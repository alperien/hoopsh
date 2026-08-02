/**
 * Dead-carom attribution pinned to GROUND TRUTH.
 *
 * The dead-carom branch (sim/possession.ts:641-668) draws a winning side for
 * a loose ball nobody secured and keys BOTH the event label and the award
 * routing off one boolean: `offensive = side === ph.offSide` (line 643). A
 * mutation audit (findings/audit-engine-mechanics.md, TR-M3) proved that
 * inverting that comparison survives every semantic test in the repo:
 * teamrebounds.test.ts selects "defensive" caroms BY the flipped label and
 * then checks the flow the same flipped boolean drove (label-flow
 * consistency), and the box fold shares the event predicate — a coherent
 * relabeling satisfies all of it while every dead carom (~7-9 per game)
 * awards the ball to the wrong team.
 *
 * This file breaks the circularity by anchoring on stream facts the boolean
 * cannot relabel:
 *  - the MISS that spawned the scramble. A scramble only exists off a missed
 *    shot or missed final free throw (shooting.ts:272-294, fouls.ts:473-491),
 *    and the loose ball emits nothing until it resolves — so the nearest
 *    preceding shot/free_throw event names the shooting side, independent of
 *    anything the rebound branch stamps.
 *  - the documented label contract: "`offensive` is true when `team` matches
 *    the side that took the missed shot" (core/events.ts:319).
 *  - the documented award: a carom that dies with the DEFENSE ends the
 *    possession as 'def_rebound' and the awarded side inbounds
 *    (core/events.ts:106-110; possession.ts:664-665), while a carom that dies
 *    with the OFFENSE is a side out — the same possession continues with no
 *    possession boundary at all (possession.ts:651-659). Basketball reason:
 *    an offensive team rebound never changes whose ball it is, a defensive
 *    one always does.
 *
 * Zero tolerance: every dead carom in both games is checked, exact sides.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import type { GameEvent, GameResult, ReboundEvent, TeamSide } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

// Two full games, fresh seeds. Measured on these seeds: carom-gt-1 has
// 3 offensive / 7 defensive dead caroms, carom-gt-7 has 6 / 10 — both kinds
// well clear of the vacuity floors below. If an engine rng reshuffle ever
// drops a floor under 2, re-anchor the seed list (plenty of seeds qualify —
// the mechanic fires ~7-9 times a game); do not weaken the assertions.
const SEEDS = ['carom-gt-1', 'carom-gt-7'];
const games: GameResult[] = SEEDS.map((seed) => {
  const { home, away } = sampleMatchup();
  return simulateGame({ seed, home, away, collectFrames: false });
});

/**
 * Events that pin down whose ball it is (or that a possession boundary
 * happened). Everything else that can legally appear inside a dead ball —
 * timeout, substitution — says nothing about possession and is skipped.
 */
const BOUNDARY = new Set<GameEvent['type']>([
  'shot', 'pass', 'turnover', 'free_throw', 'foul',
  'possession_start', 'possession_end'
]);

/** First boundary event at or after index `from`. A game always closes its last possession, so running off the end means the walk itself is broken — fail loudly. */
function nextBoundary(events: readonly GameEvent[], from: number): { e: GameEvent; i: number } {
  for (let k = from; k < events.length; k++) {
    const e = events[k];
    if (e !== undefined && BOUNDARY.has(e.type)) return { e, i: k };
  }
  throw new Error(`no boundary event after index ${from} — stream ended mid-possession`);
}

interface Carom {
  idx: number;
  reb: ReboundEvent;
  /** side of the miss that spawned the scramble — the ground-truth offense */
  shooterSide: TeamSide;
}

/**
 * Every dead-carom team rebound with its ground-truth shooting side.
 * Selection is by event SHAPE only (playerless, no deadBall formality flag —
 * core/events.ts:323-341), which the possession.ts:643 boolean does not
 * influence; the shooting side comes from the miss, never from the rebound's
 * own `offensive`/`team` stamps.
 */
function deadCaroms(events: readonly GameEvent[]): Carom[] {
  const rows: Carom[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e === undefined || e.type !== 'rebound' || e.player !== undefined || e.deadBall === true) continue;
    let shooterSide: TeamSide | null = null;
    for (let k = i - 1; k >= 0; k--) {
      const p = events[k];
      if (p !== undefined && (p.type === 'shot' || p.type === 'free_throw')) {
        // the nearest shooting event before a scramble rebound must be the
        // miss that put the ball in the air — a make never scrambles
        if (p.made) throw new Error(`carom at ${i}: nearest preceding shooting event is a make`);
        shooterSide = p.team;
        break;
      }
    }
    if (shooterSide === null) throw new Error(`carom at ${i}: no preceding shot/free_throw`);
    rows.push({ idx: i, reb: e, shooterSide });
  }
  return rows;
}

describe('dead-carom attribution vs ground truth (2 games)', () => {
  it('labels every dead carom offensive exactly when the carom side took the miss', () => {
    let off = 0;
    let def = 0;
    for (const g of games) {
      for (const { reb, shooterSide } of deadCaroms(g.events)) {
        // core/events.ts:319 verbatim contract. Under the audit mutant the
        // label reads `team !== shooterSide` on every carom — both kinds flip.
        expect(reb.offensive).toBe(reb.team === shooterSide);
        if (reb.team === shooterSide) off++;
        else def++;
      }
    }
    // vacuity floor: at least 2 of EACH kind checked (measured 9 / 17)
    expect(off).toBeGreaterThanOrEqual(2);
    expect(def).toBeGreaterThanOrEqual(2);
  });

  it('a defensive dead carom ends the possession as def_rebound and the carom side inbounds', () => {
    let checked = 0;
    for (const g of games) {
      for (const { idx, reb, shooterSide } of deadCaroms(g.events)) {
        if (reb.team === shooterSide) continue; // ground-truth offensive: covered below
        checked++;
        // The shooting side's possession must CLOSE right here — the defense
        // was just awarded the ball (possession.ts:664, core/events.ts:106-110).
        // Under the mutant this carom takes the side-out continuation branch
        // instead, so the first boundary event is the offense playing on.
        const end = nextBoundary(g.events, idx + 1);
        expect(
          end.e.type === 'possession_end' &&
          end.e.outcome === 'def_rebound' &&
          end.e.team === shooterSide
        ).toBe(true);
        // ...and the side the officials gave the ball inbounds it: a
        // dead-ball 'inbound' start for the carom winner, never a live burst
        // (possession.ts:665, core/events.ts:194-199)
        const start = nextBoundary(g.events, end.i + 1);
        expect(
          start.e.type === 'possession_start' &&
          start.e.team === reb.team &&
          start.e.kind === 'inbound'
        ).toBe(true);
      }
    }
    // vacuity floor: at least 2 defensive caroms walked (measured 17)
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('an offensive dead carom keeps the shooting side\'s ball: no possession boundary before its next action', () => {
    let checked = 0;
    for (const g of games) {
      for (const { idx, reb, shooterSide } of deadCaroms(g.events)) {
        if (reb.team !== shooterSide) continue; // ground-truth defensive: covered above
        checked++;
        // An offensive team rebound is a side out — same possession, same
        // shot-clock trip (possession.ts:651-659). The next boundary event
        // must be the offense doing something with the ball, never a
        // possession flip. Under the mutant this carom is routed through the
        // defensive branch: possession_end 'def_rebound' lands immediately.
        const next = nextBoundary(g.events, idx + 1);
        expect(next.e.type === 'possession_start').toBe(false);
        // the one legitimate no-further-action close is the period horn
        expect(next.e.type === 'possession_end' && next.e.outcome !== 'period_end').toBe(false);
      }
    }
    // vacuity floor: at least 2 offensive caroms walked (measured 9)
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});
