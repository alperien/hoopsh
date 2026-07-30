/**
 * buildReplay content pins (audit M-18 / mutation M12): replay.ts had zero
 * tests — a zeroed artifact (empty frames, empty events, empty lineups)
 * passed the whole suite. The replay is the standalone viewer's ONLY input
 * (externally saved copies included), so its content contract needs the
 * same protection the event stream gets.
 *
 * Pinned here: the version literal (DO-NOT #8's compatibility signal), the
 * frame rows (present when collected, 26-column layout, wall-clock
 * monotone), the embedded event stream (complete and wt-monotone), the
 * lineup timeline (two opening fives, one snapshot per substitution), and
 * the straight-copy fields. Each pin fails on the zeroed-artifact mutant.
 */

import { describe, expect, it } from 'vitest';
import { buildReplay, simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const { home, away } = sampleMatchup();
const result = simulateGame({ seed: 'replay-pin-0', home, away, collectFrames: true });
const rep = buildReplay(result);

describe('buildReplay produces a viewer-complete artifact (M-18)', () => {
  it('carries the current format version literal', () => {
    // 3 is the shipped Replay.version (see replay.ts's version history —
    // bumping it is a deliberate DO-NOT #8 event that updates the viewer
    // and THIS pin in the same change; v2 → v3 landed with the officiating
    // vocabulary wiring, which this rebase carries)
    expect(rep.version).toBe(3);
  });

  it('frames are present when collected, 26 columns, wall-clock monotone', () => {
    // a real game records frames many times a minute — hundreds per game;
    // 100 is a generous floor (measured: ~1400 at default tickHz/frameEvery)
    expect(rep.frames.length).toBeGreaterThanOrEqual(100);
    let prevWt = -1;
    for (const row of rep.frames) {
      // [t, period, clock, ballX, ballY, holderSlot, 10× (x,y)] = 26
      expect(row.length).toBe(26);
      // frame [0] is the replay timeline (wall clock): it must never move
      // backwards, or a scrubbing viewer would jump
      expect(row[0]!).toBeGreaterThanOrEqual(prevWt);
      prevWt = row[0]!;
    }
    // frames are the result's frames, not a re-derivation
    expect(rep.frames.length).toBe(result.frames.length);
  });

  it('the full event stream is embedded, bracketed by game_start/game_end, wt-monotone', () => {
    expect(rep.events.length).toBe(result.events.length);
    expect(rep.events.length).toBeGreaterThanOrEqual(100); // a real game emits hundreds
    expect(rep.events[0]!.type).toBe('game_start');
    expect(rep.events[rep.events.length - 1]!.type).toBe('game_end');
    let prevWt = -1;
    for (const e of rep.events) {
      // wt is the same wall-clock axis frames key on — a viewer aligns
      // events to frames by it, so it must be non-decreasing too
      expect(e.wt).toBeGreaterThanOrEqual(prevWt);
      prevWt = e.wt;
    }
  });

  it('the lineup timeline opens with both starting fives and tracks every substitution', () => {
    const subs = rep.events.filter((e) => e.type === 'substitution').length;
    // one snapshot per side at the game_start wt, then one per substitution
    expect(rep.lineups.length).toBe(2 + subs);
    expect(subs).toBeGreaterThanOrEqual(1); // the rotation exists in a default game
    const [s0, s1] = [rep.lineups[0]!, rep.lineups[1]!];
    expect([s0.side, s1.side].sort()).toEqual([0, 1]);
    for (const snap of [s0, s1]) {
      expect(snap.t).toBe(rep.events[0]!.wt);
      expect(snap.slots.length).toBe(5);
    }
    // every snapshot slot names a real roster player of its side
    for (const snap of rep.lineups) {
      const roster = rep.teams[snap.side].players.map((p) => p.id);
      expect(snap.slots.length).toBe(5);
      for (const id of snap.slots) expect(roster).toContain(id);
    }
  });

  it('the straight-copy fields survive the trim (seed, score, rules, team meta)', () => {
    expect(rep.seed).toBe('replay-pin-0');
    expect(rep.finalScore).toEqual(result.finalScore);
    // a 0-0 final is impossible (overtime until decided) — the zeroed
    // artifact cannot fake this
    expect(rep.finalScore[0] + rep.finalScore[1]).toBeGreaterThan(100);
    expect(rep.rules.id).toBe('nba');
    expect(rep.rules.periods).toBe(4);
    expect(rep.rules.periodMinutes).toBe(12);
    expect(rep.rules.courtLengthFt).toBe(94);
    expect(rep.teams[0].id).toBe(home.id);
    expect(rep.teams[1].id).toBe(away.id);
    for (const side of [0, 1] as const) {
      expect(rep.teams[side].players.length).toBeGreaterThanOrEqual(8);
      for (const p of rep.teams[side].players) {
        expect(typeof p.name).toBe('string');
        expect(p.heightIn).toBeGreaterThan(60);
      }
    }
  });
});
