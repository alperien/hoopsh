/**
 * Batch acceptance run:
 *   npm run batch -- --games 100 [--seed base] [--workers N]
 * Sims N games and prints the realism acceptance report.
 *
 * The everyday "did I break calibration" check — run this after any engine
 * or params.ts change (AGENTS.md §4's verification tiers call for it on
 * anything touching sim behavior). Games are distributed across worker
 * subprocesses by the parallel runner (parallel.ts; --workers defaults to
 * cores-1, and --workers 1 is the plain single-process path) — results are
 * bit-identical regardless of worker count, see parallel.ts's determinism
 * contract. Per-game summaries are piped through accumulate/finalize/
 * evaluate/formatReport (aggregate.ts) against NBA_BANDS (bands.ts) — no
 * play-by-play, no per-game detail, just the band OK/FAIL table. For a
 * single human-readable game with a box score, use simone.ts instead; for a
 * raw perf number, bench.ts. 50 games is usually enough to see a real
 * drift; sweep.ts's own internal verification pass uses more (24/seed base
 * × 3) because it's checking a candidate it's about to commit to, not just
 * sanity-checking a change.
 */

import { accumulate, emptyAcc, finalize, evaluate, formatReport } from './aggregate.js';
import { NBA_BANDS } from './bands.js';
import { flagNumber, flagValue } from './args.js';
import { resolveWorkerCount, runGames } from './parallel.js';

/**
 * RATCHET FLOOR — the minimum number of passing bands for a zero exit code.
 *
 * This is a ratchet, not an aspiration: it is set to what main actually
 * achieves so CI fails on REGRESSION immediately, without pretending the known
 * calibration debt doesn't exist. Current honest state (stable at 48 games
 * across seed bases, see REFACTOR.md): 16 of NBA_BANDS.length pass; the one
 * persistent miss is assisted-share (~63-66% vs the 54-62% band), a structural
 * gap the review flagged and an assist-window sweep confirmed a knob can't
 * close (<2% leverage). Raise this to NBA_BANDS.length when that debt is paid
 * — never lower it to make a red run green.
 *
 * Gating needs sample size: below ~24 games band noise dominates (an 8-game
 * run loses 3-4 bands to variance alone), and even at 24 several boundary
 * bands (3P%, FTA) flicker in and out. CI runs 48 games, where the count is
 * a stable 16/17. The gate only bites at n >= GATE_MIN_GAMES; smaller runs
 * stay report-only and say so. `--min-bands N` overrides; `--min-bands 0`
 * disables.
 */
const RATCHET_FLOOR = 16;
const GATE_MIN_GAMES = 24;

const games = flagNumber(process.argv, '--games', 50);
const seedBase = flagValue(process.argv, '--seed', 'acceptance');
const minBands = flagNumber(process.argv, '--min-bands', games >= GATE_MIN_GAMES ? RATCHET_FLOOR : 0);
const workers = resolveWorkerCount(flagValue(process.argv, '--workers', 'auto'));

async function main(): Promise<void> {
  console.log(`Simulating ${games} games (seed base "${seedBase}", ${workers} worker${workers === 1 ? '' : 's'})...`);
  const t0 = performance.now();
  let lastPrinted = 0;
  const summaries = await runGames({
    task: 'batch',
    games,
    seedBase,
    workers,
    onProgress: (done, total) => {
      // per game in-process, per completed worker slice when parallel
      if (done - lastPrinted >= 10 || done === total) {
        lastPrinted = done;
        process.stdout.write(`  ${done}/${total}\r`);
      }
    }
  });
  const secs = (performance.now() - t0) / 1000;
  console.log(`\nDone in ${secs.toFixed(1)}s (${(games / secs).toFixed(2)} games/sec)\n`);

  // Reduce in the parent, in global game order — bit-identical to a
  // single-process run for any worker count (parallel.ts's contract).
  const acc = emptyAcc();
  for (const s of summaries) accumulate(acc, s);

  const avgs = finalize(acc);
  const results = evaluate(avgs, NBA_BANDS);
  console.log(formatReport(results));

  // The exit code IS the acceptance gate. This used to always exit 0 — CI's
  // "band smoke" step printed FAIL lines and stayed green, which made the
  // calibration rung of the verification ladder decorative (review finding #1).
  const passing = results.filter((r) => r.pass).length;
  if (minBands > 0 && passing < minBands) {
    console.error(
      `\nBAND GATE: ${passing}/${NBA_BANDS.length} passing < required ${minBands}` +
      (games < GATE_MIN_GAMES
        ? ` — note: n=${games} is below the ${GATE_MIN_GAMES}-game gating threshold, noise dominates`
        : '')
    );
    process.exit(1);
  }
  if (minBands === 0 && games < GATE_MIN_GAMES) {
    console.log(`(report-only: n=${games} < ${GATE_MIN_GAMES}, band noise dominates below that — gate inactive)`);
  }
}

main().catch((err) => {
  // a failed parallel run (worker crash, envelope mismatch) lands here —
  // print the whole story and exit nonzero; never a partial report
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
