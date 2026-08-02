/**
 * career-replay.ts - the choice-log replay driver: CareerState =
 * f(seed, choiceLog), the identity tick.ts documents, made executable.
 * Rebuild the career's creation-time state from the caller's factory
 * (the determinism gate passes createCareer with the recording's seed
 * and spec), then for each recorded advance apply exactly the logged
 * choices whose clock matches the pre-advance clock (in seq order) and
 * advance one week. No script runs here; the log is the only decision
 * source. A byte-equal state at every checkpoint therefore proves
 * replay determinism, not merely that the same script drives the same
 * path twice.
 *
 * The clock match is sound because applyChoice stamps the clock at
 * application time and only advanceCareerWeek moves the clock: "every
 * logged choice whose clock equals the current one, in seq order"
 * reconstructs the original interleaving exactly, including several
 * choices inside one pre-advance window.
 *
 * Consumers: career-acceptance.ts (the determinism gate records a
 * scripted career, replays it here, byte-compares checkpoints) and the
 * app test suite (a fixture-career round trip inside the suite budget).
 */
import { advanceCareerWeek, applyChoice } from '@hoopsh/career';
import type { CareerState, LoggedChoice, SimulateJobs } from '@hoopsh/career';

/** A byte snapshot of the full career JSON taken after the at-th advance (1-based). */
export interface ReplayCheckpoint {
  at: number;
  label: string;
  json: string;
}

/**
 * Replay a recorded career from its choice log alone and verify it
 * against the recording's checkpoints. Called by the determinism gate
 * after the recording run. Returns null when every checkpoint matches
 * byte for byte; otherwise a report naming the first divergence (a
 * mismatched checkpoint, a denied replayed choice, or log entries the
 * replay's clock never reached). Aborts at the first divergent
 * checkpoint rather than replaying the rest of the segment. Mutates
 * nothing outside its own replayed career.
 */
export async function replayCareerFromLog(opts: {
  /**
   * Deterministic factory for the career's creation-time state: called
   * once, and it must return the byte-same starting point the recording
   * started from (the gate passes () => createCareer({ seed, spec })).
   */
  makeCareer: () => CareerState;
  /** the recording's career.choiceLog, seq-ordered */
  log: readonly LoggedChoice[];
  /** total advanceCareerWeek calls the recording made */
  advances: number;
  /** the recording's snapshots, ordered by at */
  expected: readonly ReplayCheckpoint[];
  sim: SimulateJobs;
}): Promise<string | null> {
  const career = opts.makeCareer();
  let li = 0; // log cursor: the log is seq-ordered and the clock only moves forward
  let ci = 0; // next expected checkpoint
  for (let at = 1; at <= opts.advances; at++) {
    while (li < opts.log.length
      && opts.log[li]!.clock.year === career.clock.year
      && opts.log[li]!.clock.week === career.clock.week) {
      const entry = opts.log[li]!;
      const r = applyChoice(career, entry.choice);
      if (!r.ok) {
        // a choice the recording applied cleanly bounced here: the replay
        // state has already drifted from the recorded state
        return `replayed choice denied at advance ${at} (seq ${entry.seq}, ${entry.choice.kind}): ${r.errors.join('; ')}`;
      }
      li += 1;
    }
    await advanceCareerWeek(career, opts.sim);
    while (ci < opts.expected.length && opts.expected[ci]!.at === at) {
      const want = opts.expected[ci]!;
      const got = JSON.stringify(career);
      if (got !== want.json) {
        return `replay diverges from the recording at ${want.label}: ${firstDivergence(want.json, got)}`;
      }
      ci += 1;
    }
  }
  if (li < opts.log.length) {
    const next = opts.log[li]!;
    return `${opts.log.length - li} recorded choices never matched a replay clock `
      + `(first: seq ${next.seq}, ${next.choice.kind} at y${next.clock.year}w${next.clock.week})`;
  }
  if (ci < opts.expected.length) {
    return `checkpoint ${opts.expected[ci]!.label} sits past the replayed advance count (${opts.advances}); recording and replay inputs disagree`;
  }
  return null;
}

/** Locate the first differing byte with context, so a red gate is debuggable. */
function firstDivergence(a: string, b: string): string {
  let at = 0;
  while (at < Math.min(a.length, b.length) && a[at] === b[at]) at++;
  return `states diverge at char ${at}: `
    + `...${a.slice(Math.max(0, at - 60), at + 40)}... vs ...${b.slice(Math.max(0, at - 60), at + 40)}...`;
}
