/**
 * media/news.ts - the daily news desk. Reads what actually happened
 * (today's transactions, injuries, streaks, live negotiations) and writes
 * the paper trail. Recaps live in recap.ts; award races and the almanac
 * in their own modules.
 *
 * Prose law (docs/FRANCHISE.md §10): dry and factual, numbers only from
 * sim data, no exclamation marks, no em dashes, no fabricated quotes.
 * Rumors print only when there is fire: a real negotiation at warm or
 * hotter. Wire brief bodies deal from state-quoting pools with batch-scoped
 * repeat-avoidance (#189, BodyDealer below) so single-day batches (waiver
 * runs, retirement day, the draft) do not print walls of verbatim clones.
 * Three fixed bylines with different registers:
 *   Association Wire  - agency terse, carries transactions and recaps
 *   Sloane Keller     - the insider, carries rumors and breaking moves
 *   Ray Delgado       - the columnist, carries streaks and takes
 */
import { Rng } from '@hoopsh/engine';
import type { FrPlayer, League, NewsItem, Transaction } from '../types.js';
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

function cityName(league: League, id: string): string {
  return league.teams[id]?.city ?? id;
}

// How the wire names a position. scouting.ts and media/moments.ts keep
// their own private copies; media mirrors recap.ts's precedent of small
// local formatters (the moments.ts POS_NOUN comment states the convention).
const POS_NOUN: Record<FrPlayer['pos'], string> = {
  PG: 'guard', SG: 'guard', SF: 'wing', PF: 'forward', C: 'big',
};

/** Age at season start (types.ts: age is `season - bornSeason`). */
function ageOf(league: League, p: FrPlayer): number {
  return league.season - p.bornSeason;
}

/**
 * Batch-scoped anti-repeat for wire brief bodies (#189). Copies the
 * narration LineDealer's consumption law (narration/src/voice.ts): EXACTLY
 * one rng draw per deal, repeat-avoidance by index arithmetic, never a
 * re-draw. A variable draw count would shift every later draw on the day
 * stream and break the same-day second-pass replay that #118's id guard
 * relies on. Memory lives for one writeDailyNews pass only: clone walls
 * are a batch-day problem, and persisting memory would touch saved state.
 */
class BodyDealer {
  /** last two dealt slot indices per wire class */
  private recentByClass = new Map<string, number[]>();
  /** trailing dealt bodies across classes; window 30 is FEEL (voice.ts) */
  private recentBodies: string[] = [];

  deal(cls: string, pool: string[], rng: Rng): string {
    let idx = rng.int(pool.length); // the ONLY rng draw in a deal
    const recent = this.recentByClass.get(cls) ?? [];
    const avoid = Math.min(2, pool.length - 1);
    for (let hops = 0; hops < pool.length && avoid > 0 && recent.slice(-avoid).includes(idx); hops++) {
      idx = (idx + 1) % pool.length;
    }
    let body = pool[idx]!;
    // exact-body collision (identical facts on a batch day): bump within
    // the pool, still zero extra draws, until fresh or options exhausted.
    for (let hops = 0; hops < pool.length - 1 && this.recentBodies.includes(body); hops++) {
      idx = (idx + 1) % pool.length;
      body = pool[idx]!;
    }
    recent.push(idx);
    if (recent.length > 2) recent.shift();
    this.recentByClass.set(cls, recent);
    this.recentBodies.push(body);
    if (this.recentBodies.length > 30) this.recentBodies.shift();
    return body;
  }
}

/** One transaction, one story. Returns null for wire noise below notice. */
function transactionStory(league: League, tx: Transaction, rng: Rng, seq: number, draftedToday: ReadonlySet<string>, dealer: BodyDealer): NewsItem | null {
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
      // a pick's rookie deal signs inside the selection: the draft story
      // carries the contract line, so its signing row is mechanism, not
      // news (#118). Skipped before any rng draw so repeated same-day
      // passes replay identical headline draws.
      if (draftedToday.has(tx.playerId)) return null;
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
      // draw order is part of the day stream's contract: headline first
      // (as before #189), then exactly one body deal.
      const headline = headlines[rng.int(headlines.length)]!;
      const p = league.players[tx.playerId];
      const yr = years === 1 ? 'year' : 'years';
      const tail = tx.offerSheet ? ', signed as an offer sheet' : '';
      // body pool (#189): slot 0 is the pre-pool body; every added variant
      // quotes real terms or the player's actual situation, never filler.
      const bodies = [
        `The deal runs ${years} ${yr} for ${money(total)}${tail}.`,
      ];
      if (p) {
        const played = new Set(p.seasons.map(r => r.season)).size;
        bodies.push(`${name} gets ${money(total)} ${years === 1 ? 'for the season' : `over ${years} years`}${tail}.`);
        bodies.push(years === 1
          ? `A one-year deal worth ${money(total)}${tail}.`
          : `The contract averages ${money(Math.round(total / years))} a season through ${tx.contract.years[years - 1]!.season}${tail}.`);
        bodies.push(played > 0
          ? `The ${ageOf(league, p)}-year-old ${POS_NOUN[p.pos]} signs for ${years} ${yr} at ${money(total)}${tail}.`
          : `His first league contract pays ${money(total)} ${years === 1 ? 'for the year' : `over ${years} years`}${tail}.`);
      }
      return {
        ...base, type: 'transactionWire',
        headline,
        body: dealer.deal('signing', bodies, rng),
        byline: big ? INSIDER : WIRE,
        players: [tx.playerId], teams: [tx.teamId],
        weight: big ? 3 : 1,
      };
    }
    case 'waive': {
      const p = league.players[tx.playerId];
      const team = teamName(league, tx.teamId);
      // body pool (#189): slot 0 is the pre-pool body; variants quote the
      // player's actual situation (age, tenure with the waiving team).
      const bodies = tx.stretched
        ? [`The remaining guarantee is stretched across future seasons.`]
        : [`He clears to free agency immediately.`];
      if (p && tx.stretched) {
        bodies.push(`${p.name}'s remaining guarantee is stretched across future seasons.`);
        bodies.push(`${team} spread the remaining guarantee over future seasons.`);
      } else if (p) {
        const gpTeam = p.seasons.filter(r => r.teamId === tx.teamId).reduce((s, r) => s + r.gp, 0);
        bodies.push(`The ${ageOf(league, p)}-year-old ${POS_NOUN[p.pos]} clears to free agency.`);
        bodies.push(gpTeam > 0
          ? `He hits free agency after ${gpTeam} ${gpTeam === 1 ? 'game' : 'games'} with ${team}.`
          : `He clears without appearing in a game for ${team}.`);
        bodies.push(`The move opens a roster spot in ${cityName(league, tx.teamId)}.`);
      }
      return {
        ...base, type: 'transactionWire',
        headline: `${team} waive ${playerName(league, tx.playerId)}`,
        body: dealer.deal(tx.stretched ? 'waive.stretch' : 'waive.clear', bodies, rng),
        byline: WIRE, players: [tx.playerId], teams: [tx.teamId], weight: 1,
      };
    }
    case 'retirement': {
      const p = league.players[tx.playerId];
      const seasons = p ? new Set(p.seasons.map(r => r.season)).size : 0;
      const reg = p ? p.seasons.filter(r => r.type === 'regular') : [];
      const pts = reg.reduce((s, r) => s + r.pts, 0);
      // body pools (#189): every variant contains "retires" (the newsdesk
      // suite asserts it) and quotes the career the sim actually recorded.
      const bodies: string[] = [];
      if (seasons > 0 && p) {
        const s = seasons === 1 ? 'season' : 'seasons';
        const gp = reg.reduce((sum, r) => sum + r.gp, 0);
        const clubs = new Set(p.seasons.map(r => r.teamId));
        bodies.push(`He retires after ${seasons} ${s} and ${pts.toLocaleString('en-US')} career points.`);
        bodies.push(`He retires with ${pts.toLocaleString('en-US')} points in ${gp.toLocaleString('en-US')} regular-season games.`);
        bodies.push(clubs.size === 1
          ? `He retires after ${seasons} ${s}, all with ${teamName(league, [...clubs][0]!)}.`
          : `He retires after ${seasons} ${s} across ${clubs.size} teams.`);
      } else {
        bodies.push(`He retires without appearing in a league game.`);
        if (p) {
          const d = p.draft;
          bodies.push(`He retires at ${ageOf(league, p)} without a league appearance.`);
          bodies.push(d && d.round === 1
            ? `Drafted ${ordinal(d.pick)} overall in ${d.season}, he retires without playing a league game.`
            : d && d.round === 2
              ? `A round-2 pick in ${d.season}, he retires without playing a league game.`
              : `Undrafted out of ${p.originDetail}, he retires without playing a league game.`);
        }
      }
      return {
        ...base, type: 'retirement',
        headline: `${playerName(league, tx.playerId)} calls it a career`,
        body: dealer.deal(seasons > 0 ? 'retire.vet' : 'retire.zero', bodies, rng),
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
      // draft night gets one story per first-round pick; round 2 is wire.
      // Every body variant carries the contract line: the pick's signing
      // row stays off the wire (#118), so the draft story IS the record.
      const name = playerName(league, tx.playerId);
      const team = teamName(league, tx.teamId);
      const p = league.players[tx.playerId];
      if (tx.round === 2) {
        const bodies = [`${name} signs a two-year deal.`];
        if (p) {
          bodies.push(`The ${p.originDetail} ${POS_NOUN[p.pos]} signs a two-year deal.`);
          bodies.push(`${name}, ${ageOf(league, p)}, signs a two-year deal.`);
        }
        return {
          ...base, type: 'draft',
          headline: `${team} take ${name} at pick ${tx.pick} of round 2`,
          body: dealer.deal('draft.r2', bodies, rng),
          byline: WIRE, players: [tx.playerId], teams: [tx.teamId], weight: 1,
        };
      }
      const bodies = [`${name} goes ${ordinal(tx.pick)} overall and signs his rookie-scale contract.`];
      if (p) {
        bodies.push(`The ${p.originDetail} ${POS_NOUN[p.pos]} goes ${ordinal(tx.pick)} overall and signs his rookie-scale contract.`);
        bodies.push(`${cityName(league, tx.teamId)} add a ${ageOf(league, p)}-year-old ${POS_NOUN[p.pos]}. His rookie-scale contract is signed the same night.`);
      }
      return {
        ...base, type: 'draft',
        headline: `${team} select ${name} with pick ${tx.pick}`,
        body: dealer.deal('draft.r1', bodies, rng),
        byline: WIRE, players: [tx.playerId], teams: [tx.teamId],
        weight: tx.pick <= 5 ? 3 : 2,
      };
    }
    default:
      return null; // option decisions, claims, assignments: ledger only
  }
}

export function ordinal(n: number): string {
  const rem10 = n % 10, rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/**
 * The day's non-recap stories. Ids are deterministic per (day, source
 * position), so the spine may run a second same-day pass after late
 * transactions (draft night's picks, the rollover's retirements: #118).
 * appendNews's id guard drops the repeats; only new stories land.
 */
export function writeDailyNews(league: League): NewsItem[] {
  const out: NewsItem[] = [];
  const today = { season: league.season, day: league.day };
  const rng = new Rng(`${league.seed}:news:${league.season}:${league.day}`);

  // transactions dated today. Players drafted today are collected first:
  // their rookie-deal signing rows are the pick's mechanism and stay off
  // the wire (the draft story carries the contract line, #118).
  const draftedToday = new Set<string>();
  for (const tx of league.transactions) {
    if (tx.kind === 'draftSelection' && tx.date.season === today.season && tx.date.day === today.day) {
      draftedToday.add(tx.playerId);
    }
  }
  // one dealer per pass: its memory evolves in transaction order, so a
  // same-day second pass (#118) replays the prefix identically before the
  // id guard drops the repeats.
  const dealer = new BodyDealer();
  let seq = 0;
  for (const tx of league.transactions) {
    if (tx.date.season !== today.season || tx.date.day !== today.day) continue;
    const story = transactionStory(league, tx, rng, seq++, draftedToday, dealer);
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
