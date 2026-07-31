/**
 * career-views.ts - read-model builders for the career API: trimmed,
 * display-ready payloads so the UI never receives the whole CareerState
 * (the league players map alone would swamp it). Mirrors views.ts for
 * the franchise chair.
 */
import type { GameRecord } from '@hoopsh/franchise';
import type { CareerState, CircuitGame } from '@hoopsh/career';
import { careerEarnings, legacyScore, openOffers, planFor } from '@hoopsh/career';

function heightLabel(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function me(career: CareerState) {
  return career.players[career.me] ?? career.league.players[career.me] ?? null;
}

const PHASE_LABELS: Record<CareerState['clock']['phase'], string> = {
  hs: 'high school, senior year',
  college: 'college',
  euro: 'Europe',
  nbl: 'the NBL',
  draftPrep: 'the pre-draft window',
  nba: 'the league',
  china: 'the CBA',
  retired: 'retired',
};

function teamName(career: CareerState, teamId: string): string {
  const circuitTeam = career.circuit?.teams.find(t => t.id === teamId);
  if (circuitTeam) return circuitTeam.name;
  const leagueTeam = career.league.teams[teamId];
  if (leagueTeam) return `${leagueTeam.city} ${leagueTeam.name}`;
  return teamId;
}

function scheduleRow(career: CareerState, g: CircuitGame) {
  const c = career.circuit!;
  const home = c.teams[g.homeIdx];
  const away = c.teams[g.awayIdx];
  const record = c.results[g.id];
  const myTeamId = c.teams[c.myTeamIdx]?.id;
  return {
    gameId: g.id,
    week: g.week,
    type: g.type,
    round: g.round ?? null,
    home: home ? home.name : '?',
    away: away ? away.name : '?',
    homeAbbrev: home?.abbrev ?? '?',
    awayAbbrev: away?.abbrev ?? '?',
    final: record ? record.final : null,
    ot: record?.ot ?? 0,
    myGame: Boolean(myTeamId && home && away && (home.id === myTeamId || away.id === myTeamId)),
  };
}

/** The career dashboard: one call, everything the home screen shows. */
export function careerSummary(career: CareerState, opts: { simRunning: boolean }) {
  const player = me(career);
  const c = career.circuit;
  const myTeam = c?.teams[c.myTeamIdx] ?? null;
  const myRow = c?.standings.find(s => s.teamIdx === c.myTeamIdx);
  const nextGame = c && !c.complete
    ? [...c.schedule, ...c.bracket]
      .filter(g => !c.results[g.id] && g.week >= career.clock.week)
      .sort((a, b) => a.week - b.week)[0] ?? null
    : null;
  const lastGrade = career.coach.grades[career.coach.grades.length - 1] ?? null;
  const unread = career.phone.filter(m => m.choices && m.choices.length > 0 && !m.chosen).length;

  return {
    clock: career.clock,
    phaseLabel: PHASE_LABELS[career.clock.phase],
    me: player ? {
      id: player.id,
      name: player.name,
      pos: player.pos,
      age: career.clock.year - player.bornSeason,
      heightLabel: heightLabel(player.heightIn),
      energy: career.energy,
      morale: player.morale,
      wear: Math.round(player.health.wear * 10) / 10,
      injury: player.health.injury
        ? { label: player.health.injury.label, weeksOut: Math.max(1, Math.ceil(player.health.injury.remainingDays / 7)) }
        : null,
    } : null,
    coach: {
      name: career.coach.name,
      personality: career.coach.personality,
      trust: career.coach.trust,
      role: career.coach.role,
      greenLight: career.coach.greenLight,
      lastGrade,
    },
    team: myTeam ? {
      name: myTeam.name,
      abbrev: myTeam.abbrev,
      colors: myTeam.colors,
      w: myRow?.w ?? 0,
      l: myRow?.l ?? 0,
    } : null,
    nbaTeam: career.nbaTeam,
    nextGame: nextGame && c ? scheduleRow(career, nextGame) : nbaNextGame(career),
    recentGames: recentGamesFor(career),
    stock: career.stock ? {
      rank: career.stock.rank,
      last: career.stock.history[career.stock.history.length - 1] ?? null,
      combineDone: career.stock.combineDone,
      invites: career.stock.workoutInvites.length,
    } : null,
    recruiting: career.recruiting ? {
      offers: openOffers(career).length,
      committedTo: career.recruiting.committedTo ?? null,
      hottest: [...career.recruiting.interest]
        .filter(i => !i.closed)
        .sort((a, b) => b.perceived - a.perceived)
        .slice(0, 3)
        .map(i => ({
          program: career.recruiting!.programs.find(p => p.id === i.programId)?.name ?? i.programId,
          rung: i.rung,
        })),
    } : null,
    earnings: careerEarnings(career),
    weekPlan: career.weekPlan,
    approach: career.approach,
    nextApproach: career.nextApproach,
    phoneUnread: unread,
    eventsTail: career.events.slice(-12).reverse(),
    epilogue: career.epilogue,
    gradient: gradientFor(career),
    nextBeat: nextBeatFor(career),
    simRunning: opts.simRunning,
  };
}

/** The NBA phase's next-game card: read the league schedule directly. */
function nbaNextGame(career: CareerState) {
  if (career.clock.phase !== 'nba' || !career.nbaTeam) return null;
  const upcoming = career.league.schedule
    .filter(g => (g.home === career.nbaTeam || g.away === career.nbaTeam)
      && !career.league.results[g.id]
      && g.date.season === career.league.season
      && g.date.day >= career.league.day)
    .sort((a, b) => a.date.day - b.date.day)[0];
  if (!upcoming) return null;
  return {
    gameId: upcoming.id,
    week: career.clock.week,
    type: 'regular' as const,
    round: null,
    home: teamName(career, upcoming.home),
    away: teamName(career, upcoming.away),
    homeAbbrev: career.league.teams[upcoming.home]?.abbrev ?? '?',
    awayAbbrev: career.league.teams[upcoming.away]?.abbrev ?? '?',
    final: null,
    ot: 0,
    myGame: true,
  };
}

/** My last few finished games, either chair, newest first. */
function recentGamesFor(career: CareerState) {
  const rows: Array<{ gameId: string; home: string; away: string; final: [number, number]; win: boolean }> = [];
  if (career.clock.phase === 'nba' && career.nbaTeam) {
    const mine = Object.values(career.league.results)
      .filter(r => r.home === career.nbaTeam || r.away === career.nbaTeam)
      .sort((a, b) => b.date.season - a.date.season || b.date.day - a.date.day)
      .slice(0, 3);
    for (const r of mine) {
      const homeWin = r.final[0] > r.final[1];
      const iAmHome = r.home === career.nbaTeam;
      rows.push({
        gameId: r.id, home: teamName(career, r.home), away: teamName(career, r.away),
        final: r.final, win: iAmHome ? homeWin : !homeWin,
      });
    }
    return rows;
  }
  const c = career.circuit;
  if (!c) return rows;
  const myTeamId = c.teams[c.myTeamIdx]?.id;
  if (!myTeamId) return rows;
  const mine = Object.values(c.results)
    .filter(r => r.home === myTeamId || r.away === myTeamId)
    .slice(-3)
    .reverse();
  for (const r of mine) {
    const homeWin = r.final[0] > r.final[1];
    const iAmHome = r.home === myTeamId;
    rows.push({
      gameId: r.id, home: teamName(career, r.home), away: teamName(career, r.away),
      final: r.final, win: iAmHome ? homeWin : !homeWin,
    });
  }
  return rows;
}

/**
 * The windshield: what the player is playing FOR right now. Everything
 * derives from state the systems already keep; the genre's rule is that
 * the carrot must be visible before the bite, not explained after it.
 */
function gradientFor(career: CareerState) {
  const t = career.params.trust;
  const roles = ['garbage', 'bench', 'rotation', 'sixthMan', 'starter', 'featured', 'franchise'];
  const idx = roles.indexOf(career.coach.role);
  const nearestOffer = career.recruiting && !career.recruiting.committedTo
    ? career.recruiting.offers
      .filter(o => career.clock.week < o.expiresWeek)
      .sort((a, b) => a.expiresWeek - b.expiresWeek)[0] ?? null
    : null;
  return {
    role: {
      current: career.coach.role,
      above: career.coach.roleClock.above,
      below: career.coach.roleClock.below,
      needed: t.reactGames,
      next: idx < roles.length - 1 ? roles[idx + 1] : null,
      danger: idx > 0 ? roles[idx - 1] : null,
    },
    stockLast: career.stock?.history[career.stock.history.length - 1] ?? null,
    nearestOffer: nearestOffer
      ? {
        id: nearestOffer.id,
        dest: career.recruiting!.programs.find(p => p.id === nearestOffer.programId)?.name
          ?? nearestOffer.clubName ?? 'the program',
        expiresWeek: nearestOffer.expiresWeek,
        weeksLeft: nearestOffer.expiresWeek - career.clock.week,
      }
      : null,
  };
}

/** The next date on the calendar worth living toward. */
function nextBeatFor(career: CareerState): { label: string; week: number; weeksAway: number } | null {
  const t = career.params.tick;
  const phase = career.clock.phase;
  const week = career.clock.week;
  const candidates: Array<{ label: string; week: number }> = [];

  if (career.circuit && !career.circuit.complete) {
    return null; // in season the next game IS the beat; the schedule shows it
  }
  if (phase === 'hs') {
    if (!career.recruiting?.committedTo) candidates.push({ label: 'signing day', week: t.weeksPerYear });
    candidates.push({ label: 'the college season opens', week: t.weeksPerYear + t.collegeSeasonStartWeek });
  } else if (phase === 'college') {
    candidates.push({ label: 'the season opens', week: week < t.collegeSeasonStartWeek ? t.collegeSeasonStartWeek : t.weeksPerYear + t.collegeSeasonStartWeek });
  } else if (phase === 'euro' || phase === 'nbl' || phase === 'china') {
    candidates.push({ label: 'the season opens', week: week < t.proSeasonStartWeek ? t.proSeasonStartWeek : t.weeksPerYear + t.proSeasonStartWeek });
  } else if (phase === 'draftPrep') {
    if (week < t.combineWeek) candidates.push({ label: 'the combine', week: t.combineWeek });
    if (week < t.draftWeek) candidates.push({ label: 'draft night', week: t.draftWeek });
  }
  const next = candidates.filter(c => c.week > week).sort((a, b) => a.week - b.week)[0];
  if (!next) return null;
  return { label: next.label, week: next.week % t.weeksPerYear, weeksAway: next.week - week };
}

/** My true sheet: attributes and tendencies, ceilings stay hidden. */
export function meView(career: CareerState) {
  const player = me(career);
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    pos: player.pos,
    age: career.clock.year - player.bornSeason,
    heightLabel: heightLabel(player.heightIn),
    weightLb: player.weightLb,
    attr: player.attr,
    tend: player.tend,
    morale: player.morale,
    health: {
      wear: player.health.wear,
      proneness: player.health.proneness,
      injury: player.health.injury,
      history: player.health.history,
    },
    devLog: player.devLog.slice(-30),
    creation: {
      background: career.creation.background,
      preset: career.creation.preset,
      signatures: career.creation.signatures,
      birthplace: career.creation.birthplace,
    },
  };
}

/** The circuit screen: standings, schedule, bracket, my season row. */
export function circuitView(career: CareerState) {
  const c = career.circuit;
  if (!c) {
    return {
      circuit: null,
      history: career.circuitHistory,
    };
  }
  return {
    circuit: {
      id: c.id,
      kind: c.kind,
      year: c.year,
      complete: c.complete,
      myTeamIdx: c.myTeamIdx,
      teams: c.teams.map(t => ({ id: t.id, name: t.name, abbrev: t.abbrev, colors: t.colors })),
      standings: [...c.standings]
        .sort((a, b) => b.w - a.w || (b.pf - b.pa) - (a.pf - a.pa))
        .map(s => ({ ...s, name: c.teams[s.teamIdx]?.name ?? '?' })),
      schedule: c.schedule.map(g => scheduleRow(career, g)),
      bracket: c.bracket.map(g => scheduleRow(career, g)),
    },
    history: career.circuitHistory,
  };
}

/** A circuit game center: box score with names resolved. */
export function careerGameView(career: CareerState, record: GameRecord, hasReplay: boolean) {
  const names: Record<string, string> = {};
  for (const line of record.lines) {
    const p = career.players[line.playerId] ?? career.league.players[line.playerId];
    if (p) names[line.playerId] = p.name;
  }
  return {
    gameId: record.id,
    date: record.date,
    home: teamName(career, record.home),
    away: teamName(career, record.away),
    final: record.final,
    ot: record.ot,
    lines: record.lines,
    names,
    totals: record.totals,
    keyPlays: record.keyPlays,
    grade: career.coach.grades.find(g => g.gameId === record.id) ?? null,
    me: career.me,
    hasReplay,
    hasBroadcast: hasReplay,
  };
}

/** The plan screen: tonight's ranges, my dials, the ledger behind them. */
export function planView(career: CareerState) {
  return {
    plan: planFor(career),
    approach: career.approach,
    nextApproach: career.nextApproach,
    coach: {
      name: career.coach.name,
      personality: career.coach.personality,
      trust: career.coach.trust,
      role: career.coach.role,
      greenLight: career.coach.greenLight,
      roleClock: career.coach.roleClock,
    },
    grades: career.coach.grades.slice(-15).reverse(),
    playingHurtAvailable: Boolean(me(career)?.health.injury),
  };
}

/** The recruiting board: programs joined with my interest ladder. */
export function recruitingView(career: CareerState) {
  const r = career.recruiting;
  if (!r) return { programs: [], offers: [], committedTo: null };
  return {
    programs: r.programs.map(p => {
      const interest = r.interest.find(i => i.programId === p.id) ?? null;
      return {
        id: p.id, name: p.name, tier: p.tier, region: p.region,
        coachDev: p.coachDev, promisedRole: p.promisedRole, nil: p.nil,
        style: p.style,
        rung: interest?.rung ?? 'none',
        closed: interest?.closed ?? false,
        closedReason: interest?.closedReason ?? null,
      };
    }),
    offers: r.offers,
    committedTo: r.committedTo ?? null,
  };
}

/** The stock ladder: rank, history, boards, invites. */
export function stockView(career: CareerState) {
  const s = career.stock;
  if (!s) return null;
  const teams = Object.fromEntries(
    Object.values(career.league.teams).map(t => [t.id, `${t.city} ${t.name}`]),
  );
  return {
    rank: s.rank,
    history: s.history.slice(-40),
    combineDone: s.combineDone,
    workoutInvites: s.workoutInvites.map(t => ({ teamId: t, name: teams[t] ?? t })),
    workoutsDone: s.workoutsDone.map(t => ({ teamId: t, name: teams[t] ?? t })),
    board: Object.entries(s.perTeam)
      .map(([teamId, value]) => ({ teamId, name: teams[teamId] ?? teamId, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value),
  };
}

/** The epilogue screen: what remains when the ball stops. */
export function epilogueView(career: CareerState) {
  if (!career.epilogue) return null;
  return {
    ...career.epilogue,
    legacyScore: legacyScore(career),
    ledger: career.ledger,
    seasons: career.circuitHistory,
    honorsTimeline: career.events.filter(e => e.kind === 'honor'),
  };
}


/**
 * The green room: the whole first round as it happened, my pick marked,
 * the rival's marked, the mock's last read for the gap line. Everything
 * from league.transactions; nothing invented.
 */
export function draftNightView(career: CareerState) {
  const all = career.league.transactions
    .filter((t): t is Extract<typeof t, { kind: 'draftSelection' }> => t.kind === 'draftSelection');
  if (all.length === 0) return null;
  // MY draft class when I was picked; the latest class otherwise
  const mine = all.find(p => p.playerId === career.me) ?? null;
  const season = mine ? mine.date.season : all[all.length - 1]!.date.season;
  const picks = all.filter(p => p.date.season === season);
  const rival = picks.find(p => p.playerId === career.rivalId) ?? null;
  const mockAtEntry = career.stock?.history.length
    ? career.stock.history[career.stock.history.length - 1]!.rank
    : null;
  const rows = picks
    .filter((p): p is Extract<typeof p, { kind: 'draftSelection' }> => p.kind === 'draftSelection')
    .map(p => {
      const player = career.league.players[p.playerId];
      const team = career.league.teams[p.teamId];
      return {
        round: p.round,
        pick: p.pick,
        overall: (p.round - 1) * 30 + p.pick,
        teamId: p.teamId,
        team: team ? `${team.city} ${team.name}` : p.teamId,
        colors: team?.colors ?? null,
        player: player?.name ?? p.playerId,
        mine: p.playerId === career.me,
        rival: p.playerId === career.rivalId,
      };
    })
    .sort((a, b) => a.overall - b.overall);
  const contract = mine ? career.league.players[career.me]?.contract ?? null : null;
  return {
    picks: rows,
    myPick: mine && mine.kind === 'draftSelection' ? (mine.round - 1) * 30 + mine.pick : null,
    rivalPick: rival && rival.kind === 'draftSelection' ? (rival.round - 1) * 30 + rival.pick : null,
    mockAtEntry,
    rookieDeal: contract
      ? { firstYear: contract.years[0]?.salary ?? null, years: contract.years.length }
      : null,
    undrafted: !mine,
  };
}
