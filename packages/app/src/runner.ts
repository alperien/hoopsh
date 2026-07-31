/**
 * runner.ts - the worker-pool SimulateJobs implementation, following the
 * harness parallel.ts doctrine: a job slice goes to a temp JSON file, a
 * standalone worker script answers with ONE JSON blob on stdout, workers
 * own contiguous slices so global order reconstructs by concatenation,
 * and only fold results cross the process boundary (full event streams
 * ride only for detail:'events' jobs, which the spine caps at the user's
 * game and the featured game of the night).
 *
 * Determinism: each job carries its own seed; slicing cannot change any
 * game's inputs, so worker-count N and the inline path produce identical
 * results (the app test asserts it).
 *
 * FAILURE POLICY: any worker failing rejects the whole day with stderr
 * attached; there is no partial-result path (parallel.ts doctrine). The
 * job file is kept on failure for hand re-runs.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { GameJob, GameJobResult, SimulateJobs } from '@hoopsh/franchise';

const execFileP = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const WORKER = path.join(HERE, 'worker.ts');
const REGISTER = path.join(REPO_ROOT, 'tools', 'register.mjs');

export interface WorkerPoolOpts {
  /** subprocess count; defaults to cores - 1, min 1 */
  workers?: number;
  /** directory replay files land in (worker writes them for detail:'events' jobs) */
  replayDir?: string;
}

export function makeWorkerPool(opts: WorkerPoolOpts = {}): SimulateJobs {
  const workerCount = Math.max(1, opts.workers ?? availableParallelism() - 1);
  const replayDir = opts.replayDir ?? path.resolve('out', 'replays');

  return async function simulateJobsPooled(jobs: GameJob[]): Promise<GameJobResult[]> {
    if (jobs.length === 0) return [];
    mkdirSync(replayDir, { recursive: true });
    const n = Math.min(workerCount, jobs.length);
    // contiguous slices (parallel.ts doctrine): worker w owns
    // [w*size, ...] so concatenation reconstructs submission order
    const size = Math.ceil(jobs.length / n);
    const slices: GameJob[][] = [];
    for (let w = 0; w < n; w++) {
      const slice = jobs.slice(w * size, (w + 1) * size);
      if (slice.length > 0) slices.push(slice);
    }

    const runs = slices.map(async (slice, w) => {
      const jobFile = path.join(tmpdir(), `hoopsh-gm-day-${process.pid}-${Date.now()}-${w}.json`);
      writeFileSync(jobFile, JSON.stringify({ jobs: slice, replayDir }));
      try {
        const { stdout } = await execFileP(
          process.execPath,
          ['--disable-warning=ExperimentalWarning', '--import', REGISTER, WORKER, jobFile],
          { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 },
        );
        const parsed = JSON.parse(stdout) as { results: GameJobResult[] };
        if (!Array.isArray(parsed.results) || parsed.results.length !== slice.length) {
          throw new Error(`worker ${w} returned ${parsed.results?.length ?? 'no'} results for ${slice.length} jobs`);
        }
        unlinkSync(jobFile); // job files persist only on failure, for hand re-runs
        return parsed.results;
      } catch (err) {
        throw new Error(`game worker ${w} failed (job file kept at ${jobFile}): ${(err as Error).message}`);
      }
    });

    const perSlice = await Promise.all(runs);
    const flat = perSlice.flat();
    flat.sort((a, b) => a.index - b.index); // callers rely on submission order
    return flat;
  };
}
