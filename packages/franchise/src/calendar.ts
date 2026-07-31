/**
 * calendar.ts — the season calendar and phase machine. OWNER: spine task.
 * STATUS: STAGED stub from the contracts wave; every signature below is
 * frozen (docs/FRANCHISE.md §14). The implementation replaces this file.
 */
import type { CalendarDay, League, LeagueDate, Phase, Season } from './types.js';
import type { FranchiseParams } from './params.js';

/** Build the full deterministic calendar for a season (camp through the draft). */
export function buildSeasonCalendar(params: FranchiseParams, season: Season): CalendarDay[] {
  throw new Error('franchise/calendar: not implemented (spine task lands this)');
}

/** The league's current date. */
export function currentDate(league: League): LeagueDate {
  return { season: league.season, day: league.day };
}

/** Phase for an arbitrary day of the current calendar. */
export function phaseOn(calendar: CalendarDay[], day: number): Phase {
  throw new Error('franchise/calendar: not implemented (spine task lands this)');
}
