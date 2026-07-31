/**
 * The tape term (fix wave C, the Amari critique): a prospect who actually
 * played leaves his record on the draft board. A weak season in a real
 * league drags the night's read; a strong one lifts it; a generated
 * prospect with no seasons reads exactly as before (zero).
 */
import { describe, expect, it } from 'vitest';
import { tapeAdjust } from '../src/ai/draftai.js';
import type { FrPlayer } from '../src/types.js';

function withSeason(over: Partial<FrPlayer['seasons'][number]>): FrPlayer {
  return {
    seasons: [{
      season: 2027, teamId: 'euro-x', type: 'regular',
      gp: 22, gs: 22, min: 480,
      pts: 238, fgm: 90, fga: 201, tpm: 25, tpa: 73, ftm: 33, fta: 49,
      orb: 15, drb: 54, ast: 23, stl: 15, blk: 2, tov: 11, pf: 37,
      plusMinus: -147,
      ...over,
    }],
  } as unknown as FrPlayer;
}

describe('the tape leaves a mark on the night', () => {
  it('reads zero for a generated prospect with no seasons', () => {
    expect(tapeAdjust({ seasons: [] } as unknown as FrPlayer)).toBe(0);
  });

  it('drags a weak real season (the Amari euro line)', () => {
    // 10.8 a night, minus 6.7 per game: TS was respectable (.535) but the
    // impact was a crater; the board must feel it
    const adj = tapeAdjust(withSeason({}));
    expect(adj).toBeLessThan(-2);
  });

  it('lifts a strong season and orders tape sensibly', () => {
    const weak = tapeAdjust(withSeason({}));
    const strong = tapeAdjust(withSeason({ pts: 420, plusMinus: 110 }));
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThan(0);
  });

  it('ignores rumors: seasons under the games floor read zero', () => {
    expect(tapeAdjust(withSeason({ gp: 5 }))).toBe(0);
  });
});
