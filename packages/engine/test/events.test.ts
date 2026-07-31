/**
 * Event-stream shape & ordering contract — core/events.ts, the surface
 * AGENTS.md §1.3 calls "the only contract". Every assertion here is derived
 * from the JSDoc promises in core/events.ts (per-type field semantics, the
 * two-time-axes doctrine of AGENTS.md §1.5, and the ordering guarantees the
 * a10 contract scan re-verified), NOT from reading the emitting code — so a
 * failure means the stream stopped honoring what consumers were told.
 *
 * Not duplicated from invariants.test.ts (§1.6 protected): possession
 * start/end COUNT balance, final-score reconstruction, post-horn scoring,
 * minutes/plus-minus, off-court actors, TEAM-foul monotonic chain, frame
 * monotonicity. This file pins the uncovered halves: first-event framing,
 * period pairing, start/end INTERLEAVING, per-event running score, per-type
 * field completeness, personal-foul chains, and the wt/t axis promises.
 * Also not duplicated from officiating.test.ts: the flow vocabulary's
 * forced-rate emission floors and consumer chains live there — this file
 * pins the DEFAULT-stream shape of whatever the pinned seeds emit.
 *
 * Budget: exactly TWO game sims, frames OFF (~1s). Seeds re-anchored
 * 2026-07-30 (second anchor — the first was the PR #11 SimParams-hoist
 * reshuffle) after the flow re-fits (two AI dials: openerShootMalus,
 * pullUpThreeBonus; findings/refit-g3.md, g5) reshuffled every rng stream:
 * evstream-19 dropped from OT back to regulation — exactly the failure mode
 * the previous header predicted — and slot 1 moved off evstream-1 (still
 * regulation, but zero violations on the new streams) so the pool keeps
 * every flow-vocabulary event type live. Re-scouted at the rules landing
 * (OT bonus threshold + last-2:00 window penalty + made-basket clock stops
 * reshuffled every stream; same re-anchor doctrine as the prior two
 * re-scouts). Scanned evstream-1..240 on the frozen landing tree (rules +
 * fitted when-dials):
 *   evstream-10  — regulation; 1 DEFENSE-won and 1 OFFENSE-won mid-game
 *                  jump ball, 7 offensive fouls, 1 technical, 1 violation,
 *                  5 replay reviews.
 *   evstream-167 — reaches OVERTIME (period 5) with a tied Q4 period_end;
 *                  2 DEFENSE-won and 1 OFFENSE-won jump balls, 6 offensive
 *                  fouls, 1 technical, 2 replay reviews.
 * The OT seed gives the overtime legs a live branch without a seed hunt. An
 * engine rng-sequence change (legal per AGENTS §1.2) may reshuffle it back to
 * regulation — the explicit OT existence floor below then fails LOUDLY and
 * the fix is to re-scout an OT seed for the second slot (same doctrine as
 * ncaa-rules.test.ts's throw-on-scan-exhaustion; the subs.test.ts H-02
 * comment keeps the same re-anchor trail for its own OT seeds).
 */
import { describe, expect, it } from 'vitest';
import {
  simulateGame,
  type FreeThrowEvent,
  type GameEvent,
  type GameResult,
  type ShotEvent
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const pool: GameResult[] = ['evstream-10', 'evstream-167'].map((seed) => {
  const { home, away } = sampleMatchup();
  return simulateGame({ seed, home, away, collectFrames: false });
});
// Both games run the same (NBA) pack; thresholds are read back from the
// result so a rules edit re-aims these tests instead of breaking them.
const rules = pool[0]!.rules;

const maxPeriod = (g: GameResult): number =>
  g.events.reduce((m, e) => (e.period > m ? e.period : m), 1);

/** The period-framing skeleton of the stream, in stream order. */
const BOUNDARY = new Set<GameEvent['type']>([
  'game_start', 'tip_off', 'period_start', 'period_end', 'game_end'
]);
const boundaries = (g: GameResult): GameEvent[] =>
  g.events.filter((e) => BOUNDARY.has(e.type));

const shots = (g: GameResult): ShotEvent[] =>
  g.events.filter((e): e is ShotEvent => e.type === 'shot');

/** Free throws grouped into trips: a new trip starts at every n === 1. */
const ftTrips = (g: GameResult): FreeThrowEvent[][] => {
  const trips: FreeThrowEvent[][] = [];
  for (const e of g.events) {
    if (e.type !== 'free_throw') continue;
    if (e.n === 1) trips.push([e]);
    else trips[trips.length - 1]!.push(e);
  }
  return trips;
};

describe('stream framing: game_start / tip_off / period boundaries / game_end', () => {
  // events.ts:166 — "Fires exactly once, first in the stream. `lineup` is
  // each team's 5 starting on-court player ids."
  it('game_start fires exactly once, first, carrying two legal starting fives', () => {
    for (const g of pool) {
      const starts = g.events.filter((e) => e.type === 'game_start');
      expect(starts.length).toBe(1);
      const first = g.events[0]!;
      expect(first.type).toBe('game_start');
      if (first.type !== 'game_start') continue;
      expect(first.home.teamId).toBe(g.teams[0].id);
      expect(first.away.teamId).toBe(g.teams[1].id);
      for (const side of [first.home, first.away]) {
        expect(side.lineup.length).toBe(5);
        expect(new Set(side.lineup).size).toBe(5);
      }
    }
  });

  // events.ts:179 — "the stream opens `game_start` → `tip_off`".
  it('the stream opens game_start then tip_off', () => {
    for (const g of pool) {
      const second = g.events[1]!;
      expect(second.type).toBe('tip_off');
      if (second.type === 'tip_off') {
        expect([0, 1]).toContain(second.winner);
      }
    }
  });

  // events.ts:189 — "Fires exactly once, always last in the stream — only
  // after a period ends with the score NOT tied".
  it('game_end fires exactly once, last, and never with a tied score', () => {
    for (const g of pool) {
      expect(g.events.filter((e) => e.type === 'game_end').length).toBe(1);
      const last = g.events[g.events.length - 1]!;
      expect(last.type).toBe('game_end');
      expect(last.score[0]).not.toBe(last.score[1]);
      expect(g.finalScore[0]).not.toBe(g.finalScore[1]);
    }
  });

  // events.ts:179 — "Period 1 has NO `period_start` ... the count is always
  // periods played − 1"; events.ts:184 — period_end "fires once when a
  // period's clock reaches 0". Each fires once per period, in period order.
  it('period_start runs 2..N and period_end runs 1..N, once per period', () => {
    for (const g of pool) {
      const n = maxPeriod(g);
      const startPeriods = g.events
        .filter((e) => e.type === 'period_start')
        .map((e) => e.period);
      const endPeriods = g.events
        .filter((e) => e.type === 'period_end')
        .map((e) => e.period);
      const expectStarts: number[] = [];
      const expectEnds: number[] = [];
      for (let p = 1; p <= n; p++) {
        if (p > 1) expectStarts.push(p);
        expectEnds.push(p);
      }
      expect(startPeriods).toEqual(expectStarts);
      expect(endPeriods).toEqual(expectEnds);
    }
  });

  // events.ts:184 — period_end fires "before either `period_start` (next
  // period) or `game_end`"; events.ts:179 — every period_start comes after a
  // period_end. Checked on the boundary-event subsequence (subs/timeouts may
  // legally sit between the horn and the next period's opener).
  it('boundary order: period_end → (period_start | game_end); period_start always follows a period_end', () => {
    for (const g of pool) {
      const b = boundaries(g);
      const bad: string[] = [];
      for (let i = 0; i < b.length; i++) {
        const e = b[i]!;
        if (e.type === 'period_end') {
          const next = b[i + 1];
          if (!next || (next.type !== 'period_start' && next.type !== 'game_end')) {
            bad.push(`period_end p${e.period} followed by ${next?.type ?? 'nothing'}`);
          }
        }
        if (e.type === 'period_start' && b[i - 1]?.type !== 'period_end') {
          bad.push(`period_start p${e.period} not preceded by period_end`);
        }
      }
      expect(bad).toEqual([]);
    }
  });

  // events.ts:189 — "a tied period always triggers another overtime instead"
  // (of game_end), once regulation periods are exhausted.
  it('a tied period_end at/after regulation forces another period, never game_end', () => {
    let tiedEndsSeen = 0;
    for (const g of pool) {
      const b = boundaries(g);
      for (let i = 0; i < b.length; i++) {
        const e = b[i]!;
        if (e.type !== 'period_end' || e.period < rules.periods) continue;
        if (e.score[0] === e.score[1]) {
          tiedEndsSeen++;
          expect(b[i + 1]?.type).toBe('period_start');
        }
      }
    }
    // Vacuity floor: the evstream-48 OT game contributes its tied Q4 horn.
    expect(tiedEndsSeen).toBeGreaterThanOrEqual(1);
  });

  // Existence floor for every OT-conditional assert in this file. Scouted:
  // evstream-48 plays period 5. If an rng-sequence change reshuffles this
  // seed back to regulation, re-scout a fresh OT seed (see file header).
  it('the pool reaches overtime (existence floor for the OT legs)', () => {
    const otPeriods = pool.reduce(
      (n, g) => n + Math.max(0, maxPeriod(g) - rules.periods), 0);
    expect(otPeriods).toBeGreaterThanOrEqual(1);
  });

  // events.ts:173 — "Fires once per period-opening jump ball: at game start
  // and, per NBA convention, again at the start of every overtime period."
  // (Mid-game held-ball jumps are JumpBallEvent, never tip_off — the counts
  // here stay pure period openers.)
  it('tip_off fires once at game start plus once per overtime period', () => {
    for (const g of pool) {
      const tips = g.events.filter((e) => e.type === 'tip_off');
      expect(tips.length).toBe(1 + Math.max(0, maxPeriod(g) - rules.periods));
      // extra tips are OT openers: stamped with an OT period, and in boundary
      // order they follow that OT period's period_start.
      const b = boundaries(g);
      for (let i = 0; i < b.length; i++) {
        const e = b[i]!;
        if (e.type !== 'tip_off' || e === tips[0]) continue;
        expect(e.period).toBeGreaterThan(rules.periods);
        expect(b[i - 1]?.type).toBe('period_start');
      }
    }
  });

  // events.ts:173 — "`winner` gets the ball first." And the possession kind:
  // possession.ts endPeriod (:810-816) stamps every jump-ball opener (game
  // AND each OT) kind 'tip', and since the flow officiating vocabulary
  // events.ts:194 extends the same label to a DEFENSE-won mid-game held-ball
  // jump (JumpBallEvent, sim/possession.ts tickScramble / sim/passing.ts
  // attemptReachIn) — "reusing 'tip' keeps an administered jump from ever
  // reading as a transition/fastbreak start". An OFFENSE-won jump continues
  // the same possession with no possession_start at all, so the pairing is:
  // tip starts = tip_offs + defense-won jump_balls, each handed to its
  // winner. (The deeper offense-won/held_ball consumer chain is pinned at
  // forced rates in officiating.test.ts.)
  it("every tip_off and defense-won jump_ball hands the next possession to its winner, kind 'tip'", () => {
    let defWon = 0;
    let offWon = 0;
    let tipStarts = 0;
    let tipOffs = 0;
    for (const g of pool) {
      let open: 0 | 1 | null = null;
      for (let i = 0; i < g.events.length; i++) {
        const e = g.events[i]!;
        if (e.type === 'possession_start') {
          open = e.team;
          if (e.kind === 'tip') tipStarts++;
          continue;
        }
        if (e.type === 'possession_end') {
          open = null;
          continue;
        }
        if (e.type !== 'tip_off' && e.type !== 'jump_ball') continue;
        if (e.type === 'tip_off') tipOffs++;
        else {
          // both mid-game tie-up sites are live-ball, so a jump always
          // fires with a possession open; the offense keeping the tap means
          // that SAME possession simply continues (no new start to check).
          expect(open).not.toBe(null);
          if (e.winner === open) {
            offWon++;
            continue;
          }
          defWon++;
        }
        const ps = g.events.slice(i + 1).find((x) => x.type === 'possession_start');
        expect(ps?.type).toBe('possession_start');
        if (ps?.type !== 'possession_start') continue;
        expect(ps.team).toBe(e.winner);
        expect(ps.kind).toBe('tip');
      }
    }
    // pairing across the pool — a 'tip' start exists only off a jump:
    // period openers 1:1, plus one per defense-won mid-game jump ball.
    expect(tipStarts).toBe(tipOffs + defWon);
    // both mid-game branches live: both pool games host a DEFENSE-won jump
    // and each hosts an OFFENSE-won one (scouted, see header).
    expect(defWon).toBeGreaterThanOrEqual(1);
    expect(offWon).toBeGreaterThanOrEqual(1);
  });

  // RESOLVED doc conflict (was an it.todo): events.ts:194 used to claim OT
  // openers were labeled 'inbound' while endPeriod stamps 'tip'. Audit M-01
  // fixed the doc — it now reads 'tip' for every OT jump ball — so nothing
  // is left to track; the 'tip' behavior stays pinned by the test above.

  // events.ts:173 — "Regulation Q2/Q3 open with the ball going to the
  // game-opening tip's LOSER and Q4 to its winner — the real NBA rule
  // (W-L-L-W across the quarters), not an alternating arrow."
  it('regulation period openers follow W-L-L-W around the opening tip', () => {
    for (const g of pool) {
      const opener = g.events.find((e) => e.type === 'tip_off');
      expect(opener?.type).toBe('tip_off');
      if (opener?.type !== 'tip_off') continue;
      const winner = opener.winner;
      for (let p = 2; p <= rules.periods; p++) {
        const at = g.events.findIndex(
          (e) => e.type === 'period_start' && e.period === p);
        const ps = g.events.slice(at).find((x) => x.type === 'possession_start');
        if (ps?.type !== 'possession_start') continue;
        // final regulation period back to the winner, middle periods to the loser
        expect(ps.team).toBe(p === rules.periods ? winner : 1 - winner);
      }
    }
  });

  // sim/passing.ts:108-146 horn guards + events.ts:184 — the documented
  // phantom-possession regression class: nothing may start a possession
  // between a period's horn and the next period's opener.
  it('no possession ever starts between a period horn and the next period_start', () => {
    for (const g of pool) {
      let deadBetweenPeriods = false;
      let leaked = 0;
      for (const e of g.events) {
        if (e.type === 'period_end') deadBetweenPeriods = true;
        else if (e.type === 'period_start' || e.type === 'game_end') deadBetweenPeriods = false;
        else if (deadBetweenPeriods && e.type === 'possession_start') leaked++;
      }
      expect(leaked).toBe(0);
    }
  });
});

describe('possession pairing', () => {
  // events.ts:194 — "Pairs 1:1 with a later `possession_end` for the same
  // possession"; events.ts:201-208 — exactly once per possession.
  // invariants.test.ts pins equal COUNTS only; this pins the INTERLEAVING
  // and that each end names the open possession's team.
  it('starts and ends strictly alternate, and each end matches the open team', () => {
    for (const g of pool) {
      let open: 0 | 1 | null = null;
      let opened = 0;
      const bad: string[] = [];
      for (const e of g.events) {
        if (e.type === 'possession_start') {
          if (open !== null) bad.push(`start while team ${open} possession open @wt ${e.wt}`);
          open = e.team;
          opened++;
        } else if (e.type === 'possession_end') {
          if (open === null) bad.push(`end with no open possession @wt ${e.wt}`);
          else if (e.team !== open) bad.push(`end team ${e.team} != open team ${open} @wt ${e.wt}`);
          open = null;
        }
      }
      expect(bad).toEqual([]);
      expect(opened).toBeGreaterThan(100); // vacuity floor: a real game's pace
    }
  });

  // events.ts:194 — "'steal': a takeaway (bad pass or reach-in) starts the
  // new team's possession immediately"; events.ts:355 — the turnover's
  // `team` is the side LOSING the ball, so the thief's side is 1 - team.
  it("a steal-kind possession belongs to the thief's side, straight off a stolen turnover", () => {
    let checked = 0;
    for (const g of pool) {
      for (let i = 0; i < g.events.length; i++) {
        const e = g.events[i]!;
        if (e.type !== 'possession_start' || e.kind !== 'steal') continue;
        checked++;
        let to: GameEvent | undefined;
        for (let j = i - 1; j >= 0; j--) {
          if (g.events[j]!.type === 'turnover') { to = g.events[j]; break; }
        }
        expect(to?.type).toBe('turnover');
        if (to?.type !== 'turnover') continue;
        expect(to.stolenBy).toBeTruthy();
        expect(e.team).toBe(1 - to.team);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5); // re-scouted 29 across the pool
  });
});

describe('two time axes: Base.t vs Base.wt (AGENTS §1.5)', () => {
  // events.ts:137-139 — "`wt` is always >= `t` and monotonically
  // non-decreasing across the event stream"; t only advances with the game
  // clock, so it is non-decreasing too.
  it('wt >= t on every event, and both axes never run backwards', () => {
    for (const g of pool) {
      let violations = 0;
      let prevWt = -1;
      let prevT = -1;
      for (const e of g.events) {
        if (e.wt < e.t) violations++;
        if (e.wt < prevWt || e.t < prevT) violations++;
        prevWt = e.wt;
        prevT = e.t;
      }
      expect(violations).toBe(0);
    }
  });

  // events.ts:139-141 — "events stamp wt at 2 decimals (state.ts emit)";
  // Base.clock is "seconds remaining in period" (never negative, and capped
  // by the period's length: rulepack periodMinutes / otMinutes).
  it('t, wt, clock carry 2-decimal stamps; clock stays in [0, period length]', () => {
    for (const g of pool) {
      let violations = 0;
      for (const e of g.events) {
        for (const v of [e.t, e.wt, e.clock]) {
          if (Math.round(v * 100) / 100 !== v || v < 0) violations++;
        }
        const capSec =
          (e.period <= rules.periods ? rules.periodMinutes : rules.otMinutes) * 60;
        if (e.clock > capSec) violations++;
      }
      expect(violations).toBe(0);
    }
  });

  // events.ts:162 — "score AFTER this event: [home, away]". Folding ONLY
  // made shots and made free throws must reproduce every event's score
  // field (invariants.test.ts checks the FINAL score alone; this pins the
  // running value at all ~1200 events per game). Technical free throws fold
  // in like any other make (events.ts:305-306); a def_goaltend violation
  // rides a made `shot` whose points the shot itself already carries, so no
  // event type outside makes ever moves the score.
  it('score is the running score AFTER each event, reconstructible from makes alone', () => {
    for (const g of pool) {
      let h = 0;
      let a = 0;
      let mismatches = 0;
      for (const e of g.events) {
        if (e.type === 'shot' && e.made) {
          if (e.team === 0) h += e.points; else a += e.points;
        } else if (e.type === 'free_throw' && e.made) {
          if (e.team === 0) h += 1; else a += 1;
        }
        if (e.score[0] !== h || e.score[1] !== a) mismatches++;
      }
      expect(mismatches).toBe(0);
      expect([h, a]).toEqual(g.finalScore);
    }
  });

  // events.ts:131-132 — "Two events during the same dead ball share the same
  // `t`"; §1.5 — wallT advances every tick, stoppages included; and
  // events.ts:280-284 — n runs 1..of within a trip for one shooter.
  it('a free-throw trip runs on a frozen game clock: equal t, advancing wt, n counting 1..of', () => {
    let multiTrips = 0;
    for (const g of pool) {
      const bad: string[] = [];
      for (const trip of ftTrips(g)) {
        if (trip.length >= 2) multiTrips++;
        for (let i = 0; i < trip.length; i++) {
          const e = trip[i]!;
          if (e.n !== i + 1) bad.push(`n=${e.n} at trip position ${i + 1}`);
          if (e.of !== trip[0]!.of) bad.push('of changed mid-trip');
          if (e.shooter !== trip[0]!.shooter) bad.push('shooter changed mid-trip');
          if (e.t !== trip[0]!.t) bad.push(`game clock moved during a trip @wt ${e.wt}`);
          if (i > 0 && !(e.wt > trip[i - 1]!.wt)) bad.push(`wall clock stalled @wt ${e.wt}`);
        }
        if (trip[trip.length - 1]!.n !== trip[0]!.of) bad.push('trip ended before n reached of');
      }
      expect(bad).toEqual([]);
    }
    expect(multiTrips).toBeGreaterThanOrEqual(10); // re-scouted 53 across the pool
  });

  // §1.5 / events.ts:133-137 — the axes genuinely diverge: stoppages occupy
  // wall time, so by the final horn wt has outrun t.
  it('the wall clock outruns the game clock by the end of every game', () => {
    for (const g of pool) {
      const last = g.events[g.events.length - 1]!;
      expect(last.wt).toBeGreaterThan(last.t);
    }
  });
});

describe('per-type field contract', () => {
  // The GameEvent union, core/events.ts:512-530, plus each interface's
  // documented required fields. A consumer types against these; an event
  // missing one is a contract break even if the sim looks fine. The table
  // spans the ENTIRE union — the flow officiating vocabulary (replay v3:
  // jump_ball / violation / replay_review, TurnoverKind travel /
  // off_goaltend, FoulKind take / technical, the timeout-economy reasons)
  // is covered with its own documented required fields, and a type this
  // table does not document fails the default arm below: an undocumented
  // type IS the regression this net exists to catch.
  it('every event carries its documented per-type required fields', () => {
    const KINDS = {
      possession_start: ['inbound', 'live_rebound', 'steal', 'tip'],
      pass: ['normal', 'kickout', 'outlet', 'entry', 'handoff'],
      turnover: ['bad_pass', 'lost_ball', 'off_foul', 'shot_clock',
        'out_of_bounds', 'travel', 'off_goaltend'],
      foul: ['shooting', 'reach', 'offensive', 'loose_ball', 'take', 'technical'],
      outcome: ['made_fg', 'made_ft', 'def_rebound', 'turnover', 'period_end', 'held_ball'],
      zone: ['rim', 'paint', 'mid', 'three'],
      move: ['catch_shoot', 'pull_up', 'drive', 'cut_finish', 'post', 'putback', 'heave'],
      timeout: ['stop_run', 'advance', 'mandatory', 'regroup'],
      violation: ['def_goaltend', 'kicked_ball'],
      review: ['oob', 'late_make', 'period_end']
    };
    const seen = new Map<GameEvent['type'], number>();
    const bad: string[] = [];
    for (const g of pool) {
      for (const e of g.events) {
        seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
        // Base (events.ts:149-164): both clocks, a 1-based period, a
        // [home, away] score of non-negative integers.
        if (!Number.isFinite(e.t) || !Number.isFinite(e.wt)) bad.push(`${e.type}: bad clocks`);
        if (!Number.isInteger(e.period) || e.period < 1) bad.push(`${e.type}: bad period`);
        if (e.score.length !== 2 || e.score.some((s) => !Number.isInteger(s) || s < 0)) {
          bad.push(`${e.type}: bad score`);
        }
        switch (e.type) {
          case 'game_start':
            // events.ts:166-171 — a teamId and a starting five per side
            // (the legal-five detail is pinned by the framing suite above).
            if (typeof e.home.teamId !== 'string' || typeof e.away.teamId !== 'string') {
              bad.push('game_start: teamId');
            }
            if (e.home.lineup.length !== 5 || e.away.lineup.length !== 5) {
              bad.push('game_start: lineup');
            }
            break;
          case 'period_start':
          case 'period_end':
          case 'game_end':
            // Base-only markers (events.ts:179-192) — nothing beyond Base.
            break;
          case 'tip_off':
            if (e.winner !== 0 && e.winner !== 1) bad.push('tip_off: winner');
            break;
          case 'possession_start':
            if (!KINDS.possession_start.includes(e.kind)) bad.push(`possession_start: kind ${e.kind}`);
            break;
          case 'possession_end':
            if (!KINDS.outcome.includes(e.outcome)) bad.push(`possession_end: outcome ${e.outcome}`);
            break;
          case 'pass':
            if (typeof e.from !== 'string' || typeof e.to !== 'string' || e.from === e.to) {
              bad.push('pass: from/to');
            }
            if (!KINDS.pass.includes(e.kind)) bad.push(`pass: kind ${e.kind}`);
            break;
          case 'shot':
            if (typeof e.shooter !== 'string') bad.push('shot: shooter');
            if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.distFt)) {
              bad.push('shot: coordinates');
            }
            if (!KINDS.zone.includes(e.zone)) bad.push(`shot: zone ${e.zone}`);
            if (!KINDS.move.includes(e.moveType)) bad.push(`shot: moveType ${e.moveType}`);
            if (typeof e.three !== 'boolean' || typeof e.made !== 'boolean') bad.push('shot: flags');
            if (![0, 2, 3].includes(e.points)) bad.push(`shot: points ${e.points}`);
            break;
          case 'free_throw':
            if (typeof e.shooter !== 'string') bad.push('free_throw: shooter');
            if (!Number.isInteger(e.n) || !Number.isInteger(e.of) || e.n < 1 || e.n > e.of) {
              bad.push(`free_throw: n/of ${e.n}/${e.of}`);
            }
            break;
          case 'rebound':
            if (typeof e.offensive !== 'boolean') bad.push('rebound: offensive');
            if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) bad.push('rebound: spot');
            if (e.player !== undefined && typeof e.player !== 'string') bad.push('rebound: player');
            break;
          case 'turnover':
            if (typeof e.player !== 'string') bad.push('turnover: player');
            if (!KINDS.turnover.includes(e.kind)) bad.push(`turnover: kind ${e.kind}`);
            break;
          case 'foul':
            if (typeof e.on !== 'string') bad.push('foul: on');
            if (!KINDS.foul.includes(e.kind)) bad.push(`foul: kind ${e.kind}`);
            // events.ts:85-91 — a technical stamps SNAPSHOT counts (legal on
            // 0 personals); every other kind has just incremented, so >= 1.
            if (!Number.isInteger(e.personalCount) ||
              e.personalCount < (e.kind === 'technical' ? 0 : 1)) {
              bad.push('foul: personalCount');
            }
            if (!Number.isInteger(e.teamCountInPeriod) || e.teamCountInPeriod < 0) bad.push('foul: teamCount');
            if (typeof e.inBonus !== 'boolean' || typeof e.fouledOut !== 'boolean') bad.push('foul: flags');
            break;
          case 'timeout':
            if (!KINDS.timeout.includes(e.reason)) bad.push(`timeout: reason ${e.reason}`);
            if (!Number.isInteger(e.remaining) || e.remaining < 0) bad.push('timeout: remaining');
            break;
          case 'substitution':
            // events.ts:431-434 — parallel arrays; every current caller swaps
            // exactly one player, and never a player for himself.
            if (e.out.length !== 1 || e.in.length !== 1) bad.push('substitution: array shape');
            if (e.out[0] === e.in[0]) bad.push('substitution: no-op swap');
            break;
          case 'jump_ball':
            // events.ts:459-470 — two distinct tied-up contestants, the side
            // that controls the tap, and whoever came up with it.
            if (e.between.length !== 2 || e.between.some((p) => typeof p !== 'string') ||
              e.between[0] === e.between[1]) {
              bad.push('jump_ball: between');
            }
            if (e.winner !== 0 && e.winner !== 1) bad.push('jump_ball: winner');
            if (typeof e.gainedBy !== 'string') bad.push('jump_ball: gainedBy');
            break;
          case 'violation':
            // events.ts:484-491 — kind carries the contract; player is
            // optional (a future team-attributed kind may omit it) but a
            // string when present.
            if (!KINDS.violation.includes(e.kind)) bad.push(`violation: kind ${e.kind}`);
            if (e.player !== undefined && typeof e.player !== 'string') bad.push('violation: player');
            break;
          case 'replay_review':
            // events.ts:493-509 — trigger only; deliberately NO outcome
            // field (an always-'stands' outcome would be dead surface per
            // AGENTS.md DO-NOT #5, so don't "strengthen" one in here).
            if (!KINDS.review.includes(e.trigger)) bad.push(`replay_review: trigger ${e.trigger}`);
            break;
          default:
            // An event type this table does not document is an undocumented
            // stream shape — extend the table from the events.ts per-type
            // docs; never allowlist past this arm (THE COVENANT: skipping
            // unknown types is weakening).
            bad.push(`undocumented event type ${(e as { type: string }).type}`);
        }
      }
    }
    expect(bad).toEqual([]);
    // Vacuity floors — every type the pinned seeds deterministically emit
    // actually appeared (timeout included: endgame defaults ON,
    // events.ts:394-397; the flow trio re-scouted 2 jump_balls, 3
    // violations, 7 replay_reviews across the pool). held_ball and
    // off_goaltend never occur on these seeds — their forced-rate emission
    // floors are officiating.test.ts's job, not this file's.
    for (const t of ['game_start', 'tip_off', 'period_start', 'period_end', 'game_end',
      'possession_start', 'possession_end', 'pass', 'shot', 'free_throw',
      'rebound', 'turnover', 'foul', 'timeout', 'substitution',
      'jump_ball', 'violation', 'replay_review'] as const) {
      expect(seen.get(t) ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  // events.ts:221-228 — "All five kinds are live AI code paths today."
  // Scouted: all five appear in EACH pool game individually.
  it('all five pass kinds are live code paths', () => {
    const kinds = new Set<string>();
    for (const g of pool) {
      for (const e of g.events) if (e.type === 'pass') kinds.add(e.kind);
    }
    for (const k of ['normal', 'kickout', 'outlet', 'entry', 'handoff']) {
      expect([...kinds]).toContain(k);
    }
  });

  // events.ts:238-240 — "shot charts are built directly from x/y/distFt/
  // zone/three": chart coordinates live in the court frame (a shooter
  // releases in bounds), court dims read from result.rules.
  it('shot x/y land inside the court', () => {
    let out = 0;
    for (const g of pool) {
      for (const e of shots(g)) {
        if (e.x < 0 || e.x > rules.courtLengthFt || e.y < 0 || e.y > rules.courtWidthFt) out++;
      }
    }
    expect(out).toBe(0);
  });
});

describe('shot event invariants (events.ts:238-258)', () => {
  const all: ShotEvent[] = pool.flatMap((g) => shots(g));

  // events.ts:241-243 — "`points` is always 0 when `made` is false, and
  // always `three ? 3 : 2` when `made` is true — never inferred from zone".
  it('points: 0 on a miss, three ? 3 : 2 on a make', () => {
    let bad = 0;
    let madeThrees = 0;
    let madeTwos = 0;
    let misses = 0;
    for (const e of all) {
      if (!e.made) { misses++; if (e.points !== 0) bad++; }
      else {
        if (e.three) madeThrees++; else madeTwos++;
        if (e.points !== (e.three ? 3 : 2)) bad++;
      }
    }
    expect(bad).toBe(0);
    // all three value branches genuinely executed
    expect(misses).toBeGreaterThanOrEqual(20);
    expect(madeTwos).toBeGreaterThanOrEqual(20);
    expect(madeThrees).toBeGreaterThanOrEqual(5);
  });

  // events.ts:243-247 — assist "present only when `made` is true"; a passer
  // never assists his own shot (sim/shooting.ts startShot excludes it).
  it('assist appears only on makes and never names the shooter', () => {
    let assisted = 0;
    let bad = 0;
    for (const e of all) {
      if (e.assist !== undefined) {
        assisted++;
        if (!e.made) bad++;
        if (e.assist === e.shooter) bad++;
      }
    }
    expect(bad).toBe(0);
    expect(assisted).toBeGreaterThanOrEqual(10);
  });

  // events.ts:247-250 — "`blockedBy` can only be set when `made` is false
  // ... blocks subtract from misses, not from makes".
  it('blockedBy appears only on misses', () => {
    let blocked = 0;
    let bad = 0;
    for (const e of all) {
      if (e.blockedBy !== undefined) {
        blocked++;
        if (e.made) bad++;
      }
    }
    expect(bad).toBe(0);
    expect(blocked).toBeGreaterThanOrEqual(5); // re-scouted 25 across the pool
  });

  // events.ts:254-257 / :269 — contest is "0 wide open .. 1 smothered".
  it('contest sits in [0, 1] on every attempt', () => {
    let bad = 0;
    for (const e of all) {
      if (!(e.contest >= 0 && e.contest <= 1)) bad++;
    }
    expect(bad).toBe(0);
    expect(all.length).toBeGreaterThan(100);
  });

  // events.ts:250-254 — "`andOne: true` iff the shot ALSO went in (bonus
  // single free throw); `andOne: false` means the shot missed and
  // `ftAwarded` (2 or 3, matching shot value) free throws follow"; plus
  // events.ts:283-284 — "an and-one is always `n: 1, of: 1`". The trip that
  // follows belongs to the fouled shooter — though when the same whistle
  // also draws a technical, the tech shooter's single 1-of-1 attempt is
  // interposed BEFORE the trip (events.ts:298-305, real row order), so the
  // shooter's trip is the first NON-technical free throw.
  it('a shooting foul stamps andOne = made, awards made ? 1 : (three ? 3 : 2) FTs to the shooter', () => {
    let fouled = 0;
    let andOnes = 0;
    const bad: string[] = [];
    for (const g of pool) {
      const evs = g.events;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i]!;
        if (e.type !== 'shot' || !e.foul) continue;
        fouled++;
        if (e.foul.andOne) andOnes++;
        if (e.foul.andOne !== e.made) bad.push(`andOne ${e.foul.andOne} but made ${e.made}`);
        const wantFts = e.made ? 1 : e.three ? 3 : 2;
        if (e.foul.ftAwarded !== wantFts) bad.push(`ftAwarded ${e.foul.ftAwarded}, want ${wantFts}`);
        const ft = evs.slice(i + 1).find(
          (x): x is FreeThrowEvent => x.type === 'free_throw' && x.technical !== true);
        if (!ft) bad.push('no free throw follows a shooting foul');
        else {
          if (ft.shooter !== e.shooter) bad.push('FT shooter is not the fouled shooter');
          if (ft.n !== 1 || ft.of !== e.foul.ftAwarded) bad.push(`trip opened ${ft.n}/${ft.of}, want 1/${e.foul.ftAwarded}`);
        }
      }
    }
    expect(bad).toEqual([]);
    // re-scouted 56 (19 and-ones) — incl. ONE tech-rider interposition on
    // evstream-48, so the non-technical skip above is a live branch.
    expect(fouled).toBeGreaterThanOrEqual(5);
    expect(andOnes).toBeGreaterThanOrEqual(1);
  });

  // sim/shooting.ts gate documented in docs/INTERNALS.md known
  // simplifications: a shooting foul is only awarded when a contester
  // exists — so every fouled shot carries contestedBy. (Deliberately NOT
  // asserting foul.by === contestedBy: events.ts:254-257 declares them
  // independent.)
  it('a shooting foul implies a contester: foul ⇒ contestedBy present', () => {
    let fouled = 0;
    for (const e of all) {
      if (!e.foul) continue;
      fouled++;
      expect(e.contestedBy).toBeTruthy();
    }
    expect(fouled).toBeGreaterThanOrEqual(5);
  });
});

describe('turnover and foul bookkeeping', () => {
  // events.ts:44-60 — 'lost_ball' "always carries `stolenBy`"; 'shot_clock'
  // and 'out_of_bounds' never do; an 'off_foul' (charge) awards a dead-ball
  // inbound, never a steal; and the flow kinds 'travel' and 'off_goaltend'
  // are dead-ball violation TOs that "never carry stolenBy" (the real
  // scoring convention). ('bad_pass' carries it only when picked off, so it
  // has no unconditional side to pin — every OTHER kind is a never-steal.)
  it('stolenBy: always on lost_ball, never on any other kind but bad_pass', () => {
    let lost = 0;
    let never = 0;
    let bad = 0;
    for (const g of pool) {
      for (const e of g.events) {
        if (e.type !== 'turnover') continue;
        if (e.kind === 'lost_ball') {
          lost++;
          if (!e.stolenBy) bad++;
        } else if (e.kind !== 'bad_pass') {
          never++;
          if (e.stolenBy !== undefined) bad++;
        }
      }
    }
    expect(bad).toBe(0);
    expect(lost).toBeGreaterThanOrEqual(5); // re-scouted 13
    expect(never).toBeGreaterThanOrEqual(5); // re-scouted 26 (incl. 1 travel)
  });

  // events.ts:49-51 — 'off_foul' is "always immediately followed by a `foul`
  // event with kind 'offensive' for the same player" (turnover first, then
  // the foul — sim/game.ts tickLive ordering).
  it('a charge is a pair: off_foul turnover immediately followed by the offensive foul on that player', () => {
    let charges = 0;
    for (const g of pool) {
      for (let i = 0; i < g.events.length; i++) {
        const e = g.events[i]!;
        if (e.type !== 'turnover' || e.kind !== 'off_foul') continue;
        charges++;
        const next = g.events[i + 1];
        expect(next?.type).toBe('foul');
        if (next?.type !== 'foul') continue;
        expect(next.kind).toBe('offensive');
        expect(next.on).toBe(e.player);
      }
    }
    expect(charges).toBeGreaterThanOrEqual(2); // re-scouted 8 across the pool
  });

  // events.ts:365-366 — personalCount is "the fouler's running total for the
  // game (not the period)": +1 per foul, never resetting across periods.
  // Kind 'technical' is the documented exception (events.ts:85-91): a tech
  // is not a personal in NBA accounting, so its stamp REPEATS the fouler's
  // current total unchanged — "snapshot, not an increment" (fouls.ts:113).
  // (invariants.test.ts pins the TEAM chain; the per-player chain is here.)
  it('personalCount chains +1 per personal foul, never resets; a technical repeats it unchanged', () => {
    let techs = 0;
    for (const g of pool) {
      const counts = new Map<string, number>();
      let bad = 0;
      for (const e of g.events) {
        if (e.type !== 'foul') continue;
        const prev = counts.get(e.on) ?? 0;
        if (e.kind === 'technical') {
          techs++;
          if (e.personalCount !== prev) bad++;
        } else {
          if (e.personalCount !== prev + 1) bad++;
          counts.set(e.on, e.personalCount);
        }
      }
      expect(bad).toBe(0);
      expect(counts.size).toBeGreaterThan(5); // several distinct foulers
    }
    expect(techs).toBeGreaterThanOrEqual(1); // re-scouted 3 across the pool
  });

  // events.ts:366-375 — inBonus is driven by teamCountInPeriod against
  // rules.teamFoulBonusAt (a tech's snapshot count included); fouledOut is
  // "true exactly when personalCount >= rules.foulOutAt" — EXCEPT kind
  // 'technical', where it "is always false" (events.ts:88-91). The tech
  // draw runs AFTER the foul-out replacement (fouls.ts:103-116), so a tech
  // riding a foul-out whistle legally stamps personalCount AT the limit
  // with fouledOut still false — the naive formula is wrong for techs.
  // Thresholds read from result.rules, not literals.
  it('inBonus and fouledOut follow their documented threshold formulas', () => {
    // The full penalty-state formula (events.ts FoulEvent doc): regulation
    // threshold (teamFoulBonusAt; teamFoulBonusAtOT in OT) OR the NBA
    // last-2:00 window rule (lateWindowSec/lateWindowFoulBonusAt) — the
    // window count is reconstructed from the stream itself, which is the
    // point: a consumer can re-derive inBonus from prior foul events alone.
    let fouls = 0;
    let bad = 0;
    for (const g of pool) {
      // per-period, per-team window counts, rebuilt in stream order
      let period = 0;
      const lateCounts: [number, number] = [0, 0];
      for (const e of g.events) {
        if (e.period !== period) { period = e.period; lateCounts[0] = 0; lateCounts[1] = 0; }
        if (e.type !== 'foul') continue;
        const counting = e.kind !== 'offensive' && e.kind !== 'technical';
        if (counting && rules.lateWindowSec > 0 && e.clock <= rules.lateWindowSec) {
          lateCounts[e.team] += 1;
        }
        fouls++;
        const threshold = e.period > rules.periods ? rules.teamFoulBonusAtOT : rules.teamFoulBonusAt;
        const lateBonus =
          rules.lateWindowSec > 0 && e.clock <= rules.lateWindowSec &&
          lateCounts[e.team] >= rules.lateWindowFoulBonusAt;
        if (e.inBonus !== (e.teamCountInPeriod >= threshold || lateBonus)) bad++;
        if (e.kind === 'technical') {
          if (e.fouledOut !== false) bad++;
        } else if (e.fouledOut !== (e.personalCount >= rules.foulOutAt)) bad++;
      }
    }
    expect(bad).toBe(0);
    expect(fouls).toBeGreaterThan(30);
  });

  // events.ts:76-78 — an offensive foul "counts against the fouler's
  // personal total but, per NBA rule, is NOT a team foul"; and a technical
  // stamps teamCountInPeriod "unchanged" too (events.ts:87-90). Either
  // kind's event repeats the team-period count of the last COUNTING foul.
  it('offensive and technical fouls never bump the team-period foul count', () => {
    let offensives = 0;
    let techs = 0;
    let bad = 0;
    for (const g of pool) {
      const teamCounts = new Map<string, number>();
      for (const e of g.events) {
        if (e.type !== 'foul') continue;
        const key = `${e.team}:${e.period}`;
        if (e.kind === 'offensive' || e.kind === 'technical') {
          if (e.kind === 'offensive') offensives++; else techs++;
          if (e.teamCountInPeriod !== (teamCounts.get(key) ?? 0)) bad++;
        } else {
          teamCounts.set(key, e.teamCountInPeriod);
        }
      }
    }
    expect(bad).toBe(0);
    expect(offensives).toBeGreaterThanOrEqual(2); // re-scouted 13 at the rules landing
    expect(techs).toBeGreaterThanOrEqual(1); // re-scouted 2 at the rules landing
  });

  // events.ts:293-296 — oneAndOne "is stamped on every attempt of such a
  // trip and ABSENT everywhere else, so leagues without the rule emit
  // byte-identical events". NBA has no one-and-one: the KEY itself must
  // never appear (ncaa-rules.test.ts covers bonus trips; this is the
  // stream-wide byte-shape claim, and-ones and shooting trips included).
  it('NBA streams never carry the oneAndOne key on any free throw', () => {
    let fts = 0;
    let stamped = 0;
    for (const g of pool) {
      for (const e of g.events) {
        if (e.type !== 'free_throw') continue;
        fts++;
        if ('oneAndOne' in e) stamped++;
      }
    }
    expect(stamped).toBe(0);
    expect(fts).toBeGreaterThan(30); // re-scouted 130 across the pool
  });
});
