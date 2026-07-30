/**
 * sim/movement.ts — the game clock's single writer, fatigue, and integration.
 *
 * Spec sources: AGENTS.md §1.5 (two time axes — `movement.ts#advanceClock` is
 * the ONLY writer of `t`; `t` stops at whistles) and the module header
 * (movement.ts:1-13). The "clock stops at whistles" half of §1.5 is a CALLER
 * contract — stopped phases simply never call advanceClock — so its
 * observable form (frozen clock across a dead ball while wall time advances)
 * is pinned at frame level in shooting.test.ts; this file pins the writer's
 * own arithmetic: horn capping, dead-clock no-ops, and minutes accrual.
 *
 * States are hand-built with only the fields each function reads
 * (concede.test.ts doctrine). No calibrated magnitude is pinned — expected
 * values are recomputed from the same params instance (AGENTS.md §2.1).
 */

import { describe, expect, it } from 'vitest';
import { NBA, clamp, makeCourt, makePlayer, withParams, type SimParams } from '@hoopsh/engine';
import { advanceClock, applyFatigue, integrateMovement } from '../src/sim/movement.js';
import type { Agent, GameState } from '../src/sim/state.js';

const P = withParams();
const court = makeCourt(NBA);

interface AgentSpec {
  id: string;
  side: 0 | 1;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  attr?: Parameters<typeof makePlayer>[0]['attr'];
  energy?: number;
  secondsPlayed?: number;
  onCourt?: boolean;
  fouledOut?: boolean;
  targetX?: number;
  targetY?: number;
  intent?: string;
  sprinting?: boolean;
}

function mkAgent(o: AgentSpec): Agent {
  const x = o.x ?? 40;
  const y = o.y ?? 25;
  return {
    p: makePlayer({ id: o.id, attr: o.attr ?? {} }),
    side: o.side,
    pos: { x, y },
    vel: { x: o.vx ?? 0, y: o.vy ?? 0 },
    energy: o.energy ?? 100,
    secondsPlayed: o.secondsPlayed ?? 0,
    onCourt: o.onCourt ?? true,
    fouledOut: o.fouledOut ?? false,
    target: { x: o.targetX ?? x, y: o.targetY ?? y },
    intent: o.intent ?? 'spot',
    sprinting: o.sprinting ?? false
  } as unknown as Agent;
}

// advanceClock reads: clock, t, lineup, agents. applyFatigue reads: params,
// agents. integrateMovement adds: court, ball.holderId, poss.action, params.
function mkState(agents: Agent[], o?: { clock?: number; t?: number }): GameState {
  const map = new Map(agents.map((a) => [a.p.id, a]));
  const lineup: [string[], string[]] = [
    agents.filter((a) => a.side === 0 && a.onCourt).map((a) => a.p.id),
    agents.filter((a) => a.side === 1 && a.onCourt).map((a) => a.p.id)
  ];
  return {
    params: P, rules: NBA, court,
    clock: o?.clock ?? 600, t: o?.t ?? 100,
    agents: map, lineup,
    ball: { holderId: null, pos: { x: 47, y: 25 }, flight: null },
    poss: { action: null }
  } as unknown as GameState;
}

function fiveVsFive(): Agent[] {
  const out: Agent[] = [];
  for (let i = 1; i <= 5; i++) out.push(mkAgent({ id: `h${i}`, side: 0, secondsPlayed: 60 }));
  for (let i = 1; i <= 5; i++) out.push(mkAgent({ id: `a${i}`, side: 1, secondsPlayed: 60 }));
  return out;
}

describe('advanceClock (movement.ts:22-41, AGENTS.md §1.5)', () => {
  it('burns game clock and t together and accrues on-court minutes for all ten bodies', () => {
    const agents = fiveVsFive();
    const bench = mkAgent({ id: 'b1', side: 0, onCourt: false, secondsPlayed: 0 });
    const s = mkState([...agents, bench], { clock: 720, t: 100 });
    advanceClock(s, 0.1);
    expect(s.t).toBe(100 + 0.1);
    expect(s.clock).toBe(720 - 0.1);
    for (const a of agents) expect(a.secondsPlayed).toBe(60 + 0.1);
    // the bench does not accrue game minutes
    expect(bench.secondsPlayed).toBe(0);
  });

  it('the horn caps t: a tick spanning 0:00 contributes only the remaining clock', () => {
    // movement.ts:30-34 — "the period contributes at most its scheduled
    // seconds to t. Keeps team minutes summing to exactly 5 × game length."
    // Post-buzzer scoring was a historical §1.5 incident.
    const agents = fiveVsFive();
    const s = mkState(agents, { clock: 0.4, t: 100 });
    advanceClock(s, 1);
    expect(s.t).toBe(100 + 0.4);
    expect(s.clock).toBeLessThanOrEqual(0);
    for (const a of agents) expect(a.secondsPlayed).toBe(60 + 0.4);
  });

  it('a dead clock burns nothing: t and minutes freeze at 0:00 no matter how often it is called', () => {
    // movement.ts:34-36 — effective <= 0 returns before touching t
    const agents = fiveVsFive();
    const s = mkState(agents, { clock: 0, t: 100 });
    advanceClock(s, 1);
    advanceClock(s, 5);
    expect(s.t).toBe(100);
    for (const a of agents) expect(a.secondsPlayed).toBe(60);
    // and from an already-negative clock (post-horn state) likewise
    const s2 = mkState(fiveVsFive(), { clock: -0.2, t: 50 });
    advanceClock(s2, 1);
    expect(s2.t).toBe(50);
  });

  it('a fouled-out body still standing in the lineup accrues minutes (bench-exhausted degenerate)', () => {
    // state.ts:293-310 — plain onCourt (not liveOnCourt) is the deliberate
    // choice for lineup mechanics: the body is physically on the floor, and
    // the minutes-conservation invariant (team minutes = 5 × game length)
    // needs exactly five accruers per side at all times.
    const agents = fiveVsFive();
    agents[0]!.fouledOut = true;
    const s = mkState(agents, { clock: 300, t: 10 });
    advanceClock(s, 0.5);
    expect(agents[0]!.secondsPlayed).toBe(60 + 0.5);
  });
});

describe('applyFatigue (movement.ts:127-153)', () => {
  it('on-court players drain, bench players recover; fouled-out splits by location — a floor ghost tires like anyone else, a benched ghost freezes', () => {
    // movement.ts:130-136 (audit L-06, commit 96f76db): the skip narrowed
    // from `fouledOut` to `fouledOut && !onCourt`. A fouled-out player still
    // ON the floor (subs.ts replaceFouledOut's bench-exhausted play-on edge)
    // "drains energy like anyone else" — the old blanket skip froze his
    // energy mid-game. A fouled-out player on the BENCH can never return, so
    // his recovery stays skipped and his energy holds (kept byte-identical
    // for the common case).
    const worker = mkAgent({ id: 'w', side: 0, energy: 80 });
    const rester = mkAgent({ id: 'r', side: 0, energy: 50, onCourt: false });
    // identical spec to the worker, but fouled out and still on the floor
    const floorGhost = mkAgent({ id: 'g', side: 1, energy: 80, fouledOut: true });
    const benchGhost = mkAgent({ id: 'bg', side: 1, energy: 42, fouledOut: true, onCourt: false });
    const s = mkState([worker, rester, floorGhost, benchGhost]);
    applyFatigue(s, 0.5);
    expect(worker.energy).toBeLessThan(80);
    expect(worker.energy).toBeGreaterThanOrEqual(0);
    // bench recovery is the exact documented rate, clamped into [0,100]
    expect(rester.energy).toBe(clamp(50 + P.fatigue.recoverPerSecBench * 0.5, 0, 100));
    // "like anyone else", pinned exactly: an identical body drains identically
    expect(floorGhost.energy).toBe(worker.energy);
    expect(floorGhost.energy).toBeLessThan(80);
    // the benched arm stays byte-identical: recovery skipped, energy frozen
    expect(benchGhost.energy).toBe(42);
  });

  it('energy clamps at both rails: an empty tank stops at 0, a full bench player holds 100', () => {
    const empty = mkAgent({ id: 'e', side: 0, energy: 0.001 });
    const full = mkAgent({ id: 'f', side: 0, energy: 100, onCourt: false });
    const s = mkState([empty, full]);
    applyFatigue(s, 1000);
    expect(empty.energy).toBe(0);
    expect(full.energy).toBe(100);
  });

  it('a neutral-stamina stationary player drains exactly drainPerSec — the executable base-rate definition', () => {
    // movement.ts:131-142 — speedShare 0 and stamina 50 make every
    // multiplier exactly 1, so one second costs exactly drainPerSec
    const still = mkAgent({ id: 's', side: 0, energy: 80, attr: { stamina: 50 } });
    const s = mkState([still]);
    applyFatigue(s, 1);
    expect(still.energy).toBe(clamp(80 - P.fatigue.drainPerSec, 0, 100));
  });

  it('sprinting drains faster than standing still', () => {
    // movement.ts:131-137 — speedShare scales drain up
    const sprinter = mkAgent({ id: 'sp', side: 0, energy: 80, vx: 28 });
    const stander = mkAgent({ id: 'st', side: 0, energy: 80 });
    const s = mkState([sprinter, stander]);
    applyFatigue(s, 1);
    expect(sprinter.energy).toBeLessThan(stander.energy);
  });

  it('stamina moderates the drain: the iron man outlasts the low-tank player', () => {
    // movement.ts:138-140 — 100 drains a quarter slower, 0 a quarter faster
    const iron = mkAgent({ id: 'i', side: 0, energy: 80, attr: { stamina: 100 } });
    const glass = mkAgent({ id: 'gl', side: 0, energy: 80, attr: { stamina: 0 } });
    const s = mkState([iron, glass]);
    applyFatigue(s, 1);
    expect(iron.energy).toBeGreaterThan(glass.energy);
  });
});

describe('integrateMovement (movement.ts:43-119)', () => {
  it('an agent steps toward its target and never overshoots past it', () => {
    const runner = mkAgent({ id: 'r', side: 0, x: 40, y: 25, targetX: 60, targetY: 25, sprinting: true });
    const s = mkState([runner]);
    const before = Math.abs(60 - runner.pos.x);
    integrateMovement(s, 0.1);
    expect(runner.pos.x).toBeGreaterThan(40);
    expect(runner.pos.x).toBeLessThanOrEqual(60);
    expect(Math.abs(60 - runner.pos.x)).toBeLessThan(before);
  });

  it('an arrived agent stays put — the 0.25 ft threshold stops the jitter', () => {
    // movement.ts:62-65
    const parked = mkAgent({ id: 'p', side: 0, x: 50, y: 25, targetX: 50, targetY: 25 });
    const s = mkState([parked]);
    integrateMovement(s, 0.1);
    expect(parked.pos).toEqual({ x: 50, y: 25 });
    expect(parked.vel).toEqual({ x: 0, y: 0 });
  });

  it('positions clamp inside the court with the half-foot margin, even chasing an out-of-bounds target', () => {
    // movement.ts:81-83 — nobody's centerpoint sits on the paint stripe
    const chaser = mkAgent({ id: 'c', side: 0, x: 2, y: 2, targetX: -50, targetY: -50, sprinting: true });
    const s = mkState([chaser]);
    for (let i = 0; i < 30; i++) integrateMovement(s, 0.1);
    expect(chaser.pos.x).toBeGreaterThanOrEqual(0.5);
    expect(chaser.pos.y).toBeGreaterThanOrEqual(0.5);
    expect(chaser.pos.x).toBeLessThanOrEqual(court.length - 0.5);
    expect(chaser.pos.y).toBeLessThanOrEqual(court.width - 0.5);
  });

  it('overlapping bodies get pushed apart symmetrically to the avoidance radius (no winner)', () => {
    // movement.ts:86-118 — 50/50 split with no live post action
    const R = P.move.avoidRadiusFt;
    const a = mkAgent({ id: 'a', side: 0, x: 50, y: 25 });
    const b = mkAgent({ id: 'b', side: 1, x: 50 + R * 0.2, y: 25 });
    const s = mkState([a, b]);
    integrateMovement(s, 0.1);
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
    expect(d).toBeGreaterThanOrEqual(R - 1e-9);
    expect(d).toBeLessThanOrEqual(R + 1e-9);
    // symmetric split: both moved the same distance off the contact point
    const movedA = Math.abs(a.pos.x - 50);
    const movedB = Math.abs(b.pos.x - (50 + R * 0.2));
    expect(Math.abs(movedA - movedB)).toBeLessThanOrEqual(1e-9);
  });
});
