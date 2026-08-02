/**
 * Substitution legal-window invariant — full-game scan (issue #179).
 *
 * Provenance: Red Team finding F6 on PR #174 (advisory record: PR comment
 * 5157655537). The #174 concede-device correction narrowed WHERE
 * substitutions may happen — sub.postMakeSubWindow 0 closed the
 * running-clock make-inbound rotation pass (sim/possession.ts deadBall,
 * the liveInbound guard) and sub.ftGapSubMode 3 moved the routine rotation
 * into the between-attempts slot (sim/fouls.ts tickFreeThrows) — but no
 * test asserted the window set itself. A regression reopening the
 * make-inbound window (the legacy G8c tell: ~30 live-ball subs/g vs corpus
 * 1.16) would land silently: every existing suite stays green while the
 * rotation grammar goes wrong. This suite scans every substitution event
 * in full games and asserts it lands inside the engine's own legal-window
 * set. Mutant-verified RED: forcing possession.ts's liveInbound to false
 * (reopening the make-inbound pass) trips the scan on the very first pool
 * game.
 *
 * THE LEGAL-WINDOW SET, derived from the engine's substitution emitters.
 * sim/subs.ts swapPlayers is the only code that emits `substitution`; its
 * callers are checkSubs (+ quarterWave inside it) and replaceFouledOut.
 * Their call sites, and therefore the only stream contexts in which a
 * substitution may appear:
 *
 *  1. Stopped-clock dead balls — sim/possession.ts deadBall runs checkSubs
 *     unless the dead ball is a running-clock make-inbound (liveInbound).
 *     Every deadBall caller except the made-basket path passes
 *     clockRuns:false: non-shooting-foul side-outs (possession.ts,
 *     passing.ts), dead-ball turnovers (out_of_bounds passing.ts, travel +
 *     shot_clock sim/game.ts, off_goaltend + off_foul possession.ts/
 *     game.ts), kicked-ball violations (passing.ts), dead-carom team-
 *     rebound awards (possession.ts tickScramble), held-ball jump balls
 *     (passing.ts attemptReachIn, possession.ts tickScramble), and the
 *     technical-trip resume (fouls.ts tickFreeThrows).
 *  2. The made-basket dead ball ONLY when the clock actually stopped —
 *     sim/shooting.ts resolveShotOutcome: clock <= rules.
 *     makeStopClockFinalSec in the final period/OT, <= rules.
 *     makeStopClockEarlySec earlier (NBA 120/60). A timeout (endgame
 *     maybeTimeout, run inside deadBall BEFORE checkSubs) or a replay
 *     review (deadBall sets clockRuns=false before the liveInbound guard)
 *     also freezes the clock and reopens the pass; both emit their own
 *     anchor event first.
 *  3. Free-throw windows — sim/fouls.ts: the trip-entry pass in
 *     enterFreeThrows (after the foul event, after maybeFtTimeout), the
 *     between-attempts slot in tickFreeThrows (ftGapSubMode > 0; after the
 *     attempt's free_throw event and, on a miss, the deadBall-formality
 *     rebound), and the made-final-attempt dead ball. A missed FINAL
 *     attempt (or a missed one-and-one front end, fouls.ts frontEndMiss)
 *     leaves the ball live off the rim and hosts nothing. Technical
 *     attempts are dead by rule regardless of make/miss (fouls.ts: no
 *     rebound of any kind; the resume path re-enters deadBall).
 *  4. Period boundaries — sim/possession.ts endPeriod emits period_start
 *     (and tip_off for an OT period) and THEN runs checkSubs with the
 *     quarter-break wave.
 *  5. Fouled-out replacement — sim/fouls.ts recordFoul calls
 *     replaceFouledOut synchronously, immediately after emitting the foul
 *     event with fouledOut:true. This is the one mid-live-play exception,
 *     and the foul whistle itself is the anchor.
 *
 * Scan mechanics: events emitted during one stoppage share one game-clock
 * stamp — t freezes at the whistle and state.ts emit stamps round2(s.t) —
 * and the running-clock make-inbound resolves its deadBall (and any mutant
 * sub pass) synchronously in the tick that resolved the shot, so an
 * illegal sub still shares its t with the made shot. Walking backward from
 * a substitution over same-t events therefore reaches the stoppage cause
 * before leaving the cluster. Bookkeeping events that legitimately sit
 * between the cause and the sub pass are skipped: other substitutions
 * (multi-swap windows), possession_end (endPossession runs before deadBall
 * at every site), and def_goaltend violations (emitted between a made shot
 * and its dead ball, sim/shooting.ts — the shot itself decides legality).
 * Everything else is a verdict: an anchor from the set above is legal; a
 * live-ball event (pass, missed shot, live player rebound, steal
 * turnover), a possession_start (play resumed), or running out of same-t
 * events (no stoppage at all at this clock reading) is a violation.
 */

import { describe, expect, it } from 'vitest';
import {
  NCAA, simulateGame, type GameEvent, type GameResult, type RulePack
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

/** turnover kinds that come with a whistle/dead ball (see set 1 above);
 *  bad_pass and lost_ball are live steals — play continues, no window */
const DEAD_BALL_TURNOVERS = new Set(['out_of_bounds', 'travel', 'shot_clock', 'off_goaltend', 'off_foul']);

/**
 * Judge one substitution event against the legal-window set. Returns null
 * when the substitution sits in a legal window, else a compact reason
 * string (kept short: the vitest-shim failure message truncates at 200
 * chars, and the first violation must survive it).
 */
function illegalReason(events: GameEvent[], i: number, rules: RulePack): string | null {
  const sub = events[i]!;
  for (let j = i - 1; j >= 0; j--) {
    const ev = events[j]!;
    if (ev.t !== sub.t) break; // left the stoppage cluster with no anchor
    // transparent bookkeeping between a stoppage cause and its sub pass
    if (ev.type === 'substitution' || ev.type === 'possession_end') continue;
    if (ev.type === 'violation' && ev.kind === 'def_goaltend') continue;
    // whistles and administrative stoppages — always a legal window
    if (ev.type === 'foul') return null;          // incl. the fouled-out replacement (set 5)
    if (ev.type === 'timeout') return null;       // huddle window (set 2)
    if (ev.type === 'replay_review') return null; // monitor stoppage (set 2)
    if (ev.type === 'jump_ball') return null;     // held-ball administration (set 1)
    if (ev.type === 'violation') return null;     // kicked_ball (def_goaltend skipped above)
    if (ev.type === 'turnover') {
      return DEAD_BALL_TURNOVERS.has(ev.kind) ? null : `sub after live turnover (${ev.kind})`;
    }
    if (ev.type === 'rebound') {
      // deadBall: the missed-non-final-FT formality; playerless: a team
      // rebound awarded at a dead-ball inbound. A player rebound is live.
      return ev.deadBall === true || ev.player === undefined
        ? null
        : 'sub after live player rebound';
    }
    if (ev.type === 'free_throw') {
      if (ev.technical === true) return null;                    // dead by rule (set 3)
      if (ev.n < ev.of && !(ev.oneAndOne === true && !ev.made)) return null; // between attempts
      if (ev.n === ev.of && ev.made) return null;                // made final: dead-ball inbound
      return `sub after live-ball FT (n=${ev.n} of=${ev.of} made=${ev.made})`;
    }
    if (ev.type === 'period_start') return null; // boundary wave (set 4)
    if (ev.type === 'tip_off') {
      // only OT boundaries host the endPeriod pass; the game-opening tip
      // never does (checkSubs has no game-start call site)
      return ev.period > rules.periods ? null : 'sub at the game-opening tip';
    }
    if (ev.type === 'shot') {
      if (!ev.made) return 'sub after live missed shot';
      // THE GUARDED CLASS (set 2): a made basket hosts the pass only
      // inside the pack's stop-clock windows. Outside them the inbound is
      // live and possession.ts's liveInbound guard must have skipped
      // checkSubs — a sub here is the reopened make-inbound window.
      const stopSec = ev.period >= rules.periods
        ? rules.makeStopClockFinalSec
        : rules.makeStopClockEarlySec;
      return ev.clock <= stopSec
        ? null
        : `sub on running-clock make-inbound (clock=${ev.clock} window=${stopSec})`;
    }
    // possession_start (play resumed), pass, game_start, period_end,
    // game_end: none may precede a substitution inside one stoppage
    return `sub anchored at ${ev.type}`;
  }
  return 'sub with no same-t stoppage anchor (mid-live-play)';
}

/**
 * The anchor event a legal substitution hangs off (first non-transparent
 * same-t predecessor) — used only by the pool-coverage assertions below.
 */
function anchorOf(events: GameEvent[], i: number): GameEvent | null {
  const sub = events[i]!;
  for (let j = i - 1; j >= 0; j--) {
    const ev = events[j]!;
    if (ev.t !== sub.t) return null;
    if (ev.type === 'substitution' || ev.type === 'possession_end') continue;
    if (ev.type === 'violation' && ev.kind === 'def_goaltend') continue;
    return ev;
  }
  return null;
}

/**
 * The pool. sim once, assert many (the invariants.test.ts shared-games
 * pattern). Two parts:
 *  - sublegal-0..19, home/away mirrored — the broad base. Within it,
 *    sublegal-5 reaches OT and sublegal-3/7/17/19 finish at margins
 *    22-29, so crunch, concede entry/exit, and garbage-time closing
 *    lineups are all exercised.
 *  - pinned extras: sublegal-x-84 (a second OT game); subncaa-3, an NCAA
 *    OT game (halves pack, one-and-one bonus, makeStopClockEarlySec 0);
 *    and sublegacy-0, an `endgame: false` legacy-path blowout (margin 31,
 *    no timeout economy). The non-default pins follow the fingerprint
 *    corpus's audit-H-04 lesson: default-config-only coverage is blind to
 *    a window regression that leaks into the legacy or non-NBA paths.
 *    All pins chosen so the issue-#179 requirement — a pool wide enough
 *    to exercise OT and endgame concede states — is guaranteed by
 *    construction, and the coverage test below fails loudly if an
 *    rng-order change ever drifts these seeds away from the states they
 *    were picked for (re-pick from a fresh seed sweep in that case; 166
 *    games were swept for these).
 */
const BASE_GAMES = 20;
const results: GameResult[] = [];
for (let i = 0; i < BASE_GAMES; i++) {
  const { home, away } = sampleMatchup();
  const flip = i % 2 === 1;
  results.push(simulateGame({
    seed: `sublegal-${i}`,
    home: flip ? away : home,
    away: flip ? home : away,
    collectFrames: false
  }));
}
{
  const { home, away } = sampleMatchup();
  results.push(simulateGame({
    seed: 'sublegal-x-84', home, away, collectFrames: false
  }));
  // mirrored orientation, matching the seed sweep that picked it
  results.push(simulateGame({
    seed: 'subncaa-3', home: away, away: home, rules: NCAA, collectFrames: false
  }));
  results.push(simulateGame({
    seed: 'sublegacy-0', home, away, endgame: false, collectFrames: false
  }));
}

describe(`substitution legal windows over ${results.length} games (issue #179)`, () => {
  it('every substitution lands in a legal window (full-game scan)', () => {
    const violations: string[] = [];
    for (const r of results) {
      r.events.forEach((e, idx) => {
        if (e.type !== 'substitution') return;
        const reason = illegalReason(r.events, idx, r.rules);
        if (reason !== null) {
          violations.push(`${r.seed} ev${idx} p${e.period} clk${e.clock}: ${reason}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('the pool exercises OT and endgame concede states', () => {
    // OT stoppages run the crunch arm (subs.ts checkSubs, audit H-02) and
    // 20+ margins cross the concede line (params.sub concedeMarginBase 15
    // + 1.0/min) — the states the #174 concede-device class lives in. If
    // this fails after an rng-order change, the seeds drifted: re-pick per
    // the pool comment, do not weaken the counts.
    const ot = results.filter((r) => r.events.some((e) => e.period > r.rules.periods)).length;
    const blowouts = results.filter((r) => Math.abs(r.finalScore[0] - r.finalScore[1]) >= 20).length;
    expect(ot).toBeGreaterThanOrEqual(2);
    expect(blowouts).toBeGreaterThanOrEqual(3);
  });

  it('the pool exercises the conditional hosts: make stop-window and FT-gap subs', () => {
    // The two windows whose legality is conditional (not a plain whistle):
    // subs on a made basket inside the stop-clock window, and subs in the
    // between-FT-attempts gap (the ftGapSubMode 3 routine host). If neither
    // occurred, the scan above would be passing vacuously on its two
    // subtlest branches.
    let makeWindow = 0;
    let ftGap = 0;
    for (const r of results) {
      r.events.forEach((e, idx) => {
        if (e.type !== 'substitution') return;
        const a = anchorOf(r.events, idx);
        if (a === null) return;
        if (a.type === 'shot') makeWindow++;
        if (a.type === 'free_throw' && a.n < a.of) ftGap++;
        if (a.type === 'rebound' && a.deadBall === true) ftGap++;
      });
    }
    expect(makeWindow).toBeGreaterThanOrEqual(1);
    expect(ftGap).toBeGreaterThanOrEqual(1);
  });
});
