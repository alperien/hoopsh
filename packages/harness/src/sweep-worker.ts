/**
 * Sweep worker: evaluate one params candidate.
 * argv[2] = path to a job JSON: { overrides, games, seedBases }
 * stdout  = JSON: { seedResults: [{ seedBase, avgs }] }
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
}

const job: Job = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const params = withParams(job.overrides as Parameters<typeof withParams>[0]);

const seedResults = [];
for (const seedBase of job.seedBases) {
  const acc = emptyAcc();
  const def = sampleMatchup();
  for (let i = 0; i < job.games; i++) {
    const flip = i % 2 === 1;
    const home = flip ? def.away : def.home;
    const away = flip ? def.home : def.away;
    const result = simulateGame({
      seed: `${seedBase}-${i}`,
      home,
      away,
      params,
      collectFrames: false
    });
    accumulate(acc, boxScore(result.events, [home, away]));
  }
  seedResults.push({ seedBase, avgs: finalize(acc) });
}

process.stdout.write(JSON.stringify({ seedResults }));
