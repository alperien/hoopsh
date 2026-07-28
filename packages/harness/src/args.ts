/**
 * Shared CLI flag parsing for harness scripts; loud on malformed input.
 *
 * Exists because of a real silent-corruption incident: broadcast-demo.ts read
 * `--seed`'s value with a bare non-null assertion, so `npm run broadcast --
 * --seed` (flag given, value forgotten) silently simulated a game seeded with
 * the literal string "undefined" and wrote out/broadcast-undefined.txt. No
 * crash, no warning. In a determinism-first project, a seed that isn't what
 * the caller thinks it is must fail loudly, not quietly produce a plausible-
 * looking game (review finding #3).
 */

/** value of `flag`, or `fallback` when the flag is absent; throws when the
 *  flag is present but its value is missing or is the next flag */
export function flagValue(argv: readonly string[], flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(
      `${flag} requires a value (got ${v === undefined ? 'end of arguments' : `"${v}"`}) — ` +
      `omit the flag entirely to use the default "${fallback}"`
    );
  }
  return v;
}

/** numeric variant of flagValue; additionally throws on a non-numeric value
 *  (Number("--seed") is NaN, and a NaN game count silently runs zero games) */
export function flagNumber(argv: readonly string[], flag: string, fallback: number): number {
  const raw = flagValue(argv, flag, String(fallback));
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${flag} requires a finite number, got "${raw}"`);
  }
  return n;
}
