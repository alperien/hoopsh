/**
 * people/dev.ts — development, aging. OWNER: people task.
 * STATUS: INERT stub from the contracts wave — the spine calls these
 * every review/season, so until the people task lands they no-op instead
 * of throwing (labeled per AGENTS.md §2.5). The implementation replaces
 * this file.
 */
import type { League } from '../types.js';

/** Run a development review for every player (midseason or offseason). Mutates. */
export function runDevelopmentReview(league: League, when: 'midseason' | 'offseason'): void {
  // INERT until people task lands: no development happens.
}

/** Apply aging decline at season rollover (before the offseason review). */
export function applyAging(league: League): void {
  // INERT until people task lands: nobody ages.
}
