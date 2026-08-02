/**
 * sim/passing.ts — pass-failure routing and the reach-in foul's two paths,
 * pinned at the event-stream boundary.
 *
 * Spec sources: passing.ts:86-124 (a steal starts the thief's possession
 * IMMEDIATELY, ball in hand; an out-of-bounds bad pass routes through a
 * dead-ball inbound for the other team), passing.ts:244-266 (a strip is a
 * live steal; a non-bonus reach-in keeps the SAME possession alive with no
 * free throws; a bonus reach-in sends the holder to the line per
 * FoulOutcome.bonus), events.ts:44-53 and :170-175 (turnover/possession
 * kinds).
 *
 * One seeded game is this file's entire sim budget; every stream rule is
 * asserted over ALL matching events with an existence floor so an rng
 * reshuffle cannot quietly reduce a rule to an unexecuted branch
 * (invariants.test.ts:131 pattern). The horn can legally swallow a new
 * possession (the phantom-possession guard, passing.ts:102-121), so each
 * walk treats period_end as a valid escape — floors require non-escaped
 * instances.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const { home, away } = sampleMatchup();
const result = simulateGame({ seed: 'd2pass-1', home, away, collectFrames: false });
const ev = result.events;

// roster side lookup: team 0 = home, 1 = away
const sideOf = new Map<string, 0 | 1>();
for (const p of home.players) sideOf.set(p.id, 0);
for (const p of away.players) sideOf.set(p.id, 1);

/** first event at index > i whose type is in `stop`; null if the stream ends */
function nextOf(i: number, stop: ReadonlyArray<GameEvent['type']>): GameEvent | null {
  for (let j = i + 1; j < ev.length; j++) {
    if (stop.includes(ev[j]!.type)) return ev[j]!;
  }
  return null;
}

describe('bad-pass routing (passing.ts:86-124)', () => {
  it("a stolen bad pass carries the thief and starts HIS possession immediately (kind 'steal')", () => {
    let checked = 0;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]!;
      if (e.type !== 'turnover' || e.kind !== 'bad_pass') continue;
      expect(e.stolenBy).toBeTruthy(); // the OOB variant is kind 'out_of_bounds'
      const thiefSide = sideOf.get(e.stolenBy!);
      expect(thiefSide).toBe(e.team === 0 ? 1 : 0); // the thief is a defender
      const next = nextOf(i, ['possession_start', 'period_end']);
      if (!next || next.type !== 'possession_start') continue; // horn escape
      expect(next.kind).toBe('steal');
      expect(next.team).toBe(thiefSide);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(1);
  });

  it('an out-of-bounds bad pass has no thief and routes through a dead-ball INBOUND for the other team', () => {
    // passing.ts:112-122 — deadBall(other(passer.side)); events.ts:44-53
    // (stolenBy never on out_of_bounds)
    let checked = 0;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]!;
      if (e.type !== 'turnover' || e.kind !== 'out_of_bounds') continue;
      expect(e.stolenBy).toBe(undefined);
      const next = nextOf(i, ['possession_start', 'period_end']);
      if (!next || next.type !== 'possession_start') continue; // horn escape
      expect(next.kind).toBe('inbound');
      expect(next.team).toBe(e.team === 0 ? 1 : 0);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(1);
  });
});

describe('reach-in resolution (passing.ts:179-267)', () => {
  it("a clean strip is a live steal: 'lost_ball' credits the defender and his side runs with it", () => {
    // passing.ts:244-249; events.ts:44-53 (stolenBy ALWAYS on lost_ball)
    let checked = 0;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]!;
      if (e.type !== 'turnover' || e.kind !== 'lost_ball') continue;
      expect(e.stolenBy).toBeTruthy();
      const thiefSide = sideOf.get(e.stolenBy!);
      expect(thiefSide).toBe(e.team === 0 ? 1 : 0);
      const next = nextOf(i, ['possession_start', 'period_end']);
      if (!next || next.type !== 'possession_start') continue;
      expect(next.kind).toBe('steal');
      expect(next.team).toBe(thiefSide);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(1);
  });

  it('a NON-bonus reach-in continues the same possession: no free throws, no possession flip', () => {
    // passing.ts:257-266 — the continuation dead ball resumes play with the
    // fouled team still in possession; fouls.ts:26-35 (bonus null contract).
    // Walk from each such foul to the next possession boundary: a
    // possession_start before a possession_end means the whistle flipped the
    // ball (red); a free_throw before any LATER foul means someone shot FTs
    // off a foul that awards none (red).
    let checked = 0;
    const violations: string[] = [];
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]!;
      if (e.type !== 'foul' || e.kind !== 'reach' || e.inBonus) continue;
      let sawLaterFoul = false;
      for (let j = i + 1; j < ev.length; j++) {
        const x = ev[j]!;
        if (x.type === 'possession_end' || x.type === 'period_end') break;
        if (x.type === 'possession_start') {
          violations.push(`event ${i}: possession flipped at ${j} (${x.kind})`);
          break;
        }
        if (x.type === 'free_throw' && !sawLaterFoul) {
          violations.push(`event ${i}: free throw at ${j} off a foul that awards none`);
          break;
        }
        if (x.type === 'foul') sawLaterFoul = true; // a later foul may award its own trip
      }
      checked += 1;
    }
    expect(violations).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(1);
  });

  it('a BONUS reach-in sends the fouled team to the line for the pack-awarded trip', () => {
    // passing.ts:250-256 — award comes from FoulOutcome.bonus (NBA: flat
    // bonusFreeThrows, read from result.rules, never a literal)
    let checked = 0;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]!;
      if (e.type !== 'foul' || e.kind !== 'reach' || !e.inBonus) continue;
      const next = nextOf(i, ['free_throw', 'possession_start', 'possession_end', 'shot', 'turnover', 'period_end']);
      expect(next).toBeTruthy();
      expect(next!.type).toBe('free_throw');
      if (next!.type !== 'free_throw') continue;
      expect(next!.team).toBe(e.team === 0 ? 1 : 0); // fouled team shoots
      expect(next!.n).toBe(1);
      expect(next!.of).toBe(result.rules.bonusFreeThrows);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(1);
  });
});

describe('completed passes (passing.ts:126-134)', () => {
  it('every pass connects two DISTINCT teammates on the possessing side', () => {
    let count = 0;
    for (const e of ev) {
      if (e.type !== 'pass') continue;
      expect(e.from).not.toBe(e.to);
      expect(sideOf.get(e.from)).toBe(e.team);
      expect(sideOf.get(e.to)).toBe(e.team);
      count += 1;
    }
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
