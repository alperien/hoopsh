/**
 * cba/tradelegal.ts — trade legality: salary matching, aprons, Stepien,
 * recent-signee freezes, roster bounds. OWNER: cba task. STATUS: STAGED
 * stub; signatures frozen.
 */
import type { League, TradeOffer } from '../types.js';
import type { Legality } from './contracts.js';

/** Full legality verdict for both sides of a two-team offer. */
export function validateTrade(league: League, offer: TradeOffer): Legality {
  throw new Error('franchise/cba/tradelegal: not implemented (cba task lands this)');
}

/** Max incoming salary a team may take for given outgoing (matching bands + aprons). */
export function maxIncomingFor(league: League, teamId: string, outgoing: number): number {
  throw new Error('franchise/cba/tradelegal: not implemented (cba task lands this)');
}
