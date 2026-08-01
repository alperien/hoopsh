/**
 * views.ts - pure builders from League state to the protocol.ts DTO
 * shapes. No I/O here: the server owns files and sockets, views own
 * shaping. Display grades in this file are presentation, not sim truth:
 * the engine never sees an "overall".
 */
import type {
  DayDigest, FrPlayer, GameLine, GameRecord, League, NewsItem, PlayerSeasonRow, TeamId,
} from '@hoopsh/franchise';
import { capSheet, conferenceSeeds } from '@hoopsh/franchise';
import type {
  FaRow, GameView, LeaderRow, PlayerRow, PlayerView, ProspectRow, ScheduleRow, Summary, TeamView,
} from './protocol.js';

/**
 * Display overall 0-99: a scouting-grade composite of the 24 attributes
 * weighted toward the skills that decide games. Presentation only.
 */
export function overall(p: FrPlayer): number {
  const a = p.attr;
  const score =
    0.16 * Math.max(a.finishing, a.midRange, a.three) +      // best scoring tool
    0.10 * ((a.finishing + a.midRange + a.three) / 3) +      // scoring breadth
    0.12 * a.ballHandle +
    0.12 * ((a.passAcc + a.passVision) / 2) +
    0.14 * ((a.perimeterD + a.interiorD) / 2) +
    0.07 * ((a.steal + a.block) / 2) +
    0.08 * ((a.offReb + a.defReb + a.boxout) / 3) +
    0.10 * a.decisions +
    0.06 * ((a.speed + a.accel + a.lateral) / 3) +
    0.05 * a.stamina;
  return Math.max(1, Math.min(99, Math.round(score)));
}

export function heightLabel(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function age(league: League, p: FrPlayer): number {
  return league.season - p.bornSeason;
}

function currentRow(league: League, p: FrPlayer): PlayerSeasonRow | null {
  const rows = p.seasons.filter(r => r.season === league.season && r.type === 'regular');
  if (rows.length === 0) return null;
  const sum = { ...rows[0]! };
  for (const r of rows.slice(1)) {
    sum.gp += r.gp; sum.min += r.min; sum.pts += r.pts; sum.orb += r.orb; sum.drb += r.drb;
    sum.ast += r.ast; sum.stl += r.stl; sum.blk += r.blk; sum.tov += r.tov;
    sum.fgm += r.fgm; sum.fga += r.fga; sum.tpm += r.tpm; sum.tpa += r.tpa; sum.ftm += r.ftm; sum.fta += r.fta;
  }
  return sum;
}

function perGame(row: PlayerSeasonRow | null): Record<string, number> {
  if (!row || row.gp === 0) return { gp: 0 };
  const g = row.gp;
  const r1 = (x: number): number => Math.round((x / g) * 10) / 10;
  return {
    gp: g,
    min: r1(row.min), pts: r1(row.pts), reb: r1(row.orb + row.drb), ast: r1(row.ast),
    stl: r1(row.stl), blk: r1(row.blk), tov: r1(row.tov),
    fgPct: row.fga > 0 ? Math.round((row.fgm / row.fga) * 1000) / 10 : 0,
    tpPct: row.tpa > 0 ? Math.round((row.tpm / row.tpa) * 1000) / 10 : 0,
    ftPct: row.fta > 0 ? Math.round((row.ftm / row.fta) * 1000) / 10 : 0,
  };
}

export function playerRow(league: League, pid: string): PlayerRow {
  const p = league.players[pid]!;
  const c = p.contract;
  const yearRow = c?.years.find(y => y.season === league.season);
  return {
    id: p.id,
    name: p.name,
    pos: p.pos,
    age: age(league, p),
    heightLabel: heightLabel(p.heightIn),
    ovr: overall(p),
    salary: yearRow?.salary ?? 0,
    years: c ? c.years.filter(y => y.season >= league.season).length : 0,
    status: p.status,
    injuryLabel: p.health.injury ? `${p.health.injury.label} (${p.health.injury.remainingDays}d)` : null,
    perGame: perGame(currentRow(league, p)),
  };
}

export function dateLabel(league: League, day: number): string {
  return league.calendar[day]?.label ?? `day ${day}`;
}

export function scheduleRow(league: League, gameId: string): ScheduleRow | null {
  const g = league.schedule.find(x => x.id === gameId) ?? league.playin.find(x => x.id === gameId);
  const r = league.results[gameId];
  const src = g ?? r;
  if (!src) return null;
  return {
    gameId,
    date: src.date,
    dateLabel: dateLabel(league, src.date.day),
    home: src.home,
    away: src.away,
    final: r ? r.final : null,
    ot: r?.ot ?? 0,
    userGame: src.home === league.userTeam || src.away === league.userTeam,
  };
}

export function teamSchedule(league: League, teamId: TeamId): { upcoming: ScheduleRow[]; recent: ScheduleRow[] } {
  const mine = league.schedule.filter(g => g.home === teamId || g.away === teamId);
  const upcoming: ScheduleRow[] = [];
  const recent: ScheduleRow[] = [];
  for (const g of mine) {
    const row = scheduleRow(league, g.id);
    if (!row) continue;
    if (row.final) recent.push(row);
    else upcoming.push(row);
  }
  recent.sort((a, b) => b.date.day - a.date.day);
  upcoming.sort((a, b) => a.date.day - b.date.day);
  return { upcoming: upcoming.slice(0, 8), recent: recent.slice(0, 8) };
}

export function teamView(league: League, teamId: TeamId): TeamView {
  const t = league.teams[teamId]!;
  const { scoutSeed, ...pub } = t;
  void scoutSeed;
  const { upcoming, recent } = teamSchedule(league, teamId);
  return {
    team: pub,
    standings: league.standings[teamId] ?? {
      teamId, w: 0, l: 0, homeW: 0, homeL: 0, awayW: 0, awayL: 0,
      confW: 0, confL: 0, divW: 0, divL: 0, ptsFor: 0, ptsAgainst: 0, streak: 0, last10: [],
    },
    roster: [...t.roster, ...t.twoWay].map(pid => playerRow(league, pid)),
    cap: capSheet(league, teamId),
    upcoming,
    recent,
  };
}

export function playerView(league: League, pid: string): PlayerView {
  const p = league.players[pid]!;
  const isProspect = p.status === 'draftEligible';
  // hidden truth stays hidden for prospects: the UI gets ranges, not dials
  const pub = isProspect
    ? { ...p, attr: undefined, tend: undefined, potential: undefined }
    : { ...p, potential: undefined }; // potential is always a projection (F5)
  const gameLog: PlayerView['gameLog'] = [];
  for (const r of Object.values(league.results)) {
    const line = r.lines.find(l => l.playerId === pid);
    if (line) gameLog.push({ gameId: r.id, date: r.date, line });
  }
  gameLog.sort((a, b) => b.date.day - a.date.day);
  return {
    player: pub,
    report: league.scouting[pid] ?? null,
    seasons: p.seasons,
    gameLog: gameLog.slice(0, 20),
    news: league.news.filter(n => n.players.includes(pid)).slice(-10).reverse(),
  };
}

const LEADER_STATS: Record<string, (r: PlayerSeasonRow) => number> = {
  pts: r => r.pts, reb: r => r.orb + r.drb, ast: r => r.ast,
  stl: r => r.stl, blk: r => r.blk, tpm: r => r.tpm, min: r => r.min,
};

export function leaders(league: League, stat: string): LeaderRow[] {
  const fn = LEADER_STATS[stat] ?? LEADER_STATS.pts!;
  // qualifier: 70% of the team-games played so far (REAL-shaped rate rule)
  const maxGp = Math.max(1, ...Object.values(league.standings).map(s => s.w + s.l));
  const floor = Math.max(1, Math.floor(maxGp * 0.70));
  const rows: LeaderRow[] = [];
  for (const pid of Object.keys(league.players)) {
    const p = league.players[pid]!;
    const row = currentRow(league, p);
    if (!row || row.gp < floor) continue;
    rows.push({
      playerId: pid,
      name: p.name,
      teamId: p.contract?.teamId ?? '',
      value: Math.round((fn(row) / row.gp) * 10) / 10,
      gp: row.gp,
    });
  }
  rows.sort((a, b) => b.value - a.value || a.playerId.localeCompare(b.playerId));
  return rows.slice(0, 15);
}

export function gameView(league: League, record: GameRecord, hasReplay: boolean): GameView {
  return {
    gameId: record.id,
    date: record.date,
    home: record.home,
    away: record.away,
    final: record.final,
    ot: record.ot,
    lines: record.lines,
    totals: record.totals,
    keyPlays: record.keyPlays,
    recap: league.news.find(n => n.gameId === record.id && n.type === 'recap') ?? null,
    officials: record.officials ?? null,
    hasReplay,
    hasBroadcast: hasReplay, // the broadcast script renders from the replay's events
  };
}

export function prospects(league: League): ProspectRow[] {
  const rows: ProspectRow[] = [];
  const mids = new Map<string, number>();
  for (const pid of league.draftClass) {
    const report = league.scouting[pid] ?? null;
    // consensus rank from the user's own report midpoints; unscouted
    // prospects sort to the back (the fog is the game, docs/FRANCHISE.md §9)
    let mid = 0;
    if (report) {
      const groups = Object.values(report.current);
      const ceil = Object.values(report.ceiling);
      mid = groups.reduce((s, [lo, hi]) => s + (lo + hi) / 2, 0) / Math.max(1, groups.length) * 0.6
        + ceil.reduce((s, [lo, hi]) => s + (lo + hi) / 2, 0) / Math.max(1, ceil.length) * 0.4;
    }
    mids.set(pid, mid);
  }
  const order = [...league.draftClass].sort((a, b) => (mids.get(b) ?? 0) - (mids.get(a) ?? 0) || a.localeCompare(b));
  order.forEach((pid, i) => {
    const p = league.players[pid]!;
    const bucket = i < 5 ? 'top five' : i < 14 ? 'lottery' : i < 30 ? 'first round' : i < 45 ? 'second round' : 'fringe';
    rows.push({
      id: pid,
      name: p.name,
      pos: p.pos,
      age: age(league, p),
      heightLabel: heightLabel(p.heightIn),
      origin: p.originDetail,
      report: league.scouting[pid] ?? null,
      projectedPick: bucket,
    });
  });
  return rows;
}

export function faMarket(league: League): FaRow[] {
  const rows: FaRow[] = [];
  for (const pid of league.freeAgents) {
    const p = league.players[pid]!;
    const ovr = overall(p);
    const a = age(league, p);
    // the agent's opening ask: a fair-AAV curve by grade, trimmed by age
    // (FEEL, display only; the market itself prices in ai/fa.ts)
    const cap = league.capLines[league.season]?.cap ?? 0;
    const share = Math.max(0.005, Math.min(0.30, Math.pow(Math.max(0, ovr - 40) / 59, 2.1) * 0.30));
    const ageTrim = a >= 34 ? 0.55 : a >= 31 ? 0.75 : 1;
    const askSalary = Math.round(cap * share * ageTrim);
    const askYears = a <= 26 ? 4 : a <= 30 ? 3 : a <= 33 ? 2 : 1;
    rows.push({
      id: pid, name: p.name, pos: p.pos, age: a, ovr,
      askYears, askSalary: Math.max(askSalary, 1_200_000),
      interest: ovr >= 75 ? 'high' : ovr >= 62 ? 'medium' : 'low',
      rights: p.rights ? `${p.rights.restricted ? 'RFA' : 'rights'} (${p.rights.teamId.toUpperCase()})` : null,
    });
  }
  rows.sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
  return rows;
}

export function summary(league: League, opts: { digest: DayDigest | null; simRunning: boolean }): Summary {
  const seedsFor = league.teams[league.userTeam]!.conference;
  const seeds = conferenceSeeds(league, seedsFor);
  const s = league.standings[league.userTeam];
  const todayGame = league.schedule.find(g =>
    g.date.day === league.day && g.date.season === league.season
    && (g.home === league.userTeam || g.away === league.userTeam)
    && !league.results[g.id]);
  const headlines: NewsItem[] = league.news
    .filter(n => n.weight >= 2)
    .slice(-6)
    .reverse();
  return {
    date: { season: league.season, day: league.day },
    dateLabel: dateLabel(league, league.day),
    phase: league.phase,
    userTeam: league.userTeam,
    record: {
      w: s?.w ?? 0,
      l: s?.l ?? 0,
      confSeed: seeds.indexOf(league.userTeam) + 1,
    },
    todayGame: todayGame
      ? {
          gameId: todayGame.id,
          opponent: todayGame.home === league.userTeam ? todayGame.away : todayGame.home,
          home: todayGame.home === league.userTeam,
        }
      : null,
    inboxOpen: league.inbox.filter(i => !i.resolved).length,
    headlines,
    digest: opts.digest,
    simRunning: opts.simRunning,
  };
}
