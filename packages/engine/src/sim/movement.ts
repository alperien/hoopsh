/**
 * Physical integration: per-tick position/velocity updates with soft
 * collision avoidance, fatigue drain/recovery, and the game clock advance.
 *
 * These three functions are the lowest layer of the tick pipeline — called
 * from every phase handler (`tickLive` in game.ts, `tickDead`/`tickScramble`
 * in possession.ts, `tickFreeThrows` in fouls.ts) since players keep moving
 * and getting tired regardless of what phase the game is in. `advanceClock`
 * is the ONLY place `s.t` changes — see docs/INTERNALS.md's two-time-axes
 * note (`t` stops at whistles, `wallT` never does; this file owns `t`).
 * `s.clock` is shared ownership: it normally moves here, but `endPeriod`
 * (possession.ts) zeroes it at the horn and resets it for the next period.
 */

import { clamp } from '../core/rng.js';
import { add, clampRect, dist, len, norm, scale, sub, type V2 } from '../core/vec.js';
import { acceleration } from '../model/derived.js';
import type { TeamSide } from '../core/events.js';
import { onCourt, type Agent, type GameState } from './state.js';
import { moveSpeed } from './ai.js';

/**
 * Advance game-clock time (`s.t`, `s.clock`) by `dt` seconds and accrue
 * on-court minutes. Called once per tick from every phase handler that
 * should burn game clock (live play, made-basket dead time, free-throw
 * rebounds) — phases that stop the clock (most dead balls, free-throw
 * attempts themselves) simply don't call this.
 */
export function advanceClock(s: GameState, dt: number): void {
  // game-clock time (t, seconds) never runs past the horn — a legal
  // buzzer-beater may still be airborne (that lives on the wall clock),
  // but the period contributes at most its scheduled seconds to t.
  // Keeps team minutes summing to exactly 5 × game length.
  const effective = Math.min(dt, Math.max(0, s.clock));
  s.clock -= dt;
  if (effective <= 0) return;
  s.t += effective;
  for (const side of [0, 1] as TeamSide[]) {
    for (const a of onCourt(s, side)) a.secondsPlayed += effective;
  }
}

/**
 * Steering-based physical integration for every on-court player: accelerate
 * toward `a.target` at each agent's rating-derived acceleration cap, clamp
 * to a rating-derived top speed, then resolve overlaps with soft mutual
 * push-apart. Called once per tick from every phase handler regardless of
 * game phase (dead-ball freezes and scrambles still need bodies to walk to
 * their targets and not stack on top of each other).
 */
export function integrateMovement(s: GameState, dt: number): void {
  const agentsOnCourt: Agent[] = [];
  for (const side of [0, 1] as TeamSide[]) {
    for (const a of onCourt(s, side)) agentsOnCourt.push(a);
  }

  for (const a of agentsOnCourt) {
    const sp = moveSpeed(s, a);
    const toTarget = sub(a.target, a.pos);
    const d = len(toTarget);
    // 0.25ft arrival threshold: close enough to call it "there" and stop,
    // rather than have the agent jitter forever chasing the last fraction of
    // an inch (a numerical-stability floor, not a basketball fact)
    const desired = d < 0.25
      ? { x: 0, y: 0 }
      : // don't overshoot a near target: cap desired speed at (d / dt) * 0.85
        // (85% of the speed that would land exactly on the target this tick)
        // so the agent decelerates into short hops instead of oscillating
        // past them every frame
        scale(norm(toTarget), Math.min(sp, (d / dt) * 0.85));
    const acc = acceleration(a.p.attr); // rating-derived ft/s^2 cap (model/derived.ts)
    const dv = sub(desired, a.vel);
    const dvl = len(dv);
    const maxDelta = acc * dt;
    // if the full velocity change fits within this tick's acceleration
    // budget, snap straight to the desired velocity; otherwise step toward
    // it by the max allowed delta (this is what makes accel a real physical
    // limit instead of instant velocity changes)
    a.vel = dvl <= maxDelta ? desired : add(a.vel, scale(norm(dv), maxDelta));
    // 0.5ft margin: keep a player's position point a half-foot inside the
    // physical sideline/baseline rather than letting it sit exactly on the
    // boundary line — nobody's centerpoint should coincide with the paint stripe
    a.pos = clampRect(add(a.pos, scale(a.vel, dt)), s.court.length, s.court.width, 0.5);
  }

  // soft collision avoidance: two agents closer than avoidRadiusFt get pushed
  // directly apart, splitting the overlap 50/50 so neither player "wins" the
  // spot. Body separation is BEHAVIORAL, not cosmetic: the resolved
  // positions feed rebound contests, shot contests, and passing lanes
  // downstream, so who ends the tick cleanly spaced shows up in the box
  // score (#126 measured it).
  //
  // Order independence (#142): every pairwise displacement is computed from
  // the same pre-pass snapshot, accumulated per agent, and applied once
  // (Jacobi-style). The previous loop resolved pairs sequentially in place —
  // agentsOnCourt is built side 0 first, so side-0 teammate pairs resolved
  // first and side-1 teammate pairs last, and the last-resolved pairs ended
  // each tick exactly separated while earlier pairs could be re-overlapped
  // by later resolutions. That spacing subsidy for slot 1 was worth ~+1.4
  // margin and ~+4.5pp win% per game to the away roster (#126: reversing
  // the build order flipped home win% 45.50 -> 54.50 at n=800, an exact
  // mirror — larger than the shipped home-court dial's whole effect). With
  // accumulation there is no resolution sequence, so no slot is privileged.
  // An isolated overlapping pair (the common case) gets arithmetic
  // identical to the sequential loop's; only multi-contact clusters
  // (rebound scrums, screens) resolve differently.
  const R = s.params.move.avoidRadiusFt;
  // a live poster DISPLACES opponents rather than splitting the separation:
  // post play is legal contact, and the symmetric 50/50 split let the man
  // guarding the block stall the walk-down and backdown indefinitely
  // (fidelity incident: self-posts never arrived; backdowns carved ~1 ft of
  // the designed ~3). Who gets to lean is already strength-gated upstream —
  // actionTick's poster score carries strength/finishing.
  const act = s.poss.action;
  const posterId = act && act.kind === 'post' ? act.posterId : null;
  const lean = s.params.move.postLeanShare;
  // accumulated push per agent (indexed like agentsOnCourt); null = no
  // contact this tick, position untouched by the collision pass
  const push: (V2 | null)[] = new Array(agentsOnCourt.length).fill(null);
  for (let i = 0; i < agentsOnCourt.length; i++) {
    for (let j = i + 1; j < agentsOnCourt.length; j++) {
      const a = agentsOnCourt[i]!;
      const b = agentsOnCourt[j]!;
      const d = dist(a.pos, b.pos);
      if (d < R && d > 1e-6) {
        // split the overlap between the two — 50/50 normally, lean-weighted
        // against an OPPONENT of the live poster (teammates still split even)
        let aShare = 0.5;
        if (posterId === a.p.id && b.side !== a.side) aShare = 1 - lean;
        else if (posterId === b.p.id && a.side !== b.side) aShare = lean;
        const overlap = R - d;
        const dir = norm(sub(a.pos, b.pos));
        push[i] = add(push[i] ?? { x: 0, y: 0 }, scale(dir, overlap * aShare));
        push[j] = sub(push[j] ?? { x: 0, y: 0 }, scale(dir, overlap * (1 - aShare)));
      }
    }
  }
  for (let i = 0; i < agentsOnCourt.length; i++) {
    const p = push[i];
    if (!p) continue;
    const a = agentsOnCourt[i]!;
    a.pos = clampRect(add(a.pos, p), s.court.length, s.court.width, 0.5);
  }
}

/**
 * Drain energy for on-court players (more when sprinting, moderated by
 * stamina rating) and recover it for players resting on the bench. Called
 * once per tick from every phase handler alongside `integrateMovement` —
 * fatigue accrues continuously, not just during live offense/defense.
 */
export function applyFatigue(s: GameState, dt: number): void {
  const F = s.params.fatigue;
  for (const [, a] of s.agents) {
    // a fouled-out player ON THE FLOOR (bench exhausted — subs.ts
    // replaceFouledOut's play-on edge) is playing real minutes and tires
    // like anyone else; the old blanket skip froze his energy mid-game
    // (audit L-06). A fouled-out player on the BENCH can never return, so
    // his recovery stays skipped — the value is read by nothing (kept
    // byte-identical for the common case).
    if (a.fouledOut && !a.onCourt) continue;
    if (a.onCourt) {
      // 28 ft/s ≈ elite NBA sprint speed (see sprintSpeed in model/derived.ts,
      // capped at 28 for a 100-speed player) — speedShare is "how close to
      // max effort is this player moving right now," used to scale drain up
      // when sprinting vs. jogging/standing
      const speedShare = len(a.vel) / 28;
      // stamina rating scales drain: 50 is neutral, 100 drains a quarter
      // slower (×0.75), 0 a quarter faster (×1.25) — iron-man profiles play
      // longer stints
      const staminaMult = 1.25 - (a.p.attr.stamina / 100) * 0.5;
      const drain = F.drainPerSec * (1 + speedShare * F.sprintDrainMult) * staminaMult * dt;
      a.energy = clamp(a.energy - drain, 0, 100);
      // Cumulative load (fdesign-rhythm M1, live at loadPerSec 0.011 since
      // the FLOW flip; at 0 load provably stays 0): heavy legs accrue on
      // the same effort/stamina
      // chain as energy, but recover an order of magnitude slower below.
      // That asymmetry is what makes load trend across a game while energy
      // sawtooths per stint. See state.ts Agent.load for the consumer map.
      a.load = clamp(a.load + F.loadPerSec * (1 + speedShare * F.sprintDrainMult) * staminaMult * dt, 0, 100);
    } else {
      a.energy = clamp(a.energy + F.recoverPerSecBench * dt, 0, 100);
      // a bench sit takes only a sliver off the legs (a 4-min sit ≈ 5 pts):
      // within a half, load is close to monotone
      a.load = clamp(a.load - F.loadRecoverPerSecBench * dt, 0, 100);
    }
  }
}

/**
 * Resolution-side energy: raw energy minus cumulative load ("a tired body
 * with heavy legs"). The consumers are the resolution models (resolve.ts's
 * shot-fatigue term and currentMaxSpeed), wired per ffit-rhythm §8 and
 * live at fatigue.loadPerSec 0.011 since the FLOW flip (at 0 load stays 0
 * and this equals
 * raw energy exactly). Subs/rotation never read this (M1 contract: rotation
 * cadence belongs to raw energy).
 */
export function effectiveEnergy(a: Agent): number {
  return clamp(a.energy - a.load, 0, 100);
}
