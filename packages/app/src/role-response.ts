/**
 * role-response.ts - the reacting-world gate's independent witness
 * (issue #41; findings C1 in findings/career-accept.md and H-trust-1 in
 * findings/career-trust.md, branch review/optimization-audit).
 *
 * WHY THIS EXISTS: the acceptance gate used to re-read
 * career.coach.roleClock, but trust.ts zeroes that clock inside the same
 * call that raises it to reactGames (the ladder block is exhaustive over
 * "clock >= reactGames", so every arm resets before updateAfterGame
 * returns). The old check verified clock hygiene, not the response: a
 * regression that kept the reset while dropping the role move stayed
 * green. Proven by mutant: suppress the promotion's role assignment in
 * trust.ts and the roleClock read passes while this module goes red.
 *
 * HOW IT WORKS: coach.grades is the complete input record of the real
 * clock inside a tenure (every updateAfterGame call pushes a grade, and
 * nothing else writes one). This module replays those grades through the
 * same documented arithmetic (above-band raises `above` and zeroes
 * `below`; below-band mirrors; par nights decay both by 1; DNP nights
 * freeze both), and when the replayed clock reaches reactGames it demands
 * the observable response: coach.role moved one rung and the move carries
 * its `ev-role-<gameId>` event with the matching delta.
 *
 * What is deliberately NOT demanded:
 *   - ladder-edge firings (franchise ceiling, garbage floor): trust.ts
 *     answers those with a silent clock reset plus a trust move and emits
 *     no event, so there is nothing observable to require. Registered in
 *     findings/career-trust.md (the silent edge trust moves).
 *   - firings inside a tenure's first observed week: a coach change is
 *     the documented legal reset (installNextCoach and freshCoach zero
 *     roleClock and start grades empty), and the outgoing tenure's final
 *     partial week leaves with it. The new tenure's backlog replays for
 *     clock phase only, then verification re-anchors on the role the
 *     world shows. At most one week per tenure goes unverified.
 */
import type { CareerState, RoleId } from '@hoopsh/career';

/**
 * The role ladder, pinned. trust.ts owns the live LADDER; the gate pins
 * the documented order independently so a regression that scrambles the
 * ladder cannot grade its own answer key. A deliberate ladder redesign
 * updates both, with the design reason stated.
 */
const LADDER: readonly RoleId[] = [
  'garbage', 'bench', 'rotation', 'sixthMan', 'starter', 'featured', 'franchise',
];

/**
 * trust.ts marks ungraded nights with this note prefix and freezes both
 * clocks (it returns before the clock block). The prefix is the grade's
 * only DNP marker; trust.ts carries the matching trap comment.
 */
const DNP_NOTE_PREFIX = 'did not play';

interface RequiredResponse {
  eventId: string;
  gameId: string;
  delta: 1 | -1;
}

export interface RoleTracker {
  /** reference identity of career.coach; a new object is a new tenure */
  coachRef: unknown;
  /** grades of the current tenure already replayed */
  cursor: number;
  above: number;
  below: number;
  /** the ladder index the world should show, per the replayed record */
  expectedIdx: number;
  /** false while a tenure's first observed week replays for phase only */
  verifying: boolean;
}

/** Start watching a career. Call once, right after createCareer. */
export function createRoleTracker(career: CareerState): RoleTracker {
  return {
    coachRef: career.coach,
    cursor: 0,
    above: 0,
    below: 0,
    expectedIdx: LADDER.indexOf(career.coach.role),
    // a career observed mid-tenure replays its backlog for clock phase
    // only; from creation (no grades yet) verification starts immediately
    verifying: career.coach.grades.length === 0,
  };
}

/**
 * Replay this week's new grades through the documented clock arithmetic
 * and demand the world's response at every mid-ladder firing. Returns
 * breach descriptions; empty means the world reacted. Call once per
 * advanceCareerWeek, after it returns.
 */
export function observeRoleResponses(tracker: RoleTracker, career: CareerState): string[] {
  const breaches: string[] = [];
  const coach = career.coach;
  const t = career.params.trust;

  // a replaced coach object is the documented legal reset (tick.ts
  // installNextCoach, nbabridge.ts freshCoach: roleClock zeroed, grades
  // emptied). The length check catches a same-reference wipe defensively.
  if (coach !== tracker.coachRef || coach.grades.length < tracker.cursor) {
    tracker.coachRef = coach;
    tracker.cursor = 0;
    tracker.above = 0;
    tracker.below = 0;
    tracker.verifying = false;
  }

  const required: RequiredResponse[] = [];
  for (; tracker.cursor < coach.grades.length; tracker.cursor++) {
    const g = coach.grades[tracker.cursor]!;
    if (g.note.startsWith(DNP_NOTE_PREFIX)) continue; // DNP: both clocks freeze
    if (g.production >= t.promoteAt) {
      tracker.above += 1;
      tracker.below = 0;
    } else if (g.production <= t.demoteAt) {
      tracker.below += 1;
      tracker.above = 0;
    } else {
      tracker.above = Math.max(0, tracker.above - 1);
      tracker.below = Math.max(0, tracker.below - 1);
    }
    // the firing: trust.ts resets both clocks on a move and one clock at
    // a ladder edge, but at an above firing `below` is already 0 (the
    // raise that reached reactGames zeroed it, and decay never raises),
    // so resetting the firing side alone is the same arithmetic. The
    // response is demanded only when verification is anchored.
    if (tracker.above >= t.reactGames) {
      if (tracker.verifying && tracker.expectedIdx < LADDER.length - 1) {
        tracker.expectedIdx += 1;
        required.push({ eventId: `ev-role-${g.gameId}`, gameId: g.gameId, delta: 1 });
      }
      tracker.above = 0;
    } else if (tracker.below >= t.reactGames) {
      if (tracker.verifying && tracker.expectedIdx > 0) {
        tracker.expectedIdx -= 1;
        required.push({ eventId: `ev-role-${g.gameId}`, gameId: g.gameId, delta: -1 });
      }
      tracker.below = 0;
    }
  }

  if (!tracker.verifying) {
    // the tenure's first observed week established clock phase; from the
    // next grade on, verify against the role the world shows now
    tracker.expectedIdx = LADDER.indexOf(coach.role);
    tracker.verifying = true;
    return breaches;
  }

  const actualIdx = LADDER.indexOf(coach.role);
  if (actualIdx < 0) {
    breaches.push(`coach role '${coach.role}' is not on the documented ladder`);
  } else if (actualIdx !== tracker.expectedIdx) {
    breaches.push(`role response missing: the graded record says '${LADDER[tracker.expectedIdx]}', the coach says '${coach.role}'`);
    tracker.expectedIdx = actualIdx; // re-anchor: one defect reports once per week, not forever
  }
  for (const r of required) {
    const ev = career.events.find(e => e.id === r.eventId);
    if (!ev || ev.kind !== 'role' || ev.delta !== r.delta) {
      breaches.push(`role response unexplained: no role event for game ${r.gameId} (delta ${r.delta})`);
    }
  }
  return breaches;
}
