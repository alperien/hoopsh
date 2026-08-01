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
 * — the goldens doctrine. The intermediate scale is 0.37 (the probe's
 * demonstration point) until the increment's landing dose is selected;
 * the dose commit re-anchors the intermediate pins AT the landing dose
 * (the Lead-ruled natural choice), keeping one pinned scale in (0, 1).
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

  const PINNED: { seed: string; scale: number; events: number; final: string; hash: string }[] = [
    { seed: 'f3pin-1', scale: 0.37, events: 1153, final: '87-139', hash: '2d6d23f7' },
    { seed: 'f3pin-2', scale: 0.37, events: 1216, final: '107-109', hash: '96158e1d' },
    { seed: 'f3pin-3', scale: 0.37, events: 1299, final: '103-131', hash: '3375979e' },
    { seed: 'f3pin-4', scale: 0.37, events: 1194, final: '113-109', hash: '3d417fbd' },
    { seed: 'f3pin-1', scale: 1, events: 1181, final: '120-112', hash: 'b6e0f3c4' },
    { seed: 'f3pin-2', scale: 1, events: 1252, final: '132-114', hash: 'f64bbff8' }
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
