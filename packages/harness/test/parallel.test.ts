/**
 * Parallel-runner gates — worker-count invariance and loud failure.
 *
 * DETERMINISM IS THE PRODUCT here: the whole verification culture (golden
 * fingerprints, locked calibration bands, the noise floor) rests on "same
 * seeds in, same numbers out". This suite pins parallel.ts's contract:
 *
 *   1. The SAME games (seeds, home/away mirroring) are simulated regardless
 *      of worker count, and per-game results are returned in global game
 *      order — asserted by deep-strict equality of the per-game summary
 *      arrays across worker counts (workers=1 runs in-process; workers>1
 *      spawns real subprocesses, so this also covers the JSON round trip).
 *   2. The reductions the CLIs print (accumulate/finalize for `npm run
 *      batch`, reduceFlows for `npm run flow`) are bit-identical across
 *      worker counts — deep-strict equality, no tolerance.
 *   3. A crashing worker fails the WHOLE run loudly — no silent partial
 *      results (this codebase's documented cardinal sin).
 *
 * Kept small (8 games per comparison) for suite speed; npm run batch/flow
 * own the large-n comparisons.
 */

import { describe, expect, it } from 'vitest';
import { runGames, resolveWorkerCount, type GameTaskName } from '../src/parallel.js';
import { accumulate, emptyAcc, finalize, type LeagueAverages, type TeamGameSummary } from '../src/aggregate.js';
import { reduceFlows } from '../src/flow-metrics.js';
import { measureFlow } from '../src/flow.js';

const GAMES = 8;

function leagueAverages(summaries: TeamGameSummary[]): LeagueAverages {
  const acc = emptyAcc();
  for (const s of summaries) accumulate(acc, s);
  return finalize(acc);
}

describe('parallel runner — worker-count invariance', () => {
  it(`batch: 1 worker vs 2 workers over ${GAMES} games — identical per-game summaries and league averages`, async () => {
    const w1 = await runGames({ task: 'batch', games: GAMES, seedBase: 'par-inv', workers: 1 });
    const w2 = await runGames({ task: 'batch', games: GAMES, seedBase: 'par-inv', workers: 2 });
    expect(w1.length).toBe(GAMES);
    // per-game rows identical AND in the same (global) order
    expect(w2).toEqual(w1);
    // the reduction the band report prints: bit-identical, no tolerance
    expect(leagueAverages(w2)).toEqual(leagueAverages(w1));
  });

  it(`flow: 3 workers (uneven 3/3/2 slices) over ${GAMES} games — matches single-process measureFlow exactly`, async () => {
    const parallel = reduceFlows(await runGames({ task: 'flow', games: GAMES, seedBase: 'par-flow', workers: 3 }));
    const single = measureFlow(GAMES, 'par-flow');
    expect(parallel).toEqual(single);
  });
});

describe('parallel runner — loud failure', () => {
  it('a crashing worker rejects the whole run with the cause (never silent partial results)', async () => {
    let message = '';
    try {
      // an unknown task crashes both workers inside run-worker.ts before any
      // simulation happens — cheap way to exercise the real subprocess
      // failure path end to end
      await runGames({ task: 'nope' as GameTaskName, games: 2, seedBase: 'par-crash', workers: 2 });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('FAILED');
    expect(message).toContain('unknown game task');
  });

  it('malformed --workers values are rejected loudly (args.ts doctrine)', () => {
    expect(() => resolveWorkerCount('0')).toThrow('--workers');
    expect(() => resolveWorkerCount('1.5')).toThrow('--workers');
    expect(() => resolveWorkerCount('two')).toThrow('--workers');
    expect(resolveWorkerCount('3')).toBe(3);
    expect(resolveWorkerCount('auto')).toBeGreaterThanOrEqual(1);
  });
});
