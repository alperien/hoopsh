/**
 * media/news.ts — the news desk. OWNER: media task. STATUS: INERT stub
 * (spine calls nightly). Template pools with seeded variety and
 * repeat-avoidance (narration package discipline); numbers only from sim
 * data; rumors only from real negotiation state at temperature >= warm.
 * Bylines are fixed voices. Prose register: docs/FRANCHISE.md §10.
 */
import type { League, NewsItem } from '../types.js';

/** Write the day's stories (recaps handled by media/recap.ts). */
export function writeDailyNews(league: League): NewsItem[] {
  return []; // INERT until media task lands: the papers are dark.
}
