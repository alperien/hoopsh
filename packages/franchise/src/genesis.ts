/**
 * genesis.ts — createLeague: the whole league at day zero. OWNER: genesis
 * task. STATUS: STAGED stub; signatures frozen.
 * Assembles: 30 franchises (teamdata.ts), genesis rosters with plausible
 * age/quality/contract structure (payrolls legal, a few teams taxed, a
 * few rebuilding), personas, coaches, picks 7 seasons out, season 1
 * calendar + schedule, initial cap lines, first draft class NOT yet
 * generated (that happens at the lottery).
 */
import type { League, TeamId } from './types.js';
import type { FranchiseParams } from './params.js';

export interface CreateLeagueOpts {
  seed: string;
  userTeam: TeamId;
  startSeason?: number;          // default 2026
  params?: Partial<FranchiseParams>;
}

export function createLeague(opts: CreateLeagueOpts): League {
  throw new Error('franchise/genesis: not implemented (genesis task lands this)');
}
