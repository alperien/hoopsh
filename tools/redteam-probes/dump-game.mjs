// Usage (from repo root): node --disable-warning=ExperimentalWarning --import ./tools/register.mjs tools/redteam-probes/dump-game.mjs <seed> <on|off|omit> <outfile.json>
// Dump a full game's observable output as JSON for cross-tree comparison.
// env TREE = repo root (defaults to this clone, derived from this script's location — set it only to dump from ANOTHER tree); argv[2] = seed; argv[3] = 'on'|'off'|'omit'; argv[4] = outfile
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const TREE = process.env.TREE ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { simulateGame } = await import(`${TREE}/packages/engine/src/index.ts`);
const { sampleMatchup } = await import(`${TREE}/packages/data/src/index.ts`);
const seed = process.argv[2];
const mode = process.argv[3];
const { home, away } = sampleMatchup();
const cfg = { seed, home, away, collectFrames: true };
if (mode === 'on') cfg.endgame = true;
if (mode === 'off') cfg.endgame = false;
const r = simulateGame(cfg);
const out = JSON.stringify({ events: r.events, frames: r.frames, finalScore: r.finalScore });
writeFileSync(process.argv[4], out);
console.log(process.argv[4], out.length, 'bytes, score', r.finalScore.join('-'), 'events', r.events.length);
