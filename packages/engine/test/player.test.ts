/**
 * Spec-derived unit tests for model/player.ts — makePlayer/makeTactics, the
 * fixture factories every test and pack loader in the repo leans on.
 * Expectations come from the documented default tables (player.ts:152-188),
 * the factory JSDoc (player.ts:192-214), and the module header's "all 0-100"
 * contract — not from the function bodies.
 */
import { describe, expect, it } from 'vitest';
import { makePlayer, makeTactics } from '@hoopsh/engine';

// The 24 documented rating dials (model/player.ts:13-71) and 14 documented
// tendency dials (model/player.ts:73-118), sorted. A key appearing or
// vanishing here is exactly the alarm AGENTS.md DO-NOT #2 wants: attribute
// depth is added only against a failing fidelity case, never speculatively.
const ATTR_KEYS = [
  'accel', 'ballHandle', 'block', 'boxout', 'consistency', 'contestSkill',
  'decisions', 'defReb', 'drawFoul', 'finishing', 'freeThrow', 'interiorD',
  'lateral', 'midRange', 'offReb', 'passAcc', 'passVision', 'perimeterD',
  'speed', 'stamina', 'steal', 'strength', 'three', 'vertical'
];
const TEND_KEYS = [
  'crashOffReb', 'drive', 'foulAggr', 'gambleSteal', 'iso', 'offBallMotion',
  'passOut', 'post', 'pullUp', 'pushPace', 'shotMid', 'shotRim', 'shotThree',
  'usage'
];

describe('makePlayer default attributes', () => {
  // spec: model/player.ts:152-165 — "Every attribute at exactly 50 by
  // design": n(50) = 0 (model/derived.ts), so the default player is
  // formula-neutral — you only pay for ratings you push away from 50.
  it('every documented attribute is present and exactly 50', () => {
    const attr = makePlayer({ id: 'pd-1' }).attr;
    expect(Object.keys(attr).sort()).toEqual(ATTR_KEYS);
    for (const key of ATTR_KEYS) {
      expect((attr as unknown as Record<string, number>)[key]).toBe(50);
    }
  });
});

describe('makePlayer default tendencies', () => {
  const tend = makePlayer({ id: 'pd-2' }).tend;
  const tendRec = tend as unknown as Record<string, number>;

  it('carries exactly the documented tendency surface, all inside 0-100', () => {
    // spec: model/player.ts:1-3 ("All 0-100, human-editable") + :73-118
    expect(Object.keys(tend).sort()).toEqual(TEND_KEYS);
    for (const key of TEND_KEYS) {
      expect(tendRec[key]).toBeGreaterThanOrEqual(0);
      expect(tendRec[key]).toBeLessThanOrEqual(100);
    }
  });

  // spec: model/player.ts:167-188 — the defaults encode the documented
  // modern pace-and-space shot diet, each value with a stated basketball
  // reason: the long two is the least efficient shot (shotMid suppressed to
  // 30), attempts at the rim still outnumber threes (shotRim 50 > shotThree
  // 40), the default player attacks downhill rather than settling (drive 45
  // > pullUp 35), and iso/post are low-frequency actions leaguewide (25/15).
  it('pins the documented shot-diet values', () => {
    expect(tend.shotRim).toBe(50);
    expect(tend.shotThree).toBe(40);
    expect(tend.shotMid).toBe(30);
    expect(tend.pullUp).toBe(35);
    expect(tend.drive).toBe(45);
    expect(tend.iso).toBe(25);
    expect(tend.post).toBe(15);
  });

  // spec: model/player.ts:181-188 — the six defaults outside the shot diet
  // are hand-set table entries too (no SWEPT calibration tag anywhere in
  // model/player.ts; sweep-owned values live in sim/params.ts), so they pin
  // exactly like the diet: passOut 50, offBallMotion 45, crashOffReb 40,
  // gambleSteal 35, foulAggr 40, pushPace 45. pushPace's CONSUMER is staged
  // (player.ts:106-107, Stage 2), but its default is a shipped constant
  // today. Without these pins the 0-100 bracket above was the only guard on
  // all six — any drift inside the range passed unseen.
  it('pins the hand-set off-diet defaults exactly', () => {
    expect(tend.passOut).toBe(50);
    expect(tend.offBallMotion).toBe(45);
    expect(tend.crashOffReb).toBe(40);
    expect(tend.gambleSteal).toBe(35);
    expect(tend.foulAggr).toBe(40);
    expect(tend.pushPace).toBe(45);
  });

  it('keeps the documented modern-diet ordering: shotMid < shotThree < shotRim', () => {
    expect(tend.shotMid).toBeLessThan(tend.shotThree);
    expect(tend.shotThree).toBeLessThan(tend.shotRim);
    // both clear-out actions sit low, post below iso (player.ts:178-180)
    expect(tend.post).toBeLessThan(tend.iso);
  });

  it('usage defaults to 50 — the league-average ~20% offensive load', () => {
    // spec: model/player.ts:110-117 — usage maps to real USG%: 50 ~ 20%
    expect(tend.usage).toBe(50);
  });
});

describe('makePlayer identity defaults and override merge', () => {
  // spec: model/player.ts:192-210 — "Build a player from partial overrides
  // — the workhorse of tests & fixtures": defaults pos 'SF', heightIn 78 in,
  // weightLb 215 lb, wingspanIn unrecorded (reachFt then falls back).
  it('defaults the physical identity of a league-average wing', () => {
    const p = makePlayer({ id: 'pd-3' });
    expect(p.id).toBe('pd-3');
    expect(p.pos).toBe('SF');
    expect(p.heightIn).toBe(78); // 6'6" in inches
    expect(p.weightLb).toBe(215); // pounds
    expect(p.wingspanIn).toBe(undefined); // unrecorded, not zero
  });

  it('an attr override changes only that dial; everything else stays 50', () => {
    const p = makePlayer({ id: 'pd-4', attr: { three: 99 } });
    expect(p.attr.three).toBe(99);
    expect(p.attr.speed).toBe(50);
    expect(p.attr.midRange).toBe(50);
    expect(p.tend.shotRim).toBe(50); // tend table untouched by an attr override
  });

  it('a tend override merges over the diet defaults the same way', () => {
    const p = makePlayer({ id: 'pd-5', tend: { shotThree: 80 } });
    expect(p.tend.shotThree).toBe(80);
    expect(p.tend.shotMid).toBe(30);
    expect(p.attr.three).toBe(50);
  });

  it('top-level overrides are taken verbatim', () => {
    const p = makePlayer({
      id: 'pd-6', name: 'Custom Name', pos: 'C', heightIn: 84, weightLb: 260, wingspanIn: 90
    });
    expect(p.name).toBe('Custom Name');
    expect(p.pos).toBe('C');
    expect(p.heightIn).toBe(84);
    expect(p.weightLb).toBe(260);
    expect(p.wingspanIn).toBe(90);
  });

  it('overriding one player never leaks into later defaults or shares rating objects', () => {
    // the factory's whole value as a fixture builder: players are
    // independent value objects. A shared attr/tend reference (or a spread
    // that wrote into the default table) would let one test's mutation
    // corrupt every later fixture.
    const hot = makePlayer({ id: 'pd-7', attr: { three: 99 }, tend: { shotThree: 95 } });
    const fresh = makePlayer({ id: 'pd-8' });
    expect(fresh.attr.three).toBe(50);
    expect(fresh.tend.shotThree).toBe(40);
    expect(fresh.attr).not.toBe(hot.attr);
    expect(fresh.tend).not.toBe(hot.tend);
  });

  it('two NO-override players never share attribute or tendency tables', () => {
    // the aliasing failure mode the override-vs-default pairing above cannot
    // see: handing DEFAULT_ATTR/DEFAULT_TEND out by reference whenever no
    // override is passed (mutation-audit survivor M9) aliases exactly the
    // default-vs-default pair. The argument itself is required by the API
    // (makePlayer reads partial.id unconditionally), so the two {}-built
    // players below ARE the no-override extreme.
    const a = makePlayer({ id: 'pd-9' });
    const b = makePlayer({ id: 'pd-10' });
    expect(a.attr).not.toBe(b.attr);
    expect(a.tend).not.toBe(b.tend);
    // and independence is real, not just referential: writing through one
    // player's dial must not surface in the other (a shared mutable table
    // would let one test's mutation corrupt every later fixture)
    a.attr.three = 99;
    a.tend.shotThree = 95;
    expect(b.attr.three).toBe(50);
    expect(b.tend.shotThree).toBe(40);
  });

  it('auto-generated ids are unique across calls', () => {
    // spec: model/player.ts:190-201 — id defaults to `p<n>` off a module
    // counter. Uniqueness is the promise; the counter being ambient is why
    // fixtures must pass explicit ids (findings/fixtures.md recipe 2 trap).
    const a = makePlayer({});
    const b = makePlayer({});
    expect(a.id).not.toBe(b.id);
  });
});

describe('makeTactics', () => {
  // spec: model/player.ts:212-214 + Tactics JSDoc (player.ts:131-138) —
  // defaults pace 50, threeBias 50, helpAggr 50 with partial override merge.
  it('defaults to the all-average tactics profile', () => {
    expect(makeTactics()).toEqual({ pace: 50, threeBias: 50, helpAggr: 50 });
    expect(makeTactics({})).toEqual({ pace: 50, threeBias: 50, helpAggr: 50 });
  });

  it('merges a partial override over the defaults', () => {
    const t = makeTactics({ threeBias: 80 });
    expect(t.threeBias).toBe(80);
    expect(t.pace).toBe(50);
    expect(t.helpAggr).toBe(50);
  });

  it('returns a fresh object per call (two teams never share tactics state)', () => {
    expect(makeTactics()).not.toBe(makeTactics());
  });
});
