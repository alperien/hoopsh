/**
 * Offer-sheet resolution at the tick (#185): the morning auto-resolve
 * must never kill the day with a raw executor throw, and the AI match
 * rule must price against signing-season books — the label-season sheets
 * read $0 between the lottery and the calendar rollover, so the apron
 * test at the old read waved every match through on fiction.
 *
 * The path is organically unreachable on this base (free agency never
 * convenes before #164/#232 lands, so sheets never exist in live play).
 * Every scenario here CONSTRUCTS the sheet state directly and drives it
 * through advanceDay, the public seam. After #232 arms the path
 * organically, these pins keep holding: they assert resolution behavior,
 * not how the sheet came to exist.
 *
 * COMPUTE BUDGET: zero engine games. Quiet no-game days only; everything
 * is pure state.
 */
import { describe, expect, it } from 'vitest';
import type { Contract, League, PlayerId, TeamId } from '../src/types.js';
import { buildSeasonCalendar, phaseOn } from '../src/calendar.js';
import { rollCapLines } from '../src/cba/cap.js';
import { simulateJobsInline } from '../src/gameday.js';
import { advanceDay } from '../src/tick.js';
import { fixtureLeague, fixturePlayer } from './fixture.js';

/** First calendar day in `phase` carrying no marks (no games, no rituals). */
function quietDayIn(league: League, phase: League['phase']): number {
  const cal = league.calendar;
  for (let d = 0; d < cal.length; d++) {
    if (phaseOn(cal, d) === phase && (cal[d]!.marks as string[]).length === 0) return d;
  }
  throw new Error(`no quiet ${phase} day in the fixture calendar`);
}

/** A fixture league parked on a quiet day of `phase`, calendar pre-built so advanceDay's lazy init cannot move the clock. */
function leagueOn(phase: League['phase']): League {
  const league = fixtureLeague();
  league.calendar = buildSeasonCalendar(league.params, league.season);
  league.day = quietDayIn(league, phase);
  league.phase = phase;
  return league;
}

/** Pad a roster to the 15-man maximum with signed minimum-ish bodies. */
function padRosterToMax(league: League, teamId: TeamId): void {
  const team = league.teams[teamId]!;
  let i = 0;
  while (team.roster.length < league.params.cba.rosterMax) {
    const id = `fill-${teamId}-${i}`;
    const p = fixturePlayer(id, teamId, league.season, i);
    p.contract!.years = p.contract!.years.map((y) => ({ ...y, salary: 1_000_000, guaranteed: 1_000_000 }));
    league.players[id] = p;
    team.roster.push(id);
    i += 1;
  }
}

/**
 * Construct a restricted free agent with rights held by `incumbent` and a
 * live offer sheet from `from`, expiring today. Attributes are pinned to
 * 99 so the core-rank half of the auto-match rule always says "keeper" —
 * each test then controls the outcome through the apron half alone.
 */
function lodgeSheet(
  league: League,
  opts: { incumbent: TeamId; from: TeamId; year1: number; contractSeason: number },
): PlayerId {
  const pid = 'rfa-0001';
  const p = fixturePlayer(pid, null, league.season, 0);
  for (const k of Object.keys(p.attr)) (p.attr as unknown as Record<string, number>)[k] = 99;
  p.rights = {
    teamId: opts.incumbent, tier: 'bird', capHold: 1_000_000,
    qualifyingOffer: 1_000_000, restricted: true,
  };
  league.players[pid] = p;
  league.freeAgents.push(pid);
  const contract: Contract = {
    id: `c-sheet-${pid}`, playerId: pid, teamId: opts.from,
    years: [
      { season: opts.contractSeason, salary: opts.year1, guaranteed: opts.year1 },
      { season: opts.contractSeason + 1, salary: opts.year1, guaranteed: opts.year1 },
    ],
    kind: 'standard', means: 'capSpace',
    signedOn: { season: league.season, day: league.day },
    birdYearsAtSigning: 0,
  };
  league.offerSheets.push({
    playerId: pid, from: opts.from, contract,
    decideBy: { season: league.season, day: league.day },
  });
  return pid;
}

function offerSheetSignings(league: League, pid: PlayerId) {
  return league.transactions.filter(
    (t) => t.kind === 'signing' && t.playerId === pid && (t as { offerSheet?: boolean }).offerSheet === true,
  );
}

function matchDecisionsFor(league: League, pid: PlayerId) {
  return league.transactions.filter((t) => t.kind === 'matchDecision' && t.playerId === pid);
}

describe('offer-sheet resolution at the tick (#185)', () => {
  it('voids a sheet the user can no longer execute, explained, without killing the day', async () => {
    const league = leagueOn('regular');
    // live-play shape: the user's chair lodged the sheet (the offerSheet
    // action is not phase-gated); an AI front office holds the rights
    const offering = league.userTeam;
    const incumbent = (Object.keys(league.teams) as TeamId[])[1]!;
    // the user's roster filled to the ceiling during the match window
    padRosterToMax(league, offering);
    // year 1 lands the incumbent past the first apron, so the auto-match
    // rule declines and resolution flows to the user's signing
    const year1 = league.capLines[league.season]!.apron1 + 1;
    const pid = lodgeSheet(league, {
      incumbent, from: offering, year1, contractSeason: league.season,
    });

    // on the defective base this day dies inside executeSigning:
    // "roster already at the 15-man maximum"
    await advanceDay(league, simulateJobsInline);

    expect(league.offerSheets.length).toBe(0);
    expect(offerSheetSignings(league, pid).length).toBe(0);
    const decisions = matchDecisionsFor(league, pid);
    expect(decisions.length).toBe(1);
    expect((decisions[0] as { matched?: boolean }).matched).toBe(false);
    const note = league.inbox.find((i) => i.id.startsWith('sheet-void-') && i.id.endsWith(pid));
    expect(note?.kind).toBe('notice');
    expect(note?.body ?? '').toContain('15-man');
  });

  it('falls back to the unmatched signing when the incumbent matches but cannot execute', async () => {
    const league = leagueOn('regular');
    // the user's chair lodged the sheet; the AI incumbent decided to keep
    // its core but filled to the ceiling during the window: the match is
    // physically unexecutable today
    const offering = league.userTeam;
    const incumbent = (Object.keys(league.teams) as TeamId[])[1]!;
    padRosterToMax(league, incumbent);
    const year1 = 1_000_000; // well under the apron: the match rule says yes
    const pid = lodgeSheet(league, {
      incumbent, from: offering, year1, contractSeason: league.season,
    });
    const sheet = league.capLines[league.season]!;
    // fixture sanity: the matched branch must actually be reachable
    expect(year1 <= sheet.apron1).toBe(true);

    // on the defective base this day dies inside executeSigning on the
    // incumbent's forced, unvalidated match execution
    await advanceDay(league, simulateJobsInline);

    const signings = offerSheetSignings(league, pid);
    expect(signings.length).toBe(1);
    expect((signings[0] as { teamId?: string }).teamId).toBe(offering);
    expect(league.teams[offering]!.roster).toContain(pid);
    const decisions = matchDecisionsFor(league, pid);
    expect(decisions.length).toBe(1);
    expect((decisions[0] as { matched?: boolean }).matched).toBe(false);
    const note = league.inbox.find((i) => i.id.startsWith('sheet-match-block-') && i.id.endsWith(pid));
    expect(note?.kind).toBe('notice');
  });

  it('reroutes AI-AI sheets silently: the day survives, the desk stays quiet', async () => {
    const league = leagueOn('regular');
    // two AI front offices; the user's team is no party to the sheet
    const [, incumbent, offering] = Object.keys(league.teams) as TeamId[];
    padRosterToMax(league, offering!);
    const year1 = league.capLines[league.season]!.apron1 + 1;
    const pid = lodgeSheet(league, {
      incumbent: incumbent!, from: offering!, year1, contractSeason: league.season,
    });
    const dayBefore = league.day;

    // same defective-base crash shape as the user-party void above: the
    // fix must survive it for ANY two teams, but only user-party sheets
    // may reach the user's desk
    await advanceDay(league, simulateJobsInline);

    expect(league.day).toBe(dayBefore + 1);
    expect(league.offerSheets.length).toBe(0);
    expect(offerSheetSignings(league, pid).length).toBe(0);
    expect(matchDecisionsFor(league, pid).length).toBe(1);
    expect(league.inbox.some((i) => i.id.startsWith('sheet-void-') || i.id.startsWith('sheet-match-block-'))).toBe(false);
  });

  it('prices the auto-match apron test on signing-season books between lottery and rollover', async () => {
    const league = leagueOn('draft');
    const [, incumbent, offering] = Object.keys(league.teams) as TeamId[];
    const signing = league.season + 1;
    rollCapLines(league, signing);
    // the #185 state: contract years already advanced at the playoffs-to-
    // draft transition, so the label-season books read $0 while the
    // signing-season books carry the real payroll
    for (const rid of league.teams[incumbent!]!.roster) {
      const c = league.players[rid]!.contract!;
      c.years = c.years.filter((y) => y.season >= signing);
    }
    const labelLines = league.capLines[league.season]!;
    const signingLines = league.capLines[signing]!;
    // 10 fixture contracts x $10M = $100M of signing-season payroll
    const signingPayroll = 100_000_000;
    // a bill that fits under the apron on the zeroed label books but
    // blows past it on the real signing-season books
    const year1 = signingLines.apron1 - signingPayroll + 5_000_000;
    expect(year1 > 0).toBe(true);
    expect(year1 <= labelLines.apron1).toBe(true);
    expect(signingPayroll + year1 > signingLines.apron1).toBe(true);
    const pid = lodgeSheet(league, {
      incumbent: incumbent!, from: offering!, year1, contractSeason: signing,
    });

    await advanceDay(league, simulateJobsInline);

    // the defective base reads 0 + year1 <= apron1, matches on fiction,
    // and hands the player to the incumbent; real books say decline
    const signings = offerSheetSignings(league, pid);
    expect(signings.length).toBe(1);
    expect((signings[0] as { teamId?: string }).teamId).toBe(offering);
    const decisions = matchDecisionsFor(league, pid);
    expect(decisions.length).toBe(1);
    expect((decisions[0] as { matched?: boolean }).matched).toBe(false);
  });
});
