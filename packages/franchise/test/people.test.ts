/**
 * People-module tests: development/aging (people/dev.ts), injuries
 * (people/injury.ts), disposition/morale (people/disposition.ts),
 * retirement (people/retire.ts). Scenarios are hand-built on the shared
 * fixtureLeague (ages, season rows, standings set directly), and the pure
 * exported helpers (hazardFor, moraleFor, retireHazardFor) are hit
 * directly where the math itself is the contract. Extra named exports are
 * imported from the module files; the frozen barrel is not touched.
 */
import { describe, expect, it } from 'vitest';
import type {
  FrPlayer, GameLine, GameRecord, Injury, League, PlayerSeasonRow, TeamTotalsLite,
} from '../src/types.js';
import type { AttrGroup } from '../src/types.js';
import { defaultFranchiseParams } from '../src/params.js';
import { fixtureLeague } from './fixture.js';
import { ATTR_GROUPS, applyAging, runDevelopmentReview } from '../src/people/dev.js';
import {
  INJURY_CATALOG, SEVERITY_ORDER, advanceRecoveries, hazardFor, rollPostGameInjuries,
} from '../src/people/injury.js';
import { moraleFor, updateDispositions } from '../src/people/disposition.js';
import { retireHazardFor, runRetirements } from '../src/people/retire.js';

// ---------------------------------------------------------------------------
// scenario helpers

function seasonRow(season: number, teamId: string, min: number, gp: number): PlayerSeasonRow {
  return {
    season, teamId, type: 'regular', gp, gs: gp, min,
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0,
  };
}

function gameLine(playerId: string, teamId: string, min: number): GameLine {
  return {
    playerId, teamId, starter: true, min,
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0,
  };
}

function zeroTotals(): TeamTotalsLite {
  return {
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0,
    ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pace: 0, fastbreakPts: 0, biggestLead: 0,
  };
}

function gameRecord(league: League, day: number, lines: GameLine[]): GameRecord {
  const tids = Object.keys(league.teams).sort();
  return {
    id: `s${league.season}-d${day}-${tids[1]}@${tids[0]}`,
    date: { season: league.season, day },
    type: 'regular', home: tids[0]!, away: tids[1]!, seed: 'people-test',
    final: [100, 90], ot: 0, lines, totals: [zeroTotals(), zeroTotals()], keyPlays: [],
  };
}

function groupSum(player: FrPlayer, group: AttrGroup): number {
  let sum = 0;
  for (const k of ATTR_GROUPS[group]) sum += player.attr[k];
  return sum;
}

function setAge(league: League, id: string, age: number): void {
  league.players[id]!.bornSeason = league.season - age;
}

/** A 21-year-old high-ceiling starter and a 31-year-old twin, same team, 90-devQuality staff. */
function devScenario(): { league: League; youngId: string; oldId: string } {
  const league = fixtureLeague();
  const team = league.teams[league.userTeam]!;
  team.coach.devQuality = 90;
  const youngId = team.roster[0]!;
  const oldId = team.roster[1]!;
  for (const id of [youngId, oldId]) {
    const p = league.players[id]!;
    for (const k of ATTR_GROUPS.scoring) p.attr[k] = 60;
    p.potential.scoring = 90;
    p.workEthic = 60;
    p.seasons.push(seasonRow(league.season, team.id, 2400, 70));
  }
  setAge(league, youngId, 21);
  setAge(league, oldId, 31);
  return { league, youngId, oldId };
}

// ---------------------------------------------------------------------------
// development & aging

describe('development reviews (people/dev.ts)', () => {
  it('a 21-year-old with minutes, staff, and headroom out-develops a 31-year-old in the scoring group', () => {
    const { league, youngId, oldId } = devScenario();
    const young = league.players[youngId]!;
    const old = league.players[oldId]!;
    const beforeYoung = groupSum(young, 'scoring');
    const beforeOld = groupSum(old, 'scoring');

    runDevelopmentReview(league, 'offseason');

    const gainYoung = groupSum(young, 'scoring') - beforeYoung;
    const gainOld = groupSum(old, 'scoring') - beforeOld;
    expect(gainYoung).toBeGreaterThanOrEqual(2);
    expect(gainYoung).toBeGreaterThan(gainOld);
    // scoring peaks at 27 (params.aging.peakAge); at 31 the growth window
    // is fully closed, and decline belongs to applyAging, not the review.
    expect(gainOld).toBe(0);
  });

  it('writes one devLog note per player per review, with plain-language reasons and bounded deltas', () => {
    const league = fixtureLeague();
    runDevelopmentReview(league, 'offseason');
    for (const player of Object.values(league.players)) {
      expect(player.devLog.length).toBe(1);
      const note = player.devLog[0]!;
      expect(note.reasons.length).toBeGreaterThan(0);
      for (const d of Object.values(note.deltas)) {
        expect(d ?? 0).toBeLessThanOrEqual(8); // smooth arcs: no group jumps (research 01 finding 1)
        expect(d ?? 0).toBeGreaterThanOrEqual(0); // reviews never decline; applyAging owns that
      }
    }
  });

  it('explains the arc: minutes earned and staff quality land in the reasons', () => {
    const { league, youngId } = devScenario();
    runDevelopmentReview(league, 'offseason');
    const reasons = league.players[youngId]!.devLog[0]!.reasons.join(' | ');
    expect(reasons).toContain('earned 2400 minutes');
    expect(reasons).toContain('devQuality 90 staff');
  });

  it('midseason reviews are checkpoint-sized next to the offseason program', () => {
    const off = devScenario();
    const mid = devScenario();
    const before = groupSum(off.league.players[off.youngId]!, 'scoring');
    runDevelopmentReview(off.league, 'offseason');
    runDevelopmentReview(mid.league, 'midseason');
    const offGain = groupSum(off.league.players[off.youngId]!, 'scoring') - before;
    const midGain = groupSum(mid.league.players[mid.youngId]!, 'scoring') - before;
    expect(midGain).toBeLessThan(offGain);
  });

  it('keeps every attribute an integer inside 0-100 through review plus aging', () => {
    const league = fixtureLeague();
    runDevelopmentReview(league, 'offseason');
    applyAging(league);
    for (const player of Object.values(league.players)) {
      for (const group of Object.keys(ATTR_GROUPS) as AttrGroup[]) {
        for (const k of ATTR_GROUPS[group]) {
          const v = player.attr[k];
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('is deterministic: the same league state reviews to the same result', () => {
    const a = devScenario().league;
    const b = devScenario().league;
    runDevelopmentReview(a, 'offseason');
    runDevelopmentReview(b, 'offseason');
    expect(JSON.stringify(a.players)).toBe(JSON.stringify(b.players));
  });
});

describe('aging (people/dev.ts applyAging)', () => {
  it('a 31-year-old loses phys (legs first), a 21-year-old does not, and mental holds before 34', () => {
    const { league, youngId, oldId } = devScenario();
    const young = league.players[youngId]!;
    const old = league.players[oldId]!;
    const beforePhysOld = groupSum(old, 'phys');
    const beforePhysYoung = groupSum(young, 'phys');
    const beforeMentalOld = groupSum(old, 'mental');

    applyAging(league);

    expect(groupSum(old, 'phys')).toBeLessThan(beforePhysOld);
    expect(groupSum(young, 'phys')).toBe(beforePhysYoung); // 21 is before every peak
    // research 05 B2: decision-making and shooting hold late; the mental
    // group never declines before 34.
    expect(groupSum(old, 'mental')).toBe(beforeMentalOld);
    const note = old.devLog[old.devLog.length - 1]!;
    expect(note.reasons.join(' | ')).toContain('legs first');
    expect(note.deltas.phys ?? 0).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// injuries

describe('injury model (people/injury.ts)', () => {
  it('hazardFor: exactly basePer36 at the 36-minute/midpoint anchors, scaling with age, proneness, and minutes', () => {
    const params = defaultFranchiseParams();
    const base = hazardFor(params, { min: 36, age: 26, proneness: 50, wear: 50 });
    expect(base).toBe(params.injury.basePer36);
    expect(hazardFor(params, { min: 36, age: 34, proneness: 50, wear: 50 })).toBeGreaterThan(base);
    expect(hazardFor(params, { min: 36, age: 26, proneness: 100, wear: 50 })).toBeGreaterThan(base * 1.9);
    expect(hazardFor(params, { min: 18, age: 26, proneness: 50, wear: 50 })).toBeLessThan(base);
    expect(hazardFor(params, { min: 36, age: 26, proneness: 50, wear: 100 })).toBeGreaterThan(base);
  });

  it('produces a plausible injury count over many exposures, with catalog-consistent severities and bands', () => {
    const league = fixtureLeague();
    // Test-only elevated rate for signal from few rolls; the CAL default
    // stays owned by params.ts.
    league.params.injury.basePer36 = 0.2;
    const team = league.teams[Object.keys(league.teams).sort()[0]!]!;
    const ids = team.roster.slice(0, 8);
    for (const id of ids) {
      const p = league.players[id]!;
      p.bornSeason = league.season - 26;
      p.health.proneness = 50;
    }
    const all: Injury[] = [];
    for (let day = 1; day <= 50; day++) {
      // heal and reset wear between days so every line re-rolls at p = 0.2 exactly
      for (const id of ids) {
        league.players[id]!.health.injury = null;
        league.players[id]!.health.wear = 50;
      }
      const rec = gameRecord(league, day, ids.map((id) => gameLine(id, team.id, 36)));
      all.push(...rollPostGameInjuries(league, [rec]));
    }
    // 400 rolls at p = 0.2: expect ~80; the loose band catches plumbing
    // failures (0 or 400), not calibration.
    expect(all.length).toBeGreaterThanOrEqual(50);
    expect(all.length).toBeLessThanOrEqual(115);
    const params = defaultFranchiseParams();
    for (const inj of all) {
      const def = INJURY_CATALOG.find((k) => k.kind === inj.kind)!;
      expect(def).toBeDefined();
      expect(def.severities).toContain(inj.severity); // majors only from major/seasonEnding rolls
      const sevIdx = SEVERITY_ORDER.indexOf(inj.severity);
      const [lo, hi] = params.injury.outDaysBySeverity[sevIdx]!;
      expect(inj.outDays).toBeGreaterThanOrEqual(lo);
      expect(inj.outDays).toBeLessThanOrEqual(hi);
      expect(inj.remainingDays).toBe(inj.outDays);
      expect(inj.gameId).toBeDefined();
    }
  });

  it('never re-rolls an already-injured player, and hits add wear', () => {
    const league = fixtureLeague();
    league.params.injury.basePer36 = 2.5; // clamps to the 0.95 hazard ceiling: near-certain hits
    const team = league.teams[Object.keys(league.teams).sort()[0]!]!;
    const ids = team.roster.slice(0, 8);
    const held = league.players[ids[0]!]!;
    const hold: Injury = {
      kind: 'test-hold', label: 'test hold', severity: 'moderate',
      startedOn: { season: league.season, day: 0 }, outDays: 10, remainingDays: 10,
    };
    held.health.injury = hold;
    const out = rollPostGameInjuries(league, [gameRecord(league, 1, ids.map((id) => gameLine(id, team.id, 36)))]);
    expect(held.health.injury.kind).toBe('test-hold'); // untouched: no re-roll while hurt
    expect(held.health.history.length).toBe(0);
    expect(out.length).toBeGreaterThanOrEqual(4); // the other seven at ~0.95 each
    for (const id of ids.slice(1)) {
      const p = league.players[id]!;
      if (p.health.injury) {
        expect(p.health.wear).toBeGreaterThan(0); // wearBySeverity landed
        expect(p.health.history.length).toBe(1); // appended at assignment
      }
    }
  });

  it('advanceRecoveries counts down and clears at zero, returning the cleared ids', () => {
    const league = fixtureLeague();
    const player = Object.values(league.players)[0]!;
    const injury: Injury = {
      kind: 'ankle-sprain', label: 'sprained left ankle', severity: 'minor',
      startedOn: { season: league.season, day: 1 }, outDays: 2, remainingDays: 2,
    };
    player.health.injury = injury;
    player.health.history.push(injury);

    expect(advanceRecoveries(league)).toEqual([]); // 2 -> 1: still out
    expect(player.health.injury!.remainingDays).toBe(1);
    expect(advanceRecoveries(league)).toEqual([player.id]); // 1 -> 0: cleared
    expect(player.health.injury).toBe(null);
    expect(player.health.history.length).toBe(1); // not double-appended
  });
});

// ---------------------------------------------------------------------------
// disposition & morale

/** Losing team, buried star: the one scenario that should move morale hard. */
function grievanceScenario(): { league: League; starId: string; roleId: string } {
  const league = fixtureLeague();
  const team = league.teams[league.userTeam]!;
  const starId = team.roster[0]!;
  const star = league.players[starId]!;
  for (const group of Object.keys(ATTR_GROUPS) as AttrGroup[]) {
    for (const k of ATTR_GROUPS[group]) star.attr[k] = 88; // clearly the best talent on the roster
  }
  star.disposition.ambition = 80;
  star.disposition.professionalism = 50;
  star.seasons.push(seasonRow(league.season, team.id, 200, 20)); // 10 a night for the best player
  team.roster.forEach((pid, i) => {
    if (pid === starId) return;
    league.players[pid]!.seasons.push(seasonRow(league.season, team.id, 400 + i * 100, 40));
  });
  league.standings[team.id] = {
    teamId: team.id, w: 10, l: 30, homeW: 5, homeL: 15, awayW: 5, awayL: 15,
    confW: 6, confL: 20, divW: 2, divL: 6, ptsFor: 4000, ptsAgainst: 4400,
    streak: -3, last10: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  };
  return { league, starId, roleId: team.roster[1]! };
}

describe('disposition & morale (people/disposition.ts)', () => {
  it('an underplayed star on a losing team sits below a content role player, and below baseline', () => {
    const { league, starId, roleId } = grievanceScenario();
    const starMorale = moraleFor(league, league.players[starId]!);
    const roleMorale = moraleFor(league, league.players[roleId]!);
    expect(starMorale).toBeLessThan(roleMorale);
    expect(starMorale).toBeLessThan(70);
  });

  it('a healthy fresh league is QUIET: baseline morale everywhere, zero requests', () => {
    const league = fixtureLeague();
    const items = updateDispositions(league);
    expect(items).toEqual([]);
    for (const team of Object.values(league.teams)) {
      for (const pid of team.roster) expect(league.players[pid]!.morale).toBe(70);
    }
  });

  it('arms one trade request only under the compound condition, once per season', () => {
    const { league, starId } = grievanceScenario();
    const star = league.players[starId]!;
    // push the star to the floor: volatile, hyper-ambitious, long rehab
    star.disposition.ambition = 90;
    star.disposition.professionalism = 40;
    star.tend.usage = 95;
    star.health.injury = {
      kind: 'meniscus-tear', label: 'torn left meniscus', severity: 'major',
      startedOn: { season: league.season, day: 10 }, outDays: 90, remainingDays: 90,
    };

    const items = updateDispositions(league);
    expect(items.length).toBe(1);
    const item = items[0]!;
    expect(item.id).toBe(`trade-request-${league.season}-${starId}`);
    expect(item.kind).toBe('decision'); // the star plays for the user's team
    expect(item.choices!.map((c) => c.label)).toEqual(['Hold firm', 'Promise a bigger role', 'Open trade talks']);
    expect(star.morale).toBeLessThan(league.params.trade.requestMoraleFloor);

    // hysteresis: once the demand is on the record (spine appends to the
    // inbox), the same misery does not re-fire daily
    league.inbox.push(item);
    expect(updateDispositions(league).length).toBe(0);

    // professionalism gate: the consummate pro handles it in-house
    league.inbox.length = 0;
    star.disposition.professionalism = 90;
    expect(updateDispositions(league).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// retirement

describe('retirement (people/retire.ts)', () => {
  it('cohort shape: hazard-implied median retirement for a 600-minute role player lands in 33-38', () => {
    const params = defaultFranchiseParams();
    let survival = 1;
    let median = 0;
    for (let age = params.retire.minLeagueAge; age <= 46 && median === 0; age++) {
      const h = retireHazardFor(params, {
        age, seasonMinutes: 600, wear: 20, decliningSeasons: 0, contractYearsRemaining: 0,
      });
      survival *= 1 - h;
      if (survival <= 0.5) median = age;
    }
    expect(median).toBeGreaterThanOrEqual(33);
    expect(median).toBeLessThanOrEqual(38);
  });

  it('hazard gates: zero below the league age floor, and 2+ contract years crush the hazard', () => {
    const params = defaultFranchiseParams();
    expect(retireHazardFor(params, {
      age: 29, seasonMinutes: 0, wear: 90, decliningSeasons: 2, contractYearsRemaining: 0,
    })).toBe(0);
    const base = { age: 36, seasonMinutes: 2000, wear: 10, decliningSeasons: 0 };
    const unsigned = retireHazardFor(params, { ...base, contractYearsRemaining: 0 });
    const signed = retireHazardFor(params, { ...base, contractYearsRemaining: 2 });
    expect(signed).toBeLessThan(unsigned * 0.2);
    expect(signed).toBeGreaterThan(unsigned * 0.1);
  });

  it('runRetirements returns sorted eligible ids and mutates NOTHING (the spine executes)', () => {
    const setup = (): League => {
      const league = fixtureLeague();
      const team = league.teams[league.userTeam]!;
      for (const pid of team.roster.slice(0, 5)) setAge(league, pid, 42); // washed vets, ~0.99 hazard
      return league;
    };
    const league = setup();
    const out = runRetirements(league);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out).toEqual([...out].sort());
    for (const id of out) {
      expect(league.players[id]!.status).toBe('roster'); // not flipped here
      expect(league.season - league.players[id]!.bornSeason).toBeGreaterThanOrEqual(30);
    }
    expect(league.transactions.length).toBe(0); // no Transaction appended: transactions.ts owns that
    expect(runRetirements(setup())).toEqual(out); // deterministic
  });
});
