/**
 * The career spine: choice validation and logging, the week allocation
 * economy, the recovery clock, the world clock, and year-wrap phase
 * moves. Circuit play itself is the circuits suite; here the field is
 * empty or archived so the spine shows through.
 */
import { describe, expect, it } from 'vitest';
import { simulateJobsInline } from '@hoopsh/franchise';
import type { FrPlayer, TeamId } from '@hoopsh/franchise';
import { advanceCareerWeek, applyChoice } from '../src/tick.js';
import { resolveAllocation, resolveWeek } from '../src/week.js';
import { buildMyOffers } from '../src/nbabridge.js';
import { fastSim } from '../src/fastsim.js';
import { fixtureCareer } from '../test/fixture.js';

function offseason(career: ReturnType<typeof fixtureCareer>, kind?: 'hs' | 'college' | 'euro' | 'nbl' | 'china'): ReturnType<typeof fixtureCareer> {
  career.circuit = null; // between seasons: allocation and systems only
  career.circuitHistory.push({
    year: career.clock.year, kind: kind ?? 'hs', teamName: 'Oak Ridge Central',
    w: 8, l: 4,
    myLine: { gp: 12, min: 28, pts: 15, reb: 5, ast: 3, stl: 1, blk: 0, tpm: 2, fgPct: 0.47 },
    finish: 'lost regional final', honors: [],
  });
  return career;
}

/**
 * A drafted-and-done NBA veteran on the market: the descent's doorstep.
 * The league owns my file (the post-entry pool law, types.ts) and my
 * draft record is real history the descent must never touch.
 */
function vetFreeAgent(career: ReturnType<typeof fixtureCareer>, age = 34): FrPlayer {
  const league = career.league;
  for (const tid of Object.keys(league.teams)) {
    const team = league.teams[tid]!;
    if (team.gm === null) {
      team.gm = { name: 'Autopilot', timeline: 'retool', risk: 50, pickLove: 50, starChase: 50, patience: 50 };
    }
  }
  const me = career.players[career.me]!;
  delete career.players[career.me];
  me.status = 'freeAgent';
  me.contract = null;
  me.rights = null;
  me.bornSeason = league.season - age;
  me.draft = { season: league.season - 12, round: 1, pick: 12, teamId: Object.keys(league.teams).sort()[0]! as TeamId };
  league.players[career.me] = me;
  if (!league.freeAgents.includes(career.me)) league.freeAgents.push(career.me);
  league.careerControlled = [career.me];
  career.nbaTeam = null;
  career.clock.phase = 'nba';
  career.circuit = null;
  return me;
}

describe('applyChoice validates, applies, logs', () => {
  it('takes a legal week plan and logs it', () => {
    const career = fixtureCareer();
    const r = applyChoice(career, { kind: 'setWeekPlan', plan: { slots: ['film', 'rest'], focus: 'defense' } });
    expect(r.ok).toBe(true);
    expect(career.weekPlan.focus).toBe('defense');
    expect(career.choiceLog.length).toBe(1);
    expect(career.choiceLog[0]!.seq).toBe(0);
  });

  it('refuses an overstuffed week without logging', () => {
    const career = fixtureCareer();
    const r = applyChoice(career, {
      kind: 'setWeekPlan',
      plan: { slots: ['extraWork', 'extraWork', 'film', 'body'], focus: 'scoring' },
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('3 slots');
    expect(career.choiceLog.length).toBe(0);
  });

  it('takes an approach card for the next game only', () => {
    const career = fixtureCareer();
    const r = applyChoice(career, {
      kind: 'setApproach',
      card: { assertiveness: 80, range: 70, motor: 50, defense: 40, playmaking: 45 },
    });
    expect(r.ok).toBe(true);
    expect(career.nextApproach?.assertiveness).toBe(80);
    const bad = applyChoice(career, {
      kind: 'setApproach',
      card: { assertiveness: 140, range: 50, motor: 50, defense: 50, playmaking: 50 },
    });
    expect(bad.ok).toBe(false);
  });

  it('holds the phase doors: no declaring from high school, no retiring from nothing', () => {
    const career = fixtureCareer();
    expect(applyChoice(career, { kind: 'declareDraft' }).ok).toBe(false);
    expect(applyChoice(career, { kind: 'retire' }).ok).toBe(false);
    expect(applyChoice(career, { kind: 'acceptOffer', offerId: 'nope' }).ok).toBe(false);
    expect(career.choiceLog.length).toBe(0);
  });
});

describe('the week allocation economy', () => {
  it('rest restores, grind drains, and the floor warns', () => {
    const grinder = fixtureCareer();
    grinder.weekPlan = { slots: ['extraWork', 'extraWork', 'film'], focus: 'scoring' };
    resolveAllocation(grinder);
    const rested = fixtureCareer();
    rested.weekPlan = { slots: ['rest', 'rest', 'life'], focus: 'scoring' };
    resolveAllocation(rested);
    expect(rested.energy).toBeGreaterThan(grinder.energy);

    const empty = fixtureCareer();
    empty.energy = 30;
    empty.weekPlan = { slots: ['extraWork', 'extraWork', 'film'], focus: 'scoring' };
    resolveAllocation(empty);
    expect(empty.events.some(e => e.kind === 'energy' && e.reason.includes('empty'))).toBe(true);
  });

  it('body work trims the odometer', () => {
    const career = fixtureCareer();
    const me = career.players[career.me]!;
    me.health.wear = 3;
    career.weekPlan = { slots: ['body', 'body', 'rest'], focus: 'phys' };
    resolveAllocation(career);
    expect(me.health.wear).toBeLessThan(3);
  });
});

describe('the training pity timer', () => {
  it('banks fractional progress and lands +1 deterministically at least every ceil(1/rate) weeks', () => {
    const career = fixtureCareer();
    expect(career.trainingBank).toBe(undefined); // old saves carry no bank; the week creates it
    career.weekPlan = { slots: ['extraWork', 'rest', 'rest'], focus: 'scoring' };
    // HS staff 42: rate = 0.16 * (1 - 8/50*0.35) ~ 0.151/week -> a tick at least every 7 weeks
    const cap = Math.ceil(1 / (career.params.week.trainingGainBase * (1 + ((42 - 50) / 50) * 0.35)));
    expect(cap).toBe(7);
    const landings: number[] = [];
    for (let w = 0; w < 16; w++) {
      const before = career.events.length;
      resolveAllocation(career);
      career.clock.week += 1;
      if (career.events.slice(before).some(e => e.kind === 'dev' && e.reason.includes('extra work paid'))) {
        landings.push(w);
      }
    }
    expect(landings.length).toBeGreaterThanOrEqual(2); // 16 weeks at ~0.151/week
    let last = -1;
    for (const w of landings) {
      expect(w - last).toBeLessThanOrEqual(cap); // the drought cap, deterministic
      last = w;
    }
    expect((career.trainingBank?.scoring ?? 0)).toBeLessThan(1); // a landing spends the bank
    expect((career.trainingBank?.scoring ?? 0)).toBeGreaterThanOrEqual(0);
  });

  it('a finished group banks nothing and its ceiling speaks exactly once (issue #105)', () => {
    // The banks-nothing half is unchanged law. The silence half was the
    // measured aggravator: the drip died at ceiling without a word and dead
    // windows read at raw length (#100). The issue's adopted acceptance is
    // that the death IS an event - the hidden-ceiling reveal - once per
    // group, never weekly.
    const career = fixtureCareer();
    const me = career.players[career.me]!;
    me.potential.scoring = 1; // group mean is already past this
    career.weekPlan = { slots: ['extraWork', 'rest', 'rest'], focus: 'scoring' };
    for (let w = 0; w < 10; w++) resolveAllocation(career);
    expect(career.trainingBank?.scoring ?? 0).toBe(0); // still banks nothing
    const reveals = career.events.filter(e =>
      e.kind === 'dev' && e.reason.includes('nothing left to add to scoring'));
    expect(reveals.length).toBe(1); // ten silent weeks, one stated ceiling
    expect(career.events.filter(e => e.kind === 'dev').length).toBe(1); // and no other dev noise
  });
});

describe('the sticky card and honest weekly grading (resolveWeek)', () => {
  const offPlan = { assertiveness: 95, range: 95, motor: 50, defense: 30, playmaking: 40 };

  it('folds a dialed card into the standing approach at week end, even without games', async () => {
    const career = offseason(fixtureCareer());
    applyChoice(career, { kind: 'setApproach', card: { ...offPlan } });
    expect(career.nextApproach?.assertiveness).toBe(95);
    await resolveWeek(career, fastSim);
    expect(career.approach).toEqual(offPlan);   // the card persists until changed
    expect(career.nextApproach).toBe(null);     // and the one-shot slot is clear
  });

  it('playingHurt never persists into the standing card', async () => {
    const career = offseason(fixtureCareer());
    career.nextApproach = { ...offPlan, playingHurt: true };
    await resolveWeek(career, fastSim);
    expect(career.approach).toEqual(offPlan);
    expect((career.approach as { playingHurt?: boolean }).playingHurt).toBe(undefined);
  });

  it('grades BOTH games of a doubleheader week against the one card the engine saw', async () => {
    const career = fixtureCareer();
    career.clock.week = 0; // the fixture schedule packs my team a two-game week at week 0
    career.nextApproach = { ...offPlan };
    const digest = await resolveWeek(career, simulateJobsInline);
    const myGames = career.coach.grades.filter(g => g.gameId.startsWith('c2026-w0'));
    expect(myGames.length).toBe(2);
    expect(digest.gamesPlayed.length).toBeGreaterThanOrEqual(2);
    // the measured dishonesty was adherence alternating 0/100 with an
    // off-plan card; both nights now judge the card that simulated
    expect(myGames[0]!.adherence).toBe(myGames[1]!.adherence);
    expect(myGames[0]!.adherence).toBeLessThan(70);
    expect(career.approach).toEqual(offPlan); // and the card stuck at week end
    expect(career.nextApproach).toBe(null);
  });
});

describe('the week and the world clock', () => {
  it('advances the clock and heals on schedule', async () => {
    const career = offseason(fixtureCareer());
    const me = career.players[career.me]!;
    me.health.injury = {
      kind: 'ankle-sprain', label: 'a rolled ankle', severity: 'minor',
      startedOn: { season: career.clock.year, day: career.clock.week },
      outDays: 5, remainingDays: 5,
    };
    const week = career.clock.week;
    const digest = await advanceCareerWeek(career, fastSim);
    expect(career.clock.week).toBe(week + 1);
    expect(me.health.injury).toBe(null);
    expect(career.events.some(e => e.kind === 'injury' && e.reason.includes('cleared'))).toBe(true);
    expect(digest.energy).toBe(career.energy);
  });

  it('wraps the year into the walk-on door when nobody called', async () => {
    const career = offseason(fixtureCareer());
    career.recruiting = null; // no board at all: the barest path
    career.clock.week = career.params.tick.weeksPerYear - 1;
    const year = career.clock.year;
    const digest = await advanceCareerWeek(career, fastSim);
    expect(career.clock.year).toBe(year + 1);
    expect(career.clock.week).toBe(0);
    expect(career.clock.phase).toBe('college');
    expect(digest.phaseChangedTo).toBe('college');
    expect(career.events.some(e => e.kind === 'phase' && e.reason.includes('walked on'))).toBe(true);
  });

  it('sends the showcase routes to the draft after one year', async () => {
    const career = fixtureCareer();
    career.clock.phase = 'euro';
    offseason(career, 'euro');
    career.clock.week = career.params.tick.weeksPerYear - 1;
    await advanceCareerWeek(career, fastSim);
    expect(career.clock.phase).toBe('draftPrep');
  });

  it('a descent veteran\'s year wrap stays abroad: never back into draftPrep (issue #40)', async () => {
    const career = fixtureCareer({ seed: 'descent-vet' });
    const me = vetFreeAgent(career);
    const draftBefore = JSON.stringify(me.draft);
    const euro = buildMyOffers(career).find(o => o.id.startsWith('abroad:euro:'))!;
    expect(applyChoice(career, { kind: 'acceptAbroadOffer', offerId: euro.id }).ok).toBe(true);
    expect(career.clock.phase).toBe('euro');

    offseason(career, 'euro'); // the euro season played out and archived
    career.clock.week = career.params.tick.weeksPerYear - 1;
    const digest = await advanceCareerWeek(career, fastSim);

    expect(career.clock.phase).toBe('euro'); // multi-year descents live; a veteran is not a prospect
    expect(digest.phaseChangedTo).toBe(undefined);
    expect(JSON.stringify(me.draft)).toBe(draftBefore); // the record survives the wrap untouched
    expect(me.status).not.toBe('draftEligible');
    expect(career.league.draftClass.includes(career.me)).toBe(false);
  });

  it('the forty line retires the euro descent, the ending china already had (issue #40)', async () => {
    const career = fixtureCareer({ seed: 'descent-forty' });
    const me = vetFreeAgent(career, 39); // 40 at the wrap: the career year advances first
    const draftBefore = JSON.stringify(me.draft);
    const euro = buildMyOffers(career).find(o => o.id.startsWith('abroad:euro:'))!;
    expect(applyChoice(career, { kind: 'acceptAbroadOffer', offerId: euro.id }).ok).toBe(true);

    offseason(career, 'euro');
    career.clock.week = career.params.tick.weeksPerYear - 1;
    const digest = await advanceCareerWeek(career, fastSim);

    expect(career.clock.phase).toBe('retired');
    expect(digest.phaseChangedTo).toBe('retired');
    expect(career.epilogue).not.toBe(null);
    expect(JSON.stringify(me.draft)).toBe(draftBefore); // retirement reads the real record
  });

  it('runs the same week the same way twice (determinism spine)', async () => {
    const a = offseason(fixtureCareer());
    const b = offseason(fixtureCareer());
    await advanceCareerWeek(a, fastSim);
    await advanceCareerWeek(b, fastSim);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.energy).toBe(b.energy);
    expect(a.league.day).toBe(b.league.day);
  });
});
