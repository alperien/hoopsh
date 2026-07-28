/**
 * fetch-tracking-references.mjs: generates tracking-references-2023-24.json.
 *
 * Why this exists: the speed-units incident (texture.ts header tells it) ended
 * with a corrected-but-still-uncited "4.2 MPH ≈ 6.2 ft/s" reference, and the
 * passing reference ("~300 passes / ~95 possessions") was never cited at all.
 * Per this directory's contract (README.md), a reference number the harness
 * compares itself against must be GENERATED from a cited primary source, not
 * recalled. So this script fetches NBA's own tracking API responses and
 * computes the league values, definitions attached.
 *
 * Source: stats.nba.com leaguedashptstats (SpeedDistance + Passing, Team,
 * PerGame, Regular Season). stats.nba.com rejects automated clients from this
 * kind of egress (hangs/504, same access story as league-averages-2023-24.json),
 * but the Internet Archive Wayback Machine holds complete-season snapshots of
 * the RAW API JSON, archived months after each season ended. Those archived
 * URLs are pinned below; `id_` after the timestamp returns the raw body.
 *
 * Run: node data/nba/fetch-tracking-references.mjs
 * (three sequential requests to web.archive.org, >=2s apart per this
 * directory's politeness convention; rerunning only changes
 * provenance.accessedAt)
 *
 * Validation (script refuses to write on failure): 30 team rows per table;
 * the Passing snapshot's AST mean must match league-averages-2023-24.json's
 * B-Ref ast 26.7 to ±0.1 (independent pipelines agreeing); SpeedDistance MIN
 * must match B-Ref mp 241.4 to ±0.1.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// 1 mph = 5280 ft / 3600 s. Stated to five decimals so every ft/s figure in
// the output is reproducible from its mph quote by hand.
const MPH_TO_FTPS = 1.46667;

// Archived raw-JSON snapshots of the official API (timestamps are the
// archive's; both 2023-24 snapshots were taken 2024-09-30, months after the
// season ended, so they are complete-season data).
const NBA_QS =
  'College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=' +
  '&GameScope=&Height=&ISTRound=&LastNGames=0&LeagueID=00&Location=&Month=0' +
  '&OpponentTeamID=0&Outcome=&PORound=0&PerMode=PerGame&PlayerExperience=' +
  '&PlayerOrTeam=Team&PlayerPosition=&PtMeasureType={MEASURE}&Season={SEASON}' +
  '&SeasonSegment=&SeasonType=Regular%20Season&StarterBench=&TeamID=0' +
  '&VsConference=&VsDivision=&Weight=';
const snapshotUrl = (ts, measure, season) =>
  `https://web.archive.org/web/${ts}id_/https://stats.nba.com/stats/leaguedashptstats?` +
  NBA_QS.replace('{MEASURE}', measure).replace('{SEASON}', season);

const URLS = {
  speedDistance2324: snapshotUrl('20240930115313', 'SpeedDistance', '2023-24'),
  passing2324: snapshotUrl('20240930115019', 'Passing', '2023-24'),
  speedDistance2223: snapshotUrl('20231026142740', 'SpeedDistance', '2022-23')
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
// ft/s figures are derived from the 2-decimal mph QUOTE (NBA publishes team
// values at 2 decimals), so quote and conversion never disagree; the
// unrounded computed means are stored alongside.
const ftps = (mphQuote) => r2(mphQuote * MPH_TO_FTPS);

async function fetchTable(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const j = await res.json();
  const rs = j.resultSets[0];
  if (rs.rowSet.length !== 30) throw new Error(`expected 30 team rows, got ${rs.rowSet.length}`);
  const col = (name) => {
    const i = rs.headers.indexOf(name);
    if (i === -1) throw new Error(`missing column ${name}`);
    return rs.rowSet.map((r) => r[i]);
  };
  return { col };
}

const sd24 = await fetchTable(URLS.speedDistance2324);
await sleep(2000);
const pass24 = await fetchTable(URLS.passing2324);
await sleep(2000);
const sd23 = await fetchTable(URLS.speedDistance2223);

// ---- cross-checks against the independently sourced league-averages file
const leagueAvg = JSON.parse(readFileSync(join(HERE, 'league-averages-2023-24.json'), 'utf8'));
const astTracking = mean(pass24.col('AST'));
if (Math.abs(astTracking - leagueAvg.per_game.ast) > 0.1) {
  throw new Error(`AST cross-check failed: tracking ${astTracking} vs B-Ref ${leagueAvg.per_game.ast}`);
}
const minTracking = mean(sd24.col('MIN'));
if (Math.abs(minTracking - leagueAvg.per_game.mp) > 0.1) {
  throw new Error(`MIN cross-check failed: tracking ${minTracking} vs B-Ref ${leagueAvg.per_game.mp}`);
}

// ---- league values (mean of the 30 team rows; quotes at NBA's 2-decimal display precision)
const spd = mean(sd24.col('AVG_SPEED'));
const spdOff = mean(sd24.col('AVG_SPEED_OFF'));
const spdDef = mean(sd24.col('AVG_SPEED_DEF'));
const dist = mean(sd24.col('DIST_MILES'));
const passesMade = mean(pass24.col('PASSES_MADE'));
const gpSum = sd24.col('GP').reduce((a, b) => a + b, 0);
const range = (a) => [Math.min(...a), Math.max(...a)];

// implied speed = distance ÷ on-court time (MIN is the 5-man aggregate, so
// MIN/60 is five-man on-court player-hours); provably NOT the AVG_SPEED column
const implied24 = dist / (minTracking / 60);
const spd23 = mean(sd23.col('AVG_SPEED'));
const dist23 = mean(sd23.col('DIST_MILES'));
const implied23 = dist23 / (mean(sd23.col('MIN')) / 60);

// possessions per game: B-Ref pace is per 48 MINUTES; overtime makes per-game
// possessions higher by mp/240 (league-averages: pace 98.5, mp 241.4)
const possPerGame = leagueAvg.advanced.pace * (leagueAvg.per_game.mp / 240);
const ppp = [r2(r2(passesMade) / r2(possPerGame)), r2(r2(passesMade) / leagueAvg.advanced.pace)];

const out = {
  provenance: {
    source:
      'NBA Advanced Stats player tracking (stats.nba.com leaguedashptstats), Team/PerGame/Regular Season, raw API JSON via Internet Archive Wayback Machine complete-season snapshots',
    urls: URLS,
    season: '2023-24',
    seasonType: 'Regular Season',
    accessedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    method:
      'generated by data/nba/fetch-tracking-references.mjs — fetches the archived raw API responses, averages the 30 team rows, cross-validates against league-averages-2023-24.json (independent Basketball-Reference pipeline), writes this file; never hand-typed',
    glossary:
      'NBA.com Stat Glossary (https://www.nba.com/stats/help/glossary): "AVG SPEED — The average speed in miles per hour of all movements (sprinting, jogging, standing, walking) by a player or team while on the court" (Off/Def variants restrict to time on offense/defense)',
    unitNote:
      `mph quotes are 2-decimal roundings of the computed 30-team means (computedMean* fields carry 4 decimals); ft/s = mph quote x ${MPH_TO_FTPS} (1 mph = 5280 ft / 3600 s), rounded to 2 decimals`,
    note:
      'stats.nba.com rejects automated clients from datacenter egress (hangs/504) — same access story as league-averages-2023-24.json; the Wayback Machine archived the raw API JSON, and both 2023-24 snapshots (2024-09-30) postdate the season by months, so they are complete-season data'
  },
  speedDistance: {
    season: '2023-24',
    AVG_SPEED: {
      mph: r2(spd), ftps: ftps(r2(spd)), computedMeanMph: r4(spd),
      teamRangeMph: range(sd24.col('AVG_SPEED')),
      teamRangeFtps: range(sd24.col('AVG_SPEED')).map(ftps),
      definition:
        'team-level average speed of the 5 on-court players over ALL movements INCLUDING STANDING, per tracked game (see definitionTraps.avgSpeedIncludesStanding)'
    },
    AVG_SPEED_OFF: {
      mph: r2(spdOff), ftps: ftps(r2(spdOff)), computedMeanMph: r4(spdOff),
      teamRangeMph: range(sd24.col('AVG_SPEED_OFF')),
      definition: 'same, restricted to time on offense — offense runs ~16% faster than defense'
    },
    AVG_SPEED_DEF: {
      mph: r2(spdDef), ftps: ftps(r2(spdDef)), computedMeanMph: r4(spdDef),
      teamRangeMph: range(sd24.col('AVG_SPEED_DEF')),
      definition: 'same, restricted to time on defense'
    },
    DIST_MILES: {
      milesPerGame: r2(dist), computedMean: r4(dist),
      teamRange: range(sd24.col('DIST_MILES')),
      off: r2(mean(sd24.col('DIST_MILES_OFF'))), def: r2(mean(sd24.col('DIST_MILES_DEF'))),
      definition: 'total miles covered by all 5 on-court players, per tracked game'
    },
    MIN: {
      teamMinutesPerGame: r2(minTracking),
      definition: '5-man on-court aggregate: 241.35 = 5 x 48.27 player-minutes (overtime inflates past 240)'
    }
  },
  passing: {
    season: '2023-24',
    PASSES_MADE: {
      perGame: r2(passesMade), computedMean: r4(passesMade),
      teamRange: range(pass24.col('PASSES_MADE')),
      definition:
        'tracking PASSES_MADE: completed passes per tracked team-game; NBA publishes no finer definition (whether e.g. handoffs count is unspecified)'
    }
  },
  derived: {
    distOverOnCourtTimeMph: {
      mph: r2(implied24), ftps: ftps(r2(implied24)), computedMph: r4(implied24),
      definition:
        'DIST_MILES / (MIN/60 five-man on-court player-hours). NOT the AVG_SPEED column — see definitionTraps.avgSpeedNotDistOverMinutes'
    },
    passesPerPossession: {
      value: r2((ppp[0] + ppp[1]) / 2), range: ppp,
      derivation:
        `PASSES_MADE ${r2(passesMade)} / possessions per game: ${ppp[0]} using per-GAME possessions (pace 98.5 per 48 min x mp 241.4/240 = ${r2(possPerGame)}, overtime included), ${ppp[1]} using per-48 pace 98.5 directly (divisors from league-averages-2023-24.json; B-Ref pace is per 48 minutes, not per game)`
    },
    corroboration2022_23: {
      AVG_SPEED_mph: r2(spd23), computedMeanMph: r4(spd23),
      DIST_MILES: r2(dist23),
      distOverOnCourtTimeMph: r2(implied23), computedMph: r4(implied23),
      note:
        'prior season, prior tracking provider (see definitionTraps.providerSwitch): values continuous across the switch, and the AVG_SPEED-vs-distance/time gap repeats (~7% both seasons), so the gap is systematic, not a provider artifact'
    }
  },
  definitionTraps: {
    avgSpeedIncludesStanding:
      'AVG_SPEED is not a "when moving" average — the glossary definition explicitly includes standing. A sim metric that averages only live-ball movement frames is close to, but not exactly, this definition.',
    avgSpeedNotDistOverMinutes:
      `the AVG_SPEED column does not equal DIST_MILES / on-court time: 2023-24 gives ${r2(implied24)} mph by division vs the column's ${r2(spd)} (${Math.round((implied24 / spd - 1) * 1000) / 10}% gap); 2022-23 repeats it (${r2(implied23)} vs ${r2(spd23)}, ${Math.round((implied23 / spd23 - 1) * 1000) / 10}%). NBA does not publish AVG_SPEED's denominator. Any comparison must state WHICH of the two it targets; they bracket the plausible like-for-like range.`,
    simTextureIsADifferentQuantity:
      'the harness texture tool (packages/harness/src/texture.ts) measures live-game-clock-only, 5 Hz chord-sampled mean speed of all 10 on-court players with >30 ft/s pairs trimmed — a THIRD definition, matching neither NBA convention (dead-ball movement excluded, chord under-reads path length, denominator is live clock). Comparing it to either NBA number is definition-noisy at the ~10-15% level; the speed-units incident (2026-07-26) started by comparing it to an uncited, units-confused target.',
    perTrackedGame:
      `per-game values mean per TRACKED game: 2023-24 team GP sums to ${gpSum}, not 2460 — tracking was unavailable for some games (NBA.com prints this caveat on every tracking page)`,
    teamMinIsFiveManAggregate:
      'team MIN, DIST_MILES sum over the 5 on-court players; team AVG_SPEED is their average',
    providerSwitch:
      '2023-24 was the first season on a new tracking provider (Second Spectrum through 2022-23) per secondary reporting — cite the season, never "NBA tracking" generically',
    pacePerGameVsPer48:
      'Basketball-Reference pace (98.5) is possessions per 48 MINUTES; per-game possessions run ~0.6% higher because of overtime — the passesPerPossession range spans both divisors'
  },
  validation: {
    teamRows: { speedDistance2324: 30, passing2324: 30, speedDistance2223: 30 },
    astCrossCheck: {
      trackingAstPerGame: r2(astTracking), bRefAstPerGame: leagueAvg.per_game.ast,
      note: 'tracking snapshot vs league-averages-2023-24.json (independent Basketball-Reference pipeline) — must agree to ±0.1 or this script refuses to write'
    },
    minCrossCheck: { trackingMinPerGame: r2(minTracking), bRefMpPerGame: leagueAvg.per_game.mp },
    gpSum2324: gpSum
  }
};

const target = join(HERE, 'tracking-references-2023-24.json');
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${target}`);
console.log(`AVG_SPEED ${out.speedDistance.AVG_SPEED.mph} mph = ${out.speedDistance.AVG_SPEED.ftps} ft/s | ` +
  `off ${out.speedDistance.AVG_SPEED_OFF.mph} / def ${out.speedDistance.AVG_SPEED_DEF.mph} | ` +
  `dist ${out.speedDistance.DIST_MILES.milesPerGame} mi | passes ${out.passing.PASSES_MADE.perGame} | ` +
  `passes/poss ${out.derived.passesPerPossession.range.join('-')}`);
