/**
 * ai/valuation.ts — the value model: players, picks, packages. OWNER:
 * ai-trade task. STATUS: STAGED stub; signatures frozen. THROWS (pure
 * compute; nothing calls it until its consumers land).
 * Surplus value = projected production over remaining contract, persona/
 * timeline-adjusted (docs/FRANCHISE.md §7).
 */
import type { DraftPick, League, TeamId, TradeOffer } from '../types.js';

/** Team-context value of a player TO this team (not a global number). */
export function playerValue(league: League, teamId: TeamId, playerId: string): number {
  throw new Error('franchise/ai/valuation: not implemented (ai-trade task lands this)');
}

export function pickValue(league: League, teamId: TeamId, pick: DraftPick): number {
  throw new Error('franchise/ai/valuation: not implemented (ai-trade task lands this)');
}

/** Net value of an offer from `perspective`'s side (positive = they gain). */
export function offerNet(league: League, perspective: TeamId, offer: TradeOffer): number {
  throw new Error('franchise/ai/valuation: not implemented (ai-trade task lands this)');
}
