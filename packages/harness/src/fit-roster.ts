/**
 * STATS → RATINGS inversion: fit a full 38-dial player profile (24 attributes
 * + 14 tendencies, model/player.ts) from a real season box-score line, then
 * emit a validated TeamPack (data/schema.ts).
 *
 * Run: npm run rosters:fit -- --in data/nba/example-stars.season.json
 *        [--out out/fitted] [--iters 8] [--cands 2] [--games 4]
 *        [--no-refine] [--compare-fixtures] [--seed fit]
 *      npm run rosters:fit -- --benchmarks     (fidelity-fixture validation)
 *
 * ── THE TWO LAYERS ─────────────────────────────────────────────────────────
 *
 * 1. ANALYTIC PRIORS (analyticFit): every dial with a box-score signal is set
 *    by an EXPLICIT, documented formula — most by inverting the engine's own
 *    forward models (the same algebra resolve.ts runs forward):
 *      FT%  -> attr.freeThrow   exact inverse of freeThrowP's piecewise curve
 *      3P%  -> attr.three       inverse of the three-point make logit at a
 *                               reference shot mix (see REFERENCE MODEL below)
 *      2P%  -> finishing/midRange  zone make logits at league-anchored zone %s
 *      FTA rate -> attr.drawFoul   inverse of shootingFoulP's draw multiplier
 *      USG% -> tend.usage       the dial IS a USG% scale (decide.ts:115)
 *      shares of FGA -> shotRim/shotMid/shotThree  ratio-vs-league model
 *      AST, AST/TOV -> passVision/passAcc/passOut  calibrated-linear anchors
 *      ORB/DRB -> offReb/defReb/boxout             calibrated-linear anchors
 *      STL/BLK -> steal/block (+ gambleSteal)      calibrated-linear anchors
 *    "Calibrated-linear" constants cannot come from clean algebra (those stats
 *    emerge from many interacting mechanisms), so each is anchored on fixed
 *    points stated in its comment: the league-average player must land at the
 *    engine's default dial value, and the three fidelity fixtures
 *    (harness/src/fidelity.ts: Curry/LeBron/Jokić) must land near their
 *    hand-built values. An unexplained coefficient in this layer is a bug.
 *
 * 2. BOUNDED REFINEMENT (refineFit): simulate the fitted player in a
 *    league-neutral host team (solve.ts convention), compare the produced
 *    season-scale line to the input targets, and hill-climb a small dial
 *    subset with common random numbers. Bounded twice over:
 *      - TRUST REGION: no searched dial may drift more than ±TRUST_REGION
 *        from its analytic value — the explainable layer stays primary and
 *        refinement only absorbs interaction effects the algebra can't see
 *        (usage competition, contest economies, help rotations).
 *      - COMPUTE BUDGET (hard-enforced): ≤ MAX_GAMES_PER_ITER simulated games
 *        per refinement iteration and ≤ MAX_ITERS iterations per player.
 *
 * ── INPUT FORMAT: the season-line JSON schema ──────────────────────────────
 *
 * A *.season.json file (see data/nba/example-*.season.json):
 * {
 *   "kind": "season-lines",              // required discriminator
 *   "provenance": "<where these numbers came from>",   // required, honest
 *   "team": { "id": "gsw", "name": "...", "abbrev": "GSW" },  // optional
 *   "players": [ {
 *     "name": "Stephen Curry",           // required
 *     "pos": "PG",                       // required: PG|SG|SF|PF|C
 *     "heightIn": 74, "weightLb": 185,   // required (wingspanIn optional)
 *     "mpg": 34.2,                       // required: minutes per game
 *     "pts": 30.1, "reb": 5.4, "ast": 6.7,       // required per-game
 *     "stl": 2.1, "blk": 0.2, "tov": 3.3,        // required per-game
 *     "fga": 20.2, "fgPct": 0.504,               // required (pct as 0..1)
 *     "tpa": 11.2, "tpPct": 0.454,               // required (0s if none)
 *     "fta": 5.1,  "ftPct": 0.908,               // required
 *     "orb": 0.9,                        // optional: off. boards per game
 *     "pf": 2.0,                         // optional: fouls per game
 *     "shotZones": { "rimShare2": 0.45, "midShare2": 0.35 },  // optional:
 *                                        // shares of TWO-point attempts
 *     "fixtureId": "fid-curry"           // optional: compare vs fidelity.ts
 *   } ]
 * }
 * All percentages are decimals (0.454, not 45.4). All counting stats are
 * per-game averages. Missing optional fields fall back to position priors.
 *
 * ── DIALS THAT CANNOT BE INFERRED FROM A BOX LINE (the gap list) ───────────
 *
 * These come from the position archetype template (or a flat default) and are
 * labeled source "template" in the report. This list is a feature, not an
 * apology — a box line simply does not contain this information:
 *   attr.perimeterD / interiorD / contestSkill — defensive craft. STL/BLK are
 *     weak proxies (gamblers ≠ stoppers); real inference needs matchup or
 *     on/off data. Template + a small steal/block nudge only.
 *   attr.speed / accel / lateral / vertical — athleticism. Body + position
 *     priors only; combine/tracking data would identify them.
 *   attr.decisions — shot-selection IQ. AST/TOV sees ball-security IQ, not
 *     shot-diet IQ (a chucker with safe passes scores high). Partial signal.
 *   attr.consistency — STAGED dial (variance model): a season AVERAGE carries
 *     zero information about game-to-game variance. Flat 60.
 *   tend.offBallMotion — relocation appetite. Invisible in a box line (a
 *     spot-up corner statue and a Curry-grade relocator can share a line);
 *     needs tracking data. Weak catch-and-shoot-share proxy.
 *   tend.pushPace — STAGED dial; pace preference isn't in a player line.
 *     Position prior.
 *   tend.iso / post — play-type mix. Approximated from usage/position/shot
 *     mix; real identification needs play-type (Synergy-style) data.
 *   tend.foulAggr — defaults near neutral unless `pf` is provided.
 *   wingspanIn — pass through if provided; never guessed.
 *
 * Solved profiles are CONTEXT-RELATIVE (same caveat as solve.ts): the
 * refinement embeds the player in a league-neutral cast; a profile fitted
 * here will drift on a very different roster. That is basketball, not a bug.
 *
 * ── MAP OF THE FILE: the 11 `── section ──` banners, in order ──────────────
 *   input schema          SeasonLine + validateSeasonLines (the *.season.json contract)
 *   position priors       POS table: per-position anchors the formulas lean on
 *   derived rates         season line -> usage/shares/rates (deriveRates)
 *   REFERENCE MODEL       engine-derived logits the inversions run backwards
 *   forward models        re-exports for the round-trip tests
 *   analytic inversions   the invert* family (FT%, 3P%, 2P%, FTA rate)
 *   the analytic fit      layer 1: analyticFit — 38 dials, each with provenance
 *   layer 2: refinement   budgets, scoreLine, hostTeam, refineFit (CRN hill-climb)
 *   team pack assembly    assembleTeamPack: fitted players -> valid TeamPack
 *   fixture comparison    diff a fit against the hand-built fidelity fixtures
 *   CLI                   file I/O + flags; everything above is importable pure logic
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  Rng, clamp, defaultParams, makePlayer, sigmoid,
  type Player, type Position, type Team
} from '@hoopsh/engine';
import {
  benchBig, benchScorer, comboGuard, glueForward, postAnchor, rimRunner,
  scoringWing, threeAndD, toTeamPack, validateTeamPack, type TeamPack
} from '@hoopsh/data';
import { runBenchmark, BENCHMARKS, type AggLine } from './fidelity.js';
import { checkFlags, flagNumber, flagValue } from './args.js';

// ───────────────────────────────────────────────────────────── input schema

export interface ShotZoneSplits {
  /** share of TWO-point attempts taken at the rim (0..1) */
  rimShare2: number;
  /** share of TWO-point attempts from mid-range (0..1); paint gets the rest */
  midShare2: number;
}

export interface SeasonLine {
  name: string;
  pos: Position;
  heightIn: number;
  weightLb: number;
  wingspanIn?: number;
  mpg: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fga: number;
  fgPct: number;
  tpa: number;
  tpPct: number;
  fta: number;
  ftPct: number;
  orb?: number;
  pf?: number;
  /** made dunks per game (bbref shooting table fg_dunk / games) — drives the
   *  vertical floor so real dunkers clear the dunk-call athlete gate */
  dunks?: number;
  shotZones?: ShotZoneSplits;
  /** optional id of a fidelity.ts benchmark fixture to diff against */
  fixtureId?: string;
}

export interface SeasonLinesFile {
  kind: 'season-lines';
  /** REQUIRED and honest: where the numbers came from. Files whose numbers
   *  were typed from memory MUST say so (see data/nba/README.md). */
  provenance: string;
  team?: { id: string; name: string; abbrev: string };
  players: SeasonLine[];
}

export interface LineIssue { path: string; message: string }

const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** strict, loud validation — same philosophy as data/schema.ts: reject the
 *  whole file with a complete issue list rather than defaulting bad fields */
export function validateSeasonLines(raw: unknown): { file: SeasonLinesFile | null; issues: LineIssue[] } {
  const issues: LineIssue[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { file: null, issues: [{ path: '$', message: 'must be an object' }] };
  }
  const f = raw as Partial<SeasonLinesFile>;
  if (f.kind !== 'season-lines') issues.push({ path: '$.kind', message: 'expected "season-lines"' });
  if (!f.provenance || typeof f.provenance !== 'string') {
    issues.push({ path: '$.provenance', message: 'missing provenance string (say where the numbers came from — "typed from memory, unverified" is acceptable and must be stated)' });
  }
  if (!Array.isArray(f.players) || f.players.length === 0) {
    issues.push({ path: '$.players', message: 'need at least 1 player line' });
    return { file: null, issues };
  }
  const reqNum: (keyof SeasonLine)[] = [
    'heightIn', 'weightLb', 'mpg', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov',
    'fga', 'fgPct', 'tpa', 'tpPct', 'fta', 'ftPct'
  ];
  f.players.forEach((p, i) => {
    const at = `$.players[${i}]`;
    // a null/non-object entry must land in the promised complete issue list,
    // not throw a TypeError at the first property read (scan finding b4-11 —
    // same report-never-throw contract as data/schema.ts's validator)
    if (typeof p !== 'object' || p === null) {
      issues.push({ path: at, message: 'player line must be an object' });
      return;
    }
    const pl = p as Partial<SeasonLine>;
    if (!pl.name || typeof pl.name !== 'string') issues.push({ path: `${at}.name`, message: 'missing name' });
    if (!POSITIONS.includes(pl.pos as Position)) issues.push({ path: `${at}.pos`, message: `pos must be one of ${POSITIONS.join('|')}` });
    for (const k of reqNum) {
      const v = pl[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        issues.push({ path: `${at}.${k}`, message: 'must be a finite number >= 0' });
      }
    }
    for (const k of ['fgPct', 'tpPct', 'ftPct'] as const) {
      const v = pl[k];
      if (typeof v === 'number' && v > 1) {
        issues.push({ path: `${at}.${k}`, message: 'percentages are decimals in 0..1 (write 0.454, not 45.4)' });
      }
    }
    // Optional numerics validate when PRESENT (audit M-29): they were exempt
    // from the loud pass entirely, so a STRING orb sailed through validation
    // and crashed mid-fit deep in the rate math, and a negative orb silently
    // skewed the rebounding profile — the exact silent-default class this
    // validator exists to reject.
    for (const k of ['wingspanIn', 'orb', 'pf', 'dunks'] as const) {
      const v = pl[k];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        issues.push({ path: `${at}.${k}`, message: 'optional, but when present must be a finite number >= 0' });
      }
    }
    if (pl.fixtureId !== undefined && typeof pl.fixtureId !== 'string') {
      issues.push({ path: `${at}.fixtureId`, message: 'optional, but when present must be a fidelity benchmark id string' });
    }
    if (typeof pl.tpa === 'number' && typeof pl.fga === 'number' && pl.tpa > pl.fga) {
      issues.push({ path: `${at}.tpa`, message: '3PA cannot exceed FGA' });
    }
    if (typeof pl.orb === 'number' && typeof pl.reb === 'number' && pl.orb > pl.reb) {
      issues.push({ path: `${at}.orb`, message: 'ORB cannot exceed REB' });
    }
    if (pl.shotZones) {
      const z = pl.shotZones as Partial<ShotZoneSplits>;
      const bad = (x: unknown) => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1;
      if (bad(z.rimShare2) || bad(z.midShare2) || (z.rimShare2 as number) + (z.midShare2 as number) > 1) {
        issues.push({ path: `${at}.shotZones`, message: 'rimShare2/midShare2 must be 0..1 and sum to <= 1 (paint gets the remainder)' });
      }
    }
  });
  // Fitted ids are `fit-${slug(name)}` (analyticFit); names that slug empty
  // or identically produce broken/duplicate player ids that only explode
  // LATE — pack validation or merged box-score lines (audit L-46). Reject
  // here, where the fix (rename a player) is obvious.
  const slugAt = new Map<string, number>();
  f.players.forEach((p, i) => {
    if (typeof p !== 'object' || p === null) return;
    const name = (p as Partial<SeasonLine>).name;
    if (!name || typeof name !== 'string') return; // missing-name issue already filed
    const s = slug(name);
    if (s === '') {
      issues.push({ path: `$.players[${i}].name`, message: `"${name}" slugs to an empty player id — the name needs at least one letter or digit` });
      return;
    }
    const prev = slugAt.get(s);
    if (prev !== undefined) {
      issues.push({ path: `$.players[${i}].name`, message: `"${name}" slugs to "fit-${s}", colliding with players[${prev}] — player ids must be unique; rename one` });
    } else {
      slugAt.set(s, i);
    }
  });
  return { file: issues.length === 0 ? (raw as SeasonLinesFile) : null, issues };
}

// ─────────────────────────────────────────────────── position priors (fixed)

/**
 * Per-position basketball priors used where the box line is silent. The zone
 * mixes are league play-style facts (guards' twos skew to drives+pullups,
 * bigs' to rim+paint); orbShare is the typical ORB share of a position's
 * total boards; stl/blk are league positional averages used ONLY to center
 * the defensive nudges (a wing with 1.5 stl is a plus thief; a center with
 * 1.5 is a monster).
 */
const POS: Record<Position, {
  rim2: number; paint2: number;   // shares of TWO-point attempts (mid = rest)
  orbShare: number;               // ORB share of TRB when orb not given
  stlAvg: number; blkAvg: number; // positional per-game averages
  handleBonus: number;            // ball lives in guards' hands
  big: boolean;
  pushPace: number;               // STAGED dial prior
}> = {
  PG: { rim2: 0.42, paint2: 0.22, orbShare: 0.12, stlAvg: 1.2, blkAvg: 0.3, handleBonus: 12, big: false, pushPace: 55 },
  SG: { rim2: 0.44, paint2: 0.20, orbShare: 0.14, stlAvg: 1.0, blkAvg: 0.35, handleBonus: 8, big: false, pushPace: 52 },
  SF: { rim2: 0.50, paint2: 0.20, orbShare: 0.18, stlAvg: 1.0, blkAvg: 0.5, handleBonus: 5, big: false, pushPace: 48 },
  PF: { rim2: 0.56, paint2: 0.22, orbShare: 0.25, stlAvg: 0.8, blkAvg: 0.8, handleBonus: 2, big: true, pushPace: 44 },
  C: { rim2: 0.60, paint2: 0.24, orbShare: 0.30, stlAvg: 0.7, blkAvg: 1.2, handleBonus: 0, big: true, pushPace: 40 }
};

/** position archetype = template for the UNIDENTIFIED dials (same mapping as
 *  solve.ts) — physicals and defensive craft start here, box-inferable dials
 *  are overwritten by the analytic layer below */
const TEMPLATES: Record<Position, (w: { id: string; name: string; pos: Position }) => Player> = {
  PG: comboGuard, SG: scoringWing, SF: threeAndD, PF: glueForward, C: postAnchor
};

// ─────────────────────────────────────────── derived rates from a season line

export interface Rates {
  twoPa: number;        // two-point attempts per game
  twoPct: number;       // two-point make %
  share3: number;       // 3PA / FGA
  mix: { rim: number; paint: number; mid: number; three: number }; // FGA shares
  pullUpShare: number;  // share of 3PA that are self-created (est.)
  usgPct: number;       // usage estimate (0..1)
  ftaRate: number;      // FTA / FGA
  astToTov: number;
  tovShare: number;     // TOV share of possessions used
  orb: number;          // per game (given or position-estimated)
  drb: number;
}

/** possessions-used denominator: league team ≈ 110 plays (FGA + 0.44·FTA +
 *  TOV) per 48 team-minutes → 2.3 plays per on-court minute. REAL-ish league
 *  constant; the usage dial's own scale (decide.ts:115) does the rest. */
const PLAYS_PER_MIN = 2.3;

export function deriveRates(line: SeasonLine): Rates {
  const fga = Math.max(0.1, line.fga);
  const twoPa = Math.max(0, line.fga - line.tpa);
  const twoMade = Math.max(0, line.fga * line.fgPct - line.tpa * line.tpPct);
  const twoPct = twoPa > 0.2 ? clamp(twoMade / twoPa, 0, 1) : 0.5;
  const share3 = clamp(line.tpa / fga, 0, 1);
  const P = POS[line.pos];

  // Two-point zone mix: position prior, bent toward the rim by foul-drawing
  // volume (free throws are earned at the rim — a high FTA rate is direct
  // evidence of rim pressure), overridden entirely by shotZones when given.
  const ftaRate = clamp(line.fta / fga, 0, 1.2);
  let rim2 = P.rim2 + clamp((ftaRate - 0.28) * 0.35, -0.08, 0.1);
  let mid2 = 1 - rim2 - P.paint2;
  if (line.shotZones) {
    rim2 = line.shotZones.rimShare2;
    mid2 = line.shotZones.midShare2;
  }
  const paint2 = clamp(1 - rim2 - mid2, 0, 1);
  const twoShare = 1 - share3;
  const mix = {
    rim: rim2 * twoShare,
    paint: paint2 * twoShare,
    mid: Math.max(0, mid2) * twoShare,
    three: share3
  };

  // Self-created share of threes: catch-and-shoot diets cap around 5-6
  // attempts a game (you only get so many kickouts); volume beyond that is
  // pulled up. Anchors: 3 attempts → 0.15 (spot-up), 11+ → ~0.55
  // (heliocentric). Scaled by a CREATOR factor — pull-ups are a creator's
  // shot, and AST volume is the box line's creator signal: a 5.6-3PA 3&D
  // wing (1.8 AST) is a spot-up shooter, not a 28% pull-up shooter, while
  // the same 3PA on a lead guard is heavily self-created.
  const creator = clamp(0.5 + line.ast * 0.12, 0.6, 1.4);
  const pullUpShare = clamp((0.15 + (line.tpa - 3) * 0.05) * creator, 0.1, 0.65);

  // USG%: possessions used / team plays while on court. Standard estimate
  // when team totals are unknown; PLAYS_PER_MIN documented above.
  const used = line.fga + 0.44 * line.fta + line.tov;
  const usgPct = clamp(used / (Math.max(8, line.mpg) * PLAYS_PER_MIN), 0.05, 0.42);

  const astToTov = line.ast / Math.max(0.5, line.tov);
  const tovShare = clamp(line.tov / Math.max(1, used), 0, 0.5);

  const orb = line.orb !== undefined ? line.orb : line.reb * P.orbShare;
  const drb = Math.max(0, line.reb - orb);
  return { twoPa, twoPct, share3, mix, pullUpShare, usgPct, ftaRate, astToTov, tovShare, orb, drb };
}

// ──────────────────────────────────── REFERENCE MODEL (engine-derived logits)

/**
 * The reference shot conditions the analytic inversions assume, per zone.
 * All logit pieces come from defaultParams — the same constants resolve.ts
 * runs forward — so the algebra here is the engine's own algebra.
 *
 * The one judgment call per zone is the REFERENCE CONTEST LEVEL, i.e. how
 * open the sim's realized average look in that zone actually is. These are
 * NOT the contest midpoint (0.38): the engine's relocation/catch-and-shoot
 * economy delivers threes well under the midpoint, while rim attempts meet
 * help. Values are calibrated so the archetype/fixture anchors invert onto
 * themselves (three: eliteShooter 99 ↔ ~45%, threeAndD 82 ↔ ~38.5%,
 * comboGuard 70 ↔ ~36%) — each anchor's check lives in the tests.
 */
const REF_CONTEST = {
  threeBase: 0.19,     // open catch-and-shoot economy
  threePerPullUp: 0.15, // pull-ups are self-created INTO a contest
  rim: 0.25,
  paint: 0.34,
  mid: 0.36
};
/** typical in-rotation energy — fatigue ambient = fatigueCoef·(1-0.88) */
const REF_ENERGY = 0.88;
/** average rim-attempt distance, ft (a mix of dunks and short finishes) */
const REF_RIM_DIST_FT = 2.0;
/** average feet beyond the arc on a three (corner 22s vs 26-footers) */
const REF_THREE_BEYOND_FT = 1.0;

interface ZoneRef { base: number; coef: number; ambient: number; leaguePct: number }

function fatigueAmbient(): number {
  return defaultParams.shot.fatigueCoef * (1 - REF_ENERGY);
}

/** three-point reference ambient depends on the player's pull-up share:
 *  contest tightens and the pull-up logit malus applies pro-rata */
export function threeAmbient(pullUpShare: number): number {
  const S = defaultParams.shot;
  const c = REF_CONTEST.threeBase + REF_CONTEST.threePerPullUp * pullUpShare;
  return S.contestCoef * (c - S.contestMidpoint)
    + pullUpShare * S.movePullUp
    - S.distPenaltyThreePerFt * REF_THREE_BEYOND_FT
    + fatigueAmbient();
}

/** two-point-zone references: move-type mixes are documented play-style
 *  facts (rim shots are drives/cuts/putbacks; mid-range is pull-up-heavy) */
export function zoneRefs(): { rim: ZoneRef; paint: ZoneRef; mid: ZoneRef } {
  const S = defaultParams.shot;
  const fat = fatigueAmbient();
  // rim: 50% drives, 15% cuts, 10% putbacks, 25% standstill finishes
  const rimMove = 0.5 * S.moveDrive + 0.15 * S.moveCutFinish + 0.1 * S.movePutback;
  const rimAmb = S.contestCoef * (REF_CONTEST.rim - S.contestMidpoint)
    + rimMove - S.distPenaltyRimPerFt * REF_RIM_DIST_FT + fat;
  // paint: floaters off drives (45%) and short post touches (10%)
  const paintAmb = S.contestCoef * (REF_CONTEST.paint - S.contestMidpoint)
    + 0.45 * S.moveDrive + 0.1 * S.movePost + fat;
  // mid: 65% pull-ups — nobody stands open at 18 ft
  const midAmb = S.contestCoef * (REF_CONTEST.mid - S.contestMidpoint)
    + 0.65 * S.movePullUp + fat;
  return {
    rim: { base: S.baseRim, coef: S.skillCoef, ambient: rimAmb, leaguePct: sigmoid(S.baseRim + rimAmb) },
    paint: { base: S.basePaint, coef: S.skillCoef, ambient: paintAmb, leaguePct: sigmoid(S.basePaint + paintAmb) },
    mid: { base: S.baseMid, coef: S.skillCoef, ambient: midAmb, leaguePct: sigmoid(S.baseMid + midAmb) }
  };
}

const logit = (p: number): number => Math.log(clamp(p, 0.02, 0.98) / (1 - clamp(p, 0.02, 0.98)));
/** mirror of model/derived.ts n(): rating -> [-1, +1] (50 -> 0) */
const nOf = (rating: number): number => (rating - 50) / 50;
const ratingOf = (n: number): number => Math.round(clamp(50 * (1 + n), 1, 99));

// ─────────────────────────────────────────── forward models (for the tests)

/** forward: attr.three -> expected 3P% at the reference conditions.
 *  Exact mirror of shotMakeP's three-zone branch under threeAmbient(). */
export function forwardThreePct(three: number, pullUpShare: number): number {
  const S = defaultParams.shot;
  return sigmoid(S.baseThree + S.skillCoefThree * nOf(three) + threeAmbient(pullUpShare));
}

/** forward: attr.freeThrow -> FT%. Exact mirror of resolve.ts freeThrowP. */
export function forwardFtPct(freeThrow: number): number {
  const S = defaultParams.shot;
  const nv = nOf(freeThrow);
  const elite = Math.max(0, (nv - 0.6) / 0.4) * S.ftEliteKick;
  return clamp(S.ftBasePct + S.ftSkillSwing * nv + elite, 0.3, 0.98);
}

// ─────────────────────────────────────────────────── analytic inversions

/** 3P% -> attr.three: invert the make logit at the reference conditions.
 *  p = σ(baseThree + skillCoefThree·n + ambient)  ⇒  n = (logit(p) − base − ambient)/coef */
export function invertThree(tpPct: number, pullUpShare: number): number {
  const S = defaultParams.shot;
  return ratingOf((logit(tpPct) - S.baseThree - threeAmbient(pullUpShare)) / S.skillCoefThree);
}

/** FT% -> attr.freeThrow: exact piecewise inverse of freeThrowP (same
 *  algebra as solve.ts): below the elite knee (rating 80) the curve is
 *  base + swing·n; above it the elite kick adds (n−0.6)/0.4·kick. */
export function invertFreeThrow(ftPct: number): number {
  const S = defaultParams.shot;
  const knee = S.ftBasePct + S.ftSkillSwing * 0.6;
  let n: number;
  if (ftPct <= knee) {
    n = (ftPct - S.ftBasePct) / S.ftSkillSwing;
  } else {
    n = (ftPct - S.ftBasePct + (S.ftEliteKick * 0.6) / 0.4) /
        (S.ftSkillSwing + S.ftEliteKick / 0.4);
  }
  return ratingOf(n);
}

/**
 * 2P% -> finishing + midRange via zone-anchored inversion.
 *
 * A box line only carries ONE two-point number, so the player's per-zone
 * percentages are estimated with a SHRUNK UNIFORM SHIFT: each zone % =
 * league zone % (from the engine's own reference model) + 0.6 × (player 2P%
 * − league 2P% at his mix). The 0.6 shrink is regression-to-the-mean — raw
 * 2P% is a noisy estimator of any single zone, and zone spreads are narrower
 * than full pass-through would imply. Each estimated zone % then inverts its
 * own logit. Refinement owns the residual (it sees actual sim FG%).
 * NOTE paint skill in-engine is 0.35·finishing + 0.65·midRange
 * (resolve.ts zoneSkill), so paint carries no independent dial to invert.
 */
export const TWO_PT_SHRINK = 0.6;
export function invertTwoPoint(rates: Rates): { finishing: number; midRange: number; leagueTwoPct: number } {
  const Z = zoneRefs();
  const m = rates.mix;
  const twoTotal = Math.max(0.02, m.rim + m.paint + m.mid);
  const leagueTwoPct =
    (m.rim * Z.rim.leaguePct + m.paint * Z.paint.leaguePct + m.mid * Z.mid.leaguePct) / twoTotal;
  const shift = TWO_PT_SHRINK * (rates.twoPct - leagueTwoPct);
  const pRim = clamp(Z.rim.leaguePct + shift, 0.15, 0.9);
  const pMid = clamp(Z.mid.leaguePct + shift, 0.12, 0.75);
  const finishing = ratingOf((logit(pRim) - Z.rim.base - Z.rim.ambient) / Z.rim.coef);
  const midRange = ratingOf((logit(pMid) - Z.mid.base - Z.mid.ambient) / Z.mid.coef);
  return { finishing, midRange, leagueTwoPct };
}

/**
 * FTA rate -> attr.drawFoul: invert shootingFoulP's draw multiplier.
 *
 * Forward model (resolve.ts shootingFoulP + shooting.ts startShot): per
 * attempt in zone z, P(foul) = base_z · contestMult · draw, and the trip is
 * worth k_z FTs on a miss (2, or 3 beyond the arc) but only 1 on a make with
 * the and-one damping (andOneFoulMult). Fouls also require a contester
 * (contest.by !== null) — CONTESTED_SHARE ≈ 0.85 of attempts.
 * Predicted shooting-FTA rate at draw D:
 *   Σ_z mix_z · base_z·(1+(cf−1)·c_z)·CONTESTED_SHARE·D ·
 *        [(1−p_z)·k_z + p_z·andOneFoulMult·1]
 * Box FTA also include NON-shooting free throws (penalty reach-ins, loose
 * balls): NONSHOOT_FTA_SHARE ≈ 0.35 × the SHOOTING-foul FTA — the
 * `(1 + share)` denominator factor below — i.e. ≈26% of TOTAL FTA, inside
 * the real-league ~25-30% once this engine's reach-in economy is counted.
 * (A share “of FTA” would instead need a /(1 − share) construction, a ~54%
 * larger correction — “fixing” the code to match that reading would
 * materially shift every drawFoul fit; the algebra as written is the
 * intended one.) Solve for D, then
 * n = (D−1)/drawFoulSwing, shrunk by 0.8 (same regression-to-mean argument
 * as the zone model — FTA rate is also driven by shot mix noise).
 *
 * The zone mix used for the D solve is BLENDED 50/50 with the league mix:
 * the player mix is itself an estimate (position priors), and an extreme
 * estimated mix (a 55% three diet) otherwise makes the tiny three-zone foul
 * base explode D — foul-drawing evidence should not ride entirely on a
 * quantity this layer guessed. MIX_BLEND=0.5 keeps the Curry-class outlier
 * in the 80s instead of pinning at 99 while moving balanced diets < 3 points.
 */
export const CONTESTED_SHARE = 0.85;
export const NONSHOOT_FTA_SHARE = 0.35;
export const DRAW_FOUL_SHRINK = 0.8;
export const DRAW_FOUL_MIX_BLEND = 0.5;
export function invertDrawFoul(rates: Rates, tpPct: number): number {
  const F = defaultParams.foul;
  const S = defaultParams.shot;
  const Z = zoneRefs();
  const shift = TWO_PT_SHRINK * (rates.twoPct -
    invertTwoPoint(rates).leagueTwoPct);
  const b = DRAW_FOUL_MIX_BLEND;
  const mixOf = (obs: number, league: number): number => (1 - b) * obs + b * league;
  const zones: { mixShare: number; base: number; contest: number; p: number; k: number }[] = [
    { mixShare: mixOf(rates.mix.rim, LEAGUE_MIX.rim), base: F.shootRim, contest: REF_CONTEST.rim, p: clamp(Z.rim.leaguePct + shift, 0.15, 0.9), k: 2 },
    { mixShare: mixOf(rates.mix.paint, LEAGUE_MIX.paint), base: F.shootPaint, contest: REF_CONTEST.paint, p: clamp(Z.paint.leaguePct + shift, 0.12, 0.85), k: 2 },
    { mixShare: mixOf(rates.mix.mid, LEAGUE_MIX.mid), base: F.shootMid, contest: REF_CONTEST.mid, p: clamp(Z.mid.leaguePct + shift, 0.12, 0.75), k: 2 },
    { mixShare: mixOf(rates.mix.three, LEAGUE_MIX.three), base: F.shootThree, contest: REF_CONTEST.threeBase + 0.15 * rates.pullUpShare, p: clamp(tpPct, 0.1, 0.55), k: 3 }
  ];
  let predAtD1 = 0;
  for (const z of zones) {
    const contestMult = 1 + (F.contestFactor - 1) * z.contest;
    const foulP = z.base * contestMult * CONTESTED_SHARE;
    predAtD1 += z.mixShare * foulP * ((1 - z.p) * z.k + z.p * S.andOneFoulMult);
  }
  const denom = Math.max(0.02, predAtD1 * (1 + NONSHOOT_FTA_SHARE));
  const D = rates.ftaRate / denom;
  return ratingOf(((D - 1) / F.drawFoulSwing) * DRAW_FOUL_SHRINK);
}

/** USG% -> tend.usage: the dial IS a USG% scale by construction —
 *  decide.ts:115: targetShare = 0.20 + (usage−50)/100 · usageShareSwing,
 *  so usage = 50 + (USG% − 0.20)·100/usageShareSwing. Pure algebra. */
export function usageDial(usgPct: number): number {
  return Math.round(clamp(50 + ((usgPct - 0.2) * 100) / defaultParams.ai.usageShareSwing, 10, 99));
}

/**
 * FGA zone shares -> zone tendencies (shotRim/shotMid/shotThree).
 *
 * NOT clean algebra: tendencies enter decideBall as one bias among many
 * competing utilities, so the realized share is an emergent quantity. Model:
 *   tend_z = default_z · (share_obs_z / share_league_z)^1.25 + (USG%−20)·0.9
 * Anchors (stated, testable): a league-average line (shares ≈ league, USG
 * 20%) must return the engine's DEFAULT tendencies (50/30/40 — a fixpoint);
 * the Curry fixture's 0.55 three-share + 33% usage must land shotThree in
 * the mid-80s (fixture: 86). The exponent 1.25 sets how aggressively share
 * deviations amplify; the usage term feeds every zone (high-usage players
 * shoot more EVERYWHERE — volume is identity, decide.ts usage loop).
 * League shares: rim .32 / paint .12 / mid .18 / three .38 — consistent with
 * the engine's own league bands (3PA share band and the default shot diet).
 */
const LEAGUE_MIX = { rim: 0.32, paint: 0.12, mid: 0.18, three: 0.38 };
const ZONE_TEND_SHAPE = 1.25;
const ZONE_TEND_USAGE = 0.9;
export function zoneTendencies(rates: Rates): { shotRim: number; shotMid: number; shotThree: number } {
  const vol = (clamp(rates.usgPct, 0.08, 0.42) * 100 - 20) * ZONE_TEND_USAGE;
  const scale = (def: number, obs: number, league: number): number =>
    Math.round(clamp(def * Math.pow(Math.max(0.05, obs / league), ZONE_TEND_SHAPE) + vol, 1, 99));
  // rim tendency covers rim AND paint appetite (decideBall zoneTend treats
  // rim/paint as one bucket — decide.ts:90), so compare their combined share
  const rimObs = rates.mix.rim + rates.mix.paint;
  const rimLeague = LEAGUE_MIX.rim + LEAGUE_MIX.paint;
  return {
    shotRim: scale(50, rimObs, rimLeague),
    shotMid: scale(30, rates.mix.mid, LEAGUE_MIX.mid),
    shotThree: scale(40, rates.mix.three, LEAGUE_MIX.three)
  };
}

// ───────────────────────────────────────────────────────── the analytic fit

export interface DialSource {
  dial: string;
  value: number;
  /** 'formula' = inverted/derived from the box line; 'body' = height/weight;
   *  'template' = position archetype (the gap list); 'default' = flat */
  source: 'formula' | 'body' | 'template' | 'default';
  detail: string;
}

export interface AnalyticFit {
  player: Player;
  rates: Rates;
  sources: DialSource[];
}

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Layer 1: the documented analytic prior. Every dial assignment below either
 * cites its inversion (formula), its body/position prior, or lands on the
 * template (the gap list in the file header).
 */
export function analyticFit(line: SeasonLine): AnalyticFit {
  const rates = deriveRates(line);
  const P = POS[line.pos];
  const src: DialSource[] = [];
  // F = record-and-clamp: EVERY dial assignment below routes through it so
  // the provenance report (`sources`) is complete — never assign a dial
  // directly, or the report silently loses that dial's audit trail.
  const F = (dial: string, value: number, source: DialSource['source'], detail: string): number => {
    const v = Math.round(clamp(value, 1, 99));
    src.push({ dial, value: v, source, detail });
    return v;
  };

  const p = TEMPLATES[line.pos]({ id: `fit-${slug(line.name)}`, name: line.name, pos: line.pos });
  p.heightIn = line.heightIn;
  p.weightLb = line.weightLb;
  if (line.wingspanIn !== undefined) p.wingspanIn = line.wingspanIn;

  const a = p.attr;
  const t = p.tend;
  const usg = rates.usgPct * 100;

  // ---- shooting (engine-formula inversions) ----
  a.three = line.tpa >= 0.7
    ? F('three', invertThree(line.tpPct, rates.pullUpShare), 'formula',
        `invert 3P logit: 3P%=${(line.tpPct * 100).toFixed(1)}, pull-up share ${rates.pullUpShare.toFixed(2)}`)
    : F('three', Math.min(TEMPLATES[line.pos]({ id: 'x', name: 'x', pos: line.pos }).attr.three, 35), 'template',
        'under 0.7 3PA/g: 3P% is noise; template capped at 35 (non-shooter)');
  a.freeThrow = F('freeThrow', invertFreeThrow(line.ftPct), 'formula',
    `exact freeThrowP inverse: FT%=${(line.ftPct * 100).toFixed(1)}`);
  const two = invertTwoPoint(rates);
  // the estimated rim% invertTwoPoint applied internally (its pRim), redone
  // here only so the provenance string can show it — keep in lockstep
  const estRimPct = clamp(zoneRefs().rim.leaguePct + TWO_PT_SHRINK * (rates.twoPct - two.leagueTwoPct), 0.15, 0.9);
  a.finishing = F('finishing', two.finishing, 'formula',
    `rim logit inverse @ est. rim%=${(estRimPct * 100).toFixed(1)} (2P% ${(rates.twoPct * 100).toFixed(1)} vs league ${(two.leagueTwoPct * 100).toFixed(1)})`);
  a.midRange = F('midRange', two.midRange, 'formula',
    'mid logit inverse at the same shrunk uniform shift');
  a.drawFoul = F('drawFoul', invertDrawFoul(rates, line.tpPct), 'formula',
    `shootingFoulP draw-mult inverse: FTA/FGA=${rates.ftaRate.toFixed(2)}`);

  // ---- playmaking (calibrated-linear; anchors: league-avg line → ~template,
  //      Jokić 9 AST / 2.7 AST:TOV → 96-99, Curry 6.7 → low 80s) ----
  a.passVision = F('passVision', 40 + line.ast * 5.6 + rates.astToTov * 2, 'formula',
    `40 + AST·5.6 + AST:TOV·2 (AST=${line.ast}, AST:TOV=${rates.astToTov.toFixed(1)})`);
  a.passAcc = F('passAcc', 40 + line.ast * 4.2 + rates.astToTov * 5.5, 'formula',
    '40 + AST·4.2 + AST:TOV·5.5 (accuracy is the ball-security half of passing)');
  // ball security: TOV share of possessions used, centered on the league's
  // ~12-13% — turnover-prone creators lose handle, not vision
  const tovAdj = (0.125 - rates.tovShare) * 100;
  a.ballHandle = F('ballHandle',
    40 + line.ast * 3 + (usg - 20) * 1.0 + P.handleBonus + line.tpa * 1.2 + tovAdj, 'formula',
    `40 + AST·3 + (USG−20)·1.0 + posBonus ${P.handleBonus} + 3PA·1.2 (pull-up volume needs handle) + secAdj ${tovAdj.toFixed(1)}`);

  // ---- rebounding (calibrated-linear; anchors: Jokić 2.8 ORB → high 80s /
  //      9.5 DRB → high 90s; a 3 TRB guard → 30s-40s) ----
  a.offReb = F('offReb', 12 + rates.orb * 26, 'formula', `12 + ORB·26 (ORB=${rates.orb.toFixed(1)})`);
  a.defReb = F('defReb', 16 + rates.drb * 8.5, 'formula', `16 + DRB·8.5 (DRB=${rates.drb.toFixed(1)})`);

  // ---- body-derived physicals ----
  a.strength = F('strength', 30 + (line.weightLb - 170) * 0.55 + (P.big ? 5 : 0), 'body',
    `30 + (weight−170)·0.55 ${P.big ? '+ big 5' : ''} — mass is the only strength signal in a box line`);
  a.boxout = F('boxout', 0.7 * a.defReb + 0.3 * a.strength - 6 - (P.big ? 0 : 12), 'formula',
    'defReb·0.7 + strength·0.3 − 6 (− 12 for non-bigs: guards leak out, they do not seal)');
  a.stamina = F('stamina', 58 + (line.mpg - 26) * 2.6, 'body',
    `58 + (MPG−26)·2.6 — heavy minutes are the box line's only motor signal (MPG=${line.mpg})`);

  // ---- defense: box signals (STL/BLK) + templates for craft ----
  a.steal = F('steal', 30 + line.stl * 24, 'formula', `30 + STL·24 (STL=${line.stl})`);
  a.block = F('block', 18 + line.blk * 34, 'formula', `18 + BLK·34 (BLK=${line.blk})`);
  a.perimeterD = F('perimeterD', a.perimeterD + (line.stl - P.stlAvg) * 8, 'template',
    `template ± (STL−posAvg)·8 — real perimeter craft is NOT box-visible (gap list)`);
  a.interiorD = F('interiorD', a.interiorD + (line.blk - P.blkAvg) * 10, 'template',
    `template ± (BLK−posAvg)·10 — rim positioning is NOT box-visible (gap list)`);
  F('contestSkill', a.contestSkill, 'template', 'no box signal at all (gap list)');
  F('speed', a.speed, 'template', 'athleticism not in a box line (gap list)');
  F('accel', a.accel, 'template', 'athleticism not in a box line (gap list)');
  F('lateral', a.lateral, 'template', 'athleticism not in a box line (gap list)');
  {
    // Dunk volume is the one direct hops signal a season line can carry
    // (bbref shooting table, made dunks per game). The narration dunk call
    // gates on athlete = 0.6·vertical + 0.4·finishing >= 74 (shotcall.ts
    // DUNK_ATHLETE_SCORE) — a HARD gate, so a real dunker whose blend lands
    // 73.9 never dunks in-sim (measured: Wembanyama fit to 73.0 while
    // leading the fit pool in real dunks). When the line carries dunks,
    // invert that gate: >= 0.3 dunks/g clears it with margin, heavier dunk
    // diets push the floor further (+4 per dunk/g, capped +6). finishing is
    // already fitted (rim% inversion) by this point, so the inversion is
    // exact. Without the field, the old template+BLK nudge stands unchanged.
    const blkNudge = a.vertical + (line.blk - P.blkAvg) * 6;
    if (line.dunks !== undefined && line.dunks >= 0.3) {
      // real dunker: must CLEAR the gate, with margin scaling on volume
      const floor = (74 + 2 + Math.min(6, line.dunks * 4) - 0.4 * a.finishing) / 0.6;
      a.vertical = F('vertical', Math.max(blkNudge, Math.min(97, floor)), 'formula',
        `max(template+BLK nudge, dunk-gate inversion): ${line.dunks}/g made dunks must clear ` +
        `the dunk-call athlete gate (0.6·vert + 0.4·finishing >= 74, narration shotcall) — ` +
        `floor = (76 + min(6, dunks·4) − 0.4·finishing)/0.6, capped at 97, with finishing=${Math.round(a.finishing)}`);
    } else if (line.dunks !== undefined && line.dunks < 0.15) {
      // real NON-dunker: must NOT clear the gate. A high-finishing guard
      // (layup-package 90s) otherwise lands a blend over 74 and the booth
      // calls dunks the real player almost never throws — the inverse
      // failure of the floor above. Same inversion, other side.
      const ceil = Math.max(25, (73 - 0.4 * a.finishing) / 0.6);
      a.vertical = F('vertical', Math.min(blkNudge, ceil), 'formula',
        `min(template+BLK nudge, dunk-gate ceiling): ${line.dunks}/g made dunks — a real ` +
        `non-dunker stays under the dunk-call athlete gate (blend < 74) — ` +
        `ceiling = (73 − 0.4·finishing)/0.6 with finishing=${Math.round(a.finishing)}`);
    } else {
      a.vertical = F('vertical', blkNudge, 'template',
        'template + small BLK nudge (blocks need hops); otherwise not box-visible' +
        (line.dunks !== undefined ? ` (dunks=${line.dunks}/g in the 0.15-0.3 boundary zone)` : ''));
    }
  }

  // ---- mental ----
  a.decisions = F('decisions', 42 + rates.astToTov * 9 + (usg - 20) * 0.5, 'formula',
    'PARTIAL signal: 42 + AST:TOV·9 + (USG−20)·0.5 — ball-security IQ only; shot-selection IQ is not box-visible');
  a.consistency = F('consistency', 60, 'default',
    'STAGED dial; a season average carries no game-to-game variance info');

  // ---- tendencies ----
  // drives are a guard/wing rim-pressure mechanism — a big's rim diet comes
  // from rolls, cuts, putbacks and post-ups, so the rim-share evidence is
  // capped and bigs are hard-capped low (their drive dial is also mostly
  // inert in-engine: ai.driveMinDistFt excludes dunker-spot positions).
  // Computed BEFORE the zone tendencies: shotThree needs it (see below).
  const driveRaw = 18 + Math.min(rates.mix.rim, 0.45) * 95 + rates.ftaRate * 50
    - rates.share3 * 25 + (P.big ? -(line.pos === 'C' ? 30 : 15) : 8);
  t.drive = F('drive', Math.min(driveRaw, line.pos === 'C' ? 45 : line.pos === 'PF' ? 60 : 99), 'formula',
    'min(rim-FGA share, .45)·95 + FTA rate·50 − 3PA share·25 ± position (bigs capped: they roll/post, not drive)');
  t.post = F('post',
    4 + (line.pos === 'C' ? 30 : line.pos === 'PF' ? 22 : line.pos === 'SF' ? 8 : 0)
    + rates.mix.mid * 60 + (usg - 20) * (P.big ? 1.2 : 0.3) - rates.share3 * 20, 'formula',
    'WEAK signal: position base + mid-share·60 + usage — play-type data would identify this (gap list)');

  const zt = zoneTendencies(rates);
  t.shotRim = F('shotRim', zt.shotRim, 'formula',
    `default·(rim+paint share ${(rates.mix.rim + rates.mix.paint).toFixed(2)} / league 0.44)^1.25 + usage`);
  t.shotMid = F('shotMid', zt.shotMid, 'formula',
    `default·(mid share ${rates.mix.mid.toFixed(2)} / league 0.18)^1.25 + usage`);
  // OPPORTUNITY CORRECTION on shotThree: zone tendencies bias per-DECISION,
  // and an inside-clustered player's decision points are rarely threes, so
  // realizing a given 3PA SHARE requires a larger per-opportunity bias.
  // "Inside-clustered" = max(drive, post): drivers AND post hubs both live
  // off inside decision points. Centered on the league-average line's own
  // drive output (55 — the fixpoint test pins it) at 0.6 dial points per
  // point; anchored on the LeBron fixture, which needs shotThree 76 to
  // realize a ~0.16 share in-sim for a drive-84 profile (and still carries
  // fidelity.ts's documented 3PA ratchet).
  const driveOppAdj = Math.max(0, Math.max(t.drive, t.post) - 55) * 0.6;
  t.shotThree = F('shotThree', zt.shotThree + driveOppAdj, 'formula',
    `default·(3PA share ${rates.share3.toFixed(2)} / league 0.38)^1.25 + usage` +
    (driveOppAdj > 0.5 ? ` + drive-opportunity ${driveOppAdj.toFixed(0)}` : ''));
  t.pullUp = F('pullUp', 30 + line.tpa * 3 + (line.ast >= 6 && line.tpa >= 4 ? 8 : 0), 'formula',
    '30 + 3PA·3 (+8 for high-AST high-3PA creators) — volume threes are pulled, not caught');
  t.usage = F('usage', usageDial(rates.usgPct), 'formula',
    `usage dial IS a USG% scale (decide.ts): USG=${(rates.usgPct * 100).toFixed(1)}%`);
  t.iso = F('iso', 18 + (usg - 20) * 1.9, 'formula',
    'WEAK signal: 18 + (USG−20)·1.9 — self-creation load proxies iso appetite (gap list)');
  t.passOut = F('passOut', 34 + line.ast * 4.4 - (usg - 20) * 0.5, 'formula',
    '34 + AST·4.4 − (USG−20)·0.5 (creators pass; pure scorers hold)');
  t.offBallMotion = F('offBallMotion',
    40 + (1 - rates.pullUpShare) * rates.share3 * 70 + (P.big ? -5 : 5) - t.post * 0.15, 'template',
    'WEAK proxy: catch-and-shoot 3 diet suggests movement; true relocation appetite needs tracking data (gap list)');
  t.crashOffReb = F('crashOffReb', 8 + rates.orb * 17 + (P.big ? 8 : 0), 'formula',
    '8 + ORB·17 (+8 bigs) — offensive boards are earned by crashing');
  t.gambleSteal = F('gambleSteal', 20 + line.stl * 17, 'formula',
    '20 + STL·17 — steals require gambling (reach-in economy, passing.ts)');
  t.foulAggr = line.pf !== undefined
    ? F('foulAggr', 40 + (line.pf - 2.2) * 10, 'formula', `40 + (PF−2.2)·10 (PF=${line.pf})`)
    : F('foulAggr', 38, 'default', 'no pf given — near-neutral default (gap list)');
  t.pushPace = F('pushPace', P.pushPace, 'template', 'STAGED dial; pace preference is not in a player box line (gap list)');

  return { player: p, rates, sources: src };
}

// ───────────────────────────────────────────────── layer 2: refinement

/** HARD compute budget (per the wave-1 contract): the orchestrator owns heavy
 *  compute; this fitter may not sweep. Exceeding either cap is an error, not
 *  a warning. */
export const MAX_GAMES_PER_ITER = 8;
export const MAX_ITERS = 10;

export interface FitOptions {
  /** refinement iterations (≤ MAX_ITERS) */
  iters: number;
  /** candidates per iteration */
  cands: number;
  /** games per candidate evaluation (cands·games ≤ MAX_GAMES_PER_ITER) */
  games: number;
  refine: boolean;
  seedBase: string;
}

export const DEFAULT_FIT_OPTIONS: FitOptions = {
  // 7 iters × (2 cands × 4 games) = 56 refinement games, + 4 seed-eval +
  // 16 verify-gate games = 76 total per player, inside the 10×8 hard cap
  iters: 7, cands: 2, games: 4, refine: true, seedBase: 'fit'
};

/** targets the objective scores, with "one noticeable unit" scales
 *  (solve.ts convention, extended to the full line) */
interface Achieved {
  pts: number; ast: number; trb: number; tpa: number; fga: number; fta: number;
  tpPct: number; ftPct: number; fgPct: number; stl: number; blk: number; tov: number;
}
const SCALES: Record<keyof Achieved, number> = {
  pts: 2.5, ast: 1.1, trb: 1.1, tpa: 1.2, fga: 2.0, fta: 0.9,
  tpPct: 0.02, ftPct: 0.025, fgPct: 0.02, stl: 0.5, blk: 0.45, tov: 0.8
};

function lineOf(agg: AggLine): Achieved {
  const g = Math.max(1, agg.games);
  return {
    pts: agg.pts / g, ast: agg.ast / g, trb: agg.trb / g, tpa: agg.tpa / g,
    fga: agg.fga / g, fta: agg.fta / g,
    tpPct: agg.tpm / Math.max(1, agg.tpa), ftPct: agg.ftm / Math.max(1, agg.fta),
    fgPct: agg.fgm / Math.max(1, agg.fga),
    stl: agg.stl / g, blk: agg.blk / g, tov: agg.tov / g
  };
}

function targetsOf(line: SeasonLine): Achieved {
  return {
    pts: line.pts, ast: line.ast, trb: line.reb, tpa: line.tpa, fga: line.fga,
    fta: line.fta, tpPct: line.tpPct, ftPct: line.ftPct, fgPct: line.fgPct,
    stl: line.stl, blk: line.blk, tov: line.tov
  };
}

/**
 * Weighted normalized squared error. Percentage stats get ATTEMPT-AWARE
 * weights: 3P% measured on ~1 attempt/game over a short slate is pure noise,
 * and letting it dominate the objective makes the search sacrifice real
 * dials chasing a coin flip (observed: a low-3PA forward's fit trashed its
 * rebounding to chase an unhittable small-sample 3P%). Weight = sqrt of the
 * target's share of a "trustworthy" attempt volume (8 3PA / 6 FTA per game)
 * — a standard-error-style shrink — capped at 1.
 */
function scoreLine(a: Achieved, target: Achieved): number {
  const pctWeight: Partial<Record<keyof Achieved, number>> = {
    tpPct: clamp(Math.sqrt(target.tpa / 8), 0, 1),
    ftPct: clamp(Math.sqrt(target.fta / 6), 0, 1)
  };
  let err = 0;
  for (const k of Object.keys(SCALES) as (keyof Achieved)[]) {
    const w = pctWeight[k] ?? 1;
    const d = ((a[k] - target[k]) / SCALES[k]) * w;
    err += d * d;
  }
  return err;
}

/**
 * League-neutral supporting cast — the fidelity-benchmark/solve.ts
 * convention. Forked from solve.ts back when importing it executed its main
 * (solve.ts is import.meta.main-guarded now); the fork has since diverged.
 * POSITION-AWARE starters: the star fills his own
 * slot and the cast fills the other four — starting a rimRunner center next
 * to a fitted center made twin towers that ATE the fitted big's boards
 * (observed: a 12-board center fitting to 8.5), which no fidelity cast does
 * either. The star carries his real minutes load.
 */
export function hostTeam(star: Player, mpg: number): Team {
  const starterMk: Record<Position, (w: { id: string; name: string; pos: Position }) => Player> = {
    PG: comboGuard, SG: threeAndD, SF: threeAndD, PF: glueForward, C: rimRunner
  };
  const starterSlots = (['PG', 'SG', 'SF', 'PF', 'C'] as Position[])
    .filter((pos) => pos !== star.pos);
  const starters = starterSlots.map((pos, i) =>
    starterMk[pos]({ id: `fit-${i + 2}`, name: `Cast ${i + 2}`, pos }));
  const bench = [
    benchScorer({ id: 'fit-6', name: 'Cast Six', pos: 'SG' }),
    threeAndD({ id: 'fit-7', name: 'Cast Seven', pos: 'SF' }),
    benchBig({ id: 'fit-8', name: 'Cast Eight', pos: 'C' }),
    glueForward({ id: 'fit-9', name: 'Cast Nine', pos: 'PF' }),
    comboGuard({ id: 'fit-10', name: 'Cast Ten', pos: 'PG' })
  ];
  return {
    id: 'fit-host', name: 'Fitter Hosts', abbrev: 'FIT',
    players: [star, ...starters, ...bench],
    starters: [star.id, ...starters.map((p) => p.id)],
    tactics: { pace: 50, threeBias: 50, helpAggr: 50 },
    rotationMinutes: { [star.id]: Math.round(clamp(mpg, 12, 40)) }
  };
}

/** the dial subset refinement may move — solve.ts's 17 stat-relevant dials
 *  plus the box-visible defense/foul/crash dials this fitter also targets */
const SEARCH_DIALS: { path: 'attr' | 'tend'; key: string }[] = [
  { path: 'attr', key: 'three' }, { path: 'attr', key: 'midRange' },
  { path: 'attr', key: 'finishing' }, { path: 'attr', key: 'freeThrow' },
  { path: 'attr', key: 'passVision' }, { path: 'attr', key: 'passAcc' },
  { path: 'attr', key: 'ballHandle' }, { path: 'attr', key: 'defReb' },
  { path: 'attr', key: 'offReb' }, { path: 'attr', key: 'boxout' },
  { path: 'attr', key: 'drawFoul' }, { path: 'attr', key: 'steal' },
  { path: 'attr', key: 'block' },
  { path: 'tend', key: 'usage' }, { path: 'tend', key: 'shotThree' },
  { path: 'tend', key: 'shotRim' }, { path: 'tend', key: 'shotMid' },
  { path: 'tend', key: 'pullUp' }, { path: 'tend', key: 'drive' },
  { path: 'tend', key: 'passOut' }, { path: 'tend', key: 'offBallMotion' },
  { path: 'tend', key: 'crashOffReb' }, { path: 'tend', key: 'gambleSteal' }
];

/** refinement may not drift a dial further than this from the analytic
 *  prior — keeps layer 1 primary and layer 2 an interaction-corrector.
 *  Dials whose analytic inversion is EXACT algebra get a tighter leash than
 *  heuristic ones: freeThrowP inverts exactly (±6 covers rounding + FT-count
 *  noise), the three-point inverse only carries reference-condition
 *  uncertainty (±12), while emergent-quantity dials (tendencies, counting-
 *  stat anchors) get the full ±20. */
export const TRUST_REGION = 20;
const TRUST_REGION_BY_DIAL: Record<string, number> = {
  'attr.freeThrow': 6,
  'attr.three': 12
};

/** CRN noise guard: a candidate must beat the incumbent by this relative
 *  margin to be accepted — with 4-game evaluations the percentage stats are
 *  noisy enough that accepting every hairline "improvement" chases seed
 *  luck instead of signal. */
export const ACCEPT_MARGIN = 0.03;

export interface RefineResult {
  player: Player;
  seedLine: Achieved;
  finalLine: Achieved;
  seedErr: number;
  finalErr: number;
  /** held-out re-evaluation of the SELECTED player on FRESH seeds — the
   *  honest number to quote (finalLine is in-sample by construction) */
  verifyLine: Achieved | null;
  verifyErr: number | null;
  /** the analytic seed's own held-out error (the verify-gate's yardstick) */
  seedVerifyErr: number | null;
  /** false = the refinement failed the verify gate and the analytic seed
   *  was kept (refinement is SAFE: it can only ship a held-out improvement) */
  keptRefinement: boolean;
  itersRun: number;
  gamesSimulated: number;
}

/** score ANY player against a season line under the fitter's evaluation
 *  protocol (league-neutral host, star minutes, season-line objective) —
 *  used to put the hand-built fidelity fixtures on the same yardstick as
 *  the fitted profiles */
export function evaluateAgainstLine(
  p: Player, line: SeasonLine, games: number, seedBase: string
): { err: number; line: Achieved } {
  const agg = runBenchmark(hostTeam(p, line.mpg), p.id, games, seedBase);
  const l = lineOf(agg);
  return { err: scoreLine(l, targetsOf(line)), line: l };
}

export function refineFit(seedPlayer: Player, line: SeasonLine, opts: FitOptions): RefineResult {
  // Integer floors BEFORE the budget arithmetic (audit M-30, L-47): the cap
  // below multiplies user-typed numbers, so fractional counts slipped under
  // it while the loops ran MORE work than the product claims (--cands 2.5
  // --games 3 = "7.5" budget, but `c < 2.5` executes 3 candidates = 9 games
  // per iteration, past the cap of 8); and the LOWER bounds were never
  // checked at all — negative or zero counts quietly fit nothing.
  for (const [name, v] of [['iters', opts.iters], ['cands', opts.cands], ['games', opts.games]] as const) {
    if (!Number.isInteger(v) || v < 1) {
      throw new Error(`fit-roster: ${name} must be an integer >= 1, got ${v}`);
    }
  }
  if (opts.iters > MAX_ITERS) {
    throw new Error(`--iters ${opts.iters} exceeds the hard budget of ${MAX_ITERS} iterations`);
  }
  if (opts.cands * opts.games > MAX_GAMES_PER_ITER) {
    throw new Error(
      `--cands ${opts.cands} × --games ${opts.games} = ${opts.cands * opts.games} games/iteration ` +
      `exceeds the hard budget of ${MAX_GAMES_PER_ITER}`
    );
  }
  const target = targetsOf(line);
  const evalGames = Math.min(opts.games, MAX_GAMES_PER_ITER);
  let gamesSimulated = 0;
  // common random numbers: runBenchmark's seeds are `${seedBase}-${starId}-${i}`,
  // so every evaluation of this player replays the identical game seeds and
  // candidates compare fairly (solve.ts convention)
  const evaluate = (p: Player, seedBase: string, games: number): { score: number; line: Achieved } => {
    const agg = runBenchmark(hostTeam(p, line.mpg), p.id, games, seedBase);
    gamesSimulated += games;
    const l = lineOf(agg);
    return { score: scoreLine(l, target), line: l };
  };

  let best = structuredClone(seedPlayer);
  let bestEval = evaluate(best, opts.seedBase, evalGames);
  const seedLine = bestEval.line;
  const seedErr = bestEval.score;
  if (!opts.refine) {
    return {
      player: best, seedLine, finalLine: seedLine, seedErr, finalErr: seedErr,
      verifyLine: null, verifyErr: null, seedVerifyErr: null,
      keptRefinement: false, itersRun: 0, gamesSimulated
    };
  }

  const bounds = new Map<string, { lo: number; hi: number }>();
  for (const d of SEARCH_DIALS) {
    const bag = d.path === 'attr'
      ? (seedPlayer.attr as unknown as Record<string, number>)
      : (seedPlayer.tend as unknown as Record<string, number>);
    const v = bag[d.key]!;
    const region = TRUST_REGION_BY_DIAL[`${d.path}.${d.key}`] ?? TRUST_REGION;
    bounds.set(`${d.path}.${d.key}`, { lo: clamp(v - region, 1, 99), hi: clamp(v + region, 1, 99) });
  }

  const rng = new Rng(`${opts.seedBase}-refine-${seedPlayer.id}`);
  // Loop shape — a bounded hill-climb: each iteration proposes `cands`
  // candidates of 2-4 random dial moves inside the trust region; acceptance
  // needs a 3% CRN-fair margin (ACCEPT_MARGIN); step anneals ×0.85 per
  // iteration, floored at 3.
  let step = 12;
  let itersRun = 0;
  for (let i = 1; i <= opts.iters; i++) {
    itersRun = i;
    for (let c = 0; c < opts.cands; c++) {
      const cand: Player = structuredClone(best);
      const moves = 2 + Math.floor(rng.float() * 3); // 2-4 local dial moves
      for (let m = 0; m < moves; m++) {
        const d = SEARCH_DIALS[Math.floor(rng.float() * SEARCH_DIALS.length)]!;
        const bag = d.path === 'attr'
          ? (cand.attr as unknown as Record<string, number>)
          : (cand.tend as unknown as Record<string, number>);
        const b = bounds.get(`${d.path}.${d.key}`)!;
        const jitter = (rng.float() * 2 - 1) * step; // uniform in ±step
        bag[d.key] = Math.round(clamp(bag[d.key]! + jitter, b.lo, b.hi));
      }
      const ev = evaluate(cand, opts.seedBase, evalGames);
      if (ev.score < bestEval.score * (1 - ACCEPT_MARGIN)) {
        best = cand;
        bestEval = ev;
      }
    }
    step = Math.max(3, step * 0.85);
  }
  // THE VERIFY GATE: finalLine is by construction the line the search
  // optimized (in-sample), and a stochastic hill-climb on 4-game evals can
  // ship a seed-luck profile. Both the analytic seed and the refined
  // candidate are re-evaluated on FRESH seeds; the refinement is kept only
  // if it wins held-out by a real margin. Refinement can therefore never
  // make the fit worse than the analytic layer — it is strictly additive.
  const seedVerify = evaluate(seedPlayer, `${opts.seedBase}-verify`, MAX_GAMES_PER_ITER);
  const bestVerify = evaluate(best, `${opts.seedBase}-verify`, MAX_GAMES_PER_ITER);
  const keptRefinement = bestVerify.score < seedVerify.score * 0.9;
  const selected = keptRefinement ? best : structuredClone(seedPlayer);
  const verify = keptRefinement ? bestVerify : seedVerify;
  return {
    player: selected, seedLine, finalLine: bestEval.line,
    seedErr, finalErr: bestEval.score,
    verifyLine: verify.line, verifyErr: verify.score,
    seedVerifyErr: seedVerify.score,
    keptRefinement, itersRun, gamesSimulated
  };
}

// ─────────────────────────────────────────────────────── team pack assembly

/**
 * Wrap the fitted players as a schema-valid TeamPack: pad the roster to 10
 * with league-neutral archetype cast (a pack needs ≥8 players and exactly 5
 * starters — data/schema.ts), pick starters by MPG, and set team threeBias
 * from the roster's aggregate 3PA share.
 */
export function assembleTeamPack(
  fits: { player: Player; line: SeasonLine }[],
  team?: { id: string; name: string; abbrev: string }
): TeamPack {
  const id = team?.id ?? 'fitted';
  const name = team?.name ?? 'Fitted Roster';
  const abbrev = team?.abbrev ?? 'FIT';
  const players = fits.map((f) => f.player);
  const castByPos: ((w: { id: string; name: string; pos: Position }) => Player)[] = [
    (w) => comboGuard({ ...w, pos: 'PG' }), (w) => benchScorer({ ...w, pos: 'SG' }),
    (w) => threeAndD({ ...w, pos: 'SF' }), (w) => glueForward({ ...w, pos: 'PF' }),
    (w) => benchBig({ ...w, pos: 'C' }), (w) => comboGuard({ ...w, pos: 'PG' }),
    (w) => threeAndD({ ...w, pos: 'SF' }), (w) => rimRunner({ ...w, pos: 'C' }),
    (w) => glueForward({ ...w, pos: 'PF' }), (w) => scoringWing({ ...w, pos: 'SG' })
  ];
  let castIdx = 0;
  while (players.length < 10) {
    const mk = castByPos[castIdx % castByPos.length]!;
    players.push(mk({ id: `${id}-cast-${castIdx + 1}`, name: `Cast ${castIdx + 1}`, pos: 'SF' }));
    castIdx++;
  }
  const byMpg = [...fits].sort((x, y) => y.line.mpg - x.line.mpg);
  const starters = byMpg.slice(0, 5).map((f) => f.player.id);
  for (const p of players) {
    if (starters.length >= 5) break;
    if (!starters.includes(p.id)) starters.push(p.id);
  }
  const totFga = fits.reduce((s, f) => s + f.line.fga, 0);
  const totTpa = fits.reduce((s, f) => s + f.line.tpa, 0);
  const share3 = totFga > 0 ? totTpa / totFga : 0.39;
  const rotationMinutes: Record<string, number> = {};
  for (const f of fits) rotationMinutes[f.player.id] = Math.round(clamp(f.line.mpg, 12, 40));
  const teamObj: Team = {
    id, name, abbrev,
    players,
    starters,
    tactics: {
      pace: 50,
      // 3PA-share-hungry rosters get the green light: ±1 tactic point per
      // ~0.8% of three-share deviation from the league's 0.39
      threeBias: Math.round(clamp(50 + (share3 - 0.39) * 120, 30, 70)),
      helpAggr: 50
    },
    rotationMinutes
  };
  return toTeamPack(teamObj);
}

// ─────────────────────────────────────────────────────── fixture comparison

export interface DialDelta { dial: string; fitted: number; fixture: number; delta: number }

export function compareToFixture(fitted: Player, fixture: Player): DialDelta[] {
  const rows: DialDelta[] = [];
  const attrs = fitted.attr as unknown as Record<string, number>;
  const fAttrs = fixture.attr as unknown as Record<string, number>;
  for (const k of Object.keys(fAttrs)) {
    rows.push({ dial: `attr.${k}`, fitted: attrs[k]!, fixture: fAttrs[k]!, delta: attrs[k]! - fAttrs[k]! });
  }
  const tends = fitted.tend as unknown as Record<string, number>;
  const fTends = fixture.tend as unknown as Record<string, number>;
  for (const k of Object.keys(fTends)) {
    rows.push({ dial: `tend.${k}`, fitted: tends[k]!, fixture: fTends[k]!, delta: tends[k]! - fTends[k]! });
  }
  return rows;
}

// ──────────────────────────────────────────────────────────────────── CLI

function fmtLine(a: Achieved): string {
  return `pts ${a.pts.toFixed(1)}  ast ${a.ast.toFixed(1)}  trb ${a.trb.toFixed(1)}  ` +
    `fga ${a.fga.toFixed(1)}  3PA ${a.tpa.toFixed(1)}  FG% ${(a.fgPct * 100).toFixed(1)}  ` +
    `3P% ${(a.tpPct * 100).toFixed(1)}  FT% ${(a.ftPct * 100).toFixed(1)}  ` +
    `stl ${a.stl.toFixed(1)}  blk ${a.blk.toFixed(1)}  tov ${a.tov.toFixed(1)}`;
}

function printSources(sources: DialSource[]): void {
  const byKind: Record<DialSource['source'], number> = { formula: 0, body: 0, template: 0, default: 0 };
  for (const s of sources) byKind[s.source]++;
  console.log(`  dial provenance: ${byKind.formula} formula, ${byKind.body} body, ${byKind.template} template (gap list), ${byKind.default} default`);
  for (const s of sources) {
    console.log(`    ${s.source.padEnd(8)} ${s.dial.padEnd(14)} ${String(s.value).padStart(3)}  ${s.detail}`);
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  // declared vocabulary — a typo'd or `=`-spelled flag dies here instead of
  // silently fitting with the defaults (args.ts checkFlags, audit H-03)
  checkFlags(argv, ['--benchmarks', '--in', '--out', '--no-refine', '--compare-fixtures', '--iters', '--cands', '--games', '--seed']);
  const benchmarks = argv.includes('--benchmarks');
  const inPath = flagValue(argv, '--in', benchmarks ? 'data/nba/example-stars.season.json' : '');
  const outDir = flagValue(argv, '--out', 'out/fitted');
  const refine = !argv.includes('--no-refine');
  const compareFixtures = benchmarks || argv.includes('--compare-fixtures');
  const opts: FitOptions = {
    iters: flagNumber(argv, '--iters', DEFAULT_FIT_OPTIONS.iters),
    cands: flagNumber(argv, '--cands', DEFAULT_FIT_OPTIONS.cands),
    games: flagNumber(argv, '--games', DEFAULT_FIT_OPTIONS.games),
    refine,
    seedBase: flagValue(argv, '--seed', 'fit')
  };
  if (!inPath) {
    console.error('fit-roster: pass --in <file.season.json> (or --benchmarks). See the header of');
    console.error('packages/harness/src/fit-roster.ts for the input schema; examples in data/nba/.');
    process.exit(1);
  }

  // one-line diagnosis for an unreadable/unparsable input — not a raw
  // ENOENT or SyntaxError stack out of node internals (simone.ts's c4-F3
  // convention; audit L-48)
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inPath, 'utf8'));
  } catch (err) {
    console.error(`fit-roster: cannot read ${inPath}: ${(err as Error).message}`);
    process.exit(1);
  }
  const { file, issues } = validateSeasonLines(raw);
  if (!file) {
    console.error(`fit-roster: ${inPath} failed season-line validation:`);
    for (const i of issues) console.error(`  ${i.path}: ${i.message}`);
    process.exit(1);
  }
  console.log(`fit-roster: ${file.players.length} player(s) from ${inPath}`);
  console.log(`provenance: ${file.provenance}\n`);
  console.log(`budget: ${opts.iters} iters × (${opts.cands} cands × ${opts.games} games) ` +
    `[caps: ${MAX_ITERS} iters, ${MAX_GAMES_PER_ITER} games/iter]${refine ? '' : '  (refinement OFF)'}\n`);

  const fits: { player: Player; line: SeasonLine }[] = [];
  const fixtureById = new Map(BENCHMARKS.map((b) => [b.players[0]!.id, b.players[0]!]));

  for (const line of file.players) {
    console.log(`── ${line.name} (${line.pos}, ${line.heightIn}", ${line.weightLb} lb, ${line.mpg} mpg)`);
    const fit = analyticFit(line);
    printSources(fit.sources);
    const result = refineFit(fit.player, line, opts);
    console.log(`  target      ${fmtLine(targetsOf(line))}`);
    console.log(`  analytic    ${fmtLine(result.seedLine)}   err ${result.seedErr.toFixed(2)}`);
    if (refine) {
      console.log(`  refined     ${fmtLine(result.finalLine)}   err ${result.finalErr.toFixed(2)}  ` +
        `(${result.itersRun} iters, ${result.gamesSimulated} games, in-sample)`);
      if (result.verifyLine) {
        const gate = result.keptRefinement
          ? `KEPT refinement (seed held-out err ${result.seedVerifyErr!.toFixed(2)})`
          : `REVERTED to analytic seed (refined held-out did not beat ${result.seedVerifyErr!.toFixed(2)} by 10%)`;
        console.log(`  verify      ${fmtLine(result.verifyLine)}   err ${result.verifyErr!.toFixed(2)}  (fresh seeds, ${MAX_GAMES_PER_ITER} games) — ${gate}`);
      }
    }
    if (compareFixtures && line.fixtureId) {
      const fixture = fixtureById.get(line.fixtureId);
      if (fixture) {
        // the fair yardstick for the verify error: the HAND-BUILT fixture,
        // run through the exact same host/games/objective protocol
        const fixEval = evaluateAgainstLine(fixture, line, MAX_GAMES_PER_ITER, `${opts.seedBase}-verify`);
        console.log(`  fixture     ${fmtLine(fixEval.line)}   err ${fixEval.err.toFixed(2)}  (hand-built ${line.fixtureId}, same protocol)`);
        console.log(`  vs fidelity fixture ${line.fixtureId} (fitted − fixture):`);
        const rows = compareToFixture(result.player, fixture);
        const big = rows.filter((r) => Math.abs(r.delta) >= 12);
        for (const r of rows) {
          const mark = Math.abs(r.delta) >= 12 ? ' *' : '';
          console.log(`    ${r.dial.padEnd(20)} fit ${String(r.fitted).padStart(3)}  fix ${String(r.fixture).padStart(3)}  Δ ${String(r.delta).padStart(4)}${mark}`);
        }
        const mad = rows.reduce((s, r) => s + Math.abs(r.delta), 0) / rows.length;
        console.log(`    mean |Δ| ${mad.toFixed(1)} across ${rows.length} dials; ${big.length} dials off by ≥12 (*)`);
      } else {
        console.log(`  fixtureId ${line.fixtureId} not found in fidelity BENCHMARKS`);
      }
    }
    console.log('');
    fits.push({ player: result.player, line });
  }

  const pack = assembleTeamPack(fits, file.team);
  const packIssues = validateTeamPack(pack);
  if (packIssues.length > 0) {
    console.error('fit-roster: assembled pack FAILED validateTeamPack — refusing to write:');
    for (const i of packIssues) console.error(`  ${i.path}: ${i.message}`);
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${pack.team.id}.team.json`);
  writeFileSync(outFile, JSON.stringify(pack, null, 2) + '\n');
  console.log(`wrote ${outFile} (${pack.team.players.length} players, validateTeamPack: 0 issues)`);
}
