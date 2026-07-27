// Package barrel — the CLI entry scripts (simone.ts, cli.ts, bench.ts,
// broadcast-demo.ts, export-rosters.ts, sweep.ts, season-cli.ts) are run
// directly via `node`/npm scripts and do NOT go through this barrel; what's
// exported here is the subset other packages/scripts import as a library:
// batch running (run.ts), aggregation/scoring (aggregate.ts), the acceptance
// bands themselves (bands.ts), and the season layer (season.ts, matchup.ts,
// league.ts — see docs/SEASON.md). sweep-worker.ts and knobs.ts are
// deliberately NOT re-exported — they're sweep.ts-internal implementation,
// not a public API.
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
