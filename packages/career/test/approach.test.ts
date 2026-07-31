/**
 * The agency core: the approach card as a real projection, the plan, the
 * coach ledger, and THE reacting-world invariant (docs/CAREER.md pillar 1
 * with a hard gate here, not a tuning hope).
 */
import { describe, expect, it } from 'vitest';
import type { GameRecord } from '@hoopsh/franchise';
import { applyApproach, applyLegs, deviationFrom, legsDebuffAt, planFor } from '../src/approach.js';
import { productionScore, updateAfterGame } from '../src/trust.js';
import type { ApproachCard } from '../src/types.js';
import { fixtureCareer } from './fixture.js';

const neutral: ApproachCard = { assertiveness: 50, range: 50, motor: 50, defense: 50, playmaking: 50 };

function mkRecord(career: ReturnType<typeof fixtureCareer>, id: string, mine: Partial<GameRecord['lines'][number]>): GameRecord {
  const base = {
    playerId: career.me, teamId: 'hs-oakridge', starter: true, min: 30,
    pts: 12, fgm: 5, fga: 11, tpm: 1, tpa: 3, ftm: 1, fta: 2,
    orb: 1, drb: 4, ast: 3, stl: 1, blk: 0, tov: 2, pf: 2, plusMinus: 4,
  };
  const totals = {
    pts: 60, fgm: 24, fga: 55, tpm: 5, tpa: 16, ftm: 7, fta: 10, orb: 8,
    drb: 20, ast: 14, stl: 5, blk: 2, tov: 9, pf: 12, pace: 66, fastbreakPts: 8, biggestLead: 9,
  };
  return {
    id, date: { season: career.clock.year, day: 0 }, type: 'regular',
    home: 'hs-oakridge', away: 'hs-westfield', seed: 'g',
    final: [62, 58], ot: 0,
    lines: [{ ...base, ...mine }],
    totals: [totals, { ...totals, pts: 58 }],
    keyPlays: [],
  };
}

describe('the approach card is a real projection', () => {
  const career = fixtureCareer();
  const me = career.players[career.me]!;

  it('moves the tendencies the dial names, and only tendencies', () => {
    const letFly = applyApproach(me, { ...neutral, range: 100 }, career.params);
    expect(letFly.tend.shotThree).toBeGreaterThan(me.tend.shotThree);
    expect(letFly.tend.pullUp).toBeGreaterThan(me.tend.pullUp);
    expect(letFly.tend.shotRim).toBeLessThan(me.tend.shotRim);
    expect(letFly.attr.three).toBe(me.attr.three); // the card changes attempts, not ability

    const takeOver = applyApproach(me, { ...neutral, assertiveness: 100 }, career.params);
    expect(takeOver.tend.usage).toBeGreaterThan(me.tend.usage);
    const defer = applyApproach(me, { ...neutral, assertiveness: 0 }, career.params);
    expect(defer.tend.usage).toBeLessThan(me.tend.usage);
  });

  it('never mutates the source player', () => {
    const before = JSON.stringify(me);
    applyApproach(me, { ...neutral, motor: 100, playingHurt: true }, career.params);
    expect(JSON.stringify(me)).toBe(before);
  });

  it('playing hurt dulls the whole sheet for the night', () => {
    const hurt = applyApproach(me, { ...neutral, playingHurt: true }, career.params);
    expect(hurt.attr.three).toBe(Math.max(0, me.attr.three - career.params.trust.playHurtDialDebuff));
    expect(hurt.attr.perimeterD).toBeLessThan(me.attr.perimeterD);
  });

  it('the playmaking dial trades my shots for the extra pass (felt-loop wiring)', () => {
    const pm = applyApproach(me, { ...neutral, playmaking: 70 }, career.params);
    expect(pm.tend.passOut).toBeGreaterThan(me.tend.passOut);
    expect(pm.tend.usage).toBeLessThan(me.tend.usage);   // the extra pass costs MY shots
    expect(pm.tend.iso).toBeLessThanOrEqual(me.tend.iso); // clear-outs are the anti-pass
    // at the extreme the swing is the full wired fraction of the max
    const maxed = applyApproach(me, { ...neutral, playmaking: 100 }, career.params);
    const max = career.params.trust.approachTendencyMax;
    expect(maxed.tend.passOut - me.tend.passOut).toBe(Math.min(100, me.tend.passOut + Math.round(1.2 * max)) - me.tend.passOut);
  });

  it('the range dial also starves the long two (shotMid down)', () => {
    const letFly = applyApproach(me, { ...neutral, range: 100 }, career.params);
    expect(letFly.tend.shotMid).toBeLessThan(me.tend.shotMid);
  });
});

describe('tired legs on the floor (energy debuff)', () => {
  const career = fixtureCareer();
  const me = career.players[career.me]!;
  const p = career.params;

  it('is zero at or above the legs floor, linear below, full at empty', () => {
    const floor = p.week.energyLegsFloor;
    const debuff = p.week.energyLegsDebuff;
    expect(legsDebuffAt(floor, p)).toBe(0);
    expect(legsDebuffAt(100, p)).toBe(0);
    expect(legsDebuffAt(0, p)).toBe(debuff);
    expect(legsDebuffAt(floor / 2, p)).toBe(debuff / 2); // exact: 8 * (40-20) / 40
  });

  it('dulls every attribute and only attributes, never mutating the source', () => {
    const before = JSON.stringify(me);
    const tired = applyLegs(me, 0, p);
    expect(JSON.stringify(me)).toBe(before);
    expect(tired.attr.three).toBe(Math.max(0, me.attr.three - p.week.energyLegsDebuff));
    expect(tired.attr.speed).toBe(Math.max(0, me.attr.speed - p.week.energyLegsDebuff));
    expect(tired.tend).toEqual(me.tend); // a tired player still wants his game
    const fresh = applyLegs(me, 80, p);
    expect(fresh.attr).toEqual(me.attr); // no-op copy above the floor
  });
});

describe('the plan and deviation', () => {
  const career = fixtureCareer();

  it('widens with the role and the green light', () => {
    career.coach.role = 'rotation';
    const tight = planFor(career);
    career.coach.role = 'franchise';
    const wide = planFor(career);
    const width = (r: [number, number]) => r[1] - r[0];
    expect(width(wide.assertiveness)).toBeGreaterThan(width(tight.assertiveness));
    career.coach.greenLight = true;
    const green = planFor(career);
    expect(width(green.range)).toBeGreaterThan(width(wide.range));
    career.coach.greenLight = false;
    career.coach.role = 'starter';
  });

  it('scores deviation as overflow beyond the ranges', () => {
    const plan = planFor(career);
    expect(deviationFrom(plan, { ...neutral })).toBe(0);
    const wild: ApproachCard = { assertiveness: 100, range: 100, motor: 50, defense: 50, playmaking: 50 };
    expect(deviationFrom(plan, wild)).toBeGreaterThan(30);
  });
});

describe('the coach ledger and THE invariant', () => {
  it('reacts to sustained production within reactGames, unconditionally', () => {
    const career = fixtureCareer();
    career.coach.role = 'rotation';
    career.coach.trust = 20; // low trust MUST NOT block the invariant
    const n = career.params.trust.reactGames;
    for (let i = 0; i < n; i++) {
      const record = mkRecord(career, `g-hot-${i}`, { pts: 28, ast: 5, tov: 1, min: 24 });
      const grade = updateAfterGame(career, record);
      expect(grade.production).toBeGreaterThanOrEqual(career.params.trust.promoteAt);
    }
    expect(career.coach.role).toBe('sixthMan');
    expect(career.events.some(e => e.kind === 'role' && e.reason.includes('outproduced'))).toBe(true);
  });

  it('shrinks the job the same way', () => {
    const career = fixtureCareer();
    career.coach.role = 'starter';
    const n = career.params.trust.reactGames;
    for (let i = 0; i < n; i++) {
      updateAfterGame(career, mkRecord(career, `g-cold-${i}`, { pts: 2, ast: 0, tov: 4, min: 18 }));
    }
    expect(career.coach.role).toBe('sixthMan');
  });

  it('grades adherence against the plan and explains every trust move', () => {
    const career = fixtureCareer();
    career.nextApproach = { assertiveness: 100, range: 100, motor: 50, defense: 50, playmaking: 50 };
    const grade = updateAfterGame(career, mkRecord(career, 'g-dev', { pts: 8 }));
    expect(grade.adherence).toBeLessThan(70);
    expect(grade.trustDelta).toBeLessThan(0);
    expect(grade.note.length).toBeGreaterThan(0);
    expect(career.nextApproach).toBe(null); // the card was for that game
    for (const e of career.events.filter(e => e.kind === 'trust')) {
      expect(e.reason.length).toBeGreaterThan(0); // the explained-consequence lint
    }
  });

  it('does not grade a DNP', () => {
    const career = fixtureCareer();
    const record = mkRecord(career, 'g-dnp', {});
    record.lines = []; // never got in
    const grade = updateAfterGame(career, record);
    expect(grade.note).toContain('did not play');
    expect(career.coach.roleClock.above).toBe(0);
  });

  it('scores production against the role par', () => {
    const career = fixtureCareer();
    career.coach.role = 'garbage';
    const asGarbage = productionScore(career, mkRecord(career, 'g-par-1', { pts: 12 }));
    career.coach.role = 'franchise';
    const asFranchise = productionScore(career, mkRecord(career, 'g-par-2', { pts: 12 }));
    expect(asGarbage).toBeGreaterThan(asFranchise); // 12 points is a feast for one job, a famine for the other
  });
});

describe('honest weekly grading: the card the game simulated with is the card judged', () => {
  it('grades EVERY game of the week against the explicit card, without consuming nextApproach', () => {
    const career = fixtureCareer();
    const wild: ApproachCard = { assertiveness: 100, range: 100, motor: 50, defense: 50, playmaking: 50 };
    career.nextApproach = { ...wild };
    // a doubleheader: two grades, one card (week.ts passes it explicitly)
    const g1 = updateAfterGame(career, mkRecord(career, 'g-dh-1', { pts: 14 }), wild);
    const g2 = updateAfterGame(career, mkRecord(career, 'g-dh-2', { pts: 11 }), wild);
    expect(g1.adherence).toBe(g2.adherence); // no 0/100 alternation (the measured dishonesty)
    expect(g1.adherence).toBeLessThan(70);   // the off-plan card is judged both nights
    expect(career.nextApproach).not.toBe(null); // the explicit-card path never consumes it
    expect(career.nextApproach?.assertiveness).toBe(100);
  });

  it('keeps the legacy consume-nextApproach path when no card is passed (the NBA bridge contract)', () => {
    const career = fixtureCareer();
    career.nextApproach = { assertiveness: 100, range: 100, motor: 50, defense: 50, playmaking: 50 };
    const g1 = updateAfterGame(career, mkRecord(career, 'g-legacy-1', { pts: 14 }));
    expect(g1.adherence).toBeLessThan(70);
    expect(career.nextApproach).toBe(null); // consumed, the old semantics
  });
});

describe('efficiency in the grade (the chucker tax)', () => {
  it('reads a 33% chucker below a 58% scorer at equal volume', () => {
    const career = fixtureCareer();
    const chucker = productionScore(career, mkRecord(career, 'g-chuck', {
      pts: 9, fgm: 4, fga: 12, tpm: 0, tpa: 2, ftm: 1, fta: 2,
    }));
    const scorer = productionScore(career, mkRecord(career, 'g-eff', {
      pts: 17, fgm: 7, fga: 12, tpm: 1, tpa: 3, ftm: 2, fta: 2,
    }));
    expect(chucker).toBeLessThan(scorer);
  });

  it('the coach names the tax when it bites: real volume, empty points', () => {
    const career = fixtureCareer();
    const grade = updateAfterGame(career, mkRecord(career, 'g-brick', {
      pts: 9, fgm: 4, fga: 12, tpm: 0, tpa: 4, ftm: 1, fta: 2,
    }));
    expect(grade.note).toContain('12 shots for 9 points is not a plan');
    // an efficient night never hears it
    const clean = updateAfterGame(career, mkRecord(career, 'g-clean', {
      pts: 17, fgm: 7, fga: 12, tpm: 1, tpa: 3, ftm: 2, fta: 2,
    }));
    expect(clean.note).not.toContain('is not a plan');
  });
});

describe('circuit-true role pars (the invariant can fire in high school)', () => {
  /** A circuit-scoring-leader night at measured HS levels (~16 with trimmings). */
  const strongNight = {
    pts: 16, fgm: 6, fga: 12, tpm: 2, tpa: 5, ftm: 2, fta: 3,
    orb: 1, drb: 4, ast: 3, stl: 1, blk: 0, tov: 2, min: 24,
  };

  it('a strong HS season replayed through the ledger produces a role move within reactGames', () => {
    const career = fixtureCareer(); // circuit.kind === 'hs' by construction
    expect(career.circuit?.kind).toBe('hs');
    const n = career.params.trust.reactGames;
    for (let i = 0; i < n; i++) {
      const grade = updateAfterGame(career, mkRecord(career, `g-hs-strong-${i}`, strongNight));
      expect(grade.production).toBeGreaterThanOrEqual(career.params.trust.promoteAt);
    }
    expect(career.coach.role).toBe('featured'); // starter -> featured, earned on prep production
    expect(career.events.some(e => e.kind === 'role' && e.delta === 1)).toBe(true);
  });

  it('the same line under NBA pars stays a quiet night (the scale is the circuit)', () => {
    const career = fixtureCareer();
    career.circuit = null; // the NBA phase grades at scale 1.0
    const prod = productionScore(career, mkRecord(career, 'g-nba-par', strongNight));
    expect(prod).toBeLessThan(career.params.trust.promoteAt);
  });

  it('a bad HS stretch can reach demoteAt (the ladder moves both ways in prep)', () => {
    const career = fixtureCareer();
    const prod = productionScore(career, mkRecord(career, 'g-hs-awful', {
      pts: 2, fgm: 1, fga: 9, tpm: 0, tpa: 3, ftm: 0, fta: 0,
      orb: 0, drb: 1, ast: 0, stl: 0, blk: 0, tov: 4, min: 20,
    }));
    expect(prod).toBeLessThanOrEqual(career.params.trust.demoteAt);
  });
});
