/**
 * Physical integration: per-tick position/velocity updates with soft
 * collision avoidance, fatigue drain/recovery, and the game clock advance.
 *
 * These three functions are the lowest layer of the tick pipeline — called
 * from every phase handler (`tickLive` in game.ts, `tickDead`/`tickScramble`
 * in possession.ts, `tickFreeThrows` in fouls.ts) since players keep moving
 * and getting tired regardless of what phase the game is in. `advanceClock`
 * is the ONLY place `s.clock`/`s.t` change — see docs/INTERNALS.md's two-
 * time-axes note (`t` stops at whistles, `wallT` never does; this file owns `t`).
 */

import { clamp } from '../core/rng.js';
import { add, clampRect, dist, len, norm, scale, sub } from '../core/vec.js';
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
  // game-clock time (t, minutes) never runs past the horn — a legal
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
  // spot — this is cosmetic body-separation, not a basketball rule (no
  // fouls/possession changes result from it, it just stops players
  // visually overlapping in the replay)
  const R = s.params.move.avoidRadiusFt;
  for (let i = 0; i < agentsOnCourt.length; i++) {
    for (let j = i + 1; j < agentsOnCourt.length; j++) {
      const a = agentsOnCourt[i]!;
      const b = agentsOnCourt[j]!;
      const d = dist(a.pos, b.pos);
      if (d < R && d > 1e-6) {
        // push each agent half the overlap distance ((R - d) * 0.5) directly
        // away from the other, along the line between them
        const push = scale(norm(sub(a.pos, b.pos)), (R - d) * 0.5);
        a.pos = clampRect(add(a.pos, push), s.court.length, s.court.width, 0.5);
        b.pos = clampRect(sub(b.pos, push), s.court.length, s.court.width, 0.5);
      }
    }
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
    if (a.fouledOut) continue;
    if (a.onCourt) {
      // 28 ft/s ≈ elite NBA sprint speed (see sprintSpeed in model/derived.ts,
      // capped at 28 for a 100-speed player) — speedShare is "how close to
      // max effort is this player moving right now," used to scale drain up
      // when sprinting vs. jogging/standing
      const speedShare = len(a.vel) / 28;
      // stamina rating scales drain: 50 is neutral, 100 drains half again
      // slower, 0 half again faster — iron-man profiles play longer stints
      const staminaMult = 1.25 - (a.p.attr.stamina / 100) * 0.5;
      const drain = F.drainPerSec * (1 + speedShare * F.sprintDrainMult) * staminaMult * dt;
      a.energy = clamp(a.energy - drain, 0, 100);
    } else {
      a.energy = clamp(a.energy + F.recoverPerSecBench * dt, 0, 100);
    }
  }
}
