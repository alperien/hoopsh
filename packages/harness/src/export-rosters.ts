/**
 * Export the built-in sample teams as editable JSON team packs:
 *   npm run rosters:export
 * The packs land in packages/data/rosters/: copy one, edit the ratings,
 * and sim with it via `npm run sim -- --home your-team.json`.
 *
 * This is the bridge from code-defined rosters (@hoopsh/data's
 * cascadiaBreakers()/meridianMonarchs(), the two calibration teams; see
 * data/teams.ts) to the pack format everyone else edits by hand
 * (data/schema.ts's TeamPack, validated by loadTeamPack). toTeamPack() does
 * the actual shape conversion; this script is just "run it on both sample
 * teams and write the JSON to disk" so there's always a known-valid example
 * pack to copy from.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { cascadiaBreakers, meridianMonarchs, toTeamPack } from '@hoopsh/data';

const dir = 'packages/data/rosters';
mkdirSync(dir, { recursive: true });

for (const team of [cascadiaBreakers(), meridianMonarchs()]) {
  const file = `${dir}/${team.id}.team.json`;
  // "$schema" first: these two packs are the copy-from examples for hand
  // authors (see docs/ROSTERS.md), so they ship with the editor pointer
  // already wired and a copied pack gets autocomplete/inline validation for
  // free. loadTeamPack() ignores the key; the generated schema allows it.
  const pack = { $schema: '../../../data/schema/team-pack.schema.json', ...toTeamPack(team) };
  writeFileSync(file, JSON.stringify(pack, null, 2) + '\n');
  console.log(`wrote ${file} (${team.players.length} players)`);
}
