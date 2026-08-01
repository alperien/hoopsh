/**
 * Provenance metadata + serialization identity for the params surface (#36).
 *
 * PROVENANCE: issue #36 (split of sim/params.ts into per-block modules).
 * Motivated by AGENTS.md DO-NOT rule 1 — "do not tidy SWEPT values" was an
 * honor system enforced only by prose comments; the split moved provenance
 * into machine-readable per-block maps so it can be a test instead.
 *
 * Two guarantees:
 *
 * 1. Every knob on the composed SimParams surface carries a provenance tag
 *    (REAL / SWEPT / FEEL). The per-block `Record<keyof Block, Provenance>`
 *    types already enforce per-block completeness at compile time; the
 *    runtime walk below additionally proves the COMPOSITION is complete in
 *    both directions (no untagged leaf, no orphan tag) and that every leaf
 *    is a number — the flat-serializable shape withParams' merge relies on.
 *
 * 2. defaultParams serializes byte-identically to the pre-split monolith.
 *    JSON.stringify key order is insertion order, so byte-identical output
 *    implies deep equality AND field order — the order the sweep's dot-path
 *    registry and the golden fingerprint corpus both key on. The pinned
 *    length/hashes below were captured from the pre-split params.ts at
 *    46b0e318 (verified there against the live object before the split).
 *    Re-baseline them ONLY alongside a deliberate value change (a tune:/
 *    mechanics commit that re-ran calibration and says so); a pure refactor
 *    that moves these pins is wrong by definition — fix the refactor, do
 *    not re-baseline.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, paramProvenance } from '../src/sim/params.js';

const TAGS = ['REAL', 'SWEPT', 'FEEL'];

/** FNV-1a 32-bit over the string's code units (ASCII here) — dependency-free */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** djb2 32-bit — a second, independent pin so a collision would need to fool both */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('params provenance metadata (#36)', () => {
  it('tags every knob on the surface, and tags nothing that is not a knob', () => {
    const problems: string[] = [];
    let leaves = 0;
    const walk = (
      params: Record<string, unknown>,
      prov: Record<string, unknown>,
      prefix: string
    ): void => {
      const keys = new Set([...Object.keys(params), ...Object.keys(prov)]);
      for (const k of keys) {
        const path = prefix ? `${prefix}.${k}` : k;
        const v = params[k];
        const t = prov[k];
        if (v === undefined) {
          problems.push(`${path}: provenance entry has no matching knob`);
        } else if (typeof v === 'number') {
          leaves++;
          if (typeof t !== 'string' || !TAGS.includes(t)) {
            problems.push(`${path}: knob is not tagged REAL/SWEPT/FEEL (got ${String(t)})`);
          }
        } else if (v !== null && typeof v === 'object') {
          if (t === null || typeof t !== 'object') {
            problems.push(`${path}: block has no provenance map`);
          } else {
            walk(v as Record<string, unknown>, t as Record<string, unknown>, path);
          }
        } else {
          problems.push(`${path}: leaf is not a number (${typeof v}) — the surface must stay flat-serializable`);
        }
      }
    };
    walk(
      defaultParams as unknown as Record<string, unknown>,
      paramProvenance as unknown as Record<string, unknown>,
      ''
    );
    expect(problems).toEqual([]);
    expect(leaves).toBeGreaterThan(0);
  });

  it('serializes byte-identically to the pre-split surface', () => {
    const json = JSON.stringify(defaultParams);
    // Captured from the pre-split monolith at 46b0e318 — see the header for
    // the only sanctioned re-baseline condition.
    expect(json.length).toBe(10811);
    expect(fnv1a(json)).toBe('8b9de216');
    expect(djb2(json)).toBe('2c10715a');
    // serializability round trip: parse(stringify(x)) deep-equals x, so no
    // non-finite number (NaN/Infinity stringify to null) hides in a default
    expect(JSON.parse(json)).toEqual(defaultParams);
  });

  it('keeps the top-level field order consumers and the sweep registry key on', () => {
    expect(Object.keys(defaultParams).join(',')).toBe(
      'tickHz,frameEvery,shot,foul,pass,reb,decide,move,fatigue,sub,endgame,officiating,ai'
    );
  });
});
