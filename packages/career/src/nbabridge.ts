/**
 * nbabridge.ts - the player's seat inside the franchise sim: entry after
 * the draft, my game projection (approach + franchise gameday), player-
 * side contracts and agency, trades-to-me reactions, FA offers, the
 * descent market. OWNER: nba task. STATUS: STAGED stub; signatures
 * frozen. The franchise league advances through franchise/tick.ts
 * advanceDay; this module wraps career concerns around it.
 */
import type { SimulateJobs } from '@hoopsh/franchise';
import type { CareerState, WeekDigest } from './types.js';

/** Resolve one NBA-phase week (7 league days; my games get approach + events). Mutates. */
export function resolveNbaWeek(career: CareerState, sim: SimulateJobs): Promise<WeekDigest> {
  throw new Error('career/nbabridge: not implemented (nba task lands this)');
}

/** My concrete FA offers when I hit the market (career-side market view). */
export function buildMyOffers(career: CareerState): import('./types.js').RouteOffer[] {
  throw new Error('career/nbabridge: not implemented (nba task lands this)');
}

/** Advance the league N days on the internal fast sim (pre-entry world, register C11). */
export function advanceLeagueFast(career: CareerState, days: number): Promise<void> {
  throw new Error('career/nbabridge: not implemented (nba task lands this)');
}
