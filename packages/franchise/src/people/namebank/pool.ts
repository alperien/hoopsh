/**
 * people/namebank/pool.ts - core types and helpers for the identity-first
 * name banks. OWNER: names task (identity rebuild wave).
 *
 * The design law: a name is generated identity-first. An Identity bundle
 * carries everything one coherent person can be made of (first-name pool,
 * surname pool, birthplace cities, registered diaspora birthplaces, club
 * countries, texture rates). The generator never mixes pools across
 * identities, so a Greek first name can never land on a Bosnian surname
 * and a Nassau birth can never carry a Portuguese first name.
 *
 * Weights are coarse integers (FEEL, census-shaped by hand). Duplicated
 * entries inside one pool are legal and simply sum their weights.
 */
import type { Rng } from '@hoopsh/engine';

/** A finished draw pool: parallel names/weights arrays for Rng.weighted. */
export interface WeightedPool {
  readonly names: readonly string[];
  readonly weights: readonly number[];
}

export type WeightedEntry = readonly [string, number];

/** Tag every listed name with one coarse weight. */
export function w(weight: number, ...names: readonly string[]): readonly WeightedEntry[] {
  return names.map((n) => [n, weight] as const);
}

/** Flatten weight groups into one draw pool. */
export function pool(...groups: readonly (readonly WeightedEntry[])[]): WeightedPool {
  const names: string[] = [];
  const weights: number[] = [];
  for (const g of groups) {
    for (const [name, weight] of g) {
      names.push(name);
      weights.push(weight);
    }
  }
  return { names, weights };
}

/** One weighted draw from a pool. All randomness flows through the passed Rng. */
export function pickFrom(rng: Rng, p: WeightedPool): string {
  return p.names[rng.weighted(p.weights)]!;
}

// ---------------------------------------------------------------------------
// birth-year cohorts (US first-name eras)

/**
 * Birth-decade buckets for US first-name pools. A prospect born 2007 draws
 * from the c2000 table; a coach born 1968 draws from c1955. The sim runs
 * decades forward, so births past 2019 HOLD the c2010 table (registered
 * choice: naming beyond the observable record extrapolates the latest era
 * rather than inventing one).
 */
export type EraKey = 'c1955' | 'c1975' | 'c1990' | 'c2000' | 'c2010';

export interface EraPools {
  readonly c1955: WeightedPool; // births 1955-1974
  readonly c1975: WeightedPool; // births 1975-1989
  readonly c1990: WeightedPool; // births 1990-1999
  readonly c2000: WeightedPool; // births 2000-2009
  readonly c2010: WeightedPool; // births 2010+, held for all later births
}

export const ERA_ORDER: readonly EraKey[] = ['c1955', 'c1975', 'c1990', 'c2000', 'c2010'];

/** Map a birth year to its cohort table (clamped at both ends). */
export function cohortOf(bornYear: number): EraKey {
  if (bornYear < 1975) return 'c1955';
  if (bornYear < 1990) return 'c1975';
  if (bornYear < 2000) return 'c1990';
  if (bornYear < 2010) return 'c2000';
  return 'c2010';
}

// ---------------------------------------------------------------------------
// identity

/** First-name source: one flat pool, or era tables keyed by birth decade. */
export type FirstPools =
  | { readonly kind: 'flat'; readonly pool: WeightedPool }
  | { readonly kind: 'era'; readonly eras: EraPools };

export function flat(p: WeightedPool): FirstPools {
  return { kind: 'flat', pool: p };
}

export function byEra(eras: EraPools): FirstPools {
  return { kind: 'era', eras };
}

/**
 * One coherent naming identity. Every generated person is drawn wholly
 * from a single Identity: first name, surname, birthplace, and the club
 * country of the bio line all tell the same story.
 */
export interface Identity {
  readonly id: string;
  /** which side of the college/international bio split this identity lives on */
  readonly kind: 'domestic' | 'international';
  /** country on the passport line ('USA' for the US identities) */
  readonly nationality: string;
  /** lineage story ('Black American', 'Franco-Malian', 'Sudanese-Australian') */
  readonly heritage?: string;
  /** relative draw weight within its kind (FEEL, pipeline-share shaped) */
  readonly weight: number;
  readonly first: FirstPools;
  readonly last: WeightedPool;
  /** primary birthplace cities, 'City, ST' or 'City, Country' */
  readonly cities: WeightedPool;
  /**
   * Registered diaspora birthplaces: part of the identity itself, never a
   * cross-pool accident (a Bosnian born in Stuttgart, a Franco-Malian born
   * in Bamako who moved young). Legal birthplaces for coherence checks.
   */
  readonly diasporaCities?: WeightedPool;
  /** chance the birthplace draws from the diaspora set (FEEL per identity) */
  readonly diasporaRate?: number;
  /** club countries for the international originDetail bio line */
  readonly clubCountries?: readonly string[];
  /** Jr./II/III rate (FEEL, ~0.03-0.05 for US identities) */
  readonly suffixRate?: number;
  /** initial-pair first-name rate (CJ, PJ, TJ), US texture */
  readonly initialsRate?: number;
  /** hyphenated double-surname rate (Alexander-Walker pattern) */
  readonly hyphenRate?: number;
}
