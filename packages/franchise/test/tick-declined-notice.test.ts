/**
 * The trade desk's walk-away notice (#253): proposeTrade pushes a
 * `declined-` notice when the AI front office ends talks. Deadline-less,
 * that notice rode to season rollover — the "spam on a delay" class the
 * #187 sweep doctrine retired in the inbox generators: a day-of notice
 * carries deadline: today, lives the day it posted, and the morning
 * sweep retires it the next day on the strict compare.
 *
 * Both pins drive the real path: applyUserAction lodges the offer, the
 * untouchable rule produces the deterministic walk-away (ai/trade.ts —
 * talks end before any valuation math), advanceDay runs the sweep at
 * the public seam.
 *
 * COMPUTE BUDGET: zero engine games. The fixture schedule is empty and
 * both advanced days are quiet (no calendar marks).
 */
import { describe, expect, it } from 'vitest';
import type { League, TeamId } from '../src/types.js';
import { buildSeasonCalendar, phaseOn } from '../src/calendar.js';
import { simulateJobsInline } from '../src/gameday.js';
import { advanceDay, applyUserAction } from '../src/tick.js';
import { fixtureLeague } from './fixture.js';

/**
 * A fixture league parked on a quiet regular-season day whose FOLLOWING
 * day is also quiet: the sweep pin advances twice, and a ritual mark on
 * either day would put unrelated motion in the day it reads.
 */
function leagueOnQuietPair(): League {
  const league = fixtureLeague();
  league.calendar = buildSeasonCalendar(league.params, league.season);
  const cal = league.calendar;
  const quiet = (d: number): boolean =>
    phaseOn(cal, d) === 'regular' && (cal[d]!.marks as string[]).length === 0;
  for (let d = 0; d + 1 < cal.length; d++) {
    if (quiet(d) && quiet(d + 1)) {
      league.day = d;
      league.phase = 'regular';
      return league;
    }
  }
  throw new Error('no quiet regular-day pair in the fixture calendar');
}

/**
 * Lodge a user offer the AI receiver walks away from, deterministically:
 * asking for an untouchable ends talks immediately, so the verdict
 * carries no counter and the walk-away branch posts the `declined-`
 * notice. Returns the receiver so pins can key the notice id.
 */
function proposeDeclinedTrade(league: League): TeamId {
  const receiver = (Object.keys(league.teams) as TeamId[]).find(
    (tid) => tid !== league.userTeam,
  )!;
  const wanted = league.teams[receiver]!.roster[0]!;
  const offered = league.teams[league.userTeam]!.roster[0]!;
  league.teams[receiver]!.strategy.untouchables = [wanted];
  const res = applyUserAction(league, {
    kind: 'proposeTrade',
    offer: {
      from: league.userTeam,
      to: receiver,
      give: { players: [offered], picks: [] },
      get: { players: [wanted], picks: [] },
    },
  });
  expect(res.ok).toBe(true); // a walk-away is still an answer
  return receiver;
}

describe('the declined- walk-away notice retires on the sweep (#253)', () => {
  it('carries deadline: today at the push site, the day-of shape (#187)', () => {
    const league = leagueOnQuietPair();
    const receiver = proposeDeclinedTrade(league);
    const item = league.inbox.find(
      (i) => i.id === `declined-${league.season}-${league.day}-${receiver}`,
    );
    expect(item).toBeDefined();
    expect(item!.kind).toBe('notice');
    // on the defective base the notice carries no deadline at all
    expect(item!.deadline).toEqual({ season: league.season, day: league.day });
  });

  it('lives its posting day and retires the next morning, not at rollover', async () => {
    const league = leagueOnQuietPair();
    const receiver = proposeDeclinedTrade(league);
    const id = `declined-${league.season}-${league.day}-${receiver}`;

    // the posting day runs in full, its own morning sweep included: the
    // strict compare keeps the notice alive to be read at the day's stop
    await advanceDay(league, simulateJobsInline);
    const posted = league.inbox.find((i) => i.id === id);
    expect(posted).toBeDefined();
    expect(posted!.resolved).toBe(false);

    // next morning's sweep retires it; on the defective base it stays
    // unresolved until season rollover
    await advanceDay(league, simulateJobsInline);
    expect(league.inbox.find((i) => i.id === id)!.resolved).toBe(true);
  });
});
