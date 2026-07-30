/**
 * Spec-derived unit tests for core/vec.ts — the 2D math every spatial
 * decision (drive lanes, passing-lane occlusion, closeouts) sits on.
 * All expectations come from the module JSDoc, not the function bodies.
 * Numeric cases are chosen on binary-exact grids (quarter-foot steps,
 * power-of-two interpolation fractions, 3-4-5 triangles) so exact `toBe`/
 * `toEqual` assertions hold under IEEE doubles without a toBeCloseTo matcher.
 */
import { describe, expect, it } from 'vitest';
import { vec, type V2 } from '@hoopsh/engine';

describe('vec basics (units: feet)', () => {
  // spec: core/vec.ts:17-31 JSDoc per function
  it('v2/add/sub/scale/dot compute component-wise', () => {
    expect(vec.v2(3, -2)).toEqual({ x: 3, y: -2 });
    expect(vec.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(vec.sub({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: -2, y: -2 });
    expect(vec.scale({ x: 3, y: -2 }, 2)).toEqual({ x: 6, y: -4 });
    expect(vec.dot({ x: 2, y: 3 }, { x: 4, y: 5 })).toBe(23);
  });

  // spec: core/vec.ts:26-29 — len is a speed (ft/s) or length, dist a court
  // distance in feet. 3-4-5 triangle is exact under IEEE hypot on V8
  // (findings/fixtures.md recipe 3 verified dist((0,0),(3,4)) === 5).
  it('len and dist measure straight-line feet', () => {
    expect(vec.len({ x: 3, y: 4 })).toBe(5);
    expect(vec.dist({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(5);
    expect(vec.dist({ x: 2, y: 7 }, { x: 2, y: 7 })).toBe(0);
  });
});

describe('freshness: every function returns a new object and never mutates inputs', () => {
  // spec: core/vec.ts:3-9 module header — "Deliberately allocation-heavy:
  // every function returns a fresh {x, y} object rather than mutating in
  // place". A mutating vec would silently corrupt agent positions shared
  // across ticks, so this is the module's load-bearing design promise.
  it('object-returning functions hand back fresh vectors', () => {
    const a: V2 = { x: 3, y: 4 };
    const b: V2 = { x: 9, y: 12 };
    const results: V2[] = [
      vec.add(a, b),
      vec.sub(a, b),
      vec.scale(a, 2),
      vec.norm(a),
      vec.lerp(a, b, 0.5),
      vec.toward(a, b, 1),
      vec.clampRect(a, 94, 50), // 94x50 ft NBA court footprint
      vec.closestOnSegment(a, b, { x: 5, y: 5 })
    ];
    for (const r of results) {
      expect(r).not.toBe(a);
      expect(r).not.toBe(b);
    }
    // inputs untouched after the whole battery
    expect(a).toEqual({ x: 3, y: 4 });
    expect(b).toEqual({ x: 9, y: 12 });
  });

  // spec: core/vec.ts:45-51 — toward's arrival branch returns `{...to}`, a
  // COPY of the destination. Handing back `to` itself would alias an agent's
  // position to its target spot; moving the spot would teleport the agent.
  it('toward at/inside maxStep returns a copy of `to`, not `to` itself', () => {
    const to: V2 = { x: 10, y: 0 };
    const arrived = vec.toward({ x: 9, y: 0 }, to, 999);
    expect(arrived).toEqual(to);
    expect(arrived).not.toBe(to);
  });

  // spec: core/vec.ts:59-63 — degenerate segment returns a COPY of `a`
  it('closestOnSegment on a zero-length segment returns a copy of a', () => {
    const a: V2 = { x: 2, y: 3 };
    const r = vec.closestOnSegment(a, { x: 2, y: 3 }, { x: 50, y: 50 });
    expect(r).toEqual({ x: 2, y: 3 });
    expect(r).not.toBe(a);
  });
});

describe('norm', () => {
  // spec: core/vec.ts:33-37 — unit vector; near-zero-length input (len <
  // 1e-9) returns the zero vector instead of dividing by ~0. Dropping that
  // guard makes a stationary agent's heading NaN and poisons every position
  // derived from it.
  it('returns the zero vector for zero and near-zero inputs', () => {
    expect(vec.norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(vec.norm({ x: 1e-12, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(vec.norm({ x: 0, y: -1e-12 })).toEqual({ x: 0, y: 0 });
  });

  it('returns the unit vector otherwise', () => {
    // 3-4-5 triangle: 3/5 and 4/5 are correctly-rounded divisions equal to
    // the literals 0.6/0.8
    expect(vec.norm({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(vec.len(vec.norm({ x: -3, y: 4 }))).toBe(1);
  });
});

describe('lerp', () => {
  // spec: core/vec.ts:39-43 — t=0 -> a, t=1 -> b, UNCLAMPED: t outside [0,1]
  // extrapolates. A clamping "fix" would silently cap projections that AI
  // code aims past a target on purpose.
  const a: V2 = { x: 0, y: 0 };
  const b: V2 = { x: 10, y: 0 };

  it('hits the endpoints at t=0 and t=1', () => {
    expect(vec.lerp(a, b, 0)).toEqual({ x: 0, y: 0 });
    expect(vec.lerp(a, b, 1)).toEqual({ x: 10, y: 0 });
    expect(vec.lerp(a, b, 0.5)).toEqual({ x: 5, y: 0 });
  });

  it('extrapolates outside [0,1] instead of clamping', () => {
    expect(vec.lerp(a, b, 2)).toEqual({ x: 20, y: 0 });
    expect(vec.lerp(a, b, -1)).toEqual({ x: -10, y: 0 });
  });
});

describe('toward', () => {
  // spec: core/vec.ts:45-51 — steps at most maxStep toward `to`; arrives
  // exactly (copy of `to`) when d <= maxStep or the distance is degenerate
  // (d < 1e-9). This is per-tick agent motion: overshooting = teleporting.
  it('steps exactly maxStep when the target is farther than maxStep', () => {
    // straight-line: 8 ft away, 2 ft step -> t = 0.25 (binary-exact)
    expect(vec.toward({ x: 0, y: 0 }, { x: 8, y: 0 }, 2)).toEqual({ x: 2, y: 0 });
    // diagonal: 6-8-10 triangle, 5 ft step -> halfway, binary-exact {3,4}
    const stepped = vec.toward({ x: 0, y: 0 }, { x: 6, y: 8 }, 5);
    expect(stepped).toEqual({ x: 3, y: 4 });
    expect(vec.dist({ x: 0, y: 0 }, stepped)).toBe(5);
  });

  it('arrives exactly when the target is within maxStep', () => {
    expect(vec.toward({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toEqual({ x: 3, y: 4 });
    expect(vec.toward({ x: 0, y: 0 }, { x: 3, y: 4 }, 6)).toEqual({ x: 3, y: 4 });
  });

  it('holds position on a zero-distance move (degenerate guard)', () => {
    expect(vec.toward({ x: 7, y: 7 }, { x: 7, y: 7 }, 0)).toEqual({ x: 7, y: 7 });
  });
});

describe('clampRect', () => {
  // spec: core/vec.ts:53-57 — clamp a point into [margin, w-margin] x
  // [margin, h-margin], margin defaulting to 0. This is what keeps agents
  // and miss-landings on the 94x50 ft court.
  it('clamps an out-of-bounds point onto the boundary (margin default 0)', () => {
    expect(vec.clampRect({ x: -5, y: 60 }, 94, 50)).toEqual({ x: 0, y: 50 });
    expect(vec.clampRect({ x: 100, y: -3 }, 94, 50)).toEqual({ x: 94, y: 0 });
  });

  it('respects an explicit margin on both axes', () => {
    // 2 ft margin: the sideline buffer used for miss landings
    expect(vec.clampRect({ x: -5, y: 60 }, 94, 50, 2)).toEqual({ x: 2, y: 48 });
  });

  it('passes an interior point through unchanged in value', () => {
    expect(vec.clampRect({ x: 47, y: 25 }, 94, 50)).toEqual({ x: 47, y: 25 });
    expect(vec.clampRect({ x: 47, y: 25 }, 94, 50, 2)).toEqual({ x: 47, y: 25 });
  });
});

describe('closestOnSegment / distToSegment (passing-lane occlusion primitive)', () => {
  // spec: core/vec.ts:59-72 — projection is clamped to the segment, so a
  // query beyond an endpoint returns the endpoint; a zero-length segment
  // returns a. distToSegment is the defender-to-lane distance: unclamped
  // projection would let a defender standing BEHIND the passer "occlude"
  // a pass he cannot touch.
  const a: V2 = { x: 0, y: 0 };
  const b: V2 = { x: 10, y: 0 };

  it('projects onto the interior when the foot of the perpendicular is inside', () => {
    expect(vec.closestOnSegment(a, b, { x: 5, y: 3 })).toEqual({ x: 5, y: 0 });
    expect(vec.distToSegment(a, b, { x: 5, y: 3 })).toBe(3);
  });

  it('clamps to the endpoints for beyond-endpoint queries', () => {
    expect(vec.closestOnSegment(a, b, { x: -4, y: 3 })).toEqual({ x: 0, y: 0 });
    expect(vec.closestOnSegment(a, b, { x: 14, y: 3 })).toEqual({ x: 10, y: 0 });
    // 3-4-5 triangle to the a-endpoint: exact under IEEE
    expect(vec.distToSegment(a, b, { x: -4, y: 3 })).toBe(5);
    expect(vec.distToSegment(a, b, { x: 13, y: 4 })).toBe(5);
  });

  it('degenerate segment: distance falls back to dist(p, a)', () => {
    const p: V2 = { x: 7, y: 9 };
    expect(vec.distToSegment(a, a, p)).toBe(vec.dist(p, a));
  });
});

describe('segmentT (clamped projection parameter)', () => {
  // spec: core/vec.ts:74-85 — 0 at a, 1 at b, clamped beyond, 0 for a
  // zero-length segment; and the doc's internal-consistency promise that
  // closestOnSegment "is this followed by the lerp".
  const a: V2 = { x: 2, y: 1 };
  const b: V2 = { x: 10, y: 7 };

  it('is 0 at a, 1 at b, and 0.5 at the midpoint', () => {
    expect(vec.segmentT(a, b, a)).toBe(0);
    expect(vec.segmentT(a, b, b)).toBe(1);
    expect(vec.segmentT(a, b, { x: 6, y: 4 })).toBe(0.5);
  });

  it('clamps beyond the endpoints and zeroes on a degenerate segment', () => {
    // extend past b along the a->b direction (slope 6/8): still 1
    expect(vec.segmentT(a, b, { x: 18, y: 13 })).toBe(1);
    // behind a along the same line: still 0
    expect(vec.segmentT(a, b, { x: -6, y: -5 })).toBe(0);
    expect(vec.segmentT(a, a, { x: 50, y: 50 })).toBe(0);
  });

  it('closestOnSegment(a,b,p) === lerp(a,b,segmentT(a,b,p)) on and off the segment', () => {
    // the two share one formula by construction — a drift between them would
    // make the drive-lane crowd check disagree with the occlusion check
    const probes: V2[] = [
      { x: 6, y: 4 },
      { x: 4.3, y: 9.1 },
      { x: -20, y: 3 },
      { x: 30, y: -2 },
      { x: 2, y: 1 }
    ];
    for (const p of probes) {
      expect(vec.lerp(a, b, vec.segmentT(a, b, p))).toEqual(vec.closestOnSegment(a, b, p));
    }
  });
});
