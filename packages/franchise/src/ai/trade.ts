/**
 * ai/trade.ts — negotiation and the league trade pulse. OWNER: ai-trade
 * task. STATUS: mixed stub — respondToOffer THROWS (UI trade desk needs
 * real answers); aiTradePulse INERT (spine calls daily).
 * Anti-fleece = valuation floor + persona patience; anti-cowardice =
 * pressure states (docs/FRANCHISE.md §7). Verdicts and counters must be
 * deterministic functions of (league, offer).
 */
import type { League, TradeOffer, TradeVerdict, Transaction } from '../types.js';

export function respondToOffer(league: League, offer: TradeOffer): TradeVerdict {
  throw new Error('franchise/ai/trade: not implemented (ai-trade task lands this)');
}

/** Daily league pulse: AI-AI talks/trades, AI proposals to the user (inbox). */
export function aiTradePulse(league: League): Transaction[] {
  return []; // INERT until ai-trade task lands: the wire is quiet.
}
