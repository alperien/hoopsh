/**
 * transactions.ts — the ONLY writers of roster/contract/pick state.
 * OWNER: cba task. STATUS: STAGED stub; signatures frozen.
 * Every executor validates first (never trust the caller), mutates
 * league, appends the Transaction, and returns it. News/inbox are NOT
 * written here (media reads league.transactions).
 */
import type { Contract, League, LeagueDate, TeamId, TradeOffer, Transaction } from './types.js';

export function executeTrade(league: League, offer: TradeOffer): Transaction {
  throw new Error('franchise/transactions: not implemented (cba task lands this)');
}
export function executeSigning(league: League, teamId: TeamId, playerId: string, contract: Contract, offerSheet?: boolean): Transaction {
  throw new Error('franchise/transactions: not implemented (cba task lands this)');
}
export function executeWaive(league: League, teamId: TeamId, playerId: string, stretch: boolean): Transaction {
  throw new Error('franchise/transactions: not implemented (cba task lands this)');
}
export function executeClaim(league: League, teamId: TeamId, playerId: string): Transaction {
  throw new Error('franchise/transactions: not implemented (cba task lands this)');
}
export function executeDraftSelection(league: League, teamId: TeamId, playerId: string, round: 1 | 2, pick: number): Transaction {
  throw new Error('franchise/transactions: not implemented (cba task lands this)');
}
export function executeOptionDecision(league: League, teamId: TeamId, playerId: string, option: 'team' | 'player', exercised: boolean): Transaction {
  throw new Error('franchise/transactions: not implemented (cba task lands this)');
}
export function executeExtension(league: League, teamId: TeamId, playerId: string, contract: Contract): Transaction {
  throw new Error('franchise/transactions: not implemented (cba task lands this)');
}
export function executeAssignment(league: League, teamId: TeamId, playerId: string, to: 'gleague' | 'roster'): Transaction {
  throw new Error('franchise/transactions: not implemented (cba task lands this)');
}
export function executeRetirement(league: League, playerId: string, date: LeagueDate): Transaction {
  throw new Error('franchise/transactions: not implemented (cba task lands this)');
}
