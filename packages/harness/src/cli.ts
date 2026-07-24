/**
 * Batch acceptance run:
 *   npm run batch -- --games 100 [--seed base]
 * Sims N games and prints the realism acceptance report.
 */

import { runBatch } from './run.js';
import { finalize, evaluate, formatReport } from './aggregate.js';
import { NBA_BANDS } from './bands.js';

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const games = Number(argOf('--games') ?? 50);
const seedBase = argOf('--seed') ?? 'acceptance';

console.log(`Simulating ${games} games (seed base "${seedBase}")...`);
const t0 = performance.now();
let done = 0;
const acc = runBatch({
  games,
  seedBase,
  onGame: () => {
    done += 1;
    if (done % 10 === 0) process.stdout.write(`  ${done}/${games}\r`);
  }
});
const secs = (performance.now() - t0) / 1000;
console.log(`\nDone in ${secs.toFixed(1)}s (${(games / secs).toFixed(2)} games/sec)\n`);

const avgs = finalize(acc);
console.log(formatReport(evaluate(avgs, NBA_BANDS)));
