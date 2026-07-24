/**
 * Passing: launching a pass (with pre-rolled turnover/steal risk), resolving
 * its arrival, and the reach-in steal/foul check on the current ball holder.
 */

import { clamp } from '../core/rng.js';
import { add, dist, lerp, scale } from '../core/vec.js';
import { agent, emit, other, type Agent, type GameState } from './state.js';
import { n } from '../model/derived.js';
import { onBallDefender } from './ai.js';
import { passRisk } from './resolve.js';
import { deadBall, endPeriod, endPossession, giveBall, startPossession } from './possession.js';
import { enterFreeThrows, recordFoul } from './fouls.js';

export function startPass(
  s: GameState,
  from: Agent,
  toId: string,
  passKind: 'normal' | 'kickout' | 'outlet' | 'entry'
): void {
  const to = agent(s, toId);
  const risk = passRisk(s, from, to);
  const fails = s.rng.chance(risk.turnoverP);
  const lead = add(to.pos, scale(to.vel, 0.25));
  const target = fails
    ? lerp(from.pos, lead, s.rng.range(0.35, 0.7))
    : lead;
  const d = Math.max(3, dist(from.pos, target));
  const time = d / s.params.pass.speedFtS;
  s.ball.holderId = null;
  s.ball.flight = {
    kind: 'pass',
    from: { ...from.pos },
    to: target,
    total: time,
    remaining: time,
    passFrom: from.p.id,
    passTo: toId,
    passKind,
    passFail: fails
      ? { stolenBy: s.rng.chance(s.params.pass.stealShare) ? risk.dangerId : null }
      : undefined
  };
}

export function resolvePassArrival(s: GameState): void {
  const f = s.ball.flight;
  if (!f || f.kind !== 'pass') return;
  const from = f.passFrom!;
  const passer = agent(s, from);
  s.ball.flight = null;

  if (f.passFail) {
    const stolenBy = f.passFail.stolenBy;
    if (stolenBy) {
      const thief = agent(s, stolenBy);
      emit(s, {
        type: 'turnover', team: passer.side, player: from,
        kind: 'bad_pass', stolenBy
      });
      endPossession(s, 'turnover');
      startPossession(s, thief.side, 'steal', thief);
      thief.pos = { ...s.ball.pos };
    } else {
      emit(s, {
        type: 'turnover', team: passer.side, player: from, kind: 'out_of_bounds'
      });
      endPossession(s, 'turnover');
      deadBall(s, other(passer.side), { clockRuns: false });
    }
    return;
  }

  const to = agent(s, f.passTo!);
  emit(s, {
    type: 'pass', team: passer.side, from, to: to.p.id, kind: f.passKind ?? 'normal'
  });
  s.poss.lastPass = { from, t: s.t };
  giveBall(s, to);
  // a catch after the buzzer is a dead play — the ball must be shot before 0.0
  // (passes in flight while the clock expires were scoring post-buzzer baskets)
  if (s.clock < 1e-6) { endPeriod(s); return; }
  s.decisionAt = s.t + 0.12; // quick trigger: catch-and-shoot window
}

// ---------------------------------------------------------------- reach-in

export function attemptReachIn(s: GameState, dt: number): void {
  const holderId = s.ball.holderId;
  if (!holderId) return;
  const h = agent(s, holderId);
  const d = onBallDefender(s, h);
  if (!d || dist(d.pos, h.pos) > 4.2) return;
  const F = s.params.foul;
  const p = F.reachInPerSec * dt * (1 + 0.85 * n(d.p.tend.gambleSteal));
  if (!s.rng.chance(p)) return;

  const stripP = clamp(0.3 + 0.3 * n(d.p.attr.steal) - 0.22 * n(h.p.attr.ballHandle), 0.08, 0.7);
  if (s.rng.chance(stripP)) {
    emit(s, {
      type: 'turnover', team: h.side, player: h.p.id, kind: 'lost_ball', stolenBy: d.p.id
    });
    endPossession(s, 'turnover');
    startPossession(s, d.side, 'steal', d);
  } else {
    const { inBonus } = recordFoul(s, d, 'reach', h);
    if (inBonus) {
      enterFreeThrows(s, h, s.rules.bonusFreeThrows);
    } else {
      // side out, same possession, shot-clock floor
      s.poss.shotClock = Math.max(s.poss.shotClock, 14);
      deadBall(s, h.side, { clockRuns: false, continuation: true, resumeIn: 1.2 });
    }
  }
}
