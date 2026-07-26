/**
 * Adversarial-input guard — permanent fixtures from the independent review.
 *
 * The review demonstrated that a single NaN rating silently corrupted a game
 * (0-0 stall, fake game_end, broken pace invariant) because nothing between
 * the caller and the sigmoid chain checked finiteness. These tests pin the
 * fix: non-finite input FAILS LOUDLY at the boundary, corrupt randomness
 * weights fail loudly at the RNG, and extreme-but-finite rosters — which are
 * legal input by design — still complete with every core invariant intact.
 */

import { describe, expect, it } from 'vitest';
import { Rng, simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

function poisoned(field: 'attr' | 'tend', key: string, value: number) {
  const { home, away } = sampleMatchup();
  const bad = structuredClone(home);
  (bad.players[2]![field] as Record<string, number>)[key] = value;
  return { home: bad, away };
}

describe('adversarial input', () => {
  it('a NaN rating throws at the boundary instead of stalling the game', () => {
    const { home, away } = poisoned('attr', 'three', NaN);
    expect(() => simulateGame({ seed: 'adv-nan', home, away, collectFrames: false }))
      .toThrow(/non-finite rating/);
  });

  it('an Infinity rating throws at the boundary', () => {
    const { home, away } = poisoned('tend', 'usage', Infinity);
    expect(() => simulateGame({ seed: 'adv-inf', home, away, collectFrames: false }))
      .toThrow(/non-finite rating/);
  });

  it('Rng.weighted rejects non-finite weights loudly', () => {
    const rng = new Rng('adv-weights');
    expect(() => rng.weighted([NaN, 1, 1])).toThrow(/non-finite weight/);
    expect(() => rng.weighted([Infinity, 1])).toThrow(/non-finite weight/);
  });

  it('extreme-but-finite ratings are legal input: the game completes and core invariants hold', () => {
    const { home, away } = sampleMatchup();
    const extreme = structuredClone(home);
    for (const p of extreme.players) {
      for (const k of Object.keys(p.attr)) (p.attr as Record<string, number>)[k] = 999;
      for (const k of Object.keys(p.tend)) (p.tend as Record<string, number>)[k] = 0;
    }
    const result = simulateGame({ seed: 'adv-extreme', home: extreme, away, collectFrames: false });
    let starts = 0;
    let ends = 0;
    let shots = 0;
    let lastScore: [number, number] = [0, 0];
    for (const e of result.events) {
      if (e.type === 'possession_start') starts++;
      if (e.type === 'possession_end') ends++;
      if (e.type === 'shot') shots++;
      if ('score' in e && e.score) lastScore = e.score as [number, number];
    }
    expect(starts).toEqual(ends);          // pace integrity survives the abuse
    // note the LOW bars: a 999-everything defense legitimately strangles the
    // game (every pass lane is lethal, so possessions die as turnovers — the
    // first run of this test found 15 total shots, which is coherent, not
    // corrupt). The claim under test is invariant integrity, not playability.
    expect(shots).toBeGreaterThan(5);
    expect(result.events.length).toBeGreaterThan(400); // the game actually ran
    expect(lastScore[0] + lastScore[1]).toBeGreaterThan(10);
  });
});
