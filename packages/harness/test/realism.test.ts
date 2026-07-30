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
 * Calibration of the tripwire itself: widths are DERIVED from the measured
 * noise floor (noise-floor.gen.ts — regenerate with `npm run noisefloor`):
 * each band edge extends by z·sd of the 24-game sampling distribution under
 * the null. At z=3 a failure means "the sim changed", not "the seed
 * changed" — the distinction feel-widened percentages could never make
 * (third external review). Where a measured center sits ON a band edge,
 * that is a standing calibration finding for INTERNALS, not gate noise —
 * compare noise-floor.gen.ts means against bands.ts edges for the current
 * list; the two examples a prior header named (pace at the 95 floor, ORtg
 * at the 121 ceiling) had drifted back inside their bands and gone stale
 * (audit L-52; today's floor measures pace ~99.2, ORtg ~115.9).
 */

import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';
import { accumulate, emptyAcc, finalize } from '../src/aggregate.js';
import { NBA_BANDS } from '../src/bands.js';
import { NOISE_FLOOR } from '../src/noise-floor.gen.js';

// tripwire z: under the null (measured sampling sd) a z=3 excursion is a
// ~0.3% event per check — a fired gate means the engine moved.
const Z = 3;

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

  // ---- check 1: TRIPWIRE vs band edges (edge ± Z·sd) — "is the sim still
  // inside acceptable basketball", sensitivity varies with where the center
  // sits inside its band (a metric mid-band is only caught by gross breakage)
  for (const band of NBA_BANDS) {
    // ratchet bands are declared destinations, not yet enforced floors — the
    // batch report and sweep see them; the regression guard does not (see
    // bands.ts Band.ratchet)
    if (band.ratchet) continue;
    const floor = (NOISE_FLOOR.league as Record<string, { n24: { sd: number } }>)[band.metric];
    const sd = floor ? floor.n24.sd : (band.hi - band.lo) * 0.15; // fallback: regenerate the floor
    const lo = band.lo - Z * sd;
    const hi = band.hi + Z * sd;
    it(`${band.label}: inside wide band [${lo.toFixed(2)} .. ${hi.toFixed(2)}]`, () => {
      const v = avgs[band.metric]!;
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    });
  }

  // ---- check 2: DRIFT vs the measured center (|current − mean| ≤ Zd·sd) —
  // "did the sim move from where the floor measured it", uniform sensitivity
  // across every metric regardless of band position (third review: without
  // this, a metric sitting 9σ inside its band is effectively uninstrumented).
  // Zd = 3.5: 17 simultaneous checks put family-wise false-alarm near 1%.
  // After an INTENTIONAL re-tune, regenerate the floor (npm run noisefloor) —
  // the gen-file diff is the accepted-drift record.
  const Zd = 3.5;
  for (const band of NBA_BANDS) {
    if (band.ratchet) continue;
    const floor = (NOISE_FLOOR.league as Record<string, { n24: { mean: number; sd: number } }>)[band.metric];
    if (!floor) continue;
    const { mean, sd } = floor.n24;
    it(`${band.label}: within ${Zd}σ of measured center ${mean.toFixed(2)}`, () => {
      const v = avgs[band.metric]!;
      expect(Math.abs(v - mean)).toBeLessThanOrEqual(Zd * sd);
    });
  }
});
