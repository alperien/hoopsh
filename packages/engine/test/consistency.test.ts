import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';

describe('box score internal consistency', () => {
  const { home, away } = sampleMatchup();
  const result = simulateGame({ seed: 'consist-1', home, away, collectFrames: false });
  const box = boxScore(result.events, [home, away]);

  it('game completes with a winner', () => {
    expect(result.finalScore[0]).not.toEqual(result.finalScore[1]);
    expect(result.events.at(-1)?.type).toEqual('game_end');
  });

  it('points identity: PTS = 2·(FGM−3PM) + 3·3PM + FTM per team', () => {
    for (const side of [0, 1] as const) {
      const t = box.teams[side];
      expect(t.pts).toEqual(2 * (t.fgm - t.tpm) + 3 * t.tpm + t.ftm);
      expect(t.pts).toEqual(result.finalScore[side]);
    }
  });

  it('player lines sum to team totals', () => {
    for (const side of [0, 1] as const) {
      const players = box.players.filter((p) => p.team === side);
      const sum = (k: 'pts' | 'fga' | 'fgm' | 'trb' | 'ast' | 'tov' | 'pf'): number =>
        players.reduce((acc, p) => acc + p[k], 0);
      expect(sum('pts')).toEqual(box.teams[side].pts);
      expect(sum('fga')).toEqual(box.teams[side].fga);
      expect(sum('fgm')).toEqual(box.teams[side].fgm);
      expect(sum('trb')).toEqual(box.teams[side].trb);
      expect(sum('ast')).toEqual(box.teams[side].ast);
      expect(sum('tov')).toEqual(box.teams[side].tov);
    }
  });

  it('team minutes ≈ 5 × game length', () => {
    const periods = box.periods;
    const expected = periods >= 4 ? 5 * 48 : 5 * 48; // regulation minimum
    for (const side of [0, 1] as const) {
      const minutes = box.players.filter((p) => p.team === side).reduce((a, p) => a + p.min, 0);
      expect(minutes).toBeGreaterThanOrEqual(expected - 3);
      expect(minutes).toBeLessThanOrEqual(expected + 5 * 6 * 3); // allow OTs
    }
  });

  it('possession counts are close between teams', () => {
    const diff = Math.abs(box.teams[0].poss - box.teams[1].poss);
    expect(diff).toBeLessThanOrEqual(6);
  });

  it('assists never exceed made field goals', () => {
    for (const side of [0, 1] as const) {
      expect(box.teams[side].ast).toBeLessThanOrEqual(box.teams[side].fgm);
    }
  });
});
