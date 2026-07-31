/**
 * Archetype catalog suite (people/archetypes.ts) - the identity contract.
 * Pure-function tests: the catalog's shape, the bounded sampling math, the
 * absolute identity caps, body bands, and selection tilts. Everything runs
 * on fixed streamRng paths, so every assertion is deterministic.
 */
import { describe, expect, it } from 'vitest';
import { ATTR_KEYS, TEND_KEYS } from '@hoopsh/data';
import type { Position } from '@hoopsh/engine';
import {
  ARCHETYPES, BODY_BANDS, anchorOf, archetypeById,
  pickArchetype, sampleBody, sampleIdentity,
} from '../src/people/archetypes.js';
import type { Archetype } from '../src/people/archetypes.js';
import { streamRng } from '../src/rng.js';

const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const MUTATION_SD = 7; // the params.gen.mutationSd default the sampler runs under

describe('the catalog', () => {
  it('carries 15 archetypes with unique ids and labels', () => {
    expect(ARCHETYPES.length).toBe(15);
    expect(new Set(ARCHETYPES.map((a) => a.id)).size).toBe(15);
    expect(new Set(ARCHETYPES.map((a) => a.label)).size).toBe(15);
    for (const a of ARCHETYPES) expect(archetypeById(a.id)).toBe(a);
  });

  it('covers every position with at least four eligible identities', () => {
    for (const pos of POSITIONS) {
      const eligible = ARCHETYPES.filter((a) => (a.pos[pos] ?? 0) > 0);
      expect(eligible.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('authors templates inside the rating scale and anchors inside the quality machinery band', () => {
    for (const a of ARCHETYPES) {
      for (const k of ATTR_KEYS) {
        expect(a.attr[k]).toBeGreaterThanOrEqual(1);
        expect(a.attr[k]).toBeLessThanOrEqual(99);
      }
      for (const k of TEND_KEYS) {
        expect(a.tend[k]).toBeGreaterThanOrEqual(0);
        expect(a.tend[k]).toBeLessThanOrEqual(99);
      }
      // anchors near the generated-league center keep the quality shift
      // meaningful at both rails (20 and 90)
      const anchor = anchorOf(a);
      expect(anchor).toBeGreaterThan(50);
      expect(anchor).toBeLessThan(70);
    }
  });
});

/** Group mean helper over sampled attributes. */
function gmean(attr: Record<string, number>, keys: readonly string[]): number {
  let sum = 0;
  for (const k of keys) sum += attr[k]!;
  return sum / keys.length;
}

const PLAY = ['ballHandle', 'passAcc', 'passVision'] as const;
const SCORE = ['finishing', 'midRange', 'three', 'freeThrow', 'drawFoul'] as const;
const DEF = ['perimeterD', 'interiorD', 'steal', 'block', 'contestSkill'] as const;

describe('sampleIdentity', () => {
  it('is deterministic per stream', () => {
    const arch = archetypeById('helioCreator');
    const a = sampleIdentity(streamRng('arch-det', 'x'), arch, 62, MUTATION_SD);
    const b = sampleIdentity(streamRng('arch-det', 'x'), arch, 62, MUTATION_SD);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('keeps every sampled dial an integer inside 1-99 at every quality rail', () => {
    for (const arch of ARCHETYPES) {
      for (const q of [20, 55, 90]) {
        const rng = streamRng('arch-rails', arch.id, q);
        for (let i = 0; i < 12; i++) {
          const { attr, tend } = sampleIdentity(rng, arch, q, MUTATION_SD);
          for (const k of ATTR_KEYS) {
            expect(Number.isInteger(attr[k])).toBe(true);
            expect(attr[k]).toBeGreaterThanOrEqual(1);
            expect(attr[k]).toBeLessThanOrEqual(99);
          }
          for (const k of TEND_KEYS) {
            expect(Number.isInteger(tend[k])).toBe(true);
            expect(tend[k]).toBeGreaterThanOrEqual(1);
            expect(tend[k]).toBeLessThanOrEqual(99);
          }
        }
      }
    }
  });

  it('holds the absolute identity caps whatever the dice and quality say', () => {
    const cases: Array<[Archetype['id'], number]> = [
      ['rimRunnerBig', 45], ['glassEater', 40], ['postHub', 58],
    ];
    for (const [id, cap] of cases) {
      const arch = archetypeById(id);
      const rng = streamRng('arch-caps', id);
      for (let i = 0; i < 80; i++) {
        const { attr, tend } = sampleIdentity(rng, arch, 82, MUTATION_SD);
        expect(attr.three).toBeLessThanOrEqual(cap); // a paint big never rolls a live three-ball
        if (arch.tendCaps.shotThree !== undefined) {
          expect(tend.shotThree).toBeLessThanOrEqual(arch.tendCaps.shotThree);
        }
      }
    }
  });

  it('keeps a floor general a playmaker first and a rim runner a finisher first', () => {
    const fg = archetypeById('floorGeneral');
    const rr = archetypeById('rimRunnerBig');
    const rngFg = streamRng('arch-ident', 'fg');
    const rngRr = streamRng('arch-ident', 'rr');
    let fgOk = 0;
    let rrOk = 0;
    const n = 120;
    for (let i = 0; i < n; i++) {
      const a = sampleIdentity(rngFg, fg, 58, MUTATION_SD).attr;
      if (gmean(a, PLAY) > gmean(a, SCORE) && gmean(a, PLAY) > gmean(a, DEF)) fgOk++;
      const b = sampleIdentity(rngRr, rr, 58, MUTATION_SD).attr;
      if (b.finishing > b.three + 25) rrOk++;
    }
    expect(fgOk / n).toBeGreaterThanOrEqual(0.9); // bounded noise cannot dissolve the identity
    expect(rrOk / n).toBe(1);
  });
});

describe('sampleBody', () => {
  it('stays inside the positional clamps and the possible-body envelope', () => {
    for (const pos of POSITIONS) {
      const band = BODY_BANDS[pos];
      const rng = streamRng('body', pos);
      let hSum = 0;
      let dSum = 0;
      const n = 400;
      for (let i = 0; i < n; i++) {
        const arch = pickArchetype(rng, pos, 50, 'domestic');
        const b = sampleBody(rng, pos, arch);
        expect(b.heightIn).toBeGreaterThanOrEqual(band.hLo);
        expect(b.heightIn).toBeLessThanOrEqual(band.hHi);
        expect(b.weightLb).toBeGreaterThanOrEqual(160);
        expect(b.weightLb).toBeLessThanOrEqual(310);
        const delta = b.wingspanIn - b.heightIn;
        expect(delta).toBeGreaterThanOrEqual(-1); // negative ape index exists but never extreme
        expect(delta).toBeLessThanOrEqual(11);    // the recorded-freak edge (~+27 cm)
        hSum += b.heightIn;
        dSum += delta;
      }
      // position means hold the band (the league's silhouette is stable)
      expect(Math.abs(hSum / n - band.hMean)).toBeLessThan(1.2);
      // wingspan rides 3.5-6 inches over height on average
      expect(dSum / n).toBeGreaterThan(3.5);
      expect(dSum / n).toBeLessThan(6.0);
    }
  });

  it('lets the freak tail exist without breaking the envelope', () => {
    const rng = streamRng('body', 'freaks');
    const arch = archetypeById('rimRunnerBig');
    let freaks = 0;
    const n = 1500;
    for (let i = 0; i < n; i++) {
      const b = sampleBody(rng, 'C', arch);
      if (b.wingspanIn - b.heightIn >= 8) freaks++;
    }
    expect(freaks).toBeGreaterThan(0);        // condors are real
    expect(freaks / n).toBeLessThan(0.12);    // and rare
  });
});

describe('pickArchetype', () => {
  it('only ever returns an identity eligible at the position', () => {
    for (const pos of POSITIONS) {
      const rng = streamRng('pick-elig', pos);
      for (let i = 0; i < 200; i++) {
        const a = pickArchetype(rng, pos, 30 + (i % 55), 'domestic');
        expect((a.pos[pos] ?? 0) > 0).toBe(true);
      }
    }
  });

  it('tilts stars toward creator identities and the fringe away from them', () => {
    const n = 1500;
    let heliosAtStar = 0;
    let heliosAtFringe = 0;
    const rngStar = streamRng('pick-star', 'hi');
    const rngFringe = streamRng('pick-star', 'lo');
    for (let i = 0; i < n; i++) {
      if (pickArchetype(rngStar, 'PG', 80, 'domestic').id === 'helioCreator') heliosAtStar++;
      if (pickArchetype(rngFringe, 'PG', 36, 'domestic').id === 'helioCreator') heliosAtFringe++;
    }
    expect(heliosAtStar).toBeGreaterThan(heliosAtFringe * 2);
  });

  it('leans the international pipeline toward skill bigs, mildly', () => {
    const n = 1500;
    const skill = new Set(['stretchBig', 'postHub']);
    let intl = 0;
    let dom = 0;
    const rngIntl = streamRng('pick-intl', 'i');
    const rngDom = streamRng('pick-intl', 'd');
    for (let i = 0; i < n; i++) {
      if (skill.has(pickArchetype(rngIntl, 'C', 55, 'international').id)) intl++;
      if (skill.has(pickArchetype(rngDom, 'C', 55, 'domestic').id)) dom++;
    }
    expect(intl).toBeGreaterThan(dom);            // the flavor exists
    expect(intl).toBeLessThan(dom * 2);           // and stays a nudge, not a stereotype gate
  });
});
