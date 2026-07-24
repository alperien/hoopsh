/** Minimal 2D vector math. Units are feet everywhere in the engine. */

export interface V2 {
  x: number;
  y: number;
}

export const v2 = (x: number, y: number): V2 => ({ x, y });

export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: V2, s: number): V2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: V2): number => Math.hypot(a.x, a.y);
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dot = (a: V2, b: V2): number => a.x * b.x + a.y * b.y;

export const norm = (a: V2): V2 => {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

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

/** distance from point p to segment ab */
export function distToSegment(a: V2, b: V2, p: V2): number {
  return dist(p, closestOnSegment(a, b, p));
}
