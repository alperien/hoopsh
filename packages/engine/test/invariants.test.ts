/**
 * Invariant suite — every guarantee the adversarial audits verified, made
 * PERMANENT. Audits are point-in-time; these run on every change.
 *
 * Provenance (audit rounds 1 & 2, 2026-07-24):
 *  - possession_end double-emission (and-ones/buzzers) inflated pace ~2.8%
 *  - passes caught after the horn scored post-buzzer baskets (2/300 games
 *    were decided by them)
 *  - game clock ran past the horn, breaking minutes conservation
 *  - FT shooters got substituted mid-sequence and shot from the bench
 * All fixed — these tests keep them fixed.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent, type GameResult } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';

const GAMES = 12;

// sim once, assert many
const results: GameResult[] = [];
for (let i = 0; i < GAMES; i++) {
  const { home, away } = sampleMatchup();
  const flip = i % 2 === 1;
  results.push(simulateGame({
    seed: `invariant-${i}`,
    home: flip ? away : home,
    away: flip ? home : away,
    collectFrames: true
  }));
}

/** fold the on-court lineups through the event stream */
function lineupAt(events: GameEvent[]): (idx: number) => [Set<string>, Set<string>] {
  const snapshots: { idx: number; lineups: [Set<string>, Set<string>] }[] = [];
  let current: [Set<string>, Set<string>] = [new Set(), new Set()];
  events.forEach((e, idx) => {
    if (e.type === 'game_start') {
      current = [new Set(e.home.lineup), new Set(e.away.lineup)];
    } else if (e.type === 'substitution') {
      const next: [Set<string>, Set<string>] = [new Set(current[0]), new Set(current[1])];
      for (const id of e.out) next[e.team].delete(id);
      for (const id of e.in) next[e.team].add(id);
      current = next;
    }
    snapshots.push({ idx, lineups: current });
  });
  return (idx) => snapshots[idx]!.lineups;
}

describe(`engine invariants over ${GAMES} games`, () => {
  it('every possession ends exactly once (pace integrity)', () => {
    for (const r of results) {
      const starts = r.events.filter((e) => e.type === 'possession_start').length;
      const ends = r.events.filter((e) => e.type === 'possession_end').length;
      expect(starts).toEqual(ends);
    }
  });

  it('no scoring event past its period horn (game-clock time is conserved)', () => {
    const periodLen = 12 * 60;
    for (const r of results) {
      for (const e of r.events) {
        if ((e.type === 'shot' && e.made) || (e.type === 'free_throw' && e.made)) {
          const regulationPeriods = 4;
          const cap = e.period <= regulationPeriods
            ? e.period * periodLen
            : regulationPeriods * periodLen + (e.period - regulationPeriods) * 5 * 60;
          expect(e.t).toBeLessThanOrEqual(cap + 0.001);
        }
      }
    }
  });

  it('score is reconstructible from events alone (the event-stream contract)', () => {
    for (const r of results) {
      const recon: [number, number] = [0, 0];
      for (const e of r.events) {
        if (e.type === 'shot' && e.made) recon[e.team] += e.points;
        if (e.type === 'free_throw' && e.made) recon[e.team] += 1;
      }
      expect(recon).toEqual(r.finalScore);
    }
  });

  it('team minutes sum to 5 × game length (within display rounding)', () => {
    for (const r of results) {
      const box = boxScore(r.events, r.teams);
      const gameMin = box.periods <= 4 ? 48 : 48 + (box.periods - 4) * 5;
      for (const side of [0, 1] as const) {
        const mins = box.players.filter((p) => p.team === side).reduce((a, p) => a + p.min, 0);
        expect(Math.abs(mins - gameMin * 5)).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it('plus-minus is zero-sum and equals margin × 5', () => {
    for (const r of results) {
      const box = boxScore(r.events, r.teams);
      const sum = (side: 0 | 1) =>
        box.players.filter((p) => p.team === side).reduce((a, p) => a + p.plusMinus, 0);
      const margin = r.finalScore[0] - r.finalScore[1];
      expect(sum(0)).toEqual(margin * 5);
      expect(sum(0) + sum(1)).toEqual(0);
    }
  });

  it('no off-court player ever shoots, rebounds, passes, steals, or takes free throws', () => {
    for (const r of results) {
      const at = lineupAt(r.events);
      r.events.forEach((e, idx) => {
        const on = at(idx);
        const check = (id: string | undefined, side: 0 | 1) => {
          if (id) expect(on[side].has(id)).toBe(true);
        };
        if (e.type === 'shot') { check(e.shooter, e.team); check(e.assist, e.team); }
        if (e.type === 'free_throw') check(e.shooter, e.team);
        if (e.type === 'rebound') check(e.player, e.team);
        if (e.type === 'pass') { check(e.from, e.team); check(e.to, e.team); }
        if (e.type === 'turnover' && e.stolenBy) check(e.stolenBy, e.team === 0 ? 1 : 0);
      });
    }
  });

  it('fouled-out players never act again', () => {
    for (const r of results) {
      const outAt = new Map<string, number>(); // playerId -> event index of foul-out
      r.events.forEach((e, idx) => {
        if (e.type === 'foul' && e.fouledOut) outAt.set(e.on, idx);
      });
      r.events.forEach((e, idx) => {
        const actors: string[] = [];
        if (e.type === 'shot') actors.push(e.shooter, ...(e.assist ? [e.assist] : []));
        if (e.type === 'free_throw') actors.push(e.shooter);
        if (e.type === 'rebound' && e.player) actors.push(e.player); // team rebounds credit nobody
        if (e.type === 'pass') actors.push(e.from, e.to);
        for (const a of actors) {
          const boundary = outAt.get(a);
          if (boundary !== undefined && idx > boundary) {
            // free throws by the fouled-out player immediately after his own
            // foul-out are legal only when he was the one fouled — engine
            // does not produce that flow; assert strictly
            expect(idx).toBeLessThanOrEqual(boundary);
          }
        }
      });
    }
  });

  it('offense-bearing events belong to the possessing team', () => {
    for (const r of results) {
      let possTeam: 0 | 1 | -1 = -1;
      for (const e of r.events) {
        if (e.type === 'possession_start') possTeam = e.team;
        if (possTeam === -1) continue;
        if (e.type === 'shot' || e.type === 'pass') expect(e.team).toEqual(possTeam);
      }
    }
  });

  it('team fouls reset each period and count monotonically within it', () => {
    for (const r of results) {
      const counts = new Map<string, number>(); // `${period}-${team}` -> last count
      for (const e of r.events) {
        if (e.type !== 'foul' || e.kind === 'offensive') continue;
        const key = `${e.period}-${e.team}`;
        const prev = counts.get(key) ?? 0;
        expect(e.teamCountInPeriod).toEqual(prev + 1);
        counts.set(key, e.teamCountInPeriod);
      }
    }
  });

  it('replay frames are strictly monotonic and cover the full game', () => {
    for (const r of results) {
      const f = r.frames;
      expect(f.length).toBeGreaterThan(1000);
      for (let i = 1; i < f.length; i++) {
        expect(f[i]![0]!).toBeGreaterThan(f[i - 1]![0]!);
      }
      const gameEnd = r.events[r.events.length - 1]!;
      expect(gameEnd.type).toEqual('game_end');
      expect(Math.abs(f[f.length - 1]![0]! - gameEnd.wt)).toBeLessThanOrEqual(0.21);
    }
  });

  it('no player teleports: per-frame movement stays under a physical ceiling', () => {
    // wall-clock frames record through stoppages, so no legitimate gap exists;
    // 45 ft/s (well above elite sprint ~28) with the frame step gives headroom
    // for substitution position handoffs which swap players in place
    for (const r of results) {
      const f = r.frames;
      for (let i = 1; i < f.length; i++) {
        const dtF = f[i]![0]! - f[i - 1]![0]!;
        if (dtF > 1.0) continue; // a forced final frame after a long idle tail
        for (let s = 0; s < 10; s++) {
          const xi = 6 + s * 2;
          const dx = f[i]![xi]! - f[i - 1]![xi]!;
          const dy = f[i]![xi + 1]! - f[i - 1]![xi + 1]!;
          const speed = Math.hypot(dx, dy) / Math.max(0.05, dtF);
          expect(speed).toBeLessThanOrEqual(45);
        }
      }
    }
  });
});
