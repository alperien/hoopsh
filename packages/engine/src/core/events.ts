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

export type ShotMoveType =
  | 'catch_shoot'
  | 'pull_up'
  | 'drive'
  | 'cut_finish'
  | 'post'
  | 'putback'
  | 'heave';

export type TurnoverKind =
  | 'bad_pass'
  | 'lost_ball'
  | 'off_foul'
  | 'shot_clock'
  | 'out_of_bounds';

export type FoulKind = 'shooting' | 'reach' | 'offensive' | 'loose_ball';

export type PossessionOutcome =
  | 'made_fg'
  | 'made_ft'
  | 'def_rebound'
  | 'turnover'
  | 'period_end';

interface Base {
  /** absolute elapsed game seconds (across periods, excludes stoppage) */
  t: number;
  /**
   * wall-clock timeline seconds — advances during EVERY phase including
   * stoppages (free throws, dead balls). Viewers and replays key on this;
   * stats key on t (game-clock time).
   */
  wt: number;
  period: number;
  /** seconds remaining in period */
  clock: number;
  /** score AFTER this event: [home, away] */
  score: [number, number];
}

export interface GameStartEvent extends Base {
  type: 'game_start';
  home: { teamId: string; lineup: string[] };
  away: { teamId: string; lineup: string[] };
}

export interface TipOffEvent extends Base {
  type: 'tip_off';
  winner: TeamSide;
}

export interface PeriodStartEvent extends Base {
  type: 'period_start';
}

export interface PeriodEndEvent extends Base {
  type: 'period_end';
}

export interface GameEndEvent extends Base {
  type: 'game_end';
}

export interface PossessionStartEvent extends Base {
  type: 'possession_start';
  team: TeamSide;
  kind: 'inbound' | 'live_rebound' | 'steal' | 'tip';
}

export interface PossessionEndEvent extends Base {
  type: 'possession_end';
  team: TeamSide;
  outcome: PossessionOutcome;
}

export interface PassEvent extends Base {
  type: 'pass';
  team: TeamSide;
  from: string;
  to: string;
  kind: 'normal' | 'kickout' | 'outlet' | 'entry';
}

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

export interface FreeThrowEvent extends Base {
  type: 'free_throw';
  team: TeamSide;
  shooter: string;
  n: number;
  of: number;
  made: boolean;
}

export interface ReboundEvent extends Base {
  type: 'rebound';
  team: TeamSide;
  player: string;
  offensive: boolean;
  x: number;
  y: number;
}

export interface TurnoverEvent extends Base {
  type: 'turnover';
  team: TeamSide;
  player: string;
  kind: TurnoverKind;
  stolenBy?: string;
}

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

export interface SubstitutionEvent extends Base {
  type: 'substitution';
  team: TeamSide;
  out: string[];
  in: string[];
}

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
  | SubstitutionEvent;

export type GameEventType = GameEvent['type'];
