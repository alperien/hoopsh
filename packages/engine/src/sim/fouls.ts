/**
 * Fouls: recording personals/team fouls with bonus tracking and fouled-out
 * replacement, plus the free-throw phase (setup and per-tick resolution).
 */

import { attackedRim, agent, emit, onCourt, other, type Agent, type GameState, type Phase } from './state.js';
import { freeThrowP, sampleMissLanding } from './resolve.js';
import { checkSubs, replaceFouledOut } from './subs.js';
import { integrateMovement } from './movement.js';
import { deadBall, endPeriod, endPossession, enterScramble } from './possession.js';
import { onShotReleased } from './ai.js';

export interface FoulOutcome {
  fouledOut: boolean;
  inBonus: boolean;
}

export function recordFoul(
  s: GameState,
  fouler: Agent,
  kind: 'shooting' | 'reach' | 'offensive' | 'loose_ball',
  drawnBy?: Agent
): FoulOutcome {
  fouler.fouls += 1;
  const side = fouler.side;
  const countsTeam = kind !== 'offensive'; // offensive fouls: personal only (v0.1)
  if (countsTeam) s.teamFoulsPeriod[side] += 1;
  const inBonus = s.teamFoulsPeriod[side] >= s.rules.teamFoulBonusAt;
  const fouledOut = fouler.fouls >= s.rules.foulOutAt;
  if (fouledOut) fouler.fouledOut = true;
  emit(s, {
    type: 'foul',
    team: side,
    on: fouler.p.id,
    kind,
    drawnBy: drawnBy?.p.id,
    personalCount: fouler.fouls,
    teamCountInPeriod: s.teamFoulsPeriod[side],
    inBonus,
    fouledOut
  });
  if (fouledOut) replaceFouledOut(s, fouler);
  return { fouledOut, inBonus };
}

// ------------------------------------------------------------- free throws

export function enterFreeThrows(s: GameState, shooter: Agent, count: number): void {
  s.ball.holderId = null;
  s.ball.flight = null;
  s.phase = {
    kind: 'freethrows',
    shooterId: shooter.p.id,
    side: shooter.side,
    taken: 0,
    of: count,
    nextIn: 1.4,
    lastMade: false
  };
  checkSubs(s);
  // cosmetic positioning around the key
  const rim = attackedRim(s, shooter.side);
  const dir = rim.x > s.court.midX ? -1 : 1;
  const ftSpot = { x: rim.x + dir * 13.75, y: s.court.centerY };
  shooter.target = ftSpot;
  let lane = 0;
  for (const a of [...onCourt(s, shooter.side), ...onCourt(s, other(shooter.side))]) {
    if (a.p.id === shooter.p.id) continue;
    a.intent = 'freeze';
    lane += 1;
    const side = lane % 2 === 0 ? 1 : -1;
    a.target = lane <= 6
      ? { x: rim.x + dir * (4 + Math.floor(lane / 2) * 3.5), y: s.court.centerY + side * 9.5 }
      : { x: rim.x + dir * 26, y: s.court.centerY + side * (6 + lane) };
  }
}

export function tickFreeThrows(s: GameState, dt: number): void {
  const ph = s.phase as Extract<Phase, { kind: 'freethrows' }>;
  integrateMovement(s, dt);
  ph.nextIn -= dt;
  if (ph.nextIn > 0) return;

  const shooter = agent(s, ph.shooterId);
  const made = s.rng.chance(freeThrowP(s, shooter));
  ph.taken += 1;
  ph.lastMade = made;
  if (made) s.score[ph.side] += 1;
  emit(s, {
    type: 'free_throw',
    team: ph.side,
    shooter: ph.shooterId,
    n: ph.taken,
    of: ph.of,
    made
  });

  if (ph.taken < ph.of) {
    ph.nextIn = 0.9;
    return;
  }

  // sequence complete
  if (made) {
    endPossession(s, 'made_ft');
    if (s.clock <= 0) { endPeriod(s); return; }
    deadBall(s, other(ph.side), { clockRuns: false, resumeIn: 1.6 });
  } else {
    if (s.clock <= 0) { endPeriod(s); return; }
    // live rebound off the miss
    const rim = attackedRim(s, ph.side);
    s.ball.pos = { ...rim };
    enterScramble(s, sampleMissLanding(s, rim, 13.75), s.rng.range(0.45, 0.8), ph.side);
    onShotReleased(s, ph.side);
  }
}
