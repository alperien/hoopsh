/**
 * Sim one game and show your work:
 *   npm run sim [-- --seed my-seed]
 * Prints the final, a box score, notable play-by-play, and saves the replay
 * + full PBP to out/.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { buildReplay, simulateGame } from '@hoopsh/engine';
import { boxScore, tsPct, type PlayerLine } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';
import { generatePlayByPlay } from '@hoopsh/narration';

const seedArg = process.argv.indexOf('--seed');
const seed = seedArg !== -1 ? process.argv[seedArg + 1]! : `game-${Date.now() % 100000}`;

const { home, away } = sampleMatchup();
const t0 = performance.now();
const result = simulateGame({ seed, home, away });
const ms = performance.now() - t0;

const box = boxScore(result.events, [home, away]);
const pbp = generatePlayByPlay(result.events, [home, away], { seed });

const line = (p: PlayerLine): string =>
  `${p.name.padEnd(16)} ${String(p.min).padStart(4)}m ` +
  `${String(p.pts).padStart(3)}pts ${String(p.fgm).padStart(2)}/${String(p.fga).padEnd(2)}fg ` +
  `${String(p.tpm)}/${String(p.tpa)}3p ${String(p.ftm)}/${String(p.fta)}ft ` +
  `${String(p.trb).padStart(2)}rb ${String(p.ast).padStart(2)}as ${String(p.stl)}st ${String(p.blk)}bl ` +
  `${String(p.tov)}to ${String(p.pf)}pf ${p.plusMinus >= 0 ? '+' : ''}${p.plusMinus}`;

console.log(`\nseed=${seed}  simulated in ${ms.toFixed(0)}ms  (${result.events.length} events)\n`);
console.log(`FINAL — ${home.name} ${result.finalScore[0]}, ${away.name} ${result.finalScore[1]}\n`);

for (const side of [0, 1] as const) {
  const team = side === 0 ? home : away;
  const totals = box.teams[side];
  console.log(`${team.name}  (${totals.fgm}/${totals.fga} FG, ${totals.tpm}/${totals.tpa} 3P, ` +
    `${totals.ftm}/${totals.fta} FT, ${totals.trb} REB, ${totals.ast} AST, ${totals.tov} TO, ` +
    `TS ${(tsPct(totals) * 100).toFixed(1)}%)`);
  const players = box.players
    .filter((p) => p.team === side && p.min > 0)
    .sort((a, b) => b.pts - a.pts);
  for (const p of players) console.log('  ' + line(p));
  console.log();
}

console.log(`pace ${box.pace} | possessions ${box.teams[0].poss}/${box.teams[1].poss} | fastbreak pts ${box.teams[0].fastbreakPts}/${box.teams[1].fastbreakPts}\n`);

console.log('— play-by-play (final 2 minutes) —');
const lastPeriod = Math.max(...pbp.map((l) => l.period));
for (const l of pbp.filter((x) => x.period === lastPeriod && x.clock <= 120)) {
  const m = Math.floor(l.clock / 60);
  const s = Math.floor(l.clock % 60).toString().padStart(2, '0');
  console.log(`  [${m}:${s}] ${l.text}`);
}

mkdirSync('out', { recursive: true });
const replay = buildReplay(result);
writeFileSync(`out/replay-${seed}.json`, JSON.stringify(replay));
writeFileSync(
  `out/pbp-${seed}.txt`,
  pbp.map((l) => `[Q${l.period} ${Math.floor(l.clock / 60)}:${Math.floor(l.clock % 60).toString().padStart(2, '0')}] ${l.text}`).join('\n')
);
console.log(`\nsaved out/replay-${seed}.json and out/pbp-${seed}.txt`);
