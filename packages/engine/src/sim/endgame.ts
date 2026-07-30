/**
 * The endgame layer's game-flow half: intentional-foul targeting and the
 * timeout brain. (The ball-handler half — continuation reshaping — is
 * CONCEPT 6 in ai/concepts.ts; the two share the chase arithmetic here.)
 *
 * Name caveat: with the timeout economy wired game-wide (mandatory TV
 * stoppages, the coach hazard; fdesign-timeouts, currently STAGED inert),
 * "endgame" is a misnomer: this file covers game-wide game management. The
 * file is deliberately not renamed (ownership map row "late-game
 * management"); the flag stays `GameState.endgame`.
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
import { emit, other, type GameState, type Phase, type TimeoutReason } from './state.js';

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
export function maybeTimeout(s: GameState, pre?: TimeoutCall): void {
  if (!s.endgame) return;
  const ph = s.phase;
  if (ph.kind !== 'dead' || ph.possKind === 'tip') return;
  // a pre-stamped decision (the live-ball site, possession.ts) skips the
  // evaluation entirely: one timeout per stoppage, hard
  const call = pre ?? decideTimeout(s, ph);
  if (!call) return;
  callTimeout(s, call.team, call.reason);
}

/** a timeout decision: who calls it and why (sim-internal; see TimeoutReason) */
export interface TimeoutCall {
  team: TeamSide;
  reason: TimeoutReason;
}

/**
 * The FT-whistle timeout site (fdesign-timeouts §1.2.2), called from
 * fouls.ts enterFreeThrows after the freethrows phase is set and before
 * the sub pass (ordering is the §4 handshake: checkSubs reads
 * phase.timeout). Real grammar needs the site: 17.5% of all corpus
 * timeouts and 44.8% of anchor timeouts sit on foul whistles, logged
 * before the FTs; without it, anchors over-land on made baskets
 * (ffit-timeouts §5.1). Decision order matches deadBall's brain minus the
 * advance (a whistle is not an inbound, there is nothing to advance):
 * mandatory first (a rule), then the coach hazard for the shooting team
 * (the possession holder at the line). The legacy deterministic stop_run
 * trigger deliberately does not evaluate here: it is live at shipped
 * params and this site must stay dark until the fit-wave flip. STAGED:
 * mandatory ships −1 and the hazard magnitudes 0, so the site decides
 * null, draws nothing, and the shipped stream is byte-identical.
 * Effects on a call are callTimeout's freethrows branch (wall-time huddle
 * stretch on nextIn; the whistle already stopped the game clock).
 */
export function maybeFtTimeout(s: GameState): void {
  if (!s.endgame) return;
  const ph = s.phase;
  if (ph.kind !== 'freethrows') return;
  const team = ph.side;
  const E = s.params.endgame;
  const margin = s.score[team] - s.score[other(team)];
  const finalPeriod = s.period >= s.rules.periods;
  const advanceWindow = finalPeriod && s.clock <= E.timeoutAdvanceClockSec && s.clock > 0;
  const call = decideMandatory(s) ?? decideCoachHazard(s, team, margin, advanceWindow);
  if (!call) return;
  callTimeout(s, call.team, call.reason);
}

/**
 * The pure decision at a dead-ball stoppage, in priority order: advance
 * (deterministic; near-universal correct coaching, unchanged), mandatory
 * (deterministic; it's a rule, STAGED off), the deterministic legacy
 * stop-the-run (live; the fit wave retires it, see the params doc), then
 * the coach voluntary hazard (probabilistic; STAGED at zero magnitudes,
 * which consumes no rng: the fingerprint-critical stage switch).
 */
function decideTimeout(s: GameState, ph: Extract<Phase, { kind: 'dead' }>): TimeoutCall | null {
  const team = ph.nextTeam; // the possession requirement: only the inbounder calls
  const E = s.params.endgame;
  const margin = s.score[team] - s.score[other(team)];
  const finalPeriod = s.period >= s.rules.periods;
  // no advance rule in this league (rules.advanceAfterTimeout false — NCAA
  // men) ⇒ no advance window at all: the advance arm never fires AND the
  // save-for-the-advance suppression below never bites, so stop_run stays
  // available to everyone all the way in (audit M-11: NCAA was getting the
  // NBA's advance-the-ball timeout)
  const advanceWindow = finalPeriod && s.rules.advanceAfterTimeout &&
    s.clock <= E.timeoutAdvanceClockSec && s.clock > 0;
  if (
    // margin <= 0: trailing or TIED — the tied team wants the last shot in
    // the frontcourt just as much (audit M-10; a tied deficit of 0 passes
    // the deficit/aliveness gates trivially)
    canSpend(s, team) &&
    advanceWindow && margin <= 0 && -margin <= E.timeoutAdvanceDeficitMax &&
    chaseAliveness(s, -margin) > 0 && !ph.continuation
  ) {
    return { team, reason: 'advance' };
  }
  const mandatory = decideMandatory(s);
  if (mandatory) return mandatory;
  if (
    // save-for-the-advance suppression applies only while this side might
    // still need an advance (trailing/tied); a leader always may regroup
    canSpend(s, team) &&
    s.runPts[other(team)] >= E.timeoutRunPts && (!advanceWindow || margin > 0)
  ) {
    return { team, reason: 'stop_run' };
  }
  return decideCoachHazard(s, team, margin, advanceWindow);
}

/**
 * Budget + Q4-cap gate (fdesign-timeouts §3.3): a team may spend iff it has
 * budget and, in the final scheduled period only, is under the ≤4 period cap
 * and (inside the last toFinalPeriodLateSec) the ≤2 late cap. OT periods are
 * exempt from the caps; the per-OT budget binds there instead. Applies to
 * coach and advance calls; the mandatory rule uses it only to pick which
 * side the scorer charges. STAGED: at the shipped 99-caps this reduces to
 * the legacy `timeoutsLeft > 0` check exactly.
 */
function canSpend(s: GameState, team: TeamSide): boolean {
  if (s.timeoutsLeft[team] <= 0) return false;
  const E = s.params.endgame;
  if (s.period === s.rules.periods) {
    if (s.timeoutsUsedFinalPeriod[team] >= E.toFinalPeriodMaxTimeouts) return false;
    if (
      s.clock <= E.toFinalPeriodLateSec &&
      s.timeoutsUsedFinalLate[team] >= E.toFinalPeriodLateMaxTimeouts
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The mandatory (TV) stoppage: NBA Rule 5 VI(b), STAGED off at the shipped
 * −1 thresholds. Regulation periods only (the corpus shows no OT anchor):
 * if the period has no timeout yet at a qualifying stoppage under
 * toMandatoryFirstBelowSec, the scorer takes one charged to the home side;
 * if it has ≤ 1 under toMandatorySecondBelowSec, charged to the side not
 * yet charged this period (tie → away, home took the first by convention).
 * Charged from the team's normal budget (real rule); if the convention
 * target can't pay (budget/caps), the other side is charged; if neither
 * can, the stoppage is skipped. Deterministic, no rng: it's a rule.
 */
function decideMandatory(s: GameState): TimeoutCall | null {
  const E = s.params.endgame;
  if (s.period > s.rules.periods) return null; // no mandatory in OT
  const charged = s.timeoutsThisPeriod;
  const total = charged[0] + charged[1];
  let target: TeamSide | null = null;
  if (E.toMandatoryFirstBelowSec >= 0 && total === 0 && s.clock <= E.toMandatoryFirstBelowSec) {
    target = 0; // first anchor: charged to the home side by convention
  } else if (
    E.toMandatorySecondBelowSec >= 0 && total <= 1 && s.clock <= E.toMandatorySecondBelowSec
  ) {
    // the side not yet charged this period; fewer-charged generalizes it,
    // and a 0-0 tie goes to the away side (home owes the first anchor)
    target = charged[0] < charged[1] ? 0 : 1;
  }
  if (target === null) return null;
  const payer = canSpend(s, target) ? target : canSpend(s, other(target)) ? other(target) : null;
  return payer === null ? null : { team: payer, reason: 'mandatory' };
}

/**
 * The game-wide coach voluntary-timeout hazard (fdesign-timeouts §2), the
 * probabilistic replacement for the deterministic run trigger: real coaches
 * stop ~3 in 10 runs at any size, so a threshold is a metronome tell.
 * Deterministic gates run first; rng is consumed only after every gate
 * passes and p > 0. At the STAGED zero magnitudes p is exactly 0, so the
 * shipped engine draws nothing and stays byte-identical. `team` is the team
 * with the ball at the stoppage being evaluated.
 */
function decideCoachHazard(
  s: GameState,
  team: TeamSide,
  margin: number,
  advanceWindow: boolean
): TimeoutCall | null {
  const E = s.params.endgame;
  if (!canSpend(s, team)) return null;
  // cooldown: prevents machine-gunning without touching mandatory/advance
  if (s.t - s.lastTimeoutT[team] < E.toCoachCooldownSec) return null;
  // quarter-open quiet window (real first-60s share: 1.0%)
  const periodLen = (s.period > s.rules.periods ? s.rules.otMinutes : s.rules.periodMinutes) * 60;
  if (periodLen - s.clock < E.toQuarterOpenQuietSec) return null;
  // a non-final period's last possession is sacred (one definition of
  // "hold for one", shared param), so no huddle interrupts it
  if (s.period < s.rules.periods && s.clock <= E.holdForOneClockSec) return null;
  // advance-reserve: trailing/tied inside the advance window, the timeout
  // is saved for the advance decision (which owns that window)
  if (advanceWindow && margin <= 0) return null;
  const oppRun = s.runPts[other(team)];
  const run = clamp((oppRun - E.toRunMinPts) / (E.toRunFullPts - E.toRunMinPts), 0, 1);
  const trail = clamp(-margin / E.toTrailRefPts, 0, 1);
  // spend-it-or-lose-it: inside the 5:00→3:00 window of the final scheduled
  // period, a team still holding more than the late cap burns the excess
  const burn =
    s.period === s.rules.periods &&
    s.clock > E.toFinalPeriodLateSec && s.clock <= E.toBurnWindowSec &&
    s.timeoutsLeft[team] > E.toFinalPeriodLateMaxTimeouts
      ? E.toBurnBoost
      : 0;
  const p = Math.min(E.toCoachMaxP, E.toCoachBasePerDead + E.toCoachRunW * run + E.toCoachTrailW * trail + burn);
  // the stage switch: p === 0 at the shipped zero magnitudes; return before
  // the draw so the rng stream is untouched (fingerprint-critical)
  if (p <= 0) return null;
  if (!s.rng.chance(p)) return null;
  return { team, reason: oppRun >= E.toStopRunLabelPts ? 'stop_run' : 'regroup' };
}

/**
 * The decision for the live-ball possession-timeout site (possession.ts
 * startPossession tail, kinds live_rebound/steal; STAGED off behind
 * params.endgame.toLiveSiteOn): grab the board / steal and call time. The
 * only path by which the endgame advance can fire off a defensive rebound
 * or a steal; the caller turns a non-null decision into a continuation dead
 * ball with the call pre-stamped (maybeTimeout's `pre`), so the stoppage's
 * own evaluation never runs twice. No continuation block on the advance
 * here: this site creates its stoppage, and advancing off a board is the
 * point. Pure decision: effects stay in callTimeout.
 */
export function decideLiveTimeout(s: GameState, team: TeamSide): TimeoutCall | null {
  const E = s.params.endgame;
  const margin = s.score[team] - s.score[other(team)];
  const finalPeriod = s.period >= s.rules.periods;
  // same advance semantics as decideTimeout: rule-pack gated (audit M-11)
  // and open to a tied team (audit M-10) — the live site replicates the
  // dead-ball advance rule, not a private variant of it
  const advanceWindow = finalPeriod && s.rules.advanceAfterTimeout &&
    s.clock <= E.timeoutAdvanceClockSec && s.clock > 0;
  if (
    canSpend(s, team) &&
    advanceWindow && margin <= 0 && -margin <= E.timeoutAdvanceDeficitMax &&
    chaseAliveness(s, -margin) > 0
  ) {
    return { team, reason: 'advance' };
  }
  return decideCoachHazard(s, team, margin, advanceWindow);
}

/**
 * The effects block, shared by every site: pay the budget, maintain the
 * period/cap/cooldown counters, emit, freeze the stoppage, and stamp the
 * phase's `timeout` field, the sub-window handshake (checkSubs runs after
 * this at every site, so the rotation layer can read it). Wall-time only:
 * the huddle stretches resumeIn/nextIn while the game clock stays frozen
 * (two-axes discipline). The freethrows branch is reached from the
 * FT-whistle site (maybeFtTimeout above, called by fouls.ts
 * enterFreeThrows), STAGED dark at the shipped to* values.
 */
function callTimeout(s: GameState, team: TeamSide, reason: TimeoutReason): void {
  const E = s.params.endgame;
  s.timeoutsLeft[team] -= 1;
  s.timeoutsThisPeriod[team] += 1;
  if (s.period === s.rules.periods) {
    s.timeoutsUsedFinalPeriod[team] += 1;
    if (s.clock <= E.toFinalPeriodLateSec) s.timeoutsUsedFinalLate[team] += 1;
  }
  s.lastTimeoutT[team] = s.t;
  // Contract converged (officiating wave, replay v3): TimeoutEvent.reason
  // now carries the full TimeoutReason set. 'mandatory'/'regroup' remain
  // unreachable at shipped params (STAGED to* values), but they emit
  // through the real union, no cast (fdesign-timeouts §5's value-only
  // widening, delivered with the rest of the event-contract chain).
  emit(s, {
    type: 'timeout', team, reason, remaining: s.timeoutsLeft[team]
  });
  const ph = s.phase;
  if (ph.kind === 'dead') {
    ph.clockRuns = false;
    ph.resumeIn = Math.max(ph.resumeIn, E.timeoutResumeSec);
    if (reason === 'advance') ph.advanceInbound = true;
    ph.timeout = { team, reason };
  } else if (ph.kind === 'freethrows') {
    // whistle already stopped the clock; the huddle is wall-time only
    ph.nextIn = Math.max(ph.nextIn, E.timeoutResumeSec);
    ph.timeout = { team, reason };
  }
  if (reason !== 'advance') {
    // the huddle answers the run for both benches (one rule for all non-
    // advance reasons; prevents hazard re-triggering without a second
    // mechanism). For the legacy stop_run this is provably the old
    // one-sided reset: noteScore keeps at most one side's run nonzero, so
    // the caller's own run is already 0 whenever the opponent's is alive.
    // 'advance' deliberately keeps the legacy no-reset (byte-identity with
    // the shipped path); fdesign-timeouts §1.2 would reset there too. The
    // fit wave may unify when the deterministic trigger retires.
    s.runPts[0] = 0;
    s.runPts[1] = 0;
  }
}
