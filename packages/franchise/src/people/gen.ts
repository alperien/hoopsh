/**
 * people/gen.ts - player generation: genesis rosters, draft classes,
 * coaches. OWNER: genesis task. STATUS: rewritten (draft realism wave).
 *
 * Method (docs/FRANCHISE.md section 5, docs/ROSTERS.md, owner brief "the
 * draft hella realistic"): every player draws a coherent archetype from
 * people/archetypes.ts (identity: attribute shape + tendencies + build),
 * levels move together under one quality shift, noise is bounded, and
 * signature negatives are capped, so a rim-running big can never roll a
 * live three-ball. Draft classes draw a TALENT TIER first and age
 * conditional on tier (the real age-talent correlation: the top of a
 * class skews 19, the back end skews 22-23), under a per-season strength
 * wave so loaded and weak classes are real. Anthropometrics come from
 * per-position bands biased by archetype, so the league's height and
 * wingspan distributions hold steady across decades of classes.
 *
 * Determinism: every draw flows through the caller's Rng and the draw
 * ORDER inside each generator is fixed (conditional branches still draw).
 * Callers use registered stream paths (rng.ts): genesis passes
 * 'genesis:team:<id>' streams; generateDraftClass derives 'class:<season>'
 * and the strength wave derives 'classwave:<season>' (registry addition
 * proposed in people/INTEGRATION-gen.md).
 */
import { clamp } from '@hoopsh/engine';
import type { Attributes, Position, Rng } from '@hoopsh/engine';
import { ATTR_KEYS } from '@hoopsh/data';
import type { AttrGroup, Coach, FrPlayer, League, PotentialProfile, Season } from '../types.js';
import type { FranchiseParams } from '../params.js';
import { streamRng } from '../rng.js';
import { generateName, generateNameOfKind, personName } from './names.js';
import type { GeneratedName, NameKind } from './names.js';
import {
  pickArchetype, sampleBody, sampleIdentity, stampArchetype,
} from './archetypes.js';
import type { Pipeline } from './archetypes.js';

export interface GenPlayerOpts {
  age: number;                 // age at the season being generated for
  season: Season;              // current season (bornSeason = season - age)
  quality?: number;            // 0-100 center of mass; default league-shaped
  idSeq: number;               // caller-owned unique sequence for PlayerId
  /**
   * Live parameter set (league.params for callers that hold a league).
   * Required so generation can never silently fall back to
   * defaultFranchiseParams() - the league.params doctrine
   * (docs/FRANCHISE_INTERNALS.md trap list).
   */
  params: FranchiseParams;
  /**
   * Pipeline the player arrives through. Forces the matching name pool
   * side and applies the archetype pipeline flavor (the euro pipeline
   * ships more skill bigs). Absent = the name draw decides (legacy
   * behavior for genesis, free agents and career circuits).
   */
  pipeline?: Pipeline;
}

// ---------------------------------------------------------------------------
// generation constants (module-scope, provenance-tagged; the sweepable
// levers live in params.gen - these are structural shape constants of the
// generator, the same category as gameday.ts's projection constants)

/** Uniform position mix. REAL-ish: NBA rosters carry ~3 players per position. */
const POSITION_ORDER: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

const QUALITY_DEFAULT_MEAN = 60; // CAL: league-shaped default (W59 recentering)
const QUALITY_DEFAULT_SD = 12;   // FEEL: wide enough to produce fringe and plus players unprompted
const QUALITY_LO = 20;           // FEEL: below this nobody holds a pro roster spot
const QUALITY_HI = 90;           // FEEL: generational ceiling for a quality TARGET

// CAN x WANT shooting structure (#143, from the #126 measurement).
// The calibration packs are bimodal: three-point skill and appetite live
// in the same bodies. Independent template rolls matched the packs on
// every MARGINAL (attr.three, tend.shotThree, minutes exposure) yet
// halved specialist density (21% vs 40%) and starved league 3PA by ~6/tg,
// because the engine prices attempts superlinearly in the CAN x WANT
// pair. The fix is structural: put the CAN in the shooter identities,
// then derive the WANT from the CAN, so coherence (docs/ROSTERS.md) holds
// by construction instead of by repairs at the extremes. Want-side-only
// coupling was probed and falsified - it reproduces the pack correlation
// but not the specialist mass, which is CAN-marginal-limited (the #143
// design record carries the rung table).
const SHOOTER_TEMPLATE_APPETITE = 55; // FEEL: template shotThree at/above this marks a shooter identity; sits in the catalog's 52-58 gap
const SHOOTER_CAN_FLOOR = 72;         // CAL: rolled attr.three floor on shooter identities; probe-picked against the 30-40% specialist-share target (#143)
const WANT_FROM_CAN_OFFSET = 12;      // REAL: the packs' minutes-weighted marginals gap - attr.three ~58 vs tend.shotThree ~46 (#126)
const WANT_FROM_CAN_NOISE_SD = 5.5;   // SWEPT: lands corr(attr.three, tend.shotThree) at the packs' 0.962; keep the .5

const RAW_DISCOUNT_PER_YEAR = 3.0; // CAL: current-dial discount per year under 23, at zero readiness
const RAW_AGE = 23;              // FEEL: by 23 a prospect's dials are his dials (FRANCHISE.md section 5)
/**
 * Readiness: elite talent translates young (the one-and-done lottery pick
 * is nearly pro-ready at 19, which is WHY he leaves at 19), while a fringe
 * teenager is all rawness. Scales the raw-arrival discount down as quality
 * rises: full discount at/below the readiness floor, RAW_READY_MIN of it
 * at the elite end. REAL-ish: rookie-season production curves by draft
 * slot show exactly this shape.
 */
const RAW_READY_Q_LO = 35;       // CAL: at/below this quality the discount applies in full
const RAW_READY_Q_HI = 80;       // CAL: quality where readiness maxes out
const RAW_READY_MIN = 0.4;       // CAL: fraction of the discount an elite teenager still carries
/**
 * How much of the raw-arrival discount each group carries. Teenagers are
 * already near their athletic tools but lag in craft and reads: skill and
 * mental groups eat the full discount, athleticism barely any.
 */
const RAW_GROUP_WEIGHT: Record<AttrGroup, number> = {
  phys: 0.3,        // FEEL: a 19-year-old's speed and vertical mostly arrived with him
  scoring: 1.0,     // FEEL: shooting touch and shot craft come with reps
  playmaking: 1.0,  // FEEL: pro passing windows are learned
  defense: 1.0,     // FEEL: scheme discipline is the last thing to develop
  rebounding: 0.7,  // FEEL: motor translates early, positioning does not
  mental: 1.2,      // FEEL: decisions lag the most in raw arrivals
};
const CEILING_AGE = 27;          // FEEL: headroom is near zero at 27+ (dev.ts owns the decline)
const CEILING_SPAN = 8;          // FEEL: 27 - 19, the years over which headroom fades linearly
/**
 * Ceiling cone width by age: young prospects carry WIDE cones (the draft's
 * uncertainty lives there), older prospects tight ones. The sd floor keeps
 * a 23-year-old's ceiling honest instead of frozen.
 */
const CEIL_SD_FLOOR = 0.35;      // CAL: fraction of ceilingHeadroomSd left at the fade horizon

// usage-vs-quality coherence (brief: stars 75-95, role players 30-55).
// Linear map fitted through (quality 80 -> usage 85) and (quality 55 ->
// usage 42), then pulled toward the archetype's usage identity: a star
// floor general carries the offense differently from a star iso creator.
const USAGE_SLOPE = 1.72;        // FEEL: fitted slope of the quality-to-usage line
const USAGE_INTERCEPT = -52.6;   // FEEL: fitted intercept of the same line
const USAGE_ARCH_PULL = 0.35;    // FEEL: points of usage per point the archetype template sits off 50
const USAGE_SD = 5;              // FEEL: role noise (some stars defer, some role players hunt)
const USAGE_LO = 15;             // FEEL: even a pure screener consumes some possessions
const USAGE_HI = 95;             // FEEL: heliocentric load ceiling (ROSTERS.md: 90 = "offense runs through him")

const MAX_NAME_REROLLS = 32;     // FEEL: uniqueness re-roll bound; pool cross-product makes exhaustion unreachable

/** Round + clamp a generated rating into the working 1-99 band. */
function clampRating(x: number): number {
  return Math.round(clamp(x, 1, 99));
}

/** Attribute keys per potential group - mirrors the PotentialProfile field comments in types.ts. */
const GROUP_ATTRS: Record<AttrGroup, ReadonlyArray<keyof Attributes>> = {
  phys: ['speed', 'accel', 'strength', 'vertical', 'lateral', 'stamina'],
  scoring: ['finishing', 'midRange', 'three', 'freeThrow', 'drawFoul'],
  playmaking: ['ballHandle', 'passAcc', 'passVision'],
  defense: ['perimeterD', 'interiorD', 'steal', 'block', 'contestSkill'],
  rebounding: ['offReb', 'defReb', 'boxout'],
  mental: ['decisions', 'consistency'],
};

/** Iteration order for group passes; fixed so draw order never depends on object key order. */
const GROUPS: readonly AttrGroup[] = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'];

function groupMean(attr: Attributes, g: AttrGroup): number {
  let sum = 0;
  for (const k of GROUP_ATTRS[g]) sum += attr[k];
  return sum / GROUP_ATTRS[g].length;
}

// ---------------------------------------------------------------------------
// draft-class talent tiers (the age-talent mixture)
//
// The real shape: the lottery's talent leaves school at 19; four-year
// seniors arrive at 22-23 because they were never lottery talents. Drawing
// a TIER first and age conditional on tier reproduces both truths at once.
// The age tilt reshapes params.gen.prospectAgeMix per tier (a geometric
// tilt across the [19, 20, 21, 22+] buckets), so the sweepable age mix
// stays live: the rotation tier IS the param, tiers above skew younger,
// the fringe tier skews senior.

interface TalentTier {
  key: 'generational' | 'star' | 'starter' | 'rotation' | 'fringe';
  weight: number;     // CAL: relative pool share (sums are normalized by rng.weighted)
  qLo: number;        // CAL: quality target band, pre-wave
  qHi: number;
  youthBias: number;  // CAL: geometric age tilt; >1 = younger than the param mix
}

const TALENT_TIERS: readonly TalentTier[] = [
  { key: 'generational', weight: 1.2, qLo: 82, qHi: 92, youthBias: 3.6 },
  { key: 'star', weight: 5.0, qLo: 73, qHi: 86, youthBias: 3 },
  { key: 'starter', weight: 13, qLo: 63, qHi: 75, youthBias: 2.2 },
  { key: 'rotation', weight: 34, qLo: 53, qHi: 65, youthBias: 1.15 },
  { key: 'fringe', weight: 46, qLo: 42, qHi: 51, youthBias: 0.26 },
];

/** Top-two-tier weight response to the class wave. FEEL: a loaded class is loaded at the TOP. */
const WAVE_TIER_EXP = 4;
/** Prospect quality never reaches a peak superstar's level on day one. FEEL. */
const PROSPECT_QUALITY_HI = 90;
/** Class strength wave clamp. FEEL: historic weak/loaded classes stay inside +-15%. */
const WAVE_LO = 0.85;
const WAVE_HI = 1.15;
/** Share of the 22+ bucket that is 23 (four-year seniors inside the bucket). FEEL. */
const SENIOR_23_SHARE = 0.3;
/**
 * Polish: extra quality by age bucket [19, 20, 21, 22+], plus a little
 * more for a true 23-year-old senior. The floor side of the age tradeoff:
 * a senior arrives with four years of reps priced into his day-one game,
 * while his ceiling cone (fade + narrow sd) is already closing. CAL:
 * tuned against the top10-vs-45-60 age-gap guard.
 */
const POLISH_BY_BUCKET: readonly [number, number, number, number] = [0, 0.4, 1.0, 2.0];
const POLISH_23_EXTRA = 0.5;
/**
 * International age overlay on the [19, 20, 21, 22+] buckets. REAL-ish:
 * euro prospects declare young (18-21 in the real league; 19 is this
 * sim's draft-eligible floor, so the mass sits 19-21 and the senior
 * bucket nearly vanishes).
 */
const INTL_AGE_MULT: readonly [number, number, number, number] = [1.15, 1.15, 1.0, 0.15];

/**
 * The per-season class strength wave, drawn on its own registered stream
 * ('classwave:<season>', see INTEGRATION-gen.md) so pool-size changes and
 * generator refactors can never reshuffle which drafts run loaded. One
 * multiplier, modest spread; exported so news/tools can read a season's
 * wave without generating the class.
 */
export function classStrengthFor(leagueSeed: string, season: Season, params: FranchiseParams): number {
  const rng = streamRng(leagueSeed, 'classwave', season);
  return clamp(1 + rng.gaussian(0, params.gen.classStrengthSd), WAVE_LO, WAVE_HI);
}

/** Tier-conditional age-bucket weights: prospectAgeMix reshaped by the tier's youth tilt. */
function ageBucketWeights(mix: readonly number[], tier: TalentTier, pipeline: Pipeline): number[] {
  const out: number[] = [];
  for (let b = 0; b < 4; b++) {
    const tilt = Math.pow(tier.youthBias, 3 - b);
    const intl = pipeline === 'international' ? INTL_AGE_MULT[b]! : 1;
    out.push((mix[b] ?? 0) * tilt * intl);
  }
  return out;
}

// ---------------------------------------------------------------------------
// shared helpers for the generation modules (genesis.ts imports these;
// they are deliberately NOT in the package barrel)

/**
 * Plain mean of all 24 attributes - the generation modules' crude overall
 * ability, used for contract pricing and the genesis starter ordering.
 * Also the "true overall" the draft-realism calibration guards rank by.
 */
export function abilityMean(p: FrPlayer): number {
  let sum = 0;
  for (const k of ATTR_KEYS) sum += p.attr[k];
  return sum / ATTR_KEYS.length;
}

function applyName(p: FrPlayer, n: GeneratedName): void {
  p.name = `${n.first} ${n.last}`;
  p.origin = n.origin;
  p.birthplace = n.birthplace;
  p.originDetail = n.originDetail;
}

/** Which side of the name pools a player's bio line came from. */
function nameKindOf(p: FrPlayer): NameKind {
  return p.origin === 'international' ? 'international' : 'domestic';
}

/**
 * League-wide name uniqueness (names.ts guarantees only famous-free single
 * draws; cross-league uniqueness is the caller's job). Re-rolls collisions
 * keeping the player's origin side stable - a Belgrade-born prospect stays
 * international - then registers the final name in `used`.
 */
export function ensureUniqueName(rng: Rng, p: FrPlayer, used: Set<string>): void {
  const kind = nameKindOf(p);
  for (let i = 0; i < MAX_NAME_REROLLS && used.has(p.name); i++) {
    applyName(p, generateNameOfKind(rng, kind, { bornYear: p.bornSeason }));
  }
  if (used.has(p.name)) {
    // fail-loud guard, not an expected path: the pools would have to be
    // near-exhausted for 32 straight collisions
    throw new Error(`gen: could not find a unique name for ${p.id}`);
  }
  used.add(p.name);
}

// ---------------------------------------------------------------------------
// generatePlayer

/**
 * Generate one player: sampled position, archetype identity (attributes,
 * tendencies and build shaped together), age-adjusted dials, potential
 * ceilings whose cones narrow with age, disposition, health. Pure function
 * of (rng state, opts).
 *
 * The caller owns: PlayerId uniqueness (opts.idSeq), league-wide name
 * uniqueness (ensureUniqueName), status (returned as 'freeAgent', the
 * neutral unsigned state - genesis flips to 'roster', class generation to
 * 'draftEligible'), and any contract/rights.
 *
 * Fixed draw order: position, name, quality, archetype, body, identity,
 * shooting coupling, usage, potential, disposition block.
 */
export function generatePlayer(rng: Rng, opts: GenPlayerOpts): FrPlayer {
  const gen = opts.params.gen;
  const pos = POSITION_ORDER[rng.int(POSITION_ORDER.length)]!;
  // birth year picks the US first-name era cohort (names.ts): a 2007-born
  // prospect draws Jayden-era names, a 1988-born veteran draws his own
  const bornYear = opts.season - opts.age;
  const name = opts.pipeline
    ? generateNameOfKind(rng, opts.pipeline, { bornYear })
    : generateName(rng, { bornYear });
  const quality = clamp(
    opts.quality ?? rng.gaussian(QUALITY_DEFAULT_MEAN, QUALITY_DEFAULT_SD),
    QUALITY_LO, QUALITY_HI,
  );

  // archetype: pipeline flavor comes from the forced pipeline when given,
  // else from the side the name draw landed on (an organically
  // international vet leans the same way an intl prospect does)
  const pipeline: Pipeline = opts.pipeline
    ?? (name.origin === 'international' ? 'international' : 'domestic');
  const arch = pickArchetype(rng, pos, quality, pipeline);

  // body: position band + archetype build bias, weight tracking height,
  // wingspan over height with the rare freak tail
  const body = sampleBody(rng, pos, arch);

  // identity: template + one quality shift + bounded group/dial noise,
  // signature caps absolute (archetypes.ts owns the math)
  const { attr, tend } = sampleIdentity(rng, arch, quality, gen.mutationSd);

  // CAN x WANT shooting coupling (#143). Two-sided by design:
  // 1) a shooter identity carries the skill its appetite implies - the
  //    rolled attr.three is floored, inside the archetype's signature
  //    cap (no shooter identity caps three today; the min is the guard
  //    for any future capped identity crossing the appetite line);
  // 2) the appetite is then derived from the final CAN, because at pro
  //    level the green light follows demonstrated skill - offset from
  //    the pack marginals, noise for the reluctant/eager spread.
  // The derivation replaces the old two-repair scheme: with WANT a
  // function of CAN, both incoherence branches are unreachable by
  // construction. Signature tendency caps land last and stay absolute:
  // a rim-runner at his 45 skill cap still never hunts threes
  // (gen.test.ts pins paint bigs at 45/12).
  if (arch.tend.shotThree >= SHOOTER_TEMPLATE_APPETITE) {
    attr.three = Math.max(attr.three, Math.min(SHOOTER_CAN_FLOOR, arch.caps.three ?? SHOOTER_CAN_FLOOR));
  }
  tend.shotThree = clampRating(
    attr.three - WANT_FROM_CAN_OFFSET + rng.gaussian(0, WANT_FROM_CAN_NOISE_SD),
  );
  const shotThreeCap = arch.tendCaps.shotThree;
  if (shotThreeCap !== undefined) tend.shotThree = Math.min(tend.shotThree, shotThreeCap);

  // usage coherent with quality AND identity: an offense feeds its best
  // players, but a star hub and a star pest carry load differently.
  tend.usage = Math.round(clamp(
    USAGE_SLOPE * quality + USAGE_INTERCEPT
      + (arch.tend.usage - 50) * USAGE_ARCH_PULL
      + rng.gaussian(0, USAGE_SD),
    USAGE_LO, USAGE_HI,
  ));

  // age adjustment, applied to the mutated dials:
  // - under 23: raw arrival, current dials discounted (the gap to the
  //   ceiling is where draft uncertainty lives - FRANCHISE.md section 5)
  // - past a group's peak: present value of the curve, a gentle linear cut
  //   anchored to the aging model's decline rate (dev.ts owns the real
  //   accelerating decline going forward; generation only positions vets)
  const peaks = opts.params.aging.peakAge;
  const readiness = clamp((quality - RAW_READY_Q_LO) / (RAW_READY_Q_HI - RAW_READY_Q_LO), 0, 1);
  const rawMult = 1 - (1 - RAW_READY_MIN) * readiness;
  for (const g of GROUPS) {
    let delta = 0;
    if (opts.age < RAW_AGE) {
      delta -= (RAW_AGE - opts.age) * RAW_DISCOUNT_PER_YEAR * RAW_GROUP_WEIGHT[g] * rawMult;
    }
    const past = opts.age - peaks[g];
    if (past > 0) delta -= past * opts.params.aging.declineBase;
    if (delta !== 0) {
      for (const k of GROUP_ATTRS[g]) attr[k] = clampRating(attr[k] + delta);
    }
  }

  // potential ceilings: current group mean plus headroom. The cone is
  // age-shaped twice: the mean fades to zero by 27 (growth ends) and the
  // sd narrows with age (a 19-year-old is a wide guess, a 23-year-old a
  // tight one). Older prospects trade ceiling for the higher floor their
  // smaller raw discount already gave them.
  const fade = clamp((CEILING_AGE - opts.age) / CEILING_SPAN, 0, 1);
  const coneSd = gen.ceilingHeadroomSd * (CEIL_SD_FLOOR + (1 - CEIL_SD_FLOOR) * fade);
  const potential = {} as PotentialProfile;
  for (const g of GROUPS) {
    const mean = groupMean(attr, g);
    const headroom = Math.max(0, rng.gaussian(gen.ceilingHeadroomMean, coneSd)) * fade;
    potential[g] = Math.min(100, Math.max(Math.round(mean), Math.round(mean + headroom)));
  }

  const id = `p${String(opts.idSeq).padStart(4, '0')}`;
  const player: FrPlayer = {
    id,
    name: `${name.first} ${name.last}`,
    pos,
    bornSeason: opts.season - opts.age,
    birthplace: name.birthplace,
    origin: name.origin,
    originDetail: name.originDetail,
    heightIn: body.heightIn,
    weightLb: body.weightLb,
    wingspanIn: body.wingspanIn,
    attr,
    tend,
    potential,
    workEthic: Math.round(clamp(rng.gaussian(55, 16), 5, 99)),   // FEEL: most pros work; gym rats and coasters both exist
    disposition: {
      ambition: Math.round(clamp(rng.gaussian(50, 18), 5, 95)),        // FEEL: wide spread drives varied FA/extension behavior
      loyalty: Math.round(clamp(rng.gaussian(50, 18), 5, 95)),         // FEEL
      professionalism: Math.round(clamp(rng.gaussian(55, 16), 5, 95)), // FEEL: locker-room problems are the tail
      marketPref: Math.round(clamp(rng.gaussian(50, 18), 5, 95)),      // FEEL
    },
    health: {
      proneness: Math.round(clamp(rng.gaussian(45, 16), 5, 95)), // FEEL: median player mildly durable
      // vets arrive carrying career wear: FEEL ~1.2 wear per pro season
      // after a typical age-22 entry, capped well under the scale top
      wear: Math.round(clamp(Math.max(0, opts.age - 22) * rng.gaussian(1.2, 0.5), 0, 60)),
      injury: null,
      history: [],
    },
    morale: Math.round(clamp(rng.gaussian(68, 8), 40, 90)), // FEEL: camp-fresh contentment; grievances are earned in-sim
    status: 'freeAgent',
    contract: null,
    rights: null,
    draft: null,
    seasons: [],
    awards: [],
    devLog: [],
    faceSeed: rng.int(2147483647), // 2^31 - 1: full positive int32 space for the portrait hash
  };
  stampArchetype(player, arch.id);
  return player;
}

// ---------------------------------------------------------------------------
// generateDraftClass

/**
 * A full draft class: params.gen.draftPoolSize prospects with status
 * 'draftEligible', a talent tier drawn per prospect and age conditional on
 * tier (top of the class young, back end senior), an exact international
 * quota per params.gen.intlShare with the euro age/archetype flavor, and a
 * per-season strength wave on its own stream ('classwave:<season>').
 * Ids continue the league's 'p' sequence; names are unique league-wide.
 *
 * Called by tick.ts at the lottery phase boundary. Mutates the league
 * (players registered, ids pushed onto league.draftClass) AND returns the
 * prospects, so callers can post-process without re-reading state.
 */
export function generateDraftClass(league: League, season: Season): FrPlayer[] {
  const gen = league.params.gen;
  const rng = streamRng(league.seed, 'class', season); // registered stream (rng.ts)

  // class strength: an isolated stream, so the wave a season carries can
  // never move when the pool size or the generator's draw count changes
  const wave = classStrengthFor(league.seed, season, league.params);

  // a loaded class is loaded at the top: the wave tilts the elite tier
  // weights as well as every quality target
  const tierWeights = TALENT_TIERS.map((t) =>
    t.key === 'generational' || t.key === 'star'
      ? t.weight * Math.pow(wave, WAVE_TIER_EXP)
      : t.weight,
  );

  // ids continue the league sequence: scan the existing max rather than
  // trusting a counter that a save/load cycle would not carry
  let seq = 1;
  for (const id of Object.keys(league.players)) {
    const m = /^p(\d+)$/.exec(id);
    if (m) seq = Math.max(seq, Number(m[1]) + 1);
  }

  const used = new Set<string>();
  for (const p of Object.values(league.players)) used.add(p.name);

  // exact international quota, shuffled so intl prospects land anywhere in
  // the pool; the kind is forced through generatePlayer's pipeline opt
  const intlCount = Math.round(gen.draftPoolSize * gen.intlShare);
  const kinds: Pipeline[] = [];
  for (let i = 0; i < gen.draftPoolSize; i++) kinds.push(i < intlCount ? 'international' : 'domestic');
  rng.shuffle(kinds);

  const out: FrPlayer[] = [];
  for (let i = 0; i < gen.draftPoolSize; i++) {
    const pipeline = kinds[i]!;
    // the mixture: tier first, then age conditional on tier, then a
    // quality target inside the tier band, scaled by the wave
    const tier = TALENT_TIERS[rng.weighted(tierWeights)]!;
    const bucket = rng.weighted(ageBucketWeights(gen.prospectAgeMix, tier, pipeline));
    const age = bucket === 3 ? (rng.chance(SENIOR_23_SHARE) ? 23 : 22) : 19 + bucket;
    const polish = POLISH_BY_BUCKET[bucket]! + (age === 23 ? POLISH_23_EXTRA : 0);
    const quality = clamp(rng.range(tier.qLo, tier.qHi) * wave + polish, QUALITY_LO, PROSPECT_QUALITY_HI);
    const p = generatePlayer(rng, { age, season, quality, idSeq: seq++, params: league.params, pipeline });
    // belt over the forced pipeline, then league-wide uniqueness
    if (nameKindOf(p) !== pipeline) {
      applyName(p, generateNameOfKind(rng, pipeline, { bornYear: p.bornSeason }));
    }
    ensureUniqueName(rng, p, used);
    p.status = 'draftEligible';
    league.players[p.id] = p;
    league.draftClass.push(p.id);
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// generateCoach

/**
 * One coach candidate: tactical identity centered on league-neutral 50,
 * development quality and GM-obedience spread wide enough that hires are
 * real choices. hiredOn is a placeholder (season 0) - every caller stamps
 * the real date (genesis stamps day zero; tick.ts's hire flow spreads
 * currentDate over it), because a candidate has no hire date yet.
 */
export function generateCoach(rng: Rng, idSeq: number): Coach {
  // staff generator: a 58-year-old coach is Rick or Monty, never Jayden
  const name = personName(rng, 'coach');
  return {
    // idSeq disambiguates within one shortlist; the drawn suffix keeps ids
    // from colliding across shortlists and genesis (36^4 = 1679616 tags)
    id: `coach-${idSeq}-${rng.int(1679616).toString(36)}`,
    name: `${name.first} ${name.last}`,
    pace: Math.round(clamp(rng.gaussian(50, 12), 20, 80)),      // FEEL: centered 50 sd 12 - few extremists on the bench
    threeBias: Math.round(clamp(rng.gaussian(50, 12), 20, 80)), // FEEL: same shape
    helpAggr: Math.round(clamp(rng.gaussian(50, 12), 20, 80)),  // FEEL: same shape
    devQuality: Math.round(rng.range(30, 90)),                  // FEEL: developer coaches are a real roster-building edge
    obedience: Math.round(rng.range(60, 95)),                   // FEEL: every pro coach mostly runs the GM's plan; nobody fully
    hiredOn: { season: 0, day: 0 },                             // placeholder: callers stamp the real date (see JSDoc)
    contractSeasons: 2 + rng.int(3),                            // FEEL: 2-4 year deals, the real league's coach-contract range
  };
}
