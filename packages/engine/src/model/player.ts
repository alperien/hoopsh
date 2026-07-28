/**
 * The handcrafted player model: attributes (what a player can do) and
 * tendencies (what a player wants to do). All 0-100, human-editable.
 *
 * Identity comes from the two interacting under the engine's spatial
 * context: an all-time shooter profile is elite `three` + heavy
 * `shotThree`/`pullUp` tendencies + high `offBallMotion`, which also creates
 * gravity that warps how defenses guard him.
 */

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export interface Attributes {
  // physical
  /** max sprint speed (model/derived.ts sprintSpeed); also feeds fatigue's speedShare drain term */
  speed: number;
  /** acceleration off a stop/cut (model/derived.ts acceleration); governs how fast velocity can change each tick in movement.ts */
  accel: number;
  /** screen-setting punch (ai.ts actionTick "fight" term) and rebound box-out leverage alongside boxout/offReb/defReb in resolve.ts resolveRebound */
  strength: number;
  /** jump: tip-off win chance (possession.ts tipWeightedWinner) and rebound skill weight in resolveRebound; also the height-advantage term for shooting over a defender */
  vertical: number;
  /** lateral defensive slide speed (model/derived.ts lateralSpeed); caps how well a defender mirrors a drive in ai.ts moveSpeed, and dilutes drive handling in decideBall's handlingBase term */
  lateral: number;
  /** how slowly energy drains under load (movement.ts applyFatigue staminaMult); high stamina = longer effective stints before subs.ts pulls a player */
  stamina: number;

  // scoring
  finishing: number; // layups, dunks, rim pressure; feeds resolve.ts zoneSkill for 'rim' and (partially) 'paint'
  /** touch/footwork on floaters, push shots, mid-post: resolve.ts zoneSkill for 'mid' and (partially) 'paint' */
  midRange: number;
  /** jump-shooting range skill (resolve.ts zoneSkill for 'three'); also half of ai.ts gravity() (defenses respect this from distance) */
  three: number;
  /** free-throw shooting touch (resolve.ts freeThrowP base-percentage swing) */
  freeThrow: number;
  /** foul-drawing craftiness: resolve.ts shootingFoulP multiplier on the shooter's side (contact-seeking finishers get to the line more) */
  drawFoul: number;

  // playmaking
  /** ball-security under pressure: resolve.ts passing.ts stripP (denominator vs a defender's steal), decideBall's drive-handling term, and half of ai.ts creation() (the usage-hierarchy score) */
  ballHandle: number;
  /** pass accuracy; resolve.ts passRisk skillTerm (turnover risk) alongside passVision */
  passAcc: number;
  /** court vision. resolve.ts passRisk skillTerm; ai.ts swingBonus; half of ai.ts creation() (usage hierarchy); scales the drive kick premium (drive-and-kick is a passing skill) */
  passVision: number;

  // defense
  /** point-of-attack craft: ai.ts on-ball containment vs drives (ai.containDBlend) and resolve.ts contest skill outside the rim area (move.contestDBlend) */
  perimeterD: number;
  /** rim-area positioning/verticality: resolve.ts contest skill within 14 ft of the attacked rim (move.contestDBlend); distinct from `block`, which converts misses into blocks */
  interiorD: number;
  /** on-ball strip and passing-lane instincts, read by resolve.ts passing stripP and passRisk's lane occlusion (danger-defender weighting) */
  steal: number;
  /** shot-blocking timing/length, the resolve.ts blockP skill term (chance a rim/paint miss is credited as a block) */
  block: number;
  /** closeout/contest technique independent of raw speed: the resolve.ts contestAt/anticipatedContest skill multiplier, blended with perimeterD/interiorD per move.contestDBlend */
  contestSkill: number;

  // rebounding
  /** offensive-rebound pursuit skill: resolve.ts resolveRebound weight when the crasher's side matches the shooting team */
  offReb: number;
  /** defensive-rebound pursuit skill: resolve.ts resolveRebound weight on the non-shooting side */
  defReb: number;
  /** boxing-out technique, resolve.ts resolveRebound defensive weight only (offense doesn't box out; it crashes) */
  boxout: number;

  // mental
  decisions: number; // shot selection & pass reads; ai.ts contestBrakeIQ (extra brake on shooting into a contest as this rises)
  /** STAGED: consumed by the hot/cold variance model (Stage 3); see docs/INTERNALS.md */
  consistency: number;
}

export interface Tendencies {
  // shot diet: relative weights across zones
  /** appetite for rim/paint shots: ai.ts decideBall zoneTend bias when the projected shot is at the rim or in the paint */
  shotRim: number;
  /** appetite for mid-range shots: ai.ts decideBall zoneTend bias when the projected shot is a mid-range look */
  shotMid: number;
  /** appetite for three-point shots: ai.ts decideBall zoneTend bias when the projected shot is a three, stacked with the team's threeBias tactic */
  shotThree: number;
  /** pull-up vs catch-and-shoot inclination. ai.ts decideBall adds a pull-up-specific bias on top of the zone bias when the shot move is 'pull_up' */
  pullUp: number;

  // with-ball inclinations
  /** appetite for putting the ball on the floor and attacking; ai.ts decideBall uDrive tendency term (drive utility), scaled by the team's driveAppetite tactic */
  drive: number;
  /** appetite for giving the ball up rather than creating; feeds ai.ts decideBall swingBonus (intrinsic ball-movement value on top of the receiving teammate's shot EV) */
  passOut: number;
  /** appetite for clearing out one-on-one: ai.ts actionTick iso-call weight; a live iso boosts the handler's attack (ai.isoDriveBonus) */
  iso: number;
  /** appetite for backing a man down: ai.ts actionTick post-call score (with strength/finishing); a posted big draws the entry, works the block, and sprays out of the double */
  post: number;

  // off-ball behavior
  offBallMotion: number; // relocations & cuts vs static spot-up; ai.ts offenseOffBallTick per-tick cut-trigger chance
  /** willingness to crash the offensive glass instead of getting back on defense: the ai.ts onShotReleased crash-vs-getback roll when a teammate's shot goes up */
  crashOffReb: number;

  // defense
  /** appetite for gambling into passing lanes for a steal; passing.ts attemptReachIn reach-in attempt rate (more gambling = more steals AND more fouls) */
  gambleSteal: number;
  /** physical/aggressive defensive style. resolve.ts shootingFoulP aggr multiplier (tenser closeouts and more contact foul more often) */
  foulAggr: number;

  // pace
  /** STAGED: consumed by the team-pace layer (Stage 2); see docs/INTERNALS.md */
  pushPace: number;

  // load
  /** share of team offense this player is wired to consume. Maps directly
   *  to real USG%: 50 ≈ 20% (league average), 90 ≈ 30% (superstar load),
   *  10 ≈ 10% (screener/finisher). Applied as CLOSED-LOOP pressure in
   *  ai.ts decideBall: the gap between this target and the realized in-game
   *  share biases shoot/drive vs pass. An under-fed star hunts, an over-fed
   *  one defers. Orthogonal to creation by design (a deferential genius and
   *  a low-skill chucker are both expressible). */
  usage: number;
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
  /** 0-100: walk-it-up .. run-and-gun. Not yet read by decideBall; reserved for the team-pace layer alongside tend.pushPace (see docs/INTERNALS.md Stage 2) */
  pace: number;
  /** 0-100: global three-point appetite modifier (ai.ts decideBall tacticsThreeScale term), stacked on top of the shooter's own shotThree tendency */
  threeBias: number;
  /** 0-100: how aggressively help defense converges (ai.ts defenseTick helper-selection score and off-ball sag depth) */
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

// Every attribute at exactly 50 by design: n(50) = 0 for all of them (see
// model/derived.ts), so a default-attribute player contributes nothing to any
// skill term in the probability models. A formula-neutral, league-average
// player, which is the right "blank" starting point for makePlayer overrides
// and test fixtures: you only pay for the ratings you deliberately push away
// from 50.
const DEFAULT_ATTR: Attributes = {
  speed: 50, accel: 50, strength: 50, vertical: 50, lateral: 50, stamina: 50,
  finishing: 50, midRange: 50, three: 50, freeThrow: 50, drawFoul: 50,
  ballHandle: 50, passAcc: 50, passVision: 50,
  perimeterD: 50, interiorD: 50, steal: 50, block: 50, contestSkill: 50,
  offReb: 50, defReb: 50, boxout: 50,
  decisions: 50, consistency: 50
};

// Unlike attributes, tendencies are deliberately not all 50: a "want to do"
// dial has no formula-neutral value the way n(50)=0 gives attributes one.
// These defaults encode a modern, pace-and-space shot diet as the baseline
// player identity rather than an old-school one. shotMid is suppressed to 30
// (well below shotRim's 50 and shotThree's 40) because the long two is the
// least efficient shot in the modern shot-value hierarchy; a real offense
// avoids it, so a "default" player should too. shotThree at 40 (vs
// shotRim's 50) still leans rim-first, matching real shot profiles where
// attempts at the rim outnumber threes even in three-happy eras. pullUp at
// 35 and drive at 45 push the default player toward getting downhill and
// finishing/kicking rather than settling for pull-up jumpers. iso/post sit
// low (25/15) because those are low-frequency actions leaguewide even before
// accounting for their STAGED status above.
const DEFAULT_TEND: Tendencies = {
  shotRim: 50, shotMid: 30, shotThree: 40, pullUp: 35,
  drive: 45, passOut: 50, iso: 25, post: 15,
  offBallMotion: 45, crashOffReb: 40,
  gambleSteal: 35, foulAggr: 40,
  pushPace: 45,
  usage: 50
};

let anonCounter = 0;

/** Build a player from partial overrides. Tests and fixtures build every player through this. */
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
