/**
 * people/names.ts — name pools and the deterministic name generator.
 * OWNER: genesis task. STATUS: STAGED stub; signatures frozen.
 * Pools are era-weighted with an international share; generated full
 * names must not collide with famous real players (blocklist) or with
 * living league players (caller checks uniqueness).
 */
import type { Rng } from '@hoopsh/engine';

export interface GeneratedName { first: string; last: string; origin: 'college' | 'international' | 'prep'; birthplace: string; originDetail: string; }

export function generateName(rng: Rng): GeneratedName {
  throw new Error('franchise/people/names: not implemented (genesis task lands this)');
}
