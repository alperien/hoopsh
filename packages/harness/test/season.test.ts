/**
 * Season-layer tests: schedule properties (pure, no sims), season
 * determinism + standings arithmetic (one small league simulated twice),
 * the SimulateGames seam contract (mock seam, no sims), and Monte-Carlo
 * sanity (identical teams straddle 50%, a clearly stronger team clears it).
 *
 * COMPUTE BUDGET: sims are the expensive part (~0.3-0.5s/game on a shared
 * 2-core box), so this file simulates exactly 82 games total: 6+6 for the
 * determinism pair, 30+30 for the two Monte-Carlo checks, 5+5 for matchup
 * determinism. Everything else runs on fabricated outcomes or pure math.
 * All sims are seeded — every assertion below is on a DETERMINISTIC value,
 * so nothing here is a statistical flake: the Monte-Carlo bounds are chosen
 * to hold for the pinned seeds AND be comfortably inside what any
 * non-broken engine draw should produce.
 */

import { describe, expect, it } from 'vitest';
import { cascadiaBreakers } from '@hoopsh/data';
import type { TeamTotals } from '@hoopsh/stats';
import {
  buildTasks, computeStandings, gameSeed, roundRobin, runSeason,
  type GameOutcome, type SimulateGames
} from '../src/season.js';
import {
  percentileSorted, simsToResolveEdge, simulateMatchup, wilsonInterval
} from '../src/matchup.js';
import { cloneTeamWithIds, makeLeague, scaleTeam } from '../src/league.js';

// ---------------------------------------------------------------- fixtures
// Shared across tests so the expensive sims run ONCE per file execution.

const LEAGUE = makeLeague(4, 'season-test');
const SCHEDULE = roundRobin(LEAGUE.map((t) => t.id), 1); // 6 games
// seedBase re-anchored twice, same non-vacuity mechanism both times: the
// draw must contain winPct ties or the diff-tiebreak tier of the ranked-
// order test goes unexercised (its guard trips loudly by design). 'det' ->
// 's2' after the scan-wave re-center; 's2' -> 's3' after the release-audit
// engine fixes reshuffled the streams and 's2' came out 3-0/2-1/1-2/0-3
// (zero ties); 's3' -> 's6' after the W69 probe flip + W70 hysteresis fix
// did the same to 's3'; 's6' -> 's4' after the W73 dunker-dive flip left
// 's6' tie-free. 's4' measured: three 2-1 teams — a triple tie exercising
// the diff tier (probed s3..s12, 2026-07-31 evening). Assertions
// unchanged.
const seasonA = await runSeason({ teams: LEAGUE, schedule: SCHEDULE, seedBase: 's4' });
const seasonB = await runSeason({ teams: LEAGUE, schedule: SCHEDULE, seedBase: 's4' });

const BASE = cascadiaBreakers();
const TWIN = cloneTeamWithIds(cascadiaBreakers(), 'twin');
const STRONG = scaleTeam(cascadiaBreakers(), 8, 'strong');
const WEAK = scaleTeam(cascadiaBreakers(), -8, 'weak');
const even = await simulateMatchup(BASE, TWIN, 30, { seedBase: 'mc-even' });
const lopsided = await simulateMatchup(STRONG, WEAK, 30, { seedBase: 'mc-edge' });

// ---------------------------------------------------------------- schedule

describe('roundRobin schedule generation', () => {
  for (const n of [4, 5, 6, 7]) {
    it(`n=${n}, rounds=2: every pair meets twice, once in each building`, () => {
      const ids = Array.from({ length: n }, (_, i) => `t${i}`);
      const games = roundRobin(ids, 2);
      expect(games.length).toBe(n * (n - 1)); // 2 * C(n,2)
      const met = new Map<string, number>();
      for (const g of games) {
        expect(g.home === g.away).toBe(false);
        met.set(`${g.home}>${g.away}`, (met.get(`${g.home}>${g.away}`) ?? 0) + 1);
      }
      // every ORDERED pair exactly once = every unordered pair once per venue
      expect(met.size).toBe(n * (n - 1));
      for (const count of met.values()) expect(count).toBe(1);
    });
  }

  it('single-cycle venue balance: |home − away| stays small (the 3-0 bug)', () => {
    for (const n of [4, 6, 8]) {
      const ids = Array.from({ length: n }, (_, i) => `t${i}`);
      const homes = new Map<string, number>();
      const aways = new Map<string, number>();
      for (const g of roundRobin(ids, 1)) {
        homes.set(g.home, (homes.get(g.home) ?? 0) + 1);
        aways.set(g.away, (aways.get(g.away) ?? 0) + 1);
      }
      for (const id of ids) {
        const imbalance = Math.abs((homes.get(id) ?? 0) - (aways.get(id) ?? 0));
        expect(imbalance).toBeLessThanOrEqual(1);
      }
    }
  });

  it('odd team counts get byes: each team sits out once per cycle', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const games = roundRobin(ids, 1);
    expect(games.length).toBe(10); // C(5,2)
    const played = new Map<string, number>();
    for (const g of games) {
      played.set(g.home, (played.get(g.home) ?? 0) + 1);
      played.set(g.away, (played.get(g.away) ?? 0) + 1);
    }
    for (const id of ids) expect(played.get(id)).toBe(4);
  });

  it('no team plays twice in the same round (date label = parallel wave)', () => {
    const games = roundRobin(['a', 'b', 'c', 'd', 'e', 'f'], 2);
    const byRound = new Map<string, string[]>();
    for (const g of games) {
      const r = byRound.get(g.date!) ?? [];
      r.push(g.home, g.away);
      byRound.set(g.date!, r);
    }
    for (const teamsInRound of byRound.values()) {
      expect(new Set(teamsInRound).size).toBe(teamsInRound.length);
    }
  });

  it('rejects duplicate ids and sub-2-team leagues', () => {
    expect(() => roundRobin(['a', 'a'])).toThrow(/duplicate/);
    expect(() => roundRobin(['a'])).toThrow(/at least 2/);
  });
});

// ------------------------------------------------------------- determinism

describe('season determinism', () => {
  it('same seed base -> byte-identical outcomes and standings', () => {
    expect(JSON.stringify(seasonA.outcomes)).toBe(JSON.stringify(seasonB.outcomes));
    expect(JSON.stringify(seasonA.standings)).toBe(JSON.stringify(seasonB.standings));
  });

  it('per-game seeds derive from base + schedule position + matchup', () => {
    expect(gameSeed('s', 3, 'h', 'a')).toBe('s:g3:a@h');
    const tasks = buildTasks(LEAGUE, SCHEDULE, 's4'); // matches the fixture's seedBase
    expect(new Set(tasks.map((t) => t.seed)).size).toBe(tasks.length);
    expect(tasks.map((t) => t.seed)).toEqual(seasonA.outcomes.map((o) => o.seed));
  });

  it('buildTasks is loud on schedules that reference unknown teams', () => {
    expect(() => buildTasks(LEAGUE, [{ home: 'ghost', away: LEAGUE[0]!.id }], 's'))
      .toThrow(/unknown home team "ghost"/);
    expect(() => buildTasks(LEAGUE, [{ home: LEAGUE[0]!.id, away: LEAGUE[0]!.id }], 's'))
      .toThrow(/cannot play itself/);
  });
});

// -------------------------------------------------------------- standings

describe('standings arithmetic', () => {
  const standings = seasonA.standings;

  it('W + L = games played, for every team', () => {
    for (const s of standings) {
      expect(s.wins + s.losses).toBe(s.games);
      expect(s.games).toBe(3); // 4-team single round-robin
      expect(s.home.wins + s.home.losses + s.away.wins + s.away.losses).toBe(s.games);
      expect(s.home.wins + s.away.wins).toBe(s.wins);
    }
  });

  it('league-wide: Σwins = Σlosses = games; Σdiff = 0 exactly', () => {
    const games = seasonA.outcomes.length;
    expect(standings.reduce((t, s) => t + s.wins, 0)).toBe(games);
    expect(standings.reduce((t, s) => t + s.losses, 0)).toBe(games);
    expect(standings.reduce((t, s) => t + s.diff, 0)).toBe(0);
    expect(standings.reduce((t, s) => t + s.pointsFor - s.pointsAgainst, 0)).toBe(0);
  });

  it('venue splits and averages reconcile with totals', () => {
    for (const s of standings) {
      expect(s.home.pointsFor + s.away.pointsFor).toBe(s.pointsFor);
      expect(s.home.pointsAgainst + s.away.pointsAgainst).toBe(s.pointsAgainst);
      expect(s.diff).toBe(s.pointsFor - s.pointsAgainst);
      expect(Math.abs(s.avg.pts * s.games - s.pointsFor)).toBeLessThan(1e-9);
      expect(s.sos).toBeGreaterThanOrEqual(0);
      expect(s.sos).toBeLessThanOrEqual(1);
      // ratio stats are ratios, not sums
      expect(s.avg.fgPct).toBeGreaterThan(0);
      expect(s.avg.fgPct).toBeLessThan(1);
    }
  });

  it('is RANKED best-first: winPct desc, diff desc, id asc — who is FIRST', () => {
    // The one thing a standings table IS. Every other test in this block is
    // order-agnostic arithmetic (sums, splits, reconciliation), so an
    // inverted sort — worst team first — used to survive the whole suite
    // (mutation probe, season.ts computeStandings comparator). This pins the
    // documented contract "sorted standings (win pct desc, diff desc, id)".
    expect(standings[0]!.winPct).toBe(Math.max(...standings.map((s) => s.winPct)));
    // 4 teams x 3 games each: Σwins = 6 cannot split evenly across 4 teams,
    // so this fixture always has a real best-vs-worst gap — the ordering
    // checks below can never go vacuous on an all-tied table
    expect(standings[0]!.winPct).toBeGreaterThan(standings[standings.length - 1]!.winPct);
    let tieTierRuns = 0; // existence accounting for the conditional tier below (b9-F6)
    for (let i = 1; i < standings.length; i++) {
      const hi = standings[i - 1]!;
      const lo = standings[i]!;
      expect(hi.winPct).toBeGreaterThanOrEqual(lo.winPct);
      if (hi.winPct === lo.winPct) {
        tieTierRuns++;
        expect(hi.diff).toBeGreaterThanOrEqual(lo.diff);
        if (hi.diff === lo.diff) {
          expect(hi.teamId < lo.teamId).toBe(true); // byte-stable total order on exact ties
        }
      }
    }
    // The diff tiebreaker tier is NOT pigeonhole-guaranteed (a 3/2/1/0 draw
    // has no winPct tie), so its exercise is asserted rather than claimed:
    // this pinned draw produces two 2-1 and two 1-2 teams (measured — 2 tie
    // pairs). A re-tune that reshuffles the draw fails here loudly instead
    // of silently un-exercising the tier (b9-F6).
    expect(tieTierRuns).toBeGreaterThanOrEqual(1);
  });

  it('is order-insensitive: shuffled outcomes fold to identical standings', () => {
    const shuffled = [...seasonA.outcomes].reverse();
    const teamIds = LEAGUE.map((t) => t.id);
    expect(JSON.stringify(computeStandings(shuffled, teamIds)))
      .toBe(JSON.stringify(computeStandings(seasonA.outcomes, teamIds)));
  });

  it('rejects outcomes for teams outside the declared roster set', () => {
    expect(() => computeStandings(seasonA.outcomes, ['nobody'])).toThrow(/not in teamIds/);
  });
});

// ------------------------------------------------------- the parallel seam

describe('SimulateGames seam contract (what wave1/runner drops into)', () => {
  const mkTotals = (side: 0 | 1, teamId: string, pts: number): TeamTotals => ({
    side, teamId, pts, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    poss: 0, fastbreakPts: 0, timeouts: 0
  });

  it('outcomes may arrive in ANY order; runSeason re-sorts before folding', async () => {
    // a fake "worker pool" that completes games in reverse order and never
    // touches the engine — proves the driver puts no ordering burden on the
    // real parallel runner
    const reversedSeam: SimulateGames = (tasks) =>
      [...tasks].reverse().map((t): GameOutcome => ({
        index: t.index,
        seed: t.seed,
        date: t.date,
        homeId: t.home.id,
        awayId: t.away.id,
        score: [100 + t.index, 90],
        totals: [mkTotals(0, t.home.id, 100 + t.index), mkTotals(1, t.away.id, 90)],
        players: []
      }));

    const result = await runSeason({
      teams: LEAGUE, schedule: SCHEDULE, seedBase: 'seam', simulate: reversedSeam
    });
    expect(result.outcomes.map((o) => o.index)).toEqual([0, 1, 2, 3, 4, 5]);
    // every home team won 100+i to 90 -> all wins are home wins
    for (const s of result.standings) expect(s.away.wins).toBe(0);
    expect(result.standings.reduce((t, s) => t + s.wins, 0)).toBe(6);
  });

  it('a seam returning the wrong number of outcomes fails loudly', async () => {
    const dropsOne: SimulateGames = (tasks) =>
      [...tasks].slice(1).map((t): GameOutcome => ({
        index: t.index, seed: t.seed, homeId: t.home.id, awayId: t.away.id,
        score: [1, 0],
        totals: [mkTotals(0, t.home.id, 1), mkTotals(1, t.away.id, 0)],
        players: []
      }));
    let threw = '';
    try {
      await runSeason({ teams: LEAGUE, schedule: SCHEDULE, seedBase: 's', simulate: dropsOne });
    } catch (e) {
      threw = String(e);
    }
    expect(/5 outcomes for 6 tasks/.test(threw)).toBe(true);
  });

  it('a seam returning a duplicated index (count intact) fails loudly instead of corrupting standings (B3-3)', async () => {
    // the overlapping-slice bug shape: game 1's outcome never arrives, game
    // 0's arrives twice — the COUNT check alone accepted this and produced
    // standings for a schedule whose game 1 was never played
    const duplicatesOne: SimulateGames = (tasks) =>
      tasks.map((t, i): GameOutcome => {
        const src = i === 1 ? tasks[0]! : t;
        return {
          index: src.index, seed: src.seed, date: src.date,
          homeId: src.home.id, awayId: src.away.id,
          score: [100, 90],
          totals: [mkTotals(0, src.home.id, 100), mkTotals(1, src.away.id, 90)],
          players: []
        };
      });
    let threw = '';
    try {
      await runSeason({ teams: LEAGUE, schedule: SCHEDULE, seedBase: 's', simulate: duplicatesOne });
    } catch (e) {
      threw = String(e);
    }
    expect(/duplicate\/missing game indices/.test(threw)).toBe(true);
  });
});

// ------------------------------------------------------------- Monte-Carlo

describe('Monte-Carlo matchup sanity', () => {
  it('identical teams: 50% inside the 95% CI, margin centered near zero', () => {
    expect(even.n).toBe(30);
    expect(even.ci95[0]).toBeLessThanOrEqual(0.5);
    expect(even.ci95[1]).toBeGreaterThanOrEqual(0.5);
    // margin sd is ~12-16 pts; at n=30 the mean's SE is ~2.5, so |mean| < 8
    // is a ~3-sigma envelope around the true 0 for this pinned seed
    expect(Math.abs(even.meanMargin)).toBeLessThan(8);
  });

  it('a uniformly stronger team is clearly above 50% (CI floor > 0.5)', () => {
    expect(lopsided.homeWinProb).toBeGreaterThan(0.7);
    expect(lopsided.ci95[0]).toBeGreaterThan(0.5);
    expect(lopsided.meanMargin).toBeGreaterThan(0);
  });

  it('distribution internals are coherent', () => {
    for (const d of [even, lopsided]) {
      expect(d.homeWins + d.awayWins).toBe(d.n);
      expect(d.histogram.reduce((s, b) => s + b.count, 0)).toBe(d.n);
      const p = d.marginPercentiles;
      expect(p.p5).toBeLessThanOrEqual(p.p25);
      expect(p.p25).toBeLessThanOrEqual(p.p50);
      expect(p.p50).toBeLessThanOrEqual(p.p75);
      expect(p.p75).toBeLessThanOrEqual(p.p95);
      expect(d.medianMargin).toBe(p.p50);
      // Ties are impossible (the engine plays OT until decided), so the
      // histogram mass at margin >= 0 must be EXACTLY the home win count: a
      // tied game would land in the lo=0 bin without counting as a home win
      // (matchup.ts counts margin > 0) and break this equality. The previous
      // assertion here — homeWins === n - awayWins — was tautological:
      // matchup.ts DEFINES awayWins as n - homeWins, so a tie-swallowing
      // engine could never have failed it (b9-F3).
      const nonNegMass = d.histogram.filter((b) => b.lo >= 0).reduce((s, b) => s + b.count, 0);
      expect(nonNegMass).toBe(d.homeWins);
      expect(d.players.length).toBeGreaterThan(0);
      for (const pl of d.players) {
        expect(pl.games).toBeGreaterThan(0);
        expect(pl.pts.p10).toBeLessThanOrEqual(pl.pts.p90);
      }
    }
  });

  it('is deterministic: same seed base -> identical distribution', async () => {
    const a = await simulateMatchup(BASE, TWIN, 5, { seedBase: 'mc-det' });
    const b = await simulateMatchup(BASE, TWIN, 5, { seedBase: 'mc-det' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('refuses to play a team against the same id (box scores would merge)', async () => {
    let threw = '';
    try {
      await simulateMatchup(BASE, cascadiaBreakers(), 1);
    } catch (e) {
      threw = String(e);
    }
    expect(/cloneTeamWithIds/.test(threw)).toBe(true);
  });
});

// ----------------------------------------------------------------- CI math

describe('CI math (no sims)', () => {
  it('Wilson interval: symmetric at p=0.5, inside [0,1], narrows with n', () => {
    const [lo, hi] = wilsonInterval(15, 30);
    expect(Math.abs(lo + hi - 1)).toBeLessThan(1e-12);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1);
    const [lo2, hi2] = wilsonInterval(500, 1000);
    expect(hi2 - lo2).toBeLessThan(hi - lo);
    // extreme p̂ stays inside [0,1] (where Wald would clip or escape)
    const [zl, zh] = wilsonInterval(0, 20);
    expect(zl).toBe(0);
    expect(zh).toBeGreaterThan(0);
    expect(zh).toBeLessThan(0.3);
    expect(() => wilsonInterval(5, 0)).toThrow(/positive/);
    expect(() => wilsonInterval(11, 10)).toThrow(/outside/);
  });

  it('simsToResolveEdge: 55%-vs-coin-flip needs ~783 sims; bigger edges cost less', () => {
    expect(simsToResolveEdge(0.55)).toBe(783);
    expect(simsToResolveEdge(0.60)).toBeLessThan(simsToResolveEdge(0.55));
    expect(simsToResolveEdge(0.52)).toBeGreaterThan(4000);
    expect(simsToResolveEdge(0.70)).toBeLessThan(60);
    expect(() => simsToResolveEdge(0.5)).toThrow(/differ/);
    expect(() => simsToResolveEdge(1.0)).toThrow(/inside/);
  });

  it('percentileSorted: linear interpolation, endpoints exact', () => {
    expect(percentileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(percentileSorted([1, 2, 3, 4], 1)).toBe(4);
    expect(percentileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(() => percentileSorted([], 0.5)).toThrow(/empty/);
  });
});

// ------------------------------------------------------------------ league

describe('league generation fixtures', () => {
  it('makeLeague is pure in (n, seed) and ids are unique', () => {
    const a = makeLeague(3, 'x');
    const b = makeLeague(3, 'x');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const ids = a.flatMap((t) => [t.id, ...t.players.map((p) => p.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(makeLeague(3, 'y'))).not.toBe(JSON.stringify(a));
  });

  it('cloneTeamWithIds shares no ids with its source', () => {
    const src = cascadiaBreakers();
    const twin = cloneTeamWithIds(src, 'q');
    expect(twin.id === src.id).toBe(false);
    const srcIds = new Set(src.players.map((p) => p.id));
    for (const p of twin.players) expect(srcIds.has(p.id)).toBe(false);
    for (const s of twin.starters) {
      expect(twin.players.some((p) => p.id === s)).toBe(true);
    }
    // same ratings, different identity
    expect(twin.players[0]!.attr).toEqual(src.players[0]!.attr);
  });

  it('cloneTeamWithIds re-keys rotationMinutes to the new ids, un-aliased (M-33)', () => {
    const src = cascadiaBreakers();
    const starter = src.starters[0]!;
    src.rotationMinutes = { [starter]: 35 };
    const twin = cloneTeamWithIds(src, 'q');
    // the coach's target must follow the renamed player, or subs.ts finds no
    // target for anyone and the twin's rotation runs unleashed
    expect(twin.rotationMinutes).toEqual({ [`${starter}-q`]: 35 });
    // and it must be a COPY — the old spread aliased the same object
    src.rotationMinutes[starter] = 10;
    expect(twin.rotationMinutes![`${starter}-q`]).toBe(35);
    // a team without targets clones without inventing the field
    expect(cloneTeamWithIds(cascadiaBreakers(), 'r').rotationMinutes).toBe(undefined);
  });

  it('scaleTeam shifts every attribute, clamped to [1, 99]', () => {
    const src = cascadiaBreakers();
    const up = scaleTeam(src, 8, 'up');
    const p0 = src.players[0]!;
    const q0 = up.players[0]!;
    for (const k of Object.keys(p0.attr) as (keyof typeof p0.attr)[]) {
      expect(q0.attr[k]).toBe(Math.min(99, Math.max(1, Math.round(p0.attr[k] + 8))));
    }
    // tendencies untouched: strength, not style
    expect(q0.tend).toEqual(p0.tend);
  });
});
