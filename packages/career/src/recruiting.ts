/**
 * recruiting.ts - programs, the interest ladder, offers, signing.
 * OWNER: recruiting task. STATUS: mixed stub - buildPrograms THROWS
 * (creation-time compute), updateRecruiting INERT (tick calls weekly).
 */
import type { Rng } from '@hoopsh/engine';
import type { CareerState, Program, RouteOffer } from './types.js';

export function buildPrograms(career: CareerState, rng: Rng): Program[] {
  throw new Error('career/recruiting: not implemented (recruiting task lands this)');
}

/** Weekly: perception updates, rung moves, offers extended/pulled, letters queued. */
export function updateRecruiting(career: CareerState): void {
  // INERT until the recruiting task lands: nobody is watching yet.
}

/** The route offers on the table right now (college + pro alternatives). */
export function openOffers(career: CareerState): RouteOffer[] {
  return career.recruiting?.offers.filter(o => !career.recruiting?.committedTo || o.id === career.recruiting.committedTo) ?? [];
}
