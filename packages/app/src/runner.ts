/**
 * runner.ts — worker-pool SimulateJobs implementation. OWNER: app task.
 * STATUS: STAGED stub. Pattern: harness/src/parallel.ts (job file ->
 * execFile worker -> one JSON blob on stdout; contiguous slices;
 * aggregates only cross the boundary — events only for detail:'events'
 * jobs, which are capped per day). Determinism: worker-count invariant.
 */
import type { GameJob, GameJobResult } from '@hoopsh/franchise';

export function makeWorkerPool(opts?: { workers?: number }): (jobs: GameJob[]) => Promise<GameJobResult[]> {
  throw new Error('app/runner: not implemented (app task lands this)');
}
