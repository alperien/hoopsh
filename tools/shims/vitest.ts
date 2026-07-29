/**
 * Minimal vitest-compatible shim backed by node:test + node:assert.
 * Lets the test suite run with zero installed dependencies.
 * Covers exactly the matchers the hoopsh suites use.
 *
 * Loaded in place of the real 'vitest' package by tools/hooks.mjs's bare-
 * specifier branch (the npm registry is firewalled, so there is no real
 * vitest to install). Test files import `describe`/`it`/`expect` from
 * 'vitest' exactly the way they would against the real package — nothing in
 * the suites themselves knows a shim is involved. `describe`/`it` are
 * straight re-exports of node:test's own primitives (their shapes already
 * match vitest's for the subset used here), so the only thing actually
 * shimmed below is the `expect(...).toX(...)` assertion surface, built on
 * node:util's isDeepStrictEqual rather than pulling in a real assertion
 * library.
 *
 * "Covers exactly the matchers the suites use" is deliberate, not lazy: this
 * is a shim to unblock a firewalled environment, not a vitest reimplementation
 * project. When npm access is available, `npm run test:vitest` (see
 * package.json) runs the SAME test files against the real vitest package,
 * unchanged — if a suite ever needs a matcher not implemented below, add it
 * here rather than working around its absence in a test.
 */

import { describe as nodeDescribe, it as nodeIt } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

export const describe = nodeDescribe;
export const it = nodeIt;

class Expectation {
  private readonly actual: unknown;
  private readonly negated: boolean;

  constructor(actual: unknown, negated = false) {
    this.actual = actual;
    this.negated = negated;
  }

  // `.not` returns a FRESH Expectation with the flag flipped rather than
  // mutating `this` — matches real vitest's `expect(x).not.toBe(y)` chaining
  // and keeps a single Expectation instance safely reusable across multiple
  // `.not`-prefixed assertions if a caller held onto the reference.
  get not(): Expectation {
    return new Expectation(this.actual, !this.negated);
  }

  // Every public matcher below funnels through here so negation and the
  // failure-message format only need to be right in one place.
  private assert(cond: boolean, message: string): void {
    const pass = this.negated ? !cond : cond;
    if (!pass) {
      throw new Error(`${this.negated ? 'NOT ' : ''}${message} — actual: ${safe(this.actual)}`);
    }
  }

  // Matcher MISUSE (wrong receiver type) throws unconditionally — it must NOT
  // route through assert(), because `.not` would flip the failure into a
  // silent pass. Real vitest raises a matcher error regardless of negation;
  // scan finding b7-F4 caught this shim letting `.not`-negated misuse pass.
  private raise(message: string): never {
    throw new Error(`${message} — actual: ${safe(this.actual)}`);
  }

  // Object.is, not ===: mirrors vitest/jest toBe semantics (distinguishes
  // +0/-0 and treats NaN as equal to itself, unlike ===) for identity/
  // primitive checks. Reach for toEqual below for structural comparison.
  toBe(expected: unknown): void {
    this.assert(Object.is(this.actual, expected), `expected toBe ${safe(expected)}`);
  }

  /** vitest-compat: actual must be a function; asserts it throws, optionally
   *  matching a string/RegExp against the error message */
  toThrow(pattern?: string | RegExp): void {
    if (typeof this.actual !== 'function') {
      // Unconditional: `expect(notAFunction).not.toThrow()` must error, not pass.
      this.raise('toThrow expects a function');
    }
    let threw = false;
    let message = '';
    try {
      (this.actual as () => unknown)();
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    if (!threw) {
      this.assert(false, `expected function to throw${pattern ? ` matching ${safe(pattern)}` : ''}`);
      return;
    }
    if (pattern !== undefined) {
      const ok = typeof pattern === 'string' ? message.includes(pattern) : pattern.test(message);
      this.assert(ok, `expected thrown message ${safe(message)} to match ${safe(pattern)}`);
    } else {
      this.assert(true, '');
    }
  }

  // Deep structural equality (objects/arrays compared by contents, not
  // reference) — this is the one the suites reach for when comparing event
  // arrays or frame rows, where two separately-built values need to match
  // value-for-value rather than be the same object.
  toEqual(expected: unknown): void {
    this.assert(isDeepStrictEqual(this.actual, expected), `expected toEqual ${safe(expected)}`);
  }

  // The comparison family mirrors vitest: the receiver must be a number or
  // bigint. Without the guard, JS coercion lets `expect('9').toBeGreaterThan(8)`
  // pass (and string-vs-string would compare lexicographically) — a silent
  // weakening real vitest refuses with a matcher error (b7-F4).
  private compareNumeric(op: (a: number, b: number) => boolean, x: number, label: string): void {
    if (typeof this.actual !== 'number' && typeof this.actual !== 'bigint') {
      this.raise(`${label} expects a number or bigint receiver`);
    }
    this.assert(op(this.actual as number, x), `expected ${label} ${x}`);
  }

  toBeGreaterThan(x: number): void {
    this.compareNumeric((a, b) => a > b, x, '>');
  }

  toBeGreaterThanOrEqual(x: number): void {
    this.compareNumeric((a, b) => a >= b, x, '>=');
  }

  toBeLessThan(x: number): void {
    this.compareNumeric((a, b) => a < b, x, '<');
  }

  toBeLessThanOrEqual(x: number): void {
    this.compareNumeric((a, b) => a <= b, x, '<=');
  }

  // Dual-mode like vitest's real toContain: substring check for strings,
  // element-membership (SameValueZero, not deep equality) for arrays and any
  // other iterable (Set, Map — vitest/jest check real membership there too).
  // A non-iterable receiver raises unconditionally: before this guard,
  // `.not.toContain(x)` on a plain object passed vacuously (b7-F4).
  toContain(item: unknown): void {
    const a = this.actual;
    let contains: boolean;
    if (typeof a === 'string') {
      contains = a.includes(String(item));
    } else if (Array.isArray(a)) {
      contains = a.includes(item);
    } else if (a != null && typeof (a as Iterable<unknown>)[Symbol.iterator] === 'function') {
      contains = [...(a as Iterable<unknown>)].includes(item);
    } else {
      this.raise('toContain expects a string or iterable receiver');
    }
    this.assert(contains, `expected toContain ${safe(item)}`);
  }

  toBeTruthy(): void {
    this.assert(Boolean(this.actual), 'expected truthy value');
  }
}

// Failure-message formatter: JSON-stringifies the value being asserted on so
// error output is readable, but caps it at 200 chars so a failing assertion
// on a full replay/frame array doesn't dump megabytes into the test log. The
// try/catch exists because JSON.stringify throws on circular references or
// BigInt — falling back to String(x) trades a crash for a possibly-unhelpful
// message, which is the right tradeoff for a test failure path.
function safe(x: unknown): string {
  try {
    const s = JSON.stringify(x);
    return s && s.length > 200 ? s.slice(0, 200) + '…' : String(s);
  } catch {
    return String(x);
  }
}

export function expect(actual: unknown): Expectation {
  return new Expectation(actual);
}
