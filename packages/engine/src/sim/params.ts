/**
 * SimParams — THE calibration surface.
 *
 * Every tunable constant in the engine lives here, in one flat, serializable
 * object. Nothing else in the engine may hardcode a behavioral constant: the
 * harness sweeps THIS file (`npm run sweep`) against real NBA acceptance
 * bands, so a number hidden elsewhere is a number the optimizer cannot reach.
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
 *      • SWEPT — found by the optimizer hunting the 16 acceptance bands. These
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
    /** logit penalty at zero energy */
    fatigueCoef: number;
    /** free throws: percentage-space base at rating 50 and swing to rating 100 */
    ftBasePct: number;
    ftSkillSwing: number;
    ftEliteKick: number;         // extra FT% above rating 80, full at 100 (elite tail curvature)
    /** chance a rim/paint miss with a strong interior contest is a block */
    blockBase: number;
    blockSkillCoef: number;
    /** seconds from decision to release, by shot type (the closeout race window) */
    windupCatchShoot: number;
    windupPullUp: number;
    windupDrive: number;
    windupCutFinish: number;
    windupPost: number;
    windupPutback: number;
    windupHeave: number;
  };

  foul: {
    /** shooting foul chance by zone at average contest/drawFoul */
    shootRim: number;
    shootPaint: number;
    shootMid: number;
    shootThree: number;
    /** multiplier range from contest tightness (tight contests foul more) */
    contestFactor: number;
    /** chance per second of on-ball pressure that a reach-in occurs */
    reachInPerSec: number;
    /** reach-in rate multiplier while the holder is driving or backing down */
    attackReachInMult: number;
    /** added clean-strip share on attacking reach-ins (pokes at the gather) */
    attackStripBonus: number;
    /** offensive foul (charge) chance per drive */
    chargePerDrive: number;
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
  };

  decide: {
    /** seconds between ball-handler decision evaluations */
    intervalSec: number;
    /** softmax temperature over action utilities (higher = more random) */
    temperature: number;
    /**
     * continuation value curve: expected points of "keep working the possession"
     * = continuationMax * (shotClock / fullClock) ^ continuationCurve
     * Shots are taken when predicted shot EV beats this. Drives pace + shot diet.
     */
    continuationMax: number;
    continuationCurve: number;
    /** below this many shot-clock seconds, urgency overrides shot quality */
    urgencySec: number;
    /** global era knob multiplying three-point appetite */
    threeAppetite: number;
    /** global multiplier on drive appetite */
    driveAppetite: number;
    /** EV bonus for open transition looks */
    transitionBonus: number;
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
    /** distance from rim where help defense triggers on a drive */
    helpTriggerFt: number;
    /** contest radius — defenders inside this affect the shot */
    contestRadiusFt: number;
    /** contest-skill mix: share contributed by role defense (interiorD near
     *  the rim, perimeterD outside) vs generic contestSkill */
    contestDBlend: number;
    /** collision-separation share absorbed by a live poster's opponent */
    postLeanShare: number;
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
    /** energy at which a bench player is considered ready */
    readyThreshold: number;
  };

  /**
   * AI utility weights — the decision layer's knobs, fully sweepable.
   * These shape WHO does WHAT (shot diets, drive rates, ball movement,
   * defensive spacing); the sections above shape how attempts RESOLVE.
   */
  ai: {
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
    handlingBase: number;        // base P(get downhill)
    handlingSkillDiv: number;    // handle-vs-lateral divisor
    handlingGapDiv: number;      // defender-gap divisor
    driveTendOffset: number;     // drive tendency neutral point
    driveTendScale: number;
    laneCrowdPenalty: number;
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
    closeoutSlackFt: number;     // gap slack before a closeout sprint
    containDBlend: number;       // on-ball containment: perimeterD share vs lateral
    // bookkeeping
    assistWindowSec: number;     // catch-to-shot window for assist credit
    assistMaxDribbles: number;
    // pick-and-roll
    pnrRatePerTick: number;      // base chance per eligible halfcourt tick to call a screen
    pnrUsageFloor: number;       // action-rate share the lineup's weakest creator keeps
    driveKickBoost: number;      // EV the help-collapse adds to the best teammate look
    driveAbortDiscount: number;  // share of a bad drive's downside actually paid (abort option)
    driveHoldBoost: number;      // hold bonus per remaining drive second (keep attacking)
    catchShootBonus: number;     // shoot bias for an open look in the catch window
    pnrDurationSec: number;      // action lifetime
    pnrScreenSetDistFt: number;  // screener-to-defender distance that counts as contact
    pnrStunOverSec: number;      // defender delay when fighting over the screen
    pnrStunUnderSec: number;     // brief delay when ducking under
    pnrUnderSagFt: number;       // extra on-ball gap while going under (pull-up space)
    pnrUnderBase: number;        // base probability of going under vs handler gravity
    pnrRollGravityCut: number;   // screener gravity below this rolls; above pops
    pnrDropDepthFt: number;      // screener defender's drop-coverage depth from the rim
    pnrDriveBonus: number;       // handler drive-utility bonus coming off the screen
    pnrMinShotClock: number;     // don't start an action later than this
    pnrWaitBoost: number;        // handler hold-utility boost while the screen arrives
    pnrMaxScreenDistFt: number;  // screener candidates farther than this are skipped
    // post-up action
    postCallShare: number;       // weight of the post option in the action-call roll
    postCallCut: number;         // minimum poster score to consider an entry
    postEntryBonus: number;      // pass-utility bonus for feeding a settled poster
    postWorkBoost: number;       // hold bonus during the backdown window
    postBackdownSec: number;     // how long the poster works before shoot-or-spray
    postShotBonus: number;       // shoot bias once the backdown is worked (vs single coverage)
    postDurationSec: number;     // action lifetime (posting + working)
    // isolation action
    isoCallShare: number;        // weight of the iso option in the action-call roll
    isoDriveBonus: number;       // attack commitment while the iso is live
    isoDurationSec: number;      // iso window length
  };
}

export const defaultParams: SimParams = {
  // 10 Hz: fine enough that a 28 ft/s sprinter moves <3 ft per tick (smooth
  // motion, accurate contests), coarse enough for ~6 games/sec. FEEL.
  tickHz: 10,
  // one replay frame per 2 ticks = 5 Hz: the viewer interpolates between them,
  // and it halves replay size (~1.8 MB/game). FEEL.
  frameEvery: 2,

  shot: {
    // Zone bases — league-average shooter, league-average contest. SWEPT,
    // and they land near real NBA zone efficiencies:
    baseRim: 0.5824,    // sigmoid ≈ 64% at the rim (NBA ~65-68% incl. dunks)
    basePaint: -0.3858,   // ≈ 41% floaters/short hooks (NBA ~40-45%)
    baseMid: -0.5228,     // ≈ 35% mid-range before skill (NBA ~40%, but the
                        //   distance penalty below and contest terms shift it)
    baseThree: -0.9089,   // ≈ 29% raw; skill + open looks lift the league to ~36% (re-centered when skillCoefThree widened)
    // How much a rating swings the logit, at rating 100 vs 50. A 0.5 coef
    // means an elite finisher gains ~+12 percentage points at the rim.
    // Three's coef is LOWER than the others on purpose: real three-point
    // percentage has a narrow spread (league 36%, elite 42%) — shooters
    // separate themselves by VOLUME and difficulty, not by hit rate. SWEPT.
    skillCoef: 0.5,
    // raised from 0.45 in the fidelity phase: at 0.45 a 99-rated shooter hit
    // 31.8% on a heavy pull-up diet — BELOW league average. Elite spread
    // widened; the sweep re-centers baseThree if the league mean drifts.
    skillCoefThree: 0.62,
    // Defense's main lever: penalty per unit of contest above the midpoint.
    // A smothered shot (contest 1.0) costs ~0.7 logits ≈ 15+ points of FG%
    // versus a wide-open one. SWEPT.
    contestCoef: -1.1347,
    // The contest level that counts as "normal NBA defensive pressure" — the
    // bases above are calibrated AT this level, so this is the zero point.
    contestMidpoint: 0.38,
    // Shot-creation difficulty adjustments (logits). Ordering reflects real
    // shot-quality data: unassisted self-created jumpers are hardest, cuts
    // and putbacks are high-percentage because the defense is out of position.
    movePullUp: -0.22,    // off the dribble, defender attached
    moveDrive: -0.08,     // moving finish through traffic
    moveCutFinish: 0.18,  // caught in stride at the rim (STAGED move type)
    movePost: -0.05,      // FEEL — back-to-basket craft costs a touch vs a clean look
    movePutback: 0.1,     // already inside, defense scrambling
    moveHeave: -2.6,      // ≈ 7% — a desperation launch, correctly awful
    // Size at the rim: per foot of standing-reach advantage over the
    // contester. A 7-footer finishing over a guard gains real percentage;
    // clamped to ±1.5 ft in the model so it can't run away. FEEL.
    rimHeightCoef: 0.35,
    // Legs at empty (energy 0) vs fresh: ~-8 points of FG%. Tired players
    // shoot worse, which is why rotations matter. FEEL.
    fatigueCoef: -0.35,
    // Free throws are modeled in PERCENTAGE space, not logits — FT% has no
    // REAL — rating 100 → ~85%+, rating 50 → 66%, rating 0 → ~47%: elite
    // FT shooters live at 88-91%, bricklayers in the 50s. The swing was
    // originally 0.12 (an 83% ceiling), which failed the fidelity harness's
    // 99-rated benchmark at 79% — league mean is preserved by re-centering
    // the base (the fidelity phase widens SPREADS; bands still own the mean).
    ftBasePct: 0.652,
    ftSkillSwing: 0.19,
    // REAL — the elite tail: +5.5% at rating 100, zero below 80; rating 99
    // lands ~90%, matching the 88-91% real elite band
    ftEliteKick: 0.055,
    // Blocks are drawn only from shots that were ALREADY going to miss, so
    // this reallocates misses to blocks rather than changing FG%. Keeps block
    // totals tunable without disturbing efficiency calibration. SWEPT.
    blockBase: 0.3,
    blockSkillCoef: 0.5,
    // WINDUP = seconds between "decides to shoot" and release. This is the
    // engine's signature mechanic: it creates the catch-and-shoot vs closeout
    // RACE, so a defender who is 8 ft away when the decision is made may
    // arrive in time to contest. Real release times: ~0.4 s for a quick
    // catch-and-shoot, ~0.55 s for a gathered pull-up. REAL-ish/FEEL.
    windupCatchShoot: 0.42,
    windupPullUp: 0.55,
    windupDrive: 0.45,
    windupCutFinish: 0.3,
    windupPost: 0.65,   // STAGED
    windupPutback: 0.25, // shortest: already up in the air
    windupHeave: 0.3
  },

  foul: {
    // Shooting-foul probability per attempt, at average contest and average
    // drawFoul. Steeply zone-dependent, like real officiating: contact at the
    // rim is whistled constantly, a jump shot almost never. These four values
    // are the primary lever on league FTA/game (band: 18-27). SWEPT — and
    // the most coupling-sensitive knobs in the file (see header point 5).
    shootRim: 0.4,
    shootPaint: 0.1,
    shootMid: 0.05,
    shootThree: 0.012,
    // Tight contests foul more: multiplier scales 1.0 (uncontested) → 1.6
    // (smothered). Ties foul rate to defensive aggression. FEEL.
    contestFactor: 1.6,
    // Per SECOND of on-ball pressure inside ~4 ft. Over a possession this
    // yields the handful of reach-ins a real game produces. SWEPT.
    reachInPerSec: 0.0161,
    // FEEL — power dribbles expose the ball; attack volume pays a live-ball
    // turnover tax (drives and post backdowns)
    attackReachInMult: 3.4,
    attackStripBonus: 0.25,
    // Charges per drive — deliberately rare; the offensive foul is the least
    // common whistle we model. SWEPT.
    chargePerDrive: 0.012,
    // Loose-ball fouls per contested rebound scramble. SWEPT.
    looseBallPerReb: 0.0255
  },

  pass: {
    // Base turnover logit for an unpressured pass ≈ 1.7% — passes are
    // mostly safe, and turnovers come from the lane-occlusion term below.
    // This is the primary lever on league TOV/game (band 11.5-15.5). SWEPT.
    riskBase: -4.02,
    // A defender sitting in the passing lane is the real turnover cause:
    // full occlusion adds 1.6 logits (~1.7% → ~8%). SWEPT.
    laneRiskCoef: 1.6,
    // Vision/accuracy reduce risk; an elite passer roughly halves it. SWEPT.
    skillCoef: 0.75,
    // Of failed passes, ~55% are stolen (credited to a defender) and the rest
    // sail out of bounds. Splits the TOV total into STL vs dead-ball. SWEPT.
    stealShare: 0.62,
    // Ball speed in flight, ft/s. A 25 ft pass takes ~0.55 s — long enough
    // that a cutter's timing and a defender's recovery both matter. REAL-ish.
    speedFtS: 45
  },

  reb: {
    // The offense is at a structural disadvantage on the glass (it is
    // retreating, the defense is between man and rim), so offensive rebound
    // weights are discounted. This is THE lever on ORB% (band 20-30%). SWEPT.
    offWeightMult: 0.78,
    // Where a miss lands: mean distance from the rim = base + coef × shot
    // distance. Long shots produce long rebounds — a real, well-documented
    // effect that makes guards' rebounds on three-heavy nights plausible.
    missDistBase: 4.6746,
    missDistCoef: 0.16,
    // How sharply proximity dominates the scramble: weight ∝ 1/(1+d)^power.
    // Higher = rebounding is pure positioning; lower = size/skill matter more.
    proximityPower: 1.4,
    // Chance an offensive rebound caught at the rim goes straight back up
    // rather than resetting the offense. FEEL, and it produces the putback
    // shot type. SWEPT-adjacent.
    putbackChance: 0.45
  },

  decide: {
    // Seconds between ball-handler decision evaluations (jittered ±25% at the
    // call site). Roughly "how often a player re-reads the floor" — the main
    // lever on how many actions fit in a possession. SWEPT.
    intervalSec: 0.6538,
    // Softmax temperature over action utilities, in expected-points units.
    // Low (0.06) = players nearly always take the best option; raising it adds
    // human noise and bad decisions. This is the engine's "IQ dial". SWEPT.
    temperature: 0.064,
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
    continuationMax: 1.52,
    // Curve exponent: value = max × (shotClock/full)^curve. At 0.22 the value
    // decays slowly then falls off a cliff late — mirroring how real offenses
    // stay patient until roughly 6-8 seconds remain. SWEPT.
    continuationCurve: 0.181,
    // Inside this many shot-clock seconds, urgency scales the continuation
    // value linearly to zero: any shot beats a violation. REAL rule pressure.
    urgencySec: 5,
    // ERA KNOBS. Global multipliers on three-point and drive appetite —
    // these are the intended hooks for era packs (a 1995 pack would set
    // threeAppetite ≈ 0.4, a 2015 pack ≈ 1.2). At 1.0 they are neutral.
    threeAppetite: 1.013,
    driveAppetite: 0.9,
    // Expected-points bonus for attacking before the defense is set. Drives
    // fast-break points; too high and teams never walk it up. SWEPT.
    transitionBonus: 0.02
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
    postLeanShare: 0.85
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
    readyThreshold: 88
  },

  ai: {
    zoneTendBias: 0.22,
    pullUpBias: 0.18,
    threeApptScale: 0.35,
    tacticsThreeScale: 0.18,
    contestBrakeAt: 0.35,
    contestBrakeBase: 0.3718,
    contestBrakeIQ: 0.35,
    holdAdvance: 0.35,
    holdHalfcourt: 0.0057,
    driveMinDistFt: 9,
    driveProjContestBase: 0.35,
    driveProjContestCrowd: 0.22,
    handlingBase: 0.55,
    handlingSkillDiv: 160,
    handlingGapDiv: 18,
    driveTendOffset: 35,
    driveTendScale: 0.42,
    laneCrowdPenalty: 0.1,
    driveFlat: -0.05,
    driveTransitionMult: 1.2,
    passRiskUtilMult: 2.4,
    passEVScale: 0.94,
    cutterBonus: 0.5,
    swingBase: 0.0442,
    swingPassOutScale: 0.16,
    swingVisionScale: 0.12,
    // FEEL — re-initiation pull: full-clock EV of feeding a teammate 100
    // creation points above the holder (decays with the shot clock; decideBall)
    playmakerScale: 0.18,
    passContinuationScale: 0.9,
    catchContestScale: 0.72,
    cutRateScale: 0.0044,
    cutDurationSec: 1.6,
    crashBase: 0.2398,
    crashTendScale: 0.6,
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
    closeoutSlackFt: 1.5,
    // FEEL — lateral quickness is the larger containment share; perimeterD
    // (angles, hand discipline) contributes the rest
    containDBlend: 0.4,
    // REAL — NBA scorekeeping credits a pass leading to a score through
    // roughly two seconds / two dribbles of a "direct scoring move"; at
    // 1.6s/1 dribble the engine's assisted-FGM share ran 46% vs the NBA's
    // ~58% (Stage 2 measurement)
    assistWindowSec: 2.0,
    assistMaxDribbles: 2,
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
    // FEEL — open-three catch-and-shoot decisiveness at full openness (linear
    // to zero at contest 0.5, arc only); the make model already favors the
    // catch rhythm, this makes the DECISION match it
    catchShootBonus: 0.18,
    pnrDurationSec: 4.2,
    pnrScreenSetDistFt: 2.2,
    pnrStunOverSec: 0.65,
    pnrStunUnderSec: 0.2,
    pnrUnderSagFt: 3.5,
    pnrUnderBase: 0.8,
    pnrRollGravityCut: 0.52,
    pnrDropDepthFt: 11,
    pnrDriveBonus: 0.2,
    pnrMinShotClock: 8,
    pnrWaitBoost: 0.3,
    pnrMaxScreenDistFt: 26,
    // FEEL — post/iso action weights and windows; the post score is carried by
    // tend.post so a team without a post threat simply never rolls it
    postCallShare: 1.0,
    postCallCut: 0.1,
    postEntryBonus: 0.22,
    postWorkBoost: 0.2,
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
    postShotBonus: 0.48,
    isoCallShare: 0.7,
    isoDriveBonus: 0.15,
    isoDurationSec: 3.0
  }
};

/** deep-merge partial overrides onto defaults (for experiments & era packs) */
export function withParams(overrides?: DeepPartial<SimParams>): SimParams {
  if (!overrides) return structuredClone(defaultParams);
  return deepMerge(structuredClone(defaultParams), overrides) as SimParams;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(patch)) {
    const b = base[key];
    const p = patch[key];
    if (b && p && typeof b === 'object' && typeof p === 'object' && !Array.isArray(b) && !Array.isArray(p)) {
      deepMerge(b as Record<string, unknown>, p as Record<string, unknown>);
    } else if (p !== undefined) {
      base[key] = p;
    }
  }
  return base;
}
