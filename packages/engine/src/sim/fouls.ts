/**
 * Fouls: recording personals/team fouls with bonus tracking and fouled-out
 * replacement, plus the free-throw phase (setup and per-tick resolution).
 *
 * Two call sites feed `recordFoul`: shooting fouls come from `shooting.ts`
 * (contest resolution), everything else (reach-ins, offensive/charges,
 * loose-ball) comes from `passing.ts`/`possession.ts`/`game.ts`'s live tick.
 * `tickFreeThrows` is dispatched directly from `game.ts`'s tick switch
 * whenever `s.phase.kind === 'freethrows'` — see docs/INTERNALS.md's pipeline.
 */

import { attackedRim, agent, emit, onCourt, other, round1, type Agent, type GameState, type Phase } from './state.js';
import { bonusFreeThrowAward, type BonusAward } from '../rules/rulepack.js';
import { freeThrowP, sampleMissLanding, sampleScrambleSec } from './resolve.js';
import { checkSubs, replaceFouledOut } from './subs.js';
import { applyFatigue, integrateMovement } from './movement.js';
import { deadBall, endPeriod, endPossession, enterScramble } from './possession.js';
import { onShotReleased } from './ai.js';
import { noteScore } from './endgame.js';

export interface FoulOutcome {
  fouledOut: boolean;
  inBonus: boolean;
  /**
   * What THIS foul awards at the line under the bonus: null for offensive
   * fouls (never shots) and whenever the fouling team isn't in the bonus.
   * For non-shooting defensive fouls, `bonus !== null` exactly when
   * `inBonus` — callers that send someone to the line must use this (shots
   * + one-and-one flag) rather than reading rules.bonusFreeThrows directly,
   * or the NCAA one-and-one tier silently becomes a flat two. Shooting-foul
   * callers ignore it: their FT count comes from the shot (2/3/and-one).
   */
  bonus: BonusAward | null;
}

/**
 * Book a foul against `fouler`: bumps his personal count and (unless it's an
 * offensive foul) his team's period foul count, checks bonus/foul-out
 * thresholds, emits the `foul` event, and — if this personal foul was his
 * last — immediately benches him and pulls in a replacement via
 * `replaceFouledOut`. Callers use the returned `{ fouledOut, inBonus }` to
 * decide what happens next (free throws vs. a normal dead-ball inbound).
 * Trap: this can change who's on the floor as a side effect, so any code
 * that captured a reference to `fouler` before calling this must not assume
 * he's still in the lineup afterward.
 */
export function recordFoul(
  s: GameState,
  fouler: Agent,
  kind: 'shooting' | 'reach' | 'offensive' | 'loose_ball',
  drawnBy?: Agent
): FoulOutcome {
  fouler.fouls += 1;
  const side = fouler.side;
  const countsTeam = kind !== 'offensive'; // offensive fouls: personal only (v0.1)
  if (countsTeam) s.teamFoulsPeriod[side] += 1;
  const inBonus = s.teamFoulsPeriod[side] >= s.rules.teamFoulBonusAt;
  // the award is looked up AFTER the team-foul bump, so the foul that puts a
  // team at exactly teamFoulBonusAt (or doubleBonusAt) already pays at the
  // new tier — matching how the rule reads ("on the seventh team foul…")
  const bonus = countsTeam ? bonusFreeThrowAward(s.rules, s.teamFoulsPeriod[side]) : null;
  const fouledOut = fouler.fouls >= s.rules.foulOutAt;
  if (fouledOut) fouler.fouledOut = true;
  emit(s, {
    type: 'foul',
    team: side,
    on: fouler.p.id,
    kind,
    drawnBy: drawnBy?.p.id,
    personalCount: fouler.fouls,
    teamCountInPeriod: s.teamFoulsPeriod[side],
    inBonus,
    fouledOut
  });
  if (fouledOut) replaceFouledOut(s, fouler);
  return { fouledOut, inBonus, bonus };
}

// ------------------------------------------------------------- free throws

/**
 * Set up a free-throw sequence: parks the ball dead, switches the phase to
 * `freethrows`, and arranges cosmetic lane positions for everyone else.
 * Called wherever a foul (or and-one) awards free throws — shooting fouls,
 * bonus reach-ins/loose-balls, and-ones. `count` is how many shots (1, 2, or
 * 3 depending on shot value / and-one / bonus rules upstream). `oneAndOne`
 * marks the trip as an NCAA-style one-and-one (count is the POTENTIAL 2;
 * tickFreeThrows ends the trip with a live ball if the front end misses) —
 * bonus callers pass it straight from FoulOutcome.bonus.
 * Trap: `checkSubs(s, shooter.p.id)` passes the shooter's id as the
 * `protect` argument specifically so the normal fatigue-rotation logic can't
 * yank the free-throw shooter off the floor between the whistle and his shot.
 */
export function enterFreeThrows(s: GameState, shooter: Agent, count: number, oneAndOne = false): void {
  s.ball.holderId = null;
  s.ball.flight = null;
  // abandon any windup, exactly as deadBall does — the whistle killed the
  // play. A reach-in foul can land on the very tick a shoot decision set
  // pendingRelease; left uncleared, the stale windup survived the whole FT
  // trip and, if the shooter himself grabbed the final-FT miss, resurrected
  // as a ghost shot with pre-whistle contest/moveType (scan a1).
  s.pendingRelease = null;
  s.phase = {
    kind: 'freethrows',
    shooterId: shooter.p.id,
    side: shooter.side,
    taken: 0,
    of: count,
    // ftSetupSec before the first attempt: time to walk to the line and get
    // set — slightly quicker than a full dead-ball delay since the whistle
    // already stopped the action
    nextIn: s.params.move.ftSetupSec,
    oneAndOne
  };
  checkSubs(s, shooter.p.id); // never sub out the man headed to the line
  // cosmetic positioning around the key — none of this affects the free-throw
  // probability model (that's purely rating-based in resolve.ts), it's just
  // so the replay doesn't show players standing wherever the whistle caught them
  const rim = attackedRim(s, shooter.side);
  const dir = rim.x > s.court.midX ? -1 : 1;
  // free-throw-line-to-rim-center distance, derived from the rule pack
  // (NBA: 19 - 5.25 = 13.75 ft) — was a hardcoded 13.75 that silently
  // diverged from any custom pack's ftLineFt/rimInsetFt
  const ftDistFt = s.rules.ftLineFt - s.rules.rimInsetFt;
  const ftSpot = { x: rim.x + dir * ftDistFt, y: s.court.centerY };
  shooter.target = ftSpot;
  // the ball waits at the line with the shooter. Without this it sat wherever
  // the whistle caught it for the whole ritual — median 14 ft, worst-case
  // 35 ft (backcourt) from the man shooting, a visible replay tell. No
  // probability model reads ball.pos in this phase; frames/viewer only.
  s.ball.pos = { ...ftSpot };
  let lane = 0;
  for (const a of [...onCourt(s, shooter.side), ...onCourt(s, other(shooter.side))]) {
    if (a.p.id === shooter.p.id) continue;
    a.intent = 'freeze';
    lane += 1;
    // alternate lane spots left/right of the key as players are enumerated
    const side = lane % 2 === 0 ? 1 : -1;
    a.target = lane <= 6
      // first 6 (3 per side) line up along the lane at the real box positions:
      // 4ft and 7.5ft from the rim (4 + floor(lane/2)*3.5), 9.5ft off the
      // lane's centerline — roughly where the low/mid box spots sit on an NBA
      // free-throw lane
      ? { x: rim.x + dir * (4 + Math.floor(lane / 2) * 3.5), y: s.court.centerY + side * 9.5 }
      // the OTHER THREE non-shooters (a full-strength floor is 9 of them for
      // 6 lane spots, so this branch fires on EVERY trip — it is the normal
      // formation, not an edge case; audit L-15 flagged the old "shouldn't
      // happen" note here) wait out past the arc like the real rule requires
      // (only six lane spots may be occupied; everyone else stays behind the
      // three-point line / FT line extended), 26 ft out, fanned wider per
      // extra lane index so they don't overlap
      : { x: rim.x + dir * 26, y: s.court.centerY + side * (6 + lane) };
  }
}

/**
 * Per-tick driver for the `freethrows` phase. Dispatched from `game.ts`'s
 * tick switch every tick while `s.phase.kind === 'freethrows'`. Counts down
 * to the next attempt, resolves it through `freeThrowP`, updates the score,
 * emits the event, and — once the sequence is done (`taken === of`, or a
 * one-and-one front end missed and forfeited the rest) — either returns the
 * ball to the other team (make) or spins up a live-rebound
 * scramble off the rim (miss). Free throws never generate an assist or
 * change shot-clock state; the sequence itself doesn't run the game clock
 * (only made/missed FT dead-ball transitions do, via `deadBall`/`enterScramble`).
 */
export function tickFreeThrows(s: GameState, dt: number): void {
  const ph = s.phase as Extract<Phase, { kind: 'freethrows' }>;
  integrateMovement(s, dt);
  // fatigue accrues here like every other phase handler — this was the sole
  // omission (energy silently froze through every trip to the line);
  // landed with the M1 margin re-sweep (docs/REGISTER.md D4)
  applyFatigue(s, dt);
  ph.nextIn -= dt;
  if (ph.nextIn > 0) return;

  const shooter = agent(s, ph.shooterId);
  const made = s.rng.chance(freeThrowP(s, shooter));
  ph.taken += 1;
  if (made) {
    s.score[ph.side] += 1;
    noteScore(s, ph.side, 1); // unanswered-run tracker (endgame layer)
  }
  emit(s, {
    type: 'free_throw',
    team: ph.side,
    shooter: ph.shooterId,
    n: ph.taken,
    of: ph.of,
    made,
    // stamped only on one-and-one trips: conditional spread (not an
    // always-present false) so every other league's event objects — and
    // therefore the golden fingerprint corpus — stay byte-identical
    ...(ph.oneAndOne ? { oneAndOne: true } : {})
  });

  // A missed one-and-one FRONT END forfeits the second attempt — by rule the
  // ball is live off the rim (NCAA men, data/ncaa/README.md R1). Skipping
  // the "more attempts remain" branch below routes this straight into the
  // sequence-complete miss path: a real rebound scramble, not the dead-ball
  // formality rebound a missed non-final FT would log.
  const frontEndMiss = ph.oneAndOne && !made && ph.taken === 1;

  if (ph.taken < ph.of && !frontEndMiss) {
    if (!made) {
      // The scorekeeping formality real logs print after every missed
      // NON-final free throw: "Offensive rebound by Team". The ball is dead
      // by rule — nobody rebounds anything, the next attempt just proceeds
      // — so the event carries deadBall: true and every stat consumer
      // excludes it from rebound totals (official-scoring convention; see
      // core/events.ts ReboundEvent). Emitted for play-by-play fidelity:
      // its total absence was a Turing-baseline tell.
      const rim = attackedRim(s, ph.side);
      emit(s, {
        type: 'rebound',
        team: ph.side,
        offensive: true,
        deadBall: true,
        x: round1(rim.x),
        y: round1(rim.y)
      });
    }
    // ftBetweenSec between subsequent attempts: shorter than the lead-in
    // since the shooter is already set at the line — just the ritual
    // dribble/pause
    ph.nextIn = s.params.move.ftBetweenSec;
    return;
  }

  // sequence complete (all awarded attempts taken, or a one-and-one front
  // end just missed — in which case `made` is false and the miss branch
  // below hands out the live rebound the rule calls for)
  if (made) {
    endPossession(s, 'made_ft');
    if (s.clock < 1e-6) { endPeriod(s); return; }
    // ftMadeResumeSec: matches the period-opening delay — a made final FT is
    // a clean possession change, no live-ball scramble to resolve first
    deadBall(s, other(ph.side), { clockRuns: false, resumeIn: s.params.move.ftMadeResumeSec });
  } else {
    if (s.clock < 1e-6) { endPeriod(s); return; }
    // live rebound off the miss: ball starts exactly at the rim and lands per
    // the normal miss-landing model, seeded with the pack-derived FT distance
    // (NBA 19 − 5.25 = 13.75 ft) as the "shot distance" input — free-throw
    // misses carom short and predictable, same as any other close shot would.
    // Same derivation as enterFreeThrows' ftDistFt: the hardcoded 13.75 that
    // was fixed there had survived here, silently diverging for any pack
    // whose FT line isn't NBA's (EuroLeague: 13.85).
    const rim = attackedRim(s, ph.side);
    s.ball.pos = { ...rim };
    // FT-miss scramble window (its own cadence fit; resolve.ts
    // sampleScrambleSec 'ft'): a free-throw miss is a shorter, more
    // contained scrum than a live-shot rebound (the lane is already boxed,
    // and the real game clock only starts on the touch, so logged deltas
    // run ~1s faster than FG misses; corpus p50 2s vs 3s)
    enterScramble(s, sampleMissLanding(s, rim, s.rules.ftLineFt - s.rules.rimInsetFt), sampleScrambleSec(s, 'ft'), ph.side);
    onShotReleased(s, ph.side); // trigger crash/get-back off-ball reactions, same as any missed shot
  }
}
