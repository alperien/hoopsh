/**
 * people/gen.ts — player generation: genesis rosters, draft classes,
 * coaches. OWNER: genesis task. STATUS: STAGED stub; signatures frozen.
 * Method (docs/FRANCHISE.md §5): start from an archetype profile
 * (@hoopsh/data builders), mutate within CAN/WANT coherence, age-adjust,
 * sample ceiling headroom. Anthropometrics hold distribution across
 * decades.
 */
import type { Rng } from '@hoopsh/engine';
import type { Coach, FrPlayer, League, Season } from '../types.js';

export interface GenPlayerOpts {
  age: number;                 // age at the season being generated for
  season: Season;              // current season (bornSeason = season - age)
  quality?: number;            // 0-100 center of mass; default league-shaped
  idSeq: number;               // caller-owned unique sequence for PlayerId
}

export function generatePlayer(rng: Rng, opts: GenPlayerOpts): FrPlayer {
  throw new Error('franchise/people/gen: not implemented (genesis task lands this)');
}

/** A full draft class (params.gen.draftPoolSize prospects, status draftEligible). */
export function generateDraftClass(league: League, season: Season): FrPlayer[] {
  throw new Error('franchise/people/gen: not implemented (genesis task lands this)');
}

export function generateCoach(rng: Rng, idSeq: number): Coach {
  throw new Error('franchise/people/gen: not implemented (genesis task lands this)');
}
