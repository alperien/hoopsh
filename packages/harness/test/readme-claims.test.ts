/**
 * README content-claims gate — the other half of readme.test.ts.
 *
 * readme.test.ts proves every fenced quickstart command RUNS (exit 0). It
 * cannot see what the README SAYS: the harness-pure audit's R3 mutant
 * (README's `npm run batch -- --games 50` -> `--games 2`) survived the whole
 * suite, because 2 is still a valid flag value and the command still exits 0.
 * This file pins the README's falsifiable content claims — quoted commands,
 * counts, paths, names — to their in-repo sources of truth, so still-valid
 * drift turns the suite red. Prose that is legitimately free to change is NOT
 * pinned (see the "left unpinned" block at the bottom of this header).
 *
 * Source-of-truth decision for the quoted batch game counts (read, not
 * assumed): the README never quotes CI's 48 (.github/workflows/ci.yml — a CI
 * budget choice) nor AGENTS.md §4.2's 24 (the mechanics-change ladder tier),
 * so equality against either would be false on today's green tree. What the
 * README quotes is anchored in packages/harness/src/cli.ts, which owns both
 * numbers that matter:
 *   - the CLI default    flagNumber(process.argv, '--games', 50)
 *   - the gate floor     const GATE_MIN_GAMES = 24
 * Every README batch mention promises band GRADING ("grade vs NBA realism
 * acceptance bands", "run the checks yourself"); below GATE_MIN_GAMES cli.ts
 * downgrades to a report-only run ("gate inactive"), so a sub-floor quote
 * makes the README functionally false — that is the R3 kill. The quickstart
 * headline additionally quotes the canonical default size exactly.
 *
 * Claims read but left UNPINNED — no crisp repo source of truth exists, and
 * manufacturing one would be worse than the gap:
 *   - "shots take 0.4–0.65s to release": params.ts windup* defaults actually
 *     span 0.25–0.65 (windupPutback 0.25, windupCutFinish 0.3); the README's
 *     range is a prose summary of typical jump shots, not a constant set.
 *   - "~2 min" suite duration, "~3-6 typical" games/sec: hardware-dependent.
 *   - `--teams 8`, `--sims 200`, `--seed my-seed`: free example parameters
 *     (their FLAG NAMES are pinned below; the values are the reader's choice).
 *   - viewer playback-controls key list, "184 games ... spread over 21 dates"
 *     composition detail: prose about internals with no single named constant.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');
const readme = read('README.md');
const rootPkg = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: { node: string };
  license: string;
};

/** Regex extraction that throws loudly when the pattern misses. A reworded
 * README must break THIS gate visibly, never drain it silently — same
 * doctrine as examples.test.ts's num(). The error says how to re-point the
 * pin if the rewording was deliberate. */
function must(src: string, re: RegExp, what: string): RegExpMatchArray {
  const m = src.match(re);
  if (!m) {
    throw new Error(
      `claim extraction failed — ${what}: pattern ${re} matched nothing. ` +
      `If the source text was deliberately reworded, re-anchor this pin.`);
  }
  return m;
}

/**
 * Every npm command the README quotes, from BOTH surfaces:
 *  - fenced ```bash blocks (comment-stripped, same parse as readme.test.ts),
 *  - inline `code` spans in prose — the surface readme.test.ts never
 *    executes, which is exactly where audit mutant R3 lived
 *    ("Run it yourself: `npm run batch -- --games 50`").
 */
function quotedNpmCommands(): { cmd: string; fenced: boolean }[] {
  const out: { cmd: string; fenced: boolean }[] = [];
  for (const m of readme.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const raw of m[1]!.split('\n')) {
      const line = raw.replace(/(^|\s)#.*$/, '').trim();
      if (/^npm (?:run |test\b)/.test(line)) out.push({ cmd: line, fenced: true });
    }
  }
  for (const m of readme.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1]!.trim();
    if (/^npm (?:run |test\b)/.test(span)) out.push({ cmd: span, fenced: false });
  }
  return out;
}
const npmCmds = quotedNpmCommands();

/** `npm test` -> "test"; `npm run x ...` -> "x". Throws on anything else. */
function scriptOf(cmd: string): string {
  if (/^npm test\b/.test(cmd)) return 'test';
  return must(cmd, /^npm run ([A-Za-z0-9:._-]+)/, `script name in "${cmd}"`)[1]!;
}

/**
 * package.json script -> its CLI source file -> the checkFlags vocabulary it
 * declares. args.ts checkFlags rejects unknown flags at RUNTIME (audit R1
 * proved that composition for fenced lines); this maps the same contract onto
 * quoted docs STATICALLY, covering the inline spans no test executes.
 * Returns null when the script's source declares no vocabulary (e.g.
 * viewer:embed takes positionals) — those commands are skipped, not faked.
 */
function flagVocab(script: string): string[] | null {
  const def = rootPkg.scripts[script];
  if (!def) return null;
  const srcRel = [...def.matchAll(/\S+\.(?:ts|mjs)\b/g)]
    .map((m) => m[0].replace(/^["']|["']$/g, ''))
    .filter((s) => !s.includes('register.mjs'))
    .pop();
  if (!srcRel || !existsSync(join(REPO, srcRel))) return null;
  const m = read(srcRel).match(/checkFlags\((?:process\.)?argv,\s*\[([^\]]*)\]/);
  if (!m) return null;
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe('README content claims match their in-repo sources of truth', () => {

  // ------------------------------------------------------------ commands

  it('every npm command the README quotes names a real package.json script', () => {
    // Source of truth: package.json "scripts". This is the R2 drift class
    // (renamed script) extended to the prose surface readme.test.ts cannot
    // reach: `npm run oos`, `npm run sweep`, `npm run typecheck`,
    // `npm run test:vitest` etc. are quoted inline only.
    expect(npmCmds.length).toBeGreaterThanOrEqual(12); // ~25 today; an empty extraction must fail, not pass
    for (const { cmd } of npmCmds) {
      const script = scriptOf(cmd);
      if (!(script in rootPkg.scripts)) {
        throw new Error(`README quotes "${cmd}" but package.json has no script "${script}"`);
      }
    }
  });

  it('every flag in a quoted command exists in that CLI’s checkFlags vocabulary', () => {
    // Source of truth: each CLI's own checkFlags([...]) declaration
    // (cli.ts, sweep.ts, season-cli.ts, simone.ts, oos.ts). Why drift
    // matters: checkFlags makes an unknown flag a hard runtime error (the
    // `--leage` incident class), so a README quoting a dropped/renamed flag
    // is a paste-and-fail instruction — invisible to the runnability gate
    // when the command sits in prose.
    let pairsChecked = 0;
    for (const { cmd } of npmCmds) {
      const parts = cmd.split(/\s--\s/);
      if (parts.length < 2) continue; // no `--`-separated args quoted
      const flags = parts.slice(1).join(' ').match(/--[a-z][A-Za-z-]*/g) ?? [];
      if (flags.length === 0) continue;
      const vocab = flagVocab(scriptOf(cmd));
      if (vocab === null) continue; // CLI declares no vocabulary; nothing to hold it to
      for (const flag of flags) {
        pairsChecked++;
        if (!vocab.includes(flag)) {
          throw new Error(
            `README quotes "${cmd}" but ${scriptOf(cmd)}'s checkFlags vocabulary ` +
            `[${vocab.join(', ')}] has no ${flag} — that line dies at runtime`);
        }
      }
    }
    expect(pairsChecked).toBeGreaterThanOrEqual(6); // 11 today; vacuity guard on the extractor
  });

  it('quoted batch game counts are gate-active sample sizes (kills audit mutant R3)', () => {
    // Source of truth: GATE_MIN_GAMES in packages/harness/src/cli.ts. Every
    // README batch mention promises band grading; cli.ts itself says runs
    // below this floor are "report-only ... gate inactive". So `--games 2`
    // (the R3 mutant, either occurrence) turns a documented realism check
    // into a no-op — functionally false documentation. Legitimate counts
    // (40, 48, 50, 100...) all pass; this is a floor, not a frozen number.
    const floor = Number(must(read('packages/harness/src/cli.ts'),
      /const GATE_MIN_GAMES = (\d+)/, 'gate floor in cli.ts')[1]);
    expect(floor).toBeGreaterThanOrEqual(1);
    const counts: { cmd: string; n: number }[] = [];
    for (const { cmd } of npmCmds) {
      if (scriptOf(cmd) !== 'batch') continue;
      const g = cmd.match(/--games\s+(\S+)/);
      if (!g) continue; // bare `npm run batch` runs the default — gate-active by construction
      const n = Number(g[1]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`README quotes "${cmd}" with a non-integer --games value "${g[1]}"`);
      }
      counts.push({ cmd, n });
    }
    expect(counts.length).toBeGreaterThanOrEqual(2); // 3 today (quickstart + two inline); extractor must not silently die
    for (const { cmd, n } of counts) {
      if (n < floor) {
        throw new Error(
          `README quotes "${cmd}" but cli.ts's acceptance gate only engages at ` +
          `--games >= ${floor} (GATE_MIN_GAMES) — the documented check would grade nothing`);
      }
      expect(n).toBeGreaterThanOrEqual(floor);
    }
  });

  it('the quickstart batch line quotes the canonical run size — cli.ts’s --games default', () => {
    // Source of truth: the default in flagNumber(process.argv, '--games', N)
    // at packages/harness/src/cli.ts. The quickstart's `--games 50` is not an
    // arbitrary example: it is the run size the CLI itself performs when the
    // flag is omitted. If the default is retuned, the headline must follow;
    // if the headline drifts (50 -> 2, R3), this pin goes red alongside the
    // floor pin above.
    const def = Number(must(read('packages/harness/src/cli.ts'),
      /'--games',\s*(\d+)\)/, 'batch --games default in cli.ts')[1]);
    const fencedBatch = npmCmds.filter((c) => c.fenced && scriptOf(c.cmd) === 'batch');
    expect(fencedBatch.length).toBeGreaterThanOrEqual(1); // the quickstart block exists
    for (const { cmd } of fencedBatch) {
      const n = Number(must(cmd, /--games\s+(\d+)/, `--games count in quickstart line "${cmd}"`)[1]);
      expect(n).toBe(def);
    }
  });

  it('the NCAA rule pack’s documented `--league` flag is in the batch CLI vocabulary', () => {
    // Claim: "an NCAA rule pack behind the harness `--league` flag" (Roadmap).
    // Source of truth: cli.ts checkFlags. Quoted as a bare flag span, never
    // inside a runnable command, so only a static pin can catch its removal.
    expect(readme).toContain('`--league` flag');
    const vocab = flagVocab('batch');
    expect(vocab).toBeTruthy();
    expect(vocab!).toContain('--league');
  });

  // ------------------------------------------------------------ paths

  it('every repo path the README references exists on disk', () => {
    // Source of truth: the filesystem. Three reference surfaces:
    //  (a) markdown link targets (./docs/EMBEDDING.md, LICENSE, ...),
    //  (b) bare docs/*.md tokens in prose and fence comments (docs/SEASON.md
    //      appears three times, never as a link),
    //  (c) backticked path spans (`data/nba/`, `tools/hooks.mjs`, ...).
    // Why drift matters: this is the W51 incident class (stale paths shipped
    // twice) applied to references instead of commands.
    const found = new Set<string>();
    for (const m of readme.matchAll(/\]\((?!https?:|#|mailto:)(?:\.\/)?([A-Za-z0-9._/-]+?)(?:#[A-Za-z0-9._-]*)?\)/g)) {
      found.add(m[1]!);
    }
    for (const m of readme.matchAll(/\bdocs\/[A-Za-z0-9_-]+\.md\b/g)) found.add(m[0]);
    for (const m of readme.matchAll(/`([A-Za-z0-9._/-]+)`/g)) {
      const s = m[1]!;
      if (!s.includes('/')) continue;
      if (s.startsWith('out/')) continue; // runtime artifacts, not repo files
      if (!/\.(?:ts|mjs|md|html|json)$/.test(s) && !s.endsWith('/')) continue;
      found.add(s);
    }
    const paths = [...found].sort();
    expect(paths.length).toBeGreaterThanOrEqual(12); // ~17 today; empty extraction must fail
    expect(paths).toContain('AGENTS.md');        // the covenant link — load-bearing
    expect(paths).toContain('docs/REGISTER.md'); // the work register — cited twice
    for (const p of paths) {
      // README shorthand omits the monorepo prefix in two known spots:
      // `harness/src/bands.ts` (lives under packages/) and `core/events.ts`
      // (lives under packages/engine/src/). Accept root, packages/, or
      // packages/engine/src/ resolution; anything else is a dead reference.
      const candidates = [p, `packages/${p}`, `packages/engine/src/${p}`];
      if (!candidates.some((c) => existsSync(join(REPO, c)))) {
        throw new Error(`README references "${p}" but none of [${candidates.join(', ')}] exists`);
      }
    }
  });

  it('the package table matches packages/ on disk, in both directions', () => {
    // Source of truth: the packages/ directory and each package.json name.
    // Direction 1: a workspace package the README never mentions means the
    // "How it fits together" table has rotted. Direction 2: an @hoopsh/X the
    // README names must be a real package whose manifest agrees.
    const dirs = readdirSync(join(REPO, 'packages'))
      .filter((d) => statSync(join(REPO, 'packages', d)).isDirectory());
    expect(dirs.length).toBeGreaterThanOrEqual(2); // vacuity guard on readdir
    for (const d of dirs) {
      if (!readme.includes(`@hoopsh/${d}`) && !readme.includes(`packages/${d}`)) {
        throw new Error(
          `packages/${d} exists but README mentions neither @hoopsh/${d} nor packages/${d} ` +
          `— the architecture table is stale`);
      }
    }
    const named = new Set([...readme.matchAll(/@hoopsh\/([a-z0-9-]+)/g)].map((m) => m[1]!));
    expect(named.size).toBeGreaterThanOrEqual(5); // engine, stats, data, narration, harness today
    for (const n of named) {
      const pkg = JSON.parse(read(`packages/${n}/package.json`)) as { name?: string };
      expect(pkg.name).toBe(`@hoopsh/${n}`);
    }
  });

  // ------------------------------------------------------------ the zero-dep claim

  it('engine declares zero dependencies, as the README bolds (manifest half)', () => {
    // Claim: "Pure, zero-dependency, deterministic sim core". Source of
    // truth: packages/engine/package.json — any dependency key appearing
    // falsifies the table row and the repo's central design rule.
    const pkg = JSON.parse(read('packages/engine/package.json')) as Record<string, unknown>;
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(key in pkg).toBe(false);
    }
  });

  it('engine imports nothing: every import/export specifier in engine/src is relative', () => {
    // Claim: "engine imports nothing — no npm packages, no `node:` built-ins"
    // (the diagram caption calls this "the review test"). Source of truth:
    // the import statements themselves. A single `node:fs` or npm specifier
    // anywhere in packages/engine/src falsifies the README's core rule.
    const files: string[] = [];
    (function walk(dir: string): void {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    })(join(REPO, 'packages/engine/src'));
    expect(files.length).toBeGreaterThanOrEqual(20); // 27 today; an empty walk must fail
    let specifiers = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const froms = [...src.matchAll(/^(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gms)];
      const bares = [...src.matchAll(/^import\s+['"]([^'"]+)['"]/gm)]; // side-effect imports
      for (const m of [...froms, ...bares]) {
        specifiers++;
        if (!m[1]!.startsWith('.')) {
          throw new Error(`${f} imports "${m[1]}" — README claims the engine imports nothing`);
        }
      }
    }
    expect(specifiers).toBeGreaterThanOrEqual(20); // ~60 today; regex rot must not pass silently
  });

  // ------------------------------------------------------------ numbers with sources

  it('the quickstart "Node N+" requirement matches package.json engines', () => {
    // Source of truth: engines.node in the root manifest. If the floor is
    // bumped (>=26), a README still advertising "Node 24+" sends newcomers
    // into loader failures.
    const claimed = Number(must(readme, /\*\*Node (\d+)\+\*\*/, 'the bolded Node version claim')[1]);
    const engines = Number(must(rootPkg.engines.node, /^>=(\d+)$/, 'root engines.node floor')[1]);
    expect(claimed).toBe(engines);
  });

  it('the "184 parsed games" corpus claims equal the corpus shipped in data/nba/', () => {
    // Source of truth: data/nba/pbp-corpus.json's games array (its meta and
    // flow-reference.json's n fields all derive from the same corpus). The
    // README stakes its realism-honesty paragraph on this number, twice
    // ("184 parsed real games", "real-game corpus (184 parsed NBA games)").
    // If the corpus grows or shrinks, both mentions must be re-stated.
    const corpus = JSON.parse(read('data/nba/pbp-corpus.json')) as { games: unknown[] };
    expect(corpus.games.length).toBeGreaterThanOrEqual(1);
    const claims = [...readme.matchAll(/(\d+) parsed (?:real|NBA)\s+games/g)].map((m) => Number(m[1]));
    expect(claims.length).toBeGreaterThanOrEqual(2); // both mentions present today
    for (const n of claims) expect(n).toBe(corpus.games.length);
  });

  it('the dev tooling the README names is actually declared in devDependencies', () => {
    // Claim: "Optional dev tooling (`typescript`, `vitest`, `tsx`,
    // `@types/node`) is declared in devDependencies". Source of truth: the
    // root manifest. A named tool missing from devDependencies makes the
    // "one plain npm install reproduces the dev environment" promise false.
    // (If the README's list is deliberately reworded, update this list too.)
    for (const tool of ['typescript', 'vitest', 'tsx', '@types/node']) {
      expect(readme).toContain(`\`${tool}\``);
      expect(tool in rootPkg.devDependencies).toBe(true);
    }
  });

  it('the documented simulateGame result shape matches the engine’s GameResult', () => {
    // Claim: "`simulateGame(config)` returns `{ seed, events, finalScore,
    // frames, rules, params, teams }`" (Build on it). Source of truth: the
    // GameResult interface in packages/engine/src/sim/game.ts. A field added
    // or renamed there makes the embedding docs lie to consumers.
    const doc = must(readme, /`simulateGame\(config\)` returns `\{([^`]+)\}`/,
      'documented simulateGame result shape')[1]!;
    const docKeys = doc.split(',').map((s) => s.trim()).filter(Boolean).sort();
    const iface = must(read('packages/engine/src/sim/game.ts'),
      /export interface GameResult \{([\s\S]*?)\n\}/, 'GameResult interface in game.ts')[1]!;
    const srcKeys = [...iface.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]!).sort();
    expect(srcKeys.length).toBeGreaterThanOrEqual(3); // interface parse must not come back empty
    expect(docKeys).toEqual(srcKeys);
  });

  it('the quoted bench budget matches what bench.ts actually enforces as its budget line', () => {
    // Claim: "games/sec benchmark (budget: ≥1 ...)" in the quickstart fence.
    // Source of truth: the budget bench.ts prints (AGENTS.md §4.2 states the
    // same "≥1 game/sec" budget). If the perf budget is renegotiated, the
    // quickstart's parenthetical must move with it.
    const claimed = Number(must(readme, /budget: ≥(\d+)/, 'bench budget claim in README')[1]);
    const printed = Number(must(read('packages/harness/src/bench.ts'),
      /budget: ≥ ?([\d.]+)/, 'budget in bench.ts output')[1]);
    expect(claimed).toBe(printed);
  });

  it('"ten times per second" is the engine’s actual tick rate (params.ts tickHz)', () => {
    // Claim: "ten agents moving on a real court, ten times per second"
    // (opening paragraph). Source of truth: the tickHz default in
    // packages/engine/src/sim/params.ts. If the tick rate is retuned, the
    // README's headline description of the sim is wrong.
    must(readme, /ten times\s+per second/, 'the tick-rate claim in the opening paragraph');
    const hz = Number(must(read('packages/engine/src/sim/params.ts'),
      /^\s*tickHz: (\d+),/m, 'tickHz default in params.ts')[1]);
    expect(hz).toBe(10);
  });

  it('the promised sim outputs are the filenames simone.ts actually writes', () => {
    // Claims: "every `npm run sim` writes the full play-by-play to
    // `out/pbp-<seed>.txt`" and "writes out/replay-showcase.json" (Watch a
    // game). Source of truth: the writeFileSync templates in
    // packages/harness/src/simone.ts. The replay half is also proven
    // end-to-end by readme.test.ts (viewer:embed consumes it); the pbp claim
    // is proven nowhere else — a renamed output orphans the headless-box
    // instructions.
    expect(readme).toContain('out/pbp-<seed>.txt');
    const simone = read('packages/harness/src/simone.ts');
    expect(simone).toContain('out/pbp-${seed}.txt');
    expect(simone).toContain('out/replay-${seed}.json');
  });

  it('the MIT license claim is three-way consistent: README, manifest, LICENSE', () => {
    // Source of truth: package.json license + the LICENSE file the README
    // links. A relicense that misses one surface is exactly this drift.
    must(readme, /## License\s+MIT\b/, 'README license section');
    expect(rootPkg.license).toBe('MIT');
    expect(read('LICENSE')).toContain('MIT License');
  });
});
