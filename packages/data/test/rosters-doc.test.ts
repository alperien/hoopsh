/**
 * docs/ROSTERS.md ships JSON the reader is meant to copy — so its examples
 * are executable claims, held to the same standard as code comments (the
 * repo's "truth pass" precedent: docs that lie get fixed, not tolerated).
 * Convention enforced here: ```json fences must PARSE (illustrative/elided
 * snippets use ```jsonc), and the worked-example player must be a complete,
 * valid, warning-free player when dropped onto a real roster.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateTeamPack, ATTR_KEYS, TEND_KEYS } from '@hoopsh/data';
import { computeWarnings } from '../../../tools/roster-validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const doc = readFileSync(path.join(ROOT, 'docs', 'ROSTERS.md'), 'utf8');
const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);

describe('docs/ROSTERS.md examples', () => {
  it('every ```json fence parses (elided snippets must use ```jsonc)', () => {
    expect(jsonBlocks.length).toBeGreaterThan(0);
    for (const block of jsonBlocks) expect(() => JSON.parse(block)).not.toThrow();
  });

  it('the worked-example player is complete, valid, and warning-free on a real roster', () => {
    const player = jsonBlocks.map((b) => JSON.parse(b))
      .find((j) => j && typeof j === 'object' && 'attr' in j && 'tend' in j);
    expect(player).toBeTruthy();
    // all 38 dials present — a copyable example may not skip keys
    expect(ATTR_KEYS.filter((k) => !(k in player.attr))).toEqual([]);
    expect(TEND_KEYS.filter((k) => !(k in player.tend))).toEqual([]);

    const pack = JSON.parse(readFileSync(path.join(ROOT, 'packages', 'data', 'rosters', 'breakers.team.json'), 'utf8'));
    pack.team.players.push(player);
    expect(validateTeamPack(pack)).toEqual([]);
    expect(computeWarnings(pack)).toEqual([]);
  });
});
