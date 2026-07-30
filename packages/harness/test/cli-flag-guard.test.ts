/**
 * CLI flag-guard pins: the harness entry points must reject unknown or
 * mal-formed flags LOUDLY (nonzero exit), never silently ignore them —
 * args.ts's doctrine, born of the broadcast silent-seed incident. Each
 * suite below pins the fix for a real, reproduced bug:
 *
 *  - turing.ts: the checkFlags vocabulary omitted five flags the CLI itself
 *    reads (--repr --windows --variant --strat --cap-per-game), so the
 *    file's own documented `--variant core` invocation (the T2/core
 *    protocol) died as "unknown flag --variant".
 *  - broadcast-demo.ts: never migrated to args.ts, so `--seed --booth
 *    latenight` silently simulated seed "--booth" and wrote a garbage
 *    filename, exit 0; typo'd flags silently ran the defaults.
 *  - scoreboard.ts (flowboard): no checkFlags at all (typo'd flags silently
 *    graded the defaults) and `--games 0` printed an all-NaN gate table
 *    with exit 0.
 *
 * FAST on purpose: allow-lists are asserted by importing them and calling
 * checkFlags directly, and every failing subprocess dies at flag-parse
 * time, BEFORE any simulation starts. The single valid-flag subprocess
 * (broadcast) sims exactly one seeded game — the only end-to-end way to
 * pin that migrating to the loud parser did not reject valid usage, since
 * broadcast-demo.ts runs on import and cannot be imported side-effect-free.
 */

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFlags } from '../src/args.js';
import { TURING_CLI_FLAGS } from '../src/turing.js';
import { FLOWBOARD_CLI_FLAGS } from '../src/scoreboard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Run a harness CLI exactly as its npm script does (same loader). Resolves
 *  — never rejects — with the exit code and captured streams, so tests can
 *  assert nonzero exits without try/catch gymnastics. */
function runCli(script: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--import', path.join(ROOT, 'tools', 'register.mjs'),
        path.join(ROOT, 'packages', 'harness', 'src', script),
        ...args
      ],
      { cwd: ROOT, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({
        code: err === null ? 0 : typeof err.code === 'number' ? err.code : 1,
        stdout, stderr
      })
    );
  });
}

describe('turing CLI flag vocabulary (allow-list matches the reads)', () => {
  it('includes the five documented flags the allow-list used to omit', () => {
    for (const f of ['--repr', '--windows', '--variant', '--strat', '--cap-per-game']) {
      expect(TURING_CLI_FLAGS).toContain(f);
    }
  });

  it('still includes the six flags it always accepted', () => {
    for (const f of ['--sim', '--window', '--out', '--real', '--seed', '--strip-timeouts']) {
      expect(TURING_CLI_FLAGS).toContain(f);
    }
  });

  it('accepts the documented T2/core protocol invocation', () => {
    expect(() => checkFlags(
      ['node', 'turing.ts', '--variant', 'core', '--repr', 'neutral', '--windows', 'mid',
        '--strat', 'clutch', '--cap-per-game', '2', '--sim', '15'],
      TURING_CLI_FLAGS
    )).not.toThrow();
  });

  it('still rejects a typo of the newly accepted flags, loudly', () => {
    expect(() => checkFlags(['node', 'turing.ts', '--variantt', 'core'], TURING_CLI_FLAGS))
      .toThrow(/unknown flag --variantt/);
  });
});

describe('flowboard (scoreboard.ts) flag guard', () => {
  it('declares exactly the flags the CLI reads', () => {
    for (const f of ['--games', '--seed', '--corpus', '--out', '--real-cap']) {
      expect(FLOWBOARD_CLI_FLAGS).toContain(f);
    }
    expect(FLOWBOARD_CLI_FLAGS.length).toBe(5);
  });

  it('rejects a typo of a known flag through checkFlags instead of running defaults', () => {
    expect(() => checkFlags(['node', 'scoreboard.ts', '--gmaes', '5'], FLOWBOARD_CLI_FLAGS))
      .toThrow(/unknown flag --gmaes/);
  });

  it('exits nonzero on an unknown flag (dies before simulating)', async () => {
    const r = await runCli('scoreboard.ts', ['--gmaes', '5']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('unknown flag --gmaes');
  });

  it('exits nonzero on --games 0 instead of printing a NaN gate table', async () => {
    const r = await runCli('scoreboard.ts', ['--games', '0']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--games requires an integer >= 1');
  });

  it('exits nonzero on a non-integer game count', async () => {
    const r = await runCli('scoreboard.ts', ['--games', '2.5']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--games requires an integer >= 1');
  });
});

describe('broadcast-demo flag guard (the original silent-seed incident)', () => {
  it('exits nonzero when --seed is passed without a value (the repro)', async () => {
    const r = await runCli('broadcast-demo.ts', ['--seed', '--booth', 'latenight']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--seed requires a value');
  });

  it('exits nonzero on an unknown flag instead of running defaults', async () => {
    const r = await runCli('broadcast-demo.ts', ['--boooth', 'classic']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('unknown flag --boooth');
  });

  it('still accepts the documented valid invocation (seed + booth)', async () => {
    const r = await runCli('broadcast-demo.ts', ['--seed', 'cli-flag-guard', '--booth', 'latenight']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('final:');
    expect(r.stdout).toContain('booth:');
  });
});
