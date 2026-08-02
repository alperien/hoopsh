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
 *   5. F2 (below): the gate itself, condition by condition, on
 *      hand-built states — phase, commit, arming, stage, label, retreat,
 *      and the F1 gather gate. Stream-side tests cannot see these.
 *   6. F3 (below): the arming-draw region — exact stream checksums at an
 *      intermediate scale and the draw-free top.
 *
 * DENOMINATOR CONVENTION (probe F4, Lead-ruled): scout counts on the
 * transcarry-1..24 pool are raw sums over 24 single games with BOTH
 * TEAMS POOLED — a "per 48" rate is per TEAM-GAME (one game contributes
 * two team-games), so 238/48 = 4.96 per team-game = 9.92 per game. The
 * PR #75 probe's independent n=144 per-game reads reconcile at exactly
 * 2x the naive per-game division; state the convention wherever these
 * figures are quoted.
 *
 * Scouted at the staged landing (pool transcarry-1..24, per-team-game
 * denominator): staged arm 5 plane drive releases on transition-kind
 * possessions and 238 transition-kind drive attempts; flipped arm 180
 * plane releases (+175); opener-context plane drives 6 staged vs 5
 * flipped. Re-scouted on the F1-amended mechanism (same pool): flipped
 * plane 134 (+129 vs the +55 floor), transition-kind drive attempts
 * 231, opener 6 vs 6; the staged arm byte-reproduces 5/238/6. Floors
 * sit well under both scouts (vacuity >= 60 vs 238; margin >= +55;
 * opener guard <= staged + 6). Re-anchor: re-run the scout, same safety
 * shape as the leakout row.
 */
import { describe, expect, it } from 'vitest';
import {
  NBA, makeCourt, simulateGame, withParams,
  type GameEvent, type GameResult, type ShotMoveType
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { carriesToRim } from '../src/sim/game.js';
import { attackedRim, type Agent, type GameState } from '../src/sim/state.js';

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

// ------------------------------------------------------------------ F2 pins

/**
 * F2 (PR #75 probe comment, Lead-ruled amendment): the gate, condition by
 * condition, on hand-built states. The pooled pins above bucket by
 * possession START kind and arming is kind-scoped, so a WITHIN-possession
 * gate regression is invisible to them: the probe's phase-gate mutant
 * (`s.poss.phase === 'transition'` -> `true`) passed this whole file while
 * leaking 0.25 halfcourt-phase carries per game — the beaten-containment
 * channel W64 assigns to a separate arc — and its commit-gate mutant
 * (`s.t < h.driveUntil` -> `true`) passed while binding nowhere. Phase is
 * not in the event stream, so no stream-side test can pin either. These
 * cases drive the extracted predicate (game.ts carriesToRim) directly,
 * one condition at a time, in the grammar.test.ts stub shape. All three
 * gate mutants (phase drop, commit drop, gather-gate deletion) were
 * re-applied and verified RED against these pins before landing — the
 * mutation-shields.test.ts doctrine.
 *
 * The stub builds only what the predicate reads: params, court, period,
 * the defenders' lineup side (defendersBack scans the defense within
 * move.transBackRadiusFt = 30 ft of the attacked rim), poss
 * carryArmed/phase, the clock, and the holder's pos/driveUntil. Values
 * pin the shipped defaults on purpose: gather boundary cases sit 0.1 ft
 * either side of ai.transCarryGatherFt = 4.5, and the retreat cases sit
 * either side of move.transSetBackCount = 4.
 */
describe('F2: the carry gate, condition by condition (hand-built states)', () => {
  interface GateOpts {
    scale?: number;                          // ai.transCarryScale, default 1
    armed?: boolean;                         // poss.carryArmed, default true
    moveType?: ShotMoveType;                 // default 'drive'
    commitLeft?: number;                     // driveUntil - t, default +1 (live)
    phase?: 'transition' | 'halfcourt' | 'advance';
    back?: number;                           // defenders inside the retreat radius, default 0
    holderFt?: number;                       // decide-time body-to-rim ft, default 2
  }

  function gateCase(o: GateOpts = {}): boolean {
    const params = withParams({ ai: { transCarryScale: o.scale ?? 1 } });
    const court = makeCourt(NBA);
    const t = 100; // mid-Q2, any live moment: the predicate reads no clock but t itself
    const agents = new Map<string, Agent>();
    const lineup: [string[], string[]] = [[], []];
    const s = {
      params, rules: NBA, court, period: 2, t, agents, lineup,
      poss: { carryArmed: o.armed ?? true, phase: o.phase ?? 'transition' }
    } as unknown as GameState;
    const rim = attackedRim(s, 0);
    const inward = rim.x > court.midX ? -1 : 1; // toward midcourt
    // five defenders: `back` of them 10 ft from the attacked rim (inside
    // the 30 ft retreat radius), the rest parked 55 ft out (beyond it)
    for (let i = 0; i < 5; i++) {
      const backOne = i < (o.back ?? 0);
      agents.set(`d-${i}`, {
        pos: { x: rim.x + inward * (backOne ? 10 : 55), y: rim.y - 4 + i * 2 },
        onCourt: true, fouledOut: false
      } as unknown as Agent);
      lineup[1].push(`d-${i}`);
    }
    const h = {
      side: 0,
      pos: { x: rim.x + inward * (o.holderFt ?? 2), y: rim.y },
      driveUntil: t + (o.commitLeft ?? 1)
    } as unknown as Agent;
    return carriesToRim(s, h, o.moveType ?? 'drive');
  }

  it('carries when every gate holds: transition, armed, drive, live commit, beaten, in reach', () => {
    expect(gateCase()).toBe(true);
  });

  it('the PHASE gate: halfcourt phase on the same armed possession never carries', () => {
    // the probe mutant that passed the whole pre-F2 file (0.25/g leak)
    expect(gateCase({ phase: 'halfcourt' })).toBe(false);
    expect(gateCase({ phase: 'advance' })).toBe(false);
  });

  it('the COMMIT gate: an expired driveUntil never carries', () => {
    // the probe's second mutant — binds rarely, regresses invisibly
    expect(gateCase({ commitLeft: -0.1 })).toBe(false);
    expect(gateCase({ commitLeft: 0 })).toBe(false); // strict <: expiry is exclusive
  });

  it('the ARMING gate: an unarmed possession never carries at any live scale', () => {
    expect(gateCase({ armed: false })).toBe(false);
    expect(gateCase({ armed: false, scale: 0.5 })).toBe(false);
  });

  it('the STAGE switch: scale 0 never carries, armed or not', () => {
    expect(gateCase({ scale: 0 })).toBe(false);
  });

  it('the LABEL gate: only drive finishes carry', () => {
    expect(gateCase({ moveType: 'pull_up' })).toBe(false);
    expect(gateCase({ moveType: 'catch_shoot' })).toBe(false);
    expect(gateCase({ moveType: 'putback' })).toBe(false);
  });

  it('the RETREAT gate: a set defense (transSetBackCount back) never carries', () => {
    expect(gateCase({ back: 4 })).toBe(false); // move.transSetBackCount = 4
    expect(gateCase({ back: 3 })).toBe(true);  // one short of set is still beaten
  });

  it('the F1 GATHER gate: reach is the carry\'s own bound, not driveShotRangeFt', () => {
    expect(gateCase({ holderFt: 4.4 })).toBe(true);
    expect(gateCase({ holderFt: 4.6 })).toBe(false); // in (gather 4.5, label 12): the F1 tail class
    expect(gateCase({ holderFt: 10 })).toBe(false);  // the probed teleport class, now unreachable
  });
});

// ------------------------------------------------------------------ F3 pins

/**
 * F3 (PR #75 probe comment, Lead-ruled amendment): the intermediate-dose
 * region, pinned. Every pooled case above runs at the dial ends (0 and
 * 1), both draw-free by the heave-guard shape — so the per-possession
 * arming DRAW is live exactly where nothing looked, and the landing dose
 * sits there. Two probe mutants passed the whole pre-F3 file to prove
 * the blindness: dropping the arming draw's kind scope (streams
 * identical at both ends, 12/12 diverged at 0.37 — every possession
 * draws instead of only live_rebound/steal), and dropping the draw-free
 * short-circuit (`carryScale >= 1 || chance` -> `chance` — one extra
 * draw per armed-scope possession shifts every scale-1 stream). Both
 * were re-applied and verified RED against these pins before landing.
 *
 * The pins are exact stream checksums — event count, final score, and
 * FNV-1a over JSON.stringify({e: events, f: frames}) with frames on
 * (the probe's own hashing convention; frames included so the F1 ball
 * path is pinned too). RE-ANCHOR: any commit that legitimately reorders
 * these streams (a landed draw upstream, a movement change) re-runs
 * this file and copies the printed actuals in, saying so in the commit
 * — the goldens doctrine. The intermediate scale IS the landing dose
 * (0.5), per the Lead ruling — one pinned scale in (0, 1), anchored
 * where the shipped default actually lives; it was 0.37 (the probe's
 * demonstration point) while the dose was unselected, re-anchored at
 * the landing commit. f3pin-1's checksum happens to match its 0.37
 * bake (that seed's arming draws land identically at both scales);
 * the other three differ, which is the pin being alive.
 *
 * The landing-dose row cannot pin the draw's DIRECTION (#127, the PR
 * #123 probe — the blow-by finding's twin, same cause): 0.5 is the
 * unique fixed point of p -> 1-p, so chance(scale) and
 * chance(1 - scale) are the same draw there, and the endpoint rows are
 * draw-free by the guard shape — a dose-inversion mutant agrees with
 * the clean engine at {0, 0.5, 1}. The scale-0.25 row is the
 * asymmetric kill: arming 75% instead of 25% of the kind-scoped
 * possessions separates the streams (f3pin-1's 0.25 stream diverges
 * from its 0.5 bake, and the row was verified RED against the
 * hand-applied inversion before landing, the mutation-shields
 * doctrine). Rider for future increments: a landing dose of exactly
 * 0.5 always needs one asymmetric row beside it.
 */
describe('F3: the arming-draw region is pinned (intermediate scale + draw-free top)', () => {
  const fnv1a = (str: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  };

  // Re-anchored at the #115 layer A acquisition stamp (giveBall writes
  // ball.pos to the new holder at every change of hands — the first
  // defensive read after any acquisition prices the honest ball, moving
  // events AND frames on every stream): all seven rows re-baked per this
  // block's doctrine — the #127 dose row included — cause stated in the
  // landing commit.
  const PINNED: { seed: string; scale: number; events: number; final: string; hash: string }[] = [
    { seed: 'f3pin-1', scale: 0.25, events: 1203, final: '123-110', hash: '182b7db2' },
    { seed: 'f3pin-1', scale: 0.5, events: 1300, final: '123-109', hash: 'ab5b85e4' },
    { seed: 'f3pin-2', scale: 0.5, events: 1406, final: '136-138', hash: '15bf16c9' },
    { seed: 'f3pin-3', scale: 0.5, events: 1159, final: '103-88', hash: 'c8fcabf5' },
    { seed: 'f3pin-4', scale: 0.5, events: 1234, final: '124-133', hash: '71c4b838' },
    { seed: 'f3pin-1', scale: 1, events: 1215, final: '131-130', hash: '6db1525e' },
    { seed: 'f3pin-2', scale: 1, events: 1221, final: '126-114', hash: 'cce839c0' }
  ];

  for (const pin of PINNED) {
    it(`${pin.seed} at scale ${pin.scale} streams exactly the baked checksum`, () => {
      const { home, away } = sampleMatchup();
      const r = simulateGame({
        seed: pin.seed, home, away, collectFrames: true,
        params: { ai: { transCarryScale: pin.scale } }
      });
      const last = r.events[r.events.length - 1]!;
      expect(r.events.length).toBe(pin.events);
      expect(`${last.score[0]}-${last.score[1]}`).toBe(pin.final);
      expect(fnv1a(JSON.stringify({ e: r.events, f: r.frames }))).toBe(pin.hash);
    });
  }
});

// -------------------------------------------------- delta F1 ball-path pin

/**
 * Delta F1 (PR #75 delta probe, comment 5150806420, Lead-ruled amendment):
 * the honest ball path, pinned as a PROPERTY. The F1 lerp (game.ts tickLive
 * carry branch: decide spot to rim across the windup) was pinned only
 * through the F3 stream checksums above, and checksums do not survive the
 * F3 header's own re-anchor doctrine: a commit that legitimately reorders
 * streams re-runs the file and copies the printed actuals in, so a lerp
 * broken INSIDE such a commit prints wrong actuals and gets baked in as
 * the new pin, silently. A property over the simulated frames survives
 * every re-anchor by construction.
 *
 * The property: a carried booking lands continuously, so the frame ball
 * must MEET the booked release. For every carried-signature shot (drive
 * label, distFt <= PLANE_FT, live_rebound/steal start kind, no foul
 * sharing the shot's wt: whistle-stamped bookings are the pre-existing
 * FT-lineup reposition class, registered in W82 and filed as its own
 * issue), the last frame strictly before the shot's wt sits within 3.5 ft
 * of the booked x/y. The foul-sharing exclusion was NECESSARY while the
 * FT-entry snap existed (the snap would have polluted the continuity
 * read on a fouled booking); PR #119 (`e851169a`) replaced that snap
 * with a wall-clock carry, so the exclusion is now merely conservative.
 *
 * The 3.5 ft bound: measured max 2.92 ft over n=109 un-fouled carried
 * bookings at the landed default (pool rtfg-1..48, the delta probe's
 * read). The theoretical step is one 0.2 s frame of lerp at the gather
 * gate's top speed (4.5 ft covered across the 0.50 s effective windup is
 * 9 ft/s, so about 1.8 ft per frame step) plus the short flight hop and
 * the 0.1 ft frame rounding. Scale 1 here for signature volume only: the
 * dose scales arming frequency, not per-carry geometry. The lerp-kill
 * mutant (ball rides the body through the windup, the pre-amendment
 * shape) was verified RED against this pin before landing, in-tree and
 * restored — the mutation-shields doctrine.
 */
describe('delta F1: the frame ball meets the carried booking (honest-path property)', () => {
  const PATH_POOL = Array.from({ length: 6 }, (_, i) => `ballpath-${i + 1}`);

  it('the last frame strictly before every carried-signature booking sits within 3.5 ft', () => {
    let signatures = 0;
    let maxGapFt = 0;
    for (const seed of PATH_POOL) {
      const { home, away } = sampleMatchup();
      const r = simulateGame({
        seed, home, away, collectFrames: true,
        params: { ai: { transCarryScale: 1 } }
      });
      const foulWt = new Set<number>();
      for (const e of r.events as GameEvent[]) {
        if (e.type === 'foul') foulWt.add(e.wt);
      }
      let possKind = '';
      let fi = 0; // rolling frame cursor: events and frames share wallT order
      for (const e of r.events as GameEvent[]) {
        if (e.type === 'possession_start') { possKind = e.kind; continue; }
        if (e.type !== 'shot' || e.moveType !== 'drive' || e.distFt > PLANE_FT) continue;
        if (possKind !== 'live_rebound' && possKind !== 'steal') continue;
        if (e.foul !== undefined || foulWt.has(e.wt)) continue;
        // frame row layout (replay/replay.ts): [0] wallT, [3] ballX, [4] ballY
        while (fi < r.frames.length && r.frames[fi]![0]! < e.wt) fi += 1;
        if (fi === 0) continue; // no frame precedes the booking (unreachable in practice)
        const fr = r.frames[fi - 1]!;
        const gap = Math.hypot(fr[3]! - e.x, fr[4]! - e.y);
        signatures += 1;
        if (gap > maxGapFt) maxGapFt = gap;
      }
    }
    // vacuity floor: the signature class must exist pooled, or the property
    // asserts over an empty slice
    expect(signatures).toBeGreaterThanOrEqual(20);
    expect(maxGapFt).toBeLessThanOrEqual(3.5);
  });
});
