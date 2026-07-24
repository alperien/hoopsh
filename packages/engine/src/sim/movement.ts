/**
 * Physical integration: per-tick position/velocity updates with soft
 * collision avoidance, fatigue drain/recovery, and the game clock advance.
 */

import { clamp } from '../core/rng.js';
import { add, clampRect, dist, len, norm, scale, sub } from '../core/vec.js';
import { acceleration } from '../model/derived.js';
import type { TeamSide } from '../core/events.js';
import { onCourt, type Agent, type GameState } from './state.js';
import { moveSpeed } from './ai.js';

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

export function integrateMovement(s: GameState, dt: number): void {
  const agentsOnCourt: Agent[] = [];
  for (const side of [0, 1] as TeamSide[]) {
    for (const a of onCourt(s, side)) agentsOnCourt.push(a);
  }

  for (const a of agentsOnCourt) {
    const sp = moveSpeed(s, a);
    const toTarget = sub(a.target, a.pos);
    const d = len(toTarget);
    const desired = d < 0.25
      ? { x: 0, y: 0 }
      : scale(norm(toTarget), Math.min(sp, (d / dt) * 0.85));
    const acc = acceleration(a.p.attr);
    const dv = sub(desired, a.vel);
    const dvl = len(dv);
    const maxDelta = acc * dt;
    a.vel = dvl <= maxDelta ? desired : add(a.vel, scale(norm(dv), maxDelta));
    a.pos = clampRect(add(a.pos, scale(a.vel, dt)), s.court.length, s.court.width, 0.5);
  }

  // soft collision avoidance
  const R = s.params.move.avoidRadiusFt;
  for (let i = 0; i < agentsOnCourt.length; i++) {
    for (let j = i + 1; j < agentsOnCourt.length; j++) {
      const a = agentsOnCourt[i]!;
      const b = agentsOnCourt[j]!;
      const d = dist(a.pos, b.pos);
      if (d < R && d > 1e-6) {
        const push = scale(norm(sub(a.pos, b.pos)), (R - d) * 0.5);
        a.pos = clampRect(add(a.pos, push), s.court.length, s.court.width, 0.5);
        b.pos = clampRect(sub(b.pos, push), s.court.length, s.court.width, 0.5);
      }
    }
  }
}

export function applyFatigue(s: GameState, dt: number): void {
  const F = s.params.fatigue;
  for (const [, a] of s.agents) {
    if (a.fouledOut) continue;
    if (a.onCourt) {
      const speedShare = len(a.vel) / 28;
      const drain = F.drainPerSec * (1 + speedShare * F.sprintDrainMult) * dt;
      a.energy = clamp(a.energy - drain, 0, 100);
    } else {
      a.energy = clamp(a.energy + F.recoverPerSecBench * dt, 0, 100);
    }
  }
}
