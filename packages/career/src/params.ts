/**
 * CareerParams - every behavioral constant of the career layer, one flat
 * object, per-task section ownership, provenance tags (REAL / FEEL / CAL),
 * exactly the FranchiseParams discipline. During the build waves a task
 * edits ONLY its own section; shapes are frozen, values inside a section
 * are the owner's to refine.
 */

import type { AttrGroup } from '@hoopsh/franchise';
import type { PresetId, RoleId } from './types.js';

export interface CareerParams {
  /** owner: creation.ts (creation task) */
  creation: {
    /** point budgets by preset, spent across the six groups above a base */
    budgetByPreset: Record<PresetId, number>;   // FEEL walkon 60 / fourstar 110 / phenom 160
    /** the floor every group starts from before budget (age-17 raw) */
    groupBase: number;                          // FEEL 38
    /** per-group cap at creation (nobody arrives finished) */
    creationGroupCap: number;                   // FEEL 68
    /** hidden ceiling headroom sampled over the visible prior */
    ceilingHeadroomMean: number;                // CAL 18 (younger than genesis prospects: more room)
    ceilingHeadroomSd: number;                  // CAL 8
    /** background modifiers are code (named priors), not params; magnitude scale here */
    backgroundStrength: number;                 // FEEL 6 (rating points swung by a background)
  };

  /** owner: circuits.ts (circuits task) */
  circuits: {
    hsTeams: number;                            // FEEL 8
    hsRegularGames: number;                     // FEEL 14 (per team)
    collegeConfTeams: number;                   // FEEL 10
    collegeConfGames: number;                   // FEEL 18
    nationalBracketTeams: number;               // FEEL 16 (register: the real field is 64)
    euroTeams: number;                          // FEEL 12
    euroGames: number;                          // FEEL 22
    nblTeams: number;                           // FEEL 10
    nblGames: number;                           // FEEL 20
    chinaTeams: number;                         // FEEL 10
    chinaGames: number;                         // FEEL 16 (short money season)
    /** roster quality centers by circuit kind (0-100, W59-recentered scale) */
    hsQualityMean: number;                      // CAL 30 (teenagers; stars stand out)
    hsQualitySd: number;                        // CAL 8
    collegeQualityByTier: [number, number, number]; // CAL [58, 50, 43] tiers 1-3
    euroQualityMean: number;                    // CAL 60 (grown men, real pros)
    nblQualityMean: number;                     // CAL 55
    chinaQualityMean: number;                   // CAL 50
    /** my HS team is built around me: teammate quality mean */
    myHsTeamQuality: number;                    // FEEL 34
    /** the rival's creation budget as a fraction of a fourstar's */
    rivalBudgetFactor: number;                  // FEEL 1.0 (a true peer)
  };

  /** owner: week.ts (week task) */
  week: {
    /** free slots per week beyond mandatory practice */
    slotCount: number;                          // FEEL 3
    /** energy costs per slot kind (rest/life restore) */
    energyCost: { practice: number; extraWork: number; film: number; body: number; rest: number; life: number };
    /** flat weekly recovery before costs (sleep exists); a balanced in-season week roughly holds */
    weekBaseRecovery: number;                   // CAL 30 (career smoke: costs alone pinned energy at 0)
      // FEEL { practice: 12, extraWork: 16, film: 6, body: 8, rest: -25, life: -12 }
    /** energy cost per game played */
    gameEnergyCost: number;                     // FEEL 14
    energyFloorInjuryRisk: number;              // CAL 30 (below this, injury hazard multiplies)
    energyLowHazardMult: number;                // CAL 1.8
    /**
     * Energy on the floor: below this energy, game-night attributes take a
     * linear debuff (approach.ts applyLegs, consumed in the circuits ME
     * projection). The A/B that forced this: 41 weeks at 0 energy cost
     * nothing measurable when the only consumer was the injury multiplier,
     * so grinding was strictly dominant and rest was never a real choice.
     */
    energyLegsFloor: number;                    // FEEL 40 (fresh legs above this)
    /** attr debuff at energy 0, scaling linearly to 0 at energyLegsFloor */
    energyLegsDebuff: number;                   // FEEL 8 (playHurtDialDebuff's scale: empty tank ~= playing hurt)
    /** weekly training dev gain at full focus, rating points toward group ceiling */
    trainingGainBase: number;                   // CAL 0.16 (season-scale ~= a real offseason review share; banked per week.ts pity timer, landing +1 every ceil(1/rate) weeks)
    filmGainBase: number;                       // CAL 0.10 (mental group only; banked the same way)
    bodyWearTrim: number;                       // CAL 0.35 (wear points removed per body slot)
    lifeMoraleGain: number;                     // FEEL 4
    gradesFloor: number;                        // FEEL 2 life slots/month keeps eligibility (HS/college)
  };

  /** owner: approach.ts + trust.ts (approach task) */
  trust: {
    /**
     * Projection: max tendency delta at a dial's extreme (0 or 100).
     * CAL 32, raised from 22 by the felt-loop A/B: at 22 a 70 range dial
     * moved threes by +0.8 attempts a game (sd 2.6, invisible) and only
     * the 100/100 extreme was felt (+1.8 3PA, +2.7 pts). At 32 the 70
     * dial's tendency swing (12.8 points) lands in the felt band and the
     * extreme reads as a genuinely different game plan.
     */
    approachTendencyMax: number;                // CAL 32 (rating points of tendency swing)
    /** plan range width by role (garbage narrowest... franchise widest) */
    planWidthByRole: Record<RoleId, number>;    // FEEL { garbage: 10, bench: 16, rotation: 22, sixthMan: 28, starter: 34, featured: 44, franchise: 54 }
    /** trust deltas */
    adherenceTrustGain: number;                 // CAL 1.2 (per game inside the plan)
    deviationTrustLoss: number;                 // CAL 2.6 (per game meaningfully outside)
    productionTrustGain: number;                // CAL 1.8 (per game outproducing role)
    /** role bands: role-relative production score thresholds (0-100 scale) */
    promoteAt: number;                          // CAL 68 (avg production over the window)
    demoteAt: number;                           // CAL 30
    /** THE reacting-world invariant: consecutive above-band games forcing a role response */
    reactGames: number;                         // FEEL 6 (the acceptance gate uses this exact number)
    /** minutes bands by role, the coach's target for me */
    minutesByRole: Record<RoleId, number>;      // REAL-ish { garbage: 4, bench: 10, rotation: 18, sixthMan: 26, starter: 30, featured: 34, franchise: 37 }
    greenLightTrust: number;                    // FEEL 78 (trust threshold widening every range)
    playHurtWearMult: number;                   // CAL 2.2 (wear accrual multiplier that night)
    playHurtDialDebuff: number;                 // CAL 8 (attr debuff while gutting it out)
  };

  /** owner: recruiting.ts (recruiting task) */
  recruiting: {
    programCount: number;                       // FEEL 14 programs exist; 4-8 engage
    /** interest weights (sum ~1): perceived ability, fit, region, exposure */
    wPerceived: number;                         // CAL 0.55
    wNeed: number;                              // CAL 0.15
    wRegion: number;                            // CAL 0.10
    wExposure: number;                          // CAL 0.20
    /** rung thresholds on the 0-100 interest score */
    rungThresholds: [number, number, number, number, number]; // CAL [20, 32, 46, 60, 72] questionnaire..offer
    /** weekly cooling when you slump (interest decay) */
    coolPerBadWeek: number;                     // CAL 4
    offerWindowWeeks: number;                   // FEEL 6
    classFillWeek: number;                      // FEEL late-spring week when programs close classes
    nilByTier: [number, number, number];        // FEEL [180_000, 60_000, 15_000] per season
    euroOfferMoney: number;                     // FEEL 220_000
    nblOfferMoney: number;                      // FEEL 120_000
  };

  /** owner: stock.ts (stock task) */
  stock: {
    /** per-team value weights: perceived now, perceived ceiling, need, persona risk */
    wNow: number;                               // CAL 0.42
    wCeiling: number;                           // CAL 0.38
    wNeed: number;                              // CAL 0.10
    wPersona: number;                           // CAL 0.10
    /** rank smoothing: weekly movement cap (picks) absent a shock */
    weeklyMoveCap: number;                      // FEEL 6
    /** shock events (30-point bracket game, injury) may move up to */
    shockMoveCap: number;                       // FEEL 14
    /** exposure by circuit kind: scout coverage multiplier */
    exposure: { hs: number; college: number; euro: number; nbl: number; china: number };
      // FEEL { hs: 0.5, college: 1.0, euro: 0.75, nbl: 0.9, china: 0.3 }
    combineCoverageBump: number;                // FEEL 25 (public measurements reprice everyone)
    workoutCoverageBump: number;                // FEEL 20 (that team only)
    draftableFloor: number;                     // CAL perceived value below which rank = null
  };

  /** owner: phone.ts (phone task) */
  phone: {
    /** hard frequency caps per thread per season (anti group-chat discipline) */
    capsPerSeason: { coach: number; agent: number; teammate: number; mentor: number; rival: number; family: number; media: number };
      // FEEL { coach: 14, agent: 12, teammate: 8, mentor: 6, rival: 8, family: 3, media: 6 }
    /** minimum weeks between messages in one thread (burst guard) */
    threadCooldownWeeks: number;                // FEEL 1
    /** decision messages needing answers before N weeks pass */
    decisionDeadlineWeeks: number;              // FEEL 2
  };

  /** owner: nbabridge.ts (nba task) */
  nbabridge: {
    /** my FA offers: how many teams surface concrete offers */
    faOfferCount: number;                       // FEEL 3-5 modeled as max 5
    /** role-promise tracking: games before a broken promise triggers the grievance thread */
    promiseGraceGames: number;                  // FEEL 20
    /** extension window opens this many days before season end (franchise calendar days) */
    extensionWindowDays: number;                // FEEL 45
    /** minimum perceived value for NBA offers to continue (else the descent) */
    nbaMarketFloor: number;                     // CAL 45
    /** trade-request morale penalty while pending (uses franchise disposition) */
    requestMoraleCost: number;                  // FEEL 10
  };

  /** owner: money.ts + epilogue.ts (money task) */
  money: {
    chinaSalaryMean: number;                    // FEEL 2_600_000 (the money years are real money)
    chinaSalarySd: number;                      // FEEL 900_000
    euroVetSalaryMean: number;                  // FEEL 1_500_000
    /** HOF: career value threshold (honors-weighted score) and ballot year gap */
    hofScoreFloor: number;                      // CAL 70
    hofBallotYears: number;                     // REAL-ish 4 (first ballot four seasons after retirement)
    jerseyRetireScore: number;                  // CAL 55 (franchise-relative)
  };

  /** owner: tick.ts (career-tick task) */
  tick: {
    /** pre-entry league advancement: franchise days advanced per career week */
    leagueDaysPerWeek: number;                  // REAL 7
    /** weeks per career year on the pre-NBA calendar */
    weeksPerYear: number;                       // REAL 52
    /** HS season start week (fall) and structure anchors */
    hsSeasonStartWeek: number;                  // FEEL 10 (late fall)
    collegeSeasonStartWeek: number;             // FEEL 8
    proSeasonStartWeek: number;                 // FEEL 6
    draftWeek: number;                          // FEEL 38 (late June semantics)
    combineWeek: number;                        // FEEL 33
  };
}

export function defaultCareerParams(): CareerParams {
  return {
    creation: {
      budgetByPreset: { walkon: 60, fourstar: 110, phenom: 160 },
      groupBase: 38,
      creationGroupCap: 68,
      ceilingHeadroomMean: 18,
      ceilingHeadroomSd: 8,
      backgroundStrength: 6,
    },
    circuits: {
      hsTeams: 8,
      hsRegularGames: 14,
      collegeConfTeams: 10,
      collegeConfGames: 18,
      nationalBracketTeams: 16,
      euroTeams: 12,
      euroGames: 22,
      nblTeams: 10,
      nblGames: 20,
      chinaTeams: 10,
      chinaGames: 16,
      hsQualityMean: 30,
      hsQualitySd: 8,
      collegeQualityByTier: [58, 50, 43],
      euroQualityMean: 60,
      nblQualityMean: 55,
      chinaQualityMean: 50,
      myHsTeamQuality: 34,
      rivalBudgetFactor: 1.0,
    },
    week: {
      slotCount: 3,
      energyCost: { practice: 12, extraWork: 16, film: 6, body: 8, rest: -25, life: -12 },
      weekBaseRecovery: 30,
      gameEnergyCost: 14,
      energyFloorInjuryRisk: 30,
      energyLowHazardMult: 1.8,
      energyLegsFloor: 40,
      energyLegsDebuff: 8,
      trainingGainBase: 0.16,
      filmGainBase: 0.10,
      bodyWearTrim: 0.35,
      lifeMoraleGain: 4,
      gradesFloor: 2,
    },
    trust: {
      approachTendencyMax: 32,
      planWidthByRole: { garbage: 10, bench: 16, rotation: 22, sixthMan: 28, starter: 34, featured: 44, franchise: 54 },
      adherenceTrustGain: 1.2,
      deviationTrustLoss: 2.6,
      productionTrustGain: 1.8,
      promoteAt: 68,
      demoteAt: 30,
      reactGames: 6,
      minutesByRole: { garbage: 4, bench: 10, rotation: 18, sixthMan: 26, starter: 30, featured: 34, franchise: 37 },
      greenLightTrust: 78,
      playHurtWearMult: 2.2,
      playHurtDialDebuff: 8,
    },
    recruiting: {
      programCount: 14,
      wPerceived: 0.55,
      wNeed: 0.15,
      wRegion: 0.10,
      wExposure: 0.20,
      rungThresholds: [20, 32, 46, 60, 72],
      coolPerBadWeek: 4,
      offerWindowWeeks: 6,
      classFillWeek: 34,
      nilByTier: [180_000, 60_000, 15_000],
      euroOfferMoney: 220_000,
      nblOfferMoney: 120_000,
    },
    stock: {
      wNow: 0.42,
      wCeiling: 0.38,
      wNeed: 0.10,
      wPersona: 0.10,
      weeklyMoveCap: 6,
      shockMoveCap: 14,
      exposure: { hs: 0.5, college: 1.0, euro: 0.75, nbl: 0.9, china: 0.3 },
      combineCoverageBump: 25,
      workoutCoverageBump: 20,
      draftableFloor: 42,
    },
    phone: {
      capsPerSeason: { coach: 14, agent: 12, teammate: 8, mentor: 6, rival: 8, family: 3, media: 6 },
      threadCooldownWeeks: 1,
      decisionDeadlineWeeks: 2,
    },
    nbabridge: {
      faOfferCount: 5,
      promiseGraceGames: 20,
      extensionWindowDays: 45,
      nbaMarketFloor: 45,
      requestMoraleCost: 10,
    },
    money: {
      chinaSalaryMean: 2_600_000,
      chinaSalarySd: 900_000,
      euroVetSalaryMean: 1_500_000,
      hofScoreFloor: 70,
      hofBallotYears: 4,
      jerseyRetireScore: 55,
    },
    tick: {
      leagueDaysPerWeek: 7,
      weeksPerYear: 52,
      hsSeasonStartWeek: 10,
      collegeSeasonStartWeek: 8,
      proSeasonStartWeek: 6,
      draftWeek: 38,
      combineWeek: 33,
    },
  };
}
