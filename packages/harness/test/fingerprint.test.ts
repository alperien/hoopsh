/**
 * In-suite twin of the golden fingerprint corpus's flag-off entry (audit
 * H-04). The corpus (`npm run fingerprint`) runs only in CI, so a change
 * that leaks behavior into the `endgame: false` legacy path — a byte-
 * identity CONTRACT (GameConfig.endgame doc, sim/endgame.ts header) — could
 * land locally with `npm test` fully green: audit mutation M16 (the endgame
 * continuation reshape applied unconditionally, i.e. the `if (s.endgame)`
 * gate at ai/decide.ts dropped) kept all 341 then-current tests green while
 * the flag-off stream's sha changed and the game's WINNER flipped. This
 * file makes `npm test` alone catch that class: it re-simulates the
 * corpus's `flagoff-legacy-0` entry and compares the same sha256 digests
 * the corpus stores.
 *
 * MAINTENANCE: any deliberate rng/behavior change re-baselines the corpus
 * (`npm run fingerprint:write`) — this test reads the regenerated golden
 * file, so it self-heals in the same commit and never needs a hand-updated
 * hash. What it can NEVER do is go green while the committed golden file
 * and the flag-off engine path disagree.
 *
 * The simulated config below MUST mirror fingerprint.ts's
 * `flagoff-legacy-0` corpus entry (seed, no home/away flip, frames on,
 * endgame: false). If the two drift, this test fails loudly on the hash
 * compare — drift cannot pass silently.
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

describe('endgame:false byte-identity (H-04 in-suite guard)', () => {
  it('the flag-off stream matches the committed corpus entry byte-for-byte', () => {
    // mirrors fingerprint.ts entry { seed: 'flagoff-legacy-0', flip: false,
    // endgame: false } — see the header MAINTENANCE note before editing
    const { home, away } = sampleMatchup();
    const r = simulateGame({
      seed: 'flagoff-legacy-0',
      home,
      away,
      collectFrames: true,
      endgame: false
    });
    const pinned = golden['flagoff-legacy-0']!;
    expect(pinned).toBeTruthy();
    // events first: the event stream is the consumer contract, so a leak
    // shows here even when it never moves a frame; frames second catch the
    // dead-ball/FT-ritual positioning class only frames can see
    expect(sha256(JSON.stringify(r.events))).toBe(pinned.events);
    expect(sha256(JSON.stringify(r.frames))).toBe(pinned.frames);
    expect(r.finalScore).toEqual(pinned.finalScore);
  });
});
