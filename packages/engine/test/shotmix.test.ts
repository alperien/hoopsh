/**
 * Shot-taxonomy gates (wave2/shotmix): the acquisition-aware quick-touch
 * classification made permanent.
 *
 * Before this branch, decide.ts labeled every 0-dribble shot inside the
 * quick window `catch_shoot`. 22% of all attempts were interior shots
 * wearing a jump-shot label (rebound put-backs, cuts), `cut_finish` was
 * assigned nowhere, and putbacks/dead-ball touches inherited stale
 * pass-delivery quality and stale assist credit. These tests pin the
 * taxonomy contract to the event stream (the public interface), not to
 * decide.ts internals:
 *   1. cut_finish and putback are actually assigned;
 *   2. catch_shoot no longer swallows interior shots;
 *   3. a cut_finish follows a completed pass to the shooter; a putback
 *      follows the shooter's own offensive rebound, with no pass between;
 *   4. putbacks are never assisted (the pre-fix false-assist artifact).
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const GAMES = 6;

/** the shooter's most recent touch-granting event before index i, if visible:
 *  a completed pass to him, his own rebound, or his steal */
function lastTouch(
  events: GameEvent[], i: number, shooter: string
): { kind: 'pass' | 'rebound' | 'steal'; t: number; offensive?: boolean } | null {
  for (let j = i - 1; j >= 0; j--) {
    const e = events[j]!;
    if (e.type === 'pass' && e.to === shooter) return { kind: 'pass', t: e.t };
    if (e.type === 'rebound' && e.player === shooter) {
      return { kind: 'rebound', t: e.t, offensive: e.offensive };
    }
    if (e.type === 'turnover' && e.stolenBy === shooter) return { kind: 'steal', t: e.t };
  }
  return null;
}

describe(`shot taxonomy over ${GAMES} games`, () => {
  const games: GameEvent[][] = [];
  for (let i = 0; i < GAMES; i++) {
    const { home, away } = sampleMatchup();
    const flip = i % 2 === 1;
    games.push(simulateGame({
      seed: `shotmix-tax-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false
    }).events);
  }
  const shots = games.flatMap((evs) =>
    evs.map((e, i) => ({ e, i, evs })).filter((x) => x.e.type === 'shot')
  ) as { e: Extract<GameEvent, { type: 'shot' }>; i: number; evs: GameEvent[] }[];

  const byMove = (m: string) => shots.filter((s) => s.e.moveType === m);
  const interior = (e: { zone: string }) => e.zone === 'rim' || e.zone === 'paint';

  it('cut_finish is assigned (was zero assignment sites before wave2)', () => {
    expect(byMove('cut_finish').length).toBeGreaterThan(0);
  });

  it('putback is assigned, including by the decision layer', () => {
    expect(byMove('putback').length).toBeGreaterThan(0);
  });

  it('catch_shoot no longer swallows interior shots (was 22-25% of ALL attempts)', () => {
    const cs = byMove('catch_shoot');
    const interiorCs = cs.filter((s) => interior(s.e)).length;
    // tolerance: a shooter can drift across the 14 ft paint/mid boundary
    // between the decision and the release (windup movement). Allow the
    // rare boundary straddle, never the systematic mislabel.
    expect(interiorCs / Math.max(1, shots.length)).toBeLessThan(0.01);
  });

  it('a cut_finish follows a completed pass to the shooter (caught in stride)', () => {
    for (const { e, i, evs } of byMove('cut_finish')) {
      const touch = lastTouch(evs, i, e.shooter);
      expect(touch?.kind).toBe('pass');
      // pass arrival -> quick window (0.9s) -> windup -> flight: well under 3s
      expect(e.t - touch!.t).toBeLessThanOrEqual(3);
    }
  });

  it('a putback follows the shooter own OFFENSIVE rebound, not a pass', () => {
    for (const { e, i, evs } of byMove('putback')) {
      const touch = lastTouch(evs, i, e.shooter);
      expect(touch?.kind).toBe('rebound');
      expect(touch?.offensive).toBe(true);
      expect(e.t - touch!.t).toBeLessThanOrEqual(3);
    }
  });

  it('putbacks are never assisted (lastPass survives the miss; credit must not)', () => {
    for (const { e } of byMove('putback')) {
      expect(e.assist).toBe(undefined);
    }
  });

  it('every assisted make follows a completed pass to the shooter', () => {
    for (const { e, i, evs } of shots) {
      if (!e.assist) continue;
      const touch = lastTouch(evs, i, e.shooter);
      expect(touch?.kind).toBe('pass');
    }
  });
});
