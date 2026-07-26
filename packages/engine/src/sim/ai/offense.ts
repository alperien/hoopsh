/**
 * Off-ball offense: spacing-spot assignment, per-tick movement (cuts, DHO
 * sprints, screen setting, relocations), and the both-sides reaction to a
 * shot going up (crash / box out / get back — the boxout half steers the
 * DEFENSE, but the trigger is the offense's shot, so it lives here with it).
 */

import { dist, lerp, norm, scale, sub, add } from '../../core/vec.js';
import { spacingSpots } from '../../geometry/court.js';
import type { TeamSide } from '../../core/events.js';
import { agent, attackedRim, onCourt, other, type GameState } from '../state.js';
import { gravity } from '../resolve.js';
import { assignedDefender } from './shared.js';
import { actionTick } from './actions.js';

/** react to a shot going up: crash the boards, box out, or get back on D */
export function onShotReleased(s: GameState, offSide: TeamSide): void {
  const rim = attackedRim(s, offSide);
  for (const a of onCourt(s, offSide)) {
    if (a.fouledOut) continue;
    const near = dist(a.pos, rim) < s.params.ai.crashNearFt;
    const crash = near && s.rng.chance(
      s.params.ai.crashBase + (a.p.tend.crashOffReb / 100) * s.params.ai.crashTendScale
    );
    if (crash) {
      a.intent = 'crash';
      a.target = { x: rim.x + s.rng.range(-5, 5), y: rim.y + s.rng.range(-5, 5) };
      a.sprinting = true;
    } else {
      a.intent = 'getback';
      a.target = lerp(attackedRim(s, other(offSide)), s.court.rims[rim.x > s.court.midX ? 0 : 1]!, 0.55);
      a.sprinting = false;
    }
  }
  for (const d of onCourt(s, other(offSide))) {
    if (d.fouledOut) continue;
    const man = d.manId ? s.agents.get(d.manId) : null;
    if (man && dist(man.pos, rim) >= 20) {
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
    d.target = man && dist(man.pos, rim) < 20
      ? lerp(man.pos, rim, 0.45) // box out between man and rim
      : lerp(d.pos, rim, 0.5);
  }
}

// ------------------------------------------------------------ offense setup

/** assign spacing spots for the possession by personnel */
export function assignSpots(s: GameState, side: TeamSide): void {
  const rim = attackedRim(s, side);
  const spots = spacingSpots(s.court, rim);
  const byKey = new Map(spots.map((x) => [x.key, x.pos]));
  // bench exhausted and every on-court player fouled out: play on with who's
  // out there rather than crashing (mirrors bestHandler — NBA rule analog: a
  // fouled-out player remains when no substitute exists; custom short rosters
  // are legal input, and the adversarial audit produced this state at default
  // params with a foul-prone no-bench fixture)
  const eligible = onCourt(s, side).filter((a) => !a.fouledOut);
  const players = eligible.length > 0 ? eligible : onCourt(s, side);

  // ball handler (best handle) takes the top; shooters fill wings/corners;
  // the worst shooter lives at the dunker spot
  // Best handler initiates from the top; everyone else fills by gravity —
  // shooters get the wings and corners (where their gravity stretches the
  // defense), the lowest-gravity big goes to the dunker spot.
  const sorted = [...players].sort((a, b) => b.p.attr.ballHandle - a.p.attr.ballHandle);
  const handler = sorted[0]!;
  const rest = sorted.slice(1).sort((a, b) => gravity(s, b) - gravity(s, a));

  const map = s.poss.spotMap;
  map.clear();
  map.set(handler.p.id, 'top');
  const shooterKeys = ['wing_l', 'wing_r', 'corner_l', 'corner_r'];
  rest.forEach((a, i) => {
    if (i < 3) {
      map.set(a.p.id, shooterKeys[i]!);
    } else {
      // gravity < dunkerGravityThreshold ≈ "the defense will not respect him out there",
      // so he is more useful on the baseline as a lob/putback threat than standing
      // in a corner being ignored (which would clog the spacing he can't use)
      map.set(a.p.id, gravity(s, a) < s.params.ai.dunkerGravityThreshold ? 'dunker' : shooterKeys[3]!);
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

/** per-tick off-ball offense behavior */
export function offenseOffBallTick(s: GameState): void {
  const side = s.poss.team;
  const rim = attackedRim(s, side);
  const spots = spacingSpots(s.court, rim);
  const byKey = new Map(spots.map((x) => [x.key, x.pos]));

  actionTick(s);
  const act = s.poss.action;

  for (const a of onCourt(s, side)) {
    if (a.fouledOut || a.p.id === s.ball.holderId) continue;

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

    // occasionally trigger a cut for motion-heavy players when the lane is
    // open. A DENIED man cuts far more: his defender is top-locked on the
    // ball side (see defenseTick denial), which is exactly when the backdoor
    // is there — the classic counter, and what keeps an all-time shooter's
    // offense alive when the catch is taken away.
    const denyCutMult = gravity(s, a) > s.params.ai.denyGravityCut ? s.params.ai.denyBackdoorMult : 1;
    if (
      s.poss.phase === 'halfcourt' &&
      a.spotKey !== 'dunker' &&
      s.rng.chance((a.p.tend.offBallMotion / 100) * s.params.ai.cutRateScale * denyCutMult) &&
      // only cut from outside cutRunwayFt — a cut needs runway to be worth anything
      dist(a.pos, rim) > s.params.ai.cutRunwayFt
    ) {
      a.cutUntil = s.t + s.params.ai.cutDurationSec;
      continue;
    }

    a.intent = 'spot';
    a.sprinting = s.poss.phase !== 'halfcourt';
    const key = a.spotKey ?? 'corner_l';
    const spot = byKey.get(key);
    if (spot) a.target = spot;
  }
}
