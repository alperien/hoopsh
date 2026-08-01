/**
 * people/names.ts - the deterministic name generator, rebuilt
 * identity-first. OWNER: names task (identity rebuild wave).
 *
 * Design law (the "Giorgos Kulenovic" fix): every generated person rolls
 * an IDENTITY first (nationality plus heritage lineage), then draws first
 * name, surname, and birthplace from that identity's pools only. Pools
 * never mix across identities, so a name always tells one coherent story:
 * a Bosnian kid born in Stuttgart is a registered diaspora arc, a Nassau
 * kid is English-Caribbean, and a 19-year-old American is Jayden-era, not
 * Jerry-era. Identity data lives in people/namebank/ (one module per
 * region); this module owns the draw orchestration, US texture (suffixes,
 * initial-pair firsts, hyphenated surnames), the famous-name blocklist,
 * and the college/prep bio lines.
 *
 * Determinism: every draw flows through the passed Rng and the draw ORDER
 * inside each helper is fixed (identity, era, first, initials, surname,
 * hyphen, suffix, birthplace, bio). Reordering draws or resizing a pool
 * reshuffles every generated name for a given seed. That is allowed by
 * the repo's rng doctrine (AGENTS.md par 1.2) but invalidates any pinned
 * test expectations, so treat pool edits as behavioral changes.
 *
 * Transliteration doctrine: all names are ASCII (Jokic, not Jokic with
 * diacritics), consistent with the codebase's existing choice.
 */
import type { Rng } from '@hoopsh/engine';
import type { EraKey, Identity, WeightedPool } from './namebank/index.js';
import {
  cohortOf, DOMESTIC_IDENTITIES, ERA_ORDER, INTL_IDENTITIES, pickFrom, US_IDENTITIES,
} from './namebank/index.js';
import { pool, w } from './namebank/pool.js';

export interface GeneratedName {
  first: string;
  last: string;
  origin: 'college' | 'international' | 'prep';
  birthplace: string;
  /** college/academy name for domestic players, club country for international */
  originDetail: string;
  /** country on the passport line ('USA' for domestic Americans) */
  nationality: string;
  /** lineage story when one applies ('Black American', 'Franco-Malian') */
  heritage?: string;
  /** generational suffix at real-roster frequency ('Jr.', 'III') */
  suffix?: string;
}

/** Which side of the domestic/international split a draw comes from. */
export type NameKind = 'domestic' | 'international';

export interface NameOpts {
  /** birth year, used to pick the era cohort for US first names */
  bornYear?: number;
  /** force the domestic/international side instead of rolling it */
  kind?: NameKind;
}

// ---------------------------------------------------------------------------
// bio-line pools (unchanged register from the original build wave)

/**
 * Fictional but real-sounding colleges (state-school register). Shared by
 * US and Canadian players: the Canadian pipeline runs through US college
 * ball, which is why Canada sits on the domestic path.
 */
const COLLEGES: readonly string[] = [
  'Alcorn Ridge State', 'Arlington Tech', 'Bayfront State', 'Blue Ridge State', 'Brockton College',
  'Calloway State', 'Cambria State', 'Cape Fear A&M', 'Carverton', 'Cedar Grove', 'Chesapeake State',
  'Claymore College', 'Copperfield', 'Crestwood State', 'Cumberland Tech', 'Delmarva State', 'Dorchester',
  'East Plains State', 'Eastport', 'Fairhaven State', 'Falls City', 'Flint Hills State', 'Fort Landis State',
  'Gulf Coast A&M', 'Granger Tech', 'Great Lakes State', 'Greenbrier', 'Harmon College', 'High Desert State',
  'Holloway', 'Huron State', 'Ironwood Tech', 'Kingsbridge', 'Lakemont', 'Maple Valley State',
  'Meridian State', 'Midland A&M', 'North Fork State', 'Northgate', 'Oak City State', 'Ozark Tech',
  'Palisade State', 'Pinecrest', 'Port Royal State', 'Prairie Ridge State', 'Redwood State',
  'Ridgeline Tech', 'Riverbend', 'Rockdale State', 'Saltgrass State', 'Sandhill State', 'Silver Lake',
  'Southport A&M', 'Stonebrook', 'Summit Ridge', 'Tidewater Tech', 'Twin Forks State', 'Vandermeer',
  'Westgate State', 'Whitfield College', 'Willowbrook', 'Wolf Creek State',
];

/** Prep academies for the rare preps-to-pros bio line. */
const PREP_ACADEMIES: readonly string[] = [
  'Beacon Ridge Academy', 'Crestview Prep', 'Lakeshore Academy', 'Summit Prep',
  'Riverside Academy', 'Oakmont Prep', 'Harborview Academy', 'Windward Prep',
];

// ---------------------------------------------------------------------------
// US texture pools

/** Initial-pair first names (CJ Alexander register). FEEL: shared across US identities. */
const INITIAL_FIRSTS: WeightedPool = pool(
  w(3, 'CJ', 'TJ', 'PJ', 'AJ', 'RJ', 'DJ'),
  w(1, 'KJ', 'JD', 'JJ', 'BJ', 'EJ', 'JT'),
);

/** Generational suffixes at real-roster proportions (Jr. dominates). */
const SUFFIXES: WeightedPool = pool(
  w(70, 'Jr.'),
  w(18, 'III'),
  w(10, 'II'),
  w(2, 'IV'),
);

// ---------------------------------------------------------------------------
// famous-name blocklist

/**
 * Exact full-name matches rejected at generation. Curated two ways: iconic
 * all-timers (defense in depth even when a token is missing from the
 * pools) and every star, past or present, whose first AND last tokens
 * both appear in the identity pools, where a collision is a real
 * possibility rather than a hypothetical. Expanded with the identity
 * rebuild: the deeper culture-true pools made many more real names
 * reachable (De'Aaron Fox, Bilal Coulibaly, Yuta Watanabe).
 */
export const FAMOUS_BLOCKLIST: readonly string[] = [
  // all-time icons
  'Michael Jordan', 'LeBron James', 'Kobe Bryant', 'Kareem Abdul-Jabbar', 'Magic Johnson',
  'Larry Bird', 'Bill Russell', 'Wilt Chamberlain', 'Oscar Robertson', 'Jerry West',
  'Julius Erving', 'Moses Malone', 'Karl Malone', 'John Stockton', 'Hakeem Olajuwon',
  "Shaquille O'Neal", 'Tim Duncan', 'Kevin Garnett', 'Dirk Nowitzki', 'Allen Iverson',
  'Steve Nash', 'Jason Kidd', 'Vince Carter', 'Tracy McGrady', 'Ray Allen', 'Reggie Miller',
  'Scottie Pippen', 'Charles Barkley', 'Patrick Ewing', 'Dominique Wilkins', 'Isiah Thomas',
  'Isaiah Thomas', 'Dwyane Wade', 'Grant Hill', 'Shawn Kemp', 'Gary Payton', 'Tony Parker',
  'Manu Ginobili', 'Pau Gasol', 'Yao Ming', 'David Robinson', 'James Worthy', 'Earl Monroe',
  'Walter Frazier', 'Elgin Baylor', 'Paul Pierce', 'Glen Rice', 'Byron Scott', 'Reggie Jackson',
  'Dikembe Mutombo', 'Manute Bol', 'Drazen Petrovic', 'Toni Kukoc', 'Vlade Divac',
  'Peja Stojakovic', 'Arvydas Sabonis', 'Zydrunas Ilgauskas', 'Detlef Schrempf', 'Dennis Johnson',
  'Kevin Johnson', 'Kenny Smith', 'Mark Jackson', 'Steve Kerr', 'Horace Grant',
  'Charles Oakley', 'Otis Thorpe', 'Larry Nance', 'Michael Cooper', 'Tony Allen',
  'Jason Richardson', 'Jason Terry', 'Chris Webber', 'Willie Green', 'Mike Miller',
  // modern stars and rotation names, prioritized where both tokens exist in the pools
  'Stephen Curry', 'Kevin Durant', 'James Harden', 'Russell Westbrook', 'Chris Paul',
  'Anthony Davis', 'Kawhi Leonard', 'Damian Lillard', 'Paul George', 'Jimmy Butler',
  'Kyrie Irving', 'Klay Thompson', 'Draymond Green', 'Joel Embiid', 'Nikola Jokic',
  'Giannis Antetokounmpo', 'Luka Doncic', 'Jayson Tatum', 'Jaylen Brown', 'Devin Booker',
  'Donovan Mitchell', 'Trae Young', 'Ja Morant', 'Zion Williamson', 'Anthony Edwards',
  'Victor Wembanyama', 'Evan Mobley', 'Tyrese Maxey', 'Jalen Green', 'Jalen Williams',
  'Jalen Johnson', 'Jalen Suggs', 'Jalen Rose', 'Jalen Brunson', 'Jamal Murray', 'Jamal Crawford',
  'Andrew Wiggins', 'Blake Griffin', 'Derrick Rose', 'Dwight Howard', 'John Wall',
  'Kevin Love', 'Kemba Walker', 'Bradley Beal', 'Zach LaVine', 'Jrue Holiday',
  'Kristaps Porzingis', 'Rudy Gobert', 'Bilal Coulibaly', 'Jahlil Okafor', 'Franz Wagner',
  'Dennis Schroder', 'Lauri Markkanen', 'Ben Simmons', 'Marcus Smart', 'Julius Randle',
  'Dillon Brooks', 'Miles Bridges', 'Michael Porter', 'Shai Gilgeous-Alexander', 'Paolo Banchero',
  'Cade Cunningham', 'Scottie Barnes', 'Tyrese Haliburton', 'Darius Garland', 'Jaren Jackson',
  "De'Aaron Fox", "D'Angelo Russell", 'Aaron Gordon', 'Eric Gordon', 'Trey Murphy',
  'Keegan Murray', 'Jabari Smith', 'Jabari Parker', 'Marcus Morris', 'Kevin Porter',
  'Cam Thomas', 'Brandon Miller', 'Brandon Ingram', 'Anthony Black', 'Josh Green',
  'Josh Hart', 'Jordan Poole', 'Isaiah Stewart', 'Malik Beasley', 'Derrick White',
  'Norman Powell', 'Grant Williams', 'Terance Mann', 'Tyus Jones', 'Tre Jones',
  'Delon Wright', 'Dejounte Murray', 'Keldon Johnson', 'Jaylin Williams', 'Jaylen Wells',
  'Amari Bailey', 'Amir Coffey', 'Cameron Johnson', 'Cameron Payne', 'Xavier Tillman',
  'Davion Mitchell', 'Javonte Green', 'Keyonte George', 'Keon Johnson', 'Kobe Brown',
  'Reggie Bullock', 'Justin Holiday', 'Seth Curry', 'Monty Williams', 'Mike Brown',
  'Jeff Green', 'John Collins', 'Jaden Ivey', 'Emeka Okafor', 'Isaac Okoro', 'Chuma Okeke',
  'Victor Oladipo', 'RJ Barrett', 'JR Smith', 'CJ McCollum', 'PJ Tucker',
  'PJ Washington', 'TJ McConnell', 'TJ Warren', 'AJ Green', 'DJ Augustin',
  // international stars whose tokens the rebuilt pools carry
  'Nikola Jovic', 'Vasilije Micic', 'Marko Guduric', 'Boban Marjanovic', 'Bogdan Bogdanovic',
  'Bojan Bogdanovic', 'Nikola Vucevic', 'Goran Dragic', 'Jusuf Nurkic', 'Dario Saric',
  'Jonas Valanciunas', 'Domantas Sabonis', 'Davis Bertans', 'Goga Bitadze', 'Sandro Mamukelashvili',
  'Alperen Sengun', 'Cedi Osman', 'Furkan Korkmaz', 'Ersan Ilyasova', 'Kostas Papanikolaou',
  'Giorgos Kalaitzakis', 'Moritz Wagner', 'Evan Fournier', 'Nicolas Batum', 'Mathias Lessort',
  'Ousmane Dieng', 'Pascal Siakam', 'Serge Ibaka', 'Joakim Noah', 'Yuta Watanabe',
  'Rui Hachimura', 'Yuki Kawamura', 'Josh Giddey', 'Patty Mills', 'Patrick Mills',
  'Jock Landale', 'Dante Exum', 'Duop Reath', 'Dyson Daniels', 'Thon Maker',
  'Bol Bol', 'Luol Deng', 'Wenyen Gabriel', 'Marc Gasol', 'Oleksandr Zinchenko',
  'Andriy Shevchenko', 'Leandro Barbosa', 'Emanuel Ginobili', 'Deandre Ayton', 'Buddy Hield',
];

const FAMOUS = new Set(FAMOUS_BLOCKLIST);

/** True when a generated full name exactly matches a famous real player. */
export function isFamousName(fullName: string): boolean {
  return FAMOUS.has(fullName);
}

// ---------------------------------------------------------------------------
// generation constants

// FEEL 0.25: standalone-draw international share, mirroring the default
// params.gen.intlShare (REAL ~25% of the modern league is international).
// Callers that must hit an exact share (draft-class quota) force the kind
// through generateNameOfKind instead of relying on this roll.
const DEFAULT_INTL_SHARE = 0.25;
// FEEL 0.03: preps-to-pros share of US players (small tail, era-neutral).
const PREP_SHARE = 0.03;
// FEEL 64: re-roll bound against the blocklist. Blocklist density over the
// identity cross-products stays far under 1e-3, so hitting the bound is
// unreachable in practice; the throw is a fail-loud guard.
const MAX_REROLLS = 64;
// FEEL 4: bounded re-draw for the second half of a hyphenated surname.
const MAX_HYPHEN_REROLLS = 4;

// FEEL [30, 70]: era mix when a caller gives no birth year. The active
// player window in the mid-2020s is births ~1990-2007, weighted young;
// callers that know the birth year (people/gen.ts) pass it and skip this.
const DEFAULT_PLAYER_ERAS: readonly EraKey[] = ['c1990', 'c2000'];
const DEFAULT_PLAYER_ERA_WEIGHTS: readonly number[] = [30, 70];

const DOMESTIC_WEIGHTS = DOMESTIC_IDENTITIES.map((i) => i.weight);
const INTL_WEIGHTS = INTL_IDENTITIES.map((i) => i.weight);

// ---------------------------------------------------------------------------
// identity-first drawing

/**
 * First name from an identity, era-aware for the US cohort tables. Draw
 * order fixed. When no birth year is passed, the default-cohort roll is a
 * uniform slot consumed for flat-pool identities too (and discarded), per
 * the fixed-shape doctrine in drawFromIdentity.
 */
function drawFirst(rng: Rng, identity: Identity, bornYear: number | undefined): string {
  const era: EraKey = bornYear !== undefined
    ? cohortOf(bornYear)
    : DEFAULT_PLAYER_ERAS[rng.weighted(DEFAULT_PLAYER_ERA_WEIGHTS)]!;
  if (identity.first.kind === 'flat') return pickFrom(rng, identity.first.pool);
  return pickFrom(rng, identity.first.eras[era]);
}

/**
 * One complete draw from a single identity: name, texture, birthplace,
 * bio line. Never reaches outside the identity's own pools.
 */
function drawFromIdentity(rng: Rng, identity: Identity, opts?: NameOpts): GeneratedName {
  // Texture and diaspora ROLLS are unconditional (chance(0) for identities
  // without the trait): every identity consumes the same roll slots, so a
  // future rate edit flips outcomes without shifting the draw count.
  let first = drawFirst(rng, identity, opts?.bornYear);
  if (rng.chance(identity.initialsRate ?? 0)) {
    first = pickFrom(rng, INITIAL_FIRSTS);
  }

  let last = pickFrom(rng, identity.last);
  // hyphenated double surname (Alexander-Walker register); multi-word
  // surnames (De La Cruz, dos Santos) stay single
  if (rng.chance(identity.hyphenRate ?? 0) && !last.includes(' ')) {
    for (let i = 0; i < MAX_HYPHEN_REROLLS; i++) {
      const second = pickFrom(rng, identity.last);
      if (second !== last && !second.includes(' ')) {
        last = `${last}-${second}`;
        break;
      }
    }
  }

  const suffix = rng.chance(identity.suffixRate ?? 0)
    ? pickFrom(rng, SUFFIXES)
    : undefined;

  const birthplace = rng.chance(identity.diasporaRate ?? 0) && identity.diasporaCities
    ? pickFrom(rng, identity.diasporaCities)
    : pickFrom(rng, identity.cities);

  if (identity.kind === 'international') {
    return {
      first, last, origin: 'international', birthplace,
      originDetail: rng.pick(identity.clubCountries ?? [identity.nationality]),
      nationality: identity.nationality,
      ...(identity.heritage !== undefined ? { heritage: identity.heritage } : {}),
      ...(suffix !== undefined ? { suffix } : {}),
    };
  }

  // domestic path: college bio, with the small US preps-to-pros tail.
  // The roll slot is uniform across domestic identities (Canadians roll
  // and discard) per the fixed-shape doctrine above.
  const prepRoll = rng.chance(PREP_SHARE);
  const prep = identity.nationality === 'USA' && prepRoll;
  return {
    first, last,
    origin: prep ? 'prep' : 'college',
    birthplace,
    originDetail: prep ? rng.pick(PREP_ACADEMIES) : rng.pick(COLLEGES),
    nationality: identity.nationality,
    ...(identity.heritage !== undefined ? { heritage: identity.heritage } : {}),
    ...(suffix !== undefined ? { suffix } : {}),
  };
}

/**
 * Draw a name of a forced kind, re-rolling famous collisions. Used by the
 * generators when a caller controls the domestic/international mix exactly
 * (draft-class international quota) and for collision re-rolls that must
 * keep a player's origin side stable.
 */
export function generateNameOfKind(rng: Rng, kind: NameKind, opts?: NameOpts): GeneratedName {
  const identities = kind === 'international' ? INTL_IDENTITIES : DOMESTIC_IDENTITIES;
  const weights = kind === 'international' ? INTL_WEIGHTS : DOMESTIC_WEIGHTS;
  for (let i = 0; i < MAX_REROLLS; i++) {
    const identity = identities[rng.weighted(weights)]!;
    const n = drawFromIdentity(rng, identity, opts);
    if (!FAMOUS.has(`${n.first} ${n.last}`)) return n;
  }
  throw new Error('names: exhausted famous-name re-rolls (pool/blocklist misconfiguration)');
}

/**
 * Deterministic name generation: rolls the international share, then
 * delegates to the identity-first draw. Pass opts.bornYear so US first
 * names land in the right era cohort; without it the draw assumes the
 * active-player window. Uniqueness across a league is the caller's job
 * (genesis and draft-class generation keep a used-name set and re-roll
 * collisions).
 */
export function generateName(rng: Rng, opts?: NameOpts): GeneratedName {
  const kind: NameKind = opts?.kind
    ?? (rng.chance(DEFAULT_INTL_SHARE) ? 'international' : 'domestic');
  return generateNameOfKind(rng, kind, opts);
}

// ---------------------------------------------------------------------------
// staff names (older birth cohorts)

export type PersonRole = 'coach' | 'gm' | 'scout' | 'official' | 'agent' | 'reporter';

/**
 * Era mix per staff role when no birth year is given (FEEL, shaped to
 * real front-office and press-room age curves). Order matches ERA_ORDER:
 * a 58-year-old head coach is a c1955/c1975 draw (Rick, Gregg, Monty),
 * never a c2000 draw (Jayden).
 */
const ROLE_ERA_WEIGHTS: Readonly<Record<PersonRole, readonly number[]>> = {
  coach: [55, 40, 5, 0, 0],
  gm: [45, 50, 5, 0, 0],
  scout: [25, 55, 20, 0, 0],
  official: [30, 55, 15, 0, 0],
  agent: [10, 55, 35, 0, 0],
  reporter: [0, 45, 50, 5, 0],
};

/**
 * Staff identity mix (FEEL): the US identities whose first-name pools are
 * either era-tabled or era-neutral, so an older staffer never draws a
 * child-cohort coinage. Weights lean whiter and older than the player
 * pool, matching the real bench and front-office demographic.
 */
const STAFF_IDS = ['us-black', 'us-white', 'us-mexican', 'us-nigerian'] as const;
const STAFF_WEIGHTS: readonly number[] = [42, 50, 4, 4];
const STAFF_IDENTITIES: readonly Identity[] = STAFF_IDS.map((id) => {
  const found = US_IDENTITIES.find((x) => x.id === id);
  if (!found) throw new Error(`names: staff identity ${id} missing from US_IDENTITIES`);
  return found;
});

/**
 * A staff name (coach, GM, scout, official, agent, reporter): drawn from
 * OLDER birth cohorts than players, famous-collision re-rolled. Pass
 * opts.bornYear to pin the cohort exactly; otherwise the role's age curve
 * decides. Returns first/last only; staff carry no bio line.
 */
export function personName(
  rng: Rng,
  role: PersonRole,
  opts?: { bornYear?: number },
): { first: string; last: string } {
  const eraWeights = ROLE_ERA_WEIGHTS[role];
  for (let i = 0; i < MAX_REROLLS; i++) {
    const identity = STAFF_IDENTITIES[rng.weighted(STAFF_WEIGHTS)]!;
    let first: string;
    if (identity.first.kind === 'flat') {
      first = pickFrom(rng, identity.first.pool);
    } else {
      const era: EraKey = opts?.bornYear !== undefined
        ? cohortOf(opts.bornYear)
        : ERA_ORDER[rng.weighted(eraWeights)]!;
      first = pickFrom(rng, identity.first.eras[era]);
    }
    const last = pickFrom(rng, identity.last);
    if (!FAMOUS.has(`${first} ${last}`)) return { first, last };
  }
  throw new Error('names: exhausted staff-name re-rolls (pool/blocklist misconfiguration)');
}

// ---------------------------------------------------------------------------
// legacy pool exports

function distinctSorted(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort();
}

function collectFirsts(identities: readonly Identity[]): string[] {
  const out: string[] = [];
  for (const id of identities) {
    if (id.first.kind === 'flat') out.push(...id.first.pool.names);
    else for (const key of ERA_ORDER) out.push(...id.first.eras[key].names);
  }
  return out;
}

/**
 * Legacy exports from the pre-identity generator, kept for back-compat:
 * the distinct US first names and surnames across every US identity and
 * era cohort. New code should draw through generateName, never from
 * these flat lists (they erase era and culture pairing).
 */
export const US_FIRST: readonly string[] = distinctSorted(collectFirsts(US_IDENTITIES));
export const US_LAST: readonly string[] = distinctSorted(
  US_IDENTITIES.flatMap((id) => [...id.last.names]),
);
