/**
 * Performance benchmark — tracks the ≥1 game/sec/core budget from day one.
 *   npm run bench
 *
 * Two-phase deliberately: an untimed warmup loop lets Node's JIT (V8)
 * finish tiering up simulateGame's hot paths BEFORE the clock starts, so
 * the measured N=25 loop reflects steady-state throughput rather than
 * being dragged down by first-run interpretation/deopt costs that no real
 * usage (a sweep worker running thousands of games back-to-back) would
 * actually pay per-game. Same fixed matchup for every iteration (from
 * @hoopsh/data's sampleMatchup) — this measures raw sim speed, not
 * roster-dependent variance, so only the seed changes game to game.
 *
 * THE INVOCATION CONTRACT (#175). Every input to the event counts below is
 * pinned by the repo tree: the matchup (sampleMatchup's fixed rosters), the
 * seed set (literal `warm-0..2` and `bench-0..24` strings), the game count
 * (N = 25), and the engine itself. No CLI args, env vars, clocks, or worker
 * processes reach the sim. The events lines are therefore a pure function of
 * (tree contents, Node/V8 version): two boxes at the same clean tree and the
 * same Node version must print byte-identical events lines. The timing lines
 * (total time, games/sec, ms/game) are hardware- and load-dependent and are
 * never comparable across boxes; the ≥1 game/sec budget is the only claim
 * they support. If two same-tree logs disagree on an events line, one of
 * them did not run this tree (dirty checkout, wrong worktree), or engine
 * determinism broke, which freezes merges (AGENTS.md §1.2). Run
 * `npm run fingerprint` to adjudicate, and read the per-game counts line to
 * name the diverging seed.
 *
 * Incident (#175): during the #174 review cycle two bench logs at "the same
 * commit" read avg events 1240 vs 1238. Both numbers were real. 1240 is the
 * #142-fixed engine at the PR head; 1238 is its base. The old output carried
 * no provenance, so off-tree control runs on both sides were attributed to
 * the wrong tree, and the record showed a phantom cross-box divergence. The
 * matchup/seeds/node/tree/sig lines exist so a bench log is never
 * tree-anonymous again.
 */

import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Tree identity for the contract lines: short HEAD sha plus a clean/DIRTY
 * flag. Shells out to git (worktrees and detached HEADs then read correctly
 * for free) and degrades to 'unknown' when git or the .git directory is
 * unavailable; the events lines still compare, they just lose their label.
 * Dirty means tracked-file modifications only (--untracked-files=no): an
 * untracked file is unreachable by the import graph unless a tracked file
 * changed too, so untracked litter (run logs, probe rigs) does not flag it.
 */
function treeIdentity(): string {
  // bench.ts lives at packages/harness/src/, three levels below the root.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  try {
    const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
    if (rev.status !== 0) return 'unknown (git unavailable or not a checkout)';
    const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' });
    const dirty = st.status === 0 && st.stdout.trim().length > 0;
    return `${rev.stdout.trim()} ${dirty ? 'DIRTY (events lines not attributable to the commit)' : 'clean'}`;
  } catch {
    return 'unknown (git unavailable or not a checkout)';
  }
}

/**
 * FNV-1a 32-bit over the per-game summary string. Not cryptographic and not
 * a stream fingerprint (that is `npm run fingerprint`'s job): its one purpose
 * is that two logs claiming the same tree either agree on this line or
 * visibly do not, without anyone eyeballing 25 counts.
 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis (2166136261, standard value)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV-1a 32-bit prime (16777619, standard value)
  }
  return (h >>> 0).toString(16).padStart(8, '0'); // as unsigned fixed-width hex
}

const { home, away } = sampleMatchup();

// warmup (JIT) — untimed on purpose, see file header.
for (let i = 0; i < 3; i++) {
  simulateGame({ seed: `warm-${i}`, home, away, collectFrames: false });
}

const N = 25;
const t0 = performance.now();
let events = 0;
const perGame: number[] = []; // event count per game, in seed order bench-0..bench-24
let sigInput = ''; // canonical per-game summary the sig line hashes: "i:events:home-away;"
for (let i = 0; i < N; i++) {
  const r = simulateGame({ seed: `bench-${i}`, home, away, collectFrames: false });
  events += r.events.length;
  perGame.push(r.events.length);
  sigInput += `${i}:${r.events.length}:${r.finalScore[0]}-${r.finalScore[1]};`;
}
const secs = (performance.now() - t0) / 1000;

// Contract lines first (what ran), result lines second (what it measured).
// The seeds line restates the loop literals above; keep them in sync.
console.log(`matchup:      ${home.id} vs ${away.id}  (sampleMatchup, fixed rosters)`);
console.log(`seeds:        warm-0..2 untimed + bench-0..${N - 1} timed, single process`);
console.log(`node:         ${process.version}  (V8 ${process.versions.v8})`);
console.log(`tree:         ${treeIdentity()}`);
console.log(`games:        ${N}`);
console.log(`total time:   ${secs.toFixed(2)}s`);
console.log(`games/sec:    ${(N / secs).toFixed(2)}  (budget: ≥ 1.0)`);
console.log(`ms/game:      ${((secs / N) * 1000).toFixed(0)}`);
console.log(`avg events:   ${(events / N).toFixed(0)}`);
console.log(`events total: ${events}`);
console.log(`events/game:  ${perGame.join(',')}`);
console.log(`events sig:   ${fnv1a(sigInput)}`);
console.log(`contract:     events lines are pinned by tree+node and must reproduce byte-identically; timing lines are load-dependent`);
