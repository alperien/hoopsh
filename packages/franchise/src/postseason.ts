/**
 * postseason.ts — play-in, playoff bracket, series scheduling, lottery.
 *
 * State model: league.playin holds scheduled play-in games,
 * league.playoffs holds PlayoffSeries; results arrive in league.results
 * like any other game. advancePostseason() is idempotent: it recomputes
 * series win counts from stored results every call, sets winners, and
 * schedules exactly the games that are due. The spine infers phase
 * completion (advancePostseason returned nothing new and every scheduled
 * game has a result).
 */
import type { Rng } from '@hoopsh/engine';
import type {
  GameId, League, LotteryResult, PlayoffSeries, ScheduledGame, SeriesId, TeamId,
} from './types.js';
import { conferenceSeeds } from './standings.js';

/** 2-2-1-1-1 (REAL): games 1,2,5,7 in the higher seed's building. */
const HIGH_HOME_GAMES = new Set([1, 2, 5, 7]);

function playinId(league: League, day: number, home: TeamId, away: TeamId): ScheduledGame {
  return {
    id: `s${league.season}-d${day}-${away}@${home}`,
    date: { season: league.season, day },
    type: 'playin',
    home, away,
  };
}

function lastRegularDay(league: League): number {
  // The calendar marks it; fall back to the last scheduled regular game
  // (calendar and schedule always exist together after the spine's init).
  const mark = league.calendar.find(d => d.marks.includes('lastRegularDay'));
  if (mark) return mark.day;
  let max = 0;
  for (const g of league.schedule) if (g.type === 'regular' && g.date.day > max) max = g.date.day;
  return max;
}

/**
 * Build the four opening play-in games (REAL format: 7v8 winner takes the
 * 7 seed; 9v10 loser is done; 7v8 loser hosts the 9v10 winner for the 8).
 * The two deciders are created by advancePostseason when these resolve.
 */
export function buildPlayin(league: League): ScheduledGame[] {
  const day0 = lastRegularDay(league) + 2; // one travel/rest day after the finale (FEEL)
  const games: ScheduledGame[] = [];
  for (const conf of ['East', 'West'] as const) {
    const seeds = conferenceSeeds(league, conf);
    const [s7, s8, s9, s10] = [seeds[6]!, seeds[7]!, seeds[8]!, seeds[9]!];
    games.push(playinId(league, day0, s7, s8));      // 7 hosts 8
    games.push(playinId(league, day0 + 1, s9, s10)); // 9 hosts 10
  }
  return games;
}

/** A finished game's winner, or null while unplayed. */
function winnerOf(league: League, gameId: GameId): TeamId | null {
  const r = league.results[gameId];
  if (!r) return null;
  const [hs, as] = r.final;
  return hs > as ? r.home : r.away;
}

function loserOf(league: League, gameId: GameId): TeamId | null {
  const r = league.results[gameId];
  if (!r) return null;
  const [hs, as] = r.final;
  return hs > as ? r.away : r.home;
}

/** The resolved 7 and 8 seeds of a conference once its play-in finished. */
function playinSeeds(league: League, conf: 'East' | 'West'): { seed7: TeamId; seed8: TeamId } | null {
  const seeds = conferenceSeeds(league, conf);
  const pair = new Set([seeds[6]!, seeds[7]!]);
  const confGames = league.playin.filter(g => pair.has(g.home) || pair.has(g.away));
  // opening game (7v8), then the decider is the game hosting its loser
  const g1 = confGames.find(g => pair.has(g.home) && pair.has(g.away));
  if (!g1) return null;
  const seed7 = winnerOf(league, g1.id);
  if (!seed7) return null;
  const decider = confGames.find(g => g !== g1 && (g.home === loserOf(league, g1.id)));
  if (!decider) return null;
  const seed8 = winnerOf(league, decider.id);
  if (!seed8) return null;
  return { seed7, seed8 };
}

function makeSeries(league: League, round: 1 | 2 | 3 | 4, conf: 'East' | 'West' | 'Finals', high: TeamId, low: TeamId, highSeed: number, lowSeed: number): PlayoffSeries {
  const id: SeriesId = `s${league.season}-r${round}-${high}v${low}`;
  return { id, round, conference: conf, high, low, highSeed, lowSeed, wins: [0, 0], games: [], winner: undefined };
}

/**
 * Build the first round once both conferences' play-ins resolved (1v8,
 * 2v7, 3v6, 4v5; the bracket never re-seeds after this).
 */
export function buildFirstRound(league: League): PlayoffSeries[] {
  const series: PlayoffSeries[] = [];
  for (const conf of ['East', 'West'] as const) {
    const seeds = conferenceSeeds(league, conf);
    const pi = playinSeeds(league, conf);
    if (!pi) throw new Error(`postseason: first round built before the ${conf} play-in resolved`);
    const order: TeamId[] = [seeds[0]!, seeds[1]!, seeds[2]!, seeds[3]!, seeds[4]!, seeds[5]!, pi.seed7, pi.seed8];
    series.push(makeSeries(league, 1, conf, order[0]!, order[7]!, 1, 8));
    series.push(makeSeries(league, 1, conf, order[3]!, order[4]!, 4, 5));
    series.push(makeSeries(league, 1, conf, order[1]!, order[6]!, 2, 7));
    series.push(makeSeries(league, 1, conf, order[2]!, order[5]!, 3, 6));
  }
  return series;
}

/** Regular-season strength for finals home court and high/low inside later rounds. */
function regularStrength(league: League, id: TeamId): number {
  const s = league.standings[id];
  if (!s) return 0;
  const g = s.w + s.l;
  const pct = g === 0 ? 0 : s.w / g;
  return pct * 1e6 + (s.ptsFor - s.ptsAgainst) / 1e3; // pct first, diff as the epsilon
}

/**
 * Advance the postseason after a day's results: recompute series wins,
 * set winners, schedule due games, open next rounds when a round clears.
 * Returns every newly scheduled game (the spine appends them to
 * league.schedule). Also creates the play-in deciders.
 */
export function advancePostseason(league: League): ScheduledGame[] {
  const out: ScheduledGame[] = [];

  // Play-in deciders: loser of 7v8 hosts winner of 9v10, one day after
  // the later opener (REAL: the play-in runs on consecutive nights).
  if (league.playin.length > 0) {
    for (const conf of ['East', 'West'] as const) {
      const seeds = conferenceSeeds(league, conf);
      const top = new Set([seeds[6]!, seeds[7]!]);
      const bottomPair = new Set([seeds[8]!, seeds[9]!]);
      const confGames = league.playin.filter(g =>
        [g.home, g.away].some(t => top.has(t) || bottomPair.has(t)));
      const g1 = confGames.find(g => top.has(g.home) && top.has(g.away));
      const g2 = confGames.find(g => bottomPair.has(g.home) && bottomPair.has(g.away));
      const hasDecider = confGames.some(g => g !== g1 && g !== g2);
      if (g1 && g2 && !hasDecider) {
        const host = loserOf(league, g1.id);
        const visitor = winnerOf(league, g2.id);
        if (host && visitor) {
          const day = Math.max(g1.date.day, g2.date.day) + 1;
          const decider = playinId(league, day, host, visitor);
          league.playin.push(decider);
          out.push(decider);
        }
      }
    }
  }

  if (league.playoffs.length === 0) return out;

  // Fold series wins idempotently from stored results.
  for (const s of league.playoffs) {
    let high = 0, low = 0;
    for (const gid of s.games) {
      const w = winnerOf(league, gid);
      if (w === s.high) high++;
      else if (w === s.low) low++;
    }
    s.wins = [high, low];
    if (!s.winner && (high === 4 || low === 4)) s.winner = high === 4 ? s.high : s.low;
  }

  // Schedule the next game of every live series whose games all resolved.
  for (const s of league.playoffs) {
    if (s.winner) continue;
    const allPlayed = s.games.every(g => league.results[g]);
    if (!allPlayed) continue;
    const n = s.games.length + 1; // next game number
    const home = HIGH_HOME_GAMES.has(n) ? s.high : s.low;
    const away = home === s.high ? s.low : s.high;
    const lastDay = s.games.length === 0
      ? undefined
      : Math.max(...s.games.map(g => league.results[g]!.date.day));
    const day = lastDay === undefined
      ? seriesOpenDay(league, s)
      : lastDay + 2; // one rest day inside a series (FEEL vs real 1-2)
    const game: ScheduledGame = {
      id: `s${league.season}-d${day}-${away}@${home}`,
      date: { season: league.season, day },
      type: 'playoffs',
      home, away,
      seriesId: s.id,
    };
    s.games.push(game.id);
    out.push(game);
  }

  // Open the next round when a round completes.
  const rounds = [1, 2, 3] as const;
  for (const r of rounds) {
    const cur = league.playoffs.filter(s => s.round === r);
    const nextExists = league.playoffs.some(s => s.round === r + 1);
    if (cur.length === 0 || nextExists) continue;
    if (!cur.every(s => s.winner)) continue;
    const latestEnd = Math.max(...cur.map(s => Math.max(...s.games.map(g => league.results[g]!.date.day))));
    const openDay = latestEnd + 3; // two rest days before a new round (FEEL)
    const next: PlayoffSeries[] = [];
    if (r < 3) {
      for (const conf of ['East', 'West'] as const) {
        const confSeries = cur.filter(s => s.conference === conf);
        // Bracket pairing holds: winner(1v8) meets winner(4v5), winner(2v7)
        // meets winner(3v6); rely on creation order from buildFirstRound.
        for (let i = 0; i + 1 < confSeries.length; i += 2) {
          const a = confSeries[i]!, b = confSeries[i + 1]!;
          const wa = a.winner!, wb = b.winner!;
          const aSeed = wa === a.high ? a.highSeed : a.lowSeed;
          const bSeed = wb === b.high ? b.highSeed : b.lowSeed;
          const [high, low, hs, ls] = aSeed <= bSeed ? [wa, wb, aSeed, bSeed] : [wb, wa, bSeed, aSeed];
          next.push(makeSeries(league, (r + 1) as 2 | 3, conf, high, low, hs, ls));
        }
      }
    } else {
      const east = cur.find(s => s.conference === 'East')!.winner!;
      const west = cur.find(s => s.conference === 'West')!.winner!;
      // Finals home court: better regular-season record (REAL).
      const [high, low] = regularStrength(league, east) >= regularStrength(league, west) ? [east, west] : [west, east];
      next.push(makeSeries(league, 4, 'Finals', high, low, 1, 2));
    }
    for (const s of next) {
      league.playoffs.push(s);
      const game: ScheduledGame = {
        id: `s${league.season}-d${openDay}-${s.low}@${s.high}`,
        date: { season: league.season, day: openDay },
        type: 'playoffs',
        home: s.high, away: s.low,
        seriesId: s.id,
      };
      s.games.push(game.id);
      out.push(game);
    }
  }

  return out;
}

/** Round-1 openers: staggered start two days after the play-in ends. */
function seriesOpenDay(league: League, s: PlayoffSeries): number {
  const playinEnd = league.playin.length > 0
    ? Math.max(...league.playin.map(g => g.date.day))
    : lastRegularDay(league) + 1;
  // Stagger by bracket slot so eight series do not all open the same
  // night (real round ones split across two days).
  const slot = league.playoffs.filter(x => x.round === s.round).indexOf(s);
  return playinEnd + 2 + (slot % 2);
}

/**
 * The draft lottery (REAL odds table: params.schedule.lotteryOdds is the
 * pick-1 probability for the 14 non-playoff teams, worst record first).
 * The top picks are drawn sequentially without replacement with
 * renormalization: the standard simulation of the real 1000-combination
 * drawing. Picks after the drawn slots follow inverse record. Round 2 is
 * pure inverse record across all 30 teams. Also resolves traded-pick
 * protections and stamps resolvedNumber on this season's picks.
 */
export function runLottery(league: League, rng: Rng): LotteryResult {
  const season = league.season;
  const playoffTeams = new Set(league.playoffs.filter(s => s.round === 1).flatMap(s => [s.high, s.low]));
  const all = Object.keys(league.teams);
  const nonPlayoff = all.filter(id => !playoffTeams.has(id));
  const byWorst = (a: TeamId, b: TeamId): number => {
    const sa = regularStrength(league, a), sb = regularStrength(league, b);
    return sa - sb || a.localeCompare(b);
  };
  nonPlayoff.sort(byWorst);
  if (nonPlayoff.length !== league.params.schedule.lotteryOdds.length) {
    throw new Error(`lottery: ${nonPlayoff.length} lottery teams, odds table wants ${league.params.schedule.lotteryOdds.length}`);
  }

  // Draw the top slots without replacement.
  const drawn: TeamId[] = [];
  const pool = nonPlayoff.map((id, i) => ({ id, odds: league.params.schedule.lotteryOdds[i]! }));
  for (let pick = 0; pick < league.params.schedule.lotteryReveals; pick++) {
    const weights = pool.map(p => p.odds);
    const idx = rng.weighted(weights);
    drawn.push(pool[idx]!.id);
    pool.splice(idx, 1);
  }
  // Remaining lottery teams by inverse record, then playoff teams by
  // inverse regular-season strength (REAL: champions pick last).
  const rest = nonPlayoff.filter(id => !drawn.includes(id));
  const playoffOrder = all.filter(id => playoffTeams.has(id)).sort(byWorst);
  const order = [...drawn, ...rest, ...playoffOrder];

  const movement = drawn
    .map((teamId, to) => ({ teamId, from: nonPlayoff.indexOf(teamId) + 1, to: to + 1 }))
    .filter(m => m.from !== m.to);

  // Resolve protections and stamp resolved numbers on season picks.
  const slotOf = new Map(order.map((id, i) => [id, i + 1]));
  for (const team of Object.values(league.teams)) {
    for (const pick of team.picks) {
      if (pick.season !== season) continue;
      const slot = pick.round === 1
        ? slotOf.get(pick.originalTeam)!
        : 30 + [...all].sort(byWorst).indexOf(pick.originalTeam) + 1;
      if (pick.round === 1 && pick.protection && pick.owner !== pick.originalTeam) {
        if (slot <= pick.protection.topN) {
          // Protected: the pick stays home this year. The obligation rolls
          // to next season with the same protection until throughSeason,
          // then extinguishes (register F12: no swaps, no 2nd-round
          // compensation in v1).
          const original = league.teams[pick.originalTeam]!;
          const owner = league.teams[pick.owner]!;
          owner.picks.splice(owner.picks.indexOf(pick), 1);
          if (pick.season + 1 <= pick.protection.throughSeason) {
            owner.picks.push({ ...pick, id: `${pick.season + 1}-r1-${pick.originalTeam}`, season: pick.season + 1 });
          }
          original.picks.push({ ...pick, owner: pick.originalTeam, protection: undefined, resolvedNumber: slot });
          continue;
        }
      }
      pick.resolvedNumber = slot;
    }
  }

  return { season, order, movement };
}
