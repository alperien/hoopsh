/**
 * gameFlow scan-convention pins (flow-metrics.ts) — synthetic event streams,
 * no simulation, so each pin isolates ONE counting rule the reference corpus
 * comparison depends on:
 *   - possession lengths are boundary-to-boundary within a period (audit
 *     H-05: the old start-to-end read silently excluded post-make inbound
 *     time the corpus counts, ~41% of possessions measured short);
 *   - the putback scan counts OFFICIAL FGAs only — a fouled miss produces no
 *     corpus miss line and is not an FGA under the repo's I26 convention
 *     (audit M-49: the sim scan counted events the corpus cannot see).
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@hoopsh/engine';
import { gameFlow } from '../src/flow-metrics.js';

// Minimal literal events: only the fields gameFlow reads are meaningful; the
// cast is confined to this builder so each case reads as basketball.
const ev = (partial: Record<string, unknown>): GameEvent =>
  ({ wt: 0, score: [0, 0], ...partial }) as unknown as GameEvent;

const possStart = (t: number, period = 1): GameEvent =>
  ev({ type: 'possession_start', team: 0, kind: 'inbound', t, period, clock: 720 - t });
const possEnd = (t: number, period = 1): GameEvent =>
  ev({ type: 'possession_end', team: 0, outcome: 'made_fg', t, period, clock: 720 - t });

describe('gameFlow possession lengths — boundary-to-boundary (H-05)', () => {
  it('measures from the previous possession_end, not from possession_start', () => {
    const f = gameFlow([
      possStart(0),        // tip
      possEnd(20),         // first possession: 0 -> 20
      possStart(22.2),     // inbound fires 2.2s AFTER the make; the clock ran
      possEnd(40)          // boundary-to-boundary: 40 - 20 = 20 (start-to-end said 17.8)
    ]);
    expect(f.possLens).toEqual([20, 20]);
  });

  it('resets the boundary at a period roll (openers measure from the period start)', () => {
    const f = gameFlow([
      possStart(700),
      possEnd(720),                                    // Q1 ends at the horn
      ev({ type: 'possession_start', team: 0, kind: 'inbound', t: 720, period: 2, clock: 720 }),
      ev({ type: 'possession_end', team: 0, outcome: 'turnover', t: 730, period: 2, clock: 710 })
    ]);
    // the Q2 possession is 10s from the period boundary — never 730 - 720
    // measured against a stale Q1 boundary from a different clock
    expect(f.possLens[f.possLens.length - 1]).toBe(10);
  });
});

describe('gameFlow putback scan — official FGAs only (M-49)', () => {
  const oreb = (t: number): GameEvent =>
    ev({ type: 'rebound', team: 0, player: 'p1', offensive: true, t, period: 1, clock: 720 - t, x: 0, y: 0 });

  it('counts a clean second-chance FGA within 6s', () => {
    const f = gameFlow([
      oreb(100),
      ev({ type: 'shot', team: 0, shooter: 'p1', made: false, t: 103, period: 1, clock: 617 })
    ]);
    expect(f.oreb).toBe(1);
    expect(f.putback6).toBe(1);
  });

  it('skips a fouled miss (no corpus miss line, not an official FGA) but still sees a later FGA', () => {
    const f = gameFlow([
      oreb(100),
      // fouled miss at +2s: bbref prints foul + FT lines only, never a miss
      // line, and the repo's I26 convention says it is not an FGA
      ev({ type: 'shot', team: 0, shooter: 'p1', made: false, foul: { by: 'd1', ftAwarded: 2, andOne: false }, t: 102, period: 1, clock: 618 }),
      // a real FGA at +5s still counts — the scan continues past the fouled miss
      ev({ type: 'shot', team: 0, shooter: 'p2', made: true, t: 105, period: 1, clock: 615 })
    ]);
    expect(f.putback6).toBe(1);
  });

  it('counts an and-one make (the corpus prints a make line for those)', () => {
    const f = gameFlow([
      oreb(100),
      ev({ type: 'shot', team: 0, shooter: 'p1', made: true, foul: { by: 'd1', ftAwarded: 1, andOne: true }, t: 103, period: 1, clock: 617 })
    ]);
    expect(f.putback6).toBe(1);
  });

  it('a fouled miss alone is NOT a putback', () => {
    const f = gameFlow([
      oreb(100),
      ev({ type: 'shot', team: 0, shooter: 'p1', made: false, foul: { by: 'd1', ftAwarded: 2, andOne: false }, t: 102, period: 1, clock: 618 })
    ]);
    expect(f.oreb).toBe(1);
    expect(f.putback6).toBe(0);
  });
});

describe('gameFlow second-chance marking vs the putback base (L-45)', () => {
  it('a LIVE playerless team OREB marks the possession second-chance but never enters the putback denominator', () => {
    const f = gameFlow([
      possStart(0),
      // live carom, no rebounder credited — the corpus marks these
      ev({ type: 'rebound', team: 0, offensive: true, t: 5, period: 1, clock: 715, x: 0, y: 0 }),
      possEnd(12)
    ]);
    expect(f.oreb).toBe(0);            // putback base stays player-only
    expect(f.secondChancePoss).toBe(1);
  });

  it('a dead-ball FT formality rebound marks nothing (both sides exclude it)', () => {
    const f = gameFlow([
      possStart(0),
      ev({ type: 'rebound', team: 0, offensive: true, deadBall: true, t: 5, period: 1, clock: 715, x: 0, y: 0 }),
      possEnd(12)
    ]);
    expect(f.oreb).toBe(0);
    expect(f.secondChancePoss).toBe(0);
  });
});
