import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

describe('determinism', () => {
  it('same seed → bit-identical event streams and frames', () => {
    const { home, away } = sampleMatchup();
    const a = simulateGame({ seed: 'det-1', home, away });
    const b = simulateGame({ seed: 'det-1', home: sampleMatchup().home, away: sampleMatchup().away });
    expect(JSON.stringify(a.events)).toEqual(JSON.stringify(b.events));
    expect(JSON.stringify(a.frames)).toEqual(JSON.stringify(b.frames));
    expect(a.finalScore).toEqual(b.finalScore);
  });

  it('different seeds → different games', () => {
    const { home, away } = sampleMatchup();
    const a = simulateGame({ seed: 'det-2', home, away, collectFrames: false });
    const b = simulateGame({ seed: 'det-3', home, away, collectFrames: false });
    expect(JSON.stringify(a.events)).not.toEqual(JSON.stringify(b.events));
  });
});
