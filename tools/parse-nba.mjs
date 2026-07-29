#!/usr/bin/env node
// tools/parse-nba.mjs — cached basketball-reference pbp HTML -> structured corpus (hoopsh data spine).
//
// Reads the gitignored raw cache written by tools/fetch-nba.mjs and produces:
//   data/nba/pbp-plays/plays-YYYY-MM.json   full per-game play arrays (monthly shards, committed)
//   data/nba/pbp-corpus.json                per-game derived metrics + corpus distributions (committed)
//   data/nba/flow-reference.json            regenerated values+distributions (only with --write-reference;
//                                           meta scholarship blocks are preserved verbatim)
//
// Usage:
//   npm run nba:parse                        # parse cache -> corpus files
//   npm run nba:parse -- --write-reference   # ...and regenerate flow-reference.json
//   node tools/parse-nba.mjs --games 202511050CLE,202601200CHI   # subset (debugging)
//
// OPERATIONAL DEFINITIONS mirror packages/harness/src/flow.ts (the sim side of the
// comparison) and the definitions documented in data/nba/flow-reference.json meta:
//   lead change   leader sign flips between two scoring events (ties counted once on entry)
//   run           maximal consecutive unanswered points (an 8-0 inside a 12-0 counts once)
//   drought       one team's longest gap between own scoring events, game clock,
//                 REGULATION ONLY, tip and final horn as endpoints
//   clutch        Q4, clock <= 2:00, margin within 5 BEFORE the scoring event;
//                 clutchFTShare = FT points / all points inside the window
//   Q4 comeback   a side's margin hits >= 10 at a scoring event in Q4 and that side loses
//   possession    boundaries = made FG (and-1 trips end at the final made FT), defensive
//                 rebound, turnover, made final FT of a plain trip ("N of N"), period end;
//                 length = game-clock seconds between boundaries (FT sequences freeze the clock)
//   putback       any FGA by the rebounding team within 6s of an OREB (scan stops at the
//                 next rebound/turnover) — PLAYER offensive rebounds as denominator
//                 (team-rebound bookkeeping rows, mostly dead-ball missed-FT artifacts, excluded)
//   steal->score  made FG by the stealing team within 6s of the steal (stops at rebound/turnover)
//   and-one       made FG with a "Shooting foul" row within 1s of game clock
// Deviations from the retired n=6 anchor implementation are quantified in the corpus
// meta (legacy* fields) and in flow-reference.json's changesVsAnchor block.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const cacheDir = flag('--cache-dir', 'data/nba/raw');
const outDir = flag('--out-dir', 'data/nba');
const onlyGames = flag('--games', null)?.split(',') ?? null;
const writeReference = argv.includes('--write-reference');

// ---------------------------------------------------------------- html -> plays
function stripTags(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPlays(html, id) {
  const tableMatch = html.match(/<table[^>]*id="pbp"[\s\S]*?<\/table>/);
  if (!tableMatch) throw new Error(`${id}: no pbp table`);
  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  const plays = [];
  let q = 1;
  for (const row of rows) {
    const headerText = stripTags(row);
    // The extraction match carries /i to agree with the /i gate: a lowercase
    // "start of…" header would pass the test and crash on [1] of a null match
    // (b7-F10; bbref has never emitted one — committed corpus unchanged).
    if (/Start of (\d)[a-z]{2} quarter/i.test(headerText)) { q = Number(headerText.match(/Start of (\d)/i)[1]); continue; }
    if (/Start of \d[a-z]{2} overtime/i.test(headerText)) { q += 1; continue; }
    const cells = (row.match(/<td[\s\S]*?<\/td>/g) ?? []).map(stripTags);
    if (cells.length < 2) continue;
    const t = cells[0].match(/^(\d+):(\d+)\.\d$/);
    if (!t) continue;
    const clockSec = Number(t[1]) * 60 + Number(t[2]);
    if (cells.length === 6) {
      const [, awayPlay, , score, , homePlay] = cells;
      const sc = score.match(/^(\d+)-(\d+)$/);
      const play = awayPlay && awayPlay.length > 1 ? { side: 'away', text: awayPlay }
        : homePlay && homePlay.length > 1 ? { side: 'home', text: homePlay } : null;
      if (play && sc) plays.push({ q, clockSec, side: play.side, text: play.text, a: Number(sc[1]), h: Number(sc[2]) });
    } else if (cells.length === 2 && cells[1].length > 1) {
      plays.push({ q, clockSec, side: null, text: cells[1], a: plays.at(-1)?.a ?? 0, h: plays.at(-1)?.h ?? 0 });
    }
  }
  if (plays.length < 100) throw new Error(`${id}: only ${plays.length} plays parsed`);
  return plays;
}

function extractGameMeta(html, id) {
  // scope to the scorebox block — the page-top "scores" strip links every game
  // of the date, so a whole-page scan grabs the wrong teams
  const box = html.match(/<div class="scorebox">[\s\S]*?<div class="scorebox_meta">/)?.[0];
  if (!box) throw new Error(`${id}: no scorebox block`);
  const teams = [...box.matchAll(/\/teams\/([A-Z]{3})\/\d{4}\.html/g)].map((m) => m[1]);
  const scores = [...box.matchAll(/class="score"[^>]*>(\d+)/g)].map((m) => Number(m[1]));
  const [away, home] = teams;
  if (!away || !home || scores.length < 2) throw new Error(`${id}: scorebox parse failed`);
  if (home !== id.slice(9)) throw new Error(`${id}: scorebox home ${home} != game-id suffix`);
  return { away, home, boxFinal: [scores[0], scores[1]], date: `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}` };
}

// game-clock seconds elapsed since tip (quarters 720s, OT periods 300s)
const elapsed = (p) => (p.q <= 4 ? (p.q - 1) * 720 + (720 - p.clockSec) : 2880 + (p.q - 5) * 300 + (300 - p.clockSec));
const periodStart = (q) => (q <= 4 ? (q - 1) * 720 : 2880 + (q - 5) * 300);
const periodEnd = (q) => (q <= 4 ? q * 720 : 2880 + (q - 4) * 300);
const REG = 2880;

// ---------------------------------------------------------------- validation
// The play stream must reproduce the final score two independent ways:
//  1. scoreboard column: last play's (a,h) == scorebox final
//  2. text-derived: every scoring event's score delta must equal the points its
//     text implies (3 for "makes 3-pt", 2 for "makes 2-pt", 1 for FTs), summed == final
function validateGame(plays, boxFinal) {
  const last = plays.at(-1);
  const scoreboardFinal = [last.a, last.h];
  let textA = 0, textH = 0, mismatches = 0;
  let prevA = 0, prevH = 0;
  for (const p of plays) {
    const dA = p.a - prevA, dH = p.h - prevH;
    if (dA < 0 || dH < 0 || (dA > 0 && dH > 0)) mismatches++;
    if (dA + dH > 0) {
      const txtPts = /makes 3-pt/.test(p.text) ? 3 : /makes 2-pt/.test(p.text) ? 2 : /makes .*free throw/.test(p.text) ? 1 : 0;
      const d = dA + dH;
      const side = dA > 0 ? 'away' : 'home';
      if (txtPts !== d || side !== p.side) mismatches++;
      if (dA > 0) textA += txtPts; else textH += txtPts;
    }
    prevA = p.a; prevH = p.h;
  }
  const ok = mismatches === 0
    && scoreboardFinal[0] === boxFinal[0] && scoreboardFinal[1] === boxFinal[1]
    && textA === boxFinal[0] && textH === boxFinal[1];
  return { ok, scoreboardFinal, textFinal: [textA, textH], boxFinal, mismatches };
}

// ---------------------------------------------------------------- flow metrics (mirrors harness/src/flow.ts)
function flowMetrics(plays) {
  let leadChanges = 0, ties = 0, largestLead = 0, leader = 0;
  let runs8 = 0, runs10 = 0, maxRun = 0, runSide = null, run = 0;
  const lastScoreT = { away: 0, home: 0 };
  const maxDrought = { away: 0, home: 0 };
  const qPts = [0, 0, 0, 0];
  let clutchPts = 0, clutchFTPts = 0;
  let led10InQ4 = false, q4Led10By = 0;
  let prevA = 0, prevH = 0;

  const closeRun = () => { if (run >= 8) runs8++; if (run >= 10) runs10++; maxRun = Math.max(maxRun, run); };

  for (const p of plays) {
    const dA = p.a - prevA, dH = p.h - prevH;
    if (dA + dH <= 0) continue;
    const side = dA > 0 ? 'away' : 'home';
    const pts = dA + dH;
    const e = elapsed(p);
    if (p.q >= 1 && p.q <= 4) qPts[p.q - 1] += pts;
    if (e <= REG) { // droughts: regulation only
      maxDrought[side] = Math.max(maxDrought[side], e - lastScoreT[side]);
      lastScoreT[side] = e;
    }
    if (runSide === side) run += pts;
    else { if (runSide !== null) closeRun(); runSide = side; run = pts; }
    const margin = p.a - p.h;
    const newLeader = margin > 0 ? 1 : margin < 0 ? -1 : 0;
    if (newLeader === 0 && leader !== 0) ties++;
    if (newLeader !== 0 && leader !== 0 && newLeader !== leader) leadChanges++;
    if (newLeader !== 0) leader = newLeader;
    largestLead = Math.max(largestLead, Math.abs(margin));
    if (p.q === 4 && p.clockSec <= 120 && Math.abs(prevA - prevH) <= 5) {
      clutchPts += pts;
      if (/free throw/i.test(p.text)) clutchFTPts += pts;
    }
    if (p.q === 4 && Math.abs(margin) >= 10) { led10InQ4 = true; q4Led10By = margin > 0 ? 1 : -1; }
    prevA = p.a; prevH = p.h;
  }
  closeRun();
  for (const s of ['away', 'home']) maxDrought[s] = Math.max(maxDrought[s], REG - lastScoreT[s]);
  const finalMargin = prevA - prevH;
  const led10Lost = led10InQ4 && ((q4Led10By > 0 && finalMargin < 0) || (q4Led10By < 0 && finalMargin > 0));
  return {
    leadChanges, ties, largestLead, runs8, runs10, maxRun,
    maxDroughtSec: Math.max(maxDrought.away, maxDrought.home),
    qPts, clutchPts, clutchFTPts,
    clutchShare: clutchPts > 0 ? clutchFTPts / clutchPts : null,
    led10InQ4, led10Lost, finalMargin: Math.abs(finalMargin)
  };
}

// ---------------------------------------------------------------- grammar metrics
const isFGA = (t) => /(makes|misses) [23]-pt/.test(t);
const isMadeFG = (t) => /makes [23]-pt/.test(t);
const isRebound = (t) => /rebound by/i.test(t);
const isTurnover = (t) => /Turnover by/i.test(t);

function grammarMetrics(plays) {
  let orebPlayer = 0, orebAll = 0, putback6 = 0, putback6LegacyDen = 0, putback6Legacy = 0;
  let steals = 0, stealScore6 = 0, stealScore6Legacy = 0, andOnes = 0;
  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    const e0 = elapsed(p);
    if (/Offensive rebound by/i.test(p.text)) {
      orebAll++;
      putback6LegacyDen++;
      const isTeam = /Offensive rebound by Team/i.test(p.text);
      if (!isTeam) {
        orebPlayer++;
        // primary: any FGA by the rebounding side within 6s; stop at next rebound/turnover
        for (let j = i + 1; j < plays.length && elapsed(plays[j]) - e0 <= 6; j++) {
          const t = plays[j].text;
          if (plays[j].side === p.side && isFGA(t)) { putback6++; break; }
          if (isRebound(t) || isTurnover(t)) break;
        }
      }
      // legacy (retired n=6 anchor implementation, kept only to quantify the definition change):
      // all OREB rows in the denominator, 2-pt attempts only, scan also stops at fouls
      for (let j = i + 1; j < plays.length && elapsed(plays[j]) - e0 <= 6; j++) {
        const t = plays[j].text;
        if (plays[j].side === p.side && /(makes|misses) 2-pt (layup|dunk|hook|jump)/i.test(t)) { putback6Legacy++; break; }
        if (/rebound|turnover|foul/i.test(t)) break;
      }
    }
    if (/steal by/i.test(p.text)) {
      steals++;
      const thiefSide = p.side === 'away' ? 'home' : 'away'; // turnover row sits in the loser's column
      // primary: made FG by the stealing side within 6s; stop at rebound/turnover
      for (let j = i + 1; j < plays.length && elapsed(plays[j]) - e0 <= 6; j++) {
        const t = plays[j].text;
        if (plays[j].side === thiefSide && isMadeFG(t)) { stealScore6++; break; }
        if (isRebound(t) || isTurnover(t)) break;
      }
      // legacy: any "makes" by any side (FTs included), stop at turnover/foul/miss
      for (let j = i + 1; j < plays.length && elapsed(plays[j]) - e0 <= 6; j++) {
        const t = plays[j].text;
        if (/makes/i.test(t)) { stealScore6Legacy++; break; }
        if (/turnover|foul|miss/i.test(t)) break;
      }
    }
    if (isMadeFG(p.text)) {
      for (let j = i + 1; j < plays.length && elapsed(plays[j]) - e0 <= 1; j++) {
        if (/Shooting foul/i.test(plays[j].text)) { andOnes++; break; }
      }
    }
  }
  return { orebPlayer, orebAll, putback6, putback6Legacy, putback6LegacyDen, steals, stealScore6, stealScore6Legacy, andOnes };
}

// ---------------------------------------------------------------- possession segmentation
// Boundary events end the current possession at their game-clock time:
//   made FG (unless an and-1 shooting foul follows within 1s — the trip's made final FT ends it),
//   defensive rebound (player or team), turnover, made final FT of a plain "N of N" trip
//   (technical/flagrant/clear-path FTs never match and correctly do not end possessions),
//   period end. Lengths are boundary-to-boundary within a period; team OREBs directly after a
//   missed non-final FT are dead-ball bookkeeping and do NOT mark a possession as second-chance.
function possessionMetrics(plays) {
  const lens = [];
  let secondChance = 0;
  let curStart = 0, curHadOreb = false, curQ = 1;

  const close = (at) => {
    const len = at - curStart;
    if (len >= 0) {
      lens.push(len);
      if (curHadOreb) secondChance++;
    }
    curStart = at;
    curHadOreb = false;
  };

  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    if (p.q !== curQ) { // period rolled: close at old period end, open at new period start
      close(periodEnd(curQ));
      curQ = p.q;
      curStart = periodStart(curQ);
      curHadOreb = false;
    }
    const e = elapsed(p);
    const t = p.text;
    if (/Offensive rebound by/i.test(t)) {
      const isTeam = /by Team/i.test(t);
      const prevRow = plays[i - 1];
      const ftArtifact = isTeam && prevRow && /misses .*free throw (\d) of (\d)/.test(prevRow.text)
        && prevRow.text.match(/(\d) of (\d)/)[1] !== prevRow.text.match(/(\d) of (\d)/)[2];
      if (!ftArtifact) curHadOreb = true;
      continue;
    }
    if (/Defensive rebound by/i.test(t)) { close(e); continue; }
    if (isTurnover(t)) { close(e); continue; }
    if (isMadeFG(t)) {
      let andOne = false;
      for (let j = i + 1; j < plays.length && elapsed(plays[j]) - e <= 1; j++) {
        if (/Shooting foul/i.test(plays[j].text)) { andOne = true; break; }
      }
      if (!andOne) close(e);
      continue;
    }
    const ft = t.match(/makes free throw (\d) of (\d)$/);
    if (ft && ft[1] === ft[2]) { close(e); continue; }
  }
  close(periodEnd(curQ)); // final horn
  // Drops ALL zero-length possessions (not just duplicates) from the length
  // stats. Known basis quirk (b7-F5): ~25 of the corpus's 379 zero-length
  // entries are live same-second tip-in trips whose OREB stays counted in the
  // secondChance numerator while the trip is excluded from n — ~0.5% relative
  // inflation of secondChanceShare, baked into the committed corpus. Changing
  // the basis requires re-baking pbp-corpus.json/flow-reference.json from the
  // raw HTML cache (not committed) — registered as an owner call.
  const cleaned = lens.filter((l, idx) => !(l === 0 && idx > 0));
  return { lens: cleaned, secondChance, n: cleaned.length };
}

// ---------------------------------------------------------------- stats helpers
const today = () => new Date().toLocaleDateString('sv'); // local YYYY-MM-DD
const round = (x, d = 2) => Number(x.toFixed(d));
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function dist(values, d = 2) {
  const v = values.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) : 0;
  return {
    n: v.length, mean: round(mean, d), stddev: round(sd, d),
    p10: round(percentile(v, 0.1), d), p50: round(percentile(v, 0.5), d), p90: round(percentile(v, 0.9), d),
    min: round(v[0], d), max: round(v[v.length - 1], d)
  };
}
function wilson95(k, n) {
  if (n === 0) return [0, 1];
  const z = 1.96, p = k / n;
  const den = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / den;
  return [round(Math.max(0, c - half), 3), round(Math.min(1, c + half), 3)];
}

// ---------------------------------------------------------------- main
const gameFiles = readdirSync(cacheDir)
  .filter((f) => /^\d{8}0[A-Z]{3}\.html$/.test(f))
  .map((f) => f.replace('.html', ''))
  .filter((id) => !onlyGames || onlyGames.includes(id))
  .sort();
if (gameFiles.length === 0) {
  console.error(`parse-nba: no cached games in ${cacheDir} — run npm run nba:fetch first`);
  process.exit(1);
}

const games = [];
const failures = [];
for (const id of gameFiles) {
  try {
    const html = readFileSync(join(cacheDir, `${id}.html`), 'utf8');
    const meta = extractGameMeta(html, id);
    const plays = extractPlays(html, id);
    const validation = validateGame(plays, meta.boxFinal);
    const flow = flowMetrics(plays);
    const grammar = grammarMetrics(plays);
    const poss = possessionMetrics(plays);
    const periods = plays.reduce((m, p) => Math.max(m, p.q), 0);
    games.push({ id, ...meta, ot: Math.max(0, periods - 4), plays, validation, flow, grammar, poss });
    if (!validation.ok) failures.push(id);
  } catch (err) {
    failures.push(id);
    games.push({ id, error: String(err.message ?? err) });
  }
}

const good = games.filter((g) => !g.error && g.validation.ok);
console.log(`parsed ${games.length} games: ${good.length} validated, ${failures.length} failed`);
for (const id of failures) {
  const g = games.find((x) => x.id === id);
  console.log(`  FAIL ${id}: ${g.error ?? JSON.stringify(g.validation)}`);
}

// ---------------------------------------------------------------- corpus aggregation (validated games only)
const per = (fn) => good.map(fn);
const sum = (fn) => good.reduce((s, g) => s + fn(g), 0);
const allPossLens = good.flatMap((g) => g.poss.lens).sort((a, b) => a - b);
const clutchGames = good.filter((g) => g.flow.clutchPts > 0);
const led10Games = good.filter((g) => g.flow.led10InQ4);
const led10LostGames = led10Games.filter((g) => g.flow.led10Lost);
const totalPoss = sum((g) => g.poss.n);

const distributions = {
  flow: {
    leadChangesPerGame: dist(per((g) => g.flow.leadChanges)),
    tiesPerGame: dist(per((g) => g.flow.ties)),
    largestLeadPerGame: dist(per((g) => g.flow.largestLead)),
    runs8PerGame: dist(per((g) => g.flow.runs8)),
    runs10PerGame: dist(per((g) => g.flow.runs10)),
    maxRunPerGame: dist(per((g) => g.flow.maxRun)),
    maxTeamDroughtSec: dist(per((g) => g.flow.maxDroughtSec), 0),
    quarterPts: [0, 1, 2, 3].map((i) => dist(per((g) => g.flow.qPts[i]), 1)),
    clutchFTShare: {
      ...dist(clutchGames.map((g) => g.flow.clutchShare), 3),
      pooled: round(clutchGames.reduce((s, g) => s + g.flow.clutchFTPts, 0) / Math.max(1, clutchGames.reduce((s, g) => s + g.flow.clutchPts, 0)), 3),
      qualifyingGames: clutchGames.length
    },
    q4Lead10LostRate: {
      rate: round(led10LostGames.length / Math.max(1, led10Games.length), 3),
      lost: led10LostGames.length, led10Games: led10Games.length,
      wilson95: wilson95(led10LostGames.length, led10Games.length),
      lostIds: led10LostGames.map((g) => g.id)
    },
    finalMargin: dist(per((g) => g.flow.finalMargin), 1),
    otGamesShare: round(good.filter((g) => g.ot > 0).length / good.length, 3)
  },
  possessions: {
    n: totalPoss,
    perGame: dist(per((g) => g.poss.n), 1),
    lengthSec: {
      mean: round(allPossLens.reduce((s, x) => s + x, 0) / allPossLens.length, 2),
      p10: round(percentile(allPossLens, 0.1), 1), p50: round(percentile(allPossLens, 0.5), 1), p90: round(percentile(allPossLens, 0.9), 1),
      share0to8: round(allPossLens.filter((x) => x <= 8).length / allPossLens.length, 3),
      share16plus: round(allPossLens.filter((x) => x >= 16).length / allPossLens.length, 3)
    },
    p50PerGame: dist(per((g) => percentile([...g.poss.lens].sort((a, b) => a - b), 0.5)), 1),
    secondChanceShare: {
      pooled: round(sum((g) => g.poss.secondChance) / totalPoss, 3),
      ...dist(per((g) => g.poss.secondChance / g.poss.n), 3)
    }
  },
  grammar: {
    putbackWithin6sShareOfOreb: {
      pooled: round(sum((g) => g.grammar.putback6) / sum((g) => g.grammar.orebPlayer), 3),
      ...dist(per((g) => (g.grammar.orebPlayer > 0 ? g.grammar.putback6 / g.grammar.orebPlayer : null)), 3),
      putbacks: sum((g) => g.grammar.putback6), orebPlayer: sum((g) => g.grammar.orebPlayer),
      legacyAnchorDefinition: round(sum((g) => g.grammar.putback6Legacy) / sum((g) => g.grammar.putback6LegacyDen), 3),
      orebAllRows: sum((g) => g.grammar.orebAll)
    },
    stealToScoreWithin6sShare: {
      pooled: round(sum((g) => g.grammar.stealScore6) / sum((g) => g.grammar.steals), 3),
      ...dist(per((g) => (g.grammar.steals > 0 ? g.grammar.stealScore6 / g.grammar.steals : null)), 3),
      conversions: sum((g) => g.grammar.stealScore6), steals: sum((g) => g.grammar.steals),
      legacyAnchorDefinition: round(sum((g) => g.grammar.stealScore6Legacy) / sum((g) => g.grammar.steals), 3)
    },
    andOnesPerGame: dist(per((g) => g.grammar.andOnes)),
    orebPlayerPerGame: dist(per((g) => g.grammar.orebPlayer), 1),
    stealsPerGame: dist(per((g) => g.grammar.steals), 1)
  }
};

// ---------------------------------------------------------------- write shards + corpus
mkdirSync(join(outDir, 'pbp-plays'), { recursive: true });
const byMonth = {};
for (const g of good) byMonth[g.date.slice(0, 7)] = [...(byMonth[g.date.slice(0, 7)] ?? []), g];
const playsFiles = [];
for (const [month, gs] of Object.entries(byMonth).sort()) {
  const file = `pbp-plays/plays-${month}.json`;
  playsFiles.push(file);
  const gameChunks = gs.map((g) => {
    const rows = g.plays.map((p) => JSON.stringify([p.q, p.clockSec, p.side === 'away' ? 'a' : p.side === 'home' ? 'h' : null, p.text, p.a, p.h]));
    return `"${g.id}":{"away":"${g.away}","home":"${g.home}","final":[${g.boxFinal[0]},${g.boxFinal[1]}],"plays":[\n${rows.join(',\n')}\n]}`;
  });
  const meta = {
    source: 'basketball-reference.com play-by-play pages (see data/nba/README.md for the pipeline)',
    month, games: gs.length,
    columns: ['q', 'clockSec', 'side(a=away,h=home,null=neutral)', 'text', 'awayScore', 'homeScore'],
    note: 'Rows are tuples to keep the committed corpus compact; q>=5 are 300s overtime periods.'
  };
  const json = `{"meta":${JSON.stringify(meta)},"games":{\n${gameChunks.join(',\n')}\n}}`;
  JSON.parse(json); // self-check
  writeFileSync(join(outDir, file), json);
  console.log(`wrote ${file}: ${gs.length} games`);
}

const corpus = {
  meta: {
    purpose: 'Real-NBA play-by-play corpus for the data spine: per-game derived flow/grammar metrics plus corpus distributions. Full play arrays live in pbp-plays/ shards; raw HTML stays out of git (data/nba/raw/, gitignored).',
    source: 'https://www.basketball-reference.com/boxscores/pbp/<gameId>.html',
    season: '2025-26 regular season',
    generatedAt: today(),
    pipeline: 'npm run nba:fetch -- --season 2025-26 && npm run nba:parse -- --write-reference',
    games: good.length,
    failed: failures,
    dates: Object.fromEntries(Object.entries(good.reduce((m, g) => { m[g.date] = (m[g.date] ?? 0) + 1; return m; }, {})).sort()),
    validation: {
      pass: good.length, fail: failures.length,
      checks: 'per game: (1) score column is monotonic and one-sided per event, (2) every scoring event’s delta equals the points its text implies, (3) text-summed points == scoreboard final == scorebox final for both teams'
    },
    playsFiles,
    definitions: 'see header of tools/parse-nba.mjs and data/nba/flow-reference.json meta.definitions'
  },
  distributions,
  games: good.map((g) => ({
    id: g.id, date: g.date, away: g.away, home: g.home, final: g.boxFinal, ot: g.ot, plays: g.plays.length,
    flow: { ...g.flow, clutchShare: g.flow.clutchShare === null ? null : round(g.flow.clutchShare, 3) },
    grammar: g.grammar,
    poss: {
      n: g.poss.n, secondChance: g.poss.secondChance,
      meanLen: round(g.poss.lens.reduce((s, x) => s + x, 0) / g.poss.n, 2),
      p50Len: round(percentile([...g.poss.lens].sort((a, b) => a - b), 0.5), 1)
    }
  }))
};
writeFileSync(join(outDir, 'pbp-corpus.json'), JSON.stringify(corpus, null, 1));
console.log(`wrote pbp-corpus.json: ${good.length} games, ${totalPoss} possessions`);

// ---------------------------------------------------------------- reference regeneration
if (writeReference) {
  const refPath = join(outDir, 'flow-reference.json');
  const old = JSON.parse(readFileSync(refPath, 'utf8'));
  const d = distributions;
  const strip = (x) => { const { min, max, ...rest } = x; return rest; };
  const gDist = (x) => ({ ...strip(x), unit: 'per game' });

  const flow = {
    leadChangesPerGame: { value: d.flow.leadChangesPerGame.mean, range: [d.flow.leadChangesPerGame.min, d.flow.leadChangesPerGame.max], dist: gDist(d.flow.leadChangesPerGame), grade: 'A', basis: `corpus n=${good.length} (2025-26), strict scoring-event leader flips (ties excluded; a tie counted once on entry). Published looser definitions (every flip inside FT sequences) run far higher — see meta.publishedSources.` },
    tiesPerGame: { value: d.flow.tiesPerGame.mean, range: [d.flow.tiesPerGame.min, d.flow.tiesPerGame.max], dist: gDist(d.flow.tiesPerGame), grade: 'A', basis: `corpus n=${good.length}: scoring events that produce a tie from a led state` },
    largestLeadPerGame: { value: d.flow.largestLeadPerGame.mean, range: [d.flow.largestLeadPerGame.min, d.flow.largestLeadPerGame.max], dist: gDist(d.flow.largestLeadPerGame), grade: 'A', basis: `corpus n=${good.length}: max absolute margin at any scoring event (OT included)` },
    runs8PerGame: { value: d.flow.runs8PerGame.mean, range: [d.flow.runs8PerGame.min, d.flow.runs8PerGame.max], dist: gDist(d.flow.runs8PerGame), grade: 'A', basis: `corpus n=${good.length}: maximal unanswered runs >= 8-0` },
    runs10PerGame: { value: d.flow.runs10PerGame.mean, range: [d.flow.runs10PerGame.min, d.flow.runs10PerGame.max], dist: gDist(d.flow.runs10PerGame), grade: 'A', basis: `corpus n=${good.length}: maximal unanswered runs >= 10-0` },
    maxRunPerGame: { value: d.flow.maxRunPerGame.mean, range: [d.flow.maxRunPerGame.min, d.flow.maxRunPerGame.max], dist: gDist(d.flow.maxRunPerGame), grade: 'A', basis: `corpus n=${good.length}: largest maximal unanswered run per game` },
    maxTeamDroughtSec: { value: d.flow.maxTeamDroughtSec.mean, range: [d.flow.maxTeamDroughtSec.min, d.flow.maxTeamDroughtSec.max], dist: gDist(d.flow.maxTeamDroughtSec), grade: 'A', basis: `corpus n=${good.length}: one team's longest gap between own scores, regulation only, tip/horn endpoints` },
    quarterPtsProfile: { value: d.flow.quarterPts.map((x) => x.mean), dist: { q1: strip(d.flow.quarterPts[0]), q2: strip(d.flow.quarterPts[1]), q3: strip(d.flow.quarterPts[2]), q4: strip(d.flow.quarterPts[3]) }, grade: 'A', basis: `corpus n=${good.length}, both teams combined, regulation quarters` },
    clutchFTShare: { value: d.flow.clutchFTShare.mean, range: [d.flow.clutchFTShare.min, d.flow.clutchFTShare.max], dist: { ...strip(d.flow.clutchFTShare), unit: 'per qualifying game' }, grade: 'A', basis: `corpus: ${d.flow.clutchFTShare.qualifyingGames} of ${good.length} games had scoring inside the window (Q4, clock<=2:00, margin<=5 before the event). value = mean of per-game FT-point shares (matches flow.ts aggregation); pooled points ratio = ${d.flow.clutchFTShare.pooled}. The foul-game spike concentrates in the final ~40s.` },
    q4Lead10LostRate: { value: d.flow.q4Lead10LostRate.rate, range: d.flow.q4Lead10LostRate.wilson95, dist: { n: d.flow.q4Lead10LostRate.led10Games, lost: d.flow.q4Lead10LostRate.lost, wilson95: d.flow.q4Lead10LostRate.wilson95, unit: 'share of games with a 10+ Q4 lead' }, grade: 'A', basis: `corpus: ${d.flow.q4Lead10LostRate.lost} of ${d.flow.q4Lead10LostRate.led10Games} games where a side's margin reached >= 10 at a Q4 scoring event ended with that side losing (range = Wilson 95% CI). Direct computation replaces the derived win-probability estimate.` },
    possessionP50Sec: { value: d.possessions.lengthSec.p50, range: [d.possessions.lengthSec.p10, d.possessions.lengthSec.p90], dist: { n: d.possessions.n, mean: d.possessions.lengthSec.mean, p10: d.possessions.lengthSec.p10, p50: d.possessions.lengthSec.p50, p90: d.possessions.lengthSec.p90, unit: 'seconds, pooled possessions (range = p10/p90)' }, grade: 'A', basis: `corpus: ${d.possessions.n} possessions segmented from pbp (boundaries: made FG with and-1 trips ending at the final FT, defensive rebound, turnover, made final FT, period end). Mean ${d.possessions.lengthSec.mean}s cross-checks published ~14.7s (inpredictable 2017-18, pre-OREB-reset era). Possessions/game: mean ${d.possessions.perGame.mean}.` },
    possessionShare0to8: { value: d.possessions.lengthSec.share0to8, dist: { n: d.possessions.n, unit: 'share of pooled possessions with length <= 8s' }, grade: 'A', basis: `corpus, same segmentation as possessionP50Sec — reference for flow.ts's possShare0to8 report line (previously unreferenced)` },
    possessionShare16plus: { value: d.possessions.lengthSec.share16plus, dist: { n: d.possessions.n, unit: 'share of pooled possessions with length >= 16s' }, grade: 'A', basis: `corpus, same segmentation — reference for flow.ts's possShare16plus report line (previously unreferenced)` }
  };
  const grammar = {
    putbackWithin6sShareOfOreb: { value: d.grammar.putbackWithin6sShareOfOreb.pooled, range: [d.grammar.putbackWithin6sShareOfOreb.min, d.grammar.putbackWithin6sShareOfOreb.max], dist: { ...strip(d.grammar.putbackWithin6sShareOfOreb), unit: 'per game share; value = pooled' }, grade: 'A', basis: `corpus: ${d.grammar.putbackWithin6sShareOfOreb.putbacks} putback FGAs within 6s of ${d.grammar.putbackWithin6sShareOfOreb.orebPlayer} PLAYER offensive rebounds (any next FGA by the rebounding team, scan stops at rebound/turnover — mirrors flow.ts). DEFINITION FIX vs the n=6 anchor: the anchor divided by ALL OREB rows including ${d.grammar.putbackWithin6sShareOfOreb.orebAllRows - d.grammar.putbackWithin6sShareOfOreb.orebPlayer} team-rebound bookkeeping rows (mostly dead-ball missed-FT artifacts) and counted only 2-pt attempts; that legacy definition yields ${d.grammar.putbackWithin6sShareOfOreb.legacyAnchorDefinition} on this corpus (anchor said 0.33). CTG's ~3s halfcourt-only standard is narrower still — see meta.publishedSources.grammar.` },
    stealToScoreWithin6sShare: { value: d.grammar.stealToScoreWithin6sShare.pooled, range: [d.grammar.stealToScoreWithin6sShare.min, d.grammar.stealToScoreWithin6sShare.max], dist: { ...strip(d.grammar.stealToScoreWithin6sShare), unit: 'per game share; value = pooled' }, grade: 'A', basis: `corpus: ${d.grammar.stealToScoreWithin6sShare.conversions} of ${d.grammar.stealToScoreWithin6sShare.steals} steals converted to a made FG by the stealing team within 6s (mirrors flow.ts: FTs excluded, scan stops at rebound/turnover). DEFINITION FIX vs the n=6 anchor implementation, which counted any 'makes' by either side incl. FTs; that legacy definition yields ${d.grammar.stealToScoreWithin6sShare.legacyAnchorDefinition} on this corpus (anchor said 0.29).` },
    andOnesPerGame: { value: d.grammar.andOnesPerGame.mean, range: [d.grammar.andOnesPerGame.min, d.grammar.andOnesPerGame.max], dist: gDist(d.grammar.andOnesPerGame), grade: 'A', basis: `corpus n=${good.length}, both teams: made FG with a shooting-foul row within 1s of game clock` },
    secondChanceShareOfPoss: { value: d.possessions.secondChanceShare.pooled, range: [d.possessions.secondChanceShare.min, d.possessions.secondChanceShare.max], dist: { ...strip(d.possessions.secondChanceShare), unit: 'per game share; value = pooled' }, grade: 'A', basis: `corpus: share of ALL possessions (both teams pooled) containing >= 1 live offensive rebound (team-rebound rows directly after missed non-final FTs excluded as dead-ball bookkeeping). NOTE for flow.ts: its report divides both-team second-chance possessions by poss/2 (a per-team denominator), which reads ~2x this definition — reconcile before gating.` }
  };

  // material-change ledger vs the retired n=6 anchor (>15% relative move flagged)
  const anchor = { leadChangesPerGame: 6.5, tiesPerGame: 5.7, largestLeadPerGame: 21.3, runs8PerGame: 3.3, runs10PerGame: 1.8, maxRunPerGame: 12.5, maxTeamDroughtSec: 295, clutchFTShare: 0.35, q4Lead10LostRate: 0.07, possessionP50Sec: 12.5, putbackWithin6sShareOfOreb: 0.33, stealToScoreWithin6sShare: 0.29, andOnesPerGame: 4.8, secondChanceShareOfPoss: 0.13 };
  const changesVsAnchor = {};
  for (const [k, oldV] of Object.entries(anchor)) {
    const entry = flow[k] ?? grammar[k];
    const newV = entry.value;
    const rel = oldV === 0 ? null : (newV - oldV) / oldV;
    changesVsAnchor[k] = { anchor: oldV, corpus: newV, relChange: round(rel, 3), material: Math.abs(rel) > 0.15 };
  }
  const qOld = [58.5, 56.3, 58.0, 54.2];
  changesVsAnchor.quarterPtsProfile = { anchor: qOld, corpus: flow.quarterPtsProfile.value, relChange: qOld.map((o, i) => round((flow.quarterPtsProfile.value[i] - o) / o, 3)), material: qOld.some((o, i) => Math.abs((flow.quarterPtsProfile.value[i] - o) / o) > 0.15) };

  const ref = {
    meta: {
      purpose: 'Real-NBA reference values for game-FLOW metrics (harness/src/flow.ts) and event-grammar magnitudes, with distributions. Every value carries provenance and is regenerated by tools/parse-nba.mjs from the committed pbp corpus — never hand-typed.',
      primarySample: {
        what: `${good.length} 2025-26 regular-season games parsed from public basketball-reference play-by-play pages, spread over ${Object.keys(corpus.meta.dates).length} dates across the season (composition in data/nba/pbp-corpus.json meta.dates); metrics computed with the operational definitions flow.ts applies to sim events (meta.definitions below).`,
        corpusFile: 'data/nba/pbp-corpus.json',
        validation: `${good.length}/${games.length} games pass the three-way score validation (play-stream points == text-derived points == scorebox final)${failures.length ? `; failures: ${failures.join(', ')}` : ''}`,
        caveat: 'Grading scheme (extended at the corpus milestone, provenance-first as before): grade A = published multi-season data with methodology OR computed from this validated n>=100 primary corpus with a stated definition; grade B = computed from primary play-by-play at small n or with a thin definition; grade C = derived/provisional. Distributions are per-game unless the dist.unit says otherwise; value is the per-game mean unless the basis says pooled.'
      },
      previousAnchor: {
        note: 'The retired n=6 anchor this corpus replaces (kept for scholarship; deltas in meta.changesVsAnchor).',
        gameIds: old.meta.previousAnchor?.gameIds ?? old.meta.primarySample?.gameIds ?? null // survives re-runs
      },
      generatedAt: today(),
      generatedBy: 'tools/parse-nba.mjs --write-reference',
      definitions: {
        leadChange: 'scoreboard leader flips sign between two scoring events; tie interludes are not changes; a tie is counted once when entered from a led state',
        run: 'maximal consecutive unanswered points (an 8-0 inside a 12-0 counts once); OT included',
        drought: "one team's longest gap between its own scoring events on the game clock, regulation only, tip and final horn as endpoints",
        clutch: 'Q4, game clock <= 2:00, margin within 5 BEFORE the scoring event; clutchFTShare = FT points / all points inside the window, averaged per qualifying game',
        q4Comeback: "a side's margin reaches >= 10 at a scoring event in Q4 and that side loses the game (mirrors flow.ts: evaluated at scoring events, so a 10+ lead carried into Q4 registers at the first Q4 scoring event that keeps it >= 10)",
        possession: 'boundaries = made FG (and-1 trips end at the made final FT), defensive rebound (player or team), turnover, made final FT of a plain N-of-N trip, period end; length = game-clock seconds between boundaries (FT sequences freeze the clock); technical/flagrant/clear-path FTs do not end possessions',
        putback: 'any FGA by the rebounding team within 6s (game clock) of a PLAYER offensive rebound; forward scan stops at the next rebound/turnover',
        stealToScore: 'made FG (FTs excluded) by the stealing team within 6s of the steal; scan stops at rebound/turnover',
        andOne: 'made FG with a shooting-foul row within 1s of the same game clock',
        ambiguitiesResolved: [
          'OREB denominator: bbref logs "Offensive rebound by Team" bookkeeping rows (mostly dead-ball after missed non-final FTs) — excluded from the putback denominator and from second-chance marking; the sim has no team-rebound events so player rebounds are the comparable base. Anchor-definition values are preserved in dist.legacyAnchorDefinition.',
          'putback numerator: meta scholarship says "any next shot" and flow.ts counts any FGA, but the anchor implementation counted only 2-pt layup/dunk/hook/jump and also stopped at fouls — corpus uses any-FGA/stop-at-rebound-or-turnover to mirror flow.ts.',
          'steal conversion: anchor implementation counted any "makes" by either side including FTs; corpus requires a made FG by the stealing side (mirrors flow.ts).',
          'drought: anchor implementation let OT scoring events extend droughts in OT games despite the regulation-only definition; corpus enforces regulation-only strictly.',
          'possession segmentation cannot see mid-game jump-ball flips or away-from-play FT retentions (both rare); flagrant/clear-path FT phrasings never match the plain N-of-N boundary regex, so those trips correctly do not end possessions.',
          'secondChanceShareOfPoss denominator is ALL possessions (both teams pooled); flow.ts currently divides by poss/2 — reconcile on the sim side before gating.'
        ]
      },
      changesVsAnchor,
      publishedSources: old.meta.publishedSources,
      turingBaseline: old.meta.turingBaseline
    },
    flow,
    grammar
  };
  writeFileSync(refPath, JSON.stringify(ref, null, 1));
  console.log(`wrote flow-reference.json (grades upgraded, distributions attached, meta scholarship preserved)`);
  console.log('\nmaterial changes vs n=6 anchor:');
  for (const [k, c] of Object.entries(changesVsAnchor)) {
    if (c.material) console.log(`  ${k}: ${JSON.stringify(c.anchor)} -> ${JSON.stringify(c.corpus)} (${Array.isArray(c.relChange) ? c.relChange.map((x) => `${round(x * 100, 0)}%`).join('/') : `${round(c.relChange * 100, 0)}%`})`);
  }
}

console.log('\ncorpus summary:');
console.log(JSON.stringify(distributions, null, 1).slice(0, 4000));
