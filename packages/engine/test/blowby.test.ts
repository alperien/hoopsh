/**
 * #114 — the halfcourt blow-by carry (game.ts executeAction shoot branch
 * + startShot carryRim): on a halfcourt possession where the handler has
 * WON the matchup — on-ball man beaten by ai.blowByBeatenFt of rim
 * distance or absent entirely, lane crowd under ai.blowByLaneMax, body
 * inside ai.blowByGatherFt of the rim — a committed drive finish CARRIES
 * to a rim-plane release by construction, exactly the #74 transition
 * carry one phase over. Same decides, same 'drive' label, same windup
 * race, same make model, same booth booking rule; only the release
 * geometry moves. The gate (game.ts blowsByToRim) is OR-ed with
 * carriesToRim into the SAME carryRim construction: one mechanism, two
 * phase-disjoint gates.
 *
 * Pinned here (the transcarry.test.ts shape, its registered sibling):
 *   1. Determinism at the flip: same seed, same scale, identical streams
 *      (the gate is rng-free; the arming draw short-circuits at 0 and 1).
 *   2. The dial is live: staged vs flipped streams diverge on the pool.
 *   3. The mechanism, stream-side: rim-plane drive releases (distFt <=
 *      PLANE_FT, moveType 'drive') on inbound/tip-kind possessions rise
 *      POOLED under the flip, with a vacuity floor on the staged arm's
 *      inbound/tip drive volume so the premise cannot be empty. The
 *      inbound/tip bucket is the PURE slice: those possessions never
 *      enter transition phase (possession.ts stamps them 'advance'), so
 *      carriesToRim can never fire on them and every plane rise there is
 *      the blow-by's. Pooled aggregates only — per-seed inequalities on
 *      diverged trajectories are seed lottery.
 *   4. NO kind-scoped guard exists for this mechanism, by design: kind
 *      is not phase. live_rebound/steal-KIND possessions own halfcourt
 *      TAILS (the defense sets, the phase flips) and legitimately host
 *      blow-bys there — the scout sees their plane count rise too. The
 *      scope pin is the PHASE gate in F2 below, exactly the lesson the
 *      transcarry F2 header records: phase is not in the event stream,
 *      so no stream-side test can pin it.
 *   5. F2 (below): the gate itself, condition by condition, on
 *      hand-built states — stage, arming, label, commit, phase, the
 *      beaten read (both clauses: the behindFt margin and the no-man
 *      branch), the lane read, and the reach gate.
 *
 * DENOMINATOR CONVENTION (probe F4, Lead-ruled): scout counts on the
 * blowby-1..24 pool are raw sums over 24 single games with BOTH TEAMS
 * POOLED — a per-team-game rate divides by 48.
 *
 * Scouted at the staged mechanism (pool blowby-1..24, this file's
 * signature definitions): staged arm 9 plane drive releases on
 * inbound/tip-kind possessions over 212 such drive attempts; flipped
 * arm 87 plane (+78); streams diverged 24/24. (Transition-KIND plane
 * count 80 staged -> 131 flipped — the halfcourt-tail hosting of note 4
 * plus downstream reshuffle; informational, not pinned.) Floors sit
 * well under the scout: vacuity >= 60 vs 212; margin >= +35 vs +78.
 * Re-anchor: re-run the scout, same safety shape as the transcarry row.
 */
import { describe, expect, it } from 'vitest';
import {
  NBA, makeCourt, simulateGame, withParams,
  type GameEvent, type GameResult, type ShotMoveType
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { blowsByToRim } from '../src/sim/game.js';
import { attackedRim, type Agent, type GameState } from '../src/sim/state.js';

/** the booth's book boundary (narration shotcall.ts DUNK_MAX_FT — real
 *  dunks live at 0-2 ft); inlined the same way transcarry.test.ts and
 *  leakout.test.ts inline it */
const PLANE_FT = 2.25;

const POOL = Array.from({ length: 24 }, (_, i) => `blowby-${i + 1}`);

const game = (seed: string, scale: number): GameResult => {
  const { home, away } = sampleMatchup();
  return simulateGame({ seed, home, away, params: { ai: { blowByCarryScale: scale } } });
};

/** blow-by signature counts: drive-labeled releases at/inside the booth's
 *  dunk range on possessions whose START kind can never see transition
 *  phase (inbound/tip — the pure halfcourt slice), plus the staged
 *  premise volume (any-distance drive attempts on those kinds) for the
 *  vacuity floor */
function signatures(g: GameResult): { plane: number; hcDrives: number } {
  let plane = 0;
  let hcDrives = 0;
  let possKind = '';
  for (const e of g.events as GameEvent[]) {
    if (e.type === 'possession_start') { possKind = e.kind; continue; }
    if (e.type !== 'shot' || e.moveType !== 'drive') continue;
    if (possKind === 'live_rebound' || possKind === 'steal') continue;
    hcDrives += 1;
    if (e.distFt <= PLANE_FT) plane += 1;
  }
  return { plane, hcDrives };
}

describe('the halfcourt blow-by (#114, game.ts shoot branch)', () => {
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

  it('rim-plane drive releases rise pooled on inbound/tip-kind possessions', () => {
    let stagedPlane = 0;
    let livePlane = 0;
    let stagedHcDrives = 0;
    for (const g of staged) {
      const sig = signatures(g);
      stagedPlane += sig.plane;
      stagedHcDrives += sig.hcDrives;
    }
    for (const g of live) livePlane += signatures(g).plane;
    // vacuity floor: the premise (committed drives on inbound/tip-kind
    // possessions) must exist on the STAGED arm, or the rise is measuring
    // an empty slice
    expect(stagedHcDrives).toBeGreaterThanOrEqual(60);
    // the mechanism: pooled plane releases rise under the flip, and every
    // one of them is the blow-by's (note 3: these kinds never enter
    // transition phase, so the sibling carry cannot contribute)
    expect(livePlane).toBeGreaterThanOrEqual(stagedPlane + 35);
  });
});

// ------------------------------------------------------------------ F2 pins

/**
 * F2 (the transcarry.test.ts seam shape, Lead-approved in the #114
 * phase-1 checkpoint): the gate, condition by condition, on hand-built
 * states. Phase is not in the event stream and the pooled pins above
 * bucket by possession START kind, so a within-possession gate
 * regression — the phase mutant that leaks blow-bys into transition,
 * the commit mutant that binds nowhere — is invisible to every
 * stream-side test in this file. These cases drive the extracted
 * predicate (game.ts blowsByToRim) directly, one condition at a time.
 * Every gate-condition mutant was re-applied by hand and verified RED
 * against these pins before landing — the mutation-shields.test.ts
 * doctrine.
 *
 * The stub builds only what the predicate reads: params, court, the
 * defenders' lineup side (onBallDefender scans within ai.onBallRadiusFt
 * = 12 ft of the holder; defendersInLane scans the holder->rim segment
 * against the ai.lane* window), poss blowByArmed/phase, the clock, and
 * the holder's pos/driveUntil. Values pin the shipped defaults on
 * purpose: beaten boundary cases sit 0.1 ft either side of
 * ai.blowByBeatenFt = 2.0 (the man placed colinear behind the handler,
 * so behindFt is exact), lane boundary cases put one helper at along
 * 0.75 with lateral offsets whose soft-count weights (1 - lat/5) land
 * either side of ai.blowByLaneMax = 0.5, and reach cases sit 0.1 ft
 * either side of ai.blowByGatherFt = 4.5.
 */
describe('F2: the blow-by gate, condition by condition (hand-built states)', () => {
  interface GateOpts {
    scale?: number;                          // ai.blowByCarryScale, default 1
    armed?: boolean;                         // poss.blowByArmed, default true
    moveType?: ShotMoveType;                 // default 'drive'
    commitLeft?: number;                     // driveUntil - t, default +1 (live)
    phase?: 'halfcourt' | 'transition' | 'advance';
    holderFt?: number;                       // decide-time body-to-rim ft, default 2
    /** the on-ball man's trail, ft of rim distance behind the handler
     *  (colinear placement: behindFt is exactly this value). null parks
     *  the nearest defender at 13 ft — outside onBallRadiusFt, the
     *  no-man branch. default 3 (beaten by a full step). */
    manBehindFt?: number | null;
    /** a help defender at along 0.75 of the handler->rim segment with
     *  this lateral offset, ft — soft-count weight 1 - lat/5. Absent =
     *  empty lane. Use with holderFt 4.4 so the helper stays farther
     *  from the holder than the on-ball man (the finder must keep
     *  returning the man). */
    helperLaneLat?: number;
  }

  function gateCase(o: GateOpts = {}): boolean {
    const params = withParams({ ai: { blowByCarryScale: o.scale ?? 1 } });
    const court = makeCourt(NBA);
    const t = 100; // mid-Q2, any live moment: the predicate reads no clock but t itself
    const agents = new Map<string, Agent>();
    const lineup: [string[], string[]] = [[], []];
    const s = {
      params, rules: NBA, court, period: 2, t, agents, lineup,
      poss: { blowByArmed: o.armed ?? true, phase: o.phase ?? 'halfcourt' }
    } as unknown as GameState;
    const rim = attackedRim(s, 0);
    const inward = rim.x > court.midX ? -1 : 1; // toward midcourt
    const holderFt = o.holderFt ?? 2;
    const holderPos = { x: rim.x + inward * holderFt, y: rim.y };
    // the on-ball man: colinear behind the handler (away from the rim),
    // so dist(man, rim) - dist(holder, rim) === manBehindFt exactly and
    // segmentT places him outside the lane window (behind the segment)
    const manBehindFt = o.manBehindFt === undefined ? 3 : o.manBehindFt;
    const defs: { x: number; y: number }[] = [];
    defs.push(
      manBehindFt === null
        ? { x: rim.x + inward * (holderFt + 13), y: rim.y } // outside onBallRadiusFt 12
        : { x: rim.x + inward * (holderFt + manBehindFt), y: rim.y }
    );
    // the lane helper: along 0.75 of holder->rim (inside the (0.15, 0.95)
    // window), offset laterally so the soft count reads 1 - lat/5
    if (o.helperLaneLat !== undefined) {
      defs.push({ x: rim.x + inward * (holderFt * 0.25), y: rim.y + o.helperLaneLat });
    }
    // park the rest beyond every radius the predicate reads
    while (defs.length < 5) {
      defs.push({ x: rim.x + inward * 55, y: rim.y - 4 + defs.length * 2 });
    }
    for (let i = 0; i < 5; i++) {
      agents.set(`d-${i}`, {
        pos: defs[i]!,
        onCourt: true, fouledOut: false
      } as unknown as Agent);
      lineup[1].push(`d-${i}`);
    }
    const h = {
      side: 0,
      pos: holderPos,
      driveUntil: t + (o.commitLeft ?? 1)
    } as unknown as Agent;
    return blowsByToRim(s, h, o.moveType ?? 'drive');
  }

  it('blows by when every gate holds: halfcourt, armed, drive, live commit, beaten, empty lane, in reach', () => {
    expect(gateCase()).toBe(true);
  });

  it('the STAGE switch: scale 0 never blows by, armed or not', () => {
    expect(gateCase({ scale: 0 })).toBe(false);
  });

  it('the ARMING gate: an unarmed possession never blows by at any live scale', () => {
    expect(gateCase({ armed: false })).toBe(false);
    expect(gateCase({ armed: false, scale: 0.5 })).toBe(false);
  });

  it('the LABEL gate: only drive finishes blow by', () => {
    expect(gateCase({ moveType: 'pull_up' })).toBe(false);
    expect(gateCase({ moveType: 'catch_shoot' })).toBe(false);
    expect(gateCase({ moveType: 'putback' })).toBe(false);
  });

  it('the COMMIT gate: an expired driveUntil never blows by', () => {
    expect(gateCase({ commitLeft: -0.1 })).toBe(false);
    expect(gateCase({ commitLeft: 0 })).toBe(false); // strict <: expiry is exclusive
  });

  it('the PHASE gate: transition and advance phases never blow by — the sibling disjointness', () => {
    // the halfcourt cell belongs to this gate, the transition cell to
    // carriesToRim; phase is one enum cell, so at most one can fire
    expect(gateCase({ phase: 'transition' })).toBe(false);
    expect(gateCase({ phase: 'advance' })).toBe(false);
  });

  it('the BEATEN margin: behindFt either side of ai.blowByBeatenFt = 2.0', () => {
    expect(gateCase({ manBehindFt: 1.9 })).toBe(false); // contested edge — no carry
    expect(gateCase({ manBehindFt: 2.1 })).toBe(true);  // the edge is won
  });

  it('the BEATEN no-man branch: nobody within onBallRadiusFt is a won matchup', () => {
    expect(gateCase({ manBehindFt: null })).toBe(true);
  });

  it('the LANE gate: one helper\'s soft-count weight either side of ai.blowByLaneMax = 0.5', () => {
    // lat 2.4 -> weight 0.52 (help has committed: the gate dies, the
    // kick-out valuation takes over); lat 2.6 -> weight 0.48 (not yet)
    expect(gateCase({ holderFt: 4.4, helperLaneLat: 2.4 })).toBe(false);
    expect(gateCase({ holderFt: 4.4, helperLaneLat: 2.6 })).toBe(true);
  });

  it('the REACH gate: the blow-by\'s own bound, not driveShotRangeFt', () => {
    expect(gateCase({ holderFt: 4.4 })).toBe(true);
    expect(gateCase({ holderFt: 4.6 })).toBe(false); // in (gather 4.5, label 12): the #75-F1 tail class
    expect(gateCase({ holderFt: 10 })).toBe(false);  // the teleport class, unreachable by construction
  });
});

// ------------------------------------------------------------------ F3 pins

/**
 * F3 (the transcarry.test.ts F3 shape): the arming-draw region, pinned.
 * Every pooled case above runs at the dial ends (0 and 1), both
 * draw-free by the heave-guard shape — so the per-possession arming
 * DRAW is live exactly where nothing looked, and the landing dose sits
 * there. The blow-by's arming has NO kind scope (it arms on every start
 * kind, by design), so the transcarry kind-scope mutant has no sibling
 * here; its two live arming mutants are pinned elsewhere and here:
 * dropping the scale-0 guard (`blowByScale > 0 &&`) draws on every
 * possession at the staged default and breaks the hard-zero contract —
 * caught RED by the golden fingerprint corpus (verified before
 * landing); dropping the draw-free short-circuit (`blowByScale >= 1 ||
 * chance` -> `chance`) adds one draw per possession at scale 1 and
 * shifts every scale-1 stream — caught RED by the scale-1 rows below
 * (verified before landing, the mutation-shields doctrine).
 *
 * The pins are exact stream checksums — event count, final score, and
 * FNV-1a over JSON.stringify({e: events, f: frames}) with frames on
 * (the transcarry hashing convention; frames included so the shared
 * carry ball path stays pinned from this file too). RE-ANCHOR: any
 * commit that legitimately reorders these streams (a landed draw
 * upstream, a movement change) re-runs this file and copies the
 * printed actuals in, saying so in the commit — the goldens doctrine.
 * The intermediate scale IS the landing dose (0.5), per the transcarry
 * F3 ruling — one pinned scale in (0, 1), anchored where the shipped
 * default actually lives.
 */
describe('F3: the arming-draw region is pinned (landing dose + draw-free top)', () => {
  const fnv1a = (str: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  };

  const PINNED: { seed: string; scale: number; events: number; final: string; hash: string }[] = [
    { seed: 'bb3pin-1', scale: 0.5, events: 1245, final: '105-120', hash: '8e49bed6' },
    { seed: 'bb3pin-2', scale: 0.5, events: 1190, final: '116-113', hash: '8cd9f0ed' },
    { seed: 'bb3pin-3', scale: 0.5, events: 1177, final: '121-120', hash: '938b498a' },
    { seed: 'bb3pin-4', scale: 0.5, events: 1234, final: '110-115', hash: 'b27285d7' },
    { seed: 'bb3pin-1', scale: 1, events: 1195, final: '120-106', hash: '6f9a636c' },
    { seed: 'bb3pin-2', scale: 1, events: 1275, final: '126-133', hash: '0f56bbc9' }
  ];

  for (const pin of PINNED) {
    it(`${pin.seed} at scale ${pin.scale} streams exactly the baked checksum`, () => {
      const { home, away } = sampleMatchup();
      const r = simulateGame({
        seed: pin.seed, home, away, collectFrames: true,
        params: { ai: { blowByCarryScale: pin.scale } }
      });
      const last = r.events[r.events.length - 1]!;
      expect(r.events.length).toBe(pin.events);
      expect(`${last.score[0]}-${last.score[1]}`).toBe(pin.final);
      expect(fnv1a(JSON.stringify({ e: r.events, f: r.frames }))).toBe(pin.hash);
    });
  }
});

// ------------------------------------------------- landed-default pin

/**
 * The landing existence pin (the putbackstrong.test.ts shape): the
 * SHIPPED default fires. Every stream-side arm above pins the dial
 * through explicit overrides, so none of them would notice a reverted
 * default — the provenance serialization pin would, but from the params
 * surface, not the mechanism. This pool runs DEFAULT params (the landing
 * dose, ai.blowByCarryScale 0.5 — the dose ladder's selection, see
 * params.ai.ts) and requires the class to exist on the shipped engine
 * end to end. Scouted at the landing: blowbydef-1..8 at default read 9
 * plane drive releases on inbound/tip-kind possessions over 63 such
 * drive attempts (the staged organic rate on the blowby-1..24 pool was
 * 9 over 24 games — a third of this pool's per-game rate). The floor at
 * 3 survives rng reshuffles; a zero would mean the shipped default no
 * longer fires. Re-anchor: re-run the scout, same safety shape.
 */
describe('the landed default fires (shipped-params existence pin)', () => {
  it('plane drive releases exist on inbound/tip-kind possessions at default params', () => {
    let plane = 0;
    for (let i = 1; i <= 8; i++) {
      const { home, away } = sampleMatchup();
      const r = simulateGame({ seed: `blowbydef-${i}`, home, away, collectFrames: false });
      const sig = signatures(r);
      plane += sig.plane;
    }
    expect(plane).toBeGreaterThanOrEqual(3);
  });
});
