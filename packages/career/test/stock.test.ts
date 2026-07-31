/**
 * Stock-task tests: the shared prospect-perception primitive
 * (perception.ts) and the draft-stock machinery (stock.ts) - the weekly
 * mock ladder, move caps, the combine, workouts, and draft-class entry.
 * Scenarios are hand-built on the shared fixtureCareer (strong dials and
 * game rows set directly), matching the franchise people.test.ts
 * pattern. Modules are imported directly (not via the career barrel) so
 * this suite exercises exactly the stock task's files.
 */
import { describe, expect, it } from 'vitest';
import type { Attributes } from '@hoopsh/engine';
import type { FrPlayer, GameLine, TeamTotalsLite } from '@hoopsh/franchise';
import type { CareerState, CircuitGame } from '../src/types.js';
import { fixtureCareer } from './fixture.js';
import { GROUP_ORDER, perceiveProspect } from '../src/perception.js';
import { groupMean } from '../../franchise/src/people/dev.js';
import { attendWorkout, enterDraftClass, runCombineWeek, updateStock } from '../src/stock.js';

// ---------------------------------------------------------------------------
// scenario helpers

/** Make my fixture kid an unambiguous prospect: flat 80 dials, 90 ceilings. */
function strongMe(career: CareerState): void {
  const me = career.players[career.me]!;
  for (const k of Object.keys(me.attr) as Array<keyof Attributes>) me.attr[k] = 80;
  for (const g of GROUP_ORDER) me.potential[g] = 90;
}

let gameSeq = 0;

/** Hand-set one played circuit game for me at a given week with a given line. */
function addMyGame(
  career: CareerState, week: number, pts: number,
  type: CircuitGame['type'] = 'regular', round?: string,
): void {
  const c = career.circuit!;
  const my = c.teams[c.myTeamIdx]!;
  const oppIdx = (c.myTeamIdx + 1) % c.teams.length;
  const opp = c.teams[oppIdx]!;
  const id = `stocktest-w${week}-g${gameSeq++}`;
  const game: CircuitGame = { id, week, homeIdx: c.myTeamIdx, awayIdx: oppIdx, type };
  if (round) game.round = round;
  c.schedule.push(game);
  const totals: TeamTotalsLite = {
    pts: 86, fgm: 32, fga: 66, tpm: 8, tpa: 22, ftm: 14, fta: 18, orb: 9,
    drb: 24, ast: 17, stl: 6, blk: 3, tov: 11, pf: 16, pace: 70,
    fastbreakPts: 10, biggestLead: 12,
  };
  const line: GameLine = {
    playerId: career.me, teamId: my.id, starter: true, min: 30, pts,
    fgm: Math.floor(pts / 2), fga: 18, tpm: 2, tpa: 6, ftm: pts % 2, fta: 2,
    orb: 1, drb: 4, ast: 3, stl: 1, blk: 0, tov: 2, pf: 2, plusMinus: 6,
  };
  c.results[id] = {
    id, date: { season: c.year, day: week }, type: 'regular',
    home: my.id, away: opp.id, seed: `s-${id}`, final: [86, 74], ot: 0,
    lines: [line], totals: [totals, totals], keyPlays: [],
  };
}

// ---------------------------------------------------------------------------
// perception

describe('perceiveProspect', () => {
  it('is persistent and observer-keyed: same read twice, different scouts differ', () => {
    const career = fixtureCareer({ seed: 'stock-det' });
    const me = career.players[career.me]!;
    const a = perceiveProspect(career.seed, 12345, me, 40, career.params);
    // an unrelated read in between must not perturb (fresh streams, fixed draws)
    perceiveProspect(career.seed, 777, career.players[career.rivalId]!, 10, career.params);
    const b = perceiveProspect(career.seed, 12345, me, 40, career.params);
    expect(a).toEqual(b);
    const other = perceiveProspect(career.seed, 54321, me, 40, career.params);
    expect(other.now).not.toEqual(a.now);
  });

  it('coverage buys accuracy: full coverage shrinks the error but never to zero', () => {
    const career = fixtureCareer({ seed: 'stock-mae' });
    const kids = Object.keys(career.players).sort().map(id => career.players[id]!);
    const pros = Object.keys(career.league.players).sort()
      .slice(0, 40 - kids.length).map(id => career.league.players[id]!);
    const prospects: FrPlayer[] = [...kids, ...pros];
    expect(prospects.length).toBe(40);

    let minSeen = 100;
    let maxSeen = 0;
    const maeAt = (coverage: number): number => {
      let err = 0;
      let n = 0;
      for (const p of prospects) {
        const read = perceiveProspect(career.seed, 'mae-observer', p, coverage, career.params);
        for (const g of GROUP_ORDER) {
          err += Math.abs(read.now[g] - groupMean(p.attr, g));
          err += Math.abs(read.ceiling[g] - p.potential[g]);
          minSeen = Math.min(minSeen, read.now[g], read.ceiling[g]);
          maxSeen = Math.max(maxSeen, read.now[g], read.ceiling[g]);
          n += 2;
        }
      }
      return err / n;
    };
    const blind = maeAt(0);
    const covered = maeAt(100);
    expect(blind).toBeGreaterThan(covered); // more coverage, sharper read
    expect(covered).toBeGreaterThan(0);     // the draft stays a gamble
    expect(minSeen).toBeGreaterThanOrEqual(0);   // clamped to the rating scale
    expect(maxSeen).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// the weekly mock

describe('updateStock', () => {
  it('a strong season puts him on the board; climbs respect the caps and every move states a reason', () => {
    const career = fixtureCareer({ seed: 'stock-weekly' });
    const s = career.params.stock;
    strongMe(career);
    // six weeks of steady film, all under the shock line
    for (let i = 6; i >= 1; i--) addMyGame(career, career.clock.week - i, 18 + (i % 3));

    updateStock(career);
    const first = career.stock!.rank;
    expect(first).toBeTruthy(); // he appears
    expect(first!).toBeGreaterThanOrEqual(61 - s.weeklyMoveCap); // climbs in from past the board, capped
    expect(career.stock!.history.length).toBe(1);

    career.clock.week += 1;
    updateStock(career);
    const second = career.stock!.rank!;
    expect(second).toBeLessThan(first!); // still climbing toward the target
    expect(first! - second).toBeLessThanOrEqual(s.weeklyMoveCap);

    // shock week: a 40-point championship game outruns the weekly cap
    career.clock.week += 1;
    addMyGame(career, career.clock.week, 40, 'bracket', 'F');
    updateStock(career);
    const third = career.stock!.rank!;
    expect(second - third).toBeGreaterThan(s.weeklyMoveCap);
    expect(second - third).toBeLessThanOrEqual(s.shockMoveCap);
    const shockEntry = career.stock!.history[career.stock!.history.length - 1]!;
    expect(shockEntry.reason).toContain('40-point');

    // pillar 2: every entry carries a nonempty reason, every move an event
    let allExplained = true;
    for (const e of career.stock!.history) {
      if (e.reason.length === 0) allExplained = false;
    }
    expect(allExplained).toBe(true);
    const stockEvents = career.events.filter(e => e.kind === 'stock');
    expect(stockEvents.length).toBe(career.stock!.history.length);
  });

  it('the ladder goes quiet outside the journey phases', () => {
    const career = fixtureCareer({ seed: 'stock-quiet' });
    strongMe(career);
    career.clock.phase = 'nba';
    updateStock(career);
    expect(career.stock!.history.length).toBe(0);
    expect(Object.keys(career.stock!.perTeam).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// combine and workouts

describe('runCombineWeek', () => {
  it('publishes the tape measure, bumps every board, and books 3-6 workouts', () => {
    const career = fixtureCareer({ seed: 'stock-combine' });
    strongMe(career);
    for (let i = 4; i >= 1; i--) addMyGame(career, career.clock.week - i, 20);
    updateStock(career);

    runCombineWeek(career);
    const stock = career.stock!;
    expect(stock.combineDone).toBe(true);
    expect(stock.workoutInvites.length).toBeGreaterThanOrEqual(3);
    expect(stock.workoutInvites.length).toBeLessThanOrEqual(6);

    // the invites are the teams whose value of me runs highest
    const best = Object.keys(stock.perTeam)
      .sort((a, b) => stock.perTeam[b]! - stock.perTeam[a]! || a.localeCompare(b))[0]!;
    expect(stock.workoutInvites[0]).toBe(best);

    // the measurement story quotes the REAL numbers (the fog never applied to a tape measure)
    const me = career.players[career.me]!;
    const entry = stock.history[stock.history.length - 1]!;
    expect(entry.reason).toContain('at the combine');
    expect(entry.reason).toContain(`${Math.floor(me.heightIn / 12)}-${me.heightIn % 12}`);
    expect(entry.reason).toContain(`${Math.floor(me.wingspanIn / 12)}-${me.wingspanIn % 12}`);

    // the combine happens once
    const histLen = stock.history.length;
    runCombineWeek(career);
    expect(stock.history.length).toBe(histLen);
  });
});

describe('attendWorkout', () => {
  it('moves the invite to done, re-derives that team at higher coverage, and says which way it cut', () => {
    const career = fixtureCareer({ seed: 'stock-workout' });
    strongMe(career);
    for (let i = 4; i >= 1; i--) addMyGame(career, career.clock.week - i, 20);
    runCombineWeek(career);
    const stock = career.stock!;
    const target = stock.workoutInvites[0]!;

    attendWorkout(career, target);
    expect(stock.workoutsDone).toContain(target);
    expect(stock.workoutInvites.includes(target)).toBe(false);
    const ev = career.events[career.events.length - 1]!;
    expect(ev.kind).toBe('stock');
    expect(ev.reason).toContain('workout');

    // the bump persists: the weekly recompute derives the same coverage
    const stored = stock.perTeam[target]!;
    updateStock(career);
    expect(stock.perTeam[target]).toBe(stored);

    // no invite, no workout (fail-loud path)
    let threw = false;
    try {
      attendWorkout(career, 'no-such-team');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// draft entry (the fog handoff)

describe('enterDraftClass', () => {
  it('moves me and the rival into the league class with my seat protected', () => {
    const career = fixtureCareer({ seed: 'stock-entry' });
    const meId = career.me;
    const rivalId = career.rivalId;

    enterDraftClass(career);
    const league = career.league;
    expect(league.draftClass).toContain(meId);
    expect(league.draftClass).toContain(rivalId);
    expect(league.players[meId]!.status).toBe('draftEligible');
    expect(league.players[rivalId]!.status).toBe('draftEligible');
    expect(league.careerControlled ?? []).toContain(meId);
    expect((league.careerControlled ?? []).includes(rivalId)).toBe(false); // his life belongs to the sim
    expect(career.players[meId]).toBe(undefined); // moved, not copied (save-divergence trap)
    expect(career.players[rivalId]).toBe(undefined);

    // idempotent: one entry, one story
    const classLen = league.draftClass.length;
    const evLen = career.events.length;
    enterDraftClass(career);
    expect(league.draftClass.length).toBe(classLen);
    expect(career.events.length).toBe(evLen);
  });
});
