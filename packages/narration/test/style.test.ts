/**
 * Style lint — the machine-checkable half of the anti-LLM style contract
 * (docs/BROADCAST.md §7). Motivated by a project review (2026-07): the first
 * persona draft used invented broadcast language, and specific constructions
 * — not-x-but-y contrast frames, aphoristic kickers, moralizing closers,
 * meta-similes — read instantly as generated text. Real broadcast speech
 * almost never uses them; templates that do are rejected here, so the voice
 * cannot regress silently.
 *
 * Scope: every string in every shipped VoicePack (pools, segments,
 * signatures) AND a fully rendered script from each booth preset (which also
 * covers booth-composed strings: assist tags, foul extras, scouting notes,
 * recap notes).
 */

import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { BOOTH_PRESETS, BREEN, buildBoothScript, HARLAN, HUBIE, type VoicePack } from '@hoopsh/narration';

/**
 * Banned patterns. Each entry is a construction that flags text as
 * generated rather than transcribed. High-precision on purpose — this list
 * grows when a review finds a new tell, it is never loosened to make a
 * template pass (same policy as the engine's invariants).
 */
const BANNED: { name: string; re: RegExp }[] = [
  // contrast frames: "that's not X, that's Y" / "it's not X, it's Y"
  { name: 'not-x-but-y (that/it)', re: /(that|it|this)['’]?s not [^.!?]{1,60},\s*(that|it|this|he|she)['’]?s/i },
  { name: 'not-x-but-y (comma-but)', re: /\bnot [a-z][^.!?]{0,40}, but [a-z]/i },
  { name: 'isn\'t-about frame', re: /\b(isn['’]t|is not|not) about\b/i },
  // audience filler and aphorism tells
  { name: 'folks', re: /\bfolks\b/i },
  { name: 'aphoristic "everything else"', re: /everything else is/i },
  { name: 'moralizing closer', re: /\b(you teach that|winning basketball|champions close|that['’]s the whole (lesson|recipe|point))\b/i },
  // meta-similes / personification of objects
  { name: 'owes-money simile', re: /like (it|he|she|they) owes?/i },
  { name: 'rim/clock personification', re: /\b(rim says|clock strangles|rim starts looking)\b/i }
];

function packStrings(pack: VoicePack): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const [key, pool] of Object.entries(pack.pools)) {
    for (const t of pool) out.push({ where: `${pack.id}.pools.${key}`, text: t });
  }
  for (const [key, pool] of Object.entries(pack.segments ?? {})) {
    for (const t of pool) out.push({ where: `${pack.id}.segments.${key}`, text: t });
  }
  for (const s of pack.signatures) {
    for (const t of s.text) out.push({ where: `${pack.id}.sig.${s.id}`, text: t });
  }
  return out;
}

describe('style lint', () => {
  it('no banned constructions in any shipped voice pack', () => {
    const offenders: string[] = [];
    for (const pack of [BREEN, HUBIE, HARLAN]) {
      for (const { where, text } of packStrings(pack)) {
        for (const rule of BANNED) {
          if (rule.re.test(text)) offenders.push(`[${rule.name}] ${where}: "${text}"`);
        }
      }
    }
    // joined so a failure prints every offender at once
    expect(offenders.join('\n')).toEqual('');
  });

  it('no banned constructions survive into a rendered script (both booths)', () => {
    const { home, away } = sampleMatchup();
    const result = simulateGame({ seed: 'style-1', home, away, collectFrames: false });
    const offenders: string[] = [];
    for (const preset of Object.keys(BOOTH_PRESETS) as (keyof typeof BOOTH_PRESETS)[]) {
      const cues = buildBoothScript(result.events, [home, away], { seed: 'style-1', booth: preset });
      for (const c of cues) {
        for (const rule of BANNED) {
          if (rule.re.test(c.text)) offenders.push(`[${rule.name}] ${preset}/${c.voice}: "${c.text}"`);
        }
      }
    }
    expect(offenders.join('\n')).toEqual('');
  });
});
