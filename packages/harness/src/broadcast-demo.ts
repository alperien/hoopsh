/**
 * Broadcast demo:
 *   npm run broadcast [-- --seed showcase-v2]
 * Sims a game (deterministic by seed), merges template play-by-play with the
 * color-commentary provider into a two-voice broadcast script, and saves it.
 * Swap TemplateColorProvider for an LLM-backed CommentaryProvider to upgrade
 * the color voice — the interface is identical (see packages/narration).
 *
 * Note the default seed here ("showcase-v2") is this script's own: simone.ts
 * defaults to a time-derived seed (`game-<Date.now()%100000>`) unless --seed
 * is passed, and the seed AGENTS.md §4.1's docs-only fingerprint check pins
 * is `fingerprint-1` via `npm run sim`. They're independent demo scripts,
 * not meant to reproduce each other's output. (A prior version of this note
 * cited a "showcase-v3" seed that exists nowhere in the repo — corrected.)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { buildBroadcastScript, formatScript, TemplateColorProvider } from '@hoopsh/narration';
import { flagValue } from './args.js';

// flagValue fails loudly on a bare `--seed` — the old inline read here used a
// non-null assertion and silently seeded the sim with the string "undefined"
// (see args.ts's header for the incident)
const seed = flagValue(process.argv, '--seed', 'showcase-v2');

const { home, away } = sampleMatchup();
const result = simulateGame({ seed, home, away, collectFrames: false });

const cues = await buildBroadcastScript(result.events, [home, away], new TemplateColorProvider(), { seed });
const script = formatScript(cues);

mkdirSync('out', { recursive: true });
const file = `out/broadcast-${seed}.txt`;
writeFileSync(file, script);

const pbpCount = cues.filter((c) => c.speaker === 'pbp').length;
const colorCount = cues.filter((c) => c.speaker === 'color').length;
console.log(`final: ${home.abbrev} ${result.finalScore[0]} — ${away.abbrev} ${result.finalScore[1]}`);
console.log(`${cues.length} cues (${pbpCount} play-by-play, ${colorCount} color) → ${file}\n`);

// excerpt: the last two minutes of regulation
const excerpt = cues.filter((c) => c.period === 4 && c.clock <= 120);
for (const c of excerpt.slice(0, 40)) {
  const m = Math.floor(c.clock / 60);
  const s = String(Math.floor(c.clock % 60)).padStart(2, '0');
  console.log(`[${m}:${s}] ${c.speaker === 'pbp' ? 'PBP  ' : 'COLOR'} ${c.text}`);
}
