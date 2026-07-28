/**
 * Monte-Carlo matchup API: the shape a prediction consumer needs.
 *
 * A single simulated game is one draw from the engine's outcome
 * distribution; a prediction needs the distribution: win probability with
 * honest uncertainty, the margin's center and spread, and per-player stat
 * lines. `simulateMatchup(home, away, n)` runs n independent games (seeds
 * derived from a base + sim index, so the whole distribution is
 * reproducible) and summarizes them.
 *
 * Statistics:
 *
 * - Win probability CI: Wilson score interval (see `wilsonInterval`), not
 *   the naive normal ("Wald") interval. Wald misbehaves exactly where
 *   matchup predictions live: p near 0.5 is fine, but lopsided matchups
 *   push p toward 0/1 where Wald's coverage collapses and its bounds leave
 *   [0,1]; Wilson stays inside [0,1] and keeps ~nominal coverage at small
 *   n.
 *
 * - n-sensitivity (the "how many sims" question): the standard error of a
 *   win-probability estimate is sqrt(p(1-p)/n) <= 0.5/sqrt(n). To tell a
 *   55% team from a coin flip you are testing p=0.55 against p0=0.50; the
 *   one-sample binomial power formula (`simsToResolveEdge`) gives
 *     n = (z_a*sqrt(p0*q0) + z_b*sqrt(p1*q1))^2 / (p1-p0)^2
 *   ≈ 783 sims for 95% confidence / 80% power. Rules of thumb this
 *   implies (all at 95% confidence, 80% power, vs p0=0.5):
 *     55% vs 50%  ->  ~783 sims        60% vs 50%  ->  ~194 sims
 *     52% vs 50%  ->  ~4,895 sims      70% vs 50%  ->   ~47 sims
 *   Equivalently by CI width: the 95% CI half-width is ~0.98/sqrt(n)
 *   (worst case p=0.5): n=100 -> ±9.8pp, n=400 -> ±4.9pp, n=1600 -> ±2.5pp.
 *   A 5-point edge is expensive to resolve; the API reports the CI so a
 *   consumer can see when n was too small instead of trusting a bare 0.55.
 *
 * - Margin distribution: mean, sample sd, percentiles (linear-interpolation
 *   quantiles), and a binned histogram. Margins are from the home team's
 *   perspective; ties are impossible (the engine plays overtime until
 *   decided), so P(margin>0) = homeWinProb exactly.
 *
 * Note on "home": the engine currently models no home-court advantage (and
 * run.ts's mirror option exists to verify it stays that way), so home/away
 * here is positional, not an edge; a real-world prediction consumer must
 * add HCA exogenously (docs/SEASON.md). The `mirror` option alternates
 * which side is the engine's home team purely to cancel any accidental
 * structural home bias; margins stay home-team-signed either way.
 *
 * Parallelism: same seam as the season driver. Pass a `SimulateGames` to
 * fan the n sims out to workers; results are re-sorted by sim index before
 * any statistic is computed, so completion order cannot change a digit.
 */

import type { Team } from '@hoopsh/engine';
import {
  gameSeed, simulateTasksSequential,
  type GameOutcome, type GameTask, type SimulateGames
} from './season.js';

// --------------------------------------------------------------- CI math

/**
 * Wilson score interval for a binomial proportion.
 * Center (p̂ + z²/2n)/(1 + z²/n), half-width z·√(p̂(1−p̂)/n + z²/4n²)/(1 + z²/n).
 * z defaults to 1.96 (two-sided 95%).
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) throw new Error('wilsonInterval: n must be positive');
  if (successes < 0 || successes > n) {
    throw new Error(`wilsonInterval: successes ${successes} outside [0, ${n}]`);
  }
  const p = successes / n;
  const z2n = (z * z) / n;
  const center = (p + z2n / 2) / (1 + z2n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2n / (4 * n))) / (1 + z2n);
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/**
 * Sims needed to distinguish a true win probability `p1` from a null `p0`
 * (one-sample, two-sided binomial test, normal approximation):
 *   n = (z_alpha*sqrt(p0 q0) + z_power*sqrt(p1 q1))^2 / (p1 - p0)^2
 *
 * Defaults are the conventional 95% confidence (zAlpha = 1.959964, the
 * two-sided 5% normal quantile) and 80% power (zPower = 0.841621, the 20%
 * one-sided quantile). They're parameters, not a lookup table, so callers
 * wanting 90% power pass zPower = 1.281552. The z values are the caller's
 * to choose; this function is just the algebra.
 *
 * simsToResolveEdge(0.55) → 783: the honest answer to "can 100 sims see a
 * 55/45 edge?" is no: at n=100 the 95% CI half-width is ~±10pp.
 */
export function simsToResolveEdge(
  p1: number,
  p0 = 0.5,
  zAlpha = 1.959964,
  zPower = 0.841621
): number {
  if (p1 <= 0 || p1 >= 1 || p0 <= 0 || p0 >= 1) {
    throw new Error('simsToResolveEdge: probabilities must be inside (0, 1)');
  }
  if (p1 === p0) throw new Error('simsToResolveEdge: p1 must differ from p0');
  const num = zAlpha * Math.sqrt(p0 * (1 - p0)) + zPower * Math.sqrt(p1 * (1 - p1));
  return Math.ceil((num * num) / ((p1 - p0) * (p1 - p0)));
}

/** Linear-interpolation quantile (R type 7) of an ascending-sorted array. */
export function percentileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new Error('percentileSorted: empty sample');
  if (q < 0 || q > 1) throw new Error(`percentileSorted: q ${q} outside [0,1]`);
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  // the guards above pin h to [0, length-1], so lo and hi are both in bounds
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
}

// ------------------------------------------------------------- the shape

/** Distribution summary of one scalar stat across n sims. */
export interface StatDist {
  mean: number;
  /** sample standard deviation (n−1 denominator) */
  sd: number;
  p10: number;
  p50: number;
  p90: number;
}

/** Per-player season-of-one-matchup stat-line distribution. */
export interface PlayerLineDist {
  playerId: string;
  name: string;
  teamId: string;
  /** games this player appeared in (of n) */
  games: number;
  min: StatDist;
  pts: StatDist;
  trb: StatDist;
  ast: StatDist;
}

/** One histogram bin: margins m with lo <= m < hi (home perspective). */
export interface MarginBin {
  lo: number;
  hi: number;
  count: number;
}

export interface MatchupDistribution {
  homeId: string;
  awayId: string;
  n: number;
  seedBase: string;
  homeWins: number;
  awayWins: number;
  /** point estimate homeWins / n */
  homeWinProb: number;
  /** Wilson 95% interval on homeWinProb */
  ci95: [number, number];
  meanMargin: number;
  medianMargin: number;
  /** sample sd of the margin */
  sdMargin: number;
  marginPercentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  /** sparse bins (only bins with counts), ascending; counts sum to n */
  histogram: MarginBin[];
  /** home players first, then away, each sorted by mean points desc */
  players: PlayerLineDist[];
}

export interface MatchupOptions {
  /** seed base (default "matchup"); sim i uses gameSeed(base, i, …) */
  seedBase?: string;
  /** the parallelism seam; same contract as the season driver's */
  simulate?: SimulateGames;
  /** alternate which side the engine treats as home on odd sims, to cancel
   *  any accidental structural home bias (the engine claims none; this is
   *  belt-and-braces for prediction use). Margins/probabilities are always
   *  reported for the logical home team either way. Default false. */
  mirror?: boolean;
  /** histogram bin width in points (default 5) */
  binWidth?: number;
  /** progress tap; order-agnostic under a parallel seam */
  onGame?: (o: GameOutcome) => void;
}

// ------------------------------------------------------------ internals

function statDist(values: number[]): StatDist {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = n < 2
    ? 0
    : Math.sqrt(values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1));
  return {
    mean,
    sd,
    p10: percentileSorted(sorted, 0.10),
    p50: percentileSorted(sorted, 0.50),
    p90: percentileSorted(sorted, 0.90)
  };
}

function buildHistogram(margins: readonly number[], binWidth: number): MarginBin[] {
  const bins = new Map<number, number>();
  for (const m of margins) {
    const lo = Math.floor(m / binWidth) * binWidth;
    bins.set(lo, (bins.get(lo) ?? 0) + 1);
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lo, count]) => ({ lo, hi: lo + binWidth, count }));
}

// ------------------------------------------------------------ the API

/**
 * Simulate `home` vs `away` n times and return the outcome distribution.
 *
 * Deterministic in (home, away, n, seedBase): the i-th sim's seed is
 * gameSeed(seedBase, i, engineHomeId, engineAwayId), so growing n from 100
 * to 1000 reuses the first 100 games' results exactly (a cheap way to
 * refine an estimate: only the new sims cost anything under a caching
 * seam, and the first 100 margins are bit-identical regardless).
 */
export async function simulateMatchup(
  home: Team,
  away: Team,
  n: number,
  opts: MatchupOptions = {}
): Promise<MatchupDistribution> {
  if (!Number.isInteger(n) || n < 1) throw new Error(`simulateMatchup: n must be a positive integer, got ${n}`);
  if (home.id === away.id) {
    throw new Error(
      `simulateMatchup: both teams have id "${home.id}" — box scores key on ids; ` +
      'use cloneTeamWithIds (league.ts) to play a team against itself'
    );
  }
  const seedBase = opts.seedBase ?? 'matchup';
  const binWidth = opts.binWidth ?? 5;
  if (!Number.isFinite(binWidth) || binWidth <= 0) {
    throw new Error(`simulateMatchup: binWidth must be > 0, got ${binWidth}`);
  }

  const tasks: GameTask[] = Array.from({ length: n }, (_, i) => {
    const flip = (opts.mirror ?? false) && i % 2 === 1;
    const h = flip ? away : home;
    const a = flip ? home : away;
    return { index: i, seed: gameSeed(seedBase, i, h.id, a.id), home: h, away: a };
  });

  const sim = opts.simulate ?? simulateTasksSequential;
  const outcomes = [...await sim(tasks, opts.onGame)].sort((a, b) => a.index - b.index);
  if (outcomes.length !== n) {
    throw new Error(`simulate seam returned ${outcomes.length} outcomes for ${n} tasks`);
  }

  // margins from the logical home team's perspective, id-keyed so mirrored
  // sims contribute with the correct sign
  const margins: number[] = [];
  let homeWins = 0;
  const perPlayer = new Map<string, { name: string; teamId: string; min: number[]; pts: number[]; trb: number[]; ast: number[] }>();

  for (const o of outcomes) {
    const homeSidePts = o.homeId === home.id ? o.score[0] : o.score[1];
    const awaySidePts = o.homeId === home.id ? o.score[1] : o.score[0];
    if (o.homeId !== home.id && o.awayId !== home.id) {
      throw new Error(`simulateMatchup: outcome ${o.index} references teams ${o.homeId}/${o.awayId}, not ${home.id}`);
    }
    const margin = homeSidePts - awaySidePts;
    margins.push(margin);
    if (margin > 0) homeWins += 1;

    for (const line of o.players) {
      // PlayerLine.team is the engine side (0 = that game's home), so map
      // through the outcome's ids to the logical team
      const teamId = line.team === 0 ? o.homeId : o.awayId;
      const key = `${teamId}/${line.id}`;
      let rec = perPlayer.get(key);
      if (!rec) {
        rec = { name: line.name, teamId, min: [], pts: [], trb: [], ast: [] };
        perPlayer.set(key, rec);
      }
      rec.min.push(line.min);
      rec.pts.push(line.pts);
      rec.trb.push(line.trb);
      rec.ast.push(line.ast);
    }
  }

  const sortedMargins = [...margins].sort((a, b) => a - b);
  const players: PlayerLineDist[] = [...perPlayer.entries()]
    .map(([key, r]) => ({
      playerId: key.slice(r.teamId.length + 1),
      name: r.name,
      teamId: r.teamId,
      games: r.pts.length,
      min: statDist(r.min),
      pts: statDist(r.pts),
      trb: statDist(r.trb),
      ast: statDist(r.ast)
    }))
    .sort((a, b) => {
      if (a.teamId !== b.teamId) {
        // home team's players first
        if (a.teamId === home.id) return -1;
        if (b.teamId === home.id) return 1;
        return a.teamId < b.teamId ? -1 : 1;
      }
      return b.pts.mean - a.pts.mean || (a.playerId < b.playerId ? -1 : 1);
    });

  return {
    homeId: home.id,
    awayId: away.id,
    n,
    seedBase,
    homeWins,
    awayWins: n - homeWins,
    homeWinProb: homeWins / n,
    ci95: wilsonInterval(homeWins, n),
    meanMargin: margins.reduce((s, m) => s + m, 0) / n,
    medianMargin: percentileSorted(sortedMargins, 0.5),
    sdMargin: statDist(margins).sd,
    marginPercentiles: {
      p5: percentileSorted(sortedMargins, 0.05),
      p25: percentileSorted(sortedMargins, 0.25),
      p50: percentileSorted(sortedMargins, 0.50),
      p75: percentileSorted(sortedMargins, 0.75),
      p95: percentileSorted(sortedMargins, 0.95)
    },
    histogram: buildHistogram(margins, binWidth),
    players
  };
}

// ------------------------------------------------------------ formatting

/** Human-readable matchup report: probability + CI, margin summary, ASCII
 *  margin histogram, and each side's top stat lines. */
export function formatMatchup(d: MatchupDistribution, topPlayers = 4): string {
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`${d.homeId} (home) vs ${d.awayId} — ${d.n} sims (seed base "${d.seedBase}")`);
  lines.push('─'.repeat(72));
  lines.push(
    `home win probability  ${pct(d.homeWinProb)}   95% CI [${pct(d.ci95[0])}, ${pct(d.ci95[1])}]` +
    `   (${d.homeWins}W-${d.awayWins}L)`
  );
  lines.push(
    `margin (home persp.)  mean ${d.meanMargin >= 0 ? '+' : ''}${d.meanMargin.toFixed(1)}` +
    `  median ${d.medianMargin >= 0 ? '+' : ''}${d.medianMargin.toFixed(1)}  sd ${d.sdMargin.toFixed(1)}`
  );
  const p = d.marginPercentiles;
  lines.push(
    `margin percentiles    p5 ${p.p5.toFixed(0)}  p25 ${p.p25.toFixed(0)}  p50 ${p.p50.toFixed(0)}` +
    `  p75 ${p.p75.toFixed(0)}  p95 ${p.p95.toFixed(0)}`
  );
  lines.push('');
  const maxCount = Math.max(...d.histogram.map((b) => b.count));
  for (const b of d.histogram) {
    const label = `${String(b.lo).padStart(4)}..${String(b.hi - 1).padStart(3)}`;
    const bar = '#'.repeat(Math.max(1, Math.round((b.count / maxCount) * 40)));
    lines.push(`  ${label} ${bar} ${b.count}`);
  }
  lines.push('');
  for (const teamId of [d.homeId, d.awayId]) {
    lines.push(`${teamId} — top stat lines (mean, [p10..p90]):`);
    d.players
      .filter((pl) => pl.teamId === teamId)
      .slice(0, topPlayers)
      .forEach((pl) => {
        lines.push(
          `  ${pl.name.padEnd(18)} ${pl.pts.mean.toFixed(1).padStart(5)} pts [${pl.pts.p10.toFixed(0)}..${pl.pts.p90.toFixed(0)}]` +
          `  ${pl.trb.mean.toFixed(1).padStart(4)} reb  ${pl.ast.mean.toFixed(1).padStart(4)} ast` +
          `  (${pl.min.mean.toFixed(0)} min, ${pl.games}/${d.n} gms)`
        );
      });
  }
  return lines.join('\n');
}
