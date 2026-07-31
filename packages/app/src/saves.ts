/**
 * saves.ts — save files on disk (out/saves/*.json, gitignored). OWNER:
 * app task. STATUS: STAGED stub. SaveFile shape from franchise types;
 * meta is excluded from determinism hashes; league JSON round-trips
 * byte-stable (JSON.stringify of the same value).
 */
import type { League, SaveFile } from '@hoopsh/franchise';

export function saveLeague(league: League, name: string): SaveFile {
  throw new Error('app/saves: not implemented (app task lands this)');
}
export function loadLeague(name: string): League {
  throw new Error('app/saves: not implemented (app task lands this)');
}
export function listSaves(): Array<{ name: string; file: string }> {
  throw new Error('app/saves: not implemented (app task lands this)');
}
