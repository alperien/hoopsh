/**
 * media/almanac.ts - the records book and the season archives. History is
 * content (docs/FRANCHISE.md §10): every entry here is browsable in the
 * almanac screen and quotable by the news desk.
 */
import type {
  GameRecord, League, RecordBookEntry, SeasonArchive, TeamStanding,
} from '../types.js';

/** The tracked single-game records: key, label, stat extractor. */
const GAME_RECORDS: Array<{ key: string; label: string; value: (l: GameRecord['lines'][number]) => number }> = [
  { key: 'game-pts', label: 'Most points, game', value: l => l.pts },
  { key: 'game-reb', label: 'Most rebounds, game', value: l => l.orb + l.drb },
  { key: 'game-ast', label: 'Most assists, game', value: l => l.ast },
  { key: 'game-stl', label: 'Most steals, game', value: l => l.stl },
  { key: 'game-blk', label: 'Most blocks, game', value: l => l.blk },
  { key: 'game-tpm', label: 'Most threes, game', value: l => l.tpm },
];

/**
 * Check a finished game against the records book; update holders and
 * return the new entries (the news desk prints them). Regular season and
 * playoffs share one book in v1 (registered: the real book splits them).
 */
export function updateRecords(league: League, record: GameRecord): RecordBookEntry[] {
  const broken: RecordBookEntry[] = [];

  const claim = (key: string, label: string, holderId: string, holderName: string, value: number): void => {
    const existing = league.records.find(r => r.key === key);
    if (existing && existing.value >= value) return;
    const entry: RecordBookEntry = {
      key, label, holderId, holderName, value,
      season: league.season, gameId: record.id,
    };
    if (existing) {
      // genesis-era marks fall quietly at first; the news desk decides
      // what is printable from the returned entries
      const idx = league.records.indexOf(existing);
      league.records[idx] = entry;
    } else {
      league.records.push(entry);
    }
    broken.push(entry);
  };

  for (const line of record.lines) {
    const name = league.players[line.playerId]?.name ?? line.playerId;
    for (const def of GAME_RECORDS) {
      const v = def.value(line);
      // floor of note: no records book lists an 11-point game. Thresholds
      // seed the book with real marks only (FEEL, one per stat family).
      const floor = def.key === 'game-pts' ? 40 : def.key === 'game-reb' ? 18 : def.key === 'game-ast' ? 14 : def.key === 'game-tpm' ? 8 : 6;
      if (v >= floor) claim(def.key, def.label, line.playerId, name, v);
    }
  }

  // team single-game marks
  const [ht, at] = record.totals;
  const [hs, as] = record.final;
  const teams: Array<{ id: string; pts: number }> = [
    { id: record.home, pts: hs },
    { id: record.away, pts: as },
  ];
  for (const t of teams) {
    if (t.pts >= 140) { // 140 = FEEL: a printable team scoring night
      claim('team-game-pts', 'Most points, team, game', t.id, league.teams[t.id]?.name ?? t.id, t.pts);
    }
  }
  const margin = Math.abs(hs - as);
  if (margin >= 35) { // 35 = FEEL: a printable rout
    const winner = hs > as ? record.home : record.away;
    claim('team-game-margin', 'Largest margin of victory', winner, league.teams[winner]?.name ?? winner, margin);
  }
  void ht; void at;

  return broken;
}

/** League per-game averages for the archive and the drift monitor. */
function leagueAverages(league: League): Record<string, number> {
  let games = 0;
  const sums = { pts: 0, fga: 0, tpa: 0, tpm: 0, fta: 0, orb: 0, tov: 0, ast: 0, pf: 0, pace: 0 };
  for (const r of Object.values(league.results)) {
    if (r.type !== 'regular') continue;
    games++;
    for (const t of r.totals) {
      sums.pts += t.pts; sums.fga += t.fga; sums.tpa += t.tpa; sums.tpm += t.tpm;
      sums.fta += t.fta; sums.orb += t.orb; sums.tov += t.tov; sums.ast += t.ast; sums.pf += t.pf;
    }
    sums.pace += r.totals[0]!.pace;
  }
  if (games === 0) return {};
  const perTeamGame = (v: number): number => Math.round((v / (games * 2)) * 10) / 10;
  return {
    games,
    pts: perTeamGame(sums.pts),
    fga: perTeamGame(sums.fga),
    tpa: perTeamGame(sums.tpa),
    tpm: perTeamGame(sums.tpm),
    fta: perTeamGame(sums.fta),
    orb: perTeamGame(sums.orb),
    tov: perTeamGame(sums.tov),
    ast: perTeamGame(sums.ast),
    pf: perTeamGame(sums.pf),
    pace: Math.round((sums.pace / games) * 10) / 10,
  };
}

/**
 * Archive the finished season. Called at the finals-to-lottery transition
 * AFTER awards voting (the archive stores the season's awards). Returns
 * null when the season has no decided champion yet.
 */
export function archiveSeason(league: League): SeasonArchive | null {
  const finals = league.playoffs.find(s => s.round === 4);
  if (!finals?.winner) return null;
  const champion = finals.winner;
  const runnerUp = finals.winner === finals.high ? finals.low : finals.high;

  const finalStandings: TeamStanding[] = Object.values(league.standings)
    .map(s => ({ ...s, last10: [...s.last10] }))
    .sort((a, b) => b.w - a.w || (b.ptsFor - b.ptsAgainst) - (a.ptsFor - a.ptsAgainst) || a.teamId.localeCompare(b.teamId));

  const draftClass = league.transactions
    .filter(tx => tx.kind === 'draftSelection' && tx.date.season === league.season)
    .map(tx => tx.kind === 'draftSelection'
      ? { pick: tx.pick, round: tx.round, teamId: tx.teamId, playerId: tx.playerId }
      : null)
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.round - b.round || a.pick - b.pick);

  // Bake printable winner names into the archived rows (issue #188): the
  // almanac must read like the records book, whose claims resolve
  // holderName at write time with the same honest raw-id fallback. Write
  // time is the right time: the archive is self-contained history and
  // must not depend on the live player table carrying every retired man
  // forever. coy winners are team ids; every other kind is player ids.
  // Copies, not aliases: the live league.awards rows stay id-only.
  const awards = league.awards
    .filter(a => a.season === league.season)
    .map(a => ({
      ...a,
      winnerNames: a.winners.map(
        id => league.players[id]?.name ?? league.teams[id]?.name ?? id),
    }));

  const archive: SeasonArchive = {
    season: league.season,
    champion,
    runnerUp,
    finalStandings,
    awards,
    playoffs: league.playoffs.map(s => ({ ...s, wins: [...s.wins] as [number, number], games: [...s.games] })),
    lottery: league.lottery ?? { season: league.season, order: [], movement: [] },
    leagueAverages: leagueAverages(league),
    draftClass,
  };
  league.archives.push(archive);
  return archive;
}
