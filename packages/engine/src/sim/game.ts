/**
 * The game orchestrator: tick pipeline, phase machine, live-ball decision
 * loop, and the event/frame recorders. Possession/foul/shot/pass mechanics
 * live in the sibling sim modules; this file wires them together.
 */

import { makeCourt } from '../geometry/court.js';
import { NBA, type RulePack } from '../rules/rulepack.js';
import type { Team } from '../model/player.js';
import type { GameEvent, ShotMoveType, TeamSide } from '../core/events.js';
import { defaultParams, withParams, type SimParams } from './params.js';
import {
  agent, attackedRim, emit, liveOnCourt, round1,
  type Agent, type GameState
} from './state.js';
import { Rng } from '../core/rng.js';
import { add, dist, len, lerp, norm, scale, sub } from '../core/vec.js';
import {
  decideBall, defenseTick, midPullUpLight, offenseOffBallTick, type BallAction
} from './ai.js';
import { contestAt, defendersBack } from './resolve.js';
import {
  bestHandler, deadBall, endPeriod, endPossession, giveBall, setupDeadTargets,
  tickDead, tickScramble, tipWeightedWinner
} from './possession.js';
import { enterFreeThrows, recordFoul, tickFreeThrows } from './fouls.js';
import { hurriedness } from './endgame.js';
import { resolveShotOutcome, startShot, windupSec } from './shooting.js';
import { attemptReachIn, resolvePassArrival, startPass } from './passing.js';
import { advanceClock, applyFatigue, integrateMovement } from './movement.js';
import { other } from './state.js';

export interface GameConfig {
  seed: string | number;
  home: Team;
  away: Team;
  rules?: RulePack;
  params?: Parameters<typeof withParams>[0];
  collectFrames?: boolean;
  /**
   * DIAGNOSTICS ONLY: override the tick-loop safety cap (default: 4× the
   * longest legal game). The cap exists to catch engine bugs — a game that
   * hits it throws rather than returning a fake result — and this override
   * exists so tests can prove that behavior without simulating for hours.
   */
  safetyCapTicks?: number;
  /**
   * ENDGAME LAYER feature flag (default ON). On, late-game basketball
   * behaviors activate: clock-kill with a lead, trailing hurry-up and
   * intentional fouling, hold-for-one / 2-for-1 period endings, and team
   * timeouts (which add a `timeout` event type to the stream). All of it is
   * EV/urgency modulation inside the existing decision framework — see
   * sim/ai/concepts.ts (concept 6) and sim/endgame.ts; constants in
   * params.endgame (magnitude dials sweepable, harness/knobs.ts).
   *
   * Default flipped OFF→ON on the n=1260-games-per-arm, 3-seed-base survey
   * (endgame-flag report): the layer closes the sim's worst clutch-realism
   * gaps — OT share 2.06%→3.33% toward the real 4.80%, clutch FT share
   * into the real 30-50% range, Q4 10+-lead comebacks 0%→5% (real ~5-10%),
   * the foul game and timeouts existing at all — with every invariant
   * probe green at 20 seeds and 1,260 games. Expect ON games to shift
   * league texture late (more FTs, longer leading-team possessions, more
   * stoppages): that is the point. Explicit `endgame: false` remains the
   * byte-identical pre-layer path (the layer then runs no code and
   * consumes no rng).
   */
  endgame?: boolean;
  /**
   * Input-contract tier. 'finite' (default) rejects only non-finite ratings,
   * measurements, and tactics — out-of-range finite values are legal (custom
   * content, stress tests; a 999 just saturates the curves). 'strict'
   * additionally enforces the @hoopsh/data pack contract: ratings 0-100,
   * heightIn 60-96, tactics 0-100.
   * Use 'strict' when rosters come from untrusted or hand-edited sources and
   * you want "valid but unusual" formally separated from "invalid".
   */
  validate?: 'finite' | 'strict';
}

export interface GameResult {
  seed: string;
  events: GameEvent[];
  finalScore: [number, number];
  frames: number[][];
  rules: RulePack;
  params: SimParams;
  teams: [Team, Team];
}

// ------------------------------------------------------------------ set-up

function validateTeam(team: Team): void {
  if (team.starters.length !== 5) throw new Error(`${team.id}: needs exactly 5 starters`);
  // duplicate STARTER ids pass every other check here yet put the same body
  // in two lineup slots: the game runs 4-on-5 to a normal-looking result
  // (same silent-corruption class as the NaN incident — see
  // assertValidRatings). The lineup array double-counts the duplicated
  // player's seconds while box.ts folds lineup slots through a Set, so
  // ["a","a","b","c","d"] silently broke the 240-minute invariant
  // (192-minute team sums, a phantom lineup slot) with the game otherwise
  // "working". Mirrors data/src/schema.ts's starters check — the pack layer
  // rejects this too, but the engine boundary accepts raw Team objects from
  // any caller and direct-API callers never pass through roster:validate
  // (c4-F5). Two identical copies of this guard once lived in this function
  // (the second was unreachable); their incident notes are merged here.
  if (new Set(team.starters).size !== team.starters.length) {
    throw new Error(`${team.id}: duplicate starter ids`);
  }
  for (const id of team.starters) {
    if (!team.players.some((p) => p.id === id)) {
      throw new Error(`${team.id}: starter ${id} not on roster`);
    }
  }
  const ids = new Set(team.players.map((p) => p.id));
  if (ids.size !== team.players.length) throw new Error(`${team.id}: duplicate player ids`);
}

function validateTeams(home: Team, away: Team): void {
  validateTeam(home);
  validateTeam(away);
  // ids must be unique across the UNION of both rosters, not just within
  // each: one agents Map serves both sides, keyed by player id, so a
  // cross-team collision made mkAgents(away) silently overwrite the home
  // agent — the game ran to a garbage result (0-120 finals, 288-minute team
  // box sums) with no warning. No upstream layer can catch this (the roster
  // validator sees one pack at a time), so the check lives at the boundary.
  const homeIds = new Set(home.players.map((p) => p.id));
  for (const p of away.players) {
    if (homeIds.has(p.id)) {
      throw new Error(`duplicate player id across teams: ${p.id} (${home.id} vs ${away.id})`);
    }
  }
}

function initState(cfg: GameConfig): GameState {
  validateTeams(cfg.home, cfg.away);
  const rules = cfg.rules ?? NBA;
  const params = cfg.params ? withParams(cfg.params) : structuredClone(defaultParams);
  const rng = new Rng(cfg.seed);
  const court = makeCourt(rules);

  const agents = new Map<string, Agent>();
  const mkAgents = (team: Team, side: TeamSide) => {
    for (const p of team.players) {
      agents.set(p.id, {
        p,
        side,
        pos: {
          x: court.midX + rng.range(-8, 8),
          y: side === 0 ? rng.range(4, 20) : rng.range(court.width - 20, court.width - 4)
        },
        vel: { x: 0, y: 0 },
        energy: 100,
        load: 0,
        secondsPlayed: 0,
        fouls: 0,
        onCourt: false,
        fouledOut: false,
        lastSwapT: 0,
        target: { x: court.midX, y: court.centerY },
        intent: 'freeze',
        sprinting: false,
        spotKey: null,
        manId: null,
        dribblesSinceCatch: 0,
        dribbleAcc: 0,
        catchT: -99,
        acquiredBy: 'deadball',
        catchQuality: 0,
        usedPoss: 0,
        teamPossOnCourt: 0,
        driveUntil: -99,
        cutUntil: -99,
        relocUntil: -99,
        screenStunUntil: -99,
        navUnderUntil: -99
      });
    }
  };
  mkAgents(cfg.home, 0);
  mkAgents(cfg.away, 1);

  const lineup: [string[], string[]] = [[...cfg.home.starters], [...cfg.away.starters]];
  for (const side of [0, 1] as TeamSide[]) {
    for (const id of lineup[side]) {
      const a = agents.get(id);
      if (a) a.onCourt = true;
    }
  }

  const s: GameState = {
    rng,
    params,
    rules,
    court,
    teams: [cfg.home, cfg.away],
    agents,
    lineup,
    ball: { holderId: null, pos: { x: court.midX, y: court.centerY }, flight: null },
    period: 1,
    clock: rules.periodMinutes * 60,
    t: 0,
    wallT: 0,
    score: [0, 0],
    teamFoulsPeriod: [0, 0],
    teamFoulsLate: [0, 0],
    tipWinner: 0,
    // default ON per the n=1260/arm flag-on survey — see GameConfig.endgame
    endgame: cfg.endgame ?? true,
    timeoutsLeft: [rules.timeoutsPerGame, rules.timeoutsPerGame],
    runPts: [0, 0],
    // timeout-economy bookkeeping (state.ts doc): upkeep always, staged consumers
    timeoutsThisPeriod: [0, 0],
    timeoutsUsedFinalPeriod: [0, 0],
    timeoutsUsedFinalLate: [0, 0],
    lastTimeoutT: [-99, -99],
    conceded: [false, false],
    poss: {
      team: 0,
      shotClock: rules.shotClockSec,
      phase: 'advance',
      startT: 0,
      kind: 'tip',
      leakArmed: false,
      carryArmed: false,
      // pre-tip placeholder; the tip possession itself is stamped by
      // startPossession like every period start
      opener: false,
      lastPass: null,
      spotMap: new Map(),
      spots: new Map(),
      action: null,
      ended: false
    },
    // PLACEHOLDER phase — simulateGame replaces it wholesale (with the real
    // opening delay and the actual tip winner) before the first tick ever
    // runs, so the values here are never ticked; the field just cannot be
    // null (audit L-02: the old 0.6 here read like a tuned opening delay)
    phase: { kind: 'dead', resumeIn: 0, clockRuns: false, nextTeam: 0, possKind: 'tip' },
    events: [],
    frames: [],
    collectFrames: cfg.collectFrames ?? true,
    decisionAt: 0,
    pendingRelease: null,
    over: false
  };
  return s;
}

// ------------------------------------------------------------------ ticker

function tick(s: GameState, dt: number): void {
  // the wall clock advances on EVERY tick — stoppages included — so replays
  // capture free-throw rituals and dead-ball repositioning instead of
  // compressing them into teleports (game-clock t advances via advanceClock)
  s.wallT += dt;
  switch (s.phase.kind) {
    case 'live': tickLive(s, dt); break;
    case 'dead': tickDead(s, dt); break;
    case 'freethrows': tickFreeThrows(s, dt); break;
    case 'scramble': tickScramble(s, dt); break;
  }
  recordFrame(s);
}

/**
 * The live-ball tick. Stage numbers below match docs/INTERNALS.md's
 * "tickLive, in order" diagram (file and doc cross-reference each other);
 * most stages can end the tick with an early `return`.
 */
function tickLive(s: GameState, dt: number): void {
  advanceClock(s, dt); // 1. game clock (stops at the horn)

  // 2. ball in flight?
  const f = s.ball.flight;
  if (f) {
    f.remaining -= dt;
    s.ball.pos = lerp(f.to, f.from, Math.max(0, f.remaining) / f.total);
    // the shot clock runs during PASS flights — only a released shot freezes
    // it (the rule stated below). Freezing both flight kinds granted the
    // offense every pass's flight time for free: whistle-free possessions
    // measured up to ~31s under the 24s clock. An expiry mid-flight is
    // whistled at the existing check on the first tick after arrival.
    if (f.kind === 'pass') s.poss.shotClock -= dt;
    integrateMovement(s, dt);
    applyFatigue(s, dt);
    if (f.remaining <= 0) {
      if (f.kind === 'shot') resolveShotOutcome(s, f.shot!);
      else resolvePassArrival(s);
    }
    return;
  }

  // 3. period expiry with ball live — checked BEFORE the shot-clock violation:
  // when both clocks cross zero on the same tick, the horn ends the period
  // (the real rule — an expired game clock supersedes the shot clock), where
  // the old order charged a phantom shot-clock turnover at 0:00 and played a
  // post-buzzer inbound before the period could end
  if (s.clock < 1e-6) { endPeriod(s); return; }

  // 4. shot clock (frozen while a shot is airborne, running otherwise)
  s.poss.shotClock -= dt;
  if (s.poss.shotClock <= 0) {
    const holder = s.ball.holderId ? agent(s, s.ball.holderId) : bestHandler(s, s.poss.team);
    emit(s, {
      type: 'turnover', team: s.poss.team, player: holder.p.id, kind: 'shot_clock'
    });
    endPossession(s, 'turnover');
    deadBall(s, other(s.poss.team), { clockRuns: false });
    return;
  }

  const holderId = s.ball.holderId;
  if (!holderId) {
    // shouldn't happen in live phase; recover gracefully
    giveBall(s, bestHandler(s, s.poss.team), 'deadball');
    return;
  }
  const h = agent(s, holderId);

  // 5. shot windup in progress: defenders close out, then the ball goes up
  const pr = s.pendingRelease;
  if (pr && pr.shooterId === holderId) {
    offenseOffBallTick(s);
    defenseTick(s);
    integrateMovement(s, dt);
    applyFatigue(s, dt);
    if (pr.carryRim && pr.carryFrom !== undefined && pr.carryT0 !== undefined) {
      // #74 F1 amendment — the carried gather's honest ball path: the
      // ball extends from the gather spot to the rim across the windup
      // instead of riding a body that passes the plane and keeps sliding
      // (measured at scale 1: every gated carry brings the body within
      // 4.35 ft of the rim mid-windup, but the release-tick body sits
      // p50 4.87 / max 9.95 ft past-or-beside it). The lerp makes the
      // rim-plane booking CONTINUOUS — the ball is already at the hoop
      // when the shot books — and the defense reads the honest ball
      // (closeouts converge on the finish, not the fly-by; contest at
      // release still prices off the body per the approved sketch).
      // Both stamps are game-clock t, the releaseAt axis — never wallT.
      const dur = pr.releaseAt - pr.carryT0;
      const raw = dur > 0 ? (s.t - pr.carryT0) / dur : 1;
      const f = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      s.ball.pos = lerp(pr.carryFrom, attackedRim(s, h.side), f);
    } else {
      s.ball.pos = { x: h.pos.x, y: h.pos.y };
    }
    if (s.t >= pr.releaseAt) {
      s.pendingRelease = null;
      startShot(s, h, pr.moveType, pr.contest0, pr.carryRim);
    }
    return;
  }
  if (pr) s.pendingRelease = null; // stale windup (ball changed hands)

  // 6. possession phase transitions — both ARRIVAL-based, not clock-based
  // (a fixed 4.5s transition window expired mid-floor once the jog economy
  // slowed the getback, and the downhill archetype lost its drive window)
  const rim = attackedRim(s, h.side);
  if (s.poss.phase === 'advance' && dist(h.pos, rim) < s.params.move.advancePickupFt) {
    // the logo pickup (move.advancePickupFt, ~36 ft) — offense initiates
    // there, not at the arc (32 ft left 54% of the downhill benchmark's
    // decisions inside the drive-gated advance phase after the jog economy;
    // main had 36%)
    s.poss.phase = 'halfcourt';
  } else if (s.poss.phase === 'transition') {
    // transition ends when the DEFENSE IS SET: transSetBackCount+ defenders
    // inside transBackRadiusFt of the rim they protect (the same arrival
    // principle as the advance flip — shared definition in resolve.ts
    // defendersBack, also read by the decision layer's transition
    // continuation cut); transitionMaxSec is the chaos-state safety cap
    if (
      defendersBack(s, h.side) >= s.params.move.transSetBackCount ||
      s.t - s.poss.startT > s.params.move.transitionMaxSec
    ) {
      s.poss.phase = 'halfcourt';
    }
  }

  // 7. holder movement intent
  const holderAct = s.poss.action;
  const backingDown =
    holderAct?.kind === 'post' && holderAct.posterId === h.p.id && holderAct.phase === 'working';
  const walkingToBlock =
    holderAct?.kind === 'post' && holderAct.posterId === h.p.id &&
    holderAct.phase === 'posting' && holderAct.feederId === holderAct.posterId;
  if (walkingToBlock) {
    // self-post: dribble down to the block at a walk — the target was set by
    // the action call; actionTick flips to 'working' on arrival
    h.intent = 'spot';
    h.sprinting = false;
  } else if (backingDown) {
    // the backdown: slow power dribbles carve toward the rim — this is what
    // turns the ~8 ft entry catch into a ~4 ft finish (without it the post
    // was a passing station that never scored: 0.1 post shots/game). Creep
    // speed comes from the short target leash (~1.5 ft/s), and the advance
    // stops at the restricted-area edge.
    const dRim = dist(h.pos, rim);
    if (dRim > s.params.ai.backdownStopFt) {
      const step = scale(norm(sub(rim, h.pos)), s.params.ai.backdownStepFt);
      h.target = add(h.pos, step);
    } else {
      h.target = { ...h.pos };
    }
    h.intent = 'spot';
    h.sprinting = false;
  } else if (s.t < h.driveUntil) {
    h.intent = 'drive';
    h.target = rim;
    h.sprinting = true;
  } else if (s.poss.phase !== 'halfcourt') {
    h.intent = 'advance';
    const dir = rim.x > s.court.midX ? -1 : 1;
    // stable target — regenerating it with jitter every tick made the
    // handler visibly vibrate while bringing the ball up
    h.target = { x: rim.x + dir * 26, y: s.court.centerY };
    // endgame hurry (flag-gated): a chasing team SPRINTS the ball up — the
    // dribble-jog walk-up costs seconds it no longer has (sim/endgame.ts)
    h.sprinting = s.poss.phase === 'transition' ||
      (s.endgame && hurriedness(s, h.side) >= s.params.endgame.hurrySprintMin);
  } else {
    h.intent = 'spot';
    h.sprinting = false;
    // hold position and survey — repositioning comes from drive/pass decisions
    h.target = h.pos;
  }

  // 8. dribble accounting (for assist windows)
  if (len(h.vel) > s.params.move.dribbleSpeedFtS) {
    h.dribbleAcc += dt;
    if (h.dribbleAcc >= s.params.move.dribbleSec) {
      h.dribbleAcc = 0;
      h.dribblesSinceCatch += 1;
    }
  }

  // 9. decisions: decideBall -> executeAction at each decision window
  if (s.t >= s.decisionAt) {
    const action = decideBall(s);
    const scheduledBefore = s.decisionAt;
    executeAction(s, h, action);
    if (s.phase.kind !== 'live') return; // action may have changed phase
    // executeAction may schedule its own re-decision window (a drive's quick
    // finish-or-kick check). Only apply the generic cadence when it didn't:
    // the unconditional overwrite made the drive window a dead store for the
    // code's whole history — every drive re-decided on the 0.49-0.85s
    // default instead of the designed 0.5s (scan a1).
    if (s.decisionAt === scheduledBefore) {
      const D = s.params.decide;
      s.decisionAt = s.t + D.intervalSec * s.rng.range(D.intervalJitterLo, D.intervalJitterHi);
    }
  }

  // a shot/pass just went airborne: keep crash/box-out intents, skip brains
  if (s.ball.flight) {
    integrateMovement(s, dt);
    applyFatigue(s, dt);
    return;
  }

  // 10. reach-in steals
  attemptReachIn(s, dt);
  if (s.phase.kind !== 'live') return;

  // 11. charge check while driving — turnover first, THEN the foul: recordFoul
  // may foul the driver out and emit his replacement sub, and the turnover
  // must not appear to be committed by a player already off the floor
  if (s.t < h.driveUntil && s.rng.chance(s.params.foul.chargePerDrive * dt * s.params.foul.chargeTickMult)) {
    emit(s, {
      type: 'turnover', team: h.side, player: h.p.id, kind: 'off_foul'
    });
    const { techFT } = recordFoul(s, h, 'offensive');
    endPossession(s, 'turnover');
    if (techFT) {
      // technical rider on the charge (officiating wave, staged-inert,
      // fouls.ts): the defense shoots the tech first, then the same inbound
      // dead ball runs from tickFreeThrows via resume (1.8s default delay,
      // matching the no-tech deadBall below)
      enterFreeThrows(s, techFT, 1, false, {
        resume: { nextTeam: other(h.side), continuation: false, resumeIn: 1.8 }
      });
      return;
    }
    deadBall(s, other(h.side), { clockRuns: false });
    return;
  }

  // Traveling (officiating wave, fdesign-officiating §1.3, live at the
  // shipped travelPer*Sec rates — 1.05/g REAL total, rate gate before the
  // draw): a sibling hazard
  // to the charge, drawing only on attacking ticks. Committed drive time
  // rolls travelPerDriveSec·dt, post-backdown time rolls travelPerPostSec·dt
  // (same per-second × dt shape as chargePerDrive; ≤1 roll per attacking
  // tick, and the charge roll above keeps stream priority). A travel is a
  // violation, not a foul: dead-ball turnover, no PF, no team foul, never a
  // steal. It is the arc's main repair of the dead-turnover deficit. The
  // dead ball is flagged reviewable ('oob'; a shuffle at the gather is the
  // same close boundary call).
  {
    const O = s.params.officiating;
    const travelRate = s.t < h.driveUntil
      ? O.travelPerDriveSec
      : backingDown ? O.travelPerPostSec : 0;
    if (travelRate > 0 && s.rng.chance(travelRate * dt)) {
      emit(s, {
        type: 'turnover', team: h.side, player: h.p.id, kind: 'travel'
      });
      endPossession(s, 'turnover');
      deadBall(s, other(h.side), { clockRuns: false, reviewable: 'oob' });
      return;
    }
  }

  // 12. off-ball brains, then physics: movement integration + fatigue
  offenseOffBallTick(s);
  defenseTick(s);
  integrateMovement(s, dt);
  applyFatigue(s, dt);

  // ball follows holder
  s.ball.pos = { x: h.pos.x, y: h.pos.y };
}

/**
 * #74: does this committed drive finish carry to a rim-plane release?
 * The transition carry's full gate in short-circuit order: the stage
 * switch (transCarryScale, checked FIRST — the staged-zero contract),
 * the possession's arming draw (carryArmed, rolled in startPossession),
 * the label (only 'drive' finishes), the live commit window
 * (driveUntil), the phase, the beaten retreat, and the F1 gather gate
 * (the carry's own reach — params.ai.transCarryGatherFt). Pure read: no
 * rng, no writes, no side effects on GameState. Called from
 * executeAction's shoot branch at decide time; exported so
 * transcarry.test.ts can pin it condition-by-condition on hand-built
 * states (probe F2: phase is not in the event stream and the
 * scope-guard buckets by possession START kind, so a within-possession
 * gate regression is invisible to every stream-side test).
 */
export function carriesToRim(s: GameState, h: Agent, moveType: ShotMoveType): boolean {
  return (
    s.params.ai.transCarryScale > 0 &&
    s.poss.carryArmed &&
    moveType === 'drive' &&
    s.t < h.driveUntil &&
    s.poss.phase === 'transition' &&
    defendersBack(s, h.side) < s.params.move.transSetBackCount &&
    dist(h.pos, attackedRim(s, h.side)) <= s.params.ai.transCarryGatherFt
  );
}

function executeAction(s: GameState, h: Agent, action: BallAction): void {
  switch (action.kind) {
    case 'shoot':
      // enter the windup: defenders get windupSec to close out before the
      // contest is measured at release. This race IS shot defense.
      s.pendingRelease = {
        shooterId: h.p.id,
        moveType: action.moveType,
        releaseAt: s.t + windupSec(s, action.moveType),
        contest0: contestAt(s, h, h.pos).level
      };
      // THE TRANSITION CARRY (#74, unassisted-creation arc increment 1): a
      // committed drive finish on a beaten break CARRIES to a rim-plane
      // release by construction. Everything about the decision is
      // unchanged — same re-read cadence, same commit expiry, same 'drive'
      // label, same windup race, same make model — but the body keeps
      // carrying at the rim through the windup and the RELEASE point is
      // the plane itself (startShot, carryRim). The #74 probe measured the
      // deficit as pure release geometry (beaten-break finishes at median
      // 4.8 ft against the booth's 2.25 ft book boundary, 0-8% at the
      // plane, while plane releases convert at 59-67%), and instrumenting
      // this branch localized the artifact one level deeper: decide-time
      // rim distances on these finishes read 0.2-3.9 ft, so the
      // behind-plane release IS the sprinting body's stopping distance —
      // a 16 ft/s carry slides 4-6 ft during the 0.45 s windup whatever
      // the steering target says, and no movement shape can land the
      // plane. The 0.45 s is the windupDrive param; the effective windup
      // is 0.50 s on every released carry, the param tick-quantized to
      // the next 0.1 s boundary. The finish's extension at the rim has
      // to be constructed,
      // exactly as the approved sketch words it. The CONTEST still reads
      // off the body at release (startShot), so a carry into traffic
      // prices as the heavily-contested rim attempt it is — probabilistic
      // resolution over hard physics, the engine's core bet. Dunk-class
      // then books through the booth's own deterministic rule (made,
      // inside its range, athlete gate) — the sync contract extended by
      // reuse, not duplicated. The beaten read is the shared defendersBack
      // measure the phase flip and the EV brain already use. No decide
      // re-entry (W64 attempt 2), no speed change (attempt 1),
      // drive-labeled attempt count untouched by construction (the same
      // decides fire the same shots — only where the ball goes up moves).
      // transCarryScale is the stage switch, checked FIRST.
      //
      // F1 amendment (PR #75 probe, Lead-ruled): the carry's reach is its
      // OWN gate — the decide-time body-to-rim gap must sit inside
      // ai.transCarryGatherFt or the finish stays an ordinary drive
      // release. The only distance cap before it was
      // decide.driveShotRangeFt (12 ft, the drive LABEL gate — a knob the
      // carry's docs never named), and that tail booked the ball at the
      // rim with the body 6+ ft away on 17.5% of scale-1 carries (release
      // gap p90 7.44 ft, max 10.06 — not a human finish). NOTE: the
      // defendersBack condition below is exactly redundant with
      // phase === 'transition' today — the phase flip shares the read,
      // runs earlier in the same tick, and positions are frozen between
      // integrations (probe-verified: its deletion moves 0/12 streams).
      // It stays as belt-and-suspenders on separately-owned conditions;
      // do not "fix" the redundancy in either direction silently. The
      // conditions themselves live in carriesToRim (above executeAction),
      // extracted so the F2 pins can drive them one at a time.
      if (carriesToRim(s, h, action.moveType)) {
        s.pendingRelease.carryRim = true;
        // F1: the gather's ball path starts here (decide-time body spot,
        // decide-tick clock) and meets the rim at release — tickLive
        // moves the ball along it so the rim booking lands continuously.
        s.pendingRelease.carryFrom = { x: h.pos.x, y: h.pos.y };
        s.pendingRelease.carryT0 = s.t;
        break; // carry the finish: target stays the rim, sprint stays on
      }
      h.target = h.pos;
      h.sprinting = false;
      break;
    case 'pass':
      startPass(s, h, action.toId, action.passKind);
      break;
    case 'drive': {
      {
        const D = s.params.decide;
        const A = s.params.ai;
        const launchDist = dist(h.pos, attackedRim(s, h.side));
        // THE SNAKE STOP-SHORT: a mid-range identity sometimes attacks TO
        // HIS SPOT, not the rim — the drive that ends in a stop-on-a-dime
        // pull-up at the FT-line/elbow band (the signature self-created
        // middy). Gated on the shared midPullUpLight (ai/shared.ts: the
        // same joint green light the decisiveness term honors, so the
        // player who snakes and the player who rises are the same player)
        // and only from OUTSIDE the band — a snake attacks INTO it;
        // launches already inside it are the ordinary rim drive. The
        // commit simply ends at driveMidStopFt instead of the rim: the
        // beaten defender is still trailing when it expires, so the next
        // decision is a pull-up in the band with real separation — and if
        // the light doesn't fire there, the kick machinery takes over,
        // which is how real snakes end too.
        const stopShort =
          launchDist > A.midGreenMaxFt &&
          midPullUpLight(h) > 0 &&
          s.rng.chance(midPullUpLight(h) * A.driveMidStopChance);
        // non-snake: the arrival-based commit — penetrate until you REACH
        // the rim vicinity (launch distance / planning speed), clamped to
        // [floor, ceiling]; a fixed window expired mid-lane on long
        // launches and drives died as 15-ft pull-ups (drive-collapse
        // forensic)
        h.driveUntil = stopShort
          ? s.t + (launchDist - A.driveMidStopFt) / D.driveSpeedFtSec
          : s.t + Math.min(D.driveCommitMaxSec, Math.max(D.driveCommitSec, launchDist / D.driveSpeedFtSec));
      }
      // re-evaluate quickly mid-drive (finish or kick)
      s.decisionAt = s.t + s.params.decide.driveRecheckSec;
      break;
    }
    case 'hold':
      break;
  }
}

// ------------------------------------------------------------------ frames

function recordFrame(s: GameState, force = false): void {
  if (!s.collectFrames) return;
  // cadence keyed to the WALL clock (relative epsilon: float accumulation
  // across ~29k ticks was silently dropping the final frame)
  const step = s.params.frameEvery / s.params.tickHz;
  if (s.frames.length > 0) {
    const lastT = s.frames[s.frames.length - 1]![0]!;
    // forced frames still respect strict monotonicity after round1()
    if (s.wallT - lastT < (force ? 0.05 : step * 0.999)) return;
  }
  const row: number[] = [
    round1(s.wallT),
    s.period,
    round1(Math.max(0, s.clock)),
    round1(s.ball.pos.x),
    round1(s.ball.pos.y),
    holderSlot(s)
  ];
  for (const side of [0, 1] as TeamSide[]) {
    for (const id of s.lineup[side]) {
      const a = agent(s, id);
      row.push(round1(a.pos.x), round1(a.pos.y));
    }
  }
  s.frames.push(row);
}

function holderSlot(s: GameState): number {
  const id = s.ball.holderId;
  if (!id) return -1;
  const a = s.agents.get(id);
  if (!a) return -1;
  const idx = s.lineup[a.side].indexOf(id);
  return idx === -1 ? -1 : a.side * 5 + idx;
}

// -------------------------------------------------------------------- main

/**
 * Reject invalid ratings at the boundary. Two tiers (GameConfig.validate):
 *
 * 'finite' (always on): a single NaN poisons every sigmoid downstream, the
 * softmax weights all go NaN, Rng.weighted falls through, and the game
 * stalls at 0-0 until the safety cap trips — an independent review
 * demonstrated exactly this silent-corruption chain. Non-finite input is
 * always a caller bug and must fail loudly here, not 48 simulated minutes
 * later. Out-of-range FINITE values stay legal in this tier (custom
 * content and stress tests are real use cases; a 999 just saturates the
 * curves — see the adversarial extreme-roster test).
 *
 * 'strict' (opt-in): additionally enforces the @hoopsh/data pack contract —
 * ratings 0-100, heightIn 60-96, tactics 0-100 (ranges mirror
 * data/src/schema.ts, which the engine cannot import; keep the two in
 * sync). This formally separates
 * "valid but unusual" from "invalid" for callers feeding the engine
 * untrusted or hand-edited rosters.
 */
function assertValidRatings(team: Team, side: string, strict: boolean): void {
  for (const p of team.players) {
    for (const [bagName, bag] of [['attr', p.attr], ['tend', p.tend]] as const) {
      for (const [k, v] of Object.entries(bag)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(
            `simulateGame: non-finite rating ${side}/${p.id}.${bagName}.${k} = ${String(v)} — ` +
            `validate rosters (see @hoopsh/data loadTeamPack) before simulating`
          );
        }
        if (strict && (v < 0 || v > 100)) {
          throw new Error(
            `simulateGame: rating out of range ${side}/${p.id}.${bagName}.${k} = ${String(v)} ` +
            `(validate:'strict' enforces the 0-100 pack contract; use the default 'finite' tier for experimental rosters)`
          );
        }
      }
    }
    if (!Number.isFinite(p.heightIn) || !Number.isFinite(p.weightLb)) {
      throw new Error(`simulateGame: non-finite body measurement on ${side}/${p.id}`);
    }
    // wingspanIn is optional, but PRESENT-and-non-finite doesn't trigger the
    // `?? heightIn + 2` fallback in derived.ts (?? only catches nullish) —
    // a NaN wingspan flowed into standing reach and detonated ~20 simulated
    // minutes in as an unattributed Rng.weighted throw, and Infinity played
    // silently. schema.ts validates exactly this field; the mirrors were
    // out of sync on the one field schema calls out as a NaN vector (c4-F2).
    if (p.wingspanIn !== undefined && (typeof p.wingspanIn !== 'number' || !Number.isFinite(p.wingspanIn))) {
      throw new Error(`simulateGame: non-finite wingspanIn on ${side}/${p.id} = ${String(p.wingspanIn)}`);
    }
    if (strict && (p.heightIn < 60 || p.heightIn > 96)) {
      throw new Error(
        `simulateGame: heightIn out of range ${side}/${p.id} = ${String(p.heightIn)} (validate:'strict' expects 60-96)`
      );
    }
  }
  // Team.tactics mirrors schema.ts as well (keys pace/threeBias/helpAggr —
  // keep in sync, the engine cannot import the data package). The AI reads
  // tactics.threeBias/helpAggr unconditionally with no fallback: a MISSING
  // tactics object crashed raw ~8 simulated seconds in at the first
  // tactics-driven decision, and a NaN threeBias passed 'strict' only to
  // detonate later as an unattributed non-finite-weight throw — the exact
  // silent-corruption chain the ratings tiers above exist to prevent
  // (audit M-44). Same two tiers: finiteness always, 0-100 under 'strict'.
  if (typeof team.tactics !== 'object' || team.tactics === null) {
    throw new Error(
      `simulateGame: ${side}/${team.id} missing tactics — need { pace, threeBias, helpAggr }, each a finite number (the AI reads them unconditionally)`
    );
  }
  for (const k of ['pace', 'threeBias', 'helpAggr'] as const) {
    const v = team.tactics[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(
        `simulateGame: non-finite tactic ${side}/${team.id}.tactics.${k} = ${String(v)} — ` +
        `validate rosters (see @hoopsh/data loadTeamPack) before simulating`
      );
    }
    if (strict && (v < 0 || v > 100)) {
      throw new Error(
        `simulateGame: tactic out of range ${side}/${team.id}.tactics.${k} = ${String(v)} ` +
        `(validate:'strict' enforces the 0-100 pack contract)`
      );
    }
  }
  // rotationMinutes mirrors schema.ts too: a NaN target doesn't fail — it
  // silently disables the minutes-pace leash for that player (observed: a
  // NaN-targeted starter rode until fouling out instead of rotating). Keys
  // for ids not on the roster are ignored harmlessly by subs.ts, so only
  // value shape is enforced here, exactly like the pack validator (c4-F2).
  if (team.rotationMinutes !== undefined) {
    for (const [rid, v] of Object.entries(team.rotationMinutes)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new Error(
          `simulateGame: rotationMinutes target ${side}/${rid} = ${String(v)} must be a finite number >= 0`
        );
      }
    }
  }
}

export function simulateGame(cfg: GameConfig): GameResult {
  // exact-match tier names, unknown values rejected: JS callers passing
  // 'Strict' (case typo) used to silently run the finite tier — a 500-rated
  // player then played under a config that asked for strictness (c4-F6)
  if (cfg.validate !== undefined && cfg.validate !== 'finite' && cfg.validate !== 'strict') {
    throw new Error(`simulateGame: unknown validate tier "${String(cfg.validate)}" (use 'finite' or 'strict')`);
  }
  const strict = cfg.validate === 'strict';
  assertValidRatings(cfg.home, 'home', strict);
  assertValidRatings(cfg.away, 'away', strict);
  const s = initState(cfg);

  emit(s, {
    type: 'game_start',
    home: { teamId: cfg.home.id, lineup: [...s.lineup[0]] },
    away: { teamId: cfg.away.id, lineup: [...s.lineup[1]] }
  });

  s.tipWinner = tipWeightedWinner(s);
  emit(s, { type: 'tip_off', winner: s.tipWinner });
  s.phase = { kind: 'dead', resumeIn: 0.8, clockRuns: false, nextTeam: s.tipWinner, possKind: 'tip' };
  setupDeadTargets(s, s.tipWinner);

  const dt = 1 / s.params.tickHz;
  const hardCapSeconds =
    (s.rules.periods * s.rules.periodMinutes + 12 * s.rules.otMinutes) * 60 + 900;
  let safety = cfg.safetyCapTicks ?? Math.ceil(hardCapSeconds / dt) * 4;

  while (!s.over && safety-- > 0) {
    tick(s, dt);
  }
  if (!s.over) {
    // The cap tripping means the game FAILED to finish — an engine bug (or a
    // deliberately tiny safetyCapTicks). An earlier version emitted a
    // legitimate-looking game_end here, which let a stalled game masquerade
    // as a valid result; an external review flagged it. Fail loudly instead:
    // a result you get back from simulateGame is always a finished game.
    // The diagnosis names BOTH suspects: with stock rules/params this is an
    // engine bug, but a degenerate config reaches the same cap legitimately
    // (probed: unscorable params spin up endless tied OTs; a sub-tick
    // shotClockSec starves endPeriod) — the old "engine bug" wording sent
    // users with a weird rulepack hunting phantom engine defects (c4-F4).
    throw new Error(
      `simulateGame: tick-loop safety cap exhausted before game_end — engine bug, unless the config is ` +
      `degenerate (custom rules/params that prevent scoring or period end make this unreachable-by-design) ` +
      `(seed=${String(cfg.seed)}, period=${s.period}, clock=${s.clock.toFixed(1)}s, ` +
      `phase=${s.phase.kind}, score=${s.score[0]}-${s.score[1]}, events=${s.events.length})`
    );
  }
  // guarantee the final positions and game_end instant are representable
  recordFrame(s, true);

  return {
    seed: String(cfg.seed),
    events: s.events,
    finalScore: [s.score[0], s.score[1]],
    frames: s.frames,
    rules: s.rules,
    params: s.params,
    teams: [cfg.home, cfg.away]
  };
}
