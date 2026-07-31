/**
 * media/awards.ts — award races, voting, all-star. OWNER: media task.
 * STATUS: INERT stub (spine calls weekly/at season points).
 */
import type { AwardResult, League, NewsItem } from '../types.js';

/** Weekly race update stories (MVP ladder etc.). */
export function updateAwardRaces(league: League): NewsItem[] {
  return []; // INERT until media task lands.
}

/** End-of-season voting (params.media weights; 65-game rule). */
export function voteSeasonAwards(league: League): AwardResult[] {
  return []; // INERT until media task lands: no awards are given.
}

/** All-star selections at the break. */
export function selectAllStars(league: League): AwardResult[] {
  return []; // INERT until media task lands.
}
