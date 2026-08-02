/**
 * One-command re-baseline — regenerate every deterministic baseline artifact
 * after a deliberate rng-order / mechanics change, in the right order, with
 * a summary of exactly what moved (issue #35).
 *
 *   npm run rebaseline               regenerate + report + final full suite
 *   npm run rebaseline -- --dry-run  guards + staleness preview, writes NOTHING
 *
 * WHAT IT REGENERATES (the artifacts it owns, all-or-nothing):
 *   1. packages/harness/golden/fingerprints.json   (fingerprint.ts --write)
 *   2. packages/harness/src/noise-floor.gen.ts     (noisefloor.ts --mode all)
 *   3. packages/{engine,harness,narration}/test/seed-pins.gen.ts
 *      (reanchor.ts --write — only when its verify pass finds stale pins;
 *      the helper's own doctrine, confirmation run, and restore-on-red are
 *      the authority; this tool never bypasses them)
 *
 * WHAT IT WILL NEVER DO (AGENTS §1.6, issue #35 scope):
 *   - edit a test file, a band edge, or a params value. Checksum-pin rows
 *     (transcarry/blowby/putbackstrong…), the latewindow pool, and example
 *     seeds need judgment (mutant-RED re-verification, pool re-scouts); the
 *     final suite run LISTS them as manual re-anchor debt instead.
 *   - write past a red guard. A one-command rebaseline must not become a
 *     one-command way to launder a regression.
 *
 * GUARDS (both run before any byte is written; red ⇒ REFUSE, exit 1):
 *   - the invariant suite (packages/engine/test/invariants.test.ts). The
 *     invariants survive legitimate rng-order changes by construction, so a
 *     red invariant suite is a broken engine, not a stale baseline.
 *   - the determinism gate (fingerprint.ts --determinism, the issue-#33 CI
 *     gate). Baking goldens from a nondeterministic engine would launder
 *     ambient-state corruption into the reference corpus.
 *   The refusal path is exercised safely via --dry-run: introduce the
 *   breaking change, run the dry run, watch the guard refuse — no writes
 *   happen in either mode until both guards are green.
 *
 * IDEMPOTENCE (the tool's own self-test): at an unchanged kernel the run is
 * a provable no-op — the corpus rewrite is byte-identical by determinism,
 * the reanchor helper writes nothing when every pin verifies anchored, and
 * the noise-floor regen is discarded when the only diff is the generatedAt
 * date stamp (values identical ⇒ the checked-in measurement stands; keeping
 * a stamp-only rewrite would make the accepted-drift record lie and the
 * no-op unprovable). The summary's artifact table prints sha256 before/after
 * per artifact and declares NO-OP when nothing moved.
 *
 * EXIT CODES (mirrors reanchor.ts's convention: 2 is never a full success):
 *   0  clean — no-op at an unchanged kernel, or a rebaseline whose final
 *      full suite is green (no manual debt)
 *   1  refused (a guard is red) or a leg failed — every owned artifact is
 *      restored to its pre-run bytes; the tree is left untouched
 *   2  rebaselined, but the final full suite lists manual re-anchor debt
 *      (dry-run: movement detected, a real run is needed)
 *
 * Interrupts: a killed run can leave a regenerated artifact behind (the
 * restore-on-failure path never gets to run) — `git status` shows exactly
 * which of the owned artifacts moved; restore via git.
 *
 * Zero-install: Node built-ins only, like every tools/*.mjs. Child runs go
 * through tools/register.mjs exactly as the npm scripts do.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER = path.join(ROOT, 'tools', 'register.mjs');
/** scratch + captured child logs live under gitignored out/ so a run never
 *  dirties the tracked tree with its own bookkeeping */
const SCRATCH = path.join(ROOT, 'out', 'rebaseline');

// ---------------------------------------------------------------- argv

/** the whole flag surface — loud on anything else, per the args.ts doctrine
 *  (tools/*.mjs precedent: roster-new.mjs's local checkArgv) */
const KNOWN_FLAGS = ['--dry-run'];

function checkArgv(argv) {
  const seen = new Set();
  for (const a of argv) {
    const eq = a.indexOf('=');
    const name = eq === -1 ? a : a.slice(0, eq);
    if (!KNOWN_FLAGS.includes(name)) {
      console.error(`unknown argument ${a} (this tool takes: ${KNOWN_FLAGS.join(' ')})`);
      process.exit(1);
    }
    if (eq !== -1) {
      console.error(`${name} takes no value — pass the bare flag`);
      process.exit(1);
    }
    if (seen.has(name)) {
      console.error(`${name} is passed twice — pass it exactly once`);
      process.exit(1);
    }
    seen.add(name);
  }
}

checkArgv(process.argv.slice(2));
const DRY = process.argv.includes('--dry-run');

// ------------------------------------------------------------- plumbing

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
/** 12 hex chars — display width only, matching fingerprint.ts's truncated
 *  hash diagnostics; full hashes stay in the artifacts themselves */
const short = (hex) => hex.slice(0, 12);

/** the owned artifacts, in regeneration order (paths relative to ROOT) */
const ARTIFACTS = [
  'packages/harness/golden/fingerprints.json',
  'packages/harness/src/noise-floor.gen.ts',
  'packages/engine/test/seed-pins.gen.ts',
  'packages/harness/test/seed-pins.gen.ts',
  'packages/narration/test/seed-pins.gen.ts'
];

const abs = (rel) => path.join(ROOT, rel);
const readArtifact = (rel) => readFileSync(abs(rel));

/** pre-run bytes of every owned artifact — the restore-on-failure source
 *  and the before side of the summary's sha table */
const snapshot = new Map(ARTIFACTS.map((rel) => [rel, readArtifact(rel)]));

function restoreAll(reason) {
  for (const [rel, bytes] of snapshot) writeFileSync(abs(rel), bytes);
  console.error(`\nRESTORED — every owned artifact is back at its pre-run bytes (${reason}).`);
}

/** run a TS entry point through the register hook, exactly as the npm
 *  scripts do. stdio 'inherit' streams progress for long legs; 'capture'
 *  returns the text for parsing and re-printing. maxBuffer mirrors
 *  reanchor.ts's confirmation run (a full-suite capture fits in 64 MiB). */
function run(args, { capture = false, logName = null } = {}) {
  const res = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', REGISTER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 64 * 1024 * 1024
  });
  if (res.error) throw res.error;
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  if (capture && logName !== null) {
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(path.join(SCRATCH, logName), out);
  }
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '', out };
}

const t0 = performance.now();
const secs = (since) => `${((performance.now() - since) / 1000).toFixed(1)}s`;
const rule = (label) => console.log(`\n── ${label}`);

/** the last lines of a captured child log — enough context to act on a
 *  refusal without re-running; the full text is under out/rebaseline/ */
function tail(text, n = 25) {
  const lines = text.trimEnd().split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

// ---------------------------------------------------------------- guards

function guard(label, args, logName, redMeaning) {
  const t = performance.now();
  const r = run(args, { capture: true, logName });
  if (r.status !== 0) {
    console.error(tail(r.out));
    console.error(
      `\nREFUSED — ${label} is red (full output: out/rebaseline/${logName}).\n` +
      `${redMeaning}\n` +
      'Nothing was written. Fix the engine first; there is nothing to re-baseline past a red guard.'
    );
    process.exit(1);
  }
  console.log(`${label}: green (${secs(t)})`);
}

// ----------------------------------------------------- canonical fingerprint

/** the (events)/FINAL line AGENTS §4.1 has every change record, plus sha256
 *  of the replay and pbp files simone.ts saves — the exact numbers a PR
 *  body's before/after fingerprint table quotes */
function canonicalFingerprint() {
  const r = run(['packages/harness/src/simone.ts', '--seed', 'fingerprint-1'], { capture: true, logName: 'sim-fingerprint-1.log' });
  if (r.status !== 0) throw new Error(`simone.ts --seed fingerprint-1 exited ${r.status} (out/rebaseline/sim-fingerprint-1.log)`);
  const events = r.stdout.match(/\((\d+) events\)/)?.[1] ?? '?';
  const final = r.stdout.match(/FINAL — .+? (\d+), .+? (\d+)/);
  const score = final ? `${final[1]}-${final[2]}` : '?';
  const replaySha = short(sha256(readFileSync(path.join(ROOT, 'out', 'replay-fingerprint-1.json'))));
  const pbpSha = short(sha256(readFileSync(path.join(ROOT, 'out', 'pbp-fingerprint-1.txt'))));
  return { events, score, replaySha, pbpSha };
}

// ------------------------------------------------------------------ corpus

/** parse the golden corpus (seed → { events, frames, finalScore }) */
const parseCorpus = (text) => JSON.parse(text);

/** per-seed movement between two corpus objects, in the new file's key
 *  order (insertion order IS the corpus order — fingerprint.ts) */
function corpusDelta(oldC, newC) {
  const moved = [];
  for (const seed of Object.keys(newC)) {
    const o = oldC[seed];
    const n = newC[seed];
    if (!o) { moved.push({ seed, note: 'new seed (corpus grew)' }); continue; }
    const events = o.events !== n.events;
    const frames = o.frames !== n.frames;
    const score = o.finalScore[0] !== n.finalScore[0] || o.finalScore[1] !== n.finalScore[1];
    if (events || frames || score) {
      moved.push({ seed, events, frames, from: o.finalScore.join('-'), to: n.finalScore.join('-') });
    }
  }
  for (const seed of Object.keys(oldC)) {
    if (!(seed in newC)) moved.push({ seed, note: 'removed seed (corpus shrank)' });
  }
  return moved;
}

function reportCorpus(moved, total) {
  if (moved.length === 0) {
    console.log(`corpus: 0/${total} seeds moved — byte-identical rebake`);
    return;
  }
  console.log(`corpus: ${moved.length}/${total} seeds moved`);
  for (const m of moved) {
    if (m.note) { console.log(`  ${m.seed}: ${m.note}`); continue; }
    const what = [m.events ? 'events' : null, m.frames ? 'frames' : null].filter(Boolean).join('+') || 'score only';
    console.log(`  ${m.seed}: ${what}, final ${m.from} → ${m.to}`);
  }
}

// -------------------------------------------------------------- noise floor

/** the JSON object inside noise-floor.gen.ts (strip the generated header
 *  and the `export const NOISE_FLOOR = … as const;` wrapper) */
function parseNoiseFloor(text) {
  const anchor = text.indexOf('export const NOISE_FLOOR');
  const start = text.indexOf('{', anchor);
  const end = text.lastIndexOf('}');
  return JSON.parse(text.slice(start, end + 1));
}

/** generatedAt is the ONE wall-clock byte in the artifact (noisefloor.ts
 *  stamps the emit date). Normalizing it out is what makes "did the floor
 *  actually move" a byte comparison instead of a judgment call. */
const normalizeStamp = (text) => text.replace(/"generatedAt": "\d{4}-\d{2}-\d{2}"/, '"generatedAt": "-"');

/** NBA_BANDS + TARGETS read live from the harness modules through a spawned
 *  probe (this tool is plain Node with no TS loader of its own). Absolute
 *  .ts file URLs on purpose: the hooks.mjs .js→.ts rewrite covers relative
 *  specifiers only. TARGETS rows carry getter functions; the probe strips
 *  to the serializable fields the table needs. */
function readBandDefs() {
  mkdirSync(SCRATCH, { recursive: true });
  const probePath = path.join(SCRATCH, 'band-probe.mjs');
  const bandsUrl = pathToFileURL(path.join(ROOT, 'packages', 'harness', 'src', 'bands.ts')).href;
  const fidelityUrl = pathToFileURL(path.join(ROOT, 'packages', 'harness', 'src', 'fidelity.ts')).href;
  writeFileSync(probePath, [
    `import { NBA_BANDS } from ${JSON.stringify(bandsUrl)};`,
    `import { TARGETS } from ${JSON.stringify(fidelityUrl)};`,
    'const targets = {};',
    'for (const [id, rows] of Object.entries(TARGETS)) {',
    '  targets[id] = rows.map((t) => ({ label: t.label, lo: t.lo, hi: t.hi, ratchet: !!t.ratchet, pct: !!t.pct, quarantine: t.quarantine }));',
    '}',
    'console.log(JSON.stringify({ bands: NBA_BANDS, targets }));'
  ].join('\n'));
  const r = run([probePath], { capture: true, logName: 'band-probe.log' });
  if (r.status !== 0) throw new Error(`band probe exited ${r.status} (out/rebaseline/band-probe.log)`);
  return JSON.parse(r.stdout);
}

/** the tripwire z the gates apply on top of band edges — read from the test
 *  sources so this table can never drift from the real formula silently: a
 *  moved/renamed constant breaks the anchored match LOUDLY and the table
 *  falls back to raw floor movement with a warning */
function readZ(relTestPath) {
  const m = readFileSync(abs(relTestPath), 'utf8').match(/^const Z = ([0-9.]+);/m);
  return m ? Number(m[1]) : null;
}

const fmtV = (x, pct) => (pct ? `${(100 * x).toFixed(1)}%` : x.toFixed(2));

/** league band table: measured center + gate sd (n24 — realism.test.ts's
 *  window) and the derived tripwire [lo−z·sd .. hi+z·sd], before → after */
function leagueTable(oldNf, newNf, bands, z) {
  console.log(`league bands (gate window n24; tripwire = edge ± ${z ?? '?'}·sd — realism.test.ts):`);
  for (const b of bands) {
    const o = oldNf.league[b.metric];
    const n = newNf.league[b.metric];
    if (!o || !n) { console.log(`  ${b.metric.padEnd(10)} (no floor row ${o ? 'after' : 'before'} — regenerate/inspect by hand)`); continue; }
    const p = !!b.pct;
    const band = `[${fmtV(b.lo, p)} .. ${fmtV(b.hi, p)}]`;
    const center = `${fmtV(o.n24.mean, p)} → ${fmtV(n.n24.mean, p)}`;
    const sd = `${fmtV(o.n24.sd, p)} → ${fmtV(n.n24.sd, p)}`;
    const trip = z === null || b.ratchet
      ? (b.ratchet ? '(ratchet — reported, not gated)' : '(z unparsed — raw floors only)')
      : `[${fmtV(b.lo - z * o.n24.sd, p)} .. ${fmtV(b.hi + z * o.n24.sd, p)}] → [${fmtV(b.lo - z * n.n24.sd, p)} .. ${fmtV(b.hi + z * n.n24.sd, p)}]`;
    console.log(`  ${b.metric.padEnd(10)} band ${band}  center ${center}  sd ${sd}  tripwire ${trip}`);
  }
}

/** star target table: gate sd is the n12 window (fidelity.test.ts) */
function starTable(oldNf, newNf, targets, z) {
  console.log(`star targets (gate window n12; tripwire = edge ± ${z ?? '?'}·sd — fidelity.test.ts):`);
  for (const [starId, rows] of Object.entries(targets)) {
    const o = oldNf.stars[starId];
    const n = newNf.stars[starId];
    if (!o || !n) { console.log(`  ${starId}: (no floor rows ${o ? 'after' : 'before'})`); continue; }
    for (const t of rows) {
      const or = o[t.label];
      const nr = n[t.label];
      if (!or || !nr) { console.log(`  ${starId.replace('fid-', '').padEnd(7)} ${t.label.padEnd(10)} (no floor row)`); continue; }
      const p = !!t.pct;
      const target = `[${fmtV(t.lo, p)} .. ${fmtV(t.hi, p)}]`;
      const sd = `${fmtV(or.n12.sd, p)} → ${fmtV(nr.n12.sd, p)}`;
      const marks = `${t.ratchet ? ' (ratchet)' : ''}${t.quarantine ? ` (quarantined ${t.quarantine})` : ''}`;
      const trip = z === null || t.ratchet
        ? ''
        : `  tripwire [${fmtV(t.lo - z * or.n12.sd, p)} .. ${fmtV(t.hi + z * or.n12.sd, p)}] → [${fmtV(t.lo - z * nr.n12.sd, p)} .. ${fmtV(t.hi + z * nr.n12.sd, p)}]`;
      console.log(`  ${starId.replace('fid-', '').padEnd(7)} ${t.label.padEnd(10)} target ${target}  sd ${sd}${trip}${marks}`);
    }
  }
}

// -------------------------------------------------------------- seed pins

/** reanchor.ts's per-pin verify lines: `STATE    id (consumer) — detail` */
function parsePinStates(text) {
  const states = [];
  for (const m of text.matchAll(/^(ANCHORED|DEGRADED|STRANDED)\s+(\S+) \((.*?)\) — (.*)$/gm)) {
    states.push({ state: m[1], id: m[2], consumer: m[3], detail: m[4] });
  }
  return states;
}

/** reanchor --write's trailing report rows: `  id: from -> to` */
const parsePinReport = (text) =>
  [...text.matchAll(/^ {2}(\w+): (.+ -> .+)$/gm)].map((m) => `${m[1]}: ${m[2]}`);

// -------------------------------------------------------------- full suite

/** node --test's flat summary counts + failing test names (the same
 *  trailing-duration anchor reanchor.ts's confirmation parser uses) */
function parseSuite(text) {
  const counts = {};
  for (const m of text.matchAll(/^ℹ (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)/gm)) {
    counts[m[1]] = Number(m[2]);
  }
  const failing = [];
  let inSummary = false;
  for (const line of text.split('\n')) {
    if (line.includes('✖ failing tests:')) { inSummary = true; continue; }
    if (!inSummary) continue;
    const m = line.match(/✖ (.+) \([\d.]+m?s\)\s*$/);
    if (m !== null && m[1] !== undefined) failing.push(m[1]);
  }
  return { counts, failing: [...new Set(failing)] };
}

// -------------------------------------------------------------------- main

const summary = {
  canonical: null,
  corpusMoved: null,   // count, or null = not measured (dry-run early exit)
  corpusTotal: 0,
  floor: 'not measured (dry-run skips the regen; a moved corpus implies the floor moves with it)',
  pins: '?',
  suite: 'not run (dry-run)',
  debt: []
};

function artifactTable() {
  console.log('artifacts:');
  let anyMoved = false;
  for (const rel of ARTIFACTS) {
    const before = sha256(snapshot.get(rel));
    const after = sha256(readArtifact(rel));
    const moved = before !== after;
    anyMoved = anyMoved || moved;
    console.log(`  ${rel.padEnd(48)} ${short(before)} → ${short(after)}  ${moved ? 'MOVED' : 'unchanged'}`);
  }
  return anyMoved;
}

async function main() {
  console.log(`rebaseline${DRY ? ' (dry run — no writes)' : ''} — base tree snapshot taken (${ARTIFACTS.length} artifacts)`);

  // ---- guards: both green before any byte moves (issue #35's guard rule)
  rule('guards');
  guard(
    'invariant suite',
    ['--test', 'packages/engine/test/invariants.test.ts'],
    'invariants.log',
    'The invariants survive legitimate rng-order changes by construction (AGENTS §1.6): a red invariant suite is a broken engine, not a stale baseline.'
  );
  guard(
    'determinism gate',
    ['packages/harness/src/fingerprint.ts', '--determinism'],
    'determinism.log',
    'Same seed must mean bit-identical output (AGENTS §1.2). Baking goldens from a nondeterministic engine would launder ambient-state corruption into the reference corpus.'
  );

  // ---- the canonical (events)/FINAL fingerprint every report quotes
  rule('canonical fingerprint (seed fingerprint-1)');
  summary.canonical = canonicalFingerprint();
  console.log(`${summary.canonical.events} events, final ${summary.canonical.score}, replay sha ${summary.canonical.replaySha}…, pbp sha ${summary.canonical.pbpSha}…`);

  // ---- golden corpus
  rule('golden corpus');
  const oldCorpus = parseCorpus(snapshot.get(ARTIFACTS[0]).toString('utf8'));
  if (DRY) {
    const r = run(['packages/harness/src/fingerprint.ts'], { capture: true, logName: 'fingerprint-verify.log' });
    process.stdout.write(r.out);
    if (r.status !== 0 && r.status !== 1) throw new Error(`fingerprint verify exited ${r.status} (out/rebaseline/fingerprint-verify.log)`);
    summary.corpusTotal = Object.keys(oldCorpus).length;
    summary.corpusMoved = r.status === 0 ? 0 : (r.out.match(/hash mismatch|final score .+ → /g) ?? []).length;
    console.log(r.status === 0
      ? 'corpus: byte-identical — nothing to rebake'
      : 'corpus: STALE (deviations above) — a real run rebakes it');
  } else {
    const r = run(['packages/harness/src/fingerprint.ts', '--write']);
    if (r.status !== 0) throw new Error(`fingerprint --write exited ${r.status}`);
    const newCorpus = parseCorpus(readArtifact(ARTIFACTS[0]).toString('utf8'));
    const moved = corpusDelta(oldCorpus, newCorpus);
    summary.corpusTotal = Object.keys(newCorpus).length;
    summary.corpusMoved = moved.length;
    reportCorpus(moved, summary.corpusTotal);
  }

  // ---- noise floor (the long leg: ~3.1k games at the checked-in 40/16/8
  // sample basis; noisefloor.ts streams its own per-base progress)
  rule('noise floor');
  if (DRY) {
    console.log(summary.floor);
  } else {
    const r = run(['packages/harness/src/noisefloor.ts', '--mode', 'all']);
    if (r.status !== 0) throw new Error(`noisefloor --mode all exited ${r.status}`);
    const oldText = snapshot.get(ARTIFACTS[1]).toString('utf8');
    const newText = readArtifact(ARTIFACTS[1]).toString('utf8');
    if (normalizeStamp(oldText) === normalizeStamp(newText)) {
      // identical values ⇒ the checked-in measurement stands; a date-only
      // rewrite would churn the accepted-drift record and break the no-op
      writeFileSync(abs(ARTIFACTS[1]), snapshot.get(ARTIFACTS[1]));
      summary.floor = 'values identical — stamp-only regen discarded, checked-in measurement stands';
      console.log(summary.floor);
    } else {
      const oldNf = parseNoiseFloor(oldText);
      const newNf = parseNoiseFloor(newText);
      if (newNf.meta.leagueBases !== oldNf.meta.leagueBases || newNf.meta.starBases12 !== oldNf.meta.starBases12 || newNf.meta.starBases40 !== oldNf.meta.starBases40) {
        console.log(`NOTE: sample basis changed (${oldNf.meta.leagueBases}/${oldNf.meta.starBases12}/${oldNf.meta.starBases40} → ${newNf.meta.leagueBases}/${newNf.meta.starBases12}/${newNf.meta.starBases40}) — gate power moved with it`);
      }
      const { bands, targets } = readBandDefs();
      leagueTable(oldNf, newNf, bands, readZ('packages/harness/test/realism.test.ts'));
      console.log('');
      starTable(oldNf, newNf, targets, readZ('packages/harness/test/fidelity.test.ts'));
      summary.floor = 'moved — regenerated (band table above; the gen-file diff is the accepted-drift record)';
    }
  }

  // ---- seed pins, through the reanchor helper's own doctrine
  rule('seed pins (reanchor helper)');
  const pinsArgs = ['packages/harness/src/reanchor.ts', ...(DRY ? [] : ['--write'])];
  const pins = run(pinsArgs, { capture: true, logName: 'reanchor.log' });
  process.stdout.write(pins.out);
  const states = parsePinStates(pins.out);
  const stale = states.filter((s) => s.state !== 'ANCHORED');
  if (pins.status === 0) {
    const rows = parsePinReport(pins.out);
    summary.pins = rows.length > 0
      ? `re-anchored ${rows.length} (${rows.join('; ')})`
      : `all ${states.length} anchored — nothing to re-anchor`;
  } else if (DRY && stale.length > 0) {
    summary.pins = `${stale.length} stale (${stale.map((s) => s.id).join(', ')}) — a real run re-anchors via the helper`;
  } else {
    // the helper already restored (or refused before writing) its own
    // files; restore the rest of the rebaseline too — half a re-baseline
    // is worse than none
    throw new Error(`reanchor exited ${pins.status} — its refusal/confirmation output above is the diagnosis (out/rebaseline/reanchor.log)`);
  }

  // ---- final full suite: what remains red is the manual re-anchor debt
  if (!DRY) {
    rule('full suite (manual re-anchor debt check)');
    const suite = run(['--test', 'packages/*/test/*.test.ts'], { capture: true, logName: 'suite.log' });
    const { counts, failing } = parseSuite(suite.out);
    summary.suite = `tests ${counts.tests ?? '?'}, pass ${counts.pass ?? '?'}, fail ${counts.fail ?? '?'}, todo ${counts.todo ?? '?'}`;
    console.log(`${summary.suite} (full output: out/rebaseline/suite.log)`);
    if (suite.status !== 0 && failing.length === 0) {
      // a red run with no parsed names is a runner-level failure, not pin
      // debt — fail-safe like reanchor's classifier: restore, do not guess
      throw new Error('suite red but no failing-test names parsed — runner-level failure (out/rebaseline/suite.log)');
    }
    summary.debt = failing;
  }

  // ---- summary
  rule('rebaseline summary');
  const c = summary.canonical;
  console.log(`canonical fingerprint: ${c.events} events, ${c.score}, replay ${c.replaySha}…, pbp ${c.pbpSha}…`);
  console.log(`corpus: ${summary.corpusMoved}/${summary.corpusTotal} seeds moved`);
  console.log(`noise floor: ${summary.floor}`);
  console.log(`seed pins: ${summary.pins}`);
  console.log(`suite: ${summary.suite}`);
  if (summary.debt.length > 0) {
    console.log(`\nMANUAL RE-ANCHOR NEEDED — ${summary.debt.length} failing test${summary.debt.length === 1 ? '' : 's'} (this tool never edits test expectations; see the checksum-pin / pool re-scout choreography in recent mechanics PRs):`);
    for (const name of summary.debt) console.log(`  ✖ ${name}`);
  }
  const anyMoved = artifactTable();
  console.log(`\n${secs(t0)} total`);

  if (DRY) {
    const pending = (summary.corpusMoved ?? 0) > 0 || stale.length > 0;
    console.log(pending
      ? '\nDRY RUN — movement detected; run without --dry-run to rebaseline (exit 2).'
      : '\nDRY RUN — nothing would move (exit 0).');
    process.exitCode = pending ? 2 : 0;
    return;
  }
  if (!anyMoved) {
    console.log('\nNO-OP — every artifact byte-identical: the baselines already match this kernel.');
    return;
  }
  if (summary.debt.length > 0) {
    console.log('\nREBASELINED with manual debt — commit the artifact diffs together with the hand re-anchors above (exit 2 is never a full success).');
    process.exitCode = 2;
    return;
  }
  console.log('\nREBASELINED — review the artifact diffs and commit them with the change that moved the streams.');
}

try {
  await main();
} catch (err) {
  restoreAll(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
