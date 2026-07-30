/**
 * Possession-grammar wiring acceptance (FLOW wave, staged-inert).
 *
 * The four grammar mechanisms (quarter-opener deliberateness, OREB scramble
 * economy, iso/stepback-three creation, heave discipline; see
 * findings/fdesign-grammar.md) land wired but STAGED: every stage switch
 * defaults to its inert value, so default-params behavior is byte-identical
 * to the pre-wiring engine (the golden fingerprint corpus is the tripwire
 * for that; `npm run fingerprint`). These tests do two jobs instead:
 *
 *  1. Live-shape: with the switches forced via withParams overrides, each
 *     mechanism fires exactly in its designed context and nowhere else
 *     (window gates, identity gates, taxonomy gates).
 *  2. Staged-inert: with the switches at rest, the shape dials alone
 *     (ramp geometry, window seconds, drive share, deficit ceiling) change
 *     nothing, proving the zeros/one really are the switches the fit wave
 *     will flip.
 *
 * decideBall is exercised directly on a hand-built GameState (the softmax
 * consumes rng, so repeated calls sample the decision distribution; forced
 * utilities of ±5 EV make the assertions deterministic at temperature
 * 0.0732; weight ratios of e^68 cannot lose a 60-draw sample).
 */

import { describe, expect, it } from 'vitest';
import {
  NBA, Rng, makeCourt, makePlayer, makeTactics, simulateGame, withParams,
  type Team, type V2
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { decideBall, type BallAction } from '../src/sim/ai/decide.js';
import { openerSet } from '../src/sim/ai/concepts.js';
import { attackedRim, type Agent, type GameState } from '../src/sim/state.js';

type ParamOverrides = Parameters<typeof withParams>[0];

// ---------------------------------------------------------------- helpers

/** period-start elapsed seconds for an NBA game (12-min periods, 5-min OT) */
function periodStartT(period: number): number {
  const reg = Math.min(period - 1, NBA.periods);
  const ot = Math.max(0, period - 1 - NBA.periods);
  return reg * NBA.periodMinutes * 60 + ot * NBA.otMinutes * 60;
}

interface StateOpts {
  params?: ParamOverrides;
  seed?: string;
  period?: number;               // default 2
  clock?: number;                // seconds left in period, default 600
  shotClock?: number;            // default 20
  /** possession startT; default = the period's start (an opener) */
  possStartT?: number;
  phase?: 'advance' | 'halfcourt' | 'transition';
  score?: [number, number];
  /** seconds since the holder's catch (catchT = t - this), default 0.2 */
  sinceCatch?: number;
  acquiredBy?: Agent['acquiredBy'];
  /** holder distance from the attacked rim, ft (straight toward midcourt) */
  holderFt?: number;
  tend?: Partial<ReturnType<typeof makePlayer>['tend']>;
  attr?: Partial<ReturnType<typeof makePlayer>['attr']>;
}

/**
 * A minimal-but-complete 5v5 GameState for exercising decideBall in
 * isolation: offense holder placed relative to the attacked rim, one open
 * arc teammate (26 ft straightaway), one corner teammate, two parked deep;
 * all defenders parked ~45 ft away in the backcourt so contests/openness
 * are clean unless a test moves them. No possession machinery runs; tests
 * drive decideBall directly.
 */
function mkState(o: StateOpts = {}): { s: GameState; holder: string; arcMate: string } {
  const period = o.period ?? 2;
  const params = withParams(o.params);
  const rng = new Rng(o.seed ?? 'grammar-fixture');
  const court = makeCourt(NBA);

  const mk = (id: string, over: Partial<Parameters<typeof makePlayer>[0]> = {}) =>
    makePlayer({ id, name: id, pos: 'SF', heightIn: 78, ...over });
  const off = [
    mk('off-1', { tend: { shotRim: 80, shotThree: 60, pullUp: 60, usage: 70, ...o.tend }, attr: { finishing: 90, three: 75, midRange: 70, ...o.attr } }),
    mk('off-2', { tend: { shotThree: 75 }, attr: { three: 80 } }),
    mk('off-3', { tend: { shotThree: 60 } }),
    mk('off-4'),
    mk('off-5')
  ];
  const def = [mk('def-1'), mk('def-2'), mk('def-3'), mk('def-4'), mk('def-5')];
  const teamOf = (id: string, players: ReturnType<typeof mk>[]): Team => ({
    id, name: id, abbrev: id.slice(0, 3).toUpperCase(),
    players, starters: players.map((p) => p.id), tactics: makeTactics()
  });

  const startT = o.possStartT ?? periodStartT(period);
  const sinceCatch = o.sinceCatch ?? 0.2;
  const t = startT + 4; // 4s into the trip keeps catch math simple

  const agents = new Map<string, Agent>();
  const addAgent = (p: ReturnType<typeof mk>, side: 0 | 1) => {
    agents.set(p.id, {
      p, side,
      pos: { x: court.midX, y: court.centerY },
      vel: { x: 0, y: 0 },
      energy: 100, load: 0, secondsPlayed: 0, fouls: 0, onCourt: true, fouledOut: false,
      lastSwapT: 0,
      target: { x: court.midX, y: court.centerY },
      intent: 'spot', sprinting: false, spotKey: null, manId: null,
      dribblesSinceCatch: 0, dribbleAcc: 0,
      catchT: -99, acquiredBy: 'deadball',
      catchQuality: params.shot.passQualityCenter,
      usedPoss: 0, teamPossOnCourt: 0,
      driveUntil: -99, cutUntil: -99, relocUntil: -99,
      screenStunUntil: -99, navUnderUntil: -99
    });
  };
  off.forEach((p) => addAgent(p, 0));
  def.forEach((p) => addAgent(p, 1));

  const s: GameState = {
    rng, params, rules: NBA, court,
    teams: [teamOf('grm-off', off), teamOf('grm-def', def)],
    agents,
    lineup: [off.map((p) => p.id), def.map((p) => p.id)],
    ball: { holderId: 'off-1', pos: { x: 0, y: 0 }, flight: null },
    period, clock: o.clock ?? 600, t, wallT: t,
    score: o.score ?? [0, 0],
    teamFoulsPeriod: [0, 0], tipWinner: 0,
    endgame: true, timeoutsLeft: [7, 7], runPts: [0, 0],
    timeoutsThisPeriod: [0, 0], timeoutsUsedFinalPeriod: [0, 0],
    timeoutsUsedFinalLate: [0, 0], lastTimeoutT: [-99, -99],
    conceded: [false, false],
    poss: {
      team: 0, shotClock: o.shotClock ?? 20, phase: o.phase ?? 'halfcourt',
      startT, kind: 'inbound', lastPass: null,
      spotMap: new Map(), spots: new Map(), action: null, ended: false
    },
    phase: { kind: 'live' },
    events: [], frames: [], collectFrames: false,
    decisionAt: 0, pendingRelease: null, over: false
  };

  // geometry relative to the rim side 0 attacks this period
  const rim = attackedRim(s, 0);
  const inward = rim.x > court.midX ? -1 : 1; // toward midcourt
  const place = (id: string, ftFromRim: number, lateral = 0): void => {
    const a = agents.get(id)!;
    a.pos = { x: rim.x + inward * ftFromRim, y: rim.y + lateral };
    a.target = { ...a.pos };
  };
  place('off-1', o.holderFt ?? 5);
  place('off-2', 26);              // straightaway three (arc is 23.75 ft)
  place('off-3', 20, 18);          // wing-ish spacing body
  place('off-4', 60);              // parked deep
  place('off-5', 60, 8);
  for (const d of def) place(d.id, 45, 4); // defenders parked far: open looks

  const holder = agents.get('off-1')!;
  holder.catchT = t - sinceCatch;
  holder.acquiredBy = o.acquiredBy ?? 'pass';
  s.ball.pos = { ...holder.pos };
  return { s, holder: 'off-1', arcMate: 'off-2' };
}

/** sample decideBall n times (fresh rng draws each call; state untouched) */
function sample(s: GameState, n: number): BallAction[] {
  const out: BallAction[] = [];
  for (let i = 0; i < n; i++) out.push(decideBall(s));
  return out;
}

const shootCount = (as: BallAction[]) => as.filter((a) => a.kind === 'shoot').length;

// ------------------------------------------- M1: quarter-opener (concept 9)

describe('concept 9 — opening set (staged wiring)', () => {
  const stub = (over: {
    period?: number; startT?: number; phase?: string; params?: ParamOverrides;
  }) => ({
    params: withParams(over.params),
    rules: NBA,
    period: over.period ?? 2,
    poss: { phase: over.phase ?? 'halfcourt', startT: over.startT ?? 720 }
  }) as unknown as GameState;

  const FORCED: ParamOverrides = { ai: { openerShootMalus: 0.4 } };

  it('staged default is exactly zero even in the opener window', () => {
    const r = openerSet(stub({}), 1);
    expect(r.shoot).toBe(0);
    expect(r.drive).toBe(0);
  });

  it('forced malus fires on the period-opening possession, full at possession start', () => {
    const r = openerSet(stub({ params: FORCED }), 1);
    expect(r.shoot).toBe(0.4);
    expect(r.drive).toBe(0.4 * 0.75); // openerDriveShare default
  });

  it('ramps to exactly zero at and below the floor share (window-only)', () => {
    const s = stub({ params: FORCED });
    expect(openerSet(s, 0.4167).shoot).toBe(0);
    expect(openerSet(s, 0.3).shoot).toBe(0);
    const mid = openerSet(s, 0.7).shoot;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.4);
  });

  it('never fires on a non-opener possession or outside advance/halfcourt', () => {
    expect(openerSet(stub({ params: FORCED, startT: 726.4 }), 1).shoot).toBe(0);
    expect(openerSet(stub({ params: FORCED, phase: 'transition' }), 1).shoot).toBe(0);
  });

  it('recognizes openers in Q1, Q4, and OT, with float-noise tolerance', () => {
    expect(openerSet(stub({ params: FORCED, period: 1, startT: 0 }), 1).shoot).toBe(0.4);
    expect(openerSet(stub({ params: FORCED, period: 4, startT: 2160 }), 1).shoot).toBe(0.4);
    expect(openerSet(stub({ params: FORCED, period: 5, startT: 2880 }), 1).shoot).toBe(0.4);
    // t accrues fl-rounded ticks: the boundary is never exact; tolerance pin
    expect(openerSet(stub({ params: FORCED, startT: 719.9999999 }), 1).shoot).toBe(0.4);
    // ...but one tick later is a different possession
    expect(openerSet(stub({ params: FORCED, period: 5, startT: 2884 }), 1).shoot).toBe(0);
  });

  it('master scale gates the whole concept', () => {
    const r = openerSet(stub({ params: { ai: { openerShootMalus: 0.4, openerScale: 0 } } }), 1);
    expect(r.shoot).toBe(0);
  });

  it('live: a forced malus suppresses shooting only in the opener window', () => {
    const N = 60;
    const forced: ParamOverrides = { ai: { openerShootMalus: 5 } };
    // opener possession, early clock (share 20/24 ≈ 0.83, inside the window):
    // a point-blank cut finish that would otherwise fire is held/passed out of
    const opener = mkState({ params: forced, shotClock: 20 });
    expect(shootCount(sample(opener.s, N))).toBe(0);
    // same look on a non-opener possession: the drilled finish fires
    const later = mkState({ params: forced, shotClock: 20, possStartT: periodStartT(2) + 30 });
    expect(shootCount(sample(later.s, N))).toBeGreaterThan(0);
    // same opener possession below the window floor (share 9/24 = 0.375): free
    const lateClock = mkState({ params: forced, shotClock: 9 });
    expect(shootCount(sample(lateClock.s, N))).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------- staged-inert pinning

describe('staged-inert: shape dials alone change nothing', () => {
  it('a full game is byte-identical with shape dials moved and switches at rest', () => {
    const run = (params?: ParamOverrides) => {
      const { home, away } = sampleMatchup();
      return simulateGame({ seed: 'grammar-pin-0', home, away, params, collectFrames: false });
    };
    const base = run();
    const staged = run({
      // every shape dial off its default; every stage switch at rest
      ai: {
        openerScale: 1.31,
        openerDriveShare: 0.9,
        openerRampFloorShare: 0.55
      }
    });
    expect(staged.finalScore).toEqual(base.finalScore);
    expect(staged.events.length).toBe(base.events.length);
    expect(staged.events).toEqual(base.events);
  });
});
