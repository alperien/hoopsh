/**
 * Performance benchmark; tracks the ≥1 game/sec/core budget from day one.
 *   npm run bench
 *
 * Two-phase deliberately: an untimed warmup loop lets Node's JIT (V8)
 * finish tiering up simulateGame's hot paths before the clock starts, so
 * the measured N=25 loop reflects steady-state throughput rather than
 * being dragged down by first-run interpretation/deopt costs that no real
 * usage (a sweep worker running thousands of games back-to-back) would
 * actually pay per-game. Same fixed matchup for every iteration (from
 * @hoopsh/data's sampleMatchup): this measures raw sim speed, not
 * roster-dependent variance, so only the seed changes game to game.
 */

import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const { home, away } = sampleMatchup();

// warmup (JIT); untimed on purpose, see file header.
for (let i = 0; i < 3; i++) {
  simulateGame({ seed: `warm-${i}`, home, away, collectFrames: false });
}

const N = 25;
const t0 = performance.now();
let events = 0;
for (let i = 0; i < N; i++) {
  const r = simulateGame({ seed: `bench-${i}`, home, away, collectFrames: false });
  events += r.events.length;
}
const secs = (performance.now() - t0) / 1000;

console.log(`games:        ${N}`);
console.log(`total time:   ${secs.toFixed(2)}s`);
console.log(`games/sec:    ${(N / secs).toFixed(2)}  (budget: ≥ 1.0)`);
console.log(`ms/game:      ${((secs / N) * 1000).toFixed(0)}`);
console.log(`avg events:   ${(events / N).toFixed(0)}`);
