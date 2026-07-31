/**
 * genesis.ts - createLeague: the whole league at day zero. OWNER: genesis
 * task. STATUS: implemented (build wave A).
 *
 * Assembles: 30 franchises (teamdata.ts) with 14-15 man rosters shaped as
 * an age/quality pyramid (stars rare, a handful of tax teams, a handful of
 * rebuilders near the payroll floor), genesis contracts written DIRECTLY
 * with means 'genesis' (the cba modules validate live signings; league
 * history that predates day zero is fiction and never re-validated),
 * owners/GM personas/coaches, own 1st+2nd round picks seven seasons out
 * (REAL: the CBA's seven-year pick horizon), genesis-season cap lines, and
 * a veteran free-agent pool. The first draft class is NOT generated here -
 * tick.ts calls generateDraftClass at the lottery phase boundary.
 *
 * calendar and schedule are returned EMPTY by contract: tick.ts
 * lazy-initializes both on the first advanceDay (docs/FRANCHISE_INTERNALS.md
 * genesis row). Phase 'camp'/day 0 matches what calendar.ts#phaseOn reads
 * from an empty calendar.
 *
 * Determinism: every draw flows through registered streams (rng.ts) -
 * 'genesis' for league-level decisions and 'genesis:team:<id>' per team,
 * so one team's roster draws never reshuffle another's. Same seed and
 * opts = deep-equal league.
 */
import { clamp } from '@hoopsh/engine';
import type { Rng } from '@hoopsh/engine';
import type {
  Contract, ContractYear, DraftPick, FrPlayer, FrTeam, League, Owner,
  PlayerId, Season, TeamId, Timeline,
} from './types.js';
import type { FranchiseParams } from './params.js';
import { withFranchiseParams } from './params.js';
import { streamRng } from './rng.js';
import { FRANCHISES } from './teamdata.js';
import { generatePersona } from './ai/persona.js';
import { generateName } from './people/names.js';
import { abilityMean, ensureUniqueName, generateCoach, generatePlayer } from './people/gen.js';

export interface CreateLeagueOpts {
  seed: string;
  userTeam: TeamId;
  startSeason?: number;          // default 2026
  params?: Partial<FranchiseParams>;
}

// ---------------------------------------------------------------------------
// genesis shape constants (module-scope, provenance-tagged; same category
// as gameday.ts's projection constants - structural conventions of league
// assembly, not sweepable levers; candidates for params.gen graduation are
// flagged in the genesis task report)

const DEFAULT_START_SEASON = 2026; // REAL: params.cba genesis cap lines are the 2026-27 figures
const PICK_HORIZON = 7;            // REAL: teams may trade picks at most seven drafts out, so seven exist on the books

const ROSTER_FULL_P = 0.75;        // FEEL: most teams carry the full 15; a few leave the last spot open
const TAX_TEAMS_MIN = 2;           // FEEL: 2-4 teams open the league in the tax (real leagues run ~4-8; kept low at genesis so tax pressure builds in-sim)
const TAX_TEAMS_SPREAD = 3;        // FEEL: int(3) on top of the min -> 2-4
const REBUILD_TEAMS_MIN = 5;       // FEEL: 5-7 teams open in a teardown - roughly the real league's bottom tier
const REBUILD_TEAMS_SPREAD = 3;    // FEEL: int(3) on top of the min -> 5-7

/**
 * Quality dropoff by roster slot (slot 0 = the best player). FEEL pyramid:
 * a tight starter core, then a long bench tail - real cap sheets and
 * minutes ladders both have this shape.
 */
const DROP: readonly number[] = [0, 5, 8, 11, 14, 17, 20, 22, 24, 26, 28, 30, 32, 34, 36];
const SLOT_Q_NOISE = 2;            // FEEL: sd of per-slot quality jitter so ladders are not literal staircases
const Q_SLOT_LO = 42;              // CAL: fringe-pro floor, lifted +12 by the first acceptance measurement (generated league ran pace 86 / scoring 100 / 3PA 24 against the calibration rosters' input level; REGISTER W59)
const Q_SLOT_HI = 88;              // CAL: lifted with the floor so the pyramid keeps its shape

/** Top-slot quality range per timeline. CAL: lifted +10 with the W59 recentering; contenders employ a star, rebuilders' best is a solid starter. */
const TIER_TOP_Q: Record<Timeline, [number, number]> = {
  contend: [84, 90],
  retool: [74, 86],
  rebuild: [68, 76],
};
/** Roster age bias per timeline. FEEL: contenders buy vets, rebuilders play kids; biases roughly cancel league-wide. */
const TIER_AGE_BIAS: Record<Timeline, number> = { contend: 1.0, retool: 0.2, rebuild: -1.8 };
const AGE_LO = 19;                 // REAL: draft-eligible minimum age
const AGE_HI = 38;                 // FEEL: the oldest opening-night vets
const STAR_Q = 84;                 // CAL: quality targets at/above this read as stars (moved with the W59 recentering)
const STAR_AGE_LO = 24;           // REAL-ish: star production window - nobody arrives at genesis as a made 19-year-old star
const STAR_AGE_HI = 33;           // REAL-ish: same window's back end
const REBUILD_YOUNG_SLOTS = 2;     // FEEL: a rebuild's slots 1-2 are its young core
const REBUILD_YOUNG_Q_BOOST = 4;   // FEEL: the young core carries extra promise (headroom does the rest)
const REBUILD_YOUNG_AGE_LO = 20;   // FEEL: young core range
const REBUILD_YOUNG_AGE_HI = 23;   // FEEL

// contract pricing (FEEL curve anchored to real cap sheets: ability ~55 is
// minimum-contract replacement level, ability ~80 is max-contract level;
// anchors moved +10 with the W59 quality recentering so pricing stays
// relative and payroll shapes hold)
const SALARY_ABILITY_FLOOR = 55;   // CAL: replacement-level ability, the minimum-contract line
const SALARY_ABILITY_SPAN = 25;    // FEEL: floor + 25 spans min money to max money
const SALARY_CURVE_EXP = 1.6;      // FEEL: convex - star pay grows faster than star skill (scarcity pricing)
const SALARY_MAX_FRACTION = 0.33;  // FEEL: curve top lands inside the 25-35% star band
const SALARY_BASE_FRACTION = 0.008;// FEEL: curve bottom sits at vet-minimum scale
const SALARY_NOISE = 0.12;         // FEEL: +-12% negotiation spread around the curve

// per-ability salary bounds, as fractions of cap (clamps that keep the
// sheet plausible while fitPayroll scales toward the team target)
const STAR_ABILITY = 80;           // CAL: ability at/above this is priced as a star (moved with the W59 recentering)
const STAR_FRACTION_LO = 0.25;     // REAL-ish: brief's star band - 25-35% of cap (the CBA max tiers)
const STAR_FRACTION_HI = 0.35;     // REAL: 35% is the 10+ years-of-service max
const SOLID_ABILITY = 72;          // CAL: quality-starter line (moved with the W59 recentering)
const SOLID_FRACTION_LO = 0.06;    // FEEL: a real starter never plays for the minimum at genesis
const SOLID_FRACTION_HI = 0.25;    // FEEL: sub-star money tops out below the max tier
const ROTATION_ABILITY = 54;       // FEEL: rotation-player line
const ROTATION_FRACTION_LO = 0.02; // FEEL: rotation floor - above minimum, below mid-level
const ROTATION_FRACTION_HI = 0.14; // FEEL: rotation ceiling - full-MLE-and-change
const FRINGE_FRACTION_HI = 0.075;  // FEEL: end-of-bench ceiling; high enough that floor teams can carry "bad money" (payroll floors are met with overpays in the real league too)

const FIT_PASSES = 8;              // FEEL: proportional-headroom fitting converges in 2-3 passes; 8 is margin
const FIT_TOLERANCE = 1000;        // FEEL: $1,000 - far under the slack designed into every payroll target
/**
 * Floor-rescue ceiling, fraction of cap. When a rookie-heavy roster cannot
 * reach the 90% payroll floor under the plausibility ceilings, standard
 * deals relax up to here and the fit reruns: floor teams eating one or two
 * oversized "bad money" contracts is exactly how the real league meets its
 * floor, so the rescue is realism, not a hack.
 */
const RESCUE_FRACTION_HI = 0.20;   // FEEL: a 33M albatross is a real cap-sheet object; a 50M one on a floor team is not
const MAX_ROOKIE_DEALS = 6;        // FEEL: at most ~two drafts of scale deals plus holdovers on one roster; also keeps the floor reachable (a 14-man sheet of scale money cannot legally spend 148M)

const CONTRACT_LEN_WEIGHTS = [0.18, 0.30, 0.30, 0.22]; // FEEL: 1-4 year deals, most sheets living at 2-3
const RAISE_LO = -0.04;            // FEEL: mild decliner deals exist
const RAISE_HI = 0.08;             // REAL: 8% is the CBA's own-team raise cap
const STAR_PLAYER_OPTION_P = 0.3;  // FEEL: stars extract player options on the last year
const FRINGE_TEAM_OPTION_P = 0.2;  // FEEL: teams extract options on fringe deals
const ROOKIE_DEAL_YEARS = 4;       // REAL: rookie scale is 2 guaranteed years + 2 team options
const ROOKIE_RAISE = 0.05;         // REAL-ish: scale raises run ~5% year over year
const ROOKIE_ENTRY_AGE = 19;       // FEEL: genesis fiction - every young player is priced as if drafted at 19
const YOS_ENTRY_AGE = 20;          // FEEL: years-of-service proxy for minimums - age minus a typical age-20 entry

const TWO_WAY_MAX = 2;             // FEEL: 0-2 of the 3 slots filled at genesis; camp battles fill the rest in-sim

// payroll targets by tier (fractions applied to the genesis lines)
const REBUILD_TARGET_LO = 1.01;    // FEEL: floor teams sit just above the 90% minimum (floor x 1.01)
const REBUILD_TARGET_SPREAD = 0.06;// FEEL: up to floor x 1.07
const MIDDLE_TARGET_LO = 1.08;     // FEEL: mid teams start comfortably over the floor (floor x 1.08)
const MIDDLE_TARGET_HI = 0.985;    // FEEL: and stop just under the tax line (tax x 0.985)
const CONTEND_TARGET_LO = 1.01;    // FEEL: tax teams clear the line for real (tax x 1.01)
const CONTEND_APRON1_STRETCH = 1.03; // FEEL: a contender or two may nose over the first apron
const CONTEND_APRON2_GUARD = 0.96;   // FEEL: hard guard - nobody opens over the second apron (its penalties are the sim's to earn)

// free agents (the unsigned veteran market the season opens with)
const FA_COUNT_BASE = 55;          // FEEL: ~60 unsigned vets, matching a real September market's usable tail
const FA_COUNT_SPREAD = 11;        // FEEL: int(11) -> 55-65
const FA_AGE_MEAN = 31;            // FEEL: the unsigned market skews old
const FA_AGE_SD = 3.5;             // FEEL
const FA_AGE_LO = 26;              // FEEL: younger unsigned players took camp deals already
const FA_AGE_HI = 39;              // FEEL: the last-ring-chase tail
const FA_QUALITY_MEAN = 42;        // FEEL: fringe-to-rotation caliber - real starters do not go unsigned at camp
const FA_QUALITY_SD = 8;           // FEEL
const FA_QUALITY_LO = 25;          // FEEL
const FA_QUALITY_HI = 58;          // FEEL

const SIGNED_AGO_SPAN = 3;         // FEEL: genesis deals were signed 0-2 seasons ago (past years live off-book, types.ts Contract.years)
const OWNER_TAX_APPETITE_CONTEND: [number, number] = [60, 95]; // FEEL: a team IN the tax has an owner who signed up for the bill
const OWNER_TAX_APPETITE_OTHER: [number, number] = [20, 80];   // FEEL: the rest span cheap to willing
const OWNER_PATIENCE: [number, number] = [25, 90];             // FEEL: quick triggers and dynasty patience both exist

// ---------------------------------------------------------------------------
// helpers

interface SlotPlan { quality: number; age: number; }

/** Quality/age ladder for one roster. Slot 0 is the team's best player. */
function planRoster(rng: Rng, tier: Timeline, size: number, params: FranchiseParams): SlotPlan[] {
  const [qLo, qHi] = TIER_TOP_Q[tier];
  const topQ = rng.range(qLo, qHi);
  const plan: SlotPlan[] = [];
  let rookieDeals = 0; // ages 22 and under land on rookie-scale paper (contract pricing below)
  for (let i = 0; i < size; i++) {
    let quality = clamp(topQ - DROP[i]! + rng.gaussian(0, SLOT_Q_NOISE), Q_SLOT_LO, Q_SLOT_HI);
    const young = tier === 'rebuild' && i >= 1 && i <= REBUILD_YOUNG_SLOTS;
    if (young) quality = clamp(quality + REBUILD_YOUNG_Q_BOOST, Q_SLOT_LO, Q_SLOT_HI);
    let age = Math.round(rng.gaussian(
      params.gen.genesisAgeMean + TIER_AGE_BIAS[tier],
      params.gen.genesisAgeSd,
    ));
    // stars arrive inside the production window; a rebuild's young core is young
    if (quality >= STAR_Q) age = clamp(age, STAR_AGE_LO, STAR_AGE_HI);
    else if (young) age = clamp(age, REBUILD_YOUNG_AGE_LO, REBUILD_YOUNG_AGE_HI);
    else age = clamp(age, AGE_LO, AGE_HI);
    if (age <= 22) {
      // 22 and under is the rookie-scale line (contract pricing below)
      if (rookieDeals >= MAX_ROOKIE_DEALS) age = 23; // see MAX_ROOKIE_DEALS: the tail of an age draw becomes a 23-year-old on a standard deal
      else rookieDeals++;
    }
    plan.push({ quality, age });
  }
  return plan;
}

/** Cap fraction the pricing curve asks for at a given ability, with negotiation noise. */
function salaryFraction(rng: Rng, ability: number): number {
  const t = clamp((ability - SALARY_ABILITY_FLOOR) / SALARY_ABILITY_SPAN, 0, 1);
  const f = Math.pow(t, SALARY_CURVE_EXP) * SALARY_MAX_FRACTION + SALARY_BASE_FRACTION;
  return f * (1 + rng.range(-SALARY_NOISE, SALARY_NOISE));
}

/** Plausibility clamps for a standard genesis salary, integer dollars. */
function salaryBounds(ability: number, age: number, params: FranchiseParams): [number, number] {
  const cap = params.cba.genesisCap;
  if (ability >= STAR_ABILITY) return [Math.round(cap * STAR_FRACTION_LO), Math.round(cap * STAR_FRACTION_HI)];
  if (ability >= SOLID_ABILITY) return [Math.round(cap * SOLID_FRACTION_LO), Math.round(cap * SOLID_FRACTION_HI)];
  if (ability >= ROTATION_ABILITY) return [Math.round(cap * ROTATION_FRACTION_LO), Math.round(cap * ROTATION_FRACTION_HI)];
  // fringe: floor at the service-time minimum so nobody plays below scale
  const yos = clamp(age - YOS_ENTRY_AGE, 0, params.cba.minSalaryPctByYos.length - 1);
  return [Math.round(cap * params.cba.minSalaryPctByYos[yos]!), Math.round(cap * FRINGE_FRACTION_HI)];
}

interface PricedRow { salary: number; lo: number; hi: number; }

/**
 * Proportional-headroom payroll fitting: scale the priced salaries toward
 * the team target without breaking any per-player plausibility clamp.
 * Money stays integer dollars every pass. Targets are designed with more
 * slack than FIT_TOLERANCE against every league line, so a converged fit
 * can never strand a payroll outside [floor, apron2].
 */
function fitPayroll(rows: PricedRow[], target: number): void {
  for (let pass = 0; pass < FIT_PASSES; pass++) {
    let sum = 0;
    for (const r of rows) sum += r.salary;
    const diff = target - sum;
    if (Math.abs(diff) <= FIT_TOLERANCE) return;
    let headroom = 0;
    for (const r of rows) headroom += diff > 0 ? r.hi - r.salary : r.salary - r.lo;
    if (headroom <= 0) return; // clamps exhausted; targets are sized so this only trims the tolerance tail
    for (const r of rows) {
      const h = diff > 0 ? r.hi - r.salary : r.salary - r.lo;
      r.salary = Math.round(clamp(r.salary + diff * (h / headroom), r.lo, r.hi));
    }
  }
}

/** Standard multi-year deal: drawn length, one drawn raise trajectory, occasional last-year option. */
function standardYears(rng: Rng, start: number, season: Season, star: boolean, fringe: boolean): ContractYear[] {
  const len = 1 + rng.weighted(CONTRACT_LEN_WEIGHTS);
  const raise = rng.range(RAISE_LO, RAISE_HI);
  const years: ContractYear[] = [];
  for (let i = 0; i < len; i++) {
    const salary = Math.round(start * Math.pow(1 + raise, i));
    // fully guaranteed at genesis (register-style simplification: partial
    // guarantees enter the league through in-sim signings, not fiction)
    years.push({ season: season + i, salary, guaranteed: salary });
  }
  if (len >= 2) {
    if (star && rng.chance(STAR_PLAYER_OPTION_P)) years[len - 1]!.playerOption = true;
    else if (fringe && rng.chance(FRINGE_TEAM_OPTION_P)) years[len - 1]!.teamOption = true;
  }
  return years;
}

/** Remaining rookie-scale years for a player assumed drafted at ROOKIE_ENTRY_AGE. */
function rookieYears(rng: Rng, params: FranchiseParams, season: Season, age: number): ContractYear[] {
  const cap = params.cba.genesisCap;
  // where he notionally went in his (fictional) draft prices the scale;
  // clamped to the zero-service minimum because no contract may pay below
  // the applicable minimum salary (REAL)
  const notionalPick = rng.int(30);
  const start = Math.max(
    Math.round(cap * params.cba.minSalaryPctByYos[0]!),
    Math.round(cap * params.cba.rookieScalePick1PctOfCap * Math.pow(params.cba.rookieScaleDecay, notionalPick)),
  );
  const elapsed = clamp(age - ROOKIE_ENTRY_AGE, 0, ROOKIE_DEAL_YEARS - 1);
  const remaining = ROOKIE_DEAL_YEARS - elapsed;
  const years: ContractYear[] = [];
  for (let i = 0; i < remaining; i++) {
    const origIdx = elapsed + i; // index within the original 4-year scale deal
    const salary = Math.round(start * Math.pow(1 + ROOKIE_RAISE, origIdx));
    years.push({
      season: season + i,
      salary,
      guaranteed: salary,
      // REAL: scale years beyond params.cba.rookieScaleYears are team options
      ...(origIdx >= params.cba.rookieScaleYears ? { teamOption: true } : {}),
    });
  }
  return years;
}

function makeContract(playerId: PlayerId, teamId: TeamId, years: ContractYear[], kind: Contract['kind'], rng: Rng, season: Season, age: number): Contract {
  return {
    id: `c-${playerId}`, // player ids are league-unique, so contract ids inherit that
    playerId,
    teamId,
    years,
    kind,
    means: 'genesis', // genesis deals are fiction, never validated by the cba modules
    signedOn: { season: season - rng.int(SIGNED_AGO_SPAN), day: 0 },
    // plausible Bird continuity: some tenure, capped by career length
    birdYearsAtSigning: rng.int(clamp(age - 18, 1, 4)),
  };
}

function payrollTarget(rng: Rng, tier: Timeline, params: FranchiseParams): number {
  const cba = params.cba;
  const floor = Math.round(cba.genesisCap * cba.minPayrollPctOfCap);
  const u = rng.float();
  if (tier === 'rebuild') return Math.round(floor * (REBUILD_TARGET_LO + REBUILD_TARGET_SPREAD * u));
  if (tier === 'retool') {
    const lo = floor * MIDDLE_TARGET_LO;
    const hi = cba.genesisTax * MIDDLE_TARGET_HI;
    return Math.round(lo + (hi - lo) * u);
  }
  const lo = cba.genesisTax * CONTEND_TARGET_LO;
  const hi = Math.min(cba.genesisApron1 * CONTEND_APRON1_STRETCH, cba.genesisApron2 * CONTEND_APRON2_GUARD);
  return Math.round(lo + (hi - lo) * u);
}

// ---------------------------------------------------------------------------
// createLeague

/**
 * Build the whole league at day zero. Deterministic: same opts (seed
 * included) produce a deep-equal league. Throws on an unknown userTeam.
 * See the module header for what is and is not assembled here.
 */
export function createLeague(opts: CreateLeagueOpts): League {
  if (!FRANCHISES.some((f) => f.id === opts.userTeam)) {
    throw new Error(`createLeague: unknown userTeam '${opts.userTeam}' (valid ids live in teamdata.ts FRANCHISES)`);
  }
  const params = withFranchiseParams(opts.params);
  const season: Season = opts.startSeason ?? DEFAULT_START_SEASON;
  const cba = params.cba;

  // league-level draws: tier assignment and (after the team loop) the
  // free-agent pool. Per-team rosters use isolated 'genesis:team:<id>'
  // streams so a draw-count change in one team never reshuffles another.
  const master = streamRng(opts.seed, 'genesis');
  const shuffled = FRANCHISES.map((f) => f.id);
  master.shuffle(shuffled);
  const taxCount = TAX_TEAMS_MIN + master.int(TAX_TEAMS_SPREAD);
  const rebuildCount = REBUILD_TEAMS_MIN + master.int(REBUILD_TEAMS_SPREAD);
  const tiers = new Map<TeamId, Timeline>();
  shuffled.forEach((id, i) => {
    tiers.set(id, i < taxCount ? 'contend' : i >= shuffled.length - rebuildCount ? 'rebuild' : 'retool');
  });

  const players: Record<PlayerId, FrPlayer> = {};
  const teams: Record<TeamId, FrTeam> = {};
  const usedNames = new Set<string>();
  let seq = 1; // 'p' + zero-padded sequence, continued later by generateDraftClass

  for (let i = 0; i < FRANCHISES.length; i++) {
    const f = FRANCHISES[i]!;
    const tier = tiers.get(f.id)!;
    const rng = streamRng(opts.seed, 'genesis', 'team', f.id);

    // fixed per-team draw order: target, size, plan, players, two-ways,
    // pricing, contract shapes, front office
    const target = payrollTarget(rng, tier, params);
    const rosterSize = rng.chance(ROSTER_FULL_P) ? cba.rosterMax : cba.rosterMin;
    const plan = planRoster(rng, tier, rosterSize, params);

    const roster: FrPlayer[] = [];
    for (const slot of plan) {
      const p = generatePlayer(rng, { age: slot.age, season, quality: slot.quality, idSeq: seq++, params });
      ensureUniqueName(rng, p, usedNames);
      p.status = 'roster';
      players[p.id] = p;
      roster.push(p);
    }

    // 0-2 two-way players: young fringe pros on the roster's edge
    const twoWayCount = rng.int(TWO_WAY_MAX + 1);
    const twoWays: FrPlayer[] = [];
    for (let w = 0; w < twoWayCount; w++) {
      const age = clamp(Math.round(rng.gaussian(21.5, 1.2)), 19, 23); // FEEL: two-ways are development-age
      const quality = clamp(rng.gaussian(36, 6), Q_SLOT_LO, 48);      // FEEL: below every standard-roster slot
      const p = generatePlayer(rng, { age, season, quality, idSeq: seq++, params });
      ensureUniqueName(rng, p, usedNames);
      p.status = 'roster'; // two-ways dress subject to the game limit (gameday.ts healthyPool)
      players[p.id] = p;
      twoWays.push(p);
    }

    // price the standard roster: rookie-scale money is fixed by the scale,
    // everyone else is fitted toward the team's payroll target
    const priced: Array<{ p: FrPlayer; row: PricedRow; rookie: boolean; ability: number }> = [];
    let rookieSum = 0;
    for (const p of roster) {
      const age = season - p.bornSeason;
      const ability = abilityMean(p);
      if (age <= 22) { // FEEL: 22 and under are still on rookie-scale paper at genesis
        const years = rookieYears(rng, params, season, age);
        p.contract = makeContract(p.id, f.id, years, 'rookieScale', rng, season, age);
        rookieSum += years[0]!.salary;
        priced.push({ p, row: { salary: years[0]!.salary, lo: 0, hi: 0 }, rookie: true, ability });
      } else {
        const [lo, hi] = salaryBounds(ability, age, params);
        const salary = Math.round(clamp(cba.genesisCap * salaryFraction(rng, ability), lo, hi));
        priced.push({ p, row: { salary, lo, hi }, rookie: false, ability });
      }
    }
    const standardRows = priced.filter((r) => !r.rookie).map((r) => r.row);
    fitPayroll(standardRows, target - rookieSum);
    // floor rescue: when the plausibility ceilings strand a rookie-heavy
    // sheet under the 90% floor, relax standard deals toward the rescue
    // ceiling and refit - the real league meets its floor with bad money too
    const fitted = rookieSum + standardRows.reduce((s, r) => s + r.salary, 0);
    const floorLine = Math.round(cba.genesisCap * cba.minPayrollPctOfCap);
    if (fitted < floorLine) {
      const rescueHi = Math.round(cba.genesisCap * RESCUE_FRACTION_HI);
      for (const r of standardRows) r.hi = Math.max(r.hi, rescueHi);
      fitPayroll(standardRows, target - rookieSum);
    }
    for (const r of priced) {
      if (r.rookie) continue;
      const age = season - r.p.bornSeason;
      const years = standardYears(rng, r.row.salary, season, r.ability >= STAR_ABILITY, r.ability < ROTATION_ABILITY);
      r.p.contract = makeContract(r.p.id, f.id, years, 'standard', rng, season, age);
    }

    // two-way deals: half the rookie minimum, off the cap (cba/cap.ts skips team.twoWay)
    const twoWaySalary = Math.round(cba.genesisCap * cba.minSalaryPctByYos[0]! * cba.twoWaySalaryPctOfRookieMin);
    for (const p of twoWays) {
      const age = season - p.bornSeason;
      const years: ContractYear[] = [];
      const len = 1 + rng.int(2); // FEEL: 1-2 year two-way deals
      for (let y = 0; y < len; y++) years.push({ season: season + y, salary: twoWaySalary, guaranteed: twoWaySalary });
      p.contract = makeContract(p.id, f.id, years, 'twoWay', rng, season, age);
      p.twoWayGamesUsed = 0;
    }

    // starters: best five by the generation modules' crude ability mean.
    // ai/roster.ts's depthChart is the league's real depth source once the
    // ai-team task lands; this ordering only seeds day zero (noted in the
    // genesis task report).
    const starters = roster
      .slice()
      .sort((a, b) => (abilityMean(b) - abilityMean(a)) || (a.id < b.id ? -1 : 1))
      .slice(0, 5)
      .map((p) => p.id);

    // own 1st + 2nd round picks, PICK_HORIZON seasons out
    const picks: DraftPick[] = [];
    for (let s = 0; s < PICK_HORIZON; s++) {
      for (const round of [1, 2] as const) {
        picks.push({
          id: `${season + s}-r${round}-${f.id}`, // PickId convention (types.ts)
          season: season + s,
          round,
          originalTeam: f.id,
          owner: f.id,
        });
      }
    }

    // front office: owner, GM persona (user team runs its own front
    // office), coach stamped with the genesis date
    const ownerName = generateName(rng); // owners draw from the same era-neutral pools; only first/last are used
    const appetite = tier === 'contend' ? OWNER_TAX_APPETITE_CONTEND : OWNER_TAX_APPETITE_OTHER;
    const owner: Owner = {
      name: `${ownerName.first} ${ownerName.last}`,
      taxAppetite: Math.round(rng.range(appetite[0], appetite[1])),
      patience: Math.round(rng.range(OWNER_PATIENCE[0], OWNER_PATIENCE[1])),
      expectation: tier === 'contend'
        ? rng.pick(['title', 'contend'] as const)
        : tier === 'rebuild'
          ? rng.pick(['develop', 'rebuild'] as const)
          : rng.pick(['playoffs', 'playin'] as const),
    };
    const gm = f.id === opts.userTeam ? null : { ...generatePersona(rng), timeline: tier };
    const coach = { ...generateCoach(rng, i), hiredOn: { season, day: 0 } };

    teams[f.id] = {
      id: f.id,
      city: f.city,
      name: f.name,
      abbrev: f.abbrev,
      conference: f.conference,
      division: f.division,
      colors: f.colors,
      arena: f.arena,
      founded: season,
      owner,
      gm,
      coach,
      roster: roster.map((p) => p.id),
      twoWay: twoWays.map((p) => p.id),
      rotation: {
        minutes: {}, // coach decides until a policy is set (types.ts RotationPolicy)
        starters,
        b2bRestBelow: params.rotation.b2bRestBelow,
        scratches: [],
      },
      picks,
      taxSeasonsRecent: [], // repeater clocks start at zero: the sim earns its tax history
      scoutSeed: rng.int(2147483647), // 2^31 - 1: persistent per-team scouting error root (scouting.ts)
      strategy: { timeline: tier, untouchables: [] },
    };
  }

  // the unsigned veteran market: fringe-to-rotation vets on nobody's books.
  // rights are null by genesis fiction - every prior team renounced, Bird
  // continuity starts fresh with in-sim signings.
  const freeAgents: PlayerId[] = [];
  const faCount = FA_COUNT_BASE + master.int(FA_COUNT_SPREAD);
  for (let i = 0; i < faCount; i++) {
    const age = clamp(Math.round(master.gaussian(FA_AGE_MEAN, FA_AGE_SD)), FA_AGE_LO, FA_AGE_HI);
    const quality = clamp(master.gaussian(FA_QUALITY_MEAN, FA_QUALITY_SD), FA_QUALITY_LO, FA_QUALITY_HI);
    const p = generatePlayer(master, { age, season, quality, idSeq: seq++, params });
    ensureUniqueName(master, p, usedNames);
    p.status = 'freeAgent';
    players[p.id] = p;
    freeAgents.push(p.id);
  }

  return {
    seed: opts.seed,
    params,
    season,
    startSeason: season,
    day: 0,
    phase: 'camp', // what phaseOn reads from an empty calendar (calendar.ts)
    calendar: [],  // lazy-initialized by tick.ts on first advance (module header)
    userTeam: opts.userTeam,
    teams,
    players,
    schedule: [],  // lazy-initialized alongside the calendar
    results: {},
    standings: {}, // advanceDay seeds empty rows for every team
    playoffs: [],
    playin: [],
    lottery: null,
    draftClass: [], // first class generated at the lottery (tick.ts)
    scouting: {},
    freeAgents,
    offerSheets: [],
    waiverWire: [],
    negotiations: [],
    transactions: [],
    news: [],
    inbox: [],
    awards: [],
    records: [],
    archives: [],
    deadMoney: {},
    capLines: {
      [season]: {
        cap: cba.genesisCap,
        tax: cba.genesisTax,
        apron1: cba.genesisApron1,
        apron2: cba.genesisApron2,
        // REAL: the payroll floor is 90% of cap; rounded because money is integer dollars
        minSalaryFloor: Math.round(cba.genesisCap * cba.minPayrollPctOfCap),
      },
    },
    actionLog: [],
    actionSeq: 0,
  };
}
