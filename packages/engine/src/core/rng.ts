/**
 * Deterministic seeded PRNG (sfc32) + distribution helpers.
 *
 * Every random draw in a game flows through one Rng instance owned by the sim.
 * Same seed + same inputs = bit-identical games on every platform.
 * Never use Math.random() anywhere in the engine.
 */

/** cyrb128 string hash -> four 32-bit seeds */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private gauss: number | null = null;

  constructor(seed: string | number) {
    const [a, b, c, d] = cyrb128(String(seed));
    this.a = a; this.b = b; this.c = c; this.d = d;
    // warm up
    for (let i = 0; i < 12; i++) this.float();
  }

  /** uniform float in [0, 1) */
  float(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** uniform float in [min, max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** uniform int in [0, n) */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** true with probability p */
  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: empty array');
    return arr[this.int(arr.length)]!;
  }

  /** index sampled proportionally to non-negative weights (all-zero -> uniform) */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return this.int(weights.length);
    let roll = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i]!);
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }

  /** standard normal via Box-Muller (cached pair) */
  gaussian(mean = 0, sd = 1): number {
    if (this.gauss !== null) {
      const g = this.gauss;
      this.gauss = null;
      return mean + sd * g;
    }
    let u = 0, v = 0;
    while (u === 0) u = this.float();
    while (v === 0) v = this.float();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.gauss = mag * Math.cos(2 * Math.PI * v);
    return mean + sd * mag * Math.sin(2 * Math.PI * v);
  }

  /** in-place Fisher-Yates */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }
}

/** logistic sigmoid — the workhorse of every probability model in the engine */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
