/**
 * Schedule, standings, postseason, lottery — the season-structure suite.
 * Shared-build pattern: generate once, assert many (PLAYBOOK Recipe F).
 */
import { describe, expect, it } from 'vitest';
import { streamRng } from '../src/rng.js';
import { generateSchedule } from '../src/schedule.js';
import { applyResultToStandings, conferenceSeeds, emptyStanding } from '../src/standings.js';
import { advancePostseason, buildFirstRound, buildPlayin, runLottery } from '../src/postseason.js';
import type { GameRecord, League, ScheduledGame, TeamId } from '../src/types.js';
import { fixtureLeague } from './fixture.js';

function mkTotals(pts: number): GameRecord['totals'][0] {
  return { pts, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pace: 98, fastbreakPts: 0, biggestLead: 0 };
}

function feedResult(league: League, g: ScheduledGame, homeWins: boolean): void {
  const final: [number, number] = homeWins ? [110, 100] : [100, 110];
  league.results[g.id] = {
    id: g.id, date: g.date, type: g.type === 'preseason' ? 'regular' : g.type,
    home: g.home, away: g.away, seed: 'test',
    final, ot: 0, lines: [], totals: [mkTotals(final[0]), mkTotals(final[1])],
    keyPlays: [], seriesId: g.seriesId,
  } as GameRecord;
}

/** Standings ladder: team index i gets wins so seeds are predictable. */
function ladderStandings(league: League): void {
  const east = Object.values(league.teams).filter(t => t.conference === 'East').map(t => t.id).sort();
  const west = Object.values(league.teams).filter(t => t.conference === 'West').map(t => t.id).sort();
  for (const [ids] of [[east], [west]] as const) {
    ids.forEach((id, i) => {
      const s = emptyStanding(id);
      s.w = 60 - i * 3; // strict ladder, no ties
      s.l = 82 - s.w;
      s.ptsFor = 8000; s.ptsAgainst = 7500 - i * 10;
      league.standings[id] = s;
    });
  }
}

describe('schedule generator', () => {
  const league = fixtureLeague({ teams: 30 });
  const schedule = generateSchedule(league, league.season, streamRng(league.seed, 'schedule', league.season));

  it('is deterministic', () => {
    const again = generateSchedule(league, league.season, streamRng(league.seed, 'schedule', league.season));
    expect(JSON.stringify(again)).toBe(JSON.stringify(schedule));
  });

  it('produces 1230 games, 82 per team', () => {
    expect(schedule.length).toBe(1230);
    const counts = new Map<TeamId, number>();
    for (const g of schedule) {
      counts.set(g.home, (counts.get(g.home) ?? 0) + 1);
      counts.set(g.away, (counts.get(g.away) ?? 0) + 1);
    }
    expect(counts.size).toBe(30);
    for (const n of counts.values()) expect(n).toBe(82);
  });

  it('follows the 16/36/30 formula with 41 home games', () => {
    for (const teamId of ['nye', 'cas'] as const) {
      const me = league.teams[teamId]!;
      let division = 0, conf = 0, cross = 0, home = 0;
      for (const g of schedule) {
        if (g.home !== teamId && g.away !== teamId) continue;
        if (g.home === teamId) home++;
        const opp = league.teams[g.home === teamId ? g.away : g.home]!;
        if (opp.conference !== me.conference) cross++;
        else if (opp.division === me.division) division++;
        else conf++;
      }
      expect(division).toBe(16);
      expect(conf).toBe(36);
      expect(cross).toBe(30);
      expect(home).toBe(41);
    }
  });

  it('never plays a team on three straight days and caps back-to-backs', () => {
    const p = league.params.schedule;
    for (const t of Object.keys(league.teams)) {
      const days = schedule.filter(g => g.home === t || g.away === t).map(g => g.date.day).sort((a, b) => a - b);
      let b2b = 0;
      for (let i = 1; i < days.length; i++) {
        expect(days[i]).not.toBe(days[i - 1]); // one game per day
        if (days[i]! - days[i - 1]! === 1) b2b++;
        if (i >= 2) expect(days[i]! - days[i - 2]!).toBeGreaterThan(2);
      }
      expect(b2b).toBeLessThanOrEqual(p.b2bTarget + p.b2bTolerance);
    }
  });

  it('keeps the all-star break dark', () => {
    const start = league.params.calendar.allStarDayIndex;
    const inBreak = schedule.filter(g => g.date.day >= start && g.date.day < start + 4);
    expect(inBreak.length).toBe(0);
  });
});

describe('standings fold and seeding', () => {
  it('folds venue, conference, division splits and ignores playoffs', () => {
    const league = fixtureLeague({ teams: 30 });
    const [a, b] = ['nye', 'bka'] as const; // same division
    const g: ScheduledGame = { id: 's2026-d3-bka@nye', date: { season: 2026, day: 3 }, type: 'regular', home: a, away: b };
    feedResult(league, g, true);
    applyResultToStandings(league, league.results[g.id]!);
    expect(league.standings[a]!.w).toBe(1);
    expect(league.standings[a]!.homeW).toBe(1);
    expect(league.standings[a]!.divW).toBe(1);
    expect(league.standings[a]!.confW).toBe(1);
    expect(league.standings[b]!.l).toBe(1);
    expect(league.standings[b]!.streak).toBe(-1);
    const po: ScheduledGame = { id: 's2026-d9-bka@nye', date: { season: 2026, day: 9 }, type: 'playoffs', home: a, away: b };
    feedResult(league, po, true);
    applyResultToStandings(league, league.results[po.id]!);
    expect(league.standings[a]!.w).toBe(1); // unchanged: playoffs never count
  });

  it('breaks a win-pct tie by head-to-head', () => {
    const league = fixtureLeague({ teams: 30 });
    ladderStandings(league);
    const east = conferenceSeeds(league, 'East');
    // force a tie between seeds 2 and 3, then let 3 own the head-to-head
    const s2 = league.standings[east[1]!]!;
    const s3 = league.standings[east[2]!]!;
    s3.w = s2.w; s3.l = s2.l;
    const g: ScheduledGame = { id: 's2026-d40-x@y', date: { season: 2026, day: 40 }, type: 'regular', home: east[2]!, away: east[1]! };
    feedResult(league, g, true);
    const re = conferenceSeeds(league, 'East');
    expect(re.indexOf(east[2]!)).toBeLessThan(re.indexOf(east[1]!));
  });
});

describe('postseason machine', () => {
  const league = fixtureLeague({ teams: 30 });
  ladderStandings(league);
  league.phase = 'playin';
  league.playin = buildPlayin(league);
  const east = conferenceSeeds(league, 'East');
  const west = conferenceSeeds(league, 'West');

  it('opens the play-in with 7 hosting 8 and 9 hosting 10', () => {
    expect(league.playin.length).toBe(4);
    const e78 = league.playin.find(g => g.home === east[6] && g.away === east[7]);
    const e910 = league.playin.find(g => g.home === east[8] && g.away === east[9]);
    expect(e78).toBeTruthy();
    expect(e910).toBeTruthy();
  });

  it('creates the decider hosted by the 7v8 loser, then seeds the bracket', () => {
    // favorites win the openers in both conferences
    for (const g of league.playin) feedResult(league, g, true);
    const deciders = advancePostseason(league);
    expect(deciders.length).toBe(2);
    const eDecider = deciders.find(g => [g.home, g.away].includes(east[7]!))!;
    expect(eDecider.home).toBe(east[7]); // loser of 7v8 hosts
    expect(eDecider.away).toBe(east[8]); // winner of 9v10 visits
    for (const g of deciders) feedResult(league, g, true);
    league.playoffs = buildFirstRound(league);
    expect(league.playoffs.length).toBe(8);
    const e18 = league.playoffs.find(s => s.conference === 'East' && s.highSeed === 1)!;
    expect(e18.high).toBe(east[0]);
    expect(e18.low).toBe(east[7]); // the 8 seed came through the decider
  });

  it('walks the bracket to a champion with 2-2-1-1-1 home court', () => {
    let champion: TeamId | undefined;
    for (let step = 0; step < 300 && !champion; step++) {
      const games = advancePostseason(league);
      for (const g of games) {
        const series = league.playoffs.find(s => s.id === g.seriesId)!;
        feedResult(league, g, g.home === series.high); // the high seed always wins
      }
      champion = league.playoffs.find(s => s.round === 4)?.winner;
    }
    // both conference ladders are identical, so finals home court fell to
    // the tiebreak and the high side always won: the champion must be one
    // of the two conference tops.
    expect([east[0], west[0]]).toContain(champion);
    const anySeries = league.playoffs.find(s => s.round === 1 && s.wins[0] === 4)!;
    expect(anySeries.games.length).toBeGreaterThanOrEqual(4);
    // games 1 and 2 in the high seed's building
    const g1 = league.results[anySeries.games[0]!]!;
    const g2 = league.results[anySeries.games[1]!]!;
    const g3 = league.results[anySeries.games[2]!]!;
    expect(g1.home).toBe(anySeries.high);
    expect(g2.home).toBe(anySeries.high);
    expect(g3.home).toBe(anySeries.low);
  });

  it('runs a deterministic lottery with sane odds and rolls protections', () => {
    const r1 = runLottery(league, streamRng(league.seed, 'lottery', league.season));
    const r2 = runLottery(league, streamRng(league.seed, 'lottery', league.season));
    expect(JSON.stringify(r1.order)).toBe(JSON.stringify(r2.order));
    expect(r1.order.length).toBe(30);

    // odds sanity: worst team lands pick 1 at a rate near its 14% ticket
    const nonPlayoff = new Set(r1.order.slice(0, 14));
    const playoffTeams = new Set(league.playoffs.filter(s => s.round === 1).flatMap(s => [s.high, s.low]));
    const worst = Object.keys(league.teams)
      .filter(id => !playoffTeams.has(id))
      .sort((a, b) => (league.standings[a]!.w - league.standings[b]!.w) || a.localeCompare(b))[0]!;
    expect(nonPlayoff.has(worst)).toBeTruthy();
    let hits = 0;
    const draws = 400; // Monte Carlo width: se ~ 1.7pp at p=.14
    for (let i = 0; i < draws; i++) {
      const r = runLottery(league, streamRng(`mc-${i}`, 'lottery', league.season));
      if (r.order[0] === worst) hits++;
    }
    expect(hits / draws).toBeGreaterThan(0.09);
    expect(hits / draws).toBeLessThan(0.20);

    // protection: the worst team's pick, owed to another team top-10
    // protected, stays home and the obligation rolls one season
    const owner = r1.order[20]!;
    const worstTeam = league.teams[worst]!;
    const ownPick = worstTeam.picks.find(() => true);
    const pick = {
      id: `${league.season}-r1-${worst}`, season: league.season, round: 1 as const,
      originalTeam: worst, owner, protection: { topN: 10, throughSeason: league.season + 2 },
    };
    league.teams[owner]!.picks.push(pick);
    runLottery(league, streamRng(league.seed, 'lottery', league.season));
    const ownerHasIt = league.teams[owner]!.picks.some(pk => pk.originalTeam === worst && pk.season === league.season);
    const rolled = league.teams[owner]!.picks.some(pk => pk.originalTeam === worst && pk.season === league.season + 1);
    const homeHasIt = worstTeam.picks.some(pk => pk.originalTeam === worst && pk.season === league.season && pk.resolvedNumber !== undefined);
    expect(ownerHasIt).toBe(false);
    expect(rolled).toBe(true);
    expect(homeHasIt).toBe(true);
    expect(ownPick === undefined || true).toBeTruthy(); // fixture teams start with no picks; guard only
  });
});
