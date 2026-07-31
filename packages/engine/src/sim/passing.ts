/**
 * Passing: launching a pass (with pre-rolled turnover/steal risk), resolving
 * its arrival, and the reach-in steal/foul check on the current ball holder.
 *
 * `startPass` is called from the AI's ball-handler decision (`ai.ts`,
 * `executeAction`) whenever it picks one of the pass options; the flight
 * itself is advanced tick-by-tick by `game.ts`'s live tick, which calls
 * `resolvePassArrival` once `remaining` counts down to zero. `attemptReachIn`
 * is polled every live tick independent of passing — it's the on-ball
 * defender's steal/foul pressure on whoever currently holds the ball.
 */

import { clamp } from '../core/rng.js';
import { add, dist, lerp, scale } from '../core/vec.js';
import type { TeamSide } from '../core/events.js';
import { agent, attackedRim, emit, liveOnCourt, other, type Agent, type GameState } from './state.js';
import { n } from '../model/derived.js';
import { assignedDefender, onBallDefender } from './ai.js';
import { contestAt, defendersBack, passRisk } from './resolve.js';
import {
  deadBall, endPeriod, endPossession, giveBall, jumpGainer, jumpWinnerOf,
  retentionFoulShotClock, startPossession
} from './possession.js';
import { enterFreeThrows, recordFoul } from './fouls.js';
import { foulHuntSide } from './endgame.js';

/**
 * Launch a pass from `from` to the player `toId`. The turnover/steal outcome
 * is decided HERE, at launch (via `passRisk`), not on arrival — `resolvePassArrival`
 * just plays out whatever was pre-rolled into `passFail`. This matters for
 * determinism/ordering: the ball's mid-air path can visually differ (an
 * off-target lead toward a defender) depending on whether the pass was
 * doomed from the start, so the fail/success branch has to be chosen before
 * the flight's `to` target is even computed.
 */
export function startPass(
  s: GameState,
  from: Agent,
  toId: string,
  passKind: 'normal' | 'kickout' | 'outlet' | 'entry' | 'handoff' | 'lob'
): void {
  const to = agent(s, toId);
  // the lob flag rides the CHOICE payload from decide.ts — pricing and
  // outcome share one passRisk belief (the session-8 self-consistency rule)
  const risk = passRisk(s, from, to, passKind === 'lob');
  const fails = s.rng.chance(risk.turnoverP);
  // lead the receiver by pass.leadSec of his current velocity — a pass
  // thrown to where a moving teammate WILL be, not where he currently stands
  // ("lead like you'd expect a decent passer to", not a real reaction-time
  // constant)
  const lead = add(to.pos, scale(to.vel, s.params.pass.leadSec));
  // a failing pass doesn't necessarily go somewhere absurd — it's undercooked,
  // landing somewhere between the passer and the intended target
  // (pass.failShortLo/Hi of the way there) rather than reaching the receiver;
  // this is what puts it in a defender's range without teleporting the ball
  // to him
  const target = fails
    ? lerp(from.pos, lead, s.rng.range(s.params.pass.failShortLo, s.params.pass.failShortHi))
    : lead;
  // floor the flight distance at pass.minFlightFt so a point-blank pass
  // still takes a nonzero tick or two to "arrive" instead of resolving
  // instantly
  const d = Math.max(s.params.pass.minFlightFt, dist(from.pos, target));
  const time = d / s.params.pass.speedFtS; // speedFtS is a flat ball speed (SimParams), not player-dependent
  s.ball.holderId = null;
  s.ball.flight = {
    kind: 'pass',
    from: { ...from.pos },
    to: target,
    total: time,
    remaining: time,
    passFrom: from.p.id,
    passTo: toId,
    passKind,
    // stealShare: of all failed passes, this fraction become a live steal
    // (credited to the most dangerous lane defender from passRisk); the rest
    // sail out of bounds untouched — both are "bad passes" but only one
    // creates a live-ball turnover for the defense to run with
    passFail: fails
      ? { stolenBy: s.rng.chance(s.params.pass.stealShare) ? risk.dangerId : null }
      : undefined
  };
}

/**
 * Resolve a pass once its flight timer reaches zero. Dispatched from
 * `game.ts`'s live tick when `s.ball.flight.remaining <= 0` and
 * `flight.kind === 'pass'`. Branches three ways: a clean catch (hands the
 * ball to the receiver and opens a quick decision window), a steal (new
 * possession for the thief), or an out-of-bounds turnover (dead ball, other
 * team inbounds). The steal/OOB outcome itself was already decided back in
 * `startPass` — this function just acts on `f.passFail`.
 */
export function resolvePassArrival(s: GameState): void {
  const f = s.ball.flight;
  if (!f || f.kind !== 'pass') return;
  const from = f.passFrom!;
  const passer = agent(s, from);
  s.ball.flight = null;

  if (f.passFail) {
    const stolenBy = f.passFail.stolenBy;
    if (stolenBy) {
      const thief = agent(s, stolenBy);
      emit(s, {
        type: 'turnover', team: passer.side, player: from,
        kind: 'bad_pass', stolenBy
      });
      endPossession(s, 'turnover');
      // horn check, same as the clean-catch branch below: a pass still in
      // flight when the clock hit zero resolves its turnover, but no NEW
      // possession may start after the buzzer — without this guard the steal
      // started a phantom 0.0s possession (pace +1, a possession_start
      // stamped after the horn) that the next live tick ended as period_end
      if (s.clock < 1e-6) { endPeriod(s); return; }
      startPossession(s, thief.side, 'steal', thief);
      // the BALL snaps to the thief (a deflection), never the player to the
      // ball — teleporting bodies breaks the replay's physical continuity
      s.ball.pos = { x: thief.pos.x, y: thief.pos.y };
    } else {
      emit(s, {
        type: 'turnover', team: passer.side, player: from, kind: 'out_of_bounds'
      });
      endPossession(s, 'turnover');
      // same horn guard as the steal branch — the OOB variant otherwise sat
      // through the full dead-ball ritual (tickDead never checks the horn
      // with clockRuns:false) and inbounded a phantom possession after 0:00
      if (s.clock < 1e-6) { endPeriod(s); return; }
      // an OOB call is the canonical reviewable close call (officiating
      // wave; the flag costs nothing while the review rates are staged at 0)
      deadBall(s, other(passer.side), { clockRuns: false, reviewable: 'oob' });
    }
    return;
  }

  const to = agent(s, f.passTo!);

  // Kicked ball (officiating wave, fdesign-officiating §1.6, live at
  // kickedPerPass 0.00127 — 0.57/g REAL, rate gate before the draw): on a clean-catch
  // arrival only (the pass-fail branch above owns steals/OOB), a defender's
  // foot kills the pass. No turnover and no pass event (the pass never
  // completed); the offense retains at a same-possession stoppage with the
  // shot clock floored at the rule pack's short-clock reset (the NBA's
  // 14-reset). Violator = the intended receiver's assigned defender
  // (fallback: nearest live defender to the catch spot). Skipped at the
  // horn: a pass arriving after 0.0 is a dead play, not a whistle (the
  // buzzer check below owns it). Draw order: one chance() per clean catch.
  const O = s.params.officiating;
  if (s.clock >= 1e-6 && O.kickedPerPass > 0 && s.rng.chance(O.kickedPerPass)) {
    const kicker = assignedDefender(s, to) ??
      liveOnCourt(s, other(to.side))
        .sort((a, b) => dist(a.pos, to.pos) - dist(b.pos, to.pos))[0];
    if (kicker) {
      emit(s, {
        type: 'violation', team: kicker.side, player: kicker.p.id, kind: 'kicked_ball'
      });
      s.poss.shotClock = Math.max(s.poss.shotClock, s.rules.shotClockOffRebSec);
      // 1.2s continuation: same possession resumes. The whistle, the
      // clock freeze, and the fresh short clock are the texture (the same
      // side-out pattern as a non-bonus reach-in foul)
      deadBall(s, to.side, { clockRuns: false, continuation: true, resumeIn: 1.2 });
      return;
    }
  }

  emit(s, {
    type: 'pass', team: passer.side, from, to: to.p.id, kind: f.passKind ?? 'normal'
  });
  s.poss.lastPass = { from, t: s.t }; // feeds assist-window checks in shooting.ts (catch-to-shot timing)
  // delivery quality rides the catch: a pass into the shooting pocket from an
  // elite passer makes the receiver's rise easier (consumed by shotMakeP for
  // catch-and-shoot attempts only — the window gates it naturally)
  to.catchQuality = n((passer.p.attr.passAcc + passer.p.attr.passVision) / 2);
  // a handoff catch stuns the receiver's trailing defender — the hub's body
  // is the screen. This is the whole payoff of the DHO action: the receiver
  // rises into a catch-and-shoot with the contest wiped, or attacks downhill.
  const act = s.poss.action;
  if (f.passKind === 'handoff' && act?.kind === 'dho' && to.p.id === act.receiverId) {
    const trail = assignedDefender(s, to);
    if (trail) trail.screenStunUntil = s.t + s.params.ai.dhoStunSec;
    // ...and the receiver TURNS THE CORNER: a drive commitment off the catch
    // (his man is screened behind him — the whole point). Inside the arc the
    // downhill attack is the play; at the arc the catch-and-shoot machinery
    // competes naturally. Without this, receivers caught, reset, and the
    // action produced 0.1 assists a game on 8.9 handoffs.
    const rim = attackedRim(s, to.side);
    if (dist(to.pos, rim) < s.params.ai.dhoArcSplitFt) {
      // inside the arc: turn the corner downhill
      to.driveUntil = s.t + s.params.decide.driveCommitSec; // same commitment as executeAction's drive
    }
    // at/beyond the arc: no commitment — the catch-and-shoot machinery owns
    // the rise (a drive grant there sprinted the receiver INTO the defense
    // and swallowed the open three the stun had just bought)
    s.poss.action = null; // the action delivered; normal offense resumes
  }
  giveBall(s, to, 'pass');
  // a catch after the buzzer is a dead play — the ball must be shot before 0.0
  // (passes in flight while the clock expires were scoring post-buzzer baskets)
  if (s.clock < 1e-6) { endPeriod(s); return; }
  // THE LOB FUSION (W64 channel 2, session-8 arc): a clean lob catch rises
  // immediately — the catch IS the gather. pendingRelease replaces the
  // decision window (never a decideBall re-entry: the W64(2) graveyard),
  // exactly the machinery executeAction's 'shoot' uses, so stage 5 owns the
  // windup, the stage-4 violation check still precedes the release (no
  // buzzer-proof lobs — verifier F8), and giveBall above has already
  // stamped the assist chain (every made alley-oop is assisted — F1).
  // contest0 is the at-catch contest discounted for the vertical advantage;
  // it enters startShot as the BLEND INPUT (contestReleaseBlend mixes the
  // at-release contest back in — the effective relief is measured, not
  // assumed; F1b). The receiver's cut target stays live: unlike a decided
  // shot (which plants the shooter), momentum carries the rise to the rim —
  // that coast is what puts the release inside the booth's 2.25 ft dunk
  // band (F2).
  if (f.passKind === 'lob' && s.params.ai.lobScale > 0) {
    s.pendingRelease = {
      shooterId: to.p.id,
      moveType: 'cut_finish',
      releaseAt: s.t + s.params.shot.windupCutFinish,
      contest0: contestAt(s, to, to.pos).level * s.params.ai.lobContestDiscount
    };
    return;
  }
  // 0.12s: deliberately much faster than the ~0.25-0.35s decision delays used
  // elsewhere (new possession, post-rebound) — this is the catch-and-shoot
  // trigger window, modeling a shooter who catches and fires almost
  // immediately rather than resetting and re-evaluating the whole possession
  s.decisionAt = s.t + 0.12;
}

// ---------------------------------------------------------------- reach-in

/**
 * Is the transition take live for the defense right now? (officiating wave,
 * fdesign-officiating §1.5, live at takeHuntRateMult 0.06728; at 0 the
 * first check returns and nothing else evaluates.) True only in the
 * opening seconds of a steal/live-rebound possession while the defense is
 * beaten (fewer than transSetBackCount−1 back): the real "wrap him up
 * before the break gets going" calculus, built exactly like foulHuntSide.
 * The existing reach-in dice get loaded (rate × takeHuntRateMult, strip
 * share collapsed), never a scripted foul. Never active in the final
 * period's last 2:00: the real rule excludes it there, and the exclusion
 * doubles as the firewall between this and the endgame foul hunt (whose
 * fouls are the take's other context, relabeled via takeRelabelHuntFouls).
 */
function takeHuntActive(s: GameState, offSide: TeamSide): boolean {
  const O = s.params.officiating;
  if (O.takeHuntRateMult <= 0) return false; // 0 = staged off
  if (s.poss.kind !== 'steal' && s.poss.kind !== 'live_rebound') return false;
  if (s.t - s.poss.startT > O.takeWindowSec) return false;
  // 120 s: the real transition-take rule carves out the final two minutes
  // (late-game fouling is the endgame hunt's jurisdiction, not a take)
  if (s.period >= s.rules.periods && s.clock <= 120) return false;
  return defendersBack(s, offSide) < s.params.move.transSetBackCount - 1;
}

/**
 * Per-tick pressure check on whoever currently holds the ball, from his
 * primary defender. Polled every live tick from `game.ts` regardless of what
 * else is happening (dribbling, deciding, mid-drive) — this is what produces
 * on-ball steals and reach-in fouls independent of the AI's own decisions.
 * Resolves in two stages: first "does a reach-in event happen at all" (time-
 * based, scales with the defender's gambling tendency), then, conditional on
 * that, "is it a clean strip (turnover) or a foul" (skill-based, `stripP`).
 */
export function attemptReachIn(s: GameState, dt: number): void {
  const holderId = s.ball.holderId;
  if (!holderId) return;
  const h = agent(s, holderId);
  // ball exposure: power dribbles show the ball. A live drive or post
  // backdown multiplies the reach-in rate — this is the live-ball turnover
  // pressure that keeps attack volume honest (without it, FGA ran 2-3% over
  // band with steals pinned at the low edge; the Stage 2 diagnosis).
  const act = s.poss.action;
  const attacking =
    s.t < h.driveUntil ||
    (act?.kind === 'post' && act.posterId === h.p.id && act.phase === 'working');
  let d = onBallDefender(s, h);
  if (attacking) {
    // in traffic ANY converging defender can get a hand in — a beaten on-ball
    // man is behind the play, and the strip risk of attacking a crowd comes
    // from the helpers meeting the ball at the gather
    for (const cand of liveOnCourt(s, other(h.side))) {
      if (!d || dist(cand.pos, h.pos) < dist(d.pos, h.pos)) d = cand;
    }
  }
  // ENDGAME LAYER: intentional fouling rides THIS machinery — a trailing
  // defense late in a close game (sim/endgame.ts foulHuntSide) doesn't get a
  // new scripted action, it gets the same reach-in dice LOADED: a wider grab
  // range, a drilled-deliberate rate, and a strip share near zero (a wrap-up
  // is a whistle, not a poke). defense.ts presses the on-ball defender into
  // range so the grab actually connects. Flag off, hunting is always false.
  const hunting = s.endgame && foulHuntSide(s) === other(h.side);
  // Transition take (officiating wave): the same loaded-dice doctrine for
  // the beaten-in-transition wrap-up. Hunt geometry, take rate, strip
  // share collapsed to zero, foul kind 'take'. Live at takeHuntRateMult
  // 0.06728 (takeHuntActive gates; 0 = off), and the endgame hunt
  // takes precedence when both could apply (it can't by construction, the
  // final-2:00 exclusion; the ordering documents the priority).
  const takeHunting = !hunting && takeHuntActive(s, h.side);
  const E = s.params.endgame;
  // 4.2ft: hand-check range, deliberately shorter than onBallDefender's
  // own 12ft "who guards him" radius, since a reach-in needs the defender
  // close enough to actually get a hand on the ball
  // (attacking widens it to gather range: strips happen at the gather; a
  // hunted/take grab is a lunge, the wider hunt range)
  const F = s.params.foul;
  const reachRange = hunting || takeHunting
    ? E.foulHuntReachDistFt
    : attacking ? F.attackReachDistFt : F.reachDistFt;
  if (!d || dist(d.pos, h.pos) > reachRange) return;
  // per-tick probability from a per-second rate (reachInPerSec * dt), boosted
  // up to +85% for a maximum-gambleSteal defender — aggressive gamblers reach
  // in far more often than conservative ones, at the cost of the foul risk below
  // (a hunted/take grab replaces the gamble swing with the coach's order:
  // the deliberate foulHuntRateMult / takeHuntRateMult)
  const exposure = attacking ? F.attackReachInMult : 1;
  // heavy legs reach (rhythm wiring): a loaded defender stops moving his
  // feet and starts using his hands, so the ORGANIC rate scales with his
  // cumulative load. Hunted/take grabs are coach orders and stay unscaled.
  // Exactly ×1 while the load pool is staged at 0.
  const legs = 1 + F.loadReachSwing * (d.load / 100);
  const p = hunting
    ? F.reachInPerSec * dt * E.foulHuntRateMult
    : takeHunting
      ? F.reachInPerSec * dt * s.params.officiating.takeHuntRateMult
      : F.reachInPerSec * dt * exposure * (1 + F.reachInGambleSwing * n(d.p.tend.gambleSteal)) * legs;
  if (!s.rng.chance(p)) return;

  // Held ball → mid-game jump (officiating wave, fdesign-officiating §1.1
  // secondary site, live at heldBallPerReach 0.005 — the ~15% on-ball
  // share of the 0.83/g REAL total, rate gate before
  // the draw): organic reach events only (a hunted/take grab is a foul on
  // purpose, never a tie-up). The defender ties the holder up instead of
  // stripping or hacking, and the officials administer a jump between the
  // two. Draw order inside the reach event is fixed: this one chance(),
  // then (on fire) jumpWinnerOf's one weighted(); the strip/foul split
  // below is never reached on a tie-up.
  if (!hunting && !takeHunting) {
    const O = s.params.officiating;
    if (O.heldBallPerReach > 0 && s.rng.chance(O.heldBallPerReach)) {
      const jumpWinner = jumpWinnerOf(s, h, d);
      const gainer = jumpGainer(s, jumpWinner, h.pos);
      emit(s, {
        type: 'jump_ball',
        between: [h.p.id, d.p.id],
        winner: jumpWinner.side,
        gainedBy: gainer.p.id
      });
      if (jumpWinner.side === h.side) {
        // offense controls the tap: the same possession resumes at a
        // continuation dead ball, the loose-ball side-out pattern (1.2s,
        // clock stopped, shot clock floored at the 14s reset)
        s.poss.shotClock = Math.max(s.poss.shotClock, s.rules.shotClockOffRebSec);
        deadBall(s, h.side, { clockRuns: false, continuation: true, resumeIn: 1.2 });
      } else {
        // defense controls the tap: possession flips with no turnover
        // charged (real scoring convention; the 'held_ball' outcome exists
        // for exactly this), and the new possession is an administered
        // 'tip', never a transition burst
        endPossession(s, 'held_ball');
        startPossession(s, d.side, 'tip', gainer);
      }
      return;
    }
  }

  // given a reach-in happens, stripP is the clean-strip share: a base, plus a
  // swing for an elite-steal defender, minus a swing for an elite ball-handler
  // (ball security beats a defender's hands, but not as much as the
  // defender's hands beat a poor handler) — clamped to [stripMin, stripMax] so
  // even the best/worst matchups still have a real chance either way, never a
  // guaranteed foul or guaranteed strip (all five constants live in params.foul)
  // attacking reach-ins skew cleaner: a poke at the gather is a strip far
  // more often than a hack (without the skew, the attack-exposure tax paid
  // out in fouls instead of the turnovers it exists to produce)
  // a hunted grab is a foul on purpose: the clean-strip share collapses to
  // foulHuntStripShare (hands still find ball once in a while; the
  // occasional legitimate endgame steal off the "foul" is real texture).
  // A take is even more deliberate: the wrap-up before the break develops
  // is a whistle every time (stripP 0 keeps the draw count identical while
  // the corpus's zero-strip resolution holds)
  const stripP = hunting
    ? E.foulHuntStripShare
    : takeHunting
      ? 0
      : clamp(
          F.stripBase + (attacking ? F.attackStripBonus : 0) + F.stripStealSwing * n(d.p.attr.steal) - F.stripHandleSwing * n(h.p.attr.ballHandle),
          F.stripMin, F.stripMax
        );
  if (s.rng.chance(stripP)) {
    emit(s, {
      type: 'turnover', team: h.side, player: h.p.id, kind: 'lost_ball', stolenBy: d.p.id
    });
    endPossession(s, 'turnover');
    startPossession(s, d.side, 'steal', d);
  } else {
    // foul kind vocabulary (officiating wave): a transition-take grab is a
    // 'take'; the endgame hunt's wrap-ups are takes too now that the
    // relabel switch is flipped (takeRelabelHuntFouls 1, live since the
    // FLOW flip; the relabel changes no rates or stats, only the kind
    // the corpus actually prints for the Q4 foul game). Everything else
    // stays a 'reach'.
    const kind = takeHunting || (hunting && s.params.officiating.takeRelabelHuntFouls > 0)
      ? 'take'
      : 'reach';
    const { bonus, techFT } = recordFoul(s, d, kind, h);
    if (bonus) {
      h.usedPoss++; // a bonus trip uses the possession (usage bookkeeping)
      // award comes from FoulOutcome.bonus, not rules.bonusFreeThrows: under
      // NCAA rules team fouls 7-9 are a one-and-one, not a flat two
      // (a technical rider prefixes the trip: fouls.ts, staged-inert)
      enterFreeThrows(s, h, bonus.shots, bonus.oneAndOne,
        techFT ? { pre: techFT.p.id } : undefined);
    } else {
      // not in the bonus: no free throws, offense just keeps the ball — the
      // defensive-foul retention reset (retentionFoulShotClock: frontcourt
      // floors at the short reset and is never lowered, a BACKcourt whistle
      // — reach-ins land on the advance all the time — grants the full
      // fresh clock, audit L-11), then the short side-out continuation
      // delay (move.deadBallSideOutSec — same possession, no team change)
      // lets the whistle register before play resumes
      s.poss.shotClock = retentionFoulShotClock(s, h.side, h.pos);
      if (techFT) {
        // technical rider with no FTs of its own: the tech FT is shot
        // first, then this exact deadBall runs from tickFreeThrows via
        // resume, so the possession resumes byte-identically to the no-tech
        // path
        enterFreeThrows(s, techFT, 1, false, {
          resume: {
            nextTeam: h.side, continuation: true,
            resumeIn: s.params.move.deadBallSideOutSec
          }
        });
        return;
      }
      deadBall(s, h.side, {
        clockRuns: false, continuation: true,
        resumeIn: s.params.move.deadBallSideOutSec
      });
    }
  }
}
