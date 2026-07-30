/**
 * CLI flag parsing — pins the fix for a real silent-corruption incident:
 * `npm run broadcast -- --seed` (flag present, value forgotten) used to
 * simulate a game seeded with the literal string "undefined" and write
 * out/broadcast-undefined.txt without a word of complaint. See args.ts.
 */

import { describe, expect, it } from 'vitest';
import { checkFlags, flagValue, flagNumber } from '../src/args.js';

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

  // audit H-03: `--seed=zzz` matched no exact token, so every harness CLI
  // silently ran its DEFAULT seed; repeats silently took the first value.
  it('rejects the --flag=value spelling with the space-separated form suggested (H-03)', () => {
    expect(() => flagValue(['node', 'x.ts', '--seed=zzz'], '--seed', 'd'))
      .toThrow(/--seed zzz/);
    expect(() => flagNumber(['node', 'x.ts', '--games=3'], '--games', 50))
      .toThrow(/--games 3/);
  });

  it('rejects a repeated flag instead of silently taking the first (H-03)', () => {
    expect(() => flagNumber(['node', 'x.ts', '--games', '2', '--games', '7'], '--games', 50))
      .toThrow(/more than once/);
  });
});

describe('checkFlags — per-CLI flag vocabulary (H-03)', () => {
  const KNOWN = ['--seed', '--games', '--league'];

  it('accepts a clean argv (values, negative numbers, and known flags pass)', () => {
    expect(() => checkFlags(['node', 'x.ts', '--seed', 'abc', '--games', '24'], KNOWN)).not.toThrow();
    expect(() => checkFlags(['node', 'x.ts', '--games', '-3'], KNOWN)).not.toThrow();
    expect(() => checkFlags(['node', 'x.ts'], KNOWN)).not.toThrow();
  });

  it('rejects an unknown flag with a nearest-match hint (the --leage incident)', () => {
    expect(() => checkFlags(['node', 'x.ts', '--leage', 'ncaa'], KNOWN))
      .toThrow(/unknown flag --leage.*did you mean --league/);
  });

  it('rejects an unknown flag with no close match by listing the vocabulary', () => {
    expect(() => checkFlags(['node', 'x.ts', '--bogus'], KNOWN))
      .toThrow(/unknown flag --bogus.*this CLI takes: --seed --games --league/);
  });

  it('rejects the = spelling even on a known flag', () => {
    expect(() => checkFlags(['node', 'x.ts', '--seed=zzz'], KNOWN))
      .toThrow(/--seed zzz/);
  });

  it('rejects repeated flags', () => {
    expect(() => checkFlags(['node', 'x.ts', '--games', '2', '--games', '7'], KNOWN))
      .toThrow(/passed 2 times/);
  });
});
