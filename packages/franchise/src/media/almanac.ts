/**
 * media/almanac.ts — records book and season archives. OWNER: media task.
 * STATUS: INERT stub (spine calls after games and at rollover).
 */
import type { GameRecord, League, RecordBookEntry, SeasonArchive } from '../types.js';

/** Check a finished game against the records book. */
export function updateRecords(league: League, record: GameRecord): RecordBookEntry[] {
  return []; // INERT until media task lands: no records are kept.
}

/** Archive the finished season (called at rollover, after awards). */
export function archiveSeason(league: League): SeasonArchive | null {
  return null; // INERT until media task lands.
}
