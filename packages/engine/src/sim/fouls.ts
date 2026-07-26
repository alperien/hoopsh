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

import { attackedRim, agent, emit, onCourt, other, type Agent, type GameState, type Phase } from './state.js';
import { freeThrowP, sampleMissLanding } from './resolve.js';
import { checkSubs, replaceFouledOut } from './subs.js';
import { applyFatigue, integrateMovement } from './movement.js';
import { deadBall, endPeriod, endPossession, enterScramble } from './possession.js';
import { onShotReleased } from './ai.js';

export interface FoulOutcome {
  fouledOut: boolean;
  inBonus: boolean;
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
  return { fouledOut, inBonus };
}

// ------------------------------------------------------------- free throws

/**
 * Set up a free-throw sequence: parks the ball dead, switches the phase to
 * `freethrows`, and arranges cosmetic lane positions for everyone else.
 * Called wherever a foul (or and-one) awards free throws — shooting fouls,
 * bonus reach-ins/loose-balls, and-ones. `count` is how many shots (1, 2, or
 * 3 depending on shot value / and-one / bonus rules upstream).
 * Trap: `checkSubs(s, shooter.p.id)` passes the shooter's id as the
 * `protect` argument specifically so the normal fatigue-rotation logic can't
 * yank the free-throw shooter off the floor between the whistle and his shot.
 */
export function enterFreeThrows(s: GameState, shooter: Agent, count: number): void {
  s.ball.holderId = null;
  s.ball.flight = null;
  s.phase = {
    kind: 'freethrows',
    shooterId: shooter.p.id,
    side: shooter.side,
    taken: 0,
    of: count,
    // 1.4s before the first attempt: time to walk to the line and get set —
    // slightly quicker than a full dead-ball delay since the whistle already
    // stopped the action
    nextIn: 1.4,
    lastMade: false
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
      // anyone left over (shouldn't happen with 10 players on court, but
      // covers short-roster edge cases) gets pushed out past the arc, 26ft
      // out, fanned wider per extra lane index so they don't overlap
      : { x: rim.x + dir * 26, y: s.court.centerY + side * (6 + lane) };
  }
}

/**
 * Per-tick driver for the `freethrows` phase. Dispatched from `game.ts`'s
 * tick switch every tick while `s.phase.kind === 'freethrows'`. Counts down
 * to the next attempt, resolves it through `freeThrowP`, updates the score,
 * emits the event, and — once the full sequence (`taken === of`) is done —
 * either returns the ball to the other team (make) or spins up a live-rebound
 * scramble off the rim (miss). Free throws never generate an assist or
 * change shot-clock state; the sequence itself doesn't run the game clock
 * (only made/missed FT dead-ball transitions do, via `deadBall`/`enterScramble`).
 */
export function tickFreeThrows(s: GameState, dt: number): void {
  const ph = s.phase as Extract<Phase, { kind: 'freethrows' }>;
  integrateMovement(s, dt);
  // fatigue accrues here like every other phase handler — this was the sole
  // omission (energy silently froze through every trip to the line);
  // landed with the M1 margin re-sweep (REFACTOR.md D4)
  applyFatigue(s, dt);
  ph.nextIn -= dt;
  if (ph.nextIn > 0) return;

  const shooter = agent(s, ph.shooterId);
  const made = s.rng.chance(freeThrowP(s, shooter));
  ph.taken += 1;
  ph.lastMade = made;
  if (made) s.score[ph.side] += 1;
  emit(s, {
    type: 'free_throw',
    team: ph.side,
    shooter: ph.shooterId,
    n: ph.taken,
    of: ph.of,
    made
  });

  if (ph.taken < ph.of) {
    // 0.9s between subsequent attempts: shorter than the 1.4s lead-in since
    // the shooter is already set at the line — just the ritual dribble/pause
    ph.nextIn = 0.9;
    return;
  }

  // sequence complete
  if (made) {
    endPossession(s, 'made_ft');
    if (s.clock < 1e-6) { endPeriod(s); return; }
    // 1.6s: matches the period-opening delay — a made final FT is a clean
    // possession change, no live-ball scramble to resolve first
    deadBall(s, other(ph.side), { clockRuns: false, resumeIn: 1.6 });
  } else {
    if (s.clock < 1e-6) { endPeriod(s); return; }
    // live rebound off the miss: ball starts exactly at the rim and lands per
    // the normal miss-landing model, seeded with the FT line distance (13.75)
    // as the "shot distance" input — free-throw misses carom short and
    // predictable, same as any other close shot would
    const rim = attackedRim(s, ph.side);
    s.ball.pos = { ...rim };
    // 0.45-0.8s scramble window: a free-throw miss is a shorter, more
    // contained scrum than a live-shot rebound (everyone's already boxed out
    // in the lane) so it resolves a bit faster than a typical miss scramble
    enterScramble(s, sampleMissLanding(s, rim, 13.75), s.rng.range(0.45, 0.8), ph.side);
    onShotReleased(s, ph.side); // trigger crash/get-back off-ball reactions, same as any missed shot
  }
}
