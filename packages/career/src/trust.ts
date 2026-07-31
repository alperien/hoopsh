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
import type { ApproachCard, CareerState, CircuitKind, GameGrade, RoleId } from './types.js';
import { deviationFrom, planFor } from './approach.js';

/** The ladder, in order; promotion moves one rung per response. */
const LADDER: readonly RoleId[] = [
  'garbage', 'bench', 'rotation', 'sixthMan', 'starter', 'featured', 'franchise',
];

/**
 * Role par: the composite line a role is EXPECTED to produce per game in
 * the NBA's scoring environment. FEEL anchors shaped like real per-role
 * production (a sixth man's 13 composite is ~12 points with trimmings; a
 * franchise player's 26 is a 25-7-6 night). productionScore centers 50 on
 * par, after PAR_SCALE_BY_KIND normalizes for the circuit.
 */
const ROLE_PAR: Record<RoleId, number> = {
  garbage: 2, bench: 5, rotation: 9, sixthMan: 13, starter: 16, featured: 21, franchise: 26,
};

/**
 * Par scale by circuit: ROLE_PAR is NBA-shaped, and grading a prep game
 * against an NBA par made the flagship reacting-world invariant
 * unreachable (measured: prep finals run 34-26 vs NBA ~110; a circuit
 * scoring leader at 13.9 ppg never touched promoteAt 68, zero role moves
 * in two full seasons). FEEL table, anchored between two measurements:
 * pure team-total proportion (prep ~30/110 = 0.27) would promote every
 * decent week, so HS sits at 0.45 - a starter par of 7.2, which a real
 * circuit-leading line (~14 points with trimmings) clears and an average
 * night does not. College/euro/nbl step toward the NBA with their
 * 40-minute, grown-man scoring; china's run-and-gun pace grades closest
 * to the league. The NBA phase (career.circuit null) is scale 1.0.
 */
const PAR_SCALE_BY_KIND: Record<CircuitKind, number> = {
  hs: 0.45, college: 0.7, euro: 0.75, nbl: 0.8, china: 0.85,
};

/** The role's par in the CURRENT scoring environment (see PAR_SCALE_BY_KIND). */
function parFor(career: CareerState): number {
  const scale = career.circuit ? PAR_SCALE_BY_KIND[career.circuit.kind] : 1.0;
  return ROLE_PAR[career.coach.role] * scale;
}

/**
 * Shooting-efficiency weight in the composite: points above/below a
 * 50% true-shooting baseline (1.0 point per true attempt), so a 35%
 * chucker's production reads below a 55% scorer at equal volume and
 * volume alone can no longer buy a grade. CAL 0.7: 12 true attempts at
 * TS 35 read ~-2.5 composite, a visible drag; an efficient night gains
 * about +1, so par anchors (set pre-efficiency) keep their meaning and
 * the promoteAt/demoteAt bands stay where they were.
 */
const EFF_WEIGHT = 0.7;

/** True shot attempts, the classic 0.44 free-throw-trip weighting. REAL-ish. */
function trueAttempts(line: GameLine): number {
  return line.fga + 0.44 * line.fta;
}

/** The efficiency term of the composite (negative = the chucker tax). */
function efficiencyTerm(line: GameLine): number {
  return EFF_WEIGHT * (line.pts - trueAttempts(line));
}

/** Composite line value: scoring first, efficiency priced, giveaways punished. FEEL blend. */
function composite(line: GameLine): number {
  return line.pts
    + efficiencyTerm(line)
    + 0.7 * (line.orb + line.drb)
    + 1.0 * line.ast
    + 1.5 * (line.stl + line.blk)
    - 1.5 * line.tov;
}

/**
 * Role-relative production 0-100: 50 = exactly the role's par (scaled to
 * the circuit's scoring environment), promoteAt (68) is a night clearly
 * above the job, demoteAt (30) clearly below. DNPs are not scored (the
 * caller skips grading entirely).
 */
export function productionScore(career: CareerState, record: GameRecord): number {
  const line = record.lines.find(l => l.playerId === career.me);
  if (!line || line.min <= 0) return 0;
  const par = parFor(career);
  // 2.2: a composite 10 over par reads ~72, a clear over-delivery. FEEL.
  return clamp(Math.round(50 + (composite(line) - par) * 2.2), 0, 100);
}

/**
 * Grade my night: adherence vs the plan, production vs the role, trust
 * movement with the coach's personality in the math, the role clocks,
 * and the invariant. Mutates coach state and the event log; returns the
 * grade.
 *
 * THE CARD (felt-loop fix): pass `card` explicitly - the card the game
 * actually SIMULATED with - and every game of a week grades against the
 * same card the engine saw (week.ts captures it once per week). The old
 * behavior consumed career.nextApproach on the FIRST grade, so the
 * second game of a doubleheader simulated with the card but was graded
 * against the neutral default (measured adherence alternating 0/100 all
 * season with an off-plan card). When `card` is omitted the legacy
 * consume-nextApproach path runs unchanged, which keeps the NBA bridge
 * (one grade per league day) working without edits.
 */
export function updateAfterGame(
  career: CareerState,
  record: GameRecord,
  card?: ApproachCard & { playingHurt?: boolean },
): GameGrade {
  const { coach, params } = career;
  const t = params.trust;
  const line = record.lines.find(l => l.playerId === career.me);
  const cardUsed = card ?? career.nextApproach ?? { ...career.approach };
  if (!card) career.nextApproach = null; // legacy path: the card was for that game only

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
  // the chucker tax gets named when it bites: real volume, empty points
  // (efficiencyTerm <= -2.5 is ~12 true attempts at 35% shooting; the
  // coach says what the grade already priced)
  if (line.fga >= 8 && efficiencyTerm(line) <= -2.5) {
    reasons.push(`${line.fga} shots for ${line.pts} points is not a plan`);
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
  } else if (coach.roleClock.above >= t.reactGames && idx === LADDER.length - 1) {
    // the ladder's ceiling: there is no bigger job to give, so the clock
    // resets and the response is belief instead (the invariant's promise
    // is a response within reactGames, and this IS the response; a clock
    // that sat here forever would read as the world going deaf, and the
    // acceptance harness rightly fails that)
    coach.roleClock.above = 0;
    coach.trust = clamp(coach.trust + 2, 5, 99);
    coach.greenLight = coach.trust >= t.greenLightTrust;
  } else if (coach.roleClock.below >= t.reactGames && idx === 0) {
    // the ladder's floor: nothing below garbage; the clock resets and the
    // cost is trust (the seat itself is the response)
    coach.roleClock.below = 0;
    coach.trust = clamp(coach.trust - 2, 5, 99);
    coach.greenLight = coach.trust >= t.greenLightTrust;
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
