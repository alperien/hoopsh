/**
 * Booth test contract (docs/BROADCAST.md §9) — consumer tier: these tests
 * never touch the engine; they assert the booth's own guarantees:
 * determinism per seed, full play-call coverage, clean rendering (no
 * unfilled slots), wall-clock cue ordering, signature budgets, structural
 * segments, and that the shipped booths actually sound different.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import {
  BOOTH_PRESETS, BOONE, buildBoothScript, CORBIN, formatBoothScript, TREMAINE,
  type BoothCue, type VoicePack
} from '@hoopsh/narration';

describe('booth', () => {
  const { home, away } = sampleMatchup();
  const result = simulateGame({ seed: 'booth-1', home, away, collectFrames: false });
  const cues = buildBoothScript(result.events, [home, away], { seed: 'booth-1' });

  it('is deterministic for a fixed seed and booth', () => {
    const again = buildBoothScript(result.events, [home, away], { seed: 'booth-1' });
    expect(JSON.stringify(again)).toEqual(JSON.stringify(cues));
  });

  it('renders every line clean — no unfilled slots, no undefined, no empties', () => {
    expect(cues.length).toBeGreaterThan(300);
    for (const c of cues) {
      expect(c.text.length).toBeGreaterThan(2);
      expect(c.text).not.toContain('undefined');
      expect(c.text).not.toContain('{'); // an unfilled slot survives visibly — see voice.ts fillSlots
      expect(c.text).not.toContain('}');
    }
  });

  it('gives every made field goal a play call', () => {
    const madeShots = result.events.filter((e) => e.type === 'shot' && e.made && !e.blockedBy).length;
    const shotCalls = cues.filter((c) => c.speaker === 'pbp' && c.kind === 'shot_made').length;
    expect(shotCalls).toEqual(madeShots);
  });

  it('emits cues in non-decreasing wall-clock order (the replay/TTS axis)', () => {
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.wt).toBeGreaterThanOrEqual(cues[i - 1]!.wt);
    }
  });

  it('respects every signature call budget', () => {
    const packs: VoicePack[] = [CORBIN, TREMAINE, BOONE];
    const countSig = (all: BoothCue[], voiceId: string, sigId: string): number =>
      all.filter((c) => c.voice === voiceId && c.sig === sigId).length;
    const latenight = buildBoothScript(result.events, [home, away], { seed: 'booth-1', booth: 'latenight' });
    for (const pack of packs) {
      for (const s of pack.signatures) {
        expect(countSig(cues, pack.id, s.id)).toBeLessThanOrEqual(s.perGame);
        expect(countSig(latenight, pack.id, s.id)).toBeLessThanOrEqual(s.perGame);
      }
    }
  });

  it('produces the structural segments a broadcast needs', () => {
    // pregame scouting from the analyst before any live play
    expect(cues[0]!.kind).toEqual('game_start');
    expect(cues.filter((c) => c.kind === 'pregame' && c.speaker === 'color').length).toEqual(1);
    // a recap at period breaks (halftime uses its own segment)
    expect(cues.filter((c) => c.kind === 'recap_q').length).toBeGreaterThanOrEqual(2);
    expect(cues.filter((c) => c.kind === 'recap_half').length).toEqual(1);
    // the final call and the analyst's wrap
    expect(cues.filter((c) => c.kind === 'game_end' && c.speaker === 'pbp').length).toEqual(1);
    expect(cues.filter((c) => c.kind === 'final' && c.speaker === 'color').length).toEqual(1);
  });

  it('never repeats the exact same sentence back to back in the same voice', () => {
    const byVoice = new Map<string, string>();
    for (const c of cues) {
      expect(c.text === byVoice.get(c.voice)).toBe(false);
      byVoice.set(c.voice, c.text);
    }
  });

  it('keeps registers within the contract and uses more than one', () => {
    const seen = new Set<string>();
    for (const c of cues) {
      expect(['flat', 'elevated', 'peak'].includes(c.register)).toBe(true);
      seen.add(c.register);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('sounds different in a different booth', () => {
    const latenight = buildBoothScript(result.events, [home, away], { seed: 'booth-1', booth: 'latenight' });
    expect(latenight.length).toBeGreaterThan(300);
    const classicText = cues.map((c) => c.text).join('\n');
    const latenightText = latenight.map((c) => c.text).join('\n');
    expect(classicText === latenightText).toBe(false);
    // both voices actually speak in both booths
    expect(latenight.some((c) => c.voice === BOONE.id)).toBe(true);
    expect(latenight.some((c) => c.voice === TREMAINE.id)).toBe(true);
  });

  it('formats a printable two-voice script', () => {
    const script = formatBoothScript(cues, BOOTH_PRESETS.classic);
    expect(script).toContain('CORBIN:');
    expect(script).toContain('TREMAINE:');
    expect(script.split('\n').length).toEqual(cues.length);
  });
});
