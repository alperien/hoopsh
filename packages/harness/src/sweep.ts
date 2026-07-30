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
 * is small enough (40 SWEEPABLE paths today — count them in knobs.ts, the
 * registry is the source of truth) that simple local search reaches
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
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { defaultParams } from '@hoopsh/engine';
import { checkFlags, flagNumber, flagValue } from './args.js';
import { NBA_BANDS } from './bands.js';
import { evaluate, type LeagueAverages } from './aggregate.js';
// Reads use getPath (defaults, the candidate diff); writes go through
// evaluateCandidate's own nested-object builder, so setPath isn't needed
// here and isn't imported. (A prior comment here claimed setPath was
// "imported but never called" — it was never imported at all; corrected.)
import { SWEEPABLE, getPath } from './knobs.js';

const execFileP = promisify(execFile);

// CLI flags, each with the default the header's usage example implies —
// parsed through args.ts's loud validators, NOT a hand-rolled reader. This
// file is the one whose output gets baked into params.ts defaults, and it
// had regressed to the exact incident class args.ts exists to prevent: a
// typo'd `--iters` became NaN, the whole search loop was skipped, and a
// plausible-looking (empty-diff) out/sweep-best.json was written with exit 0
// — a calibration run that measured nothing and said so nowhere (scan
// finding B2-1; a NaN `--workers` similarly made evalBatch evaluate ZERO
// candidates per iteration, silently). The integer floors below close the
// remainder of that class: a finite-but-negative count no-ops the same way
// NaN did. `--iters 0` stays legal — it is the documented verify-only mode
// (AGENTS.md §4.2's 3-seed band verification rung).
// GAMES (search-time batch size) is deliberately smaller than VERIFY_GAMES
// (final measurement size) — see main()'s comment on why. SEED_BASES
// defaults to three fixed, distinct seed-string prefixes rather than one:
// requiring a candidate to pass bands on ALL three independently seeded
// samples (not just one lucky sample) is what makes "locked" mean something
// (AGENTS.md §4.4) rather than overfitting to a single seed's noise.
// declared vocabulary first — a typo'd or `=`-spelled flag must die before a
// calibration budget is spent measuring the wrong thing (args.ts checkFlags,
// audit H-03; same incident family as the NaN `--iters` note above)
checkFlags(process.argv, ['--iters', '--cands', '--games', '--workers', '--verify', '--seeds', '--objective', '--endgame']);
const ITERS = flagNumber(process.argv, '--iters', 28);
const CANDS = flagNumber(process.argv, '--cands', 4);
const GAMES = flagNumber(process.argv, '--games', 16);
const WORKERS = flagNumber(process.argv, '--workers', 2);
const VERIFY_GAMES = flagNumber(process.argv, '--verify', 24);
const SEED_BASES = flagValue(process.argv, '--seeds', 'swp-alpha,swp-beta,swp-gamma').split(',');
for (const [flag, v, min] of [
  ['--iters', ITERS, 0], ['--cands', CANDS, 1], ['--games', GAMES, 1],
  ['--workers', WORKERS, 1], ['--verify', VERIFY_GAMES, 1]
] as const) {
  if (!Number.isInteger(v) || v < min) {
    throw new Error(`sweep: ${flag} must be an integer >= ${min}, got ${v}`);
  }
}
// --endgame FORCES GameConfig.endgame ON for every candidate evaluation.
// It existed for the pre-flip flag-on re-sweep (docs/REGISTER.md W2); the flip
// LANDED (sim/game.ts `endgame ?? true`), so forced-ON now evaluates the
// identical games as a flagless run — kept so scripted callers stay
// meaningful. Without the flag, games run the engine's shipped default
// (sweep-worker omits the key entirely), so a sweep always measures FROM
// the config that actually ships — same doctrine as the all-defaults
// baseline candidate below, and the reason there is deliberately no
// endgame-OFF sweep mode: the legacy path is not a calibration target.
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
async function evaluateCandidate(
  cand: Candidate,
  games: number,
  seedBases: readonly string[] = SEED_BASES
): Promise<{ score: number; seedResults: SeedResult[] }> {
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
  writeFileSync(jobPath, JSON.stringify({ overrides, games, seedBases, endgame: ENDGAME }));
  // Same keep-on-failure / unlink-on-success policy as parallel.ts's runner
  // jobs: a failed evaluation keeps its job file so the candidate can be
  // re-run by hand (node --import ./tools/register.mjs
  // packages/harness/src/sweep-worker.ts <jobPath>), while a successful one
  // cleans up after itself — a default 28x4 run used to leave ~115 job files
  // in /tmp unconditionally (scan finding B2-2).
  const { stdout } = await execFileP(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--import', './tools/register.mjs', 'packages/harness/src/sweep-worker.ts', jobPath],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }
  );
  const { seedResults } = JSON.parse(stdout) as { seedResults: SeedResult[] };
  unlinkSync(jobPath); // success — clean up (kept on any throw above)
  return { score: scoreResults(seedResults), seedResults };
}

/**
 * The scoring function: 0 = every band passes, dead-centered, on every seed
 * base — otherwise a sum of two components per (seed base × band) pair:
 *   - a normalized OUT-OF-BAND penalty: how far past the edge, as a fraction
 *     of the band's own width, so a tight band (small `width`) and a wide
 *     band contribute comparably instead of the search fixating on whichever
 *     band happens to have the largest raw units;
 *   - a CENTERING PRESSURE (CENTER_W per unit of normalized distance to the
 *     band's middle — 0.25 under the DEFAULT 'margin' objective, 0.015 under
 *     'legacy'; see OBJECTIVE MODES below for the weights and why they
 *     changed) that applies even to in-band values, nudging the search
 *     toward the band's middle rather than stopping at the first value that
 *     merely clears the edge. This is what keeps a "locked" calibration
 *     robust to the ~1% sampling noise between runs (see AGENTS.md §4.4's
 *     noise floor) instead of one bad seed's variance tipping a
 *     just-barely-passing band into a fail.
 *
 * CONTINUITY AT THE BAND EDGE, and why it matters: the out-of-band branches
 * below add a flat `CENTER_W` on top of the distance-past-edge term. That
 * is exactly the centering-pressure value the in-band branch reaches
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
 *     (knob-sensitivity probe, docs/REGISTER.md): a calibration where rounding
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
const OBJECTIVE = flagValue(process.argv, '--objective', 'margin');
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
      // NaN-on-missing-key note) is scored as a flat 10 per (seed base ×
      // band) rather than silently skipped, so a broken metric wiring can
      // never look like a free win to the search. 10 ≈ 2.4 band-widths past
      // an edge under the margin objective — a real violation CAN exceed it
      // (the claim here used to say it couldn't; audit L-42), but a metric
      // that far gone dominates the score either way.
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
  // Math.imul keeps the multiply exact in 32-bit space. The previous naive
  // `searchSeed * 1103515245` reached ~2^61 — past float64's 53-bit integer
  // precision — so the product ROUNDED before the mask and the intended
  // period-2^31 generator collapsed to 12,890 distinct states cycling every
  // 10,466 draws (scan finding B2-5): any budget past ~12.9k draws (roughly
  // iters × cands × 11, e.g. --iters 200 --cands 8) silently replayed the
  // same perturbation stream. Since (x mod 2^32) mod 2^31 = x mod 2^31,
  // imul's low-32-bit product plus the mask computes the classic LCG
  // (a=1103515245, c=12345, m=2^31) exactly — full period 2^31 (c odd,
  // a ≡ 1 mod 4). Dividing by 2^31 (not 2^31−1) keeps the result in [0, 1):
  // never exactly 1, so `Math.floor(rand() * N)` can never index out of
  // bounds even on the state-max draw. Still one fixed seed, still the same
  // stream every run — the reproducibility contract above is unchanged.
  searchSeed = (Math.imul(searchSeed, 1103515245) + 12345) & 0x7fffffff;
  return searchSeed / 0x80000000;
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
  // DISJOINT verify sample (audit M-23): the worker seeds games
  // `${seedBase}-${i}` from i=0, so verifying on the search's own seed bases
  // replayed every search game — games 0..GAMES-1 of the "verification" WERE
  // the sample the winning candidate was selected on, and the verify score
  // partially re-measured selection noise as if it were held-out signal.
  // A `-verify` suffix on each base yields entirely fresh game seeds while
  // keeping the same three-independent-bases structure the lock is defined
  // on.
  const verify = await evaluateCandidate(current, VERIFY_GAMES, SEED_BASES.map((b) => `${b}-verify`));
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

  // Rail-pinned convergence report (audit M-25): a final value sitting ON a
  // knob's declared lo/hi rail means the search wanted to go further and the
  // rail — not the bands — chose the value. Silent rail-pinning is how six
  // shipped defaults came to sit exactly on their rails with nobody knowing
  // whether that was calibration or clamping. One line, every run: either
  // widen the range (knobs.ts) deliberately or accept the edge deliberately.
  const pinned: string[] = [];
  for (const knob of SWEEPABLE) {
    const v = current[knob.path] ?? getPath(defaultParams as unknown as Record<string, unknown>, knob.path);
    if (Math.abs(v - knob.lo) <= 1e-9 || Math.abs(v - knob.hi) <= 1e-9) {
      pinned.push(`${knob.path}=${v} [${knob.lo}..${knob.hi}]`);
    }
  }
  if (pinned.length > 0) {
    console.log(`\nWARNING rail-pinned knobs (value ON its declared search rail — widen the knobs.ts range or accept the edge deliberately): ${pinned.join(', ')}`);
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

  // Verify-rung exit code (audit M-24): `--iters 0 --verify N` is AGENTS.md
  // §4.2's 3-seed band-verification rung — a gate, and a gate's exit code IS
  // its verdict. It used to exit 0 with 21 band-fails, so scripted ladders
  // saw green on a failing verification. A TUNING run (--iters > 0) keeps
  // exit 0 regardless: its contract is "search, then write the best found";
  // the printed fail count and sweep-best.json carry the verdict there.
  if (ITERS === 0 && failCount(verify.seedResults) > 0) {
    console.error(`\nVERIFY FAILED: ${failCount(verify.seedResults)} band-fails on the verification rung (--iters 0) — exiting nonzero`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
