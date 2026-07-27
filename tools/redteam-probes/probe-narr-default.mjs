// Usage (from repo root, generates the dump fixture first): node --disable-warning=ExperimentalWarning --import ./tools/register.mjs tools/redteam-probes/dump-game.mjs rt-egB off /tmp/new-off-rt-egB.json && node --disable-warning=ExperimentalWarning --import ./tools/register.mjs tools/redteam-probes/probe-narr-default.mjs
// Narration over the DEFAULT (flag-off) stream from the saved dump — no new sims.
import { readFileSync } from 'node:fs';
import { generatePlayByPlay } from '../../packages/narration/src/index.ts';
import { sampleMatchup } from '../../packages/data/src/index.ts';

const { events } = JSON.parse(readFileSync('/tmp/new-off-rt-egB.json', 'utf8'));
const { home, away } = sampleMatchup();
const lines = generatePlayByPlay(events, [home, away]);
const text = lines.map((l) => l.text).join('\n');
for (const tok of ['undefined', 'NaN', '[object']) {
  console.log(`"${tok}" present:`, text.includes(tok));
}
const teamRebLines = lines.filter((l) => /out of bounds|by Team|team rebound/i.test(l.text));
console.log('team-rebound-ish lines:', teamRebLines.length, '| sample:', teamRebLines[0]?.text);
const shotWords = ['layup', 'dunk', 'hook', 'jump shot', 'tip-in'];
const counts = Object.fromEntries(shotWords.map((w) => [w, (text.match(new RegExp(w, 'g')) ?? []).length]));
console.log('shot vocabulary counts:', JSON.stringify(counts));
