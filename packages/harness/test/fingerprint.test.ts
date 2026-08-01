/**
 * In-suite twin of the golden fingerprint corpus's flag-off entry (audit
 * H-04), freshness-conditioned since issue #33.
 *
 * THE LEAK CLASS THIS CATCHES: a change that leaks behavior into the
 * `endgame: false` legacy path — a byte-identity CONTRACT (GameConfig.endgame
 * doc, sim/endgame.ts header). Audit mutation M16 (the endgame continuation
 * reshape applied unconditionally, i.e. the `if (s.endgame)` gate at
 * ai/decide.ts dropped) kept all 341 then-current tests green while the
 * flag-off stream's sha changed and the game's WINNER flipped. This file
 * makes `npm test` alone catch that class: it re-simulates the corpus's
 * `flagoff-legacy-0` entry and compares the same sha256 digests the corpus
 * stores.
 *
 * FRESHNESS CONDITION (issue #33): the golden corpus stopped being a
 * gameplay-regression gate — a deliberate rng-order change may land WITHOUT
 * regenerating the golden file, so the committed corpus may lag the engine.
 * An unconditional byte compare would then fail on every later commit. So
 * this suite first re-simulates a default-config anchor entry (`ci-fp`):
 *
 *   - anchor MATCHES the corpus → the corpus is fresh for the current
 *     engine, and the flag-off entry must match byte-for-byte. A
 *     flag-off-only divergence is a leak into the legacy path (a shared-path
 *     change would have moved the anchor too) — exactly the M16 class.
 *   - anchor MISMATCHES → a deliberate rng/behavior change landed without a
 *     regen (allowed post-#33); the byte compare is inconclusive and is
 *     skipped with a printed notice. The existence checks below still run.
 *     The guard re-arms at the next `npm run fingerprint:write`.
 *
 * RESIDUAL BLINDNESS (stated, not hidden): a single commit that both moves
 * default-path streams AND leaks into the flag-off path skips the compare
 * here. The pre-#33 regime was equally blind to that commit — its forced
 * same-commit regen baked the leaked flag-off stream into the new golden.
 * Coverage for that corner is the pure-refactor tier's before/after
 * byte-identity assertion (`npm run fingerprint` against a fresh base) and
 * review of regen diffs. The same blindness covers the whole stale WINDOW:
 * any flag-off leak landing between an unregen'd rng-order change and the
 * next `fingerprint:write` is invisible here, and that regen bakes it into
 * the new golden. Regen commits are re-arming events; review them as the
 * moment the flag-off contract is re-accepted.
 *
 * MAINTENANCE: the two simulated configs below MUST mirror fingerprint.ts's
 * corpus entries — `ci-fp` (no flip, default config) and `flagoff-legacy-0`
 * (no flip, frames on, endgame: false). If the entries drift, the hash
 * compares fail loudly when the corpus is fresh — drift cannot pass silently.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.resolve(HERE, '..', 'golden', 'fingerprints.json');

interface SeedFingerprint {
  events: string;
  frames: string;
  finalScore: [number, number];
}

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, SeedFingerprint>;

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * Re-simulate one corpus entry exactly as fingerprint.ts builds it. Both
 * entries this suite uses have flip: false, so home/away arrive unflipped.
 * The spread-omit mirrors the corpus discipline: the anchor passes NO
 * endgame key (engine default), the flag-off entry passes explicit false.
 */
function fingerprintOf(seed: string, config: { endgame?: boolean } = {}): SeedFingerprint {
  const { home, away } = sampleMatchup();
  const r = simulateGame({
    seed,
    home,
    away,
    collectFrames: true,
    ...(config.endgame === undefined ? {} : { endgame: config.endgame })
  });
  return {
    events: sha256(JSON.stringify(r.events)),
    frames: sha256(JSON.stringify(r.frames)),
    finalScore: r.finalScore
  };
}

const matches = (a: SeedFingerprint, b: SeedFingerprint): boolean =>
  a.events === b.events && a.frames === b.frames &&
  a.finalScore[0] === b.finalScore[0] && a.finalScore[1] === b.finalScore[1];

describe('golden corpus coverage (H-04): the non-default-config entries exist', () => {
  it('the corpus pins flag-off, NCAA, and EuroLeague entries — not just default-config games', () => {
    // existence guard: a corpus regen that silently drops the H-04 entries
    // (e.g. reverting fingerprint.ts's entry table) reopens the audit hole
    for (const key of ['flagoff-legacy-0', 'flagoff-legacy-1', 'ncaa-0', 'euro-0']) {
      expect(Object.keys(golden)).toContain(key);
    }
    expect(Object.keys(golden).length).toBeGreaterThanOrEqual(28);
  });
});

describe('endgame:false byte-identity (H-04 in-suite guard, freshness-conditioned per #33)', () => {
  it('the flag-off stream may not diverge from the corpus alone', () => {
    const pinnedAnchor = golden['ci-fp']!;
    expect(pinnedAnchor).toBeTruthy();
    const anchor = fingerprintOf('ci-fp');
    if (!matches(anchor, pinnedAnchor)) {
      // A deliberate rng/behavior change landed without a corpus regen —
      // allowed since #33; the flag-off compare cannot distinguish that from
      // a leak, so it abstains. If YOUR change was supposed to be
      // behavior-preserving, treat this notice as the failure signal and run
      // `npm run fingerprint` for the per-seed diff.
      console.warn(
        '[fingerprint.test] corpus is stale vs the current engine (anchor ci-fp mismatch) — ' +
        'flag-off byte compare skipped; re-arm via `npm run fingerprint:write` at a clean base'
      );
      return;
    }
    const r = fingerprintOf('flagoff-legacy-0', { endgame: false });
    const pinned = golden['flagoff-legacy-0']!;
    expect(pinned).toBeTruthy();
    // events first: the event stream is the consumer contract, so a leak
    // shows here even when it never moves a frame; frames second catch the
    // dead-ball/FT-ritual positioning class only frames can see
    expect(r.events).toBe(pinned.events);
    expect(r.frames).toBe(pinned.frames);
    expect(r.finalScore).toEqual(pinned.finalScore);
  });
});
