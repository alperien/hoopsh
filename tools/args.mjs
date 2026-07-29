/**
 * Shared CLI flag parsing for tools/*.mjs — loud on malformed input.
 *
 * Plain-node mirror of packages/harness/src/args.ts (same names, same
 * semantics). The tools run without the TS register hook, so they cannot
 * import the harness module — and each had grown its own silent local
 * reader instead: `--flag` with a forgotten value fell back to the default
 * with no warning, the exact silent-seed incident class args.ts's header
 * records. Keep the two files in lockstep; args.ts is the canonical doc.
 *
 * One tools-only addition: a `null`/`undefined` fallback is legal here
 * (fetch/parse-nba use null for "flag not given"), and the error hint
 * adapts instead of advertising a default of "null".
 */

/** value of `flag`, or `fallback` when the flag is absent; throws when the
 *  flag is PRESENT but its value is missing or is the next flag */
export function flagValue(argv, flag, fallback) {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    const got = v === undefined ? 'end of arguments' : `"${v}"`;
    const hint = fallback == null
      ? 'omit the flag entirely to skip it'
      : `omit the flag entirely to use the default "${fallback}"`;
    throw new Error(`${flag} requires a value (got ${got}) — ${hint}`);
  }
  return v;
}

/** numeric variant of flagValue; additionally throws on a non-numeric value
 *  (Number("--seed") is NaN, and a NaN game count silently runs zero games) */
export function flagNumber(argv, flag, fallback) {
  const raw = flagValue(argv, flag, String(fallback));
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${flag} requires a finite number, got "${raw}"`);
  }
  return n;
}
