#!/usr/bin/env node
// Bake a replay JSON into the viewer, producing a standalone shareable HTML file.
//   node packages/viewer/embed.mjs out/replay-<seed>.json out/viewer-<seed>.html
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
