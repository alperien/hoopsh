/**
 * The examples anti-rot gate: every file in examples/ is EXECUTED here, as
 * its own subprocess through the same loader `npm run example:NN` uses, and
 * its printed output is asserted on — properties, not just "did not throw".
 * An example that stops compiling, stops running, or stops demonstrating the
 * thing its header promises fails this suite (the matter-js pattern:
 * examples ARE regression tests, so they can never rot silently).
 *
 * Also enforced: the examples/README.md index and the package.json
 * `example:NN` scripts stay in sync with the files on disk — an example you
 * can't discover or run with one command is rot too.
 *
 * COMPUTE BUDGET: examples are the expensive part (each subprocess pays
 * loader startup + 1-6 seeded sims; ~1-3s each, the season example ~4s).
 * All six are spawned CONCURRENTLY at module load, so this file adds
 * roughly max(child)+contention — measured ~8s wall on a shared 2-core box
 * — not the ~11s sequential sum. Every example is seed-pinned, so all
 * assertions below are on deterministic output; numeric bounds are
 * deliberately structural (>=, not ===) so an engine recalibration that
 * legitimately shifts scores does not break this suite.
 */

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXAMPLES_DIR = path.join(ROOT, 'examples');

const exampleFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.ts')).sort();

async function runExample(file: string): Promise<string> {
  const { stdout } = await exec(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--import', path.join(ROOT, 'tools', 'register.mjs'),
      path.join(EXAMPLES_DIR, file)
    ],
    { cwd: ROOT, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
  );
  return stdout;
}

// One concurrent burst, shared by every test below — each example runs
// exactly once per suite execution (season.test.ts's fixture pattern).
// Sequential on purpose: six concurrent engine processes at module load
// spiked memory on 2-core CI runners (the types job died mid-suite). The
// serial cost (~30-45s) is paid once per suite run.
const outputs = new Map<string, string>();
for (const f of exampleFiles) outputs.set(f, await runExample(f));

/** Extract the (first) numeric capture of `re`, failing loudly if absent. */
function num(out: string, re: RegExp): number {
  const m = out.match(re);
  if (!m || m[1] === undefined) throw new Error(`output did not match ${re}`);
  return Number(m[1]);
}
const out = (file: string): string => {
  const o = outputs.get(file);
  if (o === undefined) throw new Error(`${file} produced no output entry`);
  return o;
};

describe('examples index integrity', () => {
  it('ships the six numbered examples this suite asserts on', () => {
    expect(exampleFiles.length).toBeGreaterThanOrEqual(6);
    for (const n of ['01', '02', '03', '04', '05', '06']) {
      expect(exampleFiles.some((f) => f.startsWith(`${n}-`))).toBe(true);
    }
  });

  it('every example file is listed in examples/README.md', () => {
    const readme = readFileSync(path.join(EXAMPLES_DIR, 'README.md'), 'utf8');
    for (const f of exampleFiles) expect(readme).toContain(f);
  });

  it('every numbered example has its one-command run script in package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const f of exampleFiles) {
      const n = f.slice(0, 2);
      const script: string | undefined = pkg.scripts[`example:${n}`];
      expect(script === undefined ? `MISSING example:${n}` : script).toContain(`examples/${f}`);
    }
  });

  it('examples never deep-import package internals (barrels only)', () => {
    for (const f of exampleFiles) {
      const src = readFileSync(path.join(EXAMPLES_DIR, f), 'utf8');
      // '@hoopsh/<pkg>/anything' would bypass the public barrel; the season
      // example's documented exception imports harness src by relative path.
      expect(/@hoopsh\/[\w-]+\//.test(src)).toBe(false);
    }
  });
});

describe('01-simulate-a-game', () => {
  const o = out('01-simulate-a-game.ts');
  it('completes a full game with a plausible final score', () => {
    const home = num(o, /Final: CAS (\d+) —/);
    const away = num(o, /Final: CAS \d+ — MER (\d+)/);
    expect(home).toBeGreaterThan(59); // a full NBA-rules game, not a stub
    expect(away).toBeGreaterThan(59);
    expect(o).toContain('Q4:'); // the line score reached the fourth quarter
  });
  it('renders shot events and reports the stream size', () => {
    expect(o).toContain('First four shot attempts');
    expect(num(o, /The stream has (\d+) events/)).toBeGreaterThan(500);
  });
  it('proves determinism: the same seed replays identically', () => {
    expect(o).toContain('Same seed replays identically: yes');
  });
});

describe('02-custom-consumer (events are the contract)', () => {
  const o = out('02-custom-consumer.ts');
  it('finds lead changes the box score cannot express', () => {
    expect(num(o, /Lead changes: (\d+)/)).toBeGreaterThanOrEqual(1);
    expect(o).toContain('take the lead'); // at least one rendered change line
  });
  it('finds a real scoring run for each team', () => {
    expect(num(o, /Biggest run, CAS: (\d+)-0/)).toBeGreaterThanOrEqual(4);
    expect(num(o, /Biggest run, MER: (\d+)-0/)).toBeGreaterThanOrEqual(4);
  });
  it('largest leads bound the final margin (internal consistency)', () => {
    const casLead = num(o, /Largest lead, CAS: (\d+)/);
    const merLead = num(o, /Largest lead, MER: (\d+)/);
    const home = num(o, /Final: CAS (\d+) —/);
    const away = num(o, /Final: CAS \d+ — MER (\d+)/);
    expect(Math.max(casLead, merLead)).toBeGreaterThanOrEqual(Math.abs(home - away));
  });
});

describe('03-your-own-team (data packs + validation)', () => {
  const o = out('03-your-own-team.ts');
  it('the validator catches all four planted authoring mistakes, with JSONPaths', () => {
    expect(o).toContain('team is null, 4 issues');
    expect(o).toContain('$.team.players[0].heightIn');
    expect(o).toContain('$.team.players[1].attr.three');
    expect(o).toContain('$.team.players[2].tend.usage');
    expect(o).toContain('starter bay-99 not on roster');
  });
  it('the clean pack round-trips and the custom team plays a full game', () => {
    expect(o).toContain('Clean pack loads with 0 issues');
    const bay = num(o, /Final: BAY (\d+) —/);
    expect(bay).toBeGreaterThan(59);
  });
  it('the authored dials show up in the box score (the sniper takes threes)', () => {
    const line = o.match(/Juno Reyes\s+(\d+)\s+(\d+)-(\d+)/);
    if (!line) throw new Error('no box line for Juno Reyes');
    expect(Number(line[3])).toBeGreaterThanOrEqual(5); // 3PA: shotThree=92 must mean volume
  });
});

describe('04-custom-rules (RulePack is data)', () => {
  const o = out('04-custom-rules.ts');
  it('the same spot is a two under NBA geometry and a three under the shorter arc', () => {
    expect(o).toContain('a long TWO (zone: mid) in the NBA');
    expect(o).toContain('a THREE in the Harbor Rec League');
  });
  it('regulation is exactly as long as each pack says (2880s vs 2400s)', () => {
    expect(o).toContain('regulation ends at t=2880s');
    expect(o).toContain('regulation ends at t=2400s');
  });
  it('the result echoes the custom rules id', () => {
    expect(o).toContain('rules id echoed by the result: rec-league');
  });
  it('one-and-one free throws exist under the rec rule and NEVER under NBA rules', () => {
    const counts = [...o.matchAll(/one-and-one front ends shot: (\d+)/g)].map((m) => Number(m[1]));
    expect(counts.length).toBe(2);
    expect(counts[0]).toBe(0); // NBA: the field is absent from every event
    expect(counts[1]).toBeGreaterThanOrEqual(1); // rec league: the rule is live
  });
});

describe('05-commentary-provider (the narration seam)', () => {
  const o = out('05-commentary-provider.ts');
  it('the custom provider contributes at least one color line to the script', () => {
    expect(num(o, /(\d+) color lines from provider "stats-corner"/)).toBeGreaterThanOrEqual(1);
    expect(o).toContain('[Stats Corner]');
  });
  it('provider lines are interleaved with play-by-play in broadcast format', () => {
    expect(o).toContain('PBP:');
    expect(o).toContain('COLOR: [Stats Corner]');
    expect(num(o, /(\d+) cues/)).toBeGreaterThan(100); // a full game's script
  });
});

describe('06-season (schedule -> games -> standings)', () => {
  const o = out('06-season.ts');
  const rows = [...o.matchAll(/lg\d-\w+\s+(\d+)-(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)/g)];
  it('plays a 4-team single round-robin: 6 games, 4 standings rows', () => {
    expect(num(o, /Results \((\d+) games\)/)).toBe(6);
    expect(rows.length).toBe(4);
  });
  it('standings arithmetic holds: wins = games, diff sums to zero', () => {
    const wins = rows.reduce((n, r) => n + Number(r[1]), 0);
    const losses = rows.reduce((n, r) => n + Number(r[2]), 0);
    const diff = rows.reduce((n, r) => n + Number(r[5]), 0);
    expect(wins).toBe(6);
    expect(losses).toBe(6);
    expect(diff).toBe(0);
  });
});
