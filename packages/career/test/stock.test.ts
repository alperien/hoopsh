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
import type { FrPlayer, GameLine, TeamId, TeamTotalsLite } from '@hoopsh/franchise';
import type { CareerState, CircuitGame } from '../src/types.js';
import { fixtureCareer } from './fixture.js';
import { GROUP_ORDER, perceiveProspect } from '../src/perception.js';
import { groupMean } from '../../franchise/src/people/dev.js';
import {
  attendWorkout, enterDraftClass, productionIndex, runCombineWeek, updateStock,
} from '../src/stock.js';

// ---------------------------------------------------------------------------
// scenario helpers

/** Make my fixture kid an unambiguous prospect: flat 80 dials, 90 ceilings. */
function strongMe(career: CareerState): void {
  const me = career.players[career.me]!;
  for (const k of Object.keys(me.attr) as Array<keyof Attributes>) me.attr[k] = 80;
  for (const g of GROUP_ORDER) me.potential[g] = 90;
}

/** Flat dials at any level: mid-band prospects sit inside the consensus
 * band where the mock actually wobbles (a roofed 80s sheet pins pick 1). */
function setMe(career: CareerState, attr: number, pot: number): void {
  const me = career.players[career.me]!;
  for (const k of Object.keys(me.attr) as Array<keyof Attributes>) me.attr[k] = attr;
  for (const g of GROUP_ORDER) me.potential[g] = pot;
}

let gameSeq = 0;

/** Optional line/score overrides for perception-economy scenarios: shot
 * columns feed the efficiency leg of productionIndex, the final feeds
 * the circuit's scoring environment. */
interface GameOpts {
  shot?: Partial<Pick<GameLine, 'fgm' | 'fga' | 'tpm' | 'tpa' | 'ftm' | 'fta'>>;
  final?: [number, number];
}

/** Hand-set one played circuit game for me at a given week with a given line. */
function addMyGame(
  career: CareerState, week: number, pts: number,
  type: CircuitGame['type'] = 'regular', round?: string, opts: GameOpts = {},
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
  const shot = opts.shot ?? {};
  const line: GameLine = {
    playerId: career.me, teamId: my.id, starter: true, min: 30, pts,
    fgm: shot.fgm ?? Math.floor(pts / 2), fga: shot.fga ?? 18,
    tpm: shot.tpm ?? 2, tpa: shot.tpa ?? 6,
    ftm: shot.ftm ?? pts % 2, fta: shot.fta ?? 2,
    orb: 1, drb: 4, ast: 3, stl: 1, blk: 0, tov: 2, pf: 2, plusMinus: 6,
  };
  c.results[id] = {
    id, date: { season: c.year, day: week }, type: 'regular',
    home: my.id, away: opp.id, seed: `s-${id}`, final: opts.final ?? [86, 74], ot: 0,
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

// ---------------------------------------------------------------------------
// the perception economy (fix wave B): production in the read

describe('productionIndex and the production-blended read', () => {
  it('an inefficient chucker reads below an efficient scorer with the same sheet', () => {
    const mk = (shot: GameOpts['shot']): CareerState => {
      const career = fixtureCareer({ seed: 'stock-eff' });
      strongMe(career);
      gameSeq = 200; // identical game ids across the pair: identical streams
      for (let i = 5; i >= 1; i--) {
        addMyGame(career, career.clock.week - i, 22, 'regular', undefined, { shot, final: [60, 52] });
      }
      updateStock(career);
      return career;
    };
    // 22 points each: the chucker needs 26 shots (fg 30.8%), the scorer 16 (fg 56.3%)
    const chucker = mk({ fgm: 8, fga: 26, ftm: 4, fta: 5, tpm: 2, tpa: 10 });
    const scorer = mk({ fgm: 9, fga: 16, ftm: 2, fta: 3, tpm: 2, tpa: 5 });

    const prodChucker = productionIndex(chucker)!;
    const prodScorer = productionIndex(scorer)!;
    expect(prodChucker.ts!).toBeLessThan(0.45); // the shot diet is the difference...
    expect(prodScorer.ts!).toBeGreaterThan(0.55);
    expect(prodChucker.ppg).toBe(prodScorer.ppg); // ...volume is not
    expect(prodScorer.index - prodChucker.index).toBeGreaterThan(15);

    // and it lands in the perceived value every war room holds
    const teamIds = Object.keys(chucker.stock!.perTeam).sort();
    let better = 0;
    for (const tid of teamIds) {
      if (scorer.stock!.perTeam[tid]! > chucker.stock!.perTeam[tid]!) better += 1;
    }
    expect(better).toBe(teamIds.length); // every single team, same fog, different tape
    const mean = (c: CareerState): number => {
      const vs = Object.values(c.stock!.perTeam);
      return vs.reduce((a, b) => a + b, 0) / vs.length;
    };
    expect(mean(scorer) - mean(chucker)).toBeGreaterThan(2); // visibly worse, not a rounding hair
  });

  it('same seed: a hot 3-game stretch moves the rank up, a cold one down, reasons quoting form', () => {
    const base = fixtureCareer({ seed: 'form-A' });
    setMe(base, 62, 72);
    for (let i = 6; i >= 1; i--) {
      addMyGame(base, base.clock.week - i, 15, 'regular', undefined, {
        shot: { fgm: 6, fga: 13, ftm: 3, fta: 4 }, final: [60, 52],
      });
    }
    // let the ladder settle on the steady-15 read first
    for (let w = 0; w < 10; w++) {
      updateStock(base);
      base.clock.week += 1;
    }
    const settled = base.stock!.rank!;
    expect(settled).toBeTruthy();

    const hot = structuredClone(base);
    const cold = structuredClone(base);
    gameSeq = 100;
    for (let i = 0; i < 3; i++) {
      addMyGame(hot, hot.clock.week, 27, 'regular', undefined, {
        shot: { fgm: 11, fga: 17, ftm: 3, fta: 4 }, final: [60, 52],
      });
    }
    gameSeq = 100; // same ids: the hot and cold forks differ ONLY in the lines
    for (let i = 0; i < 3; i++) {
      addMyGame(cold, cold.clock.week, 4, 'regular', undefined, {
        shot: { fgm: 2, fga: 15, ftm: 0, fta: 0 }, final: [60, 52],
      });
    }
    for (const fork of [hot, cold]) {
      updateStock(fork);
      fork.clock.week += 1;
      updateStock(fork); // two weeks: the capped walk shows its direction
    }

    expect(hot.stock!.rank!).toBeLessThan(settled);  // form up, boards up
    expect(cold.stock!.rank!).toBeGreaterThan(settled); // form down, boards down
    expect(hot.stock!.rank!).toBeLessThan(cold.stock!.rank!);

    // the stated reasons quote the form window, not vibes (pillar 2)
    const hotReason = hot.stock!.history[hot.stock!.history.length - 1]!.reason;
    const coldReason = cold.stock!.history[cold.stock!.history.length - 1]!.reason;
    expect(/games travel: .* a night/.test(hotReason)).toBe(true);
    expect(hotReason).toContain('true shooting');
    expect(/tape cooled|slump/.test(coldReason)).toBe(true);
    expect(coldReason).toContain('a night');
  });
});

// ---------------------------------------------------------------------------
// feed hygiene (fix wave B)

describe('stock feed hygiene', () => {
  it('sub-3-pick moves stay in the history but push no events; bigger moves print', () => {
    const career = fixtureCareer({ seed: 'quiet-A' });
    setMe(career, 62, 72); // mid-band: the ladder wobbles around its slot
    for (let i = 6; i >= 1; i--) {
      addMyGame(career, career.clock.week - i, 14 + (i % 2), 'regular', undefined, {
        shot: { fgm: 6, fga: 12, ftm: 2, fta: 3 }, final: [60, 52],
      });
    }
    for (let w = 0; w < 18; w++) {
      updateStock(career);
      career.clock.week += 1;
    }

    const hist = career.stock!.history;
    const events = career.events.filter(e => e.kind === 'stock');
    // classify every history move; no shocks exist in this scenario (no
    // current-week games, no injury, no combine)
    let sub3 = 0;
    let big = 0;
    for (let i = 1; i < hist.length; i++) {
      const a = hist[i - 1]!.rank;
      const b = hist[i]!.rank;
      if (a !== null && b !== null && Math.abs(a - b) < 3) sub3 += 1;
      else big += 1;
    }
    expect(sub3).toBeGreaterThanOrEqual(2); // the wobble happened (the old code printed all of it)
    expect(big).toBeGreaterThanOrEqual(1);
    // the ledger balances exactly: first appearance + every 3-plus move
    // printed, every sub-3 move did not
    expect(events.length).toBe(1 + big);
    expect(events.length).toBeLessThan(hist.length);

    // and no printed event carries a sub-3 reason: every event's reason
    // exists in the history (the event is the entry, curated)
    for (const ev of events) {
      expect(hist.some(h => h.reason === ev.reason)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// mock-vs-board convergence (fix wave B)

describe('draftPrep board convergence', () => {
  it('with a live class visible, the mock converges to the war rooms own sort', () => {
    const career = fixtureCareer({ seed: 'prep-A' });
    setMe(career, 55, 65);
    career.clock.phase = 'draftPrep';
    career.circuit = null;
    career.circuitHistory.push({
      year: 2026, kind: 'hs', teamName: 'Oak Ridge Central', w: 12, l: 2,
      myLine: { gp: 14, min: 392, pts: 210, reb: 60, ast: 40, stl: 14, blk: 6, tpm: 20, fgPct: 0.52 },
      finish: 'state champion', honors: [],
    });
    // plant a live class of 25 clearly worse prospects (floored dials):
    // the boards must sort me to the top even though the season consensus
    // band alone would park a 55-flat sheet in the teens
    const league = career.league;
    for (const pid of Object.keys(league.players).sort().slice(0, 25)) {
      const p = league.players[pid]!;
      p.status = 'draftEligible';
      for (const k of Object.keys(p.attr) as Array<keyof Attributes>) p.attr[k] = 30;
      for (const g of GROUP_ORDER) p.potential[g] = 35;
      league.draftClass.push(pid);
    }
    career.stock!.combineDone = true;
    career.clock.week = career.params.tick.combineWeek + 1;

    for (let w = 0; w < 16 && career.clock.week < 52; w++) {
      updateStock(career);
      career.clock.week += 1;
    }

    // only the rival can plausibly sit ahead: the mock found the boards
    expect(career.stock!.rank!).toBeLessThanOrEqual(3);
    const reasons = career.stock!.history.map(h => h.reason);
    expect(reasons.some(r => r.includes('pre-draft boards tighten'))).toBe(true);
  });
});

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

  it('never re-enters a file the league already owns (the abroad dual-pool binding, issue #40)', () => {
    const career = fixtureCareer({ seed: 'stock-descent' });
    const league = career.league;
    const me = career.players[career.me]!;
    // a descent veteran abroad: applyAbroadOffer keeps ONE object in BOTH
    // pools - the league file carrying real draft history, and the career
    // map so the circuit machinery can find me (nbabridge.ts)
    me.status = 'freeAgent';
    me.contract = null;
    me.rights = null;
    me.bornSeason = league.season - 34;
    me.draft = { season: league.season - 12, round: 1, pick: 12, teamId: Object.keys(league.teams).sort()[0]! as TeamId };
    league.players[career.me] = me;
    league.careerControlled = [career.me];
    career.clock.phase = 'euro';
    career.nbaTeam = null;
    const draftBefore = JSON.stringify(me.draft);

    enterDraftClass(career);
    expect(me.status).toBe('freeAgent');                       // not flipped to draftEligible
    expect(league.draftClass.includes(career.me)).toBe(false); // a veteran is not on the boards
    expect(career.players[career.me]).toBe(me);                // the abroad binding survives
    expect(JSON.stringify(me.draft)).toBe(draftBefore);        // history untouched
    // the rival's own first entry still works next to the skip
    expect(league.draftClass).toContain(career.rivalId);
    expect(league.players[career.rivalId]!.status).toBe('draftEligible');
  });
});
