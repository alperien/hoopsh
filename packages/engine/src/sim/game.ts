/**
 * The game orchestrator: tick pipeline, phase machine, possession lifecycle,
 * fouls/free throws, substitutions, clocks, and the event/frame recorders.
 */

import { Rng, clamp } from '../core/rng.js';
import {
  add, clampRect, dist, len, lerp, norm, scale, sub, type V2
} from '../core/vec.js';
import { makeCourt } from '../geometry/court.js';
import { classifyShot } from '../geometry/court.js';
import { NBA, type RulePack } from '../rules/rulepack.js';
import type { Team } from '../model/player.js';
import { acceleration } from '../model/derived.js';
import { n } from '../model/derived.js';
import type { GameEvent, ShotMoveType, TeamSide } from '../core/events.js';
import { defaultParams, withParams, type SimParams } from './params.js';
import {
  agent, attackedRim, emit, onCourt, other, round1,
  type Agent, type GameState, type PendingShot, type Phase
} from './state.js';
import {
  assignMatchups, assignSpots, decideBall, defenseTick, moveSpeed,
  offenseOffBallTick, onBallDefender, type BallAction
} from './ai.js';
import {
  blockP, contestAt, freeThrowP, resolveRebound, sampleMissLanding,
  shotMakeP, shootingFoulP, passRisk
} from './resolve.js';

export interface GameConfig {
  seed: string | number;
  home: Team;
  away: Team;
  rules?: RulePack;
  params?: Parameters<typeof withParams>[0];
  collectFrames?: boolean;
}

export interface GameResult {
  seed: string;
  events: GameEvent[];
  finalScore: [number, number];
  frames: number[][];
  rules: RulePack;
  params: SimParams;
  teams: [Team, Team];
}

// ------------------------------------------------------------------ set-up

function validateTeam(team: Team): void {
  if (team.starters.length !== 5) throw new Error(`${team.id}: needs exactly 5 starters`);
  for (const id of team.starters) {
    if (!team.players.some((p) => p.id === id)) {
      throw new Error(`${team.id}: starter ${id} not on roster`);
    }
  }
  const ids = new Set(team.players.map((p) => p.id));
  if (ids.size !== team.players.length) throw new Error(`${team.id}: duplicate player ids`);
}

function initState(cfg: GameConfig): GameState {
  validateTeam(cfg.home);
  validateTeam(cfg.away);
  const rules = cfg.rules ?? NBA;
  const params = cfg.params ? withParams(cfg.params) : structuredClone(defaultParams);
  const rng = new Rng(cfg.seed);
  const court = makeCourt(rules);

  const agents = new Map<string, Agent>();
  const mkAgents = (team: Team, side: TeamSide) => {
    for (const p of team.players) {
      agents.set(p.id, {
        p,
        side,
        pos: {
          x: court.midX + rng.range(-8, 8),
          y: side === 0 ? rng.range(4, 20) : rng.range(court.width - 20, court.width - 4)
        },
        vel: { x: 0, y: 0 },
        energy: 100,
        secondsPlayed: 0,
        fouls: 0,
        onCourt: false,
        fouledOut: false,
        target: { x: court.midX, y: court.centerY },
        intent: 'freeze',
        sprinting: false,
        spotKey: null,
        manId: null,
        dribblesSinceCatch: 0,
        dribbleAcc: 0,
        catchT: -99,
        driveUntil: -99,
        cutUntil: -99,
        screenStunUntil: -99
      });
    }
  };
  mkAgents(cfg.home, 0);
  mkAgents(cfg.away, 1);

  const lineup: [string[], string[]] = [[...cfg.home.starters], [...cfg.away.starters]];
  for (const side of [0, 1] as TeamSide[]) {
    for (const id of lineup[side]) {
      const a = agents.get(id);
      if (a) a.onCourt = true;
    }
  }

  const s: GameState = {
    rng,
    params,
    rules,
    court,
    teams: [cfg.home, cfg.away],
    agents,
    lineup,
    ball: { holderId: null, pos: { x: court.midX, y: court.centerY }, flight: null },
    period: 1,
    clock: rules.periodMinutes * 60,
    t: 0,
    score: [0, 0],
    teamFoulsPeriod: [0, 0],
    tipWinner: 0,
    poss: {
      team: 0,
      shotClock: rules.shotClockSec,
      phase: 'advance',
      startT: 0,
      kind: 'tip',
      lastPass: null,
      spotMap: new Map()
    },
    phase: { kind: 'dead', resumeIn: 0.6, clockRuns: false, nextTeam: 0, possKind: 'tip' },
    events: [],
    frames: [],
    collectFrames: cfg.collectFrames ?? true,
    decisionAt: 0,
    pendingRelease: null,
    over: false
  };
  return s;
}

function tipWeightedWinner(s: GameState): TeamSide {
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

function bestHandler(s: GameState, side: TeamSide): Agent {
  const players = onCourt(s, side).filter((x) => !x.fouledOut);
  return players.reduce((m, x) => (x.p.attr.ballHandle > m.p.attr.ballHandle ? x : m));
}

// ------------------------------------------------------------- possessions

function startPossession(
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
    spotMap: new Map()
  };
  emit(s, { type: 'possession_start', team, kind });
  assignSpots(s, team);
  assignMatchups(s, other(team));
  const h = holder ?? bestHandler(s, team);
  giveBall(s, h);
  s.decisionAt = s.t + 0.25;
}

function giveBall(s: GameState, a: Agent): void {
  s.ball.holderId = a.p.id;
  s.ball.flight = null;
  a.catchT = s.t;
  a.dribblesSinceCatch = 0;
  a.dribbleAcc = 0;
}

function endPossession(
  s: GameState,
  outcome: 'made_fg' | 'made_ft' | 'def_rebound' | 'turnover' | 'period_end'
): void {
  emit(s, { type: 'possession_end', team: s.poss.team, outcome });
}

/** enter a dead-ball phase; possession (re)starts when it elapses */
function deadBall(
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

function setupDeadTargets(s: GameState, offSide: TeamSide): void {
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

// ------------------------------------------------------------------- fouls

interface FoulOutcome {
  fouledOut: boolean;
  inBonus: boolean;
}

function recordFoul(
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

function replaceFouledOut(s: GameState, out: Agent): void {
  const side = out.side;
  const bench = s.teams[side].players
    .map((p) => agent(s, p.id))
    .filter((a) => !a.onCourt && !a.fouledOut);
  if (bench.length === 0) return; // nobody left — play on (edge case)
  bench.sort((a, b) =>
    Number(b.p.pos === out.p.pos) - Number(a.p.pos === out.p.pos) || b.energy - a.energy
  );
  swapPlayers(s, side, out, bench[0]!);
}

function swapPlayers(s: GameState, side: TeamSide, out: Agent, into: Agent): void {
  const slots = s.lineup[side];
  const idx = slots.indexOf(out.p.id);
  if (idx === -1) return;
  slots[idx] = into.p.id;
  out.onCourt = false;
  into.onCourt = true;
  into.pos = { ...out.pos };
  into.vel = { x: 0, y: 0 };
  into.manId = out.manId;
  into.spotKey = out.spotKey;
  emit(s, { type: 'substitution', team: side, out: [out.p.id], in: [into.p.id] });
}

function checkSubs(s: GameState): void {
  const P = s.params.sub;
  const crunch =
    s.period >= s.rules.periods &&
    s.clock < 300 &&
    Math.abs(s.score[0] - s.score[1]) <= 10;

  for (const side of [0, 1] as TeamSide[]) {
    const team = s.teams[side];
    const starters = new Set(team.starters);
    for (const id of [...s.lineup[side]]) {
      const a = agent(s, id);
      if (a.fouledOut) continue;
      if (crunch) {
        // close & late: get starters back on the floor if they can stand
        if (!starters.has(id)) {
          const starter = team.starters
            .map((sid) => agent(s, sid))
            .find((x) => !x.onCourt && !x.fouledOut && x.energy > 35);
          if (starter) swapPlayers(s, side, a, starter);
        }
        continue;
      }
      // starters run longer stints; bench players yield the floor back sooner
      const tiredAt = starters.has(id) ? P.tiredThreshold : P.tiredThreshold + 12;
      if (a.energy < tiredAt) {
        const bench = team.players
          .map((p) => agent(s, p.id))
          .filter((b) => !b.onCourt && !b.fouledOut && b.energy >= P.readyThreshold);
        if (bench.length === 0) continue;
        bench.sort((x, y) =>
          Number(y.p.pos === a.p.pos) - Number(x.p.pos === a.p.pos) || y.energy - x.energy
        );
        swapPlayers(s, side, a, bench[0]!);
      }
    }
  }
}

// ------------------------------------------------------------- free throws

function enterFreeThrows(s: GameState, shooter: Agent, count: number): void {
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

// ------------------------------------------------------------------ shots

function startShot(
  s: GameState,
  shooter: Agent,
  moveType: ShotMoveType,
  contest0?: number
): void {
  const rim = attackedRim(s, shooter.side);
  const contest = contestAt(s, shooter, shooter.pos);
  if (contest0 !== undefined) {
    // a late closeout bothers the shot less than a set contest:
    // blend the contest at decision time with the contest at release
    contest.level = 0.55 * contest0 + 0.45 * contest.level;
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
  const pFoul = shootingFoulP(s, shooter, loc.zone, contest) * (blockedBy ? 0.35 : 1);
  const foulRoll = s.rng.chance(made ? pFoul * 0.28 : pFoul);
  if (foulRoll && contest.by) {
    foul = {
      by: contest.by,
      ftAwarded: made ? 1 : loc.three ? 3 : 2,
      andOne: made
    };
  }

  // assist bookkeeping
  let assist: string | undefined;
  const lp = s.poss.lastPass;
  if (
    made && lp &&
    s.t - shooter.catchT <= 1.6 &&
    shooter.dribblesSinceCatch <= 1 &&
    lp.from !== shooter.p.id
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
    atBuzzer: s.clock <= 0.3
  };

  s.ball.holderId = null;

  if (blockedBy) {
    // resolved instantly at the release point: ball swatted loose
    resolveShotOutcome(s, pending, blockedBy);
    return;
  }

  const flightTime = 0.45 + loc.distFt * 0.021;
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

function onShotReleased(s: GameState, offSide: TeamSide): void {
  const rim = attackedRim(s, offSide);
  for (const a of onCourt(s, offSide)) {
    if (a.fouledOut) continue;
    const near = dist(a.pos, rim) < 22;
    const crash = near && s.rng.chance(0.25 + (a.p.tend.crashOffReb / 100) * 0.6);
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

function resolveShotOutcome(s: GameState, shot: PendingShot, blockedBy?: string): void {
  const shooter = agent(s, shot.shooterId);
  const points = shot.made ? (shot.three ? 3 : 2) : 0;
  if (shot.made) s.score[shot.side] += points as 2 | 3;

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

  const periodOver = s.clock <= 0;

  if (shot.made) {
    endPossession(s, 'made_fg');
    if (shot.foul) {
      enterFreeThrows(s, shooter, 1); // and-one
      return;
    }
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
  s.phase = {
    kind: 'scramble',
    landAt: clampRect(landAt, s.court.length, s.court.width, 1.5),
    resolveIn: s.rng.range(0.5, 0.95),
    offSide: shot.side
  };
}

// ------------------------------------------------------------------ passes

function startPass(
  s: GameState,
  from: Agent,
  toId: string,
  passKind: 'normal' | 'kickout' | 'outlet' | 'entry'
): void {
  const to = agent(s, toId);
  const risk = passRisk(s, from, to);
  const fails = s.rng.chance(risk.turnoverP);
  const lead = add(to.pos, scale(to.vel, 0.25));
  const target = fails
    ? lerp(from.pos, lead, s.rng.range(0.35, 0.7))
    : lead;
  const d = Math.max(3, dist(from.pos, target));
  const time = d / s.params.pass.speedFtS;
  s.ball.holderId = null;
  s.ball.flight = {
    kind: 'pass',
    from: { ...from.pos },
    to: target,
    total: time,
    remaining: time,
    passFrom: from.p.id,
    passTo: toId,
    passKind,
    passFail: fails
      ? { stolenBy: s.rng.chance(s.params.pass.stealShare) ? risk.dangerId : null }
      : undefined
  };
}

function resolvePassArrival(s: GameState): void {
  const f = s.ball.flight;
  if (!f || f.kind !== 'pass') return;
  const from = f.passFrom!;
  const passer = agent(s, from);
  s.ball.flight = null;

  if (f.passFail) {
    const stolenBy = f.passFail.stolenBy;
    if (stolenBy) {
      const thief = agent(s, stolenBy);
      emit(s, {
        type: 'turnover', team: passer.side, player: from,
        kind: 'bad_pass', stolenBy
      });
      endPossession(s, 'turnover');
      startPossession(s, thief.side, 'steal', thief);
      thief.pos = { ...s.ball.pos };
    } else {
      emit(s, {
        type: 'turnover', team: passer.side, player: from, kind: 'out_of_bounds'
      });
      endPossession(s, 'turnover');
      deadBall(s, other(passer.side), { clockRuns: false });
    }
    return;
  }

  const to = agent(s, f.passTo!);
  emit(s, {
    type: 'pass', team: passer.side, from, to: to.p.id, kind: f.passKind ?? 'normal'
  });
  s.poss.lastPass = { from, t: s.t };
  giveBall(s, to);
  s.decisionAt = s.t + 0.12; // quick trigger: catch-and-shoot window
}

// ---------------------------------------------------------------- reach-in

function attemptReachIn(s: GameState, dt: number): void {
  const holderId = s.ball.holderId;
  if (!holderId) return;
  const h = agent(s, holderId);
  const d = onBallDefender(s, h);
  if (!d || dist(d.pos, h.pos) > 4.2) return;
  const F = s.params.foul;
  const p = F.reachInPerSec * dt * (1 + 0.85 * n(d.p.tend.gambleSteal));
  if (!s.rng.chance(p)) return;

  const stripP = clamp(0.3 + 0.3 * n(d.p.attr.steal) - 0.22 * n(h.p.attr.ballHandle), 0.08, 0.7);
  if (s.rng.chance(stripP)) {
    emit(s, {
      type: 'turnover', team: h.side, player: h.p.id, kind: 'lost_ball', stolenBy: d.p.id
    });
    endPossession(s, 'turnover');
    startPossession(s, d.side, 'steal', d);
  } else {
    const { inBonus } = recordFoul(s, d, 'reach', h);
    if (inBonus) {
      enterFreeThrows(s, h, s.rules.bonusFreeThrows);
    } else {
      // side out, same possession, shot-clock floor
      s.poss.shotClock = Math.max(s.poss.shotClock, 14);
      deadBall(s, h.side, { clockRuns: false, continuation: true, resumeIn: 1.2 });
    }
  }
}

// ------------------------------------------------------------------ ticker

function tick(s: GameState, dt: number): void {
  switch (s.phase.kind) {
    case 'live': tickLive(s, dt); break;
    case 'dead': tickDead(s, dt); break;
    case 'freethrows': tickFreeThrows(s, dt); break;
    case 'scramble': tickScramble(s, dt); break;
  }
  recordFrame(s);
}

function advanceClock(s: GameState, dt: number): void {
  s.clock -= dt;
  s.t += dt;
  for (const side of [0, 1] as TeamSide[]) {
    for (const a of onCourt(s, side)) a.secondsPlayed += dt;
  }
}

function tickLive(s: GameState, dt: number): void {
  advanceClock(s, dt);

  // ball in flight?
  const f = s.ball.flight;
  if (f) {
    f.remaining -= dt;
    s.ball.pos = lerp(f.to, f.from, Math.max(0, f.remaining) / f.total);
    integrateMovement(s, dt);
    applyFatigue(s, dt);
    if (f.remaining <= 0) {
      if (f.kind === 'shot') resolveShotOutcome(s, f.shot!);
      else resolvePassArrival(s);
    }
    return;
  }

  // shot clock (frozen while a shot is airborne, running otherwise)
  s.poss.shotClock -= dt;
  if (s.poss.shotClock <= 0) {
    const holder = s.ball.holderId ? agent(s, s.ball.holderId) : bestHandler(s, s.poss.team);
    emit(s, {
      type: 'turnover', team: s.poss.team, player: holder.p.id, kind: 'shot_clock'
    });
    endPossession(s, 'turnover');
    deadBall(s, other(s.poss.team), { clockRuns: false });
    return;
  }

  // period expiry with ball live
  if (s.clock <= 0) { endPeriod(s); return; }

  const holderId = s.ball.holderId;
  if (!holderId) {
    // shouldn't happen in live phase; recover gracefully
    giveBall(s, bestHandler(s, s.poss.team));
    return;
  }
  const h = agent(s, holderId);

  // shot windup in progress: defenders close out, then the ball goes up
  const pr = s.pendingRelease;
  if (pr && pr.shooterId === holderId) {
    offenseOffBallTick(s);
    defenseTick(s);
    integrateMovement(s, dt);
    applyFatigue(s, dt);
    s.ball.pos = { x: h.pos.x, y: h.pos.y };
    if (s.t >= pr.releaseAt) {
      s.pendingRelease = null;
      startShot(s, h, pr.moveType, pr.contest0);
    }
    return;
  }
  if (pr) s.pendingRelease = null; // stale windup (ball changed hands)

  // possession phase transitions
  const rim = attackedRim(s, h.side);
  if (s.poss.phase === 'advance' && dist(h.pos, rim) < 32) {
    s.poss.phase = 'halfcourt';
  } else if (s.poss.phase === 'transition' && s.t - s.poss.startT > 4.5) {
    s.poss.phase = 'halfcourt';
  }

  // holder movement intent
  if (s.t < h.driveUntil) {
    h.intent = 'drive';
    h.target = rim;
    h.sprinting = true;
  } else if (s.poss.phase !== 'halfcourt') {
    h.intent = 'advance';
    const dir = rim.x > s.court.midX ? -1 : 1;
    h.target = { x: rim.x + dir * 26, y: s.court.centerY + s.rng.range(-1, 1) };
    h.sprinting = s.poss.phase === 'transition';
  } else {
    h.intent = 'spot';
    h.sprinting = false;
    // probe: drift slightly toward open space in front of the arc
    h.target = h.pos;
  }

  // dribble accounting (for assist windows)
  if (len(h.vel) > 3.5) {
    h.dribbleAcc += dt;
    if (h.dribbleAcc >= 0.55) {
      h.dribbleAcc = 0;
      h.dribblesSinceCatch += 1;
    }
  }

  // decisions
  if (s.t >= s.decisionAt) {
    const action = decideBall(s);
    executeAction(s, h, action);
    if (s.phase.kind !== 'live') return; // action may have changed phase
    const D = s.params.decide;
    s.decisionAt = s.t + D.intervalSec * s.rng.range(0.75, 1.3);
  }

  // a shot/pass just went airborne: keep crash/box-out intents, skip brains
  if (s.ball.flight) {
    integrateMovement(s, dt);
    applyFatigue(s, dt);
    return;
  }

  attemptReachIn(s, dt);
  if (s.phase.kind !== 'live') return;

  // charge check while driving
  if (s.t < h.driveUntil && s.rng.chance(s.params.foul.chargePerDrive * dt * 2)) {
    recordFoul(s, h, 'offensive');
    emit(s, {
      type: 'turnover', team: h.side, player: h.p.id, kind: 'off_foul'
    });
    endPossession(s, 'turnover');
    deadBall(s, other(h.side), { clockRuns: false });
    return;
  }

  offenseOffBallTick(s);
  defenseTick(s);
  integrateMovement(s, dt);
  applyFatigue(s, dt);

  // ball follows holder
  s.ball.pos = { x: h.pos.x, y: h.pos.y };
}

/** windup time before the ball leaves the shooter's hands, by shot type */
function windupSec(moveType: ShotMoveType): number {
  switch (moveType) {
    case 'catch_shoot': return 0.42;
    case 'pull_up': return 0.55;
    case 'drive': return 0.45;
    case 'cut_finish': return 0.3;
    case 'post': return 0.65;
    case 'putback': return 0.25;
    case 'heave': return 0.3;
  }
}

function executeAction(s: GameState, h: Agent, action: BallAction): void {
  switch (action.kind) {
    case 'shoot':
      // enter the windup: defenders get windupSec to close out before the
      // contest is measured at release. This race IS shot defense.
      s.pendingRelease = {
        shooterId: h.p.id,
        moveType: action.moveType,
        releaseAt: s.t + windupSec(action.moveType),
        contest0: contestAt(s, h, h.pos).level
      };
      h.target = h.pos;
      h.sprinting = false;
      break;
    case 'pass':
      startPass(s, h, action.toId, action.passKind);
      break;
    case 'drive': {
      h.driveUntil = s.t + 1.35;
      s.decisionAt = s.t + 0.5; // re-evaluate quickly mid-drive (finish or kick)
      break;
    }
    case 'hold':
      break;
  }
}

function tickDead(s: GameState, dt: number): void {
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

function tickFreeThrows(s: GameState, dt: number): void {
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
    s.phase = {
      kind: 'scramble',
      landAt: sampleMissLanding(s, rim, 13.75),
      resolveIn: s.rng.range(0.45, 0.8),
      offSide: ph.side
    };
    onShotReleased(s, ph.side);
  }
}

function tickScramble(s: GameState, dt: number): void {
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

function endPeriod(s: GameState): void {
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

// ---------------------------------------------------------------- movement

function integrateMovement(s: GameState, dt: number): void {
  const agentsOnCourt: Agent[] = [];
  for (const side of [0, 1] as TeamSide[]) {
    for (const a of onCourt(s, side)) agentsOnCourt.push(a);
  }

  for (const a of agentsOnCourt) {
    const sp = moveSpeed(s, a);
    const toTarget = sub(a.target, a.pos);
    const d = len(toTarget);
    const desired = d < 0.25
      ? { x: 0, y: 0 }
      : scale(norm(toTarget), Math.min(sp, (d / dt) * 0.85));
    const acc = acceleration(a.p.attr);
    const dv = sub(desired, a.vel);
    const dvl = len(dv);
    const maxDelta = acc * dt;
    a.vel = dvl <= maxDelta ? desired : add(a.vel, scale(norm(dv), maxDelta));
    a.pos = clampRect(add(a.pos, scale(a.vel, dt)), s.court.length, s.court.width, 0.5);
  }

  // soft collision avoidance
  const R = s.params.move.avoidRadiusFt;
  for (let i = 0; i < agentsOnCourt.length; i++) {
    for (let j = i + 1; j < agentsOnCourt.length; j++) {
      const a = agentsOnCourt[i]!;
      const b = agentsOnCourt[j]!;
      const d = dist(a.pos, b.pos);
      if (d < R && d > 1e-6) {
        const push = scale(norm(sub(a.pos, b.pos)), (R - d) * 0.5);
        a.pos = clampRect(add(a.pos, push), s.court.length, s.court.width, 0.5);
        b.pos = clampRect(sub(b.pos, push), s.court.length, s.court.width, 0.5);
      }
    }
  }
}

function applyFatigue(s: GameState, dt: number): void {
  const F = s.params.fatigue;
  for (const [, a] of s.agents) {
    if (a.fouledOut) continue;
    if (a.onCourt) {
      const speedShare = len(a.vel) / 28;
      const drain = F.drainPerSec * (1 + speedShare * F.sprintDrainMult) * dt;
      a.energy = clamp(a.energy - drain, 0, 100);
    } else {
      a.energy = clamp(a.energy + F.recoverPerSecBench * dt, 0, 100);
    }
  }
}

// ------------------------------------------------------------------ frames

function recordFrame(s: GameState): void {
  if (!s.collectFrames) return;
  // frame cadence: every params.frameEvery ticks — track via t modulo
  const step = s.params.frameEvery / s.params.tickHz;
  if (s.frames.length > 0) {
    const lastT = s.frames[s.frames.length - 1]![0]!;
    if (s.t - lastT < step - 1e-9) return;
  }
  const row: number[] = [
    round1(s.t),
    s.period,
    round1(Math.max(0, s.clock)),
    round1(s.ball.pos.x),
    round1(s.ball.pos.y),
    holderSlot(s)
  ];
  for (const side of [0, 1] as TeamSide[]) {
    for (const id of s.lineup[side]) {
      const a = agent(s, id);
      row.push(round1(a.pos.x), round1(a.pos.y));
    }
  }
  s.frames.push(row);
}

function holderSlot(s: GameState): number {
  const id = s.ball.holderId;
  if (!id) return -1;
  const a = s.agents.get(id);
  if (!a) return -1;
  const idx = s.lineup[a.side].indexOf(id);
  return idx === -1 ? -1 : a.side * 5 + idx;
}

// -------------------------------------------------------------------- main

export function simulateGame(cfg: GameConfig): GameResult {
  const s = initState(cfg);

  emit(s, {
    type: 'game_start',
    home: { teamId: cfg.home.id, lineup: [...s.lineup[0]] },
    away: { teamId: cfg.away.id, lineup: [...s.lineup[1]] }
  });

  s.tipWinner = tipWeightedWinner(s);
  emit(s, { type: 'tip_off', winner: s.tipWinner });
  s.phase = { kind: 'dead', resumeIn: 0.8, clockRuns: false, nextTeam: s.tipWinner, possKind: 'tip' };
  setupDeadTargets(s, s.tipWinner);

  const dt = 1 / s.params.tickHz;
  const hardCapSeconds =
    (s.rules.periods * s.rules.periodMinutes + 12 * s.rules.otMinutes) * 60 + 900;
  let safety = Math.ceil(hardCapSeconds / dt) * 4;

  while (!s.over && safety-- > 0) {
    tick(s, dt);
  }
  if (!s.over) {
    emit(s, { type: 'game_end' });
  }

  return {
    seed: String(cfg.seed),
    events: s.events,
    finalScore: [s.score[0], s.score[1]],
    frames: s.frames,
    rules: s.rules,
    params: s.params,
    teams: [cfg.home, cfg.away]
  };
}
