/**
 * Spec-derived tests for narration/broadcast.ts (buildBroadcastScript
 * windowing, cue merge, formatScript rendering) and the provider contract in
 * narration/provider.ts (CommentaryWindow payload, TemplateColorProvider
 * moment dispatch).
 *
 * Expectations come from the modules' own JSDoc: a window flushes at the
 * FIRST of size (windowEvents, default 24) / period_end / detected moment,
 * and the trailing buffer always flushes; at a shared timestamp the pbp cue
 * sorts before the color cue; storylines is the UNWIRED continuity channel
 * and stays [] for the whole script. TemplateColorProvider: empty window
 * yields nothing; run/milestone/clutch_start each yield one templated line;
 * lead_change/tie yield no color (pbp renders those). Cross-checked against
 * the reference implementation in examples/05-commentary-provider.ts.
 * Narration is a FROZEN prototype — these pin current behavior.
 *
 * OT period labels are already covered by pbp.test.ts and are deliberately
 * not re-pinned here (findings/map.md MEDIUM-6).
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import {
  buildBroadcastScript, ContextTracker, formatScript, generatePlayByPlay, TemplateColorProvider,
  type BroadcastCue, type ColorLine, type CommentaryProvider, type CommentaryWindow, type NarrativeMoment
} from '@hoopsh/narration';

const { home, away } = sampleMatchup();
const teams: [typeof home, typeof away] = [home, away];
const H0 = home.players[0]!.id;
const H1 = home.players[1]!.id;

type Score = [number, number];

// hand-built events with honest base stamps (core/events.ts Base) and real
// roster ids so pbp name lookup resolves
const reb = (t: number, clock: number, score: Score = [0, 0], period = 1): GameEvent =>
  ({ type: 'rebound', team: 0, player: H1, offensive: false, x: 30, y: 20, t, wt: t + 5, period, clock, score } as GameEvent);

const make2 = (t: number, score: Score): GameEvent =>
  ({
    type: 'shot', team: 0, shooter: H0, x: 88, y: 25, distFt: 3, zone: 'rim', three: false,
    moveType: 'drive', contest: 0.3, made: true, points: 2, t, wt: t + 5, period: 1, clock: 700 - t, score
  } as GameEvent);

const periodEnd = (t: number, clock: number, score: Score, period = 1): GameEvent =>
  ({ type: 'period_end', t, wt: t + 5, period, clock, score } as GameEvent);

// recording provider: captures every CommentaryWindow, optionally replies
function recorder(received: CommentaryWindow[], reply: (w: CommentaryWindow) => ColorLine[] = () => []): CommentaryProvider {
  return {
    name: 'recorder',
    async generate(w: CommentaryWindow): Promise<ColorLine[]> {
      received.push(w);
      return reply(w);
    }
  };
}

describe('buildBroadcastScript windowing (spec: broadcast.ts windowing comment)', () => {
  it('size boundary chunks a quiet stream at windowEvents, and the remainder flushes trailing', async () => {
    // spec: boundary 1 — "buffer reaches windowEvents … events"; plus the
    // trailing-buffer flush. 10 no-moment events at windowEvents 4 -> 4,4,2.
    const events = Array.from({ length: 10 }, (_, i) => reb(10 + 10 * i, 700 - 10 * i));
    const received: CommentaryWindow[] = [];
    await buildBroadcastScript(events, teams, recorder(received), { seed: 'bcast-w1', windowEvents: 4 });
    expect(received.map((w) => w.events.length)).toEqual([4, 4, 2]);
    // window payload contract (spec: provider.ts CommentaryWindow — score/
    // period/clock at window end, full teams, storylines threaded through):
    for (const w of received) {
      const last = w.events[w.events.length - 1]!;
      expect(w.score).toEqual(last.score);
      expect(w.period).toBe(last.period);
      expect(w.clock).toBe(last.clock);
      expect(w.teams[0]).toBe(home);
      expect(w.teams[1]).toBe(away);
      expect(w.storylines).toEqual([]); // UNWIRED channel stays empty (broadcast.ts)
    }
  });

  it('the default window size is 24 events', async () => {
    // spec: "buffer reaches windowEvents (default 24)". 25 quiet events with
    // no explicit windowEvents must split [24, 1]; 23 or 25 defaults go red.
    const events = Array.from({ length: 25 }, (_, i) => reb(10 + 5 * i, 700 - 5 * i));
    const received: CommentaryWindow[] = [];
    await buildBroadcastScript(events, teams, recorder(received), { seed: 'bcast-w2' });
    expect(received.map((w) => w.events.length)).toEqual([24, 1]);
  });

  it('a period_end forces an early flush so color never straddles the break', async () => {
    // spec: boundary 2 — "the event is a period_end, so color commentary
    // never straddles a quarter break".
    const events = [
      reb(10, 700), reb(20, 690),
      periodEnd(720, 0, [0, 0]),
      reb(730, 700, [0, 0], 2), reb(740, 690, [0, 0], 2), reb(750, 680, [0, 0], 2)
    ];
    const received: CommentaryWindow[] = [];
    await buildBroadcastScript(events, teams, recorder(received), { seed: 'bcast-w3', windowEvents: 100 });
    expect(received.map((w) => w.events.length)).toEqual([3, 3]);
    expect(received[0]!.events[2]!.type).toBe('period_end');
    expect(received[0]!.clock).toBe(0); // stamped from the boundary event
  });

  it('a detected moment forces an immediate flush carrying that moment; the trailing window carries none', async () => {
    // spec: boundary 3 — "a narrative moment … was just detected, so color
    // commentary can react … IMMEDIATELY"; trailing flush passes moments: [].
    // Four made twos land exactly on the 8-0 run bar at the 4th event.
    const events = [
      make2(10, [2, 0]), make2(20, [4, 0]), make2(30, [6, 0]), make2(40, [8, 0]),
      reb(50, 650, [8, 0]), reb(60, 640, [8, 0])
    ];
    const received: CommentaryWindow[] = [];
    await buildBroadcastScript(events, teams, recorder(received), { seed: 'bcast-w4', windowEvents: 100 });
    expect(received.map((w) => w.events.length)).toEqual([4, 2]);
    expect(received[0]!.moments.length).toBe(1);
    expect(received[0]!.moments[0]!.kind).toBe('run');
    expect(received[1]!.moments).toEqual([]);
  });

  it('a short stream still reaches the provider once via the trailing flush', async () => {
    // spec: "flush the trailing buffer — … providers deserve to react to the
    // final buzzer".
    const events = Array.from({ length: 5 }, (_, i) => reb(10 + 10 * i, 700 - 10 * i));
    const received: CommentaryWindow[] = [];
    await buildBroadcastScript(events, teams, recorder(received), { seed: 'bcast-w5', windowEvents: 24 });
    expect(received.length).toBe(1);
    expect(received[0]!.events.length).toBe(5);
  });

  it('color lines returned from the trailing window land as cues stamped at the final event', async () => {
    // spec: the trailing flush hands providers the final-buzzer window and
    // their lines join the merged script like any other window's (broadcast.ts
    // trailing-flush comment; baseline-uncovered lines 110-111).
    const events = [reb(10, 700), reb(20, 690)];
    const reply = (w: CommentaryWindow): ColorLine[] =>
      [{ t: w.events[w.events.length - 1]!.t, speaker: 'color', text: 'final word' }];
    const cues = await buildBroadcastScript(events, teams, recorder([], reply), { seed: 'bcast-w8', windowEvents: 24 });
    const color = cues.filter((c) => c.speaker === 'color');
    expect(color.length).toBe(1);
    expect(color[0]!.t).toBe(20);
    expect(color[0]!.clock).toBe(690);   // stamped from the last buffered event
    expect(color[0]!.period).toBe(1);
    expect(color[0]!.text).toBe('final word');
    // the pbp-before-color tie-break holds for trailing-window lines too
    expect(cues.filter((c) => c.t === 20).map((c) => c.speaker)).toEqual(['pbp', 'color']);
  });

  it('an empty event stream produces no windows and no cues', async () => {
    // spec: the trailing flush is guarded by buffer.length > 0 — nothing to
    // react to, provider never called.
    const received: CommentaryWindow[] = [];
    const cues = await buildBroadcastScript([], teams, recorder(received), { seed: 'bcast-w6' });
    expect(received.length).toBe(0);
    expect(cues).toEqual([]);
  });

  it('at a shared timestamp the pbp call reads before the color reaction', async () => {
    // spec: broadcast.ts merge comment — tie on t resolves 'pbp' before
    // 'color', "the play call reads before the reaction". Provider replies at
    // exactly the boundary event's t (a rebound that renders a pbp line).
    const events = [reb(10, 700), reb(20, 690), reb(30, 680)];
    const received: CommentaryWindow[] = [];
    const reply = (w: CommentaryWindow): ColorLine[] =>
      [{ t: w.events[w.events.length - 1]!.t, speaker: 'color', text: 'color reaction' }];
    const cues = await buildBroadcastScript(events, teams, recorder(received, reply), { seed: 'bcast-w7', windowEvents: 3 });
    const at30 = cues.filter((c) => c.t === 30);
    expect(at30.map((c) => c.speaker)).toEqual(['pbp', 'color']);
    // color cues are stamped with the window-end period/clock (BroadcastCue shape)
    const color = at30[1]!;
    expect(color.period).toBe(1);
    expect(color.clock).toBe(680);
    expect(color.text).toBe('color reaction');
  });
});

describe('formatScript rendering (spec: broadcast.ts formatScript — "[label m:ss] SPEAKER: text" lines)', () => {
  it('renders period label, mm:ss clock with zero-padded seconds, and the speaker tag', () => {
    // spec: fmtClock floors to whole seconds and pads to two digits; labels
    // are Q<n> inside regulation (OT labels covered by pbp.test.ts).
    const cues: BroadcastCue[] = [
      { t: 0, period: 1, clock: 720, speaker: 'pbp', text: 'Tip.' },
      { t: 500, period: 2, clock: 65.9, speaker: 'color', text: 'Notes.' },
      { t: 2800, period: 4, clock: 5.4, speaker: 'pbp', text: 'Late.' }
    ];
    expect(formatScript(cues).split('\n')).toEqual([
      '[Q1 12:00] PBP: Tip.',
      '[Q2 1:05] COLOR: Notes.',
      '[Q4 0:05] PBP: Late.'
    ]);
  });

  it('formats an empty cue list as the empty string', () => {
    expect(formatScript([])).toBe('');
  });
});

describe('TemplateColorProvider (spec: provider.ts — moment-kind dispatch, empty-window guard)', () => {
  const provider = new TemplateColorProvider();
  const win = (moments: NarrativeMoment[], events: GameEvent[] = [reb(100, 600)]): CommentaryWindow =>
    ({ events, moments, score: [10, 8], period: 1, clock: 600, teams, storylines: [] });
  const moment = (partial: Partial<NarrativeMoment> & { kind: NarrativeMoment['kind'] }): NarrativeMoment =>
    ({ t: 100, period: 1, clock: 600, detail: '', ...partial });

  it('an empty window yields no lines, even when moments are attached', async () => {
    // spec: provider.ts empty-window guard — "bail before even looking at
    // w.moments".
    expect(await provider.generate(win([], []))).toEqual([]);
    expect(await provider.generate(win([moment({ kind: 'run', team: 0, detail: '8-0 run' })], []))).toEqual([]);
  });

  it('a run moment yields one line naming the running team, timestamped at the moment', async () => {
    // spec: provider dispatch — 'run' produces the momentum template for
    // w.teams[m.team] (examples/05 reacts to the same window shape).
    const lines = await provider.generate(win([moment({ kind: 'run', team: 0, detail: '8-0 run' })]));
    expect(lines.length).toBe(1);
    expect(lines[0]!.text).toContain(home.name);
    expect(lines[0]!.t).toBe(100);
    expect(lines[0]!.speaker).toBe('color');
  });

  it('a milestone names the player from the rosters, falling back to the raw id when unknown', async () => {
    // spec: provider dispatch — milestone looks the player up across both
    // teams "?? m.playerId".
    const known = await provider.generate(win([moment({ kind: 'milestone', team: 0, playerId: H0, detail: '20+ points' })]));
    expect(known.length).toBe(1);
    expect(known[0]!.text).toContain(home.players[0]!.name);
    const unknown = await provider.generate(win([moment({ kind: 'milestone', team: 0, playerId: 'ghost-9', detail: '20+ points' })]));
    expect(unknown[0]!.text).toContain('ghost-9');
  });

  it('clutch_start yields one line; lead_change and tie yield none (pbp already renders those)', async () => {
    // spec: provider dispatch comment — "only for run/milestone/clutch_start:
    // lead_change and tie moments produce no color line here".
    const clutch = await provider.generate(win([moment({ kind: 'clutch_start', detail: 'clutch time' })]));
    expect(clutch.length).toBe(1);
    expect(clutch[0]!.text.length).toBeGreaterThan(0);
    expect(await provider.generate(win([moment({ kind: 'lead_change', team: 0, detail: 'lead change' })]))).toEqual([]);
    expect(await provider.generate(win([moment({ kind: 'tie', detail: 'tied at 10' })]))).toEqual([]);
  });

  it('multiple dispatched moments in one window each yield their line', async () => {
    const lines = await provider.generate(win([
      moment({ kind: 'run', team: 1, detail: '12-0 run' }),
      moment({ kind: 'milestone', team: 1, playerId: away.players[0]!.id, detail: '30+ points' })
    ]));
    expect(lines.length).toBe(2);
    expect(lines[0]!.text).toContain(away.name);
    expect(lines[1]!.text).toContain(away.players[0]!.name);
  });
});

describe('buildBroadcastScript over a real game (windowing invariants at scale)', () => {
  // One seeded sim (deterministic per AGENTS.md §1.2); recorder returns no
  // color so every cue must be a pbp line.
  const result = simulateGame({ seed: 'bcast-real-1', home, away, collectFrames: false });

  it('windows partition the event stream in order, bounded by the default size, delivering every moment', async () => {
    const received: CommentaryWindow[] = [];
    const cues = await buildBroadcastScript(result.events, teams, recorder(received), {
      seed: 'bcast-real-1', periods: result.rules.periods
    });

    // partition: every event delivered exactly once, in stream order
    // (spec: buffer accumulates raw events, flushes, resets)
    expect(received.length).toBeGreaterThan(1); // vacuity floor
    const delivered = received.flatMap((w) => w.events);
    expect(delivered.length).toBe(result.events.length);
    expect(delivered.every((e, i) => e === result.events[i])).toBe(true);

    // every window is non-empty and no bigger than the default size boundary
    expect(received.every((w) => w.events.length >= 1 && w.events.length <= 24)).toBe(true);

    // moment delivery: the windows' moments are exactly what an independent
    // ContextTracker detects over the same stream, in order (spec: a moment
    // flushes its own window immediately, so none can be dropped)
    const tracker = new ContextTracker(result.rules.periods);
    const all: NarrativeMoment[] = [];
    for (const e of result.events) all.push(...tracker.update(e));
    expect(all.length).toBeGreaterThan(0); // vacuity floor
    expect(received.flatMap((w) => w.moments)).toEqual(all);

    // storylines stays [] for the whole script (spec: broadcast.ts UNWIRED
    // continuity channel — a future wiring must update this deliberately)
    expect(received.every((w) => w.storylines.length === 0)).toBe(true);

    // with no color lines, the cue list is exactly the pbp layer
    expect(cues.every((c) => c.speaker === 'pbp')).toBe(true);
    const pbp = generatePlayByPlay(result.events, teams, {
      seed: 'bcast-real-1', includeMoments: false, periods: result.rules.periods
    });
    expect(cues.length).toBe(pbp.length);
  });
});
