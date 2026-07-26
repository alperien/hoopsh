/**
 * Man-to-man defense: size-sorted matchup assignment and the per-tick
 * positioning brain (help rotations, blitzes, drop coverage, on-ball
 * containment gaps, top-lock denial, help-side sag).
 */

import { clamp } from '../../core/rng.js';
import { dist, lerp, norm, scale, sub, add, type V2 } from '../../core/vec.js';
import type { TeamSide } from '../../core/events.js';
import { agent, attackedRim, onCourt, other, type Agent, type GameState } from '../state.js';
import { gravity } from '../resolve.js';

/** assign man matchups: sort both lineups by size and pair them */
export function assignMatchups(s: GameState, defSide: TeamSide): void {
  // same bench-exhausted fallback as assignSpots/bestHandler: when a whole
  // lineup has fouled out (legal with short rosters), play on rather than
  // index into an empty list — `o[...]!` crashed here in the audit fixture
  const pick = (side: TeamSide) => {
    const live = onCourt(s, side).filter((a) => !a.fouledOut);
    return live.length > 0 ? live : onCourt(s, side);
  };
  const defenders = pick(defSide);
  const attackers = pick(other(defSide));
  // Match by size: height plus a weight term (÷12 puts pounds on roughly the
  // same scale as inches, so a 250 lb wing sorts above a 240 lb one of equal
  // height). Crude but produces sane bigs-on-bigs, guards-on-guards pairings.
  const bySize = (arr: Agent[]) =>
    [...arr].sort((a, b) => (b.p.heightIn + b.p.weightLb / 12) - (a.p.heightIn + a.p.weightLb / 12));
  const d = bySize(defenders);
  const o = bySize(attackers);
  for (let i = 0; i < d.length; i++) {
    d[i]!.manId = o[Math.min(i, o.length - 1)]!.p.id;
  }
}

/** per-tick defensive positioning */
export function defenseTick(s: GameState): void {
  const defSide = other(s.poss.team);
  const rim = defendedRimOf(s, defSide);
  const holderId = s.ball.holderId;
  const holder = holderId ? agent(s, holderId) : null;
  const helpAggr = s.teams[defSide].tactics.helpAggr / 100;
  const A = s.params.ai;

  // is a help rotation warranted? Drives trigger it, and so does a live
  // post-up being worked on the block — the double-team is what turns the
  // post into a passing hub (help leaves a shooter; the poster sprays)
  const actD = s.poss.action;
  const postWorking =
    holder !== null && actD?.kind === 'post' &&
    actD.posterId === holder.p.id && actD.phase === 'working';
  // the blitz: an extreme-gravity HOLDER beyond the arc draws a second body —
  // denial's on-ball sibling, and what actually caps elite pull-up volume
  // (the fidelity benchmark kept 15+ deep attempts against single coverage)
  const blitz =
    holder !== null && gravity(s, holder) > A.denyGravityCut &&
    dist(holder.pos, rim) > A.blitzBeyondFt;
  let helper: Agent | null = null;
  if (holder && (s.t < holder.driveUntil || postWorking || blitz)) {
    const dRim = dist(holder.pos, rim);
    if (dRim < s.params.move.helpTriggerFt) {
      // nearest weak-side defender whose man has the least gravity
      let bestScore = Infinity;
      for (const d of onCourt(s, defSide)) {
        if (d.fouledOut || !d.manId || d.manId === holder.p.id) continue;
        // Pick the helper: closest to the rim, but STRONGLY penalized for
        // leaving a shooter (gravity × 26 ft-equivalent). This is the real
        // help-defense dilemma — you rotate off the worst shooter, and elite
        // shooters effectively can't be helped off of. helpAggr scales how
        // much a team tolerates the risk.
        const man = agent(s, d.manId);
        // helperGravityCeil: the gravity-penalty factor at helpAggr=0 (maximum
        // reluctance), dropping to ceil−1 at helpAggr=1.0 — full aggression
        // still avoids leaving elite shooters open but rotates off of
        // average-gravity players much more willingly.
        const score = dist(d.pos, rim) + gravity(s, man) * A.helperGravityWeight * (A.helperGravityCeil - helpAggr);
        if (score < bestScore) { bestScore = score; helper = d; }
      }
    }
  }

  for (const d of onCourt(s, defSide)) {
    if (d.fouledOut) continue;
    d.intent = 'defend';
    d.sprinting = false;
    const man = d.manId ? agent(s, d.manId) : null;
    if (!man) { d.target = lerp(rim, s.ball.pos, 0.4); continue; }

    if (helper && d.p.id === helper.p.id && holder) {
      if (blitz && s.t >= holder.driveUntil) {
        // blitz: close on the HOLDER, slightly rim-side — a stunting second
        // body that turns his pull-up into a contested look and invites the
        // pass out (assists rise league-wide; that's the point)
        d.target = lerp(holder.pos, rim, 0.08);
        d.sprinting = true;
        continue;
      }
      // rotate to the rim, shaded 22% up the drive path — meet the driver at
      // the front of the rim rather than standing under the basket
      d.target = lerp(rim, holder.pos, 0.22);
      d.sprinting = true;
      continue;
    }

    // pick-and-roll drop coverage: the screener's defender protects the paint
    const act = s.poss.action;
    if (act && act.kind === 'pnr' && act.phase !== 'coming' && man.p.id === act.screenerId && holder) {
      const dRim = Math.max(1, dist(holder.pos, rim));
      d.target = lerp(rim, holder.pos, clamp(A.pnrDropDepthFt / dRim, 0, 0.85));
      continue;
    }

    const onBall = holder !== null && man.p.id === holder.p.id;
    if (onBall && holder) {
      // shooting threat CLOSES the gap; drive threat OPENS it — you play a
      // downhill freight train from depth and concede the pull-up (this is
      // why a 92-drive point-forward gets his ~5 threes a game: they're
      // given, not taken; without it his pull-up never fired at 0.7 attempts)
      const driveThreat = (man.p.tend.drive / 100) * (man.p.attr.speed / 100);
      let gap = Math.max(
        2.2,
        s.params.move.defGapBaseFt - gravity(s, man) * s.params.move.defGapGravityFt
          + driveThreat * s.params.move.defGapDriveFt
      );
      // ducking under a screen: drop back, concede the pull-up
      if (s.t < d.navUnderUntil) gap += A.pnrUnderSagFt;
      const toRim = norm(sub(rim, holder.pos));
      d.target = add(holder.pos, scale(toRim, gap));
      // closeout: sprint when caught out of position (e.g. after a swing pass)
      d.sprinting = dist(d.pos, holder.pos) > gap + A.closeoutSlackFt;
      // beaten on a drive: chase the intercept point
      // Beaten on a drive: abandon the cushion and chase the intercept point
      // 30% of the way to the rim — trail the drive rather than the man.
      if (s.t < holder.driveUntil) {
        d.target = lerp(holder.pos, rim, 0.3);
        d.sprinting = true;
      }
      continue;
    }

    // off-ball: guard the man-rim line, sagging with ball distance & low gravity
    const g = gravity(s, man);
    // DENIAL: an all-time shooter doesn't get guarded, he gets denied — above
    // the gravity threshold the defender shades onto the man-BALL line (top-
    // lock) to take the catch away instead of protecting the drive line.
    // This is what actually caps an elite shooter's volume in real basketball:
    // the fidelity harness's 0.98-gravity benchmark took 22+ threes because
    // openness-priced passes kept finding him — denial prices the pass lane
    // itself (passRisk's lane occlusion reads the defender's position, so
    // feeds to a denied man become genuinely riskier and teammates benefit).
    if (g > A.denyGravityCut && s.ball.holderId && s.ball.holderId !== man.p.id) {
      const toBall = norm(sub(s.ball.pos, man.pos));
      d.target = add(man.pos, scale(toBall, A.denyDistFt));
      continue;
    }
    const guardDist = A.guardDistBase + (1 - g) * A.guardDistOpen;
    const manToRim = norm(sub(rim, man.pos));
    // Stand on the man-rim line at guardDist — but never more than halfway to
    // the rim, or a defender guarding someone in the corner ends up under the
    // basket instead of between his man and it.
    const basePoint = add(man.pos, scale(manToRim, Math.min(guardDist, dist(man.pos, rim) * 0.5)));
    const ballDist = dist(man.pos, s.ball.pos);
    const sag = clamp((ballDist - A.sagStartFt) / A.sagRangeFt, 0, A.sagMax)
      * (1 - g * A.sagGravityCut) * (0.6 + helpAggr * 0.6);
    const helpSpot = lerp(rim, s.ball.pos, A.helpSpotPull);
    d.target = lerp(basePoint, helpSpot, sag);
  }
}

function defendedRimOf(s: GameState, defSide: TeamSide): V2 {
  return attackedRim(s, other(defSide));
}
