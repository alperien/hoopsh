/**
 * The scaffold's one hard promise: `roster:new` never emits an invalid pack.
 * Everything else here defends the ergonomics around that promise: the
 * archetype menu can't silently miss a new archetype, placeholder names
 * stay unique, and the CLI's exit codes hold for scripting.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as data from '@hoopsh/data';
import { ARCHETYPES, buildRoster, defaultSlots, packText, slugify } from '../../../tools/roster-new.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { loadTeamPack, validateTeamPack, MIN_PLAYERS } = data;

function scaffold(extra: Partial<Parameters<typeof buildRoster>[0]> = {}) {
  return buildRoster({
    name: 'Test Team', abbrev: 'TST', id: 'test-team',
    slots: defaultSlots(10), tactics: {}, ...extra
  });
}

describe('roster:new scaffold', () => {
  it('every default size produces a pack that validates clean', () => {
    for (let n = MIN_PLAYERS; n <= 15; n++) {
      const pack = scaffold({ slots: defaultSlots(n) });
      expect(validateTeamPack(JSON.parse(JSON.stringify(pack)))).toEqual([]);
      expect(pack.team.players.length).toBe(n);
      expect(pack.team.starters.length).toBe(5);
    }
  });

  it('disambiguates repeated archetypes in placeholder names', () => {
    const pack = scaffold(); // default 10 uses glueForward twice
    const names = pack.team.players.map((p: { name: string }) => p.name);
    expect(names).toContain('Glue Forward');
    expect(names).toContain('Glue Forward 2');
    expect(new Set(names).size).toBe(names.length);
  });

  it('rejects bad sizes and unknown archetypes with readable errors', () => {
    expect(() => defaultSlots(7)).toThrow();
    expect(() => defaultSlots(16)).toThrow();
    expect(() => defaultSlots(Number('banana'))).toThrow();
    expect(() => scaffold({ slots: ['floorGeneral', 'badArch', 'threeAndD', 'glueForward', 'rimRunner', 'comboGuard', 'benchScorer', 'benchBig'] }))
      .toThrow(/unknown archetype 'badArch'/);
  });

  it('menu covers every archetype exported by @hoopsh/data (anti-drift discovery)', () => {
    // An archetype builder is any exported function that, given {id, name},
    // returns a Player-shaped object (attr + tend + pos). Team builders and
    // schema helpers don't match. A 12th archetype added to archetypes.ts
    // fails here until it's added to the scaffold menu.
    const discovered: string[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (typeof v !== 'function') continue;
      try {
        const r = (v as (arg: unknown) => unknown)({ id: 'probe', name: 'probe' }) as Record<string, unknown> | null;
        if (r && typeof r === 'object' && 'attr' in r && 'tend' in r && 'pos' in r) discovered.push(k);
      } catch {
        // not archetype-shaped — fine
      }
    }
    expect(Object.keys(ARCHETYPES).sort()).toEqual(discovered.sort());
  });

  it('emitted text carries the editor $schema pointer and still validates', () => {
    const outFile = path.join(ROOT, 'somewhere', 'team.json'); // path math only; nothing written
    const text = packText(scaffold(), outFile);
    const parsed = JSON.parse(text);
    expect(parsed.$schema).toBe('../data/schema/team-pack.schema.json');
    expect(validateTeamPack(parsed)).toEqual([]); // loader ignores the $schema key
  });

  it('slugify produces filesystem-safe ids', () => {
    expect(slugify('Oak City Owls!')).toBe('oak-city-owls');
    expect(slugify('  ')).toBe('new-team');
  });

  it('CLI end-to-end: writes a loadable pack, refuses silent overwrite (exit 2)', () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'hoopsh-scaffold-')), 'owls.team.json');
    const args = [
      '--disable-warning=ExperimentalWarning',
      '--import', path.join(ROOT, 'tools', 'register.mjs'),
      path.join(ROOT, 'tools', 'roster-new.mjs'),
      '--name', 'Owl City', '--out', out
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(first.status).toBe(0);
    const { team, issues } = loadTeamPack(readFileSync(out, 'utf8'));
    expect(issues).toEqual([]);
    expect(team?.name).toBe('Owl City');

    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(second.status).toBe(2);
    expect(second.stderr).toContain('--force');
  });
});
