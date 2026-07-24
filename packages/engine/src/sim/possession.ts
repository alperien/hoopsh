/**
 * Possession lifecycle: starting/ending possessions, dead-ball setup,
 * live-rebound scrambles, period transitions, and the opening tip.
 */

import { dist, lerp, type V2 } from '../core/vec.js';
import type { TeamSide } from '../core/events.js';
import {
  attackedRim, emit, onCourt, other, round1,
  type Agent, type GameState, type Phase
} from './state.js';
import { assignMatchups, assignSpots } from './ai.js';
import { resolveRebound } from './resolve.js';
import { checkSubs } from './subs.js';
import { advanceClock, applyFatigue, integrateMovement } from './movement.js';
import { enterFreeThrows, recordFoul } from './fouls.js';
import { startShot } from './shooting.js';

export function tipWeightedWinner(s: GameState): TeamSide {
  const jumper = (side: TeamSide): number => {
    const bigs = onCourt(s, side);
    const best = bigs.reduce((m, a) =>
      a.p.heightIn + a.p.attr.vertical * 0.12 > m.p.heightIn + m.p.attr.vertical * 0.12 ? a : m
    );
    return best.p.heightIn * 0.7 + best.p.attr.vertical * 0.3;
  };
  const h = jumper(0);
  const a = jumper(1);
  return s.rng.weighted([h, a]) as TeamSide;
}

export function bestHandler(s: GameState, side: TeamSide): Agent {
  const eligible = onCourt(s, side).filter((x) => !x.fouledOut);
  // bench exhausted (every replacement used): play on with whoever is out there
  // rather than crashing — custom short rosters are legal input
  const players = eligible.length > 0 ? eligible : onCourt(s, side);
  return players.reduce((m, x) => (x.p.attr.ballHandle > m.p.attr.ballHandle ? x : m));
}

// ------------------------------------------------------------- possessions

export function startPossession(
  s: GameState,
  team: TeamSide,
  kind: 'inbound' | 'live_rebound' | 'steal' | 'tip',
  holder?: Agent
): void {
  s.poss = {
    team,
    shotClock: s.rules.shotClockSec,
    phase: kind === 'live_rebound' || kind === 'steal' ? 'transition' : 'advance',
    startT: s.t,
    kind,
    lastPass: null,
    spotMap: new Map(),
    action: null,
    ended: false
  };
  // stale-timer hygiene: commitments from the previous possession must not
  // leak into this one (a defender still "cutting", a stun crossing sides)
  for (const [, a] of s.agents) {
    a.driveUntil = -99;
    a.cutUntil = -99;
    a.screenStunUntil = -99;
    a.navUnderUntil = -99;
  }
  emit(s, { type: 'possession_start', team, kind });
  assignSpots(s, team);
  assignMatchups(s, other(team));
  const h = holder ?? bestHandler(s, team);
  giveBall(s, h);
  s.decisionAt = s.t + 0.25;
}

export function giveBall(s: GameState, a: Agent): void {
  s.ball.holderId = a.p.id;
  s.ball.flight = null;
  a.catchT = s.t;
  a.dribblesSinceCatch = 0;
  a.dribbleAcc = 0;
}

export function endPossession(
  s: GameState,
  outcome: 'made_fg' | 'made_ft' | 'def_rebound' | 'turnover' | 'period_end'
): void {
  // a possession ends exactly once — and-ones, buzzer flows, and FT-miss
  // scrambles all route here, so guard against double counting (pace/ORtg
  // depend on this invariant)
  if (s.poss.ended) return;
  s.poss.ended = true;
  emit(s, { type: 'possession_end', team: s.poss.team, outcome });
}

/** enter a dead-ball phase; possession (re)starts when it elapses */
export function deadBall(
  s: GameState,
  nextTeam: TeamSide,
  opts: { clockRuns: boolean; resumeIn?: number; continuation?: boolean }
): void {
  s.ball.flight = null;
  s.ball.holderId = null;
  s.phase = {
    kind: 'dead',
    resumeIn: opts.resumeIn ?? 1.8,
    clockRuns: opts.clockRuns,
    nextTeam,
    possKind: 'inbound',
    continuation: opts.continuation
  };
  checkSubs(s);
  setupDeadTargets(s, nextTeam);
}

export function setupDeadTargets(s: GameState, offSide: TeamSide): void {
  const rim = attackedRim(s, offSide);
  const own = attackedRim(s, other(offSide)); // offense inbounds under its own defended basket
  const dir = rim.x > s.court.midX ? 1 : -1;
  const handler = bestHandler(s, offSide);
  for (const a of onCourt(s, offSide)) {
    a.intent = 'freeze';
    a.sprinting = false;
    if (a.p.id === handler.p.id) {
      a.target = { x: own.x + dir * 4, y: s.court.centerY - 6 };
    } else {
      // stagger toward midcourt lanes
      const i = s.lineup[offSide].indexOf(a.p.id);
      a.target = {
        x: s.court.midX - dir * (6 + i * 4),
        y: 6 + i * (s.court.width - 12) / 4
      };
    }
  }
  for (const d of onCourt(s, other(offSide))) {
    d.intent = 'freeze';
    d.sprinting = false;
    const man = d.manId ? s.agents.get(d.manId) : null;
    d.target = man ? lerp(man.pos, rim, 0.25) : lerp(rim, s.court.rims[dir > 0 ? 0 : 1]!, 0.3);
  }
}

/** enter a live-rebound scramble phase (ball is loose and up for grabs) */
export function enterScramble(
  s: GameState,
  landAt: V2,
  resolveIn: number,
  offSide: TeamSide
): void {
  s.phase = { kind: 'scramble', landAt, resolveIn, offSide };
}

export function tickDead(s: GameState, dt: number): void {
  const ph = s.phase as Extract<Phase, { kind: 'dead' }>;
  if (ph.clockRuns) {
    advanceClock(s, dt);
    if (s.clock <= 0) { endPeriod(s); return; }
  }
  ph.resumeIn -= dt;
  integrateMovement(s, dt);
  applyFatigue(s, dt);
  if (ph.resumeIn > 0) return;

  if (ph.continuation) {
    // same possession resumes (non-shooting foul etc.)
    s.phase = { kind: 'live' };
    giveBall(s, bestHandler(s, ph.nextTeam));
    s.decisionAt = s.t + 0.3;
    return;
  }
  s.phase = { kind: 'live' };
  startPossession(s, ph.nextTeam, ph.possKind === 'tip' ? 'tip' : 'inbound');
}

export function tickScramble(s: GameState, dt: number): void {
  const ph = s.phase as Extract<Phase, { kind: 'scramble' }>;
  advanceClock(s, dt);
  if (s.clock <= 0) { endPeriod(s); return; }
  s.ball.pos = lerp(s.ball.pos, ph.landAt, 0.25);

  // nearby players converge on the ball
  for (const side of [0, 1] as TeamSide[]) {
    for (const a of onCourt(s, side)) {
      if (a.fouledOut) continue;
      if (dist(a.pos, ph.landAt) < 18) {
        a.target = ph.landAt;
        a.sprinting = true;
      }
    }
  }
  integrateMovement(s, dt);
  applyFatigue(s, dt);

  ph.resolveIn -= dt;
  if (ph.resolveIn > 0) return;

  // loose-ball foul (defensive side only, v0.1)
  const defSide = other(ph.offSide);
  if (s.rng.chance(s.params.foul.looseBallPerReb)) {
    const fouler = onCourt(s, defSide)
      .filter((a) => !a.fouledOut)
      .sort((a, b) => dist(a.pos, ph.landAt) - dist(b.pos, ph.landAt))[0];
    if (fouler) {
      const victim = onCourt(s, ph.offSide)
        .sort((a, b) => dist(a.pos, ph.landAt) - dist(b.pos, ph.landAt))[0]!;
      const { inBonus } = recordFoul(s, fouler, 'loose_ball', victim);
      if (inBonus) {
        enterFreeThrows(s, victim, s.rules.bonusFreeThrows);
      } else {
        s.poss.shotClock = Math.max(s.poss.shotClock, 14);
        deadBall(s, ph.offSide, { clockRuns: false, continuation: true, resumeIn: 1.2 });
      }
      return;
    }
  }

  const winner = resolveRebound(s, ph.landAt, ph.offSide);
  const offensive = winner.side === ph.offSide;
  emit(s, {
    type: 'rebound',
    team: winner.side,
    player: winner.p.id,
    offensive,
    x: round1(ph.landAt.x),
    y: round1(ph.landAt.y)
  });

  s.phase = { kind: 'live' };
  if (offensive) {
    s.poss.shotClock = Math.max(s.poss.shotClock, s.rules.shotClockOffRebSec);
    s.poss.phase = 'halfcourt';
    giveBall(s, winner);
    const rim = attackedRim(s, winner.side);
    if (dist(winner.pos, rim) < 6 && s.rng.chance(s.params.reb.putbackChance)) {
      startShot(s, winner, 'putback');
      return;
    }
    s.decisionAt = s.t + 0.35;
  } else {
    endPossession(s, 'def_rebound');
    startPossession(s, winner.side, 'live_rebound', winner);
  }
}

// ----------------------------------------------------------------- periods

export function endPeriod(s: GameState): void {
  endPossession(s, 'period_end');
  s.clock = 0;
  emit(s, { type: 'period_end' });

  const isFinalScheduled = s.period >= s.rules.periods;
  const tied = s.score[0] === s.score[1];
  if (isFinalScheduled && !tied) {
    emit(s, { type: 'game_end' });
    s.over = true;
    return;
  }

  s.period += 1;
  const isOT = s.period > s.rules.periods;
  s.clock = (isOT ? s.rules.otMinutes : s.rules.periodMinutes) * 60;
  s.teamFoulsPeriod = [0, 0];
  emit(s, { type: 'period_start' });

  let team: TeamSide;
  if (isOT) {
    team = tipWeightedWinner(s);
    emit(s, { type: 'tip_off', winner: team });
  } else {
    // NBA convention: tip loser opens Q2/Q3, tip winner opens the final period
    team = s.period === s.rules.periods ? s.tipWinner : other(s.tipWinner);
  }
  s.phase = { kind: 'dead', resumeIn: 1.6, clockRuns: false, nextTeam: team, possKind: 'inbound' };
  checkSubs(s);
  // matchup/spot targets refresh when the possession starts
}
