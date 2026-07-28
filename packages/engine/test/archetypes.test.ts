/**
 * Archetype acceptance: ratings profiles must produce the right shape of
 * stat line at multi-game scale. Bands are generous in v0.1; they tighten
 * as calibration matures (see harness bands for league-level).
 */

import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { boxScore, type PlayerLine } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';

const GAMES = 24; // thin structural margins (assist leadership) need the power

function seasonLines(): Map<string, PlayerLine & { games: number }> {
  const totals = new Map<string, PlayerLine & { games: number }>();
  for (let i = 0; i < GAMES; i++) {
    const { home, away } = sampleMatchup();
    const flip = i % 2 === 1;
    const result = simulateGame({
      seed: `arch-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false
    });
    const box = boxScore(result.events, [flip ? away : home, flip ? home : away]);
    for (const p of box.players) {
      const prev = totals.get(p.id);
      if (!prev) {
        totals.set(p.id, { ...p, games: 1 });
      } else {
        prev.games += 1;
        for (const k of ['min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'trb', 'ast', 'stl', 'blk', 'tov', 'pf'] as const) {
          prev[k] += p[k];
        }
        for (const z of ['rim', 'paint', 'mid', 'three'] as const) {
          prev.zones[z].a += p.zones[z].a;
          prev.zones[z].m += p.zones[z].m;
        }
      }
    }
  }
  return totals;
}

const lines = seasonLines();
const per = (id: string, k: 'pts' | 'ast' | 'trb' | 'tpa' | 'fga' | 'blk'): number => {
  const l = lines.get(id);
  if (!l) throw new Error(`no line for ${id}`);
  return l[k] / l.games;
};

describe(`archetype behavior over ${GAMES} games`, () => {
  it('elite shooter (Mercer): heavy three-point diet, high scoring', () => {
    const l = lines.get('brk-mercer')!;
    const tpaShare = l.tpa / Math.max(1, l.fga);
    expect(tpaShare).toBeGreaterThan(0.45); // most attempts from deep
    expect(per('brk-mercer', 'pts')).toBeGreaterThan(12); // a primary scorer
    expect(per('brk-mercer', 'tpa')).toBeGreaterThan(5); // lets it fly
  });

  it('rim-runner (Ratliff): lives at the rim, owns the glass, blocks shots', () => {
    const l = lines.get('brk-ratliff')!;
    const rimShare = (l.zones.rim.a + l.zones.paint.a) / Math.max(1, l.fga);
    expect(rimShare).toBeGreaterThan(0.75); // barely shoots outside the paint
    expect(l.tpa / Math.max(1, l.fga)).toBeLessThan(0.08);
    expect(per('brk-ratliff', 'trb')).toBeGreaterThan(6);
  });

  // Resolved structurally (Stage 2 usage hierarchy): the calibration-session-1
  // finding was that creation flowed through swing positions and scalar knobs
  // moved touches but not terminal creation. The structural fix, in ai.ts:
  // the playmaker pull is relative to the holder's own creation score and
  // clock-scaled (re-initiation after swings); PnR initiation is gated by the
  // holder's creation rank (ai.pnrUsageFloor); drive utility prices the
  // paint-touch-and-spray option, crowd-gated and scaled by the driver's own
  // vision; open catch-and-shoot threes convert (ai.catchShootBonus). The
  // floor general now leads his team in assists. Historically he ran 4th.
  it('floor general (Vance): the assist leader on his team', () => {
    const vance = per('mon-vance', 'ast');
    expect(vance).toBeGreaterThanOrEqual(4); // level floor; see ratchet below
    for (const id of lines.keys()) {
      if (id.startsWith('mon-') && id !== 'mon-vance') {
        expect(vance).toBeGreaterThan(per(id, 'ast'));
      }
    }
  });

  // Level ratchet, deferred to the fidelity phase: a real floor general
  // leads at 6-10 apg, not ~5. The gap is league assisted-share. The engine
  // credits ~46-50% of makes as assisted vs the NBA's ~58%, and no acceptance
  // band constrains it yet. Chasing the level with style knobs oscillates
  // (Stage 2 measurement); it needs an assisted-share band in harness/bands
  // plus per-player validation against real profiles (Curry/LeBron/Jokić
  // benchmark work). Ratchet the floor above to 6+ when that band lands.
  it.todo('floor general (Vance): 6+ assists per game (needs assisted-share band)');

  it('non-shooting bigs do not chuck threes', () => {
    // allowance of max(1, 8% of FGA) tolerates the occasional end-of-period
    // desperation heave (any player stuck with the ball must launch one)
    // without tolerating actual three-point chucking at volume
    for (const id of ['mon-halvorsen', 'brk-marsh', 'mon-yaro']) {
      const l = lines.get(id)!;
      expect(l.tpa).toBeLessThanOrEqual(Math.max(1, l.fga * 0.08));
    }
  });

  it('starters play more than bench', () => {
    const starters = ['brk-mercer', 'mon-vance'];
    const bench = ['brk-marsh', 'mon-yaro'];
    for (let i = 0; i < starters.length; i++) {
      const s = lines.get(starters[i]!)!;
      const b = lines.get(bench[i]!)!;
      expect(s.min / s.games).toBeGreaterThan(b.min / b.games);
    }
  });
});
