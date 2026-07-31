/**
 * media/awards.ts - award races, season voting, all-star selection.
 *
 * Voting model (docs/FRANCHISE.md §10): stats, wins, availability, and a
 * small narrative wobble; params.media.mvpWeights carries the blend. The
 * 65-game availability rule (REAL, research 06 §2) gates the major
 * individual awards. Voting has taste, not politics (register F9): no
 * memory of media feuds, just a seeded wobble so races are not pure
 * spreadsheets.
 */
import { Rng } from '@hoopsh/engine';
import type {
  AwardKind, AwardResult, League, NewsItem, PlayerSeasonRow, TeamId,
} from '../types.js';
import { COLUMNIST } from './news.js';

/** Current-season regular-season row for a player, if any. */
function seasonRow(league: League, playerId: string): PlayerSeasonRow | null {
  const p = league.players[playerId];
  if (!p) return null;
  // a traded player owns one row per stint; fold them for voting
  const rows = p.seasons.filter(r => r.season === league.season && r.type === 'regular');
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0]!;
  const sum = { ...rows[0]! };
  for (const r of rows.slice(1)) {
    sum.gp += r.gp; sum.gs += r.gs; sum.min += r.min; sum.pts += r.pts;
    sum.fgm += r.fgm; sum.fga += r.fga; sum.tpm += r.tpm; sum.tpa += r.tpa;
    sum.ftm += r.ftm; sum.fta += r.fta; sum.orb += r.orb; sum.drb += r.drb;
    sum.ast += r.ast; sum.stl += r.stl; sum.blk += r.blk; sum.tov += r.tov;
    sum.pf += r.pf; sum.plusMinus += r.plusMinus;
  }
  return sum;
}

/**
 * Per-game production score, the voting backbone: scoring volume with an
 * efficiency correction, playmaking, glass, stocks. FEEL weights shaped
 * like the public catch-all metrics (a 28/8/8 season on good efficiency
 * should out-poll a hollow 30).
 */
function production(row: PlayerSeasonRow): number {
  if (row.gp === 0) return 0;
  const g = row.gp;
  const pts = row.pts / g;
  const reb = (row.orb + row.drb) / g;
  const ast = row.ast / g;
  const stocks = (row.stl + row.blk) / g;
  const tov = row.tov / g;
  // true shooting vs the modern ~57% baseline; volume scales the credit
  const tsa = row.fga + 0.44 * row.fta; // 0.44 = REAL free-throw possession weight
  const ts = tsa > 0 ? row.pts / (2 * tsa) : 0;
  const effBonus = (ts - 0.57) * pts * 1.5; // FEEL: efficiency credit scaled by volume
  return pts + 1.2 * reb * 0.7 + 1.6 * ast * 0.7 + 2.2 * stocks - 1.4 * tov + effBonus;
}

/** Defensive production for DPOY/All-Defense: stocks, defensive glass, minutes. */
function defProduction(league: League, row: PlayerSeasonRow): number {
  if (row.gp === 0) return 0;
  const g = row.gp;
  const teamD = league.standings[row.teamId];
  // team defense context: points allowed per game vs the league midpoint
  const teamFactor = teamD && teamD.w + teamD.l > 0
    ? Math.max(0.8, Math.min(1.2, 1 + (112 - teamD.ptsAgainst / (teamD.w + teamD.l)) / 40)) // 112 = FEEL league scoring midpoint
    : 1;
  return ((row.stl / g) * 2.6 + (row.blk / g) * 2.4 + (row.drb / g) * 0.5 + (row.min / g) * 0.05) * teamFactor;
}

function winsShare(league: League, teamId: TeamId): number {
  const s = league.standings[teamId];
  if (!s || s.w + s.l === 0) return 0.5;
  return s.w / (s.w + s.l);
}

interface Candidate { playerId: string; score: number; }

function ballotFrom(cands: Candidate[], top: number): Array<{ id: string; share: number }> {
  const sorted = cands.slice().sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId)).slice(0, top);
  const total = sorted.reduce((s, c) => s + Math.max(0, c.score), 0) || 1;
  return sorted.map(c => ({ id: c.playerId, share: Math.round((Math.max(0, c.score) / total) * 1000) / 1000 }));
}

function award(league: League, kind: AwardKind, ballot: Array<{ id: string; share: number }>): AwardResult {
  return { season: league.season, kind, winners: ballot.length ? [ballot[0]!.id] : [], ballot };
}

/** MVP-style blended score for a candidate row. */
function mvpScore(league: League, row: PlayerSeasonRow, rng: Rng): number {
  const w = league.params.media.mvpWeights;
  const prod = production(row);
  const wins = winsShare(league, row.teamId);
  const availability = row.gp; // gate applied by callers; volume still matters
  return prod * w.production * 2 + wins * 100 * w.teamWins + (availability / 82) * 100 * w.availability
    + rng.gaussian(0, 2) * w.narrative * 10; // the seeded wobble (F9: taste, not politics)
}

/**
 * End-of-season voting. Called once at the finals-to-lottery transition,
 * before archiveSeason. Returns every AwardResult (the caller appends to
 * league.awards and stamps player.awards).
 */
export function voteSeasonAwards(league: League): AwardResult[] {
  const rng = new Rng(`${league.seed}:awards:${league.season}`);
  const floor = league.params.media.awardGpFloor; // 65 = REAL award eligibility rule
  const out: AwardResult[] = [];

  const rows: Array<{ playerId: string; row: PlayerSeasonRow }> = [];
  for (const pid of Object.keys(league.players)) {
    const row = seasonRow(league, pid);
    if (row) rows.push({ playerId: pid, row });
  }

  const eligible = rows.filter(r => r.row.gp >= floor);
  const mvpBallot = ballotFrom(eligible.map(r => ({ playerId: r.playerId, score: mvpScore(league, r.row, rng) })), 5);
  out.push(award(league, 'mvp', mvpBallot));

  out.push(award(league, 'dpoy', ballotFrom(
    eligible.map(r => ({ playerId: r.playerId, score: defProduction(league, r.row) + rng.gaussian(0, 0.4) })), 5)));

  // scoring title: points per game among qualified players (REAL: 58 games
  // hold for rate titles; the award floor is close enough for v1, noted)
  const scoring = eligible.map(r => ({ playerId: r.playerId, score: r.row.pts / Math.max(1, r.row.gp) }));
  out.push(award(league, 'scoringTitle', ballotFrom(scoring, 3)));

  // rookies: drafted for this season, or first ledger season
  const rookies = rows.filter(r => {
    const p = league.players[r.playerId]!;
    return p.draft?.season === league.season || (p.seasons.filter(x => x.type === 'regular').length === 1 && !p.draft);
  });
  // rookie floor: half the award floor (rookies miss camp time; FEEL)
  const royBallot = ballotFrom(
    rookies.filter(r => r.row.gp >= Math.floor(floor / 2))
      .map(r => ({ playerId: r.playerId, score: production(r.row) + rng.gaussian(0, 0.6) })), 5);
  out.push(award(league, 'roy', royBallot));

  // sixth man: majority of games off the bench
  const bench = eligible.filter(r => r.row.gs < r.row.gp / 2);
  out.push(award(league, 'smoy', ballotFrom(
    bench.map(r => ({ playerId: r.playerId, score: production(r.row) + rng.gaussian(0, 0.5) })), 5)));

  // most improved: production delta vs last season (both seasons real)
  const mip: Candidate[] = [];
  for (const { playerId, row } of eligible) {
    const p = league.players[playerId]!;
    const prev = p.seasons.find(r => r.season === league.season - 1 && r.type === 'regular');
    if (!prev || prev.gp < 30) continue; // 30 = FEEL: a real prior season to improve from
    mip.push({ playerId, score: production(row) - production(prev) + rng.gaussian(0, 0.4) });
  }
  out.push(award(league, 'mip', mip.length ? ballotFrom(mip, 5) : []));

  // all-league teams: top 15 by MVP score in 5s
  const ordered = ballotFrom(eligible.map(r => ({ playerId: r.playerId, score: mvpScore(league, r.row, rng) })), 15);
  const allKinds: AwardKind[] = ['allLeague1', 'allLeague2', 'allLeague3'];
  allKinds.forEach((kind, i) => {
    const slice = ordered.slice(i * 5, i * 5 + 5);
    out.push({ season: league.season, kind, winners: slice.map(s => s.id), ballot: slice });
  });

  // all-defense: top 10 by defensive production in 5s
  const dOrdered = ballotFrom(eligible.map(r => ({ playerId: r.playerId, score: defProduction(league, r.row) })), 10);
  (['allDefense1', 'allDefense2'] as AwardKind[]).forEach((kind, i) => {
    const slice = dOrdered.slice(i * 5, i * 5 + 5);
    out.push({ season: league.season, kind, winners: slice.map(s => s.id), ballot: slice });
  });

  // all-rookie: top 5 rookies regardless of the veteran floor
  const rookieOrdered = ballotFrom(rookies.map(r => ({ playerId: r.playerId, score: production(r.row) })), 5);
  out.push({ season: league.season, kind: 'allRookie', winners: rookieOrdered.map(s => s.id), ballot: rookieOrdered });

  // finals MVP: playoff production on the champion
  const finals = league.playoffs.find(s => s.round === 4);
  if (finals?.winner) {
    const champs: Candidate[] = [];
    for (const pid of Object.keys(league.players)) {
      const p = league.players[pid]!;
      const po = p.seasons.find(r => r.season === league.season && r.type === 'playoffs' && r.teamId === finals.winner);
      if (po && po.gp >= 8) champs.push({ playerId: pid, score: production(po) }); // 8 = FEEL: a real playoff run
    }
    out.push(award(league, 'fmvp', ballotFrom(champs, 3)));
  }

  // coach of the year: biggest win improvement vs last season's archive
  const prevStandings = league.archives.find(a => a.season === league.season - 1)?.finalStandings;
  const coy: Array<{ teamId: TeamId; delta: number }> = [];
  for (const teamId of Object.keys(league.teams)) {
    const cur = league.standings[teamId];
    if (!cur) continue;
    const prev = prevStandings?.find(s => s.teamId === teamId);
    const delta = prev ? cur.w - prev.w : cur.w - 41; // genesis: beat .500 (FEEL)
    coy.push({ teamId, delta });
  }
  coy.sort((a, b) => b.delta - a.delta || a.teamId.localeCompare(b.teamId));
  if (coy.length > 0) {
    out.push({
      season: league.season, kind: 'coy',
      winners: [coy[0]!.teamId],
      ballot: coy.slice(0, 3).map(c => ({ id: c.teamId, share: 0 })),
    });
  }

  return out;
}

/**
 * All-star selection at the break: twelve per conference, fan-vote flavor
 * (production plus a market bump), returned as two AwardResults.
 */
export function selectAllStars(league: League): AwardResult[] {
  const out: AwardResult[] = [];
  // 1.05 = FEEL: the fan-vote market bump for the biggest stages
  const marketBump = new Set(['nye', 'bka', 'las', 'chi', 'sfo']);
  for (const conf of ['East', 'West'] as const) {
    const cands: Candidate[] = [];
    for (const pid of Object.keys(league.players)) {
      const p = league.players[pid]!;
      const teamId = p.contract?.teamId;
      if (!teamId || league.teams[teamId]?.conference !== conf) continue;
      const row = seasonRow(league, pid);
      if (!row || row.gp < 15) continue; // 15 = FEEL: half the pre-break slate
      const bump = marketBump.has(teamId) ? 1.05 : 1;
      cands.push({ playerId: pid, score: production(row) * bump });
    }
    const twelve = ballotFrom(cands, 12);
    out.push({ season: league.season, kind: 'allStar', winners: twelve.map(b => b.id), ballot: twelve });
  }
  return out;
}

/**
 * Weekly race stories: the MVP ladder, printed on the columnist's byline.
 * Called on the award-race cadence during the regular season.
 */
export function updateAwardRaces(league: League): NewsItem[] {
  if (league.phase !== 'regular') return [];
  const rng = new Rng(`${league.seed}:awards:${league.season}:race:${league.day}`);
  const rows: Array<{ playerId: string; row: PlayerSeasonRow }> = [];
  for (const pid of Object.keys(league.players)) {
    const row = seasonRow(league, pid);
    if (row && row.gp >= 5) rows.push({ playerId: pid, row });
  }
  if (rows.length < 5) return [];
  const ladder = ballotFrom(rows.map(r => ({ playerId: r.playerId, score: mvpScore(league, r.row, rng) })), 5);
  const names = ladder.map((b, i) => {
    const p = league.players[b.id]!;
    const row = seasonRow(league, b.id)!;
    return `${i + 1}. ${p.name} (${(row.pts / Math.max(1, row.gp)).toFixed(1)} a game, ${league.teams[p.contract?.teamId ?? '']?.abbrev ?? 'FA'} ${league.standings[p.contract?.teamId ?? '']?.w ?? 0}-${league.standings[p.contract?.teamId ?? '']?.l ?? 0})`;
  });
  return [{
    id: `n-s${league.season}d${league.day}-race`,
    date: { season: league.season, day: league.day },
    type: 'awardRace',
    headline: `The MVP ladder, week of day ${league.day}`,
    body: names.join(' '),
    byline: COLUMNIST,
    players: ladder.map(b => b.id),
    teams: [],
    weight: 2,
  }];
}
