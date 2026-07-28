/**
 * Parallel-runner worker: simulate one contiguous slice of a game batch.
 *
 * argv[2] = path to a job JSON: { task, seedBase, start, count }
 * stdout  = JSON: { task, start, count, results: [per-game summary, ...] }
 *
 * This is the other end of parallel.ts's job-file protocol, the same shape
 * as the sweep's sweep-worker.ts (see that file's header for the full
 * rationale): a standalone, independently invocable script, not a module the
 * parent imports. parallel.ts spawns exactly this file via execFile; this
 * script knows nothing about worker counts, slicing policy, or reduction.
 * It turns one slice description into one ordered results array via the
 * same runGamesInProcess() the single-process path uses. Debug a slice by
 * hand (parallel.ts keeps the job file on failure):
 *   node --import ./tools/register.mjs packages/harness/src/run-worker.ts /tmp/hoopsh-runner-job-<pid>-<n>.json
 *
 * Loudness contract: any malformed job or mid-slice error throws, which
 * exits nonzero with the message on stderr; the parent surfaces that and
 * fails the whole run. stdout carries only the result JSON (a stray
 * console.log here would corrupt the protocol).
 */

import { readFileSync } from 'node:fs';
import { GAME_TASK_NAMES, runGamesInProcess, type GameTaskName } from './parallel.js';

const jobPath = process.argv[2];
if (jobPath === undefined) {
  console.error('run-worker: missing job path (argv[2]) — expected a JSON file { task, seedBase, league, start, count }');
  process.exit(2);
}

interface Job { task: GameTaskName; seedBase: string; league?: string; start: number; count: number }
const job = JSON.parse(readFileSync(jobPath, 'utf8')) as Partial<Job>;

if (typeof job.task !== 'string' || !(GAME_TASK_NAMES as string[]).includes(job.task)) {
  // same phrasing as runGamesInProcess's own guard so callers/tests can
  // match one string for "the task name was bad" regardless of which side
  // of the process boundary caught it
  throw new Error(`run-worker: unknown game task ${JSON.stringify(job.task)} (valid: ${GAME_TASK_NAMES.join(', ')})`);
}
if (typeof job.seedBase !== 'string' || job.seedBase.length === 0) {
  throw new Error(`run-worker: seedBase must be a non-empty string, got ${JSON.stringify(job.seedBase)}`);
}
if (!Number.isInteger(job.start) || job.start! < 0 || !Number.isInteger(job.count) || job.count! < 0) {
  throw new Error(`run-worker: start/count must be non-negative integers, got start=${JSON.stringify(job.start)} count=${JSON.stringify(job.count)}`);
}
// league is optional (older job files / hand-written debug jobs default to
// nba); anything present must resolve or the run must die loudly here, same
// as runGamesInProcess's own resolveLeague call would
const league = job.league ?? 'nba';
if (typeof league !== 'string') {
  throw new Error(`run-worker: league must be a string, got ${JSON.stringify(job.league)}`);
}

const results = runGamesInProcess(job.task as GameTaskName, job.seedBase, job.start!, job.count!, undefined, league);
process.stdout.write(JSON.stringify({ task: job.task, start: job.start, count: job.count, results }));
