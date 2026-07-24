/**
 * Performance benchmark — tracks the ≥1 game/sec/core budget from day one.
 *   npm run bench
 */

import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const { home, away } = sampleMatchup();

// warmup (JIT)
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
