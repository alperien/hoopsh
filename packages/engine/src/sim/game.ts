/**
 * The game orchestrator: tick pipeline, phase machine, live-ball decision
 * loop, and the event/frame recorders. Possession/foul/shot/pass mechanics
 * live in the sibling sim modules; this file wires them together.
 */

import { makeCourt } from '../geometry/court.js';
import { NBA, type RulePack } from '../rules/rulepack.js';
import type { Team } from '../model/player.js';
import type { GameEvent, TeamSide } from '../core/events.js';
import { defaultParams, withParams, type SimParams } from './params.js';
import {
  agent, attackedRim, emit, round1,
  type Agent, type GameState
} from './state.js';
import { Rng } from '../core/rng.js';
import { dist, len, lerp } from '../core/vec.js';
import {
  decideBall, defenseTick, offenseOffBallTick, type BallAction
} from './ai.js';
import { contestAt } from './resolve.js';
import {
  bestHandler, deadBall, endPeriod, endPossession, giveBall, setupDeadTargets,
  tickDead, tickScramble, tipWeightedWinner
} from './possession.js';
import { recordFoul, tickFreeThrows } from './fouls.js';
import { resolveShotOutcome, startShot, windupSec } from './shooting.js';
import { attemptReachIn, resolvePassArrival, startPass } from './passing.js';
import { advanceClock, applyFatigue, integrateMovement } from './movement.js';
import { other } from './state.js';

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

function executeAction(s: GameState, h: Agent, action: BallAction): void {
  switch (action.kind) {
    case 'shoot':
      // enter the windup: defenders get windupSec to close out before the
      // contest is measured at release. This race IS shot defense.
      s.pendingRelease = {
        shooterId: h.p.id,
        moveType: action.moveType,
        releaseAt: s.t + windupSec(s, action.moveType),
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
