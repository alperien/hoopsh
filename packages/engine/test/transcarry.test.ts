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
  NBA, Rng, makeCourt, makePlayer, makeTactics, simulateGame, withParams,
  type GameEvent, type GameResult, type ShotMoveType, type Team
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { carriesToRim } from '../src/sim/game.js';
import { startPossession } from '../src/sim/possession.js';
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

  // Re-anchored at the #142 collision-order landing: the order-independent
  // push-apart resolves every multi-contact tick differently, so events
  // AND frames move on every stream at every scale. All seven rows
  // re-baked per this block's doctrine. On the new streams f3pin-1's
  // arming draws land identically at 0.25 and 0.5 (the coincidence class
  // bb3pin-2 showed at the #114 landing — whose own 0.25/0.5 coincidence
  // RESOLVED on these same streams, not a copy error either time); the
  // 0.25 row's inversion kill was re-verified RED by hand at this bake
  // (inverted chance(1 - scale) read 1242/120-113/56393375 against the
  // clean 1223 row below), per the #127 rider and the mutation-shields
  // doctrine.
  const PINNED: { seed: string; scale: number; events: number; final: string; hash: string }[] = [
    { seed: 'f3pin-1', scale: 0.25, events: 1223, final: '125-115', hash: 'c6b77ab0' },
    { seed: 'f3pin-1', scale: 0.5, events: 1223, final: '125-115', hash: 'c6b77ab0' },
    { seed: 'f3pin-2', scale: 0.5, events: 1300, final: '114-118', hash: '00abda0b' },
    { seed: 'f3pin-3', scale: 0.5, events: 1163, final: '140-110', hash: '08f98802' },
    { seed: 'f3pin-4', scale: 0.5, events: 1228, final: '108-121', hash: 'abd7554d' },
    { seed: 'f3pin-1', scale: 1, events: 1290, final: '144-123', hash: 'b618e07e' },
    { seed: 'f3pin-2', scale: 1, events: 1259, final: '129-138', hash: '8f46ecd2' }
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

// --------------------------------------------------- scale-0 off-switch pins

/**
 * #139: the hard-zero contract, pinned explicitly at the retired default —
 * the #138 blow-by pin's transition twin (filed from the #132 re-review:
 * transCarryScale ships 0.5 with the same staged-guard shape and the same
 * retired corpus shield). The arming draw's scale guard (`carryScale > 0
 * &&`, possession.ts startPossession) is what makes scale 0 draw-free and
 * byte-identical — the #74 staged-zero contract. The golden corpus covered
 * it only while the shipped default was 0; the #74 dose landing moved the
 * default to 0.5, so no corpus config reaches the guard's false arm any
 * more, and the #132 review demonstrated the class on the blow-by: guard
 * dropped, full suite and corpus all green. The F2 STAGE row above does
 * not cover this site — it pins the GATE's own scale read (game.ts
 * carriesToRim), a separate check the drive branch makes at decide time,
 * and it never runs startPossession at all. Two layers re-cover the OFF
 * direction at the draw:
 *
 *  1. Baked stream checksums at scale 0 (the F3 shape, frames on, same
 *     RE-ANCHOR doctrine). No live two-arm comparison can own this pin:
 *     chance(0) consumes one float and never arms, so a dropped guard
 *     shifts every scale-0 stream UNIFORMLY — any two in-engine configs
 *     with scale <= 0 stay pairwise identical under the mutant, and only
 *     a fixture baked from the guarded engine can witness the shift.
 *  2. A draw-count property at the arming site, which survives re-anchors:
 *     on identical hand-built states, startPossession consumes IDENTICAL
 *     draws at scale 0 and scale 1 (both draw-free by the guard shape, so
 *     the two runs' rng streams never diverge at all) and exactly one more
 *     at the landing dose. The guard-drop breaks the equality from the 0
 *     side; dropping the >= 1 short-circuit breaks it from the 1 side.
 *
 * The isolation is the #138 shape derived for the carry's kind scope. The
 * blow-by pin starts an 'inbound' possession and lets the kind scope strip
 * the leak and carry draws away (the blow-by arms on every start kind);
 * the carry's draw exists ONLY on live_rebound/steal starts, so this
 * fixture starts a 'live_rebound' possession and switches the other
 * scale-sensitive sites on that path off through their own documented
 * off-arms instead: ai.leakOutScale 0 and ai.blowByCarryScale 0 (the same
 * heave-guard shape — 0 never reaches either draw), and
 * endgame.toLiveSiteOn 0 (the live-ball timeout site at the
 * startPossession tail runs only on live_rebound/steal starts and its
 * coach-hazard evaluation ends in a real chance() at the shipped fits; 0
 * is that site's own staging off-path, returning before the draw). What
 * remains scale-sensitive is exactly one draw — the carry's, rolled after
 * the dead leak site and before the dead blow-by site, ahead of
 * assignSpots' fixed-count jitter (rollSpots' header documents the fixed
 * consumption) — so the +1 offset at the landing dose is exact.
 *
 * Both layers were verified RED under the hand-applied guard-drop before
 * landing — the test's own params patch supplies scale 0, no defaults
 * edited — and the interior-dose stream DIRECTION beside these rows is
 * #127's concern, already owned by the f3pin-1@0.25 row above. The
 * mutation-shields doctrine.
 */

type ParamOverrides = Parameters<typeof withParams>[0];

/** count raw uniform draws at the source: every Rng distribution helper
 *  funnels through float() — the blowby.test.ts #131 counting shape */
function countDraws(rng: Rng): { n: number } {
  const counter = { n: 0 };
  const raw = rng.float.bind(rng);
  (rng as unknown as { float: () => number }).float = () => {
    counter.n += 1;
    return raw();
  };
  return counter;
}

/**
 * A mid-Q2 game state one call away from a fresh possession — the
 * blowby.test.ts mkLifecycleState shape (typed full literals: CI types
 * tracks every field), trimmed to this file's one consumer: the #139
 * off-switch pin calls the real startPossession on it (replacing poss)
 * to count the arming site's draws. 5v5 real default players so
 * assignSpots/assignMatchups/bestHandler read honest lineups.
 */
function mkOffSwitchState(seed: string, params: ParamOverrides): GameState {
  const P = withParams(params);
  const court = makeCourt(NBA);
  const mk = (id: string) => makePlayer({ id, name: id, pos: 'SF', heightIn: 78 });
  const off = [mk('off-1'), mk('off-2'), mk('off-3'), mk('off-4'), mk('off-5')];
  const def = [mk('def-1'), mk('def-2'), mk('def-3'), mk('def-4'), mk('def-5')];
  const teamOf = (id: string, players: ReturnType<typeof mk>[]): Team => ({
    id, name: id, abbrev: id.slice(0, 3).toUpperCase(),
    players, starters: players.map((p) => p.id), tactics: makeTactics()
  });
  const agents = new Map<string, Agent>();
  const addAgent = (p: ReturnType<typeof mk>, side: 0 | 1): void => {
    agents.set(p.id, {
      p, side,
      pos: { x: court.midX, y: court.centerY },
      vel: { x: 0, y: 0 },
      energy: 100, load: 0, secondsPlayed: 0, fouls: 0, onCourt: true, fouledOut: false,
      lastSwapT: 0,
      target: { x: court.midX, y: court.centerY },
      intent: 'spot', sprinting: false, spotKey: null, manId: null,
      dribblesSinceCatch: 0, dribbleAcc: 0,
      catchT: -99, acquiredBy: 'deadball',
      catchQuality: P.shot.passQualityCenter,
      usedPoss: 0, teamPossOnCourt: 0,
      driveUntil: -99, cutUntil: -99, relocUntil: -99,
      screenStunUntil: -99, navUnderUntil: -99
    });
  };
  off.forEach((p) => addAgent(p, 0));
  def.forEach((p) => addAgent(p, 1));
  return {
    rng: new Rng(seed), params: P, rules: NBA, court,
    teams: [teamOf('tc-off', off), teamOf('tc-def', def)],
    agents,
    lineup: [off.map((p) => p.id), def.map((p) => p.id)],
    ball: { holderId: null, pos: { x: court.midX, y: court.centerY }, flight: null },
    // mid-Q2, clock-consistent: 320s of Q2 elapsed, wallT ahead of t by
    // earlier stoppage time (two-axes discipline)
    period: 2, clock: 400, t: 1040, wallT: 1250,
    score: [40, 38],
    teamFoulsPeriod: [0, 0], teamFoulsLate: [0, 0], tipWinner: 0,
    endgame: true, timeoutsLeft: [7, 7], runPts: [0, 0],
    timeoutsThisPeriod: [0, 0], timeoutsUsedFinalPeriod: [0, 0],
    timeoutsUsedFinalLate: [0, 0], lastTimeoutT: [-99, -99],
    conceded: [false, false],
    // a placeholder trip: the pin below calls the real startPossession on
    // this state, which replaces this whole object before anything reads it
    poss: {
      team: 0, shotClock: 14, phase: 'advance', startT: 1035, kind: 'inbound',
      leakArmed: false, carryArmed: false, blowByArmed: false,
      opener: false,
      lastPass: null, spotMap: new Map(), spots: new Map(), action: null, ended: false
    },
    phase: { kind: 'live' },
    events: [], frames: [], collectFrames: false,
    decisionAt: 0, pendingRelease: null, over: false
  };
}

describe('the scale-0 off-switch (#139): the hard-zero contract at the retired default', () => {
  // the F3 hashing convention, duplicated locally so the F3 block above
  // stays untouched (stacked test-only diffs stay additive — the #138 shape)
  const fnv1a = (str: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  };

  // Re-anchored at the #142 collision-order landing (a legitimate scale-0
  // stream reorder, the uniform-shift class this block's own doctrine
  // anticipates: the movement reshuffle is scale-blind — a scale-0 game
  // holds multi-contact scrums like any other, so events and frames both
  // move on every stream). Both rows re-baked; the #139/#156 draw-count
  // property below held unchanged through the landing, as it must.
  const PINNED: { seed: string; events: number; final: string; hash: string }[] = [
    { seed: 'tc0pin-1', events: 1232, final: '96-129', hash: '5f2b5a05' },
    { seed: 'tc0pin-2', events: 1241, final: '105-102', hash: '976e89c1' }
  ];

  for (const pin of PINNED) {
    it(`${pin.seed} at scale 0 streams exactly the baked checksum`, () => {
      const { home, away } = sampleMatchup();
      const r = simulateGame({
        seed: pin.seed, home, away, collectFrames: true,
        params: { ai: { transCarryScale: 0 } }
      });
      const last = r.events[r.events.length - 1]!;
      expect(r.events.length).toBe(pin.events);
      expect(`${last.score[0]}-${last.score[1]}`).toBe(pin.final);
      expect(fnv1a(JSON.stringify({ e: r.events, f: r.frames }))).toBe(pin.hash);
    });
  }

  it('the arming site is draw-free at both ends and draws exactly once at the landing dose', () => {
    const run = (scale: number): { n: number; armed: boolean } => {
      const s = mkOffSwitchState('tc-off-switch', {
        // the isolation patch (block comment above): the sibling arming
        // sites off through their own hard-zero arms, the live-timeout
        // site through its staging dial — the carry's draw is the only
        // scale-sensitive one left on a live_rebound start
        ai: { transCarryScale: scale, leakOutScale: 0, blowByCarryScale: 0 },
        endgame: { toLiveSiteOn: 0 }
      });
      const counter = countDraws(s.rng);
      startPossession(s, 0, 'live_rebound');
      return { n: counter.n, armed: s.poss.carryArmed };
    };
    const at0 = run(0);
    const at1 = run(1);
    const at05 = run(0.5);
    // the off-switch equality: 0 and 1 are both draw-free by the guard
    // shape, so their whole startPossession draw sequences are identical.
    // A dropped scale guard consumes chance(0) and breaks this from the 0
    // side; a dropped >= 1 short-circuit breaks it from the 1 side
    expect(at0.n).toBe(at1.n);
    // the landing dose draws exactly the one arming chance() more: the
    // draw precedes assignSpots' fixed-count jitter (rollSpots' header
    // documents the fixed consumption), so the offset is exact
    expect(at05.n).toBe(at0.n + 1);
    // and the arming semantics at the ends: 0 is OFF, 1 always arms on
    // the carry's own kind scope
    expect(at0.armed).toBe(false);
    expect(at1.armed).toBe(true);
  });
});
