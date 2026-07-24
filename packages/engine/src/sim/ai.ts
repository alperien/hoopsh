/**
 * AI brains: offensive decision-making, off-ball movement, defensive positioning.
 *
 * Philosophy: behavior EMERGES from utility comparisons fed by the same
 * probability models that resolve outcomes. Drive-and-kick isn't scripted —
 * help convergence lowers the drive EV and raises the kickout EV, so the pass
 * happens. Tendencies bias utilities; attributes change the underlying EVs.
 */

import { clamp } from '../core/rng.js';
import { dist, lerp, norm, scale, sub, add, type V2 } from '../core/vec.js';
import { spacingSpots } from '../geometry/court.js';
import { lateralSpeed } from '../model/derived.js';
import type { TeamSide } from '../core/events.js';
import {
  agent, attackedRim, onCourt, other,
  type Agent, type GameState
} from './state.js';
import {
  anticipatedContest, contestAt, currentMaxSpeed, gravity, openness, passRisk, shotEV
} from './resolve.js';

// ---------------------------------------------------------------- decisions

export type BallAction =
  | { kind: 'shoot'; moveType: 'catch_shoot' | 'pull_up' | 'drive' | 'heave' | 'post' }
  | { kind: 'pass'; toId: string; passKind: 'normal' | 'kickout' | 'outlet' | 'entry' }
  | { kind: 'drive' }
  | { kind: 'hold' };

/** the ball-handler's decision — evaluated every params.decide.intervalSec */
export function decideBall(s: GameState): BallAction {
  const holderId = s.ball.holderId;
  if (!holderId) return { kind: 'hold' };
  const h = agent(s, holderId);
  const D = s.params.decide;
  const A = s.params.ai;
  const rim = attackedRim(s, h.side);
  const distToRim = dist(h.pos, rim);
  const tactics = s.teams[h.side].tactics;

  // continuation value: what "keep working" is worth, decaying with the shot clock
  const full = s.rules.shotClockSec;
  const sc = Math.max(0, s.poss.shotClock);
  let continuation = D.continuationMax * Math.pow(sc / full, D.continuationCurve);
  if (sc < D.urgencySec) continuation *= sc / D.urgencySec;

  // desperation heave
  const periodExpiring = s.clock < 2.5 && s.clock < sc;
  if ((sc < 1.2 || periodExpiring) && distToRim > 32) {
    return { kind: 'shoot', moveType: 'heave' };
  }

  const driving = s.t < h.driveUntil;
  const sinceCatch = s.t - h.catchT;
  const shotMove: BallAction['moveType'] & string =
    driving && distToRim < 12 ? 'drive'
      : sinceCatch < 0.9 && h.dribblesSinceCatch === 0 ? 'catch_shoot'
      : 'pull_up';

  // judge the shot against the contest expected AT RELEASE, not right now —
  // a defender sprinting into a closeout makes the look worse than it seems
  const W = s.params.shot;
  const windup =
    shotMove === 'catch_shoot' ? W.windupCatchShoot :
    shotMove === 'pull_up' ? W.windupPullUp : W.windupDrive;
  const contest = anticipatedContest(s, h, h.pos, windup);
  const myShot = shotEV(s, h, h.pos, shotMove, contest);

  // --- utility: shoot
  const zoneTend =
    myShot.zone === 'rim' || myShot.zone === 'paint' ? h.p.tend.shotRim :
    myShot.zone === 'mid' ? h.p.tend.shotMid : h.p.tend.shotThree;
  let shootBias = ((zoneTend - 50) / 100) * A.zoneTendBias;
  if (shotMove === 'pull_up') shootBias += ((h.p.tend.pullUp - 50) / 100) * A.pullUpBias;
  if (myShot.zone === 'three') {
    shootBias += (D.threeAppetite - 1) * A.threeApptScale + ((tactics.threeBias - 50) / 100) * A.tacticsThreeScale;
  }
  // shooting over a contest is a bad habit; smart players pass out of it
  const contestBrake =
    clamp(contest.level - A.contestBrakeAt, 0, 1) *
    (A.contestBrakeBase + ((h.p.attr.decisions - 50) / 100) * A.contestBrakeIQ);
  // transition looks are worth extra before the defense sets
  const transitionTerm = s.poss.phase === 'transition' ? D.transitionBonus : 0;
  const uShoot = myShot.ev + shootBias + transitionTerm - continuation - contestBrake;

  // --- utility: drive
  let uDrive = -Infinity;
  if (!driving && distToRim > A.driveMinDistFt && s.poss.phase !== 'advance') {
    const onBall = onBallDefender(s, h);
    const gap = onBall ? dist(onBall.pos, h.pos) : 8;
    const laneCrowd = defendersInLane(s, h, rim);
    const projected = lerp(h.pos, rim, clamp((distToRim - 5) / distToRim, 0, 1));
    const projContest = {
      level: clamp(A.driveProjContestBase + laneCrowd * A.driveProjContestCrowd, 0, 1),
      by: null,
      heightAdvFt: 0
    };
    const driveShot = shotEV(s, h, projected, 'drive', projContest);
    const handling = clamp(
      A.handlingBase +
        (h.p.attr.ballHandle - (onBall?.p.attr.lateral ?? 50)) / A.handlingSkillDiv +
        (gap - 4) / A.handlingGapDiv,
      0.2, 0.95
    );
    const tendTerm = ((h.p.tend.drive - A.driveTendOffset) / 100) * A.driveTendScale * D.driveAppetite;
    // a stalled drive isn't a wasted possession — it resets to the continuation
    // value. Utility = P(get downhill)·(rim EV − continuation) + tendencies.
    uDrive = handling * (driveShot.ev - continuation)
      + tendTerm + transitionTerm * A.driveTransitionMult - laneCrowd * A.laneCrowdPenalty + A.driveFlat;
    // attacking off a live screen: the whole point of calling for it
    const act = s.poss.action;
    if (act && act.handlerId === h.p.id && act.phase !== 'coming') {
      uDrive += A.pnrDriveBonus;
    }
  }

  // --- utility: pass to each teammate
  let bestPass: { toId: string; u: number; passKind: 'normal' | 'kickout' | 'outlet' | 'entry' } | null = null;
  for (const m of onCourt(s, h.side)) {
    if (m.p.id === h.p.id || m.fouledOut) continue;
    const o = openness(s, m);
    const catchContest = { level: clamp((1 - o) * A.catchContestScale, 0, 1), by: null, heightAdvFt: 0.5 };
    const theirShot = shotEV(s, m, m.pos, 'catch_shoot', catchContest);
    const risk = passRisk(s, h, m);
    const cutting = s.t < m.cutUntil;
    const cutterBonus = cutting ? A.cutterBonus : 0;
    const swingBonus =
      A.swingBase +
      ((h.p.tend.passOut - 50) / 100) * A.swingPassOutScale +
      ((h.p.attr.passVision - 50) / 100) * A.swingVisionScale;
    // getting the ball back to a playmaker has value beyond his own shot —
    // he creates the NEXT action (how offenses route through their engine)
    const playmakerPull =
      (((m.p.attr.passVision + m.p.attr.ballHandle) / 2 - A.playmakerOffset) / 100) * A.playmakerScale;
    const u =
      theirShot.ev * (1 - risk.turnoverP * A.passRiskUtilMult) * A.passEVScale
      + cutterBonus + swingBonus + playmakerPull
      - continuation * A.passContinuationScale;
    if (bestPass === null || u > bestPass.u) {
      bestPass = {
        toId: m.p.id,
        u,
        passKind: driving ? 'kickout' : s.poss.phase === 'transition' ? 'outlet' : 'normal'
      };
    }
  }

  // --- utility: hold (keep probing)
  const uHold = s.poss.phase === 'advance' ? A.holdAdvance : A.holdHalfcourt;

  // softmax selection over available actions
  const actions: { a: BallAction; u: number }[] = [
    { a: { kind: 'shoot', moveType: shotMove }, u: uShoot },
    { a: { kind: 'hold' }, u: uHold }
  ];
  if (uDrive > -Infinity) actions.push({ a: { kind: 'drive' }, u: uDrive });
  if (bestPass) actions.push({ a: { kind: 'pass', toId: bestPass.toId, passKind: bestPass.passKind }, u: bestPass.u });

  const temp = Math.max(0.02, s.params.decide.temperature);
  const maxU = Math.max(...actions.map((x) => x.u));
  const weights = actions.map((x) => Math.exp((x.u - maxU) / temp));
  const idx = s.rng.weighted(weights);
  return actions[idx]!.a;
}

export function onBallDefender(s: GameState, holder: Agent): Agent | null {
  let best: Agent | null = null;
  let bestD = Infinity;
  for (const d of onCourt(s, other(holder.side))) {
    if (d.fouledOut) continue;
    const dd = dist(d.pos, holder.pos);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best && bestD < 12 ? best : null;
}

function defendersInLane(s: GameState, h: Agent, rim: V2): number {
  let count = 0;
  for (const d of onCourt(s, other(h.side))) {
    if (d.fouledOut) continue;
    const t = laneT(h.pos, rim, d.pos);
    if (t > 0.15 && t < 0.95) {
      const lat = dist(d.pos, lerp(h.pos, rim, t));
      if (lat < 5) count += 1 - lat / 5;
    }
  }
  return count;
}

function laneT(a: V2, b: V2, p: V2): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  if (l2 < 1e-9) return 0;
  return clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2, 0, 1);
}

/** react to a shot going up: crash the boards, box out, or get back on D */
export function onShotReleased(s: GameState, offSide: TeamSide): void {
  const rim = attackedRim(s, offSide);
  for (const a of onCourt(s, offSide)) {
    if (a.fouledOut) continue;
    const near = dist(a.pos, rim) < 22;
    const crash = near && s.rng.chance(
      s.params.ai.crashBase + (a.p.tend.crashOffReb / 100) * s.params.ai.crashTendScale
    );
    if (crash) {
      a.intent = 'crash';
      a.target = { x: rim.x + s.rng.range(-5, 5), y: rim.y + s.rng.range(-5, 5) };
      a.sprinting = true;
    } else {
      a.intent = 'getback';
      a.target = lerp(attackedRim(s, other(offSide)), s.court.rims[rim.x > s.court.midX ? 0 : 1]!, 0.55);
      a.sprinting = false;
    }
  }
  for (const d of onCourt(s, other(offSide))) {
    if (d.fouledOut) continue;
    const man = d.manId ? s.agents.get(d.manId) : null;
    d.intent = 'crash';
    d.target = man && dist(man.pos, rim) < 20
      ? lerp(man.pos, rim, 0.45) // box out between man and rim
      : lerp(d.pos, rim, 0.5);
  }
}

// ------------------------------------------------------------ offense setup

/** assign spacing spots for the possession by personnel */
export function assignSpots(s: GameState, side: TeamSide): void {
  const rim = attackedRim(s, side);
  const spots = spacingSpots(s.court, rim);
  const byKey = new Map(spots.map((x) => [x.key, x.pos]));
  const players = onCourt(s, side).filter((a) => !a.fouledOut);

  // ball handler (best handle) takes the top; shooters fill wings/corners;
  // the worst shooter lives at the dunker spot
  const sorted = [...players].sort((a, b) => b.p.attr.ballHandle - a.p.attr.ballHandle);
  const handler = sorted[0]!;
  const rest = sorted.slice(1).sort((a, b) => gravity(b) - gravity(a));

  const map = s.poss.spotMap;
  map.clear();
  map.set(handler.p.id, 'top');
  const shooterKeys = ['wing_l', 'wing_r', 'corner_l', 'corner_r'];
  rest.forEach((a, i) => {
    if (i < 3) {
      map.set(a.p.id, shooterKeys[i]!);
    } else {
      // lowest-gravity big: dunker spot if a true non-shooter, else last shooter spot
      map.set(a.p.id, gravity(a) < 0.42 ? 'dunker' : shooterKeys[3]!);
    }
  });

  for (const a of players) {
    const key = map.get(a.p.id);
    const pos = key ? byKey.get(key) : undefined;
    if (pos) {
      a.spotKey = key!;
      a.target = { ...pos };
    }
  }
}

// ------------------------------------------------------------ pick-and-roll

/**
 * Pick-and-roll lifecycle. The action is deliberately thin scaffolding —
 * everything downstream (pull-up space when the defender ducks under, the
 * pocket pass to the roller, the pop three) EMERGES from existing systems:
 * screen stun feeds the contest model, the roll reuses cut machinery (and so
 * earns the cutter pass bonus), the pop reuses spacing spots.
 */
function pnrTick(s: GameState): void {
  const A = s.params.ai;
  const act = s.poss.action;
  const holderId = s.ball.holderId;

  if (act) {
    const screener = agent(s, act.screenerId);
    const handler = agent(s, act.handlerId);
    const handlerLostBall = holderId !== act.handlerId && act.phase !== 'finishing';
    const actorGone =
      !screener.onCourt || screener.fouledOut || !handler.onCourt || handler.fouledOut;
    if (s.t > act.until || handlerLostBall || actorGone) {
      s.poss.action = null;
      return;
    }

    if (act.phase === 'coming') {
      const onBall = onBallDefender(s, handler);
      if (onBall && dist(screener.pos, onBall.pos) < A.pnrScreenSetDistFt) {
        // contact: the on-ball defender must navigate the screen
        act.phase = 'set';
        act.setAt = s.t;
        const under = s.rng.chance(clamp(A.pnrUnderBase - gravity(handler), 0.08, 0.85));
        if (under) {
          onBall.screenStunUntil = s.t + A.pnrStunUnderSec;
          onBall.navUnderUntil = s.t + 1.2; // drops back — concedes the pull-up
        } else {
          const fight = 0.7 + screener.p.attr.strength / 300; // strong screens hit harder
          onBall.screenStunUntil = s.t + A.pnrStunOverSec * fight;
        }
      }
      return;
    }

    if (act.phase === 'set' && s.t - act.setAt > 0.5) {
      // screener's next job: roll to the rim or pop to the arc
      act.phase = 'finishing';
      if (gravity(screener) < A.pnrRollGravityCut) {
        screener.cutUntil = s.t + 1.7; // the roll IS a cut — pocket pass emerges
      } else {
        screener.spotKey = screener.pos.y < s.court.centerY ? 'wing_l' : 'wing_r';
      }
    }
    return;
  }

  // no action running: consider calling one
  if (
    s.poss.phase !== 'halfcourt' ||
    !holderId ||
    s.poss.shotClock < A.pnrMinShotClock ||
    s.pendingRelease !== null
  ) return;
  const h = agent(s, holderId);
  if (s.t < h.driveUntil) return;
  const rim = attackedRim(s, s.poss.team);
  const dRim = dist(h.pos, rim);
  if (dRim < 18 || dRim > 31) return;
  if (!s.rng.chance(A.pnrRatePerTick)) return;

  // pick the screener: prefer low-gravity size (his defender sags -> good screens)
  let best: Agent | null = null;
  let bestScore = -Infinity;
  for (const a of onCourt(s, s.poss.team)) {
    if (a.fouledOut || a.p.id === holderId || s.t < a.cutUntil) continue;
    const score = (1 - gravity(a)) * 1.5 + (a.p.heightIn - 70) / 28 + a.p.attr.strength / 400;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  if (!best) return;
  s.poss.action = {
    kind: 'pnr',
    handlerId: holderId,
    screenerId: best.p.id,
    phase: 'coming',
    until: s.t + A.pnrDurationSec,
    setAt: 0
  };
}

/** per-tick off-ball offense behavior */
export function offenseOffBallTick(s: GameState): void {
  const side = s.poss.team;
  const rim = attackedRim(s, side);
  const spots = spacingSpots(s.court, rim);
  const byKey = new Map(spots.map((x) => [x.key, x.pos]));

  pnrTick(s);
  const act = s.poss.action;

  for (const a of onCourt(s, side)) {
    if (a.fouledOut || a.p.id === s.ball.holderId) continue;

    // screener on his way to set (or holding) the screen
    if (act && a.p.id === act.screenerId && act.phase !== 'finishing') {
      const handler = agent(s, act.handlerId);
      const onBall = onBallDefender(s, handler);
      if (onBall) {
        // set up beside the defender on the handler's side; once there, PLANT
        // (a screen is a stationary pick — grinding into the defender looks
        // like a collision glitch and is an illegal screen anyway)
        const toHandler = norm(sub(handler.pos, onBall.pos));
        const spot = add(onBall.pos, scale(toHandler, 1.6));
        a.target = dist(a.pos, spot) < 0.9 ? a.pos : spot;
        a.intent = 'spot';
        a.sprinting = act.phase === 'coming';
        continue;
      }
    }

    // finish an active cut
    if (s.t < a.cutUntil) {
      a.intent = 'cut';
      a.target = lerp(rim, a.pos, 0.06);
      a.sprinting = true;
      continue;
    }

    // occasionally trigger a cut for motion-heavy players when the lane is open
    if (
      s.poss.phase === 'halfcourt' &&
      a.spotKey !== 'dunker' &&
      s.rng.chance((a.p.tend.offBallMotion / 100) * s.params.ai.cutRateScale) &&
      dist(a.pos, rim) > 16
    ) {
      a.cutUntil = s.t + s.params.ai.cutDurationSec;
      continue;
    }

    a.intent = 'spot';
    a.sprinting = s.poss.phase !== 'halfcourt';
    const key = a.spotKey ?? 'corner_l';
    const spot = byKey.get(key);
    if (spot) a.target = spot;
  }
}

// ------------------------------------------------------------------ defense

/** assign man matchups: sort both lineups by size and pair them */
export function assignMatchups(s: GameState, defSide: TeamSide): void {
  const defenders = onCourt(s, defSide).filter((a) => !a.fouledOut);
  const attackers = onCourt(s, other(defSide)).filter((a) => !a.fouledOut);
  const bySize = (arr: Agent[]) =>
    [...arr].sort((a, b) => (b.p.heightIn + b.p.weightLb / 12) - (a.p.heightIn + a.p.weightLb / 12));
  const d = bySize(defenders);
  const o = bySize(attackers);
  for (let i = 0; i < d.length; i++) {
    d[i]!.manId = o[Math.min(i, o.length - 1)]!.p.id;
  }
}

/** per-tick defensive positioning */
export function defenseTick(s: GameState): void {
  const defSide = other(s.poss.team);
  const rim = defendedRimOf(s, defSide);
  const holderId = s.ball.holderId;
  const holder = holderId ? agent(s, holderId) : null;
  const helpAggr = s.teams[defSide].tactics.helpAggr / 100;
  const A = s.params.ai;

  // is a help rotation warranted?
  let helper: Agent | null = null;
  if (holder && s.t < holder.driveUntil) {
    const dRim = dist(holder.pos, rim);
    if (dRim < s.params.move.helpTriggerFt) {
      // nearest weak-side defender whose man has the least gravity
      let bestScore = Infinity;
      for (const d of onCourt(s, defSide)) {
        if (d.fouledOut || !d.manId || d.manId === holder.p.id) continue;
        const man = agent(s, d.manId);
        const score = dist(d.pos, rim) + gravity(man) * A.helperGravityWeight * (1.35 - helpAggr);
        if (score < bestScore) { bestScore = score; helper = d; }
      }
    }
  }

  for (const d of onCourt(s, defSide)) {
    if (d.fouledOut) continue;
    d.intent = 'defend';
    d.sprinting = false;
    const man = d.manId ? agent(s, d.manId) : null;
    if (!man) { d.target = lerp(rim, s.ball.pos, 0.4); continue; }

    if (helper && d.p.id === helper.p.id && holder) {
      // rotate to the rim / drive path
      d.target = lerp(rim, holder.pos, 0.22);
      d.sprinting = true;
      continue;
    }

    // pick-and-roll drop coverage: the screener's defender protects the paint
    const act = s.poss.action;
    if (act && act.phase !== 'coming' && man.p.id === act.screenerId && holder) {
      const dRim = Math.max(1, dist(holder.pos, rim));
      d.target = lerp(rim, holder.pos, clamp(A.pnrDropDepthFt / dRim, 0, 0.85));
      continue;
    }

    const onBall = holder !== null && man.p.id === holder.p.id;
    if (onBall && holder) {
      let gap = Math.max(
        2.2,
        s.params.move.defGapBaseFt - gravity(man) * s.params.move.defGapGravityFt
      );
      // ducking under a screen: drop back, concede the pull-up
      if (s.t < d.navUnderUntil) gap += A.pnrUnderSagFt;
      const toRim = norm(sub(rim, holder.pos));
      d.target = add(holder.pos, scale(toRim, gap));
      // closeout: sprint when caught out of position (e.g. after a swing pass)
      d.sprinting = dist(d.pos, holder.pos) > gap + A.closeoutSlackFt;
      // beaten on a drive: chase the intercept point
      if (s.t < holder.driveUntil) {
        d.target = lerp(holder.pos, rim, 0.3);
        d.sprinting = true;
      }
      continue;
    }

    // off-ball: guard the man-rim line, sagging with ball distance & low gravity
    const g = gravity(man);
    const guardDist = A.guardDistBase + (1 - g) * A.guardDistOpen;
    const manToRim = norm(sub(rim, man.pos));
    const basePoint = add(man.pos, scale(manToRim, Math.min(guardDist, dist(man.pos, rim) * 0.5)));
    const ballDist = dist(man.pos, s.ball.pos);
    const sag = clamp((ballDist - A.sagStartFt) / A.sagRangeFt, 0, A.sagMax)
      * (1 - g * A.sagGravityCut) * (0.6 + helpAggr * 0.6);
    const helpSpot = lerp(rim, s.ball.pos, A.helpSpotPull);
    d.target = lerp(basePoint, helpSpot, sag);
  }
}

function defendedRimOf(s: GameState, defSide: TeamSide): V2 {
  return attackedRim(s, other(defSide));
}

/** movement speed for an agent given intent & fatigue */
export function moveSpeed(s: GameState, a: Agent): number {
  const max = currentMaxSpeed(s, a);
  if (a.intent === 'defend') {
    const lat = lateralSpeed(a.p.attr) * (a.sprinting ? 1.15 : 1);
    return Math.min(max, lat);
  }
  const mult = a.sprinting ? 1 : s.params.move.halfcourtSpeedMult;
  return max * mult;
}
