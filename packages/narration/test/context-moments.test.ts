/**
 * Spec-derived unit tests for narration/context.ts' ContextTracker.
 *
 * Expectations come from the module's taxonomy JSDoc (post release-audit):
 * run bars at 8/12/16 UNANSWERED points detected as a >= crossing with a
 * fired-bar memory (runBarHit), so a three can JUMP a bar and still fire it
 * once, with `detail` carrying the TRUE unanswered total at the crossing
 * (audit M-36); opponent scoring is the only thing that clears a run
 * counter, and the fired-bar memory resets with it; player milestones
 * 20/30/40/50 fire once per player per game via the lastMs guard;
 * lead_change/tie are suppressed on the very first score (-1 sentinel) and a
 * tie preserves the last real leader; clutch_start is a once-per-game latch
 * keyed on the constructor's regulation period count. Narration is the
 * maintained template layer (context.ts header, audit L-33 — the FROZEN
 * PROTOTYPE label belongs to the viewer, not this package).
 *
 * Complements context.test.ts (the audit's own M-36 exhibits): that file
 * pins crossing mechanics on the 8/12 bars and the rendered article; this
 * one covers the full bar ladder in one run (jump and exact landings mixed,
 * through 16), both sides' reset bookkeeping, milestones, lead/tie ordering,
 * clutch bounds, and a real-game cross-consumer fold.
 *
 * All streams are hand-built (AGENTS.md §2.3: consumers fold events, tests
 * must not re-derive game logic) and stamp both time axes plus
 * period/clock/score per core/events.ts Base.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { ContextTracker, type NarrativeMoment } from '@hoopsh/narration';
import { boxScore } from '@hoopsh/stats';

const { home, away } = sampleMatchup();
const H0 = home.players[0]!.id;
const H1 = home.players[1]!.id;
const A0 = away.players[0]!.id;

type Score = [number, number];

// event builders — real roster ids, honest base-field stamps
const make = (team: 0 | 1, shooter: string, points: 2 | 3, t: number, score: Score): GameEvent =>
  ({
    type: 'shot', team, shooter, x: 10, y: 25,
    distFt: points === 3 ? 24 : 4, zone: points === 3 ? 'three' : 'rim',
    three: points === 3, moveType: points === 3 ? 'catch_shoot' : 'drive',
    contest: 0.3, made: true, points,
    t, wt: t + 10, period: 1, clock: 600, score
  } as GameEvent);

const ft = (team: 0 | 1, shooter: string, made: boolean, t: number, score: Score): GameEvent =>
  ({ type: 'free_throw', team, shooter, n: 1, of: 2, made, t, wt: t + 10, period: 1, clock: 600, score } as GameEvent);

const reb = (t: number, score: Score, period: number, clock: number): GameEvent =>
  ({ type: 'rebound', team: 0, player: H1, offensive: false, x: 30, y: 20, t, wt: t + 10, period, clock, score } as GameEvent);

const feed = (tracker: ContextTracker, events: GameEvent[]): NarrativeMoment[] => {
  const out: NarrativeMoment[] = [];
  for (const e of events) out.push(...tracker.update(e));
  return out;
};

describe('scoring runs (spec: context.ts taxonomy — 8/12/16 unanswered, >= bar crossings, reset only on opponent score)', () => {
  it('fires run moments at exactly 8, then 12, then 16 unanswered points', () => {
    // spec: "one team's UNANSWERED points reach or cross the 8, 12, then 16
    // bars … an 8-0 run that continues to 16-0 produces three moments (one
    // per bar)". Eight made twos land exactly on every bar, so the reported
    // true totals coincide with the bar values — a regression guard for the
    // >= crossing (a strict-> bug would silence exact landings).
    const tracker = new ContextTracker();
    const events = Array.from({ length: 8 }, (_, i) =>
      make(0, H0, 2, 10 * (i + 1), [2 * (i + 1), 0]));
    const runs = feed(tracker, events).filter((m) => m.kind === 'run');
    expect(runs.map((m) => m.detail)).toEqual(['8-0 run', '12-0 run', '16-0 run']);
    expect(runs.map((m) => m.team)).toEqual([0, 0, 0]);
    expect(tracker.currentRun(0)).toBe(16);
    expect(tracker.currentRun(1)).toBe(0);
  });

  it('a three jumping the counter from 6 to 9 fires the 8 bar with the true total; 12 exact and a 16 jump each fire once more', () => {
    // spec: context.ts run comment — ">= crossing with the fired-bar memory,
    // NOT exact equality: a three jumps a bar outright (6 -> 9 passes 8
    // without ever equaling it)" and detail "states the true unanswered
    // total at the crossing" (audit M-36). Full ladder in ONE run — jump
    // (9), exact landing (12), silent between-bars step (14: both lower
    // bars spent), jump past 16 (17) — the 16 bar at moment level, which
    // context.test.ts's 8/12-bar exhibits stop short of.
    const tracker = new ContextTracker();
    const events = [
      make(0, H0, 2, 10, [2, 0]),
      make(0, H1, 2, 20, [4, 0]),
      make(0, H0, 2, 30, [6, 0]),
      make(0, H1, 3, 40, [9, 0]),   // 6 -> 9 jumps the 8 bar: fires, total 9
      make(0, H0, 3, 50, [12, 0]),  // 9 -> 12 lands exactly on the 12 bar
      make(0, H1, 2, 60, [14, 0]),  // 12 -> 14: 8 and 12 spent, 16 unreached — silent
      make(0, H0, 3, 70, [17, 0])   // 14 -> 17 jumps the 16 bar: fires, total 17
    ];
    const runs = feed(tracker, events).filter((m) => m.kind === 'run');
    expect(runs.map((m) => m.detail)).toEqual(['9-0 run', '12-0 run', '17-0 run']);
    expect(runs.map((m) => m.team)).toEqual([0, 0, 0]);
    expect(tracker.currentRun(0)).toBe(17);
  });

  it('an opponent basket clears only the side being scored on; the answering run restarts from zero', () => {
    // spec: context.ts run comment — "credit the scoring team, then zero the
    // OTHER team's counter … a team's own basket never clears its own tally",
    // and "The opponent's fired-bar memory resets with their run: their next
    // run starts announcing from the 8 bar again" (runBarHit, audit M-36).
    const tracker = new ContextTracker();
    feed(tracker, [
      make(0, H0, 2, 10, [2, 0]),
      make(0, H1, 2, 20, [4, 0]),
      make(0, H0, 2, 30, [6, 0])
    ]);
    expect(tracker.currentRun(0)).toBe(6);
    feed(tracker, [make(1, A0, 2, 40, [6, 2])]); // answer breaks the run
    expect(tracker.currentRun(1)).toBe(2);       // scorer's own counter survives its basket
    expect(tracker.currentRun(0)).toBe(0);
    // a fresh 8-0 burst after the reset fires the 8 bar again
    const runs = feed(tracker, Array.from({ length: 4 }, (_, i) =>
      make(0, H0, 2, 50 + 10 * i, [8 + 2 * i, 2]))).filter((m) => m.kind === 'run');
    expect(runs.map((m) => m.detail)).toEqual(['8-0 run']);
  });

  it('made free throws feed runs and pointsFor; unknown ids read 0', () => {
    // spec: context.ts update() — a made free throw scores 1 for the shooter;
    // pointsFor/currentRun are the public accessors (coverage baseline:
    // context.ts 180-185 unexecuted before this suite).
    const tracker = new ContextTracker();
    feed(tracker, [
      make(0, H0, 2, 10, [2, 0]),
      make(0, H0, 3, 20, [5, 0]),
      ft(0, H0, true, 30, [6, 0]),
      ft(0, H0, false, 31, [6, 0]) // a miss scores nothing
    ]);
    expect(tracker.pointsFor(H0)).toBe(6);
    expect(tracker.currentRun(0)).toBe(6);
    expect(tracker.pointsFor('nobody-9')).toBe(0);
  });
});

describe('player milestones (spec: context.ts taxonomy — 20/30/40/50 once per player, >= crossing)', () => {
  it('crossing 20 fires once; later baskets re-fire nothing until 30', () => {
    // spec: "a player crosses 20/30/40/50 total points … each threshold
    // firing once per game per player (milestonesHit … guards against
    // re-firing on every subsequent basket past the bar)".
    const tracker = new ContextTracker();
    // 10 twos -> exactly 20, then 4 more twos (28: silent), then one more (30)
    const events = Array.from({ length: 15 }, (_, i) =>
      make(0, H0, 2, 10 * (i + 1), [2 * (i + 1), 0]));
    const ms = feed(tracker, events).filter((m) => m.kind === 'milestone');
    expect(ms.map((m) => m.detail)).toEqual(['20+ points', '30+ points']);
    expect(ms.map((m) => m.playerId)).toEqual([H0, H0]);
    expect(tracker.pointsFor(H0)).toBe(30);
  });

  it('a three jumping from 19 to 22 still crosses the 20 bar', () => {
    // spec: context.ts milestone comment — "the check is pts >= bar (not
    // ===), so a player jumping from 19 to 22 on a three still crosses the
    // 20 bar correctly".
    const tracker = new ContextTracker();
    const to19 = [
      ...Array.from({ length: 8 }, (_, i) => make(0, H0, 2, 10 * (i + 1), [2 * (i + 1), 0])),
      make(0, H0, 3, 90, [19, 0])
    ];
    expect(feed(tracker, to19).filter((m) => m.kind === 'milestone')).toEqual([]);
    const crossing = feed(tracker, [make(0, H0, 3, 100, [22, 0])])
      .filter((m) => m.kind === 'milestone');
    expect(crossing.length).toBe(1);
    expect(crossing[0]!.detail).toBe('20+ points');
    // and the bucket after the jump is silent again
    expect(feed(tracker, [make(0, H0, 2, 110, [24, 0])])
      .filter((m) => m.kind === 'milestone')).toEqual([]);
  });
});

describe('lead changes and ties (spec: context.ts taxonomy — first-score suppression, tie preserves the leader)', () => {
  it('scripted sequence: first lead silent, tie fires, retaken lead silent, real flip fires', () => {
    // spec: "lead_change … there WAS a clear leader immediately before
    // (excludes the very first bucket)"; "tie: the score becomes even after
    // having had a clear leader"; "a tie deliberately leaves lastLeader
    // pointing at whoever led just before … retaking the lead … is correctly
    // NOT flagged". Sequence from findings/spec-consumers.md.
    const tracker = new ContextTracker();
    const first = tracker.update(make(0, H0, 2, 10, [2, 0]));   // 2-0: unremarkable first lead
    expect(first).toEqual([]);
    const tie = tracker.update(make(1, A0, 2, 20, [2, 2]));     // 2-2: tie after a real leader
    expect(tie.map((m) => m.kind)).toEqual(['tie']);
    expect(tie[0]!.detail).toBe('tied at 2');
    const retake = tracker.update(make(0, H1, 2, 30, [4, 2]));  // 4-2: same leader returns
    expect(retake).toEqual([]);
    const flip = tracker.update(make(1, A0, 3, 40, [4, 5]));    // 4-5: a real lead change
    expect(flip.map((m) => m.kind)).toEqual(['lead_change']);
    expect(flip[0]!.team).toBe(1);
  });
});

describe('clutch_start (spec: context.ts taxonomy — once-per-game latch, any event type, OT qualifies)', () => {
  it('fires on a non-scoring event entering the window, and never again', () => {
    // spec: "fires exactly once per game … checked unconditionally on every
    // event (not just scored ones)" — the clutchAnnounced latch.
    const tracker = new ContextTracker();
    const first = tracker.update(reb(2700, [80, 78], 4, 150));
    expect(first.map((m) => m.kind)).toEqual(['clutch_start']);
    expect(tracker.update(reb(2710, [80, 78], 4, 140))).toEqual([]);
    expect(tracker.update(make(0, H0, 2, 2720, [82, 78]))
      .filter((m) => m.kind === 'clutch_start')).toEqual([]);
    expect(tracker.moments.filter((m) => m.kind === 'clutch_start').length).toBe(1);
  });

  it('window bounds are inclusive: clock 180 and margin 6 qualify; 181 and 7 do not, nor a non-final period', () => {
    // spec: "clock at or under 3:00 AND the margin at or under 6 points",
    // period >= regulation count.
    expect(new ContextTracker().update(reb(2700, [6, 0], 4, 180))
      .map((m) => m.kind)).toEqual(['clutch_start']);
    expect(new ContextTracker().update(reb(2700, [7, 0], 4, 180))).toEqual([]);   // margin 7
    expect(new ContextTracker().update(reb(2700, [6, 0], 4, 181))).toEqual([]);   // 3:01 left
    expect(new ContextTracker().update(reb(1500, [6, 0], 3, 100))).toEqual([]);   // period 3 of 4
  });

  it('overtime qualifies, and a halves ruleset reaches clutch in period 2 via the constructor count', () => {
    // spec: "period >= the ruleset's regulation period count, so overtime
    // qualifies too"; "the period count is a constructor input (default 4
    // …) because final period is 2 under a halves ruleset".
    expect(new ContextTracker().update(reb(3000, [100, 98], 5, 100))
      .map((m) => m.kind)).toEqual(['clutch_start']);
    expect(new ContextTracker(2).update(reb(2250, [60, 58], 2, 150))
      .map((m) => m.kind)).toEqual(['clutch_start']);
    expect(new ContextTracker().update(reb(2250, [60, 58], 2, 150))).toEqual([]); // NBA default: Q2 is not final
  });
});

describe('ContextTracker over a real game agrees with the box-score fold (cross-consumer check)', () => {
  // One seeded sim for realism at scale (deterministic per AGENTS.md §1.2 —
  // same seed, bit-identical events). Both consumers fold the SAME stream:
  // the tracker's per-player points must match boxScore's pts column exactly,
  // since both are defined as made shots plus made free throws.
  const result = simulateGame({ seed: 'ctx-real-1', home, away, collectFrames: false });
  const tracker = new ContextTracker(result.rules.periods);
  const fresh: NarrativeMoment[] = [];
  for (const e of result.events) fresh.push(...tracker.update(e));
  const box = boxScore(result.events, [home, away]);

  it('pointsFor matches every player boxScore pts line', () => {
    // spec: AGENTS.md §1.3 — box scores are reconstructible from events
    // alone; context.ts scores the same shot/free_throw events.
    expect(box.players.some((p) => p.pts > 0)).toBe(true); // vacuity floor
    for (const p of box.players) {
      expect(tracker.pointsFor(p.id)).toBe(p.pts);
    }
  });

  it('moments accumulate exactly the per-update fresh returns, with valid kinds and bars', () => {
    // spec: update() JSDoc — "returns moments newly created by this event";
    // the moments field is the running accumulation of those.
    expect(fresh.length).toBeGreaterThan(0); // vacuity floor
    expect(tracker.moments).toEqual(fresh);
    expect(tracker.moments.filter((m) => m.kind === 'clutch_start').length).toBeLessThanOrEqual(1);
    expect(tracker.moments.filter((m) => m.kind === 'run').length).toBeGreaterThan(0); // vacuity floor for the bar check
    for (const m of tracker.moments) {
      if (m.kind === 'run') {
        // spec: detail is the TRUE unanswered total at a >= crossing of the
        // 8/12/16 bars (audit M-36). No scoring event is worth more than 3
        // and the bars sit 4 apart, so one event crosses at most one bar and
        // a crossing total lands on bar..bar+2 — nine reachable details, not
        // the old exact-landing three.
        const total = Number(/^(\d+)-0 run$/.exec(m.detail)?.[1]);
        expect([8, 9, 10, 12, 13, 14, 16, 17, 18]).toContain(total);
      }
      if (m.kind === 'milestone') {
        // milestone detail still names the BAR (the true-total phrasing is
        // pbp.ts renderMoment's job, audit H-08 — not the tracker's)
        expect(['20+ points', '30+ points', '40+ points', '50+ points']).toContain(m.detail);
      }
    }
  });
});
