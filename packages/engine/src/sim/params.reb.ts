/**
 * SimParams block `reb` — rebound positioning weights, putbacks, dead-ball
 * caroms.
 *
 * Split out of sim/params.ts (#36): this module owns the block's interface,
 * calibrated defaults, and machine-readable per-knob provenance. The composed
 * surface (SimParams, defaultParams, paramProvenance, withParams) and the
 * reading guide for these numbers (logits, units, coupling) stay in
 * sim/params.ts. Values and comments moved verbatim at the split; provenance
 * tag meanings and adjudication rules live in params.provenance.ts.
 */

import type { Provenance } from './params.provenance.js';

export interface RebParams {
  /** offensive rebound weight multiplier (defense boxes out by default) */
  offWeightMult: number;
  /** mean rebound distance from rim = base + coef * shotDist */
  missDistBase: number;
  missDistCoef: number;
  /** how strongly proximity to landing spot dominates the scramble */
  proximityPower: number;
  /** putback attempt chance when an off-rebound lands at the rim */
  putbackChance: number;
  /** putback eligibility radius: the rebounder must still be within this
   *  of the rim for the automatic putback roll, ft */
  putbackRadiusFt: number;
  /** beyond this distance from the miss-landing spot, a player can't reach the rebound */
  reboundCutoffFt: number;
  /** scramble convergence radius: players within this of the landing spot
   *  chase the loose ball, ft */
  scrambleConvergeFt: number;
  /** scramble resolution window off a missed shot, seconds (uniform draw
   *  so scrambles don't all resolve on the same beat) */
  scrambleResolveLoSec: number;
  scrambleResolveHiSec: number;
  /** the shorter, more contained free-throw-miss scramble window, seconds */
  ftScrambleLoSec: number;
  ftScrambleHiSec: number;
  /** blocked-shot carom: the loose ball starts this share of the way from
   *  the release point back toward the rim… */
  blockCaromShare: number;
  /** …then scatters up to this many ft per axis (uniform) */
  blockScatterFt: number;
  /** relative spread of miss-landing samples around the mean: std = mean × this factor */
  reboundSpreadFactor: number;
  /** share of live-rebound scrambles whose carom dies (out of bounds /
   *  rolls dead) and is awarded as a TEAM rebound at a dead-ball inbound
   *  instead of credited to a player — see possession.ts tickScramble */
  deadBallCaromChance: number;
  // --- rebound cadence (G9, fdesign-judge §3; wired STAGED, live at 1
  // since the FLOW flip). How long a
  // miss stays loose before someone secures it (resolve.ts
  // sampleScrambleSec -> possession.ts tickScramble's window). cadenceOn
  // is the stage switch: at 0 the legacy sub-second uniform windows are
  // drawn with the same single rng call (byte-identical stream); at 1 the
  // draw maps through a piecewise-linear inverse CDF whose interior knots
  // sit at half-integer seconds and whose levels are the cum* fields.
  // Each cum* sextet is a coupled set (a monotone CDF): re-fit together
  // against the corpus, never nudge one alone. Off the sweep surface
  // (knobs.ts doctrine): the 17 bands measure no cadence statistic and
  // would only bend these to buy pace; the flip wave re-centers pace
  // with pace-native dials and verifies cadence via the flowboard (G9).
  /** stage switch: 0 = legacy instant-rebound windows (never-fire), 1 =
   *  corpus-shaped scramble cadence */
  cadenceOn: number;
  /** missed-FGA secure window: min/max span (seconds of game clock) */
  cadenceFgMinSec: number;
  cadenceFgMaxSec: number;
  /** missed-FGA window CDF levels at the 0.5/1.5/2.5/3.5/4.5/5.5s knots */
  cadenceFgCum0: number;
  cadenceFgCum1: number;
  cadenceFgCum2: number;
  cadenceFgCum3: number;
  cadenceFgCum4: number;
  cadenceFgCum5: number;
  /** missed-final-FT secure window: same model, its own corpus fit */
  cadenceFtMinSec: number;
  cadenceFtMaxSec: number;
  cadenceFtCum0: number;
  cadenceFtCum1: number;
  cadenceFtCum2: number;
  cadenceFtCum3: number;
  cadenceFtCum4: number;
  cadenceFtCum5: number;
  /** scramble rating blend — a coupled set shaping WHO wins each rebound lottery */
  blendOffReb: number;         // offensive: pursuit
  blendOffVertical: number;    // offensive: hops
  blendDefReb: number;         // defensive: positioning
  blendDefBoxout: number;      // defensive: sealing
  blendDefVertical: number;    // defensive: tipped reach
  blendHeightPerIn: number;    // both sides: weight per inch of height
}

export const rebDefaults: RebParams = {
  // The offense is at a structural disadvantage on the glass (it is
  // retreating, the defense is between man and rim), so offensive rebound
  // weights are discounted. This is THE lever on ORB% (band 20-30%). SWEPT.
  offWeightMult: 0.6,
  // Where a miss lands: mean distance from the rim = base + coef × shot
  // distance. Long shots produce long rebounds — a real, well-documented
  // effect that makes guards' rebounds on three-heavy nights plausible.
  missDistBase: 4.8116,
  missDistCoef: 0.16,
  // How sharply proximity dominates the scramble: weight ∝ 1/(1+d)^power.
  // Higher = rebounding is pure positioning; lower = size/skill matter more.
  proximityPower: 1.4,
  // Chance an offensive rebound caught at the rim goes straight back up
  // rather than resetting the offense; produces the putback shot type.
  // Raised 0.4532 → 0.55 with the concept-10 OREB read (ffit-grammar:
  // putback-within-6s share 65% vs the 62% floor at this dose). Registered
  // [0.35, 0.8]; the sweep owns it from here.
  putbackChance: 0.5749948213111973,
  // FEEL — putback eligibility: the rebounder must still be right under
  // the basket (within 6 ft of the rim) for the automatic putback roll.
  // Was inline in possession.ts tickScramble (audit H-01, the
  // mutation-proven anchor: 6 → 0 dropped putbacks 199 → 96 over 40
  // games). Registered in harness/knobs.ts: putbackChance saturates
  // against exactly this radius (see its knob note), so the pair are
  // calibration companions.
  putbackRadiusFt: 6,
  // Rebound scramble geometry:
  //   reboundCutoffFt: beyond this nobody realistically gets there. FEEL —
  //     24 ft is approximately the three-point arc; a player who let the shot
  //     leave from that far has no chance on a typical short miss.
  reboundCutoffFt: 24,        // FEEL — max scramble distance, ft
  // FEEL — scramble convergence: players within 18 ft of the landing spot
  // chase the loose ball — roughly "anyone who could plausibly be a
  // rebounder on this carom" without pulling in players still way out on
  // the perimeter. Was inline in possession.ts tickScramble (audit H-01).
  scrambleConvergeFt: 18,
  // reboundSpreadFactor: controls how tightly miss-landings cluster around
  //   the mean. 0.45 × mean gives a Gaussian std; floor at 1 ft prevents
  //   on-the-rim degenerate samples. Tracking-data validated. FEEL.
  reboundSpreadFactor: 0.45,  // FEEL — relative spread of miss-landing distribution
  // FEEL — scramble resolution windows, uniform draws so scrambles don't
  // all resolve on the same beat (were inline; audit H-01): a missed-shot
  // scramble plays out over 0.5-0.95 s (shooting.ts), while a free-throw
  // miss is a shorter, more contained scrum — everyone is already boxed
  // out in the lane — at 0.45-0.8 s (fouls.ts; the window burns a mean
  // ~0.67 s of game clock per miss).
  scrambleResolveLoSec: 0.5,
  scrambleResolveHiSec: 0.95,
  ftScrambleLoSec: 0.45,
  ftScrambleHiSec: 0.8,
  // FEEL — the blocked-shot carom (were inline in shooting.ts, audit
  // H-01): the swatted ball starts 35% of the way from the release point
  // back toward the rim, then scatters up to ±6 ft per axis — a block
  // sprays anywhere in the vicinity, unlike a rim miss's distance-shaped
  // landing model. Both feed the scramble's landing spot, i.e. WHO
  // recovers the block.
  blockCaromShare: 0.35,
  blockScatterFt: 6,
  // TEAM rebounds: real missed-FG caroms die out of bounds (tipped OOB,
  // long skips) at a measured 15.4% of misses in the six-game reference
  // corpus (14.3/game, 59% awarded to the offense) — and the Turing
  // baseline's judges used the sim's total LACK of "rebound by Team"
  // lines as a definitely-real marker (flow-reference.json
  // meta.turingBaseline). Modeled as a flat pre-roll on scramble
  // resolution; the WINNING SIDE follows the same positioning-weighted
  // lottery a player rebound uses, so ORB%'s expectation is unchanged and
  // team rebound totals still count the board (official-scoring
  // convention, stats/box.ts). Set slightly under the real 0.154 because
  // every diverted carom is a player rebound nobody gets credited for —
  // 0.08 keeps the interior-star TRB identity (fidelity gate) inside its
  // tripwire — and every diverted OFFENSIVE carom replaces a putback
  // chance (unassisted makes) with a halfcourt re-set, which nudges
  // assisted share upward against its band ceiling — while still making
  // team rebounds a normal sight in the log (~7/game plus the FT
  // dead-ball formalities). REAL anchor, FEEL discount.
  deadBallCaromChance: 0.08,
  // ---- rebound cadence (G9, live since the FLOW flip) ----
  // Real rebounds are not instant: the miss caroms off iron, bodies fight,
  // and only then does someone secure the ball. Measured on the committed
  // 184-game corpus (data/nba/pbp-plays, G9 definition = harness
  // rebMissDeltas: game-clock delta miss row -> player-rebound row,
  // interleaved subs skipped): missed FGAs n=15,004, floored-second
  // histogram 0s 5.5% / 1s 12.0% / 2s 27.6% / 3s 31.5% / 4s 16.7% /
  // 5s 5.0% / 6s+ 1.8%, p50 3s, <=1s 17.4%; missed final FTs n=869,
  // 0s 12.4% / 1s 8.7% / 2s 37.4% / 3s 28.4% / 4s+ 13.0%, p50 2s (faster:
  // the clock legally starts on the touch after an FT, and the lane is
  // already boxed). The sim's legacy window resolved every scramble in
  // 0.5-0.95s; "rebound rows <=1s after every miss" was the blind
  // judges' #1 genuine tell (tell C / gate G9, findings/fdesign-judge).
  cadenceOn: 1, // live (ffit-cadence): the corpus CDF below owns scramble timing; G9 reads p50 3s, <=1s ~17%
  // REAL: corpus-fitted CDF levels. The knots sit at half-integer
  // seconds because both measurement pipelines floor clocks to whole
  // seconds: P(logged delta <= k) ~ F(k + 0.5), so fitting F at k+0.5
  // (then MC-polishing for the sim's 0.1s tick rounding) makes the
  // sim's logged histogram land on the corpus one. Fitted values
  // reproduce the FG target within 1.2pp L1 (p50 3s, <=1s 17.0%,
  // 2-4s 75.6%) and the FT target within corpus noise (n=869). The odd
  // precision is the fit; do not tidy (AGENTS §2.1).
  cadenceFgMinSec: 0.3,   // REAL floor: a tip-to-grab off the rim
  cadenceFgMaxSec: 8.0,   // corpus p99.9 ~ 7.5s; longer scrums are scorer noise
  cadenceFgCum0: 0.085,
  cadenceFgCum1: 0.141,
  cadenceFgCum2: 0.451,
  cadenceFgCum3: 0.792,
  cadenceFgCum4: 0.949,
  cadenceFgCum5: 0.983,
  cadenceFtMinSec: 0.1,   // near-zero: the first touch can be the secure
  cadenceFtMaxSec: 6.5,   // corpus max 8, p99 6
  cadenceFtCum0: 0.168,
  cadenceFtCum1: 0.171,   // ~no mass 0.5-1.5s: clean grab or a real fight
  cadenceFtCum2: 0.611,
  cadenceFtCum3: 0.903,
  cadenceFtCum4: 0.976,
  cadenceFtCum5: 0.993,
  // Scramble rating blend (FEEL — a COUPLED SET: re-tune together, never
  // hand-nudge one alone). Rebounding is a zero-sum lottery, so these
  // redistribute WHO rebounds without moving league totals. Height stays
  // dominant in absolute terms (inches × per-inch weight beats any rating
  // term) — but at 0.6/in it flattened craft entirely: every 7-footer
  // rated within ~10% regardless of skill, and a 97-defReb/92-boxout
  // center pulled 7.5 boards (fidelity incident).
  blendOffReb: 0.8,           // pursuit
  blendOffVertical: 0.3,      // hops
  blendDefReb: 0.7,           // positioning
  blendDefBoxout: 0.35,       // sealing
  blendDefVertical: 0.12,     // tipped reach
  blendHeightPerIn: 0.45      // both sides, per inch
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const rebProvenance: Record<keyof RebParams, Provenance> = {
  offWeightMult: 'SWEPT',
  missDistBase: 'SWEPT',
  missDistCoef: 'FEEL',
  proximityPower: 'FEEL',
  putbackChance: 'SWEPT',
  putbackRadiusFt: 'FEEL',
  reboundCutoffFt: 'FEEL',
  scrambleConvergeFt: 'FEEL',
  reboundSpreadFactor: 'FEEL',
  scrambleResolveLoSec: 'FEEL',
  scrambleResolveHiSec: 'FEEL',
  ftScrambleLoSec: 'FEEL',
  ftScrambleHiSec: 'FEEL',
  blockCaromShare: 'FEEL',
  blockScatterFt: 'FEEL',
  deadBallCaromChance: 'FEEL',
  cadenceOn: 'FEEL',
  cadenceFgMinSec: 'REAL',
  cadenceFgMaxSec: 'REAL',
  cadenceFgCum0: 'REAL',
  cadenceFgCum1: 'REAL',
  cadenceFgCum2: 'REAL',
  cadenceFgCum3: 'REAL',
  cadenceFgCum4: 'REAL',
  cadenceFgCum5: 'REAL',
  cadenceFtMinSec: 'REAL',
  cadenceFtMaxSec: 'REAL',
  cadenceFtCum0: 'REAL',
  cadenceFtCum1: 'REAL',
  cadenceFtCum2: 'REAL',
  cadenceFtCum3: 'REAL',
  cadenceFtCum4: 'REAL',
  cadenceFtCum5: 'REAL',
  blendOffReb: 'FEEL',
  blendOffVertical: 'FEEL',
  blendDefReb: 'FEEL',
  blendDefBoxout: 'FEEL',
  blendDefVertical: 'FEEL',
  blendHeightPerIn: 'FEEL'
};
