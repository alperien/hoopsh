/**
 * W64 channel 3 — the transition leak-out (session-8 arc; the register's
 * channel-3 row): on live-rebound/steal transitions the fastest
 * gate-clearing non-handler abandons his spot for the far rim, and the
 * finish rides the ORDINARY catch path (the channel-2 lob fusion was
 * measured worse than that path and stripped — see the falsification row).
 *
 * Pinned here:
 *   1. Determinism at the flip: same seed, same scale, identical streams
 *      (the designation is rng-free; this guards a future draw sneaking in).
 *   2. The dial is live: staged vs flipped streams diverge on the pool.
 *   3. The mechanism, stream-side: early point-blank finishes by
 *      gate-clearing athletes in live_rebound/steal possessions (the leak
 *      signature) rise POOLED under the flip, with a vacuity floor on the
 *      staged arm so the premise cannot be empty. Pooled aggregates only —
 *      per-seed inequalities on diverged trajectories are seed lottery.
 *   4. The G3 exclusion, by the same counter: possessions that START from
 *      makes/inbounds ('advance' openers) show NO leak-signature rise —
 *      the phase gate is 'transition' (live_rebound/steal) by construction.
 *
 * Scouted at the staged landing (out/scout-leakout.mjs): pool
 * leakout-1..24, staged arm 24 transition leak-signature finishes, flipped
 * arm 148 (+517%); opener-context finishes 1 staged vs 0 flipped (the
 * exclusion holds dark and lit). Floors sit well under scout; the CURRENT
 * scout numbers and floors live in ./seed-pins.gen.ts (GENERATED).
 * Re-anchor (issue #50): run the helper named there — it re-runs this
 * scout and rewrites the floors at the same safety shape (vacuity ~60% of
 * the staged scout, margin ~a third of the gap), and REFUSES when the
 * fresh scout shows the mechanism itself collapsed rather than reshuffled.
 */
import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent, type GameResult } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { SEED_PINS } from './seed-pins.gen.js';

const POOL = Array.from({ length: 24 }, (_, i) => `leakout-${i + 1}`);

const game = (seed: string, scale: number): GameResult => {
  const { home, away } = sampleMatchup();
  return simulateGame({ seed, home, away, params: { ai: { leakOutScale: scale } } });
};

/** leak-signature finishes: a made/missed shot <=3 ft within windowSec of a
 *  possession start, by a shooter whose athlete blend clears the engine
 *  gate, split by the possession's start kind */
function signatures(g: GameResult, windowSec = 6): { transition: number; opener: number } {
  const traits = new Map<string, { vertical: number; finishing: number }>();
  for (const t of g.teams) for (const p of t.players) traits.set(p.id, p.attr);
  const gate = (id: string): boolean => {
    const a = traits.get(id);
    return !!a && 0.6 * a.vertical + 0.4 * a.finishing >= 74;
  };
  let transition = 0;
  let opener = 0;
  let possT = 0;
  let possKind = '';
  for (const e of g.events as GameEvent[]) {
    if (e.type === 'possession_start') { possT = e.t; possKind = e.kind; continue; }
    if (e.type !== 'shot' || e.distFt > 3 || e.t - possT > windowSec) continue;
    if (!gate(e.shooter)) continue;
    if (possKind === 'live_rebound' || possKind === 'steal') transition += 1;
    else opener += 1;
  }
  return { transition, opener };
}

describe('the transition leak-out (W64 channel 3, offense.ts)', () => {
  const staged = POOL.map((s) => game(s, 0));
  const live = POOL.map((s) => game(s, 1));

  it('the flipped branch is deterministic: same seed, same scale, same stream', () => {
    const again = game(POOL[0]!, 1);
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(live[0]!.events));
  });

  it('the dial is live: staged and flipped streams diverge on the pool', () => {
    let diverged = 0;
    for (let i = 0; i < POOL.length; i++) {
      if (JSON.stringify(staged[i]!.events) !== JSON.stringify(live[i]!.events)) diverged += 1;
    }
    expect(diverged).toBeGreaterThan(0);
  });

  it('leak-signature finishes rise in transition possessions (pooled, with floors)', () => {
    let sTrans = 0;
    let lTrans = 0;
    for (let i = 0; i < POOL.length; i++) {
      sTrans += signatures(staged[i]!).transition;
      lTrans += signatures(live[i]!).transition;
    }
    expect(sTrans).toBeGreaterThanOrEqual(SEED_PINS.leakout.floors.stagedVacuityMin); // vacuity: the premise exists dark
    expect(lTrans).toBeGreaterThanOrEqual(sTrans + SEED_PINS.leakout.floors.liveRiseMin); // the mechanism, with margin
  });

  it('openers and post-make possessions carry no leak (the G3 exclusion)', () => {
    let sOpen = 0;
    let lOpen = 0;
    for (let i = 0; i < POOL.length; i++) {
      sOpen += signatures(staged[i]!).opener;
      lOpen += signatures(live[i]!).opener;
    }
    // the phase gate is 'transition': non-transition contexts must not RISE
    // (they may fall — transition converts earlier and steals share)
    expect(lOpen).toBeLessThanOrEqual(sOpen + SEED_PINS.leakout.floors.openerSlack);
  });
});
