/**
 * Possession lifecycle: starting/ending possessions, dead-ball setup,
 * live-rebound scrambles, period transitions, and the opening tip.
 *
 * This is the phase-transition hub of the tick pipeline (see docs/INTERNALS.md):
 * `tickDead` and `tickScramble` are dispatched directly from `game.ts`'s tick
 * switch, and `startPossession`/`endPossession`/`deadBall` are the choke points
 * every other module (fouls, passing, shooting) routes through to change what
 * phase the game is in. Possession-level bookkeeping (shot clock, pace, ORtg)
 * all keys off the invariants enforced here — read this file first when a
 * pace/possession-count stat looks wrong.
 */

import { dist, lerp, type V2 } from '../core/vec.js';
import type { TeamSide } from '../core/events.js';
import {
  attackedRim, emit, onCourt, other, round1,
  type Agent, type GameState, type Phase
} from './state.js';
import { assignMatchups, assignSpots } from './ai.js';
import { resolveRebound } from './resolve.js';
import { checkSubs } from './subs.js';
import { advanceClock, applyFatigue, integrateMovement } from './movement.js';
import { enterFreeThrows, recordFoul } from './fouls.js';
import { startShot } from './shooting.js';

/**
 * Decide who wins a jump ball (opening tip, each overtime period).
 * Called once per game at tip-off and once per OT period in `endPeriod`.
 * Purely a coin-flip weighted by height + hops — no possession/clock side
 * effects here, the caller (`endPeriod`) does the actual phase transition.
 */
export function tipWeightedWinner(s: GameState): TeamSide {
  // pick each side's best jumper first (a small proxy score: height dominates,
  // vertical breaks near-ties — 0.12 is just enough weight that an elite leaper
  // can edge out someone an inch taller, not enough to flip a real size gap),
  // then weight the two jumpers against each other for the actual coin flip.
  const jumper = (side: TeamSide): number => {
    const bigs = onCourt(s, side);
    const best = bigs.reduce((m, a) =>
      a.p.heightIn + a.p.attr.vertical * 0.12 > m.p.heightIn + m.p.attr.vertical * 0.12 ? a : m
    );
    // final tip-win weight: mostly standing reach (height), a real but smaller
    // share of leaping ability — a jump ball is won more by who's taller than
    // who jumps higher, but hops still matter (70/30 split)
    return best.p.heightIn * 0.7 + best.p.attr.vertical * 0.3;
  };
  const h = jumper(0);
  const a = jumper(1);
  return s.rng.weighted([h, a]) as TeamSide;
}

/** Ball-handler picked to bring the ball up / receive the inbound: highest ballHandle rating on the floor. */
export function bestHandler(s: GameState, side: TeamSide): Agent {
  const eligible = onCourt(s, side).filter((x) => !x.fouledOut);
  // bench exhausted (every replacement used): play on with whoever is out there
  // rather than crashing — custom short rosters are legal input
  const players = eligible.length > 0 ? eligible : onCourt(s, side);
  return players.reduce((m, x) => (x.p.attr.ballHandle > m.p.attr.ballHandle ? x : m));
}

// ------------------------------------------------------------- possessions

/**
 * Begin a new possession for `team`. Called from every place the ball changes
 * hands: after a dead-ball resume (inbound), a live rebound, a steal, and the
 * post-tip handoff. Resets the shot clock, tags the possession `kind` (used
 * downstream for transition-offense bonuses), assigns fresh spacing spots and
 * defensive matchups, and hands the ball to `holder` (or the team's best
 * ball-handler if none given).
 *
 * Side effect to be aware of: clears stale per-agent commitment timers
 * (`driveUntil`, `cutUntil`, `screenStunUntil`, `navUnderUntil`) on EVERY
 * agent in the game, not just the new possession's team — a defender still
 * "fighting through a screen" from three seconds ago must not carry that
 * state into a brand-new possession.
 */
export function startPossession(
  s: GameState,
  team: TeamSide,
  kind: 'inbound' | 'live_rebound' | 'steal' | 'tip',
  holder?: Agent
): void {
  s.poss = {
    team,
    shotClock: s.rules.shotClockSec,
    phase: kind === 'live_rebound' || kind === 'steal' ? 'transition' : 'advance',
    startT: s.t,
    kind,
    lastPass: null,
    spotMap: new Map(),
    action: null,
    ended: false
  };
  // stale-timer hygiene: commitments from the previous possession must not
  // leak into this one (a defender still "cutting", a stun crossing sides)
  for (const [, a] of s.agents) {
    a.driveUntil = -99;
    a.cutUntil = -99;
    a.screenStunUntil = -99;
    a.navUnderUntil = -99;
  }
  emit(s, { type: 'possession_start', team, kind });
  assignSpots(s, team);
  assignMatchups(s, other(team));
  const h = holder ?? bestHandler(s, team);
  giveBall(s, h);
  // 0.25s: the new holder needs at least one tick of "look around" before the
  // AI is allowed to shoot/pass/drive off the inbound — prevents an
  // instant no-look heave the moment the ball touches his hands
  s.decisionAt = s.t + 0.25;
}

/**
 * Transfer ball possession to `a` (a catch, not a shot going up). Resets the
 * dribble-count bookkeeping used for the "one-dribble-and-shoot" assist
 * window and hand-check/strip mechanics. Called on every inbound, rebound,
 * steal, and completed pass — NOT on a shot release (that clears the holder
 * without assigning a new one; see `startShot`/`resolvePassArrival`).
 */
export function giveBall(s: GameState, a: Agent): void {
  s.ball.holderId = a.p.id;
  s.ball.flight = null;
  a.catchT = s.t;
  a.dribblesSinceCatch = 0;
  a.dribbleAcc = 0;
}

/**
 * Close out the current possession's bookkeeping (emits `possession_end`).
 * Call this from wherever a possession's fate is decided — a make, a
 * defensive rebound, a turnover, or the period horn — right before handing
 * the ball to the other phase. Idempotent via `s.poss.ended`: and-one free
 * throws, buzzer-beater flows, and FT-miss scrambles can all legitimately
 * call this more than once for the same dead possession, and only the first
 * call may count — pace and offensive-rating stats depend on possessions
 * being counted exactly once.
 */
export function endPossession(
  s: GameState,
  outcome: 'made_fg' | 'made_ft' | 'def_rebound' | 'turnover' | 'period_end'
): void {
  // a possession ends exactly once — and-ones, buzzer flows, and FT-miss
  // scrambles all route here, so guard against double counting (pace/ORtg
  // depend on this invariant)
  if (s.poss.ended) return;
  s.poss.ended = true;
  emit(s, { type: 'possession_end', team: s.poss.team, outcome });
}

/**
 * Enter a dead-ball phase; possession (re)starts (or resumes, if
 * `continuation`) once `resumeIn` elapses. This is THE choke point for
 * out-of-bounds, non-shooting fouls, and made-basket dead time — callers
 * pick `nextTeam` (who gets the ball when play resumes) and whether the
 * game clock keeps running under the delay (`clockRuns`, e.g. a make with
 * the clock still live vs. a violation that stops it).
 * Abandons any shot windup in flight (`pendingRelease = null`) since a dead
 * ball means the prior play can no longer resolve.
 */
export function deadBall(
  s: GameState,
  nextTeam: TeamSide,
  opts: { clockRuns: boolean; resumeIn?: number; continuation?: boolean }
): void {
  s.ball.flight = null;
  s.ball.holderId = null;
  s.pendingRelease = null; // abandon any windup — the play is dead
  s.phase = {
    kind: 'dead',
    // 1.8s default dead-ball delay: long enough to read the whistle/basket on
    // a replay viewer, short enough not to visibly slow the game's pace
    resumeIn: opts.resumeIn ?? 1.8,
    clockRuns: opts.clockRuns,
    nextTeam,
    possKind: 'inbound',
    continuation: opts.continuation
  };
  checkSubs(s);
  setupDeadTargets(s, nextTeam);
}

/**
 * Cosmetic positioning for the dead-ball freeze: everyone stops driving/
 * cutting AI and walks to an inbound-ready spot. Purely visual/spacing setup
 * for the replay — no probability model reads these positions, so the exact
 * arithmetic below is "looks plausible," not "matters for outcomes."
 * Called from `deadBall` and (indirectly, via `tickDead`) whenever a fresh
 * inbound is coming up.
 */
export function setupDeadTargets(s: GameState, offSide: TeamSide): void {
  const rim = attackedRim(s, offSide);
  const own = attackedRim(s, other(offSide)); // offense inbounds under its own defended basket
  const dir = rim.x > s.court.midX ? 1 : -1;
  const handler = bestHandler(s, offSide);
  for (const a of onCourt(s, offSide)) {
    a.intent = 'freeze';
    a.sprinting = false;
    if (a.p.id === handler.p.id) {
      // inbounder stands ~4ft in front of the baseline he's inbounding from,
      // a few feet off the centerline (own.x is the DEFENDED rim — the
      // offense always takes the ball out under its own basket after a
      // score/dead ball on this end)
      a.target = { x: own.x + dir * 4, y: s.court.centerY - 6 };
    } else {
      // stagger the rest of the offense toward midcourt in parallel lanes so
      // they don't all clump on one spot; i*4 spaces each successive player
      // farther back, i*(width-12)/4 fans them across the court width with a
      // 6ft margin off each sideline
      const i = s.lineup[offSide].indexOf(a.p.id);
      a.target = {
        x: s.court.midX - dir * (6 + i * 4),
        y: 6 + i * (s.court.width - 12) / 4
      };
    }
  }
  for (const d of onCourt(s, other(offSide))) {
    d.intent = 'freeze';
    d.sprinting = false;
    const man = d.manId ? s.agents.get(d.manId) : null;
    // a defender with an assigned man drifts a quarter of the way from him
    // toward the rim (denies the easy inbound-to-cutter); with no assignment
    // yet, just settle a third of the way between the two rims (roughly
    // mid-lane) so nobody looks frozen mid-court
    d.target = man ? lerp(man.pos, rim, 0.25) : lerp(rim, s.court.rims[dir > 0 ? 0 : 1]!, 0.3);
  }
}

/**
 * Enter a live-rebound scramble phase: the ball is loose in the air/on the
 * floor and nearby players converge on it. Called after any missed shot
 * (field goal or free throw) whose rebound isn't an automatic putback.
 * `resolveIn` is how long the scramble plays out before `tickScramble` picks
 * a winner — callers pass a randomized window so scrambles don't all resolve
 * on the same beat.
 */
export function enterScramble(
  s: GameState,
  landAt: V2,
  resolveIn: number,
  offSide: TeamSide
): void {
  s.phase = { kind: 'scramble', landAt, resolveIn, offSide };
}

/**
 * Per-tick driver for the `dead` phase. Dispatched from `game.ts`'s tick
 * switch every tick while `s.phase.kind === 'dead'`. Advances the game clock
 * only if `clockRuns` (a made basket keeps it running until the delay ends;
 * a whistle stops it), still integrates movement/fatigue so the freeze-target
 * walk from `setupDeadTargets` actually plays out, and — once `resumeIn`
 * counts down to zero — either resumes the SAME possession (`continuation`,
 * e.g. after a non-shooting foul with no change of team) or starts a brand
 * new one via `startPossession`.
 */
export function tickDead(s: GameState, dt: number): void {
  const ph = s.phase as Extract<Phase, { kind: 'dead' }>;
  if (ph.clockRuns) {
    advanceClock(s, dt);
    if (s.clock < 1e-6) { endPeriod(s); return; }
  }
  ph.resumeIn -= dt;
  integrateMovement(s, dt);
  applyFatigue(s, dt);
  if (ph.resumeIn > 0) return;

  if (ph.continuation) {
    // same possession resumes (non-shooting foul etc.)
    s.phase = { kind: 'live' };
    giveBall(s, bestHandler(s, ph.nextTeam));
    // 0.3s: slightly longer than startPossession's 0.25s "look around" beat —
    // this is a possession that was already flowing before the whistle, so
    // give the offense a beat longer to re-set rather than snap back to speed
    s.decisionAt = s.t + 0.3;
    return;
  }
  s.phase = { kind: 'live' };
  startPossession(s, ph.nextTeam, ph.possKind === 'tip' ? 'tip' : 'inbound');
}

/**
 * Per-tick driver for the `scramble` phase (loose ball after a miss).
 * Dispatched from `game.ts`'s tick switch every tick while
 * `s.phase.kind === 'scramble'`. Nudges the ball toward its landing spot,
 * sprints nearby players at it, checks for a loose-ball foul once the
 * scramble window (`resolveIn`) expires, and otherwise resolves the rebound
 * via `resolveRebound` and routes into either an offensive putback look or a
 * fresh defensive-rebound possession.
 */
export function tickScramble(s: GameState, dt: number): void {
  const ph = s.phase as Extract<Phase, { kind: 'scramble' }>;
  advanceClock(s, dt);
  if (s.clock < 1e-6) { endPeriod(s); return; }
  // ease the ball 25% of the remaining distance toward its landing spot each
  // tick (a decaying-lerp "falling" visual, not a real physics trajectory —
  // at 10Hz this reaches the spot in well under a second)
  s.ball.pos = lerp(s.ball.pos, ph.landAt, 0.25);

  // nearby players converge on the ball — 18ft is roughly "anyone who could
  // plausibly be a rebounder on this carom" without pulling in players still
  // way out on the perimeter
  for (const side of [0, 1] as TeamSide[]) {
    for (const a of onCourt(s, side)) {
      if (a.fouledOut) continue;
      if (dist(a.pos, ph.landAt) < 18) {
        a.target = ph.landAt;
        a.sprinting = true;
      }
    }
  }
  integrateMovement(s, dt);
  applyFatigue(s, dt);

  ph.resolveIn -= dt;
  if (ph.resolveIn > 0) return;

  // loose-ball foul (defensive side only, v0.1): the two combatants closest
  // to the landing spot are the fouler/victim proxy — we don't model the
  // actual scrum, just who was most likely to be in the pile
  const defSide = other(ph.offSide);
  if (s.rng.chance(s.params.foul.looseBallPerReb)) {
    const fouler = onCourt(s, defSide)
      .filter((a) => !a.fouledOut)
      .sort((a, b) => dist(a.pos, ph.landAt) - dist(b.pos, ph.landAt))[0];
    if (fouler) {
      // prefer a victim who hasn't fouled out — a ghost free-throw shooter in
      // the bench-exhausted state would violate the no-fouled-out-actors rule
      const victims = onCourt(s, ph.offSide);
      const liveVictims = victims.filter((a) => !a.fouledOut);
      const victim = (liveVictims.length > 0 ? liveVictims : victims)
        .sort((a, b) => dist(a.pos, ph.landAt) - dist(b.pos, ph.landAt))[0]!;
      const { inBonus } = recordFoul(s, fouler, 'loose_ball', victim);
      if (inBonus) {
        enterFreeThrows(s, victim, s.rules.bonusFreeThrows);
      } else {
        // side out, offense keeps it: shot clock can't have ticked below 14
        // off a loose-ball whistle (mirrors the real shot-clock-reset rule
        // for a defensive foul with the offense retaining the ball)
        s.poss.shotClock = Math.max(s.poss.shotClock, 14);
        // 1.2s: shorter than the standard 1.8s dead-ball delay — this is a
        // continuation of the SAME possession (no team change), so the pause
        // just needs to cover the whistle, not a full re-set
        deadBall(s, ph.offSide, { clockRuns: false, continuation: true, resumeIn: 1.2 });
      }
      return;
    }
  }

  const winner = resolveRebound(s, ph.landAt, ph.offSide);
  const offensive = winner.side === ph.offSide;
  emit(s, {
    type: 'rebound',
    team: winner.side,
    player: winner.p.id,
    offensive,
    x: round1(ph.landAt.x),
    y: round1(ph.landAt.y)
  });

  s.phase = { kind: 'live' };
  if (offensive) {
    // offensive board: shot clock gets the rule pack's short-clock reset
    // (NBA 14s), never LESS than whatever was already on it (a board with
    // 20s left shouldn't get punished down to 14)
    s.poss.shotClock = Math.max(s.poss.shotClock, s.rules.shotClockOffRebSec);
    s.poss.phase = 'halfcourt';
    giveBall(s, winner);
    const rim = attackedRim(s, winner.side);
    // putback eligibility: within 6ft of the rim (still right under the
    // basket) and the clock has more than a hundredth of a second left —
    // putbacks must be released before the buzzer (clock guard)
    if (s.clock > 0.02 && dist(winner.pos, rim) < 6 && s.rng.chance(s.params.reb.putbackChance)) {
      startShot(s, winner, 'putback');
      return;
    }
    // 0.35s: a beat longer than a normal possession's 0.25s decision delay —
    // an offensive rebounder just fought for the ball and needs a moment to
    // survey before the AI can act on it
    s.decisionAt = s.t + 0.35;
  } else {
    endPossession(s, 'def_rebound');
    startPossession(s, winner.side, 'live_rebound', winner);
  }
}

// ----------------------------------------------------------------- periods

/**
 * Close out the current period (or the whole game). Called whenever the
 * game clock hits zero from any phase (`tickLive`, `tickDead`,
 * `tickScramble`, `tickFreeThrows` all check for it and route here) — the
 * single point where "the horn sounds" is handled. Ends the possession, and
 * if this was the last scheduled period with a clear winner, ends the game;
 * otherwise advances to the next period/overtime, resets team fouls, and
 * queues the next period's opening dead ball.
 */
export function endPeriod(s: GameState): void {
  endPossession(s, 'period_end');
  s.clock = 0;
  s.pendingRelease = null; // a windup at the horn never gets released
  emit(s, { type: 'period_end' });

  // a tied score at the end of the last scheduled period forces overtime —
  // otherwise this period's end IS the game's end
  const isFinalScheduled = s.period >= s.rules.periods;
  const tied = s.score[0] === s.score[1];
  if (isFinalScheduled && !tied) {
    emit(s, { type: 'game_end' });
    s.over = true;
    return;
  }

  s.period += 1;
  const isOT = s.period > s.rules.periods;
  s.clock = (isOT ? s.rules.otMinutes : s.rules.periodMinutes) * 60;
  s.teamFoulsPeriod = [0, 0]; // team-foul bonus count resets each period, personals don't
  emit(s, { type: 'period_start' });

  let team: TeamSide;
  if (isOT) {
    // no "tip winner" carries into OT — it's re-flipped, height/vertical only
    team = tipWeightedWinner(s);
    emit(s, { type: 'tip_off', winner: team });
  } else {
    // NBA convention: tip loser opens Q2/Q3, tip winner opens the final period
    team = s.period === s.rules.periods ? s.tipWinner : other(s.tipWinner);
  }
  // 1.6s period-opening delay: a touch shorter than the general 1.8s dead-ball
  // default since there's no preceding whistle/basket to read, just a
  // quarter-break cut back to game action
  s.phase = { kind: 'dead', resumeIn: 1.6, clockRuns: false, nextTeam: team, possKind: 'inbound' };
  checkSubs(s);
  // matchup/spot targets refresh when the possession starts
}
