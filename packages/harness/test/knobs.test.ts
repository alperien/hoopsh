/**
 * The sweepable knob registry (harness/src/knobs.ts): every entry must be a
 * live, sanely-railed dot-path into the engine's SimParams.
 *
 * Spec: knobs.ts header — "Paths are dot-notation into SimParams (resolved
 * by getPath ... into packages/engine/src/sim/params.ts' nested SimParams
 * object)" and "Each `lo`/`hi` here is a SEARCH SAFETY RAIL ... hand-picked
 * around each constant's shipped SWEPT/REAL value". Nothing checks this
 * registry at runtime: a SimParams field rename (or a typo'd new knob) makes
 * getPath return undefined and the sweep silently perturbs nothing — these
 * ~250 lines gate the whole calibration loop with zero direct tests today.
 *
 * SWEPT discipline (AGENTS.md DO-NOT #1, docs/CALIBRATION.md): no knob VALUE
 * or registry COUNT is pinned here — only the structural properties that
 * make the registry usable. The default-inside-rail assertion stays valid
 * across re-tunes because a re-tune that moves a default updates its rail in
 * the same change (knobs.ts header: ranges are picked around the shipped
 * default).
 *
 * Zero sims.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams } from '@hoopsh/engine';
import { getPath, setPath, SWEEPABLE } from '../src/knobs.js';

// clone so no test can leak a mutation into the shared engine default object
const params = (): Record<string, unknown> =>
  structuredClone(defaultParams) as unknown as Record<string, unknown>;

describe('SWEEPABLE registry wiring', () => {
  it('the registry is non-empty (anti-vacuity guard for every loop below)', () => {
    expect(SWEEPABLE.length).toBeGreaterThan(0);
  });

  it('every knob path resolves to a finite number in defaultParams (knobs.ts:2-5 — paths are dot-notation into SimParams)', () => {
    // a renamed/removed SimParams field would leave the sweep "optimizing"
    // a dead dimension with no error anywhere else
    const p = params();
    for (const k of SWEEPABLE) {
      const v = getPath(p, k.path);
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('every rail is a real interval: lo strictly below hi (knobs.ts:34-44 — a rail bounds how far perturb() may push)', () => {
    // lo === hi would pin the knob (dead search dimension); lo > hi would
    // make every clamp nonsensical
    for (const k of SWEEPABLE) {
      expect(k.lo).toBeLessThan(k.hi);
    }
  });

  it('the shipped default sits inside every rail (knobs.ts:40-43 — ranges are "hand-picked around each constant\'s shipped SWEPT/REAL value")', () => {
    // sweep.ts perturbs AROUND the params.ts default and clamps to [lo, hi];
    // a default outside its own rail means iteration zero already moves the
    // shipped value — exactly the drift the rail exists to prevent.
    // Structural check only: the VALUES are the sweep's property (AGENTS §2.1).
    const p = params();
    for (const k of SWEEPABLE) {
      const v = getPath(p, k.path);
      expect(v).toBeGreaterThanOrEqual(k.lo);
      expect(v).toBeLessThanOrEqual(k.hi);
    }
  });

  it('paths are unique — a duplicated entry would perturb one knob twice per candidate', () => {
    expect(new Set(SWEEPABLE.map((k) => k.path)).size).toBe(SWEEPABLE.length);
  });
});

describe('getPath / setPath dot-path helpers', () => {
  it('round-trip on a plain nested object; setPath mutates IN PLACE (setPath JSDoc, knobs.ts:226-241)', () => {
    const o: Record<string, unknown> = { a: { b: { c: 1 } }, top: 9 };
    setPath(o, 'a.b.c', 5);
    expect(getPath(o, 'a.b.c')).toBe(5);
    // in-place: the original object graph carries the write
    expect(((o.a as Record<string, unknown>).b as Record<string, unknown>).c).toBe(5);
    // sibling and top-level keys untouched
    expect(getPath(o, 'top')).toBe(9);
  });

  it('single-segment paths address top-level keys (getPath splits on ".")', () => {
    const o: Record<string, unknown> = { solo: 3.5 };
    expect(getPath(o, 'solo')).toBe(3.5);
    setPath(o, 'solo', 4.5);
    expect(getPath(o, 'solo')).toBe(4.5);
  });

  it('round-trips on the real SimParams shape at a registered knob path without disturbing sibling knobs', () => {
    // uses registry entries rather than hard-coded paths so a params rename
    // cannot strand this test on a stale literal. Writing hi+1 is provably
    // NOT the shipped default (defaults sit inside [lo, hi], asserted above),
    // so a silently-failed write cannot masquerade as a round-trip.
    const p = params();
    const knob = SWEEPABLE[0]!;
    const siblings = SWEEPABLE.slice(1).map((k) => [k.path, getPath(p, k.path)] as const);
    setPath(p, knob.path, knob.hi + 1);
    expect(getPath(p, knob.path)).toBe(knob.hi + 1);
    // a setPath writing at the wrong depth would clobber neighbors
    for (const [path, v] of siblings) expect(getPath(p, path)).toBe(v);
  });
});
