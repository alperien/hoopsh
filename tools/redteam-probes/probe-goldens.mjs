// Usage (from repo root): node --disable-warning=ExperimentalWarning --import ./tools/register.mjs tools/redteam-probes/probe-goldens.mjs
// Probe 9: do the re-baselined golden fingerprints match HEAD behavior? (8-seed subset)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { simulateGame } from '../../packages/engine/src/index.ts';
import { sampleMatchup } from '../../packages/data/src/index.ts';

const golden = JSON.parse(readFileSync(new URL('../../packages/harness/golden/fingerprints.json', import.meta.url), 'utf8'));
const seeds = ['ci-fp', 'acceptance-0', 'golden-0', 'golden-1', 'golden-2', 'golden-3', 'golden-4', 'golden-5'];
const allSeeds = ['ci-fp', 'acceptance-0', ...Array.from({ length: 22 }, (_, i) => `golden-${i}`)];
const sha = (s) => createHash('sha256').update(s).digest('hex');
let bad = 0;
for (const seed of seeds) {
  const index = allSeeds.indexOf(seed);
  const { home, away } = sampleMatchup();
  const flip = index % 2 === 1;
  const r = simulateGame({ seed, home: flip ? away : home, away: flip ? home : away, collectFrames: true });
  const fp = { events: sha(JSON.stringify(r.events)), frames: sha(JSON.stringify(r.frames)), finalScore: r.finalScore };
  const g = golden[seed];
  const ok = g && g.events === fp.events && g.frames === fp.frames && g.finalScore[0] === fp.finalScore[0] && g.finalScore[1] === fp.finalScore[1];
  if (!ok) { bad++; console.log(`${seed}: MISMATCH`, JSON.stringify({ got: fp, want: g })); }
  else console.log(`${seed}: matches golden (${fp.finalScore.join('-')})`);
}
console.log(bad === 0 ? '8/8 goldens verified against HEAD' : `${bad} golden mismatches`);
