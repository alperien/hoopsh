#!/usr/bin/env node
// tools/fetch-nba.mjs — polite basketball-reference play-by-play fetcher (hoopsh data spine).
//
// Downloads raw pbp HTML into a gitignored cache (data/nba/raw/). The parser
// (tools/parse-nba.mjs) turns that cache into the committed corpus
// (data/nba/pbp-corpus.json + data/nba/pbp-plays/). Raw HTML never enters git.
//
// Usage:
//   npm run nba:fetch -- --season 2025-26           # built-in date spread (the corpus composition)
//   npm run nba:fetch -- --dates 2025-11-05,2026-01-20
//   npm run nba:fetch -- --games 202511050CLE,202601200CHI
//
// Flags:
//   --cache-dir data/nba/raw   where raw HTML lands (gitignored)
//   --delay-ms 3500            spacing between HTTP requests (hard floor 2000ms)
//   --limit N                  stop after N game-page fetches (testing)
//   --dry-run                  list what would be fetched, no network
//
// Politeness contract (courtesy-critical — do not weaken):
//   * strictly sequential; >= 2s between ANY two requests (default 3.5s ~ 17 req/min,
//     under basketball-reference's published 20 req/min crawl ceiling)
//   * resumable: files already in the cache are skipped without touching the network
//   * 429/5xx -> one 65s backoff and one retry, then abort loudly (never hammer)
//   * honest User-Agent identifying the research use

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flagNumber, flagValue } from './args.mjs';

const BASE = 'https://www.basketball-reference.com';
const UA = 'hoopsh-data-spine/1.0 (research corpus for a basketball simulator; polite sequential fetch)';

// The declared corpus composition: dates spread across the 2025-26 regular
// season (2-4 per month, mixed weekdays/weekends, avoiding the All-Star break
// and league holidays). Every game played on these dates is fetched.
const SEASON_DATES = {
  '2025-26': [
    '2025-10-24', '2025-10-29',
    '2025-11-05', '2025-11-15', '2025-11-21', '2025-11-26',
    '2025-12-05', '2025-12-15', '2025-12-26',
    '2026-01-02', '2026-01-09', '2026-01-20', '2026-01-28',
    '2026-02-06', '2026-02-12', '2026-02-25',
    '2026-03-08', '2026-03-18', '2026-03-28',
    '2026-04-05', '2026-04-10'
  ]
};

// ---------------------------------------------------------------- args
// tools/args.mjs's loud parsers, not the old local silent reader: a flag
// whose value was missing (or swallowed by the next flag) used to fall back
// to the default with no warning — the incident class args.ts exists for.
const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);

const cacheDir = flagValue(argv, '--cache-dir', 'data/nba/raw');
// Numeric flags are validated before use (flagNumber throws on non-numeric):
// Math.max(2000, NaN) is NaN, and a NaN delay makes politeFetch's `wait > 0`
// false on every request — a typo'd --delay-ms would hammer
// basketball-reference with ZERO spacing, silently defeating the courtesy
// contract in the header. Fail loudly instead.
const delayMs = Math.max(2000, flagNumber(argv, '--delay-ms', 3500)); // hard 2s floor
// --limit keeps its Infinity default (= no cap), which flagNumber's
// finite-only contract can't carry — parse the string form and keep the
// NaN bail for a non-numeric explicit value
const limitRaw = flagValue(argv, '--limit', 'Infinity');
const limit = Number(limitRaw);
if (Number.isNaN(limit)) bail(`--limit must be a number, got "${limitRaw}"`);
const dryRun = has('--dry-run');
const season = flagValue(argv, '--season', null);
const datesArg = flagValue(argv, '--dates', null);
const gamesArg = flagValue(argv, '--games', null);

const dates = [
  ...(season ? (SEASON_DATES[season] ?? bail(`unknown season "${season}" — known: ${Object.keys(SEASON_DATES).join(', ')}`)) : []),
  ...(datesArg ? datesArg.split(',') : [])
];
const explicitGames = gamesArg ? gamesArg.split(',') : [];
if (dates.length === 0 && explicitGames.length === 0) {
  bail('nothing to do. Pass --season 2025-26, --dates YYYY-MM-DD[,..], and/or --games GAMEID[,..]');
}
for (const d of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) bail(`bad date "${d}" (want YYYY-MM-DD)`);

function bail(msg) {
  console.error(`fetch-nba: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- polite fetch
let lastRequestAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function politeFetch(url) {
  const wait = lastRequestAt + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  let res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (res.status === 429 || res.status >= 500) {
    console.warn(`  ${res.status} on ${url} — backing off 65s and retrying once`);
    await sleep(65_000);
    lastRequestAt = Date.now();
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const text = await res.text();
  if (/Rate Limited Request/i.test(text)) {
    throw new Error(`rate-limit page served for ${url} — aborting so we do not hammer the host`);
  }
  return text;
}

const cached = (path) => existsSync(path) && statSync(path).size > 5_000;

// ---------------------------------------------------------------- steps
mkdirSync(cacheDir, { recursive: true });

// 1) index pages -> game ids
async function gameIdsForDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  const idxPath = join(cacheDir, `idx-${date}.html`);
  let html;
  if (cached(idxPath)) {
    html = readFileSync(idxPath, 'utf8');
  } else if (dryRun) {
    console.log(`[dry-run] would fetch index ${date}`);
    return [];
  } else {
    const url = `${BASE}/boxscores/?month=${m}&day=${d}&year=${y}`;
    console.log(`index  ${date}  ${url}`);
    html = await politeFetch(url);
    writeFileSync(idxPath, html);
  }
  const ids = [...new Set([...html.matchAll(/\/boxscores\/pbp\/(\d{8}0[A-Z]{3})\.html/g)].map((m2) => m2[1]))];
  console.log(`  ${date}: ${ids.length} games`);
  return ids;
}

// 2) game pbp pages
async function fetchGame(id) {
  const path = join(cacheDir, `${id}.html`);
  if (cached(path)) return 'cached';
  if (dryRun) {
    console.log(`[dry-run] would fetch game ${id}`);
    return 'dry';
  }
  const url = `${BASE}/boxscores/pbp/${id}.html`;
  console.log(`game   ${id}  ${url}`);
  const html = await politeFetch(url);
  if (!/<table[^>]*id="pbp"/.test(html)) {
    console.warn(`  WARN ${id}: page has no pbp table — NOT cached (inspect manually)`);
    return 'no-pbp';
  }
  writeFileSync(path, html);
  return 'fetched';
}

// ---------------------------------------------------------------- main
const t0 = Date.now();
const allIds = [];
for (const date of dates) allIds.push(...(await gameIdsForDate(date)));
for (const g of explicitGames) if (!allIds.includes(g)) allIds.push(g);

console.log(`\n${allIds.length} game ids across ${dates.length} dates (+${explicitGames.length} explicit)`);
const tally = { fetched: 0, cached: 0, 'no-pbp': 0, dry: 0 };
for (const id of allIds) {
  if (tally.fetched >= limit) {
    console.log(`--limit ${limit} reached, stopping`);
    break;
  }
  tally[await fetchGame(id)]++;
}

const gamesInCache = readdirSync(cacheDir).filter((f) => /^\d{8}0[A-Z]{3}\.html$/.test(f)).length;
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(0)}s — fetched ${tally.fetched}, already cached ${tally.cached}, no-pbp ${tally['no-pbp']}`);
console.log(`cache now holds ${gamesInCache} game pages in ${cacheDir}`);
console.log('next: npm run nba:parse');
