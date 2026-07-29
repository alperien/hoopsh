/**
 * Batch acceptance run:
 *   npm run batch -- --games 100 [--seed base] [--workers N] [--league nba|ncaa] [--no-endgame]
 * Sims N games and prints the realism acceptance report.
 *
 * --no-endgame FORCES GameConfig.endgame OFF for every game (the
 * batchNoEndgame task, parallel.ts) — the legacy pre-endgame path, a
 * non-default config with no ratchet achievement of its own, so like an
 * uncalibrated league it defaults to report-only; arm a gate explicitly
 * with --min-bands. --endgame forces ON, which since the default flip
 * (sim/game.ts `endgame ?? true`, calibrated by the coordinated re-sweep —
 * REFACTOR.md W2, landed) simulates the IDENTICAL games as a default run:
 * it stays gated like one (it used to disarm the gate, which let
 * `npm run batch -- --endgame` grade the same games as CI and exit 0
 * regardless of band regressions — scan finding, b4 adjacencies).
 *
 * --league swaps the rule pack, the acceptance bands, AND the pace basis
 * together (leagues.ts) — never one without the others. 'ncaa' runs the
 * NCAA men's pack against the proposed bands from
 * data/ncaa/acceptance-bands.json with pace in poss/40; it is measurement,
 * not acceptance: the pack is structurally correct but probability models
 * and rosters are still NBA-fit, so expect most bands to fail until the
 * NCAA calibration milestone (README §6.4). The gate below therefore only
 * arms itself for calibrated leagues.
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
import { flagNumber, flagValue } from './args.js';
import { resolveLeague } from './leagues.js';
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
// Red-team MINOR-4 (FINDINGS-REDTEAM.md; REFACTOR.md W13): `--games 0` used
// to print an all-FAIL report of zeros and exit 0 (the gate below is
// report-only under GATE_MIN_GAMES), so a scripted caller checking exit
// codes saw success on a run that simulated NOTHING. A batch that grades
// zero games is a misconfiguration, never a pass — die loudly before
// simulating anything.
if (!Number.isInteger(games) || games < 1) {
  console.error(`--games requires an integer >= 1, got ${games} — refusing to grade a run that simulates nothing`);
  process.exit(1);
}
const seedBase = flagValue(process.argv, '--seed', 'acceptance');
const league = resolveLeague(flagValue(process.argv, '--league', 'nba'));
const endgame = process.argv.includes('--endgame');
const noEndgame = process.argv.includes('--no-endgame');
if (endgame && noEndgame) {
  console.error('--endgame and --no-endgame contradict each other — pass at most one');
  process.exit(1);
}
// the ratchet is an NBA achievement at the DEFAULT config — an uncalibrated
// league, or a legacy --no-endgame run, defaults to report-only (arm it
// explicitly with --min-bands once the config has a ratchet of its own).
// --endgame does NOT disarm: forced-ON is the shipped default config since
// the flip, so it grades the identical games CI's gated run grades.
const minBands = flagNumber(
  process.argv, '--min-bands',
  league.calibrated && !noEndgame && games >= GATE_MIN_GAMES ? RATCHET_FLOOR : 0
);
// an explicitly passed gate floor must be a sane count: flagNumber only
// checks finiteness, and a negative or fractional value silently disarmed
// the gate AND skipped every report-only notice (all keyed on === 0)
if (!Number.isInteger(minBands) || minBands < 0) {
  console.error(`--min-bands must be an integer >= 0 (0 disables the gate), got ${minBands}`);
  process.exit(1);
}
const workers = resolveWorkerCount(flagValue(process.argv, '--workers', 'auto'));

async function main(): Promise<void> {
  console.log(`Simulating ${games} ${league.name} games (seed base "${seedBase}", ${workers} worker${workers === 1 ? '' : 's'}${noEndgame ? ', endgame OFF (legacy)' : endgame ? ', endgame ON (the shipped default)' : ''})...`);
  const t0 = performance.now();
  let lastPrinted = 0;
  const summaries = await runGames({
    task: noEndgame ? 'batchNoEndgame' : endgame ? 'batchEndgame' : 'batch',
    games,
    seedBase,
    league: league.id,
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
  const results = evaluate(avgs, league.bands);
  console.log(formatReport(results));

  // The exit code IS the acceptance gate. This used to always exit 0 — CI's
  // "band smoke" step printed FAIL lines and stayed green, which made the
  // calibration rung of the verification ladder decorative (review finding #1).
  const passing = results.filter((r) => r.pass).length;
  if (minBands > 0 && passing < minBands) {
    console.error(
      `\nBAND GATE: ${passing}/${league.bands.length} passing < required ${minBands}` +
      (games < GATE_MIN_GAMES
        ? ` — note: n=${games} is below the ${GATE_MIN_GAMES}-game gating threshold, noise dominates`
        : '')
    );
    process.exit(1);
  }
  if (minBands === 0 && !league.calibrated) {
    console.log(`(report-only: league "${league.id}" is uncalibrated — these bands measure the gap, they don't gate; pass --min-bands to arm one anyway)`);
  } else if (minBands === 0 && noEndgame) {
    console.log(`(report-only: --no-endgame runs the legacy pre-endgame path, a non-default config with no ratchet of its own — these bands measure the off/on gap; pass --min-bands to arm a gate anyway)`);
  } else if (minBands === 0 && games < GATE_MIN_GAMES) {
    console.log(`(report-only: n=${games} < ${GATE_MIN_GAMES}, band noise dominates below that — gate inactive)`);
  }
}

main().catch((err) => {
  // a failed parallel run (worker crash, envelope mismatch) lands here —
  // print the whole story and exit nonzero; never a partial report
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
