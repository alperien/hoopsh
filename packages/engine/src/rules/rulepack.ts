/**
 * Rule packs make leagues swappable data, not code.
 * NBA ships first; NCAA and EuroLeague follow the same interface.
 * Custom leagues are just JSON.
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
  keyWidthFt: number;
  /** free-throw line distance from baseline */
  ftLineFt: number;
  three: ThreePointGeometry;

  // game format
  periods: number;
  periodMinutes: number;
  otMinutes: number;

  // clocks
  shotClockSec: number;
  /** shot clock after an offensive rebound */
  shotClockOffRebSec: number;

  // fouls
  /** team fouls in a period that put the opponent in the bonus */
  teamFoulBonusAt: number;
  /** bonus free throws awarded on non-shooting fouls in the bonus */
  bonusFreeThrows: number;
  /** personal fouls that disqualify a player */
  foulOutAt: number;
}

export const NBA: RulePack = {
  id: 'nba',
  name: 'NBA',
  courtLengthFt: 94,
  courtWidthFt: 50,
  rimInsetFt: 5.25,
  keyWidthFt: 16,
  ftLineFt: 19,
  three: { arcRadiusFt: 23.75, cornerDistFt: 22, cornerBreakFt: 14 },
  periods: 4,
  periodMinutes: 12,
  otMinutes: 5,
  shotClockSec: 24,
  shotClockOffRebSec: 14,
  teamFoulBonusAt: 5,
  bonusFreeThrows: 2,
  foulOutAt: 6
};

/** placeholder stubs — tuned packs land with the league-expansion milestone */
export const NCAA: RulePack = {
  ...NBA,
  id: 'ncaa',
  name: 'NCAA (men)',
  three: { arcRadiusFt: 22.15, cornerDistFt: 21.65, cornerBreakFt: 9.85 },
  periods: 2,
  periodMinutes: 20,
  shotClockSec: 30,
  shotClockOffRebSec: 20,
  teamFoulBonusAt: 7,
  foulOutAt: 5
};

export const EUROLEAGUE: RulePack = {
  ...NBA,
  id: 'euroleague',
  name: 'EuroLeague',
  courtLengthFt: 91.86,
  courtWidthFt: 49.21,
  rimInsetFt: 5.15,
  three: { arcRadiusFt: 22.15, cornerDistFt: 21.65, cornerBreakFt: 9.85 },
  periods: 4,
  periodMinutes: 10,
  shotClockSec: 24,
  shotClockOffRebSec: 14,
  teamFoulBonusAt: 5,
  foulOutAt: 5
};
