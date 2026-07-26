// Dump a full game's observable output as JSON for cross-tree comparison.
// env TREE = repo root; argv[2] = seed; argv[3] = 'on'|'off'|'omit'
import { writeFileSync } from 'node:fs';
const TREE = process.env.TREE;
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
