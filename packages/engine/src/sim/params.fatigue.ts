/**
 * SimParams block `fatigue` — energy drain and bench recovery rates.
 *
 * Split out of sim/params.ts (#36): this module owns the block's interface,
 * calibrated defaults, and machine-readable per-knob provenance. The composed
 * surface (SimParams, defaultParams, paramProvenance, withParams) and the
 * reading guide for these numbers (logits, units, coupling) stay in
 * sim/params.ts. Values and comments moved verbatim at the split; provenance
 * tag meanings and adjudication rules live in params.provenance.ts.
 */

import type { Provenance } from './params.provenance.js';

export interface FatigueParams {
  drainPerSec: number;
  sprintDrainMult: number;
  recoverPerSecBench: number;
  /** speed multiplier at zero energy */
  minSpeedMult: number;
  // --- cumulative load ("legs", fdesign-rhythm M1; wired STAGED, live
  // since the FLOW flip). A
  // second pool that trends across the game where energy sawtooths per
  // stint; consumed by resolution only (movement.ts effectiveEnergy into
  // the resolve.ts shot-fatigue/speed terms, the foul.load*Swing
  // couplings, and concepts.ts deadGameBoost, all wired per ffit-rhythm
  // §8). loadPerSec is the
  // stage switch: at 0 the pool provably stays 0 and the engine is
  // byte-identical.
  /** on-court load accrual per second (same effort/stamina chain as
   *  drainPerSec). Live at the 0.011 design seed (REAL-fit: a starter
   *  reaches load ~33-38 at Q4 crunch after ~31 min; sweepable,
   *  knobs range 0.006-0.018) */
  loadPerSec: number;
  /** bench load recovery per second. FEEL: a 4-min sit restores ~5, so
   *  legs stay heavy within a half (off the sweep surface: shape) */
  loadRecoverPerSecBench: number;
  /** the halftime lump (possession.ts endPeriod). REAL: the locker room;
   *  a partial reset keeping Q3 pace near Q1's (+0.16 s/poss real) while
   *  the load-driven foul gradient persists (off-surface: shape) */
  loadHalftimeRecover: number;
}

export const fatigueDefaults: FatigueParams = {
  // Energy units per second on the floor (scale 0-100). At ~0.055/s a
  // starter drops from 100 toward the sub threshold over a ~6-8 minute
  // stint — which is what produces realistic NBA rotation patterns. FEEL.
  drainPerSec: 0.055,
  // Sprinting costs up to 2.4× the resting drain (scaled by actual speed).
  // Note stamina rating also scales this in movement.ts. FEEL.
  sprintDrainMult: 2.4,
  // Bench recovery is ~10× faster than drain: a few minutes off restores a
  // player, matching real rotation cadence. FEEL.
  recoverPerSecBench: 0.55,
  // Even at zero energy a player still moves at 82% speed — exhaustion
  // degrades, it doesn't cripple. FEEL.
  minSpeedMult: 0.82,
  // Cumulative load (fdesign-rhythm M1), live since the FLOW flip.
  // 0.011 is the REAL-fit design seed, confirmed on the ladder
  // 0.0077/0.011/0.0143 (ffit-rhythm §2: 0.011 vs 0.0143
  // indistinguishable at n=240). The pool switch: it also arms the
  // foul.loadReachSwing/loadShootSwing legs. Registered [0.006, 0.018].
  loadPerSec: 0.011,
  loadRecoverPerSecBench: 0.02, // FEEL: a 4-min sit restores ~5 pts of legs
  loadHalftimeRecover: 12 // REAL: the locker room's partial reset
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const fatigueProvenance: Record<keyof FatigueParams, Provenance> = {
  drainPerSec: 'FEEL',
  sprintDrainMult: 'FEEL',
  recoverPerSecBench: 'FEEL',
  minSpeedMult: 'FEEL',
  loadPerSec: 'REAL',
  loadRecoverPerSecBench: 'FEEL',
  loadHalftimeRecover: 'REAL'
};
