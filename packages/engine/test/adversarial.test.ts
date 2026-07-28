/**
 * Adversarial-input guard: permanent fixtures from the independent review.
 *
 * The review showed that a single NaN rating silently corrupted a game
 * (0-0 stall, fake game_end, broken pace invariant) because nothing between
 * the caller and the sigmoid chain checked finiteness. These tests pin the
 * fix: non-finite input fails loudly at the boundary, corrupt randomness
 * weights fail loudly at the RNG, and extreme-but-finite rosters, which are
 * legal input by design, still complete with every core invariant intact.
 */

import { describe, expect, it } from 'vitest';
import { Rng, simulateGame, withParams } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

function poisoned(field: 'attr' | 'tend', key: string, value: number) {
  const { home, away } = sampleMatchup();
  const bad = structuredClone(home);
  (bad.players[2]![field] as unknown as Record<string, number>)[key] = value;
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

  it('a game that cannot finish throws instead of returning a fake result', () => {
    // The tick-loop safety cap is a bug tripwire. An earlier version emitted
    // a legitimate-looking game_end when it tripped, so a stalled game could
    // masquerade as a valid result. safetyCapTicks is the diagnostics
    // override that lets us prove the loud-failure path in milliseconds.
    const { home, away } = sampleMatchup();
    expect(() => simulateGame({ seed: 'adv-cap', home, away, collectFrames: false, safetyCapTicks: 50 }))
      .toThrow(/safety cap/);
  });

  it('Rng.weighted rejects non-finite weights loudly', () => {
    const rng = new Rng('adv-weights');
    expect(() => rng.weighted([NaN, 1, 1])).toThrow(/non-finite weight/);
    expect(() => rng.weighted([Infinity, 1])).toThrow(/non-finite weight/);
  });

  it('Rng.weighted rejects an empty weights array loudly', () => {
    // used to fall through to int(0) === 0 and the caller then indexed its
    // own empty array and got undefined, silently
    const rng = new Rng('adv-weights-empty');
    expect(() => rng.weighted([])).toThrow(/empty weights/);
  });

  it('withParams rejects unknown override keys loudly (dynamic callers get no typo mercy)', () => {
    // a typo'd sweep/era-pack path used to merge in silently and be read by
    // nothing; the experiment then measured the unmodified engine while
    // reporting the knob as applied
    expect(() => withParams({ shto: { baseRim: 0.5 } } as never)).toThrow(/unknown SimParams key "shto"/);
    expect(() => withParams({ shot: { baseRym: 0.5 } } as never)).toThrow(/unknown SimParams key "shot.baseRym"/);
    // valid overrides still work and land
    const p = withParams({ shot: { baseRim: 0.42 } });
    expect(p.shot.baseRim).toBe(0.42);
    expect(p.shot.basePaint).toBe(withParams().shot.basePaint);
  });

  it("validate:'strict' enforces the pack contract that the default tier deliberately does not", () => {
    // the same 999 that is legal input below is rejected when the caller
    // opts into the strict tier. "Valid but unusual" vs "invalid" is a
    // caller choice, formalized (second external review).
    const { home, away } = poisoned('attr', 'three', 999);
    expect(() => simulateGame({ seed: 'adv-strict', home, away, collectFrames: false, validate: 'strict' }))
      .toThrow(/out of range/);
    // and a clean pack passes strict untouched
    const clean = sampleMatchup();
    const r = simulateGame({ seed: 'adv-strict-ok', home: clean.home, away: clean.away, collectFrames: false, validate: 'strict' });
    expect(r.events[r.events.length - 1]!.type).toEqual('game_end');
  });

  it('extreme-but-finite ratings are legal input: the game completes and core invariants hold', () => {
    const { home, away } = sampleMatchup();
    const extreme = structuredClone(home);
    for (const p of extreme.players) {
      for (const k of Object.keys(p.attr)) (p.attr as unknown as Record<string, number>)[k] = 999;
      for (const k of Object.keys(p.tend)) (p.tend as unknown as Record<string, number>)[k] = 0;
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
    // The bars are low on purpose: a 999-everything defense legitimately
    // strangles the game. Every pass lane is lethal, so possessions die as
    // turnovers; the first run found 15 total shots, and the texture
    // increment's pass-back damping squeezed scoring further, which is
    // coherent, not corrupt. The claim under test is invariant integrity,
    // not playability: possessions balance, the game ran, shots happened,
    // something scored. The corruption signature this fixture catches was a
    // 0-0 stall.
    expect(shots).toBeGreaterThan(5);
    expect(result.events.length).toBeGreaterThan(400); // the game actually ran
    expect(lastScore[0] + lastScore[1]).toBeGreaterThan(0);
  });
});
