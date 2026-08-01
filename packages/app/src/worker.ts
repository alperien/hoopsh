/**
 * worker.ts - standalone per-process game worker. Reads a job-slice JSON
 * path from argv[2] ({ jobs, replayDir }), sims each job with the engine,
 * folds through franchise foldEvents, prints ONE JSON blob on stdout:
 * { results: GameJobResult[] } in slice order.
 *
 * detail:'events' jobs additionally get position frames collected and a
 * full replay JSON written to <replayDir>/<gameId>.json (the 2D viewer
 * and the broadcast endpoint both read that file); their events ride the
 * result for the immediate fold.
 *
 * Independently runnable for debugging (parallel.ts doctrine):
 *   node --import ./tools/register.mjs packages/app/src/worker.ts /tmp/job.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildReplay, simulateGame } from '@hoopsh/engine';
import { foldEvents } from '@hoopsh/franchise';
import type { GameJob, GameJobResult } from '@hoopsh/franchise';

const jobFile = process.argv[2];
if (!jobFile) {
  console.error('usage: worker.ts <job-file.json>');
  process.exit(2);
}

const { jobs, replayDir } = JSON.parse(readFileSync(jobFile, 'utf8')) as { jobs: GameJob[]; replayDir: string };

const results: GameJobResult[] = [];
for (const job of jobs) {
  const wantFrames = job.detail === 'events';
  const result = simulateGame({
    seed: job.seed,
    home: job.home,
    away: job.away,
    rules: job.rules, // circuit games ride their own pack (career mode); absent = NBA
    params: job.params, // officiating tightness override when the game has a crew (officials.ts)
    collectFrames: wantFrames,
  });
  const folded = foldEvents(job, result.events);
  if (wantFrames) {
    const replay = buildReplay(result);
    writeFileSync(path.join(replayDir, `${job.gameId}.json`), JSON.stringify(replay));
    folded.events = result.events;
  }
  results.push(folded);
}

process.stdout.write(JSON.stringify({ results }));
