/**
 * Player-fidelity regression GATE — the permanent Phase 2R guard.
 *
 * Fast, WIDE version of `npm run fidelity`: a reduced slate per benchmark
 * with each target range widened by 35% of its width on both sides — the
 * same two-tier pattern as the band report vs the wide-band realism guard.
 * If this fails, an engine change broke a benchmark superstar's statistical
 * identity (the gravity shooter stopped shooting, the hub stopped hubbing).
 * Fine-grained validation stays in the CLI report at 40 games.
 *
 * Ratchet rows (Target.ratchet) are declared destinations whose mechanisms
 * haven't landed — reported by the CLI, skipped here until they flip.
 */

import { describe, expect, it } from 'vitest';
import { BENCHMARKS, TARGETS, runBenchmark } from '../src/fidelity.js';

const GAMES = 12; // enough to hold the widened ranges; the CLI owns precision

describe(`player-fidelity gate (wide ranges, ${GAMES} games per benchmark)`, () => {
  for (const bench of BENCHMARKS) {
    const star = bench.players[0]!;
    const agg = runBenchmark(bench, star.id, GAMES);
    for (const t of TARGETS[star.id]!) {
      if (t.ratchet) continue;
      const width = t.hi - t.lo;
      const lo = t.lo - width * 0.35;
      const hi = t.hi + width * 0.35;
      it(`${star.name} ${t.label}: inside wide range [${lo.toFixed(2)} .. ${hi.toFixed(2)}]`, () => {
        const v = t.get(agg);
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
      });
    }
  }
});
