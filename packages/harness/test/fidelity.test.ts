/**
 * Player-fidelity regression GATE — the permanent Phase 2R guard.
 *
 * Fast tripwire version of `npm run fidelity`: a reduced slate per benchmark
 * with each target range extended by z·sd of the MEASURED 12-game sampling
 * distribution (noise-floor.gen.ts — regenerate with `npm run noisefloor`).
 * At z=3, a failure means an engine change broke a benchmark superstar's
 * statistical identity (the gravity shooter stopped shooting, the hub
 * stopped hubbing) — not that the seed rolled badly. Fine-grained
 * validation stays in the CLI report at 40 games, and identity misses whose
 * measured 40-game CENTER sits outside the profile range are calibration
 * findings even when this tripwire passes (that distinction is the whole
 * point of measuring the floor — third external review).
 *
 * Ratchet rows (Target.ratchet) are declared destinations whose mechanisms
 * haven't landed — reported by the CLI, skipped here until they flip.
 * Quarantined rows (Target.quarantine — enforcement suspended pending a
 * named owner ruling, issue #43) are NOT skipped: they keep their widened
 * gate below, so a further regression on a quarantined row still fails CI
 * even while the CLI's exit code exempts the known, register-adjudicated
 * miss.
 */

import { describe, expect, it } from 'vitest';
import { BENCHMARKS, TARGETS, gradeTarget, runBenchmark, type Target } from '../src/fidelity.js';
import { NOISE_FLOOR } from '../src/noise-floor.gen.js';

const GAMES = 12; // the gate's speed tier; the CLI owns precision
const Z = 3;      // tripwire z under the measured null

describe('runBenchmark input contract', () => {
  it('throws loudly on a zero/NaN/fractional game count instead of returning null-as-AggLine (B3-1)', () => {
    const bench = BENCHMARKS[0]!;
    const star = bench.players[0]!;
    for (const bad of [0, -3, 1.5, NaN]) {
      expect(() => runBenchmark(bench, star.id, bad)).toThrow(/integer >= 1/);
    }
  });
});

describe('gradeTarget — the CLI exit-code classification (issue #43)', () => {
  // synthetic row, not a live target: pins the classification the CLI's
  // nonzero exit hangs on, without simulating a single game
  const row = (flags: Partial<Target> = {}): Target =>
    ({ label: 'X', lo: 10, hi: 13, get: (l) => l.trb / Math.max(1, l.games), ...flags });

  it('inside range grades ok regardless of flags', () => {
    expect(gradeTarget(row(), 11)).toBe('ok');
    expect(gradeTarget(row({ ratchet: true }), 11)).toBe('ok');
    expect(gradeTarget(row({ quarantine: 'W29' }), 11)).toBe('ok');
  });
  it('an enforced miss grades fail — the only grade that exits nonzero, both sides', () => {
    expect(gradeTarget(row(), 9)).toBe('fail');
    expect(gradeTarget(row(), 14)).toBe('fail');
  });
  it('a ratchet miss stays advisory (RTCH), never fail', () => {
    expect(gradeTarget(row({ ratchet: true }), 9)).toBe('ratchet-miss');
  });
  it('a quarantined miss reports loudly but does not gate (QUAR)', () => {
    expect(gradeTarget(row({ quarantine: 'W29' }), 9)).toBe('quarantined-miss');
  });

  // Inventory over the LIVE rows, zero simulation (PR #73 review). The
  // quarantine value is the exit-code bypass key, and node's type stripping
  // means an arbitrary truthy string RUNS here even though tsc rejects the
  // `W${number}` type. This assertion is the enforcement that reaches every
  // local `npm test`, where tsc is unavailable by design. At-most-one-flag is
  // gradeTarget's documented precondition: a row carrying both flags grades
  // ratchet-miss and leaves the tripwire, so the CI coverage the quarantine
  // paperwork promises would be silently void for that row.
  it('quarantine inventory: every flag names a register row (W-number) and never doubles with ratchet', () => {
    const badRefs: string[] = [];
    const doubled: string[] = [];
    for (const [starId, rows] of Object.entries(TARGETS)) {
      for (const t of rows) {
        if (t.quarantine !== undefined && !/^W\d+$/.test(t.quarantine)) {
          badRefs.push(`${starId} ${t.label}: ${t.quarantine}`);
        }
        if (t.ratchet && t.quarantine !== undefined) {
          doubled.push(`${starId} ${t.label}`);
        }
      }
    }
    expect(badRefs).toEqual([]);
    expect(doubled).toEqual([]);
  });
});

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
