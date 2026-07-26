/**
 * Realism regression guard — the TRIPWIRE, not the lock.
 *
 * Role: fail `npm test` (and CI) only when an engine change breaks basic
 * statistical realism. The fine-grained instruments are elsewhere: the lock
 * is the three-seed 40-game verify (`npm run sweep -- --iters 0 --verify 40`)
 * plus the fidelity gate and `npm run oos`. Keep the division of labor —
 * a tripwire that cries wolf gets deleted, a tripwire that never fires is
 * decoration.
 *
 * Calibration of the tripwire itself: bands are widened 30% of their width
 * on each side, at 24 deterministic games. Why 30 and not tighter: the two
 * RECORDED systematic residuals (FTA runs low, 3P% runs high — see
 * docs/INTERNALS.md findings) sit up to ~20% of band-width outside the true
 * band on some seed bases, so a widening much below ~30% would alarm on
 * known, documented state rather than on drift. If those findings get fixed,
 * tighten this widening in the same commit — that's the ratchet.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';
import { accumulate, emptyAcc, finalize } from '../src/aggregate.js';
import { NBA_BANDS } from '../src/bands.js';

const GAMES = 24;

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
    const lo = band.lo - width * 0.30;
    const hi = band.hi + width * 0.30;
    it(`${band.label}: inside wide band [${lo.toFixed(2)} .. ${hi.toFixed(2)}]`, () => {
      const v = avgs[band.metric]!;
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    });
  }
});
