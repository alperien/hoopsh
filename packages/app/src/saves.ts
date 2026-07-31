/**
 * saves.ts - save files on disk. All franchise I/O lives in this package;
 * the franchise layer is pure. Saves are plain JSON under out/saves/
 * (gitignored like every out/ artifact): diffable, shareable, and
 * deterministic to reproduce (league = f(seed, action log)).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SAVE_FORMAT_VERSION, type League, type SaveFile } from '@hoopsh/franchise';

/** out/saves under the repo root (worker/server both run from the root). */
export function savesDir(): string {
  return path.resolve('out', 'saves');
}

function fileFor(name: string): string {
  // keep names filesystem-safe without surprising the user
  const safe = name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'league';
  return path.join(savesDir(), `${safe}.json`);
}

export function saveLeague(league: League, name: string): SaveFile {
  const save: SaveFile = {
    formatVersion: SAVE_FORMAT_VERSION,
    meta: {
      name,
      savedAtDay: { season: league.season, day: league.day },
    },
    league,
  };
  mkdirSync(savesDir(), { recursive: true });
  writeFileSync(fileFor(name), JSON.stringify(save));
  return save;
}

export function loadLeague(name: string): League {
  const raw = readFileSync(fileFor(name), 'utf8');
  const save = JSON.parse(raw) as SaveFile;
  if (save.formatVersion !== SAVE_FORMAT_VERSION) {
    throw new Error(`save format ${save.formatVersion} is not supported (current ${SAVE_FORMAT_VERSION})`);
  }
  return save.league;
}

export function listSaves(): Array<{ name: string; file: string; savedAtDay: { season: number; day: number }; userTeam: string }> {
  let files: string[] = [];
  try {
    files = readdirSync(savesDir()).filter(f => f.endsWith('.json'));
  } catch {
    return []; // no saves directory yet: a fresh clone
  }
  const out: Array<{ name: string; file: string; savedAtDay: { season: number; day: number }; userTeam: string }> = [];
  for (const f of files) {
    try {
      const save = JSON.parse(readFileSync(path.join(savesDir(), f), 'utf8')) as SaveFile;
      out.push({
        name: save.meta.name,
        file: f,
        savedAtDay: save.meta.savedAtDay,
        userTeam: save.league.userTeam,
      });
    } catch {
      // an unreadable save is skipped, never fatal to the list
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
