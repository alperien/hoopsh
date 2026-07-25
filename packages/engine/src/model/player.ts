/**
 * The handcrafted player model: attributes (what a player CAN do) and
 * tendencies (what a player WANTS to do). All 0-100, human-editable.
 *
 * Identity emerges from the interaction of both under the engine's spatial
 * context — e.g. an all-time shooter profile is elite `three` + heavy
 * `shotThree`/`pullUp` tendencies + high `offBallMotion`, which also creates
 * gravity that warps how defenses guard him.
 */

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export interface Attributes {
  // physical
  speed: number;
  accel: number;
  strength: number;
  vertical: number;
  lateral: number;
  stamina: number;

  // scoring
  finishing: number; // layups, dunks, rim pressure
  midRange: number;
  three: number;
  freeThrow: number;
  drawFoul: number;

  // playmaking
  ballHandle: number;
  passAcc: number;
  passVision: number;

  // defense
  /** STAGED — consumed when defensive schemes land (Stage 2); see docs/INTERNALS.md */
  perimeterD: number;
  /** STAGED — consumed when defensive schemes land (Stage 2); see docs/INTERNALS.md */
  interiorD: number;
  steal: number;
  block: number;
  contestSkill: number;

  // rebounding
  offReb: number;
  defReb: number;
  boxout: number;

  // mental
  decisions: number; // shot selection & pass reads
  /** STAGED — consumed by the hot/cold variance model (Stage 3); see docs/INTERNALS.md */
  consistency: number;
}

export interface Tendencies {
  // shot diet — relative weights across zones
  shotRim: number;
  shotMid: number;
  shotThree: number;
  /** pull-up vs catch-and-shoot inclination */
  pullUp: number;

  // with-ball inclinations
  drive: number;
  passOut: number;
  /** STAGED — consumed when the iso action lands (Stage 2); see docs/INTERNALS.md */
  iso: number;
  /** STAGED — consumed when the post-up action lands (Stage 2); see docs/INTERNALS.md */
  post: number;

  // off-ball behavior
  offBallMotion: number; // relocations & cuts vs static spot-up
  crashOffReb: number;

  // defense
  gambleSteal: number;
  foulAggr: number;

  // pace
  /** STAGED — consumed by the team-pace layer (Stage 2); see docs/INTERNALS.md */
  pushPace: number;
}

export interface Player {
  id: string;
  name: string;
  pos: Position;
  heightIn: number;
  weightLb: number;
  wingspanIn?: number;
  attr: Attributes;
  tend: Tendencies;
}

export interface Tactics {
  /** 0-100: walk-it-up .. run-and-gun */
  pace: number;
  /** 0-100: global three-point appetite modifier */
  threeBias: number;
  /** 0-100: how aggressively help defense converges */
  helpAggr: number;
}

export interface Team {
  id: string;
  name: string;
  abbrev: string;
  players: Player[];
  /** 5 player ids */
  starters: string[];
  tactics: Tactics;
  /** optional target minutes per player id (defaults derived from starters) */
  rotationMinutes?: Record<string, number>;
}

const DEFAULT_ATTR: Attributes = {
  speed: 50, accel: 50, strength: 50, vertical: 50, lateral: 50, stamina: 50,
  finishing: 50, midRange: 50, three: 50, freeThrow: 50, drawFoul: 50,
  ballHandle: 50, passAcc: 50, passVision: 50,
  perimeterD: 50, interiorD: 50, steal: 50, block: 50, contestSkill: 50,
  offReb: 50, defReb: 50, boxout: 50,
  decisions: 50, consistency: 50
};

const DEFAULT_TEND: Tendencies = {
  shotRim: 50, shotMid: 30, shotThree: 40, pullUp: 35,
  drive: 45, passOut: 50, iso: 25, post: 15,
  offBallMotion: 45, crashOffReb: 40,
  gambleSteal: 35, foulAggr: 40,
  pushPace: 45
};

let anonCounter = 0;

/** Build a player from partial overrides — the workhorse of tests & fixtures. */
export function makePlayer(
  partial: Partial<Omit<Player, 'attr' | 'tend'>> & {
    attr?: Partial<Attributes>;
    tend?: Partial<Tendencies>;
  }
): Player {
  anonCounter += 1;
  return {
    id: partial.id ?? `p${anonCounter}`,
    name: partial.name ?? `Player ${anonCounter}`,
    pos: partial.pos ?? 'SF',
    heightIn: partial.heightIn ?? 78,
    weightLb: partial.weightLb ?? 215,
    wingspanIn: partial.wingspanIn,
    attr: { ...DEFAULT_ATTR, ...partial.attr },
    tend: { ...DEFAULT_TEND, ...partial.tend }
  };
}

export function makeTactics(partial?: Partial<Tactics>): Tactics {
  return { pace: 50, threeBias: 50, helpAggr: 50, ...partial };
}
