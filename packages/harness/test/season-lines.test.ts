/**
 * The committed real-roster inputs (REGISTER W65): every
 * data/nba/*-2025-26.season.json must satisfy the fitter's own loud
 * validator and the provenance contract (data/nba/README.md — source,
 * access date, producing scripts, disclosed approximations). This is the
 * guard that a future re-parse cannot silently ship a malformed or
 * provenance-stripped season file: the whole point of the pipeline is that
 * these files are reproducible evidence, not hand-typed numbers.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateSeasonLines } from '../src/fit-roster.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, 'data', 'nba');
const files = readdirSync(DIR).filter((f) => /^[a-z]{3}-2025-26\.season\.json$/.test(f));

describe('committed 2025-26 season lines (data/nba)', () => {
  it('all 30 teams ship, one file each', () => {
    expect(files.length).toBe(30);
    const ids = files.map((f) => f.slice(0, 3));
    expect(new Set(ids).size).toBe(30);
    for (const must of ['sas', 'okc', 'bos', 'lal', 'den']) expect(ids).toContain(must);
  });

  it('every file passes the fitter validator with zero issues', () => {
    for (const f of files) {
      const raw = JSON.parse(readFileSync(path.join(DIR, f), 'utf-8')) as unknown;
      const { file, issues } = validateSeasonLines(raw);
      expect(issues).toEqual([]);
      expect(file).not.toBe(null);
    }
  });

  it('every file honors the provenance contract and the pipeline shape', () => {
    for (const f of files) {
      const d = JSON.parse(readFileSync(path.join(DIR, f), 'utf-8')) as {
        provenance: string;
        team: { id: string; abbrev: string };
        players: { mpg: number; dunks?: number; shotZones?: object }[];
      };
      // provenance: source, the two producing scripts, the disclosed
      // shot-zone bucket approximation
      expect(d.provenance).toContain('basketball-reference.com');
      expect(d.provenance).toContain('fetch-nba-team.mjs');
      expect(d.provenance).toContain('parse-nba-team.mjs');
      expect(d.provenance).toContain('disclosed approximation');
      // file name matches the team id it claims
      expect(f.startsWith(d.team.id)).toBe(true);
      expect(d.team.abbrev.toLowerCase().length).toBe(3);
      // a real rotation, minutes-ordered (the parser's contract)
      expect(d.players.length).toBeGreaterThanOrEqual(8);
      expect(d.players.length).toBeLessThanOrEqual(12);
      for (let i = 1; i < d.players.length; i++) {
        expect(d.players[i - 1]!.mpg).toBeGreaterThanOrEqual(d.players[i]!.mpg);
      }
      // the dunk channel reached the file (at least one real dunker per team
      // is a basketball fact, not an assumption about any one roster)
      expect(d.players.some((p) => (p.dunks ?? 0) >= 0.3)).toBe(true);
      expect(d.players.some((p) => p.shotZones !== undefined)).toBe(true);
    }
  });
});
