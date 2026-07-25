/**
 * Passing: launching a pass (with pre-rolled turnover/steal risk), resolving
 * its arrival, and the reach-in steal/foul check on the current ball holder.
 *
 * `startPass` is called from the AI's ball-handler decision (`ai.ts`,
 * `executeAction`) whenever it picks one of the pass options; the flight
 * itself is advanced tick-by-tick by `game.ts`'s live tick, which calls
 * `resolvePassArrival` once `remaining` counts down to zero. `attemptReachIn`
 * is polled every live tick independent of passing — it's the on-ball
 * defender's steal/foul pressure on whoever currently holds the ball.
 */

import { clamp } from '../core/rng.js';
import { add, dist, lerp, scale } from '../core/vec.js';
import { agent, attackedRim, emit, onCourt, other, type Agent, type GameState } from './state.js';
import { n } from '../model/derived.js';
import { assignedDefender, onBallDefender } from './ai.js';
import { passRisk } from './resolve.js';
import { deadBall, endPeriod, endPossession, giveBall, startPossession } from './possession.js';
import { enterFreeThrows, recordFoul } from './fouls.js';

/**
 * Launch a pass from `from` to the player `toId`. The turnover/steal outcome
 * is decided HERE, at launch (via `passRisk`), not on arrival — `resolvePassArrival`
 * just plays out whatever was pre-rolled into `passFail`. This matters for
 * determinism/ordering: the ball's mid-air path can visually differ (an
 * off-target lead toward a defender) depending on whether the pass was
 * doomed from the start, so the fail/success branch has to be chosen before
 * the flight's `to` target is even computed.
 */
export function startPass(
  s: GameState,
  from: Agent,
  toId: string,
  passKind: 'normal' | 'kickout' | 'outlet' | 'entry'
): void {
  const to = agent(s, toId);
  const risk = passRisk(s, from, to);
  const fails = s.rng.chance(risk.turnoverP);
  // lead the receiver by a quarter-second of his current velocity — a pass
  // thrown to where a moving teammate WILL be, not where he currently stands
  // (scale 0.25 ~= "lead like you'd expect a decent passer to", not a
  // real reaction-time constant)
  const lead = add(to.pos, scale(to.vel, 0.25));
  // a failing pass doesn't necessarily go somewhere absurd — it's undercooked,
  // landing somewhere between the passer and the intended target (35-70% of
  // the way there) rather than reaching the receiver; this is what puts it in
  // a defender's range without teleporting the ball to him
  const target = fails
    ? lerp(from.pos, lead, s.rng.range(0.35, 0.7))
    : lead;
  // floor the flight distance at 3ft so a point-blank pass still takes a
  // nonzero tick or two to "arrive" instead of resolving instantly
  const d = Math.max(3, dist(from.pos, target));
  const time = d / s.params.pass.speedFtS; // speedFtS is a flat ball speed (SimParams), not player-dependent
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
    // stealShare: of all failed passes, this fraction become a live steal
    // (credited to the most dangerous lane defender from passRisk); the rest
    // sail out of bounds untouched — both are "bad passes" but only one
    // creates a live-ball turnover for the defense to run with
    passFail: fails
      ? { stolenBy: s.rng.chance(s.params.pass.stealShare) ? risk.dangerId : null }
      : undefined
  };
}

/**
 * Resolve a pass once its flight timer reaches zero. Dispatched from
 * `game.ts`'s live tick when `s.ball.flight.remaining <= 0` and
 * `flight.kind === 'pass'`. Branches three ways: a clean catch (hands the
 * ball to the receiver and opens a quick decision window), a steal (new
 * possession for the thief), or an out-of-bounds turnover (dead ball, other
 * team inbounds). The steal/OOB outcome itself was already decided back in
 * `startPass` — this function just acts on `f.passFail`.
 */
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
      // the BALL snaps to the thief (a deflection), never the player to the
      // ball — teleporting bodies breaks the replay's physical continuity
      s.ball.pos = { x: thief.pos.x, y: thief.pos.y };
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
  s.poss.lastPass = { from, t: s.t }; // feeds assist-window checks in shooting.ts (catch-to-shot timing)
  // a handoff catch stuns the receiver's trailing defender — the hub's body
  // is the screen. This is the whole payoff of the DHO action: the receiver
  // rises into a catch-and-shoot with the contest wiped, or attacks downhill.
  const act = s.poss.action;
  if (f.passKind === 'handoff' && act?.kind === 'dho' && to.p.id === act.receiverId) {
    const trail = assignedDefender(s, to);
    if (trail) trail.screenStunUntil = s.t + s.params.ai.dhoStunSec;
    // ...and the receiver TURNS THE CORNER: a drive commitment off the catch
    // (his man is screened behind him — the whole point). Inside the arc the
    // downhill attack is the play; at the arc the catch-and-shoot machinery
    // competes naturally. Without this, receivers caught, reset, and the
    // action produced 0.1 assists a game on 8.9 handoffs.
    const rim = attackedRim(s, to.side);
    if (dist(to.pos, rim) < 22) {
      // inside the arc: turn the corner downhill
      to.driveUntil = s.t + 1.35; // same commitment as executeAction's drive
    }
    // at/beyond the arc: no commitment — the catch-and-shoot machinery owns
    // the rise (a drive grant there sprinted the receiver INTO the defense
    // and swallowed the open three the stun had just bought)
    s.poss.action = null; // the action delivered; normal offense resumes
  }
  giveBall(s, to);
  // a catch after the buzzer is a dead play — the ball must be shot before 0.0
  // (passes in flight while the clock expires were scoring post-buzzer baskets)
  if (s.clock < 1e-6) { endPeriod(s); return; }
  // 0.12s: deliberately much faster than the ~0.25-0.35s decision delays used
  // elsewhere (new possession, post-rebound) — this is the catch-and-shoot
  // trigger window, modeling a shooter who catches and fires almost
  // immediately rather than resetting and re-evaluating the whole possession
  s.decisionAt = s.t + 0.12;
}

// ---------------------------------------------------------------- reach-in

/**
 * Per-tick pressure check on whoever currently holds the ball, from his
 * primary defender. Polled every live tick from `game.ts` regardless of what
 * else is happening (dribbling, deciding, mid-drive) — this is what produces
 * on-ball steals and reach-in fouls independent of the AI's own decisions.
 * Resolves in two stages: first "does a reach-in event happen at all" (time-
 * based, scales with the defender's gambling tendency), then, conditional on
 * that, "is it a clean strip (turnover) or a foul" (skill-based, `stripP`).
 */
export function attemptReachIn(s: GameState, dt: number): void {
  const holderId = s.ball.holderId;
  if (!holderId) return;
  const h = agent(s, holderId);
  // ball exposure: power dribbles show the ball. A live drive or post
  // backdown multiplies the reach-in rate — this is the live-ball turnover
  // pressure that keeps attack volume honest (without it, FGA ran 2-3% over
  // band with steals pinned at the low edge; the Stage 2 diagnosis).
  const act = s.poss.action;
  const attacking =
    s.t < h.driveUntil ||
    (act?.kind === 'post' && act.posterId === h.p.id && act.phase === 'working');
  let d = onBallDefender(s, h);
  if (attacking) {
    // in traffic ANY converging defender can get a hand in — a beaten on-ball
    // man is behind the play, and the strip risk of attacking a crowd comes
    // from the helpers meeting the ball at the gather
    for (const cand of onCourt(s, other(h.side))) {
      if (cand.fouledOut) continue;
      if (!d || dist(cand.pos, h.pos) < dist(d.pos, h.pos)) d = cand;
    }
  }
  // 4.2ft: has to be tight, hand-check range — this is deliberately shorter
  // than onBallDefender's own 12ft "who guards him" radius, since a reach-in
  // needs the defender close enough to actually get a hand on the ball
  // (attacking widens it to gather range: strips happen at the gather)
  if (!d || dist(d.pos, h.pos) > (attacking ? 5.5 : 4.2)) return;
  const F = s.params.foul;
  // per-tick probability from a per-second rate (reachInPerSec * dt), boosted
  // up to +85% for a maximum-gambleSteal defender — aggressive gamblers reach
  // in far more often than conservative ones, at the cost of the foul risk below
  const exposure = attacking ? F.attackReachInMult : 1;
  const p = F.reachInPerSec * dt * exposure * (1 + 0.85 * n(d.p.tend.gambleSteal));
  if (!s.rng.chance(p)) return;

  // given a reach-in happens, stripP is the clean-strip share: 0.3 base, +0.3
  // swing for an elite-steal defender, -0.22 swing for an elite ball-handler
  // (ball security beats a defender's hands, but not as much as the
  // defender's hands beat a poor handler) — clamped to [0.08, 0.7] so even
  // the best/worst matchups still have a real chance either way, never a
  // guaranteed foul or guaranteed strip
  // attacking reach-ins skew cleaner: a poke at the gather is a strip far
  // more often than a hack (without the skew, the attack-exposure tax paid
  // out in fouls instead of the turnovers it exists to produce)
  const stripP = clamp(
    0.3 + (attacking ? F.attackStripBonus : 0) + 0.3 * n(d.p.attr.steal) - 0.22 * n(h.p.attr.ballHandle),
    0.08, 0.85
  );
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
      // not in the bonus: no free throws, offense just keeps the ball —
      // shot clock is floored at 14 (defensive-foul reset) and never lowered,
      // then a short 1.2s continuation delay (same possession, no team
      // change) lets the whistle register before play resumes
      s.poss.shotClock = Math.max(s.poss.shotClock, 14);
      deadBall(s, h.side, { clockRuns: false, continuation: true, resumeIn: 1.2 });
    }
  }
}
