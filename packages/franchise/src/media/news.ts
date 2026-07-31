/**
 * media/news.ts - the daily news desk. Reads what actually happened
 * (today's transactions, injuries, streaks, live negotiations) and writes
 * the paper trail. Recaps live in recap.ts; award races and the almanac
 * in their own modules.
 *
 * Prose law (docs/FRANCHISE.md §10): dry and factual, numbers only from
 * sim data, no exclamation marks, no em dashes, no fabricated quotes.
 * Rumors print only when there is fire: a real negotiation at warm or
 * hotter. Three fixed bylines with different registers:
 *   Association Wire  - agency terse, carries transactions and recaps
 *   Sloane Keller     - the insider, carries rumors and breaking moves
 *   Ray Delgado       - the columnist, carries streaks and takes
 */
import { Rng } from '@hoopsh/engine';
import type { League, NewsItem, Transaction } from '../types.js';
import { WIRE } from './recap.js';
import { lifestyleNews } from '../people/psyche.js';

export const INSIDER = 'Sloane Keller';
export const COLUMNIST = 'Ray Delgado';

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

function playerName(league: League, id: string): string {
  return league.players[id]?.name ?? id;
}

function teamName(league: League, id: string): string {
  return league.teams[id]?.name ?? id;
}

/** One transaction, one story. Returns null for wire noise below notice. */
function transactionStory(league: League, tx: Transaction, rng: Rng, seq: number): NewsItem | null {
  const id = `n-s${league.season}d${league.day}-tx${seq}`;
  const base = { id, date: { season: league.season, day: league.day }, gameId: undefined };

  switch (tx.kind) {
    case 'trade': {
      const [a, b] = tx.teams;
      const aGets = tx.players.filter(p => p.to === a).map(p => playerName(league, p.playerId));
      const bGets = tx.players.filter(p => p.to === b).map(p => playerName(league, p.playerId));
      const aPicks = tx.picks.filter(p => p.to === a).length;
      const bPicks = tx.picks.filter(p => p.to === b).length;
      const pickTag = (n: number): string => (n === 0 ? '' : n === 1 ? ' and a pick' : ` and ${n} picks`);
      const centerpiece = [...aGets, ...bGets].sort((x, y) => x.localeCompare(y))[0] ?? 'players';
      const headlines = [
        `${teamName(league, a)} and ${teamName(league, b)} strike a deal`,
        `Trade: ${centerpiece} on the move`,
        `${teamName(league, a)} land ${aGets[0] ?? 'draft capital'} from ${teamName(league, b)}`,
      ];
      const body = `${teamName(league, a)} receive ${aGets.length ? aGets.join(', ') : 'no players'}${pickTag(aPicks)}. ` +
        `${teamName(league, b)} receive ${bGets.length ? bGets.join(', ') : 'no players'}${pickTag(bPicks)}.`;
      return {
        ...base, type: 'transactionWire',
        headline: headlines[rng.int(headlines.length)]!,
        body,
        byline: INSIDER,
        players: tx.players.map(p => p.playerId),
        teams: [a, b],
        weight: 3, // trades are always front-page in a basketball town
      };
    }
    case 'signing': {
      const years = tx.contract.years.length;
      const total = tx.contract.years.reduce((s, y) => s + y.salary, 0);
      const kind = tx.contract.kind;
      const name = playerName(league, tx.playerId);
      const team = teamName(league, tx.teamId);
      if (kind === 'twoWay' || kind === 'tenDay' || kind === 'restOfSeason') {
        return {
          ...base, type: 'transactionWire',
          headline: `${team} sign ${name}`,
          body: `${team} signed ${name} to a ${kind === 'twoWay' ? 'two-way contract' : kind === 'tenDay' ? '10-day contract' : 'rest-of-season deal'}.`,
          byline: WIRE, players: [tx.playerId], teams: [tx.teamId], weight: 1,
        };
      }
      const big = total >= 60_000_000;
      const headlines = big
        ? [`${name} agrees to ${years}-year, ${money(total)} deal with ${team}`,
           `${team} commit ${money(total)} to ${name}`]
        : [`${team} sign ${name}`,
           `${name} lands with ${team}`];
      return {
        ...base, type: 'transactionWire',
        headline: headlines[rng.int(headlines.length)]!,
        body: `The deal runs ${years} ${years === 1 ? 'year' : 'years'} for ${money(total)}${tx.offerSheet ? ', signed as an offer sheet' : ''}.`,
        byline: big ? INSIDER : WIRE,
        players: [tx.playerId], teams: [tx.teamId],
        weight: big ? 3 : 1,
      };
    }
    case 'waive': {
      return {
        ...base, type: 'transactionWire',
        headline: `${teamName(league, tx.teamId)} waive ${playerName(league, tx.playerId)}`,
        body: tx.stretched
          ? `The remaining guarantee is stretched across future seasons.`
          : `He clears to free agency immediately.`,
        byline: WIRE, players: [tx.playerId], teams: [tx.teamId], weight: 1,
      };
    }
    case 'retirement': {
      const p = league.players[tx.playerId];
      const seasons = p ? new Set(p.seasons.map(r => r.season)).size : 0;
      const pts = p ? p.seasons.filter(r => r.type === 'regular').reduce((s, r) => s + r.pts, 0) : 0;
      return {
        ...base, type: 'retirement',
        headline: `${playerName(league, tx.playerId)} calls it a career`,
        body: seasons > 0
          ? `He retires after ${seasons} ${seasons === 1 ? 'season' : 'seasons'} and ${pts.toLocaleString('en-US')} career points.`
          : `He retires without appearing in a league game.`,
        byline: COLUMNIST, players: [tx.playerId], teams: [], weight: 2,
      };
    }
    case 'coachChange': {
      return {
        ...base, type: tx.fired ? 'firing' : 'hiring',
        headline: tx.fired
          ? `${teamName(league, tx.teamId)} move on from their head coach`
          : `${teamName(league, tx.teamId)} hire ${tx.coach.name}`,
        body: tx.fired
          ? `${tx.coach.name} takes over on the bench.`
          : `${tx.coach.name} agreed to a ${tx.coach.contractSeasons}-year deal.`,
        byline: INSIDER, players: [], teams: [tx.teamId], weight: 2,
      };
    }
    case 'draftSelection': {
      // draft night gets one story per first-round pick; round 2 is wire
      const name = playerName(league, tx.playerId);
      const team = teamName(league, tx.teamId);
      if (tx.round === 2) {
        return {
          ...base, type: 'draft',
          headline: `${team} take ${name} at pick ${tx.pick} of round 2`,
          body: `${name} signs a two-year deal.`,
          byline: WIRE, players: [tx.playerId], teams: [tx.teamId], weight: 1,
        };
      }
      return {
        ...base, type: 'draft',
        headline: `${team} select ${name} with pick ${tx.pick}`,
        body: `${name} goes ${ordinal(tx.pick)} overall and signs his rookie-scale contract.`,
        byline: WIRE, players: [tx.playerId], teams: [tx.teamId],
        weight: tx.pick <= 5 ? 3 : 2,
      };
    }
    default:
      return null; // option decisions, claims, assignments: ledger only
  }
}

function ordinal(n: number): string {
  const rem10 = n % 10, rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/**
 * The day's non-recap stories. Idempotence: callers invoke once per day
 * (the spine's evening fold); ids are deterministic per (day, source).
 */
export function writeDailyNews(league: League): NewsItem[] {
  const out: NewsItem[] = [];
  const today = { season: league.season, day: league.day };
  const rng = new Rng(`${league.seed}:news:${league.season}:${league.day}`);

  // transactions dated today
  let seq = 0;
  for (const tx of league.transactions) {
    if (tx.date.season !== today.season || tx.date.day !== today.day) continue;
    const story = transactionStory(league, tx, rng, seq++);
    if (story) out.push(story);
  }

  // injuries that started today
  let inj = 0;
  for (const pid of Object.keys(league.players)) {
    const p = league.players[pid]!;
    const injury = p.health.injury;
    if (!injury || injury.startedOn.season !== today.season || injury.startedOn.day !== today.day) continue;
    const teamId = p.contract?.teamId;
    const weeks = Math.round(injury.outDays / 7);
    const timeline = injury.severity === 'seasonEnding'
      ? 'He is done for the season.'
      : injury.outDays <= 6
        ? `He is day-to-day.`
        : `The team expects him back in about ${weeks} ${weeks === 1 ? 'week' : 'weeks'}.`;
    out.push({
      id: `n-s${today.season}d${today.day}-inj${inj++}`,
      date: today, type: 'injury',
      headline: `${p.name} out with ${injury.label}`,
      body: `${teamId ? teamName(league, teamId) : 'His team'} announced the injury${injury.gameId ? ' after the game' : ''}. ${timeline}`,
      byline: WIRE,
      players: [pid], teams: teamId ? [teamId] : [],
      weight: injury.severity === 'seasonEnding' || injury.severity === 'major' ? 3 : injury.severity === 'moderate' ? 2 : 1,
    });
  }

  // streak stories at 6 and 10 (either direction), columnist voice
  let stk = 0;
  if (league.phase === 'regular') {
    for (const teamId of Object.keys(league.standings)) {
      const s = league.standings[teamId]!;
      if (s.streak === 6 || s.streak === 10) {
        out.push({
          id: `n-s${today.season}d${today.day}-stk${stk++}`,
          date: today, type: 'streak',
          headline: s.streak === 10
            ? `${teamName(league, teamId)} make it ten straight`
            : `${teamName(league, teamId)} are the league's hottest team`,
          body: `${teamName(league, teamId)} have won ${s.streak} in a row and sit ${s.w}-${s.l}.`,
          byline: COLUMNIST, players: [], teams: [teamId], weight: 2,
        });
      } else if (s.streak === -6 || s.streak === -10) {
        out.push({
          id: `n-s${today.season}d${today.day}-stk${stk++}`,
          date: today, type: 'streak',
          headline: `${teamName(league, teamId)} drop their ${ordinal(-s.streak)} straight`,
          body: `The skid has ${teamName(league, teamId)} at ${s.w}-${s.l}.`,
          byline: COLUMNIST, players: [], teams: [teamId], weight: 2,
        });
      }
    }
  }

  // rumors: only real negotiations at warm or hotter, refreshed today
  let rum = 0;
  for (const nego of league.negotiations) {
    if (nego.temperature === 'cold') continue;
    if (nego.lastDate.season !== today.season || nego.lastDate.day !== today.day) continue;
    const about = nego.about.map(pid => playerName(league, pid)).join(', ');
    const [a, b] = nego.teams;
    const hot = nego.temperature === 'hot';
    out.push({
      id: `n-s${today.season}d${today.day}-rum${rum++}`,
      date: today, type: 'rumor',
      headline: hot
        ? `Talks heating up around ${about}`
        : `${teamName(league, a)} and ${teamName(league, b)} have discussed ${about}`,
      body: hot
        ? `League sources say a deal involving ${about} has real momentum and could come together quickly.`
        : `The talks are described as preliminary. Nothing is close.`,
      byline: INSIDER,
      players: nego.about, teams: [a, b],
      weight: hot ? 2 : 1,
    });
  }

  // the rare lifestyle beat (people/psyche.ts): a few per season, weight 1
  out.push(...lifestyleNews(league));

  return out;
}
