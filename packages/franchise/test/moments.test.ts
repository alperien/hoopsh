/**
 * Phase-transition news gate (media/moments.ts, issue #111): the desk
 * writes a championship story at the finals horn, the lottery order the
 * night it is drawn, and a consensus draft preview alongside it. Driven
 * by the autosim fake game sim across two full league years so both
 * transitions fire twice.
 *
 * COMPUTE BUDGET: two fake-sim league years, zero engine games (the same
 * budget class as autosim.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '@hoopsh/engine';
import {
  advanceDay, championshipNews, createLeague, generatePersona, lotteryNightNews, streamRng,
} from '../src/index.js';
import { COLUMNIST } from '../src/media/news.js';
import { WIRE } from '../src/media/recap.js';
import type { GameJob, GameJobResult, League, LeagueDate, NewsItem } from '../src/types.js';

/** Deterministic plausible result from the job seed alone (copied from autosim.test.ts, file-local there). */
function fakeSim(jobs: GameJob[]): GameJobResult[] {
  return jobs.map(job => {
    const rng = new Rng(`fake:${job.seed}`);
    let hs = 95 + rng.int(35);
    let as = 95 + rng.int(35);
    if (hs === as) hs += 1; // the engine never ties; neither does the fake
    const mkLines = (team: GameJob['home'], teamPts: number, side: 0 | 1) => {
      const ids = team.players.slice(0, 8);
      const shares = [0.24, 0.19, 0.15, 0.12, 0.10, 0.08, 0.07, 0.05];
      let assigned = 0;
      return ids.map((p, i) => {
        const pts = i === ids.length - 1 ? teamPts - assigned : Math.round(teamPts * shares[i]!);
        assigned += pts;
        const min = [36, 34, 32, 30, 26, 22, 18, 12][i]!;
        return {
          playerId: p.id, teamId: team.id, starter: i < 5,
          min, pts,
          fgm: Math.max(0, Math.round(pts * 0.38)), fga: Math.max(1, Math.round(pts * 0.85)),
          tpm: Math.round(pts * 0.12), tpa: Math.round(pts * 0.3),
          ftm: Math.round(pts * 0.14), fta: Math.round(pts * 0.18),
          orb: rng.int(3), drb: 2 + rng.int(6), ast: rng.int(8), stl: rng.int(3),
          blk: rng.int(2), tov: rng.int(4), pf: rng.int(5),
          plusMinus: (side === 0 ? hs - as : as - hs) > 0 ? rng.int(15) : -rng.int(15),
        };
      });
    };
    const totals = (pts: number) => ({
      pts, fgm: Math.round(pts * 0.37), fga: 88, tpm: Math.round(pts * 0.12), tpa: 35,
      ftm: Math.round(pts * 0.15), fta: 20, orb: 10, drb: 33, ast: 25, stl: 7,
      blk: 4, tov: 13, pf: 19, pace: 98, fastbreakPts: 12, biggestLead: Math.abs(hs - as) + 4,
    });
    return {
      index: job.index,
      gameId: job.gameId,
      final: [hs, as] as [number, number],
      ot: 0,
      lines: [...mkLines(job.home, hs, 0), ...mkLines(job.away, as, 1)],
      totals: [totals(hs), totals(as)] as GameJobResult['totals'],
      keyPlays: [],
    };
  });
}

const SEED = 'moments-gate';
const BUDGET = 240_000;

interface Stop { date: LeagueDate; newsIds: string[] }
interface RunResult {
  league: League;
  /** digest captured when the phase flipped to 'lottery' (finals horn), per season */
  championStops: Stop[];
  /** digest captured when the phase flipped to 'draft' (lottery night), per season */
  lotteryStops: Stop[];
  /** the draft class as it stood on each lottery night (the draft empties it later) */
  classes: string[][];
}

// One shared run for every assertion below: the shim has no beforeAll, so
// the run starts once at module load and each test awaits it.
const run: Promise<RunResult> = (async () => {
  const league = createLeague({ seed: SEED, userTeam: 'nye' });
  // every chair AI-run so draft night never pauses (autosim.test.ts pattern)
  league.teams.nye!.gm = generatePersona(streamRng(SEED, 'genesis', 'user-gm'));
  const championStops: Stop[] = [];
  const lotteryStops: Stop[] = [];
  const classes: string[][] = [];
  const start = league.season;
  let guard = 0;
  while (league.season < start + 2 && guard++ < 900) {
    const d = await advanceDay(league, fakeSim);
    if (d.phaseChangedTo === 'lottery') championStops.push({ date: d.date, newsIds: d.newsIds });
    if (d.phaseChangedTo === 'draft') {
      lotteryStops.push({ date: d.date, newsIds: d.newsIds });
      classes.push([...league.draftClass]);
    }
  }
  return { league, championStops, lotteryStops, classes };
})();

const name = (league: League, teamId: string): string => league.teams[teamId]!.name;
const byId = (league: League, id: string): NewsItem | undefined => league.news.find(n => n.id === id);

describe('phase-transition news (media/moments.ts)', () => {
  it('writes the championship story at the finals horn, with the facts of the run', { timeout: BUDGET }, async () => {
    const { league, championStops } = await run;
    expect(championStops.length).toBe(2);
    const stop = championStops[0]!;
    const id = `n-s${stop.date.season}d${stop.date.day}-champ`;
    expect(stop.newsIds).toContain(id);

    const item = byId(league, id)!;
    expect(Boolean(item)).toBe(true);
    const archive = league.archives.find(a => a.season === stop.date.season)!;
    expect(item.type).toBe('review');
    expect(item.weight).toBe(3);
    expect(item.byline).toBe(COLUMNIST);
    expect(item.teams).toEqual([archive.champion, archive.runnerUp]);
    expect(item.headline.includes(name(league, archive.champion))).toBe(true);
    expect(item.date).toEqual(stop.date);

    // the body cites the actual series score and the banner count
    const finals = archive.playoffs.find(s => s.round === 4)!;
    const champWins = archive.champion === finals.high ? finals.wins[0] : finals.wins[1];
    const loserWins = archive.champion === finals.high ? finals.wins[1] : finals.wins[0];
    expect(item.body.includes(`${champWins}-${loserWins} in the finals`)).toBe(true);
    expect(/championship/.test(item.body)).toBe(true);
    // the finals scoring leader is a real player and rides the players field
    expect(item.players.length).toBe(1);
    expect(Boolean(league.players[item.players[0]!])).toBe(true);
    expect(item.body.includes('points a game in the series')).toBe(true);
  });

  it('writes the lottery order story on lottery night, every slot on the board', { timeout: BUDGET }, async () => {
    const { league, lotteryStops } = await run;
    expect(lotteryStops.length).toBe(2);
    const stop = lotteryStops[0]!;
    const id = `n-s${stop.date.season}d${stop.date.day}-lott`;
    expect(stop.newsIds).toContain(id);

    const item = byId(league, id)!;
    const order = league.archives.find(a => a.season === stop.date.season)!.lottery.order;
    expect(item.type).toBe('lottery');
    expect(item.weight).toBe(3);
    expect(item.byline).toBe(WIRE);
    // every team learned its slot tonight: the team filter must surface this
    expect(item.teams).toEqual(order);
    expect(item.teams.length).toBe(30);
    expect(item.headline.includes(name(league, order[0]!))).toBe(true);
    expect(item.body.includes(`The first-round order: 1. ${name(league, order[0]!)}`)).toBe(true);
    expect(item.body.includes(`30. ${name(league, order[29]!)}`)).toBe(true);
  });

  it('previews the class the same night with the consensus top of the board', { timeout: BUDGET }, async () => {
    const { league, lotteryStops, classes } = await run;
    const stop = lotteryStops[0]!;
    const id = `n-s${stop.date.season}d${stop.date.day}-dpre`;
    expect(stop.newsIds).toContain(id);

    const item = byId(league, id)!;
    expect(item.type).toBe('preview');
    expect(item.weight).toBe(2);
    expect(item.byline).toBe(COLUMNIST);
    // three named prospects, all really in that night's class, all in the body
    expect(item.players.length).toBe(3);
    for (const pid of item.players) {
      expect(classes[0]!.includes(pid)).toBe(true);
      expect(item.body.includes(league.players[pid]!.name)).toBe(true);
    }
    // the headline leads with the consensus number one
    expect(item.headline.includes(league.players[item.players[0]!]!.name)).toBe(true);
    expect(item.body.includes('pick first')).toBe(true);
  });

  it('fires every season, not just the first', { timeout: BUDGET }, async () => {
    const { league, championStops, lotteryStops } = await run;
    const c2 = championStops[1]!;
    const l2 = lotteryStops[1]!;
    expect(Boolean(byId(league, `n-s${c2.date.season}d${c2.date.day}-champ`))).toBe(true);
    expect(Boolean(byId(league, `n-s${l2.date.season}d${l2.date.day}-lott`))).toBe(true);
    expect(Boolean(byId(league, `n-s${l2.date.season}d${l2.date.day}-dpre`))).toBe(true);
    // one dedicated story per class per season, never duplicates
    for (const season of [c2.date.season - 1, c2.date.season]) {
      expect(league.news.filter(n => n.type === 'review' && n.date.season === season).length).toBe(1);
      expect(league.news.filter(n => n.type === 'lottery' && n.date.season === season).length).toBe(1);
      expect(league.news.filter(n => n.type === 'preview' && n.date.season === season).length).toBe(1);
    }
  });

  it('is a pure read: repeated calls produce identical items and ids never collide', { timeout: BUDGET }, async () => {
    const { league } = await run;
    // the writers are pure functions of league state (registered rng
    // streams only): calling twice must be byte-identical
    expect(JSON.stringify(championshipNews(league))).toBe(JSON.stringify(championshipNews(league)));
    expect(JSON.stringify(lotteryNightNews(league))).toBe(JSON.stringify(lotteryNightNews(league)));
    // and the feed itself carries no duplicate ids across two full years
    expect(new Set(league.news.map(n => n.id)).size).toBe(league.news.length);
  });
});
