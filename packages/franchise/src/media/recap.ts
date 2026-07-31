/**
 * media/recap.ts — game recaps from stored results. OWNER: media task.
 * STATUS: INERT stub (spine calls after games). Reads GameRecord
 * (lines, totals, keyPlays) — never raw events (gameday folded those).
 */
import type { GameRecord, League, NewsItem } from '../types.js';

export function recapGame(league: League, record: GameRecord): NewsItem | null {
  return null; // INERT until media task lands.
}
