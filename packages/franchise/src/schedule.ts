/**
 * schedule.ts — the 82-game schedule generator. OWNER: schedule task.
 * STATUS: STAGED stub; signatures frozen.
 * Honors the real formula (16 division / 36 in-conf balance / 30 cross-conf),
 * B2B counts near params.schedule.b2bTarget, no team playing twice one day.
 */
import type { Rng } from '@hoopsh/engine';
import type { League, ScheduledGame, Season } from './types.js';

export function generateSchedule(league: League, season: Season, rng: Rng): ScheduledGame[] {
  throw new Error('franchise/schedule: not implemented (schedule task lands this)');
}
