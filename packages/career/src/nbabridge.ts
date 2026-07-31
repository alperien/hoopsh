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

// ---------------------------------------------------------------------------
// choice application seams (tick.ts routes here; never throw for a bad id,
// return { ok: false, errors } instead)

/** A pending contract decision answered (extension, option, qualifying offer). */
export function applyContractDecision(career: CareerState, decisionId: string, choiceId: string): { ok: boolean; errors: string[] } {
  return { ok: false, errors: ['contract decisions are not available yet (nba task lands this)'] };
}

/** Accept one of buildMyOffers' NBA offers (undrafted or FA market). */
export function applyNbaOffer(career: CareerState, offerId: string): { ok: boolean; errors: string[] } {
  return { ok: false, errors: ['NBA offers are not available yet (nba task lands this)'] };
}

/** Accept an abroad offer (the descent: China, Europe). Moves phase. */
export function applyAbroadOffer(career: CareerState, offerId: string): { ok: boolean; errors: string[] } {
  return { ok: false, errors: ['abroad offers are not available yet (nba task lands this)'] };
}

/** Raise or withdraw my trade request; the team reacts on its own clock. */
export function setTradeRequest(career: CareerState, on: boolean): { ok: boolean; errors: string[] } {
  return { ok: false, errors: ['trade requests are not available yet (nba task lands this)'] };
}
