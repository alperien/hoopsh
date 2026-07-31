/**
 * Creation suite - validateCreation and createCareer (creation.ts).
 * Shared-build pattern: create the careers once at module load, assert
 * many (PLAYBOOK Recipe F).
 *
 * Provenance: these encode the creation acceptance criteria from the
 * build brief (docs/CAREER.md, Creating him) - the budget contract
 * (exact spend, over-cap is an error), background tradeoffs that are
 * visible on the sheet, hidden ceilings sampled over the priors, a
 * rival good enough to matter, a persona-run 30-team world with the
 * career seam set, and full determinism (a career is a pure function of
 * its opts).
 */
import { describe, expect, it } from 'vitest';
import { createCareer, validateCreation } from '../src/creation.js';
import { defaultCareerParams } from '../src/params.js';
import type { CreationSpec } from '../src/types.js';
import { abilityScore } from '../../franchise/src/gameday.js';
import type { AttrGroup, FrPlayer } from '@hoopsh/franchise';

const SEED = 'creation-suite';
const PARAMS = defaultCareerParams();

/** Fourstar budget summing to exactly 110, with scoring == defense so the aau tradeoff is isolated from the allocation. */
const FOURSTAR_BUDGET: Record<AttrGroup, number> = {
  phys: 20, scoring: 22, playmaking: 16, defense: 22, rebounding: 15, mental: 15,
};

/** Walkon budget summing to exactly 60. */
const WALKON_BUDGET: Record<AttrGroup, number> = {
  phys: 12, scoring: 14, playmaking: 8, defense: 12, rebounding: 6, mental: 8,
};

const BASE_SPEC: CreationSpec = {
  firstName: 'Trey',
  lastName: 'Vessels',
  nationality: 'us',
  birthplace: 'Akron, Ohio',
  pos: 'PG',
  heightIn: 76,
  weightLb: 195,
  background: 'aau',
  preset: 'fourstar',
  budget: FOURSTAR_BUDGET,
  signatures: ['movement-shooter', 'three-and-d'],
};

/** Build once; every describe below reads these. */
const main = createCareer({ seed: SEED, spec: BASE_SPEC });
const again = createCareer({ seed: SEED, spec: BASE_SPEC });
const late = createCareer({ seed: SEED, spec: { ...BASE_SPEC, background: 'late-bloomer' } });
const walkon = createCareer({ seed: SEED, spec: { ...BASE_SPEC, preset: 'walkon', budget: WALKON_BUDGET } });
const intl = createCareer({
  seed: SEED,
  spec: { ...BASE_SPEC, nationality: 'intl', birthplace: 'Split, Croatia', background: 'academy' },
});

const me = main.players[main.me]!;
const GROUPS: readonly AttrGroup[] = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'];

/** Mean of the attribute group backing one PotentialProfile entry (mirrors franchise types.ts field comments). */
const GROUP_ATTRS: Record<AttrGroup, ReadonlyArray<keyof FrPlayer['attr']>> = {
  phys: ['speed', 'accel', 'strength', 'vertical', 'lateral', 'stamina'],
  scoring: ['finishing', 'midRange', 'three', 'freeThrow', 'drawFoul'],
  playmaking: ['ballHandle', 'passAcc', 'passVision'],
  defense: ['perimeterD', 'interiorD', 'steal', 'block', 'contestSkill'],
  rebounding: ['offReb', 'defReb', 'boxout'],
  mental: ['decisions', 'consistency'],
};

function groupMean(p: FrPlayer, g: AttrGroup): number {
  let sum = 0;
  for (const k of GROUP_ATTRS[g]) sum += p.attr[k];
  return sum / GROUP_ATTRS[g].length;
}

function potentialSum(p: FrPlayer): number {
  let sum = 0;
  for (const g of GROUPS) sum += p.potential[g];
  return sum;
}

function meanSum(p: FrPlayer): number {
  let sum = 0;
  for (const g of GROUPS) sum += groupMean(p, g);
  return sum;
}

describe('validateCreation', () => {
  it('accepts a well-formed spec with no errors', () => {
    const v = validateCreation(BASE_SPEC, PARAMS);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('rejects overspending the preset budget', () => {
    const v = validateCreation({ ...BASE_SPEC, budget: { ...FOURSTAR_BUDGET, phys: 30 } }, PARAMS);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('120 points');
  });

  it('rejects underspending the preset budget', () => {
    const v = validateCreation({ ...BASE_SPEC, budget: { ...FOURSTAR_BUDGET, scoring: 12 } }, PARAMS);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('exactly 110');
  });

  it('rejects an over-cap group allocation instead of clamping it', () => {
    // phys 32 puts the group at 70, over the 68 cap; sum stays exactly 110
    // so the cap error is the only one
    const budget: Record<AttrGroup, number> = { phys: 32, scoring: 20, playmaking: 16, defense: 12, rebounding: 15, mental: 15 };
    const v = validateCreation({ ...BASE_SPEC, budget }, PARAMS);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('creation cap');
  });

  it('rejects a negative allocation', () => {
    const budget: Record<AttrGroup, number> = { phys: -5, scoring: 27, playmaking: 16, defense: 22, rebounding: 25, mental: 25 };
    const v = validateCreation({ ...BASE_SPEC, budget }, PARAMS);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('non-negative');
  });

  it('rejects an unplayable body: height, weight for height, wingspan for height', () => {
    expect(validateCreation({ ...BASE_SPEC, heightIn: 66 }, PARAMS).ok).toBe(false);
    expect(validateCreation({ ...BASE_SPEC, heightIn: 91 }, PARAMS).ok).toBe(false);
    expect(validateCreation({ ...BASE_SPEC, weightLb: 130 }, PARAMS).ok).toBe(false);
    expect(validateCreation({ ...BASE_SPEC, weightLb: 300 }, PARAMS).ok).toBe(false);
    expect(validateCreation({ ...BASE_SPEC, wingspanIn: 86 }, PARAMS).ok).toBe(false);
    expect(validateCreation({ ...BASE_SPEC, wingspanIn: 74 }, PARAMS).ok).toBe(false);
  });

  it('rejects empty names and duplicate signatures', () => {
    expect(validateCreation({ ...BASE_SPEC, firstName: '  ' }, PARAMS).ok).toBe(false);
    expect(validateCreation({ ...BASE_SPEC, lastName: '' }, PARAMS).ok).toBe(false);
    expect(validateCreation({ ...BASE_SPEC, signatures: ['downhill', 'downhill'] }, PARAMS).ok).toBe(false);
  });

  it('keeps the academy background international-only', () => {
    const us = validateCreation({ ...BASE_SPEC, background: 'academy' }, PARAMS);
    expect(us.ok).toBe(false);
    expect(us.errors.join(' ')).toContain('international-only');
    const ok = validateCreation(
      { ...BASE_SPEC, nationality: 'intl', birthplace: 'Split, Croatia', background: 'academy' },
      PARAMS,
    );
    expect(ok.ok).toBe(true);
  });

  it('flags an obviously US birthplace on an international prospect (advisory-light)', () => {
    const v = validateCreation({ ...BASE_SPEC, nationality: 'intl', birthplace: 'Chicago, IL' }, PARAMS);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('non-US birthplace');
  });

  it('createCareer throws on an invalid spec instead of building a broken career', () => {
    expect(() => createCareer({ seed: 'x', spec: { ...BASE_SPEC, budget: { ...FOURSTAR_BUDGET, phys: 30 } } })).toThrow('invalid spec');
  });
});

describe('determinism', () => {
  it('same opts twice produce a JSON-identical CareerState', () => {
    expect(JSON.stringify(again)).toBe(JSON.stringify(main));
  });
});

describe('me at week zero', () => {
  it('is a 17-year-old FrPlayer with the spec body and the engine wingspan default', () => {
    expect(me.bornSeason).toBe(2009); // startYear 2026 - age 17
    expect(me.pos).toBe('PG');
    expect(me.heightIn).toBe(76);
    expect(me.weightLb).toBe(195);
    expect(me.wingspanIn).toBe(78); // height + 2, the engine's own fallback
    expect(me.name).toBe('Trey Vessels');
    expect(me.status).toBe('prospect');
    expect(me.health.wear).toBe(0);
  });

  it('wears the signature identity in the 14 engine dials: a movement shooter hunts threes off motion, not iso', () => {
    expect(me.tend.shotThree).toBeGreaterThan(55);
    expect(me.tend.offBallMotion).toBeGreaterThan(60);
    expect(me.tend.iso).toBeLessThan(50);
  });

  it('shows the aau tradeoff on the sheet: scoring polish over defensive habits at equal allocations', () => {
    expect(groupMean(me, 'scoring')).toBeGreaterThan(groupMean(me, 'defense'));
  });

  it('hides real ceilings above every group: headroom exists at 17 and never passes 99', () => {
    for (const g of GROUPS) {
      expect(me.potential[g]).toBeGreaterThan(groupMean(me, g));
      expect(me.potential[g]).toBeLessThanOrEqual(99);
    }
  });

  it('samples traits into their design bands', () => {
    expect(me.workEthic).toBeGreaterThanOrEqual(5);
    expect(me.workEthic).toBeLessThanOrEqual(99);
    expect(me.health.proneness).toBeGreaterThanOrEqual(5);
    expect(me.health.proneness).toBeLessThanOrEqual(95);
    expect(me.morale).toBeGreaterThanOrEqual(40);
    expect(me.morale).toBeLessThanOrEqual(90);
  });
});

describe('backgrounds', () => {
  it('late bloomer trades visible priors now for hidden ceiling headroom, against aau on the same seed and budget', () => {
    const lateMe = late.players[late.me]!;
    expect(potentialSum(lateMe)).toBeGreaterThan(potentialSum(me));
    expect(meanSum(lateMe)).toBeLessThan(meanSum(me));
  });

  it('academy coaches the hero ball out: less iso appetite than the same build out of aau', () => {
    expect(intl.players[intl.me]!.tend.iso).toBeLessThan(me.tend.iso);
  });

  it('an international academy kid reads as an international prospect', () => {
    expect(intl.players[intl.me]!.origin).toBe('international');
    expect(intl.creation.background).toBe('academy');
  });
});

describe('the rival', () => {
  it('exists in career.players, distinct from me, seventeen like me', () => {
    const rival = main.players[main.rivalId]!;
    expect(main.rivalId).not.toBe(main.me);
    expect(rival).toBeTruthy();
    expect(main.clock.year - rival.bornSeason).toBe(17);
    expect(rival.status).toBe('prospect');
  });

  it('lands in a fourstar band: good enough to shadow my whole career', () => {
    const rival = main.players[main.rivalId]!;
    const score = abilityScore(rival);
    expect(score).toBeGreaterThanOrEqual(46);
    expect(score).toBeLessThanOrEqual(66);
  });
});

describe('the world', () => {
  it('is a full 30-team league under the career world seed', () => {
    expect(Object.keys(main.league.teams).length).toBe(30);
    expect(main.league.seed).toBe(`${SEED}:world`);
  });

  it('runs every chair on a persona, the nominated user team included', () => {
    for (const t of Object.values(main.league.teams)) expect(t.gm).toBeTruthy();
  });

  it('marks my life decisions as mine via the franchise seam', () => {
    expect(main.league.careerControlled).toEqual([main.me]);
  });

  it('keeps me and the rival out of the league until the draft', () => {
    expect(main.league.players[main.me]).toBeUndefined();
    expect(main.league.players[main.rivalId]).toBeUndefined();
  });
});

describe('the coach and the opening state', () => {
  it('starts a fourstar as the starter and a walkon in the rotation', () => {
    expect(main.coach.role).toBe('starter');
    expect(walkon.coach.role).toBe('rotation');
    expect(main.coach.trust).toBe(55);
  });

  it('writes plan widths that agree with params.trust.planWidthByRole', () => {
    for (const dial of ['assertiveness', 'range', 'motor', 'defense', 'playmaking'] as const) {
      const [lo, hi] = main.coach.plan[dial];
      expect(hi - lo).toBe(PARAMS.trust.planWidthByRole.starter);
      const [wlo, whi] = walkon.coach.plan[dial];
      expect(whi - wlo).toBe(PARAMS.trust.planWidthByRole.rotation);
    }
  });

  it('opens at the hs season start with teenage energy and a sensible default week', () => {
    expect(main.clock.phase).toBe('hs');
    expect(main.clock.year).toBe(2026);
    expect(main.clock.week).toBe(PARAMS.tick.hsSeasonStartWeek);
    expect(main.energy).toBe(85);
    expect(main.weekPlan.slots).toEqual(['extraWork', 'body', 'rest']);
    // scoring and defense tie at 22; ties break to the earlier group in
    // fixed GROUPS order, so the focus is scoring
    expect(main.weekPlan.focus).toBe('scoring');
  });

  it('seeds exactly one coach text with no choices and one phase event with a stated reason', () => {
    expect(main.phone.length).toBe(1);
    const msg = main.phone[0]!;
    expect(msg.thread).toBe('coach');
    expect(msg.from).toBe(main.coach.name);
    expect(msg.body.length).toBeGreaterThan(0);
    expect(msg.choices).toBeUndefined();
    expect(main.events.length).toBe(1);
    expect(main.events[0]!.kind).toBe('phase');
    expect(main.events[0]!.reason).toBe('senior season begins');
  });

  it('leaves the lazy-built and sibling-owned surfaces empty', () => {
    expect(main.circuit).toBe(null);
    expect(main.circuitHistory).toEqual([]);
    expect(main.recruiting!.programs).toEqual([]);
    expect(main.recruiting!.offers).toEqual([]);
    expect(main.stock!.rank).toBe(null);
    expect(main.ledger).toEqual([]);
    expect(main.choiceLog).toEqual([]);
    expect(main.nbaTeam).toBe(null);
    expect(main.epilogue).toBe(null);
    expect(main.nextApproach).toBe(null);
    expect(main.approach).toEqual({ assertiveness: 50, range: 50, motor: 50, defense: 50, playmaking: 50 });
  });
});
