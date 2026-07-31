/**
 * tick.ts - the career master state machine: phase transitions, the
 * choice log, delegation to week.ts (pre-NBA) and nbabridge.ts (NBA).
 * OWNER: career-tick task. STATUS: STAGED stub; signatures frozen.
 * Determinism: a career is a pure function of (seed, choice log); this
 * file is the only mover of career time.
 */
import type { SimulateJobs } from '@hoopsh/franchise';
import type { CareerChoice, CareerState, ChoiceResult, WeekDigest } from './types.js';

/** Validate + apply a user choice now, logging it for replay. Never throws on validation. */
export function applyChoice(career: CareerState, choice: CareerChoice): ChoiceResult {
  throw new Error('career/tick: not implemented (career-tick task lands this)');
}

/** Advance one career week (or its NBA-phase equivalent). Mutates; returns the digest. */
export function advanceCareerWeek(career: CareerState, sim: SimulateJobs): Promise<WeekDigest> {
  throw new Error('career/tick: not implemented (career-tick task lands this)');
}
