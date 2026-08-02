/**
 * saves.ts - save files on disk. All franchise and career I/O lives in
 * this package; both game layers are pure. Saves are plain JSON under
 * out/saves/ (gitignored like every out/ artifact): diffable,
 * shareable, and deterministic to reproduce (league = f(seed, action
 * log); career = f(seed, choice log)).
 *
 * One directory, two shapes: a franchise save carries `league`, a
 * career save carries `career`. listSaves discriminates by shape and
 * tags each row with its chair.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SAVE_FORMAT_VERSION, withFranchiseParams, type League, type SaveFile } from '@hoopsh/franchise';
import { CAREER_SAVE_FORMAT_VERSION, type CareerSave, type CareerState } from '@hoopsh/career';

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
  // Additive params keys (the #184 wire dials and any dial after them)
  // fill from defaults here, so a save written before a key existed
  // stays loadable without a format bump - the strict check above makes
  // a bump refuse every existing save. Saved values always win.
  save.league.params = withFranchiseParams(save.league.params);
  return save.league;
}

export function saveCareer(career: CareerState, name: string): CareerSave {
  const save: CareerSave = {
    formatVersion: CAREER_SAVE_FORMAT_VERSION,
    meta: { name, savedAt: { ...career.clock } },
    career,
  };
  mkdirSync(savesDir(), { recursive: true });
  writeFileSync(fileFor(name), JSON.stringify(save));
  return save;
}

export function loadCareer(name: string): CareerState {
  const raw = readFileSync(fileFor(name), 'utf8');
  const save = JSON.parse(raw) as CareerSave;
  if (!('career' in save)) {
    throw new Error(`"${name}" is a franchise save, not a career`);
  }
  if (save.formatVersion !== CAREER_SAVE_FORMAT_VERSION) {
    throw new Error(`career save format ${save.formatVersion} is not supported (current ${CAREER_SAVE_FORMAT_VERSION})`);
  }
  const career = save.career;
  // an abroad phase holds ME in both maps as ONE object; JSON forked it
  // into two copies, so the load rebinds them (the nbabridge hazard note)
  if (career.players[career.me] && career.league.players[career.me]) {
    career.players[career.me] = career.league.players[career.me]!;
  }
  // same additive-params contract as loadLeague: the embedded league's
  // params fill new keys from defaults so old career saves keep loading
  career.league.params = withFranchiseParams(career.league.params);
  return career;
}

export interface SaveRow {
  name: string;
  file: string;
  kind: 'franchise' | 'career';
  /** franchise rows */
  savedAtDay?: { season: number; day: number };
  userTeam?: string;
  /** career rows */
  clock?: { phase: string; year: number; week: number };
  playerName?: string;
}

export function listSaves(): SaveRow[] {
  let files: string[] = [];
  try {
    files = readdirSync(savesDir()).filter(f => f.endsWith('.json'));
  } catch {
    return []; // no saves directory yet: a fresh clone
  }
  const out: SaveRow[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(path.join(savesDir(), f), 'utf8')) as SaveFile | CareerSave;
      if ('career' in raw) {
        const c = raw.career;
        const player = c.players[c.me] ?? c.league.players[c.me];
        out.push({
          name: raw.meta.name,
          file: f,
          kind: 'career',
          clock: { ...c.clock },
          playerName: player?.name,
        });
      } else {
        out.push({
          name: raw.meta.name,
          file: f,
          kind: 'franchise',
          savedAtDay: raw.meta.savedAtDay,
          userTeam: raw.league.userTeam,
        });
      }
    } catch {
      // an unreadable save is skipped, never fatal to the list
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
