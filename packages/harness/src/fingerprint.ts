/**
 * Golden fingerprint corpus — the refactor tripwire.
 *
 *   npm run fingerprint            verify current engine output against the
 *                                  checked-in corpus (exit 1 on any mismatch)
 *   npm run fingerprint:write      regenerate the corpus (ONLY after a
 *                                  deliberate, documented behavior change)
 *
 * WHY THIS EXISTS: behavior-preserving refactors (moving inline constants
 * into SimParams, deduplicating helpers, deriving values from the rule pack)
 * must be provably behavior-preserving, not hopefully so. This script hashes
 * the full event stream AND the replay frames for a fixed set of seeds; a
 * refactor commit that changes any hash is wrong by definition and gets
 * redone. This is the same byte-stability discipline the concepts.ts
 * consolidation used, made permanent and runnable.
 *
 * The corpus covers both CI seeds (`ci-fp`, `acceptance-0`) so the existing
 * CI determinism/band steps are anchored to the same baseline, plus 22
 * mirrored sampleMatchup games for coverage of both playing styles.
 *
 * Frames are included deliberately: several "cosmetic" constants (dead-ball
 * spots, free-throw lane positions) only surface in frames, and the corpus
 * must catch an accidental change to those too.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.resolve(HERE, '..', 'golden', 'fingerprints.json');

/** every seed in the corpus, in a fixed order (order is part of the format) */
const CORPUS_SEEDS: string[] = [
  'ci-fp',        // the CI determinism-fingerprint seed (simone.ts)
  'acceptance-0', // the first seed of the CI band-smoke batch (cli.ts)
  ...Array.from({ length: 22 }, (_, i) => `golden-${i}`)
];

interface SeedFingerprint {
  events: string;
  frames: string;
  finalScore: [number, number];
}

type Corpus = Record<string, SeedFingerprint>;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function fingerprintSeed(seed: string, index: number): SeedFingerprint {
  // mirror home/away on odd corpus indices, same convention as run.ts's
  // runBatch, so both styles get exercised from both sides
  const { home, away } = sampleMatchup();
  const flip = index % 2 === 1;
  const r = simulateGame({
    seed,
    home: flip ? away : home,
    away: flip ? home : away,
    collectFrames: true
  });
  return {
    events: sha256(JSON.stringify(r.events)),
    frames: sha256(JSON.stringify(r.frames)),
    finalScore: r.finalScore
  };
}

function buildCorpus(): Corpus {
  const corpus: Corpus = {};
  CORPUS_SEEDS.forEach((seed, i) => {
    corpus[seed] = fingerprintSeed(seed, i);
    process.stdout.write(`  ${i + 1}/${CORPUS_SEEDS.length}\r`);
  });
  process.stdout.write('\n');
  return corpus;
}

const write = process.argv.includes('--write');
const t0 = performance.now();

if (write) {
  const corpus = buildCorpus();
  mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, JSON.stringify(corpus, null, 2) + '\n');
  console.log(`wrote ${CORPUS_SEEDS.length} fingerprints to ${path.relative(process.cwd(), GOLDEN_PATH)}`);
  console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
} else {
  if (!existsSync(GOLDEN_PATH)) {
    console.error(`no golden corpus at ${GOLDEN_PATH} — run: npm run fingerprint:write`);
    process.exit(2);
  }
  const expected = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Corpus;
  const actual = buildCorpus();
  const failures: string[] = [];
  for (const seed of CORPUS_SEEDS) {
    const e = expected[seed];
    const a = actual[seed];
    if (!e) { failures.push(`${seed}: missing from golden file (corpus seeds changed without --write?)`); continue; }
    if (!a) { failures.push(`${seed}: missing from run`); continue; }
    if (e.events !== a.events) failures.push(`${seed}: EVENTS hash mismatch (${e.events.slice(0, 12)}… → ${a.events.slice(0, 12)}…)`);
    if (e.frames !== a.frames) failures.push(`${seed}: FRAMES hash mismatch (${e.frames.slice(0, 12)}… → ${a.frames.slice(0, 12)}…)`);
    if (e.finalScore[0] !== a.finalScore[0] || e.finalScore[1] !== a.finalScore[1]) {
      failures.push(`${seed}: final score ${e.finalScore.join('-')} → ${a.finalScore.join('-')}`);
    }
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  if (failures.length > 0) {
    console.error(`FINGERPRINT MISMATCH — engine behavior changed (${failures.length} deviation${failures.length === 1 ? '' : 's'}, ${secs}s):`);
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nIf this change is a DELIBERATE behavior change: re-baseline with ' +
      '`npm run fingerprint:write` in the same commit and say why in the commit message.\n' +
      'If it was supposed to be behavior-preserving: the commit is wrong — fix it, do not re-baseline.'
    );
    process.exit(1);
  }
  console.log(`fingerprints OK — ${CORPUS_SEEDS.length} seeds byte-identical (${secs}s)`);
}
