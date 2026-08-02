/**
 * sim/shooting.ts — windup routing and the last-two-minutes clock rule.
 *
 * Spec sources: shooting.ts:20-32 (windupSec routes each shot type to its
 * own SimParams timing — the windup is the catch-and-shoot vs closeout race
 * window resolve.ts anticipatedContest projects across), shooting.ts:186-191
 * (after a made basket the clock keeps running EXCEPT in the last two
 * minutes of the final period — the real NBA rule), AGENTS.md §1.5 (frozen
 * game clock + advancing wall clock is the two-time-axes contract; frames
 * key on wallT).
 *
 * The windup pins force their own magnitudes through withParams
 * (coupling.test.ts pattern) so no FEEL timing is pinned. The clock rule is
 * observed at frame level on ONE seeded game — this file's whole sim budget
 * (frames are the subject, so they are collected).
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, withParams, type SimParams } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { windupSec } from '../src/sim/shooting.js';
import type { GameState } from '../src/sim/state.js';

describe('windupSec (shooting.ts:20-32)', () => {
  it('routes every shot type to its own params timing — no cross-wiring', () => {
    // forced, mutually distinct magnitudes: a swapped case in the switch
    // (e.g. drive returning the pull-up windup) goes red here
    const forced = withParams({
      shot: {
        windupCatchShoot: 0.11, windupPullUp: 0.22, windupDrive: 0.33,
        windupCutFinish: 0.44, windupPost: 0.55, windupPutback: 0.66,
        windupHeave: 0.77
      }
    });
    const s = { params: forced } as unknown as GameState;
    expect(windupSec(s, 'catch_shoot')).toBe(0.11);
    expect(windupSec(s, 'pull_up')).toBe(0.22);
    expect(windupSec(s, 'drive')).toBe(0.33);
    expect(windupSec(s, 'cut_finish')).toBe(0.44);
    expect(windupSec(s, 'post')).toBe(0.55);
    expect(windupSec(s, 'putback')).toBe(0.66);
    expect(windupSec(s, 'heave')).toBe(0.77);
  });

  it('every shipped windup is a real positive race window', () => {
    // shooting.ts:20 — "windup time before the ball leaves the shooter's
    // hands"; a zero windup would erase the closeout race anticipatedContest
    // exists to model (resolve.ts:87-100). Structure only, no magnitude.
    const s = { params: withParams() } as unknown as GameState;
    const kinds = ['catch_shoot', 'pull_up', 'drive', 'cut_finish', 'post', 'putback', 'heave'] as const;
    for (const k of kinds) expect(windupSec(s, k)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- clock rule

// one seeded game WITH frames — the file's entire sim budget.
// Frame row layout (replay.ts:6-35): [0] wallT, [1] period, [2] game clock.
// Seed re-anchored at the #115 acquisition-stamp landing (streams
// reshuffled; d2shoot-1's new draw had no clean final-period last-2:00
// make, starving the existence floor): d2shoot-2, first qualifying —
// both the late clock-stop and early clock-runs premises sampled.
// Assertions unchanged.
const { home, away } = sampleMatchup();
const result = simulateGame({ seed: 'd2shoot-2', home, away });
const ev = result.events;

/** frames whose wall time falls strictly inside the made-shot dead ball
 *  (resumeIn 2.2s, shooting.ts:190) — trimmed clear of both edges */
function deadBallFrames(wt: number): number[][] {
  return result.frames.filter((f) => f[0]! > wt + 0.3 && f[0]! < wt + 1.9);
}

/** made, un-fouled shots with no timeout near the dead ball (a timeout
 *  legitimately stops the clock and would blur the contrast case) */
function cleanMakes(filter: (e: { period: number; clock: number }) => boolean) {
  return ev.filter((e) =>
    e.type === 'shot' && e.made && e.foul === undefined && filter(e) &&
    !ev.some((t) => t.type === 'timeout' && t.wt >= e.wt - 0.5 && t.wt <= e.wt + 3));
}

describe('made-basket clock behavior (shooting.ts:186-191, AGENTS.md §1.5)', () => {
  it('inside the last two minutes of the final period the game clock STOPS across the dead ball', () => {
    const late = cleanMakes((e) => e.period >= result.rules.periods && e.clock <= 120 && e.clock >= 8);
    expect(late.length).toBeGreaterThanOrEqual(1); // existence floor
    for (const shot of late) {
      const win = deadBallFrames(shot.wt);
      expect(win.length).toBeGreaterThanOrEqual(3); // the window really is sampled
      for (const f of win) expect(f[2]).toBe(win[0]![2]); // game clock frozen
      for (let i = 1; i < win.length; i++) {
        expect(win[i]![0]).toBeGreaterThan(win[i - 1]![0]!); // wall clock never stops
      }
    }
  });

  it('after an earlier make the clock keeps RUNNING through the same dead ball', () => {
    const early = cleanMakes((e) => e.period === 1 && e.clock >= 200);
    expect(early.length).toBeGreaterThanOrEqual(1);
    for (const shot of early) {
      const win = deadBallFrames(shot.wt);
      expect(win.length).toBeGreaterThanOrEqual(3);
      const first = win[0]![2]!;
      const last = win[win.length - 1]![2]!;
      expect(last).toBeLessThan(first); // game clock fell during the stoppage
      for (let i = 1; i < win.length; i++) {
        expect(win[i]![0]).toBeGreaterThan(win[i - 1]![0]!);
      }
    }
  });
});

describe('released-shot contest stamp (resolve.ts:79, events.ts:243)', () => {
  it('every shot event carries a contest inside [0,1]', () => {
    let shots = 0;
    for (const e of ev) {
      if (e.type !== 'shot') continue;
      expect(e.contest).toBeGreaterThanOrEqual(0);
      expect(e.contest).toBeLessThanOrEqual(1);
      shots += 1;
    }
    expect(shots).toBeGreaterThanOrEqual(100); // a full game's worth, not a vacuous loop
  });
});
