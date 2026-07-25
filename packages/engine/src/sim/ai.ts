/**
 * AI brains: offensive decision-making, off-ball movement, defensive positioning.
 *
 * Philosophy: behavior EMERGES from utility comparisons fed by the same
 * probability models that resolve outcomes. Drive-and-kick isn't scripted —
 * help convergence lowers the drive EV and raises the kickout EV, so the pass
 * happens. Tendencies bias utilities; attributes change the underlying EVs.
 *
 * ── HOW TO READ THIS FILE ──────────────────────────────────────────────────
 * Everything in `decideBall` is denominated in EXPECTED POINTS. Each candidate
 * action gets a utility; a softmax over those utilities picks one. So:
 *   • a term of +0.1 means "worth a tenth of a point"
 *   • the yardstick every action is measured against is `continuation` — the
 *     expected points of NOT acting yet (keep working the possession)
 *   • all weights come from SimParams.ai so the sweep can reach them
 *
 * Three layers live here, in order:
 *   1. decideBall + helpers  — what the ball-handler does
 *   2. assignSpots / offenseOffBallTick / actionTick — what the other four do
 *   3. assignMatchups / defenseTick — what the defense does
 *
 * The most realism-critical relationships in the file:
 *   gravity() → defensive gap and sag depth (WHY shooters create space)
 *   help convergence → drive EV falls, kickout EV rises (drive-and-kick)
 *   screen stun → contest drops (WHY a pick-and-roll pull-up is a good shot)
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
/**
 * Creation score — THE usage-hierarchy definition. Used by both ball routing
 * (decideBall's re-initiation pull) and action initiation (actionTick's rank
 * gate), one definition so "who should run the offense" never disagrees
 * between deciding to pass and deciding to call a screen.
 */
function creation(a: Agent): number {
  return (a.p.attr.ballHandle + a.p.attr.passVision) / 2;
}

export function decideBall(s: GameState): BallAction {
  const holderId = s.ball.holderId;
  if (!holderId) return { kind: 'hold' };
  const h = agent(s, holderId);
  const D = s.params.decide;
  const A = s.params.ai;
  const rim = attackedRim(s, h.side);
  const distToRim = dist(h.pos, rim);
  const tactics = s.teams[h.side].tactics;

  // CONTINUATION VALUE — the yardstick for every decision below.
  // "What are the remaining seconds of this possession worth if I don't act?"
  // Decays as the shot clock drains, then collapses linearly inside the
  // urgency window (any shot beats a violation). This single curve is what
  // produces patient early-clock offense and desperate late-clock heaves.
  const full = s.rules.shotClockSec;
  const sc = Math.max(0, s.poss.shotClock);
  let continuation = D.continuationMax * Math.pow(sc / full, D.continuationCurve);
  if (sc < D.urgencySec) continuation *= sc / D.urgencySec;

  // Desperation heave: with <1.2s of shot clock (or a period expiring inside
  // 2.5s) and no chance to get closer than 32 ft, just launch it. Bypasses the
  // whole utility comparison — no shot is "good", but a violation is worse.
  const periodExpiring = s.clock < 2.5 && s.clock < sc;
  if ((sc < 1.2 || periodExpiring) && distToRim > 32) {
    return { kind: 'shoot', moveType: 'heave' };
  }

  // Which KIND of shot this would be — drives the difficulty adjustment and
  // the windup length. The catch-and-shoot window is 0.9s and zero dribbles:
  // rise up immediately off the catch, or it becomes a (harder) pull-up.
  const driving = s.t < h.driveUntil;
  const sinceCatch = s.t - h.catchT;
  const act0 = s.poss.action;
  // working the block: shots from a live post-up resolve as post moves
  // (windupPost + movePost in the shot model) instead of hurried pull-ups
  const postingUp = act0?.kind === 'post' && act0.posterId === h.p.id && act0.phase === 'working';
  const shotMove: BallAction['moveType'] & string =
    postingUp && distToRim < 14 ? 'post'
      : driving && distToRim < 12 ? 'drive'
      : sinceCatch < 0.9 && h.dribblesSinceCatch === 0 ? 'catch_shoot'
      : 'pull_up';

  // judge the shot against the contest expected AT RELEASE, not right now —
  // a defender sprinting into a closeout makes the look worse than it seems
  const W = s.params.shot;
  const windup =
    shotMove === 'catch_shoot' ? W.windupCatchShoot :
    shotMove === 'pull_up' ? W.windupPullUp :
    shotMove === 'post' ? W.windupPost : W.windupDrive;
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
  // catch-and-shoot decisiveness: a genuinely OPEN three off the catch is
  // the payoff of ball movement — letting it fly is drilled behavior, and
  // without this term the continuation value talks every receiver out of
  // shooting (kicks die in re-swings and creators never earn assists). Two
  // gates, both from incidents: contest < 0.5 so only the CREATED advantage
  // fires, not an ordinary swing catch (ungated: pace 133 vs band 95-103);
  // three-point zone only, because the drilled catch-and-shoot is a JUMP-SHOT
  // concept — paint catches are finishes the cut machinery already values,
  // and applying the bonus there flooded the rim and sank 3PA share to 26%.
  // ...and scaled by the shooter's own three-point appetite, with a hard
  // floor at tendency 25: the green light belongs to shooters and a true
  // non-shooter never has it. A sagged-off big is OPEN precisely because the
  // defense wants him shooting — unscaled, he obliged (bigs chucked ~9% of
  // their FGA from deep and league 3P% sagged).
  if (shotMove === 'catch_shoot' && myShot.zone === 'three') {
    shootBias += A.catchShootBonus * clamp((0.5 - contest.level) / 0.5, 0, 1) * clamp((h.p.tend.shotThree - 25) / 75, 0, 1);
  }
  // the worked post move: after the backdown the turnaround is the plan —
  // without this the spray won 8:1 and post scoring never materialized
  if (shotMove === 'post' && act0?.kind === 'post' && s.t - act0.postedAt >= A.postBackdownSec) {
    shootBias += A.postShotBonus;
  }
  // shooting over a contest is a bad habit; smart players pass out of it
  const contestBrake =
    clamp(contest.level - A.contestBrakeAt, 0, 1) *
    (A.contestBrakeBase + ((h.p.attr.decisions - 50) / 100) * A.contestBrakeIQ);
  // transition looks are worth extra before the defense sets
  const transitionTerm = s.poss.phase === 'transition' ? D.transitionBonus : 0;
  const uShoot = myShot.ev + shootBias + transitionTerm - continuation - contestBrake;

  // --- utility: pass to each teammate
  let bestPass: { toId: string; u: number; passKind: 'normal' | 'kickout' | 'outlet' | 'entry' } | null = null;
  let bestCatchEv = -Infinity; // best teammate look as-is — the drive block prices the collapse off it
  for (const m of onCourt(s, h.side)) {
    if (m.p.id === h.p.id || m.fouledOut) continue;
    const o = openness(s, m);
    const catchContest = { level: clamp((1 - o) * A.catchContestScale, 0, 1), by: null, heightAdvFt: 0.5 };
    const theirShot = shotEV(s, m, m.pos, 'catch_shoot', catchContest);
    if (theirShot.ev > bestCatchEv) bestCatchEv = theirShot.ev;
    const risk = passRisk(s, h, m);
    const cutting = s.t < m.cutUntil;
    const cutterBonus = cutting ? A.cutterBonus : 0;
    // a big posted and settled on the block wants the entry — the feed is the
    // whole point of the action (any current holder may throw it)
    const entryTarget =
      act0?.kind === 'post' && act0.phase === 'posting' &&
      m.p.id === act0.posterId && dist(m.pos, m.target) < 4;
    const entryBonus = entryTarget ? A.postEntryBonus : 0;
    const swingBonus =
      A.swingBase +
      ((h.p.tend.passOut - 50) / 100) * A.swingPassOutScale +
      ((h.p.attr.passVision - 50) / 100) * A.swingVisionScale;
    // re-initiation: routing the ball UP the creation hierarchy has value
    // beyond the receiver's own shot — he creates the NEXT action. Relative
    // and clamped at zero: the primary feels no pull toward lesser handlers,
    // but passing DOWN is never penalized — a kick-out is judged on shot
    // merit alone (penalizing it produced a ball-stopping primary). Clock-
    // scaled: hierarchy is an early-offense concept — as the clock drains,
    // shot value takes over.
    const playmakerPull =
      (Math.max(0, creation(m) - creation(h)) / 100) * A.playmakerScale * (sc / full);
    const u =
      theirShot.ev * (1 - risk.turnoverP * A.passRiskUtilMult) * A.passEVScale
      + cutterBonus + swingBonus + playmakerPull + entryBonus
      - continuation * A.passContinuationScale;
    if (bestPass === null || u > bestPass.u) {
      bestPass = {
        toId: m.p.id,
        u,
        passKind: entryTarget ? 'entry'
          : driving ? 'kickout'
          : s.poss.phase === 'transition' ? 'outlet' : 'normal'
      };
    }
  }

  // --- utility: drive
  let uDrive = -Infinity;
  if (!driving && distToRim > A.driveMinDistFt && s.poss.phase !== 'advance') {
    const onBall = onBallDefender(s, h);
    const gap = onBall ? dist(onBall.pos, h.pos) : 8;
    const laneCrowd = defendersInLane(s, h, rim);
    // Where the drive would END: 5 ft short of the rim (a layup/floater spot,
    // not the rim itself — nobody finishes AT the center of the hoop).
    const projected = lerp(h.pos, rim, clamp((distToRim - 5) / distToRim, 0, 1));
    const projContest = {
      level: clamp(A.driveProjContestBase + laneCrowd * A.driveProjContestCrowd, 0, 1),
      by: null,
      heightAdvFt: 0
    };
    const driveShot = shotEV(s, h, projected, 'drive', projContest);
    // P(actually get downhill) — the matchup at the point of attack:
    //   base 0.55, ± the ballHandle-vs-lateral-quickness gap, ± the cushion
    //   the defender is giving (a 9 ft gap is an invitation; 2 ft is a wall).
    //   Clamped [0.2, 0.95]: nobody is uncontainable, nobody is helpless.
    // containment = physical mirror (lateral) blended with point-of-attack
    // craft (perimeterD) per ai.containDBlend
    const contain = onBall
      ? onBall.p.attr.lateral * (1 - A.containDBlend) + onBall.p.attr.perimeterD * A.containDBlend
      : 50;
    const handling = clamp(
      A.handlingBase +
        (h.p.attr.ballHandle - contain) / A.handlingSkillDiv +
        (gap - 4) / A.handlingGapDiv,
      0.2, 0.95
    );
    const tendTerm = ((h.p.tend.drive - A.driveTendOffset) / 100) * A.driveTendScale * D.driveAppetite;
    // a live drive is worth the BETTER of finishing at the rim or the
    // paint-touch-and-spray: penetration collapses the help defense and
    // manufactures an open look for the best-positioned teammate
    // (driveKickBoost = the extra openness the collapse buys him). The kick
    // premium is gated by the lane crowd — an EMPTY lane creates no spray
    // (nobody helped; its value is already in the high finish EV), a crowded
    // lane is where the kick lives. Ungated, every drive carried a phantom
    // kick premium and the paint flooded league-wide (rim share 86%, 3PA 13%).
    // Without the option term entirely, the rim attempt alone rarely beats
    // the continuation value and drives never launch (Stage 2 probe: 2 drive
    // wins in 657 decisions for the league's best handler). A stalled drive
    // still just resets to the continuation value.
    // ...and the premium scales with the DRIVER's vision: drive-and-kick is
    // a passing skill. An elite creator prices the spray option in full; a
    // low-vision wing driving into a crowd has no spray option (he cannot
    // deliver that pass), so his drive is finish-or-bust and the continuation
    // bar correctly rejects it. This is what routes drive volume — and the
    // assists it creates — through the creation hierarchy without a single
    // special case.
    const kickPremium = A.driveKickBoost * Math.min(1, laneCrowd) * (h.p.attr.passVision / 100);
    const collapse = bestCatchEv > -Infinity
      ? Math.max(driveShot.ev, bestCatchEv + kickPremium)
      : driveShot.ev;
    // the negative branch is discounted, not charged in full: a drive is
    // closer to an option than a commitment — a handler whose downhill
    // outcome trails the reset mostly aborts back to the offense (at the
    // cost of a beat of clock), he does not cash the bad branch. Charged in
    // full, the negative diff scaled WITH handling skill and punished elite
    // handlers hardest, burying the drive tendency dial; zeroed entirely, it
    // freed every mid-tendency role player to drive and the paint flooded
    // (pace 113, FTA 31, 3PA 26% — both incidents from Stage 2 tuning).
    const driveDiff = collapse - continuation;
    uDrive = handling * (driveDiff >= 0 ? driveDiff : driveDiff * A.driveAbortDiscount)
      + tendTerm + transitionTerm * A.driveTransitionMult - laneCrowd * A.laneCrowdPenalty + A.driveFlat;
    // attacking off a live screen: the whole point of calling for it
    if (act0?.kind === 'pnr' && act0.handlerId === h.p.id && act0.phase !== 'coming') {
      uDrive += A.pnrDriveBonus;
    }
    // a cleared side is an invitation — the iso call is a commitment to attack
    if (act0?.kind === 'iso' && act0.handlerId === h.p.id) {
      uDrive += A.isoDriveBonus;
    }
  }

  // --- utility: hold (keep probing)
  let uHold = s.poss.phase === 'advance' ? A.holdAdvance : A.holdHalfcourt;
  // mid-drive: keep attacking. The collapse option priced at launch (drive
  // block above) is still maturing while the dribble is live — without this,
  // hold falls to the halfcourt baseline one tick after launch and every
  // drive ends in an instant kick before the help ever commits. Scaled by
  // remaining drive seconds (capped at 1s) so the boost is strong at launch
  // and gone by the terminal decision: penetrate first, THEN finish or spray
  // off the true post-collapse looks. A flat boost instead suppresses the
  // kick outright and drives die at the rim in contested junk.
  if (driving) uHold += A.driveHoldBoost * clamp(h.driveUntil - s.t, 0, 1);
  // a screen is on its way — wait for it instead of swinging the ball away
  // (audit: without this, the handler passed before 93% of screens arrived)
  if (act0?.kind === 'pnr' && act0.handlerId === h.p.id && act0.phase === 'coming') {
    uHold += A.pnrWaitBoost;
  }
  // the backdown: a post player who just caught the entry works his position
  // for a beat before the shoot-or-spray decision (same shape as the drive
  // hold — the advantage is still maturing while he carves out space)
  if (postingUp && s.t - act0.postedAt < A.postBackdownSec) {
    uHold += A.postWorkBoost;
  }
  // ...and the self-post walk-down gets the same commitment: he CALLED this
  // action — without the boost, a high-vision hub passed away mid-dribble
  // on nearly every self-post and the call never reached the block
  // (fidelity incident: 1.2 post shots/game for a 92-post-tendency center)
  if (
    act0?.kind === 'post' && act0.posterId === h.p.id &&
    act0.phase === 'posting' && act0.feederId === act0.posterId
  ) {
    uHold += A.postWorkBoost;
  }

  // SOFTMAX over utilities: usually the best action, sometimes not. The
  // temperature (params.decide.temperature, ~0.06 expected points) is the
  // engine's "IQ dial" — near zero makes every player a perfect optimizer,
  // higher values produce human noise and bad shots.
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

/** the defender ASSIGNED to this player (falls back to nearest on-ball man) */
export function assignedDefender(s: GameState, man: Agent): Agent | null {
  for (const d of onCourt(s, other(man.side))) {
    if (!d.fouledOut && d.manId === man.p.id && dist(d.pos, man.pos) < 16) return d;
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
  // 12 ft cutoff: past that nobody is meaningfully "on the ball"
  return best && bestD < 12 ? best : null;
}

/**
 * How crowded the drive lane is: a soft count of defenders sitting between the
 * handler and the rim. Feeds both the projected contest on a drive and a
 * direct utility penalty — this is what makes a packed paint deter drives and
 * (via the kickout branch) makes help defense produce open shooters.
 *
 * t ∈ (0.15, 0.95): ignore defenders standing on top of the handler (that's
 * the on-ball matchup, handled separately) and those already under the rim.
 * lat < 5 ft: within a body's width of the driving line, weighted linearly.
 */
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
  // bench exhausted and every on-court player fouled out: play on with who's
  // out there rather than crashing (mirrors bestHandler — NBA rule analog: a
  // fouled-out player remains when no substitute exists; custom short rosters
  // are legal input, and the adversarial audit produced this state at default
  // params with a foul-prone no-bench fixture)
  const eligible = onCourt(s, side).filter((a) => !a.fouledOut);
  const players = eligible.length > 0 ? eligible : onCourt(s, side);

  // ball handler (best handle) takes the top; shooters fill wings/corners;
  // the worst shooter lives at the dunker spot
  // Best handler initiates from the top; everyone else fills by gravity —
  // shooters get the wings and corners (where their gravity stretches the
  // defense), the lowest-gravity big goes to the dunker spot.
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
      // gravity < 0.42 ≈ "the defense will not respect him out there", so he
      // is more useful on the baseline as a lob/putback threat than standing
      // in a corner being ignored (which would clog the spacing he can't use)
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
 *
 * Post-ups and isolations run through the same slot: the post entry reuses
 * the pass model (with an entry incentive), the double-team reuses help
 * defense, and the spray out of the double reuses kick-out machinery — the
 * post becomes a passing hub for free. The iso is pure decision-layer: a
 * commitment window that boosts the handler's attack.
 */
function actionTick(s: GameState): void {
  const A = s.params.ai;
  const act = s.poss.action;
  const holderId = s.ball.holderId;

  if (act && act.kind === 'post') {
    const poster = agent(s, act.posterId);
    // gave it up from the block (the spray) or lost it — the action is over;
    // during 'posting' a null holder is normal (the entry is in flight)
    const sprayed = act.phase === 'working' && holderId !== act.posterId;
    if (s.t > act.until || sprayed || !poster.onCourt || poster.fouledOut) {
      s.poss.action = null;
      return;
    }
    if (act.phase === 'posting' && holderId === act.posterId) {
      // entry caught — or, on a self-post (feederId === posterId), the
      // dribble-down: wait until he has actually reached the block, else
      // "working" would start 26 ft from the rim
      const selfPost = act.feederId === act.posterId;
      if (!selfPost || dist(poster.pos, poster.target) < 3.5) {
        act.phase = 'working'; // the backdown clock starts
        act.postedAt = s.t;
      }
    }
    return;
  }
  if (act && act.kind === 'iso') {
    const handler = agent(s, act.handlerId);
    if (s.t > act.until || holderId !== act.handlerId || !handler.onCourt || handler.fouledOut) {
      s.poss.action = null;
    }
    return;
  }

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
      const onBall = assignedDefender(s, handler);
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
  // usage hierarchy: actions are called by the pecking order. rank01 is the
  // holder's creation standing among on-court teammates (ties count half), so
  // the primary initiates most screens while the weakest creator mostly
  // swings instead; pnrUsageFloor keeps secondary actions alive.
  const myC = creation(h);
  let below = 0;
  let peers = 0;
  for (const a of onCourt(s, s.poss.team)) {
    if (a.p.id === holderId || a.fouledOut) continue;
    peers++;
    const c = creation(a);
    below += c < myC ? 1 : c === myC ? 0.5 : 0;
  }
  const rank01 = peers > 0 ? below / peers : 1;
  if (!s.rng.chance(A.pnrRatePerTick * (A.pnrUsageFloor + (1 - A.pnrUsageFloor) * rank01))) return;

  // pick the screener: low-gravity size (his defender sags -> good screens),
  // discounted by how far he must travel — a screen that can't arrive in time
  // is worse than no screen (audit: distance-blind choice left 93% of actions inert)
  let best: Agent | null = null;
  let bestScore = -Infinity;
  for (const a of onCourt(s, s.poss.team)) {
    if (a.fouledOut || a.p.id === holderId || s.t < a.cutUntil) continue;
    const travel = dist(a.pos, h.pos);
    if (travel > A.pnrMaxScreenDistFt) continue;
    const score =
      (1 - gravity(a)) * 1.5 + (a.p.heightIn - 70) / 28 + a.p.attr.strength / 400
      - travel / 40;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  // the call: screen, post entry, or a clear-out. One weighted roll across
  // whatever this lineup actually offers — a team without a post threat never
  // posts, a low-iso handler never clears out (identity through tendencies).
  let poster: Agent | null = null;
  let posterScore = 0;
  for (const a of onCourt(s, s.poss.team)) {
    // the HOLDER is a legal poster: a hub big who is also his team's best
    // creator (the Jokić shape) initiates his own post-up by dribbling down
    // to the block — before this, the usage hierarchy routed him the ball
    // and the post action then required someone ELSE to hold it, so the
    // profile scored 7.9 ppg with 0.6 post touches (fidelity incident)
    if (a.fouledOut || s.t < a.cutUntil) continue;
    // post appetite carries the score; strength/finishing make it credible
    const sc = ((a.p.tend.post - 40) / 100) * (0.6 + a.p.attr.strength / 300 + a.p.attr.finishing / 500);
    if (sc > posterScore) { posterScore = sc; poster = a; }
  }
  const isoScore = Math.max(0, (h.p.tend.iso - 50) / 100);
  const wPnr = best ? 1 : 0;
  const wPost = poster && posterScore > A.postCallCut ? posterScore * A.postCallShare : 0;
  const wIso = isoScore * A.isoCallShare;
  if (wPnr + wPost + wIso <= 0) return;
  const pick = s.rng.weighted([wPnr, wPost, wIso]);

  if (pick === 1 && poster) {
    // send the big to the near block; the entry incentive lives in decideBall.
    // Self-post (poster === holder): he dribbles himself down instead —
    // feederId === posterId marks it, and the working transition waits for
    // ARRIVAL at the block rather than a catch (see the post branch above).
    const side = poster.pos.y < s.court.centerY ? 'post_l' : 'post_r';
    const spot = spacingSpots(s.court, attackedRim(s, s.poss.team)).find((x) => x.key === side)!;
    poster.spotKey = side;
    poster.target = { ...spot.pos };
    s.poss.action = {
      kind: 'post', posterId: poster.p.id, feederId: holderId,
      phase: 'posting', until: s.t + A.postDurationSec, postedAt: 0
    };
    return;
  }
  if (pick === 2) {
    s.poss.action = { kind: 'iso', handlerId: holderId, until: s.t + A.isoDurationSec };
    return;
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

  actionTick(s);
  const act = s.poss.action;

  for (const a of onCourt(s, side)) {
    if (a.fouledOut || a.p.id === s.ball.holderId) continue;

    // a posting big holds the block — no cuts, no relocations, just position
    if (act?.kind === 'post' && a.p.id === act.posterId) {
      a.intent = 'spot';
      a.sprinting = false;
      continue;
    }

    // screener on his way to set (or holding) the screen
    if (act?.kind === 'pnr' && a.p.id === act.screenerId && act.phase !== 'finishing') {
      const handler = agent(s, act.handlerId);
      const onBall = assignedDefender(s, handler);
      // set up beside the defender on the handler's side; once there, PLANT
      // (a screen is a stationary pick — grinding into the defender looks
      // like a collision glitch and is an illegal screen anyway)
      const anchor = onBall ? onBall.pos : handler.pos;
      const toHandler = onBall ? norm(sub(handler.pos, onBall.pos)) : { x: 0, y: 1 };
      const spot = add(anchor, scale(toHandler, 1.6));
      a.target = dist(a.pos, spot) < 0.9 ? a.pos : spot;
      a.intent = 'spot';
      a.sprinting = act.phase === 'coming';
      continue;
    }

    // Finish an active cut: drive hard at a point just short of the rim
    // (lerp 0.06 back toward the cutter keeps him from piling onto the hoop).
    if (s.t < a.cutUntil) {
      a.intent = 'cut';
      a.target = lerp(rim, a.pos, 0.06);
      a.sprinting = true;
      continue;
    }

    // occasionally trigger a cut for motion-heavy players when the lane is
    // open. A DENIED man cuts far more: his defender is top-locked on the
    // ball side (see defenseTick denial), which is exactly when the backdoor
    // is there — the classic counter, and what keeps an all-time shooter's
    // offense alive when the catch is taken away.
    const denyCutMult = gravity(a) > s.params.ai.denyGravityCut ? s.params.ai.denyBackdoorMult : 1;
    if (
      s.poss.phase === 'halfcourt' &&
      a.spotKey !== 'dunker' &&
      s.rng.chance((a.p.tend.offBallMotion / 100) * s.params.ai.cutRateScale * denyCutMult) &&
      // only cut from outside 16 ft — a cut needs runway to be worth anything
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
  // same bench-exhausted fallback as assignSpots/bestHandler: when a whole
  // lineup has fouled out (legal with short rosters), play on rather than
  // index into an empty list — `o[...]!` crashed here in the audit fixture
  const pick = (side: TeamSide) => {
    const live = onCourt(s, side).filter((a) => !a.fouledOut);
    return live.length > 0 ? live : onCourt(s, side);
  };
  const defenders = pick(defSide);
  const attackers = pick(other(defSide));
  // Match by size: height plus a weight term (÷12 puts pounds on roughly the
  // same scale as inches, so a 250 lb wing sorts above a 240 lb one of equal
  // height). Crude but produces sane bigs-on-bigs, guards-on-guards pairings.
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

  // is a help rotation warranted? Drives trigger it, and so does a live
  // post-up being worked on the block — the double-team is what turns the
  // post into a passing hub (help leaves a shooter; the poster sprays)
  const actD = s.poss.action;
  const postWorking =
    holder !== null && actD?.kind === 'post' &&
    actD.posterId === holder.p.id && actD.phase === 'working';
  let helper: Agent | null = null;
  if (holder && (s.t < holder.driveUntil || postWorking)) {
    const dRim = dist(holder.pos, rim);
    if (dRim < s.params.move.helpTriggerFt) {
      // nearest weak-side defender whose man has the least gravity
      let bestScore = Infinity;
      for (const d of onCourt(s, defSide)) {
        if (d.fouledOut || !d.manId || d.manId === holder.p.id) continue;
        // Pick the helper: closest to the rim, but STRONGLY penalized for
        // leaving a shooter (gravity × 26 ft-equivalent). This is the real
        // help-defense dilemma — you rotate off the worst shooter, and elite
        // shooters effectively can't be helped off of. helpAggr scales how
        // much a team tolerates the risk.
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
      // rotate to the rim, shaded 22% up the drive path — meet the driver at
      // the front of the rim rather than standing under the basket
      d.target = lerp(rim, holder.pos, 0.22);
      d.sprinting = true;
      continue;
    }

    // pick-and-roll drop coverage: the screener's defender protects the paint
    const act = s.poss.action;
    if (act && act.kind === 'pnr' && act.phase !== 'coming' && man.p.id === act.screenerId && holder) {
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
      // Beaten on a drive: abandon the cushion and chase the intercept point
      // 30% of the way to the rim — trail the drive rather than the man.
      if (s.t < holder.driveUntil) {
        d.target = lerp(holder.pos, rim, 0.3);
        d.sprinting = true;
      }
      continue;
    }

    // off-ball: guard the man-rim line, sagging with ball distance & low gravity
    const g = gravity(man);
    // DENIAL: an all-time shooter doesn't get guarded, he gets denied — above
    // the gravity threshold the defender shades onto the man-BALL line (top-
    // lock) to take the catch away instead of protecting the drive line.
    // This is what actually caps an elite shooter's volume in real basketball:
    // the fidelity harness's 0.98-gravity benchmark took 22+ threes because
    // openness-priced passes kept finding him — denial prices the pass lane
    // itself (passRisk's lane occlusion reads the defender's position, so
    // feeds to a denied man become genuinely riskier and teammates benefit).
    if (g > A.denyGravityCut && s.ball.holderId && s.ball.holderId !== man.p.id) {
      const toBall = norm(sub(s.ball.pos, man.pos));
      d.target = add(man.pos, scale(toBall, A.denyDistFt));
      continue;
    }
    const guardDist = A.guardDistBase + (1 - g) * A.guardDistOpen;
    const manToRim = norm(sub(rim, man.pos));
    // Stand on the man-rim line at guardDist — but never more than halfway to
    // the rim, or a defender guarding someone in the corner ends up under the
    // basket instead of between his man and it.
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
  // Offense/off-ball: sprint only when the situation demands it (transition,
  // cuts, crashes); otherwise cruise. Defenders are capped by LATERAL speed
  // above, which is why quick-footed guards contain drives better than fast
  // straight-line runners.
  const mult = a.sprinting ? 1 : s.params.move.halfcourtSpeedMult;
  return max * mult;
}
