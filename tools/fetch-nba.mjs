// Fetch official NBA per-team per-game aggregates with full provenance.
// Usage: node tools/fetch-nba.mjs 2023-24
// Writes data/nba/team-per-game-<season>.json with {provenance, headers, rows}.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const season = process.argv[2];
if (!/^\d{4}-\d{2}$/.test(season ?? '')) {
  console.error('usage: node tools/fetch-nba.mjs <season, e.g. 2023-24>');
  process.exit(1);
}
const params = new URLSearchParams({
  Season: season, SeasonType: 'Regular Season', MeasureType: 'Base',
  PerMode: 'PerGame', LeagueID: '00', LastNGames: '0', Month: '0',
  OpponentTeamID: '0', PaceAdjust: 'N', Period: '0', PlusMinus: 'N',
  Rank: 'N', TeamID: '0', Outcome: '', Location: '', SeasonSegment: '',
  DateFrom: '', DateTo: '', GameScope: '', GameSegment: '', Conference: '',
  Division: '', PlayerExperience: '', PlayerPosition: '', StarterBench: '',
  VsConference: '', VsDivision: '', ShotClockRange: ''
});
const url = `https://stats.nba.com/stats/leaguedashteamstats?${params}`;
const res = await fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (research fetch; hoopsh data grounding)',
    Referer: 'https://www.nba.com/',
    Accept: 'application/json'
  }
});
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const raw = await res.text();
const payload = JSON.parse(raw); // throws loudly on partial/HTML responses
const rs = payload.resultSets?.[0];
if (!rs?.headers || !rs?.rowSet?.length) {
  console.error('unexpected response shape — refusing to write a partial file');
  process.exit(1);
}
const out = {
  provenance: {
    source: 'stats.nba.com/stats/leaguedashteamstats (official NBA Stats API)',
    url,
    season,
    seasonType: 'Regular Season',
    perMode: 'PerGame',
    accessedAt: new Date().toISOString(),
    payloadSha256: createHash('sha256').update(raw).digest('hex'),
    teams: rs.rowSet.length
  },
  headers: rs.headers,
  rows: rs.rowSet
};
const path = `data/nba/team-per-game-${season}.json`;
writeFileSync(path, JSON.stringify(out, null, 1));
console.log(`wrote ${path}: ${rs.rowSet.length} teams, sha256 ${out.provenance.payloadSha256.slice(0, 12)}…`);
