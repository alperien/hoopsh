/**
 * Realism regression guard: a fast, WIDE-band check that fails only on
 * catastrophic drift (the fine-grained lock lives in `npm run batch` and the
 * sweep). Bands here are the NBA acceptance bands widened by 35% on each side
 * — if this test fails, an engine change broke basic statistical realism.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';
import { accumulate, emptyAcc, finalize } from '../src/aggregate.js';
import { NBA_BANDS } from '../src/bands.js';

const GAMES = 10;

describe('realism regression guard (wide bands)', () => {
  const acc = emptyAcc();
  for (let i = 0; i < GAMES; i++) {
    const { home, away } = sampleMatchup();
    const flip = i % 2 === 1;
    const result = simulateGame({
      seed: `guard-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false
    });
    accumulate(acc, boxScore(result.events, [flip ? away : home, flip ? home : away]));
  }
  const avgs = finalize(acc);

  for (const band of NBA_BANDS) {
    // ratchet bands are declared destinations, not yet enforced floors — the
    // batch report and sweep see them; the regression guard does not (see
    // bands.ts Band.ratchet)
    if (band.ratchet) continue;
    const width = band.hi - band.lo;
    const lo = band.lo - width * 0.35;
    const hi = band.hi + width * 0.35;
    it(`${band.label}: inside wide band [${lo.toFixed(2)} .. ${hi.toFixed(2)}]`, () => {
      const v = avgs[band.metric]!;
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    });
  }
});
