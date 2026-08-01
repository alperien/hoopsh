/**
 * Seed-pin re-anchor helper — the W54/W56 pinned-fixture class, mechanical.
 *
 *   node --disable-warning=ExperimentalWarning --import ./tools/register.mjs packages/harness/src/reanchor.ts
 *       verify every anchor in the seed-pins.gen.ts files against the
 *       current engine streams (exit 1 when any anchor needs re-anchoring)
 *
 *   node --disable-warning=ExperimentalWarning --import ./tools/register.mjs packages/harness/src/reanchor.ts --write
 *       re-scout the stranded/degraded anchors per each pin's documented
 *       doctrine, rewrite the seed-pins.gen.ts files, then re-run the six
 *       consuming test files as confirmation; the files are restored
 *       untouched if confirmation fails (--keep-unmanaged-red keeps them
 *       when the ONLY failures are KNOWN_UNMANAGED co-resident pins —
 *       exit 2, see CONFIRMATION SCOPE below)
 *
 * WHY THIS EXISTS (issue #50): a handful of tests pin SEEDS whose streams
 * exhibit a phenomenon — an overtime tip, a technical foul, a lead-change-
 * rich game — and assert the phenomenon plus a vacuity floor so the
 * assertion can never go silently empty. Those anchors are rng-order-
 * COUPLED by design (AGENTS §1.2: reordering any rng call reshuffles every
 * stream), so every legitimate rng-order change stranded them: nine tests
 * to re-anchor by hand, each a chance to fumble a pin (the register's
 * W54/W56 rows record those hand re-anchors; the H-02 seeds alone went
 * through seven). This helper makes the re-anchor ONE command that
 * re-scouts per the doctrine each test's header always prescribed.
 *
 * WHAT IT WILL NOT DO (AGENTS §1.6): it never edits a test file, never
 * touches an assertion, and never lowers a floor to make a search succeed.
 * The one floor family it may rewrite — the leakout scout floors — moves
 * only by that test's own documented safety-shape formula, behind guards
 * that REFUSE when the fresh scout shows the mechanism collapsed rather
 * than reshuffled. When a phenomenon cannot be found at all (an exhausted
 * scan), the helper reports a genuine-regression suspicion and exits 1:
 * a pin that cannot be re-anchored is evidence, not an inconvenience.
 *
 * COLLAPSE DISCRIMINATORS (the doctrine audit, review #88). A scan whose
 * qualification can be satisfied by draw luck while the guarded mechanism
 * is GONE would launder the regression into a green suite with machine-
 * written provenance — the exact failure this tool class exists to
 * prevent. Per pin, what refuses that:
 *   evstreamPool — floors are pooled existence sums over fixed slots; a
 *     vanished event type or dead overtime zeroes a floor on EVERY
 *     candidate pair, so the pair search exhausts by construction.
 *   otseek — the scanned phenomenon (reaching OT) is luck-shaped by
 *     design; the MECHANISM the consuming test asserts (crunch rides
 *     starters at the OT tip, H-02) is asserted per pinned game by the
 *     test itself, which the confirmation run executes — a crunch
 *     collapse reddens it and the helper restores (managed failure).
 *     Dead overtime exhausts the scan.
 *   tocap — hard guard: ONE late-Q4 spend on ANY scanned 0-cap arm is
 *     impossible with enforcement intact (canSpend returns false at cap 0
 *     unconditionally) and REFUSES as mechanism collapse. Without it the
 *     scan proposes seeds whose 0-cap arm is clean by draw luck and
 *     attests a cap that no longer exists (review #88's laundering
 *     mutant).
 *   leakout — hard guards on the fresh scout: the flip must at least
 *     double the staged arm, and the staged premise must survive
 *     (mechanism-shape observations, not rarity thresholds).
 *   mcEdge — aggregate guard: the scan's own candidates-times-sims reads
 *     separate a healthy strength edge (mean homeWinProb ~0.87) from a
 *     strength-blind engine (~0.5, which lucks single candidates past the
 *     0.7 qualification gate often enough to launder) by ~10 sigma; a
 *     mean below 0.65 REFUSES.
 *   pbpGame — the floor is existence (> 0 lead/tie moments); a dead
 *     tracker or wire-to-wire flow zeroes every candidate and the scan
 *     exhausts. Narrated-content correctness is the consuming tests' job
 *     (they run in confirmation).
 *
 * CONFIRMATION SCOPE + EXIT CODES. The confirmation run executes the six
 * consuming FILES in full and classifies failures against the pins'
 * surface. Any managed failure restores the fixtures and exits 1.
 * Failures matching ONLY the KNOWN_UNMANAGED registry (co-resident
 * seed-coupled tests this helper does not anchor) also restore by
 * default; under --keep-unmanaged-red they keep the re-anchor and exit 2,
 * loudly listing the out-of-coverage tax to hand-fix and commit together.
 * Exit 0 is reserved for a fully green confirmation. Unrecognized failure
 * names classify as MANAGED — fail-safe: a renamed managed test can never
 * be tolerated by mistake.
 *
 * Determinism: scans run fixed candidate ranges in a fixed order over a
 * deterministic engine, so two runs on the same commit propose byte-
 * identical anchors (only the generatedAt/anchoredAt dates are wall-clock;
 * measured by review #88 — equal blob hashes on all three files).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateGame, type GameResult, type TeamSide } from '@hoopsh/engine';
import { cascadiaBreakers, sampleMatchup } from '@hoopsh/data';
import { ContextTracker } from '@hoopsh/narration';
import { checkFlags } from './args.js';
import { simulateMatchup } from './matchup.js';
import { scaleTeam } from './league.js';
import { SEED_PINS as ENGINE_PINS } from '../../engine/test/seed-pins.gen.js';
import { SEED_PINS as HARNESS_PINS } from '../test/seed-pins.gen.js';
import { SEED_PINS as NARRATION_PINS } from '../../narration/test/seed-pins.gen.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** the three generated anchor files this helper owns, and the test files
 *  that consume them (the confirmation-run set) */
const PIN_FILES = {
  engine: path.join(ROOT, 'packages', 'engine', 'test', 'seed-pins.gen.ts'),
  harness: path.join(ROOT, 'packages', 'harness', 'test', 'seed-pins.gen.ts'),
  narration: path.join(ROOT, 'packages', 'narration', 'test', 'seed-pins.gen.ts')
} as const;

const CONSUMING_TESTS = [
  'packages/engine/test/events.test.ts',
  'packages/engine/test/subs.test.ts',
  'packages/engine/test/timeouts.test.ts',
  'packages/engine/test/leakout.test.ts',
  'packages/harness/test/season.test.ts',
  'packages/narration/test/pbp.test.ts'
];

/** Seed-coupled tests that live INSIDE the consuming files but are NOT
 *  anchored by any pin here (co-resident pins). A burn-class rng change
 *  can redden them while every managed pin re-anchors cleanly — that red
 *  is out-of-coverage re-anchor tax, not a helper failure. Failures
 *  matching ONLY these names may keep the re-anchor (exit 2) under
 *  --keep-unmanaged-red; anything unrecognized restores, so a renamed
 *  managed test can never be tolerated by mistake. A registry, not a
 *  tolerance: entries are added deliberately, each naming what it is. */
const KNOWN_UNMANAGED: ReadonlyArray<{ name: string; why: string }> = [
  {
    name: 'is RANKED best-first: winPct desc, diff desc, id asc — who is FIRST',
    why: 'season.test.ts standings pin — its tieTierRuns floor (b9-F6) rides the pinned schedule DRAW, a pin family this helper does not anchor yet (uncovered tax; see the #50 PR follow-up list)'
  }
];

// The proposed post-re-anchor state, seeded from the committed anchors.
// Searches mutate these; render() serializes them back to the .gen.ts files.
const engineState = structuredClone(ENGINE_PINS);
const harnessState = structuredClone(HARNESS_PINS);
const narrationState = structuredClone(NARRATION_PINS);

/** anchoredAt stamp for moved pins — metadata in a comment-grade string,
 *  never an input to any simulation (the no-Date rule is an ENGINE rule) */
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- rendering

// This header must stay byte-identical to the committed .gen.ts headers:
// the render is full-file, so any drift here churns every future diff.
const GEN_HEADER = `/**
 * GENERATED by the seed-pin re-anchor helper — DO NOT HAND-EDIT.
 * Verify anchors / re-anchor after an rng-order change:
 *
 *   node --disable-warning=ExperimentalWarning --import ./tools/register.mjs packages/harness/src/reanchor.ts [--write]
 *
 * Seed-pin anchors: the seeds (and scout-derived floors) whose streams
 * currently exhibit the phenomena the consuming tests assert. Anchors are
 * rng-order-COUPLED by design (AGENTS.md §1.2: adding, removing, or
 * reordering any rng call reshuffles every stream), so a legitimate
 * rng-order change may strand them — the consuming tests' vacuity floors
 * then trip LOUDLY, and the fix is a re-scout, never a weakened floor
 * (AGENTS.md §1.6; issue #50). The helper re-scouts stranded anchors per
 * each pin's documented doctrine, rewrites this file, and re-runs the
 * consuming tests; review the diff it produces. The diff of this file IS
 * the re-anchor record (register W54/W56 tracked these re-anchors by hand).
 */

export const SEED_PINS = `;

function render(state: object): string {
  return GEN_HEADER + JSON.stringify(state, null, 2) + ';\n';
}

// ------------------------------------------------------------ pin plumbing

/** anchored: full doctrine holds; degraded: the consuming test would still
 *  pass but the anchor's own doctrine margin is gone (the next reshuffle's
 *  stranding); stranded: the consuming test would fail */
type PinState = 'anchored' | 'degraded' | 'stranded';

interface PinOutcome {
  state: PinState;
  detail: string;
}

/** thrown by a search that exhausted its scan or tripped a mechanism
 *  guard — the phenomenon looks GONE, not reshuffled; never write past it */
class Refusal extends Error {}

interface Pin {
  id: string;
  consumer: string;
  verify(): Promise<PinOutcome>;
  /** re-scout and mutate the proposed state; returns the report line */
  search(): Promise<string>;
}

const progress = (label: string, i: number, n: number): void => {
  process.stdout.write(`  ${label} ${i}/${n}\r`);
};

// ------------------------------------------------- pin 1: evstream pool

/** counted per game, summed across the pool — every numeric floor the
 *  events.test.ts suite puts on the pinned pool, plus violations/reviews
 *  for slot-stat reporting. MIRRORS events.test.ts: a floor edit there must
 *  land here too (the --write confirmation run catches a miss loudly). */
interface EvCounts {
  tiedEnds: number; otPeriods: number; defWon: number; offWon: number;
  misses: number; madeTwos: number; madeThrees: number; assisted: number;
  blocked: number; shots: number; fouled: number; andOnes: number;
  stealStarts: number; multiTrips: number; techs: number; offensives: number;
  lost: number; neverSteal: number; charges: number; fouls: number;
  fts: number; violations: number; reviews: number;
}

interface EvFeatures {
  seed: string;
  overtime: boolean;
  /** the two per-game (not pooled) floors: >100 possessions opened and
   *  >5 distinct personal-foulers */
  perGameOk: boolean;
  c: EvCounts;
  eventTypes: Set<string>;
  passKinds: Set<string>;
}

/** the 18 event types the pinned pool must emit at least once (mirrors the
 *  events.test.ts vacuity list; held_ball/off_goaltend are deliberately
 *  absent there too — their floors are officiating.test.ts's job) */
const EVSTREAM_EVENT_TYPES = [
  'game_start', 'tip_off', 'period_start', 'period_end', 'game_end',
  'possession_start', 'possession_end', 'pass', 'shot', 'free_throw',
  'rebound', 'turnover', 'foul', 'timeout', 'substitution',
  'jump_ball', 'violation', 'replay_review'
];

const EVSTREAM_PASS_KINDS = ['normal', 'kickout', 'outlet', 'entry', 'handoff'];

/** pooled numeric floors, mirrored from events.test.ts (strict `>` floors
 *  are encoded as min = floor + 1) */
const EVSTREAM_FLOORS: ReadonlyArray<{ what: string; min: number; get: (c: EvCounts) => number }> = [
  { what: 'tied period_end at/after regulation', min: 1, get: (c) => c.tiedEnds },
  { what: 'overtime periods', min: 1, get: (c) => c.otPeriods },
  { what: 'DEFENSE-won mid-game jump balls', min: 1, get: (c) => c.defWon },
  { what: 'OFFENSE-won mid-game jump balls', min: 1, get: (c) => c.offWon },
  { what: 'missed shots', min: 20, get: (c) => c.misses },
  { what: 'made twos', min: 20, get: (c) => c.madeTwos },
  { what: 'made threes', min: 5, get: (c) => c.madeThrees },
  { what: 'assisted makes', min: 10, get: (c) => c.assisted },
  { what: 'blocked shots', min: 5, get: (c) => c.blocked },
  { what: 'shot events', min: 101, get: (c) => c.shots },
  { what: 'fouled shots', min: 5, get: (c) => c.fouled },
  { what: 'and-ones', min: 1, get: (c) => c.andOnes },
  { what: 'steal-kind possession starts', min: 5, get: (c) => c.stealStarts },
  { what: 'multi-attempt FT trips', min: 10, get: (c) => c.multiTrips },
  { what: 'technical fouls', min: 1, get: (c) => c.techs },
  { what: 'offensive fouls', min: 2, get: (c) => c.offensives },
  { what: 'lost_ball turnovers', min: 5, get: (c) => c.lost },
  { what: 'never-steal turnover kinds', min: 5, get: (c) => c.neverSteal },
  { what: 'charges (off_foul turnovers)', min: 2, get: (c) => c.charges },
  { what: 'foul events', min: 31, get: (c) => c.fouls },
  { what: 'free throws', min: 31, get: (c) => c.fts }
];

/** the header-documented scan pool for evstream anchors */
const EVSTREAM_SCAN_MAX = 240;

function evFeatures(seed: string): EvFeatures {
  const { home, away } = sampleMatchup();
  const r = simulateGame({ seed, home, away, collectFrames: false });
  const c: EvCounts = {
    tiedEnds: 0, otPeriods: 0, defWon: 0, offWon: 0, misses: 0, madeTwos: 0,
    madeThrees: 0, assisted: 0, blocked: 0, shots: 0, fouled: 0, andOnes: 0,
    stealStarts: 0, multiTrips: 0, techs: 0, offensives: 0, lost: 0,
    neverSteal: 0, charges: 0, fouls: 0, fts: 0, violations: 0, reviews: 0
  };
  const eventTypes = new Set<string>();
  const passKinds = new Set<string>();
  const foulers = new Set<string>();
  let opened = 0;
  let open: TeamSide | null = null;
  let maxPeriod = 1;
  let tripLen = 0;
  for (const e of r.events) {
    eventTypes.add(e.type);
    if (e.period > maxPeriod) maxPeriod = e.period;
    switch (e.type) {
      case 'possession_start':
        opened++;
        open = e.team;
        if (e.kind === 'steal') c.stealStarts++;
        break;
      case 'possession_end':
        open = null;
        break;
      case 'period_end':
        if (e.period >= r.rules.periods && e.score[0] === e.score[1]) c.tiedEnds++;
        break;
      case 'jump_ball':
        // both tie-up sites are live-ball, so `open` is a team here; the
        // offense keeping the tap continues the SAME possession
        if (e.winner === open) c.offWon++; else c.defWon++;
        break;
      case 'pass':
        passKinds.add(e.kind);
        break;
      case 'shot':
        c.shots++;
        if (!e.made) c.misses++;
        else if (e.three) c.madeThrees++;
        else c.madeTwos++;
        if (e.assist !== undefined) c.assisted++;
        if (e.blockedBy !== undefined) c.blocked++;
        if (e.foul) {
          c.fouled++;
          if (e.foul.andOne) c.andOnes++;
        }
        break;
      case 'free_throw':
        c.fts++;
        if (e.n === 1) tripLen = 1;
        else {
          tripLen++;
          if (tripLen === 2) c.multiTrips++; // count each multi-trip once
        }
        break;
      case 'turnover':
        if (e.kind === 'lost_ball') c.lost++;
        else if (e.kind !== 'bad_pass') c.neverSteal++;
        if (e.kind === 'off_foul') c.charges++;
        break;
      case 'foul':
        c.fouls++;
        if (e.kind === 'technical') c.techs++;
        else {
          if (e.kind === 'offensive') c.offensives++;
          foulers.add(e.on); // techs excluded, mirroring the personal chain
        }
        break;
      case 'violation':
        c.violations++;
        break;
      case 'replay_review':
        c.reviews++;
        break;
      default:
        break;
    }
  }
  c.otPeriods = Math.max(0, maxPeriod - r.rules.periods);
  return {
    seed,
    overtime: maxPeriod > r.rules.periods,
    perGameOk: opened >= 101 && foulers.size >= 6,
    c, eventTypes, passKinds
  };
}

function poolCounts(a: EvCounts, b: EvCounts): EvCounts {
  const out = { ...a };
  for (const k of Object.keys(out) as Array<keyof EvCounts>) out[k] = a[k] + b[k];
  return out;
}

/** failing pooled floors + missing types/kinds for a candidate pair */
function evFailures(reg: EvFeatures, ot: EvFeatures): string[] {
  const pooled = poolCounts(reg.c, ot.c);
  const bad: string[] = [];
  for (const f of EVSTREAM_FLOORS) {
    const got = f.get(pooled);
    if (got < f.min) bad.push(`${f.what}: ${got} < ${f.min}`);
  }
  for (const t of EVSTREAM_EVENT_TYPES) {
    if (!reg.eventTypes.has(t) && !ot.eventTypes.has(t)) bad.push(`event type ${t} absent`);
  }
  for (const k of EVSTREAM_PASS_KINDS) {
    if (!reg.passKinds.has(k) && !ot.passKinds.has(k)) bad.push(`pass kind ${k} absent`);
  }
  if (!reg.perGameOk) bad.push(`${reg.seed}: per-game floors (possessions/foulers) fail`);
  if (!ot.perGameOk) bad.push(`${ot.seed}: per-game floors (possessions/foulers) fail`);
  return bad;
}

/** minimum actual/floor ratio across the pooled numeric floors — the
 *  pair-selection score (widest worst-case headroom survives the most
 *  reshuffle luck; the same instinct picked "the most centered draw" for
 *  the season suite's mc-even anchor) */
function evHeadroom(reg: EvFeatures, ot: EvFeatures): number {
  const pooled = poolCounts(reg.c, ot.c);
  let min = Infinity;
  for (const f of EVSTREAM_FLOORS) {
    const ratio = f.get(pooled) / f.min;
    if (ratio < min) min = ratio;
  }
  return min;
}

const slotStats = (f: EvFeatures): string =>
  `${f.seed} — ${f.overtime ? 'overtime' : 'regulation'}; ${f.c.defWon} def-won + ` +
  `${f.c.offWon} off-won jumps, ${f.c.offensives} offensive fouls, ${f.c.techs} technicals, ` +
  `${f.c.violations} violations, ${f.c.reviews} replay reviews`;

const evstreamPin: Pin = {
  id: 'evstreamPool',
  consumer: 'packages/engine/test/events.test.ts',
  verify: async () => {
    const reg = evFeatures(engineState.evstreamPool.regulation);
    const ot = evFeatures(engineState.evstreamPool.overtime);
    const bad = evFailures(reg, ot);
    if (bad.length > 0) return { state: 'stranded', detail: bad.join('; ') };
    if (reg.overtime || !ot.overtime) {
      return {
        state: 'degraded',
        detail: `slot semantics broken (regulation slot ${reg.overtime ? 'plays OT' : 'ok'}, ` +
          `overtime slot ${ot.overtime ? 'ok' : 'plays regulation'}) — floors still hold pooled`
      };
    }
    return { state: 'anchored', detail: `floors hold, min headroom ${evHeadroom(reg, ot).toFixed(2)}x` };
  },
  search: async () => {
    const regs: EvFeatures[] = [];
    const ots: EvFeatures[] = [];
    for (let i = 1; i <= EVSTREAM_SCAN_MAX; i++) {
      progress('evstream scan', i, EVSTREAM_SCAN_MAX);
      const f = evFeatures(`evstream-${i}`);
      if (!f.perGameOk) continue;
      (f.overtime ? ots : regs).push(f);
    }
    process.stdout.write('\n');
    let best: { reg: EvFeatures; ot: EvFeatures; headroom: number } | null = null;
    let closest: { reg: EvFeatures; ot: EvFeatures; missing: number } | null = null;
    for (const reg of regs) {
      for (const ot of ots) {
        const bad = evFailures(reg, ot);
        if (bad.length === 0) {
          const headroom = evHeadroom(reg, ot);
          if (best === null || headroom > best.headroom) best = { reg, ot, headroom };
        } else if (closest === null || bad.length < closest.missing) {
          closest = { reg, ot, missing: bad.length };
        }
      }
    }
    if (best === null) {
      const diag = closest === null
        ? `no qualifying candidates at all (${regs.length} regulation, ${ots.length} overtime games scanned)`
        : `closest pair ${closest.reg.seed}+${closest.ot.seed} still misses: ${evFailures(closest.reg, closest.ot).join('; ')}`;
      throw new Refusal(
        `evstream: no pair in evstream-1..${EVSTREAM_SCAN_MAX} clears the pooled floors — ${diag}. ` +
        'A phenomenon no seed exhibits any more is a genuine regression, not seed luck; investigate before touching any pin.'
      );
    }
    const from = `${engineState.evstreamPool.regulation}+${engineState.evstreamPool.overtime}`;
    engineState.evstreamPool.regulation = best.reg.seed;
    engineState.evstreamPool.overtime = best.ot.seed;
    engineState.evstreamPool.provenance =
      `re-anchored ${TODAY} by the helper (scanned evstream-1..${EVSTREAM_SCAN_MAX}; the qualifying pair with the ` +
      `widest minimum floor headroom, ${best.headroom.toFixed(2)}x). ${slotStats(best.reg)}. ${slotStats(best.ot)}.`;
    return `evstreamPool: ${from} -> ${best.reg.seed}+${best.ot.seed} (min floor headroom ${best.headroom.toFixed(2)}x)`;
  }
};

// ------------------------------------------------ pin 2: otseek (H-02)

/** Scan doctrine: fixed order from otseek-0, stop at the anchor width.
 *  The CEILING sits deliberately far above the width: measured healthy OT
 *  density is ~2%, so the old fixed 0..300 pool carried a MEAN of ~6 OT
 *  games and refused healthy engines on reshuffle luck — a coin flip per
 *  vintage (review #88 measured 5 under its burn where #75's hand scan
 *  had found 7). 1200 candidates carry a healthy mean of ~24; fewer than
 *  6 there is ~5 sigma below every anchor era and reads as dead-or-dying
 *  overtime, not luck. Early stop keeps the healthy-path cost at roughly
 *  the old scan's (the sixth hit lands near seed ~300 at 2%). Ceiling is
 *  FEEL — sized for refusal-safety margin, not statistically fit. */
const OTSEEK_SCAN_CEILING = 1200;
const OTSEEK_WIDTH = 6;

const reachesOt = (seed: string): boolean => {
  const { home, away } = sampleMatchup();
  const r = simulateGame({ seed, home, away, collectFrames: false });
  return r.events.some((e) => e.period > r.rules.periods);
};

const otseekPin: Pin = {
  id: 'otseek',
  consumer: 'packages/engine/test/subs.test.ts (audit H-02)',
  verify: async () => {
    let ot = 0;
    for (const seed of engineState.otseek.seeds) if (reachesOt(seed)) ot++;
    const detail = `${ot}/${engineState.otseek.seeds.length} pinned seeds reach OT`;
    if (ot === engineState.otseek.seeds.length) return { state: 'anchored', detail };
    if (ot >= 2) return { state: 'degraded', detail: `${detail} — the test floor (>= 2) still holds; doctrine is 6/6` };
    return { state: 'stranded', detail };
  },
  search: async () => {
    const found: string[] = [];
    let last = 0;
    for (let i = 0; i <= OTSEEK_SCAN_CEILING && found.length < OTSEEK_WIDTH; i++) {
      progress('otseek scan', i, OTSEEK_SCAN_CEILING);
      if (reachesOt(`otseek-${i}`)) found.push(`otseek-${i}`);
      last = i;
    }
    process.stdout.write('\n');
    if (found.length < OTSEEK_WIDTH) {
      throw new Refusal(
        `otseek: only ${found.length}/${OTSEEK_WIDTH} OT games in otseek-0..${OTSEEK_SCAN_CEILING} — healthy OT density ` +
        '(~2%) puts ~24 in that pool, so overtime has become drastically rarer than any anchor era. ' +
        'Investigate the engine change first.'
      );
    }
    const from = engineState.otseek.seeds.join(', ');
    engineState.otseek.seeds = found;
    engineState.otseek.provenance =
      `re-anchored ${TODAY} by the helper (scanned otseek-0..${last} of the 0..${OTSEEK_SCAN_CEILING} ceiling, first ` +
      `${OTSEEK_WIDTH} OT-reaching seeds — the H-02 doctrine; hand-anchor trail in the subs.test.ts header). ` +
      '6/6 reach overtime at anchor; the test floor is >= 2.';
    return `otseek: [${from}] -> [${found.join(', ')}]`;
  }
};

// -------------------------------------------------------- pin 3: to-cap

/** MIRRORS timeouts.test.ts MAND.endgame — the forced-live mandatory/cap
 *  dials the to-cap fixtures pin their own params to. A drift between the
 *  two is caught by the --write confirmation run, loudly. */
const TOCAP_ENDGAME = {
  toMandatoryFirstBelowSec: 419,
  toMandatorySecondBelowSec: 179,
  toFinalPeriodMaxTimeouts: 4,
  toFinalPeriodLateMaxTimeouts: 2,
  toOvertimeTimeouts: 2
};

/** scouted to-cap-1..16 historically; widened once mechanical so a thin
 *  qualifying rate cannot exhaust the scan */
const TOCAP_SCAN_MAX = 32;
const TOCAP_WIDTH = 2;

/** both arms of one candidate, read once: late-Q4 spends under the
 *  control cap (2) and the 0-cap, plus the 0-cap arm's Q1-Q3 spends */
interface TocapRead { ctlLate: number; capLate: number; capEarly: number }

function tocapRead(seed: string): TocapRead {
  const { home, away } = sampleMatchup();
  const mk = (late: number): GameResult => simulateGame({
    seed, home, away, collectFrames: false,
    params: { endgame: { ...TOCAP_ENDGAME, toFinalPeriodLateMaxTimeouts: late } }
  });
  const lateQ4 = (r: GameResult): number =>
    r.events.filter((e) => e.type === 'timeout' && e.period === 4 && e.clock <= 180).length;
  const ctl = mk(2);
  const cap = mk(0);
  return {
    ctlLate: lateQ4(ctl),
    capLate: lateQ4(cap),
    capEarly: cap.events.filter((e) => e.type === 'timeout' && e.period <= 3).length
  };
}

/** ctl (late cap 2) spends late in Q4 at least once, the 0-cap arm spends
 *  nothing there and still spends >= 4 in Q1-Q3 — the consuming test's
 *  exact qualification */
const tocapQualifies = (r: TocapRead): boolean =>
  r.ctlLate >= 1 && r.capLate === 0 && r.capEarly >= 4;

/** The cap-collapse discriminator (review #88's blocking finding). With
 *  enforcement intact a 0-cap arm can never spend late: canSpend's late
 *  branch returns false at cap 0 unconditionally, so this is an
 *  impossible-on-healthy observation (the leakout guards' shape), not a
 *  rarity threshold. ONE late spend on ANY scanned candidate proves the
 *  cap no longer blocks. Without this guard the scan quietly DISCARDS
 *  leaking candidates as non-qualifying, finds seeds whose 0-cap arm is
 *  clean by draw luck, and writes a provenance string attesting a
 *  mechanism that is gone — mechanized invariant-weakening (AGENTS §1.6). */
function tocapCollapseGuard(seed: string, r: TocapRead): void {
  if (r.capLate > 0) {
    throw new Refusal(
      `tocap: the 0-cap arm spent ${r.capLate} late-Q4 timeout${r.capLate === 1 ? '' : 's'} on ${seed} — impossible ` +
      'with cap enforcement intact (canSpend returns false at cap 0). The late cap no longer blocks spending: ' +
      'mechanism collapse, not seed luck — do not re-anchor; investigate sim/endgame.ts first.'
    );
  }
}

const tocapPin: Pin = {
  id: 'tocap',
  consumer: 'packages/engine/test/timeouts.test.ts',
  verify: async () => {
    const reads = engineState.tocap.seeds.map((s) => [s, tocapRead(s)] as const);
    const leak = reads.find(([, r]) => r.capLate > 0);
    if (leak !== undefined) {
      return {
        state: 'stranded',
        detail: `the 0-cap arm SPENT LATE on ${leak[0]} (${leak[1].capLate}) — cap-collapse evidence, impossible ` +
          'with enforcement intact; a --write will REFUSE, not re-anchor'
      };
    }
    const bad = reads.filter(([, r]) => !tocapQualifies(r)).map(([s]) => s);
    if (bad.length === 0) {
      return { state: 'anchored', detail: `${engineState.tocap.seeds.length}/${engineState.tocap.seeds.length} seeds qualify` };
    }
    return { state: 'stranded', detail: `not qualifying: ${bad.join(', ')}` };
  },
  search: async () => {
    const found: string[] = [];
    for (let i = 1; i <= TOCAP_SCAN_MAX && found.length < TOCAP_WIDTH; i++) {
      progress('to-cap scan', i, TOCAP_SCAN_MAX);
      const seed = `to-cap-${i}`;
      const r = tocapRead(seed);
      // collapse evidence outranks qualification: a leaking candidate is
      // never "just skipped" — it is the proof the mechanism is gone
      tocapCollapseGuard(seed, r);
      if (tocapQualifies(r)) found.push(seed);
    }
    process.stdout.write('\n');
    if (found.length < TOCAP_WIDTH) {
      throw new Refusal(
        `tocap: only ${found.length}/${TOCAP_WIDTH} qualifying seeds in to-cap-1..${TOCAP_SCAN_MAX} with every scanned ` +
        '0-cap arm clean (the collapse guard above did not trip) — control games no longer spend late, or early ' +
        'timeouts dried up. A mechanism regression on the control side; investigate first.'
      );
    }
    const from = engineState.tocap.seeds.join(', ');
    engineState.tocap.seeds = found;
    engineState.tocap.provenance =
      `re-anchored ${TODAY} by the helper (scanned to-cap-1..${TOCAP_SCAN_MAX}, first ${TOCAP_WIDTH} qualifying). ` +
      'Qualification per seed: the control arm (late cap 2) spends >= 1 late-Q4 timeout, the 0-cap arm spends none there and still spends >= 4 in Q1-Q3.';
    return `tocap: [${from}] -> [${found.join(', ')}]`;
  }
};

// ------------------------------------------------------- pin 4: leakout

/** the fixed leakout pool + the signature counter, MIRRORING
 *  leakout.test.ts (windowSec 6, <=3 ft, athlete gate 0.6*vertical +
 *  0.4*finishing >= 74, split by the possession's start kind) */
const LEAKOUT_POOL = Array.from({ length: 24 }, (_, i) => `leakout-${i + 1}`);

function leakSignatures(g: GameResult): { transition: number; opener: number } {
  const traits = new Map<string, { vertical: number; finishing: number }>();
  for (const t of g.teams) for (const p of t.players) traits.set(p.id, p.attr);
  const gate = (id: string): boolean => {
    const a = traits.get(id);
    return !!a && 0.6 * a.vertical + 0.4 * a.finishing >= 74;
  };
  let transition = 0;
  let opener = 0;
  let possT = 0;
  let possKind = '';
  for (const e of g.events) {
    if (e.type === 'possession_start') { possT = e.t; possKind = e.kind; continue; }
    if (e.type !== 'shot' || e.distFt > 3 || e.t - possT > 6) continue;
    if (!gate(e.shooter)) continue;
    if (possKind === 'live_rebound' || possKind === 'steal') transition += 1;
    else opener += 1;
  }
  return { transition, opener };
}

interface LeakScout { sTrans: number; lTrans: number; sOpen: number; lOpen: number }

function leakoutScout(): LeakScout {
  const arm = (scale: number, label: string): { trans: number; open: number } => {
    let trans = 0;
    let open = 0;
    LEAKOUT_POOL.forEach((seed, i) => {
      progress(`leakout ${label} arm`, i + 1, LEAKOUT_POOL.length);
      const { home, away } = sampleMatchup();
      const g = simulateGame({ seed, home, away, params: { ai: { leakOutScale: scale } } });
      const s = leakSignatures(g);
      trans += s.transition;
      open += s.opener;
    });
    return { trans, open };
  };
  const staged = arm(0, 'staged');
  const live = arm(1, 'live');
  process.stdout.write('\n');
  return { sTrans: staged.trans, lTrans: live.trans, sOpen: staged.open, lOpen: live.open };
}

// carried from verify to search so the 48-game scout runs once per invocation
let leakScoutCache: LeakScout | null = null;

const leakoutPin: Pin = {
  id: 'leakout',
  consumer: 'packages/engine/test/leakout.test.ts',
  verify: async () => {
    const s = leakScoutCache ?? (leakScoutCache = leakoutScout());
    const f = engineState.leakout.floors;
    const detail = `scout: staged ${s.sTrans} / live ${s.lTrans} transition signatures, openers ${s.sOpen}/${s.lOpen}; ` +
      `floors ${f.stagedVacuityMin}/+${f.liveRiseMin}/slack ${f.openerSlack}`;
    const ok = s.sTrans >= f.stagedVacuityMin && s.lTrans >= s.sTrans + f.liveRiseMin && s.lOpen <= s.sOpen + f.openerSlack;
    return ok ? { state: 'anchored', detail } : { state: 'stranded', detail };
  },
  search: async () => {
    const s = leakScoutCache ?? (leakScoutCache = leakoutScout());
    // Mechanism guards — floors move ONLY for seed-luck reshuffles, never to
    // chase a weakened mechanism (AGENTS §1.6). Both bars are FEEL, sitting
    // far under the original scout (+517% flip, 24 staged) and far above
    // reshuffle noise.
    if (s.lTrans < 2 * s.sTrans) {
      throw new Refusal(
        `leakout: the flip no longer at least doubles the staged arm (staged ${s.sTrans}, flipped ${s.lTrans}; the ` +
        'original scout read +517%). That is mechanism collapse, not seed luck — do not re-anchor; investigate.'
      );
    }
    if (s.sTrans < 6) {
      throw new Refusal(
        `leakout: the staged-arm premise collapsed (${s.sTrans} transition signatures, a quarter of the original ` +
        '24-signature scout) — the leak-signature phenomenon itself moved; investigate before re-anchoring.'
      );
    }
    const floors = {
      // the leakout.test.ts header's documented safety shape: vacuity ~60%
      // of the staged scout, rise ~a third of the measured gap
      stagedVacuityMin: Math.round(0.6 * s.sTrans),
      liveRiseMin: Math.round((s.lTrans - s.sTrans) / 3),
      openerSlack: engineState.leakout.floors.openerSlack // FEEL, carried
    };
    const from = `scout ${engineState.leakout.scout.stagedTransition}/${engineState.leakout.scout.liveTransition}, ` +
      `floors ${engineState.leakout.floors.stagedVacuityMin}/+${engineState.leakout.floors.liveRiseMin}`;
    engineState.leakout.scout = { stagedTransition: s.sTrans, liveTransition: s.lTrans, stagedOpener: s.sOpen, liveOpener: s.lOpen };
    engineState.leakout.floors = floors;
    engineState.leakout.provenance =
      `re-scouted ${TODAY} by the helper over the fixed pool leakout-1..24: staged arm ${s.sTrans} transition leak ` +
      `signatures, flipped arm ${s.lTrans} (openers ${s.sOpen}/${s.lOpen}). Floors at the documented safety shape ` +
      '(vacuity ~60% of the staged scout, rise ~1/3 of the gap); openerSlack is FEEL and carries unchanged across re-anchors.';
    return `leakout: ${from} -> scout ${s.sTrans}/${s.lTrans}, floors ${floors.stagedVacuityMin}/+${floors.liveRiseMin}`;
  }
};

// ------------------------------------------------------- pin 5: mc-edge

/** the season suite's lopsided Monte-Carlo fixture: STRONG (+8) over WEAK
 *  (-8) at 30 sims, MIRRORING season.test.ts */
const MC_EDGE_N = 30;
const MC_EDGE_CANDIDATES = ['mc-edge', ...Array.from({ length: 11 }, (_, i) => `mc-edge${i + 2}`)];

interface McEdgeRead { homeWinProb: number; ciLo: number; meanMargin: number }

async function mcEdgeRead(seedBase: string): Promise<McEdgeRead> {
  const strong = scaleTeam(cascadiaBreakers(), 8, 'strong');
  const weak = scaleTeam(cascadiaBreakers(), -8, 'weak');
  const d = await simulateMatchup(strong, weak, MC_EDGE_N, { seedBase });
  return { homeWinProb: d.homeWinProb, ciLo: d.ci95[0], meanMargin: d.meanMargin };
}

const mcEdgeQualifies = (r: McEdgeRead): boolean =>
  r.homeWinProb > 0.7 && r.ciLo > 0.5 && r.meanMargin > 0;

const mcEdgePin: Pin = {
  id: 'mcEdge',
  consumer: 'packages/harness/test/season.test.ts',
  verify: async () => {
    const r = await mcEdgeRead(harnessState.mcEdge.seedBase);
    const detail = `winProb ${r.homeWinProb.toFixed(3)}, ci lo ${r.ciLo.toFixed(3)}, mean margin ${r.meanMargin.toFixed(1)}`;
    return mcEdgeQualifies(r) ? { state: 'anchored', detail } : { state: 'stranded', detail };
  },
  search: async () => {
    let best: { seedBase: string; r: McEdgeRead } | null = null;
    const winProbs: number[] = [];
    for (let i = 0; i < MC_EDGE_CANDIDATES.length; i++) {
      const seedBase = MC_EDGE_CANDIDATES[i]!;
      progress('mc-edge scan', i + 1, MC_EDGE_CANDIDATES.length);
      const r = await mcEdgeRead(seedBase);
      winProbs.push(r.homeWinProb);
      // pick-best, not first-qualifying: the widest winProb headroom
      // survives the most reshuffle luck (the mc-even4 hand-scan precedent)
      if (mcEdgeQualifies(r) && (best === null || r.homeWinProb > best.r.homeWinProb)) best = { seedBase, r };
    }
    process.stdout.write('\n');
    // Strength-collapse discriminator (review #88 doctrine audit): a
    // strength-blind engine reads ~0.5 here and single candidates luck
    // past the 0.7 qualification gate ~2% of the time each — enough,
    // across the whole candidate list, to launder a dead edge into a
    // written anchor. The MEAN across every scanned candidate separates a
    // healthy edge (~0.85-0.90 measured at every anchor era) from
    // coin-flip play by ~10 sigma at candidates x sims reads, so a mean
    // below 0.65 is mechanism collapse, not reshuffle luck. Threshold is
    // FEEL — centered between the regimes with wide margin on both sides.
    const meanWinProb = winProbs.reduce((a, b) => a + b, 0) / winProbs.length;
    if (meanWinProb < 0.65) {
      throw new Refusal(
        `mcEdge: mean homeWinProb ${meanWinProb.toFixed(3)} across ${MC_EDGE_CANDIDATES.length} scanned bases x ` +
        `${MC_EDGE_N} sims — a uniformly +8 team no longer beats a -8 team reliably ANYWHERE in the pool` +
        `${best === null ? '' : ` (one base lucked past the gate: ${best.seedBase} at ${best.r.homeWinProb.toFixed(3)})`}. ` +
        'Strength sensitivity has collapsed; re-anchoring would attest a mechanism that is gone — investigate first.'
      );
    }
    if (best === null) {
      throw new Refusal(
        `mcEdge: no scanned seed base (${MC_EDGE_CANDIDATES.length} candidates x ${MC_EDGE_N} sims) reads a uniformly ` +
        '+8 team clearly above 50% vs a -8 team. That is a strength-sensitivity regression, not seed luck — do not re-anchor.'
      );
    }
    const from = harnessState.mcEdge.seedBase;
    harnessState.mcEdge.seedBase = best.seedBase;
    harnessState.mcEdge.provenance =
      `re-anchored ${TODAY} by the helper (scanned ${MC_EDGE_CANDIDATES.length} seed bases x ${MC_EDGE_N} sims; picked the ` +
      `qualifying base with the highest homeWinProb: ${best.r.homeWinProb.toFixed(3)}, ci lo ${best.r.ciLo.toFixed(3)}, ` +
      `mean margin ${best.r.meanMargin.toFixed(1)}). Qualification: homeWinProb > 0.7, Wilson ci95 lower bound > 0.5, meanMargin > 0.`;
    return `mcEdge: ${from} -> ${best.seedBase} (winProb ${best.r.homeWinProb.toFixed(3)})`;
  }
};

// ------------------------------------------------------- pin 6: pbp game

/** the narration probe game: the M-37 broadcast test needs a stream with
 *  at least one lead change or tie; richer is safer, so search maximizes */
const PBP_SCAN_MAX = 64;

function pbpLeadOrTie(seed: string): number {
  const { home, away } = sampleMatchup();
  const r = simulateGame({ seed, home, away, collectFrames: false });
  const tracker = new ContextTracker(4); // 4 = NBA period count, as in the test
  let n = 0;
  for (const e of r.events) {
    for (const m of tracker.update(e)) {
      if (m.kind === 'lead_change' || m.kind === 'tie') n++;
    }
  }
  return n;
}

const pbpPin: Pin = {
  id: 'pbpGame',
  consumer: 'packages/narration/test/pbp.test.ts (M-37)',
  verify: async () => {
    const n = pbpLeadOrTie(narrationState.pbpGame.seed);
    const detail = `${n} lead/tie moments on the anchor stream`;
    return n > 0 ? { state: 'anchored', detail } : { state: 'stranded', detail };
  },
  search: async () => {
    let bestSeed = '';
    let bestN = 0;
    for (let i = 1; i <= PBP_SCAN_MAX; i++) {
      progress('pbp scan', i, PBP_SCAN_MAX);
      const n = pbpLeadOrTie(`pbp-${i}`);
      if (n > bestN) { bestN = n; bestSeed = `pbp-${i}`; }
    }
    process.stdout.write('\n');
    if (bestN === 0) {
      throw new Refusal(
        `pbpGame: zero lead changes or ties across pbp-1..${PBP_SCAN_MAX} — score flow has gone wire-to-wire ` +
        'everywhere, which is a gameplay regression, not seed luck. Do not re-anchor.'
      );
    }
    const from = narrationState.pbpGame.seed;
    narrationState.pbpGame.seed = bestSeed;
    narrationState.pbpGame.provenance =
      `re-anchored ${TODAY} by the helper (scanned pbp-1..${PBP_SCAN_MAX}; picked the lead/tie-richest stream: ` +
      `${bestN} moments). The M-37 floor is > 0 lead/tie moments.`;
    return `pbpGame: ${from} -> ${bestSeed} (${bestN} lead/tie moments)`;
  }
};

// ------------------------------------------------------------------- main

const PINS: Pin[] = [evstreamPin, otseekPin, tocapPin, leakoutPin, mcEdgePin, pbpPin];

interface Confirmation { green: boolean; failing: string[] }

/** Run the six consuming files; on red, collect the failing TEST names
 *  from node --test's flat "failing tests" summary so main() can classify
 *  them managed vs KNOWN_UNMANAGED. Output is captured (not streamed) and
 *  re-printed in full — the classification needs the text. */
function confirmationRun(): Confirmation {
  console.log('\nconfirmation: re-running the consuming test files…');
  const res = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--import', path.join(ROOT, 'tools', 'register.mjs'),
    '--test', ...CONSUMING_TESTS.map((f) => path.join(ROOT, f))
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // typed string via encoding, but a spawn-level failure leaves these
  // empty/undefined at runtime — truthy checks cover both shapes
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  const failing: string[] = [];
  let inSummary = false;
  for (const line of (res.stdout || '').split('\n')) {
    if (line.includes('✖ failing tests:')) { inSummary = true; continue; }
    if (!inSummary) continue;
    // summary rows read "✖ <name> (<duration>ms)" — anchor on the trailing
    // duration so names containing " (" still parse whole
    const m = line.match(/✖ (.+) \([\d.]+m?s\)\s*$/);
    if (m !== null && m[1] !== undefined) failing.push(m[1]);
  }
  return { green: res.status === 0, failing: [...new Set(failing)] };
}

/** the whole flag surface. The export is STAGED for cli-flag-guard
 *  coverage (that test imports each CLI's allow-list so vocabulary and
 *  reads cannot drift; wiring it up is the flag-coverage follow-up) —
 *  the const itself is consumed by checkFlags below. */
export const REANCHOR_CLI_FLAGS = ['--write', '--keep-unmanaged-red'] as const;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  checkFlags(argv, REANCHOR_CLI_FLAGS);
  const write = argv.includes('--write');
  const keepUnmanagedRed = argv.includes('--keep-unmanaged-red');
  if (keepUnmanagedRed && !write) {
    console.error('--keep-unmanaged-red modifies the --write confirmation only; pass it together with --write');
    process.exit(1);
  }
  const t0 = performance.now();

  const stale: Pin[] = [];
  for (const pin of PINS) {
    const o = await pin.verify();
    console.log(`${o.state.toUpperCase().padEnd(8)} ${pin.id} (${pin.consumer}) — ${o.detail}`);
    if (o.state !== 'anchored') stale.push(pin);
  }
  const secs = (): string => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

  if (stale.length === 0) {
    console.log(`\nall ${PINS.length} pins anchored — nothing to re-anchor (${secs()})`);
    return;
  }
  if (!write) {
    console.error(
      `\n${stale.length} pin${stale.length === 1 ? '' : 's'} need${stale.length === 1 ? 's' : ''} re-anchoring (${secs()}).\n` +
      'If this follows a deliberate rng-order change: re-run with --write, review the seed-pins.gen.ts diffs, and commit them with the change.\n' +
      'If the engine was not supposed to change behavior: the change is wrong — fix it, do not re-anchor.'
    );
    process.exit(1);
  }

  const report: string[] = [];
  for (const pin of stale) {
    console.log(`\nre-scouting ${pin.id}…`);
    try {
      report.push(await pin.search());
    } catch (e) {
      if (e instanceof Refusal) {
        console.error(`\nREFUSED — ${e.message}`);
        console.error('No file was written. A pin that cannot be re-anchored guards a phenomenon that is GONE; re-anchoring around it would weaken the suite (AGENTS §1.6).');
        process.exit(1);
      }
      throw e;
    }
  }

  // all-or-nothing write, with the originals kept for restore-on-red
  const originals = new Map<string, string>();
  const states: Array<[string, object]> = [
    [PIN_FILES.engine, engineState],
    [PIN_FILES.harness, harnessState],
    [PIN_FILES.narration, narrationState]
  ];
  for (const [file, state] of states) {
    const next = render(state);
    const prev = readFileSync(file, 'utf8');
    if (next === prev) continue;
    (state as { meta: { generatedAt: string } }).meta.generatedAt = TODAY;
    originals.set(file, prev);
    writeFileSync(file, render(state));
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }

  const conf = confirmationRun();
  if (!conf.green) {
    const isUnmanaged = (n: string): boolean => KNOWN_UNMANAGED.some((u) => u.name === n);
    const managed = conf.failing.filter((n) => !isUnmanaged(n));
    const unmanaged = conf.failing.filter(isUnmanaged);
    const unmanagedLines = (): void => {
      for (const n of unmanaged) {
        const u = KNOWN_UNMANAGED.find((k) => k.name === n)!;
        console.error(`  ✖ ${n}`);
        console.error(`    ${u.why}`);
      }
    };
    if (managed.length === 0 && unmanaged.length > 0 && keepUnmanagedRed) {
      console.error('\nCONFIRMATION RED — out-of-coverage only. Every managed-pin surface is green; the failures are co-resident pins this helper does not anchor:');
      unmanagedLines();
      console.error(
        '\nThe seed-pins files were KEPT (--keep-unmanaged-red). The tree is NOT green: re-anchor the tests above ' +
        'by hand and commit everything together. Exit 2 marks this partial state — it is never a full success.'
      );
      process.exitCode = 2;
    } else {
      for (const [file, prev] of originals) writeFileSync(file, prev);
      console.error(
        '\nCONFIRMATION RED — the re-scouted anchors satisfy their scout predicates but the consuming tests still fail.'
      );
      if (managed.length > 0) {
        console.error('Managed failures (the pins\' own surface — a floor moved in a test without a matching predicate here, or the engine change broke a pinned MECHANISM, not just seed luck):');
        for (const n of managed) console.error(`  ✖ ${n}`);
      }
      if (unmanaged.length > 0) {
        console.error('Out-of-coverage failures (co-resident pins this helper does not anchor):');
        unmanagedLines();
      }
      if (conf.failing.length === 0) {
        console.error('(no per-test names parsed from the runner output — treating the red as managed)');
      }
      console.error(
        'The seed-pins files were restored untouched; investigate before re-anchoring.' +
        (managed.length === 0 && unmanaged.length > 0
          ? ' If the out-of-coverage list above is the WHOLE story, --keep-unmanaged-red keeps the re-anchor (exit 2) so the rest can be hand-fixed and committed together.'
          : '')
      );
      process.exit(1);
    }
  }

  console.log(`\nre-anchored ${report.length} pin${report.length === 1 ? '' : 's'} (${secs()}):`);
  for (const line of report) console.log(`  ${line}`);
  console.log('\nreview the seed-pins.gen.ts diffs and commit them together with the rng-order change.');
}

await main();
