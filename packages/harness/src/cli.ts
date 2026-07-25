/**
 * Batch acceptance run:
 *   npm run batch -- --games 100 [--seed base]
 * Sims N games and prints the realism acceptance report.
 *
 * The everyday "did I break calibration" check — run this after any engine
 * or params.ts change (AGENTS.md §4's verification tiers call for it on
 * anything touching sim behavior). It's just runBatch (run.ts, mirrored
 * home/away by default) piped through finalize/evaluate/formatReport
 * (aggregate.ts) against NBA_BANDS (bands.ts) — no play-by-play, no per-game
 * detail, just the 16-band OK/FAIL table. For a single human-readable game
 * with a box score, use simone.ts instead; for a raw perf number, bench.ts.
 * 50 games is usually enough to see a real drift; sweep.ts's own internal
 * verification pass uses more (24/seed base × 3) because it's checking a
 * candidate it's about to commit to, not just sanity-checking a change.
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
