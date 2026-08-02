/**
 * The reacting-world gate's independent witness (issue #41): the tracker
 * must demand a role response where trust.ts owes one, stay quiet where
 * the design answers silently (ladder edges, tenure resets), and mirror
 * the documented clock arithmetic (leaky decay, DNP freeze, opposite-side
 * zeroing) exactly. The mutant family the old roleClock re-read could not
 * see is pinned here: reset kept + role move dropped, reset plus nothing,
 * move without its event. Fakes are minimal on purpose: the tracker's
 * whole read surface is coach.role, coach.grades, events, params.trust.
 */
import { describe, expect, it } from 'vitest';
import type { CareerState, RoleId } from '@hoopsh/career';
import { createRoleTracker, observeRoleResponses } from '../src/role-response.js';

const LADDER: readonly RoleId[] = [
  'garbage', 'bench', 'rotation', 'sixthMan', 'starter', 'featured', 'franchise',
];

interface FakeGrade { gameId: string; adherence: number; production: number; trustDelta: number; note: string }
interface FakeEvent { id: string; kind: string; reason: string; delta?: number }
interface Fake {
  coach: { role: RoleId; grades: FakeGrade[] };
  events: FakeEvent[];
  params: { trust: { reactGames: number; promoteAt: number; demoteAt: number } };
}

function world(role: RoleId): Fake {
  return {
    coach: { role, grades: [] },
    events: [],
    params: { trust: { reactGames: 6, promoteAt: 68, demoteAt: 30 } },
  };
}
const asCareer = (f: Fake): CareerState => f as unknown as CareerState;

function grade(f: Fake, gameId: string, production: number): void {
  f.coach.grades.push({ gameId, adherence: 100, production, trustDelta: 0, note: 'graded' });
}
function dnp(f: Fake, gameId: string): void {
  f.coach.grades.push({ gameId, adherence: 100, production: 0, trustDelta: 0, note: 'did not play; nothing to grade' });
}
/** The world's honest response, shaped exactly like trust.ts's ladder move. */
function respond(f: Fake, gameId: string, delta: 1 | -1): void {
  const idx = LADDER.indexOf(f.coach.role);
  f.coach.role = LADDER[idx + delta]!;
  f.events.push({ id: `ev-role-${gameId}`, kind: 'role', reason: 'the record demanded it', delta });
}

describe('role-response (career-acceptance.ts:gm:career-acceptance)', () => {
  it('a promotion within reactGames passes clean', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 6; i++) grade(f, `g${i}`, 80);
    respond(f, 'g6', 1);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
    expect(f.coach.role).toBe('rotation');
  });

  it('the C1 mutant goes red: reset kept, role move dropped, event still emitted', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 6; i++) grade(f, `g${i}`, 80);
    // the lying half-response: the event fires, the job never moves
    f.events.push({ id: 'ev-role-g6', kind: 'role', reason: 'outproduced', delta: 1 });
    const breaches = observeRoleResponses(tr, asCareer(f));
    expect(breaches.length).toBe(1);
    expect(breaches[0]).toContain('role response missing');
  });

  it('reset plus nothing mid-ladder goes red on both counts', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 6; i++) grade(f, `g${i}`, 80);
    const breaches = observeRoleResponses(tr, asCareer(f));
    expect(breaches.length).toBe(2);
    expect(breaches[0]).toContain('role response missing');
    expect(breaches[1]).toContain('role response unexplained');
  });

  it('a role move without its event, or with the wrong delta, is unexplained', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 6; i++) grade(f, `g${i}`, 80);
    f.coach.role = 'rotation'; // moved, never explained
    const silent = observeRoleResponses(tr, asCareer(f));
    expect(silent.length).toBe(1);
    expect(silent[0]).toContain('role response unexplained');

    const g = world('bench');
    const tg = createRoleTracker(asCareer(g));
    for (let i = 1; i <= 6; i++) grade(g, `g${i}`, 80);
    g.coach.role = 'rotation';
    g.events.push({ id: 'ev-role-g6', kind: 'role', reason: 'wrong direction', delta: -1 });
    const wrong = observeRoleResponses(tg, asCareer(g));
    expect(wrong.length).toBe(1);
    expect(wrong[0]).toContain('role response unexplained');
  });

  it('the franchise ceiling answers silently, by design', () => {
    const f = world('franchise');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 12; i++) grade(f, `g${i}`, 90); // fires at g6 and g12
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
    expect(f.coach.role).toBe('franchise');
  });

  it('the garbage floor answers silently, by design', () => {
    const f = world('garbage');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 6; i++) grade(f, `g${i}`, 10);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
  });

  it('a demotion within reactGames passes clean', () => {
    const f = world('starter');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 6; i++) grade(f, `g${i}`, 20);
    respond(f, 'g6', -1);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
    expect(f.coach.role).toBe('sixthMan');
  });

  it('par nights decay the window (leaky bucket, not consecutive): the firing lands late', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 5; i++) grade(f, `g${i}`, 80); // above 5
    grade(f, 'g6', 50);                                 // par: decays to 4
    grade(f, 'g7', 80);                                 // 5
    grade(f, 'g8', 80);                                 // 6: fires HERE, not at g6
    respond(f, 'g8', 1);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
  });

  it('a decayed run below reactGames demands nothing', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 5; i++) grade(f, `g${i}`, 80);
    grade(f, 'g6', 50); // decay to 4
    grade(f, 'g7', 80); // 5: never reaches 6
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
  });

  it('DNP nights freeze the window; the streak survives the bench', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 5; i++) grade(f, `g${i}`, 80);
    dnp(f, 'g6');
    dnp(f, 'g7');
    grade(f, 'g8', 80); // 6: fires here
    const unanswered = observeRoleResponses(tr, asCareer(f));
    expect(unanswered.length).toBe(2); // missing + unexplained

    const g = world('bench');
    const tg = createRoleTracker(asCareer(g));
    for (let i = 1; i <= 5; i++) grade(g, `g${i}`, 80);
    dnp(g, 'g6');
    dnp(g, 'g7');
    grade(g, 'g8', 80);
    respond(g, 'g8', 1);
    expect(observeRoleResponses(tg, asCareer(g))).toEqual([]);
  });

  it('an above-band night zeroes the below count, and vice versa', () => {
    const f = world('starter');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 5; i++) grade(f, `g${i}`, 20); // below 5
    grade(f, 'g6', 80);                                 // above 1, below ZEROED
    for (let i = 7; i <= 11; i++) grade(f, `g${i}`, 20); // below 5 again
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]); // no firing yet
    grade(f, 'g12', 20); // below 6: fires
    respond(f, 'g12', -1);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
  });

  it('a coach change is the legal reset; verification resumes on the new tenure', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 4; i++) grade(f, `g${i}`, 80); // streak dies with the tenure
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);

    f.coach = { role: 'rotation', grades: [] }; // the new bench, promised role and all
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]); // establishment week

    for (let i = 1; i <= 6; i++) grade(f, `n${i}`, 80);
    respond(f, 'n6', 1);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);

    for (let i = 7; i <= 12; i++) grade(f, `n${i}`, 80); // second firing, unanswered
    const breaches = observeRoleResponses(tr, asCareer(f));
    expect(breaches.length).toBe(2);
  });

  it('firings inside a tenure change week replay for phase only (documented blind spot)', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);

    f.coach = { role: 'bench', grades: [] };
    for (let i = 1; i <= 6; i++) grade(f, `n${i}`, 80); // unanswered, but unobservable
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);

    for (let i = 7; i <= 12; i++) grade(f, `n${i}`, 80); // the next window IS observable
    const breaches = observeRoleResponses(tr, asCareer(f));
    expect(breaches.length).toBe(2);
  });

  it('a window split across weekly observations still fires once, at the sixth grade', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 3; i++) grade(f, `g${i}`, 80);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
    for (let i = 4; i <= 6; i++) grade(f, `g${i}`, 80);
    respond(f, 'g6', 1);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
  });

  it('two firings in one observation demand two responses', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 6; i++) grade(f, `g${i}`, 80);
    respond(f, 'g6', 1);
    for (let i = 7; i <= 12; i++) grade(f, `g${i}`, 80);
    respond(f, 'g12', 1);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]);
    expect(f.coach.role).toBe('sixthMan');
  });

  it('a breach reports once, then re-anchors instead of spamming every week', () => {
    const f = world('bench');
    const tr = createRoleTracker(asCareer(f));
    for (let i = 1; i <= 6; i++) grade(f, `g${i}`, 80);
    expect(observeRoleResponses(tr, asCareer(f)).length).toBe(2);
    expect(observeRoleResponses(tr, asCareer(f))).toEqual([]); // no new grades, no echo
  });
});
