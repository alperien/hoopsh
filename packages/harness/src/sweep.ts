/**
 * Automated parameter sweep — the calibration lock.
 *
 *   npm run sweep [-- --iters 28 --cands 4 --games 16 --workers 2 --endgame]
 *
 * SEARCH STRATEGY, stated honestly: this is perturbation local search with
 * geometric step decay — NOT gradient descent (there's no gradient; band
 * violations aren't differentiable through a discrete-event sim) and NOT
 * CMA-ES or any other covariance-adaptive method (no covariance matrix, no
 * population statistics beyond "keep the best of K candidates"). The whole
 * algorithm is: nudge 1-3 knobs randomly from the current best, sim a batch,
 * keep the nudge if the score improved, shrink the nudge size every
 * iteration, repeat. This was chosen for SIMPLICITY and PARALLELIZABILITY on
 * a 2-core machine (see --workers default below) over search quality per
 * iteration — a fancier optimizer would converge in fewer iterations, but
 * each iteration here is cheap to parallelize (K independent candidate
 * evaluations, each itself a batch of independent games) and the knob space
 * is small enough (~25 knobs, see knobs.ts) that simple local search reaches
 * a locked calibration in well under an hour on modest hardware. If this
 * search strategy is ever revisited, that's the trade-off being reconsidered
 * — not a placeholder for "the real algorithm."
 *
 *   1. score a candidate = sum of normalized band violations across seed bases
 *      (0 = every band passes on every seed base) — see scoreResults below
 *   2. each iteration proposes K candidates (1-3 knobs nudged), evaluates them
 *      in parallel worker processes, adopts the best if it improves
 *   3. steps shrink geometrically; search stops early at a verified 0
 *
 * Output: out/sweep-best.json (changed knobs + full params + reports).
 * Apply by copying the changed values into packages/engine/src/sim/params.ts.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { defaultParams } from '@hoopsh/engine';
import { NBA_BANDS } from './bands.js';
import { evaluate, type LeagueAverages } from './aggregate.js';
// Reads use getPath (defaults, the candidate diff); writes go through
// evaluateCandidate's own nested-object builder, so setPath isn't needed
// here and isn't imported. (A prior comment here claimed setPath was
// "imported but never called" — it was never imported at all; corrected.)
import { SWEEPABLE, getPath } from './knobs.js';

const execFileP = promisify(execFile);

function argOf(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1]! : def;
}

// CLI flags, each with the default the header's usage example implies.
// GAMES (search-time batch size) is deliberately smaller than VERIFY_GAMES
// (final measurement size) — see main()'s comment on why. SEED_BASES
// defaults to three fixed, distinct seed-string prefixes rather than one:
// requiring a candidate to pass bands on ALL three independently seeded
// samples (not just one lucky sample) is what makes "locked" mean something
// (AGENTS.md §4.4) rather than overfitting to a single seed's noise.
const ITERS = Number(argOf('--iters', '28'));
const CANDS = Number(argOf('--cands', '4'));
const GAMES = Number(argOf('--games', '16'));
const WORKERS = Number(argOf('--workers', '2'));
const VERIFY_GAMES = Number(argOf('--verify', '24'));
const SEED_BASES = argOf('--seeds', 'swp-alpha,swp-beta,swp-gamma').split(',');
// --endgame FORCES GameConfig.endgame ON for every candidate evaluation —
// the flag-on re-sweep (REFACTOR.md W2) that must re-center fga before the
// default can flip. Without the flag, games run the engine's shipped default
// (sweep-worker omits the key entirely), so a sweep always measures FROM the
// config that actually ships — same doctrine as the all-defaults baseline
// candidate below. Flag-on output is a flag-on calibration: bake it only
// together with the default flip it was measured for.
const ENDGAME = process.argv.includes('--endgame');

interface SeedResult {
  seedBase: string;
  avgs: LeagueAverages;
}

// A candidate is a SPARSE set of overrides: only the knobs perturb() touched
// for this candidate are present (dot-path -> value); every knob NOT in this
// object keeps its params.ts default. Empty object `{}` is the baseline
// (unmodified defaultParams) candidate the search starts from.
type Candidate = Record<string, number>; // knob path -> value

let jobCounter = 0;

/**
 * Evaluate one candidate by farming it out to a fresh child process
 * (sweep-worker.ts) rather than simulating in-process.
 *
 * THE JOB-FILE PROTOCOL: this function writes a job description to a temp
 * JSON file, spawns `node sweep-worker.ts <jobPath>`, and reads the worker's
 * single JSON blob back from stdout. Why a file-plus-subprocess round trip
 * instead of, say, worker_threads with structured message-passing:
 *   - it keeps sweep-worker.ts a completely standalone, independently
 *     runnable script (see its own file header) — useful for debugging one
 *     candidate by hand outside the search loop;
 *   - each worker gets a fresh process/module state, so nothing about the
 *     engine's params application can leak between candidates (no shared
 *     mutable defaultParams reference across evaluations — see withParams'
 *     structuredClone in params.ts);
 *   - `execFile` gives free process-level parallelism (WORKERS concurrent
 *     children) without hand-rolling a thread pool or IPC framing.
 * The job file's path embeds `process.pid` and a monotonic `jobCounter` so
 * concurrent evaluateCandidate calls (see evalBatch below) never collide on
 * the same temp file, even across multiple sweep runs sharing /tmp.
 */
async function evaluateCandidate(cand: Candidate, games: number): Promise<{ score: number; seedResults: SeedResult[] }> {
  const overrides: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(cand)) {
    // build nested override object
    const parts = path.split('.');
    let cur = overrides;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = (cur[parts[i]!] ??= {}) as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = value;
  }
  const jobPath = `/tmp/hoopsh-sweep-job-${process.pid}-${jobCounter++}.json`;
  writeFileSync(jobPath, JSON.stringify({ overrides, games, seedBases: SEED_BASES, endgame: ENDGAME }));
  const { stdout } = await execFileP(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--import', './tools/register.mjs', 'packages/harness/src/sweep-worker.ts', jobPath],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }
  );
  const { seedResults } = JSON.parse(stdout) as { seedResults: SeedResult[] };
  return { score: scoreResults(seedResults), seedResults };
}

/**
 * The scoring function: 0 = every band passes, dead-centered, on every seed
 * base — otherwise a sum of two components per (seed base × band) pair:
 *   - a normalized OUT-OF-BAND penalty: how far past the edge, as a fraction
 *     of the band's own width, so a tight band (small `width`) and a wide
 *     band contribute comparably instead of the search fixating on whichever
 *     band happens to have the largest raw units;
 *   - a small CENTERING PRESSURE of 0.015 (a constant, same for every band)
 *     that applies even to in-band values, nudging the search toward the
 *     band's middle rather than stopping at the first value that merely
 *     clears the edge. This is what keeps a "locked" calibration robust to
 *     the ~1% sampling noise between runs (see AGENTS.md §4.4's noise floor)
 *     instead of one bad seed's variance tipping a just-barely-passing band
 *     into a fail.
 *
 * CONTINUITY AT THE BAND EDGE, and why it matters: the out-of-band branches
 * below add a flat `0.015` on top of the distance-past-edge term. That
 * `0.015` is exactly the centering-pressure value the in-band branch reaches
 * AT the edge itself (where `|v - mid| / (width/2) = 1`). So the score
 * function is continuous crossing `lo`/`hi` — a value just outside the band
 * scores just barely worse than a value just inside it, never dramatically
 * worse. Without this, the score would have a discontinuous step at every
 * band edge, which would make the LOCAL SEARCH (see the file header — this
 * is perturbation search, not gradient descent) blind near edges: a
 * candidate that crossed just outside a band would look catastrophically bad
 * compared to one just inside, even though basketball-wise they're nearly
 * identical, and the search could get stuck refusing small steps that
 * temporarily cross an edge en route to a better overall optimum.
 */
/**
 * OBJECTIVE MODES (--objective, default 'margin'):
 *
 *   'legacy' — the original weights: centering pressure capped at 0.015 per
 *     band. That pressure existed but was ~67x weaker than one band-width of
 *     violation, so in practice the search treated everything inside a band
 *     as equally good and parked metrics on edges. The measured consequence
 *     (knob-sensitivity probe, REFACTOR.md): a calibration where rounding
 *     SWEPT values to 2 decimals tips bands, and every correct mechanics fix
 *     regresses the report — a robustness radius smaller than a bug fix.
 *
 *   'margin' — centering is a real force (CENTER_W per unit of normalized
 *     distance-to-center) and violations are steepened (VIOL_W per band-width
 *     past the edge, plus the CENTER_W continuity offset so the score stays
 *     continuous at edges exactly as before). Centering a band from edge to
 *     mid buys CENTER_W; pushing another band out costs VIOL_W per width —
 *     so the search buys interior slack aggressively but never trades a pass
 *     away for it unless the violation is tiny. The acceptance criterion for
 *     a margin-mode calibration is pre-committed: it must survive the TIDY
 *     test (SWEPT values rounded to 2-3 digits without dropping a band).
 */
const OBJECTIVE = argOf('--objective', 'margin');
// Any unrecognized value (typo, forgotten value swallowing the next flag,
// dangling flag) must fail loudly here: the CENTER_W/VIOL_W selection below
// would otherwise silently fall through to the legacy weights and a full
// calibration budget would optimize the wrong objective with no indication
// in the output.
if (OBJECTIVE !== 'margin' && OBJECTIVE !== 'legacy') {
  throw new Error(`sweep: --objective must be 'margin' or 'legacy', got '${OBJECTIVE}'`);
}
const CENTER_W = OBJECTIVE === 'margin' ? 0.25 : 0.015;
const VIOL_W = OBJECTIVE === 'margin' ? 4 : 1;

function scoreResults(seedResults: SeedResult[]): number {
  let score = 0;
  for (const sr of seedResults) {
    for (const band of NBA_BANDS) {
      const v = sr.avgs[band.metric] ?? NaN;
      const width = band.hi - band.lo;
      // A metric that failed to resolve at all (see aggregate.ts#evaluate's
      // NaN-on-missing-key note) is scored as a flat, large 10 — much worse
      // than any real out-of-band distance can produce — rather than
      // silently skipped, so a broken metric wiring can never look like a
      // free win to the search.
      if (Number.isNaN(v)) { score += 10; continue; }
      // out-of-band cost includes the max in-band centering cost so the score
      // is CONTINUOUS at the band edge (a value just outside can never score
      // better than a value just inside)
      if (v < band.lo) score += CENTER_W + VIOL_W * (band.lo - v) / width;
      else if (v > band.hi) score += CENTER_W + VIOL_W * (v - band.hi) / width;
      else {
        // centering pressure — the margin objective's whole point
        const mid = (band.lo + band.hi) / 2;
        score += CENTER_W * Math.abs(v - mid) / (width / 2);
      }
    }
  }
  return score;
}

/**
 * Human-readable companion to scoreResults: raw count of (seed base × band)
 * checks that failed outright (pass/fail, no partial credit) — this is what
 * gets printed to the console each iteration and what AGENTS.md §4.4's
 * "46-48 of 48 checks passing" locked-state language refers to. The
 * continuous `score` drives the search; `failCount` is what a human reads to
 * judge whether a candidate is actually acceptable.
 */
function failCount(seedResults: SeedResult[]): number {
  let fails = 0;
  for (const sr of seedResults) {
    for (const r of evaluate(sr.avgs, NBA_BANDS)) if (!r.pass) fails++;
  }
  return fails;
}

/**
 * Evaluate a batch of candidates with bounded parallelism: WORKERS candidate
 * evaluations run concurrently (each itself a subprocess, see
 * evaluateCandidate), and the next WORKERS-sized slice only starts once the
 * current one settles. This isn't "spawn all of CANDS at once" — it's
 * throttled to the machine's actual core count (WORKERS defaults to 2, see
 * the sweep's own header on why the search targets a 2-core budget) so a
 * `--cands 8` run doesn't try to run 8 simulation-heavy subprocesses
 * simultaneously and thrash.
 */
async function evalBatch(cands: Candidate[], games: number): Promise<{ score: number; seedResults: SeedResult[] }[]> {
  const results: { score: number; seedResults: SeedResult[] }[] = [];
  for (let i = 0; i < cands.length; i += WORKERS) {
    const batch = cands.slice(i, i + WORKERS);
    const settled = await Promise.all(batch.map((c) => evaluateCandidate(c, games)));
    results.push(...settled);
  }
  return results;
}

// Simple deterministic PRNG for the SEARCH itself — deliberately separate
// from and unrelated to the engine's seeded Rng (core/rng.ts) that makes
// individual GAMES deterministic. This PRNG controls which knobs perturb()
// nudges and by how much each iteration; seeding it to a fixed constant
// (1234567) means the SEARCH PATH ITSELF is reproducible: two `npm run
// sweep` invocations with identical CLI args propose the identical sequence
// of candidates in the identical order, given identical simulated results.
// That reproducibility is what makes a sweep's printed diff trustworthy
// enough to bake into params.ts defaults (AGENTS.md §4.4) — if the search
// path were randomized per-run, "re-run the sweep and bake its output"
// (AGENTS.md §2.1's rule about SWEPT values) would produce a different
// answer every time, and nobody could tell a real re-tune from search noise.
let searchSeed = 1234567;
function rand(): number {
  searchSeed = (searchSeed * 1103515245 + 12345) & 0x7fffffff;
  return searchSeed / 0x7fffffff;
}
// Irwin-Hall approximation: sum of 4 uniforms, centered and scaled, gives a
// roughly-normal distribution without needing a Box-Muller transform or any
// trig — good enough for proposing step sizes, not a general-purpose
// generator. The `1.6` scale is FEEL, tuned so the resulting spread produces
// reasonable candidate diversity at step=1.0 (the search's largest step
// size below), not measured against any statistical target.
function gaussian(): number {
  return (rand() + rand() + rand() + rand() - 2) * 1.6;
}

/**
 * Propose one new candidate by nudging 1-3 randomly chosen SWEEPABLE knobs
 * away from `base`'s current values, scaled by `step` (a fraction of each
 * knob's own [lo, hi] range so a wide-range knob and a narrow-range knob get
 * comparable-feeling nudges) and clamped back into [lo, hi] so the search
 * can never propose a value outside the knob's declared sane range no matter
 * how large `step` or how extreme the gaussian draw. `next[knob.path] ??
 * getPath(defaultParams, …)` reads the CURRENT value from `base` if this
 * candidate lineage already touched that knob, or falls back to the
 * untouched params.ts default otherwise — so a Candidate object only ever
 * needs to carry the knobs it actually changed (see the Candidate type's
 * "sparse overrides" comment above), not a full copy of every SimParams field.
 */
function perturb(base: Candidate, step: number): Candidate {
  const next: Candidate = { ...base };
  const nKnobs = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < nKnobs; i++) {
    const knob = SWEEPABLE[Math.floor(rand() * SWEEPABLE.length)]!;
    const range = knob.hi - knob.lo;
    const cur = next[knob.path] ?? getPath(defaultParams as unknown as Record<string, unknown>, knob.path);
    const proposed = cur + gaussian() * step * range;
    next[knob.path] = Math.min(knob.hi, Math.max(knob.lo, proposed));
  }
  return next;
}

/**
 * The search loop: hill-climb from the empty (all-defaults) candidate,
 * proposing CANDS perturbations per iteration and keeping the best one IF
 * it beats the current best — a candidate that scores worse than `current`
 * is simply discarded, never adopted "to explore." This is greedy local
 * search, not simulated annealing (no chance of accepting a worse move to
 * escape a local optimum) — a deliberate simplicity trade-off, see the file
 * header's SEARCH STRATEGY note. With `step` shrinking every iteration
 * (`step = Math.max(0.06, step * 0.93)` — geometric decay, floored at 0.06
 * so late iterations still make SOME progress rather than stalling at
 * effectively-zero step size), early iterations explore coarsely and later
 * ones fine-tune, similar in spirit to simulated-annealing temperature decay
 * but without the probabilistic acceptance that name implies.
 */
async function main(): Promise<void> {
  console.log(`sweep: ${ITERS} iters × ${CANDS} candidates, ${GAMES} games × ${SEED_BASES.length} seed bases, ${WORKERS} workers, objective ${OBJECTIVE}${ENDGAME ? ', endgame ON' : ''}`);
  const t0 = performance.now();

  // The starting candidate is the empty override set — i.e. whatever's
  // currently baked into params.ts defaults. A sweep always measures FROM
  // the current calibrated state, never from some fixed "factory" baseline,
  // so re-running the sweep after a mechanics change picks up from wherever
  // that change left the league averages.
  let current: Candidate = {};
  let currentEval = await evaluateCandidate(current, GAMES);
  console.log(`baseline score ${currentEval.score.toFixed(3)} (${failCount(currentEval.seedResults)} band-fails)`);

  let step = 0.22;
  for (let iter = 1; iter <= ITERS; iter++) {
    const cands: Candidate[] = [];
    for (let k = 0; k < CANDS; k++) cands.push(perturb(current, step));
    const evals = await evalBatch(cands, GAMES);
    let bestIdx = -1;
    for (let i = 0; i < evals.length; i++) {
      if (evals[i]!.score < currentEval.score && (bestIdx === -1 || evals[i]!.score < evals[bestIdx]!.score)) {
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      current = cands[bestIdx]!;
      currentEval = evals[bestIdx]!;
    }
    step = Math.max(0.06, step * 0.93);
    const secs = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`iter ${String(iter).padStart(2)}  score ${currentEval.score.toFixed(3)}  fails ${failCount(currentEval.seedResults)}  step ${step.toFixed(3)}  [${secs}s]`);
    // Early-stop threshold: score < 0.35 alone isn't the gate (a handful of
    // bands hugging their centering-pressure minimum could sum past 0.35
    // while every single one still individually passes) — it's ANDed with
    // failCount === 0, the actual "every band passes" condition. The score
    // threshold exists mainly to skip the failCount recomputation (cheap,
    // but avoidable) when the search is nowhere near converged yet.
    if (currentEval.score < 0.35 && failCount(currentEval.seedResults) === 0) {
      console.log('all bands passing on search budget — verifying at full size');
      break;
    }
  }

  // Final verification at a LARGER game count than the search used
  // (VERIFY_GAMES, default 24, vs. GAMES, default 16 — see the CLI flags
  // above) — the search runs cheap/small to explore many candidates
  // quickly, but the number that gets baked into params.ts and reported to
  // a human should be measured at a sample size large enough that the
  // ~1% noise floor (AGENTS.md §4.4) is actually small relative to the
  // band widths, not the search's own fast-but-noisier evaluation size.
  const verify = await evaluateCandidate(current, VERIFY_GAMES);
  console.log(`\nVERIFY (${VERIFY_GAMES} games × ${SEED_BASES.length} seeds): score ${verify.score.toFixed(3)}, band-fails ${failCount(verify.seedResults)}`);
  for (const sr of verify.seedResults) {
    const fails = evaluate(sr.avgs, NBA_BANDS).filter((r) => !r.pass);
    // passing fraction is computed dynamically from NBA_BANDS.length (17
    // today) — no hardcoded count to drift. (A prior comment here described a
    // hardcoded `16` on this line; there was none, and the count was already
    // 17 — corrected.)
    console.log(`  ${sr.seedBase}: ${NBA_BANDS.length - fails.length}/${NBA_BANDS.length} ${fails.length ? '(' + fails.map((f) => `${f.band.metric}=${f.value.toFixed(2)}`).join(', ') + ')' : ''}`);
  }

  // Report the diff: only knobs whose final value differs from the
  // params.ts default by more than floating-point noise (1e-9) are
  // reported — a knob the search never moved, or nudged back to exactly
  // its starting value, doesn't clutter the "changed knobs" output or the
  // written diff below.
  console.log('\nchanged knobs:');
  const diff: Record<string, { from: number; to: number }> = {};
  for (const [path, value] of Object.entries(current)) {
    const from = getPath(defaultParams as unknown as Record<string, unknown>, path);
    if (Math.abs(from - value) > 1e-9) {
      diff[path] = { from, to: value };
      console.log(`  ${path}: ${from} → ${Number(value.toFixed(4))}`);
    }
  }

  mkdirSync('out', { recursive: true });
  writeFileSync('out/sweep-best.json', JSON.stringify({
    score: verify.score,
    bandFails: failCount(verify.seedResults),
    // provenance: a flag-on calibration must never be baked into params.ts
    // as if it were measured at the shipped default (see --endgame above)
    endgame: ENDGAME,
    diff,
    candidate: current,
    verify: verify.seedResults
  }, null, 2));
  console.log('\nwrote out/sweep-best.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
