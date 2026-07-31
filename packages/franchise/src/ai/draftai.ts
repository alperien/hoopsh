/**
 * ai/draftai.ts — AI draft boards and picks. OWNER: ai-team task.
 * STATUS: STAGED stub; THROWS (draft night cannot run without it, and
 * draft night itself lands with the spine after this exists).
 */
import type { League, TeamId } from '../types.js';

/** The pick an AI team makes from the available pool (their scouts' board). */
export function aiSelect(league: League, teamId: TeamId, available: string[]): string {
  throw new Error('franchise/ai/draftai: not implemented (ai-team task lands this)');
}
