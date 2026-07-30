/**
 * Spec-derived unit tests for core/rng.ts — the ONLY randomness source in the
 * engine (AGENTS.md §1.2). Expectations come from the class JSDoc, not the
 * method bodies. Existing coverage that is deliberately NOT duplicated here:
 * Rng.weighted's empty-array and non-finite throws (adversarial.test.ts) and
 * end-to-end same-seed game identity (determinism.test.ts).
 *
 * Seeds are fixed fresh literals namespaced `rngspec-*` (unused by any other
 * suite per findings/fixtures.md §6), so every assertion below is
 * deterministic and repeatable.
 */
import { describe, expect, it } from 'vitest';
import { Rng, sigmoid, clamp } from '@hoopsh/engine';

/** draw `count` values off a fresh Rng — the unit-level determinism probe */
function floats(seed: string | number, count: number): number[] {
  const r = new Rng(seed);
  return Array.from({ length: count }, () => r.float());
}

describe('Rng seeding and stream determinism', () => {
  // spec: core/rng.ts:2-5 — "Same seed + same inputs = bit-identical".
  // This is the unit half of AGENTS.md §1.2; determinism.test.ts only pins
  // it end-to-end through simulateGame.
  it('same seed produces the identical draw sequence', () => {
    expect(floats('rngspec-stream-1', 1000)).toEqual(floats('rngspec-stream-1', 1000));
  });

  // spec: core/rng.ts:44-45 — the constructor seeds via cyrb128(String(seed)),
  // so numeric and string spellings of a seed are the SAME stream. A config
  // layer passing seed 42 and a replay tool passing '42' must replay the
  // same game.
  it('numeric and string seeds coincide: new Rng(42) === new Rng("42") stream', () => {
    expect(floats(42, 200)).toEqual(floats('42', 200));
  });

  it('different seeds produce different streams', () => {
    expect(floats('rngspec-diff-a', 1000)).not.toEqual(floats('rngspec-diff-b', 1000));
  });
});

describe('Rng.float', () => {
  // spec: core/rng.ts:51 — "uniform float in [0, 1)"
  it('every draw lies in [0, 1)', () => {
    const r = new Rng('rngspec-float-1');
    for (let i = 0; i < 2000; i++) {
      const v = r.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform: the mean of 10k draws sits near 0.5', () => {
    const r = new Rng('rngspec-float-2');
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += r.float();
    const mean = sum / 10000;
    // a generous 0.45..0.55 bracket — catches a broken generator (stuck
    // state, wrong divisor), not sampling noise
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});

describe('Rng.range and Rng.int documented bounds', () => {
  // spec: core/rng.ts:64 — "uniform float in [min, max)"
  it('range(3, 7) stays in [3, 7)', () => {
    const r = new Rng('rngspec-range-1');
    for (let i = 0; i < 500; i++) {
      const v = r.range(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
    }
  });

  // spec: core/rng.ts:69 — "uniform int in [0, n)"
  it('int(5) is always an integer in [0, 5) and reaches every value', () => {
    const r = new Rng('rngspec-int-1');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = r.int(5);
      expect(Math.floor(v)).toBe(v);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    // "uniform" minimally means full support: all of 0..4 occur in 500 draws
    expect(seen.size).toBe(5);
  });
});

describe('Rng.chance extremes', () => {
  // spec: core/rng.ts:74 ("true with probability p") + :51 (float < 1
  // strictly). p=0 can never fire and p=1 always fires — an impossible
  // event (e.g. a zeroed foul rate) must be IMPOSSIBLE, not merely rare.
  it('chance(0) is never true and chance(1) is always true', () => {
    const r = new Rng('rngspec-chance-1');
    for (let i = 0; i < 200; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
  });
});

describe('Rng.pick', () => {
  // spec: core/rng.ts:79-81 — empty input throws loudly (same fail-loud
  // policy as weighted; weighted's throws are already pinned in
  // adversarial.test.ts, pick's is not)
  it('throws on an empty array', () => {
    const r = new Rng('rngspec-pick-1');
    expect(() => r.pick([])).toThrow('Rng.pick: empty array');
  });

  it('returns the sole element of a 1-element array and only members otherwise', () => {
    const r = new Rng('rngspec-pick-2');
    expect(r.pick(['only'])).toBe('only');
    const pool = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      expect(pool).toContain(r.pick(pool));
    }
  });
});

describe('Rng.weighted degradation paths', () => {
  // spec: core/rng.ts:84 — "index sampled proportionally to non-negative
  // weights (all-zero -> uniform)"; negative weights clamp to 0
  // (core/rng.ts:99,104), so a negative-utility entry must NEVER win.
  // NOTE: this final-index case exercises the TOTAL-side clamp (:99) only —
  // the fallthrough `return weights.length - 1` coincides with the right
  // answer here, so the per-element clamp (:104) needs the mid-array case
  // below to be falsifiable.
  it('a negative weight counts as zero: [-5, 1] always returns index 1', () => {
    const r = new Rng('rngspec-weighted-1');
    for (let i = 0; i < 200; i++) {
      expect(r.weighted([-5, 1])).toBe(1);
    }
  });

  // The PER-ELEMENT clamp (core/rng.ts:104): a negative weight in the MIDDLE
  // of the table must contribute zero mass without misrouting the mass of the
  // entries after it. Subtracting the raw -5 instead of max(0, -5) inflates
  // `roll` past every remaining entry, so index 2 can NEVER win and its third
  // of the mass is silently dumped on the fallthrough index 3 (mutation-audit
  // survivor M6). In utility terms: one negative-utility option would erase a
  // sibling option from the sim entirely.
  it('a mid-array negative routes no mass and steals none: [1, -5, 1, 1]', () => {
    const r = new Rng('rngspec-weighted-3');
    const counts = new Map<number, number>();
    for (let i = 0; i < 900; i++) {
      const idx = r.weighted([1, -5, 1, 1]);
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }
    const at = (i: number): number => counts.get(i) ?? 0;
    expect(at(1)).toBe(0); // clamped: the negative entry never wins
    // the three unit weights split the 900 draws ~evenly (~300 each); every
    // positive entry must actually receive its share of the mass
    for (const idx of [0, 2, 3]) {
      expect(at(idx)).toBeGreaterThan(240);
      expect(at(idx)).toBeLessThan(360);
    }
  });

  it('all-zero weights degrade to a uniform draw over every index', () => {
    const r = new Rng('rngspec-weighted-2');
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const idx = r.weighted([0, 0, 0]);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
      seen.add(idx);
    }
    expect(seen.size).toBe(3);
  });
});

describe('Rng.gaussian (Box-Muller cached pair)', () => {
  // spec: core/rng.ts:110-115 — "standard normal via Box-Muller (cached
  // pair)" returning `mean + sd * g`: mean/sd are applied AT CALL TIME, to
  // the cached second value too. sd=0 therefore collapses any draw to
  // exactly `mean`.
  it('applies mean/sd at call time to the cached second value', () => {
    const r = new Rng('rngspec-gauss-1');
    r.gaussian(); // first call computes the pair and caches its partner
    expect(r.gaussian(10, 0)).toBe(10); // cached path: 10 + 0 * g exactly
  });

  it('applies mean/sd at call time on the fresh path too', () => {
    const r = new Rng('rngspec-gauss-3');
    expect(r.gaussian(7, 0)).toBe(7);
  });

  // The cached partner consumes ZERO underlying draws: an rng that took two
  // gaussians and one that took one have consumed the same float stream, so
  // their next draws re-align. Miscounting draws here would silently
  // reshuffle every rng call after the first gaussian in a game.
  it('the cached second gaussian consumes no underlying draws', () => {
    const a = new Rng('rngspec-gauss-2');
    const b = new Rng('rngspec-gauss-2');
    a.gaussian();
    a.gaussian(); // served from cache — must not advance the stream
    b.gaussian();
    expect(a.float()).toBe(b.float());
  });
});

describe('Rng.shuffle', () => {
  // spec: core/rng.ts:125 — "in-place Fisher-Yates": the SAME array
  // reference comes back, holding a permutation of the original elements
  // (nothing added, dropped, or duplicated).
  it('returns the same reference containing a permutation of the input', () => {
    const r = new Rng('rngspec-shuffle-1');
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = r.shuffle(arr);
    expect(out).toBe(arr); // in-place is the contract
    expect([...out].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('is deterministic per seed', () => {
    const a = new Rng('rngspec-shuffle-2').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Rng('rngspec-shuffle-2').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
  });
});

describe('sigmoid (the probability-model workhorse)', () => {
  // spec: core/rng.ts:137-140 — logistic sigmoid. Every make/foul/block
  // probability flows through it, so its midpoint and monotonicity ARE the
  // shape of the engine's probability models.
  it('is exactly 0.5 at 0', () => {
    expect(sigmoid(0)).toBe(0.5);
  });

  it('is strictly increasing', () => {
    expect(sigmoid(-2)).toBeLessThan(sigmoid(0));
    expect(sigmoid(0)).toBeLessThan(sigmoid(2));
    expect(sigmoid(1)).toBeLessThan(sigmoid(5));
  });

  it('stays strictly inside (0, 1) across the engine-relevant logit range', () => {
    // +/-30 rather than +/-50: past |x| ~ 37, 1 + exp(-x) rounds to exactly
    // 1.0 in IEEE doubles and the strict bound genuinely saturates. Logits
    // that large never arise from clamped ratings, so the open interval is
    // asserted where the model actually lives.
    expect(sigmoid(30)).toBeLessThan(1);
    expect(sigmoid(-30)).toBeGreaterThan(0);
  });
});

describe('clamp', () => {
  // spec: core/rng.ts:142-144 — lo when x<lo, hi when x>hi, x otherwise.
  // Per findings/spec-engine.md (rng.ts:clamp note) the NaN fall-through is
  // deliberately NOT asserted — only the three documented branches are.
  it('returns lo below the range, hi above it, and x inside it', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
    expect(clamp(7, 0, 10)).toBe(7);
  });

  it('treats the boundaries as inside (x<lo / x>hi are strict)', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});
