/**
 * Rebound scramble cadence (G9, fdesign-judge §3) — wiring suite, LIVE.
 *
 * The mechanism shipped staged-inert (cadenceOn 0 = the legacy sub-second
 * uniform windows, same single rng draw) and went live at the FLOW flip
 * (ffit-cadence): params.reb.cadenceOn ships at 1, where resolve.ts
 * sampleScrambleSec maps the draw through the corpus-fitted CDF. The old
 * dormancy pins inverted to ship-at-1 pins at the flip (the ffit-cadence
 * bake checklist); the legacy arm stays covered through an explicit
 * cadenceOn 0 override.
 *
 * The forced-live distribution checks measure exactly what the judge
 * measures (harness scoreboard rebMissDeltas / tools parse-nba: game-clock
 * delta from the miss row to the player-rebound row, clocks floored to
 * whole seconds, interleaved sub rows skipped, same-period pairs only) and
 * assert against the 184-game corpus targets recorded in params.reb's
 * cadence provenance block: FG misses p50 3s, <=1s 17.4%, 2-4s 75.8%;
 * final-FT misses p50 2s. Bands are set wide enough to survive rng
 * reshuffles (cadence is a pure draw; matchup style cannot move it) but
 * tight enough that a broken CDF mapping cannot pass.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultParams, simulateGame, withParams, type GameEvent, type GameResult
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const LIVE = { reb: { cadenceOn: 1 } };

function pool(n: number, prefix: string, params?: object): GameResult[] {
  const out: GameResult[] = [];
  for (let i = 0; i < n; i++) {
    const { home, away } = sampleMatchup();
    const flip = i % 2 === 1;
    out.push(simulateGame({
      seed: `${prefix}-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false,
      ...(params ? { params } : {})
    }));
  }
  return out;
}

interface Delta { d: number; kind: 'fg' | 'ft'; miss: GameEvent; reb: GameEvent }

/**
 * The G9 measurement, ported verbatim from the judge's definition
 * (harness/src/scoreboard.ts rebMissDeltas semantics on raw events):
 * player rebounds only (team/dead-ball rows excluded), walk back over
 * interleaved substitution rows, the previous row must be a missed FGA
 * (fouled misses never precede a scramble; they route to the line) or a
 * missed final free throw, same period, clocks floored to whole seconds.
 */
function missRebDeltas(events: readonly GameEvent[]): Delta[] {
  const out: Delta[] = [];
  for (let i = 1; i < events.length; i++) {
    const r = events[i]!;
    if (r.type !== 'rebound' || !r.player || r.deadBall) continue;
    let j = i - 1;
    while (j >= 0 && events[j]!.type === 'substitution' && events[j]!.period === r.period) j--;
    if (j < 0) continue;
    const prev = events[j]!;
    if (prev.period !== r.period) continue;
    const fgMiss = prev.type === 'shot' && !prev.made;
    const ftMiss = prev.type === 'free_throw' && !prev.made && prev.n === prev.of;
    if (!fgMiss && !ftMiss) continue;
    const d = Math.floor(prev.clock) - Math.floor(r.clock);
    if (d >= 0) out.push({ d, kind: fgMiss ? 'fg' : 'ft', miss: prev, reb: r });
  }
  return out;
}

const share = (a: readonly number[], f: (d: number) => boolean): number =>
  a.length === 0 ? 0 : a.filter(f).length / a.length;
const p50 = (a: readonly number[]): number =>
  [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)]!;

// n=40 games: ~2,000+ FG-miss deltas, share s.e. under 1pp, so the bands
// below are dominated by model fit, not sampling noise.
const live = pool(40, 'cadence', LIVE);
// the legacy arm, pinned by explicit override since the flip made 1 the default
const staged = pool(4, 'cadence-staged', { reb: { cadenceOn: 0 } });

describe('forced-live cadence distribution (n=40 games)', () => {
  const all = live.flatMap((r) => missRebDeltas(r.events));
  const fg = all.filter((x) => x.kind === 'fg').map((x) => x.d);
  const ft = all.filter((x) => x.kind === 'ft').map((x) => x.d);

  it('FG misses: p50 and shares land on the corpus targets (gate band p50 2-4s, <=1s <= 30%)', () => {
    expect(fg.length).toBeGreaterThan(1500); // material sample, ~50+/game
    // corpus: p50 3s, gate band 2-4s; the fit lands 3 (probed 3 at n=40)
    expect(p50(fg)).toBeGreaterThanOrEqual(2);
    expect(p50(fg)).toBeLessThanOrEqual(4);
    // corpus <=1s 17.4% (fit 17.0%); the tell was 100%, the gate caps 30%
    expect(share(fg, (d) => d <= 1)).toBeGreaterThan(0.10);
    expect(share(fg, (d) => d <= 1)).toBeLessThan(0.26);
    // corpus 2-4s 75.8% (fit 75.6%); the scramble mass lives here
    expect(share(fg, (d) => d >= 2 && d <= 4)).toBeGreaterThan(0.66);
    expect(share(fg, (d) => d >= 2 && d <= 4)).toBeLessThan(0.85);
    // both tails exist: same-second grabs and 5s+ scrums (corpus 5.5%/6.8%)
    expect(share(fg, (d) => d === 0)).toBeGreaterThan(0.01);
    expect(share(fg, (d) => d >= 5)).toBeGreaterThan(0.02);
    expect(share(fg, (d) => d >= 5)).toBeLessThan(0.13);
    // capped span: cadenceFgMaxSec 8 + one flooring second
    for (const d of fg) expect(d).toBeLessThanOrEqual(9);
  });

  it('final-FT misses: faster secure than FG misses (corpus p50 2s vs 3s)', () => {
    expect(ft.length).toBeGreaterThan(60); // ~2-4 final-FT scrambles/game
    expect(p50(ft)).toBeGreaterThanOrEqual(1);
    expect(p50(ft)).toBeLessThanOrEqual(3);
    // corpus <=1s 21.1%, clearly above the FG share (the touch can be the
    // secure at the line); band widened for the small per-run n
    expect(share(ft, (d) => d <= 1)).toBeGreaterThan(0.08);
    expect(share(ft, (d) => d <= 1)).toBeLessThan(0.40);
  });

  it('the delay lives on BOTH time axes: game clock and wall clock burn together under the scramble', () => {
    // away from the horn (clock > 30s), the window burns game clock (t) and
    // wall clock (wt) in lockstep; the scramble ticks both. A dead-ball
    // implementation (clock frozen, or wallT-only delay) fails here.
    let checked = 0;
    for (const { miss, reb } of all) {
      if (reb.clock < 30 || miss.period !== reb.period) continue;
      const dtGame = miss.clock - reb.clock; // unfloored, round2
      const dtT = reb.t - miss.t;
      const dtW = reb.wt - miss.wt;
      expect(dtGame).toBeGreaterThan(0); // rebounds consume game clock
      expect(Math.abs(dtT - dtGame)).toBeLessThan(0.05); // one writer of t
      expect(Math.abs(dtW - dtT)).toBeLessThan(0.05); // no hidden stoppage
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('buzzer: the horn can beat the secure — no rebound row is logged at 0.0', () => {
    // a scramble reaching 0:00 ends the period without a rebound (real pbp
    // reads the same); the resolve path is clock-guarded upstream
    for (const r of live) {
      for (const e of r.events) {
        if (e.type === 'rebound' && e.player && !e.deadBall) {
          expect(e.clock).toBeGreaterThan(0);
        }
      }
    }
  });

  it('downstream flows intact when live: putbacks still fire and possessions balance', () => {
    let putbacks = 0;
    for (const r of live) {
      for (const e of r.events) {
        if (e.type === 'shot' && e.moveType === 'putback') putbacks++;
      }
      const starts = r.events.filter((e) => e.type === 'possession_start').length;
      const ends = r.events.filter((e) => e.type === 'possession_end').length;
      expect(starts).toBe(ends);
    }
    expect(putbacks).toBeGreaterThan(40); // ~4-5/game legacy; the secure still feeds them
  });

  it('deterministic when live: same seed, byte-identical events', () => {
    const { home, away } = sampleMatchup();
    const a = simulateGame({ seed: 'cadence-det', home, away, params: LIVE, collectFrames: false });
    const b = simulateGame({ seed: 'cadence-det', home, away, params: LIVE, collectFrames: false });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});

describe('ship-at-1 pins (dormancy pins inverted at the cadence flip, ffit-cadence)', () => {
  it('the stage switch ships at 1', () => {
    expect(defaultParams.reb.cadenceOn).toBe(1);
  });

  it('the pinned 0-arm still carries the legacy tell: every FG-miss rebound lands <=1s after the miss', () => {
    // pins the LEGACY behavior of the 0 arm (the 0.5-0.95s window floors to
    // 0 or 1) so the switch semantics cannot silently rot; the arm only
    // exists behind the explicit override now
    const fg = staged.flatMap((r) => missRebDeltas(r.events)).filter((x) => x.kind === 'fg');
    expect(fg.length).toBeGreaterThan(100);
    for (const { d } of fg) expect(d).toBeLessThanOrEqual(1);
  });

  it('withParams at the shipped 1 reproduces the default stream byte-for-byte', () => {
    const { home, away } = sampleMatchup();
    const plain = simulateGame({ seed: 'cadence-inert', home, away, collectFrames: false });
    const pinned = simulateGame({
      seed: 'cadence-inert', home, away, collectFrames: false,
      params: { reb: { cadenceOn: 1 } }
    });
    expect(JSON.stringify(pinned.events)).toBe(JSON.stringify(plain.events));
    expect(pinned.finalScore).toEqual(plain.finalScore);
  });
});

describe('cadence params contract', () => {
  it('each CDF sextet is monotone nondecreasing inside (0, 1) with a sane span', () => {
    const R = withParams(LIVE).reb;
    for (const k of ['Fg', 'Ft'] as const) {
      const cums = [0, 1, 2, 3, 4, 5].map(
        (i) => (R as unknown as Record<string, number>)[`cadence${k}Cum${i}`]!
      );
      for (let i = 0; i < cums.length; i++) {
        expect(cums[i]!).toBeGreaterThan(0);
        expect(cums[i]!).toBeLessThan(1);
        if (i > 0) expect(cums[i]!).toBeGreaterThanOrEqual(cums[i - 1]!);
      }
      const min = (R as unknown as Record<string, number>)[`cadence${k}MinSec`]!;
      const max = (R as unknown as Record<string, number>)[`cadence${k}MaxSec`]!;
      expect(min).toBeGreaterThan(0);
      expect(min).toBeLessThan(0.5); // below the first knot
      expect(max).toBeGreaterThan(5.5); // above the last knot
    }
  });
});
