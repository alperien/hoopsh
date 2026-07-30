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

  it('a duplicate player id ACROSS teams throws at the boundary and names the id', () => {
    // one agents Map serves both sides, keyed by player id — before the
    // cross-team check, mkAgents(away) silently overwrote the colliding home
    // agent: the game ran to completion with garbage output (0-120 finals,
    // 288-minute team box sums) and exit 0, reachable from the shipped CLI
    // by passing the same pack twice. Per-team duplicate checks cannot see
    // it; only the union check at the simulateGame boundary can.
    const { home, away } = sampleMatchup();
    const dup = structuredClone(away);
    // collide a BENCH player so the per-team checks (starters on roster,
    // within-team duplicates) still pass and the union check is what throws
    const bench = dup.players.find((p) => !dup.starters.includes(p.id))!;
    const collidingId = home.players[0]!.id;
    bench.id = collidingId;
    expect(() => simulateGame({ seed: 'adv-dup-id', home, away: dup, collectFrames: false }))
      .toThrow(new RegExp(`duplicate player id across teams: ${collidingId}`));
    // the degenerate "team vs itself" experiment (same pack twice) fails the
    // same way instead of producing the silent 0-120
    expect(() => simulateGame({ seed: 'adv-dup-self', home, away: home, collectFrames: false }))
      .toThrow(/duplicate player id across teams/);
  });

  it('a duplicate STARTER id throws at the boundary instead of playing 4-on-5', () => {
    // ['A','A','B','C','D'] passed every pre-existing check (5 starters, all
    // on roster, roster ids unique) and initState built a lineup with the
    // same body in two slots: the game ran to a normal-looking completion
    // with one team fielding four distinct players — the same silent-
    // corruption class the NaN boundary check exists for (scan a1).
    const { home, away } = sampleMatchup();
    const dup = structuredClone(home);
    dup.starters[1] = dup.starters[0]!;
    expect(() => simulateGame({ seed: 'adv-dup-starter', home: dup, away, collectFrames: false }))
      .toThrow(/duplicate starter ids/);
  });

  it('a game that cannot finish throws instead of returning a fake result', () => {
    // The tick-loop safety cap is a bug tripwire. An earlier version emitted
    // a legitimate-looking game_end when it tripped — a stalled game could
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
    // own empty array — undefined, silently
    const rng = new Rng('adv-weights-empty');
    expect(() => rng.weighted([])).toThrow(/empty weights/);
  });

  it('withParams rejects unknown override keys loudly (dynamic callers get no typo mercy)', () => {
    // a typo'd sweep/era-pack path used to merge in silently and be read by
    // nothing — the experiment then measured the unmodified engine while
    // reporting the knob as applied
    expect(() => withParams({ shto: { baseRim: 0.5 } } as never)).toThrow(/unknown SimParams key "shto"/);
    expect(() => withParams({ shot: { baseRym: 0.5 } } as never)).toThrow(/unknown SimParams key "shot.baseRym"/);
    // valid overrides still work and land
    const p = withParams({ shot: { baseRim: 0.42 } });
    expect(p.shot.baseRim).toBe(0.42);
    expect(p.shot.basePaint).toBe(withParams().shot.basePaint);
  });

  it('withParams rejects null/array/scalar GROUP overrides loudly (audit M-17)', () => {
    // { shot: null } used to fall through the merge's leaf branch and
    // replace the whole group — detonating seconds into the sim as an
    // unattributed read of undefined, naming no field
    expect(() => withParams({ shot: null } as never)).toThrow(/group "shot" must be a plain-object/);
    expect(() => withParams({ decide: [0.5] } as never)).toThrow(/group "decide" must be a plain-object/);
    expect(() => withParams({ reb: 3 } as never)).toThrow(/group "reb" must be a plain-object/);
    // an undefined group override stays a no-op (spread-built partials)
    expect(withParams({ shot: undefined }).shot.baseRim).toBe(withParams().shot.baseRim);
  });

  it('withParams rejects tickHz/frameEvery combos that collapse frame timestamps (audit M-16)', () => {
    // frame rows stamp wallT at one decimal: a wall-clock frame step below
    // 0.1 s (frameEvery/tickHz) writes duplicate timestamps and breaks the
    // strictly-increasing frame-time contract the viewer keys on — this
    // legal-looking config used to pass silently
    expect(() => withParams({ tickHz: 30, frameEvery: 2 })).toThrow(/frame step/);
    expect(() => withParams({ tickHz: 0 })).toThrow(/must be positive/);
    expect(() => withParams({ frameEvery: -1 })).toThrow(/must be positive/);
    // legal retunes still pass: 30 Hz with a 3-tick cadence is exactly 0.1 s
    expect(withParams({ tickHz: 30, frameEvery: 3 }).tickHz).toBe(30);
  });

  it('missing or non-finite Team.tactics throws at the boundary; strict enforces its range (audit M-44)', () => {
    // the AI reads tactics.threeBias/helpAggr unconditionally: a missing
    // tactics object crashed raw mid-game, and a NaN threeBias passed
    // 'strict' only to detonate ~8 simulated seconds later as an
    // unattributed non-finite-weight throw
    const { home, away } = sampleMatchup();
    const noTactics = structuredClone(home) as unknown as { tactics?: unknown };
    delete noTactics.tactics;
    expect(() => simulateGame({ seed: 'adv-tactics-missing', home: noTactics as typeof home, away, collectFrames: false }))
      .toThrow(/missing tactics/);
    const nanTactics = structuredClone(home);
    nanTactics.tactics.threeBias = NaN;
    expect(() => simulateGame({ seed: 'adv-tactics-nan', home: nanTactics, away, collectFrames: false }))
      .toThrow(/non-finite tactic home\/.*threeBias/);
    // finite-but-out-of-range: legal in the default tier (saturates), loud in strict
    const hot = structuredClone(home);
    hot.tactics.threeBias = 400;
    expect(() => simulateGame({ seed: 'adv-tactics-strict', home: hot, away, collectFrames: false, validate: 'strict' }))
      .toThrow(/tactic out of range/);
    const r = simulateGame({ seed: 'adv-tactics-loose', home: hot, away, collectFrames: false });
    expect(r.events[r.events.length - 1]!.type).toEqual('game_end');
  });

  it("validate:'strict' enforces the pack contract that the default tier deliberately does not", () => {
    // the same 999 that is LEGAL input below is rejected when the caller
    // opts into the strict tier — "valid but unusual" vs "invalid" is a
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
    // note the LOW bars: a 999-everything defense legitimately strangles the
    // game (every pass lane is lethal, so possessions die as turnovers — the
    // first run found 15 total shots, and the texture increment's pass-back
    // damping squeezed scoring further, which is coherent, not corrupt). The
    // claim under test is invariant integrity, not playability: possessions
    // balance, the game ran, shots happened, SOMETHING scored — the
    // corruption signature this fixture catches was a 0-0 stall.
    expect(shots).toBeGreaterThan(5);
    expect(result.events.length).toBeGreaterThan(400); // the game actually ran
    expect(lastScore[0] + lastScore[1]).toBeGreaterThan(0);
  });
});
