/**
 * GM desk tests (#152): the inbox generation side. The stop machinery
 * (app server) was always live; these pin that the franchise layer now
 * FEEDS it. Three properties matter most and each gets a direct pin:
 * the deadline ritual fires, relevance filters keep quiet things quiet,
 * and generation is deterministic and rng-free (same state, same items;
 * persona chairs see nothing, so acceptance identity holds).
 *
 * COMPUTE BUDGET: zero engine games. Every advanceDay here runs on an
 * empty schedule (a throwing SimulateJobs proves it); everything else
 * calls the pure generators directly on hand-built state.
 */
import { describe, expect, it } from 'vitest';
import type {
  Contract, GmPersona, InboxItem, League, PlayerId, SimulateJobs,
} from '../src/types.js';
import { buildSeasonCalendar, optionDecisionDay } from '../src/calendar.js';
import { expireInboxDeadlines, generateGmInbox } from '../src/inbox.js';
import { advanceDay, applyUserAction } from '../src/tick.js';
import { aiTradePulse, respondToOffer } from '../src/ai/trade.js';
import { fixtureLeague } from './fixture.js';

const USER = 'nye';
const AI_A = 'bka';
const AI_B = 'bos';

/** No games are scheduled in these leagues; the seam must never be hit. */
const noGames: SimulateJobs = () => {
  throw new Error('inbox tests schedule no games');
};

// Every fixture shares default params; the deadline index is a file-wide
// constant so day arithmetic reads plainly in the tests below.
const DEADLINE = fixtureLeague({ teams: 4 }).params.calendar.tradeDeadlineDayIndex;

/** Fixture league with a real calendar, parked on a chosen day/phase. */
function calendarLeague(day: number, phase: League['phase']): League {
  const league = fixtureLeague({ teams: 6 });
  league.calendar = buildSeasonCalendar(league.params, league.season);
  league.day = day;
  league.phase = phase;
  return league;
}

/** Replace the contract with per-season salaries starting this season. */
function setContract(league: League, pid: PlayerId, salaries: number[]): void {
  const c = league.players[pid]!.contract!;
  c.years = salaries.map((salary, i) => ({ season: league.season + i, salary, guaranteed: salary }));
}

function setAge(league: League, pid: PlayerId, age: number): void {
  league.players[pid]!.bornSeason = league.season - age;
}

/** Set every attribute flat so valuation ranks players exactly as told. */
function flatAttr(league: League, pid: PlayerId, x: number): void {
  const attr = league.players[pid]!.attr as unknown as Record<string, number>;
  for (const key of Object.keys(attr)) attr[key] = x;
}

const persona: GmPersona = {
  name: 'Autopilot', timeline: 'retool', risk: 50, pickLove: 50, starChase: 50, patience: 50,
};

/** Ids of items the desk generated (every desk id is deterministic). */
function ids(items: InboxItem[]): string[] {
  return items.map((i) => i.id);
}

// ------------------------------------------------------------ generation

describe('generateGmInbox: the deadline ritual', () => {
  it('briefs once when deadline season opens, with the expiring books', () => {
    const league = calendarLeague(DEADLINE - 10, 'regular');
    const rental = league.teams[USER]!.roster[0]!;
    setAge(league, rental, 30);
    setContract(league, rental, [12_000_000]); // expiring
    const items = generateGmInbox(league);
    const brief = items.find((i) => i.id === `deadline-window-s${league.season}`);
    expect(brief).toBeDefined();
    expect(brief!.kind).toBe('notice');
    expect(brief!.body).toContain(league.players[rental]!.name);
    // once per season: a second pass with the item on the record stays quiet
    league.inbox.push(brief!);
    expect(ids(generateGmInbox(league))).not.toContain(brief!.id);
  });

  it('posts the deadline call on the eve, so the stop it creates lands with the desk open (#186)', () => {
    const eve = calendarLeague(DEADLINE - 1, 'regular');
    const items = generateGmInbox(eve);
    const call = items.find((i) => i.id === `deadline-day-s${eve.season}`);
    expect(call).toBeDefined();
    expect(call!.kind).toBe('decision');
    expect(call!.choices!.length).toBeGreaterThan(0);
    // deadline = the post date: the sweep retires an ignored call during
    // deadline day's own tick, so the loop cannot re-stop at deadline+1
    expect(call!.deadline).toEqual({ season: eve.season, day: DEADLINE - 1 });
    // the eve belongs to the call alone; the window brief stays quiet
    expect(ids(items)).not.toContain(`deadline-window-s${eve.season}`);
    // deadline day itself posts nothing: its tick ends past the freeze,
    // and a stop past the freeze is the #186 pathology
    const day = calendarLeague(DEADLINE, 'regular');
    expect(ids(generateGmInbox(day))).not.toContain(`deadline-day-s${day.season}`);
  });

  it('frames deadline day from the trade desk truth: a contender sees the sellers\' best rental', () => {
    const league = calendarLeague(DEADLINE - 1, 'regular');
    league.teams[USER]!.strategy.timeline = 'contend';
    league.teams[AI_A]!.strategy.timeline = 'rebuild';
    const rental = league.teams[AI_A]!.roster[0]!;
    flatAttr(league, rental, 80);
    setAge(league, rental, 30);
    setContract(league, rental, [20_000_000]); // the classic deadline rental
    const call = generateGmInbox(league).find((i) => i.id === `deadline-day-s${league.season}`)!;
    expect(call.body).toContain(league.players[rental]!.name);
    expect(call.body).toContain(league.teams[AI_A]!.city);
  });

  it('wraps the morning after only when deals touched the user\'s world', () => {
    const windowDay = DEADLINE - 3;
    const mk = (): League => {
      const league = calendarLeague(DEADLINE + 1, 'regular');
      // park the traders in another division so rivalry alone cannot fire it
      league.teams[AI_A]!.division = 'Elsewhere';
      league.teams[AI_B]!.division = 'Elsewhere';
      const moved = league.teams[AI_A]!.roster[0]!;
      league.transactions.push({
        kind: 'trade', date: { season: league.season, day: windowDay },
        teams: [AI_A, AI_B],
        players: [{ playerId: moved, from: AI_A, to: AI_B }],
        picks: [],
      });
      return league;
    };
    // irrelevant deal: silence (the news desk owns quiet deadlines)
    const quiet = mk();
    expect(ids(generateGmInbox(quiet))).not.toContain(`deadline-wrap-s${quiet.season}`);
    // the same deal with the player under the user's scouts: a wrap
    const watched = mk();
    const moved = watched.transactions.find((t) => t.kind === 'trade')!;
    const pid = moved.kind === 'trade' ? moved.players[0]!.playerId : '';
    watched.scouting[pid] = {
      playerId: pid,
      current: { phys: [0, 100], scoring: [0, 100], playmaking: [0, 100], defense: [0, 100], rebounding: [0, 100], mental: [0, 100] },
      ceiling: { phys: [0, 100], scoring: [0, 100], playmaking: [0, 100], defense: [0, 100], rebounding: [0, 100], mental: [0, 100] },
      coverage: 25, role: '', comparison: '', strengths: [], flags: [],
      updatedOn: { season: watched.season, day: windowDay },
    };
    const wrap = generateGmInbox(watched).find((i) => i.id === `deadline-wrap-s${watched.season}`);
    expect(wrap).toBeDefined();
    expect(wrap!.body).toContain(watched.players[pid]!.name);
  });
});

describe('generateGmInbox: the rest of the desk', () => {
  it('lists option and tender business on option day', () => {
    const league = fixtureLeague({ teams: 4 });
    league.calendar = buildSeasonCalendar(league.params, league.season);
    league.day = optionDecisionDay(league.calendar, league.params);
    league.phase = 'moratorium';
    const optioned = league.teams[USER]!.roster[1]!;
    const c = league.players[optioned]!.contract!;
    c.years = [
      { season: league.season, salary: 8_000_000, guaranteed: 8_000_000 },
      { season: league.season + 1, salary: 9_000_000, guaranteed: 9_000_000, teamOption: true },
    ];
    const item = generateGmInbox(league).find((i) => i.id === `options-due-s${league.season}`);
    expect(item).toBeDefined();
    expect(item!.kind).toBe('notice');
    expect(item!.body).toContain(league.players[optioned]!.name);
    expect(item!.body).toContain('team option');
  });

  it('marks the opening of free agency with the user\'s own market exposure', () => {
    const league = fixtureLeague({ teams: 4 });
    league.calendar = buildSeasonCalendar(league.params, league.season);
    const morEnd = league.calendar.findIndex((d) => (d.marks as string[]).includes('moratoriumEnds'));
    league.day = morEnd + 1;
    league.phase = 'freeAgency';
    const fa = league.teams[USER]!.roster.pop()!;
    const p = league.players[fa]!;
    p.status = 'freeAgent';
    p.contract = null;
    p.rights = { teamId: USER, tier: 'bird', capHold: 9_000_000, restricted: false };
    league.freeAgents.push(fa);
    const item = generateGmInbox(league).find((i) => i.id === `fa-open-s${league.season}`);
    expect(item).toBeDefined();
    expect(item!.body).toContain(p.name);
  });

  it('flags a rotation hole when a user player goes down for more than a nick', () => {
    const league = calendarLeague(40, 'regular');
    const starter = league.teams[USER]!.rotation.starters[0]!;
    league.players[starter]!.health.injury = {
      kind: 'hamstring-strain', label: 'strained left hamstring', severity: 'moderate',
      startedOn: { season: league.season, day: league.day }, outDays: 14, remainingDays: 14,
    };
    const bench = league.teams[USER]!.roster[9]!;
    league.players[bench]!.health.injury = {
      kind: 'ankle-sprain', label: 'rolled ankle', severity: 'minor',
      startedOn: { season: league.season, day: league.day }, outDays: 3, remainingDays: 3,
    };
    const items = generateGmInbox(league);
    const hole = items.find((i) => i.id === `injury-s${league.season}d${league.day}-${starter}`);
    expect(hole).toBeDefined();
    expect(hole!.body).toContain('rotation needs an answer');
    // day-to-day knocks are noise: the desk stays quiet about the minor one
    expect(ids(items)).not.toContain(`injury-s${league.season}d${league.day}-${bench}`);
    // yesterday's injury does not re-fire today
    league.players[starter]!.health.injury!.startedOn.day -= 1;
    expect(ids(generateGmInbox(league)).some((id) => id.includes(starter))).toBe(false);
  });

  it('generates nothing for a persona-run chair: acceptance identity holds by construction', () => {
    // the eve: the day the desk would speak loudest for a human chair (#186)
    const league = calendarLeague(DEADLINE - 1, 'regular');
    league.teams[USER]!.gm = { ...persona };
    expect(generateGmInbox(league)).toEqual([]);
  });

  it('is a pure function of state: repeated calls return identical items', () => {
    const league = calendarLeague(DEADLINE - 1, 'regular');
    const a = generateGmInbox(league);
    const b = generateGmInbox(structuredClone(league));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- expiry

describe('expireInboxDeadlines', () => {
  it('retires only unresolved items whose deadline strictly passed', () => {
    const league = fixtureLeague({ teams: 4 });
    league.day = 50;
    const mk = (id: string, deadline?: { season: number; day: number }): InboxItem => ({
      id, date: { season: league.season, day: 40 }, kind: 'decision',
      title: id, body: id, choices: [{ id: 'x', label: 'x' }], resolved: false,
      ...(deadline ? { deadline } : {}),
    });
    league.inbox.push(
      mk('stale', { season: league.season, day: 49 }),
      mk('due-today', { season: league.season, day: 50 }),
      mk('open-ended'),
      mk('last-season', { season: league.season - 1, day: 300 }),
    );
    expireInboxDeadlines(league);
    const byId = Object.fromEntries(league.inbox.map((i) => [i.id, i.resolved]));
    expect(byId['stale']).toBe(true);       // strictly past: retired
    expect(byId['due-today']).toBe(false);  // still actionable today
    expect(byId['open-ended']).toBe(false); // no deadline: never swept
    expect(byId['last-season']).toBe(true); // season boundary counts as past
  });
});

// ----------------------------------------------------------- integration

describe('the wired day: advanceDay feeds the inbox', () => {
  it('the eve tick posts the call, the stop stands on deadline morning with a live desk, and ignoring costs exactly one stop (#186)', async () => {
    const league = calendarLeague(DEADLINE - 1, 'regular');
    const digest = await advanceDay(league, noGames);
    const id = `deadline-day-s${league.season}`;
    expect(digest.inboxIds).toContain(id); // the eve tick triggers the stop
    expect(league.day).toBe(DEADLINE); // the stop stands on deadline morning
    const item = league.inbox.find((i) => i.id === id)!;
    expect(item.resolved).toBe(false);
    // the desk is OPEN at the stop: a dump-shaped call gets a live verdict,
    // not the frozen one (#186's repro, through the real desk path). Probe
    // a clone so negotiation memory never touches the advancing league.
    const probe: Parameters<typeof respondToOffer>[1] = {
      from: USER, to: AI_A,
      give: { players: [league.teams[USER]!.roster[0]!], picks: [] },
      get: { players: [], picks: [] },
    };
    const live = respondToOffer(structuredClone(league), probe);
    expect(live.reasoning).not.toBe('the deadline has passed; call back in July');
    // the user ignores the stop; deadline day's own tick retires the call
    await advanceDay(league, noGames);
    expect(league.inbox.find((i) => i.id === id)!.resolved).toBe(true);
    // no open decision remains: the advance loop cannot re-stop at deadline+1
    expect(league.inbox.some((i) => !i.resolved && i.kind === 'decision')).toBe(false);
    // and the same call now meets the freeze: the boundary flipped with the tick
    const frozen = respondToOffer(structuredClone(league), probe);
    expect(frozen.reasoning).toBe('the deadline has passed; call back in July');
  });

  it('same seed, same items: cloned leagues advance to identical inboxes', async () => {
    const a = calendarLeague(DEADLINE - 1, 'regular');
    const b = structuredClone(a);
    for (let i = 0; i < 3; i++) {
      await advanceDay(a, noGames);
      await advanceDay(b, noGames);
    }
    expect(JSON.stringify(a.inbox)).toBe(JSON.stringify(b.inbox));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.inbox.some((i) => i.id === `deadline-day-s${a.season}`)).toBe(true);
  });

  it('a persona chair advances through deadline week with the desk dark', async () => {
    const league = calendarLeague(DEADLINE - 1, 'regular');
    league.teams[USER]!.gm = { ...persona };
    for (let i = 0; i < 3; i++) await advanceDay(league, noGames);
    expect(league.inbox.filter((i) => i.id.startsWith('deadline-')).length).toBe(0);
  });

  it('runs the offer sheet clock: item on filing day, resolution on every path', async () => {
    const mkSheetLeague = (): { league: League; rfa: PlayerId } => {
      const league = calendarLeague(0, 'freeAgency');
      // day 0 in freeAgency phase never happens on a real calendar; use the
      // real FA window so the market and calendar agree
      const morEnd = league.calendar.findIndex((d) => (d.marks as string[]).includes('moratoriumEnds'));
      league.day = morEnd + 2;
      const rfa = league.teams[USER]!.roster.pop()!;
      const p = league.players[rfa]!;
      p.status = 'freeAgent';
      p.contract = null;
      p.rights = { teamId: USER, tier: 'bird', capHold: 6_000_000, restricted: true, qualifyingOffer: 5_000_000 };
      league.freeAgents.push(rfa);
      const sheetContract: Contract = {
        id: `c-sheet-${rfa}`, playerId: rfa, teamId: AI_A,
        years: [
          { season: league.season, salary: 7_000_000, guaranteed: 7_000_000 },
          { season: league.season + 1, salary: 7_000_000, guaranteed: 7_000_000 },
        ],
        kind: 'standard', means: 'capSpace',
        signedOn: { season: league.season, day: league.day },
        birdYearsAtSigning: 0,
      };
      league.offerSheets.push({
        playerId: rfa, from: AI_A, contract: sheetContract,
        decideBy: { season: league.season, day: league.day + league.params.cba.offerSheetMatchDays },
      });
      return { league, rfa };
    };

    // path 1: silence declines; the clock retires with the sheet and the desk says who signed him
    const lapse = mkSheetLeague();
    const d1 = await advanceDay(lapse.league, noGames);
    const clockId = `sheet-clock-s${lapse.league.season}-${lapse.rfa}`;
    expect(d1.inboxIds).toContain(clockId);
    const clock = lapse.league.inbox.find((i) => i.id === clockId)!;
    expect(clock.kind).toBe('decision');
    expect(clock.deadline).toBeDefined();
    for (let i = 0; i < lapse.league.params.cba.offerSheetMatchDays + 1; i++) {
      await advanceDay(lapse.league, noGames);
    }
    expect(lapse.league.offerSheets.length).toBe(0);
    expect(lapse.league.teams[AI_A]!.roster).toContain(lapse.rfa); // signed away
    expect(lapse.league.inbox.find((i) => i.id === clockId)!.resolved).toBe(true);
    expect(lapse.league.inbox.some((i) => i.id.startsWith('sheet-result-') && i.body.includes('lapsed'))).toBe(true);

    // path 2: the user matches by hand; the clock dies the same moment
    const match = mkSheetLeague();
    await advanceDay(match.league, noGames);
    const result = applyUserAction(match.league, { kind: 'matchOfferSheet', playerId: match.rfa, matched: true });
    expect(result.ok).toBe(true);
    expect(match.league.teams[USER]!.roster).toContain(match.rfa); // matched: he stays
    expect(match.league.inbox.find((i) => i.id === `sheet-clock-s${match.league.season}-${match.rfa}`)!.resolved).toBe(true);
  });
});

// -------------------------------------------------- the trade offer clock

describe('aiTradePulse offers carry a deadline', () => {
  it('an in-window offer to the user stands exactly to the deadline', () => {
    const league = fixtureLeague({ teams: 6 });
    league.calendar = buildSeasonCalendar(league.params, league.season);
    league.phase = 'regular';
    league.day = league.params.calendar.tradeDeadlineDayIndex - 7;
    league.params.trade.deadlinePulse = 1; // force the pulse: this pins the item shape, not the dice
    league.teams[AI_A]!.strategy.timeline = 'contend';
    league.teams[AI_A]!.gm!.starChase = 70;
    for (let s = league.season + 1; s <= league.season + 7; s++) {
      league.teams[AI_A]!.picks.push({
        id: `${s}-r1-${AI_A}`, season: s, round: 1, originalTeam: AI_A, owner: AI_A,
      });
    }
    league.teams[USER]!.strategy.timeline = 'rebuild';
    const vet = league.teams[USER]!.roster[0]!;
    flatAttr(league, vet, 84);
    setAge(league, vet, 29);
    setContract(league, vet, [30_000_000]);
    aiTradePulse(league);
    const offer = league.inbox.find((i) => i.id.startsWith('trade-offer-'));
    expect(offer).toBeDefined();
    expect(offer!.deadline).toEqual({
      season: league.season,
      day: league.params.calendar.tradeDeadlineDayIndex,
    });
  });
});
