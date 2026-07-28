/**
 * The public API of @hoopsh/engine.
 *
 * The engine is pure and deterministic: no I/O, no globals, no Math.random.
 * Everything downstream (stats, narration, viewers, experiences) consumes
 * the event stream and replay this package produces.
 */

// core
export { Rng, sigmoid, clamp } from './core/rng.js';
export * as vec from './core/vec.js';
export type { V2 } from './core/vec.js';
export type {
  GameEvent, GameEventType, TeamSide, ShotZone, ShotMoveType,
  TurnoverKind, FoulKind, PossessionOutcome,
  ShotEvent, PassEvent, ReboundEvent, TurnoverEvent, FoulEvent,
  FreeThrowEvent, SubstitutionEvent, PossessionStartEvent, PossessionEndEvent,
  GameStartEvent, GameEndEvent, PeriodStartEvent, PeriodEndEvent, TipOffEvent,
  TimeoutEvent
} from './core/events.js';

// rules & court
export { NBA, NCAA, EUROLEAGUE, bonusFreeThrowAward } from './rules/rulepack.js';
export type { RulePack, ThreePointGeometry, BonusAward } from './rules/rulepack.js';
export { makeCourt, classifyShot, spacingSpots } from './geometry/court.js';
export type { Court, ShotLocation } from './geometry/court.js';

// player model
export { makePlayer, makeTactics } from './model/player.js';
export type {
  Player, Attributes, Tendencies, Team, Tactics, Position
} from './model/player.js';
export { sprintSpeed, acceleration, lateralSpeed, reachFt } from './model/derived.js';

// params (the calibration surface)
export { defaultParams, withParams } from './sim/params.js';
export type { SimParams } from './sim/params.js';

// simulation
export { simulateGame } from './sim/game.js';
export type { GameConfig, GameResult } from './sim/game.js';

// replay
export { buildReplay } from './replay/replay.js';
export type { Replay, ReplayTeamMeta, ReplayPlayerMeta, LineupSnapshot } from './replay/replay.js';
