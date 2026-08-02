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

/**
 * Timeout vocabulary, now identical to TimeoutEvent['reason']
 * (core/events.ts): the officiating wave widened the event contract to the
 * full set with replay v3 (fdesign-timeouts §5, value-only widening, no
 * shape change), so the internal superset and the contract converged.
 * 'mandatory' (scorer-imposed TV stoppage, charged per NBA Rule 5 VI(b)
 * convention) and 'regroup' (coach hazard below the stop-run label) are
 * live since the FLOW flip at the shipped params.endgame.to* fits and
 * print in default streams.
 */
export type TimeoutReason = 'stop_run' | 'advance' | 'mandatory' | 'regroup';

export interface Agent {
  p: Player;
  side: TeamSide;
  pos: V2;
  vel: V2;
  energy: number;      // 0-100
  /**
   * Cumulative load, 0-100 ("legs"; fdesign-rhythm M1, live at
   * fatigue.loadPerSec 0.011 since the FLOW flip): the second fatigue
   * pool. Accrues on court on the
   * same speed/stamina chain as energy drain, recovers far slower on the
   * bench, takes one lump off at halftime (possession.ts endPeriod), so it
   * trends across the game where energy is a stint-local sawtooth.
   * Consumed by resolution only: movement.ts effectiveEnergy into the
   * resolve.ts shot-fatigue and speed terms, plus the foul.load*Swing and
   * endgame.deadGameBoost couplings (wired per ffit-rhythm §8, inert while
   * loadPerSec is 0); subs/rotation cadence deliberately keep reading raw
   * energy (M1 contract: the load pool must not silently shorten stints).
   */
  load: number;
  secondsPlayed: number;
  fouls: number;
  onCourt: boolean;
  fouledOut: boolean;
  /** game-clock t of this player's last lineup swap (0 at init), written in
   *  one place, subs.ts swapPlayers. Because movement.ts#advanceClock is the
   *  only writer of t and it only runs during live/clock-running play,
   *  `s.t − a.lastSwapT` reads as live seconds this stint for on-court
   *  players and live seconds rested for bench, the same axis
   *  secondsPlayed uses (two-axes discipline). Consumed by the rotation
   *  grammar (subs.ts quarterWave stint/bench gates, live since the FLOW
   *  flip). */
  lastSwapT: number;

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
  /**
   * defensive goaltending violator (the contesting defender): the miss was
   * flipped to a made shot at the release roll (shooting.ts startShot,
   * live at officiating.goaltendPerContestedInsideMiss 0.0205) and
   * resolveShotOutcome emits the `violation` row right after the shot
   * event. Internal state, never an event field; the contract carries the
   * violation as its own event.
   */
  goaltend?: string;
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
      /**
       * a timeout was called at this stoppage (stamped by sim/endgame.ts
       * callTimeout, which runs before checkSubs at every site; the
       * sub-window handshake, fdesign-timeouts §4): the rotation layer reads
       * it to relax the pull leash for the huddle. Lives for the stoppage
       * only; internal state, never an event/replay field.
       */
      timeout?: { team: TeamSide; reason: TimeoutReason };
    }
  | {
      kind: 'freethrows';
      shooterId: string;
      side: TeamSide;
      taken: number;
      /** attempts the trip can reach — for a one-and-one this is the potential 2; a front-end miss ends the trip early (fouls.ts tickFreeThrows) */
      of: number;
      nextIn: number;
      /** #82 C1 — the whistle-caught ball spot the trip's carry walks FROM.
       *  Entry no longer snaps the ball to the line (that snap was the frame
       *  stream's largest teleport class: 25.4 foul-crossing jumps/g, p50
       *  13.9 ft, max ~75 ft); tickFreeThrows lerps it spot→line across the
       *  ftSetupSec lead-in (fouls.ts). Always stamped by enterFreeThrows,
       *  the variant's only constructor. */
      carryFrom?: V2;
      /** #82 C1 — wall-clock stamp of trip entry, the carry lerp's zero.
       *  wallT on purpose, NOT game-clock t: the game clock is frozen
       *  through the ritual, so a t-keyed lerp would freeze at zero (the
       *  AGENTS §1.5 trap). F1's pendingRelease pair rides t and never
       *  mixes with wallT; this pair rides wallT and never mixes with t. */
      carryT0?: number;
      /** one-and-one bonus trip (NCAA men, rules.bonusRule): the second attempt exists only if the first is made; a front-end miss is a LIVE ball */
      oneAndOne: boolean;
      /** pending technical prefix attempt (officiating wave, fouls.ts): shot
       *  first (n:1 of:1, technical:true, no rebound on a miss, no
       *  possession effects) before the main trip's `taken`/`of` sequence
       *  runs unchanged (real row order: foul → tech → tech FT → the
       *  personal's own penalty). Cleared once shot. */
      pre?: { shooterId: string };
      /** technical-only trip (the triggering foul awarded no FTs of its
       *  own): after the single attempt, tickFreeThrows skips endPossession
       *  and the miss scramble and re-enters `deadBall` with exactly these
       *  stored arguments, so the pre-whistle possession flow resumes
       *  byte-identically to the no-tech path. Every attempt of such a trip
       *  stamps `technical: true`. */
      resume?: { nextTeam: TeamSide; continuation: boolean; resumeIn: number };
      /** same handshake as the dead variant's, written by the FT-whistle
       *  timeout site (fouls.ts enterFreeThrows → maybeFtTimeout,
       *  fdesign-timeouts §1.2.2; live since the FLOW flip) */
      timeout?: { team: TeamSide; reason: TimeoutReason };
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
  /** W64 channel-3 dose (session-8): this transition possession rolled a
   *  live leak-out. One draw per live_rebound/steal possession at
   *  0 < leakOutScale < 1 (heave-guard shape: 0 never draws, >= 1
   *  short-circuits draw-free). Constant false everywhere else. */
  leakArmed: boolean;
  /** #74 transition-carry dose: this transition possession rolled a live
   *  carry (the exact leakArmed shape above — one heave-guard draw, same
   *  live_rebound/steal scope, ai.transCarryScale). Constant false
   *  everywhere else; consumed by game.ts's driving branch. */
  carryArmed: boolean;
  /** #114 halfcourt blow-by dose: this possession rolled a live blow-by
   *  (the leakArmed heave-guard shape above — one draw at
   *  0 < blowByCarryScale < 1, zero draws at 0 and >= 1) — but on EVERY
   *  start kind, where the two transition draws are
   *  live_rebound/steal-scoped: any possession reaches halfcourt. Rolled
   *  in startPossession after the carry draw; consumed by game.ts
   *  blowsByToRim. */
  blowByArmed: boolean;
  /**
   * The period's first possession (fdesign-grammar M1b). Stamped in
   * startPossession: the game clock still reads the period's full value
   * there, which no later possession can reproduce (the period-opening
   * dead ball never runs the clock and any prior possession consumes live
   * ticks). A whistle continuation resumes the same possession object, so
   * the marker survives non-shooting fouls the way a called set survives
   * a whistle. Consumed by concept 9 (ai/concepts.ts openerSet, live at
   * openerShootMalus 0.55).
   */
  opener: boolean;
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
  /** team fouls committed INSIDE the current period's late window
   *  (rules.lateWindowSec) — drives the NBA last-2:00 penalty
   *  (rulepack.ts bonusFreeThrowAward). Resets every period
   *  UNCONDITIONALLY, even where teamFoulsPeriod carries into OT. */
  teamFoulsLate: [number, number];
  tipWinner: TeamSide;

  /**
   * ENDGAME LAYER (GameConfig.endgame). `endgame` gates every late-game
   * behavior (concept 6, intentional fouling, timeouts) — ON by default
   * since the n=1260/arm flag survey (2026-07-28; `cfg.endgame ?? true`,
   * game.ts). Pass `endgame: false` for the byte-identical legacy path.
   * `timeoutsLeft` /`runPts`
   * are always maintained (cheap bookkeeping, no rng) but only READ when
   * the flag is on: runPts mirrors the unanswered-points definition the
   * narration ContextTracker uses (a team's own score accrues, an opponent
   * score zeroes it) and feeds the stop-the-run timeout trigger.
   */
  endgame: boolean;
  timeoutsLeft: [number, number];
  runPts: [number, number];
  /**
   * Timeout-economy bookkeeping (fdesign-timeouts §3.2). Same doctrine as
   * runPts/timeoutsLeft above: cheap counters maintained always (no rng),
   * read only when the flag is on; the consumers (sim/endgame.ts
   * decideMandatory/canSpend) are live since the FLOW flip at the shipped
   * params.endgame to* fits. Per-period
   * counters reset unconditionally in endPeriod (unlike the OT foul carry).
   */
  /** timeouts charged per side this period; drives the mandatory-stoppage
   *  owed/charging arithmetic (voluntary calls count toward it: that is what
   *  makes real totals substitute rather than add) */
  timeoutsThisPeriod: [number, number];
  /** timeouts used per side in the final scheduled period (the ≤4 cap) */
  timeoutsUsedFinalPeriod: [number, number];
  /** ...of which inside its last toFinalPeriodLateSec (the ≤2 cap) */
  timeoutsUsedFinalLate: [number, number];
  /** game-clock t of each side's last timeout (coach-hazard cooldown), −99 at init */
  lastTimeoutT: [number, number];
  /**
   * GARBAGE-TIME CONCEDE flags, per side: "this game is decided — starters
   * out, whoever's on the bench closes it." Written only inside checkSubs
   * (sim/subs.ts: updateConcede plus the unconditional crunch clear — dead
   * balls, the only places subs happen), read only by its concede branch.
   * Final period only, hysteresis in both directions. Like runPts:
   * always-maintained bookkeeping with no rng and no events — a game that
   * never crosses the concede line is byte-identical.
   */
  conceded: [boolean, boolean];

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
    /** #74 transition carry: this windup is a carried break finish — the
     *  RELEASE point is the rim plane by construction (startShot), because
     *  a sprinting body's stopping distance is exactly the behind-plane
     *  artifact the carry removes; the CONTEST still reads off the body at
     *  release, so traffic prices the finish honestly. Absent everywhere
     *  else. */
    carryRim?: boolean;
    /** #74 F1 amendment — the carried gather's ball path: the windup-start
     *  ball spot (the decide-time body position) the ball travels FROM.
     *  During a carried windup the ball no longer rides the sliding body:
     *  it moves body-to-rim across the windup (game.ts), meeting the hoop
     *  exactly at release — so the rim-plane booking is continuous instead
     *  of a release-tick teleport off a body that has already passed the
     *  plane (measured slide: release-tick body-to-rim p50 4.87 ft, max
     *  9.95, on decide gaps of at most the gather gate). Defense reads the
     *  honest ball (windup closeouts converge on the finish, not the
     *  fly-by). Stamped with carryRim; absent everywhere else. */
    carryFrom?: V2;
    /** #74 F1 amendment — game-clock stamp of the carried windup's start
     *  (the decide tick), the lerp's zero. Game-clock t on purpose, the
     *  same axis as releaseAt: the pair never mixes with wallT. */
    carryT0?: number;
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
