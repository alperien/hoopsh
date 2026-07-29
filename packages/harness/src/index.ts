// @hoopsh/harness — the batch & calibration tooling entry point: parallel
// batch running, box-score aggregation scored against realism acceptance
// bands, league selection (rules + bands + pace basis under one id), and
// the round-robin season / matchup-distribution layer (docs/SEASON.md).
//
// Start here: `runGames(opts)` for parallel batches, or `runSeason(opts)`
// for a full round-robin schedule with standings.
//
// Honesty notes, so this barrel doesn't oversell:
// - Repo-internal by construction: leagues.ts reads repo-root
//   data/ncaa/acceptance-bands.json and parallel.ts spawns workers via the
//   repo's own loader (tools/register.mjs). This package cannot be consumed
//   outside the monorepo (package.json says so: private).
// - Zero importers today: the CLI entry scripts (simone.ts, cli.ts,
//   bench.ts, broadcast-demo.ts, export-rosters.ts, sweep.ts, season-cli.ts)
//   are run directly via npm scripts and do NOT go through this barrel, and
//   even harness's own tests import '../src/*.js' directly. This file is
//   the declared library surface for the first in-repo (or post-decoupling
//   external) importer who wants the batch/season layer as a library.
// - sweep-worker.ts, knobs.ts, and run-worker.ts are deliberately NOT
//   re-exported — they're sweep.ts/parallel.ts-internal implementation
//   (worker subprocess entries and knob tables), not a public API.
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
