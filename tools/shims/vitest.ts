/**
 * Minimal vitest-compatible shim backed by node:test + node:assert.
 * Lets the test suite run with zero installed dependencies.
 * Covers exactly the matchers the hoopsh suites use.
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

  get not(): Expectation {
    return new Expectation(this.actual, !this.negated);
  }

  private assert(cond: boolean, message: string): void {
    const pass = this.negated ? !cond : cond;
    if (!pass) {
      throw new Error(`${this.negated ? 'NOT ' : ''}${message} — actual: ${safe(this.actual)}`);
    }
  }

  toBe(expected: unknown): void {
    this.assert(Object.is(this.actual, expected), `expected toBe ${safe(expected)}`);
  }

  toEqual(expected: unknown): void {
    this.assert(isDeepStrictEqual(this.actual, expected), `expected toEqual ${safe(expected)}`);
  }

  toBeGreaterThan(x: number): void {
    this.assert((this.actual as number) > x, `expected > ${x}`);
  }

  toBeGreaterThanOrEqual(x: number): void {
    this.assert((this.actual as number) >= x, `expected >= ${x}`);
  }

  toBeLessThan(x: number): void {
    this.assert((this.actual as number) < x, `expected < ${x}`);
  }

  toBeLessThanOrEqual(x: number): void {
    this.assert((this.actual as number) <= x, `expected <= ${x}`);
  }

  toContain(item: unknown): void {
    const a = this.actual;
    const contains = typeof a === 'string'
      ? a.includes(String(item))
      : Array.isArray(a) && a.includes(item);
    this.assert(contains, `expected toContain ${safe(item)}`);
  }

  toBeTruthy(): void {
    this.assert(Boolean(this.actual), 'expected truthy value');
  }
}

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
