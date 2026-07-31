/**
 * trust.ts - the coach ledger: grades, trust, the role ladder, and THE
 * reacting-world invariant (docs/CAREER.md pillar 1): sustained
 * production forces a role response within params.trust.reactGames,
 * unconditionally. The auto-career harness fails the build if a hot
 * player stays buried, so the promotion branch below has no trust gate,
 * no personality gate, and no exception.
 *
 * Every consequence is explained (pillar 2): each grade carries the
 * coach's stated note, and every trust or role move appends a
 * CareerEvent with a nonempty reason (the explained-consequence lint
 * reads both).
 *
 * Streams: none. Grading is arithmetic over the game record.
 */
import { clamp } from '@hoopsh/engine';
import type { GameLine, GameRecord } from '@hoopsh/franchise';
import type { CareerState, GameGrade, RoleId } from './types.js';
import { deviationFrom, planFor } from './approach.js';

/** The ladder, in order; promotion moves one rung per response. */
const LADDER: readonly RoleId[] = [
  'garbage', 'bench', 'rotation', 'sixthMan', 'starter', 'featured', 'franchise',
];

/**
 * Role par: the composite line a role is EXPECTED to produce per game.
 * FEEL anchors shaped like real per-role production (a sixth man's 13
 * composite is ~12 points with trimmings; a franchise player's 26 is a
 * 25-7-6 night). productionScore centers 50 on par.
 */
const ROLE_PAR: Record<RoleId, number> = {
  garbage: 2, bench: 5, rotation: 9, sixthMan: 13, starter: 16, featured: 21, franchise: 26,
};

/** Composite line value: scoring first, giveaways punished. FEEL blend. */
function composite(line: GameLine): number {
  return line.pts
    + 0.7 * (line.orb + line.drb)
    + 1.0 * line.ast
    + 1.5 * (line.stl + line.blk)
    - 1.5 * line.tov;
}

/**
 * Role-relative production 0-100: 50 = exactly the role's par, promoteAt
 * (68) is a night clearly above the job, demoteAt (30) clearly below.
 * DNPs are not scored (the caller skips grading entirely).
 */
export function productionScore(career: CareerState, record: GameRecord): number {
  const line = record.lines.find(l => l.playerId === career.me);
  if (!line || line.min <= 0) return 0;
  const par = ROLE_PAR[career.coach.role];
  // 2.2: a composite 10 over par reads ~72, a clear over-delivery. FEEL.
  return clamp(Math.round(50 + (composite(line) - par) * 2.2), 0, 100);
}

/**
 * Grade my night: adherence vs the plan, production vs the role, trust
 * movement with the coach's personality in the math, the role clocks,
 * and the invariant. Consumes career.nextApproach (the card was for this
 * game). Mutates coach state and the event log; returns the grade.
 */
export function updateAfterGame(career: CareerState, record: GameRecord): GameGrade {
  const { coach, params } = career;
  const t = params.trust;
  const line = record.lines.find(l => l.playerId === career.me);
  const cardUsed = career.nextApproach ?? { ...career.approach };
  career.nextApproach = null; // the card was for that game only

  // a DNP grades nothing: no adherence to judge, no production to score;
  // the role clock does not move on nights the coach never called on you
  if (!line || line.min <= 0) {
    const grade: GameGrade = {
      gameId: record.id, adherence: 100, production: 0, trustDelta: 0,
      note: 'did not play; nothing to grade',
    };
    coach.grades.push(grade);
    return grade;
  }

  const plan = planFor(career);
  const deviation = deviationFrom(plan, cardUsed);
  const adherence = 100 - deviation;
  const production = productionScore(career, record);

  // trust math, every term explained in the note
  const reasons: string[] = [];
  let delta = 0;
  if (deviation <= 15) {
    delta += t.adherenceTrustGain;
    reasons.push('played the plan');
  } else if (deviation >= 40) {
    // the disciplinarian punishes freelancing double; rides-hot-hand
    // forgives it when the freelancing WORKED (FEEL personalities)
    let loss = t.deviationTrustLoss;
    if (coach.personality === 'disciplinarian') loss *= 2;
    if (coach.personality === 'ridesHotHand' && production >= t.promoteAt) loss *= 0.4;
    delta -= loss;
    reasons.push(production >= t.promoteAt
      ? 'went off script and it worked; the coach noticed both'
      : 'hunted outside the plan');
  }
  if (production >= t.promoteAt) {
    delta += t.productionTrustGain;
    reasons.push(`outproduced the ${coach.role} job (${production})`);
  } else if (production <= t.demoteAt) {
    reasons.push(`under the ${coach.role} line tonight (${production})`);
  }
  coach.trust = clamp(Math.round((coach.trust + delta) * 10) / 10, 5, 99);
  coach.greenLight = coach.trust >= t.greenLightTrust;

  // role clocks
  if (production >= t.promoteAt) {
    coach.roleClock.above += 1;
    coach.roleClock.below = 0;
  } else if (production <= t.demoteAt) {
    coach.roleClock.below += 1;
    coach.roleClock.above = 0;
  } else {
    coach.roleClock.above = Math.max(0, coach.roleClock.above - 1);
    coach.roleClock.below = Math.max(0, coach.roleClock.below - 1);
  }

  // THE REACTING-WORLD INVARIANT: reactGames consecutive above-band games
  // move the role, unconditionally. No trust gate, no personality gate.
  let roleNote = '';
  const idx = LADDER.indexOf(coach.role);
  if (coach.roleClock.above >= t.reactGames && idx < LADDER.length - 1) {
    const from = coach.role;
    coach.role = LADDER[idx + 1]!;
    coach.roleClock.above = 0;
    coach.roleClock.below = 0;
    coach.trust = clamp(coach.trust + 4, 5, 99); // earning the job earns belief (FEEL 4)
    roleNote = ` Role: ${from} to ${coach.role}, earned over ${t.reactGames} straight games.`;
    career.events.push({
      id: `ev-role-${record.id}`,
      clock: { ...career.clock },
      kind: 'role',
      reason: `outproduced the ${from} role ${t.reactGames} games running`,
      delta: 1,
    });
  } else if (coach.roleClock.below >= t.reactGames && idx > 0) {
    const from = coach.role;
    coach.role = LADDER[idx - 1]!;
    coach.roleClock.above = 0;
    coach.roleClock.below = 0;
    roleNote = ` Role: ${from} to ${coach.role}; the job shrank with the production.`;
    career.events.push({
      id: `ev-role-${record.id}`,
      clock: { ...career.clock },
      kind: 'role',
      reason: `under the ${from} line ${t.reactGames} games running`,
      delta: -1,
    });
  }

  if (delta !== 0) {
    career.events.push({
      id: `ev-trust-${record.id}`,
      clock: { ...career.clock },
      kind: 'trust',
      reason: reasons.join('; ') || 'a quiet night inside the plan',
      delta: Math.round(delta * 10) / 10,
    });
  }

  const grade: GameGrade = {
    gameId: record.id,
    adherence,
    production,
    trustDelta: Math.round(delta * 10) / 10,
    note: (reasons.join('; ') || 'a quiet night inside the plan') + roleNote,
  };
  coach.grades.push(grade);
  return grade;
}
