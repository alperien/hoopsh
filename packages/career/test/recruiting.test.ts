/**
 * Recruiting-module tests: the board (buildPrograms), the interest
 * ladder's pacing and cooling, offers (terms, windows, pulls, class-fill
 * day), the pro route alternatives, and commitment. Scenarios are
 * hand-built on the shared fixtureCareer: my production is simulated by
 * writing PlayerSeasonRow entries (and, for the cold-stretch window,
 * GameRecord lines into circuit.results) directly, and perception is a
 * deterministic stand-in injected through updateRecruiting's perceive
 * seam (perception.ts throws mid-wave by design). Extra named exports
 * (commitToOffer) are imported from the module file; the frozen barrel
 * is not touched.
 */
import { describe, expect, it } from 'vitest';
import { ATTR_GROUPS, groupMean, streamRng } from '@hoopsh/franchise';
import type { AttrGroup, FrPlayer, GameRecord, TeamTotalsLite } from '@hoopsh/franchise';
import type { CareerParams } from '../src/params.js';
import type { PerceivedGroups } from '../src/perception.js';
import type { CareerState, InterestRung, Program, RouteOffer } from '../src/types.js';
import {
  buildPrograms, commitToOffer, openOffers, recruiterSurnameOf, updateRecruiting,
} from '../src/recruiting.js';
import { fixtureCareer } from './fixture.js';

// ---------------------------------------------------------------------------
// scenario helpers

/** Stable group order (PotentialProfile declaration order). */
const GROUPS: readonly AttrGroup[] = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'];

/** Rung ladder order, for no-skip pacing checks. */
const RUNG_ORDER: readonly InterestRung[] = ['none', 'questionnaire', 'letter', 'texts', 'visit', 'offer'];
const rungIdx = (r: InterestRung): number => RUNG_ORDER.indexOf(r);

/** Role ladder order, for promise comparisons. */
const ROLE_ORDER = ['garbage', 'bench', 'rotation', 'sixthMan', 'starter', 'featured', 'franchise'] as const;
const roleIdx = (r: string): number => ROLE_ORDER.indexOf(r as typeof ROLE_ORDER[number]);

/**
 * The deterministic perception stand-in (the brief's shape): perceived
 * groups are the player's TRUE group means plus a fixed offset, ceiling
 * a fixed step above now. Ignores seed/key/coverage on purpose so the
 * tests control the read exactly; the real perceiveProspect (stock
 * task) adds per-observer fog behind the same signature.
 */
function standIn(offset: number) {
  return (
    _seed: string, _key: string | number, player: FrPlayer, _coverage: number, _params: CareerParams,
  ): PerceivedGroups => {
    const now = {} as Record<AttrGroup, number>;
    const ceiling = {} as Record<AttrGroup, number>;
    for (const g of GROUPS) {
      const t = groupMean(player.attr, g);
      now[g] = Math.min(100, Math.max(0, t + offset));
      ceiling[g] = Math.min(100, Math.max(0, t + offset + 8)); // kids project up: ceiling reads a step over now
    }
    return { now, ceiling };
  };
}

/** Hand-set my season row: gp/pts simulate production without the circuits task. */
function setRows(career: CareerState, gp: number, pts: number): void {
  career.players[career.me]!.seasons = [{
    season: career.clock.year, teamId: 'hs-oakridge', type: 'regular',
    gp, gs: gp, min: gp * 30, pts,
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0,
  }];
}

function zeroTotals(): TeamTotalsLite {
  return {
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0,
    ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pace: 0, fastbreakPts: 0, biggestLead: 0,
  };
}

/** Fill the next unplayed scheduled circuit game with a line where I
 * score `pts`: the cold-stretch window reads these. */
function playGame(career: CareerState, pts: number): void {
  const c = career.circuit!;
  const g = c.schedule.find(x => !c.results[x.id])!;
  const home = c.teams[g.homeIdx]!.id;
  const away = c.teams[g.awayIdx]!.id;
  const rec: GameRecord = {
    id: g.id, date: { season: c.year, day: g.week * 7 }, type: 'regular',
    home, away, seed: `test-${g.id}`, final: [70, 60], ot: 0,
    lines: [{
      playerId: career.me, teamId: home, starter: true, min: 28, pts,
      fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0,
      ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0,
    }],
    totals: [zeroTotals(), zeroTotals()], keyPlays: [],
  };
  c.results[g.id] = rec;
}

/** playGame with a real shot line, for the production-read scenarios
 * (fix wave B): the efficiency leg of stock.ts productionIndex reads
 * fgm/fga/fta off the stored lines. */
function playShotGame(career: CareerState, pts: number, fgm: number, fga: number): void {
  const c = career.circuit!;
  const g = c.schedule.find(x => !c.results[x.id])!;
  const home = c.teams[g.homeIdx]!.id;
  const rec: GameRecord = {
    id: g.id, date: { season: c.year, day: g.week * 7 }, type: 'regular',
    home, away: c.teams[g.awayIdx]!.id, seed: `test-${g.id}`, final: [64, 55], ot: 0,
    lines: [{
      playerId: career.me, teamId: home, starter: true, min: 28, pts,
      fgm, fga, tpm: 2, tpa: 6, ftm: pts - 2 * fgm - 2 >= 0 ? 2 : 0, fta: 3, orb: 1, drb: 4,
      ast: 3, stl: 1, blk: 0, tov: 2, pf: 2, plusMinus: 5,
    }],
    totals: [zeroTotals(), zeroTotals()], keyPlays: [],
  };
  c.results[g.id] = rec;
}

/** A career with a built board (the caller-owned creation stream). */
function boardCareer(): CareerState {
  const career = fixtureCareer();
  career.recruiting!.programs = buildPrograms(career, streamRng(career.seed, 'career-recruit', 'build'));
  return career;
}

/** Hand-set a live offer + offer-rung interest for one program (used to
 * isolate pull / expiry / class-fill / commit behavior from the climb). */
function handOffer(career: CareerState, program: Program, expiresWeek: number): RouteOffer {
  const offer: RouteOffer = {
    id: `off-${program.id}`, kind: 'college', programId: program.id,
    money: program.nil, coachDev: program.coachDev, promisedRole: program.promisedRole,
    style: { ...program.style }, expiresWeek,
  };
  career.recruiting!.offers.push(offer);
  career.recruiting!.interest.push({
    programId: program.id, rung: 'offer', perceived: 0,
    lastMoveWeek: career.clock.week - 1, closed: false,
  });
  return offer;
}

/** One tick-shaped week: update, then advance the clock. */
function runWeek(career: CareerState, perceive: ReturnType<typeof standIn>): void {
  updateRecruiting(career, perceive);
  career.clock.week++;
}

/** Lint-style scan: every recruiting event is explained (nonempty
 * reason) and ids are unique (the phone task folds this feed). */
function expectExplained(career: CareerState): void {
  const evs = career.events.filter(e => e.kind === 'recruiting');
  expect(evs.length).toBeGreaterThan(0);
  expect(evs.every(e => e.reason.trim().length > 0)).toBe(true);
  expect(new Set(evs.map(e => e.id)).size).toBe(evs.length);
}

// ---------------------------------------------------------------------------

describe('career recruiting: the board', () => {
  it('buildPrograms is deterministic with tier, style, and promise spread', () => {
    const career = fixtureCareer();
    const a = buildPrograms(career, streamRng(career.seed, 'career-recruit', 'build'));
    const b = buildPrograms(career, streamRng(career.seed, 'career-recruit', 'build'));
    expect(a).toEqual(b); // same stream, same board: a board is a pure function of the rng

    expect(a.length).toBe(career.params.recruiting.programCount);
    const byTier = (t: number) => a.filter(p => p.tier === t);
    expect(byTier(1).length).toBe(3); // the 3/5/6 split at the default 14-program board
    expect(byTier(2).length).toBe(5);
    expect(byTier(3).length).toBe(6);

    // names are fictional-real, nonempty, unique
    expect(a.every(p => p.name.trim().length > 0)).toBe(true);
    expect(new Set(a.map(p => p.name)).size).toBe(a.length);
    expect(a.every(p => p.region.trim().length > 0)).toBe(true);

    // style spread: run-and-gun and grinder programs genuinely exist
    const paces = a.map(p => p.style.pace);
    expect(Math.max(...paces) - Math.min(...paces)).toBeGreaterThanOrEqual(20);
    const tbs = a.map(p => p.style.threeBias);
    expect(Math.max(...tbs) - Math.min(...tbs)).toBeGreaterThanOrEqual(10);

    // blue-blood staffs develop better on average; mid-majors promise more
    const devMean = (t: number) => byTier(t).reduce((s, p) => s + p.coachDev, 0) / byTier(t).length;
    expect(devMean(1)).toBeGreaterThan(devMean(3));
    expect(roleIdx(byTier(1)[0]!.promisedRole)).toBeLessThan(roleIdx(byTier(3)[0]!.promisedRole));

    // NIL is priced by tier straight from params
    const nil = career.params.recruiting.nilByTier;
    expect(a.every(p => p.nil === nil[p.tier - 1])).toBe(true);
  });
});

describe('career recruiting: the interest ladder', () => {
  it('a strong month climbs rungs without skipping and offers carry the terms', () => {
    const career = boardCareer();
    setRows(career, 8, 180); // 22.5 a game: a headliner's senior tape
    const perceive = standIn(12); // hot read: everybody's fog runs warm

    const prevRung = new Map<string, number>();
    const offeredAt = new Map<string, number>();
    let skips = 0;
    let upMoves = 0;
    for (let w = 0; w < 8; w++) {
      updateRecruiting(career, perceive);
      for (const it2 of career.recruiting!.interest) {
        const before = prevRung.get(it2.programId) ?? 0;
        const now = rungIdx(it2.rung);
        if (now > before + 1) skips++;
        if (now > before) upMoves += now - before;
        if (it2.rung === 'offer' && !offeredAt.has(it2.programId)) offeredAt.set(it2.programId, career.clock.week);
        prevRung.set(it2.programId, now);
      }
      career.clock.week++;
    }

    expect(skips).toBe(0); // courtship has pacing: one rung per week, max
    expect(career.recruiting!.interest.length).toBe(career.params.recruiting.programCount);
    const collegeOffers = career.recruiting!.offers.filter(o => o.kind === 'college');
    expect(collegeOffers.length).toBeGreaterThanOrEqual(1);

    // offers snapshot the program's real terms and expire on the window
    const p = career.params.recruiting;
    for (const offer of collegeOffers) {
      const program = career.recruiting!.programs.find(x => x.id === offer.programId)!;
      expect(offer.money).toBe(program.nil);
      expect(offer.coachDev).toBe(program.coachDev);
      expect(offer.promisedRole).toBe(program.promisedRole);
      expect(offer.style).toEqual(program.style);
      const hold = program.tier === 1 ? career.params.tick.weeksPerYear : p.offerWindowWeeks;
      expect(offer.expiresWeek).toBe(offeredAt.get(program.id)! + hold);
    }

    // every rung move was explained: one +1 recruiting event per up-move
    const upEvents = career.events.filter(e => e.kind === 'recruiting' && e.delta === 1);
    expect(upEvents.length).toBe(upMoves);
    expectExplained(career);
  });

  it('the same career state produces the same interest moves', () => {
    const career = boardCareer();
    setRows(career, 6, 120);
    const cloneA = structuredClone(career);
    const cloneB = structuredClone(career);
    const perceive = standIn(8);
    updateRecruiting(cloneA, perceive);
    updateRecruiting(cloneB, perceive);
    expect(cloneA.recruiting).toEqual(cloneB.recruiting);
    expect(cloneA.events).toEqual(cloneB.events);
  });
});

describe('career recruiting: cooling and pulled offers', () => {
  it('a cold stretch cools the read and can pull an offer', () => {
    const career = boardCareer();
    const program = career.recruiting!.programs.find(p => p.tier === 2)!;
    setRows(career, 10, 220); // a 22-a-game season baseline
    handOffer(career, program, career.clock.week + 20); // long window: expiry cannot mask the pull
    const perceive = standIn(0);

    // one good-form week establishes the fog read
    runWeek(career, perceive);
    const interest = career.recruiting!.interest.find(x => x.programId === program.id)!;
    expect(interest.closed).toBe(false); // a warm read holds the offer
    const warmPerceived = interest.perceived;

    // the slump: three single-digit games, and the rows they lower
    playGame(career, 4);
    playGame(career, 3);
    playGame(career, 5);
    setRows(career, 13, 232); // 17.8 a game season; last three: 4.0 (25%+ below)

    let pulledAtWeek: number | null = null;
    for (let w = 0; w < 6 && pulledAtWeek === null; w++) {
      runWeek(career, perceive);
      if (interest.closed) pulledAtWeek = career.clock.week - 1;
    }

    expect(interest.perceived).toBeLessThan(warmPerceived); // consecutive bad weeks drag the read down
    expect(interest.closed).toBe(true);
    expect(interest.closedReason).toBe('cooled off');
    expect(openOffers(career).some(o => o.programId === program.id)).toBe(false);
    expect(career.events.some(e => e.kind === 'recruiting' && e.reason.includes(program.name) && e.reason.includes('pulled'))).toBe(true);
    expectExplained(career);
  });
});

describe('career recruiting: windows and class-fill day', () => {
  it('an unanswered offer lapses at its window', () => {
    const career = boardCareer();
    const program = career.recruiting!.programs.find(p => p.tier === 2)!;
    setRows(career, 14, 320); // a full 22.9-a-game season: exposure maxed, so a pull cannot explain the close
    const offer = handOffer(career, program, career.clock.week + 2);
    const perceive = standIn(12); // warm read for the same reason

    runWeek(career, perceive);
    expect(openOffers(career).some(o => o.id === offer.id)).toBe(true); // live inside the window
    runWeek(career, perceive); // still inside: the window covers offerWindowWeeks full weeks
    runWeek(career, perceive); // this update runs AT expiresWeek: the paper lapses
    const interest = career.recruiting!.interest.find(x => x.programId === program.id)!;
    expect(interest.closed).toBe(true);
    expect(interest.closedReason).toBe('offer expired');
    expect(openOffers(career).some(o => o.id === offer.id)).toBe(false);
  });

  it('class-fill day closes unaccepted tier 2-3 offers; tier-1 paper survives', () => {
    const career = boardCareer();
    const t1 = career.recruiting!.programs.find(p => p.tier === 1)!;
    const t3 = career.recruiting!.programs.find(p => p.tier === 3)!;
    setRows(career, 12, 260);
    career.clock.week = career.params.recruiting.classFillWeek;
    const offer1 = handOffer(career, t1, career.clock.week + 20);
    const offer3 = handOffer(career, t3, career.clock.week + 20);
    updateRecruiting(career, standIn(12));

    const i3 = career.recruiting!.interest.find(x => x.programId === t3.id)!;
    expect(i3.closed).toBe(true);
    expect(i3.closedReason).toBe('class filled');
    expect(openOffers(career).some(o => o.id === offer3.id)).toBe(false);
    const i1 = career.recruiting!.interest.find(x => x.programId === t1.id)!;
    expect(i1.closed).toBe(false); // blue bloods hold the scholarship to signing day
    expect(openOffers(career).some(o => o.id === offer1.id)).toBe(true);
    expect(career.events.some(e => e.kind === 'recruiting' && e.reason.includes(t3.name) && e.reason.includes('class'))).toBe(true);
  });
});

describe('career recruiting: the pro routes', () => {
  it('euro and NBL offers appear once each for a high-ceiling read', () => {
    const career = boardCareer();
    setRows(career, 4, 100); // enough tape for pro clubs to move
    const perceive = standIn(20); // a top-30ish ceiling read
    for (let w = 0; w < 4; w++) runWeek(career, perceive);

    const euros = career.recruiting!.offers.filter(o => o.kind === 'euro');
    const nbls = career.recruiting!.offers.filter(o => o.kind === 'nbl');
    expect(euros.length).toBe(1); // once per career, no matter how many warm weeks follow
    expect(nbls.length).toBe(1);

    const p = career.params.recruiting;
    expect(euros[0]!.money).toBe(p.euroOfferMoney);
    expect(nbls[0]!.money).toBe(p.nblOfferMoney);
    expect(euros[0]!.promisedRole).toBe('bench');   // euro minutes are earned
    expect(nbls[0]!.promisedRole).toBe('starter');  // the Next Star slot is a showcase
    expect(euros[0]!.coachDev).toBeGreaterThan(nbls[0]!.coachDev); // euro dev is the best on the board
    expect(euros[0]!.clubName!.trim().length).toBeGreaterThan(0);
    expectExplained(career);
  });

  it('a modest ceiling read draws no pro offers', () => {
    const career = boardCareer();
    setRows(career, 4, 60);
    const perceive = standIn(-30); // ceiling mean well under the pro bar
    for (let w = 0; w < 3; w++) runWeek(career, perceive);
    expect(career.recruiting!.offers.filter(o => o.kind !== 'college').length).toBe(0);
  });
});

describe('career recruiting: the staggered ladder (fix wave B)', () => {
  it('rung timelines are NOT identical across programs: courtship spreads over weeks, blue bloods first', () => {
    for (const seed of ['stagger-A', 'stagger-B', 'stagger-C']) {
      const career = fixtureCareer({ seed });
      career.recruiting!.programs = buildPrograms(career, streamRng(career.seed, 'career-recruit', 'build'));
      setRows(career, 8, 180); // a headliner's tape: every staff WANTS to move
      const perceive = standIn(12);
      career.clock.week = career.params.tick.hsSeasonStartWeek;

      const firstMove = new Map<string, number>();
      const offerAt = new Map<string, number>();
      const prevRung = new Map<string, number>();
      let skips = 0;
      for (let w = 0; w < 24; w++) {
        updateRecruiting(career, perceive);
        for (const it2 of career.recruiting!.interest) {
          const now = rungIdx(it2.rung);
          if (now > (prevRung.get(it2.programId) ?? 0) + 1) skips += 1;
          prevRung.set(it2.programId, now);
          if (it2.rung !== 'none' && !firstMove.has(it2.programId)) firstMove.set(it2.programId, career.clock.week);
          if (it2.rung === 'offer' && !offerAt.has(it2.programId)) offerAt.set(it2.programId, career.clock.week);
        }
        career.clock.week += 1;
      }

      expect(skips).toBe(0); // pacing never buys a double-climb
      const weeks = [...firstMove.values()];
      expect(weeks.length).toBe(career.recruiting!.programs.length); // everyone courts eventually
      expect(new Set(weeks).size).toBeGreaterThanOrEqual(5); // not one wall
      expect(Math.max(...weeks) - Math.min(...weeks)).toBeGreaterThanOrEqual(5); // spread over real weeks

      // blue bloods move earlier than the small schools, on average
      const meanFor = (tier: 1 | 2 | 3): number => {
        const ws = career.recruiting!.programs
          .filter(p => p.tier === tier)
          .map(p => firstMove.get(p.id)!)
          .filter(w2 => w2 !== undefined);
        return ws.reduce((a, b) => a + b, 0) / Math.max(1, ws.length);
      };
      expect(meanFor(1)).toBeLessThan(meanFor(3));

      // offers arrive across weeks too, not as one nine-letter day
      const offerWeeks = [...offerAt.values()];
      expect(offerWeeks.length).toBeGreaterThanOrEqual(3);
      expect(new Set(offerWeeks).size).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('career recruiting: recruiter surnames (fix wave B)', () => {
  it('no two programs ever share a coach surname, and the board stays deterministic', () => {
    for (const seed of ['percept-A', 'percept-B', 'percept-C']) {
      const career = fixtureCareer({ seed });
      const a = buildPrograms(career, streamRng(career.seed, 'career-recruit', 'build'));
      const b = buildPrograms(career, streamRng(career.seed, 'career-recruit', 'build'));
      expect(a).toEqual(b); // still a pure function of the stream

      const surnames = a.map(p => recruiterSurnameOf(career.seed, p.id));
      expect(new Set(surnames).size).toBe(a.length); // Marchetti coaches ONE program
      expect(new Set(a.map(p => p.id)).size).toBe(a.length); // steered ids stay unique
    }
  });
});

describe('career recruiting: production in the read (fix wave B)', () => {
  it('a chucker month cools every staff below an efficient scorer with the same sheet', () => {
    const mk = (fgm: number, fga: number): CareerState => {
      const career = boardCareer();
      setRows(career, 5, 110); // 22 a game either way
      for (let i = 0; i < 5; i++) playShotGame(career, 22, fgm, fga);
      return career;
    };
    const chucker = mk(8, 26); // 30.8% from the field for his 22
    const scorer = mk(9, 16);  // 56.3% for the same 22
    const perceive = standIn(0);
    updateRecruiting(chucker, perceive);
    updateRecruiting(scorer, perceive);

    // same fog stand-in, same sheet, same volume: only the tape differs
    let cooler = 0;
    for (const it2 of scorer.recruiting!.interest) {
      const other = chucker.recruiting!.interest.find(x => x.programId === it2.programId)!;
      if (other.perceived < it2.perceived) cooler += 1;
    }
    expect(cooler).toBe(scorer.recruiting!.interest.length);
  });
});

describe('career recruiting: commitment', () => {
  it('commitToOffer signs one deal and closes the rest as signed elsewhere', () => {
    const career = boardCareer();
    const t2 = career.recruiting!.programs.find(p => p.tier === 2)!;
    const t3 = career.recruiting!.programs.find(p => p.tier === 3)!;
    setRows(career, 10, 220);
    const keep = handOffer(career, t2, career.clock.week + 6);
    const lose = handOffer(career, t3, career.clock.week + 6);
    career.recruiting!.offers.push({
      id: 'off-route-euro', kind: 'euro', clubName: 'BC Dalmatia',
      money: career.params.recruiting.euroOfferMoney, coachDev: 82,
      promisedRole: 'bench', style: { pace: 42, threeBias: 56 },
      expiresWeek: career.clock.week + 6,
    });
    const eventsBefore = career.events.length;

    commitToOffer(career, keep.id);

    expect(career.recruiting!.committedTo).toBe(keep.id);
    const open = openOffers(career);
    expect(open.length).toBe(1);
    expect(open[0]!.id).toBe(keep.id);
    const iLose = career.recruiting!.interest.find(x => x.programId === t3.id)!;
    expect(iLose.closed).toBe(true);
    expect(iLose.closedReason).toBe('signed elsewhere');
    expect(career.events.length - eventsBefore).toBe(3); // the commit + two offers off the board
    expect(career.events.some(e => e.kind === 'recruiting' && e.reason.includes(t2.name) && e.reason.includes('Committed'))).toBe(true);
    expectExplained(career);

    // committed careers stop courting: a further update moves nothing
    const snapshot = structuredClone(career.recruiting);
    updateRecruiting(career, standIn(12));
    expect(career.recruiting).toEqual(snapshot);

    // fail-loud guards: double commits and unknown paper are tick bugs
    expect(() => commitToOffer(career, lose.id)).toThrow('already committed');
    const fresh = boardCareer();
    expect(() => commitToOffer(fresh, 'off-nope')).toThrow('unknown offer');
  });
});
