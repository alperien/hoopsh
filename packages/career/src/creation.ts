/**
 * creation.ts - CreationSpec -> a career at week zero. OWNER: creation
 * task. STATUS: implemented (career build wave A).
 *
 * Builds me (an FrPlayer at 17: budget across groups over the base,
 * background priors, signature tendency identity, hidden ceilings sampled
 * over the visible priors), the rival, the NBA world (franchise
 * createLeague with EVERY chair persona-run), and the empty career
 * ledgers. Circuit generation is the circuits task; the career tick
 * lazy-initializes the HS circuit on the first advance, exactly the
 * genesis/calendar pattern (genesis.ts module header).
 *
 * Method mirror (people/gen.ts): the sheet starts from the calibrated
 * archetype profiles so ratings keep MEANING. The creation budget sets
 * per-group LEVELS (groupBase + allocation, the visible promise the user
 * typed); the signature and position archetypes contribute only their
 * within-group SHAPE (per-dial deviations from their own group means, so
 * shapes are level-neutral), which keeps the budget legible while a
 * movement shooter's scoring group still leans three/freeThrow the way
 * the engine expects. Tendencies come straight from the signature
 * archetype blend (appetite is identity, not skill: gen.ts never
 * quality-shifts or age-adjusts tendencies, and neither does creation),
 * with the same CAN/WANT coherence repair gen.ts runs.
 *
 * Determinism ('career:' stream namespace, rng.ts registry conventions -
 * career derives streams from the CAREER seed with 'career-' prefixed
 * labels, so they can never collide with franchise streams, which live
 * under the league seed `${seed}:world`):
 *   career-creation   me: attr/tend shaping noise, coherence repair,
 *                     coach surname + personality (this file)
 *   career-ceiling    hidden per-group ceiling headroom (this file)
 *   career-traits     workEthic, disposition, proneness, morale,
 *                     faceSeed (this file)
 *   career-rival      the rival prospect; people/gen generatePlayer
 *                     draws it dry (this file)
 * The NBA world's own draws all run under `${seed}:world` through the
 * franchise registry; the user-team chair fills from
 * streamRng(`${seed}:world`, 'genesis', 'career-user-gm') (the
 * acceptance-harness pattern: no human GM anywhere in a career save).
 */
import { clamp } from '@hoopsh/engine';
import type { Attributes, Player, Rng, Tendencies } from '@hoopsh/engine';
import {
  TEND_KEYS,
  eliteShooter, floorGeneral, glueForward, postAnchor, rimRunner, scoringWing, threeAndD,
} from '@hoopsh/data';
import { createLeague, generatePersona, generatePlayer, streamRng } from '@hoopsh/franchise';
import type { AttrGroup, FrPlayer, League, PotentialProfile } from '@hoopsh/franchise';
import type {
  ApproachCard, ApproachDial, ApproachRanges, BackgroundId, CareerClock, CareerState,
  CoachPersonality, CoachState, CreationSpec, PhoneMessage, PresetId, RoleId, SignatureId,
} from './types.js';
import type { CareerParams } from './params.js';
import { defaultCareerParams } from './params.js';

export interface CreateCareerOpts {
  seed: string;
  spec: CreationSpec;
  params?: Partial<CareerParams>;
}

// ---------------------------------------------------------------------------
// creation shape constants (module-scope, provenance-tagged: structural
// conventions of career assembly, the genesis.ts category, not sweepable
// levers - the sweepable levers live in params.creation)

const START_YEAR = 2026;   // REAL: matches franchise genesis DEFAULT_START_SEASON, so the career clock and the world's season agree at day zero
const CREATION_AGE = 17;   // REAL: the design start point - a high school senior (docs/CAREER.md, Decisions taken at approval)
const MY_ID = 'p9000';     // me and the rival are the only career-born 'p' ids: both are league-destined (stock.ts#enterDraftClass), parked at 9000 clear of the league's own p0001.. growth for any plausible pre-entry span. Circuit kids mint in the career-local 'c' alphabet instead, so the league's post-entry draft classes can never re-mint a retained id (circuits.ts#nextIdSeq, issue #83)
const RIVAL_ID_SEQ = 9001; // generatePlayer formats this as 'p9001', the second and last id in the entry pair's zone
const WORLD_USER_TEAM = 'nye'; // FEEL: createLeague requires a nominated user team; the persona fill below makes the pick invisible, so any fixed franchise works

// body bounds (validation)
const HEIGHT_LO = 68;          // REAL-ish 5'8": the shortest modern pros; below this the guard-to-center span stops being playable
const HEIGHT_HI = 90;          // REAL-ish 7'6": the tallest anyone has played at
const WEIGHT_ANCHOR_H = 74.5;  // REAL-ish: PG positional mean height, inches (gen.ts BODY table)
const WEIGHT_ANCHOR_LB = 190;  // REAL-ish: weight at that height, pounds (same table)
const WEIGHT_PER_INCH = 7;     // REAL-ish: cross-position weight-vs-height slope of gen.ts's BODY table (62 lb over 9 in)
const WEIGHT_BAND = 45;        // FEEL: wiry to bruiser spread allowed at any height, pounds
const WEIGHT_ABS_LO = 140;     // FEEL: below this no frame survives varsity contact
const WEIGHT_ABS_HI = 330;     // FEEL: above this nobody gets up and down the floor
const WINGSPAN_LO_DELTA = -1;  // FEEL: negative ape index is rare and never extreme (gen.ts clamp)
const WINGSPAN_HI_DELTA = 9;   // FEEL: the condor tail; real outliers reach ~+10 (gen.ts clamp)
const WINGSPAN_DEFAULT_DELTA = 2; // REAL-ish: the engine's own fallback when unset (model/derived.ts: wingspanIn ?? heightIn + 2)

// sheet shaping
const SIG_SHAPE_GAIN = 0.6; // FEEL: how much of the signature archetypes' within-group contrast the sheet inherits; under 1 so the typed budget stays the headline
const POS_SHAPE_GAIN = 0.4; // FEEL: the position's own lean on top (a center's phys is strength/vertical, a guard's is speed/accel)
const ATTR_NOISE_SD = 2;    // FEEL: sheet texture only, rating points; small so the budget promise stays legible
const TEND_NOISE_SD = 3;    // FEEL: identity texture around the signature blend, rating points
const RATING_LO = 1;        // FEEL: generated dials avoid the absolute 0 rail (gen.ts convention)
const RATING_HI = 99;       // FEEL: 99 is the unambiguous best; creation never mints a 100 (gen.ts convention)

// CAN/WANT coherence repair, mirrored from gen.ts (docs/ROSTERS.md: an 85
// three with a 5 shotThree never shoots - skill without appetite is
// incoherent). Signatures set appetite directly so the repair rarely
// fires here, but a shooting-heavy budget under a rim-runner/post-hub
// identity can still arrive incoherent.
const COHERENT_SKILL = 75;      // FEEL: a 75+ three is a weapon a real coach weaponizes (gen.ts)
const COHERENT_WANT_FLOOR = 15; // FEEL: below this appetite the weapon never fires (gen.ts)

// hidden ceilings
const CEILING_FLOOR_OVER_PRIOR = 2; // FEEL: creation always leaves something to develop; the hidden-ceiling RPG hook is a lie without it

// traits: preset tilts (FEEL) - the walk-on grinder archetype works harder
// than the anointed phenom; hype has never had to earn a gym key. Means
// only: the sd keeps gym rats and coasters possible under every preset.
const WORK_ETHIC_MEAN: Record<PresetId, number> = { walkon: 62, fourstar: 56, phenom: 52 };
const WORK_ETHIC_SD = 14; // FEEL: near gen.ts's pro spread (16); a teenager's habits are real but not yet settled

// the rival: a fourstar-equivalent quality TARGET for people/gen.ts.
// generatePlayer discounts a 17-year-old's current dials toward rawness
// (gen.ts raw-arrival model), so the pre-discount target adds the mean
// discount back on top of the fourstar group prior: (23 - 17) years *
// 2.6 points * ~0.8 mean group weight over the 24 dials. FEEL estimate,
// restated here because gen.ts keeps those constants module-local.
const RIVAL_RAW_DISCOUNT_EST = 12.5;

// the HS coach
const COACH_TRUST_START = 55; // FEEL: the returning senior has a season of equity over the neutral 50; trust is earned nightly from here
const ENERGY_START = 85;      // FEEL: a teenager in October - fresh legs, but school already started

/**
 * HS coach surname pool (FEEL: 16 plausible sideline names, era- and
 * region-mixed, avoiding famous basketball coaches so no county gym
 * collides with a real bench). 'Wexler' deliberately matches the shared
 * career test fixture's coach so fixture prose and generated careers
 * read alike.
 */
const COACH_SURNAMES: readonly string[] = [
  'Wexler', 'Aldrich', 'Barlowe', 'Casteel', 'Dempsey', 'Fairbank',
  'Granger', 'Halvorsen', 'Lockridge', 'Marchetti', 'Naughton', 'Pruett',
  'Rasmussen', 'Stoddard', 'Tillery', 'Youngblood',
];

/** Fixed order for personality sampling; mirrors the types.ts union. */
const COACH_PERSONALITIES: readonly CoachPersonality[] = [
  'playersCoach', 'disciplinarian', 'systems', 'ridesHotHand',
];

/**
 * Approach dials in fixed order for byte-stable plan assembly. Local copy
 * of the types.ts union so creation stays self-contained while the
 * approach task lands its own module.
 */
const APPROACH_DIALS: readonly ApproachDial[] = [
  'assertiveness', 'range', 'motor', 'defense', 'playmaking',
];

/**
 * Opening plan centers by dial (FEEL, the shared test fixture's shape):
 * a senior is asked to hustle a touch more than he is asked to hunt
 * shots. Widths come from params.trust.planWidthByRole so this opening
 * plan and the approach task's grading agree on what a role allows.
 */
const PLAN_CENTERS: Record<ApproachDial, number> = {
  assertiveness: 47, range: 47, motor: 53, defense: 50, playmaking: 50,
};

// ---------------------------------------------------------------------------
// groups and archetype shapes

/** Attribute keys per group - mirrors the PotentialProfile field comments in franchise types.ts (gen.ts keeps its own copy module-local). */
const GROUP_ATTRS: Record<AttrGroup, ReadonlyArray<keyof Attributes>> = {
  phys: ['speed', 'accel', 'strength', 'vertical', 'lateral', 'stamina'],
  scoring: ['finishing', 'midRange', 'three', 'freeThrow', 'drawFoul'],
  playmaking: ['ballHandle', 'passAcc', 'passVision'],
  defense: ['perimeterD', 'interiorD', 'steal', 'block', 'contestSkill'],
  rebounding: ['offReb', 'defReb', 'boxout'],
  mental: ['decisions', 'consistency'],
};

/** Iteration order for group passes; fixed so draw order never depends on object key order (gen.ts convention). */
const GROUPS: readonly AttrGroup[] = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'];

interface SigShape {
  /** per-dial deviations of the archetype from its OWN group means (level-neutral: they sum to ~0 within each group) */
  attrDelta: Record<keyof Attributes, number>;
  /** the archetype's tendency identity, all 14 engine dials */
  tend: Tendencies;
}

/**
 * Probe an archetype builder at module load (gen.ts's anchor-probe
 * pattern): shapes derive from the SAME builders the engine is calibrated
 * against, so a rebalanced archetype re-shapes creation with no
 * hand-copied table to go stale. The probe id/name never leave here.
 */
function probeShape(build: (who: { id: string; name: string }) => Player): SigShape {
  const p = build({ id: 'shape-probe', name: 'shape-probe' });
  const attrDelta = {} as Record<keyof Attributes, number>;
  for (const g of GROUPS) {
    let mean = 0;
    for (const k of GROUP_ATTRS[g]) mean += p.attr[k];
    mean /= GROUP_ATTRS[g].length;
    for (const k of GROUP_ATTRS[g]) attrDelta[k] = p.attr[k] - mean;
  }
  return { attrDelta, tend: { ...p.tend } };
}

/**
 * Signature -> archetype, the catalog the engine is calibrated against
 * (docs/CAREER.md, Creating him). The contrasts are honest because they
 * are the archetypes' own: a movement shooter relocates and rarely isos,
 * a downhill grinder lives on drives and free throws, a rim runner
 * essentially never shoots threes.
 */
const SIGNATURE_SHAPES: Record<SignatureId, SigShape> = {
  'movement-shooter': probeShape(eliteShooter),
  'downhill': probeShape(scoringWing),
  'point-forward': probeShape(floorGeneral),
  'rim-runner': probeShape(rimRunner),
  'three-and-d': probeShape(threeAndD),
  'post-hub': probeShape(postAnchor),
  'glue': probeShape(glueForward),
};

/** The position's most central identity: the first entry of gen.ts's per-position CATALOG, reused from the signature probes. */
const POSITION_SHAPES: Record<FrPlayer['pos'], SigShape> = {
  PG: SIGNATURE_SHAPES['point-forward'],
  SG: SIGNATURE_SHAPES['downhill'],
  SF: SIGNATURE_SHAPES['three-and-d'],
  PF: SIGNATURE_SHAPES['post-hub'],
  C: SIGNATURE_SHAPES['rim-runner'],
};

// ---------------------------------------------------------------------------
// backgrounds

interface BackgroundPrior {
  /** group prior shifts, in units of params.creation.backgroundStrength */
  groups: Partial<Record<AttrGroup, number>>;
  /** single-dial shifts, same units */
  attrs: Partial<Record<keyof Attributes, number>>;
  /** tendency shifts, same units */
  tends: Partial<Record<keyof Tendencies, number>>;
  /** extra hidden ceiling headroom, same units, banked BEFORE sampling */
  ceiling: number;
}

/**
 * The five named priors (docs/CAREER.md, Creating him), each an honest
 * tradeoff. Multipliers of params.creation.backgroundStrength (S), not
 * points, so the one knob swings every background together. At the
 * default S = 6 the late bloomer reads -4 on every group now for +8 of
 * hidden headroom.
 */
const BACKGROUNDS: Record<BackgroundId, BackgroundPrior> = {
  // offensive polish up, defensive habits down: nobody closes out in July
  aau: { groups: { scoring: 1, defense: -1 }, attrs: {}, tends: {}, ceiling: 0 },
  // decisions and film sense up, athletic priors modest: he grew up in
  // the film room, not the weight room
  'coachs-son': { groups: { mental: 1, phys: -0.5 }, attrs: { passVision: 1 }, tends: {}, ceiling: 0 },
  // handle and iso up, discipline and shot selection down: the park
  // never called a travel or ran a set
  playground: { groups: {}, attrs: { ballHandle: 1, decisions: -1 }, tends: { iso: 1.5 }, ceiling: 0 },
  // lower start, more ceiling headroom: the body and the game arrive
  // late (2/3 and 4/3 of S: -4 now, +8 headroom at the default S = 6)
  'late-bloomer': {
    groups: { phys: -2 / 3, scoring: -2 / 3, playmaking: -2 / 3, defense: -2 / 3, rebounding: -2 / 3, mental: -2 / 3 },
    attrs: {}, tends: {}, ceiling: 4 / 3,
  },
  // fundamentals and passing up, self-creation down: the club academy
  // drills reads and footwork and coaches the hero ball out
  academy: { groups: { playmaking: 1, mental: 0.5 }, attrs: {}, tends: { iso: -1.5, pullUp: -1 }, ceiling: 0 },
};

// ---------------------------------------------------------------------------
// helpers

/** Round + clamp a generated rating into the working 1-99 band (gen.ts convention). */
function clampRating(x: number): number {
  return Math.round(clamp(x, RATING_LO, RATING_HI));
}

/** The visible group prior: base + allocation + background shift. The number the ceilings sample over. */
function groupPrior(spec: CreationSpec, params: CareerParams, g: AttrGroup): number {
  const c = params.creation;
  return c.groupBase + spec.budget[g] + (BACKGROUNDS[spec.background].groups[g] ?? 0) * c.backgroundStrength;
}

/**
 * Section-level merge of caller overrides onto the defaults, mirroring
 * franchise withFranchiseParams. Module-local because the career params
 * shape froze in the contracts wave without a merge helper.
 */
function withCareerParams(over: Partial<CareerParams> | undefined): CareerParams {
  const base = defaultCareerParams();
  if (!over) return base;
  const out = base as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && k in out) {
      out[k] = { ...(out[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      out[k] = v;
    }
  }
  return out as unknown as CareerParams;
}

/**
 * Advisory-light US read on a birthplace string: the standard 'City, ST'
 * format or an explicit USA. Full state names ('Akron, Ohio') pass
 * unflagged BY DESIGN - we refuse the obvious, we do not police
 * geography (docs/CAREER.md keeps nationality consistency advisory).
 */
function looksLikeUsBirthplace(birthplace: string): boolean {
  return /,\s*[A-Z]{2}$/.test(birthplace.trim()) || /\bUSA\b/i.test(birthplace);
}

// ---------------------------------------------------------------------------
// validation

/**
 * Validate a spec against its preset budget and body bounds. Pure; no
 * randomness. Returns every problem at once (a creation screen wants the
 * full list, not the first failure), each in plain language. Called by
 * the creation UI on every edit and by createCareer as its gate.
 */
export function validateCreation(spec: CreationSpec, params: CareerParams): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const c = params.creation;

  // identity
  if (!spec.firstName || spec.firstName.trim() === '') errors.push('first name is empty');
  if (!spec.lastName || spec.lastName.trim() === '') errors.push('last name is empty');
  if (!spec.birthplace || spec.birthplace.trim() === '') errors.push('birthplace is empty');

  // budget: spent must equal the preset budget exactly; every allocation
  // is a non-negative point count; the resulting group prior may not
  // pass the creation cap. Over-cap is an ERROR, never a clamp: a silent
  // clamp would bank unspent points invisibly and break the budget
  // promise the sheet is built on.
  const budget = c.budgetByPreset[spec.preset];
  let spent = 0;
  for (const g of GROUPS) {
    const alloc = spec.budget[g];
    if (typeof alloc !== 'number' || !Number.isFinite(alloc) || alloc < 0) {
      errors.push(`${g} allocation must be a non-negative number of points`);
      continue;
    }
    spent += alloc;
    const prior = c.groupBase + alloc;
    if (prior > c.creationGroupCap) {
      errors.push(`${g} allocation of ${alloc} puts the group at ${prior}, over the creation cap of ${c.creationGroupCap} (nobody arrives finished)`);
    }
  }
  if (spent !== budget) {
    errors.push(`budget spends ${spent} points but the ${spec.preset} preset requires exactly ${budget}`);
  }

  // body: a real tradeoff surface needs real bounds
  if (!Number.isFinite(spec.heightIn) || spec.heightIn < HEIGHT_LO || spec.heightIn > HEIGHT_HI) {
    errors.push(`height ${spec.heightIn} in is outside the playable ${HEIGHT_LO}-${HEIGHT_HI} in span`);
  } else {
    const expected = WEIGHT_ANCHOR_LB + (spec.heightIn - WEIGHT_ANCHOR_H) * WEIGHT_PER_INCH;
    const lo = Math.max(WEIGHT_ABS_LO, Math.round(expected - WEIGHT_BAND));
    const hi = Math.min(WEIGHT_ABS_HI, Math.round(expected + WEIGHT_BAND));
    if (!Number.isFinite(spec.weightLb) || spec.weightLb < lo || spec.weightLb > hi) {
      errors.push(`weight ${spec.weightLb} lb is implausible at ${spec.heightIn} in (a real ${spec.heightIn} in frame plays at ${lo}-${hi} lb)`);
    }
    if (spec.wingspanIn !== undefined) {
      const wLo = spec.heightIn + WINGSPAN_LO_DELTA;
      const wHi = spec.heightIn + WINGSPAN_HI_DELTA;
      if (!Number.isFinite(spec.wingspanIn) || spec.wingspanIn < wLo || spec.wingspanIn > wHi) {
        errors.push(`wingspan ${spec.wingspanIn} in is outside ${wLo}-${wHi} in for a ${spec.heightIn} in frame`);
      }
    }
  }

  // signatures: two picks so the blend has a real contrast
  if (spec.signatures[0] === spec.signatures[1]) {
    errors.push('the two signature picks must differ');
  }

  // nationality consistency (advisory-light by design)
  if (spec.background === 'academy' && spec.nationality !== 'intl') {
    errors.push('the academy background is international-only (a US kid comes up through AAU, school ball, or the park)');
  }
  if (spec.nationality === 'intl' && spec.birthplace && looksLikeUsBirthplace(spec.birthplace)) {
    errors.push(`an international prospect needs a non-US birthplace ('${spec.birthplace}' reads as a US city)`);
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// the pieces of me

/**
 * Build me as an FrPlayer at 17. Draws, in fixed order, on the passed
 * 'career-creation' stream: 24 attr noises (GROUPS then GROUP_ATTRS
 * order), 14 tend noises (TEND_KEYS order), then any conditional
 * coherence-repair draws (deterministic per (seed, spec) because the
 * condition is a pure function of both). Ceilings and traits live on
 * their own streams so spec edits can never reshuffle them.
 */
function buildMe(rng: Rng, seed: string, spec: CreationSpec, params: CareerParams): FrPlayer {
  const c = params.creation;
  const bg = BACKGROUNDS[spec.background];
  const S = c.backgroundStrength;
  const sigA = SIGNATURE_SHAPES[spec.signatures[0]];
  const sigB = SIGNATURE_SHAPES[spec.signatures[1]];
  const posShape = POSITION_SHAPES[spec.pos];

  // attributes: budget level + signature/position shape + background
  // dial tweaks + texture noise
  const attr = {} as Attributes;
  for (const g of GROUPS) {
    const prior = groupPrior(spec, params, g);
    for (const k of GROUP_ATTRS[g]) {
      const shape = SIG_SHAPE_GAIN * (sigA.attrDelta[k] + sigB.attrDelta[k]) / 2
        + POS_SHAPE_GAIN * posShape.attrDelta[k];
      attr[k] = clampRating(prior + shape + (bg.attrs[k] ?? 0) * S + rng.gaussian(0, ATTR_NOISE_SD));
    }
  }

  // tendencies: the signature blend IS the identity (appetite is not
  // skill: never budget-shifted, never age-adjusted - gen.ts doctrine),
  // plus background appetite tweaks and texture noise
  const tend = {} as Tendencies;
  for (const k of TEND_KEYS) {
    tend[k] = clampRating((sigA.tend[k] + sigB.tend[k]) / 2 + (bg.tends[k] ?? 0) * S + rng.gaussian(0, TEND_NOISE_SD));
  }

  // CAN/WANT coherence repair, both directions (gen.ts). Centers keep
  // the reluctant-stretch-five exemption on the skill side.
  if (spec.pos !== 'C' && attr.three >= COHERENT_SKILL && tend.shotThree <= COHERENT_WANT_FLOOR) {
    tend.shotThree = Math.round(rng.range(40, 75)); // FEEL: a real weapon's firing rate (gen.ts)
  }
  if (attr.three <= COHERENT_WANT_FLOOR && tend.shotThree >= COHERENT_SKILL) {
    tend.shotThree = Math.round(rng.range(5, 25)); // FEEL: bail-out attempts only (gen.ts)
  }

  // hidden ceilings: sampled OVER the visible priors on a dedicated
  // stream, 6 draws in GROUPS order. They live in player.potential and
  // the UI contract HIDES them from the player (the RPG hook: scouts
  // guess at my ceiling the way I guess at theirs). The late bloomer
  // banks his bonus BEFORE the draw, so his whole ceiling distribution
  // sits higher, not just its floor.
  const ceilingRng = streamRng(seed, 'career-ceiling');
  const potential = {} as PotentialProfile;
  for (const g of GROUPS) {
    const prior = groupPrior(spec, params, g);
    const headroom = bg.ceiling * S + ceilingRng.gaussian(c.ceilingHeadroomMean, c.ceilingHeadroomSd);
    potential[g] = Math.round(clamp(prior + headroom, prior + CEILING_FLOOR_OVER_PRIOR, RATING_HI));
  }

  // traits: dedicated stream, fixed draw order (workEthic, ambition,
  // loyalty, professionalism, marketPref, proneness, morale, faceSeed).
  // Spreads mirror gen.ts so the career kid and the generated league
  // come from one personality distribution.
  const traits = streamRng(seed, 'career-traits');
  const workEthic = Math.round(clamp(traits.gaussian(WORK_ETHIC_MEAN[spec.preset], WORK_ETHIC_SD), 5, 99));
  const disposition = {
    ambition: Math.round(clamp(traits.gaussian(50, 18), 5, 95)),        // FEEL: gen.ts spread - drives route and FA choices later
    loyalty: Math.round(clamp(traits.gaussian(50, 18), 5, 95)),         // FEEL: gen.ts
    professionalism: Math.round(clamp(traits.gaussian(55, 16), 5, 95)), // FEEL: gen.ts pro-median lean
    marketPref: Math.round(clamp(traits.gaussian(50, 18), 5, 95)),      // FEEL: gen.ts
  };
  const proneness = Math.round(clamp(traits.gaussian(45, 16), 5, 95));  // FEEL: gen.ts - the median kid is mildly durable
  const morale = Math.round(clamp(traits.gaussian(68, 8), 40, 90));     // FEEL: gen.ts camp-fresh contentment; October of senior year feels the same

  return {
    id: MY_ID,
    name: `${spec.firstName} ${spec.lastName}`,
    pos: spec.pos,
    bornSeason: START_YEAR - CREATION_AGE,
    birthplace: spec.birthplace,
    // the bio line before any route exists: a US senior reads as a prep
    // product, an international as a club prospect; the route and draft
    // tasks overwrite originDetail once college or a club claims him
    origin: spec.nationality === 'intl' ? 'international' : 'prep',
    originDetail: spec.birthplace,
    heightIn: spec.heightIn,
    weightLb: spec.weightLb,
    wingspanIn: spec.wingspanIn ?? spec.heightIn + WINGSPAN_DEFAULT_DELTA,
    attr,
    tend,
    potential,
    workEthic,
    disposition,
    health: { proneness, wear: 0, injury: null, history: [] }, // wear 0: a 17-year-old's odometer is blank (gen.ts only accrues wear past a typical age-22 entry)
    morale,
    status: 'prospect',
    contract: null,
    rights: null,
    draft: null,
    seasons: [],
    awards: [],
    devLog: [],
    faceSeed: traits.int(2147483647), // 2^31 - 1: full positive int32 space for the portrait hash (gen.ts)
  };
}

/**
 * The rival: a peer prospect the sim tracks against me for fifteen years
 * (docs/CAREER.md, The phone). Generated through people/gen.ts on the
 * 'career-rival' stream so he is coherent the same way every league
 * player is; quality targets a fourstar-equivalent scaled by
 * params.circuits.rivalBudgetFactor. He must be GOOD - the rivalry only
 * carries if he keeps showing up on the same stages.
 */
function buildRival(seed: string, params: CareerParams, league: League): FrPlayer {
  const rng = streamRng(seed, 'career-rival');
  const c = params.creation;
  const fourstarPrior = c.groupBase + c.budgetByPreset.fourstar / GROUPS.length;
  const quality = (fourstarPrior + RIVAL_RAW_DISCOUNT_EST) * params.circuits.rivalBudgetFactor;
  // league.params, never a silent default: the live-params doctrine
  // generatePlayer's opts documents
  const rival = generatePlayer(rng, {
    age: CREATION_AGE,
    season: START_YEAR,
    quality,
    idSeq: RIVAL_ID_SEQ,
    params: league.params,
  });
  rival.status = 'prospect'; // a high school kid, not an unsigned pro
  return rival;
}

/**
 * The HS coach: identity from the creation stream (draws follow buildMe's
 * on the same stream), trust at the returning-senior baseline, role by
 * preset, and an opening plan whose widths agree with
 * params.trust.planWidthByRole so the approach task grades against the
 * same latitude the plan shows.
 */
function buildCoach(rng: Rng, params: CareerParams, preset: PresetId): CoachState {
  const surname = rng.pick(COACH_SURNAMES);
  const personality = rng.pick(COACH_PERSONALITIES);
  // the county's best player opens the fall as the starter; a walk-on
  // build is deliberately under-recruited and starts in the rotation
  // fighting up (docs/CAREER.md: under-recruited origins are a feature)
  const role: RoleId = preset === 'walkon' ? 'rotation' : 'starter';
  const width = params.trust.planWidthByRole[role];
  const plan = {} as ApproachRanges;
  for (const dial of APPROACH_DIALS) {
    const center = PLAN_CENTERS[dial];
    plan[dial] = [
      clamp(Math.round(center - width / 2), 0, 100),
      clamp(Math.round(center + width / 2), 0, 100),
    ];
  }
  return {
    name: `Coach ${surname}`,
    personality,
    trust: COACH_TRUST_START,
    role,
    plan,
    greenLight: false,
    grades: [],
    roleClock: { above: 0, below: 0 },
  };
}

// ---------------------------------------------------------------------------
// createCareer

/**
 * Build the whole career at week zero: me, the rival, the persona-run
 * NBA world, and every empty ledger. Deterministic: the same opts (seed
 * included) produce a JSON-identical CareerState. Throws on an invalid
 * spec (a career built over a broken budget would violate the creation
 * contract silently - the createLeague fail-loud pattern).
 *
 * Deliberately NOT built here: the HS circuit (circuit: null; the career
 * tick lazy-builds it via the circuits task, the genesis/calendar
 * pattern), recruiting programs (recruiting task), stock coverage (stock
 * task), and every phone thread except the coach's one welcome (phone
 * task owns the rest). Me and the rival exist ONLY in career.players;
 * league-side entry happens at the draft.
 */
export function createCareer(opts: CreateCareerOpts): CareerState {
  const params = withCareerParams(opts.params);
  const spec = opts.spec;
  const check = validateCreation(spec, params);
  if (!check.ok) {
    throw new Error(`career/creation: invalid spec: ${check.errors.join('; ')}`);
  }

  // the world first: thirty front offices exist while I am still in high
  // school, so their scouts and their transactions are real from day
  // one. createLeague leaves the nominated user team's chair vacant for
  // the GM game; career fills it with a persona from the world's own
  // genesis stream (the acceptance-harness pattern) - no human GM
  // anywhere in a career save.
  const worldSeed = `${opts.seed}:world`;
  const league = createLeague({ seed: worldSeed, userTeam: WORLD_USER_TEAM });
  league.teams[WORLD_USER_TEAM]!.gm = generatePersona(streamRng(worldSeed, 'genesis', 'career-user-gm'));
  // the franchise seam: retirement hazard, the AI option pass, and the
  // FA market all leave a career-controlled player's life decisions to
  // the human holding this career
  league.careerControlled = [MY_ID];

  const creationRng = streamRng(opts.seed, 'career-creation');
  const me = buildMe(creationRng, opts.seed, spec, params);
  const coach = buildCoach(creationRng, params, spec.preset);
  const rival = buildRival(opts.seed, params, league);

  const clock: CareerClock = { phase: 'hs', year: START_YEAR, week: params.tick.hsSeasonStartWeek };

  // one seeded welcome text: the coach states the season's expectation in
  // plain words for my role. No choices - the phone task owns every
  // conversation from here.
  const welcome: PhoneMessage = {
    id: 'msg-coach-welcome',
    clock: { ...clock }, // copy: career.clock mutates weekly and history must not move with it
    thread: 'coach',
    from: coach.name,
    body: coach.role === 'starter'
      ? 'Gym opens Monday. You are the best player in this county and this season runs through you. Play inside the plan and the tape will do the rest.'
      : 'Gym opens Monday. Nobody here is handing out minutes. Win your spot in practice every week and the nights will come.',
  };

  // the default week: train the strongest group, care for the body,
  // sleep (FEEL: a sensible September plan the first real choice
  // replaces). Ties in the budget break to the earlier group in GROUPS
  // order, fixed and byte-stable.
  let focus: AttrGroup = GROUPS[0]!;
  for (const g of GROUPS) if (spec.budget[g] > spec.budget[focus]) focus = g;

  const neutralCard: ApproachCard = {
    assertiveness: 50, range: 50, motor: 50, defense: 50, playmaking: 50, // 50 = play your normal game (types.ts)
  };

  return {
    seed: opts.seed,
    params,
    clock,
    me: MY_ID,
    players: { [MY_ID]: me, [rival.id]: rival },
    rivalId: rival.id,
    // defensive copy: the caller's spec object must not stay live inside
    // career state (determinism reads career as a value)
    creation: { ...spec, budget: { ...spec.budget }, signatures: [spec.signatures[0], spec.signatures[1]] },
    circuit: null, // lazy-built by the career tick through the circuits task (the genesis/calendar pattern)
    circuitHistory: [],
    energy: ENERGY_START,
    weekPlan: { slots: ['extraWork', 'body', 'rest'], focus },
    coach,
    recruiting: { programs: [], interest: [], offers: [] }, // the recruiting task populates
    stock: { rank: null, history: [], perTeam: {}, combineDone: false, workoutsDone: [], workoutInvites: [] },
    phone: [welcome],
    approach: neutralCard,
    nextApproach: null,
    ledger: [],
    league,
    nbaTeam: null,
    choiceLog: [],
    choiceSeq: 0,
    events: [{
      id: 'ev-phase-hs',
      clock: { ...clock }, // copy, same reason as the welcome message
      kind: 'phase',
      reason: 'senior season begins',
    }],
    epilogue: null,
  };
}
