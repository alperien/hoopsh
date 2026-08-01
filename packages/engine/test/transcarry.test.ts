/**
 * #74 increment 1 — the transition carry (game.ts executeAction shoot
 * branch + startShot carryRim): on a live-rebound/steal possession with
 * the retreat beaten, a committed drive finish CARRIES to a rim-plane
 * release by construction — the same decide fires the same 'drive' shot,
 * but the release point is the plane instead of the sprinting body's
 * stop-out (its stopping distance IS the behind-plane artifact). The
 * finish resolves through the ORDINARY windup race with the contest read
 * off the body and the make model unchanged; dunk-class booking follows
 * from the booth's own rule (made, inside DUNK_MAX_FT, athlete gate) —
 * the sync contract reused, not duplicated (narration dunkgate-sync).
 *
 * Pinned here (the leakout.test.ts shape, its registered sibling):
 *   1. Determinism at the flip: same seed, same scale, identical streams
 *      (the carry is rng-free; the arming draw short-circuits at 0 and 1).
 *   2. The dial is live: staged vs flipped streams diverge on the pool.
 *   3. The mechanism, stream-side: rim-plane drive releases (distFt <=
 *      PLANE_FT, moveType 'drive') on live_rebound/steal possessions
 *      rise POOLED under the flip, with a vacuity floor on the staged
 *      arm's transition drive volume so the premise cannot be empty.
 *      Pooled aggregates only — per-seed inequalities on diverged
 *      trajectories are seed lottery.
 *   4. The scope guard: possessions that start from makes/inbounds/tips
 *      show NO plane-release rise — the carry's gate is phase
 *      'transition', which only live_rebound/steal possessions enter.
 *
 * Scouted at the staged landing (out/i74/scout.mjs, pool
 * transcarry-1..24): staged arm 5 plane drive releases on transition-kind
 * possessions and 238 transition-kind drive attempts; flipped arm 180
 * plane releases (+175); opener-context plane drives 6 staged vs 5
 * flipped. Floors sit well under scout (vacuity >= 60 vs 238; margin
 * >= +55 vs the +175 gap; opener guard <= staged + 6). Re-anchor: re-run
 * the scout, same safety shape as the leakout row.
 */
import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent, type GameResult } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

/** the booth's book boundary (narration shotcall.ts DUNK_MAX_FT — real
 *  dunks live at 0-2 ft, 61/62 in the reference corpus); inline the same
 *  way leakout.test.ts inlines the 74-point gate and the 0.6/0.4 blend */
const PLANE_FT = 2.25;

const POOL = Array.from({ length: 24 }, (_, i) => `transcarry-${i + 1}`);

const game = (seed: string, scale: number): GameResult => {
  const { home, away } = sampleMatchup();
  return simulateGame({ seed, home, away, params: { ai: { transCarryScale: scale } } });
};

/** carry-signature counts: drive-labeled releases at/inside the booth's
 *  dunk range, split by the possession's start kind; plus the staged
 *  premise volume (any-distance drive attempts on transition-kind
 *  possessions) for the vacuity floor */
function signatures(g: GameResult): { plane: number; opener: number; transDrives: number } {
  const planeFt = PLANE_FT;
  let plane = 0;
  let opener = 0;
  let transDrives = 0;
  let possKind = '';
  for (const e of g.events as GameEvent[]) {
    if (e.type === 'possession_start') { possKind = e.kind; continue; }
    if (e.type !== 'shot' || e.moveType !== 'drive') continue;
    const transKind = possKind === 'live_rebound' || possKind === 'steal';
    if (transKind) transDrives += 1;
    if (e.distFt > planeFt) continue;
    if (transKind) plane += 1;
    else opener += 1;
  }
  return { plane, opener, transDrives };
}

describe('the transition carry (#74, game.ts driving branch)', () => {
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

  it('rim-plane drive releases rise pooled on transition-kind possessions', () => {
    let stagedPlane = 0;
    let livePlane = 0;
    let stagedTransDrives = 0;
    for (const g of staged) {
      const sig = signatures(g);
      stagedPlane += sig.plane;
      stagedTransDrives += sig.transDrives;
    }
    for (const g of live) livePlane += signatures(g).plane;
    // vacuity floor: the premise (committed drives on transition-kind
    // possessions) must exist on the STAGED arm, or the rise is measuring
    // an empty slice
    expect(stagedTransDrives).toBeGreaterThanOrEqual(60);
    // the mechanism: pooled plane releases rise under the flip
    expect(livePlane).toBeGreaterThanOrEqual(stagedPlane + 55);
  });

  it('scope guard: no plane-release rise outside live_rebound/steal possessions', () => {
    let stagedOpener = 0;
    let liveOpener = 0;
    for (const g of staged) stagedOpener += signatures(g).opener;
    for (const g of live) liveOpener += signatures(g).opener;
    expect(liveOpener).toBeLessThanOrEqual(stagedOpener + 6);
  });
});
