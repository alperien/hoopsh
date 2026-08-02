/**
 * AI team layer tests: scouting fog of war, depth charts/rotations/roster
 * upkeep, the free-agency market, and AI draft boards (ai-team task).
 *
 * COMPUTE BUDGET: zero engine games. Every scenario is pure state built by
 * hand on fixtureLeague (build-wave rule: never depend on genesis). The FA
 * market scenario simulates ~80 calendar days of pure market state, run
 * once at module load and shared across its assertions; a cloned second run
 * proves the market's day-stream determinism.
 *
 * Design law under test (docs/FRANCHISE.md 7 and 9): the fog belongs to the
 * future, not the present; a team's read on a player is persistent and
 * per-team; the market clears stars first through the same validators the
 * user faces; AI boards are built from their own scouts' wrong numbers.
 */
import { describe, expect, it } from 'vitest';
import { ATTR_KEYS } from '@hoopsh/data';
import type { FrPlayer, Injury, League, PlayerId, TeamId, Transaction } from '../src/types.js';
import { rollCapLines } from '../src/cba/cap.js';
import { groupMean } from '../src/people/dev.js';
import { buildUserReport, perceivedGroup, runCombine } from '../src/scouting.js';
import { abilityScore, aiRosterUpkeep, defaultRotation, depthChart } from '../src/ai/roster.js';
import { runAiOffseasonDecisions, runFreeAgencyDay, tenderQualifyingOffers } from '../src/ai/fa.js';
import { aiSelect } from '../src/ai/draftai.js';
import { applyUserAction } from '../src/tick.js';
import { fixtureLeague, fixturePlayer } from './fixture.js';

// ------------------------------------------------------------------ helpers

/** Every engine dial to one value: groupMean(v) = v for every group, so ability reads exactly v. */
function setAllAttrs(p: FrPlayer, v: number): void {
  for (const k of ATTR_KEYS) p.attr[k] = v;
}

function flatPotential(p: FrPlayer, v: number): void {
  p.potential = { phys: v, scoring: v, playmaking: v, defense: v, rebounding: v, mental: v };
}

function injury(days: number): Injury {
  return {
    kind: 'ankle-sprain', label: 'sprained left ankle',
    severity: days > 20 ? 'major' : 'minor',
    startedOn: { season: 2026, day: 0 }, outDays: days, remainingDays: days,
  };
}

/** Detach a rostered fixture player into unrestricted free agency. */
function freeUp(league: League, teamId: TeamId, playerId: PlayerId): FrPlayer {
  const p = league.players[playerId]!;
  p.contract = null;
  p.status = 'freeAgent';
  p.rights = null;
  const team = league.teams[teamId]!;
  team.roster = team.roster.filter((id) => id !== playerId);
  team.rotation.starters = team.rotation.starters.filter((id) => id !== playerId);
  if (!league.freeAgents.includes(playerId)) league.freeAgents.push(playerId);
  return p;
}

/** A hand-built draft-eligible prospect with flat current/ceiling values. */
function makeProspect(league: League, id: PlayerId, builderIdx: number, current: number, ceiling: number): FrPlayer {
  const p = fixturePlayer(id, null, league.season, builderIdx);
  p.status = 'draftEligible';
  setAllAttrs(p, current);
  flatPotential(p, ceiling);
  league.players[id] = p;
  return p;
}

/** An AI team's full board order: repeated aiSelect over a shrinking pool. */
function boardOrder(league: League, teamId: TeamId, pool: PlayerId[]): PlayerId[] {
  const avail = [...pool];
  const out: PlayerId[] = [];
  while (avail.length > 0) {
    const pick = aiSelect(league, teamId, avail);
    out.push(pick);
    avail.splice(avail.indexOf(pick), 1);
  }
  return out;
}

// ------------------------------------------------- the shared market run
// Six unrestricted FAs with hand-set, well-separated abilities; the middle
// one is a 95-loyalty player whose Bird rights bka holds. Free agency runs
// day 0..79 (open + tail); the same run on a clone proves determinism.

const FA_ABILITIES = [74, 68, 62, 56, 50, 44]; // below the 25% max share line so AAVs separate instead of clamping together
const market = (() => {
  const league = fixtureLeague({ seed: 'ai-team-market' });
  rollCapLines(league, league.season + 1); // July deals price against next season's lines (signingSeason)
  league.phase = 'freeAgency';
  const fas = league.teams.nye!.roster.slice(0, 6);
  fas.forEach((id, i) => {
    const p = freeUp(league, 'nye', id);
    setAllAttrs(p, FA_ABILITIES[i]!);
  });
  const loyalId = fas[2]!; // mid-market player: money differences are small, loyalty can decide
  league.players[loyalId]!.disposition.loyalty = 95;
  league.players[loyalId]!.rights = { teamId: 'bka', tier: 'bird', capHold: 12_000_000, restricted: false };

  const clone = structuredClone(league);
  let error: string | null = null;
  const advance = (l: League): void => {
    // 80 = FEEL test horizon: open (day 0) + marketTailDays (70) + slack for jitter slips
    for (let d = 0; d < 80; d++) {
      l.day = d;
      runFreeAgencyDay(l);
    }
  };
  try {
    advance(league);
    advance(clone); // the determinism pair; skipped when the first run failed (the error assertion reports it)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const signings = league.transactions.filter(
    (t): t is Extract<Transaction, { kind: 'signing' }> => t.kind === 'signing',
  );
  return { league, clone, fas, loyalId, signings, error };
})();

// ------------------------------------------------------------------ suites

describe('scouting fog of war', () => {
  const league = fixtureLeague({ seed: 'ai-team-scout' });
  const rostered = league.teams.bka!.roster[0]!;
  const prospect = makeProspect(league, 'pr01', 1, 60, 78);

  it('reads a rostered player\'s CURRENT groups exactly (register F5: the fog belongs to the future)', () => {
    const p = league.players[rostered]!;
    expect(perceivedGroup(league, 'nye', rostered, 'scoring', 'current')).toBe(groupMean(p.attr, 'scoring'));
    expect(perceivedGroup(league, 'bos', rostered, 'defense', 'current')).toBe(groupMean(p.attr, 'defense'));
  });

  it('fogs a prospect\'s current ability and every ceiling read', () => {
    expect(perceivedGroup(league, 'bka', 'pr01', 'scoring', 'current')).not.toBe(60);
    // potential is ALWAYS a projection, even for a rostered veteran
    expect(perceivedGroup(league, 'bka', rostered, 'scoring', 'ceiling'))
      .not.toBe(league.players[rostered]!.potential.scoring);
  });

  it('is persistent: the same team asking twice gets the identical read', () => {
    const first = perceivedGroup(league, 'bka', 'pr01', 'phys', 'current');
    expect(perceivedGroup(league, 'bka', 'pr01', 'phys', 'current')).toBe(first);
    // and asking about OTHER groups in between must not advance any stream
    perceivedGroup(league, 'bka', 'pr01', 'mental', 'ceiling');
    expect(perceivedGroup(league, 'bka', 'pr01', 'phys', 'current')).toBe(first);
  });

  it('gives two teams different reads on one prospect (their scouts are wrong differently)', () => {
    expect(perceivedGroup(league, 'bka', 'pr01', 'scoring', 'current'))
      .not.toBe(perceivedGroup(league, 'bos', 'pr01', 'scoring', 'current'));
  });

  it('shrinks scouting error with coverage, at the scale where busts are made', () => {
    // one read can legitimately WORSEN with coverage (the error converges
    // toward the persistent team bias, not toward zero), so the design
    // claim is asserted where it lives: across a whole class, more coverage
    // means smaller average miss (docs/FRANCHISE.md 9)
    const scale = fixtureLeague({ seed: 'ai-team-coverage' });
    const truth = 60;
    const ids: PlayerId[] = [];
    for (let i = 0; i < 12; i++) {
      const id = `cv${String(i).padStart(2, '0')}`;
      makeProspect(scale, id, i, truth, truth + 12);
      ids.push(id);
    }
    const meanMiss = (coverage: number): number => {
      let sum = 0;
      for (const id of ids) {
        scale.scouting[id] = {
          playerId: id,
          current: {} as never, ceiling: {} as never,
          coverage, role: '', comparison: '', strengths: [], flags: [],
          updatedOn: { season: 2026, day: 0 },
        };
        sum += Math.abs(perceivedGroup(scale, 'nye', id, 'scoring', 'current') - truth);
      }
      return sum / ids.length;
    };
    const missAt0 = meanMiss(0);
    const missAt90 = meanMiss(90);
    expect(missAt90).toBeLessThan(missAt0);
    // and a single read refines MONOTONICALLY: the mid-coverage read sits
    // between the cold read and the full-coverage read, never zigzagging
    const at = (coverage: number): number => {
      scale.scouting[ids[0]!]!.coverage = coverage;
      return perceivedGroup(scale, 'nye', ids[0]!, 'scoring', 'current');
    };
    const p0 = at(0);
    const p45 = at(45);
    const p90 = at(90);
    expect((p45 - p0) * (p90 - p45)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(p90 - p0) >= Math.abs(p90 - p45)).toBe(true);
  });

  it('builds an honest user report: clamped ranges, role, comparison, medical flag, coverage as confidence', () => {
    const flagged = makeProspect(league, 'pr02', 2, 62, 80);
    flagged.health.proneness = 80; // above the 70 medical-flag line
    const report = buildUserReport(league, 'pr02');
    const groups = Object.keys(report.current) as Array<keyof typeof report.current>;
    expect(groups.length).toBe(6);
    expect(groups.every((g) =>
      report.current[g][0] >= 0 && report.current[g][1] <= 100 && report.current[g][0] <= report.current[g][1]
      && report.ceiling[g][0] >= 0 && report.ceiling[g][1] <= 100 && report.ceiling[g][0] <= report.ceiling[g][1],
    )).toBe(true);
    expect(report.role.length).toBeGreaterThan(0);
    expect(report.comparison.length).toBeGreaterThan(0);
    expect(report.flags.some((f) => f.includes('medical'))).toBe(true);
    expect(report.coverage).toBe(0);
    expect(report.updatedOn).toEqual({ season: league.season, day: league.day });
  });

  it('runCombine grants combine coverage to the class and narrows the printed ranges', () => {
    const before = buildUserReport(league, 'pr01');
    league.draftClass = ['pr01'];
    runCombine(league);
    const after = league.scouting['pr01']!;
    expect(after.coverage).toBe(league.params.scouting.combineCoverage);
    const width = (r: readonly [number, number]): number => r[1] - r[0];
    // more coverage, tighter range (values sit mid-scale so clamping cannot mask the shrink)
    expect(width(after.current.scoring)).toBeLessThan(width(before.current.scoring));
  });
});

describe('depth charts and rotations', () => {
  it('orders the chart by position-weighted ability, available bodies first', () => {
    const league = fixtureLeague({ seed: 'ai-team-chart' });
    const best = league.teams.bka!.roster[3]!;
    setAllAttrs(league.players[best]!, 90);
    expect(depthChart(league, 'bka')[0]).toBe(best);
    // hurt him: still charted, but behind everyone who can dress
    league.players[best]!.health.injury = injury(10);
    const chart = depthChart(league, 'bka');
    expect(chart[0]).not.toBe(best);
    expect(chart[chart.length - 1]).toBe(best);
  });

  it('builds a five-position starting unit with tier minutes summing inside [225, 250]', () => {
    const league = fixtureLeague({ seed: 'ai-team-rot' });
    const rot = defaultRotation(league, 'bos');
    expect(rot.starters.length).toBe(5);
    expect(new Set(rot.starters).size).toBe(5);
    // fixture rosters carry all five positions; a plausible unit uses them
    const positions = new Set(rot.starters.map((id) => league.players[id]!.pos));
    expect(positions.size).toBe(5);
    const sum = Object.values(rot.minutes).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(225);
    expect(sum).toBeLessThanOrEqual(250);
    expect(rot.b2bRestBelow).toBe(league.params.rotation.b2bRestBelow);
    expect(rot.scratches).toEqual([]);
  });

  it('gives players 11+ on the chart no minutes target', () => {
    const league = fixtureLeague({ seed: 'ai-team-rot11' });
    const extra = fixturePlayer('x11', 'bka', league.season, 10);
    setAllAttrs(extra, 30); // clearly the 11th man
    league.players['x11'] = extra;
    league.teams.bka!.roster.push('x11');
    const rot = defaultRotation(league, 'bka');
    expect(Object.keys(rot.minutes).length).toBe(10);
    expect(rot.minutes['x11']).toBeUndefined();
  });
});

describe('AI roster upkeep', () => {
  it('fills AI rosters toward the 14-man floor with legal minimum signings, user team untouched', () => {
    const league = fixtureLeague({ seed: 'ai-team-upkeep' });
    for (let i = 0; i < 6; i++) {
      const id = `fa0${i}`;
      league.players[id] = fixturePlayer(id, null, league.season, i);
      league.freeAgents.push(id);
    }
    aiRosterUpkeep(league);
    // deterministic team order: bka (first AI id) fills to 14, bos takes the remaining two
    expect(league.teams.nye!.roster.length).toBe(10); // the user's shop is theirs to run
    expect(league.teams.bka!.roster.length).toBe(14);
    expect(league.teams.bos!.roster.length).toBe(12);
    expect(league.freeAgents.length).toBe(0);
    const signings = league.transactions.filter((t) => t.kind === 'signing');
    expect(signings.length).toBe(6);
    expect(signings.every((t) => t.kind === 'signing' && t.contract.means === 'minimum')).toBe(true);
  });

  it('does not scoop the market during the free-agency window (the FA module owns those signings)', () => {
    const league = fixtureLeague({ seed: 'ai-team-upkeep-fa' });
    rollCapLines(league, league.season + 1);
    league.phase = 'freeAgency';
    league.players['fa10'] = fixturePlayer('fa10', null, league.season, 0);
    league.freeAgents.push('fa10');
    aiRosterUpkeep(league);
    expect(league.transactions.filter((t) => t.kind === 'signing').length).toBe(0);
  });

  it('repairs a rotation whose starter went down', () => {
    const league = fixtureLeague({ seed: 'ai-team-upkeep-rot' });
    const starter = league.teams.phi!.rotation.starters[0]!;
    league.players[starter]!.health.injury = injury(10);
    aiRosterUpkeep(league);
    expect(league.teams.phi!.rotation.starters).not.toContain(starter);
    expect(league.teams.phi!.rotation.starters.length).toBe(5);
  });

  it('promotes the best two-way to a rest-of-season minimum when fewer than 9 can dress', () => {
    const league = fixtureLeague({ seed: 'ai-team-upkeep-2w' });
    const bka = league.teams.bka!;
    for (const id of bka.roster.slice(0, 2)) league.players[id]!.health.injury = injury(30);
    const tw = fixturePlayer('tw01', null, league.season, 3);
    tw.status = 'roster';
    tw.contract = {
      id: 'ct-tw01', playerId: 'tw01', teamId: 'bka',
      years: [{ season: league.season, salary: 600_000, guaranteed: 0 }],
      kind: 'twoWay', means: 'minimum', signedOn: { season: league.season, day: 0 }, birdYearsAtSigning: 0,
    };
    league.players['tw01'] = tw;
    bka.twoWay.push('tw01');
    aiRosterUpkeep(league);
    expect(bka.roster).toContain('tw01');
    expect(bka.twoWay.length).toBe(0);
    expect(league.players['tw01']!.contract!.kind).toBe('restOfSeason');
  });

  it('never fill-signs a careerControlled free agent, even the best body on the market', () => {
    // provenance: #69 / H-seams-1 — an abroad career player sits in
    // league.players as a top freeAgent for whole seasons; the floor fill
    // auto-signed him onto an NBA roster with no career-side event
    const league = fixtureLeague({ seed: 'ai-team-upkeep-career' });
    for (let i = 0; i < 5; i++) {
      const id = `fa2${i}`;
      league.players[id] = fixturePlayer(id, null, league.season, i);
      league.freeAgents.push(id);
    }
    const abroad = fixturePlayer('ca01', null, league.season, 5);
    setAllAttrs(abroad, 90); // tops the ability-sorted market by a mile
    league.players['ca01'] = abroad;
    league.freeAgents.push('ca01');
    league.careerControlled = ['ca01'];
    aiRosterUpkeep(league);
    // the listed player is untouched: still a free agent, on nobody's roster
    expect(abroad.status).toBe('freeAgent');
    expect(league.freeAgents).toEqual(['ca01']);
    const rostered = Object.values(league.teams).some(
      (t) => t.roster.includes('ca01') || t.twoWay.includes('ca01'),
    );
    expect(rostered).toBe(false);
    expect(league.transactions.some((t) => t.kind === 'signing' && t.playerId === 'ca01')).toBe(false);
    // and the skip is a filter, not an abort: every unlisted body signed
    expect(league.transactions.filter((t) => t.kind === 'signing').length).toBe(5);
  });

  it('never converts a careerControlled two-way; the best unlisted body goes up instead', () => {
    // provenance: #69 / H-seams-1 — conversion is a waive plus a re-sign,
    // both world decisions; a career player on a real two-way contract
    // (the below-floor offer tier) was reachable as the pick
    const league = fixtureLeague({ seed: 'ai-team-upkeep-2w-career' });
    const bka = league.teams.bka!;
    for (const id of bka.roster.slice(0, 2)) league.players[id]!.health.injury = injury(30);
    const addTwoWay = (id: PlayerId, builderIdx: number, ability: number): FrPlayer => {
      const p = fixturePlayer(id, null, league.season, builderIdx);
      p.status = 'roster';
      setAllAttrs(p, ability);
      p.contract = {
        id: `ct-${id}`, playerId: id, teamId: 'bka',
        years: [{ season: league.season, salary: 600_000, guaranteed: 0 }],
        kind: 'twoWay', means: 'minimum', signedOn: { season: league.season, day: 0 }, birdYearsAtSigning: 0,
      };
      league.players[id] = p;
      bka.twoWay.push(id);
      return p;
    };
    const listed = addTwoWay('cw01', 3, 70); // the better body, but career-controlled
    addTwoWay('tw02', 4, 40);
    league.careerControlled = ['cw01'];
    aiRosterUpkeep(league);
    // the listed two-way is untouched: same slot, same contract, no waive
    expect(bka.twoWay).toContain('cw01');
    expect(listed.contract!.kind).toBe('twoWay');
    expect(league.transactions.some((t) => t.kind === 'waive' && t.playerId === 'cw01')).toBe(false);
    // the staff still fixes the bench: the unlisted body converts
    expect(bka.roster).toContain('tw02');
    expect(league.players['tw02']!.contract!.kind).toBe('restOfSeason');
  });
});

describe('the free-agency market', () => {
  it('acts only in the freeAgency phase (the moratorium is news-only)', () => {
    const league = fixtureLeague({ seed: 'ai-team-mor' });
    rollCapLines(league, league.season + 1);
    league.phase = 'moratorium';
    freeUp(league, 'nye', league.teams.nye!.roster[0]!);
    expect(runFreeAgencyDay(league)).toEqual([]);
    expect(league.freeAgents.length).toBe(1);
  });

  it('clears the whole class legally through the executors', () => {
    expect(market.error).toBe(null); // any illegal signing would have thrown inside the run
    expect(market.signings.length).toBe(6);
    expect(market.league.freeAgents.length).toBe(0);
    expect(market.signings.every((s) => market.league.players[s.playerId]!.status === 'roster')).toBe(true);
  });

  it('clears stars first: signing day follows market rank, the best free agent earliest', () => {
    const dayOf = (id: PlayerId): number => market.signings.find((s) => s.playerId === id)!.date.day;
    const days = market.fas.map(dayOf);
    expect(days[0]!).toBeLessThan(days[1]!); // the board-setter signs before the field
    for (let i = 1; i < days.length; i++) expect(days[i]!).toBeGreaterThanOrEqual(days[i - 1]!);
  });

  it('pays the market rank: AAV strictly descends down the ability order', () => {
    const aavOf = (id: PlayerId): number => market.signings.find((s) => s.playerId === id)!.contract.years[0]!.salary;
    const aavs = market.fas.map(aavOf);
    for (let i = 1; i < aavs.length; i++) expect(aavs[i]!).toBeLessThan(aavs[i - 1]!);
    // ability 74 at age 22 commands term: prime-age deals run 3-4 years
    const bestYears = market.signings.find((s) => s.playerId === market.fas[0])!.contract.years.length;
    expect(bestYears).toBeGreaterThanOrEqual(3);
    expect(bestYears).toBeLessThanOrEqual(4);
  });

  it('lets loyalty pull a close call back to the rights-holding incumbent', () => {
    const signing = market.signings.find((s) => s.playerId === market.loyalId)!;
    expect(signing.teamId).toBe('bka');
  });

  it('is deterministic: the cloned league\'s market clears byte-identically', () => {
    expect(JSON.stringify(market.clone.transactions)).toBe(JSON.stringify(market.league.transactions));
  });
});

describe('restricted free agency', () => {
  it('tenders the qualifying offer on a keeper and withdraws it on a fringe player', () => {
    const league = fixtureLeague({ seed: 'ai-team-tender' });
    rollCapLines(league, league.season + 1);
    league.phase = 'freeAgency';
    const good = freeUp(league, 'bos', league.teams.bos!.roster[0]!);
    const fringe = freeUp(league, 'bos', league.teams.bos!.roster[1]!);
    setAllAttrs(good, 70);
    setAllAttrs(fringe, 35);
    for (const p of [good, fringe]) {
      p.rights = { teamId: 'bka', tier: 'bird', capHold: 8_000_000, restricted: true };
    }
    tenderQualifyingOffers(league);
    expect(good.rights!.restricted).toBe(true);
    expect(good.rights!.qualifyingOffer).toBeGreaterThan(0);
    expect(fringe.rights!.restricted).toBe(false);
    expect(fringe.rights!.qualifyingOffer).toBeUndefined();
  });

  it('turns an outside winning bid into an offer sheet, resolved by the incumbent\'s match', () => {
    const league = fixtureLeague({ seed: 'ai-team-rfa' });
    rollCapLines(league, league.season + 1);
    league.phase = 'freeAgency';
    const rfa = freeUp(league, 'bos', league.teams.bos!.roster[2]!);
    setAllAttrs(rfa, 72);
    // the USER team holds the rights, so resolution runs through the
    // landed matchOfferSheet action (tick.ts) instead of AI auto-match
    rfa.rights = { teamId: 'nye', tier: 'bird', capHold: 9_000_000, restricted: true, qualifyingOffer: 5_000_000 };
    let sheetDay = -1;
    for (let d = 0; d < 10 && sheetDay < 0; d++) {
      league.day = d;
      runFreeAgencyDay(league);
      if (league.offerSheets.length > 0) sheetDay = d;
    }
    expect(league.offerSheets.length).toBe(1);
    const sheet = league.offerSheets[0]!;
    expect(sheet.playerId).toBe(rfa.id);
    expect(sheet.from).not.toBe('nye');
    expect(sheet.decideBy).toEqual({ season: league.season, day: sheetDay + league.params.cba.offerSheetMatchDays });
    expect(rfa.status).toBe('freeAgent'); // nothing signs until the match window resolves
    const res = applyUserAction(league, { kind: 'matchOfferSheet', playerId: rfa.id, matched: true });
    expect(res.ok).toBe(true);
    expect(league.teams.nye!.roster).toContain(rfa.id);
    expect(rfa.status).toBe('roster');
    expect(league.offerSheets.length).toBe(0);
  });

  it('decides AI options at the deadline: a bargain team option gets exercised', () => {
    const league = fixtureLeague({ seed: 'ai-team-opt' });
    league.phase = 'moratorium'; // the deadline sits inside the moratorium (tick.ts optionDeadlineDay)
    const pid = league.teams.bka!.roster[0]!;
    const year = league.players[pid]!.contract!.years[1]!;
    year.salary = 5_000_000; // far under the player's market read: an obvious keep
    year.guaranteed = 0;
    year.teamOption = true;
    const out = runAiOffseasonDecisions(league);
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe('optionDecision');
    expect(year.guaranteed).toBe(year.salary); // an exercised team option becomes guaranteed money
    expect(year.teamOption).toBeUndefined();
  });
});

describe('AI draft boards', () => {
  const league = fixtureLeague({ seed: 'ai-team-draft' });
  const pool: PlayerId[] = [];
  for (let i = 0; i < 10; i++) {
    const id = `dx${String(i).padStart(2, '0')}`;
    // close abilities across mixed positions: the board is decided by each
    // team's scouting error, which is the design (busts come from scouting)
    makeProspect(league, id, i, 60 + (i % 3), 72 + (i % 3));
    pool.push(id);
  }

  it('is deterministic: the same room re-ranks the same board', () => {
    const first = boardOrder(league, 'bka', pool);
    expect(boardOrder(league, 'bka', pool)).toEqual(first);
    expect(aiSelect(league, 'bka', pool)).toBe(first[0]!);
  });

  it('moves the board when the scouting identity changes (different scoutSeeds, different boards)', () => {
    const before = boardOrder(league, 'bka', pool).join(',');
    const original = league.teams.bka!.scoutSeed;
    league.teams.bka!.scoutSeed = 999_983;
    const after = boardOrder(league, 'bka', pool).join(',');
    league.teams.bka!.scoutSeed = original;
    expect(after).not.toBe(before);
    // and two different rooms never share one board
    expect(boardOrder(league, 'bos', pool).join(',')).not.toBe(before);
  });

  it('scales ceiling weight with persona risk: the cautious room takes the floor, the gambler the boom', () => {
    makeProspect(league, 'dsafe', 2, 75, 75); // the finished product
    makeProspect(league, 'dboom', 2, 45, 99); // the dream (same position: need cancels)
    league.teams.bos!.gm!.risk = 0;
    expect(aiSelect(league, 'bos', ['dsafe', 'dboom'])).toBe('dsafe');
    league.teams.bos!.gm!.risk = 100;
    expect(aiSelect(league, 'bos', ['dsafe', 'dboom'])).toBe('dboom');
  });
});

describe('#164: free agency convenes (scoop gate, salary floor, tax appetite)', () => {
  it('upkeep leaves the July class to the July market: no rights-holding fills in the offseason window', () => {
    const league = fixtureLeague({ seed: 'ai-team-164-scoop' });
    rollCapLines(league, league.season + 1);
    league.phase = 'draft'; // post-lottery release, pre-moratorium: the old scoop window
    const vet = fixturePlayer('vet1', null, league.season, 4);
    setAllAttrs(vet, 90); // tops the ability-sorted patch pool by a mile
    vet.rights = { teamId: 'bos', tier: 'bird', capHold: 30_000_000, restricted: false };
    league.players['vet1'] = vet;
    league.freeAgents.push('vet1');
    const scrap = fixturePlayer('fa90', null, league.season, 1); // no rights: genuine scrap
    league.players['fa90'] = scrap;
    league.freeAgents.push('fa90');
    aiRosterUpkeep(league);
    expect(vet.status).toBe('freeAgent'); // the expiring class is never scooped
    expect(scrap.status).toBe('roster'); // the scrap pool still patches rosters
  });

  it('rights-holders return to the patch pool once the market has had its window', () => {
    const league = fixtureLeague({ seed: 'ai-team-164-postfa' });
    // in-season: signing season == label season, the July market is over
    const vet = fixturePlayer('vet2', null, league.season, 4);
    vet.rights = { teamId: 'bos', tier: 'nonBird', capHold: 2_000_000, restricted: false };
    league.players['vet2'] = vet;
    league.freeAgents.push('vet2');
    aiRosterUpkeep(league);
    expect(vet.status).toBe('roster');
  });

  it('a team under the salary floor is a buyer by rule: the floor opens the need gate', () => {
    const run = (padToFloorOffset: number): League => {
      const league = fixtureLeague({ seed: 'ai-team-164-floor' });
      rollCapLines(league, league.season + 1);
      league.phase = 'freeAgency';
      const s = league.season + 1;
      const lines = league.capLines[s]!;
      for (const tid of ['bka', 'bos', 'phi'] as TeamId[]) {
        const team = league.teams[tid]!;
        // stuff the roster to the 14-man floor with centers so a center
        // free agent reads need 0 everywhere (no stock need, no short-roster
        // point, retool timeline adds nothing)
        let i = 0;
        while (team.roster.length < league.params.cba.rosterMin) {
          const id = `${tid}c${i}`;
          league.players[id] = fixturePlayer(id, tid, league.season, 4);
          team.roster.push(id);
          i += 1;
        }
        // one pad contract parks next-season payroll relative to the floor
        const others = (team.roster.length - 1) * 10_000_000;
        const pad = league.players[team.roster[0]!]!;
        pad.contract!.years.find((y) => y.season === s)!.salary =
          lines.minSalaryFloor + padToFloorOffset - others;
      }
      const fa = fixturePlayer('flr1', null, league.season, 4); // center, no rights
      setAllAttrs(fa, 70);
      league.players['flr1'] = fa;
      league.freeAgents.push('flr1');
      for (let d = 0; d < 3; d += 1) {
        league.day = d;
        runFreeAgencyDay(league);
      }
      return league;
    };
    // every AI team 25M OVER the floor: need 0, nobody calls
    const over = run(25_000_000);
    expect(over.players['flr1']!.status).toBe('freeAgent');
    // every AI team 25M UNDER the floor: the floor gate opens, the market bids
    const under = run(-25_000_000);
    expect(under.players['flr1']!.status).toBe('roster');
    const signing = under.transactions.find((t) => t.kind === 'signing' && t.playerId === 'flr1');
    expect(signing).toBeDefined();
  });

  it('an owner spends to his appetite ceiling, and a near-ceiling bid clamps to remaining budget', () => {
    const run = (appetite: number): League => {
      const league = fixtureLeague({ seed: 'ai-team-164-appetite' });
      rollCapLines(league, league.season + 1);
      league.phase = 'freeAgency';
      const s = league.season + 1;
      const lines = league.capLines[s]!;
      for (const tid of ['bka', 'bos', 'phi'] as TeamId[]) {
        const team = league.teams[tid]!;
        team.owner.taxAppetite = appetite;
        // park next-season payroll exactly at the tax line: the short
        // fixture rosters keep need positive, so ONLY the appetite ceiling
        // decides whether anyone picks up the phone
        const others = (team.roster.length - 1) * 10_000_000;
        const pad = league.players[team.roster[0]!]!;
        pad.contract!.years.find((y) => y.season === s)!.salary = lines.tax - others;
      }
      const fa = fixturePlayer('app1', null, league.season, 4);
      setAllAttrs(fa, 70);
      league.players['app1'] = fa;
      league.freeAgents.push('app1');
      for (let d = 0; d < 3; d += 1) {
        league.day = d;
        runFreeAgencyDay(league);
      }
      return league;
    };
    // appetite 0: the ceiling IS the tax line, headroom is zero, nobody bids
    const cheap = run(0);
    expect(cheap.players['app1']!.status).toBe('freeAgent');
    // appetite 10: headroom is 10% of the tax-to-apron2 band — enough to
    // sign, small enough that the fair-value target must clamp to budget
    const willing = run(10);
    const lines = willing.capLines[willing.season + 1]!;
    const headroom = Math.round((10 / 100) * (lines.apron2 - lines.tax));
    expect(willing.players['app1']!.status).toBe('roster');
    const signing = willing.transactions.find((t) => t.kind === 'signing' && t.playerId === 'app1');
    expect(signing).toBeDefined();
    if (signing && signing.kind === 'signing') {
      expect(signing.contract.years[0]!.salary).toBeLessThanOrEqual(headroom);
    }
  });
});
