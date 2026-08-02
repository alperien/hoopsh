/**
 * Cross-cutting AI queries and locomotion policy — the pieces every other
 * ai/ module (and several sim modules) lean on. Keep this file small: it
 * exists to break what would otherwise be import cycles between the
 * decision, action, offense, and defense layers.
 */

import { dist, lerp, segmentT, type V2 } from '../../core/vec.js';
import { clamp } from '../../core/rng.js';
import { lateralSpeed } from '../../model/derived.js';
import { liveOnCourt, other, type Agent, type GameState } from '../state.js';
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

/**
 * Mid-range green light ∈ [0,1] — the shared identity gate for the drilled
 * in-between game. One definition read by BOTH the mid-range decisiveness
 * term (concepts.ts — taking the shot) and the PnR short-pop routing
 * (actions.ts — being sent to the spot), so "who has a middy" never
 * disagrees between demand and supply.
 *
 * Floor at tendency 25, mirroring the three-point green-light gates: below
 * it a player has no drilled mid game AT ALL and the gate is exactly zero —
 * a rim-runner's open 16-footer is a win for the defense (the same logic
 * zoneSkill's paint blend already encodes), so no amount of openness may
 * talk him into it. Full green light at 75 rather than 100 because mid
 * diets run structurally lower than three diets on the modern tendency
 * scale — a true mid-range artist fits at shotMid ~55-70 — so normalizing
 * to 100 would leave the gate permanently half-throttled for exactly the
 * identities it exists to serve.
 */
export function midGreenLight(a: Agent): number {
  return clamp((a.p.tend.shotMid - 25) / 50, 0, 1);
}

/**
 * The PULL-UP half of the mid green light: joint gate over the mid appetite
 * and the off-dribble appetite, as a geometric mean — both are REQUIRED
 * (either at/below its floor vetoes the light entirely: a post big with no
 * dribble game never snakes, a pull-up three hunter with no mid appetite
 * never stops short), but multiplying two sub-1 gates would double-count
 * moderation (a 44-shotMid/68-pullUp microwave scorer fell to a 0.33 light
 * and never fired; the mean keeps him at 0.57). One definition read by the
 * mid-range decisiveness term (concepts.ts — taking the pull-up) and the
 * drive stop-short (game.ts — attacking TO the pull-up spot), so the player
 * who snakes to the elbow and the player who rises once there are always
 * the same player.
 */
export function midPullUpLight(a: Agent): number {
  return Math.sqrt(midGreenLight(a) * clamp((a.p.tend.pullUp - 25) / 50, 0, 1));
}

/** the defender ASSIGNED to this player (falls back to nearest on-ball man) */
export function assignedDefender(s: GameState, man: Agent): Agent | null {
  for (const d of liveOnCourt(s, other(man.side))) {
    // Assignment leash (params.ai.assignLeashFt): a defender whose man is
    // within the leash counts as "assigned" to that man and is returned
    // directly — distinct from onBallRadiusFt (which gates who counts as
    // "on the ball" for reach-in/help purposes).
    if (d.manId === man.p.id && dist(d.pos, man.pos) < s.params.ai.assignLeashFt) return d;
  }
  return onBallDefender(s, man);
}

export function onBallDefender(s: GameState, holder: Agent): Agent | null {
  let best: Agent | null = null;
  let bestD = Infinity;
  for (const d of liveOnCourt(s, other(holder.side))) {
    const dd = dist(d.pos, holder.pos);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  // onBallRadiusFt cutoff: past that nobody is meaningfully "on the ball"
  return best && bestD < s.params.ai.onBallRadiusFt ? best : null;
}

/**
 * How crowded the drive lane is: a soft count of defenders sitting between the
 * handler and the rim. Feeds both the projected contest on a drive and a
 * direct utility penalty — this is what makes a packed paint deter drives and
 * (via the kickout branch) makes help defense produce open shooters.
 *
 * along ∈ (laneAlongMin, laneAlongMax): ignore defenders standing on top of
 * the handler (that's the on-ball matchup, handled separately) and those
 * already under the rim. (`along` is segmentT's parametric position on the
 * handler→rim segment — geometry, NOT the game clock.) lat < laneWidthFt:
 * within a body's width of the driving line, weighted linearly. All three
 * constants live in params.ai.lane*.
 */
export function defendersInLane(s: GameState, h: Agent, rim: V2): number {
  const A = s.params.ai;
  let count = 0;
  for (const d of liveOnCourt(s, other(h.side))) {
    const along = segmentT(h.pos, rim, d.pos);
    if (along > A.laneAlongMin && along < A.laneAlongMax) {
      const lat = dist(d.pos, lerp(h.pos, rim, along));
      if (lat < A.laneWidthFt) count += 1 - lat / A.laneWidthFt;
    }
  }
  return count;
}

/** movement speed for an agent given intent & fatigue */
export function moveSpeed(s: GameState, a: Agent): number {
  const max = currentMaxSpeed(s, a);
  if (a.intent === 'defend') {
    // in his stance a defender SHUFFLES (stanceSpeedMult); sprints
    // (defSprintMult) belong to closeouts, help rotations, and blitzes.
    // Capped by LATERAL speed, which is why quick-footed guards contain
    // drives better than fast straight-line runners.
    const lat = lateralSpeed(a.p.attr)
      * (a.sprinting ? s.params.move.defSprintMult : s.params.move.stanceSpeedMult);
    return Math.min(max, lat);
  }
  // Offense: sprint only when the situation demands it (transition, cuts,
  // crashes). Off-ball spacing moves are WALKED (offBallWalkMult) — a spot
  // is held, not chased; the ball-holder keeps the faster cruise.
  const offBall = a.p.id !== s.ball.holderId;
  const M = s.params.move;
  const mult = a.sprinting ? 1
    : offBall && a.intent === 'spot' ? M.offBallWalkMult
    : a.intent === 'advance' ? M.advanceJogMult   // the bring-up is a jog
    : a.intent === 'getback' ? M.getbackJogMult   // the retreat is a jog
    : a.intent === 'crash' ? M.crashWorkMult      // boxout work, not a dash
    : M.halfcourtSpeedMult;
  return max * mult;
}
