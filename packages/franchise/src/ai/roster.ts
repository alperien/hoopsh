/**
 * ai/roster.ts — depth charts, rotations, roster upkeep. OWNER: ai-team
 * task. STATUS: mixed — depthChart/defaultRotation THROW (gameday needs
 * them; gameday ships a temporary internal ordering until this lands);
 * aiRosterUpkeep INERT (spine calls daily).
 */
import type { League, RotationPolicy, TeamId } from '../types.js';

/** Best-first roster ordering by current ability at need positions. */
export function depthChart(league: League, teamId: TeamId): string[] {
  throw new Error('franchise/ai/roster: not implemented (ai-team task lands this)');
}

/** Rotation policy from depth chart + params.rotation tiers. */
export function defaultRotation(league: League, teamId: TeamId): RotationPolicy {
  throw new Error('franchise/ai/roster: not implemented (ai-team task lands this)');
}

/** Daily upkeep: injury replacements, 10-days, two-way call-ups, cuts. */
export function aiRosterUpkeep(league: League): void {
  // INERT until ai-team task lands.
}
