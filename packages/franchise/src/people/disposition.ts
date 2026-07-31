/**
 * people/disposition.ts — morale, trade requests, extension demands.
 * OWNER: people task. STATUS: INERT stub (spine calls daily).
 * Morale is OFF-COURT ONLY in v1 (register F1): it drives requests and
 * FA/extension behavior, never engine dials.
 */
import type { InboxItem, League } from '../types.js';

/** Update morale from role/wins/usage vs disposition; arm requests. */
export function updateDispositions(league: League): InboxItem[] {
  return []; // INERT until people task lands: everyone is content.
}
