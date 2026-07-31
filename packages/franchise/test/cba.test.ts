/**
 * CBA golden cases - the trust battery (docs/FRANCHISE.md §6). Anchors come
 * from docs/history/franchise-research/06-cba-rules.md; when this suite and
 * a stat-literate player disagree, one of them cites a source.
 */
import { describe, expect, it } from 'vitest';
import type { League, TeamId } from '../src/types.js';
import { capSheet, rollCapLines, taxBillFor } from '../src/cba/cap.js';
import {
  availableMeans, maxSalaryFor, minSalaryFor, rookieScaleContract,
  signingSeason, validateSigning,
} from '../src/cba/contracts.js';
import { maxIncomingFor, validateTrade } from '../src/cba/tradelegal.js';
import { executeDraftSelection, executeOptionDecision, executeTrade, executeWaive } from '../src/transactions.js';
import { fixtureLeague } from './fixture.js';

/** Set every rostered player's current-season salary so payroll is exact. */
function setPayroll(league: League, teamId: TeamId, perPlayer: number): void {
  for (const pid of league.teams[teamId]!.roster) {
    const c = league.players[pid]!.contract!;
    for (const y of c.years) { y.salary = perPlayer; y.guaranteed = perPlayer; }
  }
}

function givePicks(league: League, teamId: TeamId, seasons: number[]): void {
  for (const s of seasons) {
    league.teams[teamId]!.picks.push({
      id: `${s}-r1-${teamId}`, season: s, round: 1, originalTeam: teamId, owner: teamId,
    });
  }
}

describe('cap anchors and tax math', () => {
  it('reproduces the 2026-27 dollar anchors', () => {
    const league = fixtureLeague();
    const sheet = capSheet(league, 'nye');
    expect(sheet.cap).toBe(164_961_000);            // REAL genesis cap
    expect(sheet.tax).toBe(200_428_000);            // REAL tax line
    expect(sheet.apron1).toBe(209_015_000);         // REAL first apron
    expect(sheet.apron2).toBe(221_686_000);         // REAL second apron
    expect(league.capLines[2026]!.minSalaryFloor).toBe(148_464_900); // 90% of cap exactly
    const anyPlayer = league.players[league.teams.nye!.roster[0]!]!;
    expect(maxSalaryFor(league, anyPlayer)).toBe(41_240_250); // 25% max, exact anchor
  });

  it('computes incremental tax with standard and repeater rates', () => {
    const league = fixtureLeague();
    // payroll = tax line + 7M: 5M in bracket 1, 2M in bracket 2
    setPayroll(league, 'nye', 20_742_800); // 10 players => 207,428,000
    expect(taxBillFor(league, 'nye', 2026)).toBe(5_000_000 * 1.00 + 2_000_000 * 1.25);
    league.teams.nye!.taxSeasonsRecent = [2023, 2024, 2025]; // 3 of prior 4: repeater
    expect(taxBillFor(league, 'nye', 2026)).toBe(5_000_000 * 3.00 + 2_000_000 * 3.25);
    expect(capSheet(league, 'nye').repeater).toBeTruthy();
  });

  it('grows cap lines within the CBA bounds and idempotently', () => {
    const league = fixtureLeague();
    rollCapLines(league, 2027);
    const l27 = league.capLines[2027]!;
    const growth = l27.cap / league.capLines[2026]!.cap - 1;
    expect(growth).toBeGreaterThanOrEqual(0.03);
    expect(growth).toBeLessThanOrEqual(0.10);
    const snapshot = JSON.stringify(l27);
    rollCapLines(league, 2027); // idempotent: never rolls twice
    expect(JSON.stringify(league.capLines[2027])).toBe(snapshot);
  });
});

describe('salary matching and apron law', () => {
  it('gives under-apron teams the three-formula envelope', () => {
    const league = fixtureLeague();
    setPayroll(league, 'nye', 18_000_000); // 180M: over cap, under apron 1
    // max(2*20M+250k, 20M+expandedTPE, 1.25*20M+250k) = 40.25M,
    // and room to apron1 (29.015M) keeps 20M+29.015M=49.015M above it
    expect(maxIncomingFor(league, 'nye', 20_000_000)).toBe(40_250_000);
  });

  it('holds first-apron teams to 100% and blocks the excess', () => {
    const league = fixtureLeague();
    setPayroll(league, 'nye', 21_500_000); // 215M: over apron 1
    expect(maxIncomingFor(league, 'nye', 20_000_000)).toBe(20_000_000);
    setPayroll(league, 'bka', 18_000_000); // trade partner, over cap
    givePicks(league, 'nye', [2027, 2028, 2029, 2030]);
    givePicks(league, 'bka', [2027, 2028, 2029, 2030]);
    const nye = league.teams.nye!.roster;
    const bka = league.teams.bka!.roster;
    // nye sends one 21.5M player, takes back two 18M players (36M > 21.5M)
    const bad = validateTrade(league, {
      from: 'nye', to: 'bka',
      give: { players: [nye[0]!], picks: [] },
      get: { players: [bka[0]!, bka[1]!], picks: [] },
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toContain('take back');
    // one-for-one at equal money is legal both ways
    const good = validateTrade(league, {
      from: 'nye', to: 'bka',
      give: { players: [nye[0]!], picks: [] },
      get: { players: [bka[0]!], picks: [] },
    });
    // bka takes 21.5M for 18M out: within 200%+250k and its apron room
    expect(good.errors.join(' ')).toBe('');
    expect(good.ok).toBe(true);
  });

  it('blocks second-apron aggregation', () => {
    const league = fixtureLeague();
    setPayroll(league, 'nye', 22_500_000); // 225M: over apron 2
    setPayroll(league, 'bka', 10_000_000);
    givePicks(league, 'nye', [2027, 2028, 2029, 2030]);
    givePicks(league, 'bka', [2027, 2028, 2029, 2030]);
    const verdict = validateTrade(league, {
      from: 'nye', to: 'bka',
      give: { players: [league.teams.nye!.roster[0]!, league.teams.nye!.roster[1]!], picks: [] },
      get: { players: [league.teams.bka!.roster[0]!], picks: [] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toContain('aggregate');
  });

  it('enforces the Stepien rule on future firsts', () => {
    const league = fixtureLeague();
    givePicks(league, 'nye', [2027, 2028, 2029, 2030, 2031, 2032, 2033]);
    givePicks(league, 'bka', [2027, 2028, 2029, 2030, 2031, 2032, 2033]);
    // trading away 2027 and 2028 leaves consecutive future drafts bare
    const bad = validateTrade(league, {
      from: 'nye', to: 'bka',
      give: { players: [], picks: ['2027-r1-nye', '2028-r1-nye'] },
      get: { players: [], picks: [] },
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toContain('Stepien');
    // trading only 2027 keeps 2028 in hand: legal
    const good = validateTrade(league, {
      from: 'nye', to: 'bka',
      give: { players: [], picks: ['2027-r1-nye'] },
      get: { players: [], picks: [] },
    });
    expect(good.ok).toBe(true);
  });

  it('respects the recent-signee trade freeze', () => {
    const league = fixtureLeague();
    setPayroll(league, 'nye', 10_000_000);
    setPayroll(league, 'bka', 10_000_000);
    givePicks(league, 'nye', [2027, 2028]);
    givePicks(league, 'bka', [2027, 2028]);
    const pid = league.teams.nye!.roster[0]!;
    league.players[pid]!.contract!.tradeableFrom = { season: 2026, day: 60 }; // frozen until day 60
    const verdict = validateTrade(league, {
      from: 'nye', to: 'bka',
      give: { players: [pid], picks: [] },
      get: { players: [league.teams.bka!.roster[0]!], picks: [] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toContain('untradeable');
  });
});

describe('executors', () => {
  it('moves players, contracts, picks, and rotation hygiene in a trade', () => {
    const league = fixtureLeague();
    setPayroll(league, 'nye', 10_000_000);
    setPayroll(league, 'bka', 10_000_000);
    givePicks(league, 'nye', [2027, 2028, 2029]);
    givePicks(league, 'bka', [2027, 2028, 2029]);
    const sent = league.teams.nye!.roster[0]!;
    const got = league.teams.bka!.roster[0]!;
    const tx = executeTrade(league, {
      from: 'nye', to: 'bka',
      give: { players: [sent], picks: ['2029-r1-nye'] },
      get: { players: [got], picks: [] },
    });
    expect(tx.kind).toBe('trade');
    expect(league.teams.bka!.roster).toContain(sent);
    expect(league.teams.nye!.roster).toContain(got);
    expect(league.players[sent]!.contract!.teamId).toBe('bka');
    expect(league.teams.bka!.picks.some(p => p.id === '2029-r1-nye')).toBeTruthy();
    expect(league.teams.nye!.rotation.starters).not.toContain(sent);
    expect(league.transactions.length).toBe(1);
  });

  it('stretches waived money over 2n+1 seasons with exact integer rows', () => {
    const league = fixtureLeague();
    const pid = league.teams.nye!.roster[0]!;
    const c = league.players[pid]!.contract!;
    c.years = [
      { season: 2026, salary: 10_000_000, guaranteed: 10_000_000 },
      { season: 2027, salary: 10_000_000, guaranteed: 10_000_000 },
      { season: 2028, salary: 10_000_000, guaranteed: 10_000_000 },
    ];
    executeWaive(league, 'nye', pid, true);
    const rows = league.deadMoney.nye!;
    expect(rows.length).toBe(7); // 2n+1 with n=3
    let sum = 0;
    for (const r of rows) sum += r.amount;
    expect(sum).toBe(30_000_000); // exact: remainder lands on season 1
    expect(league.players[pid]!.status).toBe('freeAgent');
    expect(capSheet(league, 'nye').deadMoney).toBe(rows[0]!.amount);
  });

  it('drafts on the rookie scale with sane pick-1 to pick-30 shape', () => {
    const league = fixtureLeague();
    league.phase = 'lottery';
    rollCapLines(league, 2027); // signing season lines exist at the lottery transition
    const c1 = rookieScaleContract(league, 'nye', 'p9001', 1);
    const c30 = rookieScaleContract(league, 'nye', 'p9002', 30);
    const y1 = c1.years[0]!.salary;
    const y30 = c30.years[0]!.salary;
    expect(c1.years.length).toBe(4);
    expect(c1.years[2]!.teamOption).toBeTruthy();
    expect(c1.years[0]!.season).toBe(2027); // draft business is next-season business
    const ratio = y30 / y1;
    expect(ratio).toBeGreaterThan(0.15); // real 2026-27 signed ratio ~0.20
    expect(ratio).toBeLessThan(0.30);
  });

  it('runs a draft selection end to end in the draft phase', () => {
    const league = fixtureLeague();
    league.phase = 'draft';
    rollCapLines(league, 2027);
    // a prospect appears in the pool
    const prospect = league.players[league.teams.nye!.roster[0]!]!; // borrow a body
    const pid = 'p8000';
    league.players[pid] = { ...structuredClone(prospect), id: pid, name: 'Test Prospect', status: 'draftEligible', contract: null, rights: null, seasons: [] };
    league.draftClass.push(pid);
    // roster space: waive someone first
    executeWaive(league, 'nye', league.teams.nye!.roster[14] ?? league.teams.nye!.roster[0]!, false);
    executeDraftSelection(league, 'nye', pid, 1, 5);
    expect(league.players[pid]!.status).toBe('roster');
    expect(league.players[pid]!.contract!.kind).toBe('rookieScale');
    expect(league.players[pid]!.draft!.pick).toBe(5);
    expect(league.draftClass).not.toContain(pid);
  });

  it('handles option decisions both ways', () => {
    const league = fixtureLeague();
    const pid = league.teams.nye!.roster[1]!;
    const c = league.players[pid]!.contract!;
    c.years = [
      { season: 2026, salary: 8_000_000, guaranteed: 8_000_000 },
      { season: 2027, salary: 8_000_000, guaranteed: 0, teamOption: true },
    ];
    executeOptionDecision(league, 'nye', pid, 'team', true);
    expect(c.years[1]!.guaranteed).toBe(8_000_000);
    const pid2 = league.teams.nye!.roster[2]!;
    const c2 = league.players[pid2]!.contract!;
    c2.years = [
      { season: 2026, salary: 8_000_000, guaranteed: 8_000_000 },
      { season: 2027, salary: 8_000_000, guaranteed: 0, teamOption: true },
    ];
    executeOptionDecision(league, 'nye', pid2, 'team', false);
    expect(c2.years.length).toBe(1);
  });
});

describe('signing legality', () => {
  it('rejects an over-max ask and orders means sensibly', () => {
    const league = fixtureLeague();
    const faId = 'p7000';
    const donor = league.players[league.teams.bka!.roster[0]!]!;
    league.players[faId] = { ...structuredClone(donor), id: faId, name: 'Test FreeAgent', status: 'freeAgent', contract: null, rights: null, seasons: [] };
    league.freeAgents.push(faId);

    const over = validateSigning(league, 'nye', faId, { years: 3, startSalary: 60_000_000 }, 'capSpace');
    expect(over.ok).toBe(false);
    expect(over.errors.join(' ')).toContain('max');

    // fixture payroll 100M leaves real cap space: capSpace ranks first
    const means = availableMeans(league, 'nye', faId, { years: 2, startSalary: 20_000_000 });
    expect(means[0]).toBe('capSpace');
    const minMeans = availableMeans(league, 'nye', faId, { years: 1, startSalary: minSalaryFor(league, league.players[faId]!) });
    expect(minMeans).toContain('minimum');
  });

  it('turns the league year at the lottery for contract construction', () => {
    const league = fixtureLeague();
    expect(signingSeason(league)).toBe(2026); // camp: current season
    league.phase = 'freeAgency';
    expect(signingSeason(league)).toBe(2027); // July business is next-season business
  });
});
