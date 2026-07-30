/**
 * Garbage-time concede rotation (sub.concede*) — hysteresis unit pins, the
 * branch wave, crunch precedence, the foul-hunt constraint, and the
 * LIVE-default full-game pins (design-garbagetime.md §5.1).
 *
 * The mechanism is LIVE: concedeMarginBase ships at the designed 15,
 * verified on the coupled engine (findings/b2-verify-concede.md — the
 * uncoupled OOS-walk regression is gone under channel-2 coupling; see the
 * param's provenance comment in sim/params.ts). The old STAGED-default
 * dormancy describe (999 ⇒ branch unreachable, blowouts keep starters) is
 * retired — a conceded blowout is now exactly what the engine is SUPPOSED
 * to produce — and replaced by the §5.1 pins at the shipped defaults: the
 * conceded-lineup composition fold, the no-thrash hysteresis machine, and
 * the close-game guarantees.
 *
 * The unit describes force the thresholds through withParams (15/1.0/4/6/
 * 25 — today identical to the shipped defaults) so those pins keep meaning
 * the same thing if a future re-tune moves the defaults; the §5.1 pool
 * pins deliberately run the DEFAULTS and read their line arithmetic from
 * defaultParams, so they track the shipped engine. Pool thresholds follow
 * the endgame.test.ts doctrine: margin-conditioned predicates + bars set
 * well clear of probed values, so rng reshuffles from future re-tunes
 * survive.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultParams, simulateGame, withParams,
  type GameEvent, type GameResult, type Player, type SimParams, type Team, type TeamSide
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { checkSubs, updateConcede } from '../src/sim/subs.js';
import type { Agent, GameState } from '../src/sim/state.js';

// the designed values, forced explicitly (identical to today's shipped
// defaults — params.ts sub.* block) so the unit pins survive a future
// re-tune of the defaults — entry line 15 + 1/min remaining
const live = withParams({
  sub: {
    concedeMarginBase: 15,
    concedeMarginPerMin: 1.0,
    concedeTrailLagPts: 4,
    concedeExitPts: 6,
    concedeEnergyMin: 25
  }
});

// updateConcede reads exactly: period, rules.periods, clock, score,
// params.sub, conceded. checkSubs additionally walks teams/lineup (empty
// arrays make it a pure hysteresis call) and reads phase (the
// timeout-huddle handshake, inert at the shipped timeoutSubRelaxPts 0).
// Hand-built states suffice.
function hState(
  params: SimParams,
  o: { period?: number; clock: number; score: [number, number]; conceded?: [boolean, boolean] }
): GameState {
  return {
    params,
    rules: { periods: 4, periodMinutes: 12 },
    period: o.period ?? 4,
    clock: o.clock,
    score: o.score,
    conceded: o.conceded ?? [false, false],
    teams: [{ starters: [] }, { starters: [] }],
    lineup: [[], []],
    agents: new Map(),
    t: 0,
    wallT: 0,
    phase: { kind: 'dead', resumeIn: 1, clockRuns: false, nextTeam: 0, possKind: 'inbound' },
    events: []
  } as unknown as GameState;
}

describe('concede hysteresis (direct updateConcede, live thresholds)', () => {
  it('the leader enters at the clock-scaled line, not a point sooner', () => {
    // 6:00 left: line = 15 + 6 = 21
    const at21 = hState(live, { clock: 360, score: [100, 79] });
    updateConcede(at21);
    expect(at21.conceded).toEqual([true, false]); // trailer bar is 25 — holds hope
    const at20 = hState(live, { clock: 360, score: [100, 80] });
    updateConcede(at20);
    expect(at20.conceded).toEqual([false, false]);
  });

  it('the line scales with the clock: steeper early, shallower late', () => {
    // Q4 tip (12:00): line = 27 — a 27-point three-quarter lead is done
    const tip = hState(live, { clock: 720, score: [107, 80] });
    updateConcede(tip);
    expect(tip.conceded[0]).toBe(true);
    const tipShort = hState(live, { clock: 720, score: [106, 80] });
    updateConcede(tipShort);
    expect(tipShort.conceded[0]).toBe(false);
    // final seconds: line converges to the 15-point base
    const late = hState(live, { clock: 0, score: [95, 80] });
    updateConcede(late);
    expect(late.conceded[0]).toBe(true);
    const lateShort = hState(live, { clock: 0, score: [94, 80] });
    updateConcede(lateShort);
    expect(lateShort.conceded[0]).toBe(false);
  });

  it('the trailer lags the leader by concedeTrailLagPts (leader-first is structural)', () => {
    // 6:00, margin 22: leader (side 1) is over his line 21; the trailer
    // (side 0) needs 25 and still has a token starter run left in him
    const m22 = hState(live, { clock: 360, score: [78, 100] });
    updateConcede(m22);
    expect(m22.conceded).toEqual([false, true]);
    // margin 25: now both benches close it out
    const m25 = hState(live, { clock: 360, score: [75, 100] });
    updateConcede(m25);
    expect(m25.conceded).toEqual([true, true]);
  });

  it('exit sits concedeExitPts below entry, and the band between HOLDS state', () => {
    // 6:00: entry 21, exit floor 15 — a conceded leader stays conceded at 16
    const hold = hState(live, { clock: 360, score: [96, 80], conceded: [true, false] });
    updateConcede(hold);
    expect(hold.conceded[0]).toBe(true);
    // ...and exactly at the floor (15) still holds: exit needs m < line − exit
    const floor = hState(live, { clock: 360, score: [95, 80], conceded: [true, false] });
    updateConcede(floor);
    expect(floor.conceded[0]).toBe(true);
    // one below the floor exits
    const exit = hState(live, { clock: 360, score: [94, 80], conceded: [true, false] });
    updateConcede(exit);
    expect(exit.conceded[0]).toBe(false);
    // the same 16-point margin does NOT enter from the un-conceded side —
    // the hysteresis band is direction-aware, not a second threshold
    const fresh = hState(live, { clock: 360, score: [96, 80] });
    updateConcede(fresh);
    expect(fresh.conceded[0]).toBe(false);
  });

  it("the trailer's exit floor keeps him lagged too", () => {
    // 6:00: trailer entry 25, exit floor 19
    const hold = hState(live, { clock: 360, score: [81, 100], conceded: [true, true] });
    updateConcede(hold);
    expect(hold.conceded[0]).toBe(true); // deficit 19: still conceded
    const exit = hState(live, { clock: 360, score: [82, 100], conceded: [true, true] });
    updateConcede(exit);
    expect(exit.conceded[0]).toBe(false); // deficit 18: back to work
  });

  it('only the final period concedes; earlier periods clear stale flags', () => {
    const q3 = hState(live, { period: 3, clock: 100, score: [110, 70], conceded: [true, true] });
    updateConcede(q3);
    expect(q3.conceded).toEqual([false, false]);
  });

  it('OT is concede-eligible (period ≥ rules.periods, matching the crunch gate)', () => {
    // 4:00 of OT: line = 19 — margins this deep in OT are decided games
    const ot = hState(live, { period: 5, clock: 240, score: [120, 101] });
    updateConcede(ot);
    expect(ot.conceded[0]).toBe(true);
  });
});

describe('crunch precedence (checkSubs is the only writer)', () => {
  it('crunch clears concede UNCONDITIONALLY — the 20→8 collapse path', () => {
    // one-possession-ish game inside 5:00: crunch is live, and whatever the
    // concede flags said is void — starters come back, period
    const s = hState(live, { clock: 200, score: [80, 72], conceded: [true, true] });
    checkSubs(s);
    expect(s.conceded).toEqual([false, false]);
  });

  it('outside crunch, checkSubs routes to the hysteresis update', () => {
    const s = hState(live, { clock: 200, score: [102, 72] });
    checkSubs(s);
    // 3:20 left: line ≈ 18.3, trailer bar ≈ 22.3 — margin 30 concedes both
    expect(s.conceded).toEqual([true, true]);
  });
});

// ---------------------------------------------------------------- the branch

function mkAgent(p: Player, side: TeamSide, onCourt: boolean, energy: number): Agent {
  return {
    p, side,
    pos: { x: 47, y: 25 }, vel: { x: 0, y: 0 },
    energy, load: 0, secondsPlayed: 0, fouls: 0,
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

/** a dead-ball Q4 state at 5:00, margin 30 — both sides past the live line */
function fullState(params: SimParams, benchEnergy: number): { s: GameState; home: Team; away: Team } {
  const { home, away } = sampleMatchup();
  const agents = new Map<string, Agent>();
  const add = (team: Team, side: TeamSide) => {
    const starters = new Set(team.starters);
    for (const p of team.players) {
      // starters at 70 (fresh enough that the fatigue rotation stays quiet
      // in the non-concede control runs), bench per the scenario
      agents.set(p.id, mkAgent(p, side, starters.has(p.id), starters.has(p.id) ? 70 : benchEnergy));
    }
  };
  add(home, 0);
  add(away, 1);
  const s = {
    params,
    rules: { periods: 4, periodMinutes: 12 },
    period: 4,
    clock: 300,
    t: 2580,
    wallT: 2580,
    score: [100, 70],
    conceded: [false, false],
    teams: [home, away],
    agents,
    lineup: [[...home.starters], [...away.starters]],
    phase: { kind: 'dead', resumeIn: 1, clockRuns: false, nextTeam: 0, possKind: 'inbound' },
    events: []
  } as unknown as GameState;
  return { s, home, away };
}

const startersOnFloor = (s: GameState, team: Team, side: TeamSide): number =>
  s.lineup[side].filter((id) => team.starters.includes(id)).length;

describe('the concede branch (constructed dead ball, live thresholds)', () => {
  it('a conceded side waves its starters out in ONE stoppage, bench depth permitting', () => {
    const { s, home, away } = fullState(live, 90);
    checkSubs(s);
    expect(s.conceded).toEqual([true, true]); // margin 30 at 5:00 — both over
    // 5 rested non-starters per sample roster side ⇒ the whole five walks;
    // a shallower roster legally keeps 5 − benchDepth starters out there
    const expect0 = Math.max(0, 5 - (home.players.length - 5));
    const expect1 = Math.max(0, 5 - (away.players.length - 5));
    expect(startersOnFloor(s, home, 0)).toBe(expect0);
    expect(startersOnFloor(s, away, 1)).toBe(expect1);
    // the wave is real substitutions: every out is a starter, every in is not
    const subs = s.events.filter((e) => e.type === 'substitution');
    expect(subs.length).toBe(5 - expect0 + (5 - expect1));
    for (const e of subs) {
      const team = e.team === 0 ? home : away;
      expect(team.starters.includes(e.out[0]!)).toBe(true);
      expect(team.starters.includes(e.in[0]!)).toBe(false);
    }
  });

  it('the concedeEnergyMin floor gates the wave: no standing bench, no swap', () => {
    const { s, home, away } = fullState(live, 20); // bench below the 25 floor
    checkSubs(s);
    expect(s.conceded).toEqual([true, true]); // conceded, but nobody can come in
    expect(startersOnFloor(s, home, 0)).toBe(5);
    expect(startersOnFloor(s, away, 1)).toBe(5);
    expect(s.events.length).toBe(0);
  });

  it('the protect carve-out (FT shooter) survives the wave', () => {
    const { s, home } = fullState(live, 90);
    const shooter = home.starters[0]!;
    checkSubs(s, shooter);
    // the shooter stays (mid-FT-sequence subs are illegal for him); the
    // other four starters still walk — this is the ≤1-starter allowance the
    // conceded-lineup pins will use once the mechanism goes live
    expect(s.lineup[0].includes(shooter)).toBe(true);
    expect(startersOnFloor(s, home, 0)).toBe(1);
  });
});

describe('params constraints (executable documentation)', () => {
  it('a still-conceded trailer can never sit inside the intentional-foul window', () => {
    // trailer's minimum still-conceded deficit is base + lag − exit (the
    // exit floor as clock→0); it must clear endgame.foulMaxDeficit or a
    // conceded bench would foul-hunt (design §3.4). 15 + 4 − 6 = 13 > 12
    // at the shipped values — asserted on BOTH the forced pin params and
    // the live defaults so a future param tidy of either side trips it.
    const L = live.sub;
    expect(L.concedeMarginBase + L.concedeTrailLagPts - L.concedeExitPts)
      .toBeGreaterThan(live.endgame.foulMaxDeficit);
    const D = defaultParams.sub;
    expect(D.concedeMarginBase + D.concedeTrailLagPts - D.concedeExitPts)
      .toBeGreaterThan(defaultParams.endgame.foulMaxDeficit);
  });
});

// ------------------------------------------- the LIVE default (design §5.1)
//
// Full-game pins at the SHIPPED defaults (concedeMarginBase 15 — live).
// Sim-once-assert-many pool: 16 sampleMatchup games + one guaranteed
// blowout built the adversarial way (saturated clone), so at least one
// deep-conceded game exists on any seed — 'concede-pin-0' probed +51
// (margin already past line(12:00)+4 = 31 at the Q4 tip), miles above the
// entry line. All folds reconstruct margin from Base.score and lineups
// from game_start/substitution; line arithmetic is read from
// defaultParams.sub so a re-tune of the thresholds re-aims the pins
// automatically.

const D = defaultParams.sub;
const lineAt = (clock: number): number =>
  D.concedeMarginBase + D.concedeMarginPerMin * (clock / 60);
/** the side's own entry bar: leaders at the line, trailers lag behind it */
const barFor = (lead: number, clock: number): number =>
  lead >= 0 ? lineAt(clock) : lineAt(clock) + D.concedeTrailLagPts;
/** dead-ball markers — events that prove a checkSubs pass just ran/runs:
 *  period start, FT entry, and dead-ball inbounds. Substitutions are NOT
 *  markers (they are emitted mid-wave, before the lineup settles). */
const isDeadBall = (e: GameEvent): boolean =>
  e.type === 'period_start' || e.type === 'free_throw' ||
  (e.type === 'possession_start' && e.kind === 'inbound');

interface PoolGame { result: GameResult; starters: [Set<string>, Set<string>] }
const pool: PoolGame[] = [];
{
  for (let i = 0; i < 16; i++) {
    const { home, away } = sampleMatchup();
    const flip = i % 2 === 1;
    const h = flip ? away : home;
    const a = flip ? home : away;
    pool.push({
      result: simulateGame({ seed: `concede-live-${i}`, home: h, away: a, collectFrames: false }),
      starters: [new Set(h.starters), new Set(a.starters)]
    });
  }
  const { home, away } = sampleMatchup();
  const strong = structuredClone(home);
  for (const p of strong.players) {
    for (const k of Object.keys(p.attr) as (keyof typeof p.attr)[]) {
      p.attr[k] = Math.min(95, p.attr[k] + 25); // strong-but-sane blowout fixture
    }
  }
  pool.push({
    result: simulateGame({ seed: 'concede-pin-0', home: strong, away, collectFrames: false }),
    starters: [new Set(strong.starters), new Set(away.starters)]
  });
}

/** walk a game's final-period events with lineup + margin context */
function foldFinalPeriod(
  g: PoolGame,
  visit: (o: {
    e: GameEvent; side: TeamSide; lead: number; m: number; bar: number; count: number;
  }) => void
): void {
  let lineups: [Set<string>, Set<string>] = [new Set(), new Set()];
  for (const e of g.result.events as GameEvent[]) {
    if (e.type === 'game_start') {
      lineups = [new Set(e.home.lineup), new Set(e.away.lineup)];
    } else if (e.type === 'substitution') {
      for (const id of e.out) lineups[e.team].delete(id);
      for (const id of e.in) lineups[e.team].add(id);
    }
    if (e.period < 4) continue; // final scheduled period + OT, like the branch
    for (const side of [0, 1] as TeamSide[]) {
      const lead = e.score[side] - e.score[side === 0 ? 1 : 0];
      let count = 0;
      for (const id of lineups[side]) if (g.starters[side].has(id)) count++;
      visit({ e, side, lead, m: Math.abs(lead), bar: barFor(lead, e.clock), count });
    }
  }
}

describe('LIVE default §5.1: conceded-lineup composition (pool + adversarial fixture)', () => {
  it('once the margin has cleared the entry line by 4+ across a dead ball, the side fields ≤1 starter', () => {
    // The wave executes at the first dead ball over the line; assertions
    // start at the SECOND dead-ball marker (the lineup is settled by then)
    // and require margin ≥ bar+4 — comfortably above entry, so hysteresis
    // can never be holding a legitimately-exiting side in scope. Dropping
    // below the exit floor disarms (the side may legally return). The ≤1
    // allowance covers the FT protect carve-out and foul-out re-entry
    // (design §3.2). Probed: 1704 qualifying events across this pool,
    // 0 violations; the fixture alone contributes ~300 per side.
    let asserted = 0;
    for (const g of pool) {
      const over: [number, number] = [0, 0]; // dead balls seen at margin ≥ bar+4
      foldFinalPeriod(g, ({ e, side, m, bar, count }) => {
        if (m < bar - D.concedeExitPts) over[side] = 0; // exit floor: disarm
        else if (isDeadBall(e) && m >= bar + 4) over[side]++;
        if (over[side] >= 2 && m >= bar + 4) {
          asserted++;
          expect(count).toBeLessThanOrEqual(1);
        }
      });
    }
    // vacuity guard: the adversarial fixture guarantees the pin bites on
    // any seed (probed ~300 asserts/side there; bar set far below)
    expect(asserted).toBeGreaterThan(50);
  });
});

describe('LIVE default §5.1: no-thrash hysteresis (per-side state machine)', () => {
  it('every armed concede wave follows a legalized exit, and armed returns pass the exit floor or crunch', () => {
    // A "wave" is the side's on-floor starter count falling from >=3 to <=1
    // in the final period while the concede flag is armed. The flag here
    // MIRRORS the engine's rule at its actual decision points (dead balls
    // and substitution events): it arms at m >= bar, clears below the exit
    // floor or in crunch. The earlier version of this pin kept `armed`
    // sticky for the whole period and capped waves at 1; the post-re-center
    // draws produce LEGAL re-concedes (margin collapses below the exit
    // floor, then re-crosses the entry bar), which that fold miscounted as
    // thrash (re-anchored 2026-07-29; the dead-ball mirror measured 6 armed
    // waves / 0 violations over this pool). Thrash — a wave entered without
    // a legalized exit, or a return inside the band — is what fails here.
    // The guaranteed-execution pin for return legality remains the
    // constructed collapse suite below.
    const isDecisionPoint = (e: GameEvent): boolean =>
      e.type === 'substitution' || e.type === 'period_start' ||
      e.type === 'free_throw' ||
      (e.type === 'possession_start' && e.kind === 'inbound');
    let armedWavesPool = 0;
    for (const g of pool) {
      const flag: [boolean, boolean] = [false, false];
      const exitLegalized: [boolean, boolean] = [true, true];
      const waves: [number, number] = [0, 0];
      const state: ['high' | 'low', 'high' | 'low'] = ['high', 'high'];
      foldFinalPeriod(g, ({ e, side, m, bar, count }) => {
        const crunch = e.clock < D.crunchClockSec && m <= D.crunchMarginPts;
        if (isDecisionPoint(e)) {
          if (crunch) flag[side] = false;
          else if (m >= bar) flag[side] = true;
          else if (m < bar - D.concedeExitPts) flag[side] = false;
          if (crunch || m < bar - D.concedeExitPts) exitLegalized[side] = true;
        }
        if (state[side] === 'high' && count <= 1) {
          state[side] = 'low';
          if (flag[side]) {
            waves[side]++;
            armedWavesPool++;
            expect(exitLegalized[side]).toBe(true); // no wave without a legalized exit
            exitLegalized[side] = false;
          }
        } else if (state[side] === 'low' && count >= 3) {
          state[side] = 'high';
          if (flag[side]) {
            const belowExit = m < bar - D.concedeExitPts + 2;
            expect(belowExit || crunch).toBe(true); // returns only past the floor or in crunch
          }
        }
      });
      // runaway-thrash ceiling: legal re-concedes exist but are rare; more
      // than two armed waves on one side in one game is machinery failure
      expect(waves[0]).toBeLessThanOrEqual(2);
      expect(waves[1]).toBeLessThanOrEqual(2);
    }
    // non-vacuity: this pool produces armed waves (measured 6 at re-anchor)
    expect(armedWavesPool).toBeGreaterThanOrEqual(1);
  });
});

// Constructed collapse fixture (b8-F1): the pool cannot guarantee an armed
// exit/re-entry on any given seed set, so the return-legality half of §5.1
// is pinned here the way the blowout fixture pins the composition — by
// building the mid-concede state directly and driving checkSubs through the
// three margins that matter. Side 0 is a conceded leader mid-wave: its five
// reserves are on the floor and tired enough (70 < the 74 reserve leash)
// that the ordinary fatigue rotation WOULD pull them the moment the concede
// stops suspending it; its starters rest at 95, above the 88 ready bar.
function midConcedeState(
  params: SimParams,
  o: { clock: number; score: [number, number] }
): { s: GameState; home: Team; away: Team } {
  const { home, away } = sampleMatchup();
  const agents = new Map<string, Agent>();
  const starters0 = new Set(home.starters);
  for (const p of home.players) {
    agents.set(p.id, mkAgent(p, 0, !starters0.has(p.id), starters0.has(p.id) ? 95 : 70));
  }
  const starters1 = new Set(away.starters);
  for (const p of away.players) {
    // the un-conceded control side: normal shape, nobody near a leash
    agents.set(p.id, mkAgent(p, 1, starters1.has(p.id), starters1.has(p.id) ? 80 : 90));
  }
  const s = {
    params,
    rules: { periods: 4, periodMinutes: 12 },
    period: 4,
    clock: o.clock,
    t: 2880 - o.clock,
    wallT: 2880 - o.clock,
    score: o.score,
    conceded: [true, false],
    // the huddle handshake: checkSubs reads phase.timeout (inert here)
    phase: { kind: 'dead', resumeIn: 1, clockRuns: false, nextTeam: 0, possKind: 'inbound' },
    teams: [home, away],
    agents,
    lineup: [
      home.players.filter((p) => !starters0.has(p.id)).map((p) => p.id),
      [...away.starters]
    ],
    events: []
  } as unknown as GameState;
  return { s, home, away };
}

describe('LIVE default §5.1: the collapse path (constructed mid-concede states)', () => {
  it('inside the hysteresis band the wave HOLDS: no starter returns, no thrash', () => {
    // 6:00, margin 16: entry 21, exit floor 15 — the band holds the flag,
    // and the concede `continue` keeps suspending the fatigue rotation even
    // though every on-floor reserve reads tired (70 < 74). A return here
    // would be the thrash the pool test pins against.
    const { s, home } = midConcedeState(live, { clock: 360, score: [96, 80] });
    checkSubs(s);
    expect(s.conceded[0]).toBe(true);
    expect(startersOnFloor(s, home, 0)).toBe(0);
    expect(s.events.length).toBe(0);
  });

  it('below the exit floor the collapse legalizes the return: starters come back through the normal rotation', () => {
    // 6:00, margin 12 < exit floor 15 (and NOT crunch: 360 ≥ crunchClockSec,
    // 12 > crunchMarginPts): updateConcede clears the flag, the fatigue
    // rotation resumes, and each tired reserve yields to a rested starter.
    const { s, home } = midConcedeState(live, { clock: 360, score: [92, 80] });
    checkSubs(s);
    expect(s.conceded[0]).toBe(false);
    expect(startersOnFloor(s, home, 0)).toBeGreaterThanOrEqual(3);
    // the return is real substitutions: reserves out, starters in
    for (const e of s.events) {
      if (e.type !== 'substitution' || e.team !== 0) continue;
      expect(home.starters.includes(e.in[0]!)).toBe(true);
      expect(home.starters.includes(e.out[0]!)).toBe(false);
    }
  });

  it('crunch clears a standing concede AND physically returns the starters', () => {
    // 3:20, margin 8: crunch (clock < 300, margin ≤ 10) voids the flag
    // unconditionally and the crunch branch re-inserts every standing
    // starter (energy 95 > crunchEnergyMin) — the 20→8 collapse path, now
    // asserted on the LINEUP, not just the flags.
    const { s, home } = midConcedeState(live, { clock: 200, score: [88, 80] });
    checkSubs(s);
    expect(s.conceded).toEqual([false, false]);
    expect(startersOnFloor(s, home, 0)).toBeGreaterThanOrEqual(3);
  });
});

describe('LIVE default §5.1: a close game never concedes', () => {
  it('below the exit floor no margin can enter OR hold a concede at any clock (default params, exhaustive grid)', () => {
    // The line's minimum is the base itself (clock → 0): entry needs ≥ 15
    // (leader) / ≥ 19 (trailer), and holding a stale flag needs ≥ 9 / ≥ 13.
    // Sweep every 15s of the final period × every margin below those
    // floors × both chairs × both priors: updateConcede must always land
    // un-conceded. This is the arithmetic guarantee that close basketball
    // (and everything up to a 8-point game, from either prior) NEVER sees
    // the concede branch at the shipped thresholds.
    for (let clock = 0; clock <= 720; clock += 15) {
      for (let margin = 0; margin <= 8; margin++) {
        for (const homeLeads of [true, false]) {
          const score: [number, number] =
            homeLeads ? [80 + margin, 80] : [80, 80 + margin];
          for (const prior of [false, true]) {
            const s = hState(defaultParams, {
              clock, score, conceded: [prior, prior]
            });
            updateConcede(s);
            expect(s.conceded).toEqual([false, false]);
          }
        }
      }
    }
  });

  it('full-game leg: late in a close game the floor is never a full bench unit at any legal stoppage', () => {
    // At every dead-ball MARKER inside the last 4:00 with the margin ≤ 8
    // (crunch territory: within a possession-swing of the crunch
    // definition), the side must field at least one starter. A conceded
    // side sits at 0-1 starters (probed), so a concede firing without the
    // margin shows up here immediately. The ≥1 bar leaves room for a
    // gassed-roster crunch, which can legally hold starters out.
    //
    // Measurement correction at the FLOW landing (re-adjudicated per
    // f-assembly §4d, the ffit-rotations diagnosis): this leg used to
    // assert at EVERY event, which was valid only while postMakeSubWindow 1
    // hosted a sub window on every made basket (re-insertion latency ~0).
    // Under the real rule a comeback that cuts a blowout inside the crunch
    // window mid-live-play waits for the next legal stoppage before the
    // crunch re-insertion can execute (measured on this pool: one ~21s
    // possession with the margin freshly cut to 7 and the un-conceded
    // bench five still out — the coach legally cannot act sooner). The
    // behavior contract is asserted where a checkSubs pass has actually
    // run: the dead-ball settlement markers, the same device the
    // composition pin above uses.
    let sampled = 0;
    for (const g of pool) {
      foldFinalPeriod(g, ({ e, m, count }) => {
        if (isDeadBall(e) && e.clock <= 240 && m <= 8) {
          sampled++;
          expect(count).toBeGreaterThanOrEqual(1);
        }
      });
    }
    expect(sampled).toBeGreaterThan(100); // probed 366 marker events: close endings are common
  });
});
