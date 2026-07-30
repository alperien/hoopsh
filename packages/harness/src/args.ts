/**
 * Shared CLI flag parsing for harness scripts — loud on malformed input.
 *
 * Exists because of a real silent-corruption incident: broadcast-demo.ts read
 * `--seed`'s value with a bare non-null assertion, so `npm run broadcast --
 * --seed` (flag given, value forgotten) silently simulated a game seeded with
 * the literal string "undefined" and wrote out/broadcast-undefined.txt. No
 * crash, no warning — in a determinism-first project, a seed that isn't what
 * the caller thinks it is must fail loudly, not quietly produce a plausible-
 * looking game (review finding #3).
 *
 * THE FLAG GRAMMAR, stated as policy (audit H-03 — the second silent-input
 * incident class this file closes):
 *   - flags take SPACE-SEPARATED values only. `--seed=zzz` is REJECTED with
 *     the canonical spelling suggested, never accepted: the exact-token
 *     contract (argv.indexOf) is what makes flagValue's other guarantees
 *     checkable, and one canonical spelling keeps run transcripts greppable.
 *     Before this, `--seed=zzz` matched nothing and the DEFAULT seed ran
 *     silently.
 *   - a REPEATED flag is an error. The old parser took the first occurrence
 *     and silently discarded the rest (`--games 2 --games 7` ran 2); there
 *     is no right answer to guess, so we don't.
 *   - every CLI declares its flag vocabulary and rejects unknown `--` tokens
 *     via checkFlags below. Before this, a typo'd flag (`--leage ncaa`) was
 *     invisible and the run silently used every default.
 */

/** value of `flag`, or `fallback` when the flag is absent; throws when the
 *  flag is PRESENT but its value is missing or is the next flag, when it is
 *  passed more than once, or when it is spelled `--flag=value` */
export function flagValue(argv: readonly string[], flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  if (i === -1) {
    // `--seed=zzz` matches no exact token, so before this scan the DEFAULT
    // seed ran without a word (audit H-03). Reject the `=` spelling even
    // when the caller skipped checkFlags — the parser itself owns the policy.
    const eq = argv.find((a) => a.startsWith(`${flag}=`));
    if (eq !== undefined) {
      throw new Error(
        `${flag} does not take "=" — did you mean "${flag} ${eq.slice(flag.length + 1)}"? (flags take space-separated values here)`
      );
    }
    return fallback;
  }
  // repeated-flag semantics are ERROR (H-03): the old parser silently took
  // the first occurrence, so `--games 2 --games 7` ran 2 with no warning
  if (argv.indexOf(flag, i + 1) !== -1) {
    throw new Error(`${flag} is passed more than once — there is no right occurrence to guess; pass it exactly once`);
  }
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

/**
 * Validate the whole `--` surface of argv against a CLI's declared flag
 * vocabulary (`known` — every flag the CLI reads, value-taking and boolean
 * alike). Call it once at CLI startup, on the SAME array the flag reads use.
 *
 * Rejects, loudly (audit H-03 — each of these was previously silent):
 *   - unknown flags, with a nearest-match hint (`--leage` used to grade the
 *     NBA default without a word);
 *   - `--flag=value` spellings, with the space-separated form suggested;
 *   - repeated flags (also enforced per-read in flagValue).
 *
 * Only tokens starting with `--` are inspected: a value can never start with
 * `--` (flagValue rejects that), so everything else — including negative
 * numbers like `-3` — is a value and none of this function's business.
 */
export function checkFlags(argv: readonly string[], known: readonly string[]): void {
  const counts = new Map<string, number>();
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const name = eq === -1 ? a : a.slice(0, eq);
    if (!known.includes(name)) {
      const hint = nearestFlag(name, known);
      throw new Error(
        `unknown flag ${name}${hint ? ` — did you mean ${hint}?` : ''} (this CLI takes: ${known.join(' ')})`
      );
    }
    if (eq !== -1) {
      throw new Error(
        `${name} does not take "=" — did you mean "${name} ${a.slice(eq + 1)}"? (flags take space-separated values here)`
      );
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name, n] of counts) {
    if (n > 1) {
      throw new Error(`${name} is passed ${n} times — there is no right occurrence to guess; pass it exactly once`);
    }
  }
}

/** nearest known flag by edit distance, or null when nothing is close enough
 *  to be a plausible typo (distance <= 2, the classic did-you-mean cutoff) */
function nearestFlag(name: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestD = 3; // strictly-less wins, so only distances <= 2 suggest
  for (const k of known) {
    const d = editDistance(name, k);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** plain Levenshtein distance — vocabularies are ~10 flags of ~8 chars, so
 *  the O(a·b) matrix is microscopic and clarity beats cleverness */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[] = Array.from({ length: rows * cols }, () => 0);
  for (let i = 0; i < rows; i++) d[i * cols] = i;
  for (let j = 0; j < cols; j++) d[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i * cols + j] = Math.min(
        d[(i - 1) * cols + j]! + 1,        // deletion
        d[i * cols + (j - 1)]! + 1,        // insertion
        d[(i - 1) * cols + (j - 1)]! + sub // substitution
      );
    }
  }
  return d[rows * cols - 1]!;
}
