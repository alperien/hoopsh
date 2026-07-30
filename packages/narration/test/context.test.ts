/**
 * ContextTracker semantics — run-bar crossing detection (audit M-36).
 *
 * The old detection used exact equality (`run === 8 || run === 12 ||
 * run === 16`), so a run that jumped a bar via a three (6 -> 9 never equals
 * 8) fired nothing — 36% of real crossings. These tests pin the fixed
 * contract: >= crossing with a fired-bar memory (each bar announces once per
 * run, the announcement carries the TRUE unanswered total), and the memory
 * resets with the run itself when the opponent scores.
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent, TeamSide } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { ContextTracker, generatePlayByPlay } from '@hoopsh/narration';

/** minimal made-shot event; pts 2 or 3 decides the three flag */
function mkShot(
  team: TeamSide,
  shooter: string,
  pts: 2 | 3,
  score: [number, number],
  t: number
): GameEvent {
  return {
    type: 'shot', team, shooter,
    x: pts === 3 ? 47 : 5, y: 25,
    distFt: pts === 3 ? 25 : 2,
    zone: pts === 3 ? 'three' : 'rim',
    three: pts === 3, moveType: pts === 3 ? 'catch_shoot' : 'drive',
    contest: 0.3, made: true, points: pts,
    t, wt: t + 10, period: 1, clock: 720 - t, score
  } as GameEvent;
}

describe('run detection crosses bars, never requires exact landings (M-36)', () => {
  it('a three jumping the 8 bar fires once, with the true run total', () => {
    const tracker = new ContextTracker(4);
    const runs: string[] = [];
    const feed = (e: GameEvent): void => {
      for (const m of tracker.update(e)) if (m.kind === 'run') runs.push(m.detail);
    };

    // 3 + 3 = 6, then a three jumps the 8 bar outright: 6 -> 9
    feed(mkShot(0, 'p1', 3, [3, 0], 10));
    feed(mkShot(0, 'p1', 3, [6, 0], 20));
    feed(mkShot(0, 'p1', 3, [9, 0], 30));
    expect(runs).toEqual(['9-0 run']);

    // 9 -> 11 sits between bars: the 8 bar is spent, 12 not reached — silent
    feed(mkShot(0, 'p2', 2, [11, 0], 40));
    expect(runs).toEqual(['9-0 run']);

    // 11 -> 14 crosses the 12 bar (again without landing on it)
    feed(mkShot(0, 'p2', 3, [14, 0], 50));
    expect(runs).toEqual(['9-0 run', '14-0 run']);

    // opponent scores: run AND fired-bar memory reset together...
    feed(mkShot(1, 'q1', 2, [14, 2], 60));
    expect(tracker.currentRun(0)).toBe(0);

    // ...so a fresh run announces from the 8 bar again — and an exact
    // landing (3+3+2 = 8) still fires (regression guard for the old path)
    feed(mkShot(0, 'p3', 3, [17, 2], 70));
    feed(mkShot(0, 'p3', 3, [20, 2], 80));
    feed(mkShot(0, 'p4', 2, [22, 2], 90));
    expect(runs).toEqual(['9-0 run', '14-0 run', '8-0 run']);
  });

  it('rendered run lines carry the crossing total with the right article', () => {
    const { home, away } = sampleMatchup();
    // six straight threes: crossings at 9 (8 bar), 12 (exact), 18 (16 bar)
    const events = Array.from({ length: 6 }, (_, i) =>
      mkShot(0, `p${i % 3}`, 3, [3 * (i + 1), 0], 10 * (i + 1)));
    const lines = generatePlayByPlay(events, [home, away], { seed: 'm36-art' })
      .filter((l) => l.kind === 'moment' && l.text.includes('run'))
      .map((l) => l.text);
    expect(lines).toEqual([
      `${home.name} are on a 9-0 run.`,
      `${home.name} are on a 12-0 run.`,
      `${home.name} are on an 18-0 run.`
    ]);
  });
});
