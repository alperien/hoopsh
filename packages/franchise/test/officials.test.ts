/**
 * Officials tests: crew pool generation, deterministic assignment,
 * bounded mechanical influence, the legal engine seam, visibility
 * strings, and graceful absence.
 *
 * COMPUTE BUDGET: engine games are the expensive part (~0.3-0.9 s each);
 * this file simulates exactly 8 (2 for the neutral-override identity
 * pair, 6 for the locked-seed free-throw direction check). Everything
 * else is pure state.
 *
 * These tests exercise officials.ts DIRECTLY against fixture leagues.
 * None of them depend on the INTEGRATION-officials.md patches being
 * applied: League.officials and GameRecord.officials are written through
 * the same tolerant casts the module itself uses.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, simulateGame, withParams } from '@hoopsh/engine';
import type { GameRecord, League, ScheduledGame, TeamTotalsLite } from '../src/types.js';
import {
  DEFAULT_OFFICIALS_PARAMS, crewAttrDelta, crewForGame, dayAssignments,
  gameTightness, initOfficials, officialsJobExtras, officialsNewsFor,
  officialsParamsOf, officialsRecapLine, officialsStamp, officialsStateOf,
  officiatingParamsFor,
} from '../src/officials.js';
import type { GameOfficials, OfficialsParams, OfficialsState, RefCrew } from '../src/officials.js';
import { projectTeam } from '../src/gameday.js';
import { fixtureLeague } from './fixture.js';

// ---------------------------------------------------------------- helpers

/** Write officials state through the same tolerant cast the module reads with. */
function setOfficials(league: League, state: OfficialsState): void {
  (league as League & { officials?: OfficialsState }).officials = state;
}

/**
 * Write the officials params section as a Partial, through the same tolerant
 * shape officialsParamsOf reads (the real FranchiseParams field requires all
 * four members; the module defaults whatever the section leaves out).
 */
function setOfficialsParams(league: League, section: Partial<OfficialsParams>): void {
  (league.params as { officials?: Partial<OfficialsParams> }).officials = section;
}

function scheduled(league: League, id: string, day: number, home: string, away: string): ScheduledGame {
  const g: ScheduledGame = { id, date: { season: league.season, day }, type: 'regular', home, away };
  league.schedule.push(g);
  return g;
}

/** League with a schedule of `days` two-game days and a generated crew pool. */
function officiatedLeague(days: number): { league: League; teamIds: string[] } {
  const league = fixtureLeague({ teams: 4, seed: 'officials-test' });
  const teamIds = Object.keys(league.teams);
  for (let d = 1; d <= days; d++) {
    scheduled(league, `s2026-d${d}-${teamIds[1]}@${teamIds[0]}`, d, teamIds[0]!, teamIds[1]!);
    scheduled(league, `s2026-d${d}-${teamIds[3]}@${teamIds[2]}`, d, teamIds[2]!, teamIds[3]!);
  }
  setOfficials(league, initOfficials(league.seed, league.params));
  return { league, teamIds };
}

function liteTotals(fta: number): TeamTotalsLite {
  return {
    pts: 100, fgm: 38, fga: 82, tpm: 11, tpa: 31, ftm: Math.max(0, fta - 3), fta,
    orb: 10, drb: 31, ast: 24, stl: 7, blk: 4, tov: 13, pf: 19,
    pace: 99, fastbreakPts: 12, biggestLead: 9,
  };
}

function recordShell(
  league: League, id: string, fta: [number, number], officials?: GameOfficials,
): GameRecord {
  const sched = league.schedule.find((g) => g.id === id)!;
  const record: GameRecord = {
    id, date: sched.date, type: 'regular', home: sched.home, away: sched.away,
    seed: 'shell', final: [101, 99], ot: 0, lines: [], keyPlays: [],
    totals: [liteTotals(fta[0]), liteTotals(fta[1])],
  };
  // stamped through the same tolerant cast the module reads with (the
  // GameRecord.officials field lands by integration patch)
  if (officials) (record as GameRecord & { officials?: GameOfficials }).officials = officials;
  return record;
}

function crafted(over: Partial<RefCrew>): RefCrew {
  return { id: 'crew-x', names: ['Voss', 'Hale', 'Bright'], tightness: 50, homeLean: 50, consistency: 80, ...over };
}

const NO_DASH = (s: string): boolean => !s.includes('—') && !s.includes('–');

// --------------------------------------------------------------- the pool

describe('crew pool generation', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = initOfficials('pool-seed');
    const b = initOfficials('pool-seed');
    const c = initOfficials('other-seed');
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('generates the default pool with well-formed crews', () => {
    const { crews } = initOfficials('pool-seed');
    expect(crews.length).toBe(DEFAULT_OFFICIALS_PARAMS.crewCount);
    const ids = new Set(crews.map((c) => c.id));
    expect(ids.size).toBe(crews.length);
    const chiefs = new Set(crews.map((c) => c.names[0]));
    expect(chiefs.size).toBe(crews.length);
    for (const crew of crews) {
      expect(new Set(crew.names).size).toBe(3);
      for (const t of [crew.tightness, crew.homeLean, crew.consistency]) {
        expect(t).toBeGreaterThanOrEqual(5);
        expect(t).toBeLessThanOrEqual(95);
        expect(Number.isInteger(t)).toBe(true);
      }
    }
  });

  it('clamps requested crew counts into the working range', () => {
    expect(initOfficials('s', { officials: { crewCount: 1 } }).crews.length).toBe(4);
    expect(initOfficials('s', { officials: { crewCount: 99 } }).crews.length).toBe(32);
    expect(initOfficials('s', { officials: { crewCount: Number.NaN } }).crews.length).toBe(DEFAULT_OFFICIALS_PARAMS.crewCount);
  });
});

// ------------------------------------------------------------- the params

describe('officialsParamsOf', () => {
  it('returns shipped defaults for a league without the params section', () => {
    const league = fixtureLeague({ seed: 'p' });
    expect(officialsParamsOf(league)).toEqual(DEFAULT_OFFICIALS_PARAMS);
  });

  it('hard-caps every magnitude against hand edits and sweeps', () => {
    const league = fixtureLeague({ seed: 'p' });
    setOfficialsParams(league, { crewCount: 1000, tightnessFoulSwing: 5, leanRoadDebuffMax: 50, tightnessJitter: 999 });
    const p = officialsParamsOf(league);
    expect(p.crewCount).toBe(32);
    expect(p.tightnessFoulSwing).toBe(0.10);
    expect(p.leanRoadDebuffMax).toBe(1.1);
    expect(p.tightnessJitter).toBe(20);
  });

  it('backfills non-finite hand edits with defaults', () => {
    const league = fixtureLeague({ seed: 'p' });
    setOfficialsParams(league, { tightnessFoulSwing: Number.NaN, leanRoadDebuffMax: undefined });
    const p = officialsParamsOf(league);
    expect(p.tightnessFoulSwing).toBe(DEFAULT_OFFICIALS_PARAMS.tightnessFoulSwing);
    expect(p.leanRoadDebuffMax).toBe(DEFAULT_OFFICIALS_PARAMS.leanRoadDebuffMax);
  });
});

// --------------------------------------------------------------- assigning

describe('crew assignment', () => {
  it('crews every scheduled game, deterministically, over a long slate', () => {
    const { league } = officiatedLeague(100);
    const state = officialsStateOf(league)!;
    const load = new Map<string, number>();
    for (let d = 1; d <= 100; d++) {
      const rows = dayAssignments(league, league.season, d);
      expect(rows.length).toBe(2);
      // fresh derivation matches (pure function of seed and slate)
      expect(dayAssignments(league, league.season, d)).toEqual(rows);
      // no crew works two games in one night
      expect(new Set(rows.map((r) => r.crewId)).size).toBe(rows.length);
      for (const row of rows) {
        load.set(row.crewId, (load.get(row.crewId) ?? 0) + 1);
        const crew = crewForGame(league, row.gameId);
        expect(crew).toBeDefined();
        expect(crew!.id).toBe(row.crewId);
      }
    }
    // every game crewed exactly once: loads sum to the slate
    let total = 0;
    for (const v of load.values()) total += v;
    expect(total).toBe(200);
    // roughly balanced: with a fresh shuffle per day every crew's expected
    // load is identical (200 games / 20 crews = 10); the bounds are loose
    // on purpose and deterministic for this seed
    const mean = 200 / state.crews.length;
    for (const crew of state.crews) {
      const worked = load.get(crew.id) ?? 0;
      expect(worked).toBeGreaterThanOrEqual(1);
      expect(worked).toBeLessThanOrEqual(mean * 3);
    }
  });

  it('is order-independent: any game resolves the same crew in isolation', () => {
    const { league } = officiatedLeague(5);
    const forward = league.schedule.map((g) => crewForGame(league, g.id)!.id);
    const backward = [...league.schedule].reverse().map((g) => crewForGame(league, g.id)!.id).reverse();
    expect(forward).toEqual(backward);
  });

  it('returns null for games not on the books', () => {
    const { league } = officiatedLeague(2);
    expect(crewForGame(league, 'no-such-game')).toBe(null);
  });
});

// ------------------------------------------------------ bounded influence

describe('tightness and jitter', () => {
  it('a consistency-100 crew repeats its own whistle exactly', () => {
    const { league } = officiatedLeague(2);
    const crew = crafted({ tightness: 71, consistency: 100 });
    expect(gameTightness(league, league.schedule[0]!.id, crew)).toBe(71);
  });

  it('a low-consistency crew wanders inside the jitter bound, deterministically', () => {
    const { league } = officiatedLeague(30);
    const crew = crafted({ tightness: 50, consistency: 0 });
    const p = officialsParamsOf(league);
    let moved = false;
    for (const g of league.schedule) {
      const t = gameTightness(league, g.id, crew);
      expect(t).toBe(gameTightness(league, g.id, crew));
      expect(Math.abs(t - crew.tightness)).toBeLessThanOrEqual(p.tightnessJitter);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(100);
      if (t !== crew.tightness) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('stays inside 0-100 even for forced extreme crews', () => {
    const { league } = officiatedLeague(2);
    for (const crew of [crafted({ tightness: 100, consistency: 0 }), crafted({ tightness: 0, consistency: 0 })]) {
      for (const g of league.schedule) {
        const t = gameTightness(league, g.id, crew);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('crewAttrDelta (homeLean through the HCA seam)', () => {
  it('is zero for the home side and signed by lean for the road side', () => {
    const { league } = officiatedLeague(2);
    const gid = league.schedule[0]!.id;
    const p = officialsParamsOf(league);
    for (const [lean, want] of [[100, p.leanRoadDebuffMax], [0, -p.leanRoadDebuffMax], [50, 0]] as const) {
      setOfficials(league, { crews: [crafted({ homeLean: lean })] });
      expect(crewAttrDelta(league, gid, true)).toBe(0);
      expect(crewAttrDelta(league, gid, false)).toBe(want);
    }
  });

  it('never exceeds the hard cap, even under hand-edited params', () => {
    const { league } = officiatedLeague(2);
    setOfficialsParams(league, { leanRoadDebuffMax: 50 });
    setOfficials(league, { crews: [crafted({ homeLean: 100 })] });
    const delta = crewAttrDelta(league, league.schedule[0]!.id, false);
    expect(Math.abs(delta)).toBeLessThanOrEqual(1.1);
  });

  it('stays a small fraction of the baseline HCA debuff at defaults', () => {
    const { league } = officiatedLeague(2);
    const p = officialsParamsOf(league);
    expect(p.leanRoadDebuffMax).toBeLessThan(league.params.hca.roadAttrDebuff / 2);
  });
});

describe('officiatingParamsFor (foul-zone override)', () => {
  it('scales all four shooting-foul zones by one symmetric multiplier', () => {
    const { league } = officiatedLeague(2);
    const gid = league.schedule[0]!.id;
    setOfficials(league, { crews: [crafted({ tightness: 100, consistency: 100 })] });
    const ov = officiatingParamsFor(league, gid)!;
    const f = defaultParams.foul;
    const zones: Array<[number, number]> = [
      [ov.foul!.shootRim!, f.shootRim], [ov.foul!.shootPaint!, f.shootPaint],
      [ov.foul!.shootMid!, f.shootMid], [ov.foul!.shootThree!, f.shootThree],
    ];
    for (const [got, base] of zones) {
      expect(Math.abs(got / base - 1.1)).toBeLessThan(1e-9);
    }
  });

  it('caps the relative swing at 10 percent both ways, whatever the params say', () => {
    const { league } = officiatedLeague(2);
    const gid = league.schedule[0]!.id;
    setOfficialsParams(league, { tightnessFoulSwing: 5 });
    for (const tightness of [0, 100]) {
      setOfficials(league, { crews: [crafted({ tightness, consistency: 100 })] });
      const mult = officiatingParamsFor(league, gid)!.foul!.shootRim! / defaultParams.foul.shootRim;
      expect(mult).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(mult).toBeLessThanOrEqual(1.1 + 1e-9);
    }
  });

  it('merges through the engine boundary without touching other foul params', () => {
    const { league } = officiatedLeague(2);
    const ov = officiatingParamsFor(league, league.schedule[0]!.id)!;
    const merged = withParams(ov);
    expect(merged.foul.chargePerDrive).toBe(defaultParams.foul.chargePerDrive);
    expect(merged.foul.shootFoulCap).toBe(defaultParams.foul.shootFoulCap);
  });
});

// ---------------------------------------------------------- the engine seam

describe('engine seam (legal inputs only)', () => {
  const league = fixtureLeague({ teams: 4, seed: 'probe-league' });
  const ids = Object.keys(league.teams);
  scheduled(league, 'g-seam', 1, ids[0]!, ids[1]!);
  league.day = 1;
  const home = projectTeam(league, ids[0]!, { isHome: true, gameId: 'g-seam' });
  const away = projectTeam(league, ids[1]!, { isHome: false, gameId: 'g-seam' });
  const f = defaultParams.foul;
  const scaledFoul = (mult: number) => ({
    foul: {
      shootRim: f.shootRim * mult, shootPaint: f.shootPaint * mult,
      shootMid: f.shootMid * mult, shootThree: f.shootThree * mult,
    },
  });
  const countFTA = (events: ReadonlyArray<{ type: string }>): number =>
    events.filter((e) => e.type === 'free_throw').length;

  it('a neutral override is byte-identical to no override at all', () => {
    const base = simulateGame({ seed: 'seam', home, away, collectFrames: false });
    const same = simulateGame({ seed: 'seam', home, away, collectFrames: false, params: scaledFoul(1) });
    expect(JSON.stringify(same.events)).toBe(JSON.stringify(base.events));
    expect(same.finalScore).toEqual(base.finalScore);
  });

  it('the capped swing moves free-throw volume in the right direction', () => {
    // locked seeds; the engine is deterministic, so this is not a flaky
    // statistical test, it is a recorded observation (probe 2026-08-01:
    // tight arm 155 FTA, loose arm 123 over these three seeds)
    let tight = 0;
    let loose = 0;
    for (const seed of ['dir-a', 'dir-b', 'dir-c']) {
      tight += countFTA(simulateGame({ seed, home, away, collectFrames: false, params: scaledFoul(1.1) }).events);
      loose += countFTA(simulateGame({ seed, home, away, collectFrames: false, params: scaledFoul(0.9) }).events);
    }
    expect(tight).toBeGreaterThan(loose);
  });
});

// ---------------------------------------------------------------- visibility

describe('visibility', () => {
  it('stamps the record with the crew id and a surname snapshot', () => {
    const { league } = officiatedLeague(2);
    const gid = league.schedule[0]!.id;
    const stamp = officialsStamp(league, gid);
    const crew = crewForGame(league, gid)!;
    expect(stamp.officials!.crewId).toBe(crew.id);
    expect(stamp.officials!.crew).toEqual(crew.names);
    // snapshot, not a reference: history survives pool edits
    stamp.officials!.crew[0] = 'Mutated';
    expect(crew.names[0]).not.toBe('Mutated');
  });

  it('writes the recap crew line, escalating only on outlier whistle nights', () => {
    const { league } = officiatedLeague(2);
    const gid = league.schedule[0]!.id;
    const stamp = officialsStamp(league, gid).officials!;
    const names = stamp.crew.join(', ');

    const normal = officialsRecapLine(league, recordShell(league, gid, [24, 22], stamp))!;
    expect(normal).toBe(`Crew: ${names}.`);

    const tight = officialsRecapLine(league, recordShell(league, gid, [34, 33], stamp))!;
    expect(tight).toContain(`Crew: ${names}.`);
    expect(tight).toContain('67 free throws');

    const quiet = officialsRecapLine(league, recordShell(league, gid, [12, 10], stamp))!;
    expect(quiet).toContain('quiet');
    for (const line of [normal, tight, quiet]) expect(NO_DASH(line)).toBe(true);
  });

  it('renders from the stored stamp alone (archives outlive the pool)', () => {
    const { league } = officiatedLeague(2);
    const gid = league.schedule[0]!.id;
    const stamp = officialsStamp(league, gid).officials!;
    const bare = fixtureLeague({ teams: 4, seed: 'officials-test' });
    scheduled(bare, gid, 1, league.schedule[0]!.home, league.schedule[0]!.away);
    const line = officialsRecapLine(bare, recordShell(bare, gid, [20, 20], stamp));
    expect(line).toBe(`Crew: ${stamp.crew.join(', ')}.`);
  });

  it('files one wire brief when a notorious crew has the night its reputation promised', () => {
    const { league } = officiatedLeague(2);
    const gid = league.schedule[0]!.id;
    const crew = crafted({ tightness: 90 });
    setOfficials(league, { crews: [crew] });
    const stamp: GameOfficials = { crewId: crew.id, crew: [...crew.names] };

    const items = officialsNewsFor(league, [recordShell(league, gid, [36, 35], stamp)]);
    expect(items.length).toBe(1);
    expect(items[0]!.id).toBe(`n-${gid}-crew`);
    expect(items[0]!.type).toBe('feature');
    expect(items[0]!.weight).toBe(1);
    expect(items[0]!.byline).toBe('Association Wire');
    expect(items[0]!.gameId).toBe(gid);
    expect(items[0]!.headline).toContain('71 free throws');
    expect(NO_DASH(items[0]!.headline) && NO_DASH(items[0]!.body)).toBe(true);

    // a quiet crew swallowing the whistle files the mirror brief
    const quietCrew = crafted({ tightness: 12 });
    setOfficials(league, { crews: [quietCrew] });
    const quietStamp: GameOfficials = { crewId: quietCrew.id, crew: [...quietCrew.names] };
    const quiet = officialsNewsFor(league, [recordShell(league, gid, [10, 8], quietStamp)]);
    expect(quiet.length).toBe(1);
    expect(quiet[0]!.headline).toContain('swallowed the whistle');
  });

  it('stays silent for ordinary crews and ordinary nights', () => {
    const { league } = officiatedLeague(2);
    const gid = league.schedule[0]!.id;
    const ordinary = crafted({ tightness: 55 });
    setOfficials(league, { crews: [ordinary] });
    const stamp: GameOfficials = { crewId: ordinary.id, crew: [...ordinary.names] };
    expect(officialsNewsFor(league, [recordShell(league, gid, [33, 31], stamp)])).toEqual([]);
    const notorious = crafted({ tightness: 90 });
    setOfficials(league, { crews: [notorious] });
    const nStamp: GameOfficials = { crewId: notorious.id, crew: [...notorious.names] };
    expect(officialsNewsFor(league, [recordShell(league, gid, [22, 20], nStamp)])).toEqual([]);
  });
});

// ---------------------------------------------------------- graceful absence

describe('graceful absence (leagues without officials)', () => {
  it('every read is a clean no-op', () => {
    const league = fixtureLeague({ teams: 4, seed: 'bare' });
    const g = scheduled(league, 'g-bare', 1, Object.keys(league.teams)[0]!, Object.keys(league.teams)[1]!);
    expect(officialsStateOf(league)).toBe(null);
    expect(dayAssignments(league, league.season, 1)).toEqual([]);
    expect(crewForGame(league, g.id)).toBe(null);
    expect(crewAttrDelta(league, g.id, false)).toBe(0);
    expect(officiatingParamsFor(league, g.id)).toBeUndefined();
    expect(officialsRecapLine(league, recordShell(league, g.id, [30, 30]))).toBe(null);
    expect(officialsNewsFor(league, [recordShell(league, g.id, [40, 40])])).toEqual([]);
  });

  it('spreadable extras add no keys, so jobs and records stay byte-identical', () => {
    const league = fixtureLeague({ teams: 4, seed: 'bare' });
    const g = scheduled(league, 'g-bare', 1, Object.keys(league.teams)[0]!, Object.keys(league.teams)[1]!);
    const extras = officialsJobExtras(league, g.id);
    expect('params' in extras).toBe(false);
    const stamp = officialsStamp(league, g.id);
    expect('officials' in stamp).toBe(false);
    const job = { index: 0, gameId: g.id, seed: 's' };
    expect({ ...job, ...extras }).toEqual(job);
  });

  it('an empty crews array reads as absent, not as a broken pool', () => {
    const league = fixtureLeague({ teams: 4, seed: 'bare' });
    setOfficials(league, { crews: [] });
    const g = scheduled(league, 'g-bare', 1, Object.keys(league.teams)[0]!, Object.keys(league.teams)[1]!);
    expect(officialsStateOf(league)).toBe(null);
    expect(crewForGame(league, g.id)).toBe(null);
  });
});
