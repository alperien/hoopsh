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
  /** alternate home/away each game to cancel any home-side bias */
  mirror?: boolean;
  onGame?: (i: number, box: BoxScore) => void;
}

export function runBatch(opts: BatchOptions): Accumulator {
  const acc = emptyAcc();
  const base = opts.seedBase ?? 'batch';
  const def = sampleMatchup();
  const home = opts.home ?? def.home;
  const away = opts.away ?? def.away;

  for (let i = 0; i < opts.games; i++) {
    const flip = (opts.mirror ?? true) && i % 2 === 1;
    const result = simulateGame({
      seed: `${base}-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false
    });
    const box = boxScore(result.events, [flip ? away : home, flip ? home : away]);
    accumulate(acc, box);
    opts.onGame?.(i, box);
  }
  return acc;
}
