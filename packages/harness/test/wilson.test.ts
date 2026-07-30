/**
 * wilsonInterval numeric pins (audit M-28 / mutation M15): the matchup
 * API's win-probability CI had no value-level test — drifting the default
 * z from 1.96 to 1.0 (a ~40% narrower interval, silently overconfident
 * predictions) passed the suite. The endpoints below are the z = 1.96
 * closed form evaluated independently (offline, full float precision) and
 * pinned to 1e-9, so ANY drift in z, the center, or the half-width
 * arithmetic fails loudly.
 *
 * Closed form pinned (matchup.ts doc):
 *   center = (p̂ + z²/2n) / (1 + z²/n)
 *   half   = z·√(p̂(1−p̂)/n + z²/4n²) / (1 + z²/n)
 */

import { describe, expect, it } from 'vitest';
import { simsToResolveEdge, wilsonInterval } from '../src/matchup.js';

// the shim has no toBeCloseTo — assert |actual − expected| directly
const closeTo = (actual: number, expected: number, eps: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps);
};

describe('wilsonInterval matches the z=1.96 closed form to 1e-9 (M-28)', () => {
  it('57/100 — a typical matchup point estimate', () => {
    // closed form at p̂=0.57, n=100, z=1.96 (computed independently):
    const [lo, hi] = wilsonInterval(57, 100);
    closeTo(lo, 0.47215211695864351, 1e-9);
    closeTo(hi, 0.66266860999471622, 1e-9);
    // z=1.0 drift would give [0.520040..., 0.618573...] — ~5pp off both ends
  });

  it('50/100 — the symmetric coin-flip case', () => {
    const [lo, hi] = wilsonInterval(50, 100);
    closeTo(lo, 0.40382982859014716, 1e-9);
    closeTo(hi, 0.59617017140985284, 1e-9);
    // symmetry about 0.5 is exact in the closed form
    closeTo(lo + hi, 1, 1e-12);
  });

  it('0/20 — the boundary case Wilson exists for (Wald would collapse to [0,0])', () => {
    const [lo, hi] = wilsonInterval(0, 20);
    expect(lo).toBe(0);
    closeTo(hi, 0.16113012549493319, 1e-9);
  });

  it('an explicit z = 1.96 equals the default (the default IS 1.96, not an approximation of it)', () => {
    const dflt = wilsonInterval(57, 100);
    const explicit = wilsonInterval(57, 100, 1.96);
    expect(dflt).toEqual(explicit);
  });

  it('bounds stay inside [0,1] and bracket p̂ (structural sanity at extremes)', () => {
    for (const [s, n] of [[1, 3], [2, 3], [999, 1000], [1, 1000]] as const) {
      const [lo, hi] = wilsonInterval(s, n);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeLessThan(s / n);
      expect(hi).toBeGreaterThan(s / n);
    }
  });

  it('rejects impossible inputs loudly', () => {
    expect(() => wilsonInterval(1, 0)).toThrow('n must be positive');
    expect(() => wilsonInterval(-1, 10)).toThrow('outside');
    expect(() => wilsonInterval(11, 10)).toThrow('outside');
  });
});

describe('simsToResolveEdge anchors (the doc-quoted rules of thumb)', () => {
  it('55% vs 50% needs ~783 sims at 95%/80% — the header example', () => {
    // the module doc and CLI guidance both quote 783; a z-quantile drift in
    // the defaults moves this number and must fail here
    expect(simsToResolveEdge(0.55)).toBe(783);
    expect(simsToResolveEdge(0.6)).toBe(194);
  });
});
