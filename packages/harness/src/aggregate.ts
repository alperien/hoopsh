/**
 * Aggregate many box scores into league-average per-team per-game numbers,
 * then evaluate them against acceptance bands.
 *
 * Accumulation semantics: each simulated GAME contributes TWO team-games to
 * the accumulator (home's line and away's line, added separately in the
 * `for (const side of [0, 1])` loop in accumulate() below). This matches how
 * "per game" numbers are reported everywhere in real basketball stats —
 * league pace/points-per-game are averages over team-games, not over
 * matchups, so a 100-game batch run produces 200 team-games' worth of
 * signal. Getting this wrong (averaging per-MATCHUP instead) wouldn't
 * change per-game rate stats like pace or fgPct, but it would halve `games`
 * relative to what bands.ts and callers expect, and any raw-count metric
 * added later would be off by 2×.
 */

import type { BoxScore } from '@hoopsh/stats';
import { orbPct, ortg } from '@hoopsh/stats';
import type { Band } from './bands.js';

/**
 * Running sums across many team-games. Field names mirror TeamTotals'
 * counting stats one-to-one (pts, fga, fgm, …) so accumulate() below is a
 * straight per-field `+=`. The three `*Sum` fields are pre-averaged-per-game
 * quantities that can't just be summed-then-divided from raw counts —
 * pace and ortg are already themselves a ratio, and orbPct needs both
 * sides' totals for that one box score, information that no longer exists
 * once totals from many games are combined. So each is captured per-game
 * (once per team-game, using that game's own two teams) and finalize()
 * divides the running SUM of those already-computed values by `games`. This
 * is a "mean of means" — not exactly the same number as computing pace/ortg
 * from the grand totals, but consistent with the box-per-box perspective
 * (some possessions are 3 seconds, some are 20; the "average game's pace"
 * treats each game equally rather than weighting long games more).
 */
export interface Accumulator {
  games: number; // team-games
  pts: number; fga: number; fgm: number; tpa: number; tpm: number;
  fta: number; ftm: number; orb: number; drb: number; trb: number;
  ast: number; stl: number; blk: number; tov: number; pf: number;
  poss: number; paceSum: number; orbPctSum: number; ortgSum: number;
}

export function emptyAcc(): Accumulator {
  return {
    games: 0, pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0,
    orb: 0, drb: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    poss: 0, paceSum: 0, orbPctSum: 0, ortgSum: 0
  };
}

/**
 * Fold one game's box score into `acc`, contributing TWO team-games (see the
 * file header) — one for each side, each seeing only its own counting stats
 * plus its opponent's totals where a metric needs both (orbPct: a team's
 * offensive rebounds are a share of ITS OWN misses plus the opponent's
 * defensive boards, so `orbPct(t, opp)` needs the other side's totals even
 * though this is nominally "this team's" line).
 */
export function accumulate(acc: Accumulator, box: BoxScore): void {
  for (const side of [0, 1] as const) {
    const t = box.teams[side];
    const opp = box.teams[side === 0 ? 1 : 0];
    acc.games += 1;
    acc.pts += t.pts; acc.fga += t.fga; acc.fgm += t.fgm;
    acc.tpa += t.tpa; acc.tpm += t.tpm; acc.fta += t.fta; acc.ftm += t.ftm;
    acc.orb += t.orb; acc.drb += t.drb; acc.trb += t.trb;
    acc.ast += t.ast; acc.stl += t.stl; acc.blk += t.blk;
    acc.tov += t.tov; acc.pf += t.pf; acc.poss += t.poss;
    acc.paceSum += box.pace;
    acc.orbPctSum += orbPct(t, opp);
    acc.ortgSum += ortg(t);
  }
}

/**
 * Combine two accumulators field-by-field. The use case this exists for:
 * parallel/sharded batch runs (e.g. splitting a large `npm run batch` across
 * workers, or the sweep's multi-seed-base evaluation) where each shard folds
 * its own games into its own Accumulator and the results need to be
 * combined into one league-wide total before finalize(). Because every field
 * is a running sum (see the Accumulator doc comment — even the `*Sum`
 * fields are sums, just of a different underlying per-game value), a
 * component-wise add is exact: mergeAcc(A, B) followed by finalize() gives
 * the identical LeagueAverages as accumulating everything into one
 * Accumulator from the start.
 */
export function mergeAcc(a: Accumulator, b: Accumulator): Accumulator {
  const out = emptyAcc();
  for (const k of Object.keys(out) as (keyof Accumulator)[]) {
    out[k] = a[k] + b[k];
  }
  return out;
}

/**
 * League-wide per-team-game averages, keyed by the same `metric` strings
 * NBA_BANDS uses (bands.ts) — the index signature is what lets evaluate()
 * below look up `avgs[band.metric]` generically instead of a long
 * hand-written switch over every band.
 */
export interface LeagueAverages {
  games: number;
  [metric: string]: number;
}

/**
 * Turn accumulated running sums into the per-game rate stats bands.ts
 * checks. `Math.max(1, acc.games)` guards divide-by-zero on an empty
 * accumulator (a zero-game batch reads back as all-zero averages rather
 * than NaN-poisoning every downstream band check).
 *
 * Two divisor patterns here, both correct for what they compute:
 *   - Counting stats (pts, fga, trb, ast, …) divide the RAW SUM by `g` —
 *     ordinary per-game averaging, since these are directly additive.
 *   - pace/orbPct/ortg divide the pre-computed `*Sum` running total by `g`
 *     instead — see the Accumulator doc comment for why these can't be
 *     recomputed from grand totals after the fact.
 *   - fgPct/tpaShare/tpPct/ftPct instead divide sum-of-makes by
 *     sum-of-attempts DIRECTLY (not averaged-per-game) — this is the
 *     correct way to combine a ratio stat across many team-games (weighted
 *     by volume), as opposed to pace/orbPct/ortg's simple mean-of-means.
 *     The distinction matters: naively averaging each game's fgPct would
 *     let a team's one blowout 2-of-20 shooting night pull the season
 *     average down disproportionately to its point total.
 */
export function finalize(acc: Accumulator): LeagueAverages {
  const g = Math.max(1, acc.games);
  return {
    games: acc.games,
    pace: acc.paceSum / g,
    pts: acc.pts / g,
    fga: acc.fga / g,
    fgPct: acc.fga === 0 ? 0 : acc.fgm / acc.fga,
    tpaShare: acc.fga === 0 ? 0 : acc.tpa / acc.fga,
    tpPct: acc.tpa === 0 ? 0 : acc.tpm / acc.tpa,
    fta: acc.fta / g,
    ftPct: acc.fta === 0 ? 0 : acc.ftm / acc.fta,
    orbPct: acc.orbPctSum / g,
    trb: acc.trb / g,
    ast: acc.ast / g,
    stl: acc.stl / g,
    blk: acc.blk / g,
    tov: acc.tov / g,
    pf: acc.pf / g,
    ortg: acc.ortgSum / g
  };
}

export interface BandResult {
  band: Band;
  value: number;
  pass: boolean;
}

/**
 * Check each band's metric against the same-named LeagueAverages field.
 * A metric missing from `avgs` reads back as `NaN` via `?? NaN`, and
 * `NaN >= lo` / `NaN <= hi` are both false in JS — so a typo'd or
 * not-yet-wired metric name FAILS LOUDLY here rather than silently
 * reading `undefined >= lo` (which would also be false, but for a less
 * traceable reason); worth knowing that this is relying on that
 * comparison-with-NaN behavior rather than an explicit `Number.isNaN` check.
 */
export function evaluate(avgs: LeagueAverages, bands: Band[]): BandResult[] {
  return bands.map((band) => {
    const value = avgs[band.metric] ?? NaN;
    return { band, value, pass: value >= band.lo && value <= band.hi };
  });
}

/** Render a BandResult[] as the aligned OK/FAIL table `npm run batch` and the sweep print — pass/fail counts up top, one padded row per band below, percentages formatted via each band's own `pct` hint. */
export function formatReport(results: BandResult[]): string {
  const fmt = (v: number, pct?: boolean): string =>
    pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1);
  const rows = results.map((r) => {
    const status = r.pass ? ' OK ' : 'FAIL';
    const range = `${fmt(r.band.lo, r.band.pct)} – ${fmt(r.band.hi, r.band.pct)}`;
    return `${status}  ${r.band.label.padEnd(28)} ${fmt(r.value, r.band.pct).padStart(8)}   target ${range}`;
  });
  const passed = results.filter((r) => r.pass).length;
  return [
    `Realism acceptance report — ${passed}/${results.length} bands passing`,
    '─'.repeat(72),
    ...rows
  ].join('\n');
}
