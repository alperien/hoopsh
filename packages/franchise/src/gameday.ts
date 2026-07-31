/**
 * gameday.ts — projection from franchise truth to engine inputs, and the
 * result fold back. OWNER: spine task. STATUS: STAGED stub; signatures
 * frozen.
 *
 * Projection applies, in order: roster health (injured players excluded),
 * rotation policy -> engine rotationMinutes, fatigue (stamina debuff from
 * B2B/load), and home-court advantage as the road-team attribute debuff
 * (params.hca; the engine is side-symmetric and stays that way).
 * extractKeyPlays lives HERE (not media/) because workers fold with it.
 */
import type { GameEvent, Team } from '@hoopsh/engine';
import type { GameJob, GameJobResult, GameRecord, KeyPlay, League } from './types.js';

/** Project one franchise team into an engine Team for a specific game. */
export function projectTeam(league: League, teamId: string, opts: { isHome: boolean; gameId: string }): Team {
  throw new Error('franchise/gameday: not implemented (spine task lands this)');
}

/** Plan the jobs for every game scheduled today. */
export function planDayJobs(league: League): GameJob[] {
  throw new Error('franchise/gameday: not implemented (spine task lands this)');
}

/** Fold a finished game's events into the persisted result shape. */
export function foldEvents(job: GameJob, events: GameEvent[]): GameJobResult {
  throw new Error('franchise/gameday: not implemented (spine task lands this)');
}

/** Key-play extraction used by the fold (runs, buzzer beaters, milestones). */
export function extractKeyPlays(events: GameEvent[], names: Record<string, string>): KeyPlay[] {
  throw new Error('franchise/gameday: not implemented (spine task lands this)');
}

/** Apply completed results to league state (stats rows, standings inputs, records feed). */
export function applyGameResults(league: League, results: GameJobResult[]): GameRecord[] {
  throw new Error('franchise/gameday: not implemented (spine task lands this)');
}

/** Sequential in-process SimulateJobs (engine direct); tests and 1-game days. */
export function simulateJobsInline(jobs: import('./types.js').GameJob[]): import('./types.js').GameJobResult[] {
  throw new Error('franchise/gameday: not implemented (spine task lands this)');
}
