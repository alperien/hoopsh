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

function teamName(career: CareerState, circuitTeamId: string): string {
  return career.circuit?.teams.find(t => t.id === circuitTeamId)?.name ?? circuitTeamId;
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
      name: `${player.first} ${player.last}`,
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
    nextGame: nextGame && c ? scheduleRow(career, nextGame) : null,
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
    simRunning: opts.simRunning,
  };
}

/** My true sheet: attributes and tendencies, ceilings stay hidden. */
export function meView(career: CareerState) {
  const player = me(career);
  if (!player) return null;
  return {
    id: player.id,
    name: `${player.first} ${player.last}`,
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
    if (p) names[line.playerId] = `${p.first} ${p.last}`;
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
