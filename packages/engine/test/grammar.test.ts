/**
 * Possession-grammar wiring acceptance (FLOW wave) — LIVE since the flip.
 *
 * The four grammar mechanisms (quarter-opener deliberateness, OREB scramble
 * economy, iso/stepback-three creation, heave discipline; see
 * findings/fdesign-grammar.md) shipped wired-but-STAGED and went live at
 * the FLOW flip at the ffit-grammar doses. These tests do two jobs:
 *
 *  1. Live-shape: each mechanism fires exactly in its designed context and
 *     nowhere else (window gates, identity gates, taxonomy gates).
 *  2. Switch semantics: the pre-flip staged arm stays covered through
 *     explicit overrides (pinned zeros / the legacy heave 1), so the stage
 *     switches cannot silently rot. The old staged-default pins inverted
 *     at the flip (ffit-grammar §5a).
 *
 * decideBall is exercised directly on a hand-built GameState (the softmax
 * consumes rng, so repeated calls sample the decision distribution; forced
 * utilities of ±5 EV make the assertions deterministic at temperature
 * ~0.07; weight ratios of e^68 cannot lose a 60-draw sample).
 */

import { describe, expect, it } from 'vitest';
import {
  NBA, Rng, makeCourt, makePlayer, makeTactics, simulateGame, withParams,
  type Team, type V2
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { decideBall, type BallAction } from '../src/sim/ai/decide.js';
import { decisiveness, openerSet } from '../src/sim/ai/concepts.js';
import { onOrebSecured } from '../src/sim/ai/offense.js';
import { endPeriod, startPossession } from '../src/sim/possession.js';
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
    teamFoulsPeriod: [0, 0], teamFoulsLate: [0, 0], tipWinner: 0,
    endgame: true, timeoutsLeft: [7, 7], runPts: [0, 0],
    timeoutsThisPeriod: [0, 0], timeoutsUsedFinalPeriod: [0, 0],
    timeoutsUsedFinalLate: [0, 0], lastTimeoutT: [-99, -99],
    conceded: [false, false],
    poss: {
      team: 0, shotClock: o.shotClock ?? 20, phase: o.phase ?? 'halfcourt',
      startT, kind: 'inbound', lastPass: null,
      // the M1b marker mirrors what startPossession would have stamped for
      // this startT (default = the period's start, an opener)
      opener: startT === periodStartT(period),
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

describe('concept 9 — opening set (live wiring)', () => {
  const stub = (over: {
    opener?: boolean; phase?: string; params?: ParamOverrides;
  }) => ({
    params: withParams(over.params),
    rules: NBA,
    poss: { phase: over.phase ?? 'halfcourt', opener: over.opener ?? true }
  }) as unknown as GameState;

  const FORCED: ParamOverrides = { ai: { openerShootMalus: 0.4 } };

  it('the live default fires at the fitted dose; a pinned 0 stays exactly zero', () => {
    // ship-at-live pin (re-fit on the post-audit engine: malus 0.55 —
    // refit-g3, opener share 4.2% vs the 6% gate; drive share 0.75)
    const live = openerSet(stub({}), 1);
    expect(live.shoot).toBe(0.55);
    expect(live.drive).toBe(0.55 * 0.75);
    // the stage-switch semantics still hold behind an explicit override
    const pinned = openerSet(stub({ params: { ai: { openerShootMalus: 0 } } }), 1);
    expect(pinned.shoot).toBe(0);
    expect(pinned.drive).toBe(0);
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
    expect(openerSet(stub({ params: FORCED, opener: false }), 1).shoot).toBe(0);
    expect(openerSet(stub({ params: FORCED, phase: 'transition' }), 1).shoot).toBe(0);
  });

  it('the M1b marker is stamped by startPossession: true at the full period clock only', () => {
    // the period-opening dead ball never runs the clock, so the first
    // possession of Q1/Q4/OT starts at the exact full value; any later
    // possession has consumed live ticks
    for (const [period, clock] of [[1, 720], [4, 720], [5, 300]] as const) {
      const { s } = mkState({ period });
      s.period = period;
      s.clock = clock;
      startPossession(s, 0, 'inbound');
      expect(s.poss.opener).toBe(true);
    }
    // one tick of live clock later it is a different possession, even when
    // the opener itself was a single tick long
    const { s } = mkState({});
    s.clock = 719.9;
    startPossession(s, 0, 'inbound');
    expect(s.poss.opener).toBe(false);
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

// ------------------------------- M1a: opener formation re-set (endPeriod)

describe('M1a — opener formation re-set (endPeriod, live wiring)', () => {
  const runEnd = (params?: ParamOverrides): GameState => {
    const { s } = mkState({ params, period: 2 });
    s.clock = 0; // the horn
    endPeriod(s);
    return s;
  };

  it('pinned 0-arm: the break leaves everyone where the horn froze them', () => {
    const s = runEnd({ ai: { openerResetOn: 0 } });
    expect(s.period).toBe(3);
    // mkState parks everyone at intent 'spot'; without the re-set the
    // period break touches no positioning state
    for (const a of s.agents.values()) expect(a.intent).toBe('spot');
  });

  it('live default: the break stages the inbound formation on the post-sub lineup', () => {
    const s = runEnd();
    expect(s.period).toBe(3);
    // setupDeadTargets froze all ten into the walk-to formation
    for (const a of s.agents.values()) expect(a.intent).toBe('freeze');
    // the inbounder's spot: a step in front of his own baseline, off the
    // centerline (the setupDeadTargets handler branch)
    const inbounder = [...s.agents.values()].find(
      (a) => a.target.y === s.court.centerY - 6
    );
    expect(inbounder).toBeDefined();
    expect(inbounder!.side).toBe(1); // Q3 opens with the arrow: other(tipWinner)
  });
});

// ---------------------------------------- M2: OREB scramble economy (concept 10)

describe('concept 10 — scramble economy (live wiring)', () => {
  const N = 40;
  const KICK: ParamOverrides = { ai: { orebKickWindowSec: 4, orebKickBonus: 6 } };

  it('a fresh-rebound holder reaches the kick-out read: pass tagged kickout to the arc', () => {
    const { s } = mkState({ params: KICK, acquiredBy: 'rebound', sinceCatch: 1.0, holderFt: 8 });
    for (const a of sample(s, N)) {
      expect(a.kind).toBe('pass');
      if (a.kind === 'pass') {
        expect(a.passKind).toBe('kickout');
        // both spaced teammates sit behind the arc; the deep-parked pair never wins
        expect(a.toId === 'off-2' || a.toId === 'off-3').toBe(true);
      }
    }
  });

  it('the read dies outside its context: stale touch, non-rebound touch, pinned-zero window', () => {
    const kickKinds = (opts: StateOpts) =>
      sample(mkState(opts).s, N).filter((a) => a.kind === 'pass' && a.passKind === 'kickout').length;
    // grab is older than the read window
    expect(kickKinds({ params: KICK, acquiredBy: 'rebound', sinceCatch: 5, holderFt: 8 })).toBe(0);
    // an ordinary caught pass is not a scramble
    expect(kickKinds({ params: KICK, acquiredBy: 'pass', sinceCatch: 1.0, holderFt: 8 })).toBe(0);
    // window pinned 0 (the pre-flip staged value): context never true even
    // on a fresh grab — the switch semantics
    expect(kickKinds({
      params: { ai: { orebKickWindowSec: 0 } },
      acquiredBy: 'rebound', sinceCatch: 1.0, holderFt: 8
    })).toBe(0);
  });

  it('putback appetite fires on the putback taxonomy (rebound + interior + quick touch)', () => {
    const { s } = mkState({
      params: { ai: { orebPutbackBonus: 6 } },
      acquiredBy: 'rebound', sinceCatch: 0.3, holderFt: 4
    });
    for (const a of sample(s, N)) {
      expect(a.kind).toBe('shoot');
      if (a.kind === 'shoot') expect(a.moveType).toBe('putback');
    }
  });

  it('the putback term keys strictly off the taxonomy: a cut finish is untouched by the bonus', () => {
    // same look, same seed, acquiredBy 'pass' (⇒ cut_finish, not putback):
    // a forced bonus must not perturb a single decision in the sequence
    const seq = (params?: ParamOverrides) =>
      sample(mkState({ params, acquiredBy: 'pass', sinceCatch: 0.3, holderFt: 4, seed: 'putback-gate' }).s, N);
    expect(seq({ ai: { orebPutbackBonus: 6 } })).toEqual(seq());
  });
});

// ----------------------------- M2a: OREB perimeter refill (supply half)

describe('M2a — OREB perimeter refill (live wiring)', () => {
  /** post-OREB scene: the holder just grabbed the board; off-2 is a wing
   *  shooter caught retreating, off-3 sits at his corner spot, off-4 is a
   *  dunker also retreating (never refilled), off-5 has no spot */
  function orebScene(params?: ParamOverrides): { s: GameState; grab: Agent } {
    const { s } = mkState({ params, acquiredBy: 'rebound', sinceCatch: 0.3, holderFt: 4 });
    const a = (id: string): Agent => s.agents.get(id)!;
    s.poss.spots.set('wing_l', { x: s.court.midX, y: 8 });
    s.poss.spots.set('corner_l', { ...a('off-3').pos });
    s.poss.spots.set('dunker', { x: s.court.midX, y: 40 });
    a('off-2').spotKey = 'wing_l';
    a('off-2').intent = 'getback';
    a('off-2').sprinting = false;
    a('off-3').spotKey = 'corner_l'; // already home: within the 8 ft band
    a('off-4').spotKey = 'dunker';
    a('off-4').intent = 'getback';
    return { s, grab: a('off-1') };
  }

  it('forced live: getback arc teammates sprint back to their spots and hold the window', () => {
    const { s, grab } = orebScene({ ai: { orebRefillSec: 1.8 } });
    onOrebSecured(s, grab);
    const wing = s.agents.get('off-2')!;
    expect(wing.intent).toBe('spot');
    expect(wing.sprinting).toBe(true);
    expect(wing.target).toEqual(s.poss.spots.get('wing_l'));
    expect(wing.relocUntil).toBe(s.t + 1.8);
    // a spotted corner body is already a receiver: untouched
    const corner = s.agents.get('off-3')!;
    expect(corner.relocUntil).toBe(-99);
    // the dunker stays in the scrum economy even while retreating
    const dunker = s.agents.get('off-4')!;
    expect(dunker.intent).toBe('getback');
    expect(dunker.relocUntil).toBe(-99);
    // the rebounder himself is never repositioned
    expect(grab.relocUntil).toBe(-99);
  });

  it('pinned 0-arm: the refill touches no positioning state', () => {
    const { s, grab } = orebScene({ ai: { orebRefillSec: 0 } });
    onOrebSecured(s, grab);
    const wing = s.agents.get('off-2')!;
    expect(wing.intent).toBe('getback');
    expect(wing.sprinting).toBe(false);
    expect(wing.relocUntil).toBe(-99);
  });

  it('the tickScramble call site is live: pinning the refill off diverges a full game', () => {
    // pre-flip this proof forced the refill ON against the staged default;
    // with 1.8 the default the same wiring proof runs zero-vs-default
    const { home, away } = sampleMatchup();
    const base = simulateGame({ seed: 'refill-live-0', home, away, collectFrames: false });
    const zeroed = simulateGame({
      seed: 'refill-live-0', home, away, collectFrames: false,
      params: { ai: { orebRefillSec: 0 } }
    });
    expect(JSON.stringify(zeroed.events)).not.toBe(JSON.stringify(base.events));
  });
});

// ------------------------------- M3: halfcourt pull-up three (concept-1 flavor)

describe('concept-1 flavor — drilled halfcourt pull-up three (live wiring)', () => {
  const dstub = (params?: ParamOverrides, phase = 'halfcourt') => ({
    params: withParams(params),
    poss: { phase },
    t: 0
  }) as unknown as GameState;
  const shooter = (pullUp: number, shotThree: number) => ({
    p: { tend: { pullUp, shotThree, shotRim: 50, shotMid: 50 } },
    spotKey: null,
    dribblesSinceCatch: 3
  }) as unknown as Agent;
  const FORCED: ParamOverrides = { ai: { pullUpThreeBonus: 0.5 } };
  const term = (
    s: GameState, h: Agent, distFt = 26, contest = 0.2, move: 'pull_up' | 'catch_shoot' = 'pull_up'
  ) => decisiveness(s, h, move, 'three', distFt, contest, null);

  it('the live default fires in the full trigger context; a pinned 0 stays exactly zero', () => {
    expect(term(dstub(), shooter(75, 75))).toBeGreaterThan(0); // ships at 0.35 (ffit-grammar)
    expect(term(dstub({ ai: { pullUpThreeBonus: 0 } }), shooter(75, 75))).toBe(0);
  });

  it('forced bonus fires in its habitat, wider than the arc catch-shoot gate', () => {
    const t1 = term(dstub(FORCED), shooter(75, 75));
    expect(t1).toBeGreaterThan(0);
    expect(t1).toBeLessThan(0.5);
    // the mid conceded-jumper ceiling (0.65), not the arc gate's 0.5: a
    // defender in the picture at contest 0.5 still concedes the rise
    expect(term(dstub(FORCED), shooter(75, 75), 26, 0.5)).toBeGreaterThan(0);
    expect(term(dstub(FORCED), shooter(75, 75), 26, 0.65)).toBe(0);
    // more openness, bigger green light
    expect(term(dstub(FORCED), shooter(75, 75), 26, 0.1))
      .toBeGreaterThan(term(dstub(FORCED), shooter(75, 75), 26, 0.4));
  });

  it('zero-veto identity gate: either appetite at its floor kills the light entirely', () => {
    expect(term(dstub(FORCED), shooter(25, 75), 26, 0)).toBe(0);
    expect(term(dstub(FORCED), shooter(75, 20), 26, 0)).toBe(0);
  });

  it('the green light stops at the logo bomb and outside the halfcourt', () => {
    expect(term(dstub(FORCED), shooter(75, 75), 29.5)).toBe(0);
    expect(term(dstub(FORCED), shooter(75, 75), 28.5)).toBeGreaterThan(0);
    // advance-phase pull-ups get nothing from this branch
    expect(term(dstub(FORCED, 'advance'), shooter(75, 75))).toBe(0);
  });

  it('no stacking: transition keeps its own term and catch-and-shoot is untouched', () => {
    // in transition the pre-existing branch fires; a forced pull-up-three
    // bonus must not change its value by a single bit
    expect(term(dstub(FORCED, 'transition'), shooter(75, 75)))
      .toBe(term(dstub(undefined, 'transition'), shooter(75, 75)));
    // the arc catch-and-shoot branch is equally untouched
    expect(term(dstub(FORCED), shooter(75, 75), 26, 0.2, 'catch_shoot'))
      .toBe(term(dstub(), shooter(75, 75), 26, 0.2, 'catch_shoot'));
  });

  it('live: a forced bonus makes the self-created three fire in its context, veto holds', () => {
    const N = 40;
    const forced: ParamOverrides = { ai: { pullUpThreeBonus: 6 } };
    // 26 ft, halfcourt, stale touch (pull_up taxonomy), green tendencies
    const green = mkState({
      params: forced, sinceCatch: 2.0, holderFt: 26,
      tend: { pullUp: 75, shotThree: 75 }
    });
    const acts = sample(green.s, N);
    expect(shootCount(acts)).toBe(N);
    for (const a of acts) {
      if (a.kind === 'shoot') expect(a.moveType).toBe('pull_up');
    }
    // same look, no off-dribble game: the veto stands and the shot stays rare
    const veto = mkState({
      params: forced, sinceCatch: 2.0, holderFt: 26,
      tend: { pullUp: 20, shotThree: 75 }
    });
    expect(shootCount(sample(veto.s, N))).toBeLessThan(N / 2);
  });
});

// ------------------------------------- M4: heave discipline (desperation bypass)

describe('heave discipline (live wiring at the desperation bypass)', () => {
  const HEAVE: BallAction = { kind: 'shoot', moveType: 'heave' };
  const FLIPPED: ParamOverrides = { decide: { heaveLaunchChance: 0 } };
  const horn = (over: Partial<StateOpts>) => mkState({
    period: 2, clock: 1.0, shotClock: 24, holderFt: 45, sinceCatch: 2, ...over
  }).s;

  it('flipped: a hopeless Q2-horn heave is held instead of launched (beyond 32 ft)', () => {
    // leading by 5 at a non-final horn: protect the percentages
    expect(decideBall(horn({ params: FLIPPED, score: [55, 50] }))).toEqual({ kind: 'hold' });
    // trailing big at a non-final horn still holds; the heave can't tie it
    expect(decideBall(horn({ params: FLIPPED, score: [42, 50] }))).toEqual({ kind: 'hold' });
    // leading at the final horn holds too: the dribble-out
    expect(decideBall(horn({ params: FLIPPED, period: 4, score: [51, 50] }))).toEqual({ kind: 'hold' });
  });

  it('flipped: the mattering heave still flies (final period/OT, tied or down ≤3)', () => {
    expect(decideBall(horn({ params: FLIPPED, period: 4, score: [50, 50] }))).toEqual(HEAVE);
    expect(decideBall(horn({ params: FLIPPED, period: 4, score: [50, 53] }))).toEqual(HEAVE);
    expect(decideBall(horn({ params: FLIPPED, period: 5, score: [88, 88] }))).toEqual(HEAVE);
    // down 4 is a two-possession game: the heave cannot tie it, so hold
    expect(decideBall(horn({ params: FLIPPED, period: 4, score: [50, 54] }))).toEqual({ kind: 'hold' });
  });

  it('flipped: shot-clock-forced heaves are untouched (a violation is worse)', () => {
    // mid-period, shot clock binding
    expect(decideBall(horn({ params: FLIPPED, clock: 300, shotClock: 0.9, score: [55, 50] }))).toEqual(HEAVE);
    // sc === clock exactly: the shot clock still binds (sc ≤ clock regime)
    expect(decideBall(horn({ params: FLIPPED, clock: 0.9, shotClock: 0.9, score: [55, 50] }))).toEqual(HEAVE);
  });

  it('the pinned legacy arm (chance 1) preserves the always-launch in every period-expiring case', () => {
    // the pre-flip staged default, kept behind an explicit override so the
    // ≥1 draw-free semantics cannot rot; the live 0.06 default's behavior
    // is the discipline pinned above (G6 owns its rate, flowboard)
    const LEGACY: ParamOverrides = { decide: { heaveLaunchChance: 1 } };
    expect(decideBall(horn({ params: LEGACY, score: [55, 50] }))).toEqual(HEAVE);
    expect(decideBall(horn({ params: LEGACY, score: [42, 50] }))).toEqual(HEAVE);
    // the regime-split boundary: sc < 1.2 with the game clock binding
    // (old code's sc-branch, now covered by the period-expiring branch)
    expect(decideBall(horn({ params: LEGACY, clock: 0.5, shotClock: 0.9, score: [70, 50] }))).toEqual(HEAVE);
  });

  it('inside 32 ft the bypass never fires and no heave row is produced', () => {
    const s = horn({ params: FLIPPED, holderFt: 30, score: [55, 50] });
    for (const a of sample(s, 20)) {
      if (a.kind === 'shoot') expect(a.moveType).not.toBe('heave');
    }
  });
});

// ----------------------------------------------------- live-switch pinning

describe('live switches: shape dials now scale live mechanisms', () => {
  it('a full game diverges with shape dials moved — the switches are no longer at rest', () => {
    // the inverse of the pre-flip staged-inert pin (ffit-grammar §5a): with
    // the grammar switches live, every one of these dials is consumed, so
    // moving them must move outcomes
    const run = (params?: ParamOverrides) => {
      const { home, away } = sampleMatchup();
      return simulateGame({ seed: 'grammar-pin-0', home, away, params, collectFrames: false });
    };
    const base = run();
    const moved = run({
      ai: {
        openerScale: 1.31,
        openerDriveShare: 0.9,
        openerRampFloorShare: 0.55,
        scrambleScale: 1.22,
        pullUpThreeMaxFt: 25
      },
      decide: {
        heaveKeepDeficitMax: 10 // read since heaveLaunchChance < 1
      }
    });
    expect(JSON.stringify(moved.events)).not.toBe(JSON.stringify(base.events));
  });
});
