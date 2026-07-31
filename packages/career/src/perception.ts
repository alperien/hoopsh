/**
 * perception.ts - the one fog primitive for players OUTSIDE the league
 * (prospects in circuits): recruiting programs and NBA scouts both read
 * you through this, so the two systems can never diverge. OWNER: stock
 * task (recruiting consumes). STATUS: STAGED stub; signature frozen.
 *
 * Contract mirrors franchise scouting.ts's determinism law: a FIXED
 * number of gaussian draws from a fresh stream per (observerKey, player)
 * call, never a shared advancing stream; error sd narrows with coverage.
 */
import type { AttrGroup, FrPlayer } from '@hoopsh/franchise';
import type { CareerParams } from './params.js';

export interface PerceivedGroups {
  now: Record<AttrGroup, number>;
  ceiling: Record<AttrGroup, number>;
}

/**
 * What one observer believes about a circuit player. observerKey is
 * stable per observer (a program id, an NBA team's scoutSeed); coverage
 * 0-100 narrows the error like franchise scouting coverage does.
 */
export function perceiveProspect(
  seed: string,
  observerKey: string | number,
  player: FrPlayer,
  coverage: number,
  params: CareerParams,
): PerceivedGroups {
  throw new Error('career/perception: not implemented (stock task lands this)');
}
