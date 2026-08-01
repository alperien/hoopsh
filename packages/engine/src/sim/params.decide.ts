/**
 * SimParams block `decide` — decision cadence, continuation curve, appetites,
 * temperature.
 *
 * Split out of sim/params.ts (#36): this module owns the block's interface,
 * calibrated defaults, and machine-readable per-knob provenance. The composed
 * surface (SimParams, defaultParams, paramProvenance, withParams) and the
 * reading guide for these numbers (logits, units, coupling) stay in
 * sim/params.ts. Values and comments moved verbatim at the split; provenance
 * tag meanings and adjudication rules live in params.provenance.ts.
 */

import type { Provenance } from './params.provenance.js';

export interface DecideParams {
  /** seconds between ball-handler decision evaluations */
  intervalSec: number;
  /** per-decision cadence jitter: the next window is intervalSec × a
   *  uniform draw in [jitterLo, jitterHi] — players don't re-read the
   *  floor on a metronome */
  intervalJitterLo: number;
  intervalJitterHi: number;
  /** softmax temperature over action utilities (higher = more random) */
  temperature: number;
  /** the quick-release window off a touch: a 0-dribble shot decided within
   *  this many seconds of gaining the ball is an off-the-catch release
   *  (catch_shoot / cut_finish / putback by zone & acquisition — see
   *  decide.ts); after it the gather is over and the shot is a self-created
   *  pull-up */
  quickCatchSec: number;
  /** shot-type classification gates (rim distance, ft): a live post-up
   *  releases as a POST move inside postShotRangeFt; a committed drive
   *  releases as a DRIVE finish inside driveShotRangeFt (farther out, the
   *  stop-and-rise is honestly a pull-up). The label picks the make
   *  model's move adjustment and the windup, so both are make-path gates */
  postShotRangeFt: number;
  driveShotRangeFt: number;
  /**
   * continuation value curve: expected points of "keep working the possession"
   * = continuationMax * (shotClock / fullClock) ^ continuationCurve
   * Shots are taken when predicted shot EV beats this. Drives pace + shot diet.
   */
  continuationMax: number;
  continuationCurve: number;
  /** below this many shot-clock seconds, urgency overrides shot quality */
  urgencySec: number;
  /** desperation-heave trigger: launch from beyond heaveMinDistFt once the
   *  shot clock is under heaveShotClockSec, or once the period clock is
   *  both under heavePeriodClockSec and the binding (earlier) horn */
  heaveShotClockSec: number;
  heavePeriodClockSec: number;
  heaveMinDistFt: number;
  /** global era knob multiplying three-point appetite */
  threeAppetite: number;
  /** global multiplier on drive appetite */
  driveAppetite: number;
  /** EV bonus for open transition looks (flat while the phase lasts) */
  transitionBonus: number;
  /** additional shoot/drive EV bonus while a STEAL possession is still in
   *  transition — the live-ball break premium on top of transitionBonus
   *  (the drive channel weighs the sum by ai.driveTransitionMult); dies
   *  with the phase (defense set), like the flat bonus */
  stealBreakBonus: number;
  /** drive commitment window (seconds): a decided drive holds this long before re-evaluation */
  driveCommitSec: number;
  /** commit ceiling for long rampages (the floor is driveCommitSec); see game.ts arrival-based commit */
  driveCommitMaxSec: number;
  /** planning speed for the arrival-based commit: commit ≈ launchDist / this */
  driveSpeedFtSec: number;
  /** mid-drive re-decision window, seconds: a committed driver re-reads
   *  (finish or kick) on this quick cadence instead of the generic one */
  driveRecheckSec: number;
  /** first-decision delays ("look around" beats) before the AI may act on
   *  a fresh touch: a new possession's handler, a continuation resume
   *  after a whistle, and a secured offensive rebound */
  delayNewPossSec: number;
  delayResumeSec: number;
  delayOrebSec: number;
  /** heave discipline (decide.ts desperation bypass): final-period/OT
   *  deficit within which the period-horn heave is genuinely let fly;
   *  one make ties/wins */
  heaveKeepDeficitMax: number;
  /** chance a NON-mattering period-horn heave is launched anyway (the
   *  texture residue); ≥ 1 = STAGED legacy always-launch (draw-free) */
  heaveLaunchChance: number;
}

export const decideDefaults: DecideParams = {
  // Seconds between ball-handler decision evaluations (jittered per
  // decision by intervalJitterLo/Hi below). Roughly "how often a player
  // re-reads the floor" — the main lever on how many actions fit in a
  // possession. SWEPT.
  intervalSec: 0.7070273369202364,
  // FEEL — the cadence jitter: each window is intervalSec × uniform
  // [0.75, 1.3] (−25%/+30%, mildly long-skewed) so decisions never land on
  // a metronome. Was inline in game.ts tickLive (audit H-01; the old
  // "±25%" doc here understated the upper edge).
  intervalJitterLo: 0.75,
  intervalJitterHi: 1.3,
  // Softmax temperature over action utilities, in expected-points units.
  // Low (0.06) = players nearly always take the best option; raising it adds
  // human noise and bad decisions. This is the engine's "IQ dial". SWEPT;
  // re-swept at the FLOW landing (f-assembly §3 round 1).
  temperature: 0.0697461052602733,
  // REAL-ish: NBA tracking's catch-and-shoot definition is a 0-dribble
  // jumper released within ~2s of the touch; the sim's decision cadence
  // (intervalSec ≈ 0.66, jittered) makes 0.9s the equivalent "rise
  // immediately off the catch" window. Was an inline 0.9 in decide.ts;
  // promoted here when the quick-touch window started gating the
  // cut_finish/putback taxonomy (a make-model input, so it belongs on the
  // calibration surface per this file's house rule).
  quickCatchSec: 0.9,
  // Shot-type classification gates (decide.ts shotMove). A holder working
  // a live post-up releases a POST move inside 14 ft — the outer edge of
  // the traditional post area (numerically equal to move.nearRimFt but a
  // distinct physical concept: this labels the SHOT, that blends the
  // defensive roles). A committed driver inside 12 ft releases a DRIVE
  // finish; farther out, stopping and rising off the bounce is honestly a
  // pull-up. FEEL — were inline in decide.ts; the label is a make-model
  // input (move adjustment + windup), so both gates live here (audit H-01).
  postShotRangeFt: 14,
  driveShotRangeFt: 12,
  // THE MOST IMPORTANT NUMBER IN THE ENGINE.
  // Expected points of "keep working this possession" with a full shot
  // clock ≈ 1.45. Every shot decision is a comparison against this: shoot
  // only if the look beats what the possession is otherwise worth. It sets
  // pace, shot selection, and shot quality simultaneously — raise it and
  // teams hunt better shots (slower, more efficient), lower it and they
  // fire early. Real NBA offenses average ~1.10-1.15 points/possession;
  // this sits above that because it represents the value of a possession
  // being CONTINUED from a live-ball state, not its average outcome. SWEPT.
  // re-centered by hand for the Stage 2 decision-layer mechanics (drive
  // collapse pricing + catch-and-shoot decisiveness shifted the patience
  // equilibrium; two sweeps could not escape the old basin), then
  // sweep-polished from this start point. Cut 1.4714 → 1.41 at the FLOW
  // flip (ffit-cadence §4): the pace refund for the live rebound cadence,
  // ~+1.4 pace and −1.5pp of 21+s possessions at this rung.
  continuationMax: 1.41,
  // Curve exponent: value = max × (shotClock/full)^curve. At 0.22 the value
  // decays slowly then falls off a cliff late — mirroring how real offenses
  // stay patient until roughly 6-8 seconds remain. SWEPT.
  continuationCurve: 0.14,
  // Inside this many shot-clock seconds, urgency scales the continuation
  // value linearly to zero: any shot beats a violation. REAL rule pressure.
  urgencySec: 5,
  // The desperation heave (decide.ts): with the shot clock nearly gone
  // (< 1.2 s), or the period horn about to beat the shot clock (clock
  // < 2.5 s and the earlier of the two), and no hope of getting closer
  // than 32 ft, just launch — no shot is good, but a violation/expiry is
  // worse. FEEL — were inline in decide.ts; the trigger produces a real
  // attempt (shot.moveHeave prices its awfulness), so it is a
  // decision-path lever, not cosmetics (audit H-01).
  heaveShotClockSec: 1.2,
  heavePeriodClockSec: 2.5,
  heaveMinDistFt: 32,
  // ERA KNOBS. Global multipliers on three-point and drive appetite —
  // these are the intended hooks for era packs (a 1995 pack would set
  // threeAppetite ≈ 0.4, a 2015 pack ≈ 1.2). At 1.0 they are neutral.
  threeAppetite: 1.12,
  driveAppetite: 0.7997,
  // Expected-points bonus for attacking before the defense is set. Drives
  // fast-break points; too high and teams never walk it up. SWEPT.
  transitionBonus: 0.05,
  // The live-ball break premium: a steal catches the defense mid-offense —
  // facing the wrong way, cross-matched, floor balance gone — which is a
  // categorically better break than the push off a defensive rebound (the
  // retreat is already downhill-facing). REAL: transition off steals runs
  // ~1.2-1.3 PPP vs ~1.05-1.1 off rebounds, and the sim's measured gap
  // was exactly here — after a steal the clock-only continuation reset to
  // its MAXIMUM (~1.47), the thief's rim look priced at uShoot ≈ -0.41
  // (P(shoot) 14.8%/decision), and steal->score-in-6s ran 12-17% vs the
  // real 29.3% (flow-reference.json). Sized by 12-game probes on two seed
  // bases: 0.35 lands conversion at 27.9/29.3% with league FGA at the
  // taxonomy-fix level (~no pace cost) and assisted share slightly BELOW
  // its pre-branch level. Probed-and-rejected shapes, for the record
  // (wave2/shotmix): a state-aware CONTINUATION cut scaled by
  // defenders-back (the diagnostic's preferred design) fed the window to
  // hit-ahead passes league-wide (assisted share +4-10pp over a band it
  // already exceeded, conversion saturated ~20-24%) — and when
  // steal-gated, its headcount scaling faded exactly as defenders got
  // back DURING the push, gutting per-attempt quality at the finish; a
  // GLOBAL flat raise (transitionBonus 0.3) hit conversion but repriced
  // every dreb push (+13% league FGA). Flat-through-the-phase,
  // steal-gated won on conversion AND every side metric. FEEL
  // (probe-verified, awaits the coordinated re-sweep).
  stealBreakBonus: 0.35,
  // Drive commitment window: how long a drive decision keeps the ball-handler
  // heading at the rim before re-evaluation. Used in BOTH game.ts
  // (executeAction's drive branch) and passing.ts (DHO turn-the-corner grant),
  // so one param governs both. FEEL — 1.35 s at ~20 ft/s covers ~27 ft,
  // roughly the distance from the wing to a layup spot.
  driveCommitSec: 1.35,  // FEEL — commit FLOOR, seconds (short attacks)
  // Arrival-based commit (drive-collapse forensic, speed-fix branch): a
  // fixed window expired mid-lane once the jog economy stretched launch
  // distances — drive PICKS stayed equal to main (~190/4 games) but drive
  // FINISHES fell 4.7 -> 1.35/game because the terminal decision arrived
  // as a 15-ft pull-up instead of a rim finish. Commit now scales with
  // launch distance (dist/driveSpeedFtSec, clamped to [floor, max]):
  // penetrate until ARRIVAL, then finish or spray — same arrival principle
  // as the phase boundaries. FEEL.
  driveCommitMaxSec: 2.5,
  driveSpeedFtSec: 16.5,
  // FEEL — the mid-drive re-read: a committed driver checks finish-or-kick
  // every half second instead of waiting out the generic jittered cadence
  // (the drive is the one state where the floor changes that fast). Was
  // inline in game.ts executeAction (audit H-01).
  driveRecheckSec: 0.5,
  // FEEL — first-decision delays, the "look around" beats before the AI
  // may act on a fresh touch (were inline in possession.ts; audit H-01):
  // a new possession's handler takes a beat off the inbound/steal/tip
  // grant (0.25 — prevents the instant no-look heave); a whistle resume
  // re-sets slightly longer (0.3 — the possession was already flowing and
  // has to re-read); an offensive rebounder who just fought for the ball
  // needs the longest beat (0.35). They gate WHEN the decision loop first
  // fires, so all three shape early-possession texture.
  delayNewPossSec: 0.25,
  delayResumeSec: 0.3,
  delayOrebSec: 0.35,
  // ---- heave discipline (the desperation-bypass guard, decide.ts) ----
  // Real players protect their percentages: the hopeless end-quarter
  // heave is held or released after the buzzer, never logged as an FGA.
  // The sim logged 1.97 heaves/g (FGA ≥35 ft, last 4s of a period; 0/218
  // made) vs the real 0.05/g, the grammar corpus's top-ranked tell
  // (flow-grammar §2d). Shot-clock-forced heaves are untouched (a
  // violation is worse; real players launch those).
  // REAL: one-possession game: tied or down ≤3 at a final-period/OT horn,
  // the heave can tie or win, so it genuinely flies. Mirrors
  // endgame.lastShotDeficitMax (same coaching orthodoxy) but is a
  // separate decide.* param on purpose: this path runs on the always-on
  // core (endgame:false included), and reading params.endgame from it
  // would falsify that block's documented flag-off-unread contract.
  heaveKeepDeficitMax: 3,
  // At 1 the period-expiring branch launches unconditionally without
  // drawing (the legacy behavior); below 1 the discipline is armed: hold
  // unless the heave matters or the occasional careless launch fires
  // (real logs are not literally zero). Landed at 0.06: the solo grammar
  // fit chose the 0.02 ladder rung (0.06 read 0.40/g on its tree,
  // ffit-grammar §2.1), but the live officiating/timeout stoppage grammar
  // shrinks horn exposure, and at assembly 0.06 reads 0.23 heaves/g vs
  // the ≤0.3 gate (f-assembly §6.6). Makes are still unsampled (0/11 per
  // 48g); adjudicate the makes>0 leg on a ≥600-game pool. FEEL;
  // hand-owned, flow-gated, because a sweep would push it to 0 or max
  // for ±0.2 fga the bands can't attribute.
  heaveLaunchChance: 0.06
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const decideProvenance: Record<keyof DecideParams, Provenance> = {
  intervalSec: 'SWEPT',
  intervalJitterLo: 'FEEL',
  intervalJitterHi: 'FEEL',
  temperature: 'SWEPT',
  quickCatchSec: 'REAL',
  postShotRangeFt: 'FEEL',
  driveShotRangeFt: 'FEEL',
  continuationMax: 'SWEPT',
  continuationCurve: 'SWEPT',
  urgencySec: 'REAL',
  heaveShotClockSec: 'FEEL',
  heavePeriodClockSec: 'FEEL',
  heaveMinDistFt: 'FEEL',
  threeAppetite: 'SWEPT',
  driveAppetite: 'SWEPT',
  transitionBonus: 'SWEPT',
  stealBreakBonus: 'FEEL',
  driveCommitSec: 'FEEL',
  driveCommitMaxSec: 'FEEL',
  driveSpeedFtSec: 'FEEL',
  driveRecheckSec: 'FEEL',
  delayNewPossSec: 'FEEL',
  delayResumeSec: 'FEEL',
  delayOrebSec: 'FEEL',
  heaveKeepDeficitMax: 'REAL',
  heaveLaunchChance: 'FEEL'
};
