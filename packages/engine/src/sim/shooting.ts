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
  blockP, contestAt, sampleMissLanding, shotMakeP, shootingFoulP
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
  contest0?: number
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
  const loc = classifyShot(s.rules, s.court, rim, shooter.pos);
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
    x: round1(shooter.pos.x),
    y: round1(shooter.pos.y),
    distFt: round1(loc.distFt),
    zone: loc.zone,
    three: loc.three,
    moveType,
    contest: Math.round(contest.level * 100) / 100,
    contestedBy: contest.by ?? undefined,
    made: blockedBy ? false : made,
    assist,
    foul,
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

  let bonusInfo: FoulOutcome | null = null;
  if (shot.foul) {
    bonusInfo = recordFoul(s, agent(s, shot.foul.by), 'shooting', shooter);
  }

  const periodOver = s.clock < 1e-6;

  if (shot.made) {
    if (shot.foul) {
      // and-one: the possession isn't over until the free throw resolves —
      // the FT flow emits the single possession_end
      enterFreeThrows(s, shooter, 1);
      return;
    }
    endPossession(s, 'made_fg');
    if (periodOver) { endPeriod(s); return; }
    const lastTwoMin = s.period >= s.rules.periods && s.clock <= 120;
    deadBall(s, other(shot.side), { clockRuns: !lastTwoMin, resumeIn: 2.2 });
    return;
  }

  // missed
  if (shot.foul) {
    enterFreeThrows(s, shooter, shot.foul.ftAwarded);
    return;
  }
  if (periodOver) { endPeriod(s); return; }

  const rim = attackedRim(s, shot.side);
  const origin = blockedBy
    ? lerp({ x: shot.x, y: shot.y }, rim, 0.35)
    : rim;
  const landAt = blockedBy
    ? { x: origin.x + s.rng.range(-6, 6), y: origin.y + s.rng.range(-6, 6) }
    : sampleMissLanding(s, rim, shot.distFt);
  s.ball.flight = null;
  s.ball.holderId = null;
  s.ball.pos = { ...origin };
  enterScramble(
    s,
    clampRect(landAt, s.court.length, s.court.width, 1.5),
    s.rng.range(0.5, 0.95),
    shot.side
  );
}
