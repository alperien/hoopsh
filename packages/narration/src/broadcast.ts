/**
 * Broadcast script builder: merges play-by-play and color commentary into a
 * two-voice script — ready for text display or TTS rendering.
 *
 * FROZEN PROTOTYPE per project decision (docs/INTERNALS.md, ARCHITECTURE.md
 * §6): the reference example of wiring pbp.ts + a CommentaryProvider
 * (provider.ts) together into one merged script. The engine never depends on
 * this file — it only consumes `GameEvent`s already produced by a finished
 * sim (AGENTS.md §1.3/§6).
 */

import type { GameEvent, Team } from '@hoopsh/engine';
import { ContextTracker } from './context.js';
import { generatePlayByPlay, type NarrationLine } from './pbp.js';
import type { CommentaryProvider } from './provider.js';

export interface BroadcastCue {
  t: number;
  period: number;
  clock: number;
  speaker: 'pbp' | 'color';
  text: string;
}

export async function buildBroadcastScript(
  events: GameEvent[],
  teams: [Team, Team],
  provider: CommentaryProvider,
  opts?: { seed?: string; windowEvents?: number; periods?: number }
): Promise<BroadcastCue[]> {
  // PBP is generated in one pass up front via pbp.ts's own generator, with
  // `includeMoments: false` because moment TEXT ("X are on a run") is a PBP-
  // layer concern already handled by renderMoment() there — this function
  // only needs pbp.ts's play-call lines, and detects moments itself below
  // (via its own separate ContextTracker) to decide window boundaries.
  // `periods` (regulation period count; default 4) is forwarded to BOTH
  // consumers that need it — pbp's period labels and this function's own
  // tracker's clutch detection — because pbp.ts's comment warns exactly
  // this: a non-4-period ruleset that can't pass its count mis-renders
  // (scan finding B6-2: the broadcast pipeline made opts.periods
  // unreachable, so an NCAA script labeled OT "Q3").
  const pbp = generatePlayByPlay(events, teams, { seed: opts?.seed, includeMoments: false, periods: opts?.periods });
  const cues: BroadcastCue[] = pbp.map((l: NarrationLine) => ({
    t: l.t, period: l.period, clock: l.clock, speaker: 'pbp' as const, text: l.text
  }));

  // Windowing algorithm: raw events accumulate into `buffer` and a window
  // closes (flushes to the provider) at the FIRST of three boundaries:
  //   1. size    — buffer reaches `windowEvents` (default 24) events, so a
  //                quiet stretch of the game still gets color commentary at
  //                a bounded cadence rather than never flushing;
  //   2. period  — the event is a period_end, so color commentary never
  //                straddles a quarter break (each quarter's color reflects
  //                only that quarter's events);
  //   3. moment  — a narrative moment (run/milestone/lead_change/tie/
  //                clutch_start) was just detected, so color commentary can
  //                react to a big swing IMMEDIATELY rather than waiting up
  //                to `windowEvents` more events for the next size boundary.
  // Each flushed window is a fresh, independent call to `provider.generate()`
  // — this is the caller side of CommentaryProvider's stateless-per-window
  // design documented in provider.ts.
  const windowSize = opts?.windowEvents ?? 24;
  const tracker = new ContextTracker(opts?.periods);
  // STAGED/UNWIRED: threaded into every generate() call below so a provider
  // COULD read continuity notes left by an earlier window, but nothing in
  // this function ever pushes onto it — it stays `[]` for the whole script.
  // A provider that wants cross-window continuity today has to keep its own
  // internal state; this array is future surface for a caller (not yet
  // written) that extracts storyline notes from a provider's output.
  // UNWIRED — the continuity channel exists in the CommentaryProvider contract
  // but nothing populates it yet; wire it when an LLM provider starts carrying
  // narratives across windows (narration is frozen, so this waits with it)
  const storylines: string[] = [];
  let buffer: GameEvent[] = [];
  let bufferMoments = [];

  for (const e of events) {
    buffer.push(e);
    bufferMoments = tracker.update(e);
    const boundary =
      buffer.length >= windowSize ||
      e.type === 'period_end' ||
      bufferMoments.length > 0;
    if (!boundary) continue;

    const lines = await provider.generate({
      events: buffer,
      moments: bufferMoments,
      score: e.score,
      period: e.period,
      clock: e.clock,
      teams,
      storylines
    });
    for (const l of lines) {
      cues.push({ t: l.t, period: e.period, clock: e.clock, speaker: 'color', text: l.text });
    }
    buffer = [];
  }

  // flush the trailing buffer — game_end always lands here (period_end flushes
  // right before it), and providers deserve to react to the final buzzer
  if (buffer.length > 0) {
    const last = buffer[buffer.length - 1]!;
    const lines = await provider.generate({
      events: buffer, moments: [], score: last.score,
      period: last.period, clock: last.clock, teams, storylines
    });
    for (const l of lines) {
      cues.push({ t: l.t, period: last.period, clock: last.clock, speaker: 'color', text: l.text });
    }
  }

  // Merge order: primarily by timestamp: `a.t - b.t`. The second sort key
  // (`Number(a.speaker === 'color') - Number(...)`) only matters for a tie —
  // two cues landing at the EXACT same `t` — and resolves it by putting 'pbp'
  // (false→0) before 'color' (true→1), so at a shared timestamp the play-by-
  // play call always reads before the color reaction to it, matching how a
  // real broadcast pairs a play call first and a colorman's reaction second.
  cues.sort((a, b) => a.t - b.t || Number(a.speaker === 'color') - Number(b.speaker === 'color'));
  return cues;
}

export function formatScript(cues: BroadcastCue[], periods = 4): string {
  const fmtClock = (c: number): string => {
    const m = Math.floor(c / 60);
    const s = Math.floor(c % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  // overtime labels, same convention as pbp.ts periodName and the viewer:
  // the old hardcoded `Q${period}` printed "[Q5 5:00] PBP: OT under way." —
  // the bracket contradicting the pbp text in the same line (scan finding
  // B6-6). `periods` is the regulation count (default 4, NBA).
  const label = (p: number): string =>
    p > periods ? `OT${p - periods > 1 ? p - periods : ''}` : `Q${p}`;
  return cues
    .map((c) => `[${label(c.period)} ${fmtClock(c.clock)}] ${c.speaker === 'pbp' ? 'PBP' : 'COLOR'}: ${c.text}`)
    .join('\n');
}
