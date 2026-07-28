/**
 * Sweep worker: evaluate one params candidate.
 *
 * argv[2] = path to a job JSON: { overrides, games, seedBases, endgame? }
 * stdout  = JSON: { seedResults: [{ seedBase, avgs }] }
 *
 * This is the OTHER end of sweep.ts's job-file protocol (see
 * evaluateCandidate's doc comment there for the full rationale) — a
 * standalone, independently invocable script, not a module sweep.ts
 * imports and calls directly. sweep.ts spawns exactly this file as a
 * subprocess via `execFile`, passing the job path as argv[2]; this script
 * has no awareness of the search loop, candidate history, or scoring — it
 * only knows how to turn ONE job description into ONE seedResults array.
 * That narrow interface is what makes it trivial to run by hand for
 * debugging a single candidate in isolation:
 *   node --import ./tools/register.mjs packages/harness/src/sweep-worker.ts /tmp/some-job.json
 * (write a job JSON with the shape above first, or copy one sweep.ts wrote
 * to /tmp during a run before it got cleaned up).
 */

import { readFileSync } from 'node:fs';
import { withParams, simulateGame } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';
import { accumulate, emptyAcc, finalize } from './aggregate.js';

interface Job {
  overrides: Record<string, unknown>;
  games: number;
  seedBases: string[];
  /**
   * true FORCES GameConfig.endgame ON for every game (the flag-on re-sweep,
   * REFACTOR.md W2); absent or false, the key is omitted from the game
   * config entirely, so games run whatever default the engine ships
   * (`cfg.endgame ?? …`, sim/game.ts) — absent keeps old hand-written debug
   * jobs meaning what they meant.
   */
  endgame?: boolean;
}

const job: Job = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
// withParams deep-merges `overrides` onto a fresh structuredClone of
// defaultParams (see sim/params.ts) — every knob NOT in `overrides` keeps
// its calibrated default, matching the Candidate type's "sparse overrides"
// semantics on the sweep.ts side of this protocol.
const params = withParams(job.overrides as Parameters<typeof withParams>[0]);

const seedResults = [];
for (const seedBase of job.seedBases) {
  const acc = emptyAcc();
  // Note: sampleMatchup() is called fresh inside the seedBase loop (once per
  // seed base, not once for the whole job) — harmless since it just
  // constructs the same two fixed rosters (@hoopsh/data's cascadiaBreakers/
  // meridianMonarchs) every time, so this doesn't change which teams play,
  // just re-does the (cheap) construction work redundantly.
  const def = sampleMatchup();
  for (let i = 0; i < job.games; i++) {
    // Same fixed home/away alternation run.ts's `mirror` option uses (see
    // its doc comment) — every seed base plays this candidate through a
    // side-balanced batch so a candidate can't score well by accidentally
    // exploiting a home-side quirk instead of genuinely fitting the bands.
    const flip = i % 2 === 1;
    const home = flip ? def.away : def.home;
    const away = flip ? def.home : def.away;
    const result = simulateGame({
      seed: `${seedBase}-${i}`,
      home,
      away,
      params,
      collectFrames: false,
      ...(job.endgame ? { endgame: true } : {})
    });
    accumulate(acc, boxScore(result.events, [home, away]));
  }
  // One LeagueAverages entry per seed base — sweep.ts's scoreResults/
  // failCount then check EACH seed base's bands independently (never merged
  // together via mergeAcc), which is what lets it require all-three-pass
  // rather than a pooled average that could hide one bad seed inside two
  // good ones.
  seedResults.push({ seedBase, avgs: finalize(acc) });
}

process.stdout.write(JSON.stringify({ seedResults }));
