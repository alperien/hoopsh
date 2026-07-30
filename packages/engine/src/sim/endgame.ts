/**
 * The endgame layer's game-flow half: intentional-foul targeting and the
 * timeout brain. (The ball-handler half — continuation reshaping — is
 * CONCEPT 6 in ai/concepts.ts; the two share the chase arithmetic here.)
 *
 * Everything is gated on `GameState.endgame` (from `GameConfig.endgame`,
 * default ON since the n=1260/arm flag-on survey): with the flag explicitly
 * off, no function in this file changes behavior or consumes rng — the
 * byte-identical pre-layer engine.
 *
 * DESIGN DOCTRINE (same as ai/concepts.ts): these are not scripted plays.
 * Intentional fouling is a RATE/INTENT modulation of the existing reach-in
 * machinery (passing.ts attemptReachIn rolls the same dice, just loaded);
 * timeouts are a decision at the existing dead-ball choke point
 * (possession.ts deadBall); the frontcourt inbound is a positioning change
 * the normal possession machinery then plays out. The foul parade, the
 * FT-heavy clutch texture, and the stop-and-regroup rhythm all EMERGE from
 * the ordinary resolution paths running under endgame intent.
 */

import type { TeamSide } from '../core/events.js';
import { clamp } from '../core/rng.js';
import { emit, other, type GameState, type Phase } from './state.js';

/**
 * Score-change bookkeeping: unanswered-run tracking for the stop-the-run
 * timeout. Called from the two places score changes (shooting.ts
 * resolveShotOutcome, fouls.ts tickFreeThrows) — always, flag on or off
 * (pure counter upkeep, no rng, read only when the flag is on). Same
 * definition as narration's ContextTracker: your own score accrues, being
 * scored ON zeroes you.
 */
export function noteScore(s: GameState, side: TeamSide, pts: number): void {
  s.runPts[side] += pts;
  s.runPts[other(side)] = 0;
}

/** remaining chase possessions for the trailing side, counting the one it is
 *  about to get — the shared "how many chances are left" arithmetic. */
function chancesLeft(s: GameState): number {
  return s.clock / s.params.endgame.chasePossSec + 1;
}

/**
 * Is a deficit still alive? 1 = fully chaseable, 0 = walk-off territory,
 * soft-faded across chaseFadePts. Shared by the hurry urgency (concepts.ts)
 * and the foul/timeout gates below so "when do we stop trying" is ONE
 * definition, not three.
 */
export function chaseAliveness(s: GameState, deficit: number): number {
  const E = s.params.endgame;
  const reachable = chancesLeft(s) * E.chaseMaxPtsPerPoss;
  return clamp((reachable + E.chaseFadePts - deficit) / E.chaseFadePts, 0, 1);
}

/**
 * How hurried side's offense is, 0..1 — the chase urgency. 0 unless the
 * flag is on, it's the final period (or OT), the side trails inside the
 * hurry window, and the game is still alive. Ramps with the clock (a
 * down-6 team at 2:50 is nudging; at 0:50 it is sprinting), deepens with
 * the deficit, and dies with the chase (garbage time is not urgency).
 *
 * Consumed by concepts.ts (concept 6's continuation cut — this number IS
 * the fraction of hurryMaxCut applied) and game.ts (the ball-handler
 * sprints the advance once it crosses params.endgame.hurrySprintMin).
 */
export function hurriedness(s: GameState, side: TeamSide): number {
  if (!s.endgame || s.period < s.rules.periods) return 0;
  const E = s.params.endgame;
  const margin = s.score[side] - s.score[other(side)];
  if (margin >= 0 || s.clock > E.hurryClockSec) return 0;
  const deficit = -margin;
  // one possession left, down a single score: last-shot patience beats the
  // hurry (concept 6 applies the hold-for-one boost there instead)
  if (s.clock <= E.holdForOneClockSec && deficit <= E.lastShotDeficitMax) return 0;
  const ramp = 1 - s.clock / E.hurryClockSec;
  const depth = clamp(deficit / E.hurryDeficitRef, 0, 1);
  // floored depth: even down one score the late clock pushes tempo — the
  // ramp, not the deficit, carries most of the urgency
  return ramp * (E.hurryDepthFloor + (1 - E.hurryDepthFloor) * depth) * chaseAliveness(s, deficit);
}

/**
 * Which defense wants to intentionally foul RIGHT NOW, or null. Read every
 * live tick by passing.ts attemptReachIn (rate/strip-share loading) and
 * defense.ts containOnBall (press the holder into grab range).
 *
 * The activation is the real coaching calculus, not a script:
 *  - final period or OT only, and only while the LEADING team has the ball;
 *  - deficit within [foulMinDeficit, foulMaxDeficit]: down 1-2 a stop wins
 *    (never foul), down 13+ it's over — and the deficit must still be ALIVE
 *    per chaseAliveness (the shared definition above): a paper-recoverable
 *    deficit with no clock left is over too, and nobody parades a dead game;
 *  - clock inside min(foulTrailMaxClockSec, one full shot clock per
 *    possession still needed): a team down two scores must foul earlier
 *    than a team down one, because the opponent can otherwise milk a full
 *    24 per possession — this is the "scaled by deficit and remaining
 *    possessions" window;
 *  - skip when the opponent's shot clock is nearly dead (foulMinShotClock):
 *    the forced shot/violation is coming anyway, fouling only donates FTs.
 */
export function foulHuntSide(s: GameState): TeamSide | null {
  if (!s.endgame) return null;
  if (s.period < s.rules.periods) return null;
  const off = s.poss.team;
  const def = other(off);
  const deficit = s.score[off] - s.score[def]; // defense trails by this
  const E = s.params.endgame;
  if (deficit < E.foulMinDeficit || deficit > E.foulMaxDeficit) return null;
  // the shared aliveness read (chaseAliveness above): a deficit the
  // remaining clock can no longer recover is walk-off territory, and fouling
  // there is a parade in a decided game — trading FTs for possessions only
  // makes sense while the possessions can still add up. The flat deficit
  // ceiling alone missed this (down 12 with 0:20 left sits inside
  // foulMaxDeficit but is dead: 87 hunted fouls in dead games, audit M-09);
  // the header's one-definition doctrine says the foul gate reads the SAME
  // "when do we stop trying" the hurry and the advance timeout read.
  if (chaseAliveness(s, deficit) <= 0) return null;
  // one full shot clock of defense per possession the chase still needs —
  // the 3 is a rules fact (a possession scores at most one three-pointer's
  // 3 points), the same inline shot-value arithmetic shooting.ts uses
  const possNeeded = Math.ceil(deficit / 3);
  const window = Math.min(E.foulTrailMaxClockSec, possNeeded * s.rules.shotClockSec);
  if (s.clock > window) return null;
  if (s.poss.shotClock <= E.foulMinShotClock) return null;
  return def;
}

/**
 * The timeout brain — called from possession.ts deadBall AFTER the dead
 * phase is set (this is the one choke point every stoppage routes through,
 * so a timeout can only ever happen where real ones do). Only the team
 * about to inbound may call one (the possession requirement). Two real
 * triggers, in priority order:
 *
 *  1. ADVANCE — trailing OR TIED, final period, inside
 *     timeoutAdvanceClockSec, game still alive: burn a timeout so the
 *     inbound sets up in the FRONTcourt (the real advance-the-ball rule).
 *     The rule itself is league data — rules.advanceAfterTimeout: the NBA
 *     and FIBA/EuroLeague have it, NCAA men do not (rules/rulepack.ts) —
 *     and it is score-independent; what this trigger models is the coach's
 *     USE of it (the side that needs the last shot sets up frontcourt; a
 *     leader lets the clock run instead, so margin > 0 never calls it).
 *     Tied qualifies: the tied-at-0:30 advance for the win is the classic
 *     use (the old strictly-trailing gate combined with the stop-run
 *     suppression below locked a tied team out of EVERY timeout inside the
 *     window — audit M-10). The payoff is mechanical, not scripted:
 *     setupDeadTargets reads phase.advanceInbound and stages the offense
 *     up-court, so the possession simply starts ~20 ft closer with the
 *     backcourt walk-up cost deleted. Never spent on a continuation dead
 *     ball (play resumes in place — nothing to advance).
 *
 *  2. STOP THE RUN — the opponent has timeoutRunPts unanswered: call time,
 *     regroup. Resets the run counter (that's the model of "regroup"; it
 *     also prevents re-burning a timeout every dead ball of the same run).
 *     Inside the final-period advance window, only a side that might still
 *     NEED the advance (trailing or tied) saves its timeouts for it; a
 *     LEADING team has no advance to save for, so being run on late it may
 *     always call time (red-team MINOR-2: the old blanket !advanceWindow
 *     suppression made stop_run unreachable for the leader in the final
 *     ~45 s — exactly when a collapsing lead most wants the whistle).
 *
 * Effects on the already-set dead phase: the clock freezes for the rest of
 * the stoppage (a timeout is a whistle) and the resume delay stretches to
 * timeoutResumeSec of WALL time — the replay shows a real huddle, the game
 * clock shows none (two-axes discipline).
 */
export function maybeTimeout(s: GameState): void {
  if (!s.endgame) return;
  const ph = s.phase;
  if (ph.kind !== 'dead' || ph.possKind === 'tip') return;
  const team = ph.nextTeam;
  if (s.timeoutsLeft[team] <= 0) return;
  const E = s.params.endgame;
  const margin = s.score[team] - s.score[other(team)];
  const finalPeriod = s.period >= s.rules.periods;

  let reason: 'stop_run' | 'advance' | null = null;
  // no advance rule in this league (rules.advanceAfterTimeout false — NCAA
  // men) ⇒ no advance window at all: the advance arm never fires AND the
  // save-for-the-advance suppression below never bites, so stop_run stays
  // available to everyone all the way in (audit M-11: NCAA was getting the
  // NBA's advance-the-ball timeout)
  const advanceWindow = finalPeriod && s.rules.advanceAfterTimeout &&
    s.clock <= E.timeoutAdvanceClockSec && s.clock > 0;
  if (
    advanceWindow && margin <= 0 && -margin <= E.timeoutAdvanceDeficitMax &&
    chaseAliveness(s, -margin) > 0 && !ph.continuation
  ) {
    // margin <= 0: trailing or TIED — the tied team wants the last shot in
    // the frontcourt just as much (audit M-10; a tied deficit of 0 passes
    // the deficit/aliveness gates trivially)
    reason = 'advance';
  } else if (
    // save-for-the-advance suppression applies only while this side might
    // still need an advance (trailing/tied) — a leader always may regroup
    s.runPts[other(team)] >= E.timeoutRunPts && (!advanceWindow || margin > 0)
  ) {
    reason = 'stop_run';
  }
  if (!reason) return;

  s.timeoutsLeft[team] -= 1;
  emit(s, { type: 'timeout', team, reason, remaining: s.timeoutsLeft[team] });
  ph.clockRuns = false;
  ph.resumeIn = Math.max(ph.resumeIn, E.timeoutResumeSec);
  if (reason === 'advance') {
    (ph as Extract<Phase, { kind: 'dead' }>).advanceInbound = true;
  } else {
    s.runPts[other(team)] = 0; // the regroup: the run is answered by the whistle
  }
}
