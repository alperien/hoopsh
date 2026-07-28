/**
 * League selection (leagues.ts): the --league flag must swap rule pack,
 * acceptance bands, and pace basis together, with the NCAA bands loaded from
 * the research deliverable (data/ncaa/acceptance-bands.json) rather than a
 * hand-copied duplicate. Also pins the pace-normalization fix: a 40-minute
 * NCAA game's pace is reported in poss/40, not poss/48
 * (data/ncaa/README.md §5's wiring hazard).
 */

import { describe, expect, it } from 'vitest';
import { NBA, NCAA, simulateGame } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';
import { emptyAcc, finalize } from '../src/aggregate.js';
import { NBA_BANDS } from '../src/bands.js';
import { loadNcaaBands, resolveLeague } from '../src/leagues.js';
import { runGamesInProcess } from '../src/parallel.js';

describe('resolveLeague', () => {
  it('nba: the exact pre-flag configuration (NBA pack, NBA_BANDS, 48-minute pace basis, gated)', () => {
    const lg = resolveLeague('nba');
    expect(lg.rules).toBe(NBA);
    expect(lg.bands).toBe(NBA_BANDS);
    expect(lg.paceMinutes).toBe(48);
    expect(lg.calibrated).toBe(true);
  });

  it('ncaa: NCAA pack, bands from the research JSON, 40-minute pace basis, ungated', () => {
    const lg = resolveLeague('ncaa');
    expect(lg.rules).toBe(NCAA);
    expect(lg.paceMinutes).toBe(40);
    expect(lg.calibrated).toBe(false);
    expect(lg.bands.length).toBe(17); // one per proposed metric, same count as NBA_BANDS
  });

  it('throws loudly on an unknown league (a typo must never silently run as nba)', () => {
    expect(() => resolveLeague('xyz')).toThrow('unknown league "xyz"');
    expect(() => resolveLeague('euroleague')).toThrow(); // pack exists, bands don't; not resolvable yet
  });
});

describe('NCAA bands (data/ncaa/acceptance-bands.json)', () => {
  const bands = loadNcaaBands();

  it('every band metric is a key finalize() actually produces — no silent NaN-failing bands', () => {
    const known = Object.keys(finalize(emptyAcc()));
    for (const b of bands) {
      expect(known).toContain(b.metric);
    }
  });

  it('pace band is stated in the real-world poss/40 convention (66-71), matching the paceMinutes: 40 pipeline — not the 48-basis alternative', () => {
    const pace = bands.find((b) => b.metric === 'pace')!;
    expect(pace.lo).toBe(66);
    expect(pace.hi).toBe(71);
  });

  it('pct formatting hints survived the load (FT% renders as a percentage, not 0.7 fouls)', () => {
    const ft = bands.find((b) => b.metric === 'ftPct')!;
    expect(ft.pct).toBe(true);
  });
});

describe('league-aware pace normalization', () => {
  it('the same NCAA game reports pace on a 40-minute basis when asked (48/40 ratio between conventions)', () => {
    const { home, away } = sampleMatchup();
    const r = simulateGame({ seed: 'pace-basis-0', home, away, rules: NCAA, collectFrames: false });
    const on48 = boxScore(r.events, [home, away]).pace;
    const on40 = boxScore(r.events, [home, away], { paceMinutes: 40 }).pace;
    // both are display-rounded to 0.1 after scaling, so compare with slack
    expect(Math.abs(on40 - on48 * (40 / 48))).toBeLessThan(0.11);
    expect(on40).toBeLessThan(on48);
  });

  it('default stays the 48-minute NBA convention (byte-stable for every existing caller)', () => {
    const { home, away } = sampleMatchup();
    const r = simulateGame({ seed: 'pace-basis-1', home, away, collectFrames: false });
    const dflt = boxScore(r.events, [home, away]).pace;
    const explicit = boxScore(r.events, [home, away], { paceMinutes: 48 }).pace;
    expect(dflt).toBe(explicit);
  });
});

describe('league flows through the game-runner', () => {
  it('an ncaa batch game is simulated under NCAA rules (pace lands in the poss/40 world, far below the same seed under nba)', () => {
    const [ncaa] = runGamesInProcess('batch', 'lg-runner', 0, 1, undefined, 'ncaa');
    const [nba] = runGamesInProcess('batch', 'lg-runner', 0, 1, undefined, 'nba');
    // same seed, different league: the NCAA game is 40 minutes of 30-second
    // clocks reported on a 40-minute basis, so its pace number must sit
    // well below the NBA run's poss/48 number for the identical seed
    expect(ncaa!.pace).toBeLessThan(nba!.pace - 10);
    // and the runner is deterministic per (seedBase, league, i)
    const [again] = runGamesInProcess('batch', 'lg-runner', 0, 1, undefined, 'ncaa');
    expect(again!.pace).toBe(ncaa!.pace);
    expect(again!.teams[0].pts).toBe(ncaa!.teams[0].pts);
  });

  it('omitting the league is exactly the nba path (default-parameter regression guard)', () => {
    const [dflt] = runGamesInProcess('batch', 'lg-runner', 0, 1);
    const [nba] = runGamesInProcess('batch', 'lg-runner', 0, 1, undefined, 'nba');
    expect(dflt!.pace).toBe(nba!.pace);
    expect(dflt!.teams[0].pts).toBe(nba!.teams[0].pts);
    expect(dflt!.teams[1].pts).toBe(nba!.teams[1].pts);
  });
});
