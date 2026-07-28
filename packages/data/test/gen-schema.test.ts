/**
 * The generated JSON Schema (data/schema/team-pack.schema.json) is a second
 * face of the pack contract, so it gets the same paranoia as the validator:
 * prove it's current (regenerate-and-compare), prove it says YES to every
 * shipped roster, and prove it says NO to each canonical way a hand-edited
 * pack goes wrong. Evaluation runs through tools/json-schema-lite.mjs, which
 * throws on any keyword it doesn't implement, so a passing suite means every
 * keyword the schema uses was genuinely executed, not skipped.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cascadiaBreakers, toTeamPack, validateTeamPack, ATTR_KEYS, TEND_KEYS } from '@hoopsh/data';
// eslint-style note: plain relative .mjs imports. These tools are the unit
// under test, loaded the same way npm run schema:gen loads them.
import { buildTeamPackSchema, checkSchema, extractInterfaceDocs, schemaText, SCHEMA_PATH } from '../../../tools/gen-schema.mjs';
import { validate } from '../../../tools/json-schema-lite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rosterPath = (id: string) => path.join(ROOT, 'packages', 'data', 'rosters', `${id}.team.json`);

// deep-clone a known-valid pack to mutate; every negative case starts valid
function freshPack(): any {
  return JSON.parse(JSON.stringify(toTeamPack(cascadiaBreakers())));
}

const schema = buildTeamPackSchema();
const schemaErrors = (pack: unknown) => validate(schema, pack);

describe('generated team-pack JSON Schema', () => {
  it('committed file is byte-identical to a fresh regeneration (anti-drift gate)', () => {
    expect(readFileSync(SCHEMA_PATH, 'utf8')).toBe(schemaText());
    expect(checkSchema()).toEqual([]);
  });

  it('accepts both shipped rosters', () => {
    for (const id of ['breakers', 'monarchs']) {
      const pack = JSON.parse(readFileSync(rosterPath(id), 'utf8'));
      expect(schemaErrors(pack)).toEqual([]);
      expect(validateTeamPack(pack)).toEqual([]); // round-trip: shipped -> validator -> pass
    }
  });

  it('accepts a pack carrying the editor "$schema" pointer', () => {
    const pack = freshPack();
    pack.$schema = '../../data/schema/team-pack.schema.json';
    expect(schemaErrors(pack)).toEqual([]);
  });

  it('rejects an out-of-range rating (and agrees with the validator)', () => {
    for (const bad of [400, -5]) {
      const pack = freshPack();
      pack.team.players[0].attr.three = bad;
      expect(schemaErrors(pack).length).toBeGreaterThan(0);
      expect(validateTeamPack(pack).length).toBeGreaterThan(0);
    }
  });

  it('rejects a missing tendency key', () => {
    const pack = freshPack();
    delete pack.team.players[2].tend.usage;
    const errs = schemaErrors(pack);
    expect(errs.some((e: { path: string }) => e.path.includes('usage'))).toBe(true);
    expect(validateTeamPack(pack).length).toBeGreaterThan(0);
  });

  it('rejects 4 starters', () => {
    const pack = freshPack();
    pack.team.starters = pack.team.starters.slice(0, 4);
    expect(schemaErrors(pack).some((e: { path: string }) => e.path.includes('starters'))).toBe(true);
    expect(validateTeamPack(pack).length).toBeGreaterThan(0);
  });

  it('rejects a repeated starter id via uniqueItems', () => {
    const pack = freshPack();
    pack.team.starters[1] = pack.team.starters[0];
    expect(schemaErrors(pack).some((e: { path: string }) => e.path.includes('starters'))).toBe(true);
    expect(validateTeamPack(pack).length).toBeGreaterThan(0);
  });

  it('duplicate PLAYER ids are the documented inexpressible case — validator catches, schema cannot', () => {
    const pack = freshPack();
    pack.team.players[1].id = pack.team.players[0].id;
    pack.team.starters = pack.team.players.slice(2, 7).map((p: { id: string }) => p.id);
    // JSON Schema draft 2020-12 has no cross-item field-uniqueness keyword;
    // this asymmetry is enumerated in the schema's own description and docs/
    // ROSTERS.md, and load-time validation remains the final word.
    expect(schemaErrors(pack)).toEqual([]);
    expect(validateTeamPack(pack).some((i) => i.message.includes('duplicate player ids'))).toBe(true);
  });

  it('rejects a wrong formatVersion and a typo\'d rating key', () => {
    const stale = freshPack();
    stale.formatVersion = 1;
    expect(schemaErrors(stale).some((e: { path: string }) => e.path.includes('formatVersion'))).toBe(true);

    const typo = freshPack();
    typo.team.players[0].tend.sholThree = typo.team.players[0].tend.shotThree;
    delete typo.team.players[0].tend.shotThree;
    const errs = schemaErrors(typo);
    // the schema names both the unknown key (editor lint the validator
    // lacks) and the missing real key
    expect(errs.some((e: { path: string; message: string }) => e.path.includes('sholThree') && e.message.includes('unknown'))).toBe(true);
    expect(errs.some((e: { path: string }) => e.path.includes('shotThree'))).toBe(true);
  });

  it('is never looser than the validator across a fixed mutation battery', () => {
    // Each mutation is validator-rejected; the schema must reject it too
    // unless it's one of the enumerated JSON-Schema-inexpressible rules
    // (cross-reference checks), which have their own test above.
    const mutations: ((p: any) => void)[] = [
      (p) => { p.kind = 'squad'; },
      (p) => { delete p.team.tactics; },
      (p) => { p.team.tactics.pace = 101; },
      (p) => { p.team.players = p.team.players.slice(0, 7); },
      (p) => { delete p.team.players[0].attr; },
      (p) => { p.team.players[3].heightIn = 30; },
      (p) => { p.team.players[4].pos = 'CENTER'; },
      (p) => { delete p.team.players[5].weightLb; },
      (p) => { p.team.players[6].wingspanIn = 'long'; },
      (p) => { p.team.rotationMinutes = { x: -3 }; },
      (p) => { delete p.team.name; },
      (p) => { p.team.abbrev = ''; }
    ];
    for (const mutate of mutations) {
      const pack = freshPack();
      mutate(pack);
      expect(validateTeamPack(pack).length).toBeGreaterThan(0);
      expect(schemaErrors(pack).length).toBeGreaterThan(0);
    }
  });

  it('every rating key ships hover documentation extracted from player.ts', () => {
    const src = readFileSync(path.join(ROOT, 'packages', 'engine', 'src', 'model', 'player.ts'), 'utf8');
    const attrDocs = extractInterfaceDocs(src, 'Attributes');
    const tendDocs = extractInterfaceDocs(src, 'Tendencies');
    // Ratchet, not decoration: adding a rating to the engine without a doc
    // comment in player.ts fails here, because an undocumented dial is
    // exactly what makes hand-authoring rosters miserable.
    for (const k of ATTR_KEYS) expect(typeof attrDocs[k]).toBe('string');
    for (const k of TEND_KEYS) expect(typeof tendDocs[k]).toBe('string');
  });
});
