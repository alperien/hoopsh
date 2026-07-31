/**
 * standings.ts — standings fold, tiebreakers, seeding. OWNER: schedule
 * task. STATUS: STAGED stub; signatures frozen.
 * Tiebreakers (simplified officially-shaped, register F13): head-to-head,
 * division record (if same division), conference record, point diff.
 */
import type { GameRecord, League, TeamStanding } from './types.js';

export function emptyStanding(teamId: string): TeamStanding {
  return { teamId, w: 0, l: 0, homeW: 0, homeL: 0, awayW: 0, awayL: 0, confW: 0, confL: 0, divW: 0, divL: 0, ptsFor: 0, ptsAgainst: 0, streak: 0, last10: [] };
}

/** Fold one final into league.standings (mutates). */
export function applyResultToStandings(league: League, record: GameRecord): void {
  throw new Error('franchise/standings: not implemented (schedule task lands this)');
}

/** Conference seeding 1-15 with tiebreakers. */
export function conferenceSeeds(league: League, conference: 'East' | 'West'): string[] {
  throw new Error('franchise/standings: not implemented (schedule task lands this)');
}
