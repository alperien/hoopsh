/**
 * people/retire.ts — retirement hazard at season end. OWNER: people task.
 * STATUS: INERT stub (spine calls at rollover).
 */
import type { League } from '../types.js';

/** Roll retirements at season end. Mutates status; returns retiree ids. */
export function runRetirements(league: League): string[] {
  return []; // INERT until people task lands: nobody retires.
}
