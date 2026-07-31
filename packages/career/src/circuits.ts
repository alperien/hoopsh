/**
 * circuits.ts - every league that is not the NBA: generation, schedules,
 * brackets, game jobs, result folds. OWNER: circuits task. STATUS:
 * STAGED stub; signatures frozen.
 * Circuit games are engine-real: jobs carry the circuit's rule pack
 * (GameJob.rules) and flow through the same SimulateJobs seam.
 */
import type { Rng } from '@hoopsh/engine';
import type { GameJob, GameJobResult } from '@hoopsh/franchise';
import type { CareerState, Circuit, CircuitKind } from './types.js';

/** Build the circuit for a career year of the given kind (rosters included). */
export function buildCircuit(career: CareerState, kind: CircuitKind, rng: Rng): Circuit {
  throw new Error('career/circuits: not implemented (circuits task lands this)');
}

/** Jobs for this week's circuit games (mine gets detail 'events'). */
export function circuitWeekJobs(career: CareerState, week: number): GameJob[] {
  throw new Error('career/circuits: not implemented (circuits task lands this)');
}

/** Fold finished circuit games: results, standings, my season row, bracket advancement. */
export function applyCircuitResults(career: CareerState, results: GameJobResult[]): void {
  throw new Error('career/circuits: not implemented (circuits task lands this)');
}

/** Seed the postseason (conference tourney / bracket) when the regular slate ends. */
export function seedBracket(career: CareerState, rng: Rng): void {
  throw new Error('career/circuits: not implemented (circuits task lands this)');
}

/** Compact summary at season end for circuitHistory. */
export function summarizeCircuit(career: CareerState): import('./types.js').CircuitSummary {
  throw new Error('career/circuits: not implemented (circuits task lands this)');
}
