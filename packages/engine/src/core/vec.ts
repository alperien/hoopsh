/**
 * Minimal 2D vector math. Units are feet everywhere in the engine (a V2 is a
 * court position or a velocity in ft/s, never normalized/screen-space
 * coordinates). Deliberately allocation-heavy: every function returns a
 * fresh `{ x, y }` object rather than mutating in place or writing into a
 * caller-supplied output param. At 10 Hz with a couple dozen agents, the
 * garbage-collector cost is nowhere near the perf budget (see ARCHITECTURE.md
 * §7's ≥1 game/sec target), so readability wins over the micro-optimization
 * of a mutable/pooled vector API.
 */

export interface V2 {
  x: number;
  y: number;
}

/** construct a V2 from raw components */
export const v2 = (x: number, y: number): V2 => ({ x, y });

/** vector sum a + b */
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
/** vector difference a - b */
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
/** scalar multiply: a * s */
export const scale = (a: V2, s: number): V2 => ({ x: a.x * s, y: a.y * s });
/** magnitude (length) of a vector, e.g. a velocity's speed in ft/s */
export const len = (a: V2): number => Math.hypot(a.x, a.y);
/** straight-line distance between two points, in feet */
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.y - b.y);
/** dot product of a and b */
export const dot = (a: V2, b: V2): number => a.x * b.x + a.y * b.y;

/** unit vector in the direction of a; returns the zero vector for a near-zero-length input rather than dividing by ~0 */
export const norm = (a: V2): V2 => {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

/** linear interpolation between a and b; t=0 -> a, t=1 -> b (unclamped; t outside [0,1] extrapolates) */
export const lerp = (a: V2, b: V2, t: number): V2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});

/** step from `from` toward `to` by at most maxStep */
export const toward = (from: V2, to: V2, maxStep: number): V2 => {
  const d = dist(from, to);
  if (d <= maxStep || d < 1e-9) return { ...to };
  const t = maxStep / d;
  return lerp(from, to, t);
};

/** clamp a point into a rectangle with optional margin */
export const clampRect = (p: V2, w: number, h: number, margin = 0): V2 => ({
  x: Math.min(w - margin, Math.max(margin, p.x)),
  y: Math.min(h - margin, Math.max(margin, p.y))
});

/** point on segment ab closest to p */
export function closestOnSegment(a: V2, b: V2, p: V2): V2 {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  if (l2 < 1e-9) return { ...a };
  let t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

/** distance from point p to segment ab; used for passing-lane occlusion (how close a defender sits to the ball's straight-line path) */
export function distToSegment(a: V2, b: V2, p: V2): number {
  return dist(p, closestOnSegment(a, b, p));
}

/** clamped projection parameter of p onto segment ab: 0 at a, 1 at b.
 *  The shared "how far along the line is this defender" primitive: the
 *  drive-lane crowd check uses it directly, and closestOnSegment above is
 *  this followed by the lerp. (This used to be re-implemented privately in
 *  two sim modules; one definition now.) */
export function segmentT(a: V2, b: V2, p: V2): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  if (l2 < 1e-9) return 0;
  const t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2;
  return Math.max(0, Math.min(1, t));
}
