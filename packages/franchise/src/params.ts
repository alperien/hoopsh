/**
 * FranchiseParams — every behavioral constant of the franchise layer, in
 * one flat object, mirroring the engine's SimParams discipline (AGENTS.md
 * §1.4): a constant buried in module logic is unreachable by calibration
 * and league realism degrades without warning.
 *
 * Ownership: each top-level section belongs to exactly one build-wave
 * module (named in the section comment). During the build waves a task
 * edits ONLY its own section. The shapes are frozen; values inside a
 * section are the owner's to refine.
 *
 * Provenance tags (comment every value):
 * - REAL — a sourced basketball/CBA fact (cite the research file row:
 *   docs/history/franchise-research/).
 * - FEEL — hand-set for plausible behavior, not statistically constrained.
 * - CAL  — expected to move during acceptance calibration (the franchise
 *   analog of the engine's SWEPT); set to the best prior today.
 */

export interface FranchiseParams {
  /** owner: calendar.ts (spine task) */
  calendar: {
    regularSeasonGames: number;   // REAL 82
    teamsCount: number;           // REAL 30
    preseasonGames: number;       // FEEL 4 (real is 4-6; keep the camp phase short)
    campDays: number;             // FEEL 20 calendar days before opener
    regularSeasonDays: number;    // REAL ~174 (mid-Oct to mid-Apr)
    /** REAL 138 = camp 20 + regular day 118: Oct 21 to mid-February, the real all-star placement */
    allStarDayIndex: number;
    /** REAL 130 = ~8 days before the break: the early-February deadline */
    tradeDeadlineDayIndex: number;
    offseasonDays: number;        // FEEL compressed dead periods (sim skips fast)
  };

  /** owner: gameday.ts (spine task) */
  hca: {
    /**
     * CAL uniform attribute debuff applied to the road team at projection.
     * Probe (2026-07-31, n=40/point, calibration rosters): -1 => 53% home
     * wins, -2 => 65%. At league scale with fatigue interactions the 1.5
     * prior measured only 48-51% home (acceptance, 2 seasons x 1230), so
     * the dial sits higher; re-measure per REGISTER W60.
     * Real target: 55-60% home wins, +2.5-3.0 margin (research 05).
     */
    roadAttrDebuff: number;
  };

  /**
   * owner: officials.ts (officiating task). Every magnitude is re-clamped
   * to a hard cap at read time (officialsParamsOf): sweeps may lower these,
   * never turn referees into a season-deciding force.
   */
  officials: {
    /** crews in the league pool */
    crewCount: number;            // FEEL 20: ~70 real referees make ~23 crews; 20 keeps names learnable
    /** max relative swing on the engine's shooting-foul zone params at tightness 0/100 */
    tightnessFoulSwing: number;   // CAL 0.10 (hard cap 0.10 in officials.ts)
    /** max extra road attr debuff (rating points) at homeLean 100; negative mirror at 0 */
    leanRoadDebuffMax: number;    // CAL 0.8 (hard cap 1.1, half the hca debuff)
    /** tightness points of per-game jitter at consistency 0 */
    tightnessJitter: number;      // CAL 12 (hard cap 20)
  };

  /** owner: gameday.ts (spine task) */
  fatigue: {
    /** CAL stamina debuff on the second night of a back-to-back */
    b2bStaminaDebuff: number;         // CAL 8 (0-100 rating points)
    /** CAL additional debuff per 60 min over the 7-day load window */
    loadDebuffPer60Min: number;       // CAL 2
    loadWindowDays: number;           // FEEL 7
    /** minutes above which a game contributes to load (starters carry load) */
    loadMinutesFloor: number;         // FEEL 20
  };

  /** owner: people/injury.ts (people task) */
  injury: {
    /**
     * CAL base probability of any injury per player per 36 min played.
     * Target: NBA players miss ~12-14 games per 82 on average era-adjusted
     * (research 05 D6); most injuries are minor.
     */
    basePer36: number;                // CAL 0.020
    ageFactorPerYearOver28: number;   // CAL 0.06 (hazard multiplier growth)
    pronenessFactorAt100: number;     // CAL 2.0 (multiplier at proneness 100 vs 50)
    wearFactorAt100: number;          // CAL 1.6
    /** severity split minor/moderate/major/seasonEnding, sums to 1 */
    severityMix: [number, number, number, number]; // CAL [0.62, 0.26, 0.09, 0.03]
    /** outDays ranges [lo, hi] by severity (calendar days) */
    outDaysBySeverity: [[number, number], [number, number], [number, number], [number, number]];
      // REAL-ish [[1,6],[7,24],[25,80],[81,240]] (research 05 D6 injury tables)
    /** wear added per injury by severity */
    wearBySeverity: [number, number, number, number]; // FEEL [1, 3, 8, 15]
  };

  /** owner: people/dev.ts (people task) */
  dev: {
    /** reviews per season: midseason (all-star) and offseason (major) */
    reviewsPerSeason: number;         // FEEL 2
    /** CAL base growth pull toward ceiling per offseason review, age <= peak */
    growthBase: number;               // CAL 2.2 (rating points toward group ceiling)
    /** growth multiplier from minutes earned (0 min => x0.6, 2400+ => x1.4) */
    minutesFactorFloor: number;       // CAL 0.6
    minutesFactorCeil: number;        // CAL 1.4
    minutesForCeil: number;           // FEEL 2400 season minutes
    coachFactorAt100: number;         // CAL 1.35 (dev-quality-100 coach multiplier)
    ethicFactorAt100: number;         // CAL 1.3
    /** sd of the per-review noise (small: arcs must read smooth, research 01) */
    noiseSd: number;                  // CAL 0.8
    /** probability mass of a visible breakout arc per young-player season */
    breakoutRate: number;             // CAL 0.06
  };

  /** owner: people/dev.ts (people task) */
  aging: {
    /**
     * Peak/decline schedule per attribute group (ages). Research 05 D2:
     * overall peak 26-28; athleticism first (24-27), shooting/mental hold
     * into the early 30s.
     */
    peakAge: { phys: number; scoring: number; playmaking: number; defense: number; rebounding: number; mental: number };
      // REAL-ish { phys: 25, scoring: 27, playmaking: 28, defense: 27, rebounding: 27, mental: 31 }
    /** CAL decline per season at peak+1..+3, accelerating after */
    declineBase: number;              // CAL 1.2 rating points/season
    declineAccelPerYear: number;      // CAL 0.55
    wearDeclineFactorAt100: number;   // CAL 1.7 (career wear accelerates decline)
  };

  /** owner: people/retire.ts (people task) */
  retire: {
    /** logistic hazard on age; shifted by decline, role, wear */
    baseAge: number;                  // REAL-ish 35 (mean retirement mid-30s for rotation players)
    hazardSteepness: number;          // CAL 0.55
    minLeagueAge: number;             // FEEL 30 (no retirements below this w/o major injury)
    fringeRoleBoost: number;          // CAL 1.8 (out of the rotation => quit sooner)
  };

  /** owner: cba/*.ts (cba task) */
  cba: {
    /** REAL 2026-27 figures (research 06): the genesis season's lines */
    genesisCap: number;               // REAL 164_961_000
    genesisTax: number;               // REAL 200_428_000
    genesisApron1: number;            // REAL 209_015_000
    genesisApron2: number;            // REAL 221_686_000
    /** salary floor = 90% of cap (REAL) */
    minPayrollPctOfCap: number;       // REAL 0.90
    /** cap growth sampled per season in [lo, hi], clamped by CBA ceiling (research 06) */
    capGrowthLo: number;              // REAL 0.03
    capGrowthHi: number;              // REAL 0.08
    capGrowthClamp: number;           // REAL 0.10
    /** max salary tiers as % of cap by years of service (REAL: 0-6 / 7-9 / 10+) */
    maxPctByService: [number, number, number]; // REAL [0.25, 0.30, 0.35]
    /** annual raise limits (REAL: 8% own-team/Bird, 5% otherwise) */
    raisePctBird: number;             // REAL 0.08
    raisePctOther: number;            // REAL 0.05
    maxYearsBird: number;             // REAL 5
    maxYearsOther: number;            // REAL 4
    /** exceptions as % of cap (owner fills exact REAL values from research 06) */
    mlePctOfCap: number;              // REAL ~0.086 (non-taxpayer MLE)
    taxMlePctOfCap: number;           // REAL ~0.053
    roomPctOfCap: number;             // REAL ~0.045
    baePctOfCap: number;              // REAL ~0.033
    /** minimum salary by years of service, as % of cap (owner fills table) */
    minSalaryPctByYos: number[];      // REAL 11 entries (0..10+)
    /**
     * Rookie scale pick-1 first-year salary as % of cap, at the 120% rate
     * virtually every pick actually signs for (research 06 §3: 2026-27
     * pick 1 scale $12.29M, signed $14.75M = 8.94% of the $164.961M cap).
     */
    rookieScalePick1PctOfCap: number; // REAL 0.0894
    /**
     * Geometric per-pick decay. REAL-fitted: pick 30 signs ~$2.93M, so
     * (2.93/14.75)^(1/29) = 0.9457; the curve lands the published
     * endpoints and approximates the middle (research 06 §3: #10 $5.35M
     * scale; curve at 120% gives ~$8.9M vs real $6.4M, the known gap of a
     * single-decay fit, register C4).
     */
    rookieScaleDecay: number;         // REAL-fitted 0.9457
    rookieScaleYears: number;         // REAL 2 + 2 team options
    /** trade matching: at/under apron1 => 100% + 250k; below tax line wider bands (research 06) */
    tradeMatchBufferDollars: number;  // REAL 250_000
    /** standard tax brackets per 5M increment (post-2025-26 rates, research 06) */
    taxRates: number[];               // REAL [1.00, 1.25, 3.50, 4.75, ...+0.50/bracket]
    repeaterRates: number[];          // REAL [3.00, 3.25, 5.50, 6.75, ...+0.50/bracket]
    taxBracketSize: number;           // REAL 5_000_000
    /** two-way rules */
    twoWaySlots: number;              // REAL 3
    twoWayGameLimit: number;          // REAL 50
    twoWaySalaryPctOfRookieMin: number; // REAL 0.50
    rosterMax: number;                // REAL 15
    rosterMin: number;                // REAL 14
    /** stretch provision denominator: 2n+1 */
    stretchMultiplier: number;        // REAL 2
    /** offer sheet match window in days */
    offerSheetMatchDays: number;      // REAL 2
    /** trade restriction after signing (days) */
    recentSigneeFreezeDays: number;   // REAL 90 (simplified: Dec 15 rule folded in, register)
  };

  /** owner: schedule.ts / standings.ts / postseason.ts (schedule task) */
  schedule: {
    /** REAL NBA formula: 4x4 division, 4x6 + 3x4 in-conference, 2x15 cross */
    divisionGames: number;            // REAL 16
    crossConfGames: number;           // REAL 30
    /** back-to-backs per team per season (recent real ~13-15, research 05) */
    b2bTarget: number;                // REAL 14
    b2bTolerance: number;             // FEEL 3
    maxGamesInFiveDays: number;       // REAL 4 (no 5-in-5; 4-in-5 avoided)
    playinSeeds: [number, number];    // REAL [7, 10]
    seriesFormat: string;             // REAL '2-2-1-1-1'
    /** REAL lottery odds for seeds 1-14 (worst record first), research 06 */
    lotteryOdds: number[];            // REAL [.14,.14,.14,.125,.105,.09,.075,.06,.045,.03,.02,.015,.01,.005]
    lotteryReveals: number;           // REAL 4 (top-4 drawn; rest by record)
  };

  /** owner: ai/valuation.ts + ai/trade.ts (ai-trade task) */
  trade: {
    /** surplus-value horizon (seasons of projected production priced in) */
    horizonSeasons: number;           // FEEL 4
    /** CAL pick value curve anchor: pick 1 worth this many wins-of-value units */
    pickOneValue: number;             // CAL 42 (research 05 D7 draft curves)
    pickValueDecay: number;           // CAL 0.885 per slot, flattening tail
    futurePickDiscount: number;       // CAL 0.88 per season out
    /** accept when net value gain >= this fraction of package size */
    acceptThreshold: number;          // CAL 0.03
    /** hard floor: never accept net loss worse than this fraction (anti-fleece) */
    fleeceFloor: number;              // CAL -0.06
    counterThreshold: number;         // CAL -0.18 (worse than this => walk, no counter)
    cooldownDays: number;             // FEEL 10 (after a walk-away)
    /** per-day probability an AI pair opens talks in deadline season */
    deadlinePulse: number;            // CAL 0.09
    offseasonPulse: number;           // CAL 0.035
    regularPulse: number;             // CAL 0.012
    /** disgruntled-star pressure: morale below this arms a trade request */
    requestMoraleFloor: number;       // FEEL 25
  };

  /** owner: ai/fa.ts + ai/roster.ts + ai/draftai.ts (ai-team task) */
  fa: {
    /** decision weights, normalized per player by disposition (sum ~1) */
    wMoney: number;                   // CAL 0.42
    wRole: number;                    // CAL 0.22
    wWinning: number;                 // CAL 0.18
    wMarket: number;                  // CAL 0.08
    wIncumbent: number;               // CAL 0.10
    /** market clearing pace: day 1-3 stars, tail through September */
    starsSignByDay: number;           // FEEL 5 (of free agency)
    /** CAL 38: the tail must fit the calendar's freeAgency window (offseasonDays 40) */
    marketTailDays: number;
    /** AI overpay variance (winner's curse), sd as fraction of fair AAV */
    bidNoiseSd: number;               // CAL 0.07
    qualifyingOfferDecisionDay: number; // FEEL 2 (days before FA to tender QOs)
  };

  /** owner: scouting.ts (ai-team task) */
  scouting: {
    /** sd of scout error on true group values at zero coverage */
    baseErrorSd: number;              // CAL 9
    /** error sd at full coverage (never zero: the draft stays a gamble) */
    fullCoverageErrorSd: number;      // CAL 4
    /** per-team persistent bias sd (their scouts are wrong differently) */
    teamBiasSd: number;               // CAL 3
    /** coverage points granted by the combine to everyone */
    combineCoverage: number;          // FEEL 15
    /** user scouting points per season to allocate */
    userPointsPerSeason: number;      // FEEL 200
    coveragePerPoint: number;         // FEEL 0.5
  };

  /** owner: people/gen.ts + genesis.ts (genesis task) */
  gen: {
    draftClassSize: number;           // REAL 60 drafted + undrafted pool
    draftPoolSize: number;            // FEEL 75
    intlShare: number;                // REAL ~0.25 of prospects international-origin
    /** age mix of prospects [19, 20, 21, 22+] probability */
    prospectAgeMix: [number, number, number, number]; // REAL-ish [0.35, 0.30, 0.22, 0.13]
    /** class strength multiplier sd (strong/weak classes are real) */
    classStrengthSd: number;          // CAL 0.06
    /** genesis league age distribution target mean/sd */
    genesisAgeMean: number;           // REAL 26.4 (league mean age, research 05)
    genesisAgeSd: number;             // REAL-ish 4.1
    /** archetype mutation sd when generating from catalog profiles */
    mutationSd: number;               // CAL 7
    /** ceiling headroom sd for potential sampling above current ability */
    ceilingHeadroomMean: number;      // CAL 12 (young players; shrinks with age)
    ceilingHeadroomSd: number;        // CAL 7
  };

  /** owner: media/*.ts (media task) */
  media: {
    /** stories per league day budget (excl. recaps, which are per-game) */
    dailyWireBudget: number;          // FEEL 6
    frontPageThreshold: number;       // FEEL importance score for weight-3
    awardRaceCadenceDays: number;     // FEEL 7
    /** award voting weights */
    mvpWeights: { production: number; teamWins: number; availability: number; narrative: number };
      // CAL { production: 0.52, teamWins: 0.30, availability: 0.10, narrative: 0.08 }
    /** games-played floor for major awards (REAL: 65-game rule) */
    awardGpFloor: number;             // REAL 65
    /** rumor prints only when negotiation temperature >= warm */
    rumorMinTemperature: 'warm';      // FEEL policy, not a number
  };

  /** owner: ai/roster.ts (ai-team task) — also read by gameday for user defaults */
  rotation: {
    /** minutes targets by depth-chart tier (starters 1-5, bench 6-10) */
    starterMinutes: [number, number, number, number, number]; // REAL-ish [36, 35, 33, 31, 29]
    benchMinutes: [number, number, number, number, number];   // REAL-ish [26, 22, 18, 12, 8]
    /** rest a starter on B2B night 2 when fatigue below this (policy default) */
    b2bRestBelow: number;             // FEEL 35
  };

  /** owner: people/psyche.ts (psyche task). OPTIONAL: psyche.ts defaults apply when absent (old saves) */
  psyche?: {
    /** CAL max attr points confidence moves the offensive-execution dials, either direction (register F1-A) */
    confAttrCap: number;              // CAL 1.5
    /** CAL max attr points team chemistry moves the same dials, team-wide; smaller by design */
    chemAttrCap: number;              // CAL 1.0
    confStep: number;                 // FEEL 8 (max confidence move per weekly update)
    chemStep: number;                 // FEEL 3 (the room must move slower than the man)
    chemDeadband: number;             // FEEL 1 (hysteresis: no oscillation)
    chemDevSpan: number;              // CAL 0.05 (dev factor bounds 0.95-1.05)
    lifestyleNewsRate: number;        // FEEL 0.02 (a few beats per season, never spam)
  };
}

/**
 * Defaults. Values below carry their provenance in the interface comments
 * above; the flat object keeps them serializable and sweepable, one for
 * one with the interface.
 */
export function defaultFranchiseParams(): FranchiseParams {
  return {
    calendar: {
      regularSeasonGames: 82,
      teamsCount: 30,
      preseasonGames: 4,
      campDays: 20,
      regularSeasonDays: 174,
      allStarDayIndex: 138,
      tradeDeadlineDayIndex: 130,
      offseasonDays: 40,
    },
    hca: { roadAttrDebuff: 2.2 },
    officials: {
      crewCount: 20,
      tightnessFoulSwing: 0.10,
      leanRoadDebuffMax: 0.8,
      tightnessJitter: 12,
    },
    fatigue: {
      b2bStaminaDebuff: 8,
      loadDebuffPer60Min: 2,
      loadWindowDays: 7,
      loadMinutesFloor: 20,
    },
    injury: {
      basePer36: 0.020,
      ageFactorPerYearOver28: 0.06,
      pronenessFactorAt100: 2.0,
      wearFactorAt100: 1.6,
      severityMix: [0.62, 0.26, 0.09, 0.03],
      outDaysBySeverity: [[1, 6], [7, 24], [25, 80], [81, 240]],
      wearBySeverity: [1, 3, 8, 15],
    },
    dev: {
      reviewsPerSeason: 2,
      growthBase: 2.2,
      minutesFactorFloor: 0.6,
      minutesFactorCeil: 1.4,
      minutesForCeil: 2400,
      coachFactorAt100: 1.35,
      ethicFactorAt100: 1.3,
      noiseSd: 0.8,
      breakoutRate: 0.06,
    },
    aging: {
      peakAge: { phys: 25, scoring: 27, playmaking: 28, defense: 27, rebounding: 27, mental: 31 },
      declineBase: 1.2,
      declineAccelPerYear: 0.55,
      wearDeclineFactorAt100: 1.7,
    },
    retire: {
      baseAge: 35,
      hazardSteepness: 0.55,
      minLeagueAge: 30,
      fringeRoleBoost: 1.8,
    },
    cba: {
      genesisCap: 164_961_000,
      genesisTax: 200_428_000,
      genesisApron1: 209_015_000,
      genesisApron2: 221_686_000,
      minPayrollPctOfCap: 0.90,
      capGrowthLo: 0.03,
      capGrowthHi: 0.08,
      capGrowthClamp: 0.10,
      maxPctByService: [0.25, 0.30, 0.35],
      raisePctBird: 0.08,
      raisePctOther: 0.05,
      maxYearsBird: 5,
      maxYearsOther: 4,
      mlePctOfCap: 0.086,
      taxMlePctOfCap: 0.053,
      roomPctOfCap: 0.045,
      baePctOfCap: 0.033,
      minSalaryPctByYos: [0.0074, 0.0119, 0.0133, 0.0138, 0.0143, 0.0155, 0.0170, 0.0185, 0.0190, 0.0191, 0.0210],
      rookieScalePick1PctOfCap: 0.0894,
      rookieScaleDecay: 0.9457,
      rookieScaleYears: 2,
      tradeMatchBufferDollars: 250_000,
      taxRates: [1.00, 1.25, 3.50, 4.75, 5.25, 5.75, 6.25],
      repeaterRates: [3.00, 3.25, 5.50, 6.75, 7.25, 7.75, 8.25],
      taxBracketSize: 5_000_000,
      twoWaySlots: 3,
      twoWayGameLimit: 50,
      twoWaySalaryPctOfRookieMin: 0.50,
      rosterMax: 15,
      rosterMin: 14,
      stretchMultiplier: 2,
      offerSheetMatchDays: 2,
      recentSigneeFreezeDays: 90,
    },
    schedule: {
      divisionGames: 16,
      crossConfGames: 30,
      b2bTarget: 14,
      b2bTolerance: 3,
      maxGamesInFiveDays: 4,
      playinSeeds: [7, 10],
      seriesFormat: '2-2-1-1-1',
      lotteryOdds: [0.14, 0.14, 0.14, 0.125, 0.105, 0.09, 0.075, 0.06, 0.045, 0.03, 0.02, 0.015, 0.01, 0.005],
      lotteryReveals: 4,
    },
    trade: {
      horizonSeasons: 4,
      pickOneValue: 42,
      pickValueDecay: 0.885,
      futurePickDiscount: 0.88,
      acceptThreshold: 0.03,
      fleeceFloor: -0.06,
      counterThreshold: -0.18,
      cooldownDays: 10,
      deadlinePulse: 0.09,
      offseasonPulse: 0.035,
      regularPulse: 0.012,
      requestMoraleFloor: 25,
    },
    fa: {
      wMoney: 0.42,
      wRole: 0.22,
      wWinning: 0.18,
      wMarket: 0.08,
      wIncumbent: 0.10,
      starsSignByDay: 5,
      marketTailDays: 38,
      bidNoiseSd: 0.07,
      qualifyingOfferDecisionDay: 2,
    },
    scouting: {
      baseErrorSd: 9,
      fullCoverageErrorSd: 4,
      teamBiasSd: 3,
      combineCoverage: 15,
      userPointsPerSeason: 200,
      coveragePerPoint: 0.5,
    },
    gen: {
      draftClassSize: 60,
      draftPoolSize: 75,
      intlShare: 0.25,
      prospectAgeMix: [0.35, 0.30, 0.22, 0.13],
      classStrengthSd: 0.06,
      genesisAgeMean: 26.4,
      genesisAgeSd: 4.1,
      mutationSd: 7,
      ceilingHeadroomMean: 12,
      ceilingHeadroomSd: 7,
    },
    media: {
      dailyWireBudget: 6,
      frontPageThreshold: 70,
      awardRaceCadenceDays: 7,
      mvpWeights: { production: 0.52, teamWins: 0.30, availability: 0.10, narrative: 0.08 },
      awardGpFloor: 65,
      rumorMinTemperature: 'warm',
    },
    rotation: {
      starterMinutes: [36, 35, 33, 31, 29],
      benchMinutes: [26, 22, 18, 12, 8],
      b2bRestBelow: 35,
    },
    psyche: {
      confAttrCap: 1.5,
      chemAttrCap: 1.0,
      confStep: 8,
      chemStep: 3,
      chemDeadband: 1,
      chemDevSpan: 0.05,
      lifestyleNewsRate: 0.02,
    },
  };
}

/** Deep-merge a partial override over defaults (same contract as engine withParams). */
export function withFranchiseParams(over: Partial<FranchiseParams> | undefined): FranchiseParams {
  const base = defaultFranchiseParams();
  if (!over) return base;
  const out = base as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && k in out) {
      out[k] = { ...(out[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      out[k] = v;
    }
  }
  return out as unknown as FranchiseParams;
}
