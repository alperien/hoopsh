/**
 * cba/contracts.ts — contract construction and signing legality.
 * OWNER: cba task. STATUS: STAGED stub; signatures frozen.
 */
import type { Contract, FrPlayer, League, SigningMeans, TeamId } from '../types.js';

export interface Legality { ok: boolean; errors: string[]; }

export interface SigningTerms {
  years: number;
  startSalary: number;
  raisesPct?: number;               // defaults to legal max for the means
  teamOptionLastYear?: boolean;
  playerOptionLastYear?: boolean;
}

/** Years of service (seasons on any roster) — drives max tier and minimums. */
export function yearsOfService(player: FrPlayer): number {
  throw new Error('franchise/cba/contracts: not implemented (cba task lands this)');
}

export function maxSalaryFor(league: League, player: FrPlayer): number {
  throw new Error('franchise/cba/contracts: not implemented (cba task lands this)');
}

export function minSalaryFor(league: League, player: FrPlayer): number {
  throw new Error('franchise/cba/contracts: not implemented (cba task lands this)');
}

export function rookieScaleContract(league: League, teamId: TeamId, playerId: string, pick: number): Contract {
  throw new Error('franchise/cba/contracts: not implemented (cba task lands this)');
}

/** What means (cap space, Bird tier, MLE...) could legally sign these terms; best first. */
export function availableMeans(league: League, teamId: TeamId, playerId: string, terms: SigningTerms): SigningMeans[] {
  throw new Error('franchise/cba/contracts: not implemented (cba task lands this)');
}

export function validateSigning(league: League, teamId: TeamId, playerId: string, terms: SigningTerms, means: SigningMeans): Legality {
  throw new Error('franchise/cba/contracts: not implemented (cba task lands this)');
}

export function buildContract(league: League, teamId: TeamId, playerId: string, terms: SigningTerms, means: SigningMeans): Contract {
  throw new Error('franchise/cba/contracts: not implemented (cba task lands this)');
}

export function qualifyingOfferFor(league: League, playerId: string): number {
  throw new Error('franchise/cba/contracts: not implemented (cba task lands this)');
}
