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
import { clamp } from '../core/rng.js';
import type { PossessionOutcome, TeamSide } from '../core/events.js';
import {
  attackedRim, emit, liveOnCourt, onCourt, other, round1,
  type Agent, type GameState, type Phase
} from './state.js';
import { assignMatchups, assignSpots, onOrebSecured } from './ai.js';
import { resolveRebound, resolveTeamReboundSide } from './resolve.js';
import { checkSubs } from './subs.js';
import { advanceClock, applyFatigue, integrateMovement } from './movement.js';
import { enterFreeThrows, recordFoul } from './fouls.js';
import { startShot } from './shooting.js';
import { decideLiveTimeout, maybeTimeout, type TimeoutCall } from './endgame.js';

/**
 * Resolve a two-man jump ball: one weighted coin flip between exactly `a`
 * and `b`, returning the winner. The tip formula is mostly standing reach
 * (height) with a real but smaller share of leaping ability: a jump ball is
 * won more by who's taller than who jumps higher, but hops still matter
 * (70/30 split). Extracted from `tipWeightedWinner` (byte-identical there:
 * same weights, same single `rng.weighted` draw) so mid-game held-ball
 * jumps (tickScramble / passing.ts attemptReachIn, officiating wave) reuse
 * the one formula instead of duplicating it. Consumes exactly one rng draw.
 */
export function jumpWinnerOf(s: GameState, a: Agent, b: Agent): Agent {
  const weight = (j: Agent): number => j.p.heightIn * 0.7 + j.p.attr.vertical * 0.3;
  return s.rng.weighted([weight(a), weight(b)]) === 0 ? a : b;
}

/**
 * Who comes up with a jump ball's tap: the winning jumper's nearest live
 * on-court teammate to the jump spot, excluding the jumper himself.
 * Corpus: 326/340 mid-game jump gains are a third player, not the jumper
 * (the tap goes to a teammate). Falls back to the jumper only when no live
 * teammate exists (bench-exhausted degenerate state). Deterministic, no
 * rng, so a staged-off game's stream is untouched by this helper existing.
 */
export function jumpGainer(s: GameState, winner: Agent, at: V2): Agent {
  const mates = liveOnCourt(s, winner.side)
    .filter((a) => a.p.id !== winner.p.id)
    .sort((a, b) => dist(a.pos, at) - dist(b.pos, at));
  return mates[0] ?? winner;
}

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
  // then hand the two jumpers to the shared two-man flip.
  const jumper = (side: TeamSide): Agent => {
    const bigs = onCourt(s, side);
    return bigs.reduce((m, a) =>
      a.p.heightIn + a.p.attr.vertical * 0.12 > m.p.heightIn + m.p.attr.vertical * 0.12 ? a : m
    );
  };
  return jumpWinnerOf(s, jumper(0), jumper(1)).side;
}

/**
 * Shot clock after a defensive foul with the offense RETAINING the ball
 * (a reach-in outside the bonus, a loose-ball side-out): the real rule has
 * two arms keyed on where play resumes —
 *  - FRONTcourt: remaining time floored at the rule pack's short reset
 *    (NBA 14 s), never lowered;
 *  - BACKcourt: a full fresh clock (NBA 24 s) — the offense still has the
 *    whole floor to travel.
 * The backcourt arm was missing (audit L-11): a backcourt whistle with 19 s
 * left kept 19 instead of resetting to 24. `ballPos` is where the whistle
 * caught the ball (the holder for a reach-in, the carom spot for a
 * loose-ball scramble) — the sim's proxy for the resume spot. A ball ON the
 * division line has not attained frontcourt status, so exactly-midcourt
 * counts as backcourt, matching the rule book.
 */
export function retentionFoulShotClock(s: GameState, side: TeamSide, ballPos: V2): number {
  const rim = attackedRim(s, side);
  const front = rim.x > s.court.midX ? ballPos.x > s.court.midX : ballPos.x < s.court.midX;
  return front
    ? Math.max(s.poss.shotClock, s.rules.shotClockOffRebSec)
    : s.rules.shotClockSec;
}

/** Ball-handler picked to bring the ball up / receive the inbound: highest ballHandle rating on the floor. */
export function bestHandler(s: GameState, side: TeamSide): Agent {
  const eligible = liveOnCourt(s, side);
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
    // the period's first possession: the game clock still reads the full
    // period value here (the opening dead ball never runs it, advanceClock
    // is the only clock writer, and any prior possession consumes live
    // ticks), so exact equality is safe. See Possession.opener (state.ts).
    opener: s.clock ===
      (s.period > s.rules.periods ? s.rules.otMinutes : s.rules.periodMinutes) * 60,
    lastPass: null,
    spotMap: new Map(),
    spots: new Map(), // filled by assignSpots below (jittered per possession)
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
    a.relocUntil = -99; // was omitted — a relocation window leaked across
                        // possessions (docs/REGISTER.md D5; landed with M1)
  }
  emit(s, { type: 'possession_start', team, kind });
  assignSpots(s, team);
  assignMatchups(s, other(team));
  const h = holder ?? bestHandler(s, team);
  // acquisition taxonomy: the thief's touch is a steal, a live-rebound
  // possession starts with the rebounder's grab, and inbound/tip possessions
  // hand the ball over at a dead ball (an inbound catch is not a live PASS —
  // the sim doesn't fly an inbound pass, it grants the touch)
  giveBall(s, h, kind === 'steal' ? 'steal' : kind === 'live_rebound' ? 'rebound' : 'deadball');
  // delayNewPossSec: the new holder needs at least one tick of "look around"
  // before the AI is allowed to shoot/pass/drive off the inbound — prevents
  // an instant no-look heave the moment the ball touches his hands
  s.decisionAt = s.t + s.params.decide.delayNewPossSec;

  // Live-ball possession timeout (fdesign-timeouts §1.2.3, STAGED off
  // behind params.endgame.toLiveSiteOn): grab the defensive board / steal
  // and call time. 12.4% of real timeouts, and the only way the endgame
  // advance ever fires off a live change of possession (today these flows
  // never pass through deadBall, so the timeout brain is unreachable from
  // them). Inbound/tip possessions are skipped: their stoppage already had
  // its evaluation. On a call: the possession is retained through a
  // continuation dead ball with the decision pre-stamped (one timeout per
  // stoppage; deadBall's own evaluation must not run twice), the
  // post-huddle possession is halfcourt (not a transition sprint), and the
  // shot clock is left untouched (real rule: a timeout doesn't reset it).
  // For 'advance' the continuation dead ball carries advanceInbound via
  // callTimeout, and setupDeadTargets stages the frontcourt spot with no
  // new positioning code.
  if (
    s.endgame && s.params.endgame.toLiveSiteOn > 0 &&
    (kind === 'live_rebound' || kind === 'steal')
  ) {
    const call = decideLiveTimeout(s, team);
    if (call) {
      s.poss.phase = 'halfcourt';
      // deadBallSideOutSec: the continuation-stoppage delay (same as the
      // loose-ball side-out below, hoisted by audit H-01); the huddle
      // stretch itself comes from callTimeout
      deadBall(s, team, {
        clockRuns: false, continuation: true,
        resumeIn: s.params.move.deadBallSideOutSec, timeout: call
      });
    }
  }
}

/**
 * Transfer ball possession to `a` (a catch, not a shot going up). Resets the
 * dribble-count bookkeeping used for the "one-dribble-and-shoot" assist
 * window and hand-check/strip mechanics. Called on every inbound, rebound,
 * steal, and completed pass — NOT on a shot release (that clears the holder
 * without assigning a new one; see `startShot`/`resolvePassArrival`).
 *
 * `acquisition` stamps HOW the touch arrived (see state.ts BallAcquisition):
 * it gates the quick-shot taxonomy in decide.ts (catch_shoot / cut_finish /
 * putback) and assist eligibility in shooting.ts. On any NON-pass acquisition
 * the delivery-quality memory is reset to league-typical: catchQuality is a
 * property of the pass that was caught, and a rebound/steal/dead-ball touch
 * has no pass — before this, the passQ term in shotMakeP read a stale
 * delivery from a pass caught possessions earlier (wave2 diagnostic).
 * resolvePassArrival stamps the REAL delivery quality just before calling
 * this with 'pass', so the order (stamp, then giveBall) preserves it.
 */
export function giveBall(s: GameState, a: Agent, acquisition: Agent['acquiredBy']): void {
  s.ball.holderId = a.p.id;
  s.ball.flight = null;
  a.catchT = s.t;
  a.dribblesSinceCatch = 0;
  a.dribbleAcc = 0;
  a.acquiredBy = acquisition;
  if (acquisition !== 'pass') a.catchQuality = s.params.shot.passQualityCenter;
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
  outcome: PossessionOutcome
): void {
  // a possession ends exactly once — and-ones, buzzer flows, and FT-miss
  // scrambles all route here, so guard against double counting (pace/ORtg
  // depend on this invariant)
  if (s.poss.ended) return;
  s.poss.ended = true;
  // usage bookkeeping: every offensive player on court consumed a share of
  // this possession's opportunity — the denominator of realized usage share
  // (rides the exactly-once guard above, so it can't double-count)
  for (const a of onCourt(s, s.poss.team)) a.teamPossOnCourt++;
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
  opts: {
    clockRuns: boolean; resumeIn?: number; continuation?: boolean;
    /** a timeout decision already made at a live site (startPossession's
     *  live_rebound/steal hook): applied here instead of re-evaluating;
     *  one timeout per stoppage, hard */
    timeout?: TimeoutCall;
    /** this stoppage hosts a reviewable call (officiating wave, STAGED
     *  inert at the officiating.reviewPer* zeros): set by exactly the
     *  close-call sites, OOB/travel/off-goaltend turnovers ('oob') and the
     *  final-period last-2:00 made-FG dead ball ('late_make'). Unflagged
     *  dead balls consume nothing. */
    reviewable?: 'oob' | 'late_make';
  }
): void {
  s.ball.flight = null;
  s.ball.holderId = null;
  s.pendingRelease = null; // abandon any windup — the play is dead
  s.phase = {
    kind: 'dead',
    // default dead-ball delay (move.deadBallResumeSec): long enough to read
    // the whistle/basket on a replay viewer, short enough not to visibly
    // slow the game's pace
    resumeIn: opts.resumeIn ?? s.params.move.deadBallResumeSec,
    clockRuns: opts.clockRuns,
    nextTeam,
    possKind: 'inbound',
    continuation: opts.continuation
  };
  // endgame layer (GameConfig.endgame only): the inbounding team may call a
  // timeout HERE — the one choke point every stoppage routes through, which
  // is exactly where real timeouts live. May freeze the clock, stretch the
  // dead-ball delay, and flag a frontcourt inbound (see sim/endgame.ts);
  // flag off, it returns immediately. Ordering: timeout before checkSubs is
  // the sub-window handshake; the rotation layer reads phase.timeout.
  maybeTimeout(s, opts.timeout);
  // Replay review (officiating wave, fdesign-officiating §1.7): a
  // review-flagged stoppage may send the officials to the monitor. Pure
  // wallT theater with no outcome (reviews never overturn in v1; the
  // narration renders "the call stands"). Rolled after maybeTimeout (fixed
  // draw order at this site: timeout evaluation, then at most one review
  // chance) and gated rate-first so an unflagged or staged-off game draws
  // nothing. The stoppage stretch is the TimeoutEvent wallT-only mechanic:
  // game clock frozen, `wt` runs through the huddle at the monitor.
  if (opts.reviewable) {
    const O = s.params.officiating;
    const rate = opts.reviewable === 'oob' ? O.reviewPerOOB : O.reviewPerLateMake;
    if (rate > 0 && s.rng.chance(rate)) {
      emit(s, { type: 'replay_review', trigger: opts.reviewable });
      const ph = s.phase as Extract<Phase, { kind: 'dead' }>;
      ph.clockRuns = false;
      ph.resumeIn = Math.max(ph.resumeIn, O.reviewResumeSec);
    }
  }
  // Post-make sub window (ffit-rotations §3.1, the real rule): no
  // substitutions after a made basket while the clock keeps running; the
  // ball is live for the inbound, there is no window. A timeout at this
  // stoppage freezes the clock (callTimeout sets clockRuns=false) and that
  // IS a legal window; so is any caller that stops it. Legacy at
  // postMakeSubWindow 1 (STAGED): every dead ball hosts the pass, the ~30
  // live-ball subs/g tell vs corpus 1.16 (the #1 census component).
  const phSub = s.phase;
  const liveInbound =
    s.params.sub.postMakeSubWindow <= 0 && phSub.kind === 'dead' && phSub.clockRuns;
  if (!liveInbound) checkSubs(s);
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
  // an 'advance' timeout moves the whole inbound to the FRONTcourt (endgame
  // layer): the handler sets up timeoutAdvanceSpotFt from the attacked rim —
  // the real advance-the-ball payoff, delivered as positioning that the
  // normal possession machinery then plays out (no scripted inbound play)
  const advanced =
    s.phase.kind === 'dead' && s.phase.advanceInbound === true && s.phase.nextTeam === offSide;
  for (const a of onCourt(s, offSide)) {
    a.intent = 'freeze';
    a.sprinting = false;
    if (a.p.id === handler.p.id) {
      a.target = advanced
        // frontcourt hashmark, a step inside the sideline (6 ft keeps the
        // walk-to spot clear of the boundary clamp — cosmetic offset; the
        // BEHAVIORAL distance-from-rim is params.endgame.timeoutAdvanceSpotFt)
        ? { x: rim.x - dir * s.params.endgame.timeoutAdvanceSpotFt, y: 6 }
        // inbounder stands ~4ft in front of the baseline he's inbounding from,
        // a few feet off the centerline (own.x is the DEFENDED rim — the
        // offense always takes the ball out under its own basket after a
        // score/dead ball on this end)
        : { x: own.x + dir * 4, y: s.court.centerY - 6 };
    } else if (advanced) {
      // the other four space the frontcourt arc — the same fan the halfcourt
      // spot machinery will refine once the possession starts (cosmetic)
      const i = s.lineup[offSide].indexOf(a.p.id);
      a.target = {
        x: rim.x - dir * (14 + (i % 3) * 6),
        y: 8 + i * (s.court.width - 16) / 4
      };
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
 * a winner; callers draw it from `resolve.ts sampleScrambleSec` (the G9
 * miss->secure cadence; corpus-shaped when params.reb.cadenceOn is live,
 * the legacy sub-second window when STAGED). The window runs on both time
 * axes: the game clock burns under it (tickScramble advances it; real
 * rebounds consume game clock) and the frames show a holderless ball at the
 * landing spot with bodies converging (wallT ticks every frame regardless).
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
    // same possession resumes (non-shooting foul etc.) — a dead-ball touch,
    // not a pass: the whistle broke whatever play the last pass created
    s.phase = { kind: 'live' };
    giveBall(s, bestHandler(s, ph.nextTeam), 'deadball');
    // delayResumeSec: slightly longer than startPossession's "look around"
    // beat — this is a possession that was already flowing before the
    // whistle, so give the offense a beat longer to re-set rather than snap
    // back to speed
    s.decisionAt = s.t + s.params.decide.delayResumeSec;
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
  // a miss in the final seconds can legally end the period mid-scramble:
  // the horn beats the secure, no rebound row is logged (real pbp reads the
  // same: miss, then end-of-quarter). With the corpus cadence live this
  // fires more often than the legacy sub-second window did; that is real.
  if (s.clock < 1e-6) { endPeriod(s); return; }
  // ease the ball 25% of the remaining distance toward its landing spot each
  // tick (a decaying-lerp "falling" visual, not a real physics trajectory —
  // at 10Hz this reaches the spot in well under a second)
  s.ball.pos = lerp(s.ball.pos, ph.landAt, 0.25);

  // nearby players converge on the ball — reb.scrambleConvergeFt is roughly
  // "anyone who could plausibly be a rebounder on this carom" without
  // pulling in players still way out on the perimeter
  for (const side of [0, 1] as TeamSide[]) {
    for (const a of liveOnCourt(s, side)) {
      if (dist(a.pos, ph.landAt) < s.params.reb.scrambleConvergeFt) {
        a.target = ph.landAt;
        a.sprinting = true;
      }
    }
  }
  integrateMovement(s, dt);
  applyFatigue(s, dt);

  ph.resolveIn -= dt;
  if (ph.resolveIn > 0) return;

  // The expired scramble resolves exactly ONE of three ways, tried in order:
  // loose-ball foul -> team rebound -> player rebound. The first two branches
  // return; a player rebound falls through to the putback/possession routing.
  // Everything below happens at the secure (window expiry), which is the
  // rule-correct instant: the shot clock resets/floors when a team gains
  // possession (it is not running while the ball is loose; this phase
  // never decrements it), and the grammar layer's putback/kick windows key
  // off the rebounder's catchT stamped here, not off the miss. The
  // loose-ball-foul and dead-carom pre-rolls below also ride the full
  // window; the corpus says real tipped-dead caroms die earlier (team-reb
  // delta p50 1s vs player 3s); accepted residual, team rows sit outside
  // the G9 gate (fdesign-judge §3).

  // loose-ball foul (defensive side only, v0.1): the two combatants closest
  // to the landing spot are the fouler/victim proxy — we don't model the
  // actual scrum, just who was most likely to be in the pile
  const defSide = other(ph.offSide);
  if (s.rng.chance(s.params.foul.looseBallPerReb)) {
    const fouler = liveOnCourt(s, defSide)
      .sort((a, b) => dist(a.pos, ph.landAt) - dist(b.pos, ph.landAt))[0];
    if (fouler) {
      // prefer a victim who hasn't fouled out — a ghost free-throw shooter in
      // the bench-exhausted state would violate the no-fouled-out-actors rule
      const victims = onCourt(s, ph.offSide);
      const liveVictims = liveOnCourt(s, ph.offSide);
      const victim = (liveVictims.length > 0 ? liveVictims : victims)
        .sort((a, b) => dist(a.pos, ph.landAt) - dist(b.pos, ph.landAt))[0]!;
      const { bonus, techFT } = recordFoul(s, fouler, 'loose_ball', victim);
      if (bonus) {
        victim.usedPoss++; // bonus trip = possession used (usage bookkeeping)
        // award from FoulOutcome.bonus (NCAA 7-9 is a one-and-one), not a
        // flat rules.bonusFreeThrows read (see fouls.ts FoulOutcome; a
        // technical rider prefixes the trip: fouls.ts, staged-inert)
        enterFreeThrows(s, victim, bonus.shots, bonus.oneAndOne,
          techFT ? { pre: techFT.p.id } : undefined);
      } else {
        // side out, offense keeps it: the defensive-foul retention reset —
        // frontcourt floors at the short reset (NBA 14s), a backcourt
        // whistle grants a full fresh clock (retentionFoulShotClock; the
        // carom spot stands in for where play resumes — for a rebound
        // scramble that is essentially always the frontcourt)
        s.poss.shotClock = retentionFoulShotClock(s, ph.offSide, ph.landAt);
        if (techFT) {
          // technical rider with no FTs of its own: the tech FT is shot
          // first, then this deadBall runs from tickFreeThrows via resume
          // with the same arguments, so the possession resumes
          // byte-identically
          enterFreeThrows(s, techFT, 1, false, {
            resume: {
              nextTeam: ph.offSide, continuation: true,
              resumeIn: s.params.move.deadBallSideOutSec
            }
          });
          return;
        }
        // deadBallSideOutSec: shorter than the standard dead-ball delay —
        // this is a continuation of the SAME possession (no team change), so
        // the pause just needs to cover the whistle, not a full re-set
        deadBall(s, ph.offSide, {
          clockRuns: false, continuation: true,
          resumeIn: s.params.move.deadBallSideOutSec
        });
      }
      return;
    }
  }

  // TEAM rebound: some caroms die without any individual securing them —
  // tipped out of bounds, long skips off the scrum — and the officials
  // award a side the ball at a dead-ball inbound. Real logs read
  // "Defensive rebound by Team" (the Turing baseline judges used the sim's
  // total lack of these as a definitely-real marker). The winning side runs
  // the SAME positioning-weighted lottery a player rebound would, so this
  // diverts individual credit without moving the ORB/DRB split; rate lives
  // at params.reb.deadBallCaromChance (0 disables the mechanic entirely).
  if (s.rng.chance(s.params.reb.deadBallCaromChance)) {
    const side = resolveTeamReboundSide(s, ph.landAt, ph.offSide);
    const offensive = side === ph.offSide;
    emit(s, {
      type: 'rebound',
      team: side,
      offensive,
      x: round1(ph.landAt.x),
      y: round1(ph.landAt.y)
    });
    if (offensive) {
      // offense retains at a side out: shot clock floors at the rule pack's
      // short-clock reset and the SAME possession continues — mirrors the
      // loose-ball-foul side-out branch above
      s.poss.shotClock = Math.max(s.poss.shotClock, s.rules.shotClockOffRebSec);
      deadBall(s, ph.offSide, {
        clockRuns: false, continuation: true,
        resumeIn: s.params.move.deadBallSideOutSec
      });
    } else {
      // defense is awarded the ball out of bounds: the possession ended in a
      // defensive rebound, but the next one starts from a dead-ball INBOUND
      // (not a live_rebound) — no transition burst off a whistle
      endPossession(s, 'def_rebound');
      deadBall(s, side, { clockRuns: false });
    }
    return;
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

  // Held ball → mid-game jump (officiating wave, fdesign-officiating §1.1,
  // STAGED inert at heldBallPerScramble 0: the rate gate runs before the
  // draw). The scrum's winner gets tied up by the nearest live opponent and
  // the officials administer a real jump (no possession arrow, the NBA
  // rule). The rebound above stays credited as scored: real logs print the
  // rebound row, then the jump row, and the tap can still flip the ball.
  // Draw order at this site is fixed: one chance(), then (on fire) the one
  // weighted() flip inside jumpWinnerOf, ≤2 draws per resolved scramble.
  // Branching is on the jump winner, not the rebound winner: the offense's
  // side keeps its still-open possession at a 14s-floor reset; the
  // defense's side closes it as an ordinary defensive board whose next
  // possession starts as an administered 'tip' (never a transition burst).
  const O = s.params.officiating;
  if (O.heldBallPerScramble > 0 && s.rng.chance(O.heldBallPerScramble)) {
    const opp = liveOnCourt(s, other(winner.side))
      .sort((a, b) => dist(a.pos, ph.landAt) - dist(b.pos, ph.landAt))[0];
    if (opp) {
      const jumpWinner = jumpWinnerOf(s, winner, opp);
      const gainer = jumpGainer(s, jumpWinner, ph.landAt);
      emit(s, {
        type: 'jump_ball',
        between: [winner.p.id, opp.p.id],
        winner: jumpWinner.side,
        gainedBy: gainer.p.id
      });
      s.phase = { kind: 'live' };
      if (jumpWinner.side === ph.offSide) {
        // offense controls the tap: same possession continues. The shot
        // clock floors at the rule pack's short-clock reset like any
        // offense-retains whistle, and the administered restart reads as a
        // set halfcourt trip (the stoppage let the defense organize)
        s.poss.shotClock = Math.max(s.poss.shotClock, s.rules.shotClockOffRebSec);
        s.poss.phase = 'halfcourt';
        giveBall(s, gainer, 'deadball');
        // 0.35s: the post-rebound survey beat; the gainer just came out of
        // a tie-up, same re-set moment as an offensive board
        s.decisionAt = s.t + 0.35;
      } else {
        endPossession(s, 'def_rebound');
        startPossession(s, jumpWinner.side, 'tip', gainer);
      }
      return;
    }
  }

  s.phase = { kind: 'live' };
  if (offensive) {
    // offensive board: shot clock gets the rule pack's short-clock reset
    // (NBA 14s), never LESS than whatever was already on it (a board with
    // 20s left shouldn't get punished down to 14)
    s.poss.shotClock = Math.max(s.poss.shotClock, s.rules.shotClockOffRebSec);
    s.poss.phase = 'halfcourt';
    giveBall(s, winner, 'rebound');
    // perimeter re-fill behind the grab (fdesign-grammar M2a, STAGED off at
    // ai.orebRefillSec 0): the kick-out read needs a receiver on the arc.
    // Before the putback roll on purpose: a putback releases in ~0.25s and
    // the refill serves the next beat either way. Rng-free.
    onOrebSecured(s, winner);
    const rim = attackedRim(s, winner.side);
    // putback eligibility: within reb.putbackRadiusFt of the rim (still
    // right under the basket) and the clock has more than two hundredths of
    // a second left — putbacks must be released before the buzzer (clock guard)
    if (
      s.clock > 0.02 &&
      dist(winner.pos, rim) < s.params.reb.putbackRadiusFt &&
      s.rng.chance(s.params.reb.putbackChance)
    ) {
      // Offensive goaltending (officiating wave, §1.2, STAGED inert at
      // goaltendPerPutback 0, rate gate before the draw): the rebounder
      // interferes on the rim instead of getting the attempt off. A
      // turnover with no shot event (real logs read OREB row → turnover
      // row, no FGA) and never a steal. The dead ball is flagged
      // reviewable: rim interference is exactly the close call officials
      // check the monitor for.
      if (O.goaltendPerPutback > 0 && s.rng.chance(O.goaltendPerPutback)) {
        emit(s, {
          type: 'turnover', team: winner.side, player: winner.p.id, kind: 'off_goaltend'
        });
        endPossession(s, 'turnover');
        deadBall(s, other(winner.side), { clockRuns: false, reviewable: 'oob' });
        return;
      }
      startShot(s, winner, 'putback');
      return;
    }
    // delayOrebSec: a beat longer than a normal possession's decision delay
    // — an offensive rebounder just fought for the ball and needs a moment
    // to survey before the AI can act on it
    s.decisionAt = s.t + s.params.decide.delayOrebSec;
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
 * otherwise advances to the next period/overtime, resets team fouls (unless
 * the rule pack carries them into OT — teamFoulsCarryToOT), and
 * queues the next period's opening dead ball.
 */
export function endPeriod(s: GameState): void {
  endPossession(s, 'period_end');
  s.clock = 0;
  s.pendingRelease = null; // a windup at the horn never gets released
  // Period-end replay review (officiating wave, fdesign-officiating §1.7,
  // STAGED inert at reviewPerPeriodEnd 0, rate gate before the draw): the
  // last-second look at the monitor. Emitted before the period_end event
  // (real logs print the replay row, then "End of quarter") and it
  // stretches the period break's wall-clock delay (game clock is already at
  // 0). Draw order at this site is fixed: this one chance() precedes the
  // OT re-tip's weighted() below, so the flip's stream position is stable.
  let reviewStretch = 0;
  {
    const O = s.params.officiating;
    if (O.reviewPerPeriodEnd > 0 && s.rng.chance(O.reviewPerPeriodEnd)) {
      emit(s, { type: 'replay_review', trigger: 'period_end' });
      reviewStretch = O.reviewResumeSec;
    }
  }
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
  // Team-foul bonus counts reset each regulation period (personals never
  // do) — but a league with teamFoulsCarryToOT keeps the count through EVERY
  // overtime: NCAA men reset only at the end of the first half, so OT
  // continues the second half's count (and a 2nd OT continues the 1st's);
  // FIBA/EuroLeague treat extra periods as an extension of the 4th. The NBA
  // resets here like any other period (rules/rulepack.ts field doc).
  if (!(isOT && s.rules.teamFoulsCarryToOT)) s.teamFoulsPeriod = [0, 0];
  // Timeout bookkeeping resets every period, unlike the OT foul carry above
  // (state.ts doc): the per-period count drives the mandatory-stoppage
  // owed/charging arithmetic, the final-period counters back the Q4 caps.
  // Upkeep always, consumers STAGED (sim/endgame.ts, fdesign-timeouts §3.2).
  s.timeoutsThisPeriod = [0, 0];
  s.timeoutsUsedFinalPeriod = [0, 0];
  s.timeoutsUsedFinalLate = [0, 0];
  if (isOT && s.params.endgame.toOvertimeTimeouts >= 0) {
    // per-OT budget replaces the regulation remainder (real NBA rule; the
    // corpus's 8-9-used team-games are all consistent with 7 + 2/OT).
    // STAGED off at the shipped −1 (remainder carries, today's behavior)
    s.timeoutsLeft = [s.params.endgame.toOvertimeTimeouts, s.params.endgame.toOvertimeTimeouts];
  }
  // Halftime legs (fdesign-rhythm M1, a no-op at the STAGED loadPerSec 0,
  // where load is identically 0): the locker room takes one lump off the
  // cumulative-load pool, for everyone. A partial reset, so Q3 pace stays
  // near Q1's while the load-driven foul gradient persists. Fires exactly
  // once per game: the period just ended is the half boundary (NBA: after
  // Q2; an NCAA halves pack: after period 1; each league's real halftime
  // falls out of its pack). OT never re-triggers it.
  if (s.period - 1 === Math.floor(s.rules.periods / 2)) {
    for (const [, a] of s.agents) {
      a.load = clamp(a.load - s.params.fatigue.loadHalftimeRecover, 0, 100);
    }
  }
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
  // quarter-break cut back to game action, stretched to the monitor delay
  // when a period-end review fired above (wallT-only, two-axes discipline).
  // An OT opener is a fresh jump ball (tip_off emitted above), so its
  // possession is kind 'tip' per the event contract (events.ts
  // PossessionStartEvent: 'tip' = the opening possession of a period off a
  // jump ball) — it was stamped 'inbound', undercounting jump-ball
  // possessions for any consumer reading the documented kind.
  s.phase = {
    kind: 'dead', resumeIn: Math.max(1.6, reviewStretch), clockRuns: false,
    nextTeam: team, possKind: isOT ? 'tip' : 'inbound'
  };
  // the period-opening stoppage is the quarter-break wave's site (subs.ts
  // quarterWave, live at waveMaxPerTeam 2): planned boundary swaps,
  // not fatigue-forced ones. No timeout evaluation here; real first-60s
  // timeout share is 1.0%, and quarter-opening inbounds never host one.
  checkSubs(s, undefined, { wave: true });
  // Opener formation re-set (fdesign-grammar M1a, live at
  // ai.openerResetOn 1): every other inbound routes through deadBall,
  // which stages the freeze-walk formation; the period break never did, so
  // the ten idle where the horn froze them and the opener's handler can
  // receive already in his frontcourt (13.4% of sim openers attacked
  // inside 4s vs the real 0.0%; the re-set alone is worth ~16pp of the
  // <=8s share). Same order as deadBall: subs first, then targets on the
  // post-sub lineup. setupDeadTargets consumes no rng; the switch exists
  // because positions change outcomes (mechanics tier at the flip).
  // Trap: setupDeadTargets reads s.court.rims, so a hand-built minimal
  // GameState that reaches endPeriod must carry court (or pin
  // openerResetOn 0 in its params); three test fixtures crashed here at
  // the flip (f-assembly §4b).
  if (s.params.ai.openerResetOn > 0) setupDeadTargets(s, team);
  // matchup/spot targets refresh when the possession starts
}
