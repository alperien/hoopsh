/**
 * README anti-rot gate.
 *
 * The quickstart has shipped a paste-and-fail command twice (a stale
 * placeholder path both times; see docs/REGISTER.md W51). This test parses
 * README.md's fenced bash blocks and RUNS every runnable line verbatim, so
 * a README command that errors turns the suite red before it reaches a
 * newcomer. Same doctrine as examples.test.ts: instructions are code.
 *
 * Lines are executed sequentially inside each block (later lines may
 * consume files earlier lines wrote, e.g. sim -> viewer:embed). Lines
 * matching SKIP are not runnable here (cloning, browser opens, and the
 * suite itself, which would recurse). Each skip pattern must match at
 * least one line: a pattern that matches nothing is a stale skip and
 * fails the gate, so the skip list cannot quietly swallow the README.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SKIP: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^git clone /, reason: 'network; the reader already has the tree' },
  { pattern: /^(open|xdg-open|start) /, reason: 'browser open; headless here' },
  { pattern: /^(npm test|npm run test)\b/, reason: 'would recurse the suite from inside itself' },
];

function runnableLines(): { line: string; block: number }[] {
  const src = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const blocks = [...src.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!);
  expect(blocks.length).toBeGreaterThanOrEqual(2); // the quickstart exists
  const out: { line: string; block: number }[] = [];
  const skipHits = new Map<RegExp, number>();
  blocks.forEach((block, bi) => {
    for (const raw of block.split('\n')) {
      const line = raw.replace(/(^|\s)#.*$/, '').trim();
      if (!line) continue;
      const skip = SKIP.find((s) => s.pattern.test(line));
      if (skip) {
        skipHits.set(skip.pattern, (skipHits.get(skip.pattern) ?? 0) + 1);
        continue;
      }
      out.push({ line, block: bi });
    }
  });
  // a skip pattern that matches nothing is stale — fail loudly
  for (const s of SKIP) {
    if ((skipHits.get(s.pattern) ?? 0) < 1) {
      throw new Error(
        `stale SKIP pattern (matched no README line): ${s.pattern} — ${s.reason}`);
    }
  }
  return out;
}

describe('README quickstart commands run verbatim', () => {
  const lines = runnableLines();

  it('finds the runnable quickstart lines', () => {
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });

  it('every runnable README line exits 0 (executed in block order)', () => {
    for (const { line } of lines) {
      let output = '';
      try {
        output = execFileSync('bash', ['-c', line], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 240_000,
        });
      } catch (err) {
        const e = err as { status?: number; stderr?: string; stdout?: string };
        throw new Error(
          `README line failed (exit ${e.status}): ${line}\n` +
          `stderr tail: ${String(e.stderr ?? '').slice(-400)}\n` +
          `stdout tail: ${String(e.stdout ?? '').slice(-200)}`
        );
      }
      expect(typeof output).toBe('string');
    }
  });
});
