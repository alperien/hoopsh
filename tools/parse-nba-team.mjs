#!/usr/bin/env node
// tools/parse-nba-team.mjs — parse cached basketball-reference team-season
// pages into season-lines files for the roster fitter.
//
// Input: data/nba/raw/teams/{ABBR}-{endYear}.html (from tools/fetch-nba-team.mjs;
// gitignored). Output: data/nba/{abbr-lowercase}-{season}.season.json — the
// committed, provenance-stamped input `npm run rosters:fit` consumes
// (format: packages/harness/src/fit-roster.ts header; exemplar:
// data/nba/example-stars.season.json).
//
// Usage:
//   npm run nba:parse-team -- --teams SAS,OKC
//   npm run nba:parse-team -- --teams SAS --end-year 2026 --min-gp 15 --min-mpg 12 --max-players 12
//
// What it reads per player:
//   roster table          -> pos, heightIn (csk attribute, else "6-7" text), weightLb
//   per_game_stats table  -> gp, mpg, pts, reb, ast, stl, blk, tov, fga, fgPct,
//                            tpa, tpPct, fta, ftPct, orb, pf
//   shooting table        -> shotZones { rimShare2, midShare2 } — bbref distance
//                            buckets as SHARES OF ALL FGA, renormalized to 2PA:
//                            rimShare2 = pct_fga_00_03 / pct_fga_fg2a (0-3 ft ~ the
//                            fitter's rim<=4ft), midShare2 = pct_fga_16_xx /
//                            pct_fga_fg2a (16ft-3P ~ the fitter's mid>14ft).
//                            Bucket-boundary mismatch (3 vs 4 ft, 16 vs 14 ft) is
//                            disclosed in the provenance string.
//
// Rotation filter: gp >= --min-gp AND mpg >= --min-mpg, top --max-players by
// mpg. Dies loudly under 8 qualifiers (a fit needs a real rotation).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flagNumber, flagValue } from './args.mjs';

const KNOWN = new Set(['--teams', '--end-year', '--cache-dir', '--out-dir', '--min-gp', '--min-mpg', '--max-players']);
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
const endYear = flagNumber(process.argv, '--end-year', 2026);
const cacheDir = flagValue(process.argv, '--cache-dir', 'data/nba/raw/teams');
const outDir = flagValue(process.argv, '--out-dir', 'data/nba');
const minGp = flagNumber(process.argv, '--min-gp', 15);
const minMpg = flagNumber(process.argv, '--min-mpg', 12);
const maxPlayers = flagNumber(process.argv, '--max-players', 12);
const season = `${endYear - 1}-${String(endYear).slice(2)}`;

const text = (cell) =>
  cell
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** all <tr> rows of the table with this id, searching comment-wrapped markup too */
function tableRows(html, id) {
  const unwrapped = html.replace(/<!--([\s\S]*?)-->/g, (_, c) => c);
  const m = unwrapped.match(new RegExp(`<table[^>]*id="${id}"[\\s\\S]*?</table>`));
  if (!m) return null;
  return m[0].match(/<tr[\s\S]*?<\/tr>/g) ?? [];
}

/** row -> { statName: { text, csk } }, keyed by data-stat */
function cells(row) {
  const out = {};
  for (const m of row.matchAll(/<(?:td|th)[^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/(?:td|th)>/g)) {
    const csk = /csk="([^"]+)"/.exec(m[0].slice(0, m[0].indexOf('>') + 1));
    out[m[1]] = { text: text(m[2]), csk: csk ? csk[1] : null };
  }
  return out;
}

const num = (c) => (c && c.text !== '' ? Number(c.text) : null);

function heightInches(cell) {
  if (cell?.csk && Number.isFinite(Number(cell.csk))) return Math.round(Number(cell.csk));
  const m = /^(\d+)-(\d+)$/.exec(cell?.text ?? '');
  if (!m) return null;
  return Number(m[1]) * 12 + Number(m[2]);
}

/** bbref lists combo positions ("SG-SF"); the schema wants one of PG..C */
const primaryPos = (p) => (p ?? '').split('-')[0].trim();

function parseTeam(abbr) {
  const file = join(cacheDir, `${abbr}-${endYear}.html`);
  if (!existsSync(file)) {
    console.error(`${abbr}: no cached page at ${file} — run npm run nba:fetch-team -- --teams ${abbr} first`);
    process.exit(1);
  }
  const html = readFileSync(file, 'utf-8');
  const title = /<title>(.*?)<\/title>/.exec(html)?.[1] ?? '';
  const teamName = title.replace(/ Roster and Stats.*$/, '').replace(/^\d{4}-\d{2} /, '').trim();

  // roster: name -> physicals
  const phys = new Map();
  for (const row of tableRows(html, 'roster') ?? []) {
    const c = cells(row);
    const name = c.player?.text;
    if (!name) continue;
    phys.set(name, {
      pos: primaryPos(c.pos?.text),
      heightIn: heightInches(c.height),
      weightLb: num(c.weight)
    });
  }

  // shooting: name -> zone shares (renormalized to 2PA)
  const zones = new Map();
  for (const row of tableRows(html, 'shooting') ?? []) {
    const c = cells(row);
    const name = c.name_display?.text;
    if (!name) continue;
    const rim = num(c.pct_fga_00_03);
    const mid = num(c.pct_fga_16_xx);
    const twoShare = num(c.pct_fga_fg2a);
    if (rim === null || mid === null || !twoShare) continue;
    zones.set(name, {
      rimShare2: Math.min(1, rim / twoShare),
      midShare2: Math.min(1, mid / twoShare),
      // made dunks, season TOTAL (bbref fg_dunk) — becomes per-game downstream
      dunkTotal: num(c.fg_dunk)
    });
  }

  // per-game lines
  const lines = [];
  for (const row of tableRows(html, 'per_game_stats') ?? []) {
    const c = cells(row);
    const name = c.name_display?.text;
    if (!name || !row.includes('data-append-csv')) continue; // skips header/Team Totals
    const gp = num(c.games);
    const gs = num(c.games_started);
    const mpg = num(c.mp_per_g);
    if (gp === null || mpg === null) continue;
    const p = phys.get(name);
    if (!p || p.heightIn === null || p.weightLb === null || !p.pos) {
      console.log(`  note: ${name} missing roster physicals — skipped`);
      continue;
    }
    const line = {
      name,
      pos: p.pos,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      gp,
      // games started — drives the fitter's starting five (real lineups,
      // e.g. the OKC double-big front line, are not recoverable from mpg)
      gs: gs ?? 0,
      mpg,
      pts: num(c.pts_per_g),
      reb: num(c.trb_per_g),
      ast: num(c.ast_per_g),
      stl: num(c.stl_per_g),
      blk: num(c.blk_per_g),
      tov: num(c.tov_per_g),
      fga: num(c.fga_per_g),
      fgPct: num(c.fg_pct),
      tpa: num(c.fg3a_per_g),
      tpPct: num(c.fg3_pct),
      fta: num(c.fta_per_g),
      ftPct: num(c.ft_pct),
      orb: num(c.orb_per_g),
      pf: num(c.pf_per_g)
    };
    // a player with no 3PA (or no FTA) has a null pct on bbref — the fitter
    // wants numbers; 0 attempts makes the pct inert, so 0 is the honest fill
    if (line.tpa === 0 && line.tpPct === null) line.tpPct = 0;
    if (line.fta === 0 && line.ftPct === null) line.ftPct = 0;
    const missing = Object.entries(line).filter(([, v]) => v === null).map(([k]) => k);
    if (missing.length) {
      console.log(`  note: ${name} missing ${missing.join(',')} — skipped`);
      continue;
    }
    const z = zones.get(name);
    if (z) {
      line.shotZones = { rimShare2: Number(z.rimShare2.toFixed(3)), midShare2: Number(z.midShare2.toFixed(3)) };
      if (z.dunkTotal !== null) line.dunks = Number((z.dunkTotal / gp).toFixed(2));
    }
    lines.push(line);
  }

  const rotation = lines
    .filter((l) => l.gp >= minGp && l.mpg >= minMpg)
    .sort((a, b) => b.mpg - a.mpg)
    .slice(0, maxPlayers);
  if (rotation.length < 8) {
    console.error(`${abbr}: only ${rotation.length} players pass gp>=${minGp} mpg>=${minMpg} — not a rotation; loosen the filters`);
    process.exit(1);
  }

  const players = rotation.map(({ gp, ...rest }) => rest); // gp was filter-only
  const accessed = new Date().toISOString().slice(0, 10);
  const out = {
    kind: 'season-lines',
    provenance:
      `basketball-reference.com /teams/${abbr}/${endYear}.html (${season} regular season: roster, per-game, and shooting tables), ` +
      `fetched ${accessed} by tools/fetch-nba-team.mjs, parsed by tools/parse-nba-team.mjs. ` +
      `Rotation filter: gp>=${minGp}, mpg>=${minMpg}, top ${maxPlayers} by minutes. ` +
      `shotZones renormalize bbref FGA-share distance buckets to 2PA shares; bucket edges differ from the fitter's ` +
      `(bbref 0-3ft as rim<=4ft, bbref 16ft-3P as mid>14ft) — a disclosed approximation.`,
    team: { id: abbr.toLowerCase(), name: teamName, abbrev: abbr },
    players
  };
  const outFile = join(outDir, `${abbr.toLowerCase()}-${season}.season.json`);
  writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`${abbr}: ${players.length} players -> ${outFile}`);
  for (const p of players) console.log(`   ${p.name.padEnd(26)} ${p.pos.padEnd(2)} ${String(p.heightIn)}in ${p.mpg}mpg ${p.pts}pts`);
}

for (const abbr of teams) parseTeam(abbr);
