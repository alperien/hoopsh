/**
 * Broadcast demo:
 *   npm run broadcast [-- --seed showcase-v2 --booth classic|latenight]
 *   npm run broadcast -- --legacy          # the v1 pbp+color pipeline
 * Sims a game (deterministic by seed) and renders the two-voice BOOTH script
 * (docs/BROADCAST.md): play-by-play + analyst with geography, running-stat
 * awareness, heat-scaled registers, and persona voices. Saves the full script
 * and prints the last two minutes of regulation.
 *
 * Note the default seed here ("showcase-v2") differs from simone.ts's usual
 * demo seed ("showcase-v3", the one AGENTS.md's docs-only fingerprint check
 * pins) — they're independent demo scripts with their own default seeds, not
 * meant to reproduce each other's output.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import {
  BOOTH_PRESETS, buildBoothScript, buildBroadcastScript, formatBoothScript, formatScript,
  TemplateColorProvider, type BoothPresetId
} from '@hoopsh/narration';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] ?? null : null;
};
const seed = arg('seed') ?? 'showcase-v2';
const boothId = (arg('booth') ?? 'classic') as BoothPresetId;
const legacy = process.argv.includes('--legacy');

const { home, away } = sampleMatchup();
const result = simulateGame({ seed, home, away, collectFrames: false });

mkdirSync('out', { recursive: true });

if (legacy) {
  const cues = await buildBroadcastScript(result.events, [home, away], new TemplateColorProvider(), { seed });
  const script = formatScript(cues);
  const file = `out/broadcast-${seed}-legacy.txt`;
  writeFileSync(file, script);
  console.log(`final: ${home.abbrev} ${result.finalScore[0]} — ${away.abbrev} ${result.finalScore[1]}`);
  console.log(`${cues.length} cues (legacy pipeline) → ${file}`);
} else {
  const booth = BOOTH_PRESETS[boothId] ?? BOOTH_PRESETS.classic;
  const cues = buildBoothScript(result.events, [home, away], { seed, booth: boothId in BOOTH_PRESETS ? boothId : 'classic' });
  const script = formatBoothScript(cues, booth);
  const file = `out/broadcast-${seed}.txt`;
  writeFileSync(file, script);

  const pbpCount = cues.filter((c) => c.speaker === 'pbp').length;
  const colorCount = cues.filter((c) => c.speaker === 'color').length;
  console.log(`final: ${home.abbrev} ${result.finalScore[0]} — ${away.abbrev} ${result.finalScore[1]}`);
  console.log(`booth: ${booth.pbp.displayName} (pbp) + ${booth.color.displayName} (color)`);
  console.log(`${cues.length} cues (${pbpCount} play-by-play, ${colorCount} color) → ${file}\n`);

  // excerpt: the last two minutes of regulation
  const excerpt = cues.filter((c) => c.period === 4 && c.clock <= 120);
  const lines = formatBoothScript(excerpt, booth).split('\n');
  for (const l of lines.slice(0, 44)) console.log(l);
}
