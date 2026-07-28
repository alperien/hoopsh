/**
 * Concept 7 (score pressure): shape characterization + off-switch pins,
 * for both channels. Channel 2 (the defensive-intensity gap/slack lean) is
 * LIVE; scorePressureDefGain ships at the fitted 0.3 (the channel-2 θ
 * ladder, findings/b2-fit-defgain*.md + b2-trial-setC.md; provenance on the
 * param in sim/params.ts). Channel 1 (the continuation tilt) stays at 0,
 * measured null on θ across tilt 0.05-0.20 (findings/b2-fit-tilt*.md), kept
 * as a wired-but-inert channel.
 *
 * The suite pins two independent things:
 *
 *  1. The shape, via direct scorePressure()/scorePressureDefMult() calls on
 *     constructed states at withParams-forced magnitudes (the survey's own
 *     A/B pattern): exact identity at a tie, antisymmetry around 1 when the
 *     score swaps, saturation at the margin ref, monotonicity below it, and
 *     the urgency guard. Channel 1 fades to exactly 1 inside the window: a
 *     leader's raised yardstick must never re-inflate a collapsing
 *     continuation, which would manufacture shot-clock violations. Channel
 *     2 does not fade, by design. Threshold-free by construction: the
 *     forced params are powers of two (magnitude 0.25, pressures 0.5/1,
 *     fade 0 or 1), so every expected multiplier is exact in float
 *     arithmetic and no rng reshuffle or re-tune of the shipped defaults
 *     can move these assertions.
 *
 *  2. The off-switch semantics at full-game scale, in the self-consistency
 *     form that survives re-tunes of the live default: an explicit
 *     gain-0/tilt-0 override and an explicit scale-0 override are the same
 *     bit-identical engine (the master multiplies every concept-7 term),
 *     and, because the default gain is now LIVE, an explicit gain-0 game
 *     must differ from a default game (the connectivity tripwire, inverted
 *     from the retired staged-0 pin). Tilt-0 ≡ default still holds and is
 *     pinned: tilt genuinely ships 0.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, withParams, type SimParams } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { scorePressure, scorePressureDefMult, scorePressureOf } from '../src/sim/ai/concepts.js';
import type { GameState } from '../src/sim/state.js';

// The concept-7 helpers read exactly: params.ai.scorePressure*,
// params.decide.urgencySec, score, poss.shotClock, clock. A hand-built
// partial state is enough for direct-call characterization; no full game.
function state(score: [number, number], shotClock: number, clock: number, params: SimParams): GameState {
  return { params, score, poss: { shotClock }, clock } as unknown as GameState;
}

// Forced-live params for the shape tests. Every concept-7 input is pinned
// explicitly (tilt and scale/ref/urgencySec) so the suite keeps meaning the
// same thing after the calibration commit re-tunes the shipped defaults.
const live = withParams({
  decide: { urgencySec: 5 },
  ai: { scorePressureScale: 1, scorePressureTilt: 0.25, scorePressureMarginRef: 20 }
});

// far from any clock urgency: shot clock 20 of 24, 10:00 in the period;
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
    // trailing 0.875, leading 1.125, both exact powers-of-two arithmetic
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
    // period horn inside the window, shot clock ample; min(sc, clock) governs
    expect(scorePressure(state([30, 50], SC, 3, live), 0, c)).toBe(c);
    expect(scorePressure(state([50, 30], SC, 3, live), 0, c)).toBe(c);
    // and the boundary itself (eff === urgencySec) is already fully faded
    expect(scorePressure(state([30, 50], 5, CLOCK, live), 0, c)).toBe(c);
  });
});

describe('concept 7 channel 1: tilt ships 0 (measured null) and the off-switch is exact', () => {
  it('tilt 0 IS the default engine, and scale 0 kills a forced tilt bit-exactly', () => {
    const { home, away } = sampleMatchup();
    const cfg = { seed: 'coupling-0', home, away, collectFrames: false };
    // tilt-0 leg: tilt genuinely ships 0 (measured null on θ across
    // 0.05-0.20, findings/b2-fit-tilt*.md; see the param's comment), so an
    // explicit tilt-0 override is value-identical to defaults. Unlike the
    // retired channel-2 staged pin, this one survives the coupling flip
    // because the shipped value really is 0.
    const tiltZero = simulateGame({ ...cfg, params: { ai: { scorePressureTilt: 0 } } });
    const dflt = simulateGame(cfg);
    expect(JSON.stringify(dflt.events)).toEqual(JSON.stringify(tiltZero.events));
    expect(dflt.finalScore).toEqual(tiltZero.finalScore);
    // scale 0 must neutralize even a live tilt bit-exactly (0 × x = ±0;
    // 1 − ±0 = 1). The master also budgets the LIVE channel-2 gain (0.3
    // default), so the scale-0 arm is the whole-concept-off engine; its
    // comparison partner pins both channel magnitudes off explicitly.
    const scaleZero = simulateGame({
      ...cfg,
      params: { ai: { scorePressureScale: 0, scorePressureTilt: 0.25 } }
    });
    const bothOff = simulateGame({
      ...cfg,
      params: { ai: { scorePressureTilt: 0, scorePressureDefGain: 0 } }
    });
    expect(JSON.stringify(scaleZero.events)).toEqual(JSON.stringify(bothOff.events));
    expect(scaleZero.finalScore).toEqual(bothOff.finalScore);
  });
});

// ---------------- channel 2 (defensive intensity): LIVE at the fitted 0.3

// Forced channel-2 params, same exact-arithmetic discipline as `live`: the
// shape tests pin gain 0.25 (not the shipped 0.3) because 0.25 against ref
// 20 keeps every expected multiplier exact in float (pressures ±0.5/±1 ⇒
// leans ±0.125/±0.25), so the assertions characterize the mechanism's shape
// and survive any re-tune of the shipped magnitude. urgencySec pinned only
// to prove it is not consumed.
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
    // tie; the same proof shape the STAGED gain-0 default rides on
    const gapExpr = 6.660254037844387; // deliberately non-round
    expect(gapExpr * scorePressureDefMult(state([50, 50], SC, CLOCK, live2), 0)).toBe(gapExpr);
  });

  it('SIGN: the trailing team\'s defense tightens (mult < 1), the leading team\'s sags (mult > 1)', () => {
    // margin 10 of ref 20 ⇒ pressure ±0.5; gain 0.25 ⇒ lean 0.125 exactly.
    // defSide is the defender's own side: side 0 trails 40-50, so its own
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
    // yardstick would manufacture shot-clock violations, an offense-only
    // failure mode). Defense intensity manufactures no violations and real
    // late-game defense stays pressed, so the same clock states that force
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

describe('concept 7 channel 2: the LIVE default is consumed, and the off-switch is exact', () => {
  it('explicit defGain 0 ≡ explicit scale 0 (self-consistency); the live 0.3 default moves the stream', () => {
    const { home, away } = sampleMatchup();
    const cfg = { seed: 'coupling-c2', home, away, collectFrames: false };
    // the self-consistency pin (replaces the retired staged-0-vs-defaults
    // leg, invalid since the default flipped to 0.3): an explicit gain-0
    // override and an explicit scale-0 override are the same bit-identical
    // engine. Scale 0 kills the live default gain (0 × x = ±0; 1 − ±0 =
    // 1) exactly as gain 0 does, and tilt is 0 either way. This pin
    // survives any future re-tune of the shipped gain because neither arm
    // reads it… except through scale-0's multiplication, which is
    // magnitude-independent.
    const gainZero = simulateGame({ ...cfg, params: { ai: { scorePressureDefGain: 0 } } });
    const scaleZero = simulateGame({ ...cfg, params: { ai: { scorePressureScale: 0 } } });
    expect(JSON.stringify(scaleZero.events)).toEqual(JSON.stringify(gainZero.events));
    expect(scaleZero.finalScore).toEqual(gainZero.finalScore);
    // the connectivity tripwire, inverted from the retired staged pin: the
    // shipped default (gain 0.3, LIVE) must differ from the explicit-zero
    // engine, proof the flipped default is actually consumed by
    // containOnBall (deterministic per seed; a plumbing check, not a
    // statistical claim)
    const dflt = simulateGame(cfg);
    expect(JSON.stringify(dflt.events)).not.toEqual(JSON.stringify(gainZero.events));
  });
});
