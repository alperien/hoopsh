// Package barrel — the CLI entry scripts (simone.ts, cli.ts, bench.ts,
// broadcast-demo.ts, export-rosters.ts, sweep.ts) are run directly via
// `node`/npm scripts and do NOT go through this barrel; what's exported here
// is the subset other packages/scripts import as a library: batch running
// (run.ts), aggregation/scoring (aggregate.ts), and the acceptance bands
// themselves (bands.ts). sweep-worker.ts and knobs.ts are deliberately NOT
// re-exported — they're sweep.ts-internal implementation, not a public API.
export { runBatch } from './run.js';
export type { BatchOptions } from './run.js';
// the parallel game-runner (run-worker.ts is its subprocess entry and, like
// sweep-worker.ts, deliberately NOT re-exported)
export { runGames, runGamesInProcess, resolveWorkerCount, GAME_TASK_NAMES } from './parallel.js';
export type { GameTaskName, GameTaskResults, ParallelRunOptions } from './parallel.js';
export {
  accumulate, emptyAcc, mergeAcc, finalize, evaluate, formatReport
} from './aggregate.js';
export type { Accumulator, LeagueAverages, BandResult, TeamGameSummary } from './aggregate.js';
export { NBA_BANDS } from './bands.js';
export type { Band } from './bands.js';
