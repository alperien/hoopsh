/**
 * The event stream — hoopsh's most important public contract.
 *
 * Every discrete outcome in a game is a typed event. Stats, narration, viewers,
 * and future experiences are all pure consumers of this stream. The engine
 * guarantees the stream fully describes the game (box scores are derivable
 * from events alone).
 */

export type TeamSide = 0 | 1; // 0 = home, 1 = away

export type ShotZone = 'rim' | 'paint' | 'mid' | 'three';

/**
 * How a shot was created, in basketball terms — feeds both the make-probability
 * model (resolve.ts shotMakeP's moveAdj term) and narration/stat breakdowns.
 * Produced by the AI (sim/ai/decide.ts's acquisition-aware quick-touch
 * taxonomy, plus sim/possession.ts's automatic putback branch):
 * `catch_shoot` — a PERIMETER (mid/three) 0-dribble jumper released within
 * the quick window (params.decide.quickCatchSec) of gaining the ball; only a
 * caught pass carries delivery quality into it (see Agent.acquiredBy).
 * `cut_finish` — an interior (rim/paint) 0-dribble quick finish off a caught
 * pass: hit in stride and laid in.
 * `putback` — an offensive-rebound touch put straight back up, via either
 * possession.ts's automatic branch or the decision layer's quick window.
 * `pull_up` — an off-the-dribble jumper after the quick window (or any
 * dribbled-into shot).
 * `drive` — a shot at the rim off a live drive commitment, or a scramble
 * finish off a steal/dead-ball touch inside the quick window.
 * `post` — a shot from a worked post-up (assigned once the post action
 * reaches its 'working' phase).
 * `heave` — desperation end-of-clock/end-of-period launch from distance,
 * resolved with a heavy make-probability penalty.
 */
export type ShotMoveType =
  | 'catch_shoot'
  | 'pull_up'
  | 'drive'
  | 'cut_finish'
  | 'post'
  | 'putback'
  | 'heave';

/**
 * How a turnover happened. `bad_pass` — a thrown pass that misses (sim/passing.ts
 * resolvePassArrival), always carries `stolenBy` when a defender picks it off.
 * `lost_ball` — stripped by a reach-in on the current holder (sim/passing.ts
 * attemptReachIn), always carries `stolenBy`. `off_foul` — a charge committed
 * while driving (sim/game.ts tickLive); always immediately followed by a
 * `foul` event with kind 'offensive' for the same player. `shot_clock` — the
 * shot clock expired with the ball still live (sim/game.ts tickLive); never
 * carries `stolenBy`. `out_of_bounds` — a failed pass that isn't picked off
 * (sim/passing.ts resolvePassArrival); never carries `stolenBy`.
 */
export type TurnoverKind =
  | 'bad_pass'
  | 'lost_ball'
  | 'off_foul'
  | 'shot_clock'
  | 'out_of_bounds';

/**
 * What kind of foul was called. `shooting` — contact during a shot attempt
 * (sim/shooting.ts resolveShotOutcome); always paired with the triggering
 * `shot` event's own `foul` field. `reach` — a defender's steal attempt that
 * missed and made contact instead (sim/passing.ts attemptReachIn). `offensive`
 * — a charge (sim/game.ts tickLive); counts against the fouler's personal
 * total but, per NBA rule, is NOT a team foul (doesn't count toward the bonus
 * — see rules/rulepack.ts teamFoulBonusAt). `loose_ball` — contact during a
 * live-rebound scramble (sim/possession.ts tickScramble), defense-only in the
 * current model.
 */
export type FoulKind = 'shooting' | 'reach' | 'offensive' | 'loose_ball';

/**
 * How a possession ended — always exactly one `possession_end` event per
 * possession carries one of these (see the `ended` guard on Possession in
 * sim/state.ts, enforced by sim/possession.ts endPossession, which is a
 * no-op if already called this possession). `made_fg` — a clean field goal
 * with no shooting foul (sim/shooting.ts resolveShotOutcome). A made shot
 * WITH a shooting foul (and-one) does not end the possession here at all —
 * it hands off to the free-throw sequence, which is what actually closes the
 * possession: `made_ft` if that FT sequence's last attempt goes in,
 * otherwise the sequence's live-rebound scramble decides it (`def_rebound`,
 * or the offense keeps the same possession alive on an offensive rebound
 * with no possession_end in between). `def_rebound` — the defense secured
 * the rebound off a missed shot or missed final free throw: either a
 * live-ball board by a player (next possession starts as 'live_rebound') or
 * a dead carom awarded to the defense as a TEAM rebound (next possession
 * starts as a dead-ball 'inbound' — see ReboundEvent below). `turnover` —
 * any TurnoverKind. `period_end` — the period horn sounded with the
 * possession still live (a no-shot buzzer-beater situation).
 */
export type PossessionOutcome =
  | 'made_fg'
  | 'made_ft'
  | 'def_rebound'
  | 'turnover'
  | 'period_end';

/**
 * Fields common to every event. Two independent time axes — never mix them:
 *
 * - `t` — GAME-CLOCK time: absolute elapsed game seconds across periods,
 *   frozen during every stoppage (free throws, dead balls, out-of-bounds
 *   resets). This is the axis stats/box scores key on (minutes played, "how
 *   much basketball has actually happened"). Two events during the same dead
 *   ball share the same `t`.
 * - `wt` — WALL-CLOCK timeline: seconds on hoopsh's own replay timeline,
 *   advancing on every single tick, stoppages included. This is the axis
 *   viewers/replays key on — it's what lets a replay show free-throw
 *   routines and inbound repositioning as real elapsed time instead of
 *   instantaneous jumps. `wt` is always >= `t`, monotonically non-decreasing
 *   across the event stream, and matches `replay/replay.ts` frame timestamps
 *   and `LineupSnapshot.t` exactly (both key on the same wall clock).
 *
 * Consumers: use `t` for anything statistical (per-minute rates, game-clock
 * display); use `wt` for anything about REPLAYING the game (syncing to
 * frames, animating between events, lineup timelines).
 */
interface Base {
  /** absolute elapsed game seconds (across periods, excludes stoppage) */
  t: number;
  /**
   * wall-clock timeline seconds — advances during EVERY phase including
   * stoppages (free throws, dead balls). Viewers and replays key on this;
   * stats key on t (game-clock time).
   */
  wt: number;
  /** 1-based period number; > rules.periods once the game enters overtime */
  period: number;
  /** seconds remaining in period */
  clock: number;
  /** score AFTER this event: [home, away] */
  score: [number, number];
}

/** Fires exactly once, first in the stream. `lineup` is each team's 5 starting on-court player ids, in stable slot order (slot index is meaningful — see replay.ts and the frame holderSlot encoding). */
export interface GameStartEvent extends Base {
  type: 'game_start';
  home: { teamId: string; lineup: string[] };
  away: { teamId: string; lineup: string[] };
}

/** Fires once per period-opening jump ball: at game start and, per NBA convention, again at the start of every overtime period (regulation Q2/Q3/Q4 possession arrows follow the fixed alternating rule instead — see sim/possession.ts endPeriod). `winner` gets the ball first. */
export interface TipOffEvent extends Base {
  type: 'tip_off';
  winner: TeamSide;
}

/** Fires once at the start of every period, including each overtime. */
export interface PeriodStartEvent extends Base {
  type: 'period_start';
}

/** Fires once when a period's clock reaches 0, before either `period_start` (next period) or `game_end`. */
export interface PeriodEndEvent extends Base {
  type: 'period_end';
}

/** Fires exactly once, always last in the stream — only after a period ends with the score NOT tied once regulation+OT periods are exhausted (a tied period always triggers another overtime instead). */
export interface GameEndEvent extends Base {
  type: 'game_end';
}

/** Marks the start of a new possession for `team`. Pairs 1:1 with a later `possession_end` for the same possession. `kind` — 'inbound': dead-ball inbound (make/miss-and-FT/OOB/violation aftermath); 'live_rebound': defense grabbed a live-ball defensive rebound and plays on without a stoppage; 'steal': a takeaway (bad pass or reach-in) starts the new team's possession immediately, ball-in-hand; 'tip': the opening possession of a period off a jump ball. */
export interface PossessionStartEvent extends Base {
  type: 'possession_start';
  team: TeamSide;
  kind: 'inbound' | 'live_rebound' | 'steal' | 'tip';
}

/**
 * Closes out the possession opened by the matching `possession_start`.
 * Fires EXACTLY once per possession — sim/possession.ts endPossession guards
 * this with `s.poss.ended`, so and-one/buzzer/FT-scramble flows that could
 * plausibly double-fire all route through the same guarded call. Pace,
 * offensive rating, and per-possession stats all depend on this invariant
 * holding (see docs/INTERNALS.md's invariant suite).
 */
export interface PossessionEndEvent extends Base {
  type: 'possession_end';
  team: TeamSide;
  outcome: PossessionOutcome;
}

/**
 * A completed pass between two on-court teammates (failed passes are
 * `turnover` events instead, kind `bad_pass` or `lost_ball` — a failed pass
 * never produces a `pass` event). `kind` — 'normal': a standard halfcourt
 * pass; 'kickout': a pass out of a live drive (sim/ai.ts decideBall labels
 * any pass while `driving` a kickout); 'outlet': a pass during transition
 * phase (fast break ball movement); 'entry': the feed to a posted big
 * (assigned by sim/ai/decide.ts when the post action is 'posting' and the
 * poster is settled on the block); 'handoff': a dribble-handoff — the hub
 * screens for the receiver as he hands it off (assigned by sim/ai/decide.ts
 * when the DHO receiver has sprinted into range; the catch stuns his trailing
 * defender, see sim/passing.ts). Both are live AI code paths today.
 */
export interface PassEvent extends Base {
  type: 'pass';
  team: TeamSide;
  from: string;
  to: string;
  kind: 'normal' | 'kickout' | 'outlet' | 'entry' | 'handoff';
}

/**
 * A shot attempt, made or missed — the richest event in the stream (shot
 * charts are built directly from `x`/`y`/`distFt`/`zone`/`three`). Invariants:
 * `points` is always 0 when `made` is false, and always `three ? 3 : 2` when
 * `made` is true — never inferred from `zone` alone (zone 'rim'/'paint'/'mid'
 * are all worth 2). `assist` is present only when `made` is true AND the
 * passer was still on-court at the moment of the shot (sim/shooting.ts
 * startShot explicitly excludes a passer who was subbed out between his pass
 * and this shot — "no assists from the bench"); a missed shot never carries
 * an `assist` even if it came right off a pass. `blockedBy` can only be set
 * when `made` is false (sim/shooting.ts startShot only rolls for a block on
 * a would-be miss, to keep the raw make-percentage calibration clean —
 * blocks subtract from misses, not from makes). `foul` is present when
 * shooting-foul contact occurred on this attempt regardless of make/miss:
 * `andOne: true` iff the shot ALSO went in (bonus single free throw);
 * `andOne: false` means the shot missed and `ftAwarded` (2 or 3, matching
 * shot value) free throws follow. `contestedBy`/`contest` describe the
 * closest defender's contest level at release (0 wide open .. 1 smothered),
 * independent of whether that defender is also `blockedBy` or the foul's
 * `by`.
 */
export interface ShotEvent extends Base {
  type: 'shot';
  team: TeamSide;
  shooter: string;
  x: number;
  y: number;
  distFt: number;
  zone: ShotZone;
  three: boolean;
  moveType: ShotMoveType;
  /** 0 = wide open .. 1 = smothered */
  contest: number;
  contestedBy?: string;
  made: boolean;
  points: 0 | 2 | 3;
  assist?: string;
  blockedBy?: string;
  foul?: { by: string; ftAwarded: number; andOne: boolean };
}

/**
 * One free throw within a sequence (a personal trip, a bonus trip, or an
 * and-one). `n`/`of` give the 1-based position within that sequence and its
 * total length — e.g. the second shot of a two-shot foul is `n: 2, of: 2`;
 * an and-one is always `n: 1, of: 1`. A shooter can appear across multiple
 * `free_throw` events for the SAME trip (one per attempt) but the trip
 * itself is never split across two separate shooting fouls. The sequence's
 * final attempt (n === of) is what can trigger `possession_end` — see
 * sim/fouls.ts tickFreeThrows.
 */
export interface FreeThrowEvent extends Base {
  type: 'free_throw';
  team: TeamSide;
  shooter: string;
  n: number;
  of: number;
  made: boolean;
}

/**
 * A rebound. `offensive` is true when `team` matches the side that took the
 * missed shot. `x`/`y` are the ball's landing/contest spot, not the
 * rebounder's position.
 *
 * Three flavors, distinguished by `player`/`deadBall`:
 *  - `player` set — a live-ball rebound secured by that individual (miss or
 *    missed-final-free-throw scramble). The only flavor before team
 *    rebounds landed; every stat consumer credits it to the player.
 *  - `player` absent, no `deadBall` — a TEAM rebound: the live carom died
 *    without any individual securing it (skipped out of bounds / rolled
 *    dead), and the officials award `team` the ball at a dead-ball inbound
 *    (sim/possession.ts tickScramble, rate params.reb.deadBallCaromChance;
 *    the side is drawn from the same positioning-weighted lottery a player
 *    rebound uses, so ORB%'s expectation is unchanged). Real logs read
 *    "Defensive rebound by Team". Counts toward TEAM rebound totals with no
 *    player line — official-scoring convention (stats/box.ts).
 *  - `deadBall: true` (always playerless, always offensive) — the
 *    scorekeeping FORMALITY logged after a missed NON-final free throw:
 *    the ball is dead by rule, nobody rebounds anything, the next attempt
 *    simply proceeds (sim/fouls.ts tickFreeThrows). Real logs print
 *    "Offensive rebound by Team" here; official scoring EXCLUDES these
 *    dead-ball rebounds from all rebound totals, and stats/box.ts does the
 *    same. Emitted for play-by-play fidelity, not for the box score.
 */
export interface ReboundEvent extends Base {
  type: 'rebound';
  team: TeamSide;
  /** rebounder id — ABSENT for a team rebound (no individual credit) */
  player?: string;
  offensive: boolean;
  /** scorekeeping formality after a missed non-final FT (see above) */
  deadBall?: boolean;
  x: number;
  y: number;
}

/** A live-ball possession change without a shot attempt. `team` is the team that turned it over (losing the ball), never the team that gains it. `stolenBy`, when present, names the defender who is immediately awarded the ensuing possession — see TurnoverKind above for which kinds can/can't carry it. */
export interface TurnoverEvent extends Base {
  type: 'turnover';
  team: TeamSide;
  player: string;
  kind: TurnoverKind;
  stolenBy?: string;
}

/**
 * A personal foul. `personalCount` is the fouler's running total for the
 * game (not the period); `teamCountInPeriod` is the fouling TEAM's count for
 * the current period only, resetting each period (drives `inBonus`, per
 * rules.teamFoulBonusAt — note per FoulKind that 'offensive' fouls do NOT
 * increment this team count). `fouledOut: true` exactly when
 * `personalCount >= rules.foulOutAt`; when that happens the engine
 * immediately attempts a replacement (sim/fouls.ts recordFoul ->
 * sim/subs.ts replaceFouledOut), so a `fouledOut: true` foul is followed by
 * a `substitution` event for the same player UNLESS the team's entire bench
 * is already on the floor or fouled out (a real but rare short-roster edge
 * case — see replaceFouledOut's early return).
 */
export interface FoulEvent extends Base {
  type: 'foul';
  /** team of the player committing the foul */
  team: TeamSide;
  on: string;
  kind: FoulKind;
  drawnBy?: string;
  personalCount: number;
  teamCountInPeriod: number;
  inBonus: boolean;
  fouledOut: boolean;
}

/**
 * A team timeout (endgame layer — only ever emitted when the game was run
 * with `GameConfig.endgame: true`; a default-config stream never contains
 * one). Fires at a dead ball, called by the team that will inbound
 * (possession requirement, like the real rule — see sim/endgame.ts
 * maybeTimeout, invoked from sim/possession.ts deadBall). `reason` —
 * 'stop_run': the opponent has scored `params.endgame.timeoutRunPts`
 * unanswered and the coach stops the bleeding; 'advance': a trailing team
 * late in the final period burns a timeout so the ensuing inbound starts in
 * the FRONTcourt (the real advance-the-ball rule — the mechanical payoff is
 * the inbound spot, see sim/possession.ts setupDeadTargets). `remaining` is
 * the calling team's budget AFTER this timeout (budget per game:
 * rules.timeoutsPerGame). The game clock never runs during the timeout;
 * `wt` keeps advancing so replays show the huddle as real elapsed time.
 */
export interface TimeoutEvent extends Base {
  type: 'timeout';
  team: TeamSide;
  reason: 'stop_run' | 'advance';
  /** timeouts the calling team has left AFTER this one */
  remaining: number;
}

/**
 * A lineup change. `out`/`in` are parallel arrays (`out[i]` is replaced by
 * `in[i]`) but every current caller (sim/subs.ts swapPlayers) only ever
 * swaps one player at a time, so in practice both arrays always have exactly
 * one element — the array shape exists to allow a future multi-player swap
 * without a breaking event-schema change, not because that happens today.
 * Fires only at dead-ball moments or an immediate fouled-out replacement
 * (never mid-live-play otherwise) — see sim/subs.ts checkSubs/replaceFouledOut.
 */
export interface SubstitutionEvent extends Base {
  type: 'substitution';
  team: TeamSide;
  out: string[];
  in: string[];
}

/** The full discriminated union — every event a game can ever emit, discriminated on `type`. */
export type GameEvent =
  | GameStartEvent
  | TipOffEvent
  | PeriodStartEvent
  | PeriodEndEvent
  | GameEndEvent
  | PossessionStartEvent
  | PossessionEndEvent
  | PassEvent
  | ShotEvent
  | FreeThrowEvent
  | ReboundEvent
  | TurnoverEvent
  | FoulEvent
  | TimeoutEvent
  | SubstitutionEvent;

/** Just the `type` tags of GameEvent, e.g. for building `Record<GameEventType, ...>` handler tables. */
export type GameEventType = GameEvent['type'];
