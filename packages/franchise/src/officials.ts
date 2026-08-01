/**
 * officials.ts - referee crews. OWNER: officiating task.
 *
 * The league employs a fixed pool of named three-man crews, generated once
 * at genesis and stored on the league (League.officials). Every scheduled
 * game gets a crew, assigned deterministically per game day. Crews carry
 * persistent tendencies and those tendencies have a SMALL, bounded, honest
 * mechanical influence that flows only through the engine's public inputs:
 *
 *  - tightness  -> a symmetric relative nudge on the engine's shooting-foul
 *    zone probabilities (params.foul.shoot*), passed per game through
 *    GameConfig.params (sim/game.ts merges it with withParams). Both teams
 *    see the same whistle; only free-throw VOLUME moves, never who it
 *    favors. Hard-capped at +-FOUL_SWING_CAP relative.
 *  - homeLean   -> a small extra road-team execution debuff (or shave, for
 *    a road-friendly crew) riding the existing projectTeam HCA seam.
 *    Hard-capped at +-LEAN_DEBUFF_CAP rating points, a fraction of the
 *    baseline params.hca.roadAttrDebuff.
 *  - consistency -> deterministic per-game jitter on the crew's own
 *    tightness application; a low-consistency crew is a different whistle
 *    night to night, inside the same hard caps.
 *
 * HONESTY LAW: nothing here touches results after simulation. If a bias
 * cannot flow through simulateGame's public inputs it does not exist
 * mechanically (see INTEGRATION-officials.md register notes). No post-hoc
 * box score edits, ever.
 *
 * Determinism: every draw uses registered streams (rng.ts):
 *   officials:crews           crew pool generation (genesis)
 *   officials:<season>:<day>  per-day crew assignment shuffle
 *   officials:game:<gameId>   per-game tightness jitter
 * Assignment is a pure function of (seed, season, day, the day's sorted
 * game ids, crew count): calling it from any site in any order gives the
 * same crew for the same game.
 *
 * Graceful absence: a league without League.officials (fixture leagues,
 * saves from before this feature) gets null crews, zero deltas, and no
 * params overrides - game results are byte-identical to the pre-officials
 * pipeline.
 */
import { defaultParams } from '@hoopsh/engine';
import type { GameConfig } from '@hoopsh/engine';
import type {
  GameId, GameRecord, League, NewsItem, ScheduledGame, Season,
} from './types.js';
import type { FranchiseParams } from './params.js';
import { streamRng } from './rng.js';
import { personName } from './people/names.js';

/**
 * Mirrors media/recap.ts WIRE, deliberately NOT imported: recap.ts imports
 * officialsRecapLine from this module (INTEGRATION-officials.md), and a
 * WIRE import back would make the modules a cycle. The voice name is a
 * frozen media contract; if it ever changes, change it in both places.
 */
const OFFICIALS_BYLINE = 'Association Wire';

// ---------------------------------------------------------------------------
// shapes

/** One three-man crew. names[0] is the crew chief; recaps read all three. */
export interface RefCrew {
  id: string;
  /** surnames only, chief first ('Foster', not 'Scott Foster') */
  names: [string, string, string];
  /** 0-100 whistle frequency: 100 calls everything, 0 lets them play */
  tightness: number;
  /** 0-100 home protection: 50 neutral, 100 rides the crowd, 0 road-friendly */
  homeLean: number;
  /** 0-100 night-to-night stability: 100 is the same whistle every night */
  consistency: number;
}

/** What League.officials stores. A wrapper object so the pool can grow fields later. */
export interface OfficialsState {
  crews: RefCrew[];
}

/** Crew snapshot stamped on a GameRecord (surnames survive pool changes). */
export interface GameOfficials {
  crewId: string;
  crew: [string, string, string];
}

/** The officials section of FranchiseParams (params.ts integration patch mirrors this). */
export interface OfficialsParams {
  /** crews in the league pool */
  crewCount: number;                // FEEL 20: ~70 real NBA referees make ~23 crews; 20 keeps names learnable
  /** max relative swing on the engine's shooting-foul zone params at tightness 0/100 */
  tightnessFoulSwing: number;       // CAL 0.10: at the hard cap; sweeps may only lower it
  /** max extra road-team attr debuff (rating points) at homeLean 100; negative mirror at 0 */
  leanRoadDebuffMax: number;        // CAL 0.8: ~1/3 of params.hca.roadAttrDebuff 2.2, flavor not fate
  /** tightness points of per-game jitter at consistency 0 (0 at consistency 100) */
  tightnessJitter: number;          // CAL 12: a sloppy crew wanders about one quartile night to night
}

// ---------------------------------------------------------------------------
// caps and defaults (structural conventions, same category as gameday.ts's
// projection constants; the CAL magnitudes above are the sweepable levers)

const FOUL_SWING_CAP = 0.10;   // FEEL: referees flavor outcomes, they do not decide seasons; +-10% relative is the wall
const LEAN_DEBUFF_CAP = 1.1;   // FEEL: half the default HCA debuff; a crew never outweighs the building itself
const JITTER_CAP = 20;         // FEEL: even the league's flakiest crew stays recognizably itself
const CREW_COUNT_MIN = 4;      // FEEL: below this "assignment" is theater; guards degenerate custom params
const CREW_COUNT_MAX = 32;     // FEEL: a pool nobody could name is no pool at all
const NAME_REROLLS = 40;       // FEEL: surname-collision re-rolls before accepting a duplicate (never brick genesis over a name)

// tendency sampling (crew personalities; FEEL, shaped like a real staff:
// most crews near league norm, real outliers on both ends)
const TIGHTNESS_MEAN = 50;
const TIGHTNESS_SD = 16;
const LEAN_MEAN = 50;
const LEAN_SD = 14;
const CONSISTENCY_MEAN = 62;   // FEEL: professionals mostly repeat their own whistle
const CONSISTENCY_SD = 15;
const TENDENCY_LO = 5;         // FEEL: clamps keep every crew inside the working range
const TENDENCY_HI = 95;

// visibility thresholds, calibrated to THIS engine's whistle texture, not
// to real NBA figures (the sim runs hotter: patched-pipeline probe
// 2026-08-01, n=66 league games, combined FTA mean ~50, p10 36, p90 66;
// the inherited real-keyed bands fired the tight line on 27% of nights
// and the quiet line on none)
const TIGHT_NIGHT_FTA = 66;    // FEEL: ~top decile of combined-FTA nights reads as a parade
const QUIET_NIGHT_FTA = 36;    // FEEL: ~bottom decile reads as a swallowed whistle
const NOTORIOUS_DELTA = 25;    // FEEL: |tightness-50| >= 25 is a crew with a reputation
const OUTLIER_TIGHT_FTA = 70;  // FEEL: the news desk needs more than the recap does (~top 2% of nights)
const OUTLIER_QUIET_FTA = 32;  // FEEL: ~bottom 3%

export const DEFAULT_OFFICIALS_PARAMS: OfficialsParams = {
  crewCount: 20,
  tightnessFoulSwing: 0.10,
  leanRoadDebuffMax: 0.8,
  tightnessJitter: 12,
};

/** A stored override if it is a usable number, else the shipped default. */
function numOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Read the officials params off the league, tolerating their absence (the
 * params.ts section lands by integration patch; old saves and fixture
 * leagues predate it), backfilling non-finite hand edits, and clamping
 * every magnitude to its hard cap so no sweep or hand edit can turn
 * referees into a season-deciding force.
 */
export function officialsParamsOf(league: League): OfficialsParams {
  const stored = (league.params as FranchiseParams & { officials?: Partial<OfficialsParams> }).officials;
  const d = DEFAULT_OFFICIALS_PARAMS;
  return {
    crewCount: Math.max(CREW_COUNT_MIN, Math.min(CREW_COUNT_MAX, Math.round(numOr(stored?.crewCount, d.crewCount)))),
    tightnessFoulSwing: Math.max(0, Math.min(FOUL_SWING_CAP, numOr(stored?.tightnessFoulSwing, d.tightnessFoulSwing))),
    leanRoadDebuffMax: Math.max(0, Math.min(LEAN_DEBUFF_CAP, numOr(stored?.leanRoadDebuffMax, d.leanRoadDebuffMax))),
    tightnessJitter: Math.max(0, Math.min(JITTER_CAP, numOr(stored?.tightnessJitter, d.tightnessJitter))),
  };
}

// ---------------------------------------------------------------------------
// crew pool (genesis)

function clampRound(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * Generate the league's crew pool. Called from genesis with the league
 * seed and the (possibly overridden) FranchiseParams; deterministic per
 * seed. Surnames come from the shared name pools (people/names.ts), so
 * officials read like they belong to the same world as the players.
 * Per-crew draw order is fixed: three surnames, then the three tendencies.
 */
export function initOfficials(
  seed: string,
  params?: { officials?: Partial<OfficialsParams> },
): OfficialsState {
  const count = clampRound(
    numOr(params?.officials?.crewCount, DEFAULT_OFFICIALS_PARAMS.crewCount),
    CREW_COUNT_MIN, CREW_COUNT_MAX,
  );
  const rng = streamRng(seed, 'officials', 'crews');
  const usedChiefs = new Set<string>();
  const crews: RefCrew[] = [];
  for (let i = 0; i < count; i++) {
    const names: string[] = [];
    for (let slot = 0; slot < 3; slot++) {
      let last = personName(rng, 'official').last;
      // chiefs unique league-wide, all three unique within the crew; accept
      // a collision only after bounded re-rolls (never throw over a name)
      for (let tries = 0; tries < NAME_REROLLS; tries++) {
        const clash = names.includes(last) || (slot === 0 && usedChiefs.has(last));
        if (!clash) break;
        last = personName(rng, 'official').last;
      }
      names.push(last);
    }
    usedChiefs.add(names[0]!);
    crews.push({
      id: `crew-${String(i + 1).padStart(2, '0')}`,
      names: names as [string, string, string],
      tightness: clampRound(rng.gaussian(TIGHTNESS_MEAN, TIGHTNESS_SD), TENDENCY_LO, TENDENCY_HI),
      homeLean: clampRound(rng.gaussian(LEAN_MEAN, LEAN_SD), TENDENCY_LO, TENDENCY_HI),
      consistency: clampRound(rng.gaussian(CONSISTENCY_MEAN, CONSISTENCY_SD), TENDENCY_LO, TENDENCY_HI),
    });
  }
  return { crews };
}

// ---------------------------------------------------------------------------
// assignment

/**
 * League.officials, read through a tolerant cast: the types.ts field lands
 * by integration patch, and this module must compile and no-op cleanly
 * against the frozen shapes (fixture leagues, pre-officials saves). After
 * the patch the cast is a no-op widening.
 */
export function officialsStateOf(league: League): OfficialsState | null {
  const state = (league as League & { officials?: OfficialsState }).officials;
  return state && state.crews.length > 0 ? state : null;
}

/** GameRecord.officials through the same tolerant cast (types.ts patch pending). */
function stampOf(record: GameRecord): GameOfficials | undefined {
  return (record as GameRecord & { officials?: GameOfficials }).officials;
}

/** The scheduled entry for a game id, searching the season slate and the play-in. */
function scheduledGame(league: League, gameId: GameId): ScheduledGame | null {
  return league.schedule.find((g) => g.id === gameId)
    ?? league.playin.find((g) => g.id === gameId)
    ?? null;
}

/** Sorted unique game ids on one calendar day (planDayJobs's ordering rule). */
function gamesOn(league: League, season: Season, day: number): GameId[] {
  const seen = new Set<GameId>();
  const ids: GameId[] = [];
  for (const g of [...league.schedule, ...league.playin]) {
    if (g.date.season !== season || g.date.day !== day || seen.has(g.id)) continue;
    seen.add(g.id);
    ids.push(g.id);
  }
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ids;
}

/**
 * Deterministic crew assignment for one game day: Fisher-Yates over the
 * crew indices with the day's registered stream, zipped against the day's
 * sorted game ids. No crew works twice in a night while the pool covers
 * the slate (a 20-crew pool covers the NBA's 15-game maximum; the modulo
 * is a guard for degenerate custom leagues). Balance over a season comes
 * from the shuffle being fresh each day: every crew's expected load is
 * identical by symmetry.
 */
export function dayAssignments(
  league: League, season: Season, day: number,
): Array<{ gameId: GameId; crewId: string }> {
  const state = officialsStateOf(league);
  if (!state) return [];
  const ids = gamesOn(league, season, day);
  if (ids.length === 0) return [];
  const rng = streamRng(league.seed, 'officials', season, day);
  const perm = state.crews.map((_, i) => i);
  for (let i = perm.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = perm[i]!; perm[i] = perm[j]!; perm[j] = t;
  }
  return ids.map((gameId, i) => ({
    gameId,
    crewId: state.crews[perm[i % perm.length]!]!.id,
  }));
}

/**
 * The crew working one game, or null (no officials on the league, or the
 * game is not on the books). Pure and order-independent: derives the whole
 * day's assignment and picks this game's row.
 */
export function crewForGame(league: League, gameId: GameId): RefCrew | null {
  const state = officialsStateOf(league);
  if (!state) return null;
  const sched = scheduledGame(league, gameId);
  if (!sched) return null;
  const row = dayAssignments(league, sched.date.season, sched.date.day)
    .find((a) => a.gameId === gameId);
  if (!row) return null;
  return state.crews.find((c) => c.id === row.crewId) ?? null;
}

// ---------------------------------------------------------------------------
// mechanical influence (bounded; every path flows through a legal engine input)

/**
 * The crew's effective tightness for one game: the persistent tendency
 * plus consistency-scaled jitter from the game's registered stream. A
 * consistency-100 crew jitters zero; a consistency-0 crew wanders up to
 * +-tightnessJitter points. Clamped to 0-100, which is what makes every
 * downstream swing provably capped.
 */
export function gameTightness(league: League, gameId: GameId, crew: RefCrew): number {
  const p = officialsParamsOf(league);
  const rng = streamRng(league.seed, 'officials', 'game', gameId);
  const wobble = (1 - crew.consistency / 100) * p.tightnessJitter * (2 * rng.float() - 1);
  return Math.max(0, Math.min(100, crew.tightness + wobble));
}

/**
 * Home-lean influence: the EXTRA road-team execution debuff (rating
 * points) under this game's crew. Positive under a crowd-riding crew,
 * negative (a shave of the baseline HCA debuff) under a road-friendly one,
 * zero for the home side, a neutral crew, or a league without officials.
 * Bounded by construction: |delta| <= leanRoadDebuffMax <= LEAN_DEBUFF_CAP.
 * Pure read; gameday's projectTeam adds it inside the existing
 * HCA_OFFENSE_KEYS pre-degrade (INTEGRATION-officials.md patch 5).
 */
export function crewAttrDelta(league: League, gameId: GameId, isHome: boolean): number {
  if (isHome) return 0;
  const crew = crewForGame(league, gameId);
  if (!crew) return 0;
  const p = officialsParamsOf(league);
  const lean = (crew.homeLean - 50) / 50; // -1..1
  const delta = p.leanRoadDebuffMax * lean;
  return Math.max(-p.leanRoadDebuffMax, Math.min(p.leanRoadDebuffMax, delta));
}

/**
 * Tightness influence: a per-game SimParams override for simulateGame's
 * public `params` input, scaling the four shooting-foul zone probabilities
 * by one symmetric relative multiplier. Both teams shoot more (or fewer)
 * free throws under the same whistle; nothing else moves. Multiplier is
 * hard-capped inside [1 - FOUL_SWING_CAP, 1 + FOUL_SWING_CAP].
 * Returns undefined when the game has no crew (job then carries no
 * override and the engine runs its stock params, byte-identical).
 */
export function officiatingParamsFor(league: League, gameId: GameId): NonNullable<GameConfig['params']> | undefined {
  const crew = crewForGame(league, gameId);
  if (!crew) return undefined;
  const p = officialsParamsOf(league);
  const t = gameTightness(league, gameId, crew);
  const raw = 1 + p.tightnessFoulSwing * ((t - 50) / 50);
  const mult = Math.max(1 - FOUL_SWING_CAP, Math.min(1 + FOUL_SWING_CAP, raw));
  const foul = defaultParams.foul;
  return {
    foul: {
      shootRim: foul.shootRim * mult,
      shootPaint: foul.shootPaint * mult,
      shootMid: foul.shootMid * mult,
      shootThree: foul.shootThree * mult,
    },
  };
}

/**
 * Spreadable job fields for planDayJobs (`...officialsJobExtras(league, id)`):
 * the params override when a crew exists, nothing otherwise. Plain numbers
 * only, so GameJob stays structured-clone-safe across the worker boundary.
 */
export function officialsJobExtras(league: League, gameId: GameId): { params?: NonNullable<GameConfig['params']> } {
  const params = officiatingParamsFor(league, gameId);
  return params ? { params } : {};
}

// ---------------------------------------------------------------------------
// visibility

/**
 * Spreadable record fields for applyGameResults's GameRecord literal
 * (`...officialsStamp(league, id)`): the crew id plus a surname snapshot,
 * so history and recaps survive any future pool change.
 */
export function officialsStamp(league: League, gameId: GameId): { officials?: GameOfficials } {
  const crew = crewForGame(league, gameId);
  if (!crew) return {};
  return { officials: { crewId: crew.id, crew: [...crew.names] as [string, string, string] } };
}

/**
 * The recap's crew sentence: always names the crew, and on an outlier
 * whistle night says so in the wire's dry voice. Null when the record has
 * no crew (pre-officials saves, fixture leagues). Prose law: short plain
 * sentences, no exclamation marks, no em dashes.
 */
export function officialsRecapLine(league: League, record: GameRecord): string | null {
  const crew = stampOf(record) ?? officialsStamp(league, record.id).officials;
  if (!crew) return null;
  const base = `Crew: ${crew.crew.join(', ')}.`;
  const fta = record.totals[0].fta + record.totals[1].fta;
  if (fta >= TIGHT_NIGHT_FTA) return `${base} The whistle was tight all night. The teams combined for ${fta} free throws.`;
  if (fta <= QUIET_NIGHT_FTA) return `${base} The whistle stayed quiet. ${fta} free throws between both sides.`;
  return base;
}

/**
 * Rare news beat: when a NOTORIOUS crew (tightness far from league norm)
 * has an outlier free-throw night that matches its reputation, the wire
 * notes it. At most one item per day, keyed to the lowest game id, weight
 * 1 (a brief, never the front page). Dedup rides tick.ts's appendNews id
 * guard. Returns [] for leagues without officials.
 */
export function officialsNewsFor(league: League, records: GameRecord[]): NewsItem[] {
  const state = officialsStateOf(league);
  if (!state) return [];
  const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const record of sorted) {
    const stamp = stampOf(record) ?? officialsStamp(league, record.id).officials;
    if (!stamp) continue;
    const crew = state.crews.find((c) => c.id === stamp.crewId);
    if (!crew || Math.abs(crew.tightness - 50) < NOTORIOUS_DELTA) continue;
    const fta = record.totals[0].fta + record.totals[1].fta;
    const tightNight = crew.tightness > 50 && fta >= OUTLIER_TIGHT_FTA;
    const quietNight = crew.tightness < 50 && fta <= OUTLIER_QUIET_FTA;
    if (!tightNight && !quietNight) continue;
    const home = league.teams[record.home];
    const away = league.teams[record.away];
    const hName = home ? home.name : record.home;
    const aName = away ? away.name : record.away;
    const chief = crew.names[0];
    const headline = tightNight
      ? `${fta} free throws on the ${chief} crew's watch`
      : `The ${chief} crew swallowed the whistle`;
    const body = tightNight
      ? `${hName} and ${aName} combined for ${fta} free throw attempts. The ${chief} crew calls it tight. The reputation held up.`
      : `${hName} and ${aName} shot ${fta} free throws combined. The ${chief} crew lets them play. Nobody at the arena was surprised.`;
    return [{
      id: `n-${record.id}-crew`,
      date: record.date,
      type: 'feature',
      headline,
      body,
      byline: OFFICIALS_BYLINE,
      players: [],
      teams: [record.home, record.away],
      gameId: record.id,
      weight: 1,
    }];
  }
  return [];
}
