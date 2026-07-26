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

/**
 * How the current holder came to have the ball — the acquisition context a
 * shot/assist taxonomy needs. A caught PASS is the only acquisition that
 * makes a no-dribble quick shot a CATCH-and-shoot (and the only one whose
 * delivery quality legitimately rides the release); a rebound grabbed at the
 * rim and put straight back up is a putback; a steal or a dead-ball resume
 * is a self-generated touch. Before this existed, decide.ts labeled every
 * quick 0-dribble shot `catch_shoot` — 22% of ALL attempts were interior
 * shots wearing a jump-shot label, and the passQuality term read a stale
 * delivery from a pass caught possessions earlier (wave2 diagnostic).
 */
export type BallAcquisition = 'pass' | 'rebound' | 'steal' | 'deadball';

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
  /** how this touch was acquired (stamped by giveBall) — gates the quick-shot
   *  taxonomy (catch_shoot vs cut_finish vs putback) and assist eligibility */
  acquiredBy: BallAcquisition;
  /** delivery quality of the LAST pass caught, n-space [-1,1] — set on every
   *  catch from the passer's passAcc/passVision; feeds the catch-and-shoot
   *  make model ("on time, on target" — teammates shoot better next to a
   *  great passer, which is also what routes assists to passing QUALITY) */
  catchQuality: number;
  /** possessions this agent has USED this game (shot attempts; the numerator
   *  of the closed-loop usage share — see decideBall's usage pressure) */
  usedPoss: number;
  /** team offensive possessions completed while this agent was on court (the
   *  denominator of realized usage share) */
  teamPossOnCourt: number;
  driveUntil: number;          // t until which a drive commitment holds
  cutUntil: number;
  /** live purposeful-relocation window (shake off a bending defense) — target holds until this expires */
  relocUntil: number;
  screenStunUntil: number;     // defender fighting through a screen
  navUnderUntil: number;       // defender ducking under a screen (concedes pull-up space)
}

/** a running team action — pick-and-roll, post-up, or isolation */
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

export interface PostAction {
  kind: 'post';
  /** the big working the block */
  posterId: string;
  /** holder when the action was called (informational — any current holder may enter) */
  feederId: string;
  /** posting: establishing position, waiting on the entry; working: has the ball on the block */
  phase: 'posting' | 'working';
  until: number;
  /** t of the entry catch (drives the backdown window in decideBall) */
  postedAt: number;
}

export interface IsoAction {
  kind: 'iso';
  handlerId: string;
  until: number;
}

/**
 * Dribble-handoff: the hub holds while the receiver sprints to him; the
 * handoff is an ordinary pass (kind 'handoff') whose CATCH stuns the
 * receiver's trailing defender — the hub's body is the screen. The elbow
 * touch that powers hub-center offenses.
 */
export interface DhoAction {
  kind: 'dho';
  hubId: string;
  receiverId: string;
  until: number;
}

export type TeamAction = PnrAction | PostAction | IsoAction | DhoAction;

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
      /**
       * an 'advance' timeout was called during this dead ball: the inbound
       * sets up in the FRONTcourt (sim/possession.ts setupDeadTargets reads
       * this) — endgame layer only (sim/endgame.ts maybeTimeout)
       */
      advanceInbound?: boolean;
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
  /**
   * THIS possession's spacing-spot coordinates: the geometric template
   * (geometry/court.ts spacingSpots) plus a small seeded per-possession
   * jitter (params.ai.spotJitterFt), rolled once in assignSpots. Every
   * consumer of a spot position during the possession (off-ball spacing,
   * relocations, post-block targets) reads THIS map, never the raw
   * template — that's what keeps the same trip internally coherent while
   * different trips stop reproducing five bit-identical coordinates (the
   * repeated "26 ft"/"5 ft" shot-distance tell from the Turing baseline).
   */
  spots: Map<string, V2>;
  /** the running set action, if any (e.g. an active pick-and-roll) */
  action: TeamAction | null;
  /** guard: possession_end has been emitted for this possession */
  ended: boolean;
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
  t: number;       // absolute elapsed game seconds (game-clock time)
  wallT: number;   // wall-clock timeline: advances every tick, stoppages included
  score: [number, number];
  teamFoulsPeriod: [number, number];
  tipWinner: TeamSide;

  /**
   * ENDGAME LAYER (GameConfig.endgame). `endgame` gates every late-game
   * behavior (concept 6, intentional fouling, timeouts) — false is the
   * default and the byte-identical legacy path. `timeoutsLeft` /`runPts`
   * are always maintained (cheap bookkeeping, no rng) but only READ when
   * the flag is on: runPts mirrors the unanswered-points definition the
   * narration ContextTracker uses (a team's own score accrues, an opponent
   * score zeroes it) and feeds the stop-the-run timeout trigger.
   */
  endgame: boolean;
  timeoutsLeft: [number, number];
  runPts: [number, number];

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

/**
 * On-court players EXCLUDING the fouled-out. The bench-exhausted degenerate
 * state legally leaves a fouled-out player standing in the lineup (see
 * subs.ts replaceFouledOut's early return), so nearly every actor query —
 * who can shoot, contest, steal, rebound, be passed to — must filter him
 * out. That filter used to be a `.fouledOut` check hand-repeated at ~15
 * call sites, where forgetting one meant a ghost actor (an audited
 * invariant violation happened exactly this way). One definition now.
 * Plain onCourt remains for lineup mechanics (slots, frames, matchup
 * bookkeeping) where the body still physically exists on the floor.
 */
export function liveOnCourt(s: GameState, side: TeamSide): Agent[] {
  return onCourt(s, side).filter((a) => !a.fouledOut);
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
  e: DistOmit<GameEvent, 't' | 'wt' | 'period' | 'clock' | 'score'>
): void {
  s.events.push({
    ...(e as GameEvent),
    t: round2(s.t),
    wt: round2(s.wallT),
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
