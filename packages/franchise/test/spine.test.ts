/**
 * Franchise spine tests: the season calendar, game-day projection, the
 * job/fold pipeline, one real simulated league day with determinism, and
 * the draft-night pause.
 *
 * COMPUTE BUDGET: engine games are the expensive part (~0.3-0.9 s each);
 * this file simulates exactly 4 (a 2-game day, run twice for the
 * determinism pair). Everything else is pure state or hand-built events.
 *
 * SIBLING REALITY (build wave): these tests run against whatever mix of
 * real modules and contracts-wave stubs the tree holds, so they only
 * exercise spine-owned behavior plus INERT-safe seams:
 *  - the simulated day uses playoffs-TYPE games, which accumulate stat rows
 *    through the identical pipeline but never call the standings fold
 *    (a throwing stub until the schedule task lands; the regular-day
 *    integration is covered by the post-merge autosim gates). "Standings
 *    touched" here asserts the spine's own row seeding.
 *  - the draft scenario stops at the PAUSE: the user picks first, so
 *    ai/draftai.aiSelect (a throwing stub until ai-team lands) is provably
 *    never reached. Full draft-night integration lands post-merge.
 *  - no assertion requires media/people output OR requires their absence
 *    (a league with media dark just produces no news).
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@hoopsh/engine';
import type { Injury, League, ScheduledGame } from '../src/types.js';
import { defaultFranchiseParams } from '../src/params.js';
import { buildSeasonCalendar, phaseOn } from '../src/calendar.js';
import { rollCapLines } from '../src/cba/cap.js';
import { extractKeyPlays, planDayJobs, projectTeam, simulateJobsInline } from '../src/gameday.js';
import { advanceDay, applyUserAction } from '../src/tick.js';
import { gameSeedFor } from '../src/rng.js';
import { fixtureLeague, fixturePlayer } from './fixture.js';

const PARAMS = defaultFranchiseParams();
const CAL = buildSeasonCalendar(PARAMS, 2026);
const markAt = (mark: string): number => CAL.findIndex((d) => (d.marks as string[]).includes(mark));

function minorInjury(day: number): Injury {
  return {
    kind: 'ankle-sprain', label: 'sprained left ankle', severity: 'minor',
    startedOn: { season: 2026, day }, outDays: 5, remainingDays: 5,
  };
}

/** A hand-dated result shell: enough for the projection's B2B/load reads. */
function resultShell(league: League, id: string, day: number, home: string, away: string): void {
  league.results[id] = {
    id, date: { season: league.season, day }, type: 'regular', home, away,
    seed: 'shell', final: [100, 90], ot: 0, lines: [], totals: [
      { pts: 100, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pace: 0, fastbreakPts: 0, biggestLead: 0 },
      { pts: 90, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pace: 0, fastbreakPts: 0, biggestLead: 0 },
    ], keyPlays: [],
  };
}

// ------------------------------------------------------- the simulated day
// Shared across tests so the four expensive sims run once per execution.

const teamIds = ['nye', 'bka', 'bos', 'phi']; // fixture order (FRANCHISES 0-3); nye is the user team
const GAME_DAY = 30;
function twoGameDay(): { league: League; games: ScheduledGame[] } {
  const league = fixtureLeague({ seed: 'spine-day' });
  league.calendar = buildSeasonCalendar(league.params, league.season);
  league.day = GAME_DAY;
  league.phase = 'regular';
  // playoffs-TYPE games: same result/row pipeline, no standings fold call
  // (see the file header's sibling-reality note)
  const games: ScheduledGame[] = [
    { id: `s2026-d${GAME_DAY}-bka@nye`, date: { season: 2026, day: GAME_DAY }, type: 'playoffs', home: 'nye', away: 'bka' },
    { id: `s2026-d${GAME_DAY}-phi@bos`, date: { season: 2026, day: GAME_DAY }, type: 'playoffs', home: 'bos', away: 'phi' },
  ];
  league.schedule = games;
  return { league, games };
}
const dayA = twoGameDay();
const dayB = { league: structuredClone(dayA.league) };
const digestA = await advanceDay(dayA.league, simulateJobsInline);
const digestB = await advanceDay(dayB.league, simulateJobsInline);

describe('calendar shape', () => {
  it('phases run camp -> regular -> playin -> playoffs -> lottery -> draft -> moratorium -> freeAgency', () => {
    const seen: string[] = [];
    for (const d of CAL) {
      if (seen.length === 0 || seen[seen.length - 1] !== d.phase) seen.push(d.phase);
    }
    expect(seen).toEqual(['camp', 'regular', 'playin', 'playoffs', 'lottery', 'draft', 'moratorium', 'freeAgency']);
  });

  it('every day self-indexes (day field equals array position)', () => {
    expect(CAL.every((d, i) => d.day === i)).toBe(true);
  });

  it('the opener carries the seasonOpener mark on the first regular day', () => {
    const opener = markAt('seasonOpener');
    expect(opener).toBe(PARAMS.calendar.campDays);
    expect(CAL[opener]!.phase).toBe('regular');
  });

  it('deadline and all-star marks sit at their params indexes inside the regular season', () => {
    expect(markAt('tradeDeadline')).toBe(PARAMS.calendar.tradeDeadlineDayIndex);
    expect(markAt('allStar')).toBe(PARAMS.calendar.allStarDayIndex);
    expect(CAL[markAt('allStar')]!.phase).toBe('regular');
  });

  it('lastRegularDay closes the 174-day window; ritual marks follow in order', () => {
    const lastRegular = markAt('lastRegularDay');
    expect(lastRegular).toBe(PARAMS.calendar.campDays + PARAMS.calendar.regularSeasonDays - 1);
    expect(phaseOn(CAL, lastRegular + 1)).toBe('playin');
    const lottery = markAt('lotteryNight');
    const draft = markAt('draftNight');
    const morEnd = markAt('moratoriumEnds');
    expect(lastRegular).toBeLessThan(lottery);
    expect(lottery).toBeLessThan(draft);
    expect(draft).toBeLessThan(morEnd);
    expect(morEnd).toBeLessThan(CAL.length - 1);
  });

  it('labels are real month-day strings (opener lands in late October)', () => {
    expect(CAL[markAt('seasonOpener')]!.label).toContain('Oct 21');
    const shape = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}$/;
    expect(CAL.every((d) => shape.test(d.label))).toBe(true);
  });

  it('phaseOn clamps out-of-range days and defaults an empty calendar to camp', () => {
    expect(phaseOn(CAL, -10)).toBe('camp');
    expect(phaseOn(CAL, 100000)).toBe('freeAgency');
    expect(phaseOn([], 3)).toBe('camp');
  });
});

describe('projectTeam', () => {
  it('derives a 10-man rotation summing inside [225, 250] when the policy is empty', () => {
    const league = fixtureLeague();
    const team = projectTeam(league, 'nye', { isHome: true, gameId: 'g-a' });
    expect(team.players.length).toBe(10);
    expect(team.starters.length).toBe(5);
    const sum = Object.values(team.rotationMinutes!).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(225);
    expect(sum).toBeLessThanOrEqual(250);
  });

  it('excludes an injured starter, refills the five, and renormalizes explicit minutes toward 240', () => {
    const league = fixtureLeague();
    const team = league.teams['nye']!;
    for (const id of team.roster) team.rotation.minutes[id] = 24; // 10 x 24 = 240 exactly
    const hurt = team.rotation.starters[0]!;
    league.players[hurt]!.health.injury = minorInjury(4);
    const proj = projectTeam(league, 'nye', { isHome: true, gameId: 'g-b' });
    expect(proj.players.some((p) => p.id === hurt)).toBe(false);
    expect(proj.starters.length).toBe(5);
    expect(proj.starters).not.toContain(hurt);
    const sum = Object.values(proj.rotationMinutes!).reduce((a, b) => a + b, 0);
    // nine surviving 24-minute targets scale to 240/216 each (26.67 -> 27)
    expect(sum).toBeGreaterThanOrEqual(225);
    expect(sum).toBeLessThanOrEqual(250);
  });

  it('applies the road debuff to the away side only', () => {
    const league = fixtureLeague();
    const attrSum = (t: ReturnType<typeof projectTeam>): number =>
      t.players.reduce((s, p) => s + Object.values(p.attr).reduce((a, b) => a + b, 0), 0);
    const rawSum = league.teams['bos']!.roster
      .map((id) => league.players[id]!)
      .reduce((s, p) => s + Object.values(p.attr).reduce((a, b) => a + b, 0), 0);
    const home = projectTeam(league, 'bos', { isHome: true, gameId: 'g-c' });
    const away = projectTeam(league, 'bos', { isHome: false, gameId: 'g-c' });
    expect(attrSum(home)).toBe(rawSum); // no fatigue, no HCA: the home projection is the roster truth
    expect(attrSum(away)).toBeLessThan(attrSum(home));
  });

  it('debuffs stamina by exactly the B2B amount when the team played yesterday', () => {
    const league = fixtureLeague();
    const fresh = projectTeam(league, 'nye', { isHome: true, gameId: 'g-d' });
    league.day = 6;
    resultShell(league, 'prev-b2b', 5, 'nye', 'bka');
    const tired = projectTeam(league, 'nye', { isHome: true, gameId: 'g-e' });
    const pid = fresh.players[0]!.id;
    const freshStamina = fresh.players.find((p) => p.id === pid)!.attr.stamina;
    const tiredStamina = tired.players.find((p) => p.id === pid)!.attr.stamina;
    expect(tiredStamina).toBe(freshStamina - PARAMS.fatigue.b2bStaminaDebuff);
  });

  it('sits a starter under the b2bRestBelow line on the second night (load management)', () => {
    const league = fixtureLeague();
    const team = league.teams['nye']!;
    const soft = team.rotation.starters[1]!;
    // true stamina 40 projects to 32 after the B2B debuff of 8: below the
    // default rest line of 35, so the staff gives him the night
    league.players[soft]!.attr.stamina = 40;
    league.day = 6;
    resultShell(league, 'prev-rest', 5, 'nye', 'bka');
    const proj = projectTeam(league, 'nye', { isHome: true, gameId: 'g-f' });
    expect(proj.starters).not.toContain(soft);
    expect(proj.rotationMinutes![soft]).toBe(0);
    // and on a fresh night he starts as normal
    const restedLeague = fixtureLeague();
    restedLeague.players[soft]!.attr.stamina = 40;
    const freshProj = projectTeam(restedLeague, 'nye', { isHome: true, gameId: 'g-g' });
    expect(freshProj.starters).toContain(soft);
  });
});

describe('planDayJobs', () => {
  it('plans today only, seeds via gameSeedFor, and keeps events for the user game', () => {
    const { league, games } = twoGameDay();
    const jobs = planDayJobs(league);
    expect(jobs.length).toBe(2);
    expect(jobs.map((j) => j.gameId)).toEqual(games.map((g) => g.id)); // id-sorted, index order
    expect(jobs.every((j, i) => j.index === i)).toBe(true);
    expect(jobs[0]!.seed).toBe(gameSeedFor(league.seed, jobs[0]!.gameId));
    expect(jobs[1]!.seed).toBe(gameSeedFor(league.seed, jobs[1]!.gameId));
    expect(jobs[0]!.detail).toBe('events'); // nye (user) plays in game 0
    expect(jobs[1]!.detail).toBe('fold');
  });
});

describe('one simulated league day', () => {
  it('returns the day digest and advances the clock', () => {
    expect(digestA.date).toEqual({ season: 2026, day: GAME_DAY });
    expect(digestA.phase).toBe('regular');
    expect(digestA.games.length).toBe(2);
    expect(dayA.league.day).toBe(GAME_DAY + 1);
  });

  it('stores a full GameRecord per game', () => {
    for (const g of dayA.games) {
      const rec = dayA.league.results[g.id];
      expect(rec).toBeDefined();
      expect(rec!.final[0]).toBeGreaterThan(0);
      expect(rec!.lines.length).toBe(20); // both 10-man rosters get a box line
      expect(rec!.keyPlays.length).toBeLessThanOrEqual(8);
    }
  });

  it('accumulates player season rows whose points reconcile with the finals', () => {
    const rowPts = Object.values(dayA.league.players)
      .flatMap((p) => p.seasons)
      .reduce((s, r) => s + r.pts, 0);
    const finalPts = dayA.games
      .map((g) => dayA.league.results[g.id]!)
      .reduce((s, r) => s + r.final[0] + r.final[1], 0);
    expect(rowPts).toBe(finalPts);
    // a starter who played logs gp and gs on first touch
    const starterRow = dayA.league.players['p0001']!.seasons[0]!;
    expect(starterRow.gp).toBe(1);
    expect(starterRow.gs).toBe(1);
    expect(starterRow.min).toBeGreaterThan(0);
  });

  it('seeds a standings row for every franchise from day one', () => {
    for (const id of teamIds) {
      expect(dayA.league.standings[id]).toBeDefined();
      expect(dayA.league.standings[id]!.teamId).toBe(id);
    }
  });

  it('is deterministic: the cloned league advances to a byte-identical state', () => {
    expect(JSON.stringify(digestA) === JSON.stringify(digestB)).toBe(true);
    expect(JSON.stringify(dayA.league) === JSON.stringify(dayB.league)).toBe(true);
  });
});

describe('draft night pause', () => {
  // Two-team order with the user first: processDraft must pause BEFORE
  // touching ai/draftai.aiSelect (a throwing stub until ai-team lands).
  const league = fixtureLeague({ seed: 'spine-draft' });
  league.calendar = buildSeasonCalendar(league.params, league.season);
  const draftIdx = league.calendar.findIndex((d) => (d.marks as string[]).includes('draftNight'));
  league.day = draftIdx;
  league.phase = 'draft';
  league.lottery = { season: 2026, order: ['nye', 'bka'], movement: [] };
  let seq = 900;
  for (const pid of ['px01', 'px02', 'px03']) {
    const p = fixturePlayer(pid, null, 2026, (seq += 1));
    p.status = 'draftEligible';
    league.players[pid] = p;
    league.draftClass.push(pid);
  }

  it('pauses the day with an inbox decision when the user is on the clock', async () => {
    const digest = await advanceDay(league, simulateJobsInline);
    expect(league.day).toBe(draftIdx); // the day did NOT advance
    expect(league.phase).toBe('draft');
    expect(digest.inboxIds).toContain('draft-2026-pick-1');
    const item = league.inbox.find((i) => i.id === 'draft-2026-pick-1')!;
    expect(item.kind).toBe('decision');
    expect(item.resolved).toBe(false);
    // aiSelect was never reached: no selection transaction exists
    expect(digest.transactionCount).toBe(0);
  });

  it('re-advancing without picking re-issues the same pause, no duplicates', async () => {
    const digest = await advanceDay(league, simulateJobsInline);
    expect(league.day).toBe(draftIdx);
    expect(league.inbox.filter((i) => i.id === 'draft-2026-pick-1').length).toBe(1);
    expect(digest.games.length).toBe(0);
  });

  it('rejects a draftPick when the board does not hold the prospect', () => {
    const res = applyUserAction(league, { kind: 'draftPick', playerId: 'nobody' });
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});

describe('draft night at the 15-man wall (#183)', () => {
  // The playtest wedge, pinned end to end: 14 standard contracts and both
  // picks in a one-team order (no AI turns, so the wall is user-only and
  // ai/draftai stays out of the sequence). The r1 pick fills slot 15; the
  // r2 clock item must then name the wall, survive its navigational
  // answer, and hold the day openly. Sequential its share this league on
  // purpose, same shape as the pause describe above: the wedge IS a
  // sequence. Pure state, no engine games.
  const league = fixtureLeague({ seed: 'i183-wedge', playersPerTeam: 14 });
  league.calendar = buildSeasonCalendar(league.params, league.season);
  const draftIdx = league.calendar.findIndex((d) => (d.marks as string[]).includes('draftNight'));
  league.day = draftIdx;
  league.phase = 'draft';
  league.lottery = { season: 2026, order: ['nye'], movement: [] };
  // draft-night deals price against the signing season: the lottery
  // transition rolls these lines in the real flow, so a hand-built
  // draft league must roll them too (rookie scale reads capLines[2027])
  rollCapLines(league, league.season + 1);
  let seq = 950;
  for (const pid of ['pw01', 'pw02', 'pw03']) {
    const p = fixturePlayer(pid, null, 2026, (seq += 1));
    p.status = 'draftEligible';
    league.players[pid] = p;
    league.draftClass.push(pid);
  }
  const MAX = league.params.cba.rosterMax;

  it('round 1 pauses normally; the pick signs to fill slot 15', async () => {
    await advanceDay(league, simulateJobsInline);
    expect(league.day).toBe(draftIdx);
    expect(league.inbox.find((i) => i.id === 'draft-2026-pick-1')!.resolved).toBe(false);
    const res = applyUserAction(league, { kind: 'draftPick', playerId: 'pw01' });
    expect(res.ok).toBe(true);
    expect(league.teams['nye']!.roster.length).toBe(MAX);
  });

  it('the round-2 clock item names the wall and what clears it', async () => {
    await advanceDay(league, simulateJobsInline);
    expect(league.day).toBe(draftIdx); // the night holds
    const item = league.inbox.find((i) => i.id === 'draft-2026-pick-2')!;
    expect(item.resolved).toBe(false);
    expect(item.body).toContain(`${MAX}-man maximum`);
    expect(item.body).toContain('waive a player');
    expect(item.body).toContain('trade');
  });

  it('the wall surfaces as a validation error, never a throw', () => {
    const res = applyUserAction(league, { kind: 'draftPick', playerId: 'pw02' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain(`${MAX}-man maximum`);
  });

  it('a navigational answer cannot eat the clock item: the next advance re-opens it', async () => {
    const answer = applyUserAction(league, { kind: 'respondToRequest', requestId: 'draft-2026-pick-2', choice: 'open-draft' });
    expect(answer.ok).toBe(true);
    expect(league.inbox.find((i) => i.id === 'draft-2026-pick-2')!.resolved).toBe(true);
    // before the fix this advance pinned the day with the item resolved:
    // nothing answerable, nothing on-surface, the #183 soft-lock
    await advanceDay(league, simulateJobsInline);
    expect(league.day).toBe(draftIdx);
    const item = league.inbox.find((i) => i.id === 'draft-2026-pick-2')!;
    expect(item.resolved).toBe(false); // re-issued, answerable again
    expect(item.body).toContain(`${MAX}-man maximum`);
    expect(league.inbox.filter((i) => i.id === 'draft-2026-pick-2').length).toBe(1);
  });

  it('clearing a spot un-wedges the night: waive, pick, the draft completes', async () => {
    const cut = league.teams['nye']!.roster[0]!; // any body; which one is the user's call
    expect(applyUserAction(league, { kind: 'waive', playerId: cut, stretch: false }).ok).toBe(true);
    expect(applyUserAction(league, { kind: 'draftPick', playerId: 'pw02' }).ok).toBe(true);
    await advanceDay(league, simulateJobsInline);
    expect(league.day).toBe(draftIdx + 1); // the day finally completes
    expect(league.phase).toBe('moratorium');
    expect(league.players['pw03']!.status).toBe('freeAgent'); // undrafted to the market
  });
});

describe('extractKeyPlays', () => {
  const names = { h1: 'Ade Mercer', a1: 'Theo June' };
  const mk = (partial: Record<string, unknown>, t: number, clock: number, score: [number, number], period = 1): GameEvent =>
    ({ t, wt: t, period, clock, score, ...partial } as unknown as GameEvent);
  const shot = (shooter: string, team: 0 | 1, three: boolean, t: number, clock: number, score: [number, number], period = 1): GameEvent =>
    mk({
      type: 'shot', team, shooter, x: 25, y: 47, distFt: three ? 24 : 8,
      zone: three ? 'three' : 'paint', three, moveType: 'catch_shoot',
      contest: 0.2, made: true, points: three ? 3 : 2,
    }, t, clock, score, period);

  // h1 rips off 13 straight threes (39-0), a1 answers, h1 adds one more
  // (42: across the 40-point line), and a1 beats the Q4 horn.
  const events: GameEvent[] = [];
  for (let i = 0; i < 13; i++) {
    events.push(shot('h1', 0, true, 10 + i * 20, 700 - i * 20, [(i + 1) * 3, 0]));
  }
  events.push(shot('a1', 1, false, 300, 400, [39, 2]));
  events.push(shot('h1', 0, true, 320, 380, [42, 2]));
  events.push(shot('a1', 1, false, 2879, 0.4, [42, 4], 4));
  const plays = extractKeyPlays(events, names);

  it('detects the run, the 40-point milestone, and the buzzer beater', () => {
    const kinds = plays.map((p) => p.kind);
    expect(kinds).toContain('run');
    expect(kinds).toContain('milestone');
    expect(kinds).toContain('buzzer');
    const run = plays.find((p) => p.kind === 'run')!;
    expect(run.text).toContain('39-0 run');
    expect(run.text).toContain('Mercer'); // surname, not the full name
    const milestone = plays.find((p) => p.kind === 'milestone')!;
    expect(milestone.text).toContain('42');
  });

  it('caps at 8 plays and keeps the register flat (no exclamation marks)', () => {
    expect(plays.length).toBeLessThanOrEqual(8);
    expect(plays.every((p) => !p.text.includes('!'))).toBe(true);
    expect(plays.every((p) => /^(Q[1-4]|OT\d?) \d+:\d{2}$/.test(p.clock))).toBe(true);
  });
});
