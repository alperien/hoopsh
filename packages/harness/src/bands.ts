/**
 * Realism acceptance bands: per-team per-game averages the sim must land in,
 * drawn from modern NBA league-wide numbers (roughly 2015-2025 ranges, wide
 * enough to accept era variation, tight enough to catch a broken engine).
 *
 * Calibration order (see ARCHITECTURE.md §5): pace → shot mix → efficiency →
 * fouls/rebounds/turnovers → archetype differentiation.
 */

export interface Band {
  metric: string;
  label: string;
  lo: number;
  hi: number;
  /** formatting hint */
  pct?: boolean;
}

export const NBA_BANDS: Band[] = [
  { metric: 'pace', label: 'Pace (poss/48 per team)', lo: 95, hi: 103.5 },
  { metric: 'pts', label: 'Points per game', lo: 105, hi: 122 },
  { metric: 'fga', label: 'FGA per game', lo: 84, hi: 92 },
  { metric: 'fgPct', label: 'FG%', lo: 0.44, hi: 0.495, pct: true },
  { metric: 'tpaShare', label: '3PA share of FGA', lo: 0.33, hi: 0.45, pct: true },
  { metric: 'tpPct', label: '3P%', lo: 0.335, hi: 0.385, pct: true },
  { metric: 'fta', label: 'FTA per game', lo: 18, hi: 27 },
  { metric: 'ftPct', label: 'FT%', lo: 0.74, hi: 0.805, pct: true },
  { metric: 'orbPct', label: 'ORB%', lo: 0.2, hi: 0.3, pct: true },
  { metric: 'trb', label: 'Rebounds per game', lo: 40, hi: 47 },
  { metric: 'ast', label: 'Assists per game', lo: 22, hi: 30 },
  { metric: 'stl', label: 'Steals per game', lo: 6, hi: 9.5 },
  { metric: 'blk', label: 'Blocks per game', lo: 3.5, hi: 6.5 },
  { metric: 'tov', label: 'Turnovers per game', lo: 11.5, hi: 15.5 },
  { metric: 'pf', label: 'Fouls per game', lo: 16, hi: 22.5 },
  { metric: 'ortg', label: 'Offensive rating', lo: 106, hi: 121 }
];
