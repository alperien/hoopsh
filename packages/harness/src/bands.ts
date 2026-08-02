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
  // REAL — league FG%, sourced two ways (#56): 47.4% 2023-24 (fg_pct
  // transcribed verbatim in data/nba/league-averages-2023-24.json) and
  // 47.31% 2025-26 (15352/32452, 184-game pbp corpus, same parse as the
  // astdShare row below). Both sourced centers sit INSIDE with house-normal
  // margins (floor -3.3/-3.4pp; ceiling +2.1/+2.2pp, the same high-side
  // margin family as tpPct/ftPct/tov), so the recalled edges stand as
  // sourced-consistent — annotated, not moved, at #56. Note the asymmetry
  // with astdShare below: there the sourced center sat OUTSIDE the band.
  // The sim runs HIGH in this band by design (docs/CALIBRATION.md); the
  // ceiling is the live watch side and is generous vs the sourced center.
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
  // REAL (center) — assisted share of made FGs, sourced two ways (#56):
  //   63.80% pooled = 9795/15352 assisted FGM, 184-game 2025-26 pbp corpus
  //   (data/nba/pbp-plays/ committed shards). Parse: "makes [23]-pt" rows;
  //   assisted = row contains "(assist by"; FT rows excluded by the pattern.
  //   Per-game mean 63.73%, sd 6.49pp, se 0.48pp, n=184 games. The count is
  //   reproduced by three independent parses (#39 addendum, relay session,
  //   #56 PR session — same 9795/15352 each time).
  //   63.27% derived for 2023-24: ast 26.7 / fg 42.2, both transcribed
  //   verbatim in data/nba/league-averages-2023-24.json. astdShare IS
  //   ast/fgm — the same identity finalize() computes in aggregate.ts.
  // Band = 63.8 ± 4.0pp. The center is sourced; the 8pp width carries the
  //   prior band's acceptance width forward and is FEEL (no in-repo era
  //   data sources a width; sourcing the era range is validation-program
  //   work, #56). The midpoint matters beyond pass/fail: sweep.ts applies
  //   centering pressure toward it, so a mis-set midpoint actively pulls
  //   the optimizer away from reality.
  // History: the prior 54-62 claimed "~54-62% across 2015-2025, recent
  //   seasons ~56-59%" from author recall. Both sourced seasons measure
  //   ABOVE that ceiling — a sim matching reality exactly would have
  //   FAILED the band. Opened as a ratchet at ~50%; the fidelity phase
  //   closed the debt and enforced it; the ceiling corrected at #56.
  { metric: 'astdShare', label: 'Assisted share of FGM', lo: 0.598, hi: 0.678, pct: true }
];
