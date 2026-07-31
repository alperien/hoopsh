#!/usr/bin/env node
// tools/fetch-nba-team.mjs — polite basketball-reference TEAM-season page fetcher.
//
// Companion to tools/fetch-nba.mjs (the pbp fetcher): same cache discipline,
// same politeness contract. Downloads team "Roster and Stats" pages
// (/teams/{ABBR}/{endYear}.html) into the gitignored cache
// (data/nba/raw/teams/). The parser (tools/parse-nba-team.mjs) turns the
// cache into committed season-lines files (data/nba/*.season.json) that
// `npm run rosters:fit` consumes. Raw HTML never enters git.
//
// Usage:
//   npm run nba:fetch-team -- --teams SAS,OKC              # 2025-26 by default
//   npm run nba:fetch-team -- --teams SAS --end-year 2026
//
// Flags:
//   --teams SAS,OKC            bbref team abbreviations, comma-separated (required)
//   --end-year 2026            season end year (2026 = the 2025-26 season)
//   --cache-dir data/nba/raw/teams
//   --delay-ms 3500            spacing between requests (hard floor 2000ms)
//   --dry-run                  list what would be fetched, no network
//
// Politeness contract (courtesy-critical — do not weaken; mirrors fetch-nba.mjs):
//   * strictly sequential; >= 2s between ANY two requests
//   * resumable: cached files are skipped without touching the network
//   * 429/5xx -> one 65s backoff and one retry, then abort loudly
//   * honest User-Agent identifying the research use

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flagNumber, flagValue } from './args.mjs';

const BASE = 'https://www.basketball-reference.com';
const UA = 'hoopsh-data-spine/1.0 (research corpus for a basketball simulator; polite sequential fetch)';

// tools/args.mjs has no checkFlags (that lives in the harness parser); a
// local allowlist keeps the loud-flag doctrine: a typo'd flag dies here
// instead of silently fetching the default season.
const KNOWN = new Set(['--teams', '--end-year', '--cache-dir', '--delay-ms', '--dry-run']);
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--') && !KNOWN.has(a)) {
    console.error(`unknown flag ${a} (this tool takes: ${[...KNOWN].join(' ')})`);
    process.exit(1);
  }
}

const teamsRaw = flagValue(process.argv, '--teams', '');
if (!teamsRaw) {
  console.error('--teams is required (comma-separated bbref abbreviations, e.g. SAS,OKC)');
  process.exit(1);
}
const teams = teamsRaw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
const badAbbr = teams.filter((t) => !/^[A-Z]{3}$/.test(t));
if (badAbbr.length) {
  console.error(`not bbref team abbreviations: ${badAbbr.join(', ')}`);
  process.exit(1);
}
const endYear = flagNumber(process.argv, '--end-year', 2026);
const cacheDir = flagValue(process.argv, '--cache-dir', 'data/nba/raw/teams');
const delayMs = Math.max(2000, flagNumber(process.argv, '--delay-ms', 3500));
const dryRun = process.argv.includes('--dry-run');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429 || res.status >= 500) {
    console.log(`  ${res.status} — backing off 65s, one retry`);
    await sleep(65000);
    const retry = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!retry.ok) throw new Error(`${url}: ${retry.status} after backoff — aborting (never hammer)`);
    return retry.text();
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

mkdirSync(cacheDir, { recursive: true });
let fetched = 0;
for (const abbr of teams) {
  const out = join(cacheDir, `${abbr}-${endYear}.html`);
  const url = `${BASE}/teams/${abbr}/${endYear}.html`;
  if (existsSync(out)) {
    console.log(`cached  ${abbr} ${endYear} (skip)`);
    continue;
  }
  if (dryRun) {
    console.log(`would fetch ${url} -> ${out}`);
    continue;
  }
  if (fetched > 0) await sleep(delayMs);
  console.log(`fetch   ${url}`);
  const html = await fetchOnce(url);
  if (!html.includes('id="roster"') || !html.includes('id="per_game_stats"')) {
    throw new Error(`${abbr}: page fetched but roster/per_game_stats tables not found — layout change or wrong page; aborting before caching junk`);
  }
  writeFileSync(out, html);
  fetched++;
  console.log(`        -> ${out} (${html.length} bytes)`);
}
console.log(`done: ${fetched} fetched, ${teams.length - fetched} already cached`);
