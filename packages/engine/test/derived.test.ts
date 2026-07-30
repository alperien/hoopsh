/**
 * Spec-derived unit tests for model/derived.ts — the rating curves that give
 * a 0-100 rating physical meaning. Every anchor asserted below is stated in
 * the curve's own JSDoc (range endpoints and worked examples are documented
 * design facts, explicitly listed as pinnable in findings/spec-engine.md —
 * they are NOT swept calibration output). Float-fragile anchors (20.3, 8.93)
 * are bracketed with >=/<= pairs since the vitest shim has no toBeCloseTo.
 */
import { describe, expect, it } from 'vitest';
import {
  acceleration, lateralSpeed, makePlayer, reachFt, sprintSpeed,
  type Attributes, type Player
} from '@hoopsh/engine';
import { n } from '../src/model/derived.js';

/** league-average attributes with one dial pushed — explicit id per the
 *  makePlayer anonCounter trap (findings/fixtures.md recipe 2) */
function attrWith(over: Partial<Attributes>): Attributes {
  return makePlayer({ id: 'derived-fixture', attr: over }).attr;
}

describe('sprintSpeed (ft/s)', () => {
  // spec: model/derived.ts:15-26 JSDoc — linear, 18 ft/s (rating 0, a
  // plodding ground-bound center) .. 28 ft/s (rating 100, just under the
  // physical straight-line max); worked example speed 90 -> 27 ft/s.
  it('pins the documented endpoints and midpoint', () => {
    expect(sprintSpeed(attrWith({ speed: 0 }))).toBe(18);
    expect(sprintSpeed(attrWith({ speed: 100 }))).toBe(28);
    expect(sprintSpeed(attrWith({ speed: 50 }))).toBe(23); // the average rotation player
  });

  it('reproduces the worked example: speed 90 -> 27 ft/s', () => {
    expect(sprintSpeed(attrWith({ speed: 90 }))).toBe(27);
  });

  it('is monotonic in the rating (faster rating -> faster player)', () => {
    expect(sprintSpeed(attrWith({ speed: 80 }))).toBeGreaterThan(sprintSpeed(attrWith({ speed: 40 })));
  });
});

describe('acceleration (ft/s^2)', () => {
  // spec: model/derived.ts:28-38 JSDoc — the "first step" dial, linear 16
  // (rating 0) .. 30 (rating 100); worked example accel 50 -> 23 ft/s^2.
  it('pins the documented endpoints and the worked example', () => {
    expect(acceleration(attrWith({ accel: 0 }))).toBe(16);
    expect(acceleration(attrWith({ accel: 100 }))).toBe(30);
    expect(acceleration(attrWith({ accel: 50 }))).toBe(23);
  });
});

describe('lateralSpeed (ft/s)', () => {
  // spec: model/derived.ts:40-52 JSDoc — linear 14 .. 23 ft/s, DELIBERATELY
  // below sprintSpeed's ceiling: a defensive slide keeps hips square instead
  // of turning and running, which is why a drive can beat a defender who
  // would win a footrace. Worked example: lateral 70 -> 20.3 ft/s.
  it('pins the documented endpoints', () => {
    expect(lateralSpeed(attrWith({ lateral: 0 }))).toBe(14);
    expect(lateralSpeed(attrWith({ lateral: 100 }))).toBe(23);
  });

  it('its ceiling sits below the sprint ceiling (slides lose footraces)', () => {
    const maxed = attrWith({ lateral: 100, speed: 100 });
    expect(lateralSpeed(maxed)).toBeLessThan(sprintSpeed(maxed));
  });

  it('reproduces the worked example: lateral 70 -> ~20.3 ft/s', () => {
    const v = lateralSpeed(attrWith({ lateral: 70 }));
    expect(v).toBeGreaterThan(20.29);
    expect(v).toBeLessThan(20.31);
  });
});

describe('reachFt (standing reach, ft)', () => {
  // spec: model/derived.ts:54-75 JSDoc — reach = (heightIn * 1.31 +
  // (wingspanIn - heightIn) * 0.6) / 12: the 1.31 anthropometric rule of
  // thumb plus 0.6 of the "ape index" (extra span is horizontal, so it
  // converts only partially to overhead height). Fallback wingspan is
  // heightIn + 2 in when unrecorded.
  const player = (heightIn: number, wingspanIn?: number): Player =>
    makePlayer({ id: `reach-${heightIn}-${wingspanIn ?? 'none'}`, heightIn, wingspanIn });

  it("reproduces the worked example: 6'8\" (80 in) with an 84 in wingspan -> ~8.93 ft", () => {
    const r = reachFt(player(80, 84));
    expect(r).toBeGreaterThanOrEqual(8.93);
    expect(r).toBeLessThanOrEqual(8.94);
  });

  it('missing wingspan falls back to exactly heightIn + 2 in', () => {
    expect(reachFt(player(80))).toBe(reachFt(player(80, 82)));
  });

  it('grows with height and with extra wingspan (the ape-index bonus)', () => {
    expect(reachFt(player(84, 86))).toBeGreaterThan(reachFt(player(78, 80)));
    // same height, +8 in of span: longer arms contest higher
    expect(reachFt(player(80, 88))).toBeGreaterThan(reachFt(player(80, 80)));
  });
});

describe('n — the universal rating-to-model bridge', () => {
  // spec: model/derived.ts:77-94 JSDoc — 50 -> 0, 0 -> -1, 100 -> +1,
  // linear and symmetric around 50. n(50) = 0 is the calibration
  // cornerstone: a league-average player contributes NOTHING to any logit
  // term, which is what makes SimParams tunable independently of rosters.
  it('pins the documented anchors', () => {
    expect(n(50)).toBe(0);
    expect(n(0)).toBe(-1);
    expect(n(100)).toBe(1);
    expect(n(75)).toBe(0.5);
    expect(n(25)).toBe(-0.5);
  });

  it('is symmetric around the league-average 50', () => {
    expect(n(30)).toBe(-n(70));
    expect(n(10)).toBe(-n(90));
  });

  it('is monotonic: better rating, bigger term', () => {
    expect(n(60)).toBeGreaterThan(n(50));
    expect(n(50)).toBeGreaterThan(n(40));
  });

  it('a default makePlayer rating feeds the models exactly zero', () => {
    // ties player defaults to the bridge: the documented reason DEFAULT_ATTR
    // is all-50s (model/player.ts:152-157)
    const p = makePlayer({ id: 'bridge-neutral' });
    expect(n(p.attr.three)).toBe(0);
  });
});
