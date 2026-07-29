// Package barrel — the CLI entry scripts (simone.ts, cli.ts, bench.ts,
// broadcast-demo.ts, export-rosters.ts, sweep.ts, season-cli.ts) are run
// directly via `node`/npm scripts and do NOT go through this barrel.
//
// STAGED (honesty label, scan c3-F5): this is package.json `main` — the
// nominal `@hoopsh/harness` entry point — and it declares the intended
// library surface (batch running, aggregation/scoring, the acceptance
// bands, the season layer — see docs/SEASON.md). It currently has ZERO
// importers repo-wide: even harness's own tests import '../src/*.js'
// directly. It stays because a package needs a declared public API for the
// day another package (or an external consumer) wants the season layer as
// a library; the wiring condition is exactly that first importer.
// sweep-worker.ts and knobs.ts are deliberately NOT re-exported — they're
// sweep.ts-internal implementation, not a public API.
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
// league selection: one id resolves rule pack + bands + pace basis together
// (leagues.ts — NOT league.ts, which generates fictional season teams)
export { resolveLeague, loadNcaaBands, LEAGUE_IDS } from './leagues.js';
export type { LeagueConfig } from './leagues.js';
export {
  roundRobin, buildTasks, gameSeed, simulateTask, simulateTasksSequential,
  computeStandings, runSeason
} from './season.js';
export type {
  ScheduledGame, GameTask, GameOutcome, SimulateGames,
  TeamStanding, TeamSeasonAverages, VenueRecord, SeasonOptions, SeasonResult
} from './season.js';
export {
  simulateMatchup, formatMatchup, wilsonInterval, simsToResolveEdge, percentileSorted
} from './matchup.js';
export type {
  MatchupDistribution, MatchupOptions, PlayerLineDist, StatDist, MarginBin
} from './matchup.js';
export { makeLeague, makeLeagueTeam, scaleTeam, scalePlayer, cloneTeamWithIds } from './league.js';
