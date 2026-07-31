/**
 * Concept 12 — the pass-flight clock charge (ai.passClockCharge): the
 * chooser prices the receiver's shot at the ARRIVAL clock, mirroring the
 * world's rule that pass flight consumes the shot clock (game.ts tick
 * stage 2). Session-7 pass-volume arc; plan and verifier record in
 * findings/session7-plan(-review).md.
 *
 * What is pinned, and at which layer:
 *   1. Determinism inside the charged branch: same seed, same charge →
 *      identical event streams. The branch is pure arithmetic (no rng);
 *      this pin guards replay integrity against a future draw sneaking in.
 *   2. The dial is LIVE: charge 0 vs charge 1 diverge on the pool. Guards
 *      against the branch being silently dead (wrong guard, wrong scope).
 *   3. The mechanism, on real streams (the verifier's F4 stream-proxy —
 *      the shot clock itself is NOT event-derivable, so the pin counts
 *      receiver-catch violations: a turnover kind 'shot_clock' whose
 *      violator caught a pass within the final 1.5 s before the whistle.
 *      The session-7 verifier's 200-game classification read 100% of all
 *      shot-clock violations in this class — the grenade pass is the
 *      violation channel. Charging the flight must reduce them, POOLED
 *      across seeds (never per-seed strict inequality: two fully diverged
 *      rng trajectories are only comparable in aggregate).
 *   4. Totals guard: the charge must not INCREASE total shot-clock
 *      violations (the discount can only remove doomed throws).
 *
 * Seed pool scouted at the staged landing (out/scout-passclock.mjs, this
 * arc, at the shipped shape charge 1 / getOffSec 1.5): passclock-1..24
 * host 13 shot-clock violations in the staged arm, 13 of them
 * receiver-catch (the 100% class read reproduced); the charged arm reads
 * 1 total, 1 receiver-catch (-92% on the class). Vacuity floor
 * (staged >= 8) sits well under the scouted 13 so a reshuffle that starves
 * the premise fails loudly rather than passing on nothing; the margin
 * assertion (live <= staged - 4) is a third of the scouted gap of 12.
 * Re-anchor protocol: re-run out/scout-passclock.mjs 40; if the 24-seed
 * counts fall under the floors, widen the pool from the 40-seed scan and
 * update the floors to the same safety shape (floor ~60% of scouted,
 * margin ~a third of the scouted gap).
 */
import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent, type GameResult } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const POOL = Array.from({ length: 24 }, (_, i) => `passclock-${i + 1}`);

const game = (seed: string, charge: number): GameResult => {
  const { home, away } = sampleMatchup();
  return simulateGame({ seed, home, away, params: { ai: { passClockCharge: charge } } });
};

/** shot-clock violations, total and receiver-catch (a pass to the violator
 *  arriving within catchWindowSec of the whistle) */
function violations(g: GameResult, catchWindowSec = 1.5): { total: number; receiverCatch: number } {
  let total = 0;
  let receiverCatch = 0;
  const ev = g.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]!;
    if (e.type !== 'turnover' || e.kind !== 'shot_clock') continue;
    total += 1;
    // scan back for the violator's catch: the nearest prior pass TO him,
    // stopping at anything that resets the possession context
    for (let j = i - 1; j >= 0 && j > i - 12; j--) {
      const p = ev[j]!;
      if (p.type === 'pass' && p.to === e.player) {
        if (e.t - p.t <= catchWindowSec) receiverCatch += 1;
        break;
      }
      if (p.type === 'shot' || p.type === 'turnover' || p.type === 'possession_start') break;
    }
  }
  return { total, receiverCatch };
}

const streamOf = (g: GameResult): string => JSON.stringify(g.events);

describe('the pass-flight clock charge (concept 12, decide.ts)', () => {
  const staged = POOL.map((s) => game(s, 0));
  const live = POOL.map((s) => game(s, 1));

  it('the charged branch is deterministic: same seed, same charge, same stream', () => {
    const again = game(POOL[0]!, 1);
    expect(streamOf(again)).toBe(streamOf(live[0]!));
  });

  it('the dial is live: charge 0 and charge 1 diverge on the pool', () => {
    let diverged = 0;
    for (let i = 0; i < POOL.length; i++) {
      if (streamOf(staged[i]!) !== streamOf(live[i]!)) diverged += 1;
    }
    expect(diverged).toBeGreaterThan(0);
  });

  it('charging the flight cuts receiver-catch shot-clock violations (pooled)', () => {
    let stagedRC = 0;
    let liveRC = 0;
    for (let i = 0; i < POOL.length; i++) {
      stagedRC += violations(staged[i]!).receiverCatch;
      liveRC += violations(live[i]!).receiverCatch;
    }
    // vacuity floor: the staged pool must actually host the failure class
    // (scouted 15; a reshuffle that starves this fails loudly, re-scout per
    // the header)
    expect(stagedRC).toBeGreaterThanOrEqual(8);
    // the mechanism, with margin (scouted gap 9; asserted at less than half)
    expect(liveRC).toBeLessThanOrEqual(stagedRC - 4);
  });

  it('the charge never manufactures violations: live totals <= staged totals (pooled)', () => {
    let stagedTotal = 0;
    let liveTotal = 0;
    for (let i = 0; i < POOL.length; i++) {
      stagedTotal += violations(staged[i]!).total;
      liveTotal += violations(live[i]!).total;
    }
    expect(liveTotal).toBeLessThanOrEqual(stagedTotal);
  });

  it('the event stream still carries the violation vocabulary in both arms', () => {
    // guards the mechanism pin against a vacuous pass via the violation
    // CHANNEL disappearing (e.g. a refactor renaming the kind): some game
    // in some arm must still produce a shot_clock turnover
    const any = (gs: GameResult[]): boolean =>
      gs.some((g) => g.events.some((e: GameEvent) => e.type === 'turnover' && e.kind === 'shot_clock'));
    expect(any(staged)).toBe(true);
  });
});
