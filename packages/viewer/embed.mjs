#!/usr/bin/env node
// Bake a replay JSON into the viewer, producing a standalone shareable HTML file.
//   node packages/viewer/embed.mjs out/replay-<seed>.json out/viewer-<seed>.html
//
// Usage:
//   1. Generate a replay first (this script never simulates anything itself):
//        npm run sim -- --seed <seed>            → writes out/replay-<seed>.json
//   2. Bake it into the standalone viewer template (packages/viewer/index.html):
//        node packages/viewer/embed.mjs out/replay-<seed>.json out/viewer-<seed>.html
//      (also reachable as `npm run viewer:embed -- <replay.json> <out.html>`,
//      see package.json)
//   3. Open out/viewer-<seed>.html directly in a browser — no server needed,
//      the replay JSON is inlined into the page (see the MARK splice below),
//      so the file is fully self-contained and shareable on its own.
// Zero dependencies: this is plain Node fs/path/url, matching the rest of the
// zero-dependency dev runtime (see tools/register.mjs for why that matters).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , replayPath, outPath] = process.argv;
if (!replayPath || !outPath) {
  console.error('usage: node packages/viewer/embed.mjs <replay.json> <out.html>');
  process.exit(1);
}

const templatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html');
const template = readFileSync(templatePath, 'utf8');
const replay = readFileSync(replayPath, 'utf8').trim();

const MARK = '/*HOOPSH_REPLAY*/null';
const markAt = template.indexOf(MARK);
if (markAt === -1) {
  console.error('viewer template is missing the HOOPSH_REPLAY marker');
  process.exit(1);
}
// harden the bake: (1) escape "</" inside the JSON (valid JSON escape) so a
// player name containing </script> can't break out of the script tag;
// (2) splice via slice instead of String.replace, whose $-patterns corrupt
// replacements containing bare dollar signs (e.g. a team named "Team $1")
const safeReplay = replay.replace(/<\//g, '<\\/');
writeFileSync(outPath, template.slice(0, markAt) + safeReplay + template.slice(markAt + MARK.length));
console.log(`wrote ${outPath} (${(replay.length / 1024 / 1024).toFixed(2)} MB embedded)`);
