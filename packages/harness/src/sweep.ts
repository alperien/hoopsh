/**
 * Automated parameter sweep — the calibration lock.
 *
 *   npm run sweep [-- --iters 28 --cands 4 --games 16 --workers 2]
 *
 * Perturbation search over the SWEEPABLE knob registry:
 *   1. score a candidate = sum of normalized band violations across seed bases
 *      (0 = every band passes on every seed base)
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
import { SWEEPABLE, getPath, setPath } from './knobs.js';

const execFileP = promisify(execFile);

function argOf(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1]! : def;
}

const ITERS = Number(argOf('--iters', '28'));
const CANDS = Number(argOf('--cands', '4'));
const GAMES = Number(argOf('--games', '16'));
const WORKERS = Number(argOf('--workers', '2'));
const VERIFY_GAMES = Number(argOf('--verify', '24'));
const SEED_BASES = argOf('--seeds', 'swp-alpha,swp-beta,swp-gamma').split(',');

interface SeedResult {
  seedBase: string;
  avgs: LeagueAverages;
}

type Candidate = Record<string, number>; // knob path -> value

let jobCounter = 0;

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
  writeFileSync(jobPath, JSON.stringify({ overrides, games, seedBases: SEED_BASES }));
  const { stdout } = await execFileP(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--import', './tools/register.mjs', 'packages/harness/src/sweep-worker.ts', jobPath],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }
  );
  const { seedResults } = JSON.parse(stdout) as { seedResults: SeedResult[] };
  return { score: scoreResults(seedResults), seedResults };
}

/** 0 = perfect; otherwise the sum of how far outside each band we are */
function scoreResults(seedResults: SeedResult[]): number {
  let score = 0;
  for (const sr of seedResults) {
    for (const band of NBA_BANDS) {
      const v = sr.avgs[band.metric] ?? NaN;
      const width = band.hi - band.lo;
      if (Number.isNaN(v)) { score += 10; continue; }
      if (v < band.lo) score += (band.lo - v) / width;
      else if (v > band.hi) score += (v - band.hi) / width;
      else {
        // tiny centering pressure to prefer robust interiors
        const mid = (band.lo + band.hi) / 2;
        score += 0.015 * Math.abs(v - mid) / (width / 2);
      }
    }
  }
  return score;
}

function failCount(seedResults: SeedResult[]): number {
  let fails = 0;
  for (const sr of seedResults) {
    for (const r of evaluate(sr.avgs, NBA_BANDS)) if (!r.pass) fails++;
  }
  return fails;
}

async function evalBatch(cands: Candidate[], games: number): Promise<{ score: number; seedResults: SeedResult[] }[]> {
  const results: { score: number; seedResults: SeedResult[] }[] = [];
  for (let i = 0; i < cands.length; i += WORKERS) {
    const batch = cands.slice(i, i + WORKERS);
    const settled = await Promise.all(batch.map((c) => evaluateCandidate(c, games)));
    results.push(...settled);
  }
  return results;
}

// simple deterministic PRNG for the search itself
let searchSeed = 1234567;
function rand(): number {
  searchSeed = (searchSeed * 1103515245 + 12345) & 0x7fffffff;
  return searchSeed / 0x7fffffff;
}
function gaussian(): number {
  return (rand() + rand() + rand() + rand() - 2) * 1.6;
}

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

async function main(): Promise<void> {
  console.log(`sweep: ${ITERS} iters × ${CANDS} candidates, ${GAMES} games × ${SEED_BASES.length} seed bases, ${WORKERS} workers`);
  const t0 = performance.now();

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
    if (currentEval.score < 0.35 && failCount(currentEval.seedResults) === 0) {
      console.log('all bands passing on search budget — verifying at full size');
      break;
    }
  }

  // final verification at larger game count
  const verify = await evaluateCandidate(current, VERIFY_GAMES);
  console.log(`\nVERIFY (${VERIFY_GAMES} games × ${SEED_BASES.length} seeds): score ${verify.score.toFixed(3)}, band-fails ${failCount(verify.seedResults)}`);
  for (const sr of verify.seedResults) {
    const fails = evaluate(sr.avgs, NBA_BANDS).filter((r) => !r.pass);
    console.log(`  ${sr.seedBase}: ${16 - fails.length}/16 ${fails.length ? '(' + fails.map((f) => `${f.band.metric}=${f.value.toFixed(2)}`).join(', ') + ')' : ''}`);
  }

  // report the diff
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
