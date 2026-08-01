/**
 * Provenance metadata + serialization identity for the params surface (#36).
 *
 * PROVENANCE: issue #36 (split of sim/params.ts into per-block modules).
 * Motivated by AGENTS.md DO-NOT rule 1 — "do not tidy SWEPT values" was an
 * honor system enforced only by prose comments; the split moved provenance
 * into machine-readable per-block maps so it can be a test instead.
 *
 * Four guarantees:
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
 *
 * 3. The provenance record ITSELF serializes to a pinned byte string. The
 *    maps are the machine-checkable half of DO-NOT rule 1, and until the
 *    PR #49 red-team probe (finding F3) nothing guarded the record: a diff
 *    flipping every SWEPT tag to FEEL left this suite green while licensing
 *    every "tidy" the rule exists to prevent. Same pin scheme as guarantee
 *    2, and the same re-baseline doctrine with the condition adapted: the
 *    only sanctioned re-baseline is a commit that re-adjudicates a tag or
 *    changes the knob surface AND names the knob and the evidence in its
 *    message — a refactor or cleanup that moves this pin is wrong by
 *    definition.
 *
 * 4. Sweep-registered knobs (harness/src/knobs.ts SWEEPABLE) tagged FEEL
 *    form a documented, closed exception list. Registration hands the
 *    optimizer ownership of a path; FEEL says the shipped value is
 *    hand-set. Both at once is coherent only while no landed sweep output
 *    has moved the value (params.provenance.ts adjudication: a registered
 *    knob whose current value the sweep chose is SWEPT even where older
 *    prose says FEEL). The test fails on any registered FEEL knob missing
 *    from the list and on any stale exception, so a re-tag in either
 *    direction is forced through this file's record.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, paramProvenance } from '../src/sim/params.js';
// The registry import crosses into harness deliberately: guarantee 4 is a
// cross-check BETWEEN the two records (the engine's tags, the harness's
// sweep surface) and this file is where the DO-NOT-1 guards live. knobs.ts
// imports nothing, so nothing of the harness rides in behind it.
import { SWEEPABLE } from '../../harness/src/knobs.js';

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
    // Captured from the pre-split monolith at 46b0e318; re-baselined at #74
    // increment 1 (ai.transCarryScale joined the surface — the sanctioned
    // condition: a knob-surface change that names its knob). See the header
    // for the re-baseline doctrine.
    expect(json.length).toBe(10831);
    expect(fnv1a(json)).toBe('26b56df5');
    expect(djb2(json)).toBe('39b864a5');
    // serializability round trip: parse(stringify(x)) deep-equals x, so no
    // non-finite number (NaN/Infinity stringify to null) hides in a default
    expect(JSON.parse(json)).toEqual(defaultParams);
  });

  it('pins the provenance record itself — the guard of DO-NOT rule 1 is guarded (#49 F3)', () => {
    const json = JSON.stringify(paramProvenance);
    // Captured from the amended record on refactor/params-split (#49),
    // re-baselined at #74 increment 1: 479 tags = 43 SWEPT / 89 REAL /
    // 347 FEEL (ai.transCarryScale FEEL — the knob-surface change named
    // per guarantee 3). Re-baseline ONLY per guarantee 3 in the header: a
    // commit that re-adjudicates a named tag or changes the knob surface,
    // and says so — never a refactor/cleanup.
    expect(json.length).toBe(11973);
    expect(fnv1a(json)).toBe('9c7a0069');
    expect(djb2(json)).toBe('4b7fd22f');
    // same shape discipline as the params surface: pure string leaves,
    // so the record round-trips losslessly
    expect(JSON.parse(json)).toEqual(paramProvenance);
  });

  it('every sweep-registered knob tagged FEEL is a documented exception (#49 F3)', () => {
    // Guarantee 4 (header). One justification line each, sourced from the
    // knob's own comment; an entry leaves this list the moment a landed
    // sweep moves its value (the tag flips to SWEPT and the stale-exception
    // branch below fails until the row is removed).
    const SWEEP_FEEL_EXCEPTIONS: Record<string, string> = {
      'ai.swingBase':
        '0.045 IS the hand-set Stage-2 doctrine cap (hot-potato incident, knobs.ts) — sweeps pin AT the cap; none chose the value',
      'ai.contestBrakeBase':
        'hand-set utility-layer decision weight (0.3, its own lo rail); registered for fine centering, no landed sweep has moved it',
      'ai.crashBase':
        'hand-set crash-rate base (0.15, its own lo rail); registered for fine centering, no landed sweep has moved it',
      'ai.crashScatterFt':
        'audit H-01 hoist of an inline ai/offense.ts literal; hand-set carom-zone geometry, registered but not yet swept',
      'ai.cutRateScale':
        'hand-set per-tick cut chance (0.003, its own lo rail); registered for fine centering, no landed sweep has moved it',
      'ai.scorePressureScale':
        '1.0 by definition at introduction (params.ai.ts) — registered for the flag-on coordinated re-sweep, not yet swept',
      'ai.transCarryScale':
        'staged at 0 (#74 increment 1); the landing dose is FEEL by the increment doctrine — registered so the coordinated re-sweep can trade it, no landed sweep has moved it',
      'reb.putbackRadiusFt':
        "audit H-01 hoist of the inline possession.ts 6 ft radius (mutation-proven anchor); putbackChance's registered companion, not yet swept"
    };
    const tagAt = (path: string): unknown => {
      let cur: unknown = paramProvenance;
      for (const p of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[p];
      return cur;
    };
    const problems: string[] = [];
    for (const k of SWEEPABLE) {
      if (tagAt(k.path) === 'FEEL' && SWEEP_FEEL_EXCEPTIONS[k.path] === undefined) {
        problems.push(
          `${k.path}: sweep-registered and tagged FEEL but not excepted — either the tag is wrong ` +
            `(registered + optimizer-chosen value = SWEPT, params.provenance.ts) or document the exception here`
        );
      }
    }
    // the list stays honest in the other direction too: an exception that
    // no longer names a registered FEEL knob is stale and must leave
    for (const path of Object.keys(SWEEP_FEEL_EXCEPTIONS)) {
      if (!SWEEPABLE.some((k) => k.path === path)) {
        problems.push(`${path}: excepted but not in SWEEPABLE — stale exception`);
      } else if (tagAt(path) !== 'FEEL') {
        problems.push(`${path}: excepted but tagged ${String(tagAt(path))} — stale exception`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps the top-level field order consumers and the sweep registry key on', () => {
    expect(Object.keys(defaultParams).join(',')).toBe(
      'tickHz,frameEvery,shot,foul,pass,reb,decide,move,fatigue,sub,endgame,officiating,ai'
    );
  });
});
