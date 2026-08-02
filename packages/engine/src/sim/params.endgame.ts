/**
 * SimParams block `endgame` — the flag-gated endgame layer's dials
 * (GameConfig.endgame).
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
 * ENDGAME LAYER (concept 6 — game-state urgency). Live under
 * `GameConfig.endgame`, which defaults ON (flipped on the n=1260/arm
 * flag-on survey — see GameConfig.endgame in sim/game.ts); with the flag
 * explicitly off nothing in this block is read on any decision path (the
 * byte-identical pre-layer engine). Everything here is an EV/urgency
 * MODULATION of the existing decision framework (the continuation curve,
 * the reach-in machinery, the dead-ball choke point) — never a scripted
 * playbook. See sim/ai/concepts.ts (concept 6) and sim/endgame.ts.
 *
 * Sweep surface (harness/knobs.ts): the MAGNITUDE dials — scale,
 * leadHoldMaxBoost, hurryMaxCut, twoForOneCut, foulHuntRateMult — are
 * registered for the flag-ON coordinated re-sweep (the n=1260/arm
 * flag-on survey measured fga +1.41 over its band ceiling; re-centering
 * has to trade these against pace/volume). In a flag-OFF run they are
 * unread, so a flag-off sweep pays a small dead-dimension tax for them —
 * the accepted price of sweeping flag-on ahead of the default flip. The
 * WINDOW/threshold dials and the chase arithmetic stay off the surface:
 * they define WHEN late-game behavior activates — identity-shape, not a
 * rate (see the knobs.ts doctrine header).
 */
export interface EndgameParams {
  /** master scale on every concept-6 modulation (same budget-knob pattern as ai.*Scale) */
  scale: number;
  // --- clock management with a lead (final period / OT)
  /** leading team milks inside this many clock seconds of the final period — REAL:
   *  deliberate clock-kill offense is a final-~2:30 behavior, ramping toward the horn */
  leadHoldClockSec: number;
  /** continuation raise at full effect (× base continuation). At 0.5 a held
   *  possession stays above typical look EV until the urgency window — the
   *  shot comes at ~5-8 s of shot clock, real "milk to :07 then attack" */
  leadHoldMaxBoost: number;
  /** lead (pts) past which milking stops mattering: full effect at ≤ this,
   *  fading to none by 2× (a 20-pt Q4 lead is garbage time, not clock-kill) */
  leadHoldMarginRef: number;
  // --- trailing hurry-up (final period / OT)
  /** trailing team pushes tempo inside this many clock seconds — REAL: the
   *  down-two-scores hurry starts around the 3:00 mark, ramping in */
  hurryClockSec: number;
  /** continuation cut at full desperation (× base). Lowering the value of
   *  "keep working" is what makes early good-not-great looks fire — the
   *  quick-shot texture of a chasing team, without scripting a play call */
  hurryMaxCut: number;
  /** deficit (pts) at which the hurry reaches full strength */
  hurryDeficitRef: number;
  /** deficit-depth floor inside hurriedness: even down a single score the
   *  late clock pushes tempo — the clock ramp, not the deficit, carries
   *  most of the urgency (share of full depth granted at deficit → 0) */
  hurryDepthFloor: number;
  /** hurriedness (0..1, sim/endgame.ts) above which the trailing handler
   *  SPRINTS the ball up instead of the normal dribble-jog — the visible
   *  push of a chasing team */
  hurrySprintMin: number;
  /** garbage-time wind-down (fdesign-rhythm M3; live since the FLOW
   *  flip): once the final
   *  period is decided (trailing side's chaseAliveness 0), both teams get
   *  a mild continuation raise (× 1 + scale × deadGameBoost × holdFade)
   *  in ai/concepts.ts endgameContinuation, so dribble-outs emerge from
   *  the same yardstick every other concept-6 behavior reshapes. Consumer
   *  wired (ffit-rhythm §8), gated `> 0`; registered in knobs (0.1-0.5).
   *  Complements concede (personnel), does not duplicate it (intent).
   *  FEEL seed 0.25, live at the seed */
  deadGameBoost: number;
  // --- chase arithmetic shared by hurry / fouling (possessions-left math)
  /** assumed seconds per remaining CHASE possession (hurried offense + a
   *  stop/foul cycle) when counting how many chances remain — REAL: a
   *  hurrying team turns possessions over in ~10-14 s of game clock */
  chasePossSec: number;
  /** realistic points a chase recovers per remaining possession PAIR (your
   *  score minus their expected answer) — sets where a deficit reads dead */
  chaseMaxPtsPerPoss: number;
  /** softness (pts) of the alive→dead fade — no hard cliff at the boundary */
  chaseFadePts: number;
  // --- period-end possession arithmetic (all periods)
  /** inside this period clock the possession holder plays for the LAST shot
   *  (≈ shot clock + inbound beat: the opponent can't get a full possession
   *  back) — REAL: the universal "hold for one" at every quarter end */
  holdForOneClockSec: number;
  /** continuation raise while holding for one (× base) */
  holdForOneBoost: number;
  /** in the FINAL period, trailing by more than this many points abandons
   *  last-shot patience for the hurry (down 1-3: one possession can tie/win;
   *  down 4+: you need multiple possessions, waiting is fatal) — REAL */
  lastShotDeficitMax: number;
  /** 2-for-1 window (period clock, non-final periods): acting early enough
   *  in [min,max] buys the team a second possession before the horn — REAL:
   *  NBA teams hunt the ~0:28-0:38 release for exactly this arithmetic */
  twoForOneMinClockSec: number;
  twoForOneMaxClockSec: number;
  /** continuation cut at the middle of the 2-for-1 window (× base): a
   *  moderately worse-than-usual shot is worth an entire extra possession,
   *  but not a terrible one (tent-shaped across the window) */
  twoForOneCut: number;
  // --- intentional fouling when trailing (final period / OT)
  /** hunt window cap (game-clock seconds): even a large deficit doesn't
   *  start the foul parade before this — REAL: ~0:35 is where trailing
   *  teams begin trading 2 FTs for possession; the per-deficit window
   *  below (one full shot clock per possession needed) narrows it further */
  foulTrailMaxClockSec: number;
  /** don't foul down fewer than this (down 1-2 a stop wins the game; a
   *  foul just hands over points) — REAL coaching orthodoxy */
  foulMinDeficit: number;
  /** deficit past which fouling is pointless (walk-off territory) */
  foulMaxDeficit: number;
  /** don't hunt a foul once the opponent's shot clock is at/under this —
   *  the violation/forced shot is coming anyway; play the possession out */
  foulMinShotClock: number;
  /** reach-in RATE multiplier while hunting (× foul.reachInPerSec): the
   *  grab is drilled and deliberate, so it lands within ~a second of
   *  contact range instead of the organic once-in-a-possession rate */
  foulHuntRateMult: number;
  /** clean-strip share of hunted grabs (overrides the stripP model): a
   *  deliberate wrap-up is a whistle ~9 times in 10, but hands do
   *  sometimes find ball — the occasional legit late-game strip is real */
  foulHuntStripShare: number;
  /** hand-check range for the hunt, ft (a lunging grab, wider than the
   *  organic reachDistFt but still requires converging on the holder) */
  foulHuntReachDistFt: number;
  /** on-ball containment gap while hunting, ft — pressed up to grab, not
   *  sagged into a cushion (defense.ts containOnBall override) */
  foulHuntGapFt: number;
  // --- timeouts (budget lives in rules.timeoutsPerGame, a league rule)
  /** opponent unanswered points that trigger the LEGACY deterministic
   *  stop-the-bleeding timeout. RETIRED IN PLACE at the FLOW flip: the
   *  coach hazard below subsumes it (fdesign-timeouts §1.3/§6) and 999
   *  never fires. Remove together with endgame.ts decideTimeout's
   *  stop_run branch, its one remaining reader. */
  timeoutRunPts: number;
  // --- timeout economy, game-wide (fdesign-timeouts; wired STAGED, live
  // since the FLOW flip at the ffit-timeouts corpus fits — see the
  // defaults). The mandatory/TV-stoppage rule, the Q4 caps, the OT
  // budget, the coach hazard, and the live-ball site. Field notes below
  // that say "STAGED N" describe the staging discipline's never-fire
  // value, not the shipped default.
  // All off the sweep surface: the hazard magnitudes are fitted
  // by the dedicated timeout protocol, never the 17-band sweep (which
  // measures no timeout statistic), and the rest are when/rule dials
  // (identity-shape, knobs.ts doctrine). None of this is scaled by
  // endgame.scale: that budgets concept-6 EV modulations, and a timeout
  // rate is not an EV term.
  /** mandatory (TV) stoppage clock thresholds, period-clock seconds: the
   *  NBA Rule 5 VI(b) anchors, first taken at the first dead ball under
   *  6:59 if the period has none yet, second under 2:59 if it has ≤ 1.
   *  STAGED −1 = rule off. League-correct home is RulePack data
   *  (fdesign-timeouts §3.1: NCAA/EL differ); params-staged until the
   *  officiating wave lands the pack fields. */
  toMandatoryFirstBelowSec: number;
  toMandatorySecondBelowSec: number;
  /** Q4 usage caps. REAL NBA rule: max 4 team timeouts in the final
   *  scheduled period, max 2 after its 3:00 mark. STAGED 99 = caps never
   *  bind (7-budget games can't reach them). RulePack-home caveat as above. */
  toFinalPeriodMaxTimeouts: number;
  toFinalPeriodLateMaxTimeouts: number;
  /** the Q4 late-cap boundary, period-clock seconds (REAL: 3:00 = 180);
   *  read by the cap upkeep/canSpend and the burn window's inner edge */
  toFinalPeriodLateSec: number;
  /** per-OT replacement budget. REAL NBA: 2 per OT period, replacing the
   *  regulation remainder (not adding). STAGED −1 = keep the remainder
   *  (the legacy behavior). RulePack-home caveat as above. */
  toOvertimeTimeouts: number;
  /** the live-ball possession-timeout site (grab the defensive board /
   *  steal and call time; 12.4% of real timeouts, and the only path to an
   *  endgame advance off a rebound): 1 = evaluate at live_rebound/steal
   *  possession starts, 0 = STAGED off (site never evaluates) */
  toLiveSiteOn: number;
  // coach voluntary-timeout hazard, one draw per qualifying stoppage for
  // the team with the ball (fdesign-timeouts §2). The four magnitudes
  // shipped at 0 until the FLOW flip (p exactly 0, no rng drawn — the
  // stage switch); live at the corpus fits, so the hazard now draws.
  /** base hazard per qualifying dead ball; carries the low-run mass
   *  (median real run at call is 3). STAGED 0; corpus-fit seed 0.018 */
  toCoachBasePerDead: number;
  /** run term engages above this many opponent unanswered points (FEEL:
   *  just above the median-run-at-call, 3) */
  toRunMinPts: number;
  /** run term saturates here. REAL: the canonical 10-0 */
  toRunFullPts: number;
  /** run-term weight. STAGED 0; corpus-fit seed 0.13 (target: ~29%/31%
   *  of real 8-0/10-0 runs get stopped by a victim timeout) */
  toCoachRunW: number;
  /** full trail-pressure at this deficit (FEEL: 12 pts) */
  toTrailRefPts: number;
  /** trail-term weight. STAGED 0; corpus-fit seed 0.03 (target: 56.6%
   *  of real timeouts are called trailing) */
  toCoachTrailW: number;
  /** hazard ceiling guard (FEEL) */
  toCoachMaxP: number;
  /** per-team cooldown, game-clock seconds, hazard only (FEEL: real
   *  per-team spacing ~9 min; mandatory and the advance are exempt) */
  toCoachCooldownSec: number;
  /** no voluntary call in the first N seconds of a period. REAL-ish:
   *  first-60s share of real timeouts is 1.0% (20/1,986) */
  toQuarterOpenQuietSec: number;
  /** burn window outer edge (period clock, final scheduled period). REAL:
   *  the 5:00→3:00 spend-it-before-the-cap bump (Q4 minute-8 bucket
   *  0.46/g vs 0.28-0.30 neighbors) */
  toBurnWindowSec: number;
  /** burn boost added to p inside the window while the team still holds
   *  more than the late cap. STAGED 0; corpus-fit seed 0.10 */
  toBurnBoost: number;
  /** hazard-fired reason label: 'stop_run' at/above this opponent run,
   *  'regroup' below (FEEL: ≥6-run share at real calls is 23.1%) */
  toStopRunLabelPts: number;
  /** trailing inside this many final-period clock seconds spends a timeout
   *  to ADVANCE the ball (inbound moves to the frontcourt) — REAL rule */
  timeoutAdvanceClockSec: number;
  /** advance timeouts only while the game is winnable: deficit ≤ this */
  timeoutAdvanceDeficitMax: number;
  /** wall-clock seconds a timeout freezes play (replay texture only — the
   *  game clock never runs during a timeout regardless; kept well under a
   *  real 75s huddle so replays don't bloat, but long enough to READ as a
   *  stoppage rather than a hiccup) */
  timeoutResumeSec: number;
  /** frontcourt inbound spot after an advance timeout: distance from the
   *  attacked rim, ft — the real advance puts the ball at the hashmark
   *  (~28 ft out); this is a BEHAVIORAL spot (the possession starts there) */
  timeoutAdvanceSpotFt: number;
}

export const endgameDefaults: EndgameParams = {
  // Provenance, two eras. Windows/thresholds (clock seconds, deficits,
  // hunt geometry) are FEEL — hand-set from real endgame texture (clutch
  // FT share ~35%+, milked possessions releasing at ~5-8 s of shot clock,
  // the ~0:30 foul point) and verified by the flow harness probe. The
  // magnitude dials (leadHoldMaxBoost, hurryMaxCut, twoForOneCut) are
  // SWEPT — the flag now ships ON (n=1260/arm survey, 2026-07-28), so the
  // 2026-07-28 coordinated sweep re-centered them with the bands
  // (iters 14 × cands 4, verify 40×3: 16/17 on all bases, fga the
  // residual). Keep the odd precision. The basketball meaning of each is
  // on its interface doc above.
  // scale is hand-owned since the FLOW landing (de-registered from
  // knobs.ts): the assembly re-sweep sold the Q4-min quarter shape
  // through it for pace/ortg the bands could see; restoring 1 put the
  // shape back for 2 verify edge-fails (f-assembly §6.1).
  scale: 1,
  // a leading team starts protecting the ball inside ~7:00 (FEEL→REAL-fit,
  // ffit-rhythm §2: THE Q4-shape lever, q4Δ −0.57 → +1.56 alone); the
  // ramp still means the full milk only shows late
  leadHoldClockSec: 420,
  // +50% continuation ≈ 2.2 expected points of "just keep it" at full
  // ramp, above any shot the engine generates, so the holder waits for the
  // urgency window (the boost itself fades inside urgencySec, see
  // concepts.ts, so late-clock offense still fires and violations don't spike)
  leadHoldMaxBoost: 0.4147373148320206,
  // full clock-kill up ~8, none by up ~16 — a 3-possession Q4 lead is
  // managed, a 16-point one is garbage time
  leadHoldMarginRef: 8,
  // the chase starts inside ~3:00 and ramps toward the horn
  hurryClockSec: 180,
  // -45% continuation at full desperation drops the bar to ~0.8 expected
  // points — any decent look fires immediately (possessions of 4-8 s)
  hurryMaxCut: 0.40396512533655854,
  // down two scores (6) is the fully-urgent chase
  hurryDeficitRef: 6,
  // a one-point deficit still carries 40% of full chase depth
  hurryDepthFloor: 0.4,
  // past ~a third of full urgency, the walk-up becomes a push
  hurrySprintMin: 0.3,
  // live (ffit-rhythm; the concepts.ts consumer went live at the FLOW
  // flip). Registered [0.1, 0.5]; the assembly sweep moved it to ~0.19
  // and the G7 diagnostic moved it back — 0.25 is part of the restored
  // endgame trio that holds the Q4-min shape (f-assembly §6.1).
  deadGameBoost: 0.30045967918468036,
  // ~12 s per chase possession-pair; 1.6 net points recoverable per chance
  // (score ~2.2, opponent answers ~0.6 through the foul game)
  chasePossSec: 12,
  chaseMaxPtsPerPoss: 1.6,
  chaseFadePts: 6,
  // shot clock (24) + an inbound beat: inside 26 s the opponent cannot get
  // a full possession back if you hold
  holdForOneClockSec: 26,
  holdForOneBoost: 0.5,
  lastShotDeficitMax: 3,
  // the classic 2-for-1 release window
  twoForOneMinClockSec: 28,
  twoForOneMaxClockSec: 38,
  // worth ~0.6 points of shot-quality concession at the window's center —
  // roughly half an average possession, the real trade being made (probed
  // at 0.3 the window's shot rate barely moved over flag-off: the tent
  // shape means the AVERAGE cut across the window is about half the peak,
  // and half of 0.3 didn't clear the continuation bar often enough)
  twoForOneCut: 0.38530755876233497,
  // fouling starts at min(this, one full shot clock per possession needed).
  // 35 -> 45 at the rules landing: with the last-2:00 window penalty
  // modeled (rulepack.ts lateWindowSec), hunted grabs actually PAY free
  // throws — the 35 s cap was fitted when hunts paid nothing until the
  // period bonus and mostly donated side-outs. Fitted against the G7
  // gates at n=20/n=40: 55 bought more FT climb but blew the min-48 band
  // (7.3 vs 4.4-6.0); 45 is the joint point (REGISTER W63).
  foulTrailMaxClockSec: 45,
  foulMinDeficit: 3,
  foulMaxDeficit: 12,
  foulMinShotClock: 5,
  // hunt rate = foul.reachInPerSec × this (passing.ts): 0.01585 × 33.8644
  // ≈ 0.54/s within grab range, the foul landing ~2 s after the defender
  // reaches the holder. Rescaled 45.3 → 33.8644 at the FLOW landing to
  // hold the product constant as organic reach rose (knot-combo §1), so
  // the hunt economy is isolated from the fga/pace absorber; 45.3 itself
  // was the restored inventory value after the band sweep sold the Q4
  // shape through the endgame trio (f-assembly §6.1).
  foulHuntRateMult: 33.51348026432238,
  foulHuntStripShare: 0.12,
  foulHuntReachDistFt: 6,
  foulHuntGapFt: 1.5,
  // RETIRED IN PLACE at the FLOW flip: the coach hazard below owns
  // stop-the-run texture now (toCoachRunW), so the legacy deterministic
  // trigger never fires at 999. fdesign-timeouts §6 wants the param
  // REMOVED, but the stop_run branch in endgame.ts decideTimeout still
  // reads it; delete both together (an engine mechanics change, not a
  // params flip). Until then 999 is the never-fire value, not a tunable.
  timeoutRunPts: 999,
  // Timeout economy (fdesign-timeouts), live since the FLOW flip:
  // corpus-fitted by ffit-timeouts (G1 lands 8.5-13 timeouts/g with
  // every quarter ≥1). Not swept.
  toMandatoryFirstBelowSec: 419, // REAL: 6:59, NBA Rule 5 VI(b) first mandatory anchor
  toMandatorySecondBelowSec: 179, // REAL: 2:59, second anchor
  toFinalPeriodMaxTimeouts: 4, // REAL Q4 cap
  toFinalPeriodLateMaxTimeouts: 2, // REAL after-3:00 cap
  // 3:00 of the final period, REAL boundary; safe to ship live (only the
  // staged caps/burn read it)
  toFinalPeriodLateSec: 180,
  toOvertimeTimeouts: 2, // REAL: per-OT replacement budget
  toLiveSiteOn: 1, // live rebound/steal timeout site (fdesign-timeouts §1.2.3)
  toCoachBasePerDead: 0.02, // corpus-fit (ffit-timeouts: the 0.018 seed fell ~0.4/g short of total volume)
  // shape dials at design values:
  toRunMinPts: 4, // FEEL: engage above the median real run at call (3)
  toRunFullPts: 10, // REAL: the canonical 10-0
  toCoachRunW: 0.195, // corpus-fit (ffit-timeouts: 8-0 stop-rate response saturates; seed 0.13)
  toTrailRefPts: 12, // FEEL: full trail pressure down 12
  toCoachTrailW: 0.03, // corpus-fit at its seed (ffit-timeouts: 56.6% trailing-caller share)
  toCoachMaxP: 0.35, // FEEL: hazard ceiling
  toCoachCooldownSec: 120, // FEEL: real per-team spacing ~9 min of game clock
  toQuarterOpenQuietSec: 60, // REAL-ish: first-60s share 1.0% (20/1,986)
  toBurnWindowSec: 300, // REAL: the 5:00→3:00 pre-cap burn window
  toBurnBoost: 0.13, // corpus-fit (ffit-timeouts: Q4 total 3.05→3.27, in band; seed 0.10)
  toStopRunLabelPts: 6, // FEEL: ≥6-run share at real calls is 23.1%
  // advance timeouts live inside the final ~0:45 of a close game
  timeoutAdvanceClockSec: 45,
  timeoutAdvanceDeficitMax: 8,
  // 8 s of wall-clock huddle: reads as a real stoppage in the replay
  // without recording a 75 s empty gym
  timeoutResumeSec: 8,
  // hashmark inbound: possession starts ~28 ft from the attacked rim
  timeoutAdvanceSpotFt: 28
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const endgameProvenance: Record<keyof EndgameParams, Provenance> = {
  scale: 'FEEL',
  leadHoldClockSec: 'REAL',
  leadHoldMaxBoost: 'SWEPT',
  leadHoldMarginRef: 'FEEL',
  hurryClockSec: 'REAL',
  hurryMaxCut: 'SWEPT',
  hurryDeficitRef: 'FEEL',
  hurryDepthFloor: 'FEEL',
  hurrySprintMin: 'FEEL',
  deadGameBoost: 'SWEPT',
  chasePossSec: 'REAL',
  chaseMaxPtsPerPoss: 'FEEL',
  chaseFadePts: 'FEEL',
  holdForOneClockSec: 'REAL',
  holdForOneBoost: 'FEEL',
  lastShotDeficitMax: 'REAL',
  twoForOneMinClockSec: 'REAL',
  twoForOneMaxClockSec: 'REAL',
  twoForOneCut: 'SWEPT',
  foulTrailMaxClockSec: 'REAL',
  foulMinDeficit: 'REAL',
  foulMaxDeficit: 'FEEL',
  foulMinShotClock: 'FEEL',
  foulHuntRateMult: 'SWEPT',
  foulHuntStripShare: 'FEEL',
  foulHuntReachDistFt: 'FEEL',
  foulHuntGapFt: 'FEEL',
  timeoutRunPts: 'FEEL',
  toMandatoryFirstBelowSec: 'REAL',
  toMandatorySecondBelowSec: 'REAL',
  toFinalPeriodMaxTimeouts: 'REAL',
  toFinalPeriodLateMaxTimeouts: 'REAL',
  toFinalPeriodLateSec: 'REAL',
  toOvertimeTimeouts: 'REAL',
  toLiveSiteOn: 'FEEL',
  toCoachBasePerDead: 'REAL',
  toRunMinPts: 'FEEL',
  toRunFullPts: 'REAL',
  toCoachRunW: 'REAL',
  toTrailRefPts: 'FEEL',
  toCoachTrailW: 'REAL',
  toCoachMaxP: 'FEEL',
  toCoachCooldownSec: 'FEEL',
  toQuarterOpenQuietSec: 'REAL',
  toBurnWindowSec: 'REAL',
  toBurnBoost: 'REAL',
  toStopRunLabelPts: 'FEEL',
  timeoutAdvanceClockSec: 'REAL',
  timeoutAdvanceDeficitMax: 'FEEL',
  timeoutResumeSec: 'FEEL',
  timeoutAdvanceSpotFt: 'REAL'
};
