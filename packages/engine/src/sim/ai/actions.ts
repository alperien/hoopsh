/**
 * Team actions: the pick-and-roll / post-up / isolation / dribble-handoff
 * lifecycle: calling one, advancing its phases, and tearing it down.
 */

import { clamp } from '../../core/rng.js';
import { dist } from '../../core/vec.js';
import { spacingSpots } from '../../geometry/court.js';
import { agent, attackedRim, liveOnCourt, type Agent, type GameState } from '../state.js';
import { gravity } from '../resolve.js';
import { creation, assignedDefender, midGreenLight } from './shared.js';

/**
 * Pick-and-roll lifecycle. The action is deliberately thin scaffolding;
 * everything downstream (pull-up space when the defender ducks under, the
 * pocket pass to the roller, the pop three) emerges from existing systems:
 * screen stun feeds the contest model, the roll reuses cut machinery (and so
 * earns the cutter pass bonus), the pop reuses spacing spots.
 *
 * Post-ups and isolations run through the same slot: the post entry reuses
 * the pass model (with an entry incentive), the double-team reuses help
 * defense, and the spray out of the double reuses kick-out machinery, so
 * the post becomes a passing hub for free. The iso is pure decision-layer: a
 * commitment window that boosts the handler's attack.
 */
export function actionTick(s: GameState): void {
  const A = s.params.ai;
  const act = s.poss.action;
  const holderId = s.ball.holderId;

  if (act && act.kind === 'post') {
    const poster = agent(s, act.posterId);
    // gave it up from the block (the spray) or lost it: the action is over;
    // during 'posting' a null holder is normal (the entry is in flight)
    const sprayed = act.phase === 'working' && holderId !== act.posterId;
    if (s.t > act.until || sprayed || !poster.onCourt || poster.fouledOut) {
      s.poss.action = null;
      return;
    }
    if (act.phase === 'posting' && holderId === act.posterId) {
      // entry caught, or, on a self-post (feederId === posterId), the
      // dribble-down: wait until he has actually reached the block, else
      // "working" would start 26 ft from the rim
      const selfPost = act.feederId === act.posterId;
      if (!selfPost || dist(poster.pos, poster.target) < A.postArrivalFt) {
        act.phase = 'working'; // the backdown clock starts
        act.postedAt = s.t;
      }
    }
    return;
  }
  if (act && act.kind === 'dho') {
    const hub = agent(s, act.hubId);
    const recv = agent(s, act.receiverId);
    // a null holder is the handoff in flight; resolvePassArrival clears the
    // action on the catch (after stunning the trailing defender)
    const hubLostIt = holderId !== null && holderId !== act.hubId;
    if (s.t > act.until || hubLostIt || !hub.onCourt || hub.fouledOut || !recv.onCourt || recv.fouledOut) {
      s.poss.action = null;
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
        const under = s.rng.chance(clamp(A.pnrUnderBase - gravity(s, handler), 0.08, 0.85));
        if (under) {
          onBall.screenStunUntil = s.t + A.pnrStunUnderSec;
          onBall.navUnderUntil = s.t + 1.2; // drops back; concedes the pull-up
        } else {
          const fight = 0.7 + screener.p.attr.strength / 300; // strong screens hit harder
          onBall.screenStunUntil = s.t + A.pnrStunOverSec * fight;
        }
      }
      return;
    }

    if (act.phase === 'set' && s.t - act.setAt > 0.5) {
      // screener's next job: roll to the rim, pop to the arc, or pop short
      // to the elbow (the mid-range supply line)
      act.phase = 'finishing';
      if (gravity(s, screener) < A.pnrRollGravityCut) {
        // A low-gravity screener with a real in-between game (the shared
        // midGreenLight × his midRange ability, the same green light the
        // decisiveness term honors, so nobody is ever stationed at a spot
        // he has no license to shoot from) mixes short pops into his roll
        // diet: the classic mid-pop big. His defender sits in drop
        // coverage by construction (low gravity ⇒ sag), so the elbow
        // catch is the shot the defense concedes, which is where real
        // mid-range volume comes from. Rim-runners (green light exactly
        // 0) always roll, as before.
        const midPop = midGreenLight(screener) * (screener.p.attr.midRange / 100);
        if (midPop >= A.pnrMidPopScoreCut && s.rng.chance(A.pnrMidPopChance)) {
          screener.spotKey = screener.pos.y < s.court.centerY ? 'elbow_l' : 'elbow_r';
        } else {
          screener.cutUntil = s.t + A.pnrRollCutSec; // the roll is a cut; the pocket pass emerges
        }
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
  for (const a of liveOnCourt(s, s.poss.team)) {
    if (a.p.id === holderId) continue;
    peers++;
    const c = creation(a);
    below += c < myC ? 1 : c === myC ? 0.5 : 0;
  }
  const rank01 = peers > 0 ? below / peers : 1;
  if (!s.rng.chance(A.pnrRatePerTick * (A.pnrUsageFloor + (1 - A.pnrUsageFloor) * rank01))) return;

  // pick the screener: low-gravity size (his defender sags -> good screens),
  // discounted by how far he must travel. A screen that can't arrive in time
  // is worse than no screen (audit: distance-blind choice left 93% of actions inert)
  let best: Agent | null = null;
  let bestScore = -Infinity;
  for (const a of liveOnCourt(s, s.poss.team)) {
    if (a.p.id === holderId || s.t < a.cutUntil) continue;
    const travel = dist(a.pos, h.pos);
    if (travel > A.pnrMaxScreenDistFt) continue;
    const g = gravity(s, a);
    // the mid-pop big's seat at the table: a screener who can score off
    // the short pop (midGreenLight × ability, the same gate the pop
    // routing below uses) is a premier screen partner, because the
    // defense must choose between conceding his pop (drop) and freeing the
    // roll (hedge). Gravity-gated to the roll/short-pop population: an
    // arc-popper's gravity already carries his value, and ungated the
    // affinity handed screens to mid-happy guards, whose pop goes to the
    // wing anyway and serves nothing.
    const popAffinity = g < A.pnrRollGravityCut
      ? midGreenLight(a) * (a.p.attr.midRange / 100) * A.screenerMidPopWeight
      : 0;
    const score =
      (1 - g) * A.screenerGravityWeight
      + (a.p.heightIn - A.screenerHeightBaseIn) / A.screenerHeightDiv
      + a.p.attr.strength / A.screenerStrengthDiv
      - travel / A.screenerTravelDiv
      + popAffinity;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  // the call: screen, post entry, or a clear-out. One weighted roll across
  // whatever this lineup actually offers: a team without a post threat never
  // posts, a low-iso handler never clears out (identity through tendencies).
  let poster: Agent | null = null;
  let posterScore = 0;
  for (const a of liveOnCourt(s, s.poss.team)) {
    // the holder is a legal poster: a hub big who is also his team's best
    // creator (the Jokić shape) initiates his own post-up by dribbling down
    // to the block. Before this, the usage hierarchy routed him the ball
    // and the post action then required someone else to hold it, so the
    // profile scored 7.9 ppg with 0.6 post touches (fidelity incident)
    if (s.t < a.cutUntil) continue;
    // post appetite carries the score; strength/finishing make it credible
    const sc = ((a.p.tend.post - A.posterTendOffset) / 100) * (A.posterScoreBase + a.p.attr.strength / A.posterStrengthDiv + a.p.attr.finishing / A.posterFinishingDiv);
    if (sc > posterScore) { posterScore = sc; poster = a; }
  }
  const isoScore = Math.max(0, (h.p.tend.iso - 50) / 100);
  // DHO receiver: the best gravity/motion mover in range. The handoff is a
  // shooter's action (the stun buys him his rise), so gravity carries it
  let dhoRecv: Agent | null = null;
  let dhoScore = 0;
  for (const a of liveOnCourt(s, s.poss.team)) {
    if (a.p.id === holderId || s.t < a.cutUntil) continue;
    if (dist(a.pos, h.pos) > A.dhoSearchRadiusFt) continue;
    // DHO receiver score: gravity (shooter identity, 65%) + motion (movement
    // tendency, 35%). FEEL: a handoff buys a rise; it needs a shooter who
    // also sprints in. Numerically similar to the gravity() weights but a
    // distinct quantity (selecting who to run the DHO with, not how much
    // the defense respects the eventual shooter).
    const sc = gravity(s, a) * A.dhoRecvGravityWeight + (a.p.tend.offBallMotion / 100) * A.dhoRecvMotionWeight;
    if (sc > dhoScore) { dhoScore = sc; dhoRecv = a; }
  }
  const wPnr = best ? 1 : 0;
  const wPost = poster && posterScore > A.postCallCut ? posterScore * A.postCallShare : 0;
  const wIso = isoScore * A.isoCallShare;
  // scaled by the caller's creation: the DHO is how a hub creates; a
  // low-vision holder doesn't run elbow offense
  const wDho = dhoRecv ? dhoScore * A.dhoCallShare * (creation(h) / 100) : 0;
  if (wPnr + wPost + wIso + wDho <= 0) return;
  const pick = s.rng.weighted([wPnr, wPost, wIso, wDho]);

  if (pick === 1 && poster) {
    // send the big to the near block; the entry incentive lives in decideBall.
    // Self-post (poster === holder): he dribbles himself down instead;
    // feederId === posterId marks it, and the working transition waits for
    // arrival at the block rather than a catch (see the post branch above).
    const side = poster.pos.y < s.court.centerY ? 'post_l' : 'post_r';
    // read the possession's jittered spot table (see offense.ts rollSpots);
    // the raw template is only a fallback for a degenerate hand-built state
    const spotPos = s.poss.spots.get(side)
      ?? spacingSpots(s.court, attackedRim(s, s.poss.team)).find((x) => x.key === side)!.pos;
    poster.spotKey = side;
    poster.target = { ...spotPos };
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
  if (pick === 3 && dhoRecv) {
    s.poss.action = {
      kind: 'dho', hubId: holderId, receiverId: dhoRecv.p.id,
      until: s.t + A.dhoDurationSec
    };
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
