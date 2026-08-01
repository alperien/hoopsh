/**
 * people/namebank/index.ts - the identity registry.
 *
 * Aggregates every naming identity into the two draw sides (domestic and
 * international) and exposes a lookup for the coherence tests. Weights
 * are FEEL, shaped to the modern league's pipeline shares: France is the
 * biggest foreign feeder, then the Balkans, Canada rides the domestic
 * path, and East Asia stays rare by design.
 */
import type { Identity } from './pool.js';
import { US_IDENTITIES } from './us.js';
import { BALKAN_IDENTITIES } from './balkans.js';
import { FRANCE_IDENTITIES } from './france.js';
import { EUROPE_IDENTITIES } from './europe.js';
import { AFRICA_IDENTITIES } from './africa.js';
import { CANADA_IDENTITIES, LATAM_IDENTITIES } from './americas.js';
import { ASIA_PACIFIC_IDENTITIES } from './asiapacific.js';

export type { EraKey, EraPools, FirstPools, Identity, WeightedPool } from './pool.js';
export { cohortOf, ERA_ORDER, pickFrom } from './pool.js';
export { US_BLACK_ERAS, US_IDENTITIES, US_WHITE_ERAS } from './us.js';

/** Domestic draw side: the US identities plus the Canadian college pipeline. */
export const DOMESTIC_IDENTITIES: readonly Identity[] = [
  ...US_IDENTITIES,
  ...CANADA_IDENTITIES,
];

/** International draw side, weighted by pipeline share. */
export const INTL_IDENTITIES: readonly Identity[] = [
  ...FRANCE_IDENTITIES,
  ...BALKAN_IDENTITIES,
  ...EUROPE_IDENTITIES,
  ...AFRICA_IDENTITIES,
  ...LATAM_IDENTITIES,
  ...ASIA_PACIFIC_IDENTITIES,
];

/** Every identity, for audits and tests. */
export const ALL_IDENTITIES: readonly Identity[] = [
  ...DOMESTIC_IDENTITIES,
  ...INTL_IDENTITIES,
];

const BY_KEY = new Map<string, Identity>();
for (const id of ALL_IDENTITIES) {
  const key = `${id.nationality}|${id.heritage ?? ''}`;
  if (BY_KEY.has(key)) {
    // fail-loud at module init: (nationality, heritage) is the public key a
    // generated name reports, so two identities may not share one
    throw new Error(`namebank: duplicate identity key ${key}`);
  }
  BY_KEY.set(key, id);
}

/** Look an identity up by the (nationality, heritage) pair a GeneratedName carries. */
export function identityFor(nationality: string, heritage?: string): Identity | undefined {
  return BY_KEY.get(`${nationality}|${heritage ?? ''}`);
}
