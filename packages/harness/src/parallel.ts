/**
 * Reusable parallel game-runner — spread N deterministic games across W
 * worker subprocesses.
 *
 * This generalizes the sweep's proven worker pattern (sweep.ts +
 * sweep-worker.ts): a job description goes to a temp JSON file, a standalone
 * worker script (run-worker.ts) is spawned via execFile with the job path as
 * argv[2], and the worker answers with ONE JSON blob on stdout. Same
 * rationale as there — fresh process/module state per worker, an
 * independently runnable script for debugging, and free process-level
 * parallelism without hand-rolling IPC framing.
 *
 * WHAT CROSSES THE PROCESS BOUNDARY: per-game AGGREGATES only (a slim
 * team-totals summary for 'batch', a GameFlow row for 'flow') — never raw
 * event streams or frames. A game is a few thousand events; its summary is a
 * few hundred bytes. Aggregation to per-game granularity happens INSIDE the
 * worker; the cross-game reduction happens in the parent.
 *
 * DETERMINISM CONTRACT (the whole point — this repo's verification culture
 * rests on byte-identical reproducibility):
 *   1. Game i's inputs depend only on (seedBase, league, i): seed
 *      `${seedBase}-${i}`, the league's rule pack (leagues.ts — 'nba'
 *      default), home/away mirrored on odd GLOBAL index i, rosters
 *      constructed fresh per game. A worker owns a CONTIGUOUS slice of
 *      global indices, so every game is simulated with exactly the inputs
 *      the single-process path would use.
 *   2. Workers return per-game summaries IN SLICE ORDER; the parent
 *      concatenates slices in slice order, reconstructing global game order.
 *   3. The cross-game reduction (accumulate/finalize, reduceFlows) runs in
 *      the PARENT over that ordered array — the same floating-point
 *      operations in the same order as a single-process run. JSON number
 *      round-trips are exact for finite doubles, so worker-count N and
 *      worker-count 1 produce bit-identical reports.
 *   Enforced by test/parallel.test.ts (worker-count invariance).
 *
 * FAILURE POLICY: any worker failing — nonzero exit, unparsable stdout, or a
 * result envelope that doesn't match the job — aborts the sibling workers
 * and rejects the whole run with the worker's stderr attached. There is no
 * partial-result path: you get all N games or a loud error.
 */

import { execFile } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { simulateGame, type Team } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';
import type { TeamGameSummary } from './aggregate.js';
import { gameFlow, type GameFlow } from './flow-metrics.js';
import { resolveLeague, type LeagueConfig } from './leagues.js';

const execFileP = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const REGISTER = path.join(REPO_ROOT, 'tools', 'register.mjs');
const WORKER = path.join(HERE, 'run-worker.ts');

/**
 * Per-task result row types. Adding a workflow to the parallel runner means
 * adding a key here plus its per-game function in GAME_TASKS below — the
 * generic machinery (slicing, spawning, validation, ordering) is shared.
 */
export interface GameTaskResults {
  /** slim box summary — exactly the fields aggregate.ts's accumulate() reads */
  batch: TeamGameSummary;
  /** same as `batch`, but simulated with the endgame layer FORCED ON. Since
   *  the default flip (sim/game.ts `endgame ?? true`) this simulates the
   *  identical games as `batch` — kept so scripted callers that pinned the
   *  explicit flag-on config keep meaning what they meant.
   *  A separate TASK for the same reason as flowNoEndgame below. */
  batchEndgame: TeamGameSummary;
  /** `batch` with the endgame layer FORCED OFF — the legacy pre-endgame
   *  path (AGENTS.md ownership map: `endgame: false`), i.e. the non-default
   *  side of the off/on comparison now that ON is the shipped default. */
  batchNoEndgame: TeamGameSummary;
  /** per-game flow metrics — reduce with flow-metrics.ts's reduceFlows() */
  flow: GameFlow;
  /** same as `flow`, but with the endgame layer FORCED ON — identical to
   *  `flow` since the default flip; see batchEndgame above.
   *  A separate TASK rather than an option so worker payloads stay a plain
   *  (task, seedBase, slice) triple and slice invariance is unaffected. */
  flowEndgame: GameFlow;
  /** `flow` with the endgame layer FORCED OFF — the off/on comparison for
   *  its target metrics (clutch FT share, Q4 shape, tails) runs default
   *  (ON) against this legacy path. */
  flowNoEndgame: GameFlow;
}
export type GameTaskName = keyof GameTaskResults;

/**
 * Simulate global game index i's matchup under the house conventions shared
 * by every batch-shaped workflow (run.ts's runBatch, sweep-worker.ts, the
 * old flow.ts loop): seed `${seedBase}-${i}`, and odd indices swap home/away
 * so any home-side bias cancels out of batch averages (see runBatch's
 * `mirror` doc comment). Rosters are constructed FRESH per game — required
 * for slice invariance, since a worker starting at game 12 has no way to
 * share object state with games 0-11 (and must not need to). The league
 * config supplies the rule pack; rosters stay the two NBA-fit calibration
 * teams for EVERY league until an NCAA roster generator exists (see
 * data/ncaa/README.md §6.4 — deliberate, and why NCAA reports read as
 * "NBA players under college rules").
 *
 * `endgame` semantics: `true`/`false` FORCE the endgame layer on/off;
 * `undefined` OMITS the key so the game runs whatever GameConfig.endgame
 * default the engine ships (`cfg.endgame ?? …`, sim/game.ts). Omission — not
 * an explicit value — is deliberate: the default flip was a coordinated
 * engine change (REFACTOR.md W2, landed: the default is now ON), and the
 * default-config tasks here must keep grading the config that actually
 * ships, whichever way any future flip lands. Today that makes the `batch`/
 * `flow` tasks identical to their forced-ON `*Endgame` twins, and the
 * `*NoEndgame` tasks the legacy path.
 */
function playGame(seed: string, flip: boolean, league: LeagueConfig, endgame?: boolean): { events: ReturnType<typeof simulateGame>['events']; teams: [Team, Team] } {
  const def = sampleMatchup();
  const home = flip ? def.away : def.home;
  const away = flip ? def.home : def.away;
  const result = simulateGame({
    seed, home, away, rules: league.rules, collectFrames: false,
    ...(endgame === undefined ? {} : { endgame })
  });
  return { events: result.events, teams: [home, away] };
}

/** shared body of the batch / batchEndgame tasks — one code path so the
 *  flag-on measurement can never drift from the default-config gate */
function batchSummary(seed: string, flip: boolean, league: LeagueConfig, endgame?: boolean): TeamGameSummary {
  const { events, teams } = playGame(seed, flip, league, endgame);
  // pace normalizes to the league's own regulation minutes (poss/48 NBA,
  // poss/40 NCAA) so it lands in the same convention its band is stated in
  const box = boxScore(events, teams, { paceMinutes: league.paceMinutes });
  // ship ONLY what accumulate() reads — drops per-player lines and shot
  // events from the IPC payload (a full BoxScore would still be correct,
  // just needlessly large)
  return { teams: box.teams, pace: box.pace };
}

type GameTaskFns = { [K in GameTaskName]: (seed: string, flip: boolean, league: LeagueConfig) => GameTaskResults[K] };

const GAME_TASKS: GameTaskFns = {
  batch: (seed, flip, league) => batchSummary(seed, flip, league),
  batchEndgame: (seed, flip, league) => batchSummary(seed, flip, league, true),
  batchNoEndgame: (seed, flip, league) => batchSummary(seed, flip, league, false),
  flow: (seed, flip, league) => gameFlow(playGame(seed, flip, league).events, league.rules),
  flowEndgame: (seed, flip, league) => gameFlow(playGame(seed, flip, league, true).events, league.rules),
  flowNoEndgame: (seed, flip, league) => gameFlow(playGame(seed, flip, league, false).events, league.rules)
};

export const GAME_TASK_NAMES = Object.keys(GAME_TASKS) as GameTaskName[];

/**
 * Simulate games [start, start+count) of a batch in THIS process, returning
 * per-game summaries in game order. This is both the workers' inner loop
 * (run-worker.ts calls it with a slice) and the single-process path
 * (runGames with workers=1 calls it with the whole range) — one code path,
 * so the two can't drift apart.
 */
export function runGamesInProcess<K extends GameTaskName>(
  task: K,
  seedBase: string,
  start: number,
  count: number,
  onGame?: (globalIndex: number) => void,
  leagueId = 'nba'
): GameTaskResults[K][] {
  const fn = GAME_TASKS[task];
  if (fn === undefined) {
    throw new Error(`unknown game task "${String(task)}" (valid: ${GAME_TASK_NAMES.join(', ')})`);
  }
  const league = resolveLeague(leagueId); // throws loudly on a typo'd league
  const out: GameTaskResults[K][] = [];
  for (let i = start; i < start + count; i++) {
    out.push(fn(`${seedBase}-${i}`, i % 2 === 1, league));
    onGame?.(i);
  }
  return out;
}

/**
 * Parse a --workers flag value: 'auto' (the default) leaves one core for the
 * parent/rest of the box — max(1, availableParallelism() - 1); anything else
 * must be an integer >= 1. Loud on malformed input, per args.ts's
 * silent-corruption doctrine (a NaN worker count must never quietly become
 * "some default").
 */
export function resolveWorkerCount(raw: string): number {
  if (raw === 'auto') return Math.max(1, availableParallelism() - 1);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--workers requires an integer >= 1 (or "auto"), got "${raw}"`);
  }
  return n;
}

export interface ParallelRunOptions<K extends GameTaskName> {
  task: K;
  games: number;
  seedBase: string;
  /** league id (leagues.ts resolveLeague): swaps the rule pack and the pace basis. Default 'nba' — the exact pre-league-flag behavior. */
  league?: string;
  /** subprocess count; default max(1, availableParallelism() - 1). 1 = run in-process (no subprocess). */
  workers?: number;
  /** progress callback: per game in-process, per completed slice with workers */
  onProgress?: (done: number, total: number) => void;
}

interface Slice { start: number; count: number }

/** shape of run-worker.ts's stdout blob; echoes the job so a mixed-up or truncated result can't pass validation */
interface WorkerEnvelope { task: string; start: number; count: number; results: unknown[] }

let jobCounter = 0;

async function runWorkerSlice(
  task: GameTaskName,
  seedBase: string,
  league: string,
  slice: Slice,
  signal: AbortSignal
): Promise<unknown[]> {
  const jobPath = path.join(tmpdir(), `hoopsh-runner-job-${process.pid}-${jobCounter++}.json`);
  writeFileSync(jobPath, JSON.stringify({ task, seedBase, league, start: slice.start, count: slice.count }));
  let stdout: string;
  try {
    ({ stdout } = await execFileP(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', '--import', REGISTER, WORKER, jobPath],
      { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024, signal }
    ));
  } catch (err) {
    // job file is deliberately KEPT on failure so the slice can be re-run by
    // hand:  node --import ./tools/register.mjs packages/harness/src/run-worker.ts <jobPath>
    const e = err as Error & { stderr?: string; code?: unknown; signal?: unknown };
    const stderrTail = typeof e.stderr === 'string' && e.stderr.length > 0
      ? `\n--- worker stderr (tail) ---\n${e.stderr.slice(-2000)}`
      : '';
    throw Object.assign(
      new Error(`worker subprocess failed (exit code ${String(e.code)}${e.signal ? `, signal ${String(e.signal)}` : ''}); job kept at ${jobPath}${stderrTail}`),
      { isAbort: e.code === 'ABORT_ERR' || e.name === 'AbortError' }
    );
  }
  let envelope: Partial<WorkerEnvelope>;
  try {
    envelope = JSON.parse(stdout) as Partial<WorkerEnvelope>;
  } catch {
    throw new Error(`worker stdout is not valid JSON (${stdout.length} bytes, starts "${stdout.slice(0, 120)}"); job kept at ${jobPath}`);
  }
  if (
    envelope.task !== task ||
    envelope.start !== slice.start ||
    !Array.isArray(envelope.results) ||
    envelope.results.length !== slice.count
  ) {
    throw new Error(
      `worker result envelope mismatch: expected {task:"${task}", start:${slice.start}, count:${slice.count}}, ` +
      `got {task:"${String(envelope.task)}", start:${String(envelope.start)}, results.length:${Array.isArray(envelope.results) ? envelope.results.length : 'n/a'}}; job kept at ${jobPath}`
    );
  }
  // Finiteness sweep (c1-F2): JSON.stringify maps NaN/Infinity to null, so a
  // non-finite number in a per-game summary would cross this boundary as
  // null and coerce to 0 in the parent's reduction, while --workers 1
  // (in-process, no JSON) would propagate the NaN — a silent workers-N vs
  // workers-1 divergence, the exact failure this file's loudness contract
  // exists to prevent. No producer emits non-finite numbers or nulls today
  // (box/flow ratios are zero-guarded; neither row type has a null field);
  // this keeps that a loud fact rather than a lucky one.
  for (let i = 0; i < envelope.results.length; i++) {
    assertFiniteRow(envelope.results[i], `results[${slice.start + i}]`, jobPath);
  }
  unlinkSync(jobPath); // success — clean up
  return envelope.results;
}

/** Depth-first scan of one worker result row: every number must be finite,
 *  and null is rejected outright — a null where a number belongs is exactly
 *  what a non-finite number looks like after JSON.stringify, and no per-game
 *  summary field is legitimately null. */
function assertFiniteRow(v: unknown, at: string, jobPath: string): void {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`worker result ${at} is non-finite (${v}); job kept at ${jobPath}`);
    return;
  }
  if (v === null) {
    throw new Error(`worker result ${at} is null — a non-finite number crosses the JSON boundary as null; job kept at ${jobPath}`);
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) assertFiniteRow(v[i], `${at}[${i}]`, jobPath);
    return;
  }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) assertFiniteRow(x, `${at}.${k}`, jobPath);
  }
}

/**
 * Run `games` games of `task`, split contiguously across `workers`
 * subprocesses, and return the per-game summaries in GLOBAL GAME ORDER
 * (index 0..games-1). The caller owns the reduction (accumulate/finalize for
 * batch, reduceFlows for flow) — see the header's determinism contract for
 * why reduction must stay in the parent, in this order.
 *
 * workers=1 runs entirely in-process (no subprocess at all) — the escape
 * hatch that keeps the old single-process behavior directly reachable via
 * `--workers 1`.
 */
export async function runGames<K extends GameTaskName>(opts: ParallelRunOptions<K>): Promise<GameTaskResults[K][]> {
  const { task, games, seedBase, onProgress } = opts;
  const league = opts.league ?? 'nba';
  resolveLeague(league); // validate up front — better a loud parent error than W identical worker failures
  if (!Number.isInteger(games) || games < 0) {
    throw new Error(`runGames: games must be a non-negative integer, got ${String(games)}`);
  }
  const requested = opts.workers ?? Math.max(1, availableParallelism() - 1);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(`runGames: workers must be an integer >= 1, got ${String(opts.workers)}`);
  }
  // never spawn more workers than there are games
  const workers = Math.min(requested, Math.max(1, games));

  if (workers === 1) {
    return runGamesInProcess(task, seedBase, 0, games, (i) => onProgress?.(i + 1, games), league);
  }

  // contiguous, near-even slices: the first (games % workers) slices carry
  // one extra game, and slice boundaries tile 0..games-1 with no gaps
  const slices: Slice[] = [];
  const per = Math.floor(games / workers);
  const extra = games % workers;
  for (let w = 0, start = 0; w < workers; w++) {
    const count = per + (w < extra ? 1 : 0);
    slices.push({ start, count });
    start += count;
  }

  // First failure aborts the siblings (no point simulating games we'll
  // discard), then the whole run rejects listing every REAL failure —
  // abort-collateral rejections are noise, not signal, and are only
  // reported if somehow nothing else is.
  const controller = new AbortController();
  let done = 0;
  const settled = await Promise.allSettled(
    slices.map(async (slice) => {
      try {
        const results = await runWorkerSlice(task, seedBase, league, slice, controller.signal);
        done += slice.count;
        onProgress?.(done, games);
        return results;
      } catch (err) {
        controller.abort();
        throw err;
      }
    })
  );

  const failures: string[] = [];
  const abortNoise: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]!;
    if (s.status === 'rejected') {
      const reason = s.reason as Error & { isAbort?: boolean };
      const msg = `worker ${i} (games ${slices[i]!.start}-${slices[i]!.start + slices[i]!.count - 1}): ${reason instanceof Error ? reason.message : String(reason)}`;
      (reason?.isAbort ? abortNoise : failures).push(msg);
    }
  }
  if (failures.length > 0 || abortNoise.length > 0) {
    const listed = failures.length > 0 ? failures : abortNoise;
    throw new Error(
      `parallel run FAILED — ${listed.length} of ${workers} workers did not return valid results (no partial results are used):\n  ` +
      listed.join('\n  ')
    );
  }

  // concatenate slices in slice order -> global game order
  const out: GameTaskResults[K][] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') out.push(...(s.value as GameTaskResults[K][]));
  }
  if (out.length !== games) {
    // belt-and-braces: per-slice envelope validation should make this unreachable
    throw new Error(`parallel run FAILED — assembled ${out.length} game results, expected ${games}`);
  }
  return out;
}
