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

import { attackedRim, agent, emit, liveOnCourt, onCourt, other, round1, type Agent, type GameState, type Phase } from './state.js';
import { lerp, type V2 } from '../core/vec.js';
import type { FoulKind, TeamSide } from '../core/events.js';
import { bonusFreeThrowAward, type BonusAward } from '../rules/rulepack.js';
import { freeThrowP, sampleMissLanding, sampleScrambleSec } from './resolve.js';
import { checkSubs, replaceFouledOut } from './subs.js';
import { applyFatigue, integrateMovement } from './movement.js';
import { deadBall, endPeriod, endPossession, enterScramble } from './possession.js';
import { onShotReleased } from './ai.js';
import { maybeFtTimeout, noteScore } from './endgame.js';

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
  /**
   * Technical rider (officiating wave, live at
   * officiating.techPerFoulWhistle 0.017 — 0.71/g REAL, so shipped games
   * carry the occasional non-null): the fouler drew a tech arguing this whistle, and `techFT` is the
   * awarded technical free-throw shooter (highest freeThrow rating on the
   * opposing floor, the real coaching pick). The tech `foul` event was
   * already emitted here; every recordFoul caller must thread a non-null
   * shooter into its next step so the tech FT is shot first, then the
   * interrupted flow resumes (real row order): callers whose foul awards
   * FTs anyway pass `{ pre }` into enterFreeThrows; callers headed for a
   * side-out/inbound dead ball send a technical-only trip with `{ resume }`
   * carrying the exact deadBall arguments they would otherwise pass.
   */
  techFT: Agent | null;
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
  kind: Exclude<FoulKind, 'technical'>,
  drawnBy?: Agent
): FoulOutcome {
  fouler.fouls += 1;
  const side = fouler.side;
  // offensive fouls: personal only (v0.1). A 'take' is an ordinary common
  // foul, same team-foul/bonus arithmetic as a reach (fdesign-officiating
  // §1.5: the label is vocabulary, never a new penalty).
  const countsTeam = kind !== 'offensive';
  if (countsTeam) {
    s.teamFoulsPeriod[side] += 1;
    // the late-window count (NBA last-2:00 penalty): a team foul whistled
    // with the period clock inside rules.lateWindowSec also counts toward
    // the window's own trigger (rulepack.ts bonusFreeThrowAward)
    if (s.rules.lateWindowSec > 0 && s.clock <= s.rules.lateWindowSec) {
      s.teamFoulsLate[side] += 1;
    }
  }
  // the award is looked up AFTER the team-foul bump, so the foul that puts a
  // team at exactly teamFoulBonusAt (or doubleBonusAt) already pays at the
  // new tier — matching how the rule reads ("on the seventh team foul…").
  // Context makes the OT threshold and the late-window penalty live; inBonus
  // is the standing team-penalty state (emitted on every foul event,
  // including offensive fouls that pay nothing themselves).
  const award = bonusFreeThrowAward(s.rules, s.teamFoulsPeriod[side], {
    isOT: s.period > s.rules.periods,
    lateWindowFouls: s.teamFoulsLate[side],
    clockSec: s.clock
  });
  const inBonus = award !== null;
  const bonus = countsTeam ? award : null;
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

  // Technical foul (officiating wave, fdesign-officiating §1.4, live at
  // techPerFoulWhistle 0.017 — 0.71/g REAL; the rate gate still runs
  // before the draw, so a zeroed rate leaves the rng stream
  // untouched). V1 models the dominant real
  // trigger only, after-foul frustration (42% of corpus techs): the fouler
  // argues the whistle he just got. The tech is not a personal in NBA
  // accounting: every count below is a stamped snapshot, nothing
  // increments, `fouledOut` is always false (stats/box.ts excludes kind
  // 'technical' from pf on the same convention). Draw order at this site is
  // fixed: exactly one chance() after the foul-out replacement.
  let techFT: Agent | null = null;
  const O = s.params.officiating;
  if (O.techPerFoulWhistle > 0 && s.rng.chance(O.techPerFoulWhistle)) {
    emit(s, {
      type: 'foul',
      team: side,
      on: fouler.p.id,
      kind: 'technical',
      personalCount: fouler.fouls, // unchanged; snapshot, not an increment
      teamCountInPeriod: s.teamFoulsPeriod[side], // unchanged
      inBonus,
      fouledOut: false // a tech never disqualifies in this model
    });
    // the real coaching pick: best free-throw shooter on the floor for the
    // side the tech was called against (the fouler's opponents). Falls back
    // through onCourt only in the bench-exhausted degenerate state.
    const shooters = liveOnCourt(s, other(side));
    const eligible = shooters.length > 0 ? shooters : onCourt(s, other(side));
    techFT = eligible.reduce((m, a) => (a.p.attr.freeThrow > m.p.attr.freeThrow ? a : m));
  }
  return { fouledOut, inBonus, bonus, techFT };
}

// ------------------------------------------------------------- free throws

/**
 * The trip's line spot — where the shooter sets up and where the ball ends
 * up — plus the rim/direction pair the lane formation builds from. The
 * free-throw-line-to-rim-center distance is derived from the rule pack
 * (NBA: 19 − 5.25 = 13.75 ft) — was a hardcoded 13.75 that silently
 * diverged from any custom pack's ftLineFt/rimInsetFt. One derivation,
 * shared by trip entry and the tick carry (#82 C1), so the carry's arrival
 * write lands on coordinates bit-identical to the spot entry aimed
 * everyone at. Rim/side/rules never change mid-trip, so entry-time and
 * tick-time calls return identical values.
 */
function ftLineSpot(s: GameState, side: TeamSide): { rim: V2; dir: number; ftSpot: V2 } {
  const rim = attackedRim(s, side);
  const dir = rim.x > s.court.midX ? -1 : 1;
  const ftDistFt = s.rules.ftLineFt - s.rules.rimInsetFt;
  return { rim, dir, ftSpot: { x: rim.x + dir * ftDistFt, y: s.court.centerY } };
}

/**
 * Set up a free-throw sequence: parks the ball dead, switches the phase to
 * `freethrows`, and arranges cosmetic lane positions for everyone else.
 * Called wherever a foul (or and-one) awards free throws — shooting fouls,
 * bonus reach-ins/loose-balls, and-ones. `count` is how many shots (1, 2, or
 * 3 depending on shot value / and-one / bonus rules upstream). `oneAndOne`
 * marks the trip as an NCAA-style one-and-one (count is the POTENTIAL 2;
 * tickFreeThrows ends the trip with a live ball if the front end misses) —
 * bonus callers pass it straight from FoulOutcome.bonus.
 *
 * `tech` (officiating wave; passed exactly when FoulOutcome.techFT is
 * non-null, which the live officiating.techPerFoulWhistle 0.017 makes a
 * ~0.71/g occurrence in shipped games) arranges the technical free
 * throw in one of two mutually exclusive shapes:
 *  - `pre`: this is a normal FT trip whose whistle also drew a tech. The
 *    tech shooter's single attempt is shot first (n:1 of:1 technical:true,
 *    no rebound on a miss), then the trip runs unchanged.
 *  - `resume`: the trip is the technical (the foul awarded nothing itself:
 *    side-out / charge flows). `shooter` is the tech shooter, `count`
 *    must be 1, and on completion tickFreeThrows re-enters `deadBall` with
 *    exactly these arguments instead of ending the possession, so the
 *    pre-whistle flow resumes byte-identically to the no-tech path.
 *
 * Trap: `checkSubs(s, shooter.p.id)` passes the shooter's id as the
 * `protect` argument specifically so the normal fatigue-rotation logic can't
 * yank the free-throw shooter off the floor between the whistle and his shot.
 * A `pre` tech shooter is not protected; tickFreeThrows re-picks from the
 * live floor at shot time if the sub window moved him.
 */
export function enterFreeThrows(
  s: GameState,
  shooter: Agent,
  count: number,
  oneAndOne = false,
  tech?: {
    pre?: string;
    resume?: { nextTeam: TeamSide; continuation: boolean; resumeIn: number };
  }
): void {
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
    // #82 C1 — the carry pair: where the whistle caught the ball, and the
    // entry stamp on the WALL axis (the ritual exists only there; see the
    // field docs in state.ts). tickFreeThrows walks the ball spot→line
    // across the ftSetupSec lead-in instead of the entry snap this replaces.
    carryFrom: { x: s.ball.pos.x, y: s.ball.pos.y },
    carryT0: s.wallT,
    oneAndOne,
    // conditional spread, the oneAndOne byte-discipline pattern: a no-tech
    // trip's phase object (and everything downstream) is shaped exactly as
    // before
    ...(tech?.pre ? { pre: { shooterId: tech.pre } } : {}),
    ...(tech?.resume ? { resume: tech.resume } : {})
  };
  // FT-whistle timeout site (fdesign-timeouts §1.2.2; the structural miss
  // ffit-timeouts §5.1 names): 17.5% of real timeouts ride foul whistles,
  // logged before the FTs. One evaluation per trip, at entry, before the
  // sub pass (checkSubs reads phase.timeout, the §4 handshake). Live since
  // the FLOW flip at the shipped to* values: the site decides mandatory
  // anchors and hazard calls for real.
  maybeFtTimeout(s);
  // Between-FT sub grammar (ffit-rotations §3.2): at ftGapSubMode 3 the
  // trip-entry pass is urgent-only (a fouler in trouble still leaves at the
  // whistle) and the routine rotation moves to the between-attempts slot in
  // tickFreeThrows, where real logs place FT-window subs (14.2/g strictly
  // between attempts). Left here, trip entry harvests every pending swap
  // before the first free_throw row and the gap slot has nothing to host.
  // Legacy modes (STAGED 0-2) keep the full pass at entry.
  if (s.params.sub.ftGapSubMode >= 3) {
    checkSubs(s, shooter.p.id, { urgentOnly: true });
  } else {
    checkSubs(s, shooter.p.id); // never sub out the man headed to the line
  }
  // cosmetic positioning around the key — none of this affects the free-throw
  // probability model (that's purely rating-based in resolve.ts), it's just
  // so the replay doesn't show players standing wherever the whistle caught them
  const { rim, dir, ftSpot } = ftLineSpot(s, shooter.side);
  shooter.target = ftSpot;
  // The ball is deliberately NOT snapped to the line here. The old entry
  // snap (added so the ball didn't sit a median 14 ft from the shooter all
  // ritual) was itself the frame stream's largest teleport class — issue
  // #82: 25.4 foul-crossing single-frame ball jumps/g, p50 13.9 ft, max
  // ~75 ft on backcourt whistles. tickFreeThrows now carries the ball
  // whistle-spot→line across the same ftSetupSec lead-in, via the
  // carryFrom/carryT0 pair stamped on the phase above. No probability
  // model reads ball.pos in this phase (frames/viewer only) — that is
  // what keeps the carry frames-only.
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
  // a technical prefix shooter walks to the line too (cosmetic; the lane
  // loop above parked him on a box spot; the FT model reads no positions)
  if (tech?.pre) {
    const p = s.agents.get(tech.pre);
    if (p) p.target = { ...ftSpot };
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
  // #82 C1 — the ball walks to the line instead of teleporting there: lerp
  // whistle-spot→line across the ftSetupSec lead-in, then hold the spot for
  // the rest of the ritual (the between-attempts park the old entry snap
  // provided). Keyed on wallT, NEVER game-clock t: the clock is frozen
  // through the ritual, so a t-keyed lerp would freeze at zero (the AGENTS
  // §1.5 trap — this is F1's carry shape from game.ts on the opposite
  // axis). Worst case is a ~75 ft backcourt whistle: ~53 ft/s across the
  // 1.4 s lead-in, a relay at pass speed, replacing a ~370 ft/s
  // single-frame snap. The arrival write is the byte-exact { ...ftSpot }
  // and is ALSO gated on the attempt's own predicate (nextIn <= 0), so in
  // every float outcome the ball sits exactly on the spot at or before the
  // first attempt — technical prefixes fire on the same countdown, so they
  // are covered — and every downstream hand-off (miss rim seed, made-FT
  // dead ball, technical resume) reads exactly the position the old snap
  // produced. A timeout huddle at entry stretches nextIn, never the carry
  // window: the ball arrives early and waits out the huddle at the line.
  if (ph.carryFrom !== undefined && ph.carryT0 !== undefined) {
    const { ftSpot } = ftLineSpot(s, ph.side);
    const dur = s.params.move.ftSetupSec;
    const elapsed = s.wallT - ph.carryT0;
    s.ball.pos = elapsed >= dur || ph.nextIn <= 0
      ? { ...ftSpot }
      : lerp(ph.carryFrom, ftSpot, elapsed / dur);
  }
  if (ph.nextIn > 0) return;

  // Technical prefix attempt (officiating wave; runs when a tech rider was
  // passed into enterFreeThrows — live at techPerFoulWhistle 0.017, so
  // shipped games shoot ~0.71 of these a game): shot first, before the
  // main trip's sequence. By rule the ball is dead: a
  // miss produces no rebound of any kind (not even the formality row) and
  // the attempt has no possession effects; the main trip then runs
  // unchanged (`taken` untouched).
  if (ph.pre) {
    let tShooter = agent(s, ph.pre.shooterId);
    if (!tShooter.onCourt || tShooter.fouledOut) {
      // the whistle's sub window moved the picked shooter; the coach hands
      // the tech FT to the best live free-throw shooter still out there
      // (deterministic re-pick, no rng; keeps the no-off-court-actor
      // invariant airtight)
      const live = liveOnCourt(s, ph.side);
      const eligible = live.length > 0 ? live : onCourt(s, ph.side);
      tShooter = eligible.reduce((m, a) => (a.p.attr.freeThrow > m.p.attr.freeThrow ? a : m));
    }
    const techMade = s.rng.chance(freeThrowP(s, tShooter));
    if (techMade) {
      s.score[ph.side] += 1;
      noteScore(s, ph.side, 1); // unanswered-run tracker (endgame layer)
    }
    emit(s, {
      type: 'free_throw',
      team: ph.side,
      shooter: tShooter.p.id,
      n: 1,
      of: 1,
      made: techMade,
      technical: true
    });
    ph.pre = undefined;
    // 0.9s to the main trip's first attempt: the lane is already set, same
    // beat as between ordinary attempts
    ph.nextIn = 0.9;
    return;
  }

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
    ...(ph.oneAndOne ? { oneAndOne: true } : {}),
    // a technical-only trip's attempts carry the technical stamp (same
    // conditional-spread byte discipline); prefix techs are stamped at
    // their own emit above
    ...(ph.resume ? { technical: true } : {})
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
    // The between-attempts sub slot (fdesign-rotations §2.5; subs.ts staged
    // the urgentOnly option for exactly this caller). Real subs walk in
    // during FT administration: 33.8% of corpus subs ride FT windows.
    // Mode 1 = urgentOnly (foul-trouble/concede only, the design default);
    // modes 2/3 = the full rotation pass (with the post-make window closed
    // this becomes the routine host). The shooter stays protected. The pass
    // is rng-free, so a no-sub gap leaves the stream untouched. STAGED 0 =
    // no call, byte-identical.
    if (s.params.sub.ftGapSubMode > 0) {
      checkSubs(s, ph.shooterId,
        s.params.sub.ftGapSubMode === 1 ? { urgentOnly: true } : undefined);
    }
    // ftBetweenSec between subsequent attempts: shorter than the lead-in
    // since the shooter is already set at the line — just the ritual
    // dribble/pause
    ph.nextIn = s.params.move.ftBetweenSec;
    return;
  }

  // Technical-only trip complete (officiating wave): the possession was
  // never in question. No possession_end, no live rebound on a miss (the
  // ball is dead by rule); the interrupted flow simply resumes through the
  // exact deadBall call the no-tech path would have made at the whistle.
  if (ph.resume) {
    deadBall(s, ph.resume.nextTeam, {
      clockRuns: false,
      continuation: ph.resume.continuation,
      resumeIn: ph.resume.resumeIn
    });
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
