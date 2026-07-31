/**
 * scouting.ts — fog of war. OWNER: ai-team task. STATUS: mixed stub.
 * Deterministic error: a team's read on a player derives from
 * streamRng(seed, 'scout', teamId, playerId) plus coverage; persistent,
 * never re-rolled (rng.ts registry).
 */
import type { AttrGroup, League, ScoutReport, TeamId } from './types.js';

/** What this team believes a group value is (AI decision input). */
export function perceivedGroup(league: League, teamId: TeamId, playerId: string, group: AttrGroup, kind: 'current' | 'ceiling'): number {
  throw new Error('franchise/scouting: not implemented (ai-team task lands this)');
}

/** (Re)build the user team's report for a prospect at current coverage. */
export function buildUserReport(league: League, playerId: string): ScoutReport {
  throw new Error('franchise/scouting: not implemented (ai-team task lands this)');
}

/** Combine day: bump everyone's coverage; refresh user reports. INERT until lands. */
export function runCombine(league: League): void {
  // INERT until ai-team task lands.
}
