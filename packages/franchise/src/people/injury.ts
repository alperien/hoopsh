/**
 * people/injury.ts — the injury model. OWNER: people task.
 * STATUS: INERT stub (spine calls these daily); implementation replaces.
 * Hazard per minutes played (params.injury), post-game rolls attributed
 * narratively to a game moment (register F2), recovery countdown daily.
 */
import type { GameRecord, Injury, League } from '../types.js';

/** Roll injuries for the day's completed games. Mutates players; returns new injuries. */
export function rollPostGameInjuries(league: League, records: GameRecord[]): Injury[] {
  return []; // INERT until people task lands: rosters are immortal.
}

/** Morning tick: advance recoveries, clear healed players. Returns cleared ids. */
export function advanceRecoveries(league: League): string[] {
  return []; // INERT until people task lands.
}
