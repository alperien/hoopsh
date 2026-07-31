/**
 * The career spine: choice validation and logging, the week allocation
 * economy, the recovery clock, the world clock, and year-wrap phase
 * moves. Circuit play itself is the circuits suite; here the field is
 * empty or archived so the spine shows through.
 */
import { describe, expect, it } from 'vitest';
import { advanceCareerWeek, applyChoice } from '../src/tick.js';
import { resolveAllocation } from '../src/week.js';
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
