/**
 * #86 increment 2 — the strong putback (possession.ts tickScramble putback
 * branch + startShot carryRim): a gate-clearing rebounder who secures the
 * board inside the restricted area (the rim zone's 4 ft bracket) resolves
 * the automatic putback as a rim-plane throw-down — the release moves to
 * the plane (the #74 construction reused), the make logit gains
 * shot.putbackStrongLogit ON TOP of movePutback, and dunk-class booking
 * follows from the booth's own rule with the tip-in outranked
 * (narration shotcall.ts; dunkgate-sync pins the gate pair). The class
 * adds NO rng draws at any knob value — it moves the make threshold,
 * never the draw count — so knob 0 is byte-identical by construction and
 * both ends of the dial are draw-free.
 *
 * Pinned here (the transcarry.test.ts shape, its registered sibling):
 *   1. Determinism at the flip: same seed, same logit, identical streams.
 *   2. The dial is live: staged vs flipped streams diverge on the pool.
 *   3. The mechanism, stream-side: rim-plane putback releases (distFt
 *      exactly 0 — the plane is booked AT the rim) rise POOLED under the
 *      flip, with a vacuity floor on the staged arm's putback volume so
 *      the premise cannot be empty. Pooled aggregates only — per-seed
 *      inequalities on diverged trajectories are seed lottery.
 *   4. The stage-switch ceiling: the staged arm shows (near-)zero plane
 *      putbacks — a mutant that drops the putbackStrongLogit > 0
 *      short-circuit fires the class at knob 0 (the geometry moves even
 *      with a zero logit) and fails HERE.
 *   5. The rate guard: pooled putback ATTEMPTS are flat between arms in
 *      BOTH directions — this increment changes how a secured putback
 *      RESOLVES, never how often one happens (reb.putbackChance /
 *      putbackRadiusFt untouched; crash/positioning untouched, #86 gates).
 *   6. F2 (below): the gate itself, condition by condition, on
 *      hand-built states — stage switch, restricted-area read, athlete
 *      gate, blend weights. Stream-side tests cannot see these.
 *   7. The off-switch byte pin (below): one staged-arm game pinned by
 *      exact stream checksum — explicit logit 0 must keep reproducing the
 *      pre-flip stream after the landing flips the default.
 *
 * DENOMINATOR CONVENTION (the W82/F4 rule): scout counts on the
 * putbackstrong-1..24 pool are raw sums over 24 single games with BOTH
 * TEAMS POOLED — a "per 24" rate is per TEAM-GAME (one game contributes
 * two team-games); state the convention wherever these figures are quoted.
 *
 * Scouted at the staged landing (pool putbackstrong-1..24, raw pooled
 * sums): staged arm 306 putback attempts, 0 plane releases, 152 made;
 * flipped arm (logit 1) 305 attempts, 33 plane releases; 18/24 seeds
 * diverged. Floors sit well clear on both sides (vacuity >= 150 vs 306;
 * plane rise >= +20 vs +33; stage ceiling <= 2 vs 0; attempt drift
 * <= 31 vs 1 measured). Re-anchor: re-run the scout, same safety shape
 * as the transcarry row.
 */
import { describe, expect, it } from 'vitest';
import {
  NBA, makeCourt, simulateGame, withParams, type GameResult
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { putbackResolvesStrong } from '../src/sim/possession.js';
import { type Agent, type GameState } from '../src/sim/state.js';

const POOL = Array.from({ length: 24 }, (_, i) => `putbackstrong-${i + 1}`);

/** in-suite A/B dose: the top of the plausible logit range for maximal
 *  divergence signal (the landing dose is selected against the bands and
 *  pinned separately below) */
const TEST_LOGIT = 1;

const game = (seed: string, logit: number, frames = false): GameResult => {
  const { home, away } = sampleMatchup();
  return simulateGame({
    // the engine's frame switch is collectFrames, default ON (GameConfig has
    // no "frames" field) — only the off-switch byte pin reads r.frames, so
    // the pooled arms opt out per the suite's pooled-run convention
    seed, home, away, collectFrames: frames,
    params: { shot: { putbackStrongLogit: logit } }
  });
};

const putbacks = (rs: GameResult[]): { att: number; plane: number } => {
  let att = 0, plane = 0;
  for (const r of rs) {
    for (const e of r.events) {
      if (e.type !== 'shot' || e.moveType !== 'putback') continue;
      att++;
      // the strong signature: the release is booked AT the rim — distFt
      // is exactly 0 by construction (startShot releasePos = rim)
      if (e.distFt === 0) plane++;
    }
  }
  return { att, plane };
};

describe('the strong putback (#86, possession.ts putback branch)', () => {
  const staged = POOL.map((s) => game(s, 0));
  const live = POOL.map((s) => game(s, TEST_LOGIT));

  it('is deterministic at the flip: same seed, same logit, identical streams', () => {
    const again = game(POOL[0]!, TEST_LOGIT);
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(live[0]!.events));
  });

  it('the dial is live: staged and flipped streams diverge on the pool', () => {
    let diverged = 0;
    for (let i = 0; i < POOL.length; i++) {
      if (JSON.stringify(staged[i]!.events) !== JSON.stringify(live[i]!.events)) diverged++;
    }
    // scouted 18/24 — the class fires roughly every other game, so a
    // handful of games sharing a stream is expected, zero is a dead dial
    expect(diverged).toBeGreaterThan(0);
  });

  it('the mechanism: pooled rim-plane putback releases rise under the flip', () => {
    const sp = putbacks(staged);
    const lp = putbacks(live);
    // vacuity floor: the premise (putbacks exist to resolve) cannot be
    // empty — scouted 306 staged attempts on this pool
    expect(sp.att).toBeGreaterThanOrEqual(150);
    // the mechanism: scouted +33 pooled; floor at +20 survives rng
    // reshuffles while a deleted class (0 rise) fails loudly
    expect(lp.plane).toBeGreaterThanOrEqual(sp.plane + 20);
  });

  it('the stage-switch ceiling: knob 0 fires nothing (short-circuit FIRST)', () => {
    const sp = putbacks(staged);
    // scouted 0; a natural sub-0.05 ft grab can round to a 0.0 booking in
    // principle, so the ceiling leaves 2 of slack rather than pinning 0 —
    // the short-circuit-deletion mutant fires the class's GEOMETRY at
    // knob 0 (the logit adds nothing but the release still moves) and
    // lands ~30 plane releases here
    expect(sp.plane).toBeLessThanOrEqual(2);
  });

  it('the rate guard: putback attempt volume is flat between arms, both directions', () => {
    const sp = putbacks(staged);
    const lp = putbacks(live);
    // the class changes resolution, never rate: putbackChance and the
    // radius are untouched, the draw order is untouched, so pooled drift
    // is stream lottery only (scouted |305 - 306| = 1; bar at 31 ~ 10%)
    expect(Math.abs(lp.att - sp.att)).toBeLessThanOrEqual(31);
  });
});

// ------------------------------------------------------------------ F2 pins

/**
 * The gate, condition by condition, on hand-built states (the
 * carriesToRim/F2 shape): stream-side tests cannot distinguish WHICH
 * condition admitted a strong putback, so each pin flips exactly one.
 *
 * The stub builds only what the predicate reads: params, rules, court,
 * period (attackedRim), and the rebounder's side/pos/attributes. Values
 * pin the shipped defaults on purpose: the restricted-area cases sit
 * either side of the rim zone's 4 ft bracket (court.ts classifyShot),
 * and the athlete cases sit at and just under ai.dunkAthleteGate = 74
 * with the 0.6/0.4 blend (the booth mirror — dunkgate-sync.test.ts pins
 * the pair from the narration side).
 */
describe('F2: the strong-putback gate, condition by condition (hand-built states)', () => {
  interface GateOpts {
    logit?: number;      // shot.putbackStrongLogit, default 1
    rimFt?: number;      // rebounder's distance from the attacked rim, default 2
    vertical?: number;   // default: exactly at the gate
    finishing?: number;  // default: exactly at the gate
  }

  function gateCase(o: GateOpts = {}): boolean {
    const params = withParams({ shot: { putbackStrongLogit: o.logit ?? 1 } });
    const court = makeCourt(NBA);
    const s = { params, rules: NBA, court, period: 2 } as unknown as GameState;
    const gate = params.ai.dunkAthleteGate;
    // side 0 attacks the high-x rim in the first half (period 2 of 4):
    // place the rebounder straight up the floor from that rim
    const rim = court.rims[1];
    const rebounder = {
      side: 0,
      pos: { x: rim.x - (o.rimFt ?? 2), y: rim.y },
      p: { attr: { vertical: o.vertical ?? gate, finishing: o.finishing ?? gate } }
    } as unknown as Agent;
    return putbackResolvesStrong(s, rebounder);
  }

  it('resolves strong when every gate holds: live knob, restricted area, athlete gate', () => {
    expect(gateCase()).toBe(true);
  });

  it('the STAGE switch: logit 0 never resolves strong (checked FIRST)', () => {
    expect(gateCase({ logit: 0 })).toBe(false);
  });

  it('the RESTRICTED-AREA gate: outside the rim zone bracket never resolves strong', () => {
    expect(gateCase({ rimFt: 3.9 })).toBe(true);
    // 4.5 ft: INSIDE reb.putbackRadiusFt (6 — the automatic putback still
    // rolls) but outside the restricted area — the tap stays generic
    expect(gateCase({ rimFt: 4.5 })).toBe(false);
    expect(gateCase({ rimFt: 5.9 })).toBe(false);
  });

  it('the ATHLETE gate: under the booth mirror never resolves strong', () => {
    expect(gateCase({ vertical: 72, finishing: 72 })).toBe(false);
  });

  it('the BLEND weights are the booth\'s 0.6/0.4: a vertical-heavy body clears', () => {
    // 0.6·84 + 0.4·60 = 74.4 >= 74 clears only under the 0.6/0.4 blend
    // (a 0.5/0.5 blend reads 72 and would refuse) — the engine half of the
    // dunkgate-sync mirror case
    expect(gateCase({ vertical: 84, finishing: 60 })).toBe(true);
    expect(gateCase({ vertical: 60, finishing: 84 })).toBe(false);
  });
});

// --------------------------------------------------------- off-switch pin

/**
 * The off-switch byte pin: one staged-arm game recorded by exact stream
 * checksum at the staged landing. After the landing flips the default,
 * an explicit logit 0 override must keep reproducing THIS stream — the
 * off-switch is exact, byte for byte (the #74/leakout staged-zero
 * contract). Re-anchor doctrine: a LEGITIMATE stream reorder (another
 * landing's rng reshuffle) re-runs this file and copies the printed
 * actuals in, saying so in the commit — a re-anchor forced by a change
 * to THIS mechanism's off-path is the contract violation the pin exists
 * to catch.
 */
describe('the off-switch pin (explicit logit 0 reproduces the staged stream)', () => {
  function fnv1a(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  it('putbackstrong-1 at logit 0: the recorded stream, exactly', () => {
    // Re-anchored at the #115 landing, both layers: the layer A
    // acquisition stamp + stage-12 holder re-read moved events and
    // frames; the layer B dead-phase relay moved frames ONLY (event
    // count and final match the layer-A-only bake exactly — the
    // frames-only contract, the #119 precedent). Legitimate stream
    // reorders per this block's doctrine, causes stated in the landing
    // commits.
    const r = game('putbackstrong-1', 0, true);
    const last = r.events[r.events.length - 1]!;
    expect(r.events.length).toBe(1235);
    expect(`${last.score[0]}-${last.score[1]}`).toBe('114-113');
    expect(fnv1a(JSON.stringify({ e: r.events, f: r.frames }))).toBe('f5ebe149');
  });
});

// ------------------------------------------------- landed-default pin

/**
 * The landing existence pin: the SHIPPED default fires. Every stream-side
 * arm above pins the dial through explicit overrides, so none of them
 * would notice a reverted default — the provenance serialization pin
 * would, but from the params surface, not the mechanism. This pool runs
 * DEFAULT params (the landing dose, shot.putbackStrongLogit 0.3 — the
 * n=96 paired ladder's selection against the astd window, see
 * params.shot.ts) and requires the class to exist on the shipped engine
 * end to end. Scouted at the landing: putbackstrong-1..8 at default read
 * 107 putback attempts, 11 plane releases (11 made — the class converts
 * around 80% at the landing dose, so a small pool running the table is a
 * normal draw). The plane floor at 3 survives rng reshuffles (the class
 * fires ~0.8/game); a reverted or dead default reads 0 and fails HERE.
 */
describe('the landed default fires (#86 landing, default params)', () => {
  it('a default-params pool shows rim-plane putbacks', () => {
    const { home, away } = sampleMatchup();
    let att = 0, plane = 0;
    for (let i = 1; i <= 8; i++) {
      const r = simulateGame({ seed: `putbackstrong-${i}`, home, away });
      for (const e of r.events) {
        if (e.type !== 'shot' || e.moveType !== 'putback') continue;
        att++;
        if (e.distFt === 0) plane++;
      }
    }
    // vacuity floor first: the premise (putbacks exist) cannot be empty
    expect(att).toBeGreaterThanOrEqual(50);
    expect(plane).toBeGreaterThanOrEqual(3);
  });
});
