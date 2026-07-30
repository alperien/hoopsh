/**
 * Mutation shields (audit Section 5): behavioral pins for three mechanics
 * the release audit PROVED unprotected — each of these survived a
 * behavior-deleting mutation with the whole suite green. Every describe
 * below states its mutant and was verified red against it before landing.
 *
 *  - M-46 / mutation M11: the offensive-rebound 14-second shot-clock floor
 *    (possession.ts, rules.shotClockOffRebSec) — a full-reset mutant
 *    (fresh 24 after every OREB) and a floor-deletion mutant both ran the
 *    old suite green. Includes the sibling side-out floors (team-rebound
 *    side-out, non-bonus loose-ball/reach continuations).
 *  - M-20 / mutation M18: the final-2:00 made-basket clock stop
 *    (shooting.ts lastTwoMin) — deleting the stop ran green.
 *  - M-19 / mutation M14: endgame.foulMaxDeficit, the "down 13+ it's over,
 *    stop fouling" ceiling (endgame.ts foulHuntSide) — deleting the
 *    ceiling ran green.
 *
 * THRESHOLD PROVENANCE: every bar below was measured on this exact pinned
 * pool (seeds mshield-0..15, n=16, default config) at HEAD and under the
 * re-applied mutant before being set — measured values are quoted at each
 * assertion, bars sit well clear on both sides (endgame.test.ts doctrine:
 * survive rng reshuffles, still catch the behavior deletion).
 */

import { describe, expect, it } from 'vitest';
import { defaultParams, simulateGame, type GameEvent, type GameResult } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { foulHuntSide } from '../src/sim/endgame.js';
import type { GameState } from '../src/sim/state.js';

const GAMES = 16;

// one shared default-config pool — sim once, assert many (invariants-suite
// pattern). Default config: endgame ON, NBA pack (24s clock / 14s reset).
const pool: GameResult[] = [];
for (let i = 0; i < GAMES; i++) {
  const { home, away } = sampleMatchup();
  const flip = i % 2 === 1;
  pool.push(simulateGame({
    seed: `mshield-${i}`,
    home: flip ? away : home,
    away: flip ? home : away,
    collectFrames: false
  }));
}

/** margin for `side` at an event (score is stamped AFTER the event) */
const marginAt = (e: GameEvent, side: 0 | 1): number =>
  e.score[side] - e.score[side === 0 ? 1 : 0];

describe('M-46: post-OREB shot clock resets to the 14s floor, not a fresh 24', () => {
  // The shot clock is not in the event stream, so the pin reconstructs a
  // conservative UPPER bound on the legal budget from event times and
  // checks every observed consumption against it:
  //
  //   possession_start: budget = 24.
  //   reset point (offensive rebound, or a non-bonus foul side-out):
  //     remainingUpper = budget − max(0, elapsed − FROZEN_ALLOW)
  //     budget = max(remainingUpper, 14)   ← the rule under test
  //   check point (shot / turnover): elapsed since last reset must be
  //     ≤ budget + END_SLOP.
  //
  // The two allowances make the bound safely one-sided (never a false red):
  // FROZEN_ALLOW covers time the game clock runs but the shot clock is
  // FROZEN (a released shot's flight plus the rebound scramble window —
  // game.ts only decrements the shot clock on live/pass-flight ticks), so
  // remainingUpper always ≥ the engine's true remaining. END_SLOP covers
  // the terminating event stamping ball ARRIVAL, not release (shot flight),
  // plus tick granularity. Free-throw flows reshape possession timing, so
  // accounting abandons a possession at the first free_throw (conservative:
  // fewer checks, never a wrong one).
  //
  // Measured on this pool: max observed consumption sits 2.0s BELOW the
  // bound (maxOver −2.0 at END_SLOP 3.0); the full-reset mutant produces 27
  // violations reaching 7.6s over. The floor-EXISTENCE counters below pin
  // the other direction (floor deleted → offense never outruns its carried
  // remainder): late resets (remainingUpper < 11) whose post-reset
  // consumption exceeds that remainder by > 2s can only exist because the
  // floor granted time.
  const FROZEN_ALLOW = 2.5; // max shot flight + scramble resolve window, seconds
  const END_SLOP = 3.0;     // arrival-vs-release stamp + tick granularity, seconds
  const FULL = 24;          // NBA shotClockSec — the pool is default-config NBA
  const FLOOR = 14;         // NBA shotClockOffRebSec

  let checks = 0;
  let ceilingViolations = 0;
  let lateResets = 0;
  let playerOrebGrants = 0; // the mutation-M11 site (possession.ts player OREB)
  let sideOutGrants = 0;    // team-rebound side-out + non-bonus foul continuations

  for (const r of pool) {
    const evs = r.events;
    for (let i = 0; i < evs.length; i++) {
      if (evs[i]!.type !== 'possession_start') continue;
      let resetT = evs[i]!.t;
      let budget = FULL;
      let lastRemaining = FULL;
      let lastWasLate = false;
      let lastKind: 'playerOreb' | 'sideOut' = 'playerOreb';
      for (let j = i + 1; j < evs.length; j++) {
        const e = evs[j]!;
        if (e.type === 'possession_end') break;
        if (e.type === 'free_throw') break; // abandon: FT flow reshapes the clock
        const elapsed = e.t - resetT;
        if (e.type === 'shot' || e.type === 'turnover') {
          checks++;
          if (elapsed > budget + END_SLOP) ceilingViolations++;
          if (lastWasLate && elapsed > lastRemaining + 2.0) {
            if (lastKind === 'playerOreb') playerOrebGrants++;
            else sideOutGrants++;
            lastWasLate = false; // count each granted reset once
          }
        }
        const orebReset = e.type === 'rebound' && e.offensive;
        // a foul with no free throws = non-bonus side-out continuation
        // (loose-ball in the scramble, reach-in on the holder): same
        // max(remaining, 14) floor as the OREB reset
        const foulReset = e.type === 'foul' && evs[j + 1]?.type !== 'free_throw';
        if (orebReset || foulReset) {
          const remainingUpper = budget - Math.max(0, elapsed - FROZEN_ALLOW);
          lastRemaining = Math.max(0, remainingUpper);
          lastWasLate = remainingUpper < 11;
          if (lastWasLate) lateResets++;
          lastKind = orebReset && e.player ? 'playerOreb' : 'sideOut';
          // Foul resets budget FULL: L-11 (this audit wave) grants backcourt
          // retention fouls a fresh 24, frontcourt max(remaining, 14) — FULL
          // is the sound ceiling for both. OREB resets keep the 14-s floor
          // budget, so the fresh-24 OREB mutant stays lethal below.
          budget = foulReset ? FULL : Math.max(remainingUpper, FLOOR);
          resetT = e.t;
        }
      }
    }
  }

  it('the accounting sees a real sample (checks and late resets exist)', () => {
    // measured: 3385 checks, 143 late resets — bars at well under half
    expect(checks).toBeGreaterThanOrEqual(1500);
    expect(lateResets).toBeGreaterThanOrEqual(40);
  });

  it('no possession ever outruns the max(remaining, 14) budget (full-reset mutant fails here)', () => {
    // measured: 0 at HEAD with 2.0s of slack in hand; 27 violations (up to
    // 7.6s over) under the fresh-24 mutant re-applied at the OREB site
    expect(ceilingViolations).toBe(0);
  });

  it('the OREB floor GRANTS time: late offensive boards run past their carried remainder (floor-deletion mutant fails here)', () => {
    // measured: 16 player-OREB grants at HEAD; 0 with the floor deleted
    expect(playerOrebGrants).toBeGreaterThanOrEqual(4);
  });

  it('the side-out floors grant time too (team-rebound and non-bonus foul continuations)', () => {
    // measured: 10 side-out grants at HEAD (2 team-rebound + 8 foul
    // continuations); 0 with the three side-out floor sites deleted
    expect(sideOutGrants).toBeGreaterThanOrEqual(2);
  });
});

describe('M-20: a made basket inside 2:00 of the final period stops the game clock', () => {
  // NBA rule: the clock stops on made field goals in the last two minutes
  // of the fourth period and OT (shooting.ts lastTwoMin → clockRuns:
  // false). Outside that window a made basket keeps the clock RUNNING
  // through the inbound — so the pin is window-conditioned, and the
  // documented Q1-Q3 last-minute gap (audit M-47) is deliberately NOT
  // gated here.
  it('the clock is unchanged from the made shot to the opponent inbound (clock-run mutant fails here)', () => {
    let qualifying = 0;
    let maxDrop = 0;
    for (const r of pool) {
      const evs = r.events;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i]!;
        if (
          e.type !== 'shot' || !e.made || e.foul || // and-ones resolve via the FT flow
          e.period < r.rules.periods || e.clock > 120 ||
          e.clock < 0.2 // at ~0:00 the horn path owns the event order
        ) continue;
        // the next possession_start in the same period is the opponent's
        // inbound after the dead ball; timeouts/subs between them never run
        // the clock (both live inside the same stoppage)
        for (let j = i + 1; j < evs.length; j++) {
          const n = evs[j]!;
          if (n.type === 'possession_start') {
            if (n.period === e.period) {
              qualifying++;
              maxDrop = Math.max(maxDrop, e.clock - n.clock);
            }
            break;
          }
          if (n.type === 'period_end' || n.type === 'game_end') break;
        }
      }
    }
    // measured: 62 qualifying made FGs on this pool, max drop 0.000s;
    // the clock-run mutant (clockRuns: true) drops 2.2s on every one
    expect(qualifying).toBeGreaterThanOrEqual(15);
    expect(maxDrop).toBeLessThanOrEqual(0.05);
  });
});

describe('M-19: foulMaxDeficit — a team down 13+ has stopped hunting fouls', () => {
  // foulHuntSide reads exactly: endgame, period, rules.periods/shotClockSec,
  // poss.team/shotClock, score, clock, params.endgame — a hand-built state
  // suffices (concede.test.ts pattern). Defaults: foulMinDeficit 3,
  // foulMaxDeficit 12, foulTrailMaxClockSec 35, foulMinShotClock 5.
  const huntState = (o: { deficit: number; clock?: number; shotClock?: number; endgame?: boolean }): GameState =>
    ({
      endgame: o.endgame ?? true,
      period: 4,
      rules: { periods: 4, shotClockSec: 24 },
      poss: { team: 0, shotClock: o.shotClock ?? 20 },
      // side 0 (the offense) leads by the deficit; side 1 is the candidate hunter
      score: [90, 90 - o.deficit],
      clock: o.clock ?? 30,
      params: defaultParams // read-only in foulHuntSide — sharing the object is safe
    } as unknown as GameState);

  it('inside the window (down 3-12, late, ALIVE) the trailing defense hunts', () => {
    expect(foulHuntSide(huntState({ deficit: 8 }))).toBe(1);
    // deficit 12 is dead at clock 30 under the shared aliveness definition
    // ((30/12+1)*1.6 reachable < 12−6); at clock 35 it is barely alive
    // (0.045) and still inside the 35 s window — the real hunt boundary
    // after M-09 wired aliveness into this gate.
    expect(foulHuntSide(huntState({ deficit: 12, clock: 35 }))).toBe(1); // ceiling is inclusive
    // and the M-09 side: the same deficit at clock 30 is DEAD — no parade
    expect(foulHuntSide(huntState({ deficit: 12, clock: 30 }))).toBe(null);
  });

  it('down 13 the hunt is over — and down 20 it must STAY over (ceiling-deletion mutant fails here)', () => {
    expect(foulHuntSide(huntState({ deficit: 13 }))).toBe(null);
    // After M-09 wired aliveness into this gate, no 13+ deficit is both
    // alive and inside the window at default params, so the ceiling's
    // mutant is only observable with aliveness made generous. Pin the
    // ceiling as the SOLE barrier under a huge chaseFadePts: everything is
    // alive, the window holds (min(35, 7x24) >= clock 30), and only the
    // deficit ceiling can say no. Ceiling deleted -> the mutant hunts here.
    const generous = {
      ...defaultParams,
      endgame: { ...defaultParams.endgame, chaseFadePts: 1000 }
    };
    expect(foulHuntSide({ ...huntState({ deficit: 20 }), params: generous } as unknown as GameState)).toBe(null);
    // aliveness-bypassed sanity: the same generous params DO hunt inside the window
    expect(foulHuntSide({ ...huntState({ deficit: 12 }), params: generous } as unknown as GameState)).toBe(1);
  });

  it('the other gates hold: down 1-2 a stop wins, dead shot clock plays out, flag off never hunts', () => {
    expect(foulHuntSide(huntState({ deficit: 2 }))).toBe(null);
    expect(foulHuntSide(huntState({ deficit: 8, shotClock: 4 }))).toBe(null);
    expect(foulHuntSide(huntState({ deficit: 8, endgame: false }))).toBe(null);
  });

  it('stream-level: deep-deficit reach fouls stay at the organic trickle, not a parade', () => {
    // Reach-ins never fully vanish (the organic reachInPerSec dice keep
    // rolling in garbage time), so the pin is a ceiling well above the
    // measured organic rate and well below the mutant's parade.
    let deepStates = 0;
    let deepReach = 0;
    for (const r of pool) {
      for (const e of r.events) {
        if (e.period < r.rules.periods || e.clock > 35) continue;
        for (const side of [0, 1] as const) {
          const d = -marginAt(e, side);
          if (d >= 13 && d <= 30) deepStates++;
        }
        if (e.type === 'foul' && e.kind === 'reach' && -marginAt(e, e.team) >= 13) deepReach++;
      }
    }
    // measured: 119 deep-deficit event-states across 7 of 16 games — the
    // pool genuinely contains the walk-off finishes this pin needs
    expect(deepStates).toBeGreaterThanOrEqual(10);
    // measured: 2 organic at HEAD vs 13 with the ceiling deleted
    expect(deepReach).toBeLessThanOrEqual(6);
  });
});
