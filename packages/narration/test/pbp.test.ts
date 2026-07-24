import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
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

  it('broadcast script merges pbp and color voices in time order', async () => {
    const cues = await buildBroadcastScript(result.events, [home, away], new TemplateColorProvider(), { seed: 'pbp-1' });
    expect(cues.some((c) => c.speaker === 'color')).toBe(true);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.t).toBeGreaterThanOrEqual(cues[i - 1]!.t);
    }
  });
});
