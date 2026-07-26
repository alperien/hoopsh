import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { buildBroadcastScript, generatePlayByPlay, TemplateColorProvider } from '@hoopsh/narration';

describe('narration', () => {
  const { home, away } = sampleMatchup();
  const result = simulateGame({ seed: 'pbp-1', home, away, collectFrames: false });

  it('renders play-by-play for a full game without gaps or crashes', () => {
    const pbp = generatePlayByPlay(result.events, [home, away], { seed: 'pbp-1' });
    expect(pbp.length).toBeGreaterThan(200);
    // every made shot event surfaces in PBP
    const madeShots = result.events.filter((e) => e.type === 'shot' && e.made).length;
    expect(pbp.length).toBeGreaterThan(madeShots);
    for (const l of pbp) {
      expect(l.text.length).toBeGreaterThan(4);
      expect(l.text).not.toContain('undefined');
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = generatePlayByPlay(result.events, [home, away], { seed: 'x' });
    const b = generatePlayByPlay(result.events, [home, away], { seed: 'x' });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('a charge narrates as ONE line, not two (off_foul turnover + offensive foul pair)', () => {
    // The engine represents one charge as two consecutive events (a turnover
    // of kind 'off_foul' followed by a foul of kind 'offensive' — see
    // core/events.ts TurnoverKind). Both switch cases used to render a full
    // sentence, so every charge produced two adjacent lines for one whistle.
    const base = { t: 100, wt: 120, period: 1, clock: 500, score: [10, 8] as [number, number] };
    const charge = [
      { type: 'turnover', team: 0, player: 'brk-mercer', kind: 'off_foul', ...base },
      {
        type: 'foul', team: 0, on: 'brk-mercer', kind: 'offensive',
        personalCount: 2, teamCountInPeriod: 3, inBonus: false, fouledOut: false, ...base
      }
    ] as GameEvent[];
    const lines = generatePlayByPlay(charge, [home, away], { seed: 'charge-1', includeMoments: false });
    expect(lines.length).toBe(1);
    expect(lines[0]!.text).toContain('Charge');

    // ...but game-state news the charge line doesn't carry (foul trouble,
    // a foul-out) still gets its own line.
    const chargeFoulOut = [
      charge[0]!,
      {
        type: 'foul', team: 0, on: 'brk-mercer', kind: 'offensive',
        personalCount: 6, teamCountInPeriod: 3, inBonus: false, fouledOut: true, ...base
      }
    ] as GameEvent[];
    const linesOut = generatePlayByPlay(chargeFoulOut, [home, away], { seed: 'charge-2', includeMoments: false });
    expect(linesOut.length).toBe(2);
    expect(linesOut[1]!.text).toContain('fouled out');
  });

  it('broadcast script merges pbp and color voices in time order', async () => {
    const cues = await buildBroadcastScript(result.events, [home, away], new TemplateColorProvider(), { seed: 'pbp-1' });
    expect(cues.some((c) => c.speaker === 'color')).toBe(true);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.t).toBeGreaterThanOrEqual(cues[i - 1]!.t);
    }
  });
});
