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
  // booth-21 (re-scouted on the frozen landing tree): carries the full flow
  // vocabulary — 2 technicals, 2 jump balls, 1 violation
  const result = simulateGame({ seed: 'booth-21', home, away, collectFrames: false });
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

describe('booth flow vocabulary (officiating + timeout economy)', () => {
  // forced rates guarantee every flow event kind lands in one game — the
  // officiating.test.ts both-arms idiom, so these pins survive future rate
  // re-fits. 20x-ish the shipped values; the shipped rates are pinned by
  // the engine's own officiating suite, not here.
  const { home, away } = sampleMatchup();
  const result = simulateGame({
    seed: 'booth-vocab-1', home, away, collectFrames: false,
    params: { officiating: { kickedPerPass: 0.03, heldBallPerScramble: 0.25, techPerFoulWhistle: 0.3 } }
  });
  const cues = buildBoothScript(result.events, [home, away], { seed: 'booth-vocab-1' });
  const kinds = (k: string): BoothCue[] => cues.filter((c) => c.kind === k);
  const at = (wt: number): BoothCue[] => cues.filter((c) => c.wt === wt);
  const count = (t: string): number => result.events.filter((e) => e.type === t).length;

  it('the forced stream actually contains the vocabulary (anti-vacuity)', () => {
    expect(count('timeout')).toBeGreaterThanOrEqual(4);
    expect(count('jump_ball')).toBeGreaterThanOrEqual(2);
    expect(count('violation')).toBeGreaterThanOrEqual(1);
    expect(result.events.filter((e) => e.type === 'foul' && e.kind === 'technical').length)
      .toBeGreaterThanOrEqual(2);
  });

  it('every timeout gets a play-by-play cue; coach stoppages get the analyst', () => {
    expect(kinds('timeout').filter((c) => c.speaker === 'pbp').length).toEqual(count('timeout'));
    const coachCalls = result.events.filter(
      (e) => e.type === 'timeout' && (e.reason === 'stop_run' || e.reason === 'regroup')).length;
    expect(kinds('timeout').filter((c) => c.speaker === 'color').length).toEqual(coachCalls);
  });

  it('every jump ball and violation is called', () => {
    expect(kinds('jump_ball').length).toEqual(count('jump_ball'));
    expect(kinds('violation').length).toEqual(count('violation'));
  });

  it('a technical NEVER renders as an offensive foul (the old fall-through)', () => {
    const techs = result.events.filter((e) => e.type === 'foul' && e.kind === 'technical');
    expect(techs.length).toBeGreaterThan(0);
    for (const e of techs) {
      // a tech legally RIDES any whistle, including a charge (the fouler
      // argues the offensive-foul call he just got) — a real offensive foul
      // at the same wt then correctly renders "Offensive foul" beside the
      // tech call. The fall-through this test guards is an "Offensive foul"
      // cue with NO offensive-foul event at that instant.
      const coincidentCharge = result.events.some(
        (x) => x.type === 'foul' && x.kind === 'offensive' && x.wt === e.wt
      );
      if (coincidentCharge) continue;
      for (const c of at(e.wt)) expect(c.text).not.toContain('Offensive foul');
    }
    // and the technical pool actually fired somewhere
    expect(cues.some((c) => /technical|TECHNICAL/i.test(c.text))).toBe(true);
  });

  it('a travel NEVER renders as lost out of bounds (the old fall-through)', () => {
    const travels = result.events.filter((e) => e.type === 'turnover' && e.kind === 'travel');
    for (const e of travels) {
      for (const c of at(e.wt)) expect(c.text).not.toContain('out of bounds');
    }
  });

  it('playerless team boards render team-credited, never orphan punctuation', () => {
    for (const c of cues) {
      expect(c.text).not.toContain('undefined');
      expect(/ [,.]/.test(c.text)).toBe(false); // "Rebound, ." class garbage
      expect(c.text).not.toContain('  ');
    }
  });

  it('is deterministic on the forced stream too', () => {
    const again = buildBoothScript(result.events, [home, away], { seed: 'booth-vocab-1' });
    expect(JSON.stringify(again)).toEqual(JSON.stringify(cues));
  });
});
