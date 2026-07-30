/**
 * Rotation grammar (fdesign-rotations), STAGED-inert wiring suite:
 * quarter-break waves, the foul-trouble policy, and the timeout-window
 * relaxation, all shipped dormant (sub.waveMaxPerTeam 0 /
 * ftroublePersonalOffset 99 / timeoutSubRelaxPts 0 / subMinBenchSec 0;
 * byte-identity is the golden fingerprint corpus's job).
 *
 * Style per concede.test.ts: designed values forced through withParams,
 * hand-built states for exact-semantics pins, one small forced-live pool
 * (sim once, assert many) with bars well under probed values (probes noted
 * inline). The corpus-fit acceptance bands (design §6: boundary-delta
 * means, Q3-start starter share ≥ 0.85, histogram shapes) are the flip
 * gate, owned by the rotation fit wave, not this wiring commit: the cap-2
 * wave at these dials measures well short of the Q3-share band on the
 * unfitted engine, by design.
 *
 * Precedence contract under test (design §2.1):
 *   crunch > concede > foul-trouble > quarter-wave > fatigue/minutes.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultParams, simulateGame, withParams,
  type GameResult, type Player, type SimParams, type Team, type TeamSide
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { checkSubs } from '../src/sim/subs.js';
import type { Agent, GameState, TimeoutReason } from '../src/sim/state.js';

/** the designed (flip) values, forced; the shipped defaults stay inert */
const LIVE = withParams({
  sub: {
    waveMaxPerTeam: 2,
    waveStintMinSec: 300,
    waveReadyRelief: 10,
    subMinBenchSec: 150,
    ftroublePersonalOffset: 1,
    ftroubleIgnoreClockSec: 120,
    timeoutSubRelaxPts: 8
  }
});

// --------------------------------------------------------------- fixtures

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

interface Fixture {
  s: GameState;
  home: Team;
  /** home starters (pos forced PG/SG/SF/PF/C by index) */
  st: string[];
  /** home bench (pos forced to mirror the starters by index) */
  bn: string[];
  a: (id: string) => Agent;
}

/**
 * A dead-ball stoppage with full control of the home side. Home starters
 * open on court (energy 90, lastSwapT 0, fouls 0); positions are forced so
 * position-preference assertions are exact. The away side is built inert
 * for every branch under test: short stints (no wave exits), a gassed bench
 * (no wave/fatigue entries), no fouls.
 */
function rotState(
  params: SimParams,
  o: { period: number; clock: number; t: number; score?: [number, number] }
): Fixture {
  const { home, away } = sampleMatchup();
  const POS: Player['pos'][] = ['PG', 'SG', 'SF', 'PF', 'C'];
  const st = [...home.starters];
  const bn = home.players.map((p) => p.id).filter((id) => !st.includes(id));
  for (const p of home.players) {
    const i = st.indexOf(p.id);
    p.pos = i >= 0 ? POS[i]! : POS[bn.indexOf(p.id) % 5]!;
  }
  const agents = new Map<string, Agent>();
  const add = (team: Team, side: TeamSide): void => {
    const starters = new Set(team.starters);
    for (const p of team.players) agents.set(p.id, mkAgent(p, side, starters.has(p.id)));
  };
  add(home, 0);
  add(away, 1);
  for (const p of away.players) {
    const ag = agents.get(p.id)!;
    // short stints, gassed bench: the away side can neither exit nor enter
    if (ag.onCourt) ag.lastSwapT = Math.max(0, o.t - 100);
    else ag.energy = 20;
  }
  const s = {
    params,
    rules: { periods: 4, periodMinutes: 12, otMinutes: 5, foulOutAt: 6 },
    period: o.period,
    clock: o.clock,
    t: o.t,
    wallT: o.t,
    score: o.score ?? [50, 50],
    conceded: [false, false],
    teams: [home, away],
    agents,
    lineup: [[...home.starters], [...away.starters]],
    phase: { kind: 'dead', resumeIn: 1, clockRuns: false, nextTeam: 0, possKind: 'inbound' },
    events: []
  } as unknown as GameState;
  return { s, home, st, bn, a: (id: string) => agents.get(id)! };
}

/** put exactly `ids` on the floor for home (slot order = ids order) */
function floor(f: Fixture, ids: string[]): void {
  for (const p of f.home.players) f.a(p.id).onCourt = ids.includes(p.id);
  f.s.lineup[0] = [...ids];
}

const subsOf = (s: GameState, side: TeamSide): { out: string; in: string }[] =>
  (s.events as { type: string; team: TeamSide; out: string[]; in: string[] }[])
    .filter((e) => e.type === 'substitution' && e.team === side)
    .map((e) => ({ out: e.out[0]!, in: e.in[0]! }));

// ------------------------------------------------------- quarter-break wave

describe('quarter-break wave (constructed boundary stoppage, forced live)', () => {
  it('waves the longest stints out for the freshest position-fits, capped at waveMaxPerTeam', () => {
    const f = rotState(LIVE, { period: 2, clock: 720, t: 720 });
    // stints: st0 720s, st1 620s (both wave-eligible >= 300); the rest 220s
    f.a(f.st[1]!).lastSwapT = 100;
    for (const id of [f.st[2]!, f.st[3]!, f.st[4]!]) f.a(id).lastSwapT = 500;
    // bench: b0 mirrors st0's pos (energy 85, inside the waveReadyRelief
    // band, below the mid-quarter 88 bar), b1 mirrors st1's (95); the rest
    // are gassed (50 < 78) and ineligible
    f.a(f.bn[0]!).energy = 85;
    f.a(f.bn[0]!).lastSwapT = 500;
    f.a(f.bn[1]!).energy = 95;
    f.a(f.bn[1]!).lastSwapT = 500;
    for (const id of f.bn.slice(2)) f.a(id).energy = 50;
    checkSubs(f.s, undefined, { wave: true });
    const subs = subsOf(f.s, 0);
    // longest stint exits first; position preference beats raw energy
    // (b0 at 85 takes st0's slot over the fresher b1 at 95)
    expect(subs).toEqual([
      { out: f.st[0]!, in: f.bn[0]! },
      { out: f.st[1]!, in: f.bn[1]! }
    ]);
    expect(subsOf(f.s, 1).length).toBe(0); // the inert away side never moves
  });

  it('the wave is capped even with more eligible bodies', () => {
    const f = rotState(LIVE, { period: 2, clock: 720, t: 720 });
    for (const id of f.bn) { f.a(id).energy = 95; f.a(id).lastSwapT = 400; }
    checkSubs(f.s, undefined, { wave: true }); // all five on-court stints are 720
    expect(subsOf(f.s, 0).length).toBe(2);
  });

  it('halftime reset: starters return first and are never waved out', () => {
    const f = rotState(LIVE, { period: 3, clock: 720, t: 1440 });
    // floor: one starter with the longest stint + four non-starters
    floor(f, [f.st[0]!, ...f.bn.slice(0, 4)]);
    f.a(f.st[0]!).lastSwapT = 0; // 1440s stint, top exit candidate if not protected
    for (const id of f.bn.slice(0, 4)) f.a(id).lastSwapT = 1000; // 440s stints
    // bench: the four rested starters + one fresher non-starter; the reset
    // ordering must still prefer starters
    for (const id of [f.st[1]!, f.st[2]!, f.st[3]!, f.st[4]!]) {
      f.a(id).energy = 90;
      f.a(id).lastSwapT = 1200;
    }
    f.a(f.bn[4]!).energy = 99;
    f.a(f.bn[4]!).lastSwapT = 1200;
    checkSubs(f.s, undefined, { wave: true });
    const subs = subsOf(f.s, 0);
    expect(subs.length).toBe(2);
    for (const sub of subs) {
      expect(f.st.includes(sub.out)).toBe(false); // never wave a starter out at the H2 reset
      expect(f.st.includes(sub.in)).toBe(true);   // starters first among entries
    }
    expect(f.s.lineup[0].includes(f.st[0]!)).toBe(true);
  });

  it('churn floor + trouble filter gate wave entries', () => {
    const f = rotState(LIVE, { period: 2, clock: 720, t: 720 });
    // three fresh bench bodies: one sat only 100s (< subMinBenchSec 150),
    // one is foul-troubled, one is clean; only the clean one may enter
    f.a(f.bn[0]!).energy = 95;
    f.a(f.bn[0]!).lastSwapT = 650;
    f.a(f.bn[1]!).energy = 95;
    f.a(f.bn[1]!).lastSwapT = 400;
    f.a(f.bn[1]!).fouls = 3; // bar in Q2 is 2+1
    f.a(f.bn[2]!).energy = 95;
    f.a(f.bn[2]!).lastSwapT = 400;
    for (const id of f.bn.slice(3)) f.a(id).energy = 50;
    checkSubs(f.s, undefined, { wave: true });
    const subs = subsOf(f.s, 0);
    expect(subs.length).toBe(1);
    expect(subs[0]!.in).toBe(f.bn[2]!);
  });

  it('no wave at the Q1 tip, in OT, under crunch, or on a conceded side', () => {
    // Q1: quarterWave's period gate
    const q1 = rotState(LIVE, { period: 1, clock: 720, t: 0 });
    checkSubs(q1.s, undefined, { wave: true });
    expect(subsOf(q1.s, 0).length).toBe(0);
    // OT: crunch's floor, and the crunch branch may only re-insert
    // starters, so a full-starter floor stays put
    const ot = rotState(LIVE, { period: 5, clock: 300, t: 2880, score: [100, 100] });
    for (const id of f0(ot)) ot.a(id).lastSwapT = 2000;
    checkSubs(ot.s, undefined, { wave: true });
    expect(subsOf(ot.s, 0).length).toBe(0);
    // crunch (Q4, close, inside 5:00): the boundary keeps its five
    const cr = rotState(LIVE, { period: 4, clock: 200, t: 2680, score: [80, 78] });
    for (const id of f0(cr)) cr.a(id).lastSwapT = 2000;
    for (const id of cr.bn) { cr.a(id).energy = 95; cr.a(id).lastSwapT = 2400; }
    checkSubs(cr.s, undefined, { wave: true });
    expect(subsOf(cr.s, 0).length).toBe(0);
    // concede outranks the wave per side: a decided Q4 boundary with
    // non-starters on the floor swaps nothing (the wave is skipped and the
    // concede branch only ejects starters); the same state inside the
    // margin waves normally
    const mk = (score: [number, number]): Fixture => {
      const f = rotState(LIVE, { period: 4, clock: 720, t: 2160, score });
      floor(f, f.bn.slice(0, 5));
      for (const id of f.bn.slice(0, 5)) f.a(id).lastSwapT = 1700; // 460s stints
      for (const id of f.st) { f.a(id).energy = 95; f.a(id).lastSwapT = 1900; }
      return f;
    };
    const dead = mk([110, 75]); // margin 35 > line 27 (+lag 31): both concede
    checkSubs(dead.s, undefined, { wave: true });
    expect(subsOf(dead.s, 0).length).toBe(0);
    const alive = mk([80, 75]); // margin 5: nobody concedes, no crunch (12:00 left)
    checkSubs(alive.s, undefined, { wave: true });
    expect(subsOf(alive.s, 0).length).toBe(2);
  });

  it('INERT defaults: the same boundary produces zero wave swaps (dormancy pin)', () => {
    const f = rotState(withParams(), { period: 2, clock: 720, t: 720 });
    for (const id of f.bn) { f.a(id).energy = 100; f.a(id).lastSwapT = 400; }
    checkSubs(f.s, undefined, { wave: true }); // waveMaxPerTeam 0; guard returns
    expect(subsOf(f.s, 0).length).toBe(0);
  });
});

/** home floor ids helper (current lineup snapshot) */
function f0(f: Fixture): string[] {
  return [...f.s.lineup[0]];
}

// --------------------------------------------------------- foul-trouble

describe('foul-trouble policy (constructed, forced live)', () => {
  it('pulls the troubled player at the stoppage, non-troubled replacement, position first', () => {
    const f = rotState(LIVE, { period: 1, clock: 400, t: 320 });
    f.a(f.st[0]!).fouls = 2; // Q1 bar = 1 + 1
    f.a(f.bn[0]!).fouls = 2; // the position mirror is also troubled; excluded
    f.a(f.bn[0]!).energy = 99;
    f.a(f.bn[1]!).energy = 60; // no readyThreshold bar on the urgent pull
    for (const id of f.bn.slice(2)) f.a(id).energy = 30; // deep bench gassed
    checkSubs(f.s);
    const subs = subsOf(f.s, 0);
    expect(subs.length).toBe(1);
    expect(subs[0]!.out).toBe(f.st[0]!);
    expect(subs[0]!.in).toBe(f.bn[1]!);
  });

  it('a foul inside the last ftroubleIgnoreClockSec rides to the break', () => {
    const f = rotState(LIVE, { period: 1, clock: 100, t: 620 });
    f.a(f.st[0]!).fouls = 2;
    checkSubs(f.s);
    expect(subsOf(f.s, 0).length).toBe(0);
  });

  it('the return-block: a pulled troubled starter cannot ride the fatigue rotation back in', () => {
    const f = rotState(LIVE, { period: 1, clock: 300, t: 420 });
    floor(f, [f.bn[0]!, f.st[1]!, f.st[2]!, f.st[3]!, f.st[4]!]);
    const troubled = f.a(f.st[0]!); // benched, fresh, behind any pace, and troubled
    troubled.fouls = 2;
    troubled.energy = 100;
    troubled.lastSwapT = 100;
    f.a(f.bn[0]!).energy = 40; // tired non-starter on the floor wants relief
    f.a(f.bn[1]!).energy = 92; // the legal candidate
    f.a(f.bn[1]!).lastSwapT = 100;
    for (const id of f.bn.slice(2)) f.a(id).energy = 50;
    checkSubs(f.s);
    const subs = subsOf(f.s, 0);
    expect(subs.length).toBe(1);
    expect(subs[0]!.in).toBe(f.bn[1]!); // never the troubled starter
  });

  it('the bar self-clears at the next period', () => {
    const f = rotState(LIVE, { period: 2, clock: 700, t: 740 });
    floor(f, [f.bn[0]!, f.st[1]!, f.st[2]!, f.st[3]!, f.st[4]!]);
    const cleared = f.a(f.st[0]!);
    cleared.fouls = 2; // Q2 bar = 2 + 1: no longer troubled
    cleared.energy = 100;
    cleared.lastSwapT = 500;
    f.a(f.bn[0]!).energy = 40;
    for (const id of f.bn.slice(1)) f.a(id).energy = 50;
    checkSubs(f.s);
    const subs = subsOf(f.s, 0);
    expect(subs.length).toBe(1);
    expect(subs[0]!.in).toBe(f.st[0]!); // an ordinary (best) candidate again
  });

  it('crunch overrides foul trouble in both directions', () => {
    // a troubled starter ON the floor is not pulled...
    const f = rotState(LIVE, { period: 4, clock: 200, t: 2680, score: [80, 78] });
    f.a(f.st[0]!).fouls = 5; // Q4 bar = 4 + 1
    for (const id of f.bn) { f.a(id).energy = 95; f.a(id).lastSwapT = 2000; }
    checkSubs(f.s);
    expect(subsOf(f.s, 0).length).toBe(0);
    expect(f.s.lineup[0].includes(f.st[0]!)).toBe(true);
    // ...and a troubled starter on the bench is re-inserted (trouble-blind)
    const g = rotState(LIVE, { period: 4, clock: 200, t: 2680, score: [80, 78] });
    floor(g, [g.bn[0]!, g.st[1]!, g.st[2]!, g.st[3]!, g.st[4]!]);
    const benched = g.a(g.st[0]!);
    benched.fouls = 5;
    benched.energy = 50; // above crunchEnergyMin 35, so he can stand
    checkSubs(g.s);
    const subs = subsOf(g.s, 0);
    expect(subs.length).toBe(1);
    expect(subs[0]!).toEqual({ out: g.bn[0]!, in: g.st[0]! });
  });

  it('INERT defaults: two fouls in Q1 pull nobody (dormancy pin)', () => {
    const f = rotState(withParams(), { period: 1, clock: 400, t: 320 });
    f.a(f.st[0]!).fouls = 2; // bar at the shipped offset 99 is unreachable
    checkSubs(f.s);
    expect(subsOf(f.s, 0).length).toBe(0);
  });
});

// ------------------------------------------------- timeout-window relaxation

describe('timeout-window subs (the fdesign-timeouts §4 handshake, forced live)', () => {
  const stamp = (f: Fixture): void => {
    (f.s.phase as { timeout?: { team: TeamSide; reason: TimeoutReason } }).timeout =
      { team: 0, reason: 'stop_run' };
  };
  const prep = (f: Fixture): void => {
    f.a(f.st[0]!).energy = 65; // above the 62 bar, inside the +8 huddle band
    f.a(f.bn[0]!).energy = 92;
    f.a(f.bn[0]!).lastSwapT = 400; // rest 400 >= subMinBenchSec
    for (const id of f.bn.slice(1)) f.a(id).energy = 50;
  };

  it('the huddle loosens the pull leash for this stoppage only', () => {
    const quiet = rotState(LIVE, { period: 2, clock: 300, t: 800 });
    prep(quiet);
    checkSubs(quiet.s);
    expect(subsOf(quiet.s, 0).length).toBe(0); // 65 >= 62: not tired without the huddle
    const huddle = rotState(LIVE, { period: 2, clock: 300, t: 800 });
    prep(huddle);
    stamp(huddle);
    checkSubs(huddle.s);
    const subs = subsOf(huddle.s, 0);
    expect(subs.length).toBe(1);
    expect(subs[0]!).toEqual({ out: huddle.st[0]!, in: huddle.bn[0]! });
  });

  it('the freethrows phase variant carries the same handshake', () => {
    const f = rotState(LIVE, { period: 2, clock: 300, t: 800 });
    prep(f);
    f.s.phase = {
      kind: 'freethrows', shooterId: f.st[4]!, side: 0, taken: 0, of: 2,
      nextIn: 1, lastMade: false, oneAndOne: false,
      timeout: { team: 0, reason: 'mandatory' }
    } as GameState['phase'];
    checkSubs(f.s, f.st[4]!);
    expect(subsOf(f.s, 0).length).toBe(1);
  });

  it('INERT defaults: the stamped huddle changes nothing (dormancy pin)', () => {
    const f = rotState(withParams(), { period: 2, clock: 300, t: 800 });
    prep(f);
    stamp(f);
    checkSubs(f.s);
    expect(subsOf(f.s, 0).length).toBe(0); // relax 0: 65 >= 62 stays quiet
  });
});

// --------------------------------------------------- urgentOnly (FT slot)

describe('urgentOnly: the staged between-FT-attempts semantics', () => {
  it('runs the foul-trouble pull, protects the shooter, defers the fatigue rotation', () => {
    const f = rotState(LIVE, { period: 1, clock: 400, t: 320 });
    const shooter = f.st[4]!;
    f.a(f.st[0]!).fouls = 2;  // urgent: troubled non-shooter
    f.a(f.st[1]!).energy = 40; // merely tired: must wait for the next stoppage
    f.a(f.bn[0]!).energy = 95;
    f.a(f.bn[1]!).energy = 95;
    f.s.phase = {
      kind: 'freethrows', shooterId: shooter, side: 0, taken: 1, of: 2,
      nextIn: 0.9, lastMade: true, oneAndOne: false
    } as GameState['phase'];
    checkSubs(f.s, shooter, { urgentOnly: true });
    const subs = subsOf(f.s, 0);
    expect(subs.length).toBe(1);
    expect(subs[0]!.out).toBe(f.st[0]!);
    expect(f.s.lineup[0].includes(f.st[1]!)).toBe(true); // fatigue deferred
    // the full pass at the next stoppage does rotate the tired one
    checkSubs(f.s, shooter);
    expect(f.s.lineup[0].includes(f.st[1]!)).toBe(false);
  });

  it('a troubled SHOOTER is protected mid-trip', () => {
    const f = rotState(LIVE, { period: 1, clock: 400, t: 320 });
    const shooter = f.st[0]!;
    f.a(shooter).fouls = 2;
    checkSubs(f.s, shooter, { urgentOnly: true });
    expect(subsOf(f.s, 0).length).toBe(0);
    expect(f.s.lineup[0].includes(shooter)).toBe(true);
  });

  it('with nothing urgent pending the pass is a no-op (rng-free, zero events)', () => {
    const f = rotState(LIVE, { period: 1, clock: 400, t: 320 });
    f.a(f.st[1]!).energy = 40; // tired is NOT urgent
    for (const id of f.bn) f.a(id).energy = 95;
    checkSubs(f.s, f.st[4]!, { urgentOnly: true });
    expect(f.s.events.length).toBe(0);
  });

  it('crunch gates the urgent pull too (riding the troubled five is the override)', () => {
    const f = rotState(LIVE, { period: 4, clock: 200, t: 2680, score: [80, 78] });
    f.a(f.st[0]!).fouls = 5;
    for (const id of f.bn) f.a(id).energy = 95;
    checkSubs(f.s, f.st[4]!, { urgentOnly: true });
    expect(f.s.events.length).toBe(0);
  });
});

// ------------------------------------------------------- forced-live pool

describe('forced-live pool (existence floors; corpus-fit bands are the flip gate)', () => {
  const LIVE_POOL = {
    sub: {
      waveMaxPerTeam: 2, subMinBenchSec: 150,
      ftroublePersonalOffset: 1, timeoutSubRelaxPts: 8
    }
  };
  const pool: { r: GameResult; st: [Set<string>, Set<string>] }[] = [];
  for (let i = 0; i < 6; i++) {
    const { home, away } = sampleMatchup();
    const flip = i % 2 === 1;
    const h = flip ? away : home;
    const a = flip ? home : away;
    pool.push({
      r: simulateGame({
        seed: `rot-live-${i}`, home: h, away: a, collectFrames: false, params: LIVE_POOL
      }),
      st: [new Set(h.starters), new Set(a.starters)]
    });
  }

  it('quarter boundaries host substitution waves', () => {
    // subs whose preceding non-sub event is period_start (Q2-Q4 starts).
    // Probed: 32 across the pool (≈5.3/game; the corpus-reconstructed real
    // wave is ~9/game, the fit wave's target, not this floor's)
    let boundary = 0;
    for (const { r } of pool) {
      const ev = r.events;
      for (let k = 0; k < ev.length; k++) {
        if (ev[k]!.type !== 'substitution') continue;
        let j = k - 1;
        while (j >= 0 && ev[j]!.type === 'substitution') j -= 1;
        const prev = ev[j]!;
        if (prev.type === 'period_start' && ev[k]!.period >= 2 && ev[k]!.period <= 4) boundary += 1;
      }
    }
    expect(boundary).toBeGreaterThanOrEqual(8);
  });

  it('foul-trouble pulls happen and hold until the period turns (periods 1-3)', () => {
    // bar-crossing personals (count >= period+1, clock > 120, periods 1-3):
    // probed 29 across the pool, 29 pulled before the period ended, 0
    // same-period re-entries (the return-block; crunch re-entries are a Q4
    // phenomenon and legal, design §2.4)
    let crossings = 0;
    let pulled = 0;
    let reentries = 0;
    for (const { r } of pool) {
      const ev = r.events;
      for (let k = 0; k < ev.length; k++) {
        const e = ev[k]!;
        if (e.type !== 'foul' || e.fouledOut || e.period > 3) continue;
        if (e.personalCount < e.period + 1 || e.clock <= 120) continue;
        crossings += 1;
        for (let m = k + 1; m < ev.length && ev[m]!.period === e.period; m++) {
          const sub = ev[m]!;
          if (sub.type !== 'substitution' || !sub.out.includes(e.on)) continue;
          pulled += 1;
          for (let n = m + 1; n < ev.length && ev[n]!.period === e.period; n++) {
            const back = ev[n]!;
            if (back.type === 'substitution' && back.in.includes(e.on)) { reentries += 1; break; }
          }
          break;
        }
      }
    }
    expect(crossings).toBeGreaterThanOrEqual(10);
    expect(pulled / Math.max(1, crossings)).toBeGreaterThanOrEqual(0.6); // probed 1.0
    expect(reentries).toBe(0);
  });

  it('the pool is deterministic per seed', () => {
    const { home, away } = sampleMatchup();
    const again = simulateGame({
      seed: 'rot-live-0', home, away, collectFrames: false, params: LIVE_POOL
    });
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(pool[0]!.r.events));
  });
});

// ------------------------------------------------------------ dormancy pins

describe('STAGED dormancy (retire at the rotation fit-wave flip)', () => {
  it('the shipped stage switches are the never-fire values', () => {
    const S = defaultParams.sub;
    expect(S.waveMaxPerTeam).toBe(0);
    expect(S.subMinBenchSec).toBe(0);
    expect(S.ftroublePersonalOffset).toBe(99);
    expect(S.timeoutSubRelaxPts).toBe(0);
    // shape dials ship at design values (unread while the switches are off)
    expect(S.waveStintMinSec).toBe(300);
    expect(S.waveReadyRelief).toBe(10);
    expect(S.ftroubleIgnoreClockSec).toBe(120);
  });
});
