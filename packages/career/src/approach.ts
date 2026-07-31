/**
 * approach.ts - the pre-game card projected onto my real tendencies.
 * OWNER: approach task. STATUS: STAGED stub; signatures frozen.
 */
import type { FrPlayer } from '@hoopsh/franchise';
import type { ApproachCard, ApproachRanges, CareerState } from './types.js';
import type { CareerParams } from './params.js';

/** A copy of me with the card's tendency deltas (and playing-hurt debuffs) applied. */
export function applyApproach(me: FrPlayer, card: ApproachCard & { playingHurt?: boolean }, params: CareerParams): FrPlayer {
  throw new Error('career/approach: not implemented (approach task lands this)');
}

/** How far outside the plan a card sits, 0-100 (0 = fully inside). */
export function deviationFrom(plan: ApproachRanges, card: ApproachCard): number {
  throw new Error('career/approach: not implemented (approach task lands this)');
}

/** The plan for tonight, derived from role, coach personality, and trust. */
export function planFor(career: CareerState): ApproachRanges {
  throw new Error('career/approach: not implemented (approach task lands this)');
}
