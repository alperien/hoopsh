/**
 * Shot resolution: windup timing, release-time contest/block/foul rolls,
 * and outcome resolution (score, and-one free throws, or the miss scramble).
 */

import { clampRect, lerp } from '../core/vec.js';
import { classifyShot } from '../geometry/court.js';
import type { ShotMoveType } from '../core/events.js';
import {
  agent, attackedRim, emit, other, round1, type Agent, type GameState, type PendingShot
} from './state.js';
import {
  blockP, contestAt, sampleMissLanding, sampleScrambleSec, shotMakeP, shootingFoulP
} from './resolve.js';
import { type FoulOutcome, enterFreeThrows, recordFoul } from './fouls.js';
import { deadBall, endPeriod, endPossession, enterScramble } from './possession.js';
import { onShotReleased } from './ai.js';
import { noteScore } from './endgame.js';

/** windup time before the ball leaves the shooter's hands, by shot type */
export function windupSec(s: GameState, moveType: ShotMoveType): number {
  const W = s.params.shot;
  switch (moveType) {
    case 'catch_shoot': return W.windupCatchShoot;
    case 'pull_up': return W.windupPullUp;
    case 'drive': return W.windupDrive;
    case 'cut_finish': return W.windupCutFinish;
    case 'post': return W.windupPost;
    case 'putback': return W.windupPutback;
    case 'heave': return W.windupHeave;
  }
}

export function startShot(
  s: GameState,
  shooter: Agent,
  moveType: ShotMoveType,
  contest0?: number,
  carryRim?: boolean
): void {
  // usage bookkeeping: a shot attempt uses the possession (v1 counts FGA
  // only — FT trips and turnovers are omitted, which slightly undercounts
  // foul-drawing stars; acceptable bias, noted)
  shooter.usedPoss++;
  const rim = attackedRim(s, shooter.side);
  const contest = contestAt(s, shooter, shooter.pos);
  if (contest0 !== undefined) {
    // a late closeout bothers the shot less than a set contest:
    // blend the contest at decision time with the contest at release
    const rel = s.params.shot.contestReleaseBlend;
    contest.level = (1 - rel) * contest0 + rel * contest.level;
  }
  // #74 transition carry: a carried break finish RELEASES at the rim plane
  // by construction — the ball's extension meets the hoop while the body
  // is still traveling (a sprinting body's stopping distance is the
  // behind-plane artifact the carry exists to remove). The release POINT
  // is the rim; the CONTEST above already read off the body, so traffic
  // still prices the attempt honestly through the make model.
  const releasePos = carryRim ? rim : shooter.pos;
  const loc = classifyShot(s.rules, s.court, rim, releasePos);
  const p = shotMakeP(s, shooter, loc.zone, loc.distFt, moveType, contest);
  let made = s.rng.chance(p);

  // blocks only happen on would-be misses (keeps make % calibration clean)
  let blockedBy: string | undefined;
  if (!made && s.rng.chance(blockP(s, loc.zone, contest))) {
    blockedBy = contest.by ?? undefined;
  }

  // shooting foul?
  let foul: PendingShot['foul'];
  const pFoul = shootingFoulP(s, shooter, loc.zone, contest) * (blockedBy ? s.params.shot.blockedFoulMult : 1);
  const foulRoll = s.rng.chance(made ? pFoul * s.params.shot.andOneFoulMult : pFoul);
  if (foulRoll && contest.by) {
    foul = {
      by: contest.by,
      ftAwarded: made ? 1 : loc.three ? 3 : 2,
      andOne: made
    };
  }

  // Defensive goaltending (officiating wave, fdesign-officiating §1.2,
  // live at goaltendPerContestedInsideMiss 0.0205 — 0.51/g REAL, rate gate
  // before the
  // draw): one gated roll after the make/block/foul rolls, on contested
  // rim/paint would-be misses only. On fire the miss becomes a made shot
  // before the assist bookkeeping below (goaltended makes carry assists;
  // corpus samples do), and resolveShotOutcome runs the ordinary make path
  // plus the violation row. Deliberately independent of the block roll:
  // chaining onto block successes would drain the blk band's floor margin;
  // the 0.25/team of extra makes comes from plain misses instead, and the
  // violator is still the contesting defender either way. A shot that drew
  // a whistle is skipped (goaltend+foul compounds are real but rare;
  // documented simplification, fdesign-officiating §8). Draw order at this
  // site is fixed: make → block → foul → goaltend, ≤1 goaltend roll/shot.
  let goaltend: string | undefined;
  const O = s.params.officiating;
  if (
    O.goaltendPerContestedInsideMiss > 0 &&
    !made && !blockedBy && !foul && (loc.zone === 'rim' || loc.zone === 'paint') &&
    contest.by && s.rng.chance(O.goaltendPerContestedInsideMiss)
  ) {
    goaltend = contest.by;
    made = true; // the basket counts, scored as a normal FGM
  }

  // assist bookkeeping — the "direct scoring move" rule. The dribble
  // allowance is ZONE-AWARE (see params.ai.assistMaxDribbles*): a jumper
  // taken off the bounce is self-created and earns the passer nothing,
  // while an interior finish keeps its gather dribble. A uniform allowance
  // credited self-created pull-ups league-wide (debt D1).
  let assist: string | undefined;
  const lp = s.poss.lastPass;
  const interiorFinish = loc.zone === 'rim' || loc.zone === 'paint';
  const dribbleAllowance = interiorFinish
    ? s.params.ai.assistMaxDribblesInterior
    : s.params.ai.assistMaxDribbles;
  if (
    made && lp &&
    // only a shot off a CAUGHT PASS can be assisted: an offensive-rebound
    // putback or a resumed dead-ball touch resets the play, but lastPass
    // survives both (the possession continues) — before this gate, a
    // pre-miss/pre-whistle pass was credited on the putback that followed
    // (same acquisition-ignorance root as the catch_shoot mislabel)
    shooter.acquiredBy === 'pass' &&
    s.t - shooter.catchT <= s.params.ai.assistWindowSec &&
    shooter.dribblesSinceCatch <= dribbleAllowance &&
    lp.from !== shooter.p.id &&
    // the passer can be substituted at a continuation dead ball between his
    // pass and this shot — no assists from the bench
    s.agents.get(lp.from)?.onCourt === true
  ) {
    assist = lp.from;
  }

  const pending: PendingShot = {
    shooterId: shooter.p.id,
    side: shooter.side,
    x: round1(releasePos.x),
    y: round1(releasePos.y),
    distFt: round1(loc.distFt),
    zone: loc.zone,
    three: loc.three,
    moveType,
    contest: Math.round(contest.level * 100) / 100,
    contestedBy: contest.by ?? undefined,
    made: blockedBy ? false : made,
    assist,
    foul,
    goaltend,
  };

  s.ball.holderId = null;

  if (blockedBy) {
    // resolved instantly at the release point: ball swatted loose
    resolveShotOutcome(s, pending, blockedBy);
    return;
  }

  const flightTime = s.params.shot.flightBaseSec + loc.distFt * s.params.shot.flightPerFt;
  s.ball.flight = {
    kind: 'shot',
    from: { ...shooter.pos },
    to: { ...rim },
    total: flightTime,
    remaining: flightTime,
    shot: pending
  };

  // send bodies to work: crash / box out / get back
  onShotReleased(s, shooter.side);
}

export function resolveShotOutcome(s: GameState, shot: PendingShot, blockedBy?: string): void {
  const shooter = agent(s, shot.shooterId);
  const points = shot.made ? (shot.three ? 3 : 2) : 0;
  if (shot.made) {
    s.score[shot.side] += points as 2 | 3;
    noteScore(s, shot.side, points); // unanswered-run tracker (endgame layer)
  }

  emit(s, {
    type: 'shot',
    team: shot.side,
    shooter: shot.shooterId,
    x: shot.x,
    y: shot.y,
    distFt: shot.distFt,
    zone: shot.zone,
    three: shot.three,
    moveType: shot.moveType,
    contest: shot.contest,
    contestedBy: shot.contestedBy,
    made: shot.made,
    points: points as 0 | 2 | 3,
    assist: shot.assist,
    blockedBy,
    foul: shot.foul
  });

  // Defensive goaltending violation row (officiating wave): rides
  // immediately after the made shot event it flipped: same t/wt, and the
  // shot's score stamp already includes the points (real accounting: a
  // normal FGM row, then "Violation by Team (def goaltending)"). The
  // violating side is the defense; the player is the contesting defender
  // startShot tagged. Never coexists with a shooting foul (startShot skips
  // the compound), so the recordFoul below can't interleave.
  if (shot.goaltend) {
    emit(s, {
      type: 'violation',
      team: other(shot.side),
      player: shot.goaltend,
      kind: 'def_goaltend'
    });
  }

  let bonusInfo: FoulOutcome | null = null;
  if (shot.foul) {
    // called for its side effects (personal/team foul counts, foul event,
    // foul-out replacement). A shooting foul's FT count comes from the shot
    // itself (shot.foul.ftAwarded — 2/3/and-one), never from the bonus
    // state (see fouls.ts FoulOutcome doc; a dead `bonusInfo` local here
    // once suggested otherwise — scan wave). The outcome is consumed again
    // now, but ONLY for the staged technical rider (techFT below); the FT
    // count still never reads it.
    bonusInfo = recordFoul(s, agent(s, shot.foul.by), 'shooting', shooter);
  }

  const periodOver = s.clock < 1e-6;

  if (shot.made) {
    if (shot.foul) {
      // and-one: the possession isn't over until the free throw resolves;
      // the FT flow emits the single possession_end (a technical rider on
      // the shooting foul prefixes the trip; fouls.ts, staged-inert)
      enterFreeThrows(s, shooter, 1, false,
        bonusInfo?.techFT ? { pre: bonusInfo.techFT.p.id } : undefined);
      return;
    }
    endPossession(s, 'made_fg');
    if (periodOver) { endPeriod(s); return; }
    // made-basket clock stop, per pack (rulepack.ts makeStopClock*): the
    // final period/OT window (NBA/FIBA 2:00, NCAA 1:00) and the NBA's
    // last-minute window in EARLIER periods (Rule 5 V) — the frozen clock
    // also opens the ordinary substitution pass at this dead ball
    // (possession.ts liveInbound), which is where real Q1-Q3 last-minute
    // post-make subs live (flowboard G8c)
    const finalClass = s.period >= s.rules.periods;
    const stopSec = finalClass ? s.rules.makeStopClockFinalSec : s.rules.makeStopClockEarlySec;
    const clockStops = s.clock <= stopSec;
    // the replay-review check stays a FINAL-period last-2:00 fact (its own
    // rule, coincident with the NBA stop window but not the same thing)
    const reviewLate = finalClass && s.clock <= 120;
    deadBall(s, other(shot.side), {
      clockRuns: !clockStops,
      // made-basket inbound time (move.madeBasketResumeSec) — the clock
      // runs through it outside the stop windows
      resumeIn: s.params.move.madeBasketResumeSec,
      ...(reviewLate ? { reviewable: 'late_make' as const } : {})
    });
    return;
  }

  // missed
  if (shot.foul) {
    // (a technical rider prefixes the trip: fouls.ts, staged-inert)
    enterFreeThrows(s, shooter, shot.foul.ftAwarded, false,
      bonusInfo?.techFT ? { pre: bonusInfo.techFT.p.id } : undefined);
    return;
  }
  if (periodOver) { endPeriod(s); return; }

  const rim = attackedRim(s, shot.side);
  // a blocked shot's carom starts partway back toward the rim and sprays in
  // the vicinity (reb.blockCaromShare/blockScatterFt); a clean miss lands
  // per the distance-shaped landing model
  const R = s.params.reb;
  const origin = blockedBy
    ? lerp({ x: shot.x, y: shot.y }, rim, R.blockCaromShare)
    : rim;
  const landAt = blockedBy
    ? {
        x: origin.x + s.rng.range(-R.blockScatterFt, R.blockScatterFt),
        y: origin.y + s.rng.range(-R.blockScatterFt, R.blockScatterFt)
      }
    : sampleMissLanding(s, rim, shot.distFt);
  s.ball.flight = null;
  s.ball.holderId = null;
  s.ball.pos = { ...origin };
  // scramble window = the miss->secure cadence (G9): the game clock runs
  // under it, so this draw is the logged miss->rebound clock delta. Blocked
  // misses share the FG distribution (real blocked-miss rebounds run ~1s
  // faster, p50 2s vs 3s; pooled deliberately, since blocks are ~9% of
  // misses and the gate pools them too).
  enterScramble(
    s,
    clampRect(landAt, s.court.length, s.court.width, 1.5),
    sampleScrambleSec(s, 'fg'),
    shot.side
  );
}
