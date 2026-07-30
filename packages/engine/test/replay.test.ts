/**
 * Replay artifact contract — replay/replay.ts. The Replay JSON shape and the
 * frame-row layout are consumed by the standalone viewer (AGENTS.md DO-NOT
 * §8: never change them silently; `Replay.version` is an externally saved
 * copy's ONLY way to detect a shape it predates). Before this file,
 * buildReplay had never been called by any test (findings coverage baseline:
 * replay.ts 69% line / 0% function coverage) — the whole shippable artifact
 * was guarded by nothing but an exit-0 CLI run.
 *
 * Every assertion derives from replay.ts's own JSDoc (the index-by-index
 * frame-row contract, the lineup-timeline fold semantics, the trim/reshape
 * promise) plus the two-time-axes doctrine (AGENTS §1.5, core/events.ts
 * Base doc). Frame monotonicity + full-game coverage are already pinned by
 * invariants.test.ts and are NOT duplicated here.
 *
 * Budget: exactly ONE game sim, and it is the expensive kind — frames ON
 * (buildReplay requires them). Seed 'replay-fmt-1' scouted 2026-07-30:
 * regulation game, 1188 events, 64 substitutions, 15120 frames, 15 multi-FT
 * trips (every one of them spanning >= 2 frames), ball excursions to
 * x -1.9..95.5 (out-of-bounds caroms are real, so coordinate asserts use an
 * envelope, not strict in-bounds).
 */
import { describe, expect, it } from 'vitest';
import {
  buildReplay,
  simulateGame,
  type FreeThrowEvent,
  type LineupSnapshot
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const { home, away } = sampleMatchup();
// collectFrames deliberately left at its default (true): frames ARE the subject.
const result = simulateGame({ seed: 'replay-fmt-1', home, away });
const replay = buildReplay(result);

describe('replay artifact identity (version discipline)', () => {
  // replay.ts:82-107 — version history: 2 is the current shape (optional
  // ReboundEvent.player + deadBall?, TimeoutEvent in the union,
  // FreeThrowEvent.oneAndOne?). AGENTS DO-NOT §8: a shape change without a
  // bump here is the incident class this field exists to prevent.
  it('stamps version 2, the current shape', () => {
    expect(replay.version).toBe(2);
  });

  // Replay interface (replay.ts:82-123) — seed, finalScore, events and
  // frames are carried verbatim so the artifact replays the exact game.
  it('echoes the seed, final score, event stream and frames of its GameResult', () => {
    expect(replay.seed).toBe(result.seed);
    expect(replay.finalScore).toEqual(result.finalScore);
    expect(replay.events).toEqual(result.events);
    expect(replay.frames).toEqual(result.frames);
  });

  // Replay.rules (replay.ts:109-117) — exactly the seven viewer-facing rule
  // fields, values matching the pack the game ran under. "Exactly" matters
  // both ways: a missing field starves the viewer, an extra one silently
  // widens the shippable surface without a version bump.
  it('rules carries exactly the seven documented viewer-facing fields', () => {
    expect(Object.keys(replay.rules).sort()).toEqual([
      'courtLengthFt', 'courtWidthFt', 'id', 'periodMinutes', 'periods', 'rimInsetFt', 'three'
    ]);
    expect(Object.keys(replay.rules.three).sort()).toEqual([
      'arcRadiusFt', 'cornerBreakFt', 'cornerDistFt'
    ]);
    expect(replay.rules.id).toBe(result.rules.id);
    expect(replay.rules.courtLengthFt).toBe(result.rules.courtLengthFt);
    expect(replay.rules.courtWidthFt).toBe(result.rules.courtWidthFt);
    expect(replay.rules.rimInsetFt).toBe(result.rules.rimInsetFt);
    expect(replay.rules.periods).toBe(result.rules.periods);
    expect(replay.rules.periodMinutes).toBe(result.rules.periodMinutes);
    expect(replay.rules.three).toEqual(result.rules.three);
  });
});

describe('team & player meta — a viewer renders with no engine access', () => {
  // ReplayTeamMeta (replay.ts:66-71): id/name/abbrev per side, home first.
  it('mirrors both teams: id, name, abbrev, full roster, in [home, away] order', () => {
    for (const side of [0, 1] as const) {
      const meta = replay.teams[side];
      const team = result.teams[side];
      expect(meta.id).toBe(team.id);
      expect(meta.name).toBe(team.name);
      expect(meta.abbrev).toBe(team.abbrev);
      expect(meta.players.length).toBe(team.players.length);
      expect(meta.players.map((p) => p.id)).toEqual(team.players.map((p) => p.id));
    }
  });

  // replay.ts:59-64 + :125-144 — buildReplay is "the trim/reshape step":
  // player meta is exactly {id, name, pos, heightIn}. Ratings/tendencies
  // must never ship inside the artifact.
  it('player meta is trimmed to exactly {id, name, pos, heightIn} — no ratings leak', () => {
    let players = 0;
    for (const side of [0, 1] as const) {
      for (const p of replay.teams[side].players) {
        players++;
        expect(Object.keys(p).sort()).toEqual(['heightIn', 'id', 'name', 'pos']);
        expect(typeof p.name).toBe('string');
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.heightIn).toBeGreaterThan(0);
      }
    }
    expect(players).toBeGreaterThanOrEqual(10); // two full rosters
  });

  // Replay doc (replay.ts:81) — "self-contained ... sufficient on its own to
  // render a full game": every player id the embedded events reference must
  // resolve in the meta, or the viewer shows unnamed actors.
  it('every player id referenced by the events resolves in the meta', () => {
    const known = new Set<string>();
    for (const t of replay.teams) for (const p of t.players) known.add(p.id);
    const unresolved: string[] = [];
    let referenced = 0;
    const check = (id: unknown) => {
      if (typeof id !== 'string') return;
      referenced++;
      if (!known.has(id)) unresolved.push(id);
    };
    for (const e of replay.events) {
      const r = e as unknown as Record<string, unknown>;
      for (const k of ['shooter', 'player', 'from', 'to', 'on', 'stolenBy',
        'assist', 'blockedBy', 'contestedBy', 'drawnBy']) check(r[k]);
      if (e.type === 'substitution') for (const id of [...e.out, ...e.in]) check(id);
      if (e.type === 'game_start') {
        for (const id of [...e.home.lineup, ...e.away.lineup]) check(id);
      }
    }
    expect(unresolved).toEqual([]);
    expect(referenced).toBeGreaterThan(1000); // a real game names actors constantly
  });
});

describe('lineup timeline (LineupSnapshot[])', () => {
  // replay.ts:145-170 comment + LineupSnapshot doc (replay.ts:73-79): fold
  // game_start's two starting fives, then each substitution replaces out[i]
  // with in[i] IN PLACE (slot-stable — slot index i is holderSlot i / 5+i),
  // pushing one snapshot per change, keyed on the source event's wt.
  // events.ts:119-120 — "LineupSnapshot.t is copied from event wt and does
  // match exactly" (the ONE exact join between events and the replay
  // timeline). This re-derives the whole timeline from the documented fold
  // and demands deep equality.
  it('folds game_start + substitutions into a slot-stable, wt-keyed timeline', () => {
    const expected: LineupSnapshot[] = [];
    const running: [string[], string[]] = [[], []];
    for (const e of replay.events) {
      if (e.type === 'game_start') {
        running[0] = [...e.home.lineup];
        running[1] = [...e.away.lineup];
        expected.push({ t: e.wt, side: 0, slots: [...running[0]] });
        expected.push({ t: e.wt, side: 1, slots: [...running[1]] });
      } else if (e.type === 'substitution') {
        const slots = running[e.team];
        for (let i = 0; i < e.out.length; i++) {
          const at = slots.indexOf(e.out[i]!);
          if (at !== -1 && e.in[i]) slots[at] = e.in[i]!;
        }
        expected.push({ t: e.wt, side: e.team, slots: [...slots] });
      }
    }
    expect(replay.lineups).toEqual(expected);
  });

  // replay.ts:148-149 — "start from the game_start event's two starting
  // fives (one snapshot per side, both at t = game start)".
  it('opens with both starting fives at the game_start wall-clock stamp', () => {
    const gs = replay.events[0]!;
    expect(gs.type).toBe('game_start');
    if (gs.type !== 'game_start') return;
    expect(replay.lineups[0]).toEqual({ t: gs.wt, side: 0, slots: gs.home.lineup });
    expect(replay.lineups[1]).toEqual({ t: gs.wt, side: 1, slots: gs.away.lineup });
  });

  // replay.ts:150-152 — one snapshot per substitution event; and every
  // snapshot is a legal five (a viewer draws exactly 5 bodies per side).
  it('adds exactly one snapshot per substitution, each a legal five', () => {
    const subs = replay.events.filter((e) => e.type === 'substitution').length;
    expect(replay.lineups.length).toBe(2 + subs);
    expect(subs).toBeGreaterThanOrEqual(10); // scouted 64 — rotations are real
    for (const snap of replay.lineups) {
      expect(snap.slots.length).toBe(5);
      expect(new Set(snap.slots).size).toBe(5);
      expect([0, 1]).toContain(snap.side);
    }
  });
});

describe('frame rows: [t, period, clock, ballX, ballY, holderSlot, 10x(x,y)]', () => {
  // replay.ts:6-8 — the row is exactly 26 numbers.
  it('every row is exactly 26 finite numbers', () => {
    let bad = 0;
    for (const row of replay.frames) {
      if (row.length !== 26) bad++;
      for (const v of row) if (!Number.isFinite(v)) bad++;
    }
    expect(bad).toBe(0);
    expect(replay.frames.length).toBeGreaterThan(1000); // a full game of frames
  });

  // replay.ts:11-17 — frame [0] is WALL-clock seconds at 1-decimal rounding
  // (`round1(s.wallT)`) — deliberately a different rounding than events' 2dp
  // wt (events.ts:117-119: an equality join must fail; sync by ordering).
  it('frame [0] is wall-clock at 1-decimal rounding', () => {
    let bad = 0;
    for (const row of replay.frames) {
      if (Math.round(row[0]! * 10) / 10 !== row[0]) bad++;
    }
    expect(bad).toBe(0);
  });

  // replay.ts:25-29 — holderSlot is 0-4 home, 5-9 away, or -1 for a loose /
  // in-flight ball. Both states must actually occur (passes and shots put
  // the ball in the air constantly).
  it('holderSlot [5] is -1 or an on-court slot 0..9, and both states occur', () => {
    let loose = 0;
    let held = 0;
    let bad = 0;
    for (const row of replay.frames) {
      const h = row[5]!;
      if (!Number.isInteger(h) || h < -1 || h > 9) bad++;
      if (h === -1) loose++;
      else held++;
    }
    expect(bad).toBe(0);
    expect(loose).toBeGreaterThanOrEqual(100); // scouted 3675
    expect(held).toBeGreaterThanOrEqual(100); // scouted 11445
  });

  // replay.ts:18-22 — [1] is the 1-based period (matches Base.period, so it
  // never runs backwards); [2] is game-clock seconds remaining, clamped
  // >= 0, and can never exceed the period's length (rulepack
  // periodMinutes/otMinutes — read from result.rules, not literals).
  it('period [1] is 1-based and non-decreasing; clock [2] stays in [0, period length]', () => {
    let bad = 0;
    let prevPeriod = 1;
    for (const row of replay.frames) {
      const period = row[1]!;
      const clock = row[2]!;
      if (!Number.isInteger(period) || period < 1 || period < prevPeriod) bad++;
      prevPeriod = period;
      const capSec =
        (period <= result.rules.periods ? result.rules.periodMinutes : result.rules.otMinutes) * 60;
      if (clock < 0 || clock > capSec) bad++;
    }
    expect(bad).toBe(0);
  });

  // replay.ts:23-35 — ball and player coordinates live in the court's
  // coordinate frame (court feet, dims in replay.rules). The contract fixes
  // the coordinate SYSTEM, not strict in-bounds-ness: out-of-bounds passes
  // and caroms legitimately take the BALL outside the lines (scouted ball
  // range x -1.9..95.5 on the 94ft court), so this is a render-sanity
  // envelope (court ± 6 ft) — it catches a scrambled row layout (a clock or
  // wt value in a coordinate slot), not centimeter physics.
  it('all coordinate slots stay in a court-sized envelope', () => {
    const maxX = replay.rules.courtLengthFt + 6;
    const maxY = replay.rules.courtWidthFt + 6;
    let bad = 0;
    for (const row of replay.frames) {
      // x slots: 3 (ball), 6,8,..,24 (players); y slots: 4 (ball), 7,9,..,25.
      if (row[3]! < -6 || row[3]! > maxX || row[4]! < -6 || row[4]! > maxY) bad++;
      for (let i = 6; i < 26; i += 2) {
        if (row[i]! < -6 || row[i]! > maxX) bad++;
        if (row[i + 1]! < -6 || row[i + 1]! > maxY) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  // replay.ts:37-39 — "Frames are recorded on a fixed WALL-CLOCK cadence
  // (`frameEvery` sim ticks at `tickHz`)". Every gap is at least one step
  // (the forced final frame may land closer — excluded, per the same doc).
  // Step read from result.params so a cadence re-tune re-aims this test.
  it('frames advance on the fixed wall-clock cadence', () => {
    const step = result.params.frameEvery / result.params.tickHz;
    expect(step).toBeGreaterThan(0);
    let bad = 0;
    for (let i = 1; i < replay.frames.length - 1; i++) {
      const gap = replay.frames[i]![0]! - replay.frames[i - 1]![0]!;
      if (gap < step * 0.999) bad++;
    }
    expect(bad).toBe(0);
  });

  // replay.ts:19-22 — "[2] ... Frozen across consecutive frames during a
  // dead-ball stoppage even though [0] keeps advancing — that's expected,
  // not a bug." AGENTS §1.5: frames key on wallT, which advances through
  // stoppages; the game clock does not. Free-throw trips are the guaranteed
  // stoppage: between a trip's first and last attempt the frames must show
  // a frozen [2] under a rising [0].
  it('the game clock [2] freezes across free-throw stoppages while wall-clock [0] advances', () => {
    // group free throws into trips (a trip starts at n === 1)
    const trips: FreeThrowEvent[][] = [];
    for (const e of replay.events) {
      if (e.type !== 'free_throw') continue;
      if (e.n === 1) trips.push([e]);
      else trips[trips.length - 1]!.push(e);
    }
    let windows = 0;
    let bad = 0;
    for (const trip of trips) {
      if (trip.length < 2) continue;
      const from = trip[0]!.wt;
      const to = trip[trip.length - 1]!.wt;
      const win = replay.frames.filter((row) => row[0]! >= from && row[0]! <= to);
      if (win.length < 2) continue;
      windows++;
      for (let i = 1; i < win.length; i++) {
        if (win[i]![2] !== win[0]![2]) bad++; // game clock moved during the trip
        if (!(win[i]![0]! > win[i - 1]![0]!)) bad++; // wall clock stalled
      }
    }
    expect(bad).toBe(0);
    expect(windows).toBeGreaterThanOrEqual(10); // scouted 15/15 trips span >=2 frames
  });

  // AGENTS §1.5 + replay.ts:11-17 — wallT advances during EVERY tick,
  // stoppages included, so the replay timeline is strictly longer than the
  // basketball played: the last frame's wall-clock exceeds the total
  // game-clock seconds of all periods played.
  it('the replay timeline outruns the game clock: last frame [0] > total game-clock seconds', () => {
    const lastEvent = replay.events[replay.events.length - 1]!;
    const played = Math.max(result.rules.periods, lastEvent.period);
    const gameClockTotal =
      result.rules.periods * result.rules.periodMinutes * 60 +
      Math.max(0, played - result.rules.periods) * result.rules.otMinutes * 60;
    const lastFrame = replay.frames[replay.frames.length - 1]!;
    expect(lastFrame[0]).toBeGreaterThan(gameClockTotal);
  });
});
