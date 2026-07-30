/**
 * The bounded-rationality layer, consolidated (INTERNALS design rule 2).
 *
 * The EV core (shotEV / passRisk / the drive option price) is self-consistent
 * with resolution — but real players are not EV-optimizers; they run DRILLED
 * BEHAVIORS. Every non-EV bias in decideBall used to be its own hand-shaped
 * patch (both external reviews called them epicycles, correctly). They are
 * now EIGHT named concepts, each modeling one drilled behavior, each with a
 * MASTER SCALE in params.ai (default 1.0) so the sweep can budget an entire
 * concept — and the whole layer is measured, not assumed small (the
 * decision-vs-EV divergence metric in the harness).
 *
 *   1. DECISIVENESS (decisivenessScale) — a drilled shot fires in its trigger
 *      context: the open catch-and-shoot three, the transition pull-up, the
 *      worked post move, the conceded mid-range jumper. Green-light-gated:
 *      it belongs to shooters/post threats/mid-range artists, never to the
 *      player the defense WANTS shooting.
 *   2. ACTION COMMITMENT (actionCommitScale) — a called action is a plan:
 *      its designed payoff is preferred (entry feed, handoff, attack off the
 *      screen/clear-out) and its carrier waits for it to arrive (screen
 *      coming, DHO sprint, the post backdown, the live drive maturing).
 *   3. ADVANCE THE ADVANTAGE (advantageScale) — passes that improve the
 *      TEAM's position beyond the receiver's immediate shot: hitting a
 *      cutter, swinging the ball, routing up the creation hierarchy.
 *   4. USAGE PRESSURE (usageGainEV — its own closed loop in decideBall) —
 *      load is identity: the gap between a player's target share and his
 *      realized share biases self-creation. Kept where the loop lives.
 *   5. TEMPO (tempoScale) — transition urgency: looks are worth more before
 *      the defense sets, and the window closes fast.
 *   6. GAME-STATE URGENCY (params.endgame.scale — the endgame layer,
 *      GameConfig.endgame only) — the game clock and scoreboard reshape the
 *      CONTINUATION VALUE itself: a leading team's live possession is worth
 *      more unspent (clock-kill), a chasing team's is worth less (hurry),
 *      the period horn is a second shot clock (last shot / 2-for-1). Never
 *      a play call — the same softmax over the same utilities, with the
 *      yardstick moved.
 *   7. SCORE PRESSURE (scorePressureScale) — the all-game margin lean:
 *      trailing presses (the continuation yardstick drops, good-not-great
 *      looks fire earlier), leading coasts (it rises, the leader works
 *      longer). Linear through a tie, saturating at the margin ref; no
 *      flag, no clock window, no aliveness gate — garbage time keeps the
 *      coupling on purpose. TWO channels under the one master: the
 *      continuation tilt (offense, urgency-faded) and the defensive-
 *      intensity gap/slack lean (defense.ts on-ball containment,
 *      deliberately NOT faded — the doctrine at scorePressureDefMult).
 *   8. PROBE CULTURE (probeScale) — early-clock swing appetite: the first
 *      ~5 s of set offense are pass-friendly and shot-averse (probe the
 *      defense before attacking it); ramps to zero by mid-clock, never in
 *      transition, never on the drive channel.
 *
 * Contract for byte-stable refactors: these functions return the SAME terms
 * the inline sites used to compute, in component form — call sites add them
 * in the original order (floating-point addition is order-sensitive; the
 * consolidation must not silently re-tune the engine). At master scale 1.0
 * every term is exactly its pre-consolidation value.
 *
 * Each term's incident history (what broke without it, what flooding it
 * ungated caused) stays in comments on the term that earned it.
 *
 * In-file order: concepts 1, 2, 3, then 6, 5, 7, 8 — the banners are
 * numbered, not sorted. Concept 4 (usage pressure) lives in decide.ts's
 * closed loop, not here.
 */

import { clamp } from '../../core/rng.js';
import { dist } from '../../core/vec.js';
import { other, type Agent, type GameState } from '../state.js';
import type { ShotMoveType, TeamSide } from '../../core/events.js';
import { hurriedness } from '../endgame.js';
import { creation, midGreenLight, midPullUpLight } from './shared.js';

type Action = GameState['poss']['action'];
type ShotMove = ShotMoveType;

// ------------------------------------------------- 1. DECISIVENESS (shoot)

/**
 * Drilled green-light shots. At most one term fires (the contexts are
 * mutually exclusive by shotMove), so this returns a single addition.
 *
 * catch-and-shoot: a genuinely OPEN three off the catch is the payoff of
 * ball movement — letting it fly is drilled behavior, and without this term
 * the continuation value talks every receiver out of shooting (kicks die in
 * re-swings and creators never earn assists). Two gates, both from
 * incidents: contest < 0.5 so only the CREATED advantage fires, not an
 * ordinary swing catch (ungated: pace 133 vs band 95-103); three-point zone
 * only, because the drilled catch-and-shoot is a JUMP-SHOT concept — paint
 * catches are finishes the cut machinery already values, and applying the
 * bonus there flooded the rim and sank 3PA share to 26%. Scaled by the
 * shooter's own three-point appetite with a hard floor at tendency 25: the
 * green light belongs to shooters — a sagged-off big is OPEN precisely
 * because the defense wants him shooting (unscaled, he obliged: bigs
 * chucked ~9% of their FGA from deep and league 3P% sagged).
 *
 * transition pull-up: before the defense sets, a rhythm three off the
 * dribble is a drilled shot for shooters — the trailer/early-offense three
 * a drive-first star actually takes (his halfcourt threes are conceded to
 * the rim threat). Green-light gated identically; without this the downhill
 * benchmark attempted 0.7 threes against a real 5-7.
 *
 * worked post move: after the backdown the turnaround is the plan — without
 * this the spray won 8:1 and post scoring never materialized.
 *
 * mid-range game: the conceded in-between jumper — the elbow pull-up over a
 * defender who went under or sat in drop, the pick-and-pop 16-footer the sag
 * leaves open. Deliberately the one drilled shot whose EV does NOT clear the
 * continuation bar on its own (a three is worth more; the make model prices
 * that honestly, and buffing it to ~65% from 16 ft would be the wrong fix):
 * real mid-range volume is an IDENTITY fact — the artists take it because it
 * is their shot and the defense offers it all game — so the decision layer is
 * where it lives. Pre-term the shot was structurally extinct: argmax in 0 of
 * 780 instrumented decisions at 17-20 ft, mid share 1.4% vs the real 6.8%,
 * and the few "mid" attempts were 20-ft arc-toes. Three gates, all earned:
 * contest < midContestCeil (the drilled middy is a shot the defense at least
 * PARTLY concedes — the ceiling sits above the arc gate's 0.5 because the mid
 * game definitionally lives in front of drop coverage, a defender in the
 * picture; truly smothered it is the bad habit contestBrake already taxes);
 * the shared mid green light (ai/shared.ts midGreenLight — zero for
 * rim-runners, whose open 16-footer is the defense's win); and distance ≤
 * midGreenMaxFt, because the
 * drilled shot is the 14-19.5 ft game, not the 20-23 ft long 2 modern
 * offenses removed (ungated by distance the term would amplify the corner-
 * spot junk 2 at ~21.6 ft — the D3 trickle — and the restored "mid-range"
 * would still be all arc-toes). The pull-up flavor is additionally scaled by
 * tend.pullUp (self-creation off the dribble is its own appetite); the
 * catch-and-shoot flavor is not (the pop catch IS the trigger — a pop big
 * like the postAnchor fixture has pullUp 12 but the elbow face-up is his
 * bread and butter).
 */
export function decisiveness(
  s: GameState, h: Agent, shotMove: ShotMove, zone: string, distFt: number,
  contestLevel: number, act0: Action
): number {
  const A = s.params.ai;
  let term = 0;
  if (shotMove === 'catch_shoot' && zone === 'three') {
    term = A.catchShootBonus
      * clamp((A.catchShootContestCeil - contestLevel) / A.catchShootContestCeil, 0, 1)
      * clamp((h.p.tend.shotThree - A.threeGreenLightFloor) / A.threeGreenLightRange, 0, 1);
  } else if (s.poss.phase === 'transition' && shotMove === 'pull_up' && zone === 'three') {
    term = A.transitionPullUpBonus
      * clamp((h.p.tend.shotThree - A.threeGreenLightFloor) / A.threeGreenLightRange, 0, 1);
  } else if (shotMove === 'post' && act0?.kind === 'post' && s.t - act0.postedAt >= A.postBackdownSec) {
    term = A.postShotBonus;
  } else if (
    zone === 'mid' && distFt <= A.midGreenMaxFt &&
    (h.spotKey === 'elbow_l' || h.spotKey === 'elbow_r') &&
    // identity belt: the "elbow keys come only from mid-gated routes"
    // premise below is pierced by substitution inheritance — swapPlayers
    // copies the outgoing spotKey, and a continuation dead ball resumes the
    // possession without assignSpots, so a zero-mid sub can hold elbow_l/r
    // for its remainder (a8 line audit F1: measured ~0.025 leaked fires per
    // game handing a no-mid-game big the flat bonus on exactly the shot the
    // floor exists to refuse). Every legitimately-routed station passes
    // trivially (the routing cut already requires midGreenLight >= 0.1);
    // an inheritor with no mid game falls through to the gated term below.
    midGreenLight(h) > 0 &&
    (shotMove === 'catch_shoot' || (shotMove === 'pull_up' && h.dribblesSinceCatch === 0))
  ) {
    // the worked elbow shot: an elbow station is reachable through the
    // identity-gated routes (the short pop and the elbow assignment,
    // both cut on the same mid score), so — exactly like the worked post
    // move — the plan itself is the green light and the bonus is flat.
    // It covers the quick catch-and-shoot AND the patient catch-and-FACE
    // (zero dribbles: survey, rise — the delayed rise is still the
    // station's drilled shot, and the make model already charges it the
    // pull-up difficulty). A LIVE-dribble pull-up is genuinely different —
    // self-creation — and falls through to the tendency-gated term below
    // (probe: 38 of 56 elbow-station decisions came after the 0.9 s catch
    // window and died against a zero pullUp gate, which is wrong for a
    // face-up big whose pullUp dial correctly says "no off-dribble game").
    // Contest-gated: a recovered defender erases it and the popper swings.
    term = A.midPopShotBonus * clamp((A.midContestCeil - contestLevel) / A.midContestCeil, 0, 1);
  } else if (
    zone === 'mid' && distFt <= A.midGreenMaxFt &&
    (shotMove === 'pull_up' || shotMove === 'catch_shoot')
  ) {
    // joint identity gate for pull-ups (midPullUpLight — the doctrine and
    // the zero-veto/geometric-mean reasoning live on the helper in
    // ai/shared.ts, shared with the drive stop-short so the snake and the
    // rise belong to the same player); catches gate on the mid appetite
    // alone.
    const moveGate = shotMove === 'pull_up' ? midPullUpLight(h) : midGreenLight(h);
    term = A.midRangeBonus * clamp((A.midContestCeil - contestLevel) / A.midContestCeil, 0, 1) * moveGate;
  }
  return term * A.decisivenessScale;
}

// --------------------------------------- 2. ACTION COMMITMENT (pass/drive/hold)

/**
 * The called action's designed PASS payoff, plus the entry/DHO target flags
 * the call site needs for passKind selection ('entry' / 'handoff'). The pop
 * throwback deliberately carries NO target flag: it is only the utility
 * bonus below, and the event stream labels the pass 'kickout' (handler
 * driving) or 'normal' — only 'handoff' has downstream mechanics anyway
 * (passing.ts catch stun). A popTarget flag used to be returned here and
 * read nowhere (a7 line audit F4; deleted per DO-NOT #5).
 *
 * entry: a big posted and settled on the block wants the entry — the feed is
 * the whole point of the action (any current holder may throw it).
 * handoff: once the DHO receiver has sprinted into range, handing it off IS
 * the play — the catch stuns his trailing defender (passing.ts).
 * pop throwback: the handler comes off the screen reading the BIG. The roll
 * half of that read was already priced (the roll is a cut, so the pocket
 * pass earns the cutter bonus); the pop half had no designed feed, so the
 * popped big stood at the elbow unused (probe: the short pop produced swing
 * stations, not shots). Arrival-gated like the entry — the throwback goes
 * to a popper standing AT his spot, not one mid-relocation.
 */
export function commitmentPass(
  s: GameState, h: Agent, m: Agent, act0: Action
): { entryTarget: boolean; dhoTarget: boolean; entry: number; dho: number; pop: number } {
  const A = s.params.ai;
  const entryTarget =
    act0?.kind === 'post' && act0.phase === 'posting' &&
    m.p.id === act0.posterId && dist(m.pos, m.target) < A.feedArrivalFt;
  const dhoTarget =
    act0?.kind === 'dho' && act0.hubId === h.p.id &&
    m.p.id === act0.receiverId && dist(m.pos, h.pos) < A.dhoHandoffDistFt;
  const popTarget =
    act0?.kind === 'pnr' && act0.phase === 'finishing' &&
    m.p.id === act0.screenerId &&
    (m.spotKey === 'elbow_l' || m.spotKey === 'elbow_r') &&
    dist(m.pos, m.target) < A.feedArrivalFt;
  return {
    entryTarget,
    dhoTarget,
    entry: (entryTarget ? A.postEntryBonus : 0) * A.actionCommitScale,
    dho: (dhoTarget ? A.dhoHandoffBonus : 0) * A.actionCommitScale,
    pop: (popTarget ? A.pnrPopFeedBonus : 0) * A.actionCommitScale
  };
}

/**
 * The called action's designed DRIVE payoff. At most one fires (an action
 * has one kind): attacking off a live screen is the whole point of calling
 * for it; a cleared side is an invitation — the iso call is a commitment to
 * attack.
 */
export function commitmentDrive(s: GameState, holderId: string, act0: Action): number {
  const A = s.params.ai;
  let term = 0;
  if (act0?.kind === 'pnr' && act0.handlerId === holderId && act0.phase !== 'coming') {
    term = A.pnrDriveBonus;
  } else if (act0?.kind === 'iso' && act0.handlerId === holderId) {
    term = A.isoDriveBonus;
  }
  return term * A.actionCommitScale;
}

/**
 * The carrier's PATIENCE while his action matures — hold boosts, returned as
 * components the call site adds in its original order.
 *
 * driveHold: mid-drive, keep attacking. The collapse option priced at launch
 * is still maturing while the dribble is live — without this, hold falls to
 * the halfcourt baseline one tick after launch and every drive ends in an
 * instant kick before the help ever commits. Scaled by remaining drive
 * seconds (capped at driveHoldRampSec): strong at launch, gone by the terminal decision —
 * penetrate first, THEN finish or spray. A flat boost instead suppresses the
 * kick outright and drives die at the rim in contested junk.
 *
 * wait: a screen is on its way — wait for it instead of swinging the ball
 * away (audit: without this, the handler passed before 93% of screens
 * arrived). A live DHO of mine gets the same "wait for the action to
 * arrive" semantics while the receiver sprints in.
 *
 * postWork: the backdown — a post player who just caught the entry works his
 * position for a beat before the shoot-or-spray decision (same shape as the
 * drive hold: the advantage is still maturing while he carves out space).
 * The self-post walk-down gets the same commitment: he CALLED this action —
 * without the boost, a high-vision hub passed away mid-dribble on nearly
 * every self-post and the call never reached the block (fidelity incident:
 * 1.2 post shots/game for a 92-post-tendency center).
 */
export function commitmentHold(
  s: GameState, h: Agent, act0: Action, postingUp: boolean, driving: boolean
): { driveHold: number; wait: number; postWork: number } {
  const A = s.params.ai;
  const driveHold = driving ? A.driveHoldBoost * clamp(h.driveUntil - s.t, 0, A.driveHoldRampSec) : 0;
  let wait = 0;
  if (act0?.kind === 'pnr' && act0.handlerId === h.p.id && act0.phase === 'coming') {
    wait = A.pnrWaitBoost;
  } else if (act0?.kind === 'dho' && act0.hubId === h.p.id) {
    wait = A.pnrWaitBoost;
  }
  let postWork = 0;
  if (postingUp && act0?.kind === 'post' && s.t - act0.postedAt < A.postBackdownSec) {
    postWork = A.postWorkBoost;
  } else if (
    act0?.kind === 'post' && act0.posterId === h.p.id &&
    act0.phase === 'posting' && act0.feederId === act0.posterId
  ) {
    postWork = A.postWorkBoost;
  }
  return {
    driveHold: driveHold * A.actionCommitScale,
    wait: wait * A.actionCommitScale,
    postWork: postWork * A.actionCommitScale
  };
}

// -------------------------------------- 3. ADVANCE THE ADVANTAGE (pass)

/**
 * Passes that improve the TEAM's position beyond the receiver's own shot,
 * returned as components the call site adds in its original order.
 *
 * cutter: hitting an active cutter is the highest-leverage read in motion
 * offense. swing: ball movement has baseline value (swingBase) shaped by the
 * passer's willingness (passOut) and vision. pull: re-initiation — routing
 * the ball UP the creation hierarchy has value beyond the receiver's own
 * shot (he creates the NEXT action). Relative and clamped at zero: the
 * primary feels no pull toward lesser handlers, but passing DOWN is never
 * penalized — a kick-out is judged on shot merit alone (penalizing it
 * produced a ball-stopping primary). Clock-scaled: hierarchy is an
 * early-offense concept — as the clock drains, shot value takes over.
 */
export function advantagePass(
  s: GameState, h: Agent, m: Agent, cutting: boolean, shotClockShare: number
): { cutter: number; swing: number; pull: number; passBack: number } {
  const A = s.params.ai;
  const cutter = cutting ? A.cutterBonus : 0;
  const swing =
    A.swingBase +
    ((h.p.tend.passOut - 50) / 100) * A.swingPassOutScale +
    ((h.p.attr.passVision - 50) / 100) * A.swingVisionScale;
  const pull =
    (Math.max(0, creation(m) - creation(h)) / 100) * A.playmakerScale * shotClockShare;
  // the negative side of advancing: an immediate return pass UNDOES it —
  // it recreates the geometry the last pass just left. Freshness-decayed;
  // a true give-and-go survives because the returner is cutting (the
  // cutter term prices the advancing half of the play). Texture incident:
  // 26.8% of all passes were A->B->A returns inside 3s before this term.
  const lp = s.poss.lastPass;
  const age = lp ? s.t - lp.t : Infinity;
  const passBack = lp && lp.from === m.p.id && age < A.passBackWindowSec
    ? -A.passBackMalus * clamp(1 - age / A.passBackWindowSec, 0, 1)
    : 0;
  return {
    cutter: cutter * A.advantageScale,
    swing: swing * A.advantageScale,
    pull: pull * A.advantageScale,
    passBack: passBack * A.advantageScale
  };
}

// ------------------------------------- 6. GAME-STATE URGENCY (continuation)

/**
 * The endgame layer's ball-handler half (GameConfig.endgame only — decide.ts
 * never calls this on the default path, so flag-off is byte-identical).
 *
 * The base continuation curve assumes an endless game: "what the remaining
 * shot-clock seconds are worth" with no scoreboard and no horn. Real late-
 * game basketball is exactly the places that assumption breaks, so every
 * behavior here is a reshaping of that ONE number — the yardstick every
 * action is already measured against — rather than any new action:
 *
 *  - HORN COLLAPSE: the period clock is a second shot clock. Inside the
 *    urgency window of the HORN, the continuation collapses the same way it
 *    already does for the shot clock (min of the two governs). Without
 *    this, a team catching the ball with 8 s in a period idles into the
 *    heave check; with it, quarter endings produce a real last shot.
 *  - CLOCK-KILL (leading, final period): every second burned is worth
 *    points — the opponent's chase needs possessions and the clock is
 *    denying them. Continuation RISES (ramping toward the horn, fading in
 *    blowouts), so early-clock looks that used to fire now lose to "keep
 *    working" and the possession drains to the urgency window before the
 *    offense attacks: milk to ~:07, then play. The boost itself fades
 *    inside the urgency window (holdFade) — late-clock offense is
 *    UNCHANGED, so shot-clock violations don't spike.
 *  - HURRY (trailing, final period): the mirror image — a chasing team's
 *    unspent seconds are a cost, not an asset. Continuation FALLS by the
 *    shared hurriedness signal (sim/endgame.ts: clock ramp × deficit depth
 *    × chase-aliveness), so good-not-great early looks fire immediately.
 *  - HOLD FOR ONE: inside ~one possession of any period's horn (and, in the
 *    final period, only when tied/leading or down ≤ lastShotDeficitMax —
 *    down 4+ the hurry keeps the wheel), deny the opponent a rebuttal:
 *    continuation rises until the horn collapse releases the last shot.
 *  - 2-FOR-1 (non-final periods): in the ~0:28-0:38 window, acting early
 *    buys a whole extra possession, so the remaining seconds of THIS
 *    possession are worth less — a tent-shaped continuation cut produces
 *    the early, slightly-worse shot that real 2-for-1 hunting is.
 */
export function endgameContinuation(
  s: GameState, side: TeamSide, continuation: number
): number {
  const E = s.params.endgame;
  const U = s.params.decide.urgencySec;
  const sc = Math.max(0, s.poss.shotClock);
  const clock = s.clock;
  let mult = 1;

  // horn collapse — bring the period clock into the urgency window the base
  // curve already applies to the shot clock (factor of clamp(x/U) on the
  // BINDING clock; divide out what the base already applied for sc)
  if (clock < sc) {
    const applied = sc < U ? sc / U : 1;
    const desired = clamp(clock / U, 0, 1);
    if (desired < applied) mult *= desired / Math.max(1e-6, applied);
  }

  // every HOLD-side boost dies inside the urgency window: milking never
  // re-inflates a collapsing continuation (that would manufacture violations)
  const eff = Math.min(sc, clock);
  const holdFade = clamp((eff - U) / U, 0, 1);

  const margin = s.score[side] - s.score[other(side)];
  // Regime table for the branches below — first matching row wins:
  //   period    condition                                      regime        mult
  //   final     leading, clock ≤ leadHoldClockSec              CLOCK-KILL    rises
  //   final     tied,    clock ≤ holdForOneClockSec            HOLD FOR ONE  rises
  //   final     down ≤ lastShotDeficitMax, ≤ holdForOneClock   HOLD FOR ONE  rises
  //   final     trailing otherwise                             HURRY         falls
  //   non-final clock in the 2-for-1 window                    2-FOR-1       falls
  //   non-final clock ≤ holdForOneClockSec                     HOLD FOR ONE  rises
  // (the horn collapse above applies in every regime; holdFade kills every
  // "rises" row inside the urgency window)
  if (s.period >= s.rules.periods) {
    if (margin > 0 && clock <= E.leadHoldClockSec) {
      const ramp = 1 - clock / E.leadHoldClockSec;
      // full effect while the lead is worth protecting, gone by 2× the ref
      // (a 16+ point Q4 lead is garbage time, nobody is milking with intent)
      const blowoutFade = clamp(2 - margin / E.leadHoldMarginRef, 0, 1);
      mult *= 1 + E.scale * E.leadHoldMaxBoost * ramp * blowoutFade * holdFade;
    } else if (margin === 0 && clock <= E.holdForOneClockSec) {
      // tied, one possession left: the last shot wins the game — hold for it
      mult *= 1 + E.scale * E.holdForOneBoost * holdFade;
    } else if (margin < 0) {
      const deficit = -margin;
      if (clock <= E.holdForOneClockSec && deficit <= E.lastShotDeficitMax) {
        // down one score with one possession left: the shot that ties/wins
        // is THE possession — patience, not panic
        mult *= 1 + E.scale * E.holdForOneBoost * holdFade;
      } else {
        mult *= 1 - E.scale * E.hurryMaxCut * hurriedness(s, side);
      }
    }
  } else if (clock >= E.twoForOneMinClockSec && clock <= E.twoForOneMaxClockSec) {
    // 2-for-1: tent across the window — strongest at its center, where the
    // possession arithmetic is cleanest
    const mid = (E.twoForOneMinClockSec + E.twoForOneMaxClockSec) / 2;
    const half = Math.max(1e-6, (E.twoForOneMaxClockSec - E.twoForOneMinClockSec) / 2);
    const tent = 1 - Math.abs(clock - mid) / half;
    // floored at 0: a continuation yardstick can never go NEGATIVE ("keep
    // working" priced below zero would flip the pass channel's continuation
    // tax into a subsidy). Unreachable at defaults, but the sweep box allows
    // scale × twoForOneCut > 1 (rails 1.5 × 0.7), where the tent peak would
    // cross zero at the window center (a8 line audit F2).
    mult *= Math.max(0, 1 - E.scale * E.twoForOneCut * tent);
  } else if (clock <= E.holdForOneClockSec) {
    // quarter-ending possession (any score): deny the rebuttal, take the last shot
    mult *= 1 + E.scale * E.holdForOneBoost * holdFade;
  }
  return continuation * mult;
}

// ------------------------------------------------------- 5. TEMPO (shoot/drive)

/**
 * Transition urgency: looks are worth extra before the defense sets. The
 * drive channel weighs it by driveTransitionMult (getting downhill in
 * transition is the highest-value version of the window).
 *
 * Two layers, both dead once the defense is set (the phase flip at
 * transSetBackCount back is itself the state gate):
 *  - transitionBonus: the original flat early-offense term (SWEPT).
 *  - stealBreakBonus: the live-ball break premium — a steal catches the
 *    defense mid-offense (facing the wrong way, cross-matched, floor
 *    balance gone), a categorically better break than the push off a
 *    defensive rebound. REAL: ~1.2-1.3 PPP off steals vs ~1.05-1.1 off
 *    rebounds. Deliberately FLAT through the phase rather than scaled by
 *    defenders-back: the probe showed a headcount-scaled bonus fades
 *    exactly when the finish decision arrives (defenders got back DURING
 *    the push), gutting per-attempt quality — while the organized-vs-caught
 *    distinction the premium prices outlives the raw headcount (a defense
 *    that sprinted back off a steal is home but not matched up).
 */
export function tempo(s: GameState): { shoot: number; drive: number } {
  const D = s.params.decide;
  const A = s.params.ai;
  let term = 0;
  if (s.poss.phase === 'transition') {
    term = D.transitionBonus + (s.poss.kind === 'steal' ? D.stealBreakBonus : 0);
  }
  return {
    shoot: term * A.tempoScale,
    drive: term * A.driveTransitionMult * A.tempoScale
  };
}

// ------------------- 7. SCORE PRESSURE (continuation + defensive intensity)

/**
 * The shared scoreboard read for BOTH concept-7 channels: signed pressure
 * from `side`'s own chair. + when trailing (press: the yardstick drops,
 * good-not-great looks fire earlier; the defense plays up), − when leading
 * (coast: the yardstick rises, the leader works longer; the defense sags).
 * Linear through a tie, saturating at scorePressureMarginRef — clamp, not
 * tanh (exactly reproducible arithmetic; same saturation style as
 * leadHold's clamp). Pure arithmetic over s.score + params: no rng, no
 * events, no state writes. Consumed by scorePressure (channel 1, the
 * decideBall continuation) and scorePressureDefMult (channel 2, the
 * defense.ts containment posture).
 */
export function scorePressureOf(s: GameState, side: TeamSide): number {
  const A = s.params.ai;
  return clamp((s.score[other(side)] - s.score[side]) / A.scorePressureMarginRef, -1, 1);
}

/**
 * Channel 1 — the all-game score coupling on the continuation yardstick:
 * the scoreboard reshapes it exactly the way concept 6 does, but as a
 * gentle, symmetric, always-on lean — no flag, no rng, no events, no state
 * writes, no clock window, no aliveness gate. Trailing presses (the
 * yardstick drops, so good-not-great looks fire earlier across every
 * channel that measures against it); leading coasts (the yardstick rises,
 * so the leader works longer and surrenders the early-offense premium).
 * Garbage time keeps the coupling ON PURPOSE — the never-flattening
 * blowout is exactly the region concept 6's own fades (blowoutFade,
 * chaseAliveness) deliberately give up.
 *
 * Called from decideBall on EVERY path, immediately BEFORE the concept-6
 * reshape — base lean first, late spike second (multiplicative, so value-
 * commutative, but float order is part of the byte-stability contract
 * above). At the STAGED default (scorePressureTilt 0) the multiplier is
 * exactly 1 and the continuation passes through bit-identical.
 */
export function scorePressure(s: GameState, side: TeamSide, continuation: number): number {
  const A = s.params.ai;
  const pressure = scorePressureOf(s, side);
  // the boost half must die inside the urgency window — a leader's raised
  // yardstick must never re-inflate a collapsing continuation (that would
  // manufacture shot-clock violations; same doctrine as concept 6's holdFade
  // in endgameContinuation above). Applied symmetrically to keep the function
  // branch-free: a press cut inside the window is redundant anyway (urgency
  // already forces the shot). min(sc, clock) keeps period horns out of it.
  const eff = Math.min(Math.max(0, s.poss.shotClock), s.clock);
  const U = s.params.decide.urgencySec;
  const fade = clamp((eff - U) / U, 0, 1);
  return continuation * (1 - A.scorePressureScale * A.scorePressureTilt * pressure * fade);
}

/**
 * Channel 2 — DEFENSIVE INTENSITY — the LIVE half of concept 7: it ships
 * at the θ-ladder-FITTED scorePressureDefGain 0.3 (tune commit fe2624d;
 * provenance in params.ts, pinned from both chairs by coupling.test.ts).
 * It was chosen BY the channel-1 θ null (findings/b2-fit-tilt*.md measured
 * the continuation tilt flat on θ across 0.05→0.20, the
 * design-coupling.md §3 staged-channel-2 / OQ1 trigger).
 * The multiplier defense.ts#containOnBall applies to the on-ball
 * containment gap AND the closeout slack. A trailing team's defense
 * presses UP — tighter gap, less slack before the closeout sprint fires —
 * so contest levels rise and opponent make% falls through
 * shot.contestCoef; a leading team's defense sags OFF — softer contests,
 * protect the drive line, let the clock work. Same master:
 * scorePressureScale budgets both channels (scale × gain), same clamp
 * saturation via scorePressureOf.
 *
 * Deliberately NO urgency fade — the asymmetry vs channel 1 is doctrine,
 * not an omission. Channel 1's fade exists because a leader's RAISED
 * yardstick inside the urgency window would re-inflate a collapsing
 * continuation and manufacture shot-clock violations — an offense-only
 * failure mode (the yardstick decides WHEN the shot fires). Gap and slack
 * shape contest quality and closeout sprinting; they cannot create
 * violations, and real late-game defense stays pressed to the horn.
 *
 * Pure arithmetic over s.score + params: no rng (gap/slack shift positions
 * and downstream probabilities, never draw counts), no events, no state
 * writes. The gain-0 null is exact (0 × pressure = ±0; 1 − ±0 === 1, so
 * gap × 1 and slack × 1 pass through bit-identical) — that is how the
 * wiring originally shipped (STAGED at 6f953a0) and remains the provable
 * off-switch, but it is NOT the shipped default anymore: fe2624d turned
 * the coupling live at gain 0.3.
 */
export function scorePressureDefMult(s: GameState, defSide: TeamSide): number {
  const A = s.params.ai;
  // SIGN CONVENTION: the pressure is read from the DEFENDING team's chair —
  // defSide is the defender's OWN side, so scorePressureOf is positive when
  // the defender's team trails ⇒ multiplier < 1 ⇒ tighter (press up), and
  // negative when it leads ⇒ multiplier > 1 ⇒ looser (sag off). Feeding the
  // offense's side here would invert the whole coupling.
  return 1 - A.scorePressureScale * A.scorePressureDefGain * scorePressureOf(s, defSide);
}

// ------------------------------------------- 8. PROBE CULTURE (pass/shoot)

/**
 * The early-clock probe window ("swing culture"): real offenses probe
 * before they attack — the first ~5 s of halfcourt offense are
 * pass-friendly and shot-averse (side-to-side swings against a SET
 * defense), then the possession attacks. The engine otherwise has no
 * clock-shaped pass appetite at all: swing value is flat, and the only
 * clock-scaled pass term (the hierarchy pull) routes up-hierarchy only.
 * The window converts early HOLD windows into passes — exactly the windows
 * where drives haven't launched yet, which is what protects FTA — and its
 * passes sit well upstream of eventual shots, which is what protects
 * assisted share.
 *
 * Called from decideBall each decision. Returns the swing bonus (appended
 * at the END of the pass-utility sum) and the shoot malus (appended at the
 * END of the uShoot sum) — deliberately NOT applied to the drive channel
 * (drives keep firing in-window: the FTA protection) and NOT to the
 * continuation itself (measured poison: a yardstick raise taxes passes at
 * ~90% through passContinuationScale). Phase-gated to the set offense and
 * NEVER transition — the wave2 rejection record below: transition-side
 * subsidies feed hit-ahead swings and inflate assisted share, and the
 * stealBreakBonus economics must stay untouched. The ramp is full strength
 * off the walk-up, zero by mid-clock, hard zero long before urgencySec —
 * no violation risk by construction. Pure arithmetic over the shot-clock
 * share and params: no rng, no state writes, no events.
 */
export function probeCulture(s: GameState, shotClockShare: number): { swing: number; shoot: number } {
  const A = s.params.ai;
  if (s.poss.phase !== 'halfcourt' && s.poss.phase !== 'advance') {
    return { swing: 0, shoot: 0 };
  }
  // linear ramp: 1 at a full clock, 0 once the share falls to probeClockShare.
  // The divisor is floored: at the documented-illegal probeClockShare = 1 the
  // raw ramp is 0/0 → NaN, which the zero magnitudes below do NOT neutralize
  // (0 × NaN = NaN) — utilities would go NaN and Rng.weighted throws
  // mid-game. The floor keeps every legal share (< 1) bit-identical and turns
  // the illegal input into a harmless w = 0 instead of a crash (a7 line
  // audit F3).
  const w = clamp((shotClockShare - A.probeClockShare) / Math.max(1e-6, 1 - A.probeClockShare), 0, 1);
  return {
    swing: A.probeSwingBonus * w * A.probeScale,
    shoot: A.probeShootMalus * w * A.probeScale
  };
}

/*
 * NOTE (wave2/shotmix, probed-and-rejected): a state-aware CONTINUATION cut
 * — continuation × (1 − cut × unsetness), unsetness from the shared
 * defenders-back count — was the diagnostic's preferred design for
 * transition urgency and was implemented and measured here in five shapes
 * across two seed bases. Every shape lost to the flat, phase-gated
 * stealBreakBonus above: the yardstick cut moves the PASS bar too, feeding
 * the break to hit-ahead swings (assisted share +4-10pp over a band the
 * engine already exceeds), and headcount scaling fades exactly as defenders
 * get back DURING the push — gutting the finish decision the window exists
 * to reward. The phase flip at transSetBackCount back (game.ts, shared
 * definition in resolve.ts defendersBack) is itself the state gate; the
 * surviving state-aware piece is the defender-aware projected drive contest
 * in decide.ts. Numbers in params.decide.stealBreakBonus's comment.
 */
