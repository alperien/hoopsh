/**
 * Rim make-model monotonicity in defense (audit M-02).
 *
 * The uncontested height default (rimHeightUncontestedFt, 0.5 ft) used to
 * apply ONLY to the by === null case: the instant any defender crossed the
 * contest radius, the height term jumped to the full clamped reach
 * difference. Two defects followed — a light contest by a much SHORTER
 * defender out-valued wide open (+6.1pp at the worst case: adding a bad
 * contest RAISED make probability), and the rim logit was discontinuous at
 * the contest-radius boundary. The fix blends the matchup edge in with
 * contest level (level 0 ≡ uncontested baseline, level 1 ≡ full clamped
 * edge, exactly the old fully-contested value), which makes the rim logit
 * strictly decreasing in contest for ANY matchup at the shipped
 * coefficients: d/dlevel = contestCoef + rimHeightCoef·(adv − baseline)
 * ≤ −1.1325 + 0.35·(1.5 − 0.5) < 0.
 *
 * Direct shotMakeP pins on a hand state — no rng, no full games.
 */

import { describe, expect, it } from 'vitest';
import { defaultParams, makePlayer } from '@hoopsh/engine';
import { shotMakeP, type Contest } from '../src/sim/resolve.js';
import type { Agent, GameState } from '../src/sim/state.js';

const s = { params: defaultParams } as unknown as GameState;

function shooter(): Agent {
  return {
    p: makePlayer({ id: 'sh', name: 'Shooter', pos: 'C', heightIn: 78 }),
    energy: 100,
    catchQuality: 0
  } as unknown as Agent;
}

/** rim make-p under a contest of `level` by a defender `advFt` shorter in reach */
function rimP(level: number, advFt: number): number {
  const c: Contest = { level, by: level > 0 ? 'd1' : null, heightAdvFt: level > 0 ? advFt : 0.5 };
  return shotMakeP(s, shooter(), 'rim', 2, 'drive', c);
}

describe('rim make-p is monotone in contest (audit M-02)', () => {
  it('a light contest by a shorter defender never beats wide open', () => {
    const open = rimP(0, 0.5);
    // the audit's worst case: big reach edge (clamps at +1.5), grazing contest
    for (const level of [0.05, 0.1, 0.2, 0.4]) {
      expect(rimP(level, 3)).toBeLessThan(open);
    }
  });

  it('make-p decreases as the same defender contests harder (no interior maximum)', () => {
    for (const adv of [-1.5, -0.5, 0.5, 1.5, 3]) {
      let prev = rimP(0, adv);
      for (let level = 0.1; level <= 1.001; level += 0.1) {
        const p = rimP(level, adv);
        expect(p).toBeLessThan(prev);
        prev = p;
      }
    }
  });

  it('no jump at the contest-radius boundary: level → 0 converges to the uncontested value', () => {
    const open = rimP(0, 0.5);
    // a defender barely inside the radius, huge reach mismatch either way:
    // the old code jumped by rimHeightCoef·(±1.5 − 0.5) logits here
    expect(Math.abs(rimP(1e-6, 3) - open)).toBeLessThan(1e-4);
    expect(Math.abs(rimP(1e-6, -3) - open)).toBeLessThan(1e-4);
  });

  it('the fully-contested value still prices the full clamped reach edge (taller finishes over smaller)', () => {
    // blend endpoints unchanged: at level 1 a +1.5 reach edge beats a −1.5
    // one by exactly the old margin — the fix rescaled the PATH, not the ends
    expect(rimP(1, 1.5)).toBeGreaterThan(rimP(1, -1.5));
  });
});
