/** Runtime game state shared by the orchestrator, AI brains, and resolvers. */

import type { Rng } from '../core/rng.js';
import type { V2 } from '../core/vec.js';
import type { Court } from '../geometry/court.js';
import type { RulePack } from '../rules/rulepack.js';
import type { Player, Team } from '../model/player.js';
import type {
  GameEvent, PassEvent, ShotMoveType, ShotZone, TeamSide
} from '../core/events.js';
import type { SimParams } from './params.js';

export type MoveIntent =
  | 'spot'      // hold/space at assigned spot
  | 'advance'   // bring ball up
  | 'drive'     // attacking the rim with the ball
  | 'cut'       // off-ball cut to the rim
  | 'defend'    // defensive positioning
  | 'crash'     // offensive rebound crash
  | 'getback'   // transition defense retreat
  | 'freeze';   // dead-ball repositioning

export interface Agent {
  p: Player;
  side: TeamSide;
  pos: V2;
  vel: V2;
  energy: number;      // 0-100
  secondsPlayed: number;
  fouls: number;
  onCourt: boolean;
  fouledOut: boolean;

  // working state
  target: V2;
  intent: MoveIntent;
  sprinting: boolean;
  spotKey: string | null;
  manId: string | null;        // defensive assignment
  dribblesSinceCatch: number;
  dribbleAcc: number;          // accumulator converting hold-time to dribbles
  catchT: number;              // t when this agent received the ball
  driveUntil: number;          // t until which a drive commitment holds
  cutUntil: number;
  screenStunUntil: number;     // defender fighting through a screen
  navUnderUntil: number;       // defender ducking under a screen (concedes pull-up space)
}

/** a running team action (pick-and-roll first; more actions join over time) */
export interface PnrAction {
  kind: 'pnr';
  handlerId: string;
  screenerId: string;
  phase: 'coming' | 'set' | 'finishing';
  /** absolute t when the action expires */
  until: number;
  /** t when the screen connected (drives the set -> finishing transition) */
  setAt: number;
}

export interface PendingShot {
  shooterId: string;
  side: TeamSide;
  x: number;
  y: number;
  distFt: number;
  zone: ShotZone;
  three: boolean;
  moveType: ShotMoveType;
  contest: number;
  contestedBy?: string;
  made: boolean;
  assist?: string;
  foul?: { by: string; ftAwarded: number; andOne: boolean };
  atBuzzer: boolean;
}

export interface BallFlight {
  kind: 'pass' | 'shot';
  from: V2;
  to: V2;
  total: number;
  remaining: number;
  // pass fields
  passFrom?: string;
  passTo?: string;
  passKind?: PassEvent['kind'];
  /** pre-rolled pass failure (resolved at launch, applied at arrival) */
  passFail?: { stolenBy: string | null };
  // shot fields
  shot?: PendingShot;
}

export interface Ball {
  holderId: string | null;
  pos: V2;
  flight: BallFlight | null;
}

export type Phase =
  | { kind: 'live' }
  | {
      kind: 'dead';
      resumeIn: number;
      clockRuns: boolean;
      nextTeam: TeamSide;
      possKind: 'inbound' | 'tip';
      /** same possession continues (e.g. non-shooting foul, no turnover) */
      continuation?: boolean;
    }
  | {
      kind: 'freethrows';
      shooterId: string;
      side: TeamSide;
      taken: number;
      of: number;
      nextIn: number;
      lastMade: boolean;
    }
  | {
      kind: 'scramble'; // live rebound up for grabs
      landAt: V2;
      resolveIn: number;
      offSide: TeamSide; // side that shot the ball
    };

export interface Possession {
  team: TeamSide;
  shotClock: number;
  phase: 'advance' | 'halfcourt' | 'transition';
  startT: number;
  kind: 'inbound' | 'live_rebound' | 'steal' | 'tip';
  lastPass: { from: string; t: number } | null;
  spotMap: Map<string, string>; // agentId -> spacing spot key
  /** the running set action, if any (e.g. an active pick-and-roll) */
  action: PnrAction | null;
}

export interface GameState {
  rng: Rng;
  params: SimParams;
  rules: RulePack;
  court: Court;
  teams: [Team, Team];
  agents: Map<string, Agent>;
  /** on-court ids, 5 slots per side — slot order is stable for the replay */
  lineup: [string[], string[]];
  ball: Ball;

  period: number;
  clock: number;   // seconds remaining in period
  t: number;       // absolute elapsed game seconds
  score: [number, number];
  teamFoulsPeriod: [number, number];
  tipWinner: TeamSide;

  poss: Possession;
  phase: Phase;

  events: GameEvent[];
  frames: number[][];
  collectFrames: boolean;

  decisionAt: number; // next ball-handler decision time
  /** shot windup in progress: the catch-and-shoot vs closeout race */
  pendingRelease: {
    shooterId: string;
    moveType: ShotMoveType;
    releaseAt: number;
    /** contest level when the shot was decided (late closeouts count less) */
    contest0: number;
  } | null;
  over: boolean;
}

// ---------- helpers ----------

export function agent(s: GameState, id: string): Agent {
  const a = s.agents.get(id);
  if (!a) throw new Error(`unknown agent ${id}`);
  return a;
}

export function onCourt(s: GameState, side: TeamSide): Agent[] {
  return s.lineup[side].map((id) => agent(s, id));
}

export function other(side: TeamSide): TeamSide {
  return side === 0 ? 1 : 0;
}

/**
 * The rim a side is attacking. Home attacks the high-x rim in the first half,
 * low-x after the break (sides swap like real basketball).
 */
export function attackedRim(s: GameState, side: TeamSide): V2 {
  const firstHalf = s.period <= Math.ceil(s.rules.periods / 2);
  const homeAttacksHigh = firstHalf;
  const attacksHigh = side === 0 ? homeAttacksHigh : !homeAttacksHigh;
  return s.court.rims[attacksHigh ? 1 : 0];
}

export function defendedRim(s: GameState, side: TeamSide): V2 {
  return attackedRim(s, other(side));
}

/** Omit that distributes across a union (plain Omit collapses the union) */
export type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** append an event, stamping time/score context */
export function emit(
  s: GameState,
  e: DistOmit<GameEvent, 't' | 'period' | 'clock' | 'score'>
): void {
  s.events.push({
    ...(e as GameEvent),
    t: round2(s.t),
    period: s.period,
    clock: Math.max(0, round2(s.clock)),
    score: [s.score[0], s.score[1]]
  });
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
