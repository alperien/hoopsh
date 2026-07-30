/**
 * CI math pins (matchup.ts) — closed-form values, no simulation.
 *
 * The Wilson interval and the power formula carry the API's honesty claims
 * ("can 100 sims see a 55/45 edge?"), and nothing else in the suite checked
 * their constants: mutation M15 set z = 1.0 and the suite stayed green while
 * every printed 95% CI silently became a ~68% CI (audit M-28). The pins
 * below are hand-derived from the formulas at the documented defaults
 * (z = 1.96; zAlpha = 1.959964, zPower = 0.841621), so any constant or
 * algebra drift fails here first.
 */

import { describe, expect, it } from 'vitest';
import { simsToResolveEdge, wilsonInterval } from '../src/matchup.js';

// hand-derived digit pin (the shim has no toBeCloseTo): |actual − expected|
// under half a unit in the last quoted digit
const pin = (actual: number, expected: number, tol = 5e-8): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
};

describe('wilsonInterval — the z = 1.96 default is pinned (M-28)', () => {
  it('55/100 gives the textbook 95% interval', () => {
    const [lo, hi] = wilsonInterval(55, 100);
    // closed form at z=1.96: center (0.55 + 0.019208)/1.038416, half-width
    // 1.96·sqrt(0.2475/100 + 0.038416/400)/1.038416. A z=1.0 mutant yields
    // [0.5000, 0.5990] — nowhere near these digits.
    pin(lo, 0.4524443);
    pin(hi, 0.6438562);
  });

  it('an explicit z parameter is honored (z=1 is the ~68% interval)', () => {
    const [lo, hi] = wilsonInterval(55, 100, 1);
    pin(lo, 0.5000000);
    pin(hi, 0.5990099);
  });

  it('stays inside [0, 1] where Wald leaves it (lopsided and zero-success cases)', () => {
    const [lo98, hi98] = wilsonInterval(98, 100);
    pin(lo98, 0.9299868);
    pin(hi98, 0.9944981);
    const [lo0, hi0] = wilsonInterval(0, 20);
    expect(lo0).toBe(0);
    pin(hi0, 0.1611301);
  });

  it('rejects impossible inputs loudly', () => {
    expect(() => wilsonInterval(1, 0)).toThrow(/must be positive/);
    expect(() => wilsonInterval(-1, 10)).toThrow(/outside/);
    expect(() => wilsonInterval(11, 10)).toThrow(/outside/);
  });
});

describe('simsToResolveEdge — the 95%/80% default quantiles are pinned (M-28)', () => {
  it('reproduces the header rules of thumb', () => {
    expect(simsToResolveEdge(0.55)).toBe(783);
    expect(simsToResolveEdge(0.60)).toBe(194);
    expect(simsToResolveEdge(0.70)).toBe(47);
    // the header used to quote 4,895 here; the formula gives 4,904 (L-38)
    expect(simsToResolveEdge(0.52)).toBe(4904);
  });

  it('rejects degenerate probabilities loudly', () => {
    expect(() => simsToResolveEdge(0)).toThrow(/inside \(0, 1\)/);
    expect(() => simsToResolveEdge(0.5, 0.5)).toThrow(/must differ/);
  });
});
