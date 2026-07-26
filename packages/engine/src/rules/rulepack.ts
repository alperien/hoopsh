/**
 * Rule packs make leagues swappable data, not code.
 * NBA ships first; NCAA and EuroLeague follow the same interface.
 * Custom leagues are just JSON.
 *
 * Calibration status: NBA is the tuned, shipped pack — every probability
 * model in sim/resolve.ts and SimParams was fit assuming NBA's numbers below.
 * NCAA and EuroLeague are STRUCTURAL stubs: their court/clock/foul numbers
 * are the real, correct rule-book values for those leagues, but the
 * probability models themselves are not re-tuned for league-specific pace,
 * spacing, or skill distributions — swapping to NCAA today changes the
 * court/clock/foul math correctly but still plays like an NBA-caliber roster
 * on a smaller floor. Real per-league calibration is future work (see the
 * "league-expansion milestone" note below, kept from the original stub
 * comment).
 */

export interface ThreePointGeometry {
  /** arc radius from rim center, ft */
  arcRadiusFt: number;
  /** lateral distance from rim center to the straight corner line, ft */
  cornerDistFt: number;
  /** distance from baseline where the corner line meets the arc, ft */
  cornerBreakFt: number;
}

export interface RulePack {
  id: string;
  name: string;

  // court
  courtLengthFt: number;
  courtWidthFt: number;
  /** rim center distance from baseline */
  rimInsetFt: number;
  /**
   * UNWIRED — the paint/lane width (NBA 16 ft). Declared for completeness but
   * read nowhere: classifyShot() zones by rim distance (4/14 ft) rather than
   * lane geometry. Wire this when the post-up game needs true lane boundaries.
   */
  keyWidthFt: number;
  /** free-throw line distance from baseline */
  ftLineFt: number;
  three: ThreePointGeometry;

  // game format
  /** regulation periods (4 for NBA/EuroLeague quarters, 2 for NCAA halves) */
  periods: number;
  /** minutes per regulation period */
  periodMinutes: number;
  /** minutes per overtime period — always 5 across every pack below, matching real overtime length in each of these leagues */
  otMinutes: number;

  // clocks
  /** seconds a team has to attempt a shot before a shot-clock turnover (sim/game.ts tickLive) */
  shotClockSec: number;
  /** shot clock after an offensive rebound — shorter than a fresh possession's clock since the ball never left the frontcourt */
  shotClockOffRebSec: number;

  // fouls
  /** team fouls in a period that put the opponent in the bonus (non-shooting fouls start awarding free throws once reached) — sim/fouls.ts recordFoul's `inBonus` check */
  teamFoulBonusAt: number;
  /** bonus free throws awarded on a non-shooting foul once in the bonus — every pack below uses the modern flat "two shots in the bonus" rule (sim/passing.ts attemptReachIn, sim/possession.ts tickScramble), not the older one-and-one variant some of these leagues have used historically */
  bonusFreeThrows: number;
  /** personal fouls that disqualify a player (sim/fouls.ts recordFoul's fouledOut check, sim/subs.ts replaceFouledOut) */
  foulOutAt: number;

  // timeouts
  /**
   * Team timeouts per game (flat per-game simplification of each league's
   * real budget rules — no per-half carryover or last-two-minute caps yet).
   * Consumed only by the endgame layer (GameConfig.endgame — sim/endgame.ts);
   * a default-config game never calls one, so this field is inert there.
   */
  timeoutsPerGame: number;
}

export const NBA: RulePack = {
  id: 'nba',
  name: 'NBA',
  // 94x50 ft: the full NBA court footprint.
  courtLengthFt: 94,
  courtWidthFt: 50,
  // 5.25 ft: rim center sits this far in from the baseline (see geometry/court.ts makeCourt).
  rimInsetFt: 5.25,
  keyWidthFt: 16,
  // 19 ft: the real free-throw line distance from the baseline (see geometry/court.ts makeCourt).
  ftLineFt: 19,
  // real NBA three-point geometry: 23.75 ft arc, clipped to a 22 ft straight
  // corner line out to 14 ft from the baseline (see geometry/court.ts classifyShot).
  three: { arcRadiusFt: 23.75, cornerDistFt: 22, cornerBreakFt: 14 },
  periods: 4,
  periodMinutes: 12,
  otMinutes: 5,
  // 24-second shot clock; 14 seconds on an offensive rebound — real NBA rules.
  shotClockSec: 24,
  shotClockOffRebSec: 14,
  // bonus at 5 team fouls in a period, 2 free throws, disqualification at 6
  // personal fouls — the real modern NBA thresholds.
  teamFoulBonusAt: 5,
  bonusFreeThrows: 2,
  foulOutAt: 6,
  // 7 team timeouts per game — the real modern NBA budget (the real rule
  // also caps usage at 4 in the fourth period / 2 in the last three minutes;
  // that refinement is future work, see the interface note).
  timeoutsPerGame: 7
};

/** placeholder stubs — tuned packs land with the league-expansion milestone */
export const NCAA: RulePack = {
  ...NBA,
  id: 'ncaa',
  name: 'NCAA (men)',
  // NCAA men's three-point line: shorter arc (22.15 ft) and much shallower
  // corner break (9.85 ft vs the NBA's 14 ft) — the corner line meets the arc
  // much closer to the baseline than in the NBA.
  three: { arcRadiusFt: 22.15, cornerDistFt: 21.65, cornerBreakFt: 9.85 },
  // NCAA plays two 20-minute halves rather than four quarters.
  periods: 2,
  periodMinutes: 20,
  // longer 30-second shot clock (20 after an offensive rebound) than the NBA's 24/14.
  shotClockSec: 30,
  shotClockOffRebSec: 20,
  // bonus kicks in later (7 team fouls) but disqualification is stricter (5 personal fouls, not 6).
  teamFoulBonusAt: 7,
  foulOutAt: 5,
  // NCAA: 4 timeouts (3×30s + 1×60s) in the flat per-game simplification —
  // media-timeout structure is out of scope, same as the NBA note above.
  timeoutsPerGame: 4
};

/** like NCAA, a structural stub — real EuroLeague rule-book numbers below, but not independently probability-tuned; see the calibration-status note above. */
export const EUROLEAGUE: RulePack = {
  ...NBA,
  id: 'euroleague',
  name: 'EuroLeague',
  // FIBA court dimensions in feet (28m x 15m), slightly smaller than the NBA's 94x50.
  courtLengthFt: 91.86,
  courtWidthFt: 49.21,
  // 5.15 ft: FIBA's rim-to-baseline distance, marginally different from the NBA's 5.25 ft.
  rimInsetFt: 5.15,
  // FIBA's three-point line: same shorter arc as NCAA (22.15 ft) with a similarly shallow corner break (9.85 ft).
  three: { arcRadiusFt: 22.15, cornerDistFt: 21.65, cornerBreakFt: 9.85 },
  // EuroLeague keeps four periods like the NBA, but shorter 10-minute ones.
  periods: 4,
  periodMinutes: 10,
  shotClockSec: 24,
  shotClockOffRebSec: 14,
  // bonus at 5 team fouls like the NBA, but disqualification is stricter (5 personal fouls, matching FIBA rules).
  teamFoulBonusAt: 5,
  foulOutAt: 5,
  // FIBA/EuroLeague: 2 first-half + 3 second-half timeouts, flattened to 5
  // per game (same simplification as the other packs).
  timeoutsPerGame: 5
};
