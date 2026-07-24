/**
 * Broadcast script builder: merges play-by-play and color commentary into a
 * two-voice script — ready for text display or TTS rendering.
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
  opts?: { seed?: string; windowEvents?: number }
): Promise<BroadcastCue[]> {
  const pbp = generatePlayByPlay(events, teams, { seed: opts?.seed, includeMoments: false });
  const cues: BroadcastCue[] = pbp.map((l: NarrationLine) => ({
    t: l.t, period: l.period, clock: l.clock, speaker: 'pbp' as const, text: l.text
  }));

  // window the raw events and let the provider add color
  const windowSize = opts?.windowEvents ?? 24;
  const tracker = new ContextTracker();
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

  cues.sort((a, b) => a.t - b.t || Number(a.speaker === 'color') - Number(b.speaker === 'color'));
  return cues;
}

export function formatScript(cues: BroadcastCue[]): string {
  const fmtClock = (c: number): string => {
    const m = Math.floor(c / 60);
    const s = Math.floor(c % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  return cues
    .map((c) => `[Q${c.period} ${fmtClock(c.clock)}] ${c.speaker === 'pbp' ? 'PBP' : 'COLOR'}: ${c.text}`)
    .join('\n');
}
