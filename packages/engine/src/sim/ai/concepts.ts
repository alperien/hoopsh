/**
 * The bounded-rationality layer, consolidated (INTERNALS design rule 2).
 *
 * The EV core (shotEV / passRisk / the drive option price) is self-consistent
 * with resolution — but real players are not EV-optimizers; they run DRILLED
 * BEHAVIORS. Every non-EV bias in decideBall used to be its own hand-shaped
 * patch (both external reviews called them epicycles, correctly). They are
 * now FIVE named concepts, each modeling one drilled behavior, each with a
 * MASTER SCALE in params.ai (default 1.0) so the sweep can budget an entire
 * concept — and the whole layer is measured, not assumed small (the
 * decision-vs-EV divergence metric in the harness).
 *
 *   1. DECISIVENESS (decisivenessScale) — a drilled shot fires in its trigger
 *      context: the open catch-and-shoot three, the transition pull-up, the
 *      worked post move. Green-light-gated: it belongs to shooters/post
 *      threats, never to the player the defense WANTS shooting.
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
 *
 * Contract for byte-stable refactors: these functions return the SAME terms
 * the inline sites used to compute, in component form — call sites add them
 * in the original order (floating-point addition is order-sensitive; the
 * consolidation must not silently re-tune the engine). At master scale 1.0
 * every term is exactly its pre-consolidation value.
 *
 * Each term's incident history (what broke without it, what flooding it
 * ungated caused) stays in comments on the term that earned it.
 */

import { clamp } from '../../core/rng.js';
import { dist } from '../../core/vec.js';
import { type Agent, type GameState } from '../state.js';
import { creation } from './shared.js';

type Action = GameState['poss']['action'];
type ShotMove = 'catch_shoot' | 'pull_up' | 'drive' | 'heave' | 'post';

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
 */
export function decisiveness(
  s: GameState, h: Agent, shotMove: ShotMove, zone: string,
  contestLevel: number, act0: Action
): number {
  const A = s.params.ai;
  let term = 0;
  if (shotMove === 'catch_shoot' && zone === 'three') {
    term = A.catchShootBonus * clamp((0.5 - contestLevel) / 0.5, 0, 1) * clamp((h.p.tend.shotThree - 25) / 75, 0, 1);
  } else if (s.poss.phase === 'transition' && shotMove === 'pull_up' && zone === 'three') {
    term = A.transitionPullUpBonus * clamp((h.p.tend.shotThree - 25) / 75, 0, 1);
  } else if (shotMove === 'post' && act0?.kind === 'post' && s.t - act0.postedAt >= A.postBackdownSec) {
    term = A.postShotBonus;
  }
  return term * A.decisivenessScale;
}

// --------------------------------------- 2. ACTION COMMITMENT (pass/drive/hold)

/**
 * The called action's designed PASS payoff, plus the target flags the call
 * site needs for passKind selection.
 *
 * entry: a big posted and settled on the block wants the entry — the feed is
 * the whole point of the action (any current holder may throw it).
 * handoff: once the DHO receiver has sprinted into range, handing it off IS
 * the play — the catch stuns his trailing defender (passing.ts).
 */
export function commitmentPass(
  s: GameState, h: Agent, m: Agent, act0: Action
): { entryTarget: boolean; dhoTarget: boolean; entry: number; dho: number } {
  const A = s.params.ai;
  const entryTarget =
    act0?.kind === 'post' && act0.phase === 'posting' &&
    m.p.id === act0.posterId && dist(m.pos, m.target) < 4;
  const dhoTarget =
    act0?.kind === 'dho' && act0.hubId === h.p.id &&
    m.p.id === act0.receiverId && dist(m.pos, h.pos) < A.dhoHandoffDistFt;
  return {
    entryTarget,
    dhoTarget,
    entry: (entryTarget ? A.postEntryBonus : 0) * A.actionCommitScale,
    dho: (dhoTarget ? A.dhoHandoffBonus : 0) * A.actionCommitScale
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
 * seconds (capped at 1s): strong at launch, gone by the terminal decision —
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
  const driveHold = driving ? A.driveHoldBoost * clamp(h.driveUntil - s.t, 0, 1) : 0;
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
): { cutter: number; swing: number; pull: number } {
  const A = s.params.ai;
  const cutter = cutting ? A.cutterBonus : 0;
  const swing =
    A.swingBase +
    ((h.p.tend.passOut - 50) / 100) * A.swingPassOutScale +
    ((h.p.attr.passVision - 50) / 100) * A.swingVisionScale;
  const pull =
    (Math.max(0, creation(m) - creation(h)) / 100) * A.playmakerScale * shotClockShare;
  return {
    cutter: cutter * A.advantageScale,
    swing: swing * A.advantageScale,
    pull: pull * A.advantageScale
  };
}

// ------------------------------------------------------- 5. TEMPO (shoot/drive)

/**
 * Transition urgency: looks are worth extra before the defense sets. The
 * drive channel weighs it by driveTransitionMult (getting downhill in
 * transition is the highest-value version of the window).
 */
export function tempo(s: GameState): { shoot: number; drive: number } {
  const D = s.params.decide;
  const A = s.params.ai;
  const term = s.poss.phase === 'transition' ? D.transitionBonus : 0;
  return {
    shoot: term * A.tempoScale,
    drive: term * A.driveTransitionMult * A.tempoScale
  };
}
