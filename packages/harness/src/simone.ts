/**
 * Sim one game and show your work:
 *   npm run sim [-- --seed my-seed]
 *   npm run sim [-- --home path/to/team.json --away path/to/other.json]
 * Team packs are validated JSON (see packages/data/rosters/ for examples).
 * Prints the final, a box score, notable play-by-play, and saves the replay
 * + full PBP to out/.
 *
 * This is the "single game, human-readable" entry point; contrast with
 * cli.ts (many games, no play-by-play, just the acceptance-band report) and
 * bench.ts (many games, no output at all except a timing summary). If you
 * only remember one command in this package, this is usually the one:
 * fast enough to eyeball after any engine change, and its (events)/FINAL
 * line is the exact fingerprint AGENTS.md's docs-only verification checks.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildReplay, simulateGame, type Team } from '@hoopsh/engine';
import { boxScore, tsPct, type PlayerLine } from '@hoopsh/stats';
import { loadTeamPack, sampleMatchup } from '@hoopsh/data';
import { generatePlayByPlay } from '@hoopsh/narration';

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const seed = argOf('--seed') ?? `game-${Date.now() % 100000}`;

function teamFrom(flag: string, fallback: Team): Team {
  const file = argOf(flag);
  if (!file) return fallback;
  const { team, issues } = loadTeamPack(readFileSync(file, 'utf8'));
  if (!team) {
    console.error(`invalid team pack ${file}:`);
    for (const issue of issues) console.error(`  ${issue.path}: ${issue.message}`);
    process.exit(1);
  }
  console.log(`loaded ${flag.slice(2)} team "${team.name}" from ${file}`);
  return team;
}

const def = sampleMatchup();
const home = teamFrom('--home', def.home);
const away = teamFrom('--away', def.away);
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
