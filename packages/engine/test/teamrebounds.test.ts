/**
 * Team-rebound invariants: the dead-carom mechanic (possession.ts
 * tickScramble + params.reb.deadBallCaromChance) and the missed-non-final-FT
 * formality (fouls.ts tickFreeThrows) must produce the real log vocabulary
 * without corrupting box-score bookkeeping. Team totals count team
 * rebounds (official-scoring convention), player lines never do, and the
 * dead-ball formality counts nowhere (stats/box.ts).
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type GameResult } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';

const GAMES = 4;
const results: GameResult[] = [];
for (let i = 0; i < GAMES; i++) {
  const { home, away } = sampleMatchup();
  const flip = i % 2 === 1;
  results.push(simulateGame({
    seed: `teamreb-${i}`,
    home: flip ? away : home,
    away: flip ? home : away,
    collectFrames: false
  }));
}

describe(`team rebounds over ${GAMES} games`, () => {
  it('team rebounds occur, in both offensive and defensive flavors', () => {
    let off = 0;
    let def = 0;
    for (const r of results) {
      for (const e of r.events) {
        if (e.type !== 'rebound' || e.player || e.deadBall) continue;
        if (e.offensive) off++;
        else def++;
      }
    }
    // chance 0.12 over ~90 scrambles/game: double-digit counts across 4 games
    expect(off + def).toBeGreaterThan(10);
    expect(off).toBeGreaterThan(0);
    expect(def).toBeGreaterThan(0);
  });

  it('every missed non-final free throw logs the dead-ball formality rebound', () => {
    for (const r of results) {
      let expected = 0;
      let got = 0;
      for (const e of r.events) {
        if (e.type === 'free_throw' && !e.made && e.n < e.of) expected++;
        if (e.type === 'rebound' && e.deadBall) {
          got++;
          expect(e.offensive).toBe(true); // always the shooting team's ball
          expect(e.player === undefined).toBe(true);
        }
      }
      expect(got).toBe(expected);
    }
  });

  it('box totals = player rebounds + team rebounds; dead-ball formalities count nowhere', () => {
    for (const r of results) {
      const box = boxScore(r.events, r.teams);
      for (const side of [0, 1] as const) {
        let playerOrb = 0;
        let playerDrb = 0;
        for (const p of box.players.filter((x) => x.team === side)) {
          playerOrb += p.orb;
          playerDrb += p.drb;
          expect(p.trb).toBe(p.orb + p.drb);
        }
        let teamOrb = 0;
        let teamDrb = 0;
        for (const e of r.events) {
          if (e.type !== 'rebound' || e.team !== side || e.player || e.deadBall) continue;
          if (e.offensive) teamOrb++;
          else teamDrb++;
        }
        expect(box.teams[side].orb).toBe(playerOrb + teamOrb);
        expect(box.teams[side].drb).toBe(playerDrb + teamDrb);
        expect(box.teams[side].trb).toBe(box.teams[side].orb + box.teams[side].drb);
      }
    }
  });

  it('a defensive team rebound hands over via a dead-ball inbound, not a live burst', () => {
    let checked = 0;
    for (const r of results) {
      r.events.forEach((e, i) => {
        if (e.type !== 'rebound' || e.player || e.deadBall || e.offensive) return;
        // the possession flip: def_rebound outcome, then an 'inbound' start
        // for the awarded side (never 'live_rebound'; the ball went dead)
        const rest = r.events.slice(i + 1);
        const end = rest.find((n) => n.type === 'possession_end');
        const start = rest.find((n) => n.type === 'possession_start');
        expect(end !== undefined && end.type === 'possession_end' && end.outcome === 'def_rebound').toBe(true);
        if (start && start.type === 'possession_start') {
          expect(start.team).toBe(e.team);
          expect(start.kind).toBe('inbound');
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('possessions still balance with the new dead-ball flows', () => {
    for (const r of results) {
      const starts = r.events.filter((e) => e.type === 'possession_start').length;
      const ends = r.events.filter((e) => e.type === 'possession_end').length;
      expect(starts).toBe(ends);
    }
  });
});
