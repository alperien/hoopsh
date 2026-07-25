/**
 * Realism acceptance bands: per-team per-game averages the sim must land in,
 * drawn from modern NBA league-wide numbers (roughly 2015-2025 ranges, wide
 * enough to accept era variation, tight enough to catch a broken engine).
 *
 * Provenance: these are REAL numbers — league-wide season averages a fan of
 * the modern game would recognize — not derived from any hoopsh run. They
 * are deliberately wide bands, not point targets: the goal is "does this
 * still look like basketball," not "match the 2023-24 season exactly." A
 * mechanics change that pushes a metric outside its band has broken
 * something; a change that merely shifts it toward one edge within the band
 * hasn't, and shouldn't be hand-chased (see AGENTS.md §4.4 — that's the
 * sweep's job, not a manual nudge).
 *
 * Calibration order (see ARCHITECTURE.md §5): pace → shot mix → efficiency →
 * fouls/rebounds/turnovers → archetype differentiation. This ordering
 * matters because the metrics are coupled top-to-bottom: pace sets how many
 * possessions there are to distribute across the shot-mix bands, shot mix
 * sets how many attempts feed the efficiency bands, and so on. Tuning a
 * downstream band before an upstream one is calibrated is chasing a moving
 * target — always re-verify pace first when a bunch of bands drift together.
 */

export interface Band {
  metric: string;
  label: string;
  lo: number;
  hi: number;
  /** formatting hint — when true, format as a percentage (×100, one decimal, "%" suffix) instead of a plain per-game count; see aggregate.ts#formatReport */
  pct?: boolean;
  /** ratchet target: reported in the batch table and scored by the sweep,
   *  but EXCLUDED from the wide regression guard until the mechanics that
   *  close the gap land — a declared destination, not yet an enforced floor */
  ratchet?: boolean;
}

// One row per NBA_BANDS entry. `metric` is the LeagueAverages key it checks
// (see aggregate.ts#finalize) — every metric here must have a matching key
// there or evaluate() reads NaN and the band always fails loudly rather than
// silently passing.
export const NBA_BANDS: Band[] = [
  { metric: 'pace', label: 'Pace (poss/48 per team)', lo: 95, hi: 103.5 },
  { metric: 'pts', label: 'Points per game', lo: 105, hi: 122 },
  { metric: 'fga', label: 'FGA per game', lo: 84, hi: 92 },
  { metric: 'fgPct', label: 'FG%', lo: 0.44, hi: 0.495, pct: true },
  // "3PA share of FGA" rather than a raw 3PA-per-game count on purpose: share
  // is invariant to pace, so it isolates shot-SELECTION realism from tempo —
  // a fast, high-volume team and a slow, low-volume one can both be
  // realistic at the same share.
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
  { metric: 'ortg', label: 'Offensive rating', lo: 106, hi: 121 },
  // REAL — NBA assisted share of made FGs runs ~54-62% across 2015-2025
  // (recent seasons ~56-59%). The engine sits ~50%: unassisted pull-ups,
  // drives, and worked post-ups out-volume real basketball's catch-and-shoot
  // economy. RATCHET: the fidelity phase owns closing this (it gates
  // playmaker assist totals — a 9-apg season is unreachable at 50% share);
  // flip `ratchet` off once the gap's mechanics land and the sweep re-locks.
  { metric: 'astdShare', label: 'Assisted share of FGM', lo: 0.54, hi: 0.62, pct: true, ratchet: true }
];
