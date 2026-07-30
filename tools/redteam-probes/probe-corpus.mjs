// Usage (from repo root): node --disable-warning=ExperimentalWarning --import ./tools/register.mjs tools/redteam-probes/probe-corpus.mjs
// Probe 5: corpus integrity — shards vs pbp-corpus.json vs distributions vs flow-reference.json.
// Uses parse-nba.mjs's OWN pure functions (extracted verbatim) so this tests the DATA, not my re-implementation.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Repo root derived from this script's own location (tools/redteam-probes/), not from cwd.
const R = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(`${R}/tools/parse-nba.mjs`, 'utf8');
const grab = (start, end) => {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`cannot extract ${start}`);
  return src.slice(i, j);
};
let code = '';
code += grab('const elapsed =', '// ---------------------------------------------------------------- validation');
code += grab('function validateGame', '// ---------------------------------------------------------------- flow metrics');
code += grab('function flowMetrics', '// ---------------------------------------------------------------- grammar metrics');
code += grab('const isFGA =', '// ---------------------------------------------------------------- possession segmentation');
code += grab('function possessionMetrics', '// ---------------------------------------------------------------- stats helpers');
code += 'const round = (x, d = 2) => Number(x.toFixed(d));\n';
const pi = src.indexOf('function percentile');
code += src.slice(pi, src.indexOf('\n}', pi) + 2);
// parse-nba.mjs exports its pure functions for tests; `export` is illegal
// inside a Function body, so strip the keyword — the code stays verbatim.
code = code.replace(/^export (?=function|const)/gm, '');
const fns = new Function(`${code}; return { validateGame, flowMetrics, grammarMetrics, possessionMetrics, percentile };`)();
const round = (x, d = 2) => Number(x.toFixed(d));

const corpus = JSON.parse(readFileSync(`${R}/data/nba/pbp-corpus.json`, 'utf8'));
const flowRef = JSON.parse(readFileSync(`${R}/data/nba/flow-reference.json`, 'utf8'));

// 1. shard union vs corpus ids
const shardGames = new Map();
for (const f of corpus.meta.playsFiles) {
  const shard = JSON.parse(readFileSync(`${R}/data/nba/${f}`, 'utf8'));
  for (const [id, g] of Object.entries(shard.games)) {
    if (shardGames.has(id)) console.log('DUP across shards:', id);
    shardGames.set(id, g);
  }
}
const corpusIds = corpus.games.map((g) => g.id);
console.log(`shards: ${shardGames.size} games; corpus rows: ${corpusIds.length}; unique corpus ids: ${new Set(corpusIds).size}`);
const missing = corpusIds.filter((id) => !shardGames.has(id));
const extra = [...shardGames.keys()].filter((id) => !corpusIds.includes(id));
if (missing.length || extra.length) console.log('ID MISMATCH — missing from shards:', missing, 'extra in shards:', extra);

// 2-4. per-game: three-way score validation + recompute all derived metrics
let valFail = 0, metricFail = 0, checkedFields = 0;
const near = (a, b) => (a === b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
for (const row of corpus.games) {
  const sg = shardGames.get(row.id);
  if (!sg) continue;
  const plays = sg.plays.map(([q, clockSec, side, text, a, h]) => ({ q, clockSec, side: side === 'a' ? 'away' : side === 'h' ? 'home' : null, text, a, h }));
  // shard final vs corpus final vs teams
  if (sg.final[0] !== row.final[0] || sg.final[1] !== row.final[1] || sg.away !== row.away || sg.home !== row.home) {
    console.log(`${row.id}: shard header != corpus row`, sg.final, row.final, sg.away, sg.home, row.away, row.home);
    valFail++;
  }
  if (plays.length !== row.plays) { console.log(`${row.id}: plays count ${plays.length} != corpus ${row.plays}`); valFail++; }
  const v = fns.validateGame(plays, sg.final);
  if (!v.ok) { console.log(`${row.id}: VALIDATION FAIL`, JSON.stringify(v)); valFail++; }
  // OT flag: corpus row.ot vs max q
  const maxQ = Math.max(...plays.map((p) => p.q));
  if ((maxQ - 4 > 0 ? maxQ - 4 : 0) !== row.ot) { console.log(`${row.id}: ot ${row.ot} != derived ${maxQ - 4}`); valFail++; }

  const fm = fns.flowMetrics(plays);
  for (const k of Object.keys(row.flow)) {
    checkedFields++;
    const got = k === 'qPts' ? JSON.stringify(fm.qPts) : k === 'clutchShare' ? (fm.clutchShare === null ? null : round(fm.clutchShare, 3)) : fm[k];
    const want = k === 'qPts' ? JSON.stringify(row.flow.qPts) : row.flow[k];
    if (!near(got, want)) { metricFail++; if (metricFail < 8) console.log(`${row.id}: flow.${k} recomputed ${got} != corpus ${want}`); }
  }
  const gm = fns.grammarMetrics(plays);
  for (const k of Object.keys(row.grammar)) {
    checkedFields++;
    if (!near(gm[k], row.grammar[k])) { metricFail++; if (metricFail < 8) console.log(`${row.id}: grammar.${k} ${gm[k]} != ${row.grammar[k]}`); }
  }
  const pm = fns.possessionMetrics(plays);
  const wantPoss = { n: pm.n, secondChance: pm.secondChance, meanLen: round(pm.lens.reduce((a, b) => a + b, 0) / pm.n, 2), p50Len: round(fns.percentile([...pm.lens].sort((a, b) => a - b), 0.5), 1) };
  for (const k of Object.keys(row.poss)) {
    checkedFields++;
    if (!near(wantPoss[k], row.poss[k])) { metricFail++; if (metricFail < 8) console.log(`${row.id}: poss.${k} ${wantPoss[k]} != ${row.poss[k]}`); }
  }
}
console.log(`validation failures: ${valFail}; metric mismatches: ${metricFail} of ${checkedFields} fields checked`);

// 5. distributions full recompute (mirror parse-nba's dist(): mean/stddev/p10/p50/p90/min/max)
const per = (f) => corpus.games.map(f).filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
// Mirrors parse-nba's dist() exactly: SAMPLE stddev (/(n-1), not /n) and
// rounded min/max — the probe previously used the population formula and
// reported false MISMATCHes on stddev against a corpus that was right (b7-F2).
const dist = (vals, d = 2) => {
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)) : 0;
  return { n: vals.length, mean: round(mean, d), stddev: round(sd, d), p10: round(fns.percentile(vals, 0.1), d), p50: round(fns.percentile(vals, 0.5), d), p90: round(fns.percentile(vals, 0.9), d), min: round(vals[0], d), max: round(vals[vals.length - 1], d) };
};
const D = corpus.distributions.flow;
const mineFlow = {
  leadChangesPerGame: dist(per((g) => g.flow.leadChanges)),
  tiesPerGame: dist(per((g) => g.flow.ties)),
  largestLeadPerGame: dist(per((g) => g.flow.largestLead)),
  runs8PerGame: dist(per((g) => g.flow.runs8)),
  runs10PerGame: dist(per((g) => g.flow.runs10)),
  maxRunPerGame: dist(per((g) => g.flow.maxRun)),
  // corpus key + d=0 rounding per parse-nba.mjs — the probe used to invent a
  // `maxDroughtSecPerGame` key and print MISSING on every run (b7-F2)
  maxTeamDroughtSec: dist(per((g) => g.flow.maxDroughtSec), 0)
};
let distBad = 0;
for (const [k, mine] of Object.entries(mineFlow)) {
  const theirs = D[k];
  if (!theirs) { console.log(`distributions.flow.${k}: MISSING (keys: ${Object.keys(D).join(",")})`); distBad++; continue; }
  const fields = Object.keys(mine).filter((f) => f in theirs);
  const diffs = fields.filter((f) => !near(mine[f], theirs[f]));
  if (diffs.length) { distBad++; console.log(`distributions.flow.${k} MISMATCH on ${diffs.join(",")}: mine=${JSON.stringify(mine)} theirs=${JSON.stringify(theirs)}`); }
  else console.log(`distributions.flow.${k}: MATCH (${fields.length} fields)`);
}
// pooled possession lengths
const allLens = [];
for (const row of corpus.games) {
  const sg = shardGames.get(row.id);
  const plays = sg.plays.map(([q, clockSec, side, text, a, h]) => ({ q, clockSec, side: side === "a" ? "away" : side === "h" ? "home" : null, text, a, h }));
  allLens.push(...fns.possessionMetrics(plays).lens);
}
allLens.sort((a, b) => a - b);
const P = corpus.distributions.possessions;
const poolMine = { n: allLens.length, mean: round(allLens.reduce((a, b) => a + b, 0) / allLens.length, 2), p10: round(fns.percentile(allLens, 0.1), 1), p50: round(fns.percentile(allLens, 0.5), 1), p90: round(fns.percentile(allLens, 0.9), 1) };
const poolTheirs = { n: P.n, mean: P.lengthSec.mean, p10: P.lengthSec.p10, p50: P.lengthSec.p50, p90: P.lengthSec.p90 };
const pooledOk = JSON.stringify(poolMine) === JSON.stringify(poolTheirs);
console.log("pooled poss:", pooledOk ? "MATCH" : `MISMATCH mine=${JSON.stringify(poolMine)} theirs=${JSON.stringify(poolTheirs)}`);

// 6. flow-reference.json `dist` blocks must equal corpus distributions
const fr = flowRef.flow;
const map = { leadChangesPerGame: "leadChangesPerGame", tiesPerGame: "tiesPerGame", largestLeadPerGame: "largestLeadPerGame", runs8PerGame: "runs8PerGame", runs10PerGame: "runs10PerGame", maxRunPerGame: "maxRunPerGame" };
let frBad = 0;
for (const [frk, dk] of Object.entries(map)) {
  const a = fr[frk]?.dist, b = D[dk];
  if (!a || !b) { console.log(`flow-reference ${frk}: missing dist`); frBad++; continue; }
  const fields = ["n","mean","p10","p50","p90"];
  const diffs = fields.filter((f) => !near(a[f], b[f]));
  if (diffs.length) { frBad++; console.log(`flow-reference ${frk} vs corpus MISMATCH on ${diffs}: ref=${JSON.stringify(a)} corpus=${JSON.stringify(b)}`); }
}
console.log(`flow-reference dist blocks vs corpus: ${frBad === 0 ? "ALL MATCH" : frBad + " mismatched"}`);
console.log(`fr.leadChanges value=${fr.leadChangesPerGame.value} (corpus mean ${D.leadChangesPerGame.mean})`);

// Exit-code discipline (b7-F6): any printed FAIL/MISMATCH/MISSING above must
// not exit 0 — this probe is cited as re-runnable corpus evidence.
const totalBad = valFail + metricFail + distBad + frBad + missing.length + extra.length + (pooledOk ? 0 : 1);
if (totalBad > 0) process.exitCode = 1;
