/**
 * SimParams block `ai` — EXPECTED-POINTS utility weights: concept master
 * scales, shot selection, drive, pass, screens/actions, the closed usage
 * loop.
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
 * AI utility weights — the decision layer's knobs, fully sweepable.
 * These shape WHO does WHAT (shot diets, drive rates, ball movement,
 * defensive spacing); the sections above shape how attempts RESOLVE.
 */
export interface AiParams {
  // bounded-rationality concept MASTER SCALES (ai/concepts.ts): each
  // multiplies every term of one concept, so the sweep can budget entire
  // concepts instead of nudging their sub-dials one by one. 1.0 = the
  // sub-dial values apply exactly as written.
  decisivenessScale: number;   // concept 1 — drilled green-light shots
  actionCommitScale: number;   // concept 2 — called-action payoff + patience
  advantageScale: number;      // concept 3 — cutter / swing / hierarchy passes
  tempoScale: number;          // concept 5 — transition urgency
  scorePressureScale: number;  // concept 7 — all-game score pressure (press/coast)
  /** concept 7: max fractional continuation tilt at/beyond the saturation
   *  margin — presses the trailing team's yardstick down, coasts the
   *  leader's up; 0 = coupling off */
  scorePressureTilt: number;
  /** concept 7: margin (pts) at which the press/coast lean saturates —
   *  linear through a tie, clamped beyond */
  scorePressureMarginRef: number;
  /** concept 7 channel 2 (defensive intensity): max fractional on-ball
   *  containment-gap / closeout-slack lean at/beyond the saturation
   *  margin — the trailing team's defense presses up (tighter), the
   *  leader's sags off (looser); no urgency fade by design; 0 = channel
   *  off */
  scorePressureDefGain: number;
  probeScale: number;          // concept 8 — early-clock probe window (swing culture)
  /** concept 8: shot-clock share (sc/full) above which halfcourt offense
   *  is probing — the ramp's zero point; must stay < 1 (ramp divisor) */
  probeClockShare: number;
  /** concept 8: EV added to the pass channel inside the probe window */
  probeSwingBonus: number;
  /** concept 8: fade the whole probe by the offense's own score-pressure
   *  magnitude — 0 = no fade (the pre-pricing shape), 1 = the probe dies
   *  exactly where the coupling expresses (REGISTER W28's interaction
   *  pricing: the probe's early-shot suppression measured destructive on
   *  θ and talent keep BECAUSE it blocked the early-offense channel
   *  game-state pressure works through; fading it there prices the pair) */
  probePressureFade: number;
  /** concept 8: EV subtracted from uShoot inside the probe window (drives
   *  are deliberately exempt — the FTA protection) */
  probeShootMalus: number;
  openerScale: number;         // concept 9: opening-set deliberateness (sub-dials at end of block)
  scrambleScale: number;       // concept 10: OREB scramble economy (sub-dials at end of block)
  passBackWindowSec: number;   // concept 3 (negative side): return-pass damping window
  passBackMalus: number;       // EV malus on an immediate return pass, decaying over the window
  relocateRatePerTick: number; // chance/tick a shooter shakes while a drive bends the defense
  relocDeniedRatePerTick: number; // the denied shooter's self-scheduled baseline-run cadence (much rarer)
  relocateDriftFt: number;     // how far the shake drifts away from the defender
  relocDurationSec: number;    // how long the relocated ground is held
  /** per-possession spacing-spot jitter half-width, ft (uniform per axis) —
   *  see offense.ts rollSpots; corner spots jitter along the baseline only
   *  (lateral pinned inside the corner-three line, D3 coupling) and
   *  above-the-break three spots stay behind the arc */
  spotJitterFt: number;
  /** minimum clearance BEHIND the three-point arc a jittered top/wing spot
   *  keeps (ft) — spacing shooters stand behind the line on purpose;
   *  without this floor, jitter parks them on/inside it and mints junk
   *  23-ft catch-and-shoot twos that shift the shot mix */
  spotJitterArcMarginFt: number;
  // shot selection
  zoneTendBias: number;        // weight of zone shot-diet tendencies
  pullUpBias: number;          // weight of pull-up tendency on pull-ups
  threeApptScale: number;      // era three-appetite -> utility scale
  tacticsThreeScale: number;   // team threeBias -> utility scale
  contestBrakeAt: number;      // contest level where the brake engages
  contestBrakeBase: number;    // brake strength at average decisions rating
  contestBrakeIQ: number;      // extra brake per unit of decisions rating
  holdAdvance: number;         // hold utility while bringing the ball up
  holdHalfcourt: number;       // hold utility in the halfcourt
  // drive
  driveMinDistFt: number;      // no drive evaluation inside this range
  driveProjContestBase: number;
  driveProjContestCrowd: number;
  /** where a drive is priced to END: this many ft short of the rim (a
   *  layup/floater release spot, not the hoop's center) */
  driveFinishSpotFt: number;
  handlingBase: number;        // base P(get downhill)
  handlingSkillDiv: number;    // handle-vs-lateral divisor
  handlingGapDiv: number;      // defender-gap divisor
  handlingGapRefFt: number;    // neutral on-ball cushion — gaps beyond it help the handler
  handlingMin: number;         // P(get downhill) floor — nobody is helpless
  handlingMax: number;         // ...and cap — nobody is uncontainable
  driveTendOffset: number;     // drive tendency neutral point
  driveTendScale: number;
  laneCrowdPenalty: number;
  /** defendersInLane geometry: the counted parametric slice of the
   *  handler→rim segment (on-ball and under-rim defenders excluded) and
   *  the lateral width of the driving line, ft */
  laneAlongMin: number;
  laneAlongMax: number;
  laneWidthFt: number;
  driveFlat: number;
  driveTransitionMult: number;
  // passing
  passRiskUtilMult: number;    // how strongly turnover risk discounts a pass
  passEVScale: number;         // teammate shot EV weight
  /** concept 12 — pass-flight clock charge (0..1): how much of the shot
   *  clock a pass consumes in flight is priced into the chooser's EV term.
   *  0 = legacy (receiver EV priced at the throw clock, delivery free);
   *  1 = full discount at the arrival clock (sc − flight time,
   *  startPass's success-branch arithmetic). Stage switch: at 0 the
   *  decide.ts branch short-circuits before any arithmetic (byte-identical
   *  streams). */
  passClockCharge: number;
  /** concept 12 — the receiver's get-off window, s: an arrival clock at or
   *  above this prices full value; below it the EV term decays linearly to
   *  (1 − passClockCharge) at zero. Physics floor: a catch needs a decision
   *  tick + a windup (shot.windupCatchShoot / windupCutFinish) before the
   *  release freezes the clock — so ~0.5 s arrivals are whistle bait while
   *  ~2 s arrivals convert. */
  passClockGetOffSec: number;
  /** W64 channel 3 (session-8 rim-supply arc) — the transition leak-out.
   *  0 = nobody leaks (staged, checked FIRST); at >0 the fastest
   *  gate-clearing non-handler abandons his spot for the far rim during
   *  live-rebound/steal transitions while the defense is not set. The
   *  finish rides the ORDINARY catch path — the session-8 lob-fusion
   *  experiment measured the fused rise WORSE than the normal
   *  catch->decide->windup coast (36% vs 51-55% FG; the register's
   *  channel-2 falsification row) and was stripped.
   *  KEEP IN SYNC: dunkAthleteGate and the blend weights mirror narration
   *  shotcall.ts DUNK_ATHLETE_SCORE / its 0.6/0.4 blend (the booth's own
   *  definition of who dunks IS who leaks); the engine cannot import
   *  narration, so a sync test pins the pair. */
  leakOutScale: number;
  dunkAthleteGate: number;
  dunkBlendVert: number;
  dunkBlendFin: number;
  /** inside this rim radius the leaker counts as a CUTTER (cutUntil
   *  stamps): the cutter bonus and the chooser's cut_finish pricing apply
   *  where they are honest — at the finish, never on a 60 ft hit-ahead */
  leakFinishRadiusFt: number;
  /** #74 (unassisted-creation arc, increment 1) — the transition carry.
   *  0 = no carry (staged, checked FIRST); at >0 a beaten break's
   *  committed drive finish GATHERS THROUGH its windup — the handler
   *  keeps carrying at the rim while the ball comes up, so the release
   *  plane is the arrived position instead of the behind-plane stop the
   *  cadence lands (the #74 probe: beaten-retreat transition finishes at
   *  median 4.8 ft against the booth's 2.25 ft book boundary, 0-8% at the
   *  plane, while plane releases convert at 59-67%). Same decides, same
   *  labels, same make model — only the release geometry moves.
   *  Per-possession arming draw in the heave-guard shape (0 never draws,
   *  >= 1 short-circuits draw-free), rolled in startPossession, consumed
   *  by executeAction's shoot branch (game.ts). */
  transCarryScale: number;
  /** #74 F1 amendment (PR #75 probe, Lead-ruled) — the carry's own reach:
   *  a committed drive finish carries to the rim-plane release only when
   *  the decide-time body-to-rim gap is at most this many feet. Before
   *  this gate the carry's only distance cap was decide.driveShotRangeFt
   *  (12 ft — the drive LABEL gate, a knob the carry's docs never named):
   *  17.5% of scale-1 carries booked the ball at the rim with the body
   *  6+ ft away at release (gap p90 7.44 ft, max 10.06 — past any human
   *  extension). Inside the gather gate the windup's own travel covers
   *  the gap, so a booked carry is a body that arrived at the plane or
   *  crossed it on the slide; the residual release discontinuity is
   *  bounded by this gate on the short side and by one windup of slide
   *  (8.0 ft at 16 ft/s over the 0.50 s effective windup) on the long
   *  side — both stated in W82.
   *  SHAPE, not dose: deliberately off the sweep surface (knobs.ts). */
  transCarryGatherFt: number;
  /** #114 (unassisted-creation arc) — the halfcourt blow-by carry, the
   *  transition carry's halfcourt sibling. 0 = no blow-by (staged,
   *  checked FIRST); at >0 a halfcourt drive finish that has WON the
   *  matchup gathers through its windup exactly as the #74 carry does —
   *  same decides, same 'drive' label, same make model, only the release
   *  geometry moves (the #114 probe: halfcourt drive releases sit at p50
   *  4.9 ft against the booth's 2.25 ft book boundary, 2.7% at the
   *  plane, while plane buckets convert at 70%+ — the artifact class #74
   *  measured in transition, one phase over). Per-possession arming draw
   *  in the heave-guard shape (0 never draws, >= 1 short-circuits
   *  draw-free), rolled in startPossession on EVERY start kind (any
   *  possession reaches halfcourt), consumed by executeAction's shoot
   *  branch via blowsByToRim (game.ts). */
  blowByCarryScale: number;
  /** #114 — the blow-by's beaten read: the handler carries only when his
   *  on-ball man is absent (nothing within ai.onBallRadiusFt) or trails
   *  by at least this many feet of rim distance (behindFt = defender rim
   *  distance minus handler rim distance; positive = the edge is won).
   *  SHAPE, not dose: off the sweep surface (knobs.ts). */
  blowByBeatenFt: number;
  /** #114 — the blow-by's lane read: the gate holds only while the
   *  ai/shared.ts defendersInLane soft count — the SAME definition the
   *  drive chooser prices, one seam so they can never disagree — sits
   *  under this threshold. A beaten on-ball man with help not yet
   *  committed is already an empty lane at decide time; once help
   *  commits the crowd count kills the gate and the existing kick-out
   *  valuation takes over. SHAPE, not dose: off the sweep surface. */
  blowByLaneMax: number;
  /** #114 — the blow-by's own reach, the transCarryGatherFt arithmetic
   *  applied to the halfcourt carry: the decide-time body-to-rim gap
   *  must sit inside one windup of drive cover or the finish stays an
   *  ordinary drive release. Deliberately its OWN knob so the two carry
   *  classes stay separately owned. SHAPE, not dose: off the sweep
   *  surface (the #75-F1 tail is what an outward push re-creates). */
  blowByGatherFt: number;
  cutterBonus: number;         // hitting an active cutter
  swingBase: number;           // intrinsic ball-movement value
  swingPassOutScale: number;
  swingVisionScale: number;
  playmakerScale: number;      // EV per 100 creation-gap points routed up-hierarchy
  passContinuationScale: number;
  catchContestScale: number;   // openness -> expected catch contest
  // off-ball
  cutRateScale: number;        // per-tick cut chance per unit of motion tendency
  /** the dunker dive (W64 rim supply): multiplies the dunker-spot
   *  player's cut rate while his ball-handler is mid-drive-commit — the
   *  dump-off dive that produces real point-blank catches. The dunker is
   *  otherwise excluded from cutting entirely. 0 = staged inert: the
   *  dunker branch short-circuits BEFORE any rng draw, so every stream
   *  is byte-identical to the exclusion era (the STAGED discipline). */
  dunkerDiveScale: number;
  cutDurationSec: number;
  crashBase: number;           // offensive rebound crash probability base
  crashTendScale: number;
  // contest model internals
  contestSkillFloor: number;   // minimum contest multiplier from mere presence (floor of skill range)
  contestSkillRange: number;   // additional multiplier at rating 100 vs floor (skill range above floor)
  pnrStunContestMult: number;  // contest effectiveness while screen-stunned (pairs with pnrStun*Sec)
  windupProjShare: number;     // share of windup time used to project a defender forward in anticipatedContest
  // gravity model
  gravityThreeWeight: number;  // weight of three-point ability in gravity() (vs tendency)
  gravityTendWeight: number;   // weight of shotThree tendency in gravity() (vs ability)
  // on-ball detection and off-ball movement thresholds
  onBallRadiusFt: number;      // defender must be within this to count as "on the ball"
  cutRunwayFt: number;         // off-ball player must be beyond this distance to trigger a cut
  // dunker-spot assignment
  dunkerGravityThreshold: number; // gravity below this → dunker spot; above → corner shooter

  // crash thresholds
  crashNearFt: number;         // offensive player must be within this to be eligible to crash
  /** crash-target scatter half-width, ft: crashers attack a seeded spot
   *  around the rim, not the rim's center */
  crashScatterFt: number;
  /** the guard-crash economy's perimeter line, ft from the rim: a defender
   *  whose man is at/beyond it mostly holds instead of crashing */
  defCrashPerimeterFt: number;
  /** box-out positioning: share of the way from MAN toward rim (sealing),
   *  and from SELF toward rim when there is no near man to seal */
  boxoutManShare: number;
  boxoutSelfShare: number;
  // pick-and-roll roll timing (in cut machinery)
  pnrRollCutSec: number;       // how long the screener's cut grant lasts after the screen sets
  // post mechanics
  postArrivalFt: number;       // self-posting player transitions to 'working' within this of the block
  backdownStepFt: number;      // distance the poster creeps toward the rim each movement step
  backdownStopFt: number;      // the backdown's advance stops at this rim distance (restricted-area edge)
  // DHO mechanics
  dhoSearchRadiusFt: number;   // maximum distance from hub at which a DHO receiver is considered
  dhoArcSplitFt: number;       // inside this rim distance, DHO catch triggers a drive commitment
  // defense positioning
  guardDistBase: number;       // tightest off-ball guard distance
  guardDistOpen: number;       // extra sag vs zero-gravity players
  sagStartFt: number;          // ball distance where help-side sag begins
  sagRangeFt: number;
  sagMax: number;
  sagGravityCut: number;       // gravity resistance to sagging
  denyGravityCut: number;      // above this gravity, deny the catch (top-lock)
  denyDistFt: number;          // how far up the man-ball line the denier shades
  denyBackdoorMult: number;    // cut-rate multiplier for a denied man (the counter)
  helpSpotPull: number;        // help spot pull toward the ball
  helperGravityWeight: number; // reluctance to help off shooters
  helperGravityCeil: number;   // gravity-penalty factor at helpAggr=0 (drops to ceil−1 at helpAggr=1)
  closeoutSlackFt: number;     // gap slack before a closeout sprint
  containDBlend: number;       // on-ball containment: perimeterD share vs lateral
  assignLeashFt: number;       // a defender within this of his man still counts as assigned to him
  // bookkeeping
  assistWindowSec: number;     // catch-to-shot window for assist credit
  /** dribbles allowed before a jumper stops counting as assisted */
  assistMaxDribbles: number;
  /** dribbles allowed before an INTERIOR finish stops counting as assisted */
  assistMaxDribblesInterior: number;
  // pick-and-roll
  pnrRatePerTick: number;      // base chance per eligible halfcourt tick to call a screen
  pnrUsageFloor: number;       // action-rate share the lineup's weakest creator keeps
  driveKickBoost: number;      // EV the help-collapse adds to the best teammate look
  driveAbortDiscount: number;  // share of a bad drive's downside actually paid (abort option)
  driveHoldBoost: number;      // hold bonus per remaining drive second (keep attacking)
  /** the drive-hold ramp cap, seconds: the boost scales with remaining
   *  commit time up to this far out — strong at launch, gone by the
   *  terminal decision */
  driveHoldRampSec: number;
  catchShootBonus: number;     // shoot bias for an open look in the catch window
  /** the arc catch-and-shoot gate's contest ceiling: full bonus at contest
   *  0, fading linearly to zero here (only the CREATED advantage fires) */
  catchShootContestCeil: number;
  /** the three-point green light shared by the catch-and-shoot and
   *  transition pull-up terms: zero at/below the tendency floor (the light
   *  belongs to shooters), full at floor + range */
  threeGreenLightFloor: number;
  threeGreenLightRange: number;
  midRangeBonus: number;       // drilled mid-range decisiveness (green-light gated; ai/concepts.ts)
  midGreenMaxFt: number;       // distance ceiling of the mid green light — real mid-range, not long 2s
  midPopShotBonus: number;     // shoot bias on the worked pop catch at the elbow (kin of postShotBonus)
  midContestCeil: number;      // contest ceiling of the mid green light (the middy lives vs drop coverage)
  pullUpThreeBonus: number;    // drilled halfcourt off-dribble three (green-light gated; 0 = STAGED dark)
  pullUpThreeMaxFt: number;    // outer edge of the pull-up-three green light; the logo bomb is not drilled
  driveMidStopChance: number;  // snake stop-short rate at full midPullUpLight (game.ts drive commit)
  driveMidStopFt: number;      // rim distance where a stop-short drive ends — the pull-up spot
  pnrDurationSec: number;      // action lifetime
  pnrScreenSetDistFt: number;  // screener-to-defender distance that counts as contact
  pnrStunOverSec: number;      // defender delay when fighting over the screen
  /** screen-fight stun scaling: over-stun = pnrStunOverSec × (fightBase +
   *  screener strength / fightStrengthDiv) — strong screens hit harder */
  pnrFightBase: number;
  pnrFightStrengthDiv: number;
  pnrStunUnderSec: number;     // brief delay when ducking under
  pnrUnderSagFt: number;       // extra on-ball gap while going under (pull-up space)
  pnrUnderBase: number;        // base probability of going under vs handler gravity
  pnrUnderMin: number;         // under-probability rails: even max gravity gets ducked sometimes…
  pnrUnderMax: number;         // …and even a non-shooter occasionally gets chased over
  pnrUnderConcedeSec: number;  // how long a ducking defender drops back and concedes the pull-up
  pnrSetDwellSec: number;      // beat between screen contact and the screener's roll/pop read
  pnrRollGravityCut: number;   // screener gravity below this rolls; above pops
  pnrMidPopScoreCut: number;   // min mid-pop score (mid green light × midRange ability) for the short pop
  pnrMidPopChance: number;     // chance an eligible low-gravity screener pops to the elbow instead of rolling
  pnrPopFeedBonus: number;     // pass-utility bonus for the throwback to the popped screener at his spot
  screenerMidPopWeight: number; // screener-selection affinity for the mid-pop big (gravity-gated)
  pnrDropDepthFt: number;      // screener defender's drop-coverage depth from the rim
  pnrDriveBonus: number;       // handler drive-utility bonus coming off the screen
  pnrMinShotClock: number;     // don't start an action later than this
  /** action-call eligibility ring (holder rim distance, ft): calls come
   *  from initiation range — not under the rim, not from the backcourt */
  actionCallMinRimFt: number;
  actionCallMaxRimFt: number;
  pnrWaitBoost: number;        // handler hold-utility boost while the screen arrives
  pnrMaxScreenDistFt: number;  // screener candidates farther than this are skipped
  // screener-selection scoring (actionTick): low-gravity size makes a good
  // screen (his man sags), discounted by travel distance. Were inline weights.
  screenerGravityWeight: number; // weight of (1 - gravity) in the screener score
  screenerHeightBaseIn: number;  // height baseline subtracted before scaling
  screenerHeightDiv: number;     // divisor turning height-over-baseline into score
  screenerStrengthDiv: number;   // divisor on strength's screener-score contribution
  screenerTravelDiv: number;     // divisor penalizing how far the screener must travel
  // poster-selection scoring (actionTick): post appetite carries it, strength
  // and finishing make it credible. Were inline weights.
  posterTendOffset: number;      // post-tendency neutral point for the poster score
  posterScoreBase: number;       // base multiplier before strength/finishing add in
  posterStrengthDiv: number;
  posterFinishingDiv: number;
  // DHO-receiver-selection scoring (actionTick): a shooter who also sprints in.
  dhoRecvGravityWeight: number;
  dhoRecvMotionWeight: number;
  // post-up action
  postCallShare: number;       // weight of the post option in the action-call roll
  postCallCut: number;         // minimum poster score to consider an entry
  postEntryBonus: number;      // pass-utility bonus for feeding a settled poster
  /** arrival gate for designed feeds (post entry, pop throwback), ft: the
   *  bonus applies only once the target stands AT his spot */
  feedArrivalFt: number;
  postWorkBoost: number;       // hold bonus during the backdown window
  postBackdownSec: number;     // how long the poster works before shoot-or-spray
  postShotBonus: number;       // shoot bias once the backdown is worked (vs single coverage)
  postDurationSec: number;     // action lifetime (posting + working)
  // isolation action
  isoCallShare: number;        // weight of the iso option in the action-call roll
  isoTendOffset: number;       // iso tendency neutral point (score = max(0, (iso − offset)/100))
  isoDriveBonus: number;       // attack commitment while the iso is live
  isoDurationSec: number;      // iso window length
  // dribble-handoff action
  dhoCallShare: number;        // weight of the DHO option in the action-call roll
  dhoHandoffDistFt: number;    // receiver proximity that triggers the handoff pass
  dhoStunSec: number;          // trailing-defender stun on the catch (the hub is the screen)
  dhoDurationSec: number;      // action lifetime
  dhoHandoffBonus: number;     // pass-utility bonus for the handoff itself
  blitzBeyondFt: number;       // blitz an extreme-gravity HOLDER beyond this range
  transitionPullUpBonus: number; // rhythm-three bias in transition (green-light gated)
  defCrashFarChance: number;   // base chance a perimeter defender crashes the glass
  defCrashFarSkill: number;    // extra crash chance per unit of his defReb
  // closed-loop usage pressure
  usageShareSwing: number;     // target share = 0.20 + n-ish swing (usage 90 -> ~30%)
  usageGainEV: number;         // EV pressure per 100% of target-vs-realized share gap
  usagePriorPoss: number;      // Bayesian prior possessions (kills cold-start spikes)
  // quarter-opener deliberateness (concept 9, opening set; ai/concepts.ts
  // openerSet, consumed at the end of decide.ts uShoot/uDrive sums)
  openerShootMalus: number;    // EV malus on shooting inside the opener window (0 = STAGED dark)
  openerDriveShare: number;    // share of the shoot malus the drive channel pays
  openerRampFloorShare: number; // shot-clock share where the suppression reaches zero
  /** 1 = the period break stages the next period's inbound formation
   *  (possession.ts endPeriod calls setupDeadTargets, the fdesign-grammar
   *  M1a structural half), so the opener is a genuine full-court trip;
   *  0 = STAGED legacy: players idle where the horn froze them */
  openerResetOn: number;
  // OREB scramble economy (concept 10; the terms live
  // at their decide.ts sites; doctrine in ai/concepts.ts)
  orebPutbackBonus: number;    // uShoot term on a putback-taxonomy touch (0 = STAGED dark)
  orebKickBonus: number;       // pass-utility term to arc teammates inside the kick window (0 = STAGED dark)
  orebKickWindowSec: number;   // rebounder's kick-out read window after the grab, sec (0 = STAGED
                               // dark: the context is never true, keeping the kickout taxonomy inert too)
  /** relocation-hold window (sec) for the perimeter re-fill behind a
   *  secured OREB (ai/offense.ts onOrebSecured, the fdesign-grammar M2a
   *  supply half): getback/off-spot arc teammates sprint back to their
   *  spots so the kick-out read has a receiver. STAGED 0 = off (no
   *  positioning state touched) */
  orebRefillSec: number;
}

export const aiDefaults: AiParams = {
  // Concept master scales (ai/concepts.ts). FEEL — 1.0 by definition at
  // introduction: the consolidation was proven byte-identical at these
  // defaults, so each concept's sub-dials carry their historical values
  // and the master scale is the sweep's budget knob for the whole concept.
  decisivenessScale: 1,
  actionCommitScale: 1,
  advantageScale: 1,
  tempoScale: 1,
  // concept 7's master (FEEL — 1.0 by definition at introduction, the
  // budget knob over every concept-7 term; joins the sweep surface in the
  // calibration commit, after the coupling goes live)
  scorePressureScale: 1,
  // Concept 7 (SCORE PRESSURE) sub-dials. The tilt is the max fractional
  // continuation reshape at/beyond the saturation margin: the trailing
  // team presses (yardstick down), the leader coasts (yardstick up).
  // MEASURED NULL — the fit ladder ran tilt 0.05-0.20 at n=240/point
  // (findings/b2-fit-tilt005/010/015/020.md) and θ (the per-quarter
  // margin mean-reversion the coupling exists to buy) never moved: the
  // yardstick channel's early-offense drift is cancelled by the
  // transition counterforce the design itself named (a pressing team's
  // quick misses feed the leader's transition — design-coupling.md §0),
  // while the side effects (fga up ~+0.6, tov down ~−0.7 at tilt 0.10)
  // appear anyway. Kept at 0: channel 2 (scorePressureDefGain below)
  // carries the coupling. At 0 the multiplier is exactly 1
  // (continuation × 1 === continuation), so the channel stays provably
  // inert — do not revive it by magnitude escalation; the transfer
  // function is flat where it is safe to operate.
  scorePressureTilt: 0,
  // FEEL — identity-shape: how deep a lead saturates the press/coast. At
  // the designed tilt, a 10-point margin is a ∓5% lean on the yardstick
  // (between swingBase and transitionBonus in EV terms — a real but
  // subtle lean); the ∓10% cap is ~1/3 of the endgame hurry's full cut.
  scorePressureMarginRef: 20,
  // Concept 7 CHANNEL 2 (DEFENSIVE INTENSITY): the same signed pressure,
  // applied by defense.ts#containOnBall to the on-ball containment gap
  // and the closeout slack — the trailer's defense presses up, the
  // leader's sags off, moving contest levels (and so opponent make%,
  // shot.contestCoef) directly. THE live coupling: this channel carries
  // the margin mean-reversion after channel 1 measured null (see
  // scorePressureTilt above — design-coupling.md §3's staged-channel-2 /
  // OQ1 trigger). Shares the scorePressureScale master (scale × gain);
  // deliberately NO urgency fade — defense manufactures no violations
  // (the asymmetry vs channel 1 is documented at
  // concepts.ts#scorePressureDefMult).
  // FITTED — the channel-2 θ ladder, g ∈ {0.10, 0.20, 0.30, 0.45} at
  // n=240/point (findings/b2-fit-defgain010/020/030/045.md), confirmed
  // by the ship-set trial with concede riding along
  // (findings/b2-trial-setC.md). At 0.30: θ = 0.086-0.098/quarter,
  // inside the P1 band [0.07, 0.16]; mean |m| 12.4 (NBA 12.58);
  // blowout-20+ 19.2% (NBA 19.1%); 91% of per-pairing talent drift
  // preserved (K = 0.910 ± 0.169, favorite win% unchanged 70.8→70.8);
  // fga/tov in-band (fga +0.4, tov −0.6). The wall is measured: 0.45
  // breaches the fga ceiling (+0.87) and crashes tov (−0.89,
  // findings/b2-fit-defgain045.md) — do not escalate the gain to buy
  // more θ; the master scale's sweep rail (knobs.ts) is the sanctioned
  // adjustment surface.
  scorePressureDefGain: 0.3,
  // concept 8's master (FEEL — 1.0 by definition at introduction, the
  // budget knob over every probe-culture term)
  probeScale: 1,
  // FEEL — sc/full above which halfcourt offense counts as probing:
  // halfcourt entry lands at sc ≈ 18-20, so 0.62 ≈ the first 4-5 s of the
  // set offense; the ramp is zero by mid-clock, far above urgencySec.
  // Ships at its DESIGNED value even while the concept is staged — the
  // window ramp divides by (1 − probeClockShare), so "window share 1"
  // would be 0/0, not off; the magnitudes below are the off-switch.
  probeClockShare: 0.62,
  // LIVE at the B2 dose since the W28 pricing landed (REGISTER W69). The
  // history: the B2 campaign measured the standalone dose positive
  // (+0.13 passes/poss, fga −1.0 — findings/b2-fit-probe-high/bisect.md)
  // but DESTRUCTIVE beside the live channel-2 coupling (θ 0.098→0.038,
  // talent-drift keep 91%→28% on the fixed pools; b2-trial-setB vs setC):
  // the probe's early-shot suppression blocked exactly the early-offense
  // channel game-state pressure expresses through. The pricing arc's
  // answer is probePressureFade — the probe yields precisely where the
  // coupling works. Measured at the flip (fitted-roster cohorts, n=360
  // per cohort per arm, seeds w19-*): θ preserved on BOTH cohorts
  // (self +0.014 ± 0.033, gap +0.002 ± 0.034 vs control), favorite win%
  // 64.2 → 62.5 (± 3.6, noise-compatible), buy +0.047-0.050 passes/poss,
  // fga ±0.2, tov +0.3-0.5, fta −0.5, |m| −0.4. The unpriced flip was
  // re-measured DESTRUCTIVE on the same cohorts first (gap θ → −0.013,
  // win → 55.9) — the fade is load-bearing, not decorative.
  probeSwingBonus: 0.15,
  probePressureFade: 1,
  probeShootMalus: 0.08,
  // FEEL: concept 9 master (the flow fit's budget knob). Registered in
  // knobs.ts only after the fit flips the concept live: bands cannot see
  // opener timing, so an early registration would let a sweep zero the
  // opener for ~+0.2 fga (the sub-dial doctrine lives with
  // openerShootMalus at the end of this block).
  openerScale: 1,
  // FEEL: concept 10 master (the flow fit's budget knob). Registered in
  // knobs.ts only after the fit flips the concept live; its lo rail then
  // protects the fitted putback/kick floor, because bands cannot see
  // second-chance grammar, and the wrong-reference incident that invited
  // suppression is why flow.test.ts carries a putback floor at all.
  scrambleScale: 1,
  // Pass-back damping (concept 3's negative side): an immediate return
  // pass UNDOES the advantage — it recreates the geometry the last pass
  // just left, so it is worth less than the receiver's raw shot quality
  // implies. Without it, near-tied pass utilities oscillate: the texture
  // forensics measured 26.8% of ALL passes as A->B->A returns within 3s
  // (the ping-pong the eye test caught). A genuine give-and-go survives
  // the malus — the cutter bonus prices the advancing half of the play.
  // FEEL — malus decays linearly across the window.
  passBackWindowSec: 2.5,
  passBackMalus: 0.22,
  // Purposeful relocation — the second half of stillness-as-default.
  // Spacing is HELD until the ball bends the defense; THEN shooters shake.
  // While a drive is live, a shooter drifts away from his defender,
  // restoring the open catch. Without this, stillness strangled the
  // catch-and-shoot economy: 3PA share pinned at ~24% and the sweep
  // refused more volume because contested 3P% would sink through its
  // floor (texture-increment finding). FEEL.
  relocateRatePerTick: 0.06,
  // The denied shooter's own schedule: a couple of baseline escapes per
  // possession, not a perpetual carousel — at 0.06 shared with the drive
  // trigger the elite benchmark ran corners every 1.7s, was always open,
  // and exploded to 34.9 PTS on 18 threes (fidelity incident). FEEL.
  relocDeniedRatePerTick: 0.014,
  relocateDriftFt: 4,
  relocDurationSec: 1.6,
  // Spacing spots get a small seeded jitter each possession (uniform
  // ±spotJitterFt per axis, rolled once in assignSpots) so five players
  // don't occupy five bit-identical coordinates every trip. The Turing
  // baseline's judges caught the artifact directly: every top-of-arc three
  // logged at exactly 26 ft, every dunker-spot finish at the same 4-5 ft
  // (data/nba/flow-reference.json meta.turingBaseline). Real halfcourt
  // spots are ZONES a player re-picks each trip, not points — ±2 ft keeps
  // a "26 ft" three varying across ~24-28 ft without moving anyone to a
  // different basketball spot. Two guards keep jitter from CHANGING the
  // spots' basketball meaning (see offense.ts rollSpots): corners jitter
  // along the baseline only (lateral pinned exactly at the template's
  // inside-the-line offset — the D3 decision must not be silently
  // reversed OR shortened into easier junk 2s), and top/wing spots keep
  // spotJitterArcMarginFt of clearance behind the arc (a spacing shooter
  // never deliberately stands on the line; unguarded jitter minted 23-ft
  // catch-and-shoot twos and nudged assisted share over its band edge).
  // FEEL — sized to the tell, small vs every spacing constant that reads
  // positions (defGapBaseFt 5.0, contestRadiusFt 6.5).
  spotJitterFt: 2.0,
  spotJitterArcMarginFt: 0.5,
  zoneTendBias: 0.22,
  pullUpBias: 0.18,
  threeApptScale: 0.35,
  tacticsThreeScale: 0.18,
  contestBrakeAt: 0.35,
  contestBrakeBase: 0.3,
  contestBrakeIQ: 0.35,
  holdAdvance: 0.35,
  holdHalfcourt: 0.0312,
  driveMinDistFt: 9,
  driveProjContestBase: 0.35,
  driveProjContestCrowd: 0.22,
  // FEEL — a drive is priced at its landing spot, 5 ft short of the rim: a
  // layup/floater release point, not the center of the hoop (was inline in
  // decide.ts's projected-finish lerp; audit H-01).
  driveFinishSpotFt: 5,
  handlingBase: 0.55,
  handlingSkillDiv: 160,
  handlingGapDiv: 18,
  // FEEL — the downhill-probability shape around handlingBase (were inline
  // in decide.ts, audit H-01): a 4 ft on-ball cushion is the neutral point
  // (a 9 ft gap is an invitation, 2 ft is a wall), and the rails keep every
  // matchup honest — nobody is helpless (0.2), nobody uncontainable (0.95).
  handlingGapRefFt: 4,
  handlingMin: 0.2,
  handlingMax: 0.95,
  driveTendOffset: 35,
  driveTendScale: 0.42,
  laneCrowdPenalty: 0.1,
  // FEEL — defendersInLane geometry (were inline in decide.ts, audit
  // H-01): the crowd count ignores defenders essentially ON the handler
  // (along ≤ 0.15 of the way to the rim — that's the on-ball matchup,
  // priced separately) and those already under the rim (along ≥ 0.95);
  // inside the slice a defender within 5 ft of the driving line counts,
  // weighted linearly to zero at that edge (about a body's width).
  laneAlongMin: 0.15,
  laneAlongMax: 0.95,
  laneWidthFt: 5,
  driveFlat: -0.05,
  driveTransitionMult: 1.1198,
  passRiskUtilMult: 2.4,
  passEVScale: 0.94,
  // Concept 12 — pass-flight clock charge. FEEL, LIVE at 1 since the
  // session-7 landing (staged dark first, byte-identity proven on the
  // corpus; the flip re-baselined fingerprints and re-scouted fixtures).
  // The chooser prices the receiver's shot at the clock he will CATCH
  // with — the world has charged pass flight to the shot clock since the
  // whistle-free-31s fix (game.ts), and before this flip EVERY measured
  // shot-clock violation was a receiver-catch violation (a grenade pass
  // arriving <=1.5s before the whistle; session-7 verifier's 200-game
  // classification). At the flip (n=160 A/B): violations 0.613 → 0.063/g
  // (-91% on the grenade class, a holder-side share appearing for the
  // first time), passes/poss -0.001, buzzer-beater rate flat, bands
  // 17/17.
  passClockCharge: 1,
  // The get-off window. FEEL, physics-anchored: decision tick (0.1) +
  // catch windup (shot.windupCatchShoot 0.42 / windupCutFinish 0.3) +
  // closeout/re-gather margin. The first cut used the holder's 5 s
  // urgency window and over-suppressed catchable mid-clock swings
  // (-0.111 passes/poss at n=160, session-7 A/B); the window ladder
  // {1.0, 1.5, 2.5} re-measured the trade and the chosen value keeps the
  // grenade cut at minimal volume cost (see the session-7 register row).
  passClockGetOffSec: 1.5,
  // W64 channel 3 — STAGED at 0 (session-8 arc): the flip is a
  // mechanics-tier change (fingerprints re-baseline, fixtures re-scout).
  // The gate/blend mirror shotcall.ts DUNK_ATHLETE_SCORE (sync-tested);
  // the finish rides the ordinary catch path (the lob-fusion experiment
  // is the register's channel-2 falsification row).
  leakOutScale: 0,
  dunkAthleteGate: 74,
  dunkBlendVert: 0.6,
  dunkBlendFin: 0.4,
  leakFinishRadiusFt: 7,
  // #74 increment 1 — LANDED at 0.5 (FEEL per the increment doctrine;
  // knobs.ts carries the range) on the F1-AMENDED mechanism, re-measured
  // after the PR #75 probe amendments: n=96 paired arms on TWO bases put
  // the 0.5 astd purchase inside the issue's priced window on each base
  // independently (-1.46pp acceptance / -1.95 i74dose vs priced
  // -0.7..-2.1) with fgPct FLAT at every dose (the priced ceiling breach
  // never materializes — the Lead's re-measure note, confirmed), while
  // 0.75's pooled read sits ON the window edge (-2.18 ± ~0.3) with the
  // step disagreeing across bases — the increment lands inside windows,
  // not on their boundaries. Full basis: W82 landing extension + PR #75.
  // The carry is the geometry half the probe localized: booking already
  // follows from the booth's own rule (shotcall.ts DUNK_MAX_FT + the
  // sync-pinned athlete gate above) once the gather arrives at the plane.
  transCarryScale: 0.5,
  // #74 F1 — FEEL: one windup of drive cover at well under full sprint
  // (the effective windup is 0.50 s on every released carry, the 0.45 s
  // windupDrive param tick-quantized to the next 0.1 s boundary: full
  // sprint 16 ft/s covers 8.0 ft and the 4.5 ft gate needs only 9 ft/s),
  // so a gated carry arrives whatever fatigue does, and it sits above
  // the decide-time medians the carry exists for (p50 2.1 / p90 3.9 ft,
  // probe n=585 carries) — the carried population survives while the
  // driveShotRangeFt tail (decides out to 12 ft) is severed.
  transCarryGatherFt: 4.5,
  // #114 (arc #58 increment 3) — LANDED at 0.5 (FEEL per the increment
  // doctrine; knobs.ts carries the range) on the probe-selected identity
  // gates. Rungs at n=96 on two bases read the supply channel monotone
  // (plane drive releases 1.5 -> 3.6/TG across the dial) with
  // drive-labeled attempts flat at every rung (the W64 gate); the fgPct
  // 49.5 ceiling was straddled by rung noise at doses >= 0.5 and
  // resolved UNDER the ceiling at n=288 exact supersets on all three
  // bases (48.96-49.29, 17/17 everywhere), while 0.75 breached
  // fgPct+ortg at rung level and sits on the #56 corrected astd floor —
  // the increment lands inside windows, not on their boundaries. The
  // astd purchase at 0.5: pooled 864/arm -0.25pp (cross-base scatter se
  // 0.38); fresh never-touched base n=1152/arm -0.63pp (paired se
  // 0.22), coherent with the arc exchange rate on the measured +0.32
  // unassisted makes/TG. The dose scales arming frequency only; what a
  // blow-by IS lives in the three FEEL shape gates below.
  blowByCarryScale: 0.5,
  // #114 — FEEL: the honest beaten center from the localization probe's
  // threshold grid (n=192 games, commit a1d6325 instrumentation): 1 ft
  // admits the blurred p80 boundary where "won the edge" is ambiguous
  // (3.16 fires/TG), 3 ft cuts honest wins (1.60), 2.0 ft is the center
  // (2.35). Live-commit halfcourt behindFt reads p10/p50/p90 =
  // -5.97/-2.40/+2.40 ft: genuinely beaten states are the top decile,
  // which is the honest shape — most drives do not win the edge.
  blowByBeatenFt: 2.0,
  // #114 — FEEL: soft-count units (ai/shared.ts defendersInLane, lane
  // p50 on live-commit halfcourt ticks reads 0.99). The probe's grid
  // moved fires only 2-5% across 0.25-0.75 — the threshold is not a
  // lever, because a beaten on-ball man with uncommitted help IS an
  // empty lane at decide time and committed help kills any setting.
  blowByLaneMax: 0.5,
  // #114 — FEEL: one windup of drive cover, the transCarryGatherFt
  // arithmetic (the 0.50 s effective windup needs only 9 ft/s to cover
  // 4.5 ft, so a gated carry arrives whatever fatigue does). The gate is
  // free at 4.5 — probe fire-tick rim distances read p10/p50/p90 =
  // 0.4/1.6/3.5 ft, and fires at reach 4.5 equal fires at reach 9 —
  // but it bounds the same teleport tail #75-F1 bounded in transition.
  blowByGatherFt: 4.5,
  cutterBonus: 0.5,
  swingBase: 0.045,
  swingPassOutScale: 0.16,
  swingVisionScale: 0.12,
  // FEEL — re-initiation pull: full-clock EV of feeding a teammate 100
  // creation points above the holder (decays with the shot clock; decideBall)
  playmakerScale: 0.18,
  passContinuationScale: 0.9,
  catchContestScale: 0.72,
  cutRateScale: 0.003,
  dunkerDiveScale: 6, // STAGED — the W64 dose ladder owns the flip

  cutDurationSec: 1.6,
  crashBase: 0.15,
  crashTendScale: 0.6,
  // Contest model internals — the skill floor and projection factor that shape
  // how presence + skill translate to a contest level.
  //   contestSkillFloor: a defender who is physically present always bothers
  //     the shot at least this much, even at the lowest skill (floor of the
  //     skill range). 0.55 means mere presence is 55% of a full contest. FEEL.
  //   contestSkillRange: the remaining headroom from floor to 1.0; at rating
  //     100 the formula reaches floor + range = 1.0. FEEL.
  //   windupProjShare: in anticipatedContest the defender is projected forward
  //     by windupSec × share. 0.8 = 80% of windup (he closes, doesn't overshoot). FEEL.
  contestSkillFloor: 0.55,    // FEEL — presence-only contest floor
  contestSkillRange: 0.45,    // FEEL — additional skill range above the floor
  // A screen-stunned defender still bothers the shot (he is physically
  // present) but can't properly contest. FEEL — tuned so a PnR pull-up is
  // visibly better than a normal one, not automatic; only meaningful
  // alongside pnrStunOverSec/pnrStunUnderSec (the recovery cost).
  pnrStunContestMult: 0.45,
  windupProjShare: 0.8,       // FEEL — defender projection share of windup time
  // Gravity model: three-point ability (attr.three) vs willingness (tend.shotThree).
  // REAL — a great shooter who never shoots gets ignored; a volume gunner who
  // can't shoot still draws *some* respect. Both dimensions are necessary.
  gravityThreeWeight: 0.65,   // REAL — ability weight (three rating) in gravity()
  gravityTendWeight: 0.35,    // REAL — tendency weight (shotThree) in gravity()
  // On-ball detection and off-ball movement thresholds.
  //   onBallRadiusFt: a defender beyond this isn't "on the ball" — the
  //     blitz/reach-in logic and the assist model use this radius. FEEL.
  //   cutRunwayFt: a cut needs runway; a player too close to the rim is
  //     already in the play and can't gain separation. FEEL.
  onBallRadiusFt: 12,         // FEEL — on-ball defender detection radius, ft
  cutRunwayFt: 16,            // FEEL — minimum rim distance to trigger a cut, ft
  // Dunker-spot assignment: gravity below this threshold → dunker spot.
  // 0.42 ≈ defense will ignore him on the perimeter; he's more useful as a
  // lob/putback threat at the baseline. FEEL.
  dunkerGravityThreshold: 0.42, // FEEL — gravity boundary for dunker-spot assignment

  // Crash eligibility: offensive player must be within crashNearFt of the rim
  // to be considered for a crash. Approximately the paint edge. FEEL.
  crashNearFt: 22,            // FEEL — max crash-eligible distance from rim, ft
  // FEEL — crashers attack a seeded spot within ±5 ft of the rim, not the
  // rim's center: the scatter spreads offensive rebounders across the
  // carom zone (two rng draws per crasher, x and y). Was inline in
  // ai/offense.ts onShotReleased (audit H-01).
  crashScatterFt: 5,
  // FEEL — the guard-crash economy's perimeter line (was inline in
  // ai/offense.ts, twice; audit H-01): a defender whose man stands 20+ ft
  // out mostly holds rather than sprinting into the scrum — unconditional
  // crashing had guards poaching long boards from the bigs who carved out
  // the position (hub benchmark ~2 boards short).
  defCrashPerimeterFt: 20,
  // FEEL — box-out positioning (were inline in ai/offense.ts; audit H-01):
  // seal 45% of the way from your man toward the rim (body between man and
  // ball); with no near man to seal, work halfway from where you stand
  // toward the rim.
  boxoutManShare: 0.45,
  boxoutSelfShare: 0.5,
  // PnR roll timing: after the screen sets, the screener becomes a cutter
  // for this many seconds. Reuses cut machinery so the pocket pass emerges
  // without special-casing it. FEEL.
  pnrRollCutSec: 1.7,         // FEEL — roll cut grant duration, seconds
  // Post mechanics:
  //   postArrivalFt: on a self-post, the 'working' phase starts when the
  //     poster gets within this distance of the block target. FEEL.
  //   backdownStepFt: each movement step the poster creeps toward the rim
  //     by this distance (slow power dribbles). FEEL.
  postArrivalFt: 3.5,         // FEEL — self-post block-arrival threshold, ft
  backdownStepFt: 0.15,       // FEEL — backdown creep step per tick, ft
  // FEEL — the backdown's advance stops 4.5 ft from the rim — roughly the
  // restricted-area edge: the turnaround comes from there, not from under
  // the backboard. Was inline in game.ts tickLive (audit H-01).
  backdownStopFt: 4.5,
  // DHO mechanics:
  //   dhoSearchRadiusFt: receivers farther than this from the hub are skipped.
  //     Approximately the arc; a handoff needs to be practical. FEEL.
  //   dhoArcSplitFt: inside this rim distance the DHO catch triggers a drive
  //     commitment; beyond it the catch-and-shoot machinery owns the decision.
  //     Approximately the three-point arc. FEEL.
  dhoSearchRadiusFt: 26,      // FEEL — DHO receiver search radius, ft
  dhoArcSplitFt: 22,          // FEEL — inside-arc drive-commitment threshold, ft
  guardDistBase: 2.8,
  guardDistOpen: 4.5,
  sagStartFt: 16,
  sagRangeFt: 34,
  sagMax: 0.6,
  sagGravityCut: 0.75,
  // FEEL — only all-time shooters get face-guarded; 0.88 gravity needs
  // roughly a 90+ three rating with a heavy three diet
  denyGravityCut: 0.88,
  denyDistFt: 2.2,
  denyBackdoorMult: 3.5,       // FEEL — denial invites the backdoor
  helpSpotPull: 0.28,
  helperGravityWeight: 26,
  // Gravity-penalty factor across helpAggr∈[0,1]: at helpAggr=0 the full
  // ceil× reluctance applies; at 1.0 it drops to ceil−1 — still avoids
  // leaving elite shooters, but rotates off average gravity much more
  // willingly. FEEL — the range is [ (ceil−1)×helperGravityWeight,
  // ceil×helperGravityWeight ] ft-equivalent of gravity penalty.
  helperGravityCeil: 1.35,
  closeoutSlackFt: 1.5,
  // FEEL — lateral quickness is the larger containment share; perimeterD
  // (angles, hand discipline) contributes the rest
  containDBlend: 0.4,
  // FEEL — assignment leash: large enough that a defender beaten by a step
  // is still his man; small enough that a full rotation resets assignment.
  // Distinct from onBallRadiusFt (who counts as "on the ball").
  assignLeashFt: 16,
  // REAL — NBA scorekeeping credits a pass only when it leads to a DIRECT
  // SCORING MOVE, and the allowance is not uniform across the floor: a
  // catch-and-rise jumper is the passer's shot, while the same catch
  // followed by dribbles into a pull-up is the SHOOTER's shot. Interior
  // finishes get one extra beat because the gather/drop-step off a feed
  // is still the pass's basket.
  //
  // Measured against six real 2025-26 games (parsed play-by-play, same
  // definitions): real assisted share by zone is three 87% / rim 51% /
  // paint 46% / mid 32%. Under the old uniform 2-dribble allowance the
  // engine credited three 97% / rim 66% / mid 57% — it was crediting
  // SELF-CREATED shots, which is exactly what a "direct scoring move"
  // rule exists to exclude, and it put league assisted share at 63-65%
  // against the 54-62% band (debt D1) while inflating star assist totals
  // past their real identities.
  assistWindowSec: 2.0,
  /** perimeter/jumper allowance: the catch-and-rise is the pass's shot;
   *  put it on the floor first and it becomes the shooter's */
  assistMaxDribbles: 0,
  /** interior (rim/paint) allowance: one gather/drop-step dribble off a
   *  feed still reads as the pass's basket to a real scorekeeper */
  assistMaxDribblesInterior: 1,
  // FEEL — base action-call rate; raised from 0.022 when usage-rank gating
  // landed so league screen volume held (redistribution, not reduction)
  pnrRatePerTick: 0.03,
  pnrUsageFloor: 0.25,
  // FEEL — how much an open look improves when its defender helps on a
  // drive; prices the paint-touch-and-spray option inside drive utility
  driveKickBoost: 0.2,
  // FEEL — most of a bad drive's downside is recovered by aborting into the
  // reset; only this share is paid (keeps role players suppressed without
  // punishing elite handlers for their own skill)
  driveAbortDiscount: 0.35,
  // FEEL — keeps the dribble alive until the help commits; scaled by
  // remaining drive seconds in decideBall so the terminal decision is free
  driveHoldBoost: 0.25,
  // FEEL — the hold boost's ramp cap: it scales with remaining commit time
  // up to 1 s out — strong at launch, gone by the terminal decision. Was
  // the inline clamp cap in ai/concepts.ts commitmentHold (audit H-01).
  driveHoldRampSec: 1,
  // FEEL — open-three catch-and-shoot decisiveness at full openness (linear
  // to zero at contest 0.5, arc only); the make model already favors the
  // catch rhythm, this makes the DECISION match it
  catchShootBonus: 0.18,
  // FEEL — the arc catch-and-shoot gate: full bonus on a 0-contest catch,
  // fading to nothing by contest 0.5 — only the CREATED advantage fires,
  // never an ordinary swing catch (ungated incident: pace 133 vs band
  // 95-103). Was inline in ai/concepts.ts decisiveness (audit H-01).
  catchShootContestCeil: 0.5,
  // FEEL — the three-point green light (shared by the catch-and-shoot and
  // transition pull-up terms): zero at/below tendency 25 — the light
  // belongs to shooters; a sagged-off big is open precisely because the
  // defense WANTS him shooting — ramping to full at 100 (25 + 75). Were
  // inline in ai/concepts.ts, twice (audit H-01).
  threeGreenLightFloor: 25,
  threeGreenLightRange: 75,
  // FEEL — the drilled in-between game (ai/concepts.ts decisiveness, mid
  // flavor): the elbow/FT-line jumper a mid-range scorer rises into when
  // the defense CONCEDES it (drop coverage, the under, the sag off a
  // non-three big). Deliberately a decision-layer term, not a make-model
  // buff: the shot IS lower-EV than a three (real mid-range runs ~0.85
  // PPS vs ~1.08 for threes) and the sim prices that honestly — an elite
  // open 16-ft pull-up (EV ~1.03) trails the continuation value (>=1.18)
  // until the 5 s urgency window, so pre-fix the shot was NEVER argmax
  // (instrumented: 0 of 780 decisions at 17-20 ft). Real players take it
  // anyway because it is their identity shot and the defense offers it
  // all game; that is what a drilled-behavior term models. Sized to the
  // measured gap: at full green light (tendency 75+) and full openness
  // the term is worth ~0.35-0.5 expected points, enough to make an elite
  // mid-range identity fire mid-clock, while fixture-level identities
  // (shotMid 34-44) get a scaled fraction and fire in the 5-10 s window,
  // matching the late-clock skew of real mid attempts. SWEPT; re-swept
  // at the FLOW landing (f-assembly §3 round 1).
  midRangeBonus: 0.7541998395890331,
  // REAL. 19.5 ft: the analytic boundary between the mid-range game and
  // the long 2 (the 14-19.5 ft band is the real-corpus reference: ~6.8%
  // of NBA FGA). The green light stops here on purpose: the 20-23 ft
  // toe-on-the-line two is the shot modern offenses REMOVED — no coach
  // drills it, so the decisiveness term must not resurrect it (ungated,
  // the term would also amplify the corner-spot junk 2 at ~21.6 ft that
  // D3 deliberately left inside the line — see geometry/court.ts). Long
  // 2s still occur under late-clock urgency, which is what they are.
  midGreenMaxFt: 19.5,
  // FEEL — the worked pop's payoff shot, same doctrine as postShotBonus
  // (0.552): a big who screened, popped to the elbow, and took the
  // throwback is IN his drilled shot — rising is the plan, and the
  // identity check already happened at pop assignment (only a screener
  // whose mid-pop score clears pnrMidPopScoreCut is ever stationed at
  // the elbow), so the bonus is flat rather than tendency-scaled — the
  // exact postShotBonus precedent (the post tendency gates the CALL,
  // not the worked shot). Still contest-gated: a defender who recovers
  // to the pop erases it and the popper swings instead. Without this
  // term the pop was a passing station — the elbow catch lost to
  // hold/re-swing (instrumented: 276 of 314 mid-band ball-handler
  // decisions were argmax=hold).
  midPopShotBonus: 0.75,
  // REAL(ish) — the mid green light's contest ceiling, deliberately WIDER
  // than the arc catch-and-shoot gate's 0.5: the mid-range game lives in
  // front of DROP coverage, so its habitat reads as contest ~0.3-0.45 in
  // this engine's contest model (a drop big 3-5 ft away, in the picture
  // but conceding the rise). NBA tracking classifies most mid attempts
  // as "tight" (defender 2-4 ft) — requiring arc-style openness selected
  // away the shot's actual context and the probe showed the term firing
  // almost exclusively on rare 0.0-contest catches. The make model still
  // charges the contest honestly (contestCoef); this ceiling only widens
  // which looks a mid-range IDENTITY is willing to take. Above it, the
  // contestBrake's judgment stands: that is a bad shot for anyone.
  midContestCeil: 0.65,
  // ---- concept-1 flavor: the drilled halfcourt pull-up three ----
  // The signature modern self-created shot had no term (concept 1 drilled
  // exactly four shots) and its raw numbers can't fire on their own:
  // elite pull-up-3 EV ≈ 1.03 vs a mid-clock continuation of 1.38-1.44;
  // the mid-range restoration's exact pre-fix signature, one zone out.
  // Unassisted made 3s run 1.44/g vs the real 3.87 while made-3 volume
  // already matches: a composition defect, so the fix is a decision-layer
  // decisiveness flavor (midRangeBonus's sibling), never a make-model
  // buff (movePullUp −0.22 matches real pull-up-vs-catch gaps; buffing it
  // would corrupt 3P% calibration, the midRangeBonus doctrine's exact
  // wrong fix). Fit history: the solo fit preferred the 0.5 ladder top
  // (ffit-grammar §2.4), assembly sat G5 floor-edge at the fitted 0.35,
  // and the knot-combo mix shift dropped it LOW (2.5-3.1/g vs floor
  // 3.0). Live at 0.70 per the post-audit flow re-fit
  // (findings/refit-g5.md): the dose-response is convex and 0.70 is the
  // only ladder rung that buys the gate — G5 unassisted made 3s to
  // 3.81/g vs the ≥3.0 floor, band excursions at the mid rungs
  // adjudicated draw noise on paired five-base centers (FG% Δ ±0.0,
  // tpPct +0.3, tpaShare +1.6); the real dose cost is astdShare margin
  // (center 54.4-54.7 vs floor 54.0 — watch it). Registered [0.35, 1.0]
  // in knobs.ts (the midRangeBonus precedent registers the dial itself;
  // the bumped range is refit-g5 §6's bake debt). The sturdier joint
  // re-fit with the reach/riskBase mix stays open (knot-combo §5.5).
  pullUpThreeBonus: 0.7,
  // REAL-ish: 29 ft, the real pull-up band's outer edge (24-29 ft).
  // Beyond it lives the logo bomb; sim deep-3s (≥30 ft) already run
  // 5.08/g vs 2.08 real, and this green light must not refill the excess
  // the heave discipline removes. Identity shape, off the sweep surface.
  pullUpThreeMaxFt: 29,
  // FEEL — the snake stop-short (game.ts drive commit): at FULL
  // midPullUpLight roughly a third of a mid-range artist's drives attack
  // to the pull-up spot instead of the rim; scaled by the light, the
  // benchScorer-shaped fixture (light 0.57) snakes about one drive in
  // five, and everyone without the joint light never does. Kept well
  // under 1.0 on purpose: the rim drive must stay the default or the
  // player stops pressuring the basket and the defense stops dropping —
  // which is the very coverage that makes the middy available.
  driveMidStopChance: 0.5602641382769502,
  // REAL — 16 ft: the canonical pull-up spot, a step behind the
  // free-throw line's 13.75 ft rim distance and the center of the
  // 14-19.5 ft real-mid band. Matches the elbow spot's radial distance
  // (geometry/court.ts) so the snake and the station describe the same
  // piece of floor.
  driveMidStopFt: 16,
  pnrDurationSec: 4.2,
  pnrScreenSetDistFt: 2.2,
  // FEEL — the beat between screen contact and the screener's next job
  // (roll or pop): half a second of the two-man game developing before
  // the read resolves. Was inline in ai/actions.ts (audit H-01).
  pnrSetDwellSec: 0.5,
  pnrStunOverSec: 0.65,
  // FEEL — strong screens hit harder: the over-stun scales by fightBase +
  // strength/fightStrengthDiv (~0.87× at average strength, ~1.03× for a
  // max-strength screener). Were inline in ai/actions.ts (audit H-01).
  pnrFightBase: 0.7,
  pnrFightStrengthDiv: 300,
  pnrStunUnderSec: 0.2,
  pnrUnderSagFt: 3.5,
  pnrUnderBase: 0.8,
  // FEEL — under-probability rails (were inline in ai/actions.ts, audit
  // H-01): even a max-gravity handler gets ducked under sometimes (0.08
  // floor), and even a non-shooter occasionally gets chased over (0.85
  // cap) — no matchup reads as automatic.
  pnrUnderMin: 0.08,
  pnrUnderMax: 0.85,
  // FEEL — a defender who ducks under drops back and CONCEDES the pull-up
  // window for 1.2 s (navUnderUntil): the sag that makes going under a
  // real trade, not a free win. Was inline in ai/actions.ts (audit H-01).
  pnrUnderConcedeSec: 1.2,
  pnrRollGravityCut: 0.52,
  // The PnR short pop (the mid-range half of SUPPLY — a player who is
  // never AT 16 ft can never shoot from 16 ft; pre-fix no spacing spot or
  // action ever stationed anyone in the 14-20 ft band):
  //   pnrMidPopScoreCut — a low-gravity screener whose mid-pop score
  //     (midGreenLight × midRange/100, ai/shared.ts) clears this pops to
  //     the ELBOW instead of rolling: the classic mid-pop big (the
  //     Aldridge/Horford-shaped screen partner). FEEL — 0.1 requires a
  //     real mid appetite (shotMid ≥ ~32) AND a credible jumper
  //     (midRange ~70+ at that appetite): the postAnchor fixture (34/74,
  //     score 0.13) pops; rimRunner (5/28, score 0) and benchBig (6/30,
  //     score 0) can never pop — their defender parks in the paint and
  //     an elbow catch would be the defense's win, exactly the shot the
  //     green-light floor already refuses them.
  //   pnrMidPopChance — an eligible big still mixes in rolls (his rim
  //     dives keep the drop defender honest; a 100% pop diet would be
  //     scoutable and would starve his lob/putback game). FEEL origin,
  //     SWEPT since the FLOW landing (f-assembly §3 round 1): just over
  //     half his screens end in the short pop.
  pnrMidPopScoreCut: 0.1,
  pnrMidPopChance: 0.3722341413102205,
  // FEEL. The throwback: the handler comes off the screen reading the
  // big. The roll half of that read was already priced (the roll is a
  // cut, so the pocket pass earns cutterBonus 0.5); the pop half had no
  // designed feed at all, so the popped big stood unused. 0.3 sits
  // between postEntryBonus (0.22) and the cutter/handoff feeds (0.5):
  // the throwback is a real designed outlet but the counter-read, not
  // the primary rim-bound one. Gated to the popper standing AT his spot
  // while the action lives (arrival check, same shape as entryTarget).
  pnrPopFeedBonus: 0.3,
  // FEEL — mid-pop bigs are PREMIER screening partners in real offenses
  // (the defense must pick a poison: drop concedes the pop, hedge frees
  // the roll), so the screener score gives the mid-pop score a seat.
  // Gravity-gated to gravity < pnrRollGravityCut — an arc-popping or
  // high-gravity screener gains nothing (his pop already goes to the
  // wing), which keeps guards/wings from suddenly out-screening centers.
  // At 1.5, a postAnchor-shaped PF (mid-pop score 0.13) closes most of a
  // rim-running center's structural screener-score edge and takes a real
  // share of the screens; a rim-runner (score 0) is unaffected.
  screenerMidPopWeight: 1.5,
  pnrDropDepthFt: 11,
  pnrDriveBonus: 0.2,
  pnrMinShotClock: 8,
  // FEEL — the action-call eligibility ring (was inline in ai/actions.ts,
  // audit H-01): calls come from initiation range — a holder inside 18 ft
  // is already attacking his advantage, one beyond 31 ft is still
  // bringing the ball up.
  actionCallMinRimFt: 18,
  actionCallMaxRimFt: 31,
  pnrWaitBoost: 0.3,
  pnrMaxScreenDistFt: 26,
  // FEEL — action-SELECTION scoring weights (actionTick), all previously
  // inline literals. These pick WHICH teammate screens/posts/receives a
  // DHO; they shape who-does-what outcomes, so they belong on the sweep
  // surface even though no acceptance band targets them directly.
  screenerGravityWeight: 1.5,
  screenerHeightBaseIn: 70,
  screenerHeightDiv: 28,
  screenerStrengthDiv: 400,
  screenerTravelDiv: 40,
  posterTendOffset: 40,
  posterScoreBase: 0.6,
  posterStrengthDiv: 300,
  posterFinishingDiv: 500,
  dhoRecvGravityWeight: 0.65,
  dhoRecvMotionWeight: 0.35,
  // FEEL — post/iso action weights and windows; the post score is carried by
  // tend.post so a team without a post threat simply never rolls it
  postCallShare: 1.875,
  postCallCut: 0.1,
  postEntryBonus: 0.22,
  // FEEL — designed feeds (the post entry, the pop throwback) pay their
  // bonus only once the target stands within 4 ft of his spot: the feed
  // goes to a man AT his station, not one mid-relocation. Was the inline
  // arrival gate in ai/concepts.ts commitmentPass, twice (audit H-01).
  feedArrivalFt: 4,
  postWorkBoost: 0.224,
  postBackdownSec: 2.2,
  // 7s covers: establish position (~1s) + wait for the entry (~1-2s) +
  // the 2.2s backdown + at least two shoot-or-spray decision windows.
  // At 4.5s the action expired mid-backdown and post scoring never fired.
  postDurationSec: 7.0,
  // FEEL — once position is carved out the turnaround is the default plan;
  // the spray still wins whenever the double spikes a teammate open. Raised
  // from 0.3: a 99-vision hub reached 'working' 7 times a game and sprayed
  // out of ~6 — pass options beat the shot in every near-tie (fidelity
  // probe). Real hubs finish over half their worked post-ups.
  postShotBonus: 0.552,
  isoCallShare: 0.91,
  // FEEL — iso appetite is neutral at tendency 50 and floored at zero
  // (max(0, (iso − 50)/100)): a low-iso handler simply never clears out.
  // Was inline in ai/actions.ts (audit H-01); same neutral-point shape as
  // driveTendOffset/posterTendOffset.
  isoTendOffset: 50,
  isoDriveBonus: 0.15,
  isoDurationSec: 3.0,
  // FEEL — the DHO: the hub-center creation pattern (weight also scales with
  // the caller's creation and the receiver's gravity/motion in actionTick)
  dhoCallShare: 0.9,
  dhoHandoffDistFt: 3.2,
  dhoStunSec: 0.55,
  dhoDurationSec: 3.5,
  dhoHandoffBonus: 0.5,
  // FEEL — the blitz: extreme-gravity holders get a second body beyond the
  // arc (what actually caps an elite shooter's pull-up volume)
  blitzBeyondFt: 20,
  // FEEL — the trailer three: worth ~a quarter point of bias to a shooter
  transitionPullUpBonus: 0.21300953217744822,
  // FEEL — perimeter defenders mostly hold on the shot; rebounding
  // instincts send ~30-50% of them in (defReb-scaled)
  defCrashFarChance: 0.22,
  defCrashFarSkill: 0.35,
  // REAL — usage tendency maps to USG%: 50 = 20% (exactly 1/5 of the
  // offense), each 10 points of tendency = 2.4% of share; the observed NBA
  // spread (10-34%) fits inside the dial's range
  usageShareSwing: 0.24,
  // FEEL — pressure scale: a star fed 15% against a 29% target feels
  // ~+0.2 EV of hunger on his shooting options
  usageGainEV: 1.5,
  // FEEL — realized share is smoothed with this many prior possessions at
  // target, so the first minutes don't produce wild pressure swings
  usagePriorPoss: 6,

  // ---- Concept 9 (opening set): quarter-opener deliberateness ----
  // A real period opener is a coached, scripted possession (real median
  // first-shot 16s vs the sim's 12s; first attack <=8s: real 1.7% vs sim
  // 36.6%; flow-grammar §1b). The malus below raises the shoot/drive bar
  // early in the period's first possession only, never the pass channel
  // and never the continuation (a yardstick raise taxes passes too; the
  // probe-culture record names that exact poison). One possession per
  // period ≈ 2.3% of trips: narrow by construction, assigned by the
  // tip/arrow symmetrically, so it cannot correlate with margin.
  // Fitted 0.32 at the ladder center (ffit-grammar §2.2: 0.45 bought
  // share but overshot the median and inflated opener TOs); re-checked
  // at assembly with M1a live — 0.32 → share 7.7%, 0.26 → 10.3%, the
  // predicted one-rung drop did not materialize, keep 0.32 (f-assembly
  // §6.2). Re-fit to 0.55 on the post-audit engine
  // (findings/refit-g3.md): the audit's mechanics fixes moved the shot
  // economics under 0.32 (opener attack-≤8s share 9.0% pooled vs the
  // ≤6% gate), and 0.55 is the only rung clearing every seed base
  // individually — pooled 4.2%, median 17 s, n=432 openers/dose across
  // three bases. Near the top of the usable window (one base touched
  // the 18.0 s median ceiling): do not ladder higher without watching
  // the median. Magnitude is hand-owned (flow-gated). FEEL →
  // ladder-fitted → re-fitted.
  openerShootMalus: 0.55,
  // FEEL: a blown coverage is still attacked; drives keep a quarter of
  // their appetite inside the window (shooting-foul rows count as first
  // attacks in the corpus definition, so drives are not exempt).
  openerDriveShare: 0.75,
  // REAL-ish: 0.4167 = 10/24. The suppression is full at possession start
  // and dies at shot clock 10 (~14s into the trip), far above the 5s
  // urgency window (no violation risk by construction) and deep enough
  // that the median first shot lands ~15-17s, matching the real 16s.
  // Window shape, identity doctrine; off the sweep surface.
  openerRampFloorShare: 0.4167,
  // M1a, live since the FLOW flip: endPeriod routes through
  // setupDeadTargets, so openers start from a real formation instead of
  // frozen at the horn (setupDeadTargets is rng-free but positions
  // change outcomes). ffit-grammar §2.2 measured G3 unreachable at every
  // malus rung without it. The predicted malus rung-down once this
  // flipped did NOT materialize at assembly (f-assembly §6.2).
  openerResetOn: 1,

  // ---- Concept 10 (scramble economy): OREB putback + kick-out read ----
  // After a player OREB the real game resolves fast: 71.6% of grabs see a
  // team FGA inside 6s (sim 49.9%), and 28.2% of those quick shots are
  // threes (sim 5.5%); the missing loop is overwhelmingly the kick-out
  // three over the collapsed crash, not the tip-back (flow-grammar §2b).
  // Demand half: the putback shoot term and the kick-out pass term. The
  // supply half (M2a, re-filling getback perimeter teammates behind the
  // grab) is ai/offense.ts onOrebSecured, live via orebRefillSec below.
  // Live since the FLOW flip at the ffit-grammar joint-ladder doses.
  // Known residual, owner follow-up: quick-3 share still reads 5-7% vs
  // the 20% floor WITH M2a live — the arc stays receiver-poor at refill
  // 1.8s + window 4s + kick 0.30, and dose saturation was already
  // measured at the 3× ladder, so this is a mechanism question (refill
  // timing vs kick-window phase), not a dose question (f-assembly §6.3).
  // FEEL → ladder-fitted; sized like its concept-1 siblings
  // (catchShootBonus 0.18 … midRangeBonus 0.75) to close a ~0.15-0.25 EV
  // gap against the post-OREB continuation ≈ 1.36.
  orebPutbackBonus: 0.35, // ladder: 0.2 drops putback share below its floor (ffit-grammar §2.3)
  // FEEL → ladder-fitted; between postEntryBonus 0.22 and cutterBonus 0.5,
  // a real designed outlet, not the primary read. 0.45 diagnostic bought
  // quick-3 only +2.4pp while sinking putback share below floor.
  orebKickBonus: 0.3,
  // FEEL: the rebounder's half of the corpus 6s window (pass flight +
  // catch + windup consume the rest); window shape, off the sweep surface.
  orebKickWindowSec: 4,
  // M2a live: one hard relocation, ~20 ft at sprint (FEEL). See the
  // block note above for the open kick-3 residual (f-assembly §6.3).
  orebRefillSec: 1.8
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const aiProvenance: Record<keyof AiParams, Provenance> = {
  decisivenessScale: 'FEEL',
  actionCommitScale: 'FEEL',
  advantageScale: 'FEEL',
  tempoScale: 'FEEL',
  scorePressureScale: 'FEEL',
  scorePressureTilt: 'FEEL',
  scorePressureMarginRef: 'FEEL',
  scorePressureDefGain: 'REAL',
  probeScale: 'FEEL',
  probeClockShare: 'FEEL',
  probeSwingBonus: 'FEEL',
  probePressureFade: 'FEEL',
  probeShootMalus: 'FEEL',
  openerScale: 'FEEL',
  scrambleScale: 'FEEL',
  passBackWindowSec: 'FEEL',
  passBackMalus: 'FEEL',
  relocateRatePerTick: 'FEEL',
  relocDeniedRatePerTick: 'FEEL',
  relocateDriftFt: 'FEEL',
  relocDurationSec: 'FEEL',
  spotJitterFt: 'FEEL',
  spotJitterArcMarginFt: 'FEEL',
  zoneTendBias: 'FEEL',
  pullUpBias: 'FEEL',
  threeApptScale: 'FEEL',
  tacticsThreeScale: 'FEEL',
  contestBrakeAt: 'FEEL',
  contestBrakeBase: 'FEEL',
  contestBrakeIQ: 'FEEL',
  holdAdvance: 'FEEL',
  holdHalfcourt: 'SWEPT',
  driveMinDistFt: 'FEEL',
  driveProjContestBase: 'FEEL',
  driveProjContestCrowd: 'FEEL',
  driveFinishSpotFt: 'FEEL',
  handlingBase: 'FEEL',
  handlingSkillDiv: 'FEEL',
  handlingGapDiv: 'FEEL',
  handlingGapRefFt: 'FEEL',
  handlingMin: 'FEEL',
  handlingMax: 'FEEL',
  driveTendOffset: 'FEEL',
  driveTendScale: 'FEEL',
  laneCrowdPenalty: 'FEEL',
  laneAlongMin: 'FEEL',
  laneAlongMax: 'FEEL',
  laneWidthFt: 'FEEL',
  driveFlat: 'FEEL',
  driveTransitionMult: 'SWEPT',
  passRiskUtilMult: 'FEEL',
  passEVScale: 'FEEL',
  passClockCharge: 'FEEL',
  passClockGetOffSec: 'FEEL',
  leakOutScale: 'FEEL',
  dunkAthleteGate: 'FEEL',
  dunkBlendVert: 'FEEL',
  dunkBlendFin: 'FEEL',
  leakFinishRadiusFt: 'FEEL',
  transCarryScale: 'FEEL',
  transCarryGatherFt: 'FEEL',
  blowByCarryScale: 'FEEL',
  blowByBeatenFt: 'FEEL',
  blowByLaneMax: 'FEEL',
  blowByGatherFt: 'FEEL',
  cutterBonus: 'FEEL',
  swingBase: 'FEEL',
  swingPassOutScale: 'FEEL',
  swingVisionScale: 'FEEL',
  playmakerScale: 'FEEL',
  passContinuationScale: 'FEEL',
  catchContestScale: 'FEEL',
  cutRateScale: 'FEEL',
  dunkerDiveScale: 'FEEL',
  cutDurationSec: 'FEEL',
  crashBase: 'FEEL',
  crashTendScale: 'FEEL',
  contestSkillFloor: 'FEEL',
  contestSkillRange: 'FEEL',
  pnrStunContestMult: 'FEEL',
  windupProjShare: 'FEEL',
  gravityThreeWeight: 'REAL',
  gravityTendWeight: 'REAL',
  onBallRadiusFt: 'FEEL',
  cutRunwayFt: 'FEEL',
  dunkerGravityThreshold: 'FEEL',
  crashNearFt: 'FEEL',
  crashScatterFt: 'FEEL',
  defCrashPerimeterFt: 'FEEL',
  boxoutManShare: 'FEEL',
  boxoutSelfShare: 'FEEL',
  pnrRollCutSec: 'FEEL',
  postArrivalFt: 'FEEL',
  backdownStepFt: 'FEEL',
  backdownStopFt: 'FEEL',
  dhoSearchRadiusFt: 'FEEL',
  dhoArcSplitFt: 'FEEL',
  guardDistBase: 'FEEL',
  guardDistOpen: 'FEEL',
  sagStartFt: 'FEEL',
  sagRangeFt: 'FEEL',
  sagMax: 'FEEL',
  sagGravityCut: 'FEEL',
  denyGravityCut: 'FEEL',
  denyDistFt: 'FEEL',
  denyBackdoorMult: 'FEEL',
  helpSpotPull: 'FEEL',
  helperGravityWeight: 'FEEL',
  helperGravityCeil: 'FEEL',
  closeoutSlackFt: 'FEEL',
  containDBlend: 'FEEL',
  assignLeashFt: 'FEEL',
  assistWindowSec: 'REAL',
  assistMaxDribbles: 'REAL',
  assistMaxDribblesInterior: 'REAL',
  pnrRatePerTick: 'FEEL',
  pnrUsageFloor: 'FEEL',
  driveKickBoost: 'FEEL',
  driveAbortDiscount: 'FEEL',
  driveHoldBoost: 'FEEL',
  driveHoldRampSec: 'FEEL',
  catchShootBonus: 'FEEL',
  catchShootContestCeil: 'FEEL',
  threeGreenLightFloor: 'FEEL',
  threeGreenLightRange: 'FEEL',
  midRangeBonus: 'SWEPT',
  midGreenMaxFt: 'REAL',
  midPopShotBonus: 'FEEL',
  midContestCeil: 'REAL',
  pullUpThreeBonus: 'REAL',
  pullUpThreeMaxFt: 'REAL',
  driveMidStopChance: 'SWEPT',
  driveMidStopFt: 'REAL',
  pnrDurationSec: 'FEEL',
  pnrScreenSetDistFt: 'FEEL',
  pnrSetDwellSec: 'FEEL',
  pnrStunOverSec: 'FEEL',
  pnrFightBase: 'FEEL',
  pnrFightStrengthDiv: 'FEEL',
  pnrStunUnderSec: 'FEEL',
  pnrUnderSagFt: 'FEEL',
  pnrUnderBase: 'FEEL',
  pnrUnderMin: 'FEEL',
  pnrUnderMax: 'FEEL',
  pnrUnderConcedeSec: 'FEEL',
  pnrRollGravityCut: 'FEEL',
  pnrMidPopScoreCut: 'FEEL',
  pnrMidPopChance: 'SWEPT',
  pnrPopFeedBonus: 'FEEL',
  screenerMidPopWeight: 'FEEL',
  pnrDropDepthFt: 'FEEL',
  pnrDriveBonus: 'FEEL',
  pnrMinShotClock: 'FEEL',
  actionCallMinRimFt: 'FEEL',
  actionCallMaxRimFt: 'FEEL',
  pnrWaitBoost: 'FEEL',
  pnrMaxScreenDistFt: 'FEEL',
  screenerGravityWeight: 'FEEL',
  screenerHeightBaseIn: 'FEEL',
  screenerHeightDiv: 'FEEL',
  screenerStrengthDiv: 'FEEL',
  screenerTravelDiv: 'FEEL',
  posterTendOffset: 'FEEL',
  posterScoreBase: 'FEEL',
  posterStrengthDiv: 'FEEL',
  posterFinishingDiv: 'FEEL',
  dhoRecvGravityWeight: 'FEEL',
  dhoRecvMotionWeight: 'FEEL',
  postCallShare: 'FEEL',
  postCallCut: 'FEEL',
  postEntryBonus: 'FEEL',
  feedArrivalFt: 'FEEL',
  postWorkBoost: 'FEEL',
  postBackdownSec: 'FEEL',
  postDurationSec: 'FEEL',
  postShotBonus: 'FEEL',
  isoCallShare: 'FEEL',
  isoTendOffset: 'FEEL',
  isoDriveBonus: 'FEEL',
  isoDurationSec: 'FEEL',
  dhoCallShare: 'FEEL',
  dhoHandoffDistFt: 'FEEL',
  dhoStunSec: 'FEEL',
  dhoDurationSec: 'FEEL',
  dhoHandoffBonus: 'FEEL',
  blitzBeyondFt: 'FEEL',
  transitionPullUpBonus: 'SWEPT',
  defCrashFarChance: 'FEEL',
  defCrashFarSkill: 'FEEL',
  usageShareSwing: 'REAL',
  usageGainEV: 'FEEL',
  usagePriorPoss: 'FEEL',
  openerShootMalus: 'REAL',
  openerDriveShare: 'FEEL',
  openerRampFloorShare: 'REAL',
  openerResetOn: 'FEEL',
  orebPutbackBonus: 'REAL',
  orebKickBonus: 'REAL',
  orebKickWindowSec: 'FEEL',
  orebRefillSec: 'FEEL'
};
