/**
 * people/gen.ts - player generation: genesis rosters, draft classes,
 * coaches. OWNER: genesis task. STATUS: implemented (build wave A).
 *
 * Method (docs/FRANCHISE.md section 5, docs/ROSTERS.md): start from a
 * coherent archetype profile (@hoopsh/data builders - the calibrated
 * reference points for what ratings MEAN), mutate within CAN/WANT
 * coherence, age-adjust (a 19-year-old arrives raw and discounted toward
 * his ceiling; a 30-year-old vet is his curve's present value), then
 * sample a hidden potential ceiling whose headroom shrinks with age.
 * Anthropometrics are sampled from per-position bands, NOT inherited from
 * the archetype, so the league's height/wingspan distribution holds steady
 * across decades of draft classes (a documented long-sim failure mode in
 * other games - FRANCHISE.md section 5).
 *
 * Determinism: every draw flows through the caller's Rng and the draw
 * ORDER inside each generator is fixed. Callers use registered stream
 * paths (rng.ts): genesis passes 'genesis:team:<id>' streams;
 * generateDraftClass derives 'class:<season>' itself.
 */
import { clamp } from '@hoopsh/engine';
import type { Attributes, Player, Position, Rng, Tendencies } from '@hoopsh/engine';
import {
  ATTR_KEYS, TEND_KEYS,
  eliteShooter, rimRunner, floorGeneral, threeAndD, scoringWing,
  postAnchor, comboGuard, glueForward, benchBig, benchScorer, stretchBig,
} from '@hoopsh/data';
import type { AttrGroup, Coach, FrPlayer, League, PotentialProfile, Season } from '../types.js';
import type { FranchiseParams } from '../params.js';
import { streamRng } from '../rng.js';
import { generateName, generateNameOfKind } from './names.js';
import type { GeneratedName, NameKind } from './names.js';

export interface GenPlayerOpts {
  age: number;                 // age at the season being generated for
  season: Season;              // current season (bornSeason = season - age)
  quality?: number;            // 0-100 center of mass; default league-shaped
  idSeq: number;               // caller-owned unique sequence for PlayerId
  /**
   * Live parameter set (league.params for callers that hold a league).
   * Required so generation can never silently fall back to
   * defaultFranchiseParams() - the league.params doctrine
   * (docs/FRANCHISE_INTERNALS.md trap list: sweeps and saves vary params
   * per league). Added to the frozen opts shape because the original
   * shape carried no channel for calibration values; flagged in the
   * genesis task report.
   */
  params: FranchiseParams;
}

// ---------------------------------------------------------------------------
// archetype catalog

/** Uniform position mix. REAL-ish: NBA rosters carry ~3 players per position. */
const POSITION_ORDER: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

interface CatalogEntry {
  build: (who: { id: string; name: string; pos?: Position; heightIn?: number; weightLb?: number }) => Player;
  /** plain attribute mean of the unmutated archetype: the quality the profile expresses out of the box */
  anchor: number;
}

function attrMeanOf(attr: Attributes): number {
  let sum = 0;
  // fixed ATTR_KEYS order keeps float sums bit-stable however the object was built
  for (const k of ATTR_KEYS) sum += attr[k];
  return sum / ATTR_KEYS.length;
}

function entry(build: CatalogEntry['build']): CatalogEntry {
  // Probe build at module load: anchors derive from the SAME builders the
  // mutation starts from, so quality targeting stays self-consistent if
  // @hoopsh/data ever rebalances an archetype (no hand-copied tier table
  // to go stale). The probe id/name never leave this function.
  return { build, anchor: attrMeanOf(build({ id: 'anchor-probe', name: 'anchor-probe' }).attr) };
}

/**
 * Which archetypes can express each position. Wing archetypes straddle
 * neighbor positions the way real players do (a scoring wing plays SG or
 * SF; a stretch big plays PF or C); pure specialists stay home.
 */
const CATALOG: Record<Position, CatalogEntry[]> = {
  PG: [entry(floorGeneral), entry(eliteShooter), entry(comboGuard)],
  SG: [entry(scoringWing), entry(comboGuard), entry(benchScorer), entry(eliteShooter)],
  SF: [entry(threeAndD), entry(scoringWing), entry(glueForward)],
  PF: [entry(postAnchor), entry(glueForward), entry(stretchBig)],
  C: [entry(rimRunner), entry(stretchBig), entry(benchBig), entry(postAnchor)],
};

// ---------------------------------------------------------------------------
// anthropometrics

interface BodyBand {
  hMean: number; hSd: number; hLo: number; hHi: number;
  /** weight at the position's mean height, pounds */
  wBase: number;
}

/**
 * Per-position height bands, inches. REAL-ish: modern-league positional
 * averages (PG ~6'2.5", C ~7'0") with clamps well inside the engine's
 * 60-96 validation bounds. Weight bases are the matching positional
 * averages in pounds.
 */
const BODY: Record<Position, BodyBand> = {
  PG: { hMean: 74.5, hSd: 1.8, hLo: 70, hHi: 79, wBase: 190 },
  SG: { hMean: 77.0, hSd: 1.6, hLo: 73, hHi: 81, wBase: 205 },
  SF: { hMean: 79.5, hSd: 1.5, hLo: 76, hHi: 83, wBase: 220 },
  PF: { hMean: 81.5, hSd: 1.5, hLo: 78, hHi: 85, wBase: 235 },
  C: { hMean: 83.5, hSd: 1.7, hLo: 80, hHi: 89, wBase: 252 },
};

const LB_PER_INCH = 6;     // REAL-ish: taller frames carry ~6 lb per extra inch across the league
const WEIGHT_SD = 9;       // FEEL: build variance at a given height (wiry vs sturdy)
const WEIGHT_LO = 160;     // FEEL: lighter than any modern pro
const WEIGHT_HI = 310;     // FEEL: heavier than any modern rotation player
const WING_DELTA_MEAN = 4.5; // REAL-ish: league wingspan exceeds height by ~4-5 inches on average
const WING_DELTA_SD = 1.8;   // FEEL: spread from even (negative-ape-index outliers exist) to condor arms

// ---------------------------------------------------------------------------
// generation constants (module-scope, provenance-tagged; the sweepable
// levers live in params.gen - these are structural shape constants of the
// generator, the same category as gameday.ts's projection constants)

const QUALITY_DEFAULT_MEAN = 60; // CAL: league-shaped default, lifted +10 by the W59 recentering (generated dials measured 12-18 under the calibration rosters' input level)
const QUALITY_DEFAULT_SD = 12;   // FEEL: wide enough to produce fringe and plus players unprompted
const QUALITY_LO = 20;           // FEEL: below this nobody holds a pro roster spot
const QUALITY_HI = 90;           // FEEL: generational ceiling for a quality TARGET (dials can still mutate higher)
const ARCHETYPE_TEMP = 8;        // FEEL: softmax temperature for anchor-vs-quality closeness (rating points)
const QUALITY_GAIN = 0.8;        // FEEL: how far quality drags the whole profile; below 1 so archetype shape dominates
const RATING_LO = 1;             // FEEL: generated dials avoid the absolute 0 rail (archetypes bottom out at 1)
const RATING_HI = 99;            // FEEL: 99 = the unambiguous best (ROSTERS.md anchors); generation never mints a 100

// CAN/WANT coherence (docs/ROSTERS.md: an 85 three with a 5 shotThree
// never shoots - skill without appetite is incoherent)
const COHERENT_SKILL = 75;       // FEEL: a 75+ three is a legitimate weapon a real offense weaponizes
const COHERENT_WANT_FLOOR = 15;  // FEEL: below this appetite the weapon never fires
const RAW_DISCOUNT_PER_YEAR = 2.6; // CAL rating points of current-dial discount per year under 23 (raw arrivals)
const RAW_AGE = 23;              // FEEL: by 23 a prospect's dials are his dials (FRANCHISE.md section 5)
/**
 * How much of the raw-arrival discount each group carries. Teenagers are
 * already near their athletic tools but lag in craft and reads: skill and
 * mental groups eat the full discount, athleticism barely any.
 */
const RAW_GROUP_WEIGHT: Record<AttrGroup, number> = {
  phys: 0.3,        // FEEL: a 19-year-old's speed/vertical mostly arrived with him
  scoring: 1.0,     // FEEL: shooting touch and shot craft come with reps
  playmaking: 1.0,  // FEEL: pro passing windows are learned
  defense: 1.0,     // FEEL: scheme discipline is the last thing to develop
  rebounding: 0.7,  // FEEL: motor translates early, positioning does not
  mental: 1.2,      // FEEL: decisions lag the most in raw arrivals
};
const CEILING_AGE = 27;          // FEEL: headroom is near zero at 27+ (growth is over; dev.ts owns the decline)
const CEILING_SPAN = 8;          // FEEL: 27 - 19, the years over which headroom fades linearly

// usage-vs-quality coherence (brief: stars 75-95, role players 30-55).
// Linear map fitted through (quality 80 -> usage 85) and (quality 55 ->
// usage 42): slope 43/25, intercept 85 - slope * 80.
const USAGE_SLOPE = 1.72;        // FEEL: fitted slope of the quality-to-usage line
const USAGE_INTERCEPT = -52.6;   // FEEL: fitted intercept of the same line
const USAGE_SD = 5;              // FEEL: role noise (some stars defer, some role players hunt)
const USAGE_LO = 15;             // FEEL: even a pure screener consumes some possessions
const USAGE_HI = 95;             // FEEL: heliocentric load ceiling (ROSTERS.md: 90 is "offense runs through him")

const MAX_NAME_REROLLS = 32;     // FEEL: uniqueness re-roll bound; pool cross-product makes exhaustion unreachable

/** Round + clamp a generated rating into the working 1-99 band. */
function clampRating(x: number): number {
  return Math.round(clamp(x, RATING_LO, RATING_HI));
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
// shared helpers for the generation modules (genesis.ts imports these;
// they are deliberately NOT in the package barrel)

/**
 * Plain mean of all 24 attributes - the generation modules' crude overall
 * ability, used for contract pricing and the genesis starter ordering.
 * ai/roster.ts's depthChart supersedes this for live-league ordering once
 * the ai-team task lands (same doctrine as gameday.ts#abilityScore).
 */
export function abilityMean(p: FrPlayer): number {
  return attrMeanOf(p.attr);
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
    applyName(p, generateNameOfKind(rng, kind));
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
 * Generate one player: sampled position, archetype base mutated within
 * CAN/WANT coherence, age-adjusted dials, potential ceilings, body,
 * disposition, health. Pure function of (rng state, opts).
 *
 * The caller owns: PlayerId uniqueness (opts.idSeq), league-wide name
 * uniqueness (ensureUniqueName), status (returned as 'freeAgent', the
 * neutral unsigned state - genesis flips to 'roster', class generation to
 * 'draftEligible'), and any contract/rights.
 */
export function generatePlayer(rng: Rng, opts: GenPlayerOpts): FrPlayer {
  const gen = opts.params.gen;
  // --- fixed draw order: position, name, quality, archetype, body, dials ---
  const pos = POSITION_ORDER[rng.int(POSITION_ORDER.length)]!;
  const name = generateName(rng);
  const quality = clamp(
    opts.quality ?? rng.gaussian(QUALITY_DEFAULT_MEAN, QUALITY_DEFAULT_SD),
    QUALITY_LO, QUALITY_HI,
  );

  // archetype: prefer profiles whose out-of-the-box quality sits near the
  // target, softly (a star-quality center is usually a rim runner, but a
  // star bench-big profile stays possible)
  const cands = CATALOG[pos];
  const weights = cands.map((c) => Math.exp(-Math.abs(c.anchor - quality) / ARCHETYPE_TEMP));
  const chosen = cands[rng.weighted(weights)]!;

  // body: position band, weight tracking height, wingspan over height
  const body = BODY[pos];
  const heightIn = Math.round(clamp(rng.gaussian(body.hMean, body.hSd), body.hLo, body.hHi));
  const weightLb = Math.round(clamp(
    body.wBase + (heightIn - body.hMean) * LB_PER_INCH + rng.gaussian(0, WEIGHT_SD),
    WEIGHT_LO, WEIGHT_HI,
  ));
  const wingspanIn = Math.round(clamp(
    heightIn + rng.gaussian(WING_DELTA_MEAN, WING_DELTA_SD),
    heightIn - 1, // FEEL: negative ape index is rare and never extreme
    heightIn + 9, // FEEL: the condor tail (real outliers reach ~+10)
  ));

  const id = `p${String(opts.idSeq).padStart(4, '0')}`;
  const base = chosen.build({ id, name: `${name.first} ${name.last}`, pos, heightIn, weightLb });

  // dials: uniform quality shift preserves the archetype's shape (identity
  // comes from the profile's internal ratios, not its level), then
  // per-dial mutation with the calibrated sd
  const shift = (quality - chosen.anchor) * QUALITY_GAIN;
  const attr = {} as Attributes;
  for (const k of ATTR_KEYS) {
    attr[k] = clampRating(base.attr[k] + shift + rng.gaussian(0, gen.mutationSd));
  }
  const tend = {} as Tendencies;
  for (const k of TEND_KEYS) {
    // tendencies are appetite, not skill: mutated but never quality-shifted
    // (wanting the ball harder does not make you better at it)
    tend[k] = clampRating(base.tend[k] + rng.gaussian(0, gen.mutationSd));
  }

  // CAN/WANT coherence repair (docs/ROSTERS.md). High-skill/no-appetite on
  // a non-center: a real coach would weaponize that shooter, so pull the
  // appetite up. Centers are exempt on this side (the reluctant stretch
  // five who CAN shoot but lives at the rim is a real player type).
  if (pos !== 'C' && attr.three >= COHERENT_SKILL && tend.shotThree <= COHERENT_WANT_FLOOR) {
    tend.shotThree = Math.round(rng.range(40, 75)); // FEEL: a real weapon's firing rate
  }
  // The mirror incoherence for every position: nobody at pro level keeps
  // firing threes he cannot make - the appetite gets coached out.
  if (attr.three <= COHERENT_WANT_FLOOR && tend.shotThree >= COHERENT_SKILL) {
    tend.shotThree = Math.round(rng.range(5, 25)); // FEEL: bail-out attempts only
  }

  // usage coherent with quality: an offense feeds its best players. Drawn
  // AFTER coherence repair so the star band (75-95) survives mutation.
  tend.usage = Math.round(clamp(
    USAGE_SLOPE * quality + USAGE_INTERCEPT + rng.gaussian(0, USAGE_SD),
    USAGE_LO, USAGE_HI,
  ));

  // age adjustment, applied to the mutated dials:
  // - under 23: raw arrival, current dials discounted (the gap to his
  //   ceiling is where draft uncertainty lives - FRANCHISE.md section 5)
  // - past a group's peak: present value of the curve, a gentle linear cut
  //   anchored to the aging model's decline rate (dev.ts owns the real
  //   accelerating decline going forward; genesis only positions the vet)
  const peaks = opts.params.aging.peakAge;
  for (const g of GROUPS) {
    let delta = 0;
    if (opts.age < RAW_AGE) {
      delta -= (RAW_AGE - opts.age) * RAW_DISCOUNT_PER_YEAR * RAW_GROUP_WEIGHT[g];
    }
    const past = opts.age - peaks[g];
    if (past > 0) delta -= past * opts.params.aging.declineBase;
    if (delta !== 0) {
      for (const k of GROUP_ATTRS[g]) attr[k] = clampRating(attr[k] + delta);
    }
  }

  // potential ceilings: current group mean plus headroom that fades to
  // zero by 27 (development pulls dials toward these; scouts only ever see
  // ranges around them)
  const fade = clamp((CEILING_AGE - opts.age) / CEILING_SPAN, 0, 1);
  const potential = {} as PotentialProfile;
  for (const g of GROUPS) {
    const mean = groupMean(attr, g);
    const headroom = Math.max(0, rng.gaussian(gen.ceilingHeadroomMean, gen.ceilingHeadroomSd)) * fade;
    potential[g] = Math.min(100, Math.max(Math.round(mean), Math.round(mean + headroom)));
  }

  return {
    id,
    name: `${name.first} ${name.last}`,
    pos,
    bornSeason: opts.season - opts.age,
    birthplace: name.birthplace,
    origin: name.origin,
    originDetail: name.originDetail,
    heightIn,
    weightLb,
    wingspanIn,
    attr,
    tend,
    potential,
    workEthic: Math.round(clamp(rng.gaussian(55, 16), 5, 99)),   // FEEL: mean 55 sd 16 - most pros work; gym rats and coasters both exist
    disposition: {
      ambition: Math.round(clamp(rng.gaussian(50, 18), 5, 95)),        // FEEL: wide spread drives varied FA/extension behavior
      loyalty: Math.round(clamp(rng.gaussian(50, 18), 5, 95)),         // FEEL
      professionalism: Math.round(clamp(rng.gaussian(55, 16), 5, 95)), // FEEL: slight pro-median lean; locker-room problems are the tail
      marketPref: Math.round(clamp(rng.gaussian(50, 18), 5, 95)),      // FEEL
    },
    health: {
      proneness: Math.round(clamp(rng.gaussian(45, 16), 5, 95)), // FEEL: median player mildly durable; glass players are the tail
      // vets arrive carrying career wear (a 33-year-old with a rookie's
      // odometer would misread in the injury model): FEEL ~1.2 wear per
      // pro season after a typical age-22 entry, capped well under the
      // scale top
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
}

// ---------------------------------------------------------------------------
// generateDraftClass

/**
 * A full draft class: params.gen.draftPoolSize prospects with status
 * 'draftEligible', ages per params.gen.prospectAgeMix, an exact
 * international quota per params.gen.intlShare, and a per-class strength
 * multiplier (strong and weak classes are real). Ids continue the league's
 * 'p' sequence; names are unique league-wide.
 *
 * Called by tick.ts at the lottery phase boundary. Mutates the league
 * (players registered, ids pushed onto league.draftClass) AND returns the
 * prospects, so callers can post-process without re-reading state.
 */
export function generateDraftClass(league: League, season: Season): FrPlayer[] {
  const gen = league.params.gen;
  const rng = streamRng(league.seed, 'class', season); // registered stream (rng.ts)

  // class strength: one multiplier on every prospect's quality target.
  // Drawn FIRST so pool-size changes never reshuffle it.
  const strength = clamp(
    1 + rng.gaussian(0, gen.classStrengthSd),
    0.85, 1.15, // FEEL: even historic weak/loaded classes stay inside +-15%
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

  // exact international quota (names.ts: callers that must hit a share
  // force the kind), shuffled so intl prospects land anywhere in the pool
  const intlCount = Math.round(gen.draftPoolSize * gen.intlShare);
  const kinds: NameKind[] = [];
  for (let i = 0; i < gen.draftPoolSize; i++) kinds.push(i < intlCount ? 'international' : 'domestic');
  rng.shuffle(kinds);

  const out: FrPlayer[] = [];
  for (let i = 0; i < gen.draftPoolSize; i++) {
    // age per the prospect mix; the 22+ bucket is mostly 22 with a senior tail
    const bucket = rng.weighted(gen.prospectAgeMix);
    const age = bucket === 3 ? (rng.chance(0.25) ? 23 : 22) : 19 + bucket; // FEEL 0.25: four-year seniors inside the 22+ bucket
    // prospect quality centers below the league mean - prospects are
    // unproven; the stars separate through headroom, not day-one dials
    const quality = clamp(
      rng.gaussian(44, 11) * strength, // FEEL: mean 44 sd 11 pre-strength
      QUALITY_LO,
      82, // FEEL: even a generational prospect arrives below a peak superstar
    );
    const p = generatePlayer(rng, { age, season, quality, idSeq: seq++, params: league.params });
    // enforce the assigned pool side, then league-wide uniqueness
    if (nameKindOf(p) !== kinds[i]) applyName(p, generateNameOfKind(rng, kinds[i]!));
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
  const name = generateName(rng);
  return {
    // idSeq disambiguates within one shortlist; the drawn suffix keeps ids
    // from colliding across shortlists and genesis (36^4 = 1679616 tags)
    id: `coach-${idSeq}-${rng.int(1679616).toString(36)}`,
    name: `${name.first} ${name.last}`,
    pace: Math.round(clamp(rng.gaussian(50, 12), 20, 80)),      // FEEL: centered 50 sd 12 - few extremists on the bench
    threeBias: Math.round(clamp(rng.gaussian(50, 12), 20, 80)), // FEEL: same shape
    helpAggr: Math.round(clamp(rng.gaussian(50, 12), 20, 80)),  // FEEL: same shape
    devQuality: Math.round(rng.range(30, 90)),                  // FEEL: 30-90 spread - developer coaches are a real roster-building edge
    obedience: Math.round(rng.range(60, 95)),                   // FEEL: 60-95 - every pro coach mostly runs the GM's plan; nobody fully
    hiredOn: { season: 0, day: 0 },                             // placeholder: callers stamp the real date (see JSDoc)
    contractSeasons: 2 + rng.int(3),                            // FEEL: 2-4 year deals, the real league's coach-contract range
  };
}
