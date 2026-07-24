/**
 * Export the built-in sample teams as editable JSON team packs:
 *   npm run rosters:export
 * The packs land in packages/data/rosters/ — copy one, edit the ratings,
 * and sim with it via `npm run sim -- --home your-team.json`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { cascadiaBreakers, meridianMonarchs, toTeamPack } from '@hoopsh/data';

const dir = 'packages/data/rosters';
mkdirSync(dir, { recursive: true });

for (const team of [cascadiaBreakers(), meridianMonarchs()]) {
  const file = `${dir}/${team.id}.team.json`;
  writeFileSync(file, JSON.stringify(toTeamPack(team), null, 2) + '\n');
  console.log(`wrote ${file} (${team.players.length} players)`);
}
