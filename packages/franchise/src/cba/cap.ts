/**
 * cba/cap.ts - cap arithmetic: payroll, space, holds, tax, aprons, and the
 * season-over-season growth of the cap lines. OWNER: cba task.
 *
 * Every rule cites docs/history/franchise-research/06-cba-rules.md ("research
 * 06"). All money is integer dollars; every place a fractional intermediate
 * is rounded carries a comment saying so.
 *
 * Register of simplifications (docs/FRANCHISE.md 6/13 discipline):
 * - S1 Tax bracket width is constant (params.cba.taxBracketSize). Research 06
 *   7 says the real bracket width indexes to cap growth ($5M in 2023-24,
 *   $5.168M in 2024-25). Constant width keeps the knob calibratable; lift
 *   when the economy layer grows bracket width with the cap ratio.
 * - S2 Cap holds counted here are only the FreeAgentRights holds of the
 *   team's own unsigned free agents. Unsigned first-round pick holds (120%
 *   of scale, research 06 5) are OUT of v1: the draft executor signs picks
 *   immediately, so an unsigned-pick hold can never exist yet.
 * - S3 Tax is computed on the CURRENT payroll snapshot whenever asked.
 *   Research 06 7 computes it on team salary on the final day of the regular
 *   season; the season-end caller must ask on that day. Cap holds never
 *   count toward the tax (they are cap accounting, not salary).
 * - S4 BRI true-up/escrow mechanics (research 06 1) are not modeled.
 */
import type { League, Season, TeamId } from '../types.js';
import { streamRng } from '../rng.js';

export interface CapSheet {
  season: Season;
  teamId: TeamId;
  salaries: Array<{ playerId: string; amount: number }>;
  deadMoney: number;
  capHolds: number;
  total: number;            // salaries + dead money (holds listed separately)
  cap: number; tax: number; apron1: number; apron2: number;
  spaceWithHolds: number;   // cap - total - capHolds (can be negative)
  spaceIfRenounced: number; // cap - total
  overTax: boolean; overApron1: boolean; overApron2: boolean;
  taxBill: number;
  repeater: boolean;
}

/** The cap/tax/apron lines for a season; throws when the season has not been rolled yet. */
function linesFor(league: League, season: Season): { cap: number; tax: number; apron1: number; apron2: number; minSalaryFloor: number } {
  const lines = league.capLines[season];
  if (!lines) {
    throw new Error(`cap lines for season ${season} do not exist; rollCapLines must run at season rollover`);
  }
  return lines;
}

/**
 * Team payroll for tax/apron purposes: rostered salaries plus dead money.
 * Two-way contracts never count against the cap or tax (research 06 4:
 * two-ways "don't count vs cap or 15-man limit"), so team.twoWay is skipped.
 */
function teamPayroll(league: League, teamId: TeamId, season: Season): { salaries: Array<{ playerId: string; amount: number }>; dead: number } {
  const team = league.teams[teamId];
  if (!team) throw new Error(`capSheet: unknown team ${teamId}`);
  const salaries: Array<{ playerId: string; amount: number }> = [];
  for (const pid of team.roster) {
    const contract = league.players[pid]?.contract;
    if (!contract) continue; // a rostered player without a deal has no cap number (should not persist)
    const row = contract.years.find((y) => y.season === season);
    if (row) salaries.push({ playerId: pid, amount: row.salary });
  }
  let dead = 0;
  for (const entry of league.deadMoney[teamId] ?? []) {
    if (entry.season === season) dead += entry.amount;
  }
  return { salaries, dead };
}

/** Repeater = paid tax in at least 3 of the previous 4 seasons (research 06 7). */
function isRepeater(league: League, teamId: TeamId, season: Season): boolean {
  const team = league.teams[teamId];
  if (!team) return false;
  let count = 0;
  for (const s of team.taxSeasonsRecent) {
    // window is the four seasons immediately before the one being taxed
    if (s >= season - 4 && s <= season - 1) count++;
  }
  // 3 = REAL threshold, research 06 7: "paid tax in at least 3 of the previous 4 seasons"
  return count >= 3;
}

/**
 * The luxury tax bill for a team's payroll in a season, via incremental
 * brackets (research 06 7). Post-2025-26 rates: standard 1.00/1.25/3.50/4.75
 * then +0.50 per bracket; repeater 3.00/3.25/5.50/6.75 then +0.50. Rates and
 * bracket width come from params.cba (taxRates/repeaterRates/taxBracketSize).
 *
 * Called by capSheet and directly by season-end accounting. Pure read.
 */
export function taxBillFor(league: League, teamId: TeamId, season: Season): number {
  const lines = linesFor(league, season);
  const { salaries, dead } = teamPayroll(league, teamId, season);
  let payroll = dead;
  for (const s of salaries) payroll += s.amount;
  const excess = payroll - lines.tax;
  if (excess <= 0) return 0;
  const cba = league.params.cba;
  const rates = isRepeater(league, teamId, season) ? cba.repeaterRates : cba.taxRates;
  const width = cba.taxBracketSize;
  let bill = 0;
  let remaining = excess;
  for (let i = 0; remaining > 0; i++) {
    const inBracket = Math.min(remaining, width);
    // beyond the published table the rate keeps climbing +0.50 per bracket
    // (0.50 = REAL, research 06 7: "then +0.50 per additional bracket")
    const rate = i < rates.length
      ? rates[i]!
      : rates[rates.length - 1]! + 0.50 * (i - (rates.length - 1));
    bill += inBracket * rate;
    remaining -= inBracket;
  }
  // ROUNDING: single terminal Math.round. Rates carry at most 2 decimals, so
  // per-bracket products can be fractional by < $0.005; one rounding point
  // keeps the bill deterministic and avoids per-bracket drift.
  return Math.round(bill);
}

/**
 * The full cap sheet for one team and season (defaults to the current
 * season). The trade desk, FA market, and the daily cap-legality invariant
 * all read this; it never mutates.
 *
 * Cap holds: unsigned free agents the team still holds rights on count
 * against the CAP until renounced or signed (research 06 5, "the detail most
 * sims silently drop"). Holds never count toward the tax (header S3).
 */
export function capSheet(league: League, teamId: TeamId, season?: Season): CapSheet {
  const s = season ?? league.season;
  const lines = linesFor(league, s);
  const { salaries, dead } = teamPayroll(league, teamId, s);
  let salarySum = 0;
  for (const row of salaries) salarySum += row.amount;

  // holds of this team's own unrenounced free agents (rights cleared on
  // signing/renouncement by the executors, so presence == unresolved hold)
  let capHolds = 0;
  for (const pid of league.freeAgents) {
    const rights = league.players[pid]?.rights;
    if (rights && rights.teamId === teamId) capHolds += rights.capHold;
  }

  const total = salarySum + dead;
  return {
    season: s,
    teamId,
    salaries,
    deadMoney: dead,
    capHolds,
    total,
    cap: lines.cap,
    tax: lines.tax,
    apron1: lines.apron1,
    apron2: lines.apron2,
    spaceWithHolds: lines.cap - total - capHolds,
    spaceIfRenounced: lines.cap - total,
    // "over" means strictly above the line; sitting exactly on it is legal
    overTax: total > lines.tax,
    overApron1: total > lines.apron1,
    overApron2: total > lines.apron2,
    taxBill: taxBillFor(league, teamId, s),
    repeater: isRepeater(league, teamId, s),
  };
}

/**
 * Grow the cap lines into a new season. Growth is sampled uniform in
 * [capGrowthLo, capGrowthHi] from the registered 'economy:<season>' stream
 * (rng.ts registry) and clamped to [0, capGrowthClamp]: research 06 1 says
 * the cap can rise at most 10% per year and cannot decrease (the 0%-vs-3%
 * floor is unresolved there; the sampling range already sits above 3%).
 *
 * Tax/apron/floor lines scale from GENESIS proportions of the new cap, not
 * from last season's rounded lines, so rounding error never compounds
 * across decades. Called once at season rollover by the spine; idempotent
 * (an existing target season returns without drawing, so a re-entrant call
 * cannot burn a roll).
 */
export function rollCapLines(league: League, into: Season): void {
  if (league.capLines[into]) return; // idempotency guard: never roll twice
  const prior = league.capLines[into - 1];
  if (!prior) {
    throw new Error(`rollCapLines: no cap lines for season ${into - 1} to grow from`);
  }
  const cba = league.params.cba;
  const rng = streamRng(league.seed, 'economy', into);
  let growth = rng.range(cba.capGrowthLo, cba.capGrowthHi);
  // clamp: ceiling from the CBA (research 06 1), floor at 0 (cap never shrinks)
  if (growth > cba.capGrowthClamp) growth = cba.capGrowthClamp;
  if (growth < 0) growth = 0;

  // ROUNDING: each line rounds to whole dollars exactly once, here.
  const cap = Math.round(prior.cap * (1 + growth));
  league.capLines[into] = {
    cap,
    // genesis proportions: tax ~ 121.5% of cap, aprons indexed likewise
    // (research 06 1); the ratios are carried by the genesis dollar anchors
    tax: Math.round(cap * (cba.genesisTax / cba.genesisCap)),
    apron1: Math.round(cap * (cba.genesisApron1 / cba.genesisCap)),
    apron2: Math.round(cap * (cba.genesisApron2 / cba.genesisCap)),
    minSalaryFloor: Math.round(cap * cba.minPayrollPctOfCap),
  };
}
