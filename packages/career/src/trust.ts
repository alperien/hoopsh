/**
 * trust.ts - the coach ledger: grades, trust, the role ladder, and THE
 * reacting-world invariant. OWNER: approach task. STATUS: STAGED stub.
 * updateAfterGame MUST move the role when roleClock.above reaches
 * params.trust.reactGames; the acceptance harness fails the build
 * otherwise (docs/CAREER.md, How we prove it works).
 */
import type { GameRecord } from '@hoopsh/franchise';
import type { CareerState, GameGrade } from './types.js';

/** Grade my night against the plan and the role band; mutate trust/roleClock/role. */
export function updateAfterGame(career: CareerState, record: GameRecord): GameGrade {
  throw new Error('career/trust: not implemented (approach task lands this)');
}

/** Role-relative production score 0-100 for a game line. */
export function productionScore(career: CareerState, record: GameRecord): number {
  throw new Error('career/trust: not implemented (approach task lands this)');
}
