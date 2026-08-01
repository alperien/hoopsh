/**
 * SimParams — THE calibration surface.
 *
 * Every tunable BEHAVIORAL constant in the engine lives on this surface — one
 * flat, serializable object, composed from the per-block params.<block>.ts
 * modules (#36). Nothing else in the engine may hardcode a constant that
 * affects outcomes: the harness sweeps this object (`npm run sweep`) against
 * real NBA acceptance bands, so a number hidden elsewhere is a number the
 * optimizer cannot reach.
 *
 * THE ONE EXCEPTION — cosmetic/replay-only positioning. A handful of constants
 * that place bodies for the REPLAY and nothing else stay inline where they're
 * used: the dead-ball freeze spots (possession.ts setupDeadTargets), the
 * free-throw lane alignment (fouls.ts enterFreeThrows), and similar "looks
 * plausible" geometry. No probability, EV, rate, or timing model reads them —
 * they move pixels in the viewer, not outcomes — so they are deliberately NOT
 * on the sweep surface (a knob the optimizer can't affect the bands with is
 * noise in the search space). Each such site says so in a comment. If you find
 * an inline number that feeds a make/foul/turnover/rebound/decision path, that
 * IS a bug against this rule — move it here.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW TO READ THESE NUMBERS
 *
 * 1. LOGITS, not probabilities. Every outcome resolves as
 *        P = sigmoid(base + Σ modifier terms)
 *    so a `base*` value is log-odds. Handy conversions:
 *        logit  -2.6  -1.0  -0.85  -0.5   0.0   +0.4  +0.6  +1.0
 *        P       7%    27%    30%   38%   50%    60%   65%   73%
 *    A base is calibrated to mean "league-average player, league-average
 *    contest" — because rating influence enters as n(rating) ∈ [-1,+1] which
 *    is exactly 0 at rating 50 (see model/derived.ts).
 *
 * 2. UNITS. Distances are FEET, times are SECONDS, speeds ft/s, rates are
 *    per-tick or per-second as named. Nothing here is in pixels or meters.
 *
 * 3. UTILITIES (the `ai` block) are in EXPECTED POINTS. The decision layer
 *    compares "expected points if I shoot now" against "expected points if we
 *    keep working" (`continuationMax`), so a bias of 0.1 means "worth a tenth
 *    of a point" — that is the scale to think in when nudging these.
 *
 * 4. PROVENANCE. Values fall into three kinds. Each block module carries a
 *    machine-readable per-knob map (`<block>Provenance`, composed here as
 *    `paramProvenance`; a test enforces coverage), and the comments say why:
 *      • REAL — a measured basketball fact (free-throw % ≈ 71-78% league-wide).
 *      • SWEPT — found by the optimizer hunting the 17 acceptance bands. These
 *        carry odd precision (0.485, 1.449) precisely because a machine chose
 *        them; do not "tidy" them without re-running the sweep.
 *      • FEEL — hand-set for plausible motion/timing, not statistically
 *        constrained (mostly the `move`, windup, and dead-ball timings).
 *
 * 5. COUPLING WARNING. These knobs are NOT independent. Foul rates feed shot
 *    EV (a foul is worth free throws), which changes shot selection, which
 *    changes pace and shot mix. Historical example: raising `foul.shootRim`
 *    from 0.475 to 0.5 collapsed the league three-point rate from ~38% to 30%
 *    because every player suddenly preferred driving. ALWAYS re-verify with
 *    `npm run batch` / `npm run sweep` after touching anything here.
 *
 * Layering (see ARCHITECTURE.md §2):
 *   global SimParams  -> league realism (this file)
 *   rating curves     -> player differentiation (model/derived.ts)
 *   era packs (later) -> historical overrides on top
 * ────────────────────────────────────────────────────────────────────────────
 * MAP OF THE SURFACE — eleven blocks, one module each (params.<block>.ts,
 * split per #36). Each module holds the block's interface (docs live there),
 * its calibrated defaults (the provenance narrative lives there), and its
 * machine-readable per-knob provenance map (params.provenance.ts defines the
 * tags). This file composes them into the one flat SimParams surface: the
 * interface, `defaultParams`, `paramProvenance`, and `withParams`, the
 * merge/validation boundary that closes the file.
 *   shot         make-chance logits per zone + skill/contest/fatigue coefficients
 *   foul         whistle rates (shooting, reach-in, charge, loose-ball) and FTs
 *   pass         turnover-risk logit, steal/OOB split, delivery quality
 *   reb          rebound positioning weights, putbacks, dead-ball caroms
 *   decide       decision cadence, continuation curve, appetites, temperature
 *   move         speeds, transition/advance definitions, dead-ball timing
 *   fatigue      energy drain and bench recovery rates
 *   sub          rotation thresholds, crunch/concede regimes, minutes controller
 *   endgame      the flag-gated endgame layer's dials (GameConfig.endgame)
 *   officiating  non-foul whistle texture: jump balls, goaltends, travels,
 *                techs, take fouls, kicked balls, replay reviews
 *   ai           EXPECTED-POINTS utility weights: concept master scales, shot
 *                selection, drive, pass, screens/actions, the closed usage loop
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { Provenance } from './params.provenance.js';
import { type ShotParams, shotDefaults, shotProvenance } from './params.shot.js';
import { type FoulParams, foulDefaults, foulProvenance } from './params.foul.js';
import { type PassParams, passDefaults, passProvenance } from './params.pass.js';
import { type RebParams, rebDefaults, rebProvenance } from './params.reb.js';
import { type DecideParams, decideDefaults, decideProvenance } from './params.decide.js';
import { type MoveParams, moveDefaults, moveProvenance } from './params.move.js';
import { type FatigueParams, fatigueDefaults, fatigueProvenance } from './params.fatigue.js';
import { type SubParams, subDefaults, subProvenance } from './params.sub.js';
import { type EndgameParams, endgameDefaults, endgameProvenance } from './params.endgame.js';
import { type OfficiatingParams, officiatingDefaults, officiatingProvenance } from './params.officiating.js';
import { type AiParams, aiDefaults, aiProvenance } from './params.ai.js';

export type { Provenance } from './params.provenance.js';

export interface SimParams {
  tickHz: number;
  frameEvery: number; // record a replay frame every N ticks

  shot: ShotParams;
  foul: FoulParams;
  pass: PassParams;
  reb: RebParams;
  decide: DecideParams;
  move: MoveParams;
  fatigue: FatigueParams;
  sub: SubParams;
  endgame: EndgameParams;
  officiating: OfficiatingParams;
  ai: AiParams;
}

export const defaultParams: SimParams = {
  // 10 Hz: fine enough that a 28 ft/s sprinter moves <3 ft per tick (smooth
  // motion, accurate contests), coarse enough for a >= 1 game/sec budget (hardware-dependent, ~3-6 typical). FEEL.
  tickHz: 10,
  // one replay frame per 2 ticks = 5 Hz: the viewer interpolates between them,
  // and it halves replay size (~1.8 MB/game). FEEL.
  frameEvery: 2,

  shot: shotDefaults,
  foul: foulDefaults,
  pass: passDefaults,
  reb: rebDefaults,
  decide: decideDefaults,
  move: moveDefaults,
  fatigue: fatigueDefaults,
  sub: subDefaults,
  endgame: endgameDefaults,
  officiating: officiatingDefaults,
  ai: aiDefaults
};

/** structural mirror of SimParams: a Provenance tag at every numeric leaf */
type ProvenanceMap<T> = { [K in keyof T]: T[K] extends number ? Provenance : ProvenanceMap<T[K]> };

/**
 * Machine-readable provenance for every knob on the surface, composed from
 * the per-block maps. This is what turns AGENTS.md DO-NOT rule 1 ("do not
 * tidy SWEPT values") from an honor system into a checkable property:
 * test/params-provenance.test.ts asserts every defaultParams leaf carries a
 * tag, so tooling can flag a diff that touches a SWEPT value without a
 * sweep. tickHz/frameEvery are tagged here because they live on the
 * composed surface itself, not in a block module (both FEEL, per their
 * comments above).
 */
export const paramProvenance: ProvenanceMap<SimParams> = {
  tickHz: 'FEEL',
  frameEvery: 'FEEL',
  shot: shotProvenance,
  foul: foulProvenance,
  pass: passProvenance,
  reb: rebProvenance,
  decide: decideProvenance,
  move: moveProvenance,
  fatigue: fatigueProvenance,
  sub: subProvenance,
  endgame: endgameProvenance,
  officiating: officiatingProvenance,
  ai: aiProvenance
};

/** deep-merge partial overrides onto defaults (for experiments & era packs) */
export function withParams(overrides?: DeepPartial<SimParams>): SimParams {
  if (!overrides) return structuredClone(defaultParams);
  // SimParams has no index signature (deliberate — fixed keys catch typos),
  // so the generic merge goes through unknown at this one boundary.
  const merged = deepMerge(
    structuredClone(defaultParams) as unknown as Record<string, unknown>,
    overrides as Record<string, unknown>
  ) as unknown as SimParams;
  // FRAME MONOTONICITY (audit M-16): replay frame rows stamp wallT at ONE
  // decimal (game.ts recordFrame round1), so the wall-clock frame step
  // frameEvery/tickHz must be at least 0.1 s or successive frames collapse
  // onto duplicate timestamps — a legal-looking { tickHz: 30, frameEvery: 2 }
  // (step 0.067 s) silently broke the strictly-increasing frame-time
  // contract the viewer/replay layer keys on. deepMerge above already
  // rejects non-finite numbers; non-positive values would make the step
  // arithmetic meaningless (and a non-positive tick makes the game itself
  // unrunnable), so both are rejected here at the config boundary rather
  // than 29k ticks later in a consumer.
  if (merged.tickHz <= 0 || merged.frameEvery <= 0) {
    throw new Error(
      `withParams: tickHz (${merged.tickHz}) and frameEvery (${merged.frameEvery}) must be positive`
    );
  }
  if (merged.frameEvery / merged.tickHz < 0.1 - 1e-9) {
    throw new Error(
      `withParams: frame step frameEvery/tickHz = ${(merged.frameEvery / merged.tickHz).toFixed(4)} s ` +
      `is below the 0.1 s frame-timestamp resolution — frames would collapse onto duplicate ` +
      `timestamps (replay contract); raise frameEvery or lower tickHz`
    );
  }
  return merged;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  path = ''
): Record<string, unknown> {
  for (const key of Object.keys(patch)) {
    // Unknown keys fail loudly. TypeScript already rejects typos for typed
    // callers, but sweep/solve/era-pack overrides are built dynamically at
    // runtime — a typo'd path there used to be silently merged in and then
    // read by nothing, so the "experiment" measured the unmodified engine
    // while reporting the knob as applied. Same fail-loud doctrine as
    // simulateGame's rating validation.
    if (!(key in base)) {
      throw new Error(`withParams: unknown SimParams key "${path}${key}" — not a field of defaultParams (typo?)`);
    }
    const b = base[key];
    const p = patch[key];
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      // GROUP keys take plain-object overrides only. null, arrays, and
      // scalars used to fall through to the leaf branch and REPLACE the
      // whole group ({ shot: null } merged clean, then detonated seconds
      // into the sim as an unattributed read of undefined — audit M-17).
      // Same fail-loud-at-the-boundary doctrine as the key/value checks.
      if (p === undefined) continue;
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        throw new Error(
          `withParams: SimParams group "${path}${key}" must be a plain-object override, got ` +
          (p === null ? 'null' : Array.isArray(p) ? 'an array' : typeof p)
        );
      }
      deepMerge(b as Record<string, unknown>, p as Record<string, unknown>, `${path}${key}.`);
    } else if (p !== undefined) {
      // VALUES fail loudly too, not just keys: every SimParams leaf is a
      // finite number, and a NaN accepted here used to detonate minutes
      // later as an unattributed "Rng.weighted: non-finite weight" naming
      // no field — the ratings boundary names its offender; this boundary
      // now does the same (c4-F4).
      if (typeof b === 'number' && (typeof p !== 'number' || !Number.isFinite(p))) {
        throw new Error(`withParams: SimParams value "${path}${key}" = ${String(p)} must be a finite number`);
      }
      base[key] = p;
    }
  }
  return base;
}
