/**
 * money.ts - the career ledger. OWNER: money task. STATUS: mixed stub -
 * recordEarning is a tiny live helper (siblings append through it so the
 * ledger has one writer), season accruals INERT until the task lands.
 */
import type { CareerState } from './types.js';

/** The single ledger writer: appends and returns the entry. */
export function recordEarning(career: CareerState, year: number, label: string, amount: number): void {
  career.ledger.push({ year, label, amount });
}

/** Season-end accruals (contract year paid, NIL, abroad deals). INERT until money task lands. */
export function accrueSeason(career: CareerState): void {
  // INERT until the money task lands.
}
