/**
 * week.ts - the pre-NBA week resolution: allocation effects, energy,
 * training development, grades floor, circuit game days. OWNER: week
 * task. STATUS: STAGED stub; tick.ts orchestrates, this file computes.
 */
import type { SimulateJobs } from '@hoopsh/franchise';
import type { CareerState, WeekDigest } from './types.js';

/** Resolve one pre-NBA week (allocation, games via sim, folds). Mutates. */
export function resolveWeek(career: CareerState, sim: SimulateJobs): Promise<WeekDigest> {
  throw new Error('career/week: not implemented (week task lands this)');
}
