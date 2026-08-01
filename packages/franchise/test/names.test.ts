/**
 * Name-generator tests (identity rebuild wave): coherence (a name never
 * mixes identities), era cohorts (a 2007-born kid is not named Jerry, a
 * coach is not named Jayden), US texture rates, determinism, the famous
 * blocklist, back-compat of the legacy GeneratedName surface, and the
 * pool scale floor. All sampling runs on fixed seeds, so every assertion
 * is deterministic.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '@hoopsh/engine';
import {
  FAMOUS_BLOCKLIST, generateName, generateNameOfKind, isFamousName, personName, US_FIRST, US_LAST,
} from '../src/people/names.js';
import type { GeneratedName } from '../src/people/names.js';
import {
  ALL_IDENTITIES, ERA_ORDER, identityFor, US_BLACK_ERAS, US_WHITE_ERAS,
} from '../src/people/namebank/index.js';
import type { Identity, WeightedPool } from '../src/people/namebank/index.js';

// ---------------------------------------------------------------------------
// helpers

function poolSet(p: WeightedPool): Set<string> {
  return new Set(p.names);
}

function firstNameSet(identity: Identity): Set<string> {
  if (identity.first.kind === 'flat') return poolSet(identity.first.pool);
  const out = new Set<string>();
  for (const key of ERA_ORDER) for (const n of identity.first.eras[key].names) out.add(n);
  return out;
}

function legalBirthplaces(identity: Identity): Set<string> {
  const out = poolSet(identity.cities);
  if (identity.diasporaCities) for (const c of identity.diasporaCities.names) out.add(c);
  return out;
}

/** Surname legality including the hyphenated double-surname texture. */
function surnameLegal(identity: Identity, last: string): boolean {
  const pool = poolSet(identity.last);
  if (pool.has(last)) return true;
  const dash = last.indexOf('-');
  if (dash <= 0) return false;
  return pool.has(last.slice(0, dash)) && pool.has(last.slice(dash + 1));
}

const INITIALS = /^[A-Z]{2}$/;

// names that read one generation too old for a 2005+ birth (the
// "19-year-old named Jerry" bug this rebuild kills)
const OLD_TIER = ['Jerry', 'Richard', 'Clark', 'Gerald', 'Harold', 'Herbert', 'Clarence', 'Roosevelt', 'Rick', 'Bob', 'Larry', 'Norm'];
// names that read like a 2005+ birth (never on a bench boss's placard)
const KID_TIER = ['Jayden', 'Kayden', 'Zayden', 'Jaxon', 'Zaire', 'Mekhi', 'Kyree', 'Zyaire', 'Kairo', 'Kingston'];

// ---------------------------------------------------------------------------

describe('identity coherence (the Giorgos Kulenovic fix)', () => {
  it('every international draw keeps first, surname, and birthplace inside one identity', () => {
    const rng = new Rng('names-coherence-intl');
    for (let i = 0; i < 500; i++) {
      const n = generateNameOfKind(rng, 'international');
      const identity = identityFor(n.nationality, n.heritage);
      expect(identity).toBeDefined();
      expect(firstNameSet(identity!).has(n.first)).toBe(true);
      expect(surnameLegal(identity!, n.last)).toBe(true);
      expect(legalBirthplaces(identity!).has(n.birthplace)).toBe(true);
      expect(n.origin).toBe('international');
      // originDetail is the club country line
      expect(identity!.clubCountries).toContain(n.originDetail);
    }
  });

  it('every domestic draw keeps its parts inside one identity (initial-pair firsts excepted)', () => {
    const rng = new Rng('names-coherence-dom');
    for (let i = 0; i < 500; i++) {
      const n = generateNameOfKind(rng, 'domestic');
      const identity = identityFor(n.nationality, n.heritage);
      expect(identity).toBeDefined();
      if (!INITIALS.test(n.first)) {
        expect(firstNameSet(identity!).has(n.first)).toBe(true);
      }
      expect(surnameLegal(identity!, n.last)).toBe(true);
      expect(legalBirthplaces(identity!).has(n.birthplace)).toBe(true);
      expect(['college', 'prep']).toContain(n.origin);
    }
  });
});

describe('era cohorts', () => {
  it('pools for 2000s/2010s births carry no Jerry-tier names', () => {
    for (const eras of [US_BLACK_ERAS, US_WHITE_ERAS]) {
      for (const key of ['c2000', 'c2010'] as const) {
        const names = poolSet(eras[key]);
        for (const banned of OLD_TIER) {
          expect(names.has(banned)).toBe(false);
        }
      }
    }
  });

  it('coach-cohort pools (1955-1989 births) carry no Jayden-tier names', () => {
    for (const eras of [US_BLACK_ERAS, US_WHITE_ERAS]) {
      for (const key of ['c1955', 'c1975'] as const) {
        const names = poolSet(eras[key]);
        for (const banned of KID_TIER) {
          expect(names.has(banned)).toBe(false);
        }
      }
    }
  });

  it('a 2007-born domestic prospect never draws a Jerry-tier first name', () => {
    const rng = new Rng('names-era-prospects');
    for (let i = 0; i < 300; i++) {
      const n = generateNameOfKind(rng, 'domestic', { bornYear: 2007 });
      expect(OLD_TIER).not.toContain(n.first);
    }
  });

  it('a 1968-born coach never draws a Jayden-tier first name', () => {
    const rng = new Rng('names-era-coaches');
    for (let i = 0; i < 300; i++) {
      const n = personName(rng, 'coach', { bornYear: 1968 });
      expect(KID_TIER).not.toContain(n.first);
      expect(n.first.length).toBeGreaterThan(0);
      expect(n.last.length).toBeGreaterThan(0);
    }
  });
});

describe('US texture rates', () => {
  it('suffixes land at 1-8% and hyphenated surnames at 0.5-5% over 1000+ US samples', () => {
    const rng = new Rng('names-texture');
    let us = 0;
    let suffix = 0;
    let hyphen = 0;
    let initials = 0;
    for (let i = 0; i < 2000; i++) {
      const n = generateNameOfKind(rng, 'domestic');
      if (n.nationality !== 'USA') continue; // Canada rides the domestic path
      us++;
      if (n.suffix) suffix++;
      if (n.last.includes('-')) hyphen++;
      if (INITIALS.test(n.first)) initials++;
    }
    expect(us).toBeGreaterThan(1000);
    expect(suffix / us).toBeGreaterThanOrEqual(0.01);
    expect(suffix / us).toBeLessThanOrEqual(0.08);
    expect(hyphen / us).toBeGreaterThanOrEqual(0.005);
    expect(hyphen / us).toBeLessThanOrEqual(0.05);
    // initial-pair firsts (CJ, TJ) run 1-6%
    expect(initials / us).toBeGreaterThanOrEqual(0.01);
    expect(initials / us).toBeLessThanOrEqual(0.06);
  });

  it('suffixes come from the real set', () => {
    const rng = new Rng('names-suffix-set');
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const n = generateName(rng);
      if (n.suffix) seen.add(n.suffix);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const s of seen) expect(['Jr.', 'II', 'III', 'IV']).toContain(s);
  });
});

describe('determinism', () => {
  it('same seeded rng sequence produces the identical name sequence', () => {
    const a = new Rng('names-det');
    const b = new Rng('names-det');
    for (let i = 0; i < 300; i++) {
      expect(generateName(a)).toEqual(generateName(b));
    }
  });

  it('personName is deterministic per seed and role', () => {
    const a = new Rng('names-det-staff');
    const b = new Rng('names-det-staff');
    for (let i = 0; i < 100; i++) {
      expect(personName(a, 'coach')).toEqual(personName(b, 'coach'));
      expect(personName(a, 'reporter', { bornYear: 1985 })).toEqual(personName(b, 'reporter', { bornYear: 1985 }));
    }
  });

  it('opts do not leak state: bornYear changes draws only through the cohort', () => {
    const a = new Rng('names-opts');
    const b = new Rng('names-opts');
    for (let i = 0; i < 50; i++) {
      expect(generateName(a, { bornYear: 2007 })).toEqual(generateName(b, { bornYear: 2007 }));
    }
  });
});

describe('famous blocklist', () => {
  it('flags exact famous names and passes everything else', () => {
    expect(isFamousName('Michael Jordan')).toBe(true);
    expect(isFamousName('LeBron James')).toBe(true);
    expect(isFamousName('Bilal Coulibaly')).toBe(true);
    expect(isFamousName("De'Aaron Fox")).toBe(true);
    expect(isFamousName('Yuta Watanabe')).toBe(true);
    expect(isFamousName('Michael Jordans')).toBe(false);
    expect(isFamousName('Dusan Jokic')).toBe(false);
  });

  it('generation never emits a blocklisted full name', () => {
    const rng = new Rng('names-blocklist');
    for (let i = 0; i < 2000; i++) {
      const n = generateName(rng);
      expect(isFamousName(`${n.first} ${n.last}`)).toBe(false);
    }
    for (let i = 0; i < 500; i++) {
      const p = personName(rng, 'coach');
      expect(isFamousName(`${p.first} ${p.last}`)).toBe(false);
    }
  });

  it('blocklist entries are unique', () => {
    expect(new Set(FAMOUS_BLOCKLIST).size).toBe(FAMOUS_BLOCKLIST.length);
  });
});

describe('back-compat surface', () => {
  it('generateName(rng) with no opts returns a valid legacy GeneratedName plus the new fields', () => {
    const rng = new Rng('names-compat');
    for (let i = 0; i < 200; i++) {
      const n: GeneratedName = generateName(rng);
      expect(n.first.length).toBeGreaterThan(0);
      expect(n.last.length).toBeGreaterThan(0);
      expect(['college', 'international', 'prep']).toContain(n.origin);
      expect(n.birthplace.length).toBeGreaterThan(0);
      expect(n.originDetail.length).toBeGreaterThan(0);
      // additive fields with contract semantics
      expect(n.nationality.length).toBeGreaterThan(0);
      if (n.origin === 'international') {
        expect(n.nationality).not.toBe('USA');
      } else {
        expect(['USA', 'Canada']).toContain(n.nationality);
      }
      if (n.suffix !== undefined) expect(['Jr.', 'II', 'III', 'IV']).toContain(n.suffix);
    }
  });

  it('generateNameOfKind still honors the two-argument call shape', () => {
    const rng = new Rng('names-compat-kind');
    for (let i = 0; i < 100; i++) {
      expect(generateNameOfKind(rng, 'international').origin).toBe('international');
      expect(['college', 'prep']).toContain(generateNameOfKind(rng, 'domestic').origin);
    }
  });

  it('legacy US pool exports stay populated', () => {
    expect(US_FIRST.length).toBeGreaterThan(350);
    expect(US_LAST.length).toBeGreaterThan(450);
  });
});

describe('scale floor', () => {
  it('the banks hold at least 2000 distinct first names and 2000 distinct surnames', () => {
    const firsts = new Set<string>();
    const lasts = new Set<string>();
    for (const id of ALL_IDENTITIES) {
      for (const n of firstNameSet(id)) firsts.add(n);
      for (const n of id.last.names) lasts.add(n);
    }
    expect(firsts.size).toBeGreaterThanOrEqual(2000);
    expect(lasts.size).toBeGreaterThanOrEqual(2000);
  });

  it('every identity is drawable: nonempty pools and positive weight', () => {
    for (const id of ALL_IDENTITIES) {
      expect(id.weight).toBeGreaterThan(0);
      expect(firstNameSet(id).size).toBeGreaterThan(0);
      expect(id.last.names.length).toBeGreaterThan(0);
      expect(id.cities.names.length).toBeGreaterThan(0);
      if (id.kind === 'international') {
        expect(id.clubCountries && id.clubCountries.length > 0).toBe(true);
      }
      if (id.diasporaRate) expect(id.diasporaCities).toBeDefined();
    }
  });
});
