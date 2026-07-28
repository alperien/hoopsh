/**
 * Concept 7 (SCORE PRESSURE) — shape characterization + the staged-zero
 * no-op pin, for BOTH channels: the continuation tilt (channel 1) and the
 * defensive-intensity gap/slack lean (channel 2, staged by the channel-1 θ
 * null — findings/b2-fit-tilt*.md, design-coupling.md §3/OQ1).
 *
 * The coupling ships STAGED at scorePressureTilt 0 and scorePressureDefGain
 * 0 (the calibration commits flip them after their θ fits — see the params'
 * comments in sim/params.ts), so this suite pins two independent things:
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
import { scorePressure, scorePressureDefMult, scorePressureOf } from '../src/sim/ai/concepts.js';
import type { GameState } from '../src/sim/state.js';

// The concept-7 helpers read exactly: params.ai.scorePressure*,
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

// ---------------- channel 2 (defensive intensity) — staged by the θ null

// Forced-live channel-2 params, same exact-arithmetic discipline as `live`:
// gain 0.25 against ref 20 keeps every expected multiplier exact in float
// (pressures ±0.5/±1 ⇒ leans ±0.125/±0.25). urgencySec pinned only to prove
// it is NOT consumed.
const live2 = withParams({
  decide: { urgencySec: 5 },
  ai: { scorePressureScale: 1, scorePressureDefGain: 0.25, scorePressureMarginRef: 20 }
});

describe('concept 7 channel 2 (defensive intensity): shape characterization', () => {
  it('scorePressureOf — the shared read: signed from the caller\'s own chair, clamped at the ref', () => {
    expect(scorePressureOf(state([50, 50], SC, CLOCK, live2), 0)).toBe(0); // tie
    expect(scorePressureOf(state([40, 50], SC, CLOCK, live2), 0)).toBe(0.5); // trailing by 10 of ref 20
    expect(scorePressureOf(state([40, 50], SC, CLOCK, live2), 1)).toBe(-0.5); // same game, leader's chair
    expect(scorePressureOf(state([10, 60], SC, CLOCK, live2), 0)).toBe(1); // deep deficits clamp…
    expect(scorePressureOf(state([60, 10], SC, CLOCK, live2), 0)).toBe(-1); // …both signs
  });

  it('a tie is EXACTLY multiplier 1 — gap and slack pass through bit-equal', () => {
    expect(scorePressureDefMult(state([50, 50], SC, CLOCK, live2), 0)).toBe(1);
    expect(scorePressureDefMult(state([50, 50], SC, CLOCK, live2), 1)).toBe(1);
    // ×1 is float identity, so the containment arithmetic cannot move at a
    // tie — the same proof shape the STAGED gain-0 default rides on
    const gapExpr = 6.660254037844387; // deliberately non-round
    expect(gapExpr * scorePressureDefMult(state([50, 50], SC, CLOCK, live2), 0)).toBe(gapExpr);
  });

  it('SIGN: the trailing team\'s defense tightens (mult < 1), the leading team\'s sags (mult > 1)', () => {
    // margin 10 of ref 20 ⇒ pressure ±0.5; gain 0.25 ⇒ lean 0.125 exactly.
    // defSide is the DEFENDER's own side: side 0 trails 40-50, so ITS
    // defense presses up…
    expect(scorePressureDefMult(state([40, 50], SC, CLOCK, live2), 0)).toBe(0.875);
    // …and the leading side's defense sags off in the very same game
    expect(scorePressureDefMult(state([40, 50], SC, CLOCK, live2), 1)).toBe(1.125);
    // mirrored scoreline mirrors the roles
    expect(scorePressureDefMult(state([50, 40], SC, CLOCK, live2), 0)).toBe(1.125);
    expect(scorePressureDefMult(state([50, 40], SC, CLOCK, live2), 1)).toBe(0.875);
  });

  it('saturates at scorePressureMarginRef like channel 1', () => {
    expect(scorePressureDefMult(state([30, 50], SC, CLOCK, live2), 0)).toBe(0.75);
    expect(scorePressureDefMult(state([0, 60], SC, CLOCK, live2), 0)).toBe(0.75);
    expect(scorePressureDefMult(state([0, 60], SC, CLOCK, live2), 1)).toBe(1.25);
  });

  it('NO urgency fade — the deliberate asymmetry vs channel 1 is pinned', () => {
    // channel 1 zeroes itself inside the urgency window (a leader's raised
    // yardstick would manufacture shot-clock violations — an offense-only
    // failure mode). Defense intensity manufactures no violations and real
    // late-game defense stays pressed, so the SAME clock states that force
    // channel 1's multiplier to exactly 1 leave channel 2 at full lean.
    expect(scorePressureDefMult(state([30, 50], 4, CLOCK, live2), 0)).toBe(0.75); // shot clock inside the window
    expect(scorePressureDefMult(state([30, 50], SC, 3, live2), 0)).toBe(0.75); // period horn inside the window
    expect(scorePressureDefMult(state([50, 30], 4, CLOCK, live2), 0)).toBe(1.25); // leader's sag persists too
  });

  it('the ONE master budgets channel 2 too: scale 0 kills it, scale 2 doubles it', () => {
    const scale0 = withParams({
      ai: { scorePressureScale: 0, scorePressureDefGain: 0.25, scorePressureMarginRef: 20 }
    });
    expect(scorePressureDefMult(state([30, 50], SC, CLOCK, scale0), 0)).toBe(1);
    const scale2 = withParams({
      ai: { scorePressureScale: 2, scorePressureDefGain: 0.25, scorePressureMarginRef: 20 }
    });
    // 1 − 2 × 0.25 × 0.5 = 0.75 exactly
    expect(scorePressureDefMult(state([40, 50], SC, CLOCK, scale2), 0)).toBe(0.75);
  });
});

describe('concept 7 channel 2: the STAGED zero default is a provable no-op', () => {
  it('defaults ≡ explicit defGain 0 ≡ scale-0-killed live gain; a live gain moves the stream', () => {
    const { home, away } = sampleMatchup();
    const cfg = { seed: 'coupling-c2', home, away, collectFrames: false };
    const dflt = simulateGame(cfg);
    // the staged-0 leg: shipping defaults ARE the explicit-zero engine. The
    // calibration commit that flips the default RETIRES this pair (the
    // scale-0 leg below is the permanent off-switch pin).
    const gainZero = simulateGame({ ...cfg, params: { ai: { scorePressureDefGain: 0 } } });
    expect(JSON.stringify(gainZero.events)).toEqual(JSON.stringify(dflt.events));
    expect(gainZero.finalScore).toEqual(dflt.finalScore);
    // the shared master at 0 neutralizes a live gain bit-exactly
    // (0 × x = ±0; 1 − ±0 = 1) — survives the calibration flip
    const scaleZero = simulateGame({
      ...cfg,
      params: { ai: { scorePressureScale: 0, scorePressureDefGain: 0.25 } }
    });
    expect(JSON.stringify(scaleZero.events)).toEqual(JSON.stringify(dflt.events));
    expect(scaleZero.finalScore).toEqual(dflt.finalScore);
    // and the channel is really plumbed into containOnBall: a forced live
    // gain changes the event stream (deterministic per seed — a
    // connectivity tripwire, not a statistical claim)
    const gainLive = simulateGame({ ...cfg, params: { ai: { scorePressureDefGain: 0.25 } } });
    expect(JSON.stringify(gainLive.events)).not.toEqual(JSON.stringify(dflt.events));
  });
});
