/**
 * tick.ts — the day loop: the only orchestrator of league time. OWNER:
 * spine task. STATUS: STAGED stub from the contracts wave; signatures
 * frozen.
 *
 * Day order (docs/FRANCHISE.md §8): morning (recoveries, option/QO
 * deadlines) -> AI front offices -> user actions already applied since
 * yesterday -> games (via SimulateJobs) -> evening folds (stats,
 * standings, injuries, news, inbox) -> phase transitions.
 *
 * Determinism: advanceDay(league) must be a pure function of the league
 * value (which embeds seed + action log). Wall-clock never enters.
 */
import type { DayDigest, League, UserAction } from './types.js';
import type { SimulateJobs } from './types.js';

export interface ActionResult {
  ok: boolean;
  /** human-readable rule failures (cap engine wording), empty when ok */
  errors: string[];
}

/** Validate + apply a user action now, logging it for replay. */
export function applyUserAction(league: League, action: UserAction): ActionResult {
  throw new Error('franchise/tick: not implemented (spine task lands this)');
}

/** Advance one day. Mutates league. Returns the digest the UI renders. */
export function advanceDay(league: League, sim: SimulateJobs): Promise<DayDigest> {
  throw new Error('franchise/tick: not implemented (spine task lands this)');
}
