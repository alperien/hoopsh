/**
 * SimParams block `officiating` — non-foul whistle texture rates (jump balls,
 * goaltends, travels, techs, takes, kicked balls, reviews).
 *
 * Split out of sim/params.ts (#36): this module owns the block's interface,
 * calibrated defaults, and machine-readable per-knob provenance. The composed
 * surface (SimParams, defaultParams, paramProvenance, withParams) and the
 * reading guide for these numbers (logits, units, coupling) stay in
 * sim/params.ts. Values and comments moved verbatim at the split; provenance
 * tag meanings and adjudication rules live in params.provenance.ts.
 */

import type { Provenance } from './params.provenance.js';

/**
 * Officiating vocabulary (fdesign-officiating): the non-foul whistle
 * texture the event stream structurally lacked: jump balls, goaltending,
 * travels, technicals, take fouls, kicked balls, replay reviews.
 * Wired STAGED-inert (every draw site short-circuits before consuming
 * rng when its rate is 0 — the timeout-economy stage-switch discipline);
 * LIVE since the FLOW flip at the ffit-officiating corpus fits (see the
 * defaults). Field notes below that say "STAGED 0; seed X" describe the
 * staging discipline and the fit's corpus target, not the shipped
 * default.
 *
 * None of the rates join harness/knobs.ts: they are corpus-pinned REAL
 * targets the 17-band sweep cannot see; if the sweep owned them it would
 * trade them to zero to relieve the tov/pf ceilings, defeating the arc.
 * They get their own rate gates in the flow harness instead
 * (fdesign-officiating §6). Context-split dials (drive:post, scramble:
 * reach) are FEEL, invisible in the corpus text.
 */
export interface OfficiatingParams {
  /** held-ball chance per resolved rebound scramble (primary jump-ball
   *  site, possession.ts tickScramble). STAGED 0; corpus-fit seed ~0.009
   *  (~90 scrambles/g → ~0.7/g; scramble:reach split 85:15 FEEL, total
   *  0.83/g REAL) */
  heldBallPerScramble: number;
  /** held-ball share of on-ball reach-in events (secondary site,
   *  passing.ts attemptReachIn, non-hunting only). STAGED 0; seed ~0.05
   *  (~0.15/g) */
  heldBallPerReach: number;
  /** defensive-goaltend chance per contested rim/paint would-be miss with
   *  no block/foul rolled (shooting.ts startShot). STAGED 0; seed ~0.016
   *  (~31 such misses/g → 0.51/g REAL). Deliberately independent of the
   *  block roll: chaining onto blocks would drain the blk band's 0.4
   *  floor margin; the independent draw takes the makes from misses
   *  instead (fdesign-officiating §1.2/§5) */
  goaltendPerContestedInsideMiss: number;
  /** offensive-goaltend chance per putback launch (possession.ts
   *  tickScramble putback branch). STAGED 0; seed ~0.016 (~8 putbacks/g
   *  → 0.13/g REAL) */
  goaltendPerPutback: number;
  /** traveling hazard per second of committed drive time (game.ts
   *  tickLive, the charge-roll pattern: rate × dt on attacking ticks).
   *  STAGED 0; fit seed: pin drive+post travels at 1.05/g REAL total,
   *  drive:post ≈ 60:40 FEEL (corpus text carries no context), sized
   *  against measured drive/post exposure at the flip */
  travelPerDriveSec: number;
  /** traveling hazard per second of post backdown time (same site, the
   *  backingDown tick guard). STAGED 0; see travelPerDriveSec */
  travelPerPostSec: number;
  /** technical-foul chance per foul whistle (fouls.ts recordFoul, after
   *  the foul event + any foul-out replacement). STAGED 0; seed ~0.016
   *  (~43 fouls/g → 0.71/g REAL). V1 models the dominant after-foul
   *  frustration trigger only (42% of real techs); teched player = the
   *  fouler, resolution = 1 technical FT, possession unchanged */
  techPerFoulWhistle: number;
  /** 0/1 stage switch: relabel the endgame hunt's reach-in fouls
   *  (passing.ts attemptReachIn, foulHuntSide active) as kind 'take'.
   *  Zero rate/stat change, pure vocabulary (the corpus's Q4-late take
   *  rows). STAGED 0 so shipped events are byte-identical; flip: 1.
   *  Kept switchable only for the staging discipline; the fit wave flips
   *  it permanently */
  takeRelabelHuntFouls: number;
  /** transition-take reach-rate multiplier (× foul.reachInPerSec) while
   *  takeHuntActive (passing.ts): the beaten-in-transition wrap-up,
   *  built exactly like the endgame hunt's loaded dice. STAGED 0 (site
   *  never activates); fit seed ~35-55 (the foulHuntRateMult register,
   *  sized to ~0.2-0.3/g REAL) */
  takeHuntRateMult: number;
  /** transition-take window: seconds from a steal/live-rebound possession
   *  start during which the take is live (unread while takeHuntRateMult
   *  is 0). FEEL ~4 s, the real transition-kill beat. The take also
   *  requires the defense beaten (defendersBack < transSetBackCount − 1)
   *  and never runs in the final period's last 2:00 (REAL rule exclusion,
   *  also the firewall against the endgame foul hunt) */
  takeWindowSec: number;
  /** kicked-ball chance per clean-catch pass arrival (passing.ts
   *  resolvePassArrival). STAGED 0; seed ~0.0018 (~311 passes/g →
   *  0.57/g REAL). Offense retains, same possession, 14s-floor stoppage */
  kickedPerPass: number;
  /** replay-review chance at a review-flagged OOB/violation dead ball
   *  (possession.ts deadBall, callers pass reviewable:'oob'). STAGED 0;
   *  seed ~0.12 (trigger mix FEEL, review total 2.2-2.6/g REAL) */
  reviewPerOOB: number;
  /** replay-review chance at a final-period last-2:00 made-FG dead ball
   *  (reviewable:'late_make'). STAGED 0; seed ~0.10 */
  reviewPerLateMake: number;
  /** replay-review chance per period end (possession.ts endPeriod,
   *  rolled before the period_end emit, the real row order). STAGED 0;
   *  seed ~0.15/period */
  reviewPerPeriodEnd: number;
  /** wall-clock seconds a review stretches its stoppage (the TimeoutEvent
   *  wallT-only mechanic: game clock frozen, the replay shows the
   *  monitor huddle; unread while the review rates are 0). FEEL ~18 s,
   *  reads as a real look without bloating the replay */
  reviewResumeSec: number;
}

// Officiating (fdesign-officiating), live since the FLOW flip:
// measured-exposure corpus fits (ffit-officiating). Every family's
// per-game rate lands within ±25% of its 184-game corpus target except
// take rows, which over-print at ~1.4/g because the 0/1 relabel prints
// the endgame hunt's full appetite (documented deviation,
// ffit-officiating §4). G2 reads ~8-9 rows/g across 8 categories at
// assembly. Not swept; see the interface block doc for why these rates
// must never join knobs.ts.
export const officiatingDefaults: OfficiatingParams = {
  heldBallPerScramble: 0.0095, // fit: 0.83/g total held balls, REAL (ffit-officiating)
  heldBallPerReach: 0.005, // fit: the ~15% on-ball share (FEEL split)
  goaltendPerContestedInsideMiss: 0.0205, // fit: 0.51/g def goaltends, REAL
  goaltendPerPutback: 0.024, // fit: 0.13/g off goaltends, REAL
  travelPerDriveSec: 0.00265, // fit: drive carries the whole 1.05/g REAL travel total
  travelPerPostSec: 0.0065, // fit: post exposure (~5 s/g) is too thin to carry the design's 60:40 split (ffit-officiating)
  techPerFoulWhistle: 0.017, // fit: 0.71/g techs, REAL
  takeRelabelHuntFouls: 1, // live 0/1: endgame hunt fouls print as kind 'take' (pure relabel, zero stat change)
  // fit landed 0.09, not the design's ~35-55 register (the beaten-
  // transition window saturates; ffit-officiating §4); then rescaled
  // 0.09 → 0.06728 at the FLOW landing to hold take = reach × mult
  // constant as organic reach rose (knot-combo §1)
  takeHuntRateMult: 0.06728,
  // 4 s: the real transition-kill beat; the take happens before the break
  // organizes, never after the defense is back
  takeWindowSec: 4,
  kickedPerPass: 0.00127, // fit: 0.57/g kicked balls, REAL
  reviewPerOOB: 0.25, // fit: review total 2.2-2.6/g REAL, mix FEEL
  reviewPerLateMake: 0.085, // fit (ffit-officiating; seed ~0.10)
  reviewPerPeriodEnd: 0.09, // fit (ffit-officiating; seed ~0.15/period)
  // 18 s of wall-clock monitor time: same replay-texture register as the
  // 8 s timeout huddle; a review reads longer than a huddle (FEEL)
  reviewResumeSec: 18
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const officiatingProvenance: Record<keyof OfficiatingParams, Provenance> = {
  heldBallPerScramble: 'REAL',
  heldBallPerReach: 'FEEL',
  goaltendPerContestedInsideMiss: 'REAL',
  goaltendPerPutback: 'REAL',
  travelPerDriveSec: 'REAL',
  travelPerPostSec: 'FEEL',
  techPerFoulWhistle: 'REAL',
  takeRelabelHuntFouls: 'FEEL',
  takeHuntRateMult: 'REAL',
  takeWindowSec: 'FEEL',
  kickedPerPass: 'REAL',
  reviewPerOOB: 'REAL',
  reviewPerLateMake: 'REAL',
  reviewPerPeriodEnd: 'REAL',
  reviewResumeSec: 'FEEL'
};
