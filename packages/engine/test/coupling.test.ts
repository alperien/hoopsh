/**
 * Concept 7 (SCORE PRESSURE) — shape characterization + the staged-zero
 * no-op pin.
 *
 * The coupling ships STAGED at scorePressureTilt 0 (the calibration commit
 * flips it after the θ fit — see the param's comment in sim/params.ts), so
 * this suite pins two independent things:
 *
 *  1. The SHAPE, via direct scorePressure() calls on constructed states at
 *     a withParams-forced nonzero tilt (the survey's own A/B pattern):
 *     exact identity at a tie, antisymmetry around 1 when the score swaps,
 *     saturation at the margin ref, monotonicity below it, and the urgency
 *     guard (multiplier exactly 1 for BOTH signs inside the window — a
 *     leader's raised yardstick must never re-inflate a collapsing
 *     continuation, which would manufacture shot-clock violations).
 *     Threshold-free by construction: the forced params are powers of two
 *     (tilt 0.25, pressures 0.5/1, fade 0 or 1), so every expected
 *     multiplier is EXACT in float arithmetic and no rng reshuffle or
 *     re-tune of the shipped defaults can move these assertions.
 *
 *  2. The OFF-SWITCH SEMANTICS at full-game scale: tilt 0 and scale 0 are
 *     the same bit-identical engine, and (while staged) so is a default
 *     game. Identity with MAIN is the golden fingerprint suite's job —
 *     `npm run fingerprint` — since a test in this tree can only compare
 *     this build against itself.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, withParams, type SimParams } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { scorePressure } from '../src/sim/ai/concepts.js';
import type { GameState } from '../src/sim/state.js';

// scorePressure reads exactly: params.ai.scorePressure*,
// params.decide.urgencySec, score, poss.shotClock, clock. A hand-built
// partial state is enough for direct-call characterization — no full game.
function state(score: [number, number], shotClock: number, clock: number, params: SimParams): GameState {
  return { params, score, poss: { shotClock }, clock } as unknown as GameState;
}

// Forced-live params for the shape tests. Every concept-7 input is pinned
// explicitly (tilt AND scale/ref/urgencySec) so the suite keeps meaning the
// same thing after the calibration commit re-tunes the shipped defaults.
const live = withParams({
  decide: { urgencySec: 5 },
  ai: { scorePressureScale: 1, scorePressureTilt: 0.25, scorePressureMarginRef: 20 }
});

// far from any clock urgency: shot clock 20 of 24, 10:00 in the period —
// eff = 20, fade = clamp((20 - 5) / 5, 0, 1) = 1 exactly
const SC = 20;
const CLOCK = 600;

describe('concept 7 (score pressure): shape characterization', () => {
  it('a tie is EXACTLY multiplier 1 — the continuation passes through bit-equal', () => {
    const c = 1.2345678901234567; // deliberately non-round: ×1 must be identity
    expect(scorePressure(state([50, 50], SC, CLOCK, live), 0, c)).toBe(c);
    expect(scorePressure(state([50, 50], SC, CLOCK, live), 1, c)).toBe(c);
  });

  it('antisymmetry: swapping the score mirrors the multiplier around 1', () => {
    // margin 10 of ref 20 → pressure ±0.5 exactly; tilt 0.25 → lean 0.125:
    // trailing 0.875, leading 1.125 — both exact powers-of-two arithmetic
    expect(scorePressure(state([40, 50], SC, CLOCK, live), 0, 1)).toBe(0.875);
    expect(scorePressure(state([50, 40], SC, CLOCK, live), 0, 1)).toBe(1.125);
    // ...and the same game read from the other side's chair
    expect(scorePressure(state([40, 50], SC, CLOCK, live), 1, 1)).toBe(1.125);
    expect(scorePressure(state([50, 40], SC, CLOCK, live), 1, 1)).toBe(0.875);
  });

  it('saturates at scorePressureMarginRef: deeper margins add nothing', () => {
    const at20 = scorePressure(state([30, 50], SC, CLOCK, live), 0, 1);
    expect(at20).toBe(0.75); // pressure clamps at 1: mult = 1 − 0.25
    expect(scorePressure(state([20, 50], SC, CLOCK, live), 0, 1)).toBe(at20);
    expect(scorePressure(state([0, 60], SC, CLOCK, live), 0, 1)).toBe(at20);
  });

  it('monotone in the margin below the cap (press side: the yardstick falls)', () => {
    const m4 = scorePressure(state([46, 50], SC, CLOCK, live), 0, 1);
    const m8 = scorePressure(state([42, 50], SC, CLOCK, live), 0, 1);
    const m16 = scorePressure(state([34, 50], SC, CLOCK, live), 0, 1);
    expect(m4).toBeLessThan(1);
    expect(m8).toBeLessThan(m4);
    expect(m16).toBeLessThan(m8);
  });

  it('urgency guard: inside the window the multiplier is exactly 1 for BOTH signs', () => {
    const c = 0.987654321;
    // shot clock inside urgencySec (5), game clock ample
    expect(scorePressure(state([30, 50], 4, CLOCK, live), 0, c)).toBe(c); // trailing
    expect(scorePressure(state([50, 30], 4, CLOCK, live), 0, c)).toBe(c); // leading
    // period horn inside the window, shot clock ample — min(sc, clock) governs
    expect(scorePressure(state([30, 50], SC, 3, live), 0, c)).toBe(c);
    expect(scorePressure(state([50, 30], SC, 3, live), 0, c)).toBe(c);
    // and the boundary itself (eff === urgencySec) is already fully faded
    expect(scorePressure(state([30, 50], 5, CLOCK, live), 0, c)).toBe(c);
  });
});

describe('concept 7: the STAGED zero default is a provable no-op', () => {
  it('tilt 0 kills a forced tilt via scale 0, and (staged) a default game matches both', () => {
    const { home, away } = sampleMatchup();
    const cfg = { seed: 'coupling-0', home, away, collectFrames: false };
    const tiltZero = simulateGame({ ...cfg, params: { ai: { scorePressureTilt: 0 } } });
    // scale 0 must neutralize even a live tilt bit-exactly (0 × x = ±0;
    // 1 − ±0 = 1) — the off-switch pin that survives the calibration flip
    const scaleZero = simulateGame({
      ...cfg,
      params: { ai: { scorePressureScale: 0, scorePressureTilt: 0.25 } }
    });
    expect(JSON.stringify(scaleZero.events)).toEqual(JSON.stringify(tiltZero.events));
    expect(scaleZero.finalScore).toEqual(tiltZero.finalScore);
    // STAGED leg — defaults ship at tilt 0, so an untouched game is the same
    // engine. The calibration commit that flips the default RETIRES the two
    // assertions below (the scale-0 ≡ tilt-0 legs above are the permanent pin).
    const dflt = simulateGame(cfg);
    expect(JSON.stringify(dflt.events)).toEqual(JSON.stringify(tiltZero.events));
    expect(dflt.finalScore).toEqual(tiltZero.finalScore);
  });
});
