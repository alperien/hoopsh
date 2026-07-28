/** Batch game runner (single process). Worker parallelism layers on top. */

import { simulateGame, type Team } from '@hoopsh/engine';
import { boxScore, type BoxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';
import { accumulate, emptyAcc, type Accumulator } from './aggregate.js';

export interface BatchOptions {
  games: number;
  seedBase?: string;
  home?: Team;
  away?: Team;
  /**
   * Alternate home/away each game to cancel any home-side bias.
   *
   * If the engine has any asymmetry that favors whoever is `home` (e.g. tip
   * possession odds, an inbound-position quirk, or simply which side of a
   * probability roll gets evaluated first; nothing this codebase
   * currently claims to have, but the kind of thing that's easy to
   * introduce by accident), a batch that always ran team A as home would
   * bake that bias into every acceptance-band average without anyone
   * noticing, because the two teams here (see @hoopsh/data's sampleMatchup)
   * are deliberately different playing styles, so a real skill/style gap
   * would mask a smaller structural bias. Mirroring means each team plays
   * home exactly half the batch, so any home-side effect cancels out of the
   * league-average numbers bands.ts checks, leaving only the style
   * difference, which is what these two rosters exist to exercise.
   * Defaults to true; pass `false` only when deliberately measuring
   * home-side effects in isolation.
   */
  mirror?: boolean;
  /**
   * Force GameConfig.endgame on (or off) for every game in the batch;
   * omitted = the key is not passed at all, so games run whatever default
   * the engine ships (`cfg.endgame ?? …`, sim/game.ts). Forcing on is the
   * flag-on acceptance measurement (REFACTOR.md W2's re-sweep); omission
   * keeps a default batch grading the config that actually ships, whichever
   * way the coordinated default flip lands.
   */
  endgame?: boolean;
  onGame?: (i: number, box: BoxScore) => void;
}

export function runBatch(opts: BatchOptions): Accumulator {
  const acc = emptyAcc();
  const base = opts.seedBase ?? 'batch';
  const def = sampleMatchup();
  const home = opts.home ?? def.home;
  const away = opts.away ?? def.away;

  for (let i = 0; i < opts.games; i++) {
    // Odd-indexed games swap sides under mirroring: a stable, deterministic
    // alternation (not randomized) so re-running the same seedBase always
    // produces the same home/away assignment per game index.
    const flip = (opts.mirror ?? true) && i % 2 === 1;
    const result = simulateGame({
      seed: `${base}-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false,
      ...(opts.endgame === undefined ? {} : { endgame: opts.endgame })
    });
    const box = boxScore(result.events, [flip ? away : home, flip ? home : away]);
    accumulate(acc, box);
    opts.onGame?.(i, box);
  }
  return acc;
}
