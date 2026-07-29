/**
 * CLI flag parsing — pins the fix for a real silent-corruption incident:
 * `npm run broadcast -- --seed` (flag present, value forgotten) used to
 * simulate a game seeded with the literal string "undefined" and write
 * out/broadcast-undefined.txt without a word of complaint. See args.ts.
 */

import { describe, expect, it } from 'vitest';
import { flagValue, flagNumber } from '../src/args.js';

describe('harness CLI flag parsing', () => {
  it('returns the fallback when the flag is absent', () => {
    expect(flagValue(['node', 'x.ts'], '--seed', 'showcase-v2')).toBe('showcase-v2');
    expect(flagNumber(['node', 'x.ts'], '--games', 50)).toBe(50);
  });

  it('returns the value when the flag is present with one', () => {
    expect(flagValue(['node', 'x.ts', '--seed', 'my-seed'], '--seed', 'd')).toBe('my-seed');
    expect(flagNumber(['node', 'x.ts', '--games', '24'], '--games', 50)).toBe(24);
  });

  it('throws loudly on a bare flag at the end of the arguments (the incident)', () => {
    expect(() => flagValue(['node', 'x.ts', '--seed'], '--seed', 'showcase-v2'))
      .toThrow(/--seed requires a value/);
  });

  it('throws loudly when the "value" is actually the next flag', () => {
    expect(() => flagValue(['node', 'x.ts', '--seed', '--games'], '--seed', 'd'))
      .toThrow(/--seed requires a value/);
  });

  it('throws loudly on a non-numeric value for a numeric flag', () => {
    expect(() => flagNumber(['node', 'x.ts', '--games', 'lots'], '--games', 50))
      .toThrow(/finite number/);
  });

  it('accepts negative numbers (single dash is a value, not a flag)', () => {
    expect(flagNumber(['node', 'x.ts', '--offset', '-3'], '--offset', 0)).toBe(-3);
  });
});
