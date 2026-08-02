/**
 * Off-ball offense: spacing-spot assignment, per-tick movement (cuts, DHO
 * sprints, screen setting, relocations), and the both-sides reaction to a
 * shot going up (crash / box out / get back — the boxout half steers the
 * DEFENSE, but the trigger is the offense's shot, so it lives here with it).
 */

import { dist, lerp, norm, scale, sub, add } from '../../core/vec.js';
import { clamp } from '../../core/rng.js';
import { spacingSpots } from '../../geometry/court.js';
import type { TeamSide } from '../../core/events.js';
import { agent, attackedRim, liveOnCourt, onCourt, other, type Agent, type GameState } from '../state.js';
import { defendersBack, gravity } from '../resolve.js';
import { sprintSpeed } from '../../model/derived.js';
import { assignedDefender, midGreenLight } from './shared.js';
import { actionTick } from './actions.js';

/** react to a shot going up: crash the boards, box out, or get back on D */
export function onShotReleased(s: GameState, offSide: TeamSide): void {
  const rim = attackedRim(s, offSide);
  for (const a of liveOnCourt(s, offSide)) {
    const near = dist(a.pos, rim) < s.params.ai.crashNearFt;
    const crash = near && s.rng.chance(
      s.params.ai.crashBase + (a.p.tend.crashOffReb / 100) * s.params.ai.crashTendScale
    );
    if (crash) {
      a.intent = 'crash';
      // attack a seeded spot in the carom zone, not the rim's center
      const j = s.params.ai.crashScatterFt;
      a.target = { x: rim.x + s.rng.range(-j, j), y: rim.y + s.rng.range(-j, j) };
      a.sprinting = true;
    } else {
      a.intent = 'getback';
      // retreat to the rim this team defends. (This was a lerp between two
      // expressions that are provably always the SAME rim — attackedRim of
      // the other side and the opposite-end rims[] entry — i.e. dead
      // geometry; simplified to what it always computed.)
      a.target = { ...attackedRim(s, other(offSide)) };
      a.sprinting = false;
    }
  }
  for (const d of liveOnCourt(s, other(offSide))) {
    const man = d.manId ? s.agents.get(d.manId) : null;
    if (man && dist(man.pos, rim) >= s.params.ai.defCrashPerimeterFt) {
      // guard-crash economy: a defender guarding the PERIMETER mostly holds
      // rather than sprinting into the scrum — unconditional crashing had
      // guards poaching long boards from the bigs who carved the position
      // (the hub benchmark's rebound share ran ~2 boards short). Rebounding
      // instincts (defReb) still send some guards in — the Westbrook clause.
      const goes = s.rng.chance(
        s.params.ai.defCrashFarChance + (d.p.attr.defReb / 100) * s.params.ai.defCrashFarSkill
      );
      if (!goes) {
        d.intent = 'getback';
        d.target = { ...man.pos }; // stay attached — deny the outlet leak
        d.sprinting = false;
        continue;
      }
    }
    d.intent = 'crash';
    d.target = man && dist(man.pos, rim) < s.params.ai.defCrashPerimeterFt
      ? lerp(man.pos, rim, s.params.ai.boxoutManShare) // box out between man and rim
      : lerp(d.pos, rim, s.params.ai.boxoutSelfShare);
  }
}

/**
 * Perimeter re-fill behind a secured offensive rebound (fdesign-grammar
 * M2a, the scramble economy's supply half). Non-crashing teammates were
 * sent into getback retreat at the shot (onShotReleased above) and walk
 * back to spots at offBallWalkMult (~2.5-3 ft/s, 8-10s to re-fill), so the
 * arc is empty exactly when the kick-out read (concept 10, decide.ts)
 * wants a receiver: the corpus kick-3 share is unreachable without it
 * (ffit-grammar §2.3 measured the kick dose saturating receiver-poor).
 * "Fill behind": every live off-ball teammate on a perimeter spot who is
 * retreating, or badly off his spot, sprints back to it and holds the
 * ground through the relocation-hold window (the offenseOffBallTick
 * machinery reused verbatim: relocUntil holds the target and preserves the
 * sprint flag, the baseline-escape rule). Defenders need no code: they
 * crashed to the rim, which IS the collapsed defense the kick attacks.
 *
 * Called from possession.ts tickScramble at the grab, before the putback
 * roll (a putback releases in ~0.25s and the refill is what the NEXT beat
 * needs either way). Deterministic, no rng. Live at ai.orebRefillSec 1.8
 * since the FLOW flip; at 0 it returns before touching any positioning
 * state.
 */
export function onOrebSecured(s: GameState, winner: Agent): void {
  const A = s.params.ai;
  if (A.orebRefillSec <= 0) return; // 0 = staged off
  for (const a of liveOnCourt(s, winner.side)) {
    if (a.p.id === winner.p.id) continue;
    if (
      a.spotKey !== 'top' && a.spotKey !== 'wing_l' && a.spotKey !== 'wing_r' &&
      a.spotKey !== 'corner_l' && a.spotKey !== 'corner_r'
    ) {
      continue; // dunker/elbow bodies stay in the scrum economy
    }
    const spot = s.poss.spots.get(a.spotKey);
    if (!spot) continue;
    // 8 ft: FEEL — beyond a body-and-a-step of his spot the spacing is
    // gone and the fill is worth a sprint; closer, he is already a receiver
    if (a.intent !== 'getback' && dist(a.pos, spot) <= 8) continue;
    a.intent = 'spot';
    a.target = { ...spot };
    a.sprinting = true;
    a.relocUntil = s.t + A.orebRefillSec;
  }
}

// ------------------------------------------------------------ offense setup

/**
 * Roll THIS possession's spot coordinates: the geometric template plus a
 * small seeded jitter (params.ai.spotJitterFt, uniform per axis), stored on
 * s.poss.spots for every downstream consumer. One roll per spot per
 * possession — the draw count is fixed (all spots, every call), so the RNG
 * stream stays deterministic regardless of personnel or spot usage.
 *
 * Why: with exact template coordinates, every trip produced bit-identical
 * shot locations — the Turing baseline judges read the repeated "26 ft"
 * threes and "5 ft" twos as a generator artifact (flow-reference.json
 * meta.turingBaseline). Real spots are zones re-picked each trip.
 *
 * Two guards keep jitter from changing what a spot MEANS (both bit the
 * first time around — assisted share drifted over its band edge on the
 * 24-game guard):
 *  - Corners deliberately sit INSIDE the 22 ft corner-three line (the D3
 *    decision — behind-the-line corners are coupled to the assist economy,
 *    see spacingSpots). Jitter must neither un-make that call (outward)
 *    nor systematically SHORTEN the corner into an easier junk 2 (inward),
 *    so corners jitter along the baseline only: lateral stays pinned at
 *    the template offset.
 *  - Top/wing spots are three-point spacing: a real shooter stands BEHIND
 *    the line on purpose. Unguarded jitter parked them on/inside the arc
 *    and minted 23-ft catch-and-shoot twos, so those spots keep
 *    params.ai.spotJitterArcMarginFt of clearance behind the arc (pushed
 *    back out radially when a roll lands too close).
 */
function rollSpots(s: GameState, rim: { x: number; y: number }): Map<string, { x: number; y: number }> {
  const j = s.params.ai.spotJitterFt;
  const byKey = new Map<string, { x: number; y: number }>();
  for (const { key, pos } of spacingSpots(s.court, rim)) {
    // two draws per spot, EVERY spot, every possession — fixed rng
    // consumption keeps the stream deterministic across code paths
    const dx = s.rng.range(-j, j);
    const dy = s.rng.range(-j, j);
    const p = { x: pos.x + dx, y: pos.y + dy };
    if (key === 'corner_l' || key === 'corner_r') {
      p.y = pos.y; // baseline-depth jitter only; lateral is the spot's meaning
    } else if (key === 'top' || key === 'wing_l' || key === 'wing_r') {
      const minR = s.rules.three.arcRadiusFt + s.params.ai.spotJitterArcMarginFt;
      const d = dist(p, rim);
      if (d < minR && d > 1e-9) {
        // push back out along the rim->spot ray to the clearance floor
        const k = minR / d;
        p.x = rim.x + (p.x - rim.x) * k;
        p.y = rim.y + (p.y - rim.y) * k;
      }
    }
    // same court margin the relocation drift respects — nobody spaces out of bounds
    p.x = clamp(p.x, 2, s.court.length - 2);
    p.y = clamp(p.y, 2, s.court.width - 2);
    byKey.set(key, p);
  }
  return byKey;
}

/** assign spacing spots for the possession by personnel */
export function assignSpots(s: GameState, side: TeamSide): void {
  const rim = attackedRim(s, side);
  const byKey = rollSpots(s, rim);
  s.poss.spots = byKey;
  // bench exhausted and every on-court player fouled out: play on with who's
  // out there rather than crashing (mirrors bestHandler — NBA rule analog: a
  // fouled-out player remains when no substitute exists; custom short rosters
  // are legal input, and the adversarial audit produced this state at default
  // params with a foul-prone no-bench fixture)
  const eligible = liveOnCourt(s, side);
  const players = eligible.length > 0 ? eligible : onCourt(s, side);

  // Best handler initiates from the top; everyone else fills by gravity —
  // shooters get the wings and corners, a low-gravity MID-RANGE big the
  // elbow (see below), the lowest-gravity pure big the dunker.
  const sorted = [...players].sort((a, b) => b.p.attr.ballHandle - a.p.attr.ballHandle);
  const handler = sorted[0]!;
  const rest = sorted.slice(1).sort((a, b) => gravity(s, b) - gravity(s, a));

  const map = s.poss.spotMap;
  map.clear();
  map.set(handler.p.id, 'top');
  // NOTE (D3, docs/REGISTER.md): a best-fit assignment model (appetite-ranked
  // corners + interior block stationing) is built and validated per-metric
  // in the D3 trail, but stays reverted — the D1 assist-crediting fix did
  // NOT unblock it. Behind-the-line corners change the offense globally
  // (catch-and-shoot share 58% -> 67%, bands 16/17 -> 7/17), so D3 needs
  // its own re-sweep, not a knob.
  const shooterKeys = ['wing_l', 'wing_r', 'corner_l', 'corner_r'];
  const elbowKeys = ['elbow_l', 'elbow_r'];
  let sk = 0; // next shooter spot to hand out
  let ek = 0; // next elbow spot to hand out
  rest.forEach((a, i) => {
    // THE MID-RANGE STATION: a low-gravity player (the defense will not
    // respect him beyond the arc — same threshold that routes to the
    // dunker) who nevertheless has a real in-between game (the same
    // green-light × ability score that gates the PnR short pop) spaces to
    // the ELBOW, his actual habitat, instead of a corner. A corner catch
    // for him is the junkiest shot in basketball (a 21.6 ft two the
    // defense happily concedes — pre-fix the postAnchor fixture's "mid"
    // diet was exactly that: 1.5 att/g at a 20.5 ft average); the elbow
    // face-up at ~16 ft is his drilled shot, and his sagging defender
    // must now step up to the FT line to take it away, which is the
    // spacing pressure the mid game really exerts. Rim-runners and bench
    // bigs (mid score 0) still fall through to the dunker as before.
    const midScore = midGreenLight(a) * (a.p.attr.midRange / 100);
    if (
      ek < 2 && midScore >= s.params.ai.pnrMidPopScoreCut &&
      gravity(s, a) < s.params.ai.dunkerGravityThreshold
    ) {
      map.set(a.p.id, elbowKeys[ek++]!);
    } else if (i < 3) {
      map.set(a.p.id, shooterKeys[sk++]!);
    } else {
      // gravity < dunkerGravityThreshold ≈ "the defense will not respect him out there",
      // so he is more useful on the baseline as a lob/putback threat than standing
      // in a corner being ignored (which would clog the spacing he can't use)
      map.set(a.p.id, gravity(s, a) < s.params.ai.dunkerGravityThreshold ? 'dunker' : shooterKeys[sk]!);
    }
  });

  for (const a of players) {
    const key = map.get(a.p.id);
    const pos = key ? byKey.get(key) : undefined;
    if (pos) {
      a.spotKey = key!;
      a.target = { ...pos };
    }
  }
}

/**
 * Per-tick off-ball offense behavior: a priority ladder per player, where
 * rung ORDER is the semantics and every rung ends in `continue` (first match
 * wins): DHO receiver > posting big > screener > active cut > cut trigger >
 * active relocation > relocation trigger > hold the spacing spot.
 */
/**
 * The engine-side athlete gate: does this player's vertical/finishing
 * blend clear the booth's dunk gate? The ONE engine expression of the
 * ai.dunkAthleteGate / dunkBlendVert / dunkBlendFin mirror (params.ai
 * KEEP IN SYNC note; narration's dunkgate-sync.test.ts pins the pair
 * from the outside, since the engine imports nothing): who dunks is who
 * leaks out (leakerOf below) — and the seam for any future engine read
 * that must agree with the booth about who throws it down (#86 takes it
 * for the strong-putback gate). Pure read: no rng, no writes. Extracted
 * byte-identically from leakerOf (`x < g` → `!(x >= g)`, same floats).
 */
export function clearsDunkGate(s: GameState, a: Agent): boolean {
  const A = s.params.ai;
  return A.dunkBlendVert * a.p.attr.vertical + A.dunkBlendFin * a.p.attr.finishing >= A.dunkAthleteGate;
}

/** the designated transition leaker: fastest non-handler whose athlete
 *  blend clears the lob gate (the booth's dunk gate — who leaks is who
 *  finishes). Deterministic: strict > keeps the FIRST of tied speeds in
 *  lineup order. */
function leakerOf(s: GameState, side: TeamSide, holderId: string): string | null {
  let best: Agent | null = null;
  for (const a of liveOnCourt(s, side)) {
    if (a.p.id === holderId) continue;
    if (!clearsDunkGate(s, a)) continue;
    if (!best || sprintSpeed(a.p.attr) > sprintSpeed(best.p.attr)) best = a;
  }
  return best === null ? null : best.p.id;
}

export function offenseOffBallTick(s: GameState): void {
  const side = s.poss.team;
  const rim = attackedRim(s, side);
  // THIS possession's jittered spot table (see rollSpots). The map is filled
  // by assignSpots at possession start; the defensive fallback only covers a
  // degenerate empty map (e.g. a hand-built GameState in a test).
  const byKey = s.poss.spots.size > 0
    ? s.poss.spots
    : new Map(spacingSpots(s.court, rim).map((x) => [x.key, x.pos]));

  actionTick(s);
  const act = s.poss.action;
  const holderId = s.ball.holderId;
  const holder = holderId ? agent(s, holderId) : null;
  // the leak-out designation (session-8, W64 channel 3): computed once per
  // tick, deterministic — the fastest gate-clearing non-handler; lineup
  // iteration order (insertion-deterministic) breaks speed ties via the
  // strict inequality. null while staged, off-phase, or nobody qualifies.
  const leakerId =
    s.params.ai.leakOutScale > 0 && s.poss.phase === 'transition' && holder
      ? leakerOf(s, side, holder.p.id)
      : null;

  for (const a of liveOnCourt(s, side)) {
    if (a.p.id === s.ball.holderId) continue;

    // the DHO receiver sprints AT the hub — the handoff fires on proximity
    // (decideBall's dhoTarget check); reuses the cut intent so his defender
    // trails him into the hub's body
    if (act?.kind === 'dho' && a.p.id === act.receiverId) {
      const hub = agent(s, act.hubId);
      a.intent = 'cut';
      a.target = lerp(hub.pos, a.pos, 0.05);
      a.sprinting = true;
      continue;
    }

    // a posting big holds the block — no cuts, no relocations, just position
    if (act?.kind === 'post' && a.p.id === act.posterId) {
      a.intent = 'spot';
      a.sprinting = false;
      continue;
    }

    // screener on his way to set (or holding) the screen
    if (act?.kind === 'pnr' && a.p.id === act.screenerId && act.phase !== 'finishing') {
      const handler = agent(s, act.handlerId);
      const onBall = assignedDefender(s, handler);
      // set up beside the defender on the handler's side; once there, PLANT
      // (a screen is a stationary pick — grinding into the defender looks
      // like a collision glitch and is an illegal screen anyway)
      const anchor = onBall ? onBall.pos : handler.pos;
      const toHandler = onBall ? norm(sub(handler.pos, onBall.pos)) : { x: 0, y: 1 };
      const spot = add(anchor, scale(toHandler, 1.6));
      a.target = dist(a.pos, spot) < 0.9 ? a.pos : spot;
      a.intent = 'spot';
      a.sprinting = act.phase === 'coming';
      continue;
    }

    // Finish an active cut: drive hard at a point just short of the rim
    // (lerp 0.06 back toward the cutter keeps him from piling onto the hoop).
    if (s.t < a.cutUntil) {
      a.intent = 'cut';
      a.target = lerp(rim, a.pos, 0.06);
      a.sprinting = true;
      continue;
    }

    // occasionally trigger a cut for motion-heavy players. The gates are
    // phase (halfcourt), spot (never the dunker), a tendency-scaled rng
    // roll, and the runway below — there is deliberately NO "lane is open"
    // read here (never has been, since introduction): the cut's value is
    // priced honestly at the catch by the EV core, so a cut into traffic
    // simply doesn't get fed. A DENIED man cuts far more: his defender is
    // top-locked on the ball side (see defenseTick denial), which is
    // exactly when the backdoor is there — the classic counter, and what
    // keeps an all-time shooter's offense alive when the catch is taken
    // away.
    const denyCutMult = gravity(s, a) > s.params.ai.denyGravityCut ? s.params.ai.denyBackdoorMult : 1;
    if (s.poss.phase === 'halfcourt' && a.spotKey !== 'dunker') {
      if (
        s.rng.chance((a.p.tend.offBallMotion / 100) * s.params.ai.cutRateScale * denyCutMult) &&
        // only cut from outside cutRunwayFt — a cut needs runway to be worth anything
        dist(a.pos, rim) > s.params.ai.cutRunwayFt
      ) {
        a.cutUntil = s.t + s.params.ai.cutDurationSec;
        continue;
      }
    } else if (
      // THE DUNKER DIVE (W64): the one spot excluded from ordinary cutting
      // dives exactly when his ball-handler is committed downhill — the
      // dump-off timing. No runway check: the dive IS short by design (the
      // spot sits ~10 ft out and the cut target is the rim). The scale==0
      // short-circuit precedes the rng draw, so the staged default leaves
      // every stream byte-identical to the exclusion era.
      s.poss.phase === 'halfcourt' &&
      s.params.ai.dunkerDiveScale > 0 &&
      holder && s.t < holder.driveUntil &&
      s.rng.chance((a.p.tend.offBallMotion / 100) * s.params.ai.cutRateScale * s.params.ai.dunkerDiveScale)
    ) {
      a.cutUntil = s.t + s.params.ai.cutDurationSec;
      continue;
    }

    // PURPOSEFUL RELOCATION — the second half of stillness-as-default.
    // Spacing is held until the ball bends the defense; then a shooter
    // SHAKES: while a drive is live he drifts away from his defender,
    // restoring the open catch-and-shoot that pure stillness strangled
    // (3PA share pinned at ~24% without it — see params provenance).
    if (s.t < a.relocUntil) {
      // hold the relocated ground while the window lasts (the spot branch
      // below would otherwise walk him straight back and undo the shake).
      // sprinting is preserved from the trigger: a drift walks, a baseline
      // escape RUNS.
      a.intent = 'spot';
      continue;
    }
    if (
      holder && s.poss.phase === 'halfcourt' &&
      a.spotKey !== 'dunker' &&
      gravity(s, a) > s.params.ai.dunkerGravityThreshold &&
      // ordinary shooters shake when a DRIVE bends the defense; a DENIED
      // shooter (top-locked) works on his own schedule — motion is his
      // whole counter, the one player whose perpetual movement is correct
      (s.t < holder.driveUntil || gravity(s, a) > s.params.ai.denyGravityCut) &&
      s.rng.chance(
        gravity(s, a) > s.params.ai.denyGravityCut && s.t >= holder.driveUntil
          ? s.params.ai.relocDeniedRatePerTick // self-scheduled escape: rarer
          : s.params.ai.relocateRatePerTick    // drive-triggered shake
      )
    ) {
      const dfd = assignedDefender(s, a);
      if (dfd) {
        if (gravity(s, a) > s.params.ai.denyGravityCut) {
          // THE TOP-LOCK COUNTER: a denied shooter doesn't drift — he RUNS
          // THE BASELINE to the corner his denier can't shade without
          // losing the ball side. The backdoor CUT (denyCutMult above) is
          // the rim half of the deny answer; this is the relocation half.
          // Without it, denial + stillness crowded the elite benchmark out
          // of his own three-point diet (3PA share 40% vs the 50%+
          // identity gate — fidelity incident, texture increment).
          const cl = byKey.get('corner_l');
          const cr = byKey.get('corner_r');
          const corner = cl && cr ? (dist(cl, dfd.pos) > dist(cr, dfd.pos) ? cl : cr) : (cl ?? cr);
          if (corner) a.target = { ...corner };
          a.sprinting = true;
        } else {
          const away = norm(sub(a.pos, dfd.pos));
          a.target = {
            x: clamp(a.pos.x + away.x * s.params.ai.relocateDriftFt, 2, s.court.length - 2),
            y: clamp(a.pos.y + away.y * s.params.ai.relocateDriftFt, 2, s.court.width - 2)
          };
          a.sprinting = false;
        }
        a.relocUntil = s.t + s.params.ai.relocDurationSec;
        a.intent = 'spot';
        continue;
      }
    }

    // THE TRANSITION LEAK-OUT (W64 channel 3, session-8 arc): on a live
    // rebound or steal — phase 'transition' ONLY, which excludes makes and
    // period openers by construction (possession.ts gives those 'advance';
    // verifier F6) — the designated leaker abandons his spot and runs the
    // far rim at a sprint while the defense is not yet set. Designation is
    // deterministic (fastest gate-clearing non-handler, lineup order breaks
    // ties — no rng). He carries NO cutUntil on the run (the cutter bonus
    // must not subsidize a 60 ft hit-ahead — F5); the stamp lands only
    // inside the finishing radius, where the lob tag and the bonus are
    // honest. leakOutScale is the stage switch, checked FIRST.
    if (
      s.params.ai.leakOutScale > 0 &&
      s.poss.leakArmed &&
      s.poss.phase === 'transition' &&
      a.p.id === leakerId &&
      defendersBack(s, a.side) < s.params.move.transSetBackCount
    ) {
      a.intent = 'cut';
      a.sprinting = true;
      // the same rung-shape as an active cut: target just short of the rim
      a.target = lerp(rim, a.pos, 0.06);
      if (dist(a.pos, rim) <= s.params.ai.leakFinishRadiusFt) {
        // inside the finishing radius the leak IS a cut: the stamp arms the
        // cutter bonus and the chooser's cut_finish pricing for the catch
        a.cutUntil = s.t + s.params.ai.cutDurationSec;
      }
      continue;
    }

    a.intent = 'spot';
    // sprint belongs to TRANSITION; the advance is brought up at a jog
    // (sprinting the advance was half of the perpetual-motion texture bug)
    a.sprinting = s.poss.phase === 'transition';
    const key = a.spotKey ?? 'corner_l';
    const spot = byKey.get(key);
    // stillness-as-default: at the spot means AT the spot — hold the ground,
    // don't micro-chase the pixel (the other half of perpetual motion)
    if (spot) a.target = dist(a.pos, spot) < s.params.move.arrivalDeadbandFt ? a.pos : spot;
  }
}
