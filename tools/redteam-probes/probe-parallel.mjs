// Probe 1: worker-count invariance of the parallel runner.
// Runs the SAME 7-game batch under several worker counts and compares the
// JSON-serialized per-game results byte-for-byte.
import { runGames } from '/agent/w2-redteam/packages/harness/src/parallel.ts';

const games = 7;
const seedBase = 'redteam-p1';

async function grab(task, workers) {
  const rows = await runGames({ task, games, seedBase, workers });
  return JSON.stringify(rows);
}

const results = {};
for (const w of [1, 2, 3, 7, 12]) {
  results[`batch-w${w}`] = await grab('batch', w);
}
const ref = results['batch-w1'];
for (const [k, v] of Object.entries(results)) {
  console.log(k, v === ref ? 'IDENTICAL' : 'DIFFERS', `${v.length} bytes`);
}

// flow task, 1 vs 3 workers (different payload shape, heavier floats)
const f1 = await grab('flow', 1);
const f3 = await grab('flow', 3);
console.log('flow-w3 vs flow-w1:', f3 === f1 ? 'IDENTICAL' : 'DIFFERS');

// edge cases
const one1 = JSON.stringify(await runGames({ task: 'batch', games: 1, seedBase, workers: 1 }));
const one4 = JSON.stringify(await runGames({ task: 'batch', games: 1, seedBase, workers: 4 }));
console.log('1 game, workers 4 vs 1:', one1 === one4 ? 'IDENTICAL' : 'DIFFERS');

const zero = await runGames({ task: 'batch', games: 0, seedBase, workers: 3 });
console.log('0 games, workers 3 ->', JSON.stringify(zero));

for (const bad of [{ games: -1, workers: 2 }, { games: 2.5, workers: 2 }, { games: 4, workers: 0 }, { games: 4, workers: -2 }, { games: 4, workers: 1.5 }]) {
  try {
    await runGames({ task: 'batch', seedBase, ...bad });
    console.log('NO ERROR for', JSON.stringify(bad), '<-- BAD');
  } catch (e) {
    console.log('loud error for', JSON.stringify(bad), '::', e.message.split('\n')[0]);
  }
}
