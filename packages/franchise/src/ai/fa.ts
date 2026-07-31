/**
 * ai/fa.ts — the free-agency market. OWNER: ai-team task. STATUS: INERT
 * stub (spine calls daily in FA phase); implementation replaces.
 * Market clears stars-first over weeks; decisions weigh money/role/
 * winning/market/incumbency by disposition (params.fa).
 */
import type { League, Transaction } from '../types.js';

/** One FA day: AI offers, player decisions, signings executed. */
export function runFreeAgencyDay(league: League): Transaction[] {
  return []; // INERT until ai-team task lands: the market is frozen.
}

/** Option/QO decisions for AI teams at the offseason deadlines. */
export function runAiOffseasonDecisions(league: League): Transaction[] {
  return []; // INERT until ai-team task lands.
}
