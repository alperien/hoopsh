/**
 * SimParams block `shot` — make-chance logits per zone +
 * skill/contest/fatigue coefficients.
 *
 * Split out of sim/params.ts (#36): this module owns the block's interface,
 * calibrated defaults, and machine-readable per-knob provenance. The composed
 * surface (SimParams, defaultParams, paramProvenance, withParams) and the
 * reading guide for these numbers (logits, units, coupling) stay in
 * sim/params.ts. Values and comments moved verbatim at the split; provenance
 * tag meanings and adjudication rules live in params.provenance.ts.
 */

import type { Provenance } from './params.provenance.js';

export interface ShotParams {
  /** logit base make-chance per zone at average rating & average contest */
  baseRim: number;
  basePaint: number;
  baseMid: number;
  baseThree: number;
  /** logit swing from rating (multiplied by n(rating) in [-1, 1]) */
  skillCoef: number;
  skillCoefThree: number;
  /** paint-zone skill definition — the finishing/midRange blend fed to the
   *  make model's skill term (touch-dominant; see the defaults' note) */
  paintBlendFinishing: number;
  paintBlendMidRange: number;
  /** logit penalty per unit contest above the calibration midpoint */
  contestCoef: number;
  contestMidpoint: number;
  /** logit adjustments by shot creation type */
  movePullUp: number;
  moveDrive: number;
  moveCutFinish: number;
  movePost: number;
  movePutback: number;
  moveHeave: number;
  /** #86 strong-putback finish class (the putback dunk): logit ADDED to
   *  movePutback when a gate-clearing rebounder inside the restricted area
   *  resolves the automatic putback as a rim-plane throw-down
   *  (possession.ts putbackResolvesStrong). 0 = the class is staged OFF —
   *  the hard-zero short-circuit, checked before anything else. */
  putbackStrongLogit: number;
  /** rim finishing bonus per foot of height advantage over contester */
  rimHeightCoef: number;
  /** input clamp on that height advantage: |reach edge| beyond this many ft stops counting */
  rimHeightAdvClampFt: number;
  /** height advantage (ft) credited on an UNCONTESTED rim look — the
   *  neutral point the real matchup blends from as contest rises (see
   *  shotMakeP's height term; keeps rim make-p monotone in contest) */
  rimHeightUncontestedFt: number;
  /** catch-and-shoot logit bonus per unit of delivery quality n(passAcc/vision avg) */
  passQualityCoef: number;
  /** league-typical delivery in n-space — the zero point of the term above */
  passQualityCenter: number;
  /** logit penalty at zero energy */
  fatigueCoef: number;
  /** free throws: percentage-space base at rating 50 and swing to rating 100 */
  ftBasePct: number;
  ftSkillSwing: number;
  ftEliteKick: number;         // extra FT% above rating 80, full at 100 (elite tail curvature)
  /** the elite kick's knee and ramp, in n-space: kick is zero at/below
   *  n = ftEliteKneeN and reaches ftEliteKick at kneeN + rampN */
  ftEliteKneeN: number;
  ftEliteRampN: number;
  /** chance a rim/paint miss with a strong interior contest is a block */
  blockBase: number;
  blockSkillCoef: number;
  /** within-zone distance penalty model.
   *  Three-point penalty: logit cost per foot beyond distPenaltyThreeFt.
   *  Rim penalty: logit cost per foot from point-blank (a dunk vs a 4-ft floater). */
  distPenaltyThreeFt: number;      // threshold at which the three-distance penalty starts
  distPenaltyThreePerFt: number;   // logit per foot beyond distPenaltyThreeFt
  distPenaltyRimPerFt: number;     // logit per foot from the rim (rim-zone shots only)
  /** block probability model tuning — reallocates misses → blocks without changing FG% */
  blockGain: number;               // multiplier on (blockBase + skill) × contest
  blockCap: number;                // maximum block probability (even Gobert doesn't erase every miss)
  blockSkillWeight: number;        // weight on blockSkillCoef × n(block) inside blockP
  /** seconds from decision to release, by shot type (the closeout race window) */
  windupCatchShoot: number;
  windupPullUp: number;
  windupDrive: number;
  windupCutFinish: number;
  windupPost: number;
  windupPutback: number;
  windupHeave: number;
  /** release-time contest share at startShot; the decision-time contest gets
   *  the remaining 1 - this (a late closeout counts less than a set contest) */
  contestReleaseBlend: number;
  /** shooting-foul probability multiplier when the shot went IN (and-one is
   *  rarer than a foul on a miss) */
  andOneFoulMult: number;
  /** shooting-foul probability multiplier when the shot was blocked */
  blockedFoulMult: number;
  /** shot flight time = flightBaseSec + distFt × flightPerFt (seconds) */
  flightBaseSec: number;
  flightPerFt: number;
}

export const shotDefaults: ShotParams = {
  // Zone bases — league-average shooter, league-average contest. SWEPT,
  // and they land near real NBA zone efficiencies:
  // baseRim re-swept at the FLOW landing (f-assembly §3 round 2), paying
  // for the flipped foul/whistle mix; still ≈ 64% at the rim.
  baseRim: 0.5598383354754366, // sigmoid ≈ 64% at the rim (NBA ~65-68% incl. dunks)
  basePaint: -0.5433569895541309,   // ≈ 41% floaters/short hooks (NBA ~40-45%)
  baseMid: -0.45,     // ≈ 35% mid-range before skill (NBA ~40%, but the
                      //   distance penalty below and contest terms shift it)
  baseThree: -0.955,   // ≈ 29% raw; skill + open looks lift the league to ~36% (re-centered when skillCoefThree widened)
  // How much a rating swings the logit, at rating 100 vs 50. A 0.5 coef
  // means an elite finisher gains ~+12 percentage points at the rim.
  // Three's coef is LOWER than the others on purpose: real three-point
  // percentage has a narrow spread (league 36%, elite 42%) — shooters
  // separate themselves by VOLUME and difficulty, not by hit rate. SWEPT.
  skillCoef: 0.5,
  // raised from 0.45 in the fidelity phase: at 0.45 a 99-rated shooter hit
  // 31.8% on a heavy pull-up diet — BELOW league average. Elite spread
  // widened; the sweep re-centers baseThree if the league mean drifts.
  skillCoefThree: 0.66,
  // Paint skill is TOUCH-dominant: the in-between game (floaters, push
  // shots, short hooks) rides midRange far more than finishing — which is
  // WHY sagging off a rim-runner works: his open 9-foot floater is a win
  // for the defense. FEEL — hoisted from the inline resolve.ts zoneSkill
  // blend per this file's header rule (a make-model skill input belongs
  // on this surface; audit H-01).
  paintBlendFinishing: 0.35,
  paintBlendMidRange: 0.65,
  // Defense's main lever: penalty per unit of contest above the midpoint.
  // A smothered shot (contest 1.0) costs ~0.7 logits ≈ 15+ points of FG%
  // versus a wide-open one. SWEPT.
  contestCoef: -1.1325,
  // The contest level that counts as "normal NBA defensive pressure" — the
  // bases above are calibrated AT this level, so this is the zero point.
  contestMidpoint: 0.38,
  // Shot-creation difficulty adjustments (logits). Ordering reflects real
  // shot-quality data: unassisted self-created jumpers are hardest, cuts
  // and putbacks are high-percentage because the defense is out of position.
  movePullUp: -0.22,    // off the dribble, defender attached
  moveDrive: -0.08,     // moving finish through traffic
  // caught in stride at the rim. HISTORY (wave-2 taxonomy fix): this value
  // was set while cut_finish was STAGED — assigned by NO code path — so it
  // had never once been applied to a real attempt. When the taxonomy fix
  // wired the type up, it landed on ~30% of all attempts at once and drove
  // league FG% to 51.0% (band 44-49.5). Measured at n=12: 0.18 -> 51.0%,
  // 0.00 -> 45.7%, -0.10 -> 45.0%. It is now a LIVE, load-bearing dial on
  // a large share of shots and must be re-fit by the coordinated sweep
  // rather than trusted as a hand-set FEEL value; parked at 0 pending that
  // sweep, because a never-exercised bonus is not evidence for its size.
  moveCutFinish: 0.0,
  movePost: -0.05,      // FEEL — back-to-basket craft costs a touch vs a clean look
  movePutback: 0.1,     // already inside, defense scrambling
  moveHeave: -2.6,      // ≈ 7% — a desperation launch, correctly awful
  // #86 (unassisted-creation arc, increment 2): the strong-putback class.
  // A gate-clearing rebounder (the booth's dunk-gate mirror, ai/offense.ts
  // clearsDunkGate) who secures the board inside the restricted area (the
  // rim zone's 4 ft bracket) doesn't tap the ball back toward the rim — he
  // rises and throws it down. The release moves to the rim plane (startShot
  // carryRim, the #74 construction) and this logit prices the throw-down
  // over the generic tap, ON TOP of movePutback. The off-switch is exact:
  // 0 short-circuits the whole class in putbackResolvesStrong (checked
  // FIRST — no stream touches at 0), and the class adds no rng draws at
  // ANY value: it moves the make threshold, never the draw count. FEEL,
  // landed at 0.3. The n=96 paired ladder reads that selected this dose
  // (astd -0.34pp acceptance, -0.40pp i86dose, mid-window on both) did
  // not survive their exact supersets at n=288: pooled astd -0.04pp (se
  // 0.16), consistent with zero. The dose claims no astd purchase and
  // consumes approximately zero astd headroom. What stands for 0.3: the
  // saturation direction (the geometry fires at any positive logit, the
  // dose only moves make-p, higher doses only inflate putback FG%), zero
  // measured wall pressure (17/17 bands on every n>=48 read, every base,
  // both arms), and the delivered channel (dunk booking and putback FG%).
  // Registered in harness/knobs.ts [0, 1.2].
  putbackStrongLogit: 0.3,
  // Size at the rim: per foot of standing-reach advantage over the
  // contester. A 7-footer finishing over a guard gains real percentage;
  // clamped to ±rimHeightAdvClampFt in the model so it can't run away. FEEL.
  rimHeightCoef: 0.35,
  // The clamp on that reach advantage: beyond ±1.5 ft the edge stops
  // counting — extreme mismatches stay believable rather than automatic.
  // FEEL (hoisted from an inline resolve.ts shotMakeP literal per this
  // file's header rule: a make-path number belongs on this surface).
  rimHeightAdvClampFt: 1.5,
  // FEEL — the model's height NEUTRAL POINT: shooting over nobody is like
  // shooting over someone half a foot shorter (a mild positive that keeps
  // the height term from swinging negative on unguarded makes). Also the
  // baseline the real matchup blends FROM as contest level rises (audit
  // M-02) — was an inline contestCore literal that only applied to the
  // by===null case, so any nonzero contest jumped straight to the raw
  // reach difference.
  rimHeightUncontestedFt: 0.5,
  // REAL — "on time, on target": teammates of elite passers measurably
  // shoot better; a 94-delivery passer adds ~+0.25 logit (~5-6 points of
  // make% on an open three) vs a neutral one
  passQualityCoef: 0.22,
  // REAL — volume-weighted league delivery sits near rating 57 (n ≈ 0.15);
  // centering there makes the term mean-neutral at league scale
  passQualityCenter: 0.15,
  // Legs at empty (energy 0) vs fresh: ~-8 points of FG%. Tired players
  // shoot worse, which is why rotations matter. FEEL.
  fatigueCoef: -0.35,
  // Free throws are modeled in PERCENTAGE space, not logits — FT% has no
  // REAL — rating 100 → ~85%+, rating 50 → 66%, rating 0 → ~47%: elite
  // FT shooters live at 88-91%, bricklayers in the 50s. The swing was
  // originally 0.12 (an 83% ceiling), which failed the fidelity harness's
  // 99-rated benchmark at 79% — league mean is preserved by re-centering
  // the base (the fidelity phase widens SPREADS; bands still own the mean).
  ftBasePct: 0.666,
  ftSkillSwing: 0.19,
  // REAL — the elite tail: +5.5% at rating 100, zero below 80; rating 99
  // lands ~90%, matching the 88-91% real elite band
  ftEliteKick: 0.055,
  // The kick's knee and ramp in n-space: n = 0.6 is rating 80 (where the
  // elite tail starts), and the 0.4 ramp reaches the full kick at rating
  // 100 (n = 1.0). FEEL — were inline in resolve.ts freeThrowP; the elite
  // tail's SHAPE is a make-path constant, so it lives here (audit H-01).
  ftEliteKneeN: 0.6,
  ftEliteRampN: 0.4,
  // Blocks are drawn only from shots that were ALREADY going to miss, so
  // this reallocates misses to blocks rather than changing FG%. Keeps block
  // totals tunable without disturbing efficiency calibration. SWEPT.
  blockBase: 0.34904634250729627,
  blockSkillCoef: 0.5,
  // Within-zone distance penalty model. Both constants have real-world meaning:
  //   threes: each foot beyond the NBA three-point line costs ≈1.3 pp FG% —
  //     30-footers genuinely are harder than corner threes. FEEL.
  //   rim: a dunk and a 4-foot floater are different shots; 0.09/ft captures
  //     the falloff from directly under the hoop to the paint edge. FEEL.
  distPenaltyThreeFt: 23,         // NBA three-point line distance, ft — REAL
  distPenaltyThreePerFt: 0.055,   // logit per foot beyond distPenaltyThreeFt — FEEL
  distPenaltyRimPerFt: 0.09,      // logit per foot from the rim (rim-zone only) — FEEL
  // Block model: 1.8 gain and 0.5 cap tuned to the 3.5-6.5 blocks/game band. SWEPT.
  blockGain: 1.8,          // multiplier applied to (blockBase + skill × blockSkillWeight) × contest — SWEPT
  blockCap: 0.5,           // maximum block probability — FEEL (even Gobert can't block everything)
  blockSkillWeight: 0.14,  // weight of n(block) inside blockP — SWEPT
  // WINDUP = seconds between "decides to shoot" and release. This is the
  // engine's signature mechanic: it creates the catch-and-shoot vs closeout
  // RACE, so a defender who is 8 ft away when the decision is made may
  // arrive in time to contest. Real release times: ~0.4 s for a quick
  // catch-and-shoot, ~0.55 s for a gathered pull-up. REAL-ish/FEEL.
  windupCatchShoot: 0.42,
  windupPullUp: 0.55,
  windupDrive: 0.45,
  windupCutFinish: 0.3,
  windupPost: 0.65,
  windupPutback: 0.25, // shortest: already up in the air
  windupHeave: 0.3,
  // Contest at RELEASE is blended with contest at the decision instant: a
  // late closeout bothers a shot less than a set contest. This is the
  // release-time share (decision gets 1 - it). FEEL — was inline in
  // shooting.ts startShot (0.55 decision / 0.45 release).
  contestReleaseBlend: 0.45,
  // A shooting foul on a MADE shot (and-one) is far rarer than one on a
  // miss; a foul on a blocked shot is rarer still. FEEL — were inline
  // damping factors in shooting.ts.
  andOneFoulMult: 0.28,
  blockedFoulMult: 0.35,
  // Ball flight time to the rim = base + distance × per-ft. FEEL — was the
  // inline `0.45 + loc.distFt * 0.021` in shooting.ts startShot.
  flightBaseSec: 0.45,
  flightPerFt: 0.021
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const shotProvenance: Record<keyof ShotParams, Provenance> = {
  baseRim: 'SWEPT',
  basePaint: 'SWEPT',
  baseMid: 'SWEPT',
  baseThree: 'SWEPT',
  skillCoef: 'SWEPT',
  skillCoefThree: 'FEEL',
  paintBlendFinishing: 'FEEL',
  paintBlendMidRange: 'FEEL',
  contestCoef: 'SWEPT',
  contestMidpoint: 'FEEL',
  movePullUp: 'FEEL',
  moveDrive: 'FEEL',
  moveCutFinish: 'FEEL',
  movePost: 'FEEL',
  movePutback: 'FEEL',
  moveHeave: 'FEEL',
  putbackStrongLogit: 'FEEL',
  rimHeightCoef: 'FEEL',
  rimHeightAdvClampFt: 'FEEL',
  rimHeightUncontestedFt: 'FEEL',
  passQualityCoef: 'REAL',
  passQualityCenter: 'REAL',
  fatigueCoef: 'FEEL',
  ftBasePct: 'REAL',
  ftSkillSwing: 'REAL',
  ftEliteKick: 'REAL',
  ftEliteKneeN: 'FEEL',
  ftEliteRampN: 'FEEL',
  blockBase: 'SWEPT',
  blockSkillCoef: 'SWEPT',
  distPenaltyThreeFt: 'REAL',
  distPenaltyThreePerFt: 'FEEL',
  distPenaltyRimPerFt: 'FEEL',
  blockGain: 'SWEPT',
  blockCap: 'FEEL',
  blockSkillWeight: 'SWEPT',
  windupCatchShoot: 'FEEL',
  windupPullUp: 'FEEL',
  windupDrive: 'FEEL',
  windupCutFinish: 'FEEL',
  windupPost: 'FEEL',
  windupPutback: 'FEEL',
  windupHeave: 'FEEL',
  contestReleaseBlend: 'FEEL',
  andOneFoulMult: 'FEEL',
  blockedFoulMult: 'FEEL',
  flightBaseSec: 'FEEL',
  flightPerFt: 'FEEL'
};
