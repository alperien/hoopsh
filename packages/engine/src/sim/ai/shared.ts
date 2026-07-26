/**
 * Cross-cutting AI queries and locomotion policy — the pieces every other
 * ai/ module (and several sim modules) lean on. Keep this file small: it
 * exists to break what would otherwise be import cycles between the
 * decision, action, offense, and defense layers.
 */

import { dist } from '../../core/vec.js';
import { lateralSpeed } from '../../model/derived.js';
import { onCourt, other, type Agent, type GameState } from '../state.js';
import { currentMaxSpeed } from '../resolve.js';

/**
 * Creation score — THE usage-hierarchy definition. Used by both ball routing
 * (decideBall's re-initiation pull) and action initiation (actionTick's rank
 * gate), one definition so "who should run the offense" never disagrees
 * between deciding to pass and deciding to call a screen.
 */
export function creation(a: Agent): number {
  return (a.p.attr.ballHandle + a.p.attr.passVision) / 2;
}

/** the defender ASSIGNED to this player (falls back to nearest on-ball man) */
export function assignedDefender(s: GameState, man: Agent): Agent | null {
  for (const d of onCourt(s, other(man.side))) {
    // Assignment leash (params.ai.assignLeashFt): a defender whose man is
    // within the leash counts as "assigned" to that man and is returned
    // directly — distinct from onBallRadiusFt (which gates who counts as
    // "on the ball" for reach-in/help purposes).
    if (!d.fouledOut && d.manId === man.p.id && dist(d.pos, man.pos) < s.params.ai.assignLeashFt) return d;
  }
  return onBallDefender(s, man);
}

export function onBallDefender(s: GameState, holder: Agent): Agent | null {
  let best: Agent | null = null;
  let bestD = Infinity;
  for (const d of onCourt(s, other(holder.side))) {
    if (d.fouledOut) continue;
    const dd = dist(d.pos, holder.pos);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  // onBallRadiusFt cutoff: past that nobody is meaningfully "on the ball"
  return best && bestD < s.params.ai.onBallRadiusFt ? best : null;
}

/** movement speed for an agent given intent & fatigue */
export function moveSpeed(s: GameState, a: Agent): number {
  const max = currentMaxSpeed(s, a);
  if (a.intent === 'defend') {
    // in his stance a defender SHUFFLES (stanceSpeedMult); sprints (1.15x)
    // belong to closeouts, help rotations, and blitzes. Capped by LATERAL
    // speed, which is why quick-footed guards contain drives better than
    // fast straight-line runners.
    const lat = lateralSpeed(a.p.attr) * (a.sprinting ? 1.15 : s.params.move.stanceSpeedMult);
    return Math.min(max, lat);
  }
  // Offense: sprint only when the situation demands it (transition, cuts,
  // crashes). Off-ball spacing moves are WALKED (offBallWalkMult) — a spot
  // is held, not chased; the ball-holder keeps the faster cruise.
  const offBall = a.p.id !== s.ball.holderId;
  const mult = a.sprinting ? 1
    : offBall && a.intent === 'spot' ? s.params.move.offBallWalkMult
    : a.intent === 'advance' ? s.params.move.advanceJogMult // the bring-up is a jog
    : s.params.move.halfcourtSpeedMult;
  return max * mult;
}
