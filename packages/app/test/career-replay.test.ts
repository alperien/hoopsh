/**
 * The choice-log replay driver at test tier: a scripted fixture year on
 * the fast sim, recorded and replayed from its log alone, must land
 * byte-identical through the year wrap — and a tampered log must not,
 * so the acceptance gate built on this driver stays capable of failing.
 * Provenance: issue #66 (the determinism gate byte-checked a 40-week
 * slice and never replayed the choice log). Creation-scale replay is
 * the acceptance gate's job (minutes by design); the fixture keeps this
 * inside the suite budget.
 */
import { describe, expect, it } from 'vitest';
import { advanceCareerWeek, applyChoice, fastSim } from '@hoopsh/career';
import type { CareerState, LoggedChoice } from '@hoopsh/career';
import { fixtureCareer } from '../../career/test/fixture.js';
import { replayCareerFromLog } from '../src/career-replay.js';
import type { ReplayCheckpoint } from '../src/career-replay.js';

/**
 * The fixture clock starts at week 12 (hsSeasonStartWeek + 2), so the
 * year wrap lands at advance 40; one more advance steps into the new
 * phase-year. A week-only clock matcher would pass any unwrapped
 * segment — the wrap is the semantics this test exists to pin.
 */
const ADVANCES = 41;

/** Mid-segment checkpoint, after the fixture circuit's games: lets the tamper replay go red in 8 advances instead of 41. */
const MID_AT = 8;

/** Both sides of the compare start from this same deterministic state. */
function makeCareer(): CareerState {
  return fixtureCareer({ seed: 'career-replay-suite' });
}

/**
 * Record a scripted year: alternating week plans (so the log carries
 * decisions the default state would never produce), the approach card
 * while the circuit lives, and one doubled plan to pin seq order inside
 * a single pre-advance window.
 */
async function record(): Promise<{ log: LoggedChoice[]; mid: ReplayCheckpoint; final: ReplayCheckpoint; wrapped: boolean }> {
  const career = makeCareer();
  const year0 = career.clock.year;
  let mid: ReplayCheckpoint | null = null;
  for (let w = 0; w < ADVANCES; w++) {
    applyChoice(career, {
      kind: 'setWeekPlan',
      plan: w % 2 === 0
        ? { slots: ['extraWork', 'film', 'rest'], focus: 'defense' }
        : { slots: ['body', 'rest', 'life'], focus: 'scoring' },
    });
    if (w === 3) {
      // two plans in one window: the replay must apply both, in order
      applyChoice(career, { kind: 'setWeekPlan', plan: { slots: ['rest', 'rest', 'life'], focus: 'mental' } });
    }
    if (career.circuit && !career.circuit.complete) {
      applyChoice(career, {
        kind: 'setApproach',
        card: { assertiveness: 60, range: 55, motor: 58, defense: 52, playmaking: 48 },
      });
    }
    await advanceCareerWeek(career, fastSim);
    if (w + 1 === MID_AT) {
      mid = { at: MID_AT, label: 'mid-segment', json: JSON.stringify(career) };
    }
  }
  return {
    log: structuredClone(career.choiceLog),
    mid: mid!,
    final: { at: ADVANCES, label: 'final', json: JSON.stringify(career) },
    wrapped: career.clock.year > year0,
  };
}

describe('replayCareerFromLog: the recorded log alone reproduces the career', () => {
  it('replays byte-identical through the year wrap; a tampered log goes red', async () => {
    const rec = await record();
    expect(rec.wrapped).toBe(true);                   // the segment crossed a year wrap
    expect(rec.log.length).toBeGreaterThan(ADVANCES); // weekly plans plus in-season approaches

    const clean = await replayCareerFromLog({
      makeCareer, log: rec.log, advances: ADVANCES, expected: [rec.mid, rec.final], sim: fastSim,
    });
    expect(clean).toBe(null);

    // drop the doubled plan (window 4): the replayed career trains
    // differently that week and the byte compare must go red at the
    // mid checkpoint (the driver, and the gate above it, stays
    // demonstrably capable of failing); replaying only to MID_AT keeps
    // the red path cheap
    const tampered = rec.log.filter(e => !(e.choice.kind === 'setWeekPlan' && e.choice.plan.focus === 'mental'));
    expect(tampered.length).toBe(rec.log.length - 1);
    const diverged = await replayCareerFromLog({
      makeCareer, log: tampered, advances: MID_AT, expected: [rec.mid], sim: fastSim,
    });
    expect(typeof diverged).toBe('string');
    expect(diverged).toContain('diverge');
  });
});
