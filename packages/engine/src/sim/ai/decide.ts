/**
 * The ball-handler's brain. Everything in `decideBall` is denominated in
 * EXPECTED POINTS. Each candidate action gets a utility; a softmax over those
 * utilities picks one. So:
 *   • a term of +0.1 means "worth a tenth of a point"
 *   • the yardstick every action is measured against is `continuation` — the
 *     expected points of NOT acting yet (keep working the possession)
 *   • all weights come from SimParams.ai so the sweep can reach them
 *
 * Behavior EMERGES from utility comparisons fed by the same probability
 * models that resolve outcomes. Drive-and-kick isn't scripted — help
 * convergence lowers the drive EV and raises the kickout EV, so the pass
 * happens. Tendencies bias utilities; attributes change the underlying EVs.
 */

import { clamp } from '../../core/rng.js';
import { dist, lerp, segmentT, type V2 } from '../../core/vec.js';
import { n } from '../../model/derived.js';
import type { ShotMoveType } from '../../core/events.js';
import { classifyShot } from '../../geometry/court.js';
import { agent, attackedRim, liveOnCourt, other, type Agent, type GameState } from '../state.js';
import { anticipatedContest, defendersBack, openness, passRisk, shotEV } from '../resolve.js';
import { onBallDefender } from './shared.js';
import { advantagePass, commitmentDrive, commitmentHold, commitmentPass, decisiveness, endgameContinuation, tempo } from './concepts.js';

export type BallAction =
  | { kind: 'shoot'; moveType: ShotMoveType }
  | { kind: 'pass'; toId: string; passKind: 'normal' | 'kickout' | 'outlet' | 'entry' | 'handoff' }
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

  // CONTINUATION VALUE — the yardstick for every decision below.
  // "What are the remaining seconds of this possession worth if I don't act?"
  // Decays as the shot clock drains, then collapses linearly inside the
  // urgency window (any shot beats a violation). This single curve is what
  // produces patient early-clock offense and desperate late-clock heaves.
  const full = s.rules.shotClockSec;
  const sc = Math.max(0, s.poss.shotClock);
  let continuation = D.continuationMax * Math.pow(sc / full, D.continuationCurve);
  if (sc < D.urgencySec) continuation *= sc / D.urgencySec;
  // CONCEPT 6: GAME-STATE URGENCY (endgame layer, GameConfig.endgame only) —
  // scoreboard and game clock reshape the yardstick itself: clock-kill with
  // a lead, hurry-up when chasing, hold-for-one / 2-for-1 at period ends.
  // Doctrine in ai/concepts.ts; flag off never reaches this call.
  if (s.endgame) continuation = endgameContinuation(s, h.side, continuation);

  // Desperation heave: with <1.2s of shot clock (or a period expiring inside
  // 2.5s) and no chance to get closer than 32 ft, just launch it. Bypasses the
  // whole utility comparison — no shot is "good", but a violation is worse.
  const periodExpiring = s.clock < 2.5 && s.clock < sc;
  if ((sc < 1.2 || periodExpiring) && distToRim > 32) {
    return { kind: 'shoot', moveType: 'heave' };
  }

  // Which KIND of shot this would be — drives the difficulty adjustment and
  // the windup length. A 0-dribble shot inside the quick window
  // (decide.quickCatchSec) is an off-the-touch release, and WHAT it is
  // depends on where it's from and how the ball arrived (h.acquiredBy):
  //   • perimeter (mid/three): a catch-and-shoot jumper — the tracking
  //     definition (0 dribbles, quick touch) regardless of acquisition; only
  //     a real caught pass carries delivery quality (giveBall neutralizes
  //     catchQuality on non-pass touches, so the passQ term stays honest).
  //   • interior (rim/paint) off a PASS: a cut finish — caught in stride and
  //     laid in (moveCutFinish/windupCutFinish existed for exactly this but
  //     were assigned nowhere; the shot wore a jump-shot label instead).
  //   • interior off a REBOUND: a putback — the decision-layer sibling of
  //     possession.ts's automatic putback branch.
  //   • interior off a steal/dead-ball touch (rare): a scramble finish
  //     through traffic — 'drive' is the honest difficulty for going up
  //     amid bodies without a delivery.
  // Before acquisition-aware labels, ANY quick 0-dribble shot was
  // 'catch_shoot': 22% of all attempts were interior shots counted as
  // catch-and-shoot jumpers, poisoning the shot-mix report (wave2 diagnostic).
  const driving = s.t < h.driveUntil;
  const sinceCatch = s.t - h.catchT;
  const act0 = s.poss.action;
  // working the block: shots from a live post-up resolve as post moves
  // (windupPost + movePost in the shot model) instead of hurried pull-ups
  const postingUp = act0?.kind === 'post' && act0.posterId === h.p.id && act0.phase === 'working';
  const quickTouch = sinceCatch < D.quickCatchSec && h.dribblesSinceCatch === 0;
  const loc = classifyShot(s.rules, s.court, rim, h.pos);
  const interior = loc.zone === 'rim' || loc.zone === 'paint';
  const shotMove: ShotMoveType =
    // post-shot zone boundary — 14 ft from the rim is the outer edge of the
    // traditional post area. FEEL — same numerical value as move.nearRimFt
    // (the contest model's interior boundary) but a distinct physical concept:
    // this gates the SHOT TYPE (post vs pull-up), not the defensive role blend.
    postingUp && distToRim < 14 ? 'post'
      : driving && distToRim < 12 ? 'drive'
      : !quickTouch ? 'pull_up'
      : !interior ? 'catch_shoot'
      : h.acquiredBy === 'rebound' ? 'putback'
      : h.acquiredBy === 'pass' ? 'cut_finish'
      : 'drive';

  // judge the shot against the contest expected AT RELEASE, not right now —
  // a defender sprinting into a closeout makes the look worse than it seems
  const W = s.params.shot;
  const windup =
    shotMove === 'catch_shoot' ? W.windupCatchShoot :
    shotMove === 'pull_up' ? W.windupPullUp :
    shotMove === 'post' ? W.windupPost :
    shotMove === 'cut_finish' ? W.windupCutFinish :
    shotMove === 'putback' ? W.windupPutback : W.windupDrive;
  const contest = anticipatedContest(s, h, h.pos, windup);
  const myShot = shotEV(s, h, h.pos, shotMove, contest);

  // --- utility: shoot
  const zoneTend =
    myShot.zone === 'rim' || myShot.zone === 'paint' ? h.p.tend.shotRim :
    myShot.zone === 'mid' ? h.p.tend.shotMid : h.p.tend.shotThree;
  let shootBias = ((zoneTend - 50) / 100) * A.zoneTendBias;
  if (shotMove === 'pull_up') shootBias += ((h.p.tend.pullUp - 50) / 100) * A.pullUpBias;
  if (myShot.zone === 'three') {
    // The ERA appetite expresses through the PLAYER's tendency (t/50: neutral
    // at 50, doubled for a 99, faded for a 20): a three-happy era hands its
    // green light to SHOOTERS — it does not turn hubs and rim-runners into
    // volume bombers. Flat, the texture re-tune's appetite=1.3 dragged the
    // hub benchmark to 5.9 threes (cap 5.5) and diluted his FG%, while the
    // elite shooter's SHARE of team threes was crowded out (fidelity
    // incident, texture increment).
    shootBias += (D.threeAppetite - 1) * A.threeApptScale * (h.p.tend.shotThree / 50) + ((tactics.threeBias - 50) / 100) * A.tacticsThreeScale;
  }
  // CONCEPT 1: DECISIVENESS — drilled green-light shots (catch-and-shoot
  // three, transition pull-up, worked post move, conceded mid-range jumper).
  // The doctrine and every gate's incident history live in ai/concepts.ts.
  shootBias += decisiveness(s, h, shotMove, myShot.zone, myShot.distFt, contest.level, act0);
  // USAGE PRESSURE — the closed loop that makes load an identity. The dial
  // (tend.usage) sets a target share of team offense; the gap between it and
  // the REALIZED share this game biases the self-creation options. An
  // under-fed star hunts, an over-fed one defers, a hot role player cools
  // off. This is what EV alone can't express: a 99-vision hub's passes
  // always out-value his shots, yet the real player takes 17 a game because
  // consuming offense IS his role (fidelity incident: 9 FGA vs 17 target).
  const usageTarget = 0.2 + ((h.p.tend.usage - 50) / 100) * A.usageShareSwing;
  const usageRealized =
    (h.usedPoss + A.usagePriorPoss * usageTarget) /
    (h.teamPossOnCourt + A.usagePriorPoss);
  const usagePressure = clamp(usageTarget - usageRealized, -0.25, 0.25) * A.usageGainEV;

  // shooting over a contest is a bad habit; smart players pass out of it
  const contestBrake =
    clamp(contest.level - A.contestBrakeAt, 0, 1) *
    (A.contestBrakeBase + ((h.p.attr.decisions - 50) / 100) * A.contestBrakeIQ);
  // CONCEPT 5: TEMPO — transition looks are worth extra before the defense
  // sets (flat early-offense term + the steal-break premium; concepts.ts)
  const T = tempo(s);
  const uShoot = myShot.ev + shootBias + T.shoot + usagePressure - continuation - contestBrake;

  // --- utility: pass to each teammate
  let bestPass: { toId: string; u: number; passKind: 'normal' | 'kickout' | 'outlet' | 'entry' | 'handoff' } | null = null;
  let bestCatchEv = -Infinity; // best teammate look as-is — the drive block prices the collapse off it
  for (const m of liveOnCourt(s, h.side)) {
    if (m.p.id === h.p.id) continue;
    const o = openness(s, m);
    const catchContest = { level: clamp((1 - o) * A.catchContestScale, 0, 1), by: null, heightAdvFt: 0.5 };
    // value the pass WITH my own delivery quality — the same term the make
    // model applies at resolution (self-consistency: chooser and outcome
    // share one belief about what my pass is worth to his shot)
    const myDelivery = n((h.p.attr.passAcc + h.p.attr.passVision) / 2);
    // ...and with the same TYPE resolution would assign his immediate rise:
    // an interior receiver's quick catch is a cut finish (caught in stride),
    // not a jump shot — the chooser must price the pass the way the make
    // model will resolve it, or it systematically undervalues the feed the
    // taxonomy now rewards (self-consistency, same rule as the delivery term)
    const mLoc = classifyShot(s.rules, s.court, rim, m.pos);
    const mMove: ShotMoveType = mLoc.zone === 'rim' || mLoc.zone === 'paint' ? 'cut_finish' : 'catch_shoot';
    const theirShot = shotEV(s, m, m.pos, mMove, catchContest, myDelivery);
    if (theirShot.ev > bestCatchEv) bestCatchEv = theirShot.ev;
    const risk = passRisk(s, h, m);
    // CONCEPT 3: ADVANCE THE ADVANTAGE (cutter / swing / hierarchy pull) and
    // CONCEPT 2: ACTION COMMITMENT (the called action's designed feed) — the
    // doctrine and incident history live in ai/concepts.ts; components are
    // added in the original order (floating-point order is part of the
    // determinism contract).
    const adv = advantagePass(s, h, m, s.t < m.cutUntil, sc / full);
    const pay = commitmentPass(s, h, m, act0);
    const u =
      theirShot.ev * (1 - risk.turnoverP * A.passRiskUtilMult) * A.passEVScale
      + adv.cutter + adv.swing + adv.pull + adv.passBack + pay.entry + pay.dho + pay.pop
      - continuation * A.passContinuationScale;
    if (bestPass === null || u > bestPass.u) {
      bestPass = {
        toId: m.p.id,
        u,
        passKind: pay.dhoTarget ? 'handoff'
          : pay.entryTarget ? 'entry'
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
    // the projected-contest FLOOR is defender-aware: driveProjContestBase
    // prices the help expected to arrive by the finish, and help can only
    // come from defenders who are actually back — on a set floor (back ≥
    // transSetBackCount) the full base applies, on a naked rim there is no
    // one to project. Before this, the flat 0.35 floor contested an EMPTY
    // floor and drives never beat the continuation after a steal (wave2
    // diagnostic: driveEv ~1.01 vs cont 1.47 on the break).
    const backShare = clamp(defendersBack(s, h.side) / s.params.move.transSetBackCount, 0, 1);
    const projContest = {
      level: clamp(A.driveProjContestBase * backShare + laneCrowd * A.driveProjContestCrowd, 0, 1),
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
    uDrive = usagePressure + handling * (driveDiff >= 0 ? driveDiff : driveDiff * A.driveAbortDiscount)
      + tendTerm + T.drive - laneCrowd * A.laneCrowdPenalty + A.driveFlat;
    // CONCEPT 2: ACTION COMMITMENT (drive payoff) — attack the called action
    // (live screen, cleared side); doctrine in ai/concepts.ts
    uDrive += commitmentDrive(s, h.p.id, act0);
  }

  // --- utility: hold (keep probing)
  let uHold = s.poss.phase === 'advance' ? A.holdAdvance : A.holdHalfcourt;
  // CONCEPT 2: ACTION COMMITMENT (patience) — the carrier waits for his
  // called action to mature (live drive, arriving screen, DHO sprint, the
  // post backdown). Doctrine and incident history in ai/concepts.ts;
  // components added in the original order.
  const pat = commitmentHold(s, h, act0, postingUp, driving);
  uHold += pat.driveHold;
  uHold += pat.wait;
  uHold += pat.postWork;

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
  for (const d of liveOnCourt(s, other(h.side))) {
    const t = segmentT(h.pos, rim, d.pos);
    if (t > 0.15 && t < 0.95) {
      const lat = dist(d.pos, lerp(h.pos, rim, t));
      if (lat < 5) count += 1 - lat / 5;
    }
  }
  return count;
}
