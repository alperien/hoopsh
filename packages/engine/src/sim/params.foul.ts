/**
 * SimParams block `foul` — whistle rates (shooting, reach-in, charge,
 * loose-ball) and FTs.
 *
 * Split out of sim/params.ts (#36): this module owns the block's interface,
 * calibrated defaults, and machine-readable per-knob provenance. The composed
 * surface (SimParams, defaultParams, paramProvenance, withParams) and the
 * reading guide for these numbers (logits, units, coupling) stay in
 * sim/params.ts. Values and comments moved verbatim at the split; provenance
 * tag meanings and adjudication rules live in params.provenance.ts.
 */

import type { Provenance } from './params.provenance.js';

export interface FoulParams {
  /** shooting foul chance by zone at average contest/drawFoul */
  shootRim: number;
  shootPaint: number;
  shootMid: number;
  shootThree: number;
  /** multiplier range from contest tightness (tight contests foul more) */
  contestFactor: number;
  /** foul-drawing craft swing: elite drawFoul draws this much more, per n() */
  drawFoulSwing: number;
  /** defender foulAggr swing: a max-aggression defender fouls this much more */
  foulAggrSwing: number;
  /** hard cap on any single shooting-foul probability */
  shootFoulCap: number;
  /** chance per second of on-ball pressure that a reach-in occurs */
  reachInPerSec: number;
  /** reach-in rate multiplier while the holder is driving or backing down */
  attackReachInMult: number;
  /** gambleSteal swing on the per-tick reach-in rate */
  reachInGambleSwing: number;
  /** hand-check range for a reach-in: tight normally, gather-range while attacking */
  reachDistFt: number;
  attackReachDistFt: number;
  /** clean-strip share model: base ± steal/ballHandle swings, clamped */
  stripBase: number;
  stripStealSwing: number;
  stripHandleSwing: number;
  stripMin: number;
  stripMax: number;
  /** added clean-strip share on attacking reach-ins (pokes at the gather) */
  attackStripBonus: number;
  /** offensive foul (charge) chance per drive */
  chargePerDrive: number;
  /** per-tick multiplier folded into the charge roll (chargePerDrive × dt × this) */
  chargeTickMult: number;
  /** loose-ball foul chance per contested rebound */
  looseBallPerReb: number;
  // --- cumulative-load foul couplings (fdesign-rhythm §3.2 sites 5-6,
  // wired per ffit-rhythm §8). Heavy legs foul more: slower recovery
  // means more reaching, late contests arrive in the body. Both are
  // multipliers of the form 1 + swing × load/100 and are exactly ×1
  // while fatigue.loadPerSec is 0 (load provably stays 0, the M1 stage
  // switch); live since the FLOW flip at loadPerSec 0.011.
  /** organic reach-in rate swing per full load (passing.ts
   *  attemptReachIn; hunt/take grabs are coach orders, unscaled).
   *  REAL-fit seed; knobs range 0.6-2.0 at the flip bake */
  loadReachSwing: number;
  /** shooting-foul swing per full load of the contesting defender
   *  (resolve.ts shootingFoulP, inside the shootFoulCap clamp).
   *  REAL-fit seed; knobs range 0.2-0.9 at the flip bake */
  loadShootSwing: number;
}

export const foulDefaults: FoulParams = {
  // Shooting-foul probability per attempt, at average contest and average
  // drawFoul. Steeply zone-dependent, like real officiating: contact at the
  // rim is whistled constantly, a jump shot almost never. These four values
  // are the primary lever on league FTA/game (band: 18-27). SWEPT — and
  // the most coupling-sensitive knobs in the file (see header point 5).
  // Re-fit at the FLOW flip (ffit-rhythm): with the cumulative-load pool
  // live, the loadShootSwing leg multiplies these, so the whole mix was
  // re-centered (shootRim ×1.3 from the pre-flip point).
  shootRim: 0.51974,
  shootPaint: 0.16952,
  shootMid: 0.065,
  shootThree: 0.0156,
  // Tight contests foul more: multiplier scales 1.0 (uncontested) → 1.6
  // (smothered). Ties foul rate to defensive aggression. FEEL.
  contestFactor: 1.6,
  // Shooting-foul craft swings (were inline in resolve.ts shootingFoulP):
  // an elite foul-drawer earns ~65% more whistles, a max-aggression
  // defender fouls ~50% more, and no single attempt exceeds a 60% foul
  // chance (hack-a-Shaq still leaves a clean-play chance). FEEL.
  drawFoulSwing: 0.65,
  foulAggrSwing: 0.5,
  shootFoulCap: 0.6,
  // Per second of on-ball pressure inside ~4 ft. Over a possession this
  // yields the handful of reach-ins a real game produces. Hand-fit at the
  // FLOW landing (knot-combo §2): the rhythm fit cut it ×0.62, which broke
  // fga/pace; raising organic reach is the one pace-positive fga absorber,
  // with the endgame hunt and take mults rescaled to hold their products
  // constant. Flow-shape ceiling near ~0.016 at loadReachSwing 1.3
  // (knot-combo §5.1). Sweep-owned, rails [0.008, 0.026].
  reachInPerSec: 0.01585,
  // FEEL: power dribbles expose the ball; attack volume pays a live-ball
  // turnover tax (drives and post backdowns)
  attackReachInMult: 3.4,
  // gambleSteal swing on the per-tick reach-in rate; hand-check ranges (tight
  // normally, gather-range while attacking). FEEL — were inline in passing.ts
  // attemptReachIn.
  reachInGambleSwing: 0.85,
  reachDistFt: 4.2,
  attackReachDistFt: 5.5,
  // Clean-strip share once a reach-in happens: base, +steal / -ballHandle
  // swings, clamped so the best/worst matchup still has a real chance either
  // way. FEEL — were inline in passing.ts attemptReachIn's stripP.
  stripBase: 0.3,
  stripStealSwing: 0.3,
  stripHandleSwing: 0.22,
  stripMin: 0.08,
  stripMax: 0.85,
  attackStripBonus: 0.25,
  // Offensive-foul (charge) rate while a drive is committed. NAME TRAP:
  // despite "per drive", game.ts tickLive consumes this per TICK
  // (chargePerDrive × dt × chargeTickMult) — an effective rate per SECOND
  // of committed drive time, so the realized league rate rides on drive
  // EXPOSURE, not drive count. At the old 0.012 that produced 4.4-4.8
  // charges per team-game (calibration-integration fouls diagnosis,
  // n=288 team-games) vs ~1.3 real NBA offensive fouls per team-game and
  // vs the prior comment's own "deliberately rare" intent — the
  // third-largest whistle category and ~30% of all turnovers (every
  // charge is an off_foul turnover). FEEL→REAL: hand-set to land the
  // real rate (post-change measured 1.16/1.31/1.28 per team-game on
  // three 16-game seed bases at current drive exposure). Previously
  // tagged SWEPT but never registered in harness/knobs.ts (unsweepable
  // in practice); registered there now, so the coordinated sweep owns it.
  // SWEPT at the FLOW landing (f-assembly §3 round 2).
  chargePerDrive: 0.006244936149189068,
  // Per-tick multiplier folded into the charge roll (game.ts tickLive:
  // chargePerDrive × dt × this). FEEL — the ×2 was an inline literal.
  chargeTickMult: 2,
  // Loose-ball fouls per contested rebound scramble. SWEPT.
  looseBallPerReb: 0.03573869267120509,
  // Load foul couplings (ffit-rhythm §2 REAL-fit seeds), armed since the
  // FLOW flip (fatigue.loadPerSec 0.011). Registered in knobs.ts
  // ([0.6, 2.0] / [0.2, 0.9]). knot-combo §5.1: only the ORGANIC reach
  // branch carries the loadReachSwing legs, so these swings set how
  // Q4-heavy reach fouls run; trading loadReachSwing down against
  // reachInPerSec up is the unexplored G7-shape lever.
  loadReachSwing: 1.7706909623782483,
  loadShootSwing: 0.5
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const foulProvenance: Record<keyof FoulParams, Provenance> = {
  shootRim: 'SWEPT',
  shootPaint: 'SWEPT',
  shootMid: 'SWEPT',
  shootThree: 'SWEPT',
  contestFactor: 'FEEL',
  drawFoulSwing: 'FEEL',
  foulAggrSwing: 'FEEL',
  shootFoulCap: 'FEEL',
  reachInPerSec: 'FEEL',
  attackReachInMult: 'FEEL',
  reachInGambleSwing: 'FEEL',
  reachDistFt: 'FEEL',
  attackReachDistFt: 'FEEL',
  stripBase: 'FEEL',
  stripStealSwing: 'FEEL',
  stripHandleSwing: 'FEEL',
  stripMin: 'FEEL',
  stripMax: 'FEEL',
  attackStripBonus: 'FEEL',
  chargePerDrive: 'SWEPT',
  chargeTickMult: 'FEEL',
  looseBallPerReb: 'SWEPT',
  loadReachSwing: 'SWEPT',
  loadShootSwing: 'REAL'
};
