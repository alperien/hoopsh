/**
 * SimParams — THE calibration surface.
 *
 * Every probability constant in the engine lives here, in one flat, serializable
 * object. The harness tunes these against real-league acceptance bands; player
 * ratings act as modifiers *inside* the formulas that consume these values.
 *
 * Layering (see ARCHITECTURE.md §2):
 *   global SimParams  -> league realism (this file)
 *   rating curves     -> player differentiation (model/derived.ts)
 *   era packs (later) -> historical overrides on top
 *
 * All probabilities resolve through logistic models: P = sigmoid(base + Σ terms),
 * so "base" values below are logits, not probabilities.
 * sigmoid(0.62)≈0.65, sigmoid(-0.16)≈0.46, sigmoid(-0.55)≈0.37.
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
    /** chance per decision to attack in transition before defense sets */
    transitionPush: number;
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
    playmakerOffset: number;     // playmaker-pull neutral rating
    playmakerScale: number;      // value of feeding a creator
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
    helpSpotPull: number;        // help spot pull toward the ball
    helperGravityWeight: number; // reluctance to help off shooters
    closeoutSlackFt: number;     // gap slack before a closeout sprint
    // bookkeeping
    assistWindowSec: number;     // catch-to-shot window for assist credit
    assistMaxDribbles: number;
  };
}

export const defaultParams: SimParams = {
  tickHz: 10,
  frameEvery: 2,

  shot: {
    baseRim: 0.6,
    basePaint: -0.35,
    baseMid: -0.62,
    baseThree: -0.82,
    skillCoef: 0.5,
    skillCoefThree: 0.45,
    contestCoef: -1.15,
    contestMidpoint: 0.38,
    movePullUp: -0.22,
    moveDrive: -0.08,
    moveCutFinish: 0.18,
    movePost: -0.05,
    movePutback: 0.1,
    moveHeave: -2.6,
    rimHeightCoef: 0.35,
    fatigueCoef: -0.35,
    ftBasePct: 0.71,
    ftSkillSwing: 0.12,
    blockBase: 0.3,
    blockSkillCoef: 0.5,
    windupCatchShoot: 0.42,
    windupPullUp: 0.55,
    windupDrive: 0.45,
    windupCutFinish: 0.3,
    windupPost: 0.65,
    windupPutback: 0.25,
    windupHeave: 0.3
  },

  foul: {
    shootRim: 0.435,
    shootPaint: 0.16,
    shootMid: 0.05,
    shootThree: 0.012,
    contestFactor: 1.6,
    reachInPerSec: 0.0153,
    chargePerDrive: 0.012,
    looseBallPerReb: 0.0215
  },

  pass: {
    riskBase: -3.95,
    laneRiskCoef: 1.6,
    skillCoef: 0.75,
    stealShare: 0.55,
    speedFtS: 45
  },

  reb: {
    offWeightMult: 0.82,
    missDistBase: 4.22,
    missDistCoef: 0.16,
    proximityPower: 1.4,
    putbackChance: 0.45
  },

  decide: {
    intervalSec: 0.7,
    temperature: 0.055,
    continuationMax: 1.48,
    continuationCurve: 0.22,
    urgencySec: 5,
    threeAppetite: 0.94,
    driveAppetite: 1.15,
    transitionPush: 0.55,
    transitionBonus: 0.12
  },

  move: {
    halfcourtSpeedMult: 0.72,
    avoidRadiusFt: 2.4,
    defGapBaseFt: 5.0,
    defGapGravityFt: 2.2,
    helpTriggerFt: 15,
    contestRadiusFt: 6.5
  },

  fatigue: {
    drainPerSec: 0.055,
    sprintDrainMult: 2.4,
    recoverPerSecBench: 0.55,
    minSpeedMult: 0.82
  },

  sub: {
    tiredThreshold: 62,
    readyThreshold: 88
  },

  ai: {
    zoneTendBias: 0.22,
    pullUpBias: 0.18,
    threeApptScale: 0.35,
    tacticsThreeScale: 0.18,
    contestBrakeAt: 0.35,
    contestBrakeBase: 0.5,
    contestBrakeIQ: 0.35,
    holdAdvance: 0.35,
    holdHalfcourt: -0.02,
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
    swingBase: 0.03,
    swingPassOutScale: 0.16,
    swingVisionScale: 0.12,
    playmakerOffset: 55,
    playmakerScale: 0.09,
    passContinuationScale: 0.9,
    catchContestScale: 0.72,
    cutRateScale: 0.006,
    cutDurationSec: 1.6,
    crashBase: 0.21,
    crashTendScale: 0.6,
    guardDistBase: 2.8,
    guardDistOpen: 4.5,
    sagStartFt: 16,
    sagRangeFt: 34,
    sagMax: 0.6,
    sagGravityCut: 0.75,
    helpSpotPull: 0.28,
    helperGravityWeight: 26,
    closeoutSlackFt: 1.5,
    assistWindowSec: 1.6,
    assistMaxDribbles: 1
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
