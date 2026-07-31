/**
 * ai/draftai.ts - AI draft boards and selections. OWNER: ai-team task.
 *
 * An AI board is built from that team's OWN scouts' wrong numbers
 * (docs/FRANCHISE.md 7/9: their scouts are wrong too, per-team differently
 * wrong; scouting.perceivedGroup carries the per-team persistent error).
 * The board blends perceived current ability with perceived ceiling, the
 * ceiling weight scaling with the persona's risk appetite (a boom-pick
 * hunter drafts the dream; a cautious room drafts the floor), plus a small
 * need nudge - best-available still dominates, the real-league consensus.
 *
 * Deterministic by construction: perception is persistent (never re-rolled)
 * and the scan order is fixed, so the same league state always produces the
 * same pick. No direct randomness in this module.
 */
import type { AttrGroup, League, TeamId } from '../types.js';
import { GROUP_ORDER, perceivedGroup } from '../scouting.js';
import { positionBlend } from './roster.js';

const CEIL_WEIGHT_BASE = 0.3;      // FEEL: even the most cautious room drafts some upside; the draft IS the future
const CEIL_WEIGHT_RISK_SPAN = 0.4; // FEEL: a 100-risk persona weighs ceiling at 0.7, chasing the boom
const THIN_POS_COUNT = 2;          // FEEL: fewer than two rostered bodies at a position reads as a hole worth reaching for
const NEED_BONUS = 2;              // FEEL: a 2-point board nudge; a needs pick breaks ties, never beats a clearly better prospect

/**
 * The pick an AI team makes from the available pool: the top of ITS board,
 * ranked by the team's perceived current+ceiling blend (their scouts'
 * numbers, not the truth), risk-scaled toward ceiling, with a small
 * positional-need adjustment. Called by the spine on draft night for every
 * non-user pick (tick.ts processDraft). Pure read; returns the player id.
 */
export function aiSelect(league: League, teamId: TeamId, available: string[]): string {
  const team = league.teams[teamId];
  if (!team) throw new Error(`aiSelect: unknown team ${teamId}`);
  if (available.length === 0) throw new Error('aiSelect: nothing on the board');
  const risk = team.gm ? team.gm.risk : 50; // 50 = neutral appetite when no persona exists
  const ceilWeight = CEIL_WEIGHT_BASE + CEIL_WEIGHT_RISK_SPAN * (risk / 100);

  // rostered position counts, for the need nudge
  const atPos: Record<string, number> = {};
  for (const id of team.roster) {
    const pos = league.players[id]?.pos;
    if (pos) atPos[pos] = (atPos[pos] ?? 0) + 1;
  }

  let bestId = '';
  let bestScore = -Infinity;
  // sorted scan + strict greater-than: ties resolve to the smallest id,
  // deterministically, whatever order the caller passed the pool in
  for (const pid of [...available].sort()) {
    const prospect = league.players[pid];
    if (!prospect) continue;
    const current = {} as Record<AttrGroup, number>;
    const ceiling = {} as Record<AttrGroup, number>;
    for (const g of GROUP_ORDER) {
      current[g] = perceivedGroup(league, teamId, pid, g, 'current');
      ceiling[g] = perceivedGroup(league, teamId, pid, g, 'ceiling');
    }
    // one set of eyes: the same position-demand lens the depth chart uses,
    // fed the scouts' numbers instead of the truth
    let score = (1 - ceilWeight) * positionBlend(prospect.pos, current)
      + ceilWeight * positionBlend(prospect.pos, ceiling);
    if ((atPos[prospect.pos] ?? 0) < THIN_POS_COUNT) score += NEED_BONUS;
    if (score > bestScore) {
      bestScore = score;
      bestId = pid;
    }
  }
  if (bestId === '') throw new Error('aiSelect: no known prospects on the board');
  return bestId;
}
