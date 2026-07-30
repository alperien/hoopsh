/**
 * Pure math + formatting helpers of harness/src/matchup.ts — NO Monte-Carlo:
 * simulateMatchup is never called here (it runs n games; its distribution
 * behavior is covered at integration scale by season.test.ts). This file
 * pins the pure functions to independently computed values.
 *
 * season.test.ts already asserts PROPERTIES of these helpers (symmetry,
 * monotonicity, throw-on-bad-input). This file adds exact VALUE pins where
 * the math is public: the Wilson score interval (Wilson 1927; the
 * center/half-width form is quoted in wilsonInterval's own JSDoc,
 * matchup.ts:59-63), the one-sample binomial power formula (simsToResolveEdge
 * JSDoc, matchup.ts:77-89), and the R type-7 quantile (percentileSorted
 * JSDoc). Every pinned decimal below was computed OUTSIDE the implementation
 * by evaluating the cited formula directly; floats are bracketed with
 * >=/<= rather than pinned bit-exact.
 *
 * Zero sims.
 */
import { describe, expect, it } from 'vitest';
import {
  formatMatchup, percentileSorted, simsToResolveEdge, wilsonInterval,
  type MatchupDistribution, type StatDist
} from '../src/matchup.js';

// bracket a float against an independently computed value
function near(actual: number, expected: number, eps = 1e-6): void {
  expect(actual).toBeGreaterThanOrEqual(expected - eps);
  expect(actual).toBeLessThanOrEqual(expected + eps);
}

describe('wilsonInterval — exact values from the public formula', () => {
  it('pins 15/30 and 8/10 at z=1.96 (Wilson score interval: center (p+z²/2n)/(1+z²/n), half-width z·sqrt(p(1−p)/n + z²/4n²)/(1+z²/n))', () => {
    // computed independently from the formula quoted in the JSDoc
    // (matchup.ts:59-63; E.B. Wilson 1927): p=0.5, n=30 =>
    // [0.331539, 0.668461]; p=0.8, n=10 => [0.490157, 0.943319]
    const [lo, hi] = wilsonInterval(15, 30);
    near(lo, 0.331539);
    near(hi, 0.668461);
    const [lo2, hi2] = wilsonInterval(8, 10);
    near(lo2, 0.490157);
    near(hi2, 0.943319);
  });

  it('honors the z parameter: a 90% interval (z=1.6449) is strictly narrower than the default 95% (z=1.96)', () => {
    // spec: JSDoc — "z defaults to 1.96 (two-sided 95%)"; z is the caller's
    // dial, never a hardcoded constant
    const [lo95, hi95] = wilsonInterval(15, 30);
    const [lo90, hi90] = wilsonInterval(15, 30, 1.6449);
    expect(hi90 - lo90).toBeLessThan(hi95 - lo95);
    expect(lo90).toBeGreaterThan(lo95);
    expect(hi90).toBeLessThan(hi95);
  });
});

describe('simsToResolveEdge — the header\'s rule-of-thumb table', () => {
  it('pins the documented 95%/80% table: 60% -> 194, 70% -> 47 (matchup.ts:26-28)', () => {
    // spec: file header — "60% vs 50% -> ~194 sims ... 70% vs 50% -> ~47";
    // verified independently: ceil((1.959964·sqrt(.25) +
    // 0.841621·sqrt(p1·q1))² / (p1−.5)²)
    expect(simsToResolveEdge(0.60)).toBe(194);
    expect(simsToResolveEdge(0.70)).toBe(47);
  });

  it('52% vs 50% needs 4904 sims by the formula (the header table\'s "~4,895" is approximate)', () => {
    // independent computation of the JSDoc formula:
    // num = 1.959964·0.5 + 0.841621·sqrt(0.52·0.48) = 1.400459…,
    // ceil(num²/0.0004) = 4904. The header's "~4,895" carries a tilde and is
    // ~0.2% off the formula's own answer — reported upstream as a doc nit;
    // the formula, not the prose table, is the contract.
    expect(simsToResolveEdge(0.52)).toBe(4904);
  });

  it('honors zPower: 90% power (zPower=1.281552, the JSDoc\'s worked example) costs 1047 sims for the 55% edge — more than 80% power\'s 783', () => {
    // spec: JSDoc — "callers wanting 90% power pass zPower = 1.281552 — the
    // z values are the caller's to choose; this function is just the algebra"
    const n90 = simsToResolveEdge(0.55, 0.5, 1.959964, 1.281552);
    expect(n90).toBe(1047); // ceil((1.959964·0.5 + 1.281552·sqrt(.55·.45))²/.0025), computed independently
    expect(n90).toBeGreaterThan(simsToResolveEdge(0.55));
  });

  it('rejects a p0 outside (0,1) — both probabilities are validated, not just p1 (matchup.ts:96-98)', () => {
    // season.test.ts covers bad p1; the p0 arm of the same guard is untested
    expect(() => simsToResolveEdge(0.6, 0)).toThrow(/inside \(0, 1\)/);
    expect(() => simsToResolveEdge(0.6, 1)).toThrow(/inside \(0, 1\)/);
  });
});

describe('percentileSorted — R type-7 quantile details', () => {
  it('interpolates linearly at h=(n−1)q: [10,20,30,40,50] at q=0.1 gives 14 (R type 7, per the JSDoc)', () => {
    // independent: h = 4·0.1 = 0.4 -> 10 + 0.4·(20−10) = 14
    near(percentileSorted([10, 20, 30, 40, 50], 0.1), 14, 1e-9);
    // and an interior three-quarter point: h = 3·0.75 = 2.25 -> 3.25
    near(percentileSorted([1, 2, 3, 4], 0.75), 3.25, 1e-9);
  });

  it('a single-element sample returns that element at any q', () => {
    expect(percentileSorted([7], 0)).toBe(7);
    expect(percentileSorted([7], 0.5)).toBe(7);
    expect(percentileSorted([7], 1)).toBe(7);
  });

  it('rejects q outside [0,1] (matchup.ts:107 — the guard that keeps lo/hi indices in bounds)', () => {
    // season.test.ts covers the empty-sample throw; the q guard is the other
    // documented precondition
    expect(() => percentileSorted([1, 2, 3], 1.5)).toThrow(/outside \[0,1\]/);
    expect(() => percentileSorted([1, 2, 3], -0.1)).toThrow(/outside \[0,1\]/);
  });
});

describe('formatMatchup — the human-readable report (matchup.ts:346-388, previously 0% covered)', () => {
  // hand-built distribution: pure input, no simulateMatchup involved
  const dist = (mean: number): StatDist => ({ mean, sd: 0, p10: mean, p50: mean, p90: mean });
  const d: MatchupDistribution = {
    homeId: 'breakers',
    awayId: 'monarchs',
    n: 10,
    seedBase: 'fmt-1',
    homeWins: 6,
    awayWins: 4,
    homeWinProb: 0.6,
    ci95: [0.31, 0.83],
    meanMargin: 3.2,
    medianMargin: -1,
    sdMargin: 8.4,
    marginPercentiles: { p5: -12, p25: -4, p50: -1, p75: 9, p95: 15 },
    histogram: [
      { lo: -5, hi: 0, count: 4 },
      { lo: 0, hi: 5, count: 6 }
    ],
    players: [
      { playerId: 'h1', name: 'Kaito Mercer', teamId: 'breakers', games: 10, min: dist(34), pts: dist(28.5), trb: dist(4.1), ast: dist(6.2) },
      { playerId: 'h2', name: 'Dre Holloway', teamId: 'breakers', games: 10, min: dist(30), pts: dist(18.0), trb: dist(5.0), ast: dist(2.0) },
      { playerId: 'a1', name: 'Elias Vance', teamId: 'monarchs', games: 10, min: dist(33), pts: dist(21.3), trb: dist(3.3), ast: dist(9.9) }
    ]
  };

  it('renders probability + Wilson CI as percentages with the W-L record (JSDoc: "probability + CI")', () => {
    const out = formatMatchup(d);
    expect(out).toContain('home win probability  60.0%');
    expect(out).toContain('95% CI [31.0%, 83.0%]');
    expect(out).toContain('(6W-4L)');
  });

  it('echoes the reproducibility handle (n + seed base) and signs margins from the home perspective', () => {
    const out = formatMatchup(d);
    expect(out).toContain('breakers (home) vs monarchs — 10 sims (seed base "fmt-1")');
    expect(out).toContain('mean +3.2');   // positive margin gets an explicit +
    expect(out).toContain('median -1.0'); // negative keeps its own sign, no +
  });

  it('draws histogram bars scaled to the modal bin (max count = 40 hashes) with lo..hi−1 labels', () => {
    // spec: formatMatchup body — bar = '#'.repeat(round(count/maxCount·40)),
    // label `${lo}..${hi-1}`; independent arithmetic: 4/6·40 rounds to 27
    const out = formatMatchup(d);
    expect(out).toContain(`${'#'.repeat(40)} 6`);
    expect(out).toContain(`${'#'.repeat(27)} 4`);
    expect(out).toContain('-5.. -1');
    expect(out).toContain('0..  4');
  });

  it('lists each side\'s stat lines, truncated to topPlayers (JSDoc: "each side\'s top stat lines")', () => {
    const top1 = formatMatchup(d, 1);
    expect(top1).toContain('Kaito Mercer');        // home slot 1 kept
    expect(top1).not.toContain('Dre Holloway');    // home slot 2 sliced off
    expect(top1).toContain('Elias Vance');         // away section renders independently
    expect(top1).toContain('breakers — top stat lines');
    expect(top1).toContain('monarchs — top stat lines');
    expect(top1).toContain('(34 min, 10/10 gms)'); // appearance count over n
    const all = formatMatchup(d);
    expect(all).toContain('Dre Holloway');         // default topPlayers=4 keeps both
  });
});
