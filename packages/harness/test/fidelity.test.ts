/**
 * Player-fidelity regression gate: the permanent Phase 2R guard.
 *
 * Fast tripwire version of `npm run fidelity`: a reduced slate per benchmark
 * with each target range extended by z·sd of the measured 12-game sampling
 * distribution (noise-floor.gen.ts; regenerate with `npm run noisefloor`).
 * At z=3, a failure means an engine change broke a benchmark superstar's
 * statistical identity (the gravity shooter stopped shooting, the hub
 * stopped hubbing), not that the seed rolled badly. Fine-grained
 * validation stays in the CLI report at 40 games, and identity misses whose
 * measured 40-game center sits outside the profile range are calibration
 * findings even when this tripwire passes. That distinction is the whole
 * point of measuring the floor (third external review).
 *
 * Ratchet rows (Target.ratchet) are declared destinations whose mechanisms
 * haven't landed: reported by the CLI, skipped here until they flip.
 */

import { describe, expect, it } from 'vitest';
import { BENCHMARKS, TARGETS, runBenchmark } from '../src/fidelity.js';
import { NOISE_FLOOR } from '../src/noise-floor.gen.js';

const GAMES = 12; // the gate's speed tier; the CLI owns precision
const Z = 3;      // tripwire z under the measured null

describe(`player-fidelity gate (measured-noise widths, ${GAMES} games per benchmark)`, () => {
  for (const bench of BENCHMARKS) {
    const star = bench.players[0]!;
    const agg = runBenchmark(bench, star.id, GAMES);
    const floor = (NOISE_FLOOR.stars as Record<string, Record<string, { n12: { sd: number } }>>)[star.id];
    for (const t of TARGETS[star.id]!) {
      if (t.ratchet) continue;
      const sd = floor?.[t.label] ? floor[t.label]!.n12.sd : (t.hi - t.lo) * 0.175; // fallback: regenerate the floor
      const lo = t.lo - Z * sd;
      const hi = t.hi + Z * sd;
      it(`${star.name} ${t.label}: inside tripwire range [${lo.toFixed(2)} .. ${hi.toFixed(2)}]`, () => {
        const v = t.get(agg);
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
      });
    }
  }
});
