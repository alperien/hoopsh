/**
 * Substitutions: swapping players in/out of the lineup, fatigue-driven
 * rotation checks, and fouled-out replacement.
 *
 * `checkSubs` is called only from dead-ball choke points (`deadBall`,
 * `endPeriod` in possession.ts, `enterFreeThrows` in fouls.ts) — never
 * mid-live-play, since real substitutions only happen at stoppages.
 * `replaceFouledOut` is called synchronously from `recordFoul` the instant a
 * sixth (or rule-pack-defined) personal foul is charged.
 */

import type { TeamSide } from '../core/events.js';
import { agent, emit, onCourt, type Agent, type GameState } from './state.js';

/**
 * Swap one on-court player for one bench player in a team's lineup slot.
 * Inherits the outgoing player's position/defensive assignment/spacing spot
 * so the incoming player steps into the same role rather than teleporting to
 * a default spot — the replay shows a clean hand-off, not a jump-cut.
 * Resets velocity to zero (a fresh substitute walks on, doesn't inherit
 * momentum) and emits the `substitution` event that stats/box.ts uses to
 * track exact minutes played.
 */
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

/**
 * Fatigue- and situation-driven rotation pass over both lineups. Called at
 * every dead-ball opportunity (never mid-possession). Two distinct policies:
 * in "crunch time" (see `crunch` below) starters get pulled back onto the
 * floor over tired bench players regardless of the normal fatigue thresholds;
 * otherwise it's a simple energy-threshold check per player, pulling in the
 * best-rested same-position bench option.
 * `protect`: a player id who must stay on the floor no matter what (e.g. the
 * free-throw shooter mid-sequence) — skipped entirely by this pass.
 */
export function checkSubs(s: GameState, protect?: string): void {
  const P = s.params.sub;
  // crunch-time definition: final scheduled period (or OT), under 5 minutes
  // (300s) left, and a one-possession-ish game (10 points or fewer) — this is
  // when coaches ride their best five regardless of the clock's fatigue read
  const crunch =
    s.period >= s.rules.periods &&
    s.clock < 300 &&
    Math.abs(s.score[0] - s.score[1]) <= 10;

  for (const side of [0, 1] as TeamSide[]) {
    const team = s.teams[side];
    const starters = new Set(team.starters);
    for (const id of [...s.lineup[side]]) {
      if (id === protect) continue;
      const a = agent(s, id);
      if (a.fouledOut) continue;
      if (crunch) {
        // close & late: get starters back on the floor if they can stand —
        // energy > 35 is a much looser bar than the normal readyThreshold
        // (88): in crunch time you play your starter gassed rather than sit
        // him for a fresher bench piece
        if (!starters.has(id)) {
          const starter = team.starters
            .map((sid) => agent(s, sid))
            .find((x) => !x.onCourt && !x.fouledOut && x.energy > 35);
          if (starter) swapPlayers(s, side, a, starter);
        }
        continue;
      }
      // starters run longer stints; bench players yield the floor back sooner —
      // a starter plays until tiredThreshold, a reserve is pulled 12 energy
      // points earlier (shorter leash, deeper bench rotation)
      const tiredAt = starters.has(id) ? P.tiredThreshold : P.tiredThreshold + 12;
      if (a.energy < tiredAt) {
        const bench = team.players
          .map((p) => agent(s, p.id))
          .filter((b) => !b.onCourt && !b.fouledOut && b.energy >= P.readyThreshold);
        if (bench.length === 0) continue;
        // prefer a same-position replacement (Number(bool) sorts true before
        // false when used as the primary comparator: 1 - 0 > 0 means the
        // same-position match sorts first), then most-rested among ties
        bench.sort((x, y) =>
          Number(y.p.pos === a.p.pos) - Number(x.p.pos === a.p.pos) || y.energy - x.energy
        );
        swapPlayers(s, side, a, bench[0]!);
      }
    }
  }
}

/**
 * Immediately replace a fouled-out player with the best available bench
 * option. Called synchronously from `recordFoul` the moment `fouler.fouls`
 * crosses the rule pack's foul-out limit — unlike `checkSubs`, this fires
 * mid-live-play (a foul-out can happen at any point in the action), not just
 * at dead-ball checkpoints, because the rules require it immediately.
 */
export function replaceFouledOut(s: GameState, out: Agent): void {
  const side = out.side;
  const bench = s.teams[side].players
    .map((p) => agent(s, p.id))
    .filter((a) => !a.onCourt && !a.fouledOut);
  if (bench.length === 0) return; // nobody left — play on (edge case)
  // same-position preference first (see the identical trick in checkSubs),
  // then most-rested — a foul-out replacement isn't fatigue-triggered, so
  // energy is just a tiebreaker among equally-positioned options, not a gate
  bench.sort((a, b) =>
    Number(b.p.pos === out.p.pos) - Number(a.p.pos === out.p.pos) || b.energy - a.energy
  );
  swapPlayers(s, side, out, bench[0]!);
}
