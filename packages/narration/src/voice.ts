/**
 * Voice machinery — the schema that makes a narrator DATA, plus the rendering
 * primitives every voice shares (slot filling, anti-repetition dealing,
 * clock/score phrasing).
 *
 * A VoicePack mirrors the repo's rule-pack/data-pack philosophy: personality
 * as an inspectable, editable object — template pools keyed by
 * "<kind>.<variant>.<register>", signature calls under per-game budgets, and
 * style dials. The booth (booth.ts) owns WHEN a voice speaks; a pack only
 * owns HOW it sounds.
 *
 * Determinism: LineDealer consumes EXACTLY one RNG draw per deal regardless
 * of how many repeat-avoidance bumps happen (index arithmetic, never a
 * re-draw) — the same consumption rule documented on v1 pbp.ts's Pool, for
 * the same reason: variable draw counts would shift every later pick in the
 * script.
 */

import type { Rng } from '@hoopsh/engine';
import type { BeatKind, BeatTag, Register } from './beats.js';

export interface Signature {
  id: string;
  /** template variants — same slot syntax as pools */
  text: string[];
  /** trigger: beat must match kind (when given), share ≥1 tag (when given), and reach minHeat */
  when: { kinds?: BeatKind[]; tags?: BeatTag[]; minHeat: number };
  /** hard per-game budget — a catchphrase stays an event, not a tic */
  perGame: number;
}

export interface VoicePack {
  id: string;
  displayName: string;
  role: 'pbp' | 'color';
  style: {
    /** 0..1 — how readily this voice cites tonight's numbers (FEEL dial) */
    statAffinity: number;
  };
  /**
   * template pools. Keys resolve most-specific-first:
   *   "<kind>.<variant>.<register>" → "<kind>.<variant>" → "<kind>.<register>" → "<kind>"
   * so a pack only writes the specificity it needs.
   */
  pools: Record<string, string[]>;
  signatures: Signature[];
  /** color voices: dead-ball talk pools (pregame/recap/clutch/ft_gap/…) */
  segments?: Record<string, string[]>;
}

/** slot values for one line — built by the booth per beat */
export type RenderContext = Record<string, string>;

/**
 * Fill `{slot}` tokens from ctx. Unknown slots are left VISIBLE (`{slot}`)
 * on purpose: a silently-emptied slot would hide a template/ctx mismatch,
 * and the test suite asserts no braces survive in a rendered script.
 */
export function fillSlots(template: string, ctx: RenderContext): string {
  return template.replace(/\{([a-zA-Z_]+)\}/g, (whole, key: string) => ctx[key] ?? whole);
}

/**
 * Deals lines from pools with two layers of repeat-avoidance:
 *  - per-pool memory (won't re-deal either of a pool's last two picks),
 *  - script-wide memory (won't render the exact same sentence twice within
 *    the trailing 30 cues — catches cross-pool collisions after slot fill).
 * Window sizes are FEEL: small enough to keep pools usable, large enough
 * that a reader stops noticing the loop.
 */
export class LineDealer {
  private recentByPool = new Map<string, number[]>();
  private recentSentences: string[] = [];
  private rng: Rng;
  constructor(rng: Rng) {
    this.rng = rng;
  }

  deal(poolKey: string, pool: string[], ctx: RenderContext): string {
    if (pool.length === 0) return '';
    let idx = this.rng.int(pool.length); // the ONLY rng draw in a deal
    const recent = this.recentByPool.get(poolKey) ?? [];
    const avoid = Math.min(2, pool.length - 1);
    for (let hops = 0; hops < pool.length && avoid > 0 && recent.slice(-avoid).includes(idx); hops++) {
      idx = (idx + 1) % pool.length;
    }
    let text = fillSlots(pool[idx]!, ctx);
    // cross-pool exact-sentence collision: bump within the pool (still no
    // extra rng draws) until the sentence is fresh or options are exhausted.
    for (let hops = 0; hops < pool.length - 1 && this.recentSentences.includes(text); hops++) {
      idx = (idx + 1) % pool.length;
      text = fillSlots(pool[idx]!, ctx);
    }
    recent.push(idx);
    if (recent.length > 2) recent.shift();
    this.recentByPool.set(poolKey, recent);
    this.recentSentences.push(text);
    if (this.recentSentences.length > 30) this.recentSentences.shift();
    return text;
  }
}

/** most-specific-first pool resolution (see VoicePack.pools docs) */
export function resolvePool(pack: VoicePack, kind: string, variant: string | null, register: Register): { key: string; pool: string[] } | null {
  const keys = variant
    ? [`${kind}.${variant}.${register}`, `${kind}.${variant}`, `${kind}.${register}`, kind]
    : [`${kind}.${register}`, kind];
  for (const key of keys) {
    const pool = pack.pools[key];
    if (pool && pool.length > 0) return { key: `${pack.id}:${key}`, pool };
  }
  return null;
}

// ---------------------------------------------------------------------------
// shared phrasing helpers (deterministic, no RNG)

export function mmss(clock: number): string {
  const m = Math.floor(clock / 60);
  const s = Math.floor(clock % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "the first" … "the fourth", "overtime", "double overtime", "triple overtime", then "OT4"… */
export function periodPhrase(period: number, totalPeriods: number): string {
  if (period > totalPeriods) {
    const ot = period - totalPeriods;
    if (ot === 1) return 'overtime';
    if (ot === 2) return 'double overtime';
    if (ot === 3) return 'triple overtime';
    return `OT${ot}`;
  }
  const names = ['the first', 'the second', 'the third', 'the fourth'];
  // halves rulesets (NCAA) read better as "the first half"
  if (totalPeriods === 2) return period === 1 ? 'the first half' : 'the second half';
  return names[period - 1] ?? `period ${period}`;
}

/** broadcast clock reference: "with 4:12 to go in the third", "under a minute in the fourth" */
export function clockPhrase(period: number, clock: number, totalPeriods: number): string {
  const p = periodPhrase(period, totalPeriods);
  if (clock <= 60) return `under a minute in ${p}`;
  if (clock <= 125) return `under two minutes in ${p}`;
  return `with ${mmss(clock)} to go in ${p}`;
}

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** "12-4" style run text from an unanswered run (opponent side always 0 here — see sense.ts run semantics) */
export function runText(run: number): string {
  return `${run}-0`;
}

/** minutes, rounded to the half: "four minutes", "three and a half minutes" */
export function minutesText(secs: number): string {
  const halves = Math.round(secs / 30);
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const w = whole <= 12 ? words[whole]! : String(whole);
  if (whole === 0) return 'the better part of a minute';
  return half ? `${w} and a half minutes` : `${w} minutes`;
}
