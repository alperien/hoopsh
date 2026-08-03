/**
 * Verification-rung config pin — the rung's sample size has ONE home, and
 * every document that quotes it quotes that home.
 *
 * The rung is `npm run sweep -- --iters 0 --verify N`: AGENTS.md §4.2's
 * three-seed band verification, and the only sweep mode whose exit code is a
 * verdict (sweep.ts's M-24 note). N moved 40 -> 160 at issue #266, on the
 * #222 adjudication's measurement: the seed-fixed first 40-game window of the
 * `-verify` bases draws astdShare 1.01 sd below the 160-game center (59.32%
 * over games 0-39 vs 60.09% over 0-159, against a 59.8% floor), so the rung
 * reddened on every run against an in-band league and no re-run could clear
 * it. A deterministic false red is worse than no gate: it trains readers to
 * ignore the one output that is supposed to stop a merge.
 *
 * Two failure modes this file exists to catch, both of which the suite was
 * blind to before:
 *
 *  1. THE NUMBER DRIFTS APART. Nine live surfaces quote the rung. Nothing
 *     tied them to sweep.ts's own default, so a future re-size could land in
 *     the code and leave AGENTS.md, the PR template, and the issue form
 *     instructing readers to run a different sample than the gate runs. The
 *     doc assertions below derive their expected N from sweep.ts rather than
 *     restating it, so there is exactly one number to change and eight that
 *     must follow.
 *
 *  2. THE VERDICT SOFTENS. The rung's contract is ANY-FAIL: one band-fail on
 *     one seed base exits nonzero. Raising the sample size makes a ratchet
 *     floor ("red only past K fails", the shape batch.ts uses) look like a
 *     natural companion change; it is not, and #266 rejected it explicitly.
 *     The condition is pinned below in normalized source form so the swap
 *     cannot land silently.
 *
 * Source-text assertions rather than imports, deliberately: sweep.ts runs
 * main() on import and cannot be loaded side-effect-free (the same constraint
 * cli-flag-guard.test.ts documents for broadcast-demo.ts), and reading the
 * default at runtime would cost a full search budget. Every extraction below
 * goes through must(), which throws when its pattern misses — a reworded
 * source must break this gate visibly, never drain it silently.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

/** Loud extraction: a missed pattern is a failure, not an empty result. The
 *  message says how to re-point the pin when the rewording was deliberate. */
function must(src: string, re: RegExp, what: string): RegExpMatchArray {
  const m = src.match(re);
  if (!m) {
    throw new Error(
      `extraction failed — ${what}: pattern ${re} matched nothing. ` +
      `If the source was deliberately reworded, re-anchor this pin.`);
  }
  return m;
}

const sweepSrc = read('packages/harness/src/sweep.ts');

/** The rung's sample size, read from its one home: the --verify flag default. */
const VERIFY_DEFAULT = Number(
  must(sweepSrc, /flagNumber\(process\.argv, '--verify', (\d+)\)/,
    "sweep.ts's --verify default")[1]);

/**
 * Live surfaces that INSTRUCT a reader to run the rung. Each must quote the
 * current sample size, because a reader following them is expected to produce
 * a number comparable to the gate's.
 *
 * docs/BIBLE.md is included even though it is generated: it is the file an
 * agent is handed as a context pack, so a stale Bible teaches the old number.
 * AGENTS.md §5 already requires regenerating it in the same commit as a
 * source-doc edit; this makes forgetting local and fast rather than a CI-only
 * catch.
 *
 * realism.test.ts is in the list for the same reason a document is: its
 * header points a reader at the rung as the fine-grained lock behind the
 * tripwire, and a stale size there sends them to the wrong instrument.
 */
const RUNG_INSTRUCTION_SURFACES = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  'README.md',
  'docs/PLAYBOOK.md',
  'docs/CHECKLISTS.md',
  'docs/CALIBRATION.md',
  'docs/BIBLE.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/calibration-finding.yml',
  'packages/harness/test/realism.test.ts'
];

/**
 * Surfaces deliberately NOT pinned: they cite a measurement TAKEN at the
 * sample size of its day. Re-writing `--verify 40` to `--verify 160` in a
 * register row or an era history would falsify the record of what was
 * actually run. Their contents are unconstrained here; only their existence
 * is asserted, so this exclusion can never quietly become a typo'd path that
 * excludes nothing.
 */
const HISTORICAL_CITATIONS = [
  'docs/REGISTER.md',
  'docs/history/calibration-eras.md'
];

/** Every `npm run sweep … --verify N` invocation quoted in a document. */
function quotedVerifySizes(src: string): number[] {
  return [...src.matchAll(/npm run sweep[^\n`]*--verify\s+(\d+)/g)]
    .map((m) => Number(m[1]));
}

describe('sweep verification rung — sample size has one home (#266)', () => {
  it('sweep.ts defaults --verify to 160 games per seed base', () => {
    // 160 is the adjudicated size: fresh-draw false-red rate ~69% -> ~45%,
    // detection power for a real -1pp astdShare center regression >=0.98
    // (both measured at the #222 adjudication). Changing this number is a
    // calibration-instrument decision, not a tuning knob — re-measure both
    // directions before moving it.
    expect(VERIFY_DEFAULT).toBe(160);
  });

  it('every document that instructs the rung quotes that same size', () => {
    for (const rel of RUNG_INSTRUCTION_SURFACES) {
      const src = read(rel);
      must(src, /npm run sweep[^\n`]*--verify\s+\d+/,
        `${rel} quotes no sweep --verify invocation`);
      for (const n of quotedVerifySizes(src)) {
        expect(`${rel}: --verify ${n}`).toBe(`${rel}: --verify ${VERIFY_DEFAULT}`);
      }
    }
  });

  it('leaves historical citations of the old size alone', () => {
    for (const rel of HISTORICAL_CITATIONS) {
      expect(`${rel} exists: ${existsSync(join(REPO, rel))}`).toBe(`${rel} exists: true`);
    }
  });
});

describe('sweep verification rung — the verdict stays any-fail (#266)', () => {
  it('exits nonzero on the FIRST band-fail, with no ratchet floor', () => {
    // Whitespace-normalized so reflowing the condition across lines does not
    // break the pin, while the comparison itself stays exact: `> 0` is the
    // any-fail contract. A floor (`> 16`, batch.ts's shape) would let a
    // failing verification report green, which is the exact regression
    // audit M-24 fixed and #266 re-affirmed when it rejected adopting
    // batch's ratchet semantics alongside the larger sample.
    const normalized = sweepSrc.replace(/\s+/g, ' ');
    must(normalized,
      /if \(ITERS === 0 && failCount\(verify\.seedResults\) > 0\) \{/,
      'the verify-rung exit condition');
    // and nothing else in the file compares that fail count to a floor
    expect(/failCount\([^)]*\) > [1-9]/.test(normalized)).toBe(false);
  });
});
