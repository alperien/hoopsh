/**
 * Timeout economy (fdesign-timeouts) — wiring suite, LIVE since the FLOW
 * flip: params.endgame.to* ship at the ffit-timeouts corpus fits, and the
 * flowboard G1 gate owns the behavioral acceptance. The old dormancy pins
 * retired to a fitted-value drift tripwire; every staged/never-fire arm
 * stays covered through explicit withParams overrides (fixtures pin their
 * own dials so they cannot drift with the defaults).
 *
 * Pool thresholds follow the endgame.test.ts doctrine: bars set well under
 * probed values (probes noted inline) so future rng reshuffles survive.
 */

import { describe, expect, it } from 'vitest';
import {
  Rng, defaultParams, simulateGame, withParams,
  type GameEvent, type GameResult, type Player, type Team, type TeamSide, type SimParams
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { decideLiveTimeout, maybeFtTimeout } from '../src/sim/endgame.js';
import { endPeriod } from '../src/sim/possession.js';
import type { Agent, GameState, TimeoutReason } from '../src/sim/state.js';

type TO = Extract<GameEvent, { type: 'timeout' }>;
const timeouts = (r: GameResult): TO[] =>
  r.events.filter((e): e is TO => e.type === 'timeout');
/** forced-live streams carry the STAGED reasons ('mandatory'/'regroup');
 *  the officiating wave converged TimeoutEvent's union with the internal
 *  TimeoutReason (replay v3), so this is now a plain read, kept as a helper
 *  only for the suite's call-site symmetry */
const reasonOf = (e: TO): TimeoutReason => e.reason;

// ---------------------------------------------------------------- the pools

/** the design's mandatory/TV rule + Q4 caps + OT budget, forced live */
const MAND = {
  endgame: {
    toMandatoryFirstBelowSec: 419,
    toMandatorySecondBelowSec: 179,
    toFinalPeriodMaxTimeouts: 4,
    toFinalPeriodLateMaxTimeouts: 2,
    toOvertimeTimeouts: 2
  }
};

/** the coach hazard + live-ball site forced live (legacy trigger retired via
 *  999, the flip shape, so every stop_run/regroup below is hazard-drawn) */
const HAZ = {
  endgame: {
    ...MAND.endgame,
    timeoutRunPts: 999,
    toCoachBasePerDead: 0.04,
    toCoachRunW: 0.13,
    toCoachTrailW: 0.03,
    toBurnBoost: 0.1,
    toLiveSiteOn: 1
  }
};

function pool(n: number, prefix: string, params?: object, endgame?: boolean): GameResult[] {
  const out: GameResult[] = [];
  for (let i = 0; i < n; i++) {
    const { home, away } = sampleMatchup();
    const flip = i % 2 === 1;
    out.push(simulateGame({
      seed: `${prefix}-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false,
      ...(params ? { params } : {}),
      ...(endgame === undefined ? {} : { endgame })
    }));
  }
  return out;
}

const mand = pool(8, 'to-mand', MAND);
const haz = pool(6, 'to-hz', HAZ);

describe('mandatory / TV stoppages (forced live)', () => {
  it('every regulation quarter has >= 2 timeouts (Q4 >= 1 under the caps)', () => {
    // the 2-per-quarter mandatory rule is a near-hard floor in the corpus
    // (0/736 real quarters have zero, 2/736 have one). Probed on this pool:
    // min per game-quarter exactly 2 everywhere; Q4 asserted >= 1 only, per
    // the spec's cap-fallback caveat (charging can be skipped when neither
    // side can pay under the live 4/2 caps).
    for (const r of mand) {
      const q = [0, 0, 0, 0];
      for (const e of timeouts(r)) if (e.period <= 4) q[e.period - 1] = (q[e.period - 1] ?? 0) + 1;
      expect(q[0]!).toBeGreaterThanOrEqual(2);
      expect(q[1]!).toBeGreaterThanOrEqual(2);
      expect(q[2]!).toBeGreaterThanOrEqual(2);
      expect(q[3]!).toBeGreaterThanOrEqual(1);
    }
  });

  it('charging convention: first anchor to the home side, second to the side not yet charged', () => {
    let firstAnchors = 0;
    let secondAnchors = 0;
    for (const r of mand) {
      const usedTotal: [number, number] = [0, 0];
      let period = 0;
      let perPeriod: [number, number] = [0, 0];
      for (const e of timeouts(r)) {
        if (e.period !== period) { period = e.period; perPeriod = [0, 0]; }
        const total = perPeriod[0] + perPeriod[1];
        // convention asserted in Q1-Q3 (no caps) while the target has budget
        if (reasonOf(e) === 'mandatory' && e.period <= 3) {
          if (total === 0 && usedTotal[0] < r.rules.timeoutsPerGame) {
            firstAnchors += 1;
            expect(e.team).toBe(0); // charged to home by rule
            expect(e.clock).toBeLessThanOrEqual(419);
          } else if (total === 1) {
            const owed: TeamSide = perPeriod[0] === 0 ? 0 : 1;
            if (usedTotal[owed] < r.rules.timeoutsPerGame) {
              secondAnchors += 1;
              expect(e.team).toBe(owed);
              expect(e.clock).toBeLessThanOrEqual(179);
            }
          }
        }
        // no mandatory in OT: the rule has no OT anchor (corpus n=4 periods)
        if (e.period > 4) expect(e.reason).not.toBe('mandatory');
        perPeriod[e.team] += 1;
        usedTotal[e.team] += 1;
      }
    }
    // vacuity guard (probed: 58 mandatory timeouts across the pool)
    expect(firstAnchors).toBeGreaterThanOrEqual(8);
    expect(secondAnchors).toBeGreaterThanOrEqual(8);
  });

  it('budget arithmetic: remaining counts down from the rulepack budget; OT replaces it', () => {
    for (const r of mand) {
      const used: [number, number] = [0, 0];
      let otUsed: [number, number] = [0, 0];
      let otPeriod = 0;
      for (const e of timeouts(r)) {
        expect(e.remaining).toBeGreaterThanOrEqual(0);
        if (e.period <= 4) {
          used[e.team] += 1;
          expect(e.remaining).toBe(r.rules.timeoutsPerGame - used[e.team]);
        } else {
          // per-OT replacement budget (toOvertimeTimeouts 2, forced live)
          if (e.period !== otPeriod) { otPeriod = e.period; otUsed = [0, 0]; }
          otUsed[e.team] += 1;
          expect(e.remaining).toBe(2 - otUsed[e.team]);
        }
      }
    }
  });

  it('one timeout per stoppage: a play event always intervenes between two timeouts', () => {
    for (const r of [...mand, ...haz]) {
      let sinceLast = -1; // -1: no timeout seen yet
      for (const e of r.events) {
        if (e.type === 'timeout') {
          expect(sinceLast).not.toBe(0);
          sinceLast = 0;
        } else if (e.type !== 'substitution' && sinceLast === 0) {
          sinceLast = 1; // a play event closed the stoppage window
        }
      }
    }
  });

  it('two-axes discipline: the huddle consumes wall time, never game clock', () => {
    // for every timeout whose stoppage starts a new possession, the
    // possession_start carries the same game-clock t (frozen huddle) and a
    // wall-clock wt at least timeoutResumeSec later (continuation stoppages
    // have no possession_start and are covered by the live-site suite below)
    let checked = 0;
    for (const r of mand) {
      const ev = r.events;
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i]!;
        if (e.type !== 'timeout') continue;
        for (let j = i + 1; j < ev.length; j++) {
          const n = ev[j]!;
          if (n.type === 'substitution') continue;
          if (n.type === 'possession_start') {
            checked += 1;
            expect(n.t).toBe(e.t);
            // resumeIn stretches to timeoutResumeSec (8 wall-seconds); one
            // tick of slack for the countdown granularity
            expect(n.wt - e.wt).toBeGreaterThanOrEqual(defaultParams.endgame.timeoutResumeSec - 0.2);
          }
          break; // any other play event: a continuation stoppage; skip
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(30); // probed: nearly all of ~76 timeouts
  });

  it('the Q4 late cap really blocks spending (0-cap arm) while Q1-Q3 are untouched', () => {
    // control (late cap 2) vs treatment (late cap 0) on the same seeds.
    // Probed: control shows 2 late-Q4 timeouts per game, treatment 0
    for (const i of [0, 1]) {
      const { home, away } = sampleMatchup();
      const mk = (late: number): GameResult => simulateGame({
        seed: `to-cap-${i}`, home, away, collectFrames: false,
        params: { endgame: { ...MAND.endgame, toFinalPeriodLateMaxTimeouts: late } }
      });
      const late = (r: GameResult): number =>
        timeouts(r).filter((e) => e.period === 4 && e.clock <= 180).length;
      const ctl = mk(2);
      const cap = mk(0);
      expect(late(ctl)).toBeGreaterThanOrEqual(1); // vacuity guard
      expect(late(cap)).toBe(0);
      // the cap is a Q4 rule, not a game-wide brake
      expect(timeouts(cap).filter((e) => e.period <= 3).length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('coach voluntary hazard, game-wide (forced live)', () => {
  it('voluntary timeouts exist outside the endgame (the game-wide grammar)', () => {
    // probed: 46 hazard timeouts across periods 1-3 in this pool
    let early = 0;
    for (const r of haz) {
      for (const e of timeouts(r)) {
        const reason = reasonOf(e);
        if (e.period <= 3 && (reason === 'stop_run' || reason === 'regroup')) early += 1;
      }
    }
    expect(early).toBeGreaterThanOrEqual(8);
  });

  it('hazard gates hold: quiet window, hold-for-one, per-team cooldown', () => {
    for (const r of haz) {
      const lastT: [number, number] = [-999, -999];
      for (const e of timeouts(r)) {
        const reason = reasonOf(e);
        const hazardFired = reason === 'stop_run' || reason === 'regroup';
        if (hazardFired) {
          // no voluntary call in a period's first toQuarterOpenQuietSec
          const periodLen = e.period <= 4 ? 720 : 300;
          expect(periodLen - e.clock).toBeGreaterThanOrEqual(60 - 0.01);
          // a non-final period's last possession is sacred
          if (e.period <= 3) expect(e.clock).toBeGreaterThan(26 - 0.01);
          // cooldown vs the team's previous timeout of any reason (that is
          // what lastTimeoutT stamps); mandatory/advance stay exempt
          expect(e.t - lastT[e.team]).toBeGreaterThanOrEqual(120 - 0.02);
        }
        lastT[e.team] = e.t;
      }
    }
  });

  it('live-ball site: timeouts ride defensive rebounds/steals with the possession retained', () => {
    let liveSite = 0;
    for (const r of haz) {
      const ev = r.events;
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i]!;
        if (e.type !== 'timeout') continue;
        let j = i - 1;
        while (j >= 0 && ev[j]!.type === 'substitution') j -= 1;
        const prev = ev[j]!;
        if (prev.type !== 'possession_start') continue;
        if (prev.kind !== 'live_rebound' && prev.kind !== 'steal') continue;
        liveSite += 1;
        // the grab and the whistle share the frozen instant
        expect(e.t).toBe(prev.t);
        // possession retained through the stoppage: no new possession_start
        // before this possession ends, and it ends for the same team
        for (let k = i + 1; k < ev.length; k++) {
          const n = ev[k]!;
          if (n.type === 'possession_start') {
            expect(false).toBeTruthy(); // a fresh possession before the end = retention broken
            break;
          }
          if (n.type === 'possession_end') {
            expect(n.team).toBe(prev.team);
            break;
          }
        }
      }
    }
    expect(liveSite).toBeGreaterThanOrEqual(3); // probed: 17 across the pool
  });

  it('advance still belongs to a trailing team only, wherever it fires', () => {
    let advances = 0;
    for (const r of [...haz, ...mand]) {
      for (const e of timeouts(r)) {
        if (e.reason !== 'advance') continue;
        advances += 1;
        expect(e.score[e.team] - e.score[e.team === 0 ? 1 : 0]).toBeLessThan(0);
      }
    }
    expect(advances).toBeGreaterThanOrEqual(1); // probed: 9 across both pools
  });

  it('the forced-live path is deterministic per seed', () => {
    const { home, away } = sampleMatchup();
    const a = simulateGame({ seed: 'to-hz-0', home, away, collectFrames: false, params: HAZ });
    const b = simulateGame({ seed: 'to-hz-0', home, away, collectFrames: false, params: HAZ });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});

// -------------------------------------------------- unit pins (direct calls)

function mkAgent(p: Player, side: TeamSide, onCourt: boolean): Agent {
  return {
    p, side,
    pos: { x: 47, y: 25 }, vel: { x: 0, y: 0 },
    energy: 80, load: 0, secondsPlayed: 0, fouls: 0,
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

/** minimal live-decision state: exactly what decideLiveTimeout reads */
function liveState(params: SimParams, o: {
  period: number; clock: number; score: [number, number];
  t?: number; lastTimeoutT?: [number, number]; runPts?: [number, number];
}): GameState {
  return {
    params,
    rules: { periods: 4, periodMinutes: 12, otMinutes: 5 },
    period: o.period,
    clock: o.clock,
    score: o.score,
    t: o.t ?? 600,
    rng: new Rng('to-unit'),
    timeoutsLeft: [4, 4],
    timeoutsThisPeriod: [0, 0],
    timeoutsUsedFinalPeriod: [0, 0],
    timeoutsUsedFinalLate: [0, 0],
    lastTimeoutT: o.lastTimeoutT ?? [-99, -99],
    runPts: o.runPts ?? [0, 0]
  } as unknown as GameState;
}

/** hazard forced certain: every gate that passes must produce a call.
 *  Mandatory anchors pinned OFF (they ship live since the flip and would
 *  pre-empt the hazard at the FT site — the f-assembly §4a re-pin). */
const CERTAIN = withParams({
  endgame: {
    toCoachBasePerDead: 1, toCoachMaxP: 1,
    toMandatoryFirstBelowSec: -1, toMandatorySecondBelowSec: -1
  }
});

describe('decision units (hand-built states)', () => {
  it('the live-site advance: trailing, final period, inside the window, game alive', () => {
    // hazard magnitudes pinned 0 so the leader leg tests the advance gate,
    // not a live-hazard draw (defaults carry the fitted hazard since the flip)
    const ZEROS = withParams({
      endgame: { toCoachBasePerDead: 0, toCoachRunW: 0, toCoachTrailW: 0, toBurnBoost: 0 }
    });
    const s = liveState(ZEROS, { period: 4, clock: 20, score: [80, 84] });
    expect(decideLiveTimeout(s, 0)).toEqual({ team: 0, reason: 'advance' });
    // the leading side gets no advance (and, at the pinned zero hazard
    // magnitudes, no voluntary either: the stage-switch semantics)
    expect(decideLiveTimeout(s, 1)).toBe(null);
  });

  it('pinned-zero magnitudes decide null WITHOUT consuming rng (the fingerprint switch)', () => {
    // the pre-flip staged arm, kept behind an explicit override: p === 0
    // must return before any draw
    const ZEROS = withParams({
      endgame: { toCoachBasePerDead: 0, toCoachRunW: 0, toCoachTrailW: 0, toBurnBoost: 0 }
    });
    const s = liveState(ZEROS, { period: 2, clock: 400, score: [50, 55] });
    const before = s.rng.chance(0.5); // advance the stream once, deterministically
    const t = liveState(ZEROS, { period: 2, clock: 400, score: [50, 55] });
    t.rng.chance(0.5);
    expect(decideLiveTimeout(s, 0)).toBe(null);
    // identical next draw on both streams proves decideLiveTimeout drew nothing
    expect(s.rng.chance(0.5)).toBe(t.rng.chance(0.5));
    expect(typeof before).toBe('boolean');
  });

  it('quiet window: no voluntary call in a period-opening minute', () => {
    const early = liveState(CERTAIN, { period: 1, clock: 665, score: [10, 10], t: 55 });
    expect(decideLiveTimeout(early, 0)).toBe(null); // elapsed 55 < 60
    const later = liveState(CERTAIN, { period: 1, clock: 600, score: [10, 10], t: 120 });
    expect(decideLiveTimeout(later, 0)).toEqual({ team: 0, reason: 'regroup' });
  });

  it("hold-for-one: a non-final period's last possession is never interrupted", () => {
    const s = liveState(CERTAIN, { period: 2, clock: 20, score: [40, 40] });
    expect(decideLiveTimeout(s, 0)).toBe(null);
    // the same clock in the final period is live coaching territory (leader
    // regroups; the advance-reserve keeps the trailing side quiet)
    const q4 = liveState(CERTAIN, { period: 4, clock: 20, score: [44, 40] });
    expect(decideLiveTimeout(q4, 0)).toEqual({ team: 0, reason: 'regroup' });
  });

  it('cooldown: a team cannot machine-gun voluntary timeouts', () => {
    const hot = liveState(CERTAIN, { period: 2, clock: 400, score: [40, 40], t: 900, lastTimeoutT: [790, -99] });
    expect(decideLiveTimeout(hot, 0)).toBe(null); // 110s since the last, inside 120
    const cooled = liveState(CERTAIN, { period: 2, clock: 400, score: [40, 40], t: 900, lastTimeoutT: [780, -99] });
    expect(decideLiveTimeout(cooled, 0)).toEqual({ team: 0, reason: 'regroup' });
  });

  it('the stop-run label rides the opponent run size', () => {
    const run = liveState(CERTAIN, { period: 2, clock: 400, score: [40, 48], runPts: [0, 8] });
    expect(decideLiveTimeout(run, 0)).toEqual({ team: 0, reason: 'stop_run' });
  });
});

// ------------------------------------------- the FT-whistle site (fouls.ts)

describe('FT-whistle timeout site (fdesign-timeouts §1.2.2)', () => {
  /** a freethrows-phase state on top of the liveState skeleton */
  function ftState(params: SimParams, o: {
    period: number; clock: number; score: [number, number];
    t?: number; side?: TeamSide; runPts?: [number, number];
  }): GameState {
    const s = liveState(params, o);
    (s as { endgame: boolean }).endgame = true;
    (s as { events: unknown[] }).events = [];
    (s as { wallT: number }).wallT = s.t;
    s.phase = {
      kind: 'freethrows', shooterId: 'ft-shooter', side: o.side ?? 0,
      taken: 0, of: 2, nextIn: 1.4, lastMade: false, oneAndOne: false
    } as GameState['phase'];
    return s;
  }

  it('pinned staged overrides decide null WITHOUT consuming rng (the fingerprint switch)', () => {
    // the pre-flip staged arm behind explicit overrides: mandatory off,
    // hazard magnitudes 0 — the site must return before any draw
    const STAGED = withParams({
      endgame: {
        toMandatoryFirstBelowSec: -1, toMandatorySecondBelowSec: -1,
        toCoachBasePerDead: 0, toCoachRunW: 0, toCoachTrailW: 0, toBurnBoost: 0
      }
    });
    const s = ftState(STAGED, { period: 2, clock: 400, score: [50, 55] });
    const t = ftState(STAGED, { period: 2, clock: 400, score: [50, 55] });
    s.rng.chance(0.5);
    t.rng.chance(0.5);
    maybeFtTimeout(s);
    expect(s.events.length).toBe(0);
    // identical next draw on both streams proves the site drew nothing
    expect(s.rng.chance(0.5)).toBe(t.rng.chance(0.5));
  });

  it('a forced-certain hazard calls time for the shooting team: freethrows-branch effects', () => {
    const s = ftState(CERTAIN, { period: 2, clock: 400, score: [50, 55], side: 1 });
    maybeFtTimeout(s);
    const ev = s.events as { type: string; team: TeamSide; reason: TimeoutReason }[];
    expect(ev.length).toBe(1);
    expect(ev[0]!.type).toBe('timeout');
    expect(ev[0]!.team).toBe(1); // the shooter's team holds the ball at the line
    const ph = s.phase as Extract<GameState['phase'], { kind: 'freethrows' }>;
    // wall-time huddle: nextIn stretched, phase stamped for the sub handshake
    expect(ph.timeout).toEqual({ team: 1, reason: ev[0]!.reason });
    expect(ph.nextIn).toBeGreaterThanOrEqual(defaultParams.endgame.timeoutResumeSec);
    expect(s.timeoutsLeft[1]).toBe(3);
  });

  it('the mandatory anchor rides the whistle (forced live), charged by convention', () => {
    const s = ftState(withParams(MAND), { period: 1, clock: 300, score: [20, 22] });
    maybeFtTimeout(s);
    const ev = s.events as { type: string; team: TeamSide; reason: TimeoutReason }[];
    expect(ev.length).toBe(1);
    expect(ev[0]!.reason).toBe('mandatory');
    expect(ev[0]!.team).toBe(0); // first anchor charged to the home side
  });

  it('no advance from the line (a whistle is not an inbound)', () => {
    // trailing, final period, inside the advance window: at a dead-ball
    // inbound this is a deterministic advance; at the line the reserve
    // gate holds instead (advanceWindow && margin <= 0 blocks voluntary)
    const s = ftState(CERTAIN, { period: 4, clock: 20, score: [80, 84] });
    maybeFtTimeout(s);
    expect(s.events.length).toBe(0);
  });

  it('forced-live pool: timeouts land on foul whistles, logged before the FTs', () => {
    // the corpus grammar the site exists for (17.5% of real timeouts;
    // madeFT-preceded skew 13.7% vs real 4.4% without it). Scan: a timeout
    // whose preceding non-sub event is the foul and whose next non-sub
    // event is a free_throw row.
    let onWhistle = 0;
    for (const r of haz) {
      const ev = r.events;
      for (let k = 0; k < ev.length; k++) {
        if (ev[k]!.type !== 'timeout') continue;
        let j = k - 1;
        while (j >= 0 && ev[j]!.type === 'substitution') j -= 1;
        let m = k + 1;
        while (m < ev.length && ev[m]!.type === 'substitution') m += 1;
        if (j >= 0 && m < ev.length && ev[j]!.type === 'foul' && ev[m]!.type === 'free_throw') {
          onWhistle += 1;
        }
      }
    }
    // probed 6 across the 6-game pool (1 of them a mandatory anchor);
    // floor set well under per the suite doctrine
    expect(onWhistle).toBeGreaterThanOrEqual(2);
  });
});

describe('endPeriod bookkeeping (hand-built state)', () => {
  function periodState(params: SimParams, o: { period: number; score: [number, number] }): GameState {
    const { home, away } = sampleMatchup();
    const agents = new Map<string, Agent>();
    const add = (team: Team, side: TeamSide): void => {
      const starters = new Set(team.starters);
      for (const p of team.players) agents.set(p.id, mkAgent(p, side, starters.has(p.id)));
    };
    add(home, 0);
    add(away, 1);
    return {
      params,
      rules: {
        periods: 4, periodMinutes: 12, otMinutes: 5, shotClockSec: 24,
        teamFoulsCarryToOT: false, timeoutsPerGame: 7
      },
      period: o.period,
      clock: 0,
      t: o.period * 720,
      wallT: o.period * 720,
      score: o.score,
      teamFoulsPeriod: [2, 3],
      tipWinner: 0,
      endgame: true,
      timeoutsLeft: [4, 1],
      runPts: [0, 0],
      timeoutsThisPeriod: [1, 1],
      timeoutsUsedFinalPeriod: [1, 0],
      timeoutsUsedFinalLate: [1, 0],
      lastTimeoutT: [100, 200],
      conceded: [false, false],
      teams: [home, away],
      agents,
      lineup: [[...home.starters], [...away.starters]],
      rng: new Rng('to-ot-unit'),
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

  // fixture params: these minimal states carry no court, and endPeriod at
  // the live ai.openerResetOn 1 routes into setupDeadTargets, which reads
  // s.court.rims (the possession.ts trap comment; f-assembly §4b) — pin the
  // re-set off, it is orthogonal to timeout bookkeeping
  const NO_RESET = { ai: { openerResetOn: 0 } };

  it('per-period timeout counters reset unconditionally; regulation keeps the budget remainder', () => {
    const s = periodState(withParams({ ...MAND, ...NO_RESET }), { period: 2, score: [50, 48] });
    endPeriod(s);
    expect(s.period).toBe(3);
    expect(s.timeoutsThisPeriod).toEqual([0, 0]);
    expect(s.timeoutsUsedFinalPeriod).toEqual([0, 0]);
    expect(s.timeoutsUsedFinalLate).toEqual([0, 0]);
    expect(s.timeoutsLeft).toEqual([4, 1]); // untouched, no OT replacement
  });

  it('entering OT REPLACES the remainder with the per-OT budget (the live default)', () => {
    const s = periodState(withParams({ ...MAND, ...NO_RESET }), { period: 4, score: [90, 90] });
    endPeriod(s);
    expect(s.period).toBe(5);
    expect(s.timeoutsLeft).toEqual([2, 2]);
  });

  it('at a pinned −1 the OT budget keeps the remainder (the stage-switch semantics)', () => {
    const s = periodState(
      withParams({ endgame: { toOvertimeTimeouts: -1 }, ...NO_RESET }),
      { period: 4, score: [90, 90] }
    );
    endPeriod(s);
    expect(s.period).toBe(5);
    expect(s.timeoutsLeft).toEqual([4, 1]);
  });
});

// ---------------------------------------------------------- fitted-value pins

describe('fitted defaults (ffit-timeouts) — drift tripwire', () => {
  // the dormancy pins retired at the FLOW flip; this is their replacement:
  // a tripwire on the corpus-fitted values (flowboard G1 owns the
  // behavioral acceptance) so a silent default edit cannot slip through
  it('the timeout economy ships at the ffit-timeouts corpus fits', () => {
    const E = defaultParams.endgame;
    expect(E.toCoachBasePerDead).toBe(0.02);
    expect(E.toCoachRunW).toBe(0.195);
    expect(E.toCoachTrailW).toBe(0.03);
    expect(E.toBurnBoost).toBe(0.13);
    expect(E.toMandatoryFirstBelowSec).toBe(419);
    expect(E.toMandatorySecondBelowSec).toBe(179);
    expect(E.toFinalPeriodMaxTimeouts).toBe(4);
    expect(E.toFinalPeriodLateMaxTimeouts).toBe(2);
    expect(E.toOvertimeTimeouts).toBe(2);
    expect(E.toLiveSiteOn).toBe(1);
    expect(E.timeoutRunPts).toBe(999); // legacy trigger retired in place (never fires)
  });

  it('flag OFF stays the byte-identical legacy path even with every switch forced live', () => {
    // all new upkeep is rng-free and every decision path is flag-gated: an
    // endgame:false game must not care what the timeout params say
    for (const i of [0, 1]) {
      const { home, away } = sampleMatchup();
      const base = simulateGame({
        seed: `to-off-${i}`, home, away, collectFrames: false, endgame: false
      });
      const forced = simulateGame({
        seed: `to-off-${i}`, home, away, collectFrames: false, endgame: false, params: HAZ
      });
      expect(timeouts(base).length).toBe(0);
      expect(timeouts(forced).length).toBe(0);
      expect(JSON.stringify(forced.events)).toBe(JSON.stringify(base.events));
    }
  });

  it('a default-config stream carries the live timeout vocabulary', () => {
    // the legacy-reasons pin, inverted at the flip: mandatory anchors are a
    // deterministic rule, so every default game carries at least one, and
    // every reason sits inside the full TimeoutReason union
    const { home, away } = sampleMatchup();
    const r = simulateGame({ seed: 'to-default-0', home, away, collectFrames: false });
    const reasons = timeouts(r).map((e) => e.reason);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(['stop_run', 'advance', 'mandatory', 'regroup']).toContain(reason);
    }
    expect(reasons).toContain('mandatory');
  });
});
