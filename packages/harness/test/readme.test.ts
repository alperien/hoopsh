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
import { cpSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The commands run in a disposable copy of the repo, not the real tree:
// the examples gate and this one both spawn CLIs that write out/, and the
// two files run concurrently under both test runners (a measured race —
// each gate passed solo and failed together). The copy also means a bad
// README line can never dirty the checkout. node_modules is symlinked
// (only the optional typecheck would need it; nothing here does).
const ROOT = mkdtempSync(join(tmpdir(), 'readme-gate-'));
for (const entry of ['packages', 'tools', 'data', 'docs', 'examples',
  'package.json', 'tsconfig.json', 'vitest.config.ts', 'README.md', 'LICENSE']) {
  cpSync(join(REPO, entry), join(ROOT, entry), { recursive: true });
}
try { symlinkSync(join(REPO, 'node_modules'), join(ROOT, 'node_modules')); } catch {}

const SKIP: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^git clone /, reason: 'network; the reader already has the tree' },
  { pattern: /^(open|xdg-open|start) /, reason: 'browser open; headless here' },
  { pattern: /^(npm test|npm run test)\b/, reason: 'would recurse the suite from inside itself' },
];

function runnableLines(): { line: string; block: number }[] {
  const src = readFileSync(join(REPO, 'README.md'), 'utf8');
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

  it('finds the runnable quickstart lines', { timeout: 30_000 }, () => {
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });

  // node:test and vitest both accept the {timeout} options form; vitest's
  // 5s default would otherwise kill this test (the block runs ~2 min).
  it('every runnable README line exits 0 (executed in block order)', { timeout: 600_000 }, () => {
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
