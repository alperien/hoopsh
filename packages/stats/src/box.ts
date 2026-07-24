/**
 * Fold a hoopsh event stream into a box score.
 *
 * Because the sim is the source of truth, nothing here is estimated:
 * minutes come from lineup timelines, possessions from possession events,
 * plus-minus from score deltas while on the floor.
 */

import type { GameEvent, ShotEvent, Team, TeamSide } from '@hoopsh/engine';

export interface ZoneLine {
  rim: { m: number; a: number };
  paint: { m: number; a: number };
  mid: { m: number; a: number };
  three: { m: number; a: number };
}

export interface PlayerLine {
  id: string;
  name: string;
  team: TeamSide;
  min: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  trb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  plusMinus: number;
  zones: ZoneLine;
}

export interface TeamTotals {
  side: TeamSide;
  teamId: string;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  trb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  poss: number;
  fastbreakPts: number;
}

export interface BoxScore {
  players: PlayerLine[];
  teams: [TeamTotals, TeamTotals];
  finalScore: [number, number];
  /** possessions per team per 48 min equivalent */
  pace: number;
  periods: number;
  shotEvents: ShotEvent[];
}

function emptyZones(): ZoneLine {
  return {
    rim: { m: 0, a: 0 },
    paint: { m: 0, a: 0 },
    mid: { m: 0, a: 0 },
    three: { m: 0, a: 0 }
  };
}

export function boxScore(events: GameEvent[], teams: [Team, Team]): BoxScore {
  const lines = new Map<string, PlayerLine>();
  const teamOf = new Map<string, TeamSide>();
  for (const side of [0, 1] as TeamSide[]) {
    for (const p of teams[side].players) {
      teamOf.set(p.id, side);
      lines.set(p.id, {
        id: p.id, name: p.name, team: side,
        min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
        orb: 0, drb: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
        plusMinus: 0, zones: emptyZones()
      });
    }
  }
  const totals: [TeamTotals, TeamTotals] = [0, 1].map((side) => ({
    side: side as TeamSide,
    teamId: teams[side as TeamSide].id,
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    poss: 0, fastbreakPts: 0
  })) as [TeamTotals, TeamTotals];

  const onCourt: [Set<string>, Set<string>] = [new Set(), new Set()];
  let lastT = 0;
  let finalScore: [number, number] = [0, 0];
  let periods = 0;
  const shotEvents: ShotEvent[] = [];
  let transitionPoss: [boolean, boolean] = [false, false];

  const accrueMinutes = (t: number): void => {
    const dt = t - lastT;
    if (dt > 0) {
      for (const side of [0, 1] as TeamSide[]) {
        for (const id of onCourt[side]) {
          const line = lines.get(id);
          if (line) line.min += dt;
        }
      }
    }
    lastT = t;
  };

  const scorePoints = (side: TeamSide, pts: number): void => {
    totals[side].pts += pts;
    for (const id of onCourt[side]) lines.get(id)!.plusMinus += pts;
    for (const id of onCourt[side === 0 ? 1 : 0]) lines.get(id)!.plusMinus -= pts;
  };

  for (const e of events) {
    accrueMinutes(e.t);
    finalScore = e.score;
    switch (e.type) {
      case 'game_start': {
        onCourt[0] = new Set(e.home.lineup);
        onCourt[1] = new Set(e.away.lineup);
        break;
      }
      case 'substitution': {
        for (const id of e.out) onCourt[e.team].delete(id);
        for (const id of e.in) onCourt[e.team].add(id);
        break;
      }
      case 'period_start': break;
      case 'period_end': periods += 1; break;
      case 'possession_start': {
        transitionPoss[e.team] = e.kind === 'steal' || e.kind === 'live_rebound';
        break;
      }
      case 'possession_end': {
        totals[e.team].poss += 1;
        break;
      }
      case 'shot': {
        shotEvents.push(e);
        const line = lines.get(e.shooter)!;
        line.fga += 1;
        totals[e.team].fga += 1;
        const zone = line.zones[e.zone];
        zone.a += 1;
        if (e.three) { line.tpa += 1; totals[e.team].tpa += 1; }
        if (e.made) {
          line.fgm += 1;
          totals[e.team].fgm += 1;
          zone.m += 1;
          line.pts += e.points;
          if (e.three) { line.tpm += 1; totals[e.team].tpm += 1; }
          scorePoints(e.team, e.points);
          if (transitionPoss[e.team]) totals[e.team].fastbreakPts += e.points;
          if (e.assist) {
            const passer = lines.get(e.assist);
            if (passer) { passer.ast += 1; totals[e.team].ast += 1; }
          }
        }
        if (e.blockedBy) {
          const blocker = lines.get(e.blockedBy);
          if (blocker) {
            blocker.blk += 1;
            totals[blocker.team].blk += 1;
          }
        }
        break;
      }
      case 'free_throw': {
        const line = lines.get(e.shooter)!;
        line.fta += 1;
        totals[e.team].fta += 1;
        if (e.made) {
          line.ftm += 1;
          totals[e.team].ftm += 1;
          line.pts += 1;
          scorePoints(e.team, 1);
        }
        break;
      }
      case 'rebound': {
        const line = lines.get(e.player)!;
        if (e.offensive) { line.orb += 1; totals[e.team].orb += 1; }
        else { line.drb += 1; totals[e.team].drb += 1; }
        line.trb += 1;
        totals[e.team].trb += 1;
        break;
      }
      case 'turnover': {
        const line = lines.get(e.player)!;
        line.tov += 1;
        totals[e.team].tov += 1;
        if (e.stolenBy) {
          const thief = lines.get(e.stolenBy);
          if (thief) {
            thief.stl += 1;
            totals[thief.team].stl += 1;
          }
        }
        break;
      }
      case 'foul': {
        const line = lines.get(e.on)!;
        line.pf += 1;
        totals[e.team].pf += 1;
        break;
      }
      default: break;
    }
  }

  for (const line of lines.values()) line.min = Math.round((line.min / 60) * 10) / 10;

  const totalPoss = totals[0].poss + totals[1].poss;
  const gameMinutes = Math.max(1, lastT / 60);
  const pace = (totalPoss / 2) * (48 / gameMinutes);

  return {
    players: [...lines.values()],
    teams: totals,
    finalScore,
    pace: Math.round(pace * 10) / 10,
    periods,
    shotEvents
  };
}

// ---------------------------------------------------------------- derived

export function fgPct(t: { fgm: number; fga: number }): number {
  return t.fga === 0 ? 0 : t.fgm / t.fga;
}

export function tpPct(t: { tpm: number; tpa: number }): number {
  return t.tpa === 0 ? 0 : t.tpm / t.tpa;
}

export function ftPct(t: { ftm: number; fta: number }): number {
  return t.fta === 0 ? 0 : t.ftm / t.fta;
}

export function tsPct(t: { pts: number; fga: number; fta: number }): number {
  const denom = 2 * (t.fga + 0.44 * t.fta);
  return denom === 0 ? 0 : t.pts / denom;
}

export function efgPct(t: { fgm: number; tpm: number; fga: number }): number {
  return t.fga === 0 ? 0 : (t.fgm + 0.5 * t.tpm) / t.fga;
}

export function ortg(t: TeamTotals): number {
  return t.poss === 0 ? 0 : (t.pts / t.poss) * 100;
}

/** offensive rebound percentage for a side, given both team totals */
export function orbPct(own: TeamTotals, opp: TeamTotals): number {
  const denom = own.orb + opp.drb;
  return denom === 0 ? 0 : own.orb / denom;
}
