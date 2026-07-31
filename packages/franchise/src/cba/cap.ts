/**
 * cba/cap.ts — cap arithmetic: payroll, space, holds, tax, aprons.
 * OWNER: cba task. STATUS: STAGED stub; signatures frozen.
 * All money integer dollars. Rounding: floor at final display only;
 * intermediate math stays exact integers where the CBA defines integers.
 */
import type { League, Season, TeamId } from '../types.js';

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

export function capSheet(league: League, teamId: TeamId, season?: Season): CapSheet {
  throw new Error('franchise/cba/cap: not implemented (cba task lands this)');
}

/** Grow cap lines into a new season (sampled growth, economy stream). */
export function rollCapLines(league: League, into: Season): void {
  throw new Error('franchise/cba/cap: not implemented (cba task lands this)');
}

export function taxBillFor(league: League, teamId: TeamId, season: Season): number {
  throw new Error('franchise/cba/cap: not implemented (cba task lands this)');
}
