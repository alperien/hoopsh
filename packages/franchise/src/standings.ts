/**
 * standings.ts — standings fold, tiebreakers, conference seeding.
 *
 * Only regular-season results touch standings (the fold guards it).
 * Tiebreakers are the officially-shaped simplified cascade (register
 * F13 in docs/FRANCHISE.md): head-to-head win pct, division record when
 * the tied teams share a division, conference record, point differential,
 * then team id so the order is total and standings stay byte-stable
 * (the same convention SEASON.md's standings fold uses).
 * Omitted vs the real cascade: division-winner status, common-opponent
 * records, conference-standing recursion. Cheap, close, documented.
 */
import type { GameRecord, League, TeamId, TeamStanding } from './types.js';

export function emptyStanding(teamId: string): TeamStanding {
  return { teamId, w: 0, l: 0, homeW: 0, homeL: 0, awayW: 0, awayL: 0, confW: 0, confL: 0, divW: 0, divL: 0, ptsFor: 0, ptsAgainst: 0, streak: 0, last10: [] };
}

/** Fold one final into league.standings. Regular season only; mutates. */
export function applyResultToStandings(league: League, record: GameRecord): void {
  if (record.type !== 'regular') return; // play-in and playoffs never count here
  const [hs, as] = record.final;
  if (hs === as) throw new Error(`standings: tied final in ${record.id} (the engine plays OT until decided)`);
  const homeTeam = league.teams[record.home]!;
  const awayTeam = league.teams[record.away]!;
  const sameConf = homeTeam.conference === awayTeam.conference;
  const sameDiv = sameConf && homeTeam.division === awayTeam.division;

  const fold = (teamId: TeamId, isHome: boolean, won: boolean, pf: number, pa: number): void => {
    const s = league.standings[teamId] ?? (league.standings[teamId] = emptyStanding(teamId));
    if (won) { s.w++; if (isHome) s.homeW++; else s.awayW++; }
    else { s.l++; if (isHome) s.homeL++; else s.awayL++; }
    if (sameConf) { if (won) s.confW++; else s.confL++; }
    if (sameDiv) { if (won) s.divW++; else s.divL++; }
    s.ptsFor += pf;
    s.ptsAgainst += pa;
    s.streak = won ? (s.streak > 0 ? s.streak + 1 : 1) : (s.streak < 0 ? s.streak - 1 : -1);
    s.last10.push(won ? 1 : 0);
    if (s.last10.length > 10) s.last10.shift();
  };

  fold(record.home, true, hs > as, hs, as);
  fold(record.away, false, as > hs, as, hs);
}

function winPct(s: TeamStanding): number {
  const g = s.w + s.l;
  return g === 0 ? 0 : s.w / g;
}

/** Head-to-head win pct of a over b this season, from stored results. */
function headToHead(league: League, a: TeamId, b: TeamId): number {
  let aw = 0, games = 0;
  for (const r of Object.values(league.results)) {
    if (r.type !== 'regular') continue;
    const pair = (r.home === a && r.away === b) || (r.home === b && r.away === a);
    if (!pair) continue;
    games++;
    const aIsHome = r.home === a;
    const [hs, as] = r.final;
    if ((aIsHome && hs > as) || (!aIsHome && as > hs)) aw++;
  }
  return games === 0 ? 0.5 : aw / games; // no meetings yet: neutral
}

/**
 * Conference seeding 1..15. The comparator applies the cascade pairwise;
 * ties inside a multi-team knot resolve pair-at-a-time, which is the
 * documented simplification vs the official group re-ranking.
 */
export function conferenceSeeds(league: League, conference: 'East' | 'West'): string[] {
  const ids = Object.values(league.teams)
    .filter(t => t.conference === conference)
    .map(t => t.id);

  const s = (id: TeamId): TeamStanding => league.standings[id] ?? emptyStanding(id);

  return ids.sort((a, b) => {
    const pa = winPct(s(a)), pb = winPct(s(b));
    if (pb !== pa) return pb - pa;
    const h2h = headToHead(league, a, b);
    if (h2h !== 0.5) return h2h > 0.5 ? -1 : 1;
    const ta = league.teams[a]!, tb = league.teams[b]!;
    if (ta.division === tb.division) {
      const da = s(a), db = s(b);
      const dpa = da.divW + da.divL === 0 ? 0 : da.divW / (da.divW + da.divL);
      const dpb = db.divW + db.divL === 0 ? 0 : db.divW / (db.divW + db.divL);
      if (dpb !== dpa) return dpb - dpa;
    }
    const ca = s(a), cb = s(b);
    const cpa = ca.confW + ca.confL === 0 ? 0 : ca.confW / (ca.confW + ca.confL);
    const cpb = cb.confW + cb.confL === 0 ? 0 : cb.confW / (cb.confW + cb.confL);
    if (cpb !== cpa) return cpb - cpa;
    const diffA = ca.ptsFor - ca.ptsAgainst;
    const diffB = cb.ptsFor - cb.ptsAgainst;
    if (diffB !== diffA) return diffB - diffA;
    return a.localeCompare(b); // total order: standings stay byte-stable
  });
}
