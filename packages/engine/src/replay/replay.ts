/**
 * Replay format: everything a viewer needs to render a game with zero
 * re-simulation — metadata, downsampled position frames, the event stream,
 * and a lineup timeline (who occupies which frame slot, over time).
 *
 * Frame row layout:
 *   [t, period, clock, ballX, ballY, holderSlot, h0x, h0y ... h4x, h4y, a0x, a0y ... a4x, a4y]
 * holderSlot: 0-4 home slots, 5-9 away slots, -1 = ball loose/in flight.
 */

import type { GameEvent } from '../core/events.js';
import type { GameResult } from '../sim/game.js';

export interface ReplayPlayerMeta {
  id: string;
  name: string;
  pos: string;
  heightIn: number;
}

export interface ReplayTeamMeta {
  id: string;
  name: string;
  abbrev: string;
  players: ReplayPlayerMeta[];
}

export interface LineupSnapshot {
  /** wall-clock timeline seconds this lineup takes effect */
  t: number;
  side: 0 | 1;
  slots: string[];
}

export interface Replay {
  version: 1;
  seed: string;
  rules: {
    id: string;
    courtLengthFt: number;
    courtWidthFt: number;
    rimInsetFt: number;
    three: { arcRadiusFt: number; cornerDistFt: number; cornerBreakFt: number };
    periods: number;
    periodMinutes: number;
  };
  teams: [ReplayTeamMeta, ReplayTeamMeta];
  finalScore: [number, number];
  lineups: LineupSnapshot[];
  frames: number[][];
  events: GameEvent[];
}

export function buildReplay(result: GameResult): Replay {
  const teamMeta = (side: 0 | 1): ReplayTeamMeta => {
    const t = result.teams[side];
    return {
      id: t.id,
      name: t.name,
      abbrev: t.abbrev,
      players: t.players.map((p) => ({
        id: p.id, name: p.name, pos: p.pos, heightIn: p.heightIn
      }))
    };
  };

  // fold substitutions into a lineup timeline
  const lineups: LineupSnapshot[] = [];
  const current: [string[], string[]] = [[], []];
  for (const e of result.events) {
    if (e.type === 'game_start') {
      current[0] = [...e.home.lineup];
      current[1] = [...e.away.lineup];
      lineups.push({ t: e.wt, side: 0, slots: [...current[0]] });
      lineups.push({ t: e.wt, side: 1, slots: [...current[1]] });
    } else if (e.type === 'substitution') {
      const slots = current[e.team];
      for (let i = 0; i < e.out.length; i++) {
        const idx = slots.indexOf(e.out[i]!);
        if (idx !== -1 && e.in[i]) slots[idx] = e.in[i]!;
      }
      lineups.push({ t: e.wt, side: e.team, slots: [...slots] });
    }
  }

  return {
    version: 1,
    seed: result.seed,
    rules: {
      id: result.rules.id,
      courtLengthFt: result.rules.courtLengthFt,
      courtWidthFt: result.rules.courtWidthFt,
      rimInsetFt: result.rules.rimInsetFt,
      three: { ...result.rules.three },
      periods: result.rules.periods,
      periodMinutes: result.rules.periodMinutes
    },
    teams: [teamMeta(0), teamMeta(1)],
    finalScore: result.finalScore,
    lineups,
    frames: result.frames,
    events: result.events
  };
}
