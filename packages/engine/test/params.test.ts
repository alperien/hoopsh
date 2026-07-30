/**
 * sim/params.ts — withParams merge semantics and defaultParams integrity.
 *
 * Spec sources: params.ts:1814-1859 (deep clone both paths, unknown keys and
 * non-finite VALUES fail loudly with the dotted path — the c4-F4 doctrine),
 * params.ts:1847-1849 ("every SimParams leaf is a finite number").
 *
 * adversarial.test.ts already pins the unknown-KEY throws (top-level and
 * nested dotted path) and that a valid override lands with siblings intact —
 * those are deliberately not re-pinned here. This file covers the clone
 * isolation, the value guard, undefined-skip semantics, and the all-finite
 * leaf walk that both the guard and Rng.weighted depend on.
 *
 * No calibrated magnitude is pinned anywhere (AGENTS.md §2.1): expectations
 * are read back from a pre-test snapshot of defaultParams, never written as
 * literals.
 */

import { describe, expect, it } from 'vitest';
import { defaultParams, withParams } from '@hoopsh/engine';

// snapshot taken before any test runs: the isolation assertions compare
// against this, so a mutation leaking INTO defaultParams cannot also corrupt
// the expectation
const snapshot = structuredClone(defaultParams);

describe('withParams clone semantics (params.ts:1814-1823)', () => {
  it('a no-override call returns a deep, independent, value-identical clone', () => {
    const a = withParams();
    expect(a).toEqual(defaultParams);
    expect(a).not.toBe(defaultParams);
    expect(a.shot).not.toBe(defaultParams.shot); // deep, not shallow
    expect(withParams()).not.toBe(withParams()); // two calls, two objects
  });

  it('mutating a withParams() result never touches defaultParams', () => {
    const a = withParams();
    a.shot.baseRim = 999;
    a.foul.shootFoulCap = -1;
    expect(defaultParams.shot.baseRim).toBe(snapshot.shot.baseRim);
    expect(defaultParams.foul.shootFoulCap).toBe(snapshot.foul.shootFoulCap);
    expect(withParams().shot.baseRim).toBe(snapshot.shot.baseRim);
  });

  it('overrides land in the clone only: defaultParams survives a merge byte-for-byte', () => {
    const p = withParams({ shot: { baseRim: 0.25 }, foul: { shootFoulCap: 0.5 } });
    expect(p.shot.baseRim).toBe(0.25);
    expect(p.foul.shootFoulCap).toBe(0.5);
    // untouched leaves and untouched blocks keep their default values
    expect(p.shot.basePaint).toBe(snapshot.shot.basePaint);
    expect(p.reb).toEqual(snapshot.reb);
    // and the source of truth is unmoved
    expect(defaultParams).toEqual(snapshot);
  });
});

describe('withParams merge semantics (params.ts:1827-1859)', () => {
  it('an undefined leaf means "no override", not a value', () => {
    // params.ts:1846 — `p !== undefined` guard: DeepPartial semantics for
    // dynamically-built override objects with absent entries
    const p = withParams({ shot: { baseRim: undefined } });
    expect(p.shot.baseRim).toBe(snapshot.shot.baseRim);
  });

  it('non-finite numeric values fail loudly, naming the full dotted path (c4-F4)', () => {
    // params.ts:1846-1854 — a NaN accepted here used to detonate minutes
    // later as an unattributed Rng.weighted error naming no field
    expect(() => withParams({ shot: { baseRim: NaN } } as never))
      .toThrow(/shot\.baseRim.*must be a finite number/);
    expect(() => withParams({ shot: { baseRim: Infinity } } as never))
      .toThrow(/shot\.baseRim.*must be a finite number/);
    expect(() => withParams({ foul: { shootFoulCap: -Infinity } } as never))
      .toThrow(/foul\.shootFoulCap.*must be a finite number/);
  });

  it('non-numeric values on numeric leaves fail loudly too: string, null, boolean', () => {
    // params.ts:1852 — typeof p !== 'number' is rejected, not coerced
    expect(() => withParams({ shot: { baseRim: '0.5' } } as never)).toThrow(/must be a finite number/);
    expect(() => withParams({ shot: { baseRim: null } } as never)).toThrow(/must be a finite number/);
    expect(() => withParams({ shot: { baseRim: true } } as never)).toThrow(/must be a finite number/);
  });

  it('a throwing merge leaves defaultParams intact — validation happens on a discarded clone', () => {
    // params.ts:1819-1822 — the clone is taken BEFORE the merge walks the
    // patch; if someone reorders that, a failed override corrupts the
    // engine's defaults for every game after it
    let threw = false;
    try {
      withParams({ shot: { baseMid: 0.123, baseRim: NaN } } as never);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(defaultParams).toEqual(snapshot);
  });

  it('replacing an entire GROUP with a non-object fails loudly, naming the group', () => {
    // Formerly the DISAGREEMENT todo (pre-audit params.ts:1852 guard gap):
    // withParams({ shot: 5 }) silently set params.shot = 5 and detonated far
    // from the boundary. The release audit closed it (commit 503ab7d, audit
    // M-17): deepMerge (params.ts:2247-2259) now requires plain-object
    // overrides for GROUP keys — null, arrays, and scalars are rejected at
    // the boundary with the same fail-loud doctrine as the key/value checks.
    // 5 and [0.5] below: FEEL, test-only sentinels — any non-object works;
    // the values are arbitrary, only the TYPE is under test
    expect(() => withParams({ shot: 5 } as never))
      .toThrow(/SimParams group "shot" must be a plain-object override, got number/);
    expect(() => withParams({ shot: null } as never))
      .toThrow(/SimParams group "shot" must be a plain-object override, got null/);
    expect(() => withParams({ shot: [0.5] } as never))
      .toThrow(/SimParams group "shot" must be a plain-object override, got an array/);
    // the still-legal neighbor: an undefined GROUP means "no override"
    expect(withParams({ shot: undefined }).shot).toEqual(snapshot.shot);
    // and the rejected merges were validated on a discarded clone
    expect(defaultParams).toEqual(snapshot);
  });
});

describe('defaultParams integrity (params.ts:1847-1849)', () => {
  it('every leaf is a finite number — the property the value guard and Rng.weighted rely on', () => {
    const offenders: string[] = [];
    let leaves = 0;
    const walk = (node: Record<string, unknown>, path: string): void => {
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (v && typeof v === 'object') {
          walk(v as Record<string, unknown>, `${path}${key}.`);
        } else {
          leaves += 1;
          if (typeof v !== 'number' || !Number.isFinite(v)) offenders.push(`${path}${key}=${String(v)}`);
        }
      }
    };
    walk(defaultParams as unknown as Record<string, unknown>, '');
    expect(offenders).toEqual([]);
    // non-vacuous: the walk actually visited the calibration surface
    expect(leaves).toBeGreaterThan(100);
  });
});
