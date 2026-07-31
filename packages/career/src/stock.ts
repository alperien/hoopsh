/**
 * stock.ts - draft stock: per-team perception, the weekly mock, combine,
 * workouts, and the draft-night insertion. OWNER: stock task. STATUS:
 * mixed stub - updateStock INERT (tick calls weekly), the rest THROWS.
 */
import type { CareerState } from './types.js';
import type { TeamId } from '@hoopsh/franchise';

/** Weekly: recompute per-team perception, move the rank, write the reason. */
export function updateStock(career: CareerState): void {
  // INERT until the stock task lands: no one has you on a board yet.
}

/** Combine week: measurements go public; everyone reprices. */
export function runCombineWeek(career: CareerState): void {
  // INERT until the stock task lands.
}

/** A workout with one team: their scouts see more truth. */
export function attendWorkout(career: CareerState, teamId: TeamId): void {
  throw new Error('career/stock: not implemented (stock task lands this)');
}

/**
 * Draft entry: insert me (and the rival, when his path leads here) into
 * the league's draft class so the real AI boards see us natively.
 */
export function enterDraftClass(career: CareerState): void {
  throw new Error('career/stock: not implemented (stock task lands this)');
}
