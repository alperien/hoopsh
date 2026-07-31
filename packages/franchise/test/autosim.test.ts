/**
 * The autosim machinery gate: two full league years driven by a FAKE game
 * sim (deterministic plausible finals, no engine), so the suite verifies
 * the calendar, draft, free agency, development, retirement, archives,
 * and determinism in seconds instead of half an hour. The engine-backed
 * league-health run lives outside the glob: `npm run gm:acceptance`
 * (docs/FRANCHISE.md §12 explains the two tiers).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '@hoopsh/engine';
import {
  advanceDay, capSheet, createLeague, generatePersona, streamRng,
} from '../src/index.js';
import type { GameJob, GameJobResult, League } from '../src/types.js';

/** Deterministic plausible result from the job seed alone. */
function fakeSim(jobs: GameJob[]): GameJobResult[] {
  return jobs.map(job => {
    const rng = new Rng(`fake:${job.seed}`);
    let hs = 95 + rng.int(35);
    let as = 95 + rng.int(35);
    if (hs === as) hs += 1; // the engine never ties; neither does the fake
    const mkLines = (team: GameJob['home'], teamPts: number, side: 0 | 1) => {
      // eight-man fake rotation; points split by a declining share so the
      // season rows look like basketball instead of noise
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

function aiLeague(seed: string): League {
  const league = createLeague({ seed, userTeam: 'nye' });
  // every chair AI-run: the machinery walk has no human in it
  league.teams.nye!.gm = generatePersona(streamRng(seed, 'genesis', 'user-gm'));
  return league;
}

describe('autosim machinery (fake game sim)', () => {
  it('runs two full league years end to end', { timeout: 240_000 }, async () => {
    const league = aiLeague('autosim-gate');
    const start = league.season;
    let guard = 0;
    while (league.season < start + 2 && guard++ < 900) {
      await advanceDay(league, fakeSim);
    }
    expect(league.season).toBe(start + 2);

    // both seasons archived with a champion and full standings
    const archives = league.archives.filter(a => a.season >= start);
    expect(archives.length).toBe(2);
    for (const a of archives) {
      expect(Boolean(a.champion)).toBe(true);
      expect(a.finalStandings.length).toBe(30);
      const games = a.finalStandings.map(s => s.w + s.l);
      for (const g of games) expect(g).toBe(82);
      expect(a.awards.some(x => x.kind === 'mvp')).toBe(true);
      expect(a.lottery.order.length).toBe(30);
      expect(a.draftClass.length).toBeGreaterThanOrEqual(55); // 60 picks minus passed/edge cases
    }

    // the draft put rookies in the league (rosters or the G-League;
    // second-rounders getting squeezed out by veterans is the real shape)
    const rookies = Object.values(league.players).filter(p =>
      p.draft?.season === start + 1 && (p.status === 'roster' || p.status === 'gleague'));
    expect(rookies.length).toBeGreaterThan(18);

    // free agency moved the market in July of the first offseason
    const julySignings = league.transactions.filter(tx => tx.kind === 'signing' && tx.date.season === start);
    expect(julySignings.length).toBeGreaterThan(20);

    // development wrote legible arcs and aging happened
    const withDev = Object.values(league.players).filter(p => p.devLog.length > 0);
    expect(withDev.length).toBeGreaterThan(200);

    // somebody hung them up across two offseasons (hazard is real but small)
    const retirements = league.transactions.filter(tx => tx.kind === 'retirement');
    expect(retirements.length).toBeGreaterThanOrEqual(1);

    // the economy stayed arithmetically sane on every team
    for (const teamId of Object.keys(league.teams)) {
      const sheet = capSheet(league, teamId);
      expect(Number.isFinite(sheet.total)).toBe(true);
      expect(sheet.total).toBeGreaterThanOrEqual(0);
    }

    // rating distribution did not run away in two years (drift gate)
    const proxies = Object.values(league.players)
      .filter(p => p.status === 'roster')
      .map(p => (p.attr.finishing + p.attr.three + p.attr.perimeterD + p.attr.decisions) / 4);
    const mean = proxies.reduce((s, x) => s + x, 0) / proxies.length;
    expect(mean).toBeGreaterThan(40);
    expect(mean).toBeLessThan(70);
  });

  it('replays deterministically from the seed', { timeout: 120_000 }, async () => {
    const a = aiLeague('autosim-det');
    const b = aiLeague('autosim-det');
    for (let i = 0; i < 45; i++) {
      await advanceDay(a, fakeSim);
      await advanceDay(b, fakeSim);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
