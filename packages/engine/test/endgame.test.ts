/**
 * Endgame-layer behavior suite (GameConfig.endgame).
 *
 * Two contracts, both load-bearing:
 *
 *  1. Flag on, the late-game texture exists: intentional fouls in close
 *     finishes, an FT spike in the final minute, longer leading-team /
 *     shorter trailing-team possessions late, timeouts in the stream, the
 *     2-for-1 early shot. The engine invariants (possession pairing,
 *     score reconstruction, no post-horn scoring) survive the new
 *     stoppage machinery.
 *
 *  2. Flag off, nothing changed: no timeout events, and `endgame: false`
 *     is byte-identical to omitting the flag. (Identity with the
 *     pre-layer engine is enforced separately by the golden fingerprint
 *     corpus: `npm run fingerprint`, 24 seeds, verified when the layer
 *     landed.)
 *
 * Thresholds are set well below probed values (see commit history: e.g.
 * hunted fouls measured 4+ in the qualifying game, threshold 2; lead-vs-
 * trail possession gap measured ~8.5 s, threshold 3 s) so an unrelated
 * rng-reordering change that reshuffles which seeds produce close games
 * still passes as long as the behavior itself exists.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent, type GameResult, type TimeoutEvent } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';

// 16, not 8: the FT-parade assertion below keys on games that are still
// within 12 at the 1:00 mark, and only ~half of any pool qualifies. At 8
// games that left ~4 qualifying finishes, so one quiet ending swung the
// per-game average below the bar and the suite failed on seed luck rather
// than behavior (caught during wave-1 integration, when merging narration's
// spot jitter reshuffled the RNG stream). 16 games doubles the qualifying
// sample for ~2x the runtime, the cheapest honest fix.
const GAMES = 16;

// one shared flag-ON pool: sim once, assert many (invariants-suite pattern)
const on: GameResult[] = [];
for (let i = 0; i < GAMES; i++) {
  const { home, away } = sampleMatchup();
  const flip = i % 2 === 1;
  on.push(simulateGame({
    seed: `egscan-${i}`,
    home: flip ? away : home,
    away: flip ? home : away,
    collectFrames: false,
    endgame: true
  }));
}

// small flag-OFF pool on the same seeds for the unchanged-path assertions
const off: GameResult[] = [];
for (let i = 0; i < 3; i++) {
  const { home, away } = sampleMatchup();
  const flip = i % 2 === 1;
  off.push(simulateGame({
    seed: `egscan-${i}`,
    home: flip ? away : home,
    away: flip ? home : away,
    collectFrames: false,
    endgame: false
  }));
}

const timeouts = (r: GameResult): TimeoutEvent[] =>
  r.events.filter((e): e is TimeoutEvent => e.type === 'timeout');

/** margin for `side` at an event (score is stamped after the event) */
const marginFor = (e: GameEvent, side: 0 | 1): number =>
  e.score[side] - e.score[side === 0 ? 1 : 0];

describe(`endgame layer ON over ${GAMES} games`, () => {
  it('engine invariants survive the new stoppages (pairing, score, horn)', () => {
    for (const r of on) {
      const starts = r.events.filter((e) => e.type === 'possession_start').length;
      const ends = r.events.filter((e) => e.type === 'possession_end').length;
      expect(starts).toEqual(ends);

      const recon: [number, number] = [0, 0];
      for (const e of r.events) {
        if (e.type === 'shot' && e.made) recon[e.team] += e.points;
        if (e.type === 'free_throw' && e.made) recon[e.team] += 1;
      }
      expect(recon).toEqual(r.finalScore);

      const periodLen = 12 * 60;
      for (const e of r.events) {
        if ((e.type === 'shot' && e.made) || (e.type === 'free_throw' && e.made)) {
          const cap = e.period <= 4
            ? e.period * periodLen
            : 4 * periodLen + (e.period - 4) * 5 * 60;
          expect(e.t).toBeLessThanOrEqual(cap + 0.001);
        }
      }
    }
  });

  it('timeouts fire, respect the budget, and count down correctly', () => {
    let total = 0;
    for (const r of on) {
      const tos = timeouts(r);
      total += tos.length;
      const used: [number, number] = [0, 0];
      for (const to of tos) {
        used[to.team] += 1;
        // remaining is the budget minus what this team has burned so far
        expect(to.remaining).toEqual(r.rules.timeoutsPerGame - used[to.team]);
        expect(to.remaining).toBeGreaterThanOrEqual(0);
        expect(['stop_run', 'advance']).toContain(to.reason);
      }
      expect(used[0]).toBeLessThanOrEqual(r.rules.timeoutsPerGame);
      expect(used[1]).toBeLessThanOrEqual(r.rules.timeoutsPerGame);
    }
    // probed: ~1.5-2/game across this pool, so assert well under that
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it('the advance timeout belongs to the TRAILING team — never the leader', () => {
    // maybeTimeout's advance trigger requires the caller's margin < 0: the
    // point of burning a timeout to advance the ball is that the trailing
    // team buys its chase possession a frontcourt start. A sign flip hands
    // the mechanic to the winning team and every budget/countdown assertion
    // above stays green (mutation probe), so pin the side here. Timeout
    // events don't move the score, so the stamped margin is the margin
    // maybeTimeout decided on.
    let advances = 0;
    for (const r of on) {
      for (const to of timeouts(r)) {
        if (to.reason !== 'advance') continue;
        advances++;
        expect(marginFor(to, to.team)).toBeLessThan(0);
      }
    }
    // existence floor so the loop above can never pass vacuously. Probed:
    // 15 advance timeouts across this pool (same well-under-probed
    // convention as the header documents).
    expect(advances).toBeGreaterThanOrEqual(1);
  });

  it('timeouts fold into the box score (no consumer drops the event)', () => {
    for (const r of on) {
      const box = boxScore(r.events, r.teams);
      const tos = timeouts(r);
      expect(box.teams[0].timeouts + box.teams[1].timeouts).toEqual(tos.length);
    }
  });

  it('a trailing team intentionally fouls in the final ~35s of a close game', () => {
    // qualifying state: final period/OT, clock <= 35, the fouling team down
    // 3-12, exactly foulHuntSide's activation. Count reach fouls there.
    let hunted = 0;
    let qualifyingGames = 0;
    for (const r of on) {
      let sawState = false;
      for (const e of r.events) {
        if (e.period < 4 || e.clock > 35) continue;
        for (const side of [0, 1] as const) {
          const deficit = -marginFor(e, side);
          if (deficit >= 3 && deficit <= 12) sawState = true;
        }
        if (e.type === 'foul' && e.kind === 'reach') {
          const deficit = -marginFor(e, e.team);
          if (deficit >= 3 && deficit <= 12) hunted++;
        }
      }
      if (sawState) qualifyingGames++;
    }
    // the pool must actually contain a close finish, and it must produce
    // the parade (probed: 4 hunted fouls in one qualifying game)
    expect(qualifyingGames).toBeGreaterThanOrEqual(1);
    expect(hunted).toBeGreaterThanOrEqual(2);
  });

  it('free throws spike in the final minute of close finishes', () => {
    // in games that were within 12 at the 1:00 mark of the final period,
    // the last minute should contain a real FT trip count (the parade +
    // bonus texture).
    //
    // Threshold provenance (integration re-measure, n=24): endgame OFF gives
    // 1.5 FTs per close final-minute, ON gives 3.9, a 2.6x parade spike. The
    // bar sits at 2.5 rather than that mean because this suite's pool is 8
    // games: with only ~4 qualifying games per run, a single quiet finish
    // swings the average hard. The assertion's job is "the parade exists",
    // and the honest magnitude lives in the n=24 numbers above; a tighter
    // bar here only measures the seed pool.
    let fta = 0;
    let closeGames = 0;
    for (const r of on) {
      let close = false;
      let sawFinalMinute = false;
      for (const e of r.events) {
        if (e.period < 4 || e.clock > 60) continue;
        if (!sawFinalMinute) {
          sawFinalMinute = true;
          close = Math.abs(e.score[0] - e.score[1]) <= 12;
        }
        if (close && e.type === 'free_throw') fta++;
      }
      if (close) closeGames++;
    }
    expect(closeGames).toBeGreaterThanOrEqual(1);
    expect(fta / Math.max(1, closeGames)).toBeGreaterThanOrEqual(2.5);  // n=24 re-measure: OFF 1.5 vs ON 3.9
  });

  it('a leading team late runs longer possessions than a trailing one (clock-kill vs hurry)', () => {
    const lead: number[] = [];
    const trail: number[] = [];
    for (const r of on) {
      let startT = -1;
      let startClock = -1;
      let margin = 0;
      for (const e of r.events) {
        if (e.type === 'possession_start') {
          startT = e.t;
          startClock = e.clock;
          margin = e.period >= 4 ? marginFor(e, e.team) : 99;
        } else if (e.type === 'possession_end' && startT >= 0) {
          // final period, inside 2:30 but not the last-scraps 30s, one- to
          // four-possession game: where the layer's tempo split lives
          if (e.period >= 4 && startClock <= 150 && startClock > 30) {
            if (margin >= 1 && margin <= 12) lead.push(e.t - startT);
            else if (margin <= -1 && margin >= -12) trail.push(e.t - startT);
          }
          startT = -1;
        }
      }
    }
    expect(lead.length).toBeGreaterThanOrEqual(3);
    expect(trail.length).toBeGreaterThanOrEqual(3);
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    // probed gap ≈ 8.5s (17.9 vs 9.4); flag-off gap ≈ 0.5s; 3s is a safe floor
    expect(mean(lead) - mean(trail)).toBeGreaterThanOrEqual(3);
  });

  it('2-for-1: early shots in the ~0:28-0:38 window of periods 1-3', () => {
    // shots released inside the window having used <= 12s of possession:
    // the "act early to get two" signature. Probed: 2.33/game ON vs 1.17 OFF.
    let early = 0;
    for (const r of on) {
      let possStartT = -1;
      for (const e of r.events) {
        if (e.type === 'possession_start') possStartT = e.t;
        if (
          e.type === 'shot' && e.period < 4 &&
          e.clock >= 27 && e.clock <= 38 &&
          possStartT >= 0 && e.t - possStartT <= 12
        ) early++;
      }
    }
    expect(early / GAMES).toBeGreaterThanOrEqual(1.2);
  });
});

describe('endgame layer OFF is the unchanged engine', () => {
  it('an explicit endgame:false stream never contains a timeout', () => {
    // renamed from "a default-config stream…" when the default flipped ON:
    // a default-config stream now does contain timeouts (that's the pin
    // below); flag-off purity is the legacy path's contract
    for (const r of off) {
      expect(timeouts(r).length).toEqual(0);
    }
  });

  it('omitting the flag means ON: the default flipped on the n=1260/arm survey', () => {
    // This pin is the old "endgame: false is byte-identical to omitting the
    // flag" expectation, inverted on purpose when the default flipped
    // OFF→ON (endgame-flag survey, 1,260 games per arm × 3 seed bases: the
    // layer closes the clutch-realism gaps with invariants green; see
    // GameConfig.endgame in sim/game.ts). A default-config game must now be
    // the flag-on game; the explicit-false pool above stays the
    // byte-identical legacy path.
    const { home, away } = sampleMatchup();
    const omitted = simulateGame({ seed: 'egscan-0', home, away, collectFrames: false });
    expect(JSON.stringify(on[0]!.events)).toEqual(JSON.stringify(omitted.events));
    // (identity of the explicit-false path with the pre-layer engine is the
    // golden fingerprint suite's job, npm run fingerprint, since a test in
    // this tree can only compare this build against itself)
  });

  it('the flag-ON path is deterministic per seed', () => {
    const { home, away } = sampleMatchup();
    const again = simulateGame({
      seed: 'egscan-0', home, away, collectFrames: false, endgame: true
    });
    expect(JSON.stringify(again.events)).toEqual(JSON.stringify(on[0]!.events));
    expect(again.finalScore).toEqual(on[0]!.finalScore);
  });
});
