/**
 * Cumulative-load fatigue pool ("legs", fdesign-rhythm M1) + the M3
 * deadGameBoost param, STAGED-at-zero wiring suite.
 *
 * The pool ships with fatigue.loadPerSec 0: load is provably 0 forever
 * (accrual is 0, bench recovery clamps at the floor), effectiveEnergy
 * equals raw energy, and the engine is byte-identical (the golden
 * fingerprint corpus is the authority). The pool's consumers are wired
 * (ffit-rhythm §8): the resolve.ts shot-fatigue and speed terms read
 * effectiveEnergy, shooting fouls and organic reach-ins scale with the
 * defender's load (foul.loadReachSwing/loadShootSwing, live multipliers
 * that are exactly ×1 at load 0), and concepts.ts endgameContinuation
 * carries the deadGameBoost branch behind its own `> 0` gate. So the
 * staging proof is now split: shape dials alone stay byte-identical, and a
 * forced-live pool DIVERGES. The M1 contract still holds: subs cadence
 * reads RAW energy and cannot move with load.
 */

import { describe, expect, it } from 'vitest';
import {
  Rng, defaultParams, simulateGame, withParams,
  type Player, type SimParams, type Team, type TeamSide
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { applyFatigue, effectiveEnergy } from '../src/sim/movement.js';
import { shootingFoulP } from '../src/sim/resolve.js';
import { endgameContinuation } from '../src/sim/ai/concepts.js';
import { endPeriod } from '../src/sim/possession.js';
import type { Agent, GameState } from '../src/sim/state.js';

function mkAgent(p: Player, side: TeamSide, onCourt: boolean): Agent {
  return {
    p, side,
    pos: { x: 47, y: 25 }, vel: { x: 0, y: 0 },
    energy: 90, load: 0, secondsPlayed: 0, fouls: 0,
    onCourt, fouledOut: false, lastSwapT: 0,
    target: { x: 47, y: 25 }, intent: 'freeze', sprinting: false,
    spotKey: null, manId: null,
    dribblesSinceCatch: 0, dribbleAcc: 0, catchT: -99,
    acquiredBy: 'deadball', catchQuality: 0,
    usedPoss: 0, teamPossOnCourt: 0,
    driveUntil: -99, cutUntil: -99, relocUntil: -99,
    screenStunUntil: -99, navUnderUntil: -99
  };
}

const LIVE = withParams({ fatigue: { loadPerSec: 0.011 } });

// ------------------------------------------------------------ accrual units

/** two-agent state: one on court, one benched; applyFatigue's full surface */
function fatigueState(params: SimParams): { s: GameState; on: Agent; off: Agent } {
  const { home } = sampleMatchup();
  const on = mkAgent(home.players[0]!, 0, true);
  const off = mkAgent(home.players[1]!, 0, false);
  const s = {
    params,
    agents: new Map([[on.p.id, on], [off.p.id, off]])
  } as unknown as GameState;
  return { s, on, off };
}

describe('the load pool (movement.ts applyFatigue, forced live)', () => {
  it('accrues on court on the effort/stamina chain and recovers far slower on the bench', () => {
    const { s, on, off } = fatigueState(LIVE);
    off.load = 50;
    // stationary (vel 0), stamina-neutral would be exactly loadPerSec×dt;
    // real rosters vary stamina, so bracket the stamina multiplier's
    // [0.75, 1.25] envelope instead of pinning a float
    applyFatigue(s, 10);
    expect(on.load).toBeGreaterThan(0.011 * 10 * 0.74);
    expect(on.load).toBeLessThan(0.011 * 10 * 1.26);
    expect(off.load).toBeGreaterThan(50 - 0.02 * 10 - 1e-9);
    expect(off.load).toBeLessThan(50 - 0.02 * 10 + 1e-9);
    // asymmetry: a bench second recovers less than double an on-court
    // second accrues (legs stay heavy within a half, the design's point)
    expect(0.02).toBeLessThan(2 * 0.011);
  });

  it('sprinting accrues load faster than standing (the same chain as energy)', () => {
    const { s, on } = fatigueState(LIVE);
    const still = mkAgent(on.p, 0, true); // same player: identical stamina
    still.p = on.p;
    on.vel = { x: 28, y: 0 }; // full sprint
    (s.agents as Map<string, Agent>).set('still-clone', still);
    applyFatigue(s, 10);
    expect(on.load).toBeGreaterThan(still.load * 2);
  });

  it('clamps: load never leaves [0, 100]; a fouled-out body freezes', () => {
    const { s, on, off } = fatigueState(LIVE);
    on.load = 99.999;
    applyFatigue(s, 10_000);
    expect(on.load).toBe(100);
    expect(off.load).toBe(0); // recovery clamps at the floor
    const { s: s2, on: out } = fatigueState(LIVE);
    out.fouledOut = true;
    out.load = 40;
    applyFatigue(s2, 10);
    expect(out.load).toBe(40);
  });

  it('THE STAGE SWITCH: at the shipped loadPerSec 0 the pool provably stays 0', () => {
    const { s, on, off } = fatigueState(withParams());
    applyFatigue(s, 600);
    expect(on.load).toBe(0);
    expect(off.load).toBe(0);
  });

  it('effectiveEnergy = energy − load, clamped — and equals raw energy while staged', () => {
    const { on } = fatigueState(LIVE);
    on.energy = 80;
    on.load = 30;
    expect(effectiveEnergy(on)).toBe(50);
    on.load = 95;
    expect(effectiveEnergy(on)).toBe(0);
    on.load = 0; // the staged identity
    expect(effectiveEnergy(on)).toBe(80);
  });
});

// -------------------------------------------------------- halftime recovery

describe('the halftime lump (possession.ts endPeriod, forced live)', () => {
  function periodState(params: SimParams, period: number, score: [number, number]): GameState {
    const { home, away } = sampleMatchup();
    const agents = new Map<string, Agent>();
    const add = (team: Team, side: TeamSide): void => {
      const starters = new Set(team.starters);
      for (const p of team.players) {
        const a = mkAgent(p, side, starters.has(p.id));
        a.load = 30;
        agents.set(p.id, a);
      }
    };
    add(home, 0);
    add(away, 1);
    return {
      params,
      rules: {
        periods: 4, periodMinutes: 12, otMinutes: 5, shotClockSec: 24,
        teamFoulsCarryToOT: false, timeoutsPerGame: 7
      },
      period,
      clock: 0,
      t: period * 720,
      wallT: period * 720,
      score,
      teamFoulsPeriod: [2, 3],
      tipWinner: 0,
      endgame: true,
      timeoutsLeft: [4, 4],
      runPts: [0, 0],
      timeoutsThisPeriod: [0, 0],
      timeoutsUsedFinalPeriod: [0, 0],
      timeoutsUsedFinalLate: [0, 0],
      lastTimeoutT: [-99, -99],
      conceded: [false, false],
      teams: [home, away],
      agents,
      lineup: [[...home.starters], [...away.starters]],
      rng: new Rng('load-ht-unit'),
      ball: { holderId: null, pos: { x: 47, y: 25 }, flight: null },
      poss: {
        team: 0, shotClock: 10, phase: 'halfcourt', startT: 0, kind: 'inbound',
        lastPass: null, spotMap: new Map(), spots: new Map(), action: null, ended: false
      },
      phase: { kind: 'live' },
      events: [],
      frames: [],
      collectFrames: false,
      decisionAt: 0,
      pendingRelease: null,
      over: false
    } as unknown as GameState;
  }

  it('fires exactly once — at the half boundary, for every body, clamped at 0', () => {
    const s = periodState(LIVE, 2, [50, 48]); // ending Q2 = floor(4/2): halftime
    const someone = [...s.agents.values()][0]!;
    const gassed = [...s.agents.values()][1]!;
    gassed.load = 5; // below the 12-pt lump: clamps to 0
    endPeriod(s);
    expect(s.period).toBe(3);
    expect(someone.load).toBe(18); // 30 − loadHalftimeRecover 12
    expect(gassed.load).toBe(0);
    // Q3→Q4 is NOT a halftime; neither is an OT entry
    const q3 = periodState(LIVE, 3, [70, 66]);
    endPeriod(q3);
    expect([...q3.agents.values()][0]!.load).toBe(30);
    const ot = periodState(LIVE, 4, [90, 90]);
    endPeriod(ot);
    expect(ot.period).toBe(5);
    expect([...ot.agents.values()][0]!.load).toBe(30);
  });

  it('a staged game has nothing to recover (load 0 in, load 0 out)', () => {
    const s = periodState(withParams(), 2, [50, 48]);
    for (const a of s.agents.values()) a.load = 0;
    endPeriod(s);
    for (const a of s.agents.values()) expect(a.load).toBe(0);
  });
});

// ------------------------------------------- consumers (ffit-rhythm §8)

describe('load consumers (forced live)', () => {
  /** two-body state for the foul models: shooter + contesting defender */
  function foulState(params: SimParams): { s: GameState; shooter: Agent; def: Agent } {
    const { home, away } = sampleMatchup();
    const shooter = mkAgent(home.players[0]!, 0, true);
    const def = mkAgent(away.players[0]!, 1, true);
    const s = {
      params,
      agents: new Map([[shooter.p.id, shooter], [def.p.id, def]])
    } as unknown as GameState;
    return { s, shooter, def };
  }

  it('a loaded contest whistles more: shooting-foul legs ratio 1 + swing × load/100', () => {
    const { s, shooter, def } = foulState(withParams());
    const contest = { level: 0.5, by: def.p.id, heightAdvFt: 0 };
    const fresh = shootingFoulP(s, shooter, 'mid', contest);
    def.load = 60;
    const heavy = shootingFoulP(s, shooter, 'mid', contest);
    // mid zone sits far under shootFoulCap, so the ratio is exact:
    // 1 + 0.5 (shipped loadShootSwing) × 0.6
    expect(Math.abs(heavy / fresh - 1.3)).toBeLessThan(1e-9);
    // no defender in the picture: no legs to blame, load never read
    const open = { level: 0.5, by: null, heightAdvFt: 0 };
    const openHeavy = shootingFoulP(s, shooter, 'mid', open); // def.load 60
    def.load = 0;
    expect(shootingFoulP(s, shooter, 'mid', open)).toBe(openHeavy);
  });

  it('deadGameBoost raises the continuation of a decided final period, both chairs', () => {
    const mk = (boost: number): GameState => ({
      params: withParams({ endgame: { deadGameBoost: boost } }),
      rules: { periods: 4, periodMinutes: 12, otMinutes: 5, shotClockSec: 24 },
      period: 4,
      clock: 30,
      score: [100, 70],
      poss: { shotClock: 20 },
      endgame: true
    }) as unknown as GameState;
    // margin 30 with 0:30 left: the chase is dead (chaseAliveness 0)
    const staged = mk(0);
    const boosted = mk(0.25);
    const base = endgameContinuation(staged, 0, 1);
    const up = endgameContinuation(boosted, 0, 1);
    const E = staged.params.endgame;
    // staged 0 keeps the legacy branch order (leadHold fires for the leader)
    const legacyLead = 1 + E.scale * E.leadHoldMaxBoost
      * (1 - 30 / E.leadHoldClockSec)
      * Math.max(0, Math.min(1, 2 - 30 / E.leadHoldMarginRef));
    expect(Math.abs(base - legacyLead)).toBeLessThan(1e-9);
    // forced 0.25 preempts it: 1 + scale × boost × holdFade (holdFade 1 here)
    expect(Math.abs(up - (1 + E.scale * 0.25))).toBeLessThan(1e-9);
    // the trailing chair gets the same wind-down instead of the hurry cut
    expect(Math.abs(endgameContinuation(boosted, 1, 1) - (1 + E.scale * 0.25))).toBeLessThan(1e-9);
  });
});

// ------------------------------------------------- inertness (structural)

describe('STAGED dormancy (the loadPerSec 0 stage switch)', () => {
  it('the shipped stage switch is zero; couplings ship live but ×1 at load 0', () => {
    expect(defaultParams.fatigue.loadPerSec).toBe(0);
    expect(defaultParams.endgame.deadGameBoost).toBe(0);
    // shape dials ship at design values (unread while load is 0)
    expect(defaultParams.fatigue.loadRecoverPerSecBench).toBe(0.02);
    expect(defaultParams.fatigue.loadHalftimeRecover).toBe(12);
    // the foul couplings ship at the REAL-fit seeds; their inertness is the
    // pool's zero, not their own (1 + swing × 0 = 1 exactly)
    expect(defaultParams.foul.loadReachSwing).toBe(1.3);
    expect(defaultParams.foul.loadShootSwing).toBe(0.5);
  });

  it('shape dials alone are byte-identical: swings moved, pool still 0', () => {
    for (const i of [0, 1]) {
      const { home, away } = sampleMatchup();
      const base = simulateGame({ seed: `load-inert-${i}`, home, away, collectFrames: true });
      const moved = simulateGame({
        seed: `load-inert-${i}`, home, away, collectFrames: true,
        params: {
          foul: { loadReachSwing: 2.0, loadShootSwing: 0.9 },
          fatigue: { loadRecoverPerSecBench: 0.5, loadHalftimeRecover: 99 }
        }
      });
      expect(JSON.stringify(moved.events)).toBe(JSON.stringify(base.events));
      expect(JSON.stringify(moved.frames)).toBe(JSON.stringify(base.frames));
    }
  });

  it('a FORCED-LIVE pool now diverges: the consumers are wired', () => {
    // pre-wiring this exact comparison was pinned byte-identical (the
    // pre-scheduled dormancy retirement); with the resolve/foul/speed
    // consumers wired, a live pool must move outcomes
    const { home, away } = sampleMatchup();
    const base = simulateGame({ seed: 'load-live-0', home, away, collectFrames: false });
    const live = simulateGame({
      seed: 'load-live-0', home, away, collectFrames: false,
      params: { fatigue: { loadPerSec: 0.011 } }
    });
    expect(JSON.stringify(live.events)).not.toBe(JSON.stringify(base.events));
  });
});
