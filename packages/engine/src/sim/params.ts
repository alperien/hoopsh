/**
 * SimParams — THE calibration surface.
 *
 * Every tunable BEHAVIORAL constant in the engine lives here, in one flat,
 * serializable object. Nothing else in the engine may hardcode a constant that
 * affects outcomes: the harness sweeps THIS file (`npm run sweep`) against real
 * NBA acceptance bands, so a number hidden elsewhere is a number the optimizer
 * cannot reach.
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
 * 4. PROVENANCE. Values fall into three kinds, and the comments say which:
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
 * MAP OF THE FILE — ten blocks, interface first, then calibrated defaults.
 * Each block name appears exactly TWICE: the first grep hit is its interface
 * (docs live there), the second is its defaults (provenance lives there).
 * `withParams`, the merge/validation boundary, closes the file.
 *   shot     make-chance logits per zone + skill/contest/fatigue coefficients
 *   foul     whistle rates (shooting, reach-in, charge, loose-ball) and FTs
 *   pass     turnover-risk logit, steal/OOB split, delivery quality
 *   reb      rebound positioning weights, putbacks, dead-ball caroms
 *   decide   decision cadence, continuation curve, appetites, temperature
 *   move     speeds, transition/advance definitions, dead-ball timing
 *   fatigue  energy drain and bench recovery rates
 *   sub      rotation thresholds, crunch/concede regimes, minutes controller
 *   endgame  the flag-gated endgame layer's dials (GameConfig.endgame)
 *   ai       EXPECTED-POINTS utility weights: concept master scales, shot
 *            selection, drive, pass, screens/actions, the closed usage loop
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface SimParams {
  tickHz: number;
  frameEvery: number; // record a replay frame every N ticks

  shot: {
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
  };

  foul: {
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
  };

  pass: {
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
  };

  reb: {
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
    /** scramble rating blend — a coupled set shaping WHO wins each rebound lottery */
    blendOffReb: number;         // offensive: pursuit
    blendOffVertical: number;    // offensive: hops
    blendDefReb: number;         // defensive: positioning
    blendDefBoxout: number;      // defensive: sealing
    blendDefVertical: number;    // defensive: tipped reach
    blendHeightPerIn: number;    // both sides: weight per inch of height
  };

  decide: {
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
  };

  move: {
    /** halfcourt movement speed as a share of max sprint */
    halfcourtSpeedMult: number;
    /** soft-collision avoidance radius, ft */
    avoidRadiusFt: number;
    /** on-ball defender ideal gap vs average shooter, ft */
    defGapBaseFt: number;
    /** gap shrink per unit of shooter gravity (three rating & tendency) */
    defGapGravityFt: number;
    /** gap GROWTH per unit of drive threat (tend.drive x speed) — sag off the freight train */
    defGapDriveFt: number;
    /** distance from rim where help defense triggers on a drive */
    helpTriggerFt: number;
    /** contest radius — defenders inside this affect the shot */
    contestRadiusFt: number;
    /** contest-skill mix: share contributed by role defense (interiorD near
     *  the rim, perimeterD outside) vs generic contestSkill */
    contestDBlend: number;
    /** collision-separation share absorbed by a live poster's opponent */
    postLeanShare: number;
    /** interior-vs-perimeter role-defense boundary for the contest model, ft */
    nearRimFt: number;
    /** ball-handler speed (ft/s) above which dribble accounting accrues */
    dribbleSpeedFtS: number;
    /** seconds of dribbling above that speed per counted dribble (assist window) */
    dribbleSec: number;
    /** within this of the computed spot, off-ball players STOP (stillness-as-default) */
    arrivalDeadbandFt: number;
    /** defensive version: sag ideals drift with every ball move — reposition on the CATCH, not continuously */
    defDeadbandFt: number;
    /** defensive stance speed share when not sprinting (shuffle, don't glide) */
    stanceSpeedMult: number;
    /** defensive sprint multiplier on lateral speed (closeouts, help
     *  rotations, blitzes run hot; still capped by the fatigue-scaled max) */
    defSprintMult: number;
    /** off-ball spacing moves are WALKED (share of max) — spots are held, not chased */
    offBallWalkMult: number;
    /** the ball-handler's bring-up is a dribble-JOG (share of max), not a sprint */
    advanceJogMult: number;
    /** the retreat after a score/shot is a JOG (share of max) — nobody sprints back unpressured */
    getbackJogMult: number;
    /** non-sprint crash/boxout repositioning speed (share of max) — short, quick, not a dash */
    crashWorkMult: number;
    /** transition hard cap, sec — safety only; the real end is the defense getting SET */
    transitionMaxSec: number;
    /** the defense is SET once this many defenders are back — ends the
     *  transition phase (game.ts) and zeroes the transition continuation cut
     *  (ai/concepts.ts); shared definition lives in resolve.ts defendersBack */
    transSetBackCount: number;
    /** "back" = inside this distance of the rim being defended, ft */
    transBackRadiusFt: number;
    /** the advance→halfcourt flip: the offense initiates once the holder is
     *  inside this rim distance (the logo pickup), ft */
    advancePickupFt: number;
    /** dead-ball timing (the freeze applies fatigue; a clockRuns caller also
     *  burns game clock): the standard whistle/basket read, and the shorter
     *  same-possession side-out resume (no team change) */
    deadBallResumeSec: number;
    deadBallSideOutSec: number;
    /** made-basket dead time before the inbound (the game clock RUNS
     *  through it outside the final two minutes — real inbound time) */
    madeBasketResumeSec: number;
    /** free-throw trip cadence: walk-to-the-line lead-in, the between-
     *  attempts ritual, and the made-final-FT resume before the inbound */
    ftSetupSec: number;
    ftBetweenSec: number;
    ftMadeResumeSec: number;
  };

  fatigue: {
    drainPerSec: number;
    sprintDrainMult: number;
    recoverPerSecBench: number;
    /** speed multiplier at zero energy */
    minSpeedMult: number;
  };

  sub: {
    /** energy threshold that queues a substitution at the next dead ball */
    tiredThreshold: number;
    /** extra energy points a bench player is pulled earlier than a starter */
    benchTiredBonus: number;
    rotationLeashScale: number;  // energy-leash points per 100% of minutes-pace deviation
    rotationLeashMax: number;    // leash adjustment cap (energy points)
    /** energy at which a bench player is considered ready */
    readyThreshold: number;
    /** ready-bar relief for a behind-pace targeted player (returns eagerly) */
    readyReliefBonus: number;
    /** minutes-pace below which a targeted player counts as behind (returns eager) */
    eagerReturnPace: number;
    /** minutes-pace above which a rested targeted player is held back */
    aheadHoldPace: number;
    /** crunch time: final period under this many clock seconds (every OT
     *  stoppage qualifies regardless of clock — subs.ts checkSubs), close game */
    crunchClockSec: number;
    /** crunch margin: absolute score gap at/under which crunch rotation applies */
    crunchMarginPts: number;
    /** crunch energy floor: a starter this rested can be pulled back on late */
    crunchEnergyMin: number;
    /** concede (garbage time): in the final period the LEADER pulls his
     *  starters once the margin clears a clock-scaled line —
     *  line(clock) = concedeMarginBase + concedeMarginPerMin × minutes left */
    concedeMarginBase: number;
    concedeMarginPerMin: number;
    /** extra margin the TRAILING coach needs before he concedes too */
    concedeTrailLagPts: number;
    /** hysteresis width: concede exits this many points below the entry line */
    concedeExitPts: number;
    /** energy floor for a garbage-time bench body (floor presence, not burst) */
    concedeEnergyMin: number;
  };

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
  endgame: {
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
    /** opponent unanswered points that trigger a stop-the-bleeding timeout.
     *  REAL: coaches burn one at 8-0/10-0 to reset a run. STAGED-legacy:
     *  the game-wide coach hazard below subsumes this deterministic trigger
     *  at the timeout-economy flip (fdesign-timeouts §1.3/§6; the fit wave
     *  retires it via 999, then it is removed). Until then it is the shipped
     *  stop_run behavior and must not move. */
    timeoutRunPts: number;
    // --- timeout economy, game-wide (fdesign-timeouts, STAGED wiring).
    // The mandatory/TV-stoppage rule, the Q4 caps, the OT budget, the coach
    // hazard, and the live-ball site all ship at never-fire values so the
    // default stream stays byte-identical; the timeout fit wave flips them
    // (design seeds noted per default below) and owns the corpus fit (§7
    // protocol). All off the sweep surface: the hazard magnitudes are fitted
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
     *  (today's behavior). RulePack-home caveat as above. */
    toOvertimeTimeouts: number;
    /** the live-ball possession-timeout site (grab the defensive board /
     *  steal and call time; 12.4% of real timeouts, and the only path to an
     *  endgame advance off a rebound): 1 = evaluate at live_rebound/steal
     *  possession starts, 0 = STAGED off (site never evaluates) */
    toLiveSiteOn: number;
    // coach voluntary-timeout hazard, one draw per qualifying stoppage for
    // the team with the ball (fdesign-timeouts §2). The four magnitudes ship
    // at 0, so p is exactly 0 and no rng is ever drawn (the stage switch);
    // the window/shape dials ship at design values (unread while p = 0).
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
  };

  /**
   * AI utility weights — the decision layer's knobs, fully sweepable.
   * These shape WHO does WHAT (shot diets, drive rates, ball movement,
   * defensive spacing); the sections above shape how attempts RESOLVE.
   */
  ai: {
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
    /** concept 8: EV subtracted from uShoot inside the probe window (drives
     *  are deliberately exempt — the FTA protection) */
    probeShootMalus: number;
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
    cutterBonus: number;         // hitting an active cutter
    swingBase: number;           // intrinsic ball-movement value
    swingPassOutScale: number;
    swingVisionScale: number;
    playmakerScale: number;      // EV per 100 creation-gap points routed up-hierarchy
    passContinuationScale: number;
    catchContestScale: number;   // openness -> expected catch contest
    // off-ball
    cutRateScale: number;        // per-tick cut chance per unit of motion tendency
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
  };
}

export const defaultParams: SimParams = {
  // 10 Hz: fine enough that a 28 ft/s sprinter moves <3 ft per tick (smooth
  // motion, accurate contests), coarse enough for a >= 1 game/sec budget (hardware-dependent, ~3-6 typical). FEEL.
  tickHz: 10,
  // one replay frame per 2 ticks = 5 Hz: the viewer interpolates between them,
  // and it halves replay size (~1.8 MB/game). FEEL.
  frameEvery: 2,

  shot: {
    // Zone bases — league-average shooter, league-average contest. SWEPT,
    // and they land near real NBA zone efficiencies:
    baseRim: 0.5914,    // sigmoid ≈ 64% at the rim (NBA ~65-68% incl. dunks)
    basePaint: -0.4343418182430332,   // ≈ 41% floaters/short hooks (NBA ~40-45%)
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
  },

  foul: {
    // Shooting-foul probability per attempt, at average contest and average
    // drawFoul. Steeply zone-dependent, like real officiating: contact at the
    // rim is whistled constantly, a jump shot almost never. These four values
    // are the primary lever on league FTA/game (band: 18-27). SWEPT — and
    // the most coupling-sensitive knobs in the file (see header point 5).
    shootRim: 0.3998,
    shootPaint: 0.1304,
    shootMid: 0.05,
    shootThree: 0.012,
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
    // Per SECOND of on-ball pressure inside ~4 ft. Over a possession this
    // yields the handful of reach-ins a real game produces. SWEPT.
    reachInPerSec: 0.019111332459994627,
    // FEEL — power dribbles expose the ball; attack volume pays a live-ball
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
    // three 16-game seed bases at current drive exposure);
    // previously tagged SWEPT but never registered in harness/knobs.ts
    // (unsweepable in practice) — registered there now, so the coordinated
    // sweep owns it henceforth.
    chargePerDrive: 0.0034,
    // Per-tick multiplier folded into the charge roll (game.ts tickLive:
    // chargePerDrive × dt × this). FEEL — the ×2 was an inline literal.
    chargeTickMult: 2,
    // Loose-ball fouls per contested rebound scramble. SWEPT.
    looseBallPerReb: 0.0382566165233726
  },

  pass: {
    // Base turnover logit for an unpressured pass ≈ 1.7% — passes are
    // mostly safe, and turnovers come from the lane-occlusion term below.
    // This is the primary lever on league TOV/game (band 11.5-15.5). SWEPT.
    riskBase: -3.95,
    // A defender sitting in the passing lane is the real turnover cause:
    // full occlusion adds 1.6 logits (~1.7% → ~8%). SWEPT.
    laneRiskCoef: 1.6,
    // Vision/accuracy reduce risk; an elite passer roughly halves it. SWEPT.
    skillCoef: 0.75,
    // Of failed passes, ~55% are stolen (credited to a defender) and the rest
    // sail out of bounds. Splits the TOV total into STL vs dead-ball. SWEPT.
    stealShare: 0.5191718888538026,
    // Ball speed in flight, ft/s. A 25 ft pass takes ~0.55 s — long enough
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
  },

  reb: {
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
    // rather than resetting the offense. FEEL, and it produces the putback
    // shot type. SWEPT-adjacent.
    putbackChance: 0.4454454268146934,
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
  },

  decide: {
    // Seconds between ball-handler decision evaluations (jittered per
    // decision by intervalJitterLo/Hi below). Roughly "how often a player
    // re-reads the floor" — the main lever on how many actions fit in a
    // possession. SWEPT.
    intervalSec: 0.6571,
    // FEEL — the cadence jitter: each window is intervalSec × uniform
    // [0.75, 1.3] (−25%/+30%, mildly long-skewed) so decisions never land on
    // a metronome. Was inline in game.ts tickLive (audit H-01; the old
    // "±25%" doc here understated the upper edge).
    intervalJitterLo: 0.75,
    intervalJitterHi: 1.3,
    // Softmax temperature over action utilities, in expected-points units.
    // Low (0.06) = players nearly always take the best option; raising it adds
    // human noise and bad decisions. This is the engine's "IQ dial". SWEPT.
    temperature: 0.0732,
    // REAL-ish — NBA tracking's catch-and-shoot definition is a 0-dribble
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
    // equilibrium; two sweeps could not escape the old basin) — then
    // sweep-polished from this start point
    continuationMax: 1.4714,
    // Curve exponent: value = max × (shotClock/full)^curve. At 0.22 the value
    // decays slowly then falls off a cliff late — mirroring how real offenses
    // stay patient until roughly 6-8 seconds remain. SWEPT.
    continuationCurve: 0.142,
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
    delayOrebSec: 0.35
  },

  move: {
    // Nobody sprints in the half court: cruising speed is 72% of max.
    // (Sprinting is reserved for transition, cuts, closeouts, crashes.) FEEL.
    halfcourtSpeedMult: 0.72,
    // Soft body radius, ft — players push apart below this. Two shoulders'
    // width; prevents overlap without simulating real collisions. FEEL.
    avoidRadiusFt: 2.4,
    // On-ball defensive gap vs an average shooter, shrinking by up to
    // defGapGravityFt against a maximum-gravity shooter. THIS PAIR IS WHY
    // ELITE SHOOTERS CREATE SPACE: a defender must play Curry ~2.8 ft
    // tighter, which is what a drive attacks. FEEL, high realism impact.
    defGapBaseFt: 5.0,
    defGapGravityFt: 2.2,
    // FEEL — a full drive threat buys ~1.6 ft of cushion (concede the jumper)
    defGapDriveFt: 1.6,
    // A drive inside this distance from the rim summons help — the trigger
    // that makes drive-and-kick emerge without scripting it. FEEL.
    helpTriggerFt: 15,
    // Defenders within this radius affect a shot's contest level. Roughly the
    // distance from which a closeout can still bother a shooter. FEEL.
    contestRadiusFt: 6.5,
    // FEEL — role defense carries just under half the contest-skill definition
    contestDBlend: 0.45,
    // FEEL — post play is legal contact: the defender absorbs most of the
    // body separation when a live poster leans in (0.5 = symmetric)
    postLeanShare: 0.85,
    // Rim-proximity threshold for role-defense blending in the contest model:
    // inside nearRimFt the interior-defense skill (interiorD) applies instead
    // of perimeterD. Approximately the paint distance where rim protection
    // begins to matter more than perimeter footwork. FEEL.
    nearRimFt: 14,  // FEEL — interior-vs-perimeter role-defense boundary, ft
    // Dribble accounting for the assist window: while the holder moves faster
    // than dribbleSpeedFtS, every dribbleSec of it counts as one dribble.
    // FEEL — were inline literals in game.ts tickLive.
    dribbleSpeedFtS: 3.5,
    dribbleSec: 0.55,
    // Stillness-as-default: within the deadband of the computed spot an
    // off-ball player (either side) holds position instead of micro-chasing
    // a drifting target every tick. Texture forensics found 8.67 ft/s
    // average live speed vs the NBA's ~4.2 with only 28% of player-frames
    // stationary — real spacing is HELD, not jogged. FEEL.
    arrivalDeadbandFt: 1.4,
    // Defense holds a WIDER deadband: the sag ideal drifts a little with
    // every ball movement, and chasing each drift is the shuffle-noise the
    // texture probe measured. Real defenders re-position on the catch.
    // Containment, closeouts, helps, and denial are never deadbanded. FEEL.
    defDeadbandFt: 2.6,
    // Texture probe (by role, before these dials): defense averaged 8.7 ft/s
    // — every small sag adjustment ran at FULL lateral speed. A defender in
    // his stance shuffles; the defSprintMult below still applies to
    // closeouts, helps, and blitzes. FEEL.
    stanceSpeedMult: 0.48,
    // FEEL — the defensive sprint runs HOT on lateral quickness: closeouts,
    // help rotations, and blitzes beat the shuffle by 15%, still capped by
    // the fatigue-scaled sprint max (ai/shared.ts moveSpeed). Was the inline
    // 1.15 there — closeout speed is a contest-quality lever, not cosmetics
    // (audit H-01).
    defSprintMult: 1.15,
    // Off-ball offense averaged 7.4 ft/s: spot repositioning ran at the
    // 0.72 cruise. Spacing is walked to and HELD (cuts/crashes/transition
    // still sprint via the sprinting flag; the ball-holder keeps the cruise
    // multiplier — this only walks off-ball spacing moves). FEEL.
    offBallWalkMult: 0.3,
    // The bring-up: at the 0.72 cruise the handler crossed halfcourt at
    // ~13.7 ft/s (9+ mph) EVERY possession — the single largest contributor
    // to the speed signature (avg live speed 6.55 vs NBA ~4.2, and the
    // friction signature it drives — see INTERNALS + the speed-pin
    // experiment: the shooting calibration absorbs kinematics errors, so
    // this fix forces a re-fit by design). A real bring-up is a dribble-jog;
    // transition still sprints via the sprinting flag. FEEL.
    advanceJogMult: 0.42,
    // THE CRUISE FALLTHROUGH (frame-attribution probe, speed-fix branch):
    // moveSpeed's offense branch gave every non-defend/non-spot/non-advance
    // intent the 0.72 cruise — so all five defenders crossed the court at
    // ~13.7 ft/s after EVERY score (intent 'getback'), and non-sprint
    // crashers boxed out at the same. 'early' possession windows owned 42%
    // of all fast frames and scrambles another 20% before these dials.
    // Real players jog back (~8 ft/s) and work the boxout, not dash it. FEEL.
    getbackJogMult: 0.45,
    crashWorkMult: 0.5,
    // Transition used to end on a fixed 4.5s clock — the jog economy made
    // that expire mid-floor (defense not back, holder 40 ft out) and the
    // downhill archetype lost its window (drives 4.7 -> 1.27/game, fidelity
    // incident). Transition now ends when the DEFENSE IS SET (4+ defenders
    // inside 30 ft of their rim — arrival-based, like the advance flip);
    // this cap is the chaos-state safety net only. FEEL.
    transitionMaxSec: 7,
    // "The defense is set" — the shared arrival definition (was inline in
    // game.ts's phase flip; promoted when the decision layer started
    // reading the same measure for the transition continuation cut and the
    // defender-aware projected drive contest — resolve.ts defendersBack).
    // 4 of 5 back is a set defense (one trailer is normal); 30 ft covers
    // the arc plus a step — a defender beyond it cannot influence the
    // first action at the rim. FEEL.
    transSetBackCount: 4,
    transBackRadiusFt: 30,
    // FEEL — the advance→halfcourt flip: the offense initiates at the logo
    // pickup, ~36 ft from the rim — not at the arc (32 ft left 54% of the
    // downhill benchmark's decisions inside the drive-gated advance phase
    // after the jog economy; main had 36%). Was inline in game.ts tickLive
    // (audit H-01).
    advancePickupFt: 36,
    // Dead-ball timing (the freeze walk applies fatigue; a clockRuns caller
    // also burns game clock). FEEL — were inline in possession.ts (audit
    // H-01):
    //   deadBallResumeSec — the standard delay: long enough to read the
    //     whistle/basket on a replay viewer, short enough not to visibly
    //     slow the game's pace.
    //   deadBallSideOutSec — the same-possession side-out resume (loose-ball
    //     whistle, team-carom award, non-bonus reach-in): no team change, so
    //     the pause covers the whistle, not a full re-set.
    deadBallResumeSec: 1.8,
    deadBallSideOutSec: 1.2,
    // FEEL — made-basket dead time (was inline in shooting.ts, audit H-01):
    // the scoring team retreats and the inbound comes in over ~2.2 s with
    // the game clock RUNNING outside the final two minutes — the real
    // between-baskets inbound time, and a genuine pace lever (~40 makes a
    // game burn it).
    madeBasketResumeSec: 2.2,
    // FEEL — the free-throw trip cadence (were inline in fouls.ts, audit
    // H-01; fatigue accrues through the whole ritual): 1.4 s to walk to the
    // line and get set (quicker than a full dead-ball read — the whistle
    // already stopped play), 0.9 s of ritual dribble between attempts (the
    // shooter is already set), and a 1.6 s resume after a made final FT (a
    // clean possession change, same length as the period-opening delay).
    ftSetupSec: 1.4,
    ftBetweenSec: 0.9,
    ftMadeResumeSec: 1.6
  },

  fatigue: {
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
    minSpeedMult: 0.82
  },

  sub: {
    // Sub OUT below this energy (starters get a +12 allowance in subs.ts so
    // they play longer stints); a bench player must be at least `ready` to
    // come in, preventing exhausted-for-exhausted swaps. Together these two
    // numbers ARE the rotation pattern: ~8-9 man rotations, starters ~30-34
    // minutes. FEEL, validated by the archetype minutes test.
    tiredThreshold: 62,
    // FEEL — a reserve is pulled 12 energy points earlier than a starter
    // (shorter leash, deeper bench rotation). Was inline in subs.ts checkSubs.
    benchTiredBonus: 12,
    // FEEL — minutes-aware rotation: 10% behind a coach's minutes target buys
    // ~6 energy points of extra leash, capped so nobody plays to collapse
    rotationLeashScale: 60,
    rotationLeashMax: 14,
    readyThreshold: 88,
    // FEEL — rotation-controller gates, were inline in subs.ts checkSubs. A
    // behind-pace targeted player returns eagerly (ready bar relieved by 8,
    // pace < 0.97); an ahead-pace one is held back even when rested
    // (pace > 1.08). 0.97/1.08 bracket the target from both sides so minutes
    // settle at ~target (0.92 gate produced 33 of 36; these two tightened it).
    readyReliefBonus: 8,
    eagerReturnPace: 0.97,
    aheadHoldPace: 1.08,
    // FEEL — crunch time: the final scheduled period inside 5:00 (or ANY
    // point of OT — the tip stoppage included, audit H-02), within 10
    // points; coaches ride starters who can still stand (energy > 35)
    // regardless of the normal fatigue read. Were inline in checkSubs.
    crunchClockSec: 300,
    crunchMarginPts: 10,
    crunchEnergyMin: 35,
    // Concede (garbage time): in the final period starters come out once the
    // margin clears line(clock) = base + perMin × minutes remaining — the
    // linear stand-in for the classic safe-lead heuristics (James'
    // (lead − 3.5)² ≥ seconds left gives ~22.5 at 6:00, ~16.9 at 3:00; the
    // designed line sits within a point or two across the window). All FEEL
    // at the design-garbagetime.md values: base 15 / perMin 1.0 / lag 4 /
    // exit 6 / energyMin 25 — the leader concedes up 21 at 6:00, up 18 at
    // 3:00, up 27 at the Q4 tip; the trailer follows concedeTrailLagPts
    // later.
    // LIVE, verified on the COUPLED engine only (findings/
    // b2-verify-concede.md): with channel 2 carrying the margin coupling,
    // the OOS-walk 30+ regression that blocked the first flip attempt is
    // gone (Δ30+ −0.83pp ± 1.18 — treatment BELOW control), self-play 30+
    // improves −3.5pp (1.7se) and crosses the ≤16 signed-sd gate, close/OT
    // integrity spotless, bands untouched, starters' rest −0.8…−0.9 min/g.
    // Concede REQUIRES the live coupling — do not detach them: uncoupled,
    // generated pools' uneven bench units make post-entry bench-vs-bench
    // play margin-EXPANDING, not the zero-mean drift the design assumed
    // (walk 30+ 5.8→8.3% fam-a, 7.9→10.4% fam-b —
    // findings/b2-fit-concede-oos.md), and the trailLag ladder (4→8→12)
    // could not rescue it without surrendering the balanced-cohort
    // compression (findings/b2-fit-lagkeep.md); under the coupling the
    // adverse long-span flux flips sign and the regression dissolves
    // mechanistically, not by masking.
    concedeMarginBase: 15,
    concedeMarginPerMin: 1.0,
    // FEEL — the trailing coach holds hope ~a possession and a half longer;
    // he pulls only when the deficit is unambiguous (leader's bench first,
    // a token starter run for the trailer, then both benches — the real
    // garbage-time sequence).
    concedeTrailLagPts: 4,
    // FEEL — hysteresis ≈ two possessions: a single 3-and-FT swing cannot
    // flap the lineup, and re-entry must beat a falling line. CONSTRAINT:
    // base + lag − exit (designed: 13) must stay > endgame.foulMaxDeficit
    // (12) — a still-conceded trailer must never sit inside the intentional-
    // foul deficit window (concede.test.ts pins this).
    concedeExitPts: 6,
    // FEEL — any bench body who can stand plays garbage time: looser than
    // crunchEnergyMin 35 because the incoming player needs floor presence,
    // not burst (mostly a degenerate-roster guard — bench sitters recover
    // toward 100 anyway, movement.ts bench recovery).
    concedeEnergyMin: 25
  },

  endgame: {
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
    scale: 0.9850271257403264,
    // a leading team starts protecting the ball inside ~2:30; the ramp means
    // the full milk only shows in the final minute
    leadHoldClockSec: 150,
    // +50% continuation ≈ 2.2 expected points of "just keep it" at full ramp
    // — above any shot the engine generates, so the holder waits for the
    // urgency window (the boost itself fades inside urgencySec, see
    // concepts.ts, so late-clock offense still fires and violations don't spike)
    leadHoldMaxBoost: 0.4179006153562141,
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
    // fouling starts at min(35 s, one full shot clock per possession needed)
    foulTrailMaxClockSec: 35,
    foulMinDeficit: 3,
    foulMaxDeficit: 12,
    foulMinShotClock: 5,
    // 0.0165/s base × 55 ≈ 0.9/s within grab range — the foul lands ~1-1.5 s
    // after the defender reaches the holder (real fouls-to-give cadence)
    foulHuntRateMult: 50.62253679213248,
    foulHuntStripShare: 0.12,
    foulHuntReachDistFt: 6,
    foulHuntGapFt: 1.5,
    // stop-the-run threshold: 10-0 is the canonical "timeout, regroup".
    // Probed at 8 the coaches got chatty (4.3 run timeouts/game combined,
    // a panic button); at 10 it's ~1/game, the real once-or-twice cadence.
    // STAGED-legacy (see interface doc): the fit wave retires this trigger
    // (999) when the coach hazard below goes live.
    timeoutRunPts: 10,
    // Timeout economy (fdesign-timeouts), STAGED-inert wiring values.
    // Every switch below sits at its never-fire value, so shipped behavior
    // (the advance + the deterministic stop-the-run above) is byte-identical
    // to the pre-wiring engine; the timeout fit wave flips to the design
    // seeds noted inline and owns the corpus fit (§7). Not swept.
    toMandatoryFirstBelowSec: -1, // STAGED off; flip: 419 (6:59, NBA Rule 5 VI(b) first anchor; REAL)
    toMandatorySecondBelowSec: -1, // STAGED off; flip: 179 (2:59, second anchor; REAL)
    toFinalPeriodMaxTimeouts: 99, // STAGED unbinding; flip: 4 (REAL Q4 cap)
    toFinalPeriodLateMaxTimeouts: 99, // STAGED unbinding; flip: 2 (REAL after-3:00 cap)
    // 3:00 of the final period, REAL boundary; safe to ship live (only the
    // staged caps/burn read it)
    toFinalPeriodLateSec: 180,
    toOvertimeTimeouts: -1, // STAGED keep-remainder; flip: 2 (REAL per-OT replacement budget)
    toLiveSiteOn: 0, // STAGED off; flip: 1 (live rebound/steal timeout site, §1.2.3)
    toCoachBasePerDead: 0, // STAGED; corpus-fit seed 0.018 (sized from ~33 stoppages/quarter)
    // shape dials at design values, unread while the magnitudes are 0:
    toRunMinPts: 4, // FEEL: engage above the median real run at call (3)
    toRunFullPts: 10, // REAL: the canonical 10-0
    toCoachRunW: 0, // STAGED; corpus-fit seed 0.13 (29%/31% of 8-0/10-0 runs stopped)
    toTrailRefPts: 12, // FEEL: full trail pressure down 12
    toCoachTrailW: 0, // STAGED; corpus-fit seed 0.03 (56.6% trailing-caller share)
    toCoachMaxP: 0.35, // FEEL: hazard ceiling
    toCoachCooldownSec: 120, // FEEL: real per-team spacing ~9 min of game clock
    toQuarterOpenQuietSec: 60, // REAL-ish: first-60s share 1.0% (20/1,986)
    toBurnWindowSec: 300, // REAL: the 5:00→3:00 pre-cap burn window
    toBurnBoost: 0, // STAGED; corpus-fit seed 0.10 (Q4 minute-8 bucket 0.46/g vs 0.28-0.30)
    toStopRunLabelPts: 6, // FEEL: ≥6-run share at real calls is 23.1%
    // advance timeouts live inside the final ~0:45 of a close game
    timeoutAdvanceClockSec: 45,
    timeoutAdvanceDeficitMax: 8,
    // 8 s of wall-clock huddle: reads as a real stoppage in the replay
    // without recording a 75 s empty gym
    timeoutResumeSec: 8,
    // hashmark inbound: possession starts ~28 ft from the attacked rim
    timeoutAdvanceSpotFt: 28
  },

  ai: {
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
    // STAGED — the two probe magnitudes stay at 0 (the provably inert
    // staging: the window terms are exactly +0 appended at the END of the
    // shoot/pass utility sums, x − 0 and x + 0 bit-identical through the
    // softmax). The B2 measurement campaign priced them and DEFERRED the
    // flip: standalone the mechanism is positive (+0.13 passes/poss,
    // fga −1.0, every gated band in position at the selected 0.15/0.08
    // dose — findings/b2-fit-probe-high/bisect.md) but DESTRUCTIVE in
    // combination with the live channel-2 coupling: θ 0.098→0.038 and
    // talent-drift keep 91%→28% on the fixed pools
    // (findings/b2-trial-setB.md vs setC) — the probe's early-shot
    // suppression blocks exactly the channel talent expresses through.
    // Deferred to its own arc with an interaction-aware design; do not
    // flip these alongside the coupling, and re-measure the interaction
    // (not just the standalone dose) when that arc lands.
    probeSwingBonus: 0,
    probeShootMalus: 0,
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
    cutterBonus: 0.5,
    swingBase: 0.0341,
    swingPassOutScale: 0.16,
    swingVisionScale: 0.12,
    // FEEL — re-initiation pull: full-clock EV of feeding a teammate 100
    // creation points above the holder (decays with the shot clock; decideBall)
    playmakerScale: 0.18,
    passContinuationScale: 0.9,
    catchContestScale: 0.72,
    cutRateScale: 0.003,
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
    // all game; that is exactly what a drilled-behavior term models. Sized
    // to the measured gap: at full green light (tendency 75+) and full
    // openness the term is worth ~0.35-0.5 expected points — enough to make
    // an elite mid-range identity fire mid-clock — while fixture-level
    // identities (shotMid 34-44) get a scaled fraction and fire in the
    // 5-10 s window, matching the late-clock skew of real mid attempts.
    midRangeBonus: 0.7081286886721777,
    // REAL — 19.5 ft: the analytic boundary between the mid-range game and
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
    // FEEL — the snake stop-short (game.ts drive commit): at FULL
    // midPullUpLight roughly a third of a mid-range artist's drives attack
    // to the pull-up spot instead of the rim; scaled by the light, the
    // benchScorer-shaped fixture (light 0.57) snakes about one drive in
    // five, and everyone without the joint light never does. Kept well
    // under 1.0 on purpose: the rim drive must stay the default or the
    // player stops pressuring the basket and the defense stops dropping —
    // which is the very coverage that makes the middy available.
    driveMidStopChance: 0.5670019316938034,
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
    //     scoutable and would starve his lob/putback game). FEEL — just
    //     under half his screens end in the short pop.
    pnrMidPopScoreCut: 0.1,
    pnrMidPopChance: 0.55,
    // FEEL — the throwback: the handler comes off the screen reading the
    // big. The ROLL half of that read was already priced (the roll is a
    // cut, so the pocket pass earns cutterBonus 0.5); the POP half had no
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
    transitionPullUpBonus: 0.2602843311131,
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
    usagePriorPoss: 6
  }
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
