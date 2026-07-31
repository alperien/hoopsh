/**
 * The NBA bridge: one career week inside the real franchise sim, the
 * approach swap wrapped tightly around my game days, the coach ledger
 * across teams, the FA market view, and the choice seams. fastSim is
 * the SimulateJobs for every test (a valid seam that keeps a 30-team
 * league cheap); tick.ts owns the career clock in production, so the
 * week loops here bump it the same way.
 */
import { describe, expect, it } from 'vitest';
import type { TeamId } from '@hoopsh/franchise';
import type { CareerState } from '../src/types.js';
import { fixtureCareer } from './fixture.js';
import { fastSim } from '../src/fastsim.js';
import {
  advanceLeagueFast, applyAbroadOffer, applyContractDecision, applyNbaOffer,
  buildMyOffers, resolveNbaWeek, setTradeRequest,
} from '../src/nbabridge.js';

/** AI personas everywhere: a career league never waits on a human chair. */
function fillSeats(career: CareerState): void {
  for (const tid of Object.keys(career.league.teams)) {
    const team = career.league.teams[tid]!;
    if (team.gm === null) {
      team.gm = { name: 'Autopilot', timeline: 'retool', risk: 50, pickLove: 50, starChase: 50, patience: 50 };
    }
  }
}

/** Promote the fixture into a drafted, rostered NBA state on team index `idx`. */
function promoteToNba(career: CareerState, idx = 1): TeamId {
  const league = career.league;
  fillSeats(career);
  const tid = Object.keys(league.teams)[idx]! as TeamId;
  const team = league.teams[tid]!;
  const me = career.players[career.me]!;
  delete career.players[career.me];
  me.status = 'roster';
  me.draft = { season: league.season, round: 1, pick: 5, teamId: tid }; // lottery slot
  me.contract = {
    id: `ct-${career.me}-fixture`, playerId: career.me, teamId: tid,
    years: [{ season: league.season, salary: 2_000_000, guaranteed: 2_000_000 }],
    kind: 'rookieScale', means: 'rookieScale',
    signedOn: { season: league.season, day: 0 }, birdYearsAtSigning: 0,
  };
  league.players[career.me] = me;
  team.roster.unshift(career.me); // first in roster order: fastSim's 8-man slice sees me
  team.rotation.starters = [career.me, ...team.rotation.starters.filter(id => id !== career.me)].slice(0, 5);
  league.careerControlled = [career.me];
  career.nbaTeam = tid;
  career.clock.phase = 'nba';
  career.circuit = null;
  return tid;
}

/** Promote the fixture into an undrafted league free agent (the market's problem). */
function promoteToFa(career: CareerState): void {
  const league = career.league;
  fillSeats(career);
  const me = career.players[career.me]!;
  delete career.players[career.me];
  me.status = 'freeAgent';
  me.contract = null;
  me.rights = null;
  me.draft = { season: league.season, round: 0, pick: 0, teamId: null };
  league.players[career.me] = me;
  if (!league.freeAgents.includes(career.me)) league.freeAgents.push(career.me);
  league.careerControlled = [career.me];
  career.nbaTeam = null;
  career.clock.phase = 'nba';
  career.circuit = null;
}

/** Run whole weeks the way tick does: resolve, then advance the career clock. */
async function runWeeks(career: CareerState, weeks: number): Promise<void> {
  for (let i = 0; i < weeks; i++) {
    await resolveNbaWeek(career, fastSim);
    career.clock.week += 1;
  }
}

/** Weeks until my coach has graded at least one night (schedule warmup). */
async function runUntilGraded(career: CareerState, maxWeeks = 8): Promise<void> {
  let weeks = 0;
  while (career.coach.grades.length === 0 && weeks < maxWeeks) {
    await resolveNbaWeek(career, fastSim);
    career.clock.week += 1;
    weeks += 1;
  }
}

describe('the NBA week', () => {
  it('advances exactly leagueDaysPerWeek league days and returns a digest', async () => {
    const career = fixtureCareer();
    promoteToNba(career);
    const day0 = career.league.day;
    const digest = await resolveNbaWeek(career, fastSim);
    expect(career.league.day).toBe(day0 + career.params.tick.leagueDaysPerWeek);
    expect(Array.isArray(digest.gamesPlayed)).toBe(true);
    expect(Array.isArray(digest.messages)).toBe(true);
    expect(digest.events.length).toBeGreaterThan(0); // the coach reset explains itself
    expect(digest.energy).toBe(career.energy);
  });

  it('grades my nights once the schedule reaches my team', async () => {
    const career = fixtureCareer();
    const tid = promoteToNba(career);
    await runUntilGraded(career);
    expect(career.coach.grades.length).toBeGreaterThan(0);
    // the ledger continued onto a fresh NBA coach mirroring the franchise bench
    expect(career.coach.name).toBe(career.league.teams[tid]!.coach.name);
    const grade = career.coach.grades[0]!;
    const record = career.league.results[grade.gameId];
    expect(record !== undefined).toBe(true);
    expect(record!.home === tid || record!.away === tid).toBe(true);
    expect(grade.note.length).toBeGreaterThan(0); // every consequence explained
  });

  it('the approach swap does not leak: tendencies and identity restore after the week', async () => {
    const career = fixtureCareer();
    promoteToNba(career);
    career.approach = { assertiveness: 85, range: 80, motor: 30, defense: 20, playmaking: 25 };
    const meRef = career.league.players[career.me]!;
    const tendBefore = JSON.stringify(meRef.tend);
    await runUntilGraded(career);
    expect(career.coach.grades.length).toBeGreaterThan(0); // a game really ran under the card
    expect(career.league.players[career.me]).toBe(meRef);  // the original object, not a copy
    expect(JSON.stringify(career.league.players[career.me]!.tend)).toBe(tendBefore);
  });

  it('two identical careers produce identical NBA weeks (determinism)', async () => {
    const a = fixtureCareer({ seed: 'nba-det' });
    const b = fixtureCareer({ seed: 'nba-det' });
    promoteToNba(a);
    promoteToNba(b);
    await runWeeks(a, 2);
    await runWeeks(b, 2);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.league.day).toBe(b.league.day);
    expect(JSON.stringify(a.coach.grades)).toBe(JSON.stringify(b.coach.grades));
    expect(a.energy).toBe(b.energy);
  });

  it('advanceLeagueFast moves the world N days on the internal sim', async () => {
    const career = fixtureCareer();
    const day0 = career.league.day;
    await advanceLeagueFast(career, 3);
    expect(career.league.day).toBe(day0 + 3);
  });
});

describe('my market', () => {
  it('builds offers for a free-agent me: real money, the nba: id convention', () => {
    const career = fixtureCareer();
    promoteToFa(career);
    const offers = buildMyOffers(career);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(career.params.nbabridge.faOfferCount);
    for (const o of offers) {
      expect(o.money).toBeGreaterThan(0);
      expect(/^(nba|abroad):/.test(o.id)).toBe(true);
      expect(o.expiresWeek).toBeGreaterThan(career.clock.week);
      expect((o.clubName ?? '').length).toBeGreaterThan(0);
    }
    expect(offers.some(o => o.id.startsWith('nba:'))).toBe(true);
    // a pure view: same state, same market
    expect(JSON.stringify(buildMyOffers(career))).toBe(JSON.stringify(offers));
  });

  it('applyNbaOffer signs me: roster, sane contract, ledger, explained events', () => {
    const career = fixtureCareer();
    promoteToFa(career);
    const offer = buildMyOffers(career).find(o => o.id.startsWith('nba:'))!;
    const teamId = offer.id.split(':')[1]!;
    const ledgerBefore = career.ledger.length;
    const r = applyNbaOffer(career, offer.id);
    expect(r.ok).toBe(true);
    const league = career.league;
    const team = league.teams[teamId]!;
    expect(team.roster.includes(career.me) || team.twoWay.includes(career.me)).toBe(true);
    const me = league.players[career.me]!;
    expect(me.status).toBe('roster');
    const c = me.contract!;
    expect(c.teamId).toBe(teamId);
    expect(c.years.length).toBeGreaterThanOrEqual(1);
    expect(c.years[0]!.season).toBe(league.season); // camp phase: the deal starts this league year
    expect(c.years[0]!.salary).toBeGreaterThan(0);
    expect(career.ledger.length).toBe(ledgerBefore + 1);
    expect(career.ledger[career.ledger.length - 1]!.amount).toBe(c.years[0]!.salary);
    expect(career.nbaTeam).toBe(teamId);
    expect(career.coach.role).toBe(offer.promisedRole); // the promise IS the starting role
    expect(career.coach.grades.length).toBe(0);         // new team, fresh ledger
    expect(career.coach.trust).toBeGreaterThanOrEqual(40);
    expect(career.coach.trust).toBeLessThanOrEqual(55);
    expect(career.events.some(e => e.kind === 'contract' && e.reason.includes('signed'))).toBe(true);
    // the world says no to a spent offer, without throwing
    expect(applyNbaOffer(career, offer.id).ok).toBe(false);
  });

  it('the descent fork: the China money moves the phase and commits the deal', () => {
    const career = fixtureCareer();
    promoteToFa(career);
    const me = career.league.players[career.me]!;
    me.bornSeason = career.league.season - 33; // past the age line: the overseas money calls
    const china = buildMyOffers(career).find(o => o.id.startsWith('abroad:china:'))!;
    expect(china.money).toBeGreaterThan(0);
    const r = applyAbroadOffer(career, china.id);
    expect(r.ok).toBe(true);
    expect(career.clock.phase).toBe('china');
    expect(career.nbaTeam).toBe(null);
    expect(career.recruiting?.committedTo).toBe(china.id);
    expect(career.players[career.me]).toBe(me); // the circuit machinery can find me again
    expect(career.events.some(e => e.kind === 'phase' && e.reason.includes('CBA money'))).toBe(true);
    // bad ids answer politely
    expect(applyAbroadOffer(career, 'abroad:mars:2026').ok).toBe(false);
  });
});

describe('the choice seams', () => {
  it('a trade request weighs and explains; withdrawing clears it', () => {
    const career = fixtureCareer();
    promoteToNba(career);
    const me = career.league.players[career.me]!;
    const before = me.morale;
    expect(setTradeRequest(career, true).ok).toBe(true);
    expect(me.morale).toBe(before - career.params.nbabridge.requestMoraleCost);
    expect(career.events.some(e => e.kind === 'transaction' && e.reason.startsWith('asked out:'))).toBe(true);
    expect(career.events.some(e => e.kind === 'morale' && e.delta === -career.params.nbabridge.requestMoraleCost)).toBe(true);
    expect(setTradeRequest(career, true).ok).toBe(false);  // already on the record
    expect(setTradeRequest(career, false).ok).toBe(true);
    expect(me.morale).toBe(before);
    expect(setTradeRequest(career, false).ok).toBe(false); // nothing pending
  });

  it('answers a player option and refuses nonsense ids without throwing', () => {
    const career = fixtureCareer();
    promoteToNba(career);
    const league = career.league;
    const me = league.players[career.me]!;
    const next = league.season + 1;
    me.contract!.years.push({ season: next, salary: 2_200_000, guaranteed: 2_200_000, playerOption: true });
    expect(applyContractDecision(career, 'option:banana', 'decline').ok).toBe(false);
    expect(applyContractDecision(career, `option:${next}`, 'maybe').ok).toBe(false);
    const r = applyContractDecision(career, `option:${next}`, 'decline');
    expect(r.ok).toBe(true);
    expect(me.contract!.years.some(y => y.season === next)).toBe(false); // the year came off the books
    expect(career.events.some(e => e.kind === 'contract' && e.reason.includes('opted out'))).toBe(true);
    expect(league.transactions.some(t => t.kind === 'optionDecision' && t.playerId === career.me)).toBe(true);
    expect(applyContractDecision(career, `option:${next}`, 'decline').ok).toBe(false); // spent
  });
});

describe('the market prices the decline (fix wave C, the Amari critique)', () => {
  function faAtAge(age: number, fadingSeason = false): number {
    const career = fixtureCareer();
    promoteToFa(career); // moves me into the league pool as a free agent
    const me = career.league.players[career.me]!;
    me.bornSeason = career.league.season - age;
    if (fadingSeason) {
      me.seasons.push({
        season: career.league.season - 1, teamId: 'mia', type: 'regular',
        gp: 60, gs: 20, min: 1200, pts: 420, fgm: 160, fga: 400, tpm: 40, tpa: 130,
        ftm: 60, fta: 80, orb: 30, drb: 120, ast: 90, stl: 40, blk: 10, tov: 70,
        pf: 100, plusMinus: -180,
      } as never);
    }
    const offers = buildMyOffers(career).filter(o => o.id.startsWith('nba:'));
    if (offers.length === 0) return 0;
    return Math.max(...offers.map(o => o.money));
  }

  it('the same sheet earns less at 31 than at 25, and a weak last season discounts further', () => {
    const at25 = faAtAge(25);
    const at31 = faAtAge(31);
    const at31fading = faAtAge(31, true);
    expect(at25).toBeGreaterThan(0);
    expect(at31).toBeLessThan(at25);       // the age curve alone
    expect(at31fading).toBeLessThan(at31); // 7 a night at minus 3 shaves the paper again
  });
});
