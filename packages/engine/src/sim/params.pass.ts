/**
 * SimParams block `pass` — turnover-risk logit, steal/OOB split, delivery
 * quality.
 *
 * Split out of sim/params.ts (#36): this module owns the block's interface,
 * calibrated defaults, and machine-readable per-knob provenance. The composed
 * surface (SimParams, defaultParams, paramProvenance, withParams) and the
 * reading guide for these numbers (logits, units, coupling) stay in
 * sim/params.ts. Values and comments moved verbatim at the split; provenance
 * tag meanings and adjudication rules live in params.provenance.ts.
 */

import type { Provenance } from './params.provenance.js';

export interface PassParams {
  /** base turnover logit for a normal pass (negative = rare) */
  riskBase: number;
  /** added risk when a defender sits in the passing lane (per unit occlusion) */
  laneRiskCoef: number;
  /** risk reduction from passer vision/accuracy */
  skillCoef: number;
  /** share of failed passes that are steals (rest go out of bounds) */
  stealShare: number;
  /** flat ball speed, ft/s */
  speedFtS: number;
  /** passing-lane danger envelope: defenders within this radius of the line threaten the pass */
  laneDangerFt: number;
  /** damping factor when multiple defenders are in the lane — prevents stacking to certainty */
  laneOcclusionDamp: number;
  /** lane-hazard floor for a rating-0 steal defender (anyone in the lane is a hazard; scales to 1.0 at rating 100) */
  laneStealFloor: number;
  /** total lane occlusion saturates here before the laneRiskCoef multiply */
  laneOcclusionCap: number;
  /** long-pass length threshold; beyond this each extra 10 ft adds longPassPer10Ft logits */
  longPassFt: number;
  /** logit risk added per 10 ft of pass length beyond longPassFt */
  longPassPer10Ft: number;

  /** receiver lead: the pass targets where a moving receiver WILL be,
   *  this many seconds of his current velocity ahead */
  leadSec: number;
  /** a failing pass is undercooked: it dies this uniform share of the way
   *  from passer to lead target (in a defender's range, not teleported) */
  failShortLo: number;
  failShortHi: number;
  /** flight-distance floor, ft: a point-blank pass still takes a tick or
   *  two to arrive */
  minFlightFt: number;
}

export const passDefaults: PassParams = {
  // Base turnover logit for an unpressured pass ≈ 2.3%: passes are
  // mostly safe, and turnovers come from the lane-occlusion term below.
  // This is the primary lever on league TOV/game (band 11.5-15.5).
  // History: -4.1869 → -3.95 (W16 directed search) → -3.6 (FLOW landing,
  // knot-combo §2: absorbed excess fga into tov; that -3.6 "fragility
  // wall" was measured in the pre-probe, pre-concept-12 engine) → -3.75
  // (session-7 re-price, the W19/W69 successor arc): with the probe LIVE
  // and the pass-flight clock charge pricing delivery honestly, the wall
  // moved. Dose grid at n=96 on the acceptance base: +0.107 passes/poss;
  // θ preserved on both w19 cohorts at n=1080; favorite-win -3.0 (inside
  // the pre-registered -4.0 line that KILLED the deeper -3.82 cell);
  // assist hierarchy intact (SGA-led, top-3 share flat); OOS 17/17 with
  // all four previously-registered marginals back in band. Full record:
  // the session-7 register row. Sweep-owned, rails [-4.1, -3.7]
  // (narrowed at the same landing — see knobs.ts).
  riskBase: -3.75,
  // A defender sitting in the passing lane is the real turnover cause:
  // full occlusion adds 1.6 logits (~1.7% → ~8%). SWEPT.
  laneRiskCoef: 1.6,
  // Vision/accuracy reduce risk; an elite passer roughly halves it. SWEPT.
  skillCoef: 0.75,
  // Of failed passes, ~57% are stolen (credited to a defender) and the rest
  // sail out of bounds. Splits the TOV total into STL vs dead-ball. SWEPT;
  // re-swept at the FLOW landing (f-assembly §3 round 1) after the
  // officiating take-window suppressed the transition-steal channel.
  stealShare: 0.5685795471373496,
  // Ball speed in flight, ft/s. A 25 ft pass takes ~0.55 s, long enough
  // that a cutter's timing and a defender's recovery both matter. REAL-ish.
  speedFtS: 45,
  // Pass-lane danger model — how defenders in the lane are weighted.
  //   laneDangerFt: reach-plus-step envelope; beyond it a defender can't
  //     intercept this pass. FEEL.
  //   laneOcclusionDamp: caps how much multiple loose defenders stack
  //     against a single pass — prevents deterministic TOs in a crowd. FEEL.
  laneDangerFt: 6,           // FEEL — roughly arm's length plus a step
  laneOcclusionDamp: 0.6,    // FEEL — damping factor per lane defender
  // Lane-hazard shaping, hoisted from inline resolve.ts passRisk literals
  // per this file's header rule (turnover-path numbers belong here):
  //   laneStealFloor — a rating-0 defender standing in the lane is still
  //     half the hazard of a 100-rated ball-hawk (who scales to 1.0). FEEL.
  //   laneOcclusionCap — total occlusion saturates here before the
  //     laneRiskCoef multiply. Numerically equal to laneRiskCoef's 1.6
  //     today by COINCIDENCE, not coupling — sweeping laneRiskCoef never
  //     moved this cap when it was inline, and it doesn't now. FEEL.
  laneStealFloor: 0.5,
  laneOcclusionCap: 1.6,
  // Long-pass risk: a skip pass hangs in the air, buying defenders time.
  //   Beyond 25 ft each extra 10 ft adds 0.12 logits (~3 pp TO rate). FEEL.
  longPassFt: 25,            // FEEL — cross-court skip distance threshold
  longPassPer10Ft: 0.12,     // FEEL — logit per 10 ft beyond longPassFt

  // Delivery geometry (were inline in passing.ts startPass, audit H-01 —
  // they shape flight time and where failed passes land, so they feed the
  // turnover/steal path):
  //   leadSec — throw to where a moving receiver WILL be: a quarter second
  //     of his current velocity ("lead like you'd expect a decent passer
  //     to", not a measured reaction-time constant). FEEL.
  //   failShortLo/Hi — an undercooked pass dies 35-70% of the way from the
  //     passer to the lead target: in a defender's range without
  //     teleporting the ball to him. FEEL.
  //   minFlightFt — a point-blank pass still flies ≥ 3 ft so it takes a
  //     tick or two to arrive instead of resolving instantly. FEEL.
  leadSec: 0.25,
  failShortLo: 0.35,
  failShortHi: 0.7,
  minFlightFt: 3
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const passProvenance: Record<keyof PassParams, Provenance> = {
  riskBase: 'SWEPT',
  laneRiskCoef: 'SWEPT',
  skillCoef: 'SWEPT',
  stealShare: 'SWEPT',
  speedFtS: 'REAL',
  laneDangerFt: 'FEEL',
  laneOcclusionDamp: 'FEEL',
  laneStealFloor: 'FEEL',
  laneOcclusionCap: 'FEEL',
  longPassFt: 'FEEL',
  longPassPer10Ft: 'FEEL',
  leadSec: 'FEEL',
  failShortLo: 'FEEL',
  failShortHi: 'FEEL',
  minFlightFt: 'FEEL'
};
