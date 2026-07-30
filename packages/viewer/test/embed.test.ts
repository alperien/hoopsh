/**
 * embed.mjs CLI behavior — the viewer's first EXECUTED test (the injection
 * tripwire next door only greps source). Node-only: spawns the real CLI as
 * a child process, no DOM involved.
 *
 * Pins audit M-41 (malformed replay JSON used to be spliced raw into the
 * template — a blank standalone page with CLI exit 0) and L-35 (a typo'd
 * replay path used to die on a raw ENOENT stack): every bad-input shape now
 * exits 1 with a loud ONE-LINE diagnostic, and nothing is written.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBED = path.resolve(HERE, '..', 'embed.mjs');
const DIR = mkdtempSync(path.join(tmpdir(), 'hoopsh-embed-'));

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [EMBED, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// minimal but structurally honest replay: carries every key the viewer's
// boot() dereferences unconditionally (rules/teams/events/frames)
const REPLAY = JSON.stringify({
  version: 2,
  seed: 'embed-test',
  rules: {
    id: 'nba', courtLengthFt: 94, courtWidthFt: 50, rimInsetFt: 5.25,
    three: { arcRadiusFt: 23.75, cornerDistFt: 22, cornerBreakFt: 14 },
    periods: 4, periodMinutes: 12
  },
  teams: [
    { id: 'h', name: 'Home', abbrev: 'HOM', players: [] },
    { id: 'a', name: 'Away', abbrev: 'AWY', players: [] }
  ],
  finalScore: [0, 0],
  lineups: [],
  events: [],
  frames: [[0]]
});

const expectLoudFailure = (r: ReturnType<typeof run>, needle: string, out: string): void => {
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(needle);
  expect(r.stderr.trim().split('\n').length).toBe(1); // one-line diagnostic, not a stack
  expect(existsSync(out)).toBe(false); // nothing half-written
};

describe('viewer embed CLI', () => {
  it('truncated JSON fails loudly with exit 1 and writes nothing (M-41)', () => {
    const bad = path.join(DIR, 'truncated.json');
    writeFileSync(bad, REPLAY.slice(0, REPLAY.length - 40));
    const out = path.join(DIR, 'out-truncated.html');
    expectLoudFailure(run(bad, out), 'not valid JSON', out);
  });

  it('a missing replay path fails loudly, not with a raw ENOENT stack (L-35)', () => {
    const out = path.join(DIR, 'out-missing.html');
    const r = run(path.join(DIR, 'nope.json'), out);
    expectLoudFailure(r, 'cannot read replay', out);
    expect(r.stderr).not.toContain('    at '); // no stack frames
  });

  it('valid JSON that is not a replay artifact is rejected by shape', () => {
    const notReplay = path.join(DIR, 'box.json');
    writeFileSync(notReplay, JSON.stringify({ hello: 1, events: [] }));
    const out = path.join(DIR, 'out-shape.html');
    expectLoudFailure(run(notReplay, out), 'not a replay artifact', out);

    // JSON `null` would splice cleanly and boot nothing (`if (EMBEDDED)`)
    const nullFile = path.join(DIR, 'null.json');
    writeFileSync(nullFile, 'null');
    const out2 = path.join(DIR, 'out-null.html');
    expectLoudFailure(run(nullFile, out2), 'not a replay object', out2);
  });

  it('a valid replay bakes: marker replaced by the original JSON text, exit 0', () => {
    const good = path.join(DIR, 'good.json');
    writeFileSync(good, REPLAY);
    const out = path.join(DIR, 'out-good.html');
    const r = run(good, out);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('wrote');
    const html = readFileSync(out, 'utf8');
    expect(html).not.toContain('/*HOOPSH_REPLAY*/null');
    expect(html).toContain('"seed":"embed-test"'); // spliced verbatim, not re-serialized
  });

  it('missing arguments print usage and exit 1', () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('usage:');
  });
});
