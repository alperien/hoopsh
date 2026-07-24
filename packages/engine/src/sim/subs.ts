/**
 * Substitutions: swapping players in/out of the lineup, fatigue-driven
 * rotation checks, and fouled-out replacement.
 */

import type { TeamSide } from '../core/events.js';
import { agent, emit, onCourt, type Agent, type GameState } from './state.js';

export function swapPlayers(s: GameState, side: TeamSide, out: Agent, into: Agent): void {
  const slots = s.lineup[side];
  const idx = slots.indexOf(out.p.id);
  if (idx === -1) return;
  slots[idx] = into.p.id;
  out.onCourt = false;
  into.onCourt = true;
  into.pos = { ...out.pos };
  into.vel = { x: 0, y: 0 };
  into.manId = out.manId;
  into.spotKey = out.spotKey;
  emit(s, { type: 'substitution', team: side, out: [out.p.id], in: [into.p.id] });
}

export function checkSubs(s: GameState): void {
  const P = s.params.sub;
  const crunch =
    s.period >= s.rules.periods &&
    s.clock < 300 &&
    Math.abs(s.score[0] - s.score[1]) <= 10;

  for (const side of [0, 1] as TeamSide[]) {
    const team = s.teams[side];
    const starters = new Set(team.starters);
    for (const id of [...s.lineup[side]]) {
      const a = agent(s, id);
      if (a.fouledOut) continue;
      if (crunch) {
        // close & late: get starters back on the floor if they can stand
        if (!starters.has(id)) {
          const starter = team.starters
            .map((sid) => agent(s, sid))
            .find((x) => !x.onCourt && !x.fouledOut && x.energy > 35);
          if (starter) swapPlayers(s, side, a, starter);
        }
        continue;
      }
      // starters run longer stints; bench players yield the floor back sooner
      const tiredAt = starters.has(id) ? P.tiredThreshold : P.tiredThreshold + 12;
      if (a.energy < tiredAt) {
        const bench = team.players
          .map((p) => agent(s, p.id))
          .filter((b) => !b.onCourt && !b.fouledOut && b.energy >= P.readyThreshold);
        if (bench.length === 0) continue;
        bench.sort((x, y) =>
          Number(y.p.pos === a.p.pos) - Number(x.p.pos === a.p.pos) || y.energy - x.energy
        );
        swapPlayers(s, side, a, bench[0]!);
      }
    }
  }
}

export function replaceFouledOut(s: GameState, out: Agent): void {
  const side = out.side;
  const bench = s.teams[side].players
    .map((p) => agent(s, p.id))
    .filter((a) => !a.onCourt && !a.fouledOut);
  if (bench.length === 0) return; // nobody left — play on (edge case)
  bench.sort((a, b) =>
    Number(b.p.pos === out.p.pos) - Number(a.p.pos === out.p.pos) || b.energy - a.energy
  );
  swapPlayers(s, side, out, bench[0]!);
}
