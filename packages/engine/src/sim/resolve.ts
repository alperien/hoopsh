/**
 * Probabilistic resolution models: shooting, contests, passing, rebounds, fouls.
 *
 * Design rule: the SAME predictor that resolves outcomes is used by the AI to
 * *select* actions (shot quality = predicted EV), so decision-making and
 * resolution can never drift apart. Every constant comes from SimParams.
 */

import { sigmoid, clamp } from '../core/rng.js';
import { dist, type V2 } from '../core/vec.js';
import { n, reachFt, sprintSpeed } from '../model/derived.js';
import type { ShotMoveType, ShotZone, TeamSide } from '../core/events.js';
import { classifyShot } from '../geometry/court.js';
import {
  agent, attackedRim, onCourt, other,
  type Agent, type GameState
} from './state.js';

// ---------- contests ----------

export interface Contest {
  level: number; // 0 wide open .. 1 smothered
  by: string | null;
  heightAdvFt: number; // shooter reach minus best contester reach (ft)
}

/** contest level on a shot released by `shooter` at `pos` */
export function contestAt(s: GameState, shooter: Agent, pos: V2): Contest {
  const radius = s.params.move.contestRadiusFt;
  const rim = attackedRim(s, shooter.side);
  let best = 0;
  let by: string | null = null;
  let bestReach = 0;
  for (const d of onCourt(s, other(shooter.side))) {
    if (d.fouledOut) continue;
    const dd = dist(d.pos, pos);
    if (dd > radius) continue;
    // contest = proximity × technique × availability
    //  closing: linear falloff — a defender ON the shooter contests 1.0, one at
    //           the radius edge contests ~0. Distance is the dominant term.
    const closing = 1 - dd / radius;
    //  skill: technique blended with role defense — interiorD when the defender
    //         is protecting the rim area, perimeterD outside (move.contestDBlend
    //         sets the mix). 0.55 floor: presence alone bothers a shot.
    const nearRim = dist(d.pos, rim) < s.params.move.nearRimFt;
    const roleD = nearRim ? d.p.attr.interiorD : d.p.attr.perimeterD;
    const blend = s.params.move.contestDBlend;
    const defSkill = d.p.attr.contestSkill * (1 - blend) + roleD * blend;
    const skill = s.params.ai.contestSkillFloor + s.params.ai.contestSkillRange * (defSkill / 100);
    //  stunned: caught on a screen → he's there but badly out of position. A
    //  stunned defender still bothers the shot (45% of normal contest) because
    //  he is physically present — he just can't properly contest.
    //  0.45 = FEEL: tuned so a PnR pull-up is visibly better than a normal
    //  one, but not automatic (the screen stun already costs pnrStunOverSec
    //  seconds of defensive recovery). Kept inline: it is the stun multiplier
    //  defined by the pnr mechanic and would only be meaningful as a param
    //  paired with pnrStun*Sec — a future consolidation candidate.
    const stunned = s.t < d.screenStunUntil ? 0.45 : 1;
    const level = closing * skill * stunned;
    if (level > best) {
      best = level;
      by = d.p.id;
      bestReach = reachFt(d.p);
    }
  }
  // 0.5 ft uncontested height advantage: shooting over nobody is like shooting
  // over someone slightly shorter — a mild positive that prevents the height
  // term from swinging negative on unguarded makes (geometry, not behavioral).
  const heightAdvFt = by ? reachFt(shooter.p) - bestReach : 0.5;
  return { level: clamp(best, 0, 1), by, heightAdvFt };
}

/**
 * Contest the shooter should EXPECT at release: defenders' positions are
 * projected ahead by the shot windup, so a flying closeout discourages the
 * catch-and-shoot even though the defender hasn't arrived yet. Good shooters
 * account for the man sprinting at them — so should the AI.
 */
export function anticipatedContest(
  s: GameState,
  shooter: Agent,
  pos: V2,
  windupSec: number
): Contest {
  const radius = s.params.move.contestRadiusFt;
  const rim = attackedRim(s, shooter.side);
  let best = 0;
  let by: string | null = null;
  let bestReach = 0;
  for (const d of onCourt(s, other(shooter.side))) {
    if (d.fouledOut) continue;
    // project the defender forward by windupProjShare of the windup: he closes
    // ground while the shooter gathers, but not perfectly (he must also
    // decelerate to contest rather than run past). The share keeps anticipation
    // honest rather than clairvoyant.
    const lead = windupSec * s.params.ai.windupProjShare;
    const proj = {
      x: d.pos.x + d.vel.x * lead,
      y: d.pos.y + d.vel.y * lead
    };
    const dd = Math.min(dist(d.pos, pos), dist(proj, pos));
    if (dd > radius) continue;
    const closing = 1 - dd / radius;
    // same role-defense blend as contestAt so anticipation and resolution use
    // one skill definition (interiorD near the rim, perimeterD outside)
    const nearRim = dist(d.pos, rim) < s.params.move.nearRimFt;
    const roleD = nearRim ? d.p.attr.interiorD : d.p.attr.perimeterD;
    const blend = s.params.move.contestDBlend;
    const defSkill = d.p.attr.contestSkill * (1 - blend) + roleD * blend;
    const skill = s.params.ai.contestSkillFloor + s.params.ai.contestSkillRange * (defSkill / 100);
    const stunned = s.t < d.screenStunUntil ? 0.45 : 1; // same stun multiplier as contestAt (see above)
    const level = closing * skill * stunned;
    if (level > best) {
      best = level;
      by = d.p.id;
      bestReach = reachFt(d.p);
    }
  }
  const heightAdvFt = by ? reachFt(shooter.p) - bestReach : 0.5; // same uncontested default as contestAt
  return { level: clamp(best, 0, 1), by, heightAdvFt };
}

// ---------- shooting ----------

export function zoneSkill(a: Agent, zone: ShotZone): number {
  switch (zone) {
    case 'rim': return a.p.attr.finishing;
    // the in-between game is touch, not power: midRange-dominant blend.
    // This is WHY sagging off non-shooters works — a rim-runner's open
    // 9-foot floater is a win for the defense, not the offense.
    case 'paint': return a.p.attr.finishing * 0.35 + a.p.attr.midRange * 0.65;
    case 'mid': return a.p.attr.midRange;
    case 'three': return a.p.attr.three;
  }
}

/** probability the shot goes in — the engine's most calibrated formula */
export function shotMakeP(
  s: GameState,
  shooter: Agent,
  zone: ShotZone,
  distFt: number,
  moveType: ShotMoveType,
  contest: Contest,
  /** prospective delivery quality (n-space) — decideBall passes the HOLDER's
   *  own delivery when valuing a pass; resolution omits it and the shooter's
   *  actual catchQuality (stamped at the catch) is used */
  catchQ?: number
): number {
  const P = s.params.shot;
  const base =
    zone === 'rim' ? P.baseRim :
    zone === 'paint' ? P.basePaint :
    zone === 'mid' ? P.baseMid : P.baseThree;

  const skillCoef = zone === 'three' ? P.skillCoefThree : P.skillCoef;
  const skill = skillCoef * n(zoneSkill(shooter, zone));

  const contestTerm = P.contestCoef * (contest.level - P.contestMidpoint);

  const moveAdj =
    moveType === 'pull_up' ? P.movePullUp :
    moveType === 'drive' ? P.moveDrive :
    moveType === 'cut_finish' ? P.moveCutFinish :
    moveType === 'post' ? P.movePost :
    moveType === 'putback' ? P.movePutback :
    moveType === 'heave' ? P.moveHeave : 0;

  // deep threes get harder past the line; rim shots get harder away from point-blank
  // Within-zone distance penalties (the zone bases cover the typical shot;
  // these handle the tails):
  //  • threes: each foot beyond distPenaltyThreeFt costs distPenaltyThreePerFt logits
  //    ≈ 1.3 percentage points, so a 30-footer is ~9 points worse than a corner three.
  //    Matches the real falloff on deep attempts.
  //  • rim: distPenaltyRimPerFt/ft from point-blank out to the 4 ft zone edge —
  //    a dunk and a 4-foot floater are genuinely different shots.
  const distAdj =
    zone === 'three' ? -P.distPenaltyThreePerFt * Math.max(0, distFt - P.distPenaltyThreeFt) :
    zone === 'rim' ? -P.distPenaltyRimPerFt * distFt : 0;

  // Size only matters at the rim (a 7-footer's reach is irrelevant on a
  // jumper). Clamped to ±1.5 ft of standing-reach advantage so extreme
  // mismatches stay believable rather than automatic.
  const heightTerm = zone === 'rim' ? P.rimHeightCoef * clamp(contest.heightAdvFt, -1.5, 1.5) : 0;

  const fatigue = P.fatigueCoef * (1 - shooter.energy / 100);

  // "on time, on target": a catch-and-shoot rides the DELIVERY — an elite
  // passer's ball arrives in the shooting pocket and the rise is easier.
  // This is what routes assists toward passing QUALITY (a table-setter's
  // kicks convert; a swing hub's do not) and why teammates measurably shoot
  // better next to a great passer. Self-created shots get zero by moveType.
  // ...CENTERED on league-typical delivery: an average pass neither helps
  // nor hurts, an elite one arrives in the pocket, a sloppy one costs the
  // catch. Uncentered, the term added a positive league-wide offset (typical
  // deliverers sit at n ≈ +0.15) and heated every catch-and-shoot in the
  // league — which forced the coefficient down and erased the passer spread
  // the term exists to create (mean belongs to the bands; spread to skills).
  const passQ = moveType === 'catch_shoot'
    ? P.passQualityCoef * ((catchQ ?? shooter.catchQuality) - P.passQualityCenter)
    : 0;

  return sigmoid(base + skill + contestTerm + moveAdj + distAdj + heightTerm + fatigue + passQ);
}

/** expected points for a shot from here, including free-throw EV — used by the AI */
export function shotEV(
  s: GameState,
  shooter: Agent,
  pos: V2,
  moveType: ShotMoveType,
  contest: Contest,
  catchQ?: number
): { ev: number; p: number; zone: ShotZone; three: boolean; distFt: number } {
  const rim = attackedRim(s, shooter.side);
  const loc = classifyShot(s.rules, s.court, rim, pos);
  const p = shotMakeP(s, shooter, loc.zone, loc.distFt, moveType, contest, catchQ);
  const pts = loc.three ? 3 : 2;
  const pFoul = shootingFoulP(s, shooter, loc.zone, contest);
  const ftP = freeThrowP(s, shooter);
  // Foul EV: drawing a shooting foul on a MISS converts the possession into
  // 2 (or 3) free throws. On a make it's an and-one worth only 1 FT, which is
  // why this is weighted by (1 - p) — a deliberate simplification that keeps
  // the foul-hunting incentive roughly right without double-counting and-ones.
  const ftEV = pFoul * (loc.three ? 3 : 2) * ftP * (1 - p);
  return { ev: p * pts + ftEV, p, zone: loc.zone, three: loc.three, distFt: loc.distFt };
}

export function freeThrowP(s: GameState, shooter: Agent): number {
  const P = s.params.shot;
  // linear base + swing, plus an elite kick above rating 80 (n > 0.6): a
  // purely linear model provably cannot express the league mean (~78%) and
  // the elite tail (88-91%) at once — the volume-weighted league shooter is
  // already rating ~85+, so the tail needs its own curvature (fidelity
  // incident: a 99-rated benchmark capped at 83%).
  const nv = n(shooter.p.attr.freeThrow);
  const elite = Math.max(0, (nv - 0.6) / 0.4) * P.ftEliteKick;
  return clamp(P.ftBasePct + P.ftSkillSwing * nv + elite, 0.3, 0.98);
}

/** chance a rim/paint miss is credited as a block by the best contester */
export function blockP(s: GameState, zone: ShotZone, contest: Contest): number {
  if (contest.by === null || (zone !== 'rim' && zone !== 'paint')) return 0;
  const blocker = agent(s, contest.by);
  const P = s.params.shot;
  // Only would-be misses reach here, so this reallocates misses → blocks
  // without touching FG% calibration. Scaled by contest level (you can't block
  // what you aren't near) and capped at blockCap so even Gobert doesn't erase
  // every contested miss. blockGain and blockSkillWeight are tuned to hit
  // the 3.5-6.5 blocks/game band.
  const skill = P.blockSkillCoef * n(blocker.p.attr.block);
  return clamp((P.blockBase + skill * P.blockSkillWeight) * contest.level * P.blockGain, 0, P.blockCap);
}

// ---------- fouls ----------

export function shootingFoulP(
  s: GameState,
  shooter: Agent,
  zone: ShotZone,
  contest: Contest
): number {
  const F = s.params.foul;
  const base =
    zone === 'rim' ? F.shootRim :
    zone === 'paint' ? F.shootPaint :
    zone === 'mid' ? F.shootMid : F.shootThree;
  // Three multiplicative factors on the zone base:
  //  contestMult — tight contests mean contact (1.0 → contestFactor)
  //  draw        — foul-drawing craft: elite draws ~65% more whistles than
  //                average, a passive player ~35% fewer. This is the single
  //                biggest driver of individual FTA differences.
  //  aggr        — the DEFENDER's foulAggr tendency: hackers foul ~50% more
  const contestMult = 1 + (F.contestFactor - 1) * contest.level;
  const draw = 1 + 0.65 * n(shooter.p.attr.drawFoul);
  let aggr = 1;
  if (contest.by) {
    aggr = 1 + 0.5 * n(agent(s, contest.by).p.tend.foulAggr);
  }
  // hard cap 60%: even a hack-a-Shaq scenario leaves some chance of a clean play
  return clamp(base * contestMult * draw * aggr, 0, 0.6);
}

// ---------- passing ----------

export interface PassRisk {
  turnoverP: number;
  /** most threatening lane defender (steal candidate) */
  dangerId: string | null;
}

export function passRisk(s: GameState, from: Agent, to: Agent): PassRisk {
  const P = s.params.pass;
  // lane occlusion: defenders near the segment, weighted by closeness to the lane
  let occlusion = 0;
  let dangerId: string | null = null;
  let dangerScore = -1;
  const a = from.pos;
  const b = to.pos;
  const passLen = Math.max(4, dist(a, b));
  for (const d of onCourt(s, other(from.side))) {
    if (d.fouledOut) continue;
    // Lane occlusion: how badly defenders clog the passing line.
    // laneDangerFt is the reach-plus-step envelope around a pass lane — beyond
    // that a defender is irrelevant to this pass.
    const dLane = distToLane(a, b, d.pos);
    if (dLane > P.laneDangerFt) continue;
    const along = clamp(1 - dLane / P.laneDangerFt, 0, 1);
    // steal rating 0→0.5, 100→1.0: anyone in the lane is a hazard; ball-hawks
    // are twice the hazard
    const stealSkill = 0.5 + 0.5 * (d.p.attr.steal / 100);
    const contribution = along * stealSkill;
    // laneOcclusionDamp keeps multiple loose defenders from stacking into certainty
    occlusion += contribution * P.laneOcclusionDamp;
    if (contribution > dangerScore) {
      dangerScore = contribution;
      dangerId = d.p.id;
    }
  }
  // long cross-court passes are riskier
  // Cross-court passes are riskier: beyond longPassFt, each extra 10 ft adds
  // longPassPer10Ft logits. Long skip passes hang in the air — real turnover source.
  const lengthTerm = P.longPassPer10Ft * Math.max(0, passLen - P.longPassFt) / 10;
  const skillTerm = P.skillCoef * ((n(from.p.attr.passAcc) + n(from.p.attr.passVision)) / 2);
  const logit = P.riskBase + P.laneRiskCoef * clamp(occlusion, 0, 1.6) + lengthTerm - skillTerm;
  return { turnoverP: sigmoid(logit), dangerId };
}

function distToLane(a: V2, b: V2, p: V2): number {
  // distance from p to segment a-b
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-9) return dist(a, p);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = clamp(t, 0, 1);
  return dist(p, { x: a.x + abx * t, y: a.y + aby * t });
}

// ---------- rebounding ----------

/** sample where a missed shot lands */
export function sampleMissLanding(s: GameState, rim: V2, shotDistFt: number): V2 {
  const R = s.params.reb;
  // Long shots rebound long (well-documented in tracking data) — this is why
  // three-heavy games produce more guard rebounds and longer scrambles.
  const mean = R.missDistBase + R.missDistCoef * shotDistFt;
  // reboundSpreadFactor × mean relative spread: rebounds cluster near the mean
  // but with a real tail; floor of 1 ft prevents a degenerate on-rim sample.
  const d = Math.max(1, s.rng.gaussian(mean, mean * R.reboundSpreadFactor));
  const angle = s.rng.range(0, Math.PI * 2);
  const raw = { x: rim.x + Math.cos(angle) * d, y: rim.y + Math.sin(angle) * d };
  return {
    x: clamp(raw.x, 2, s.court.length - 2),
    y: clamp(raw.y, 2, s.court.width - 2)
  };
}

/** weighted scramble: who comes down with a live rebound at `spot` */
export function resolveRebound(
  s: GameState,
  spot: V2,
  offSide: TeamSide
): Agent {
  const R = s.params.reb;
  const candidates: Agent[] = [];
  const weights: number[] = [];
  for (const side of [0, 1] as TeamSide[]) {
    for (const a of onCourt(s, side)) {
      if (a.fouledOut) continue;
      // beyond reboundCutoffFt you're not getting to this rebound
      const d = dist(a.pos, spot);
      if (d > R.reboundCutoffFt) continue;
      // Proximity dominates (1/(1+d)^power) — rebounding is mostly positioning
      const prox = 1 / Math.pow(1 + d, R.proximityPower);
      const attr = a.p.attr;
      // Offense vs defense reward DIFFERENT skills, which is the whole
      // asymmetry of the glass: the offense needs pursuit and hops (offReb,
      // vertical) because it's attacking from behind; the defense wins by
      // owning the space first (defReb, boxout). Height enters both at 0.6
      // per inch — dominant in absolute terms, as it should be.
      // skill-forward weights: height matters, but at 0.6/inch it flattened
      // the spread — every 7-footer rated within ~10% regardless of craft,
      // and an all-league rebounder read as ordinary (fidelity incident:
      // a 97-defReb/92-boxout center pulled 7.5 boards). Rebounding is a
      // zero-sum lottery, so re-weighting redistributes WHO rebounds without
      // moving league totals.
      // FEEL — these six rating blend weights shape who wins each scramble:
      //   offense: offReb×0.8 (pursuit) + vertical×0.3 (hops) + height×0.45/in
      //   defense: defReb×0.7 (positioning) + boxout×0.35 (sealing) +
      //            vertical×0.12 (tipped reach) + height×0.45/in
      // Kept inline because the six values are a coupled set; splitting them
      // into six separate params without also separating offensive vs defensive
      // paths would make the API harder to reason about without adding sweep
      // value. Migration candidate if the reb model is ever re-tuned.
      const rebSkill = a.side === offSide
        ? attr.offReb * 0.8 + attr.vertical * 0.3 + a.p.heightIn * 0.45
        : attr.defReb * 0.7 + attr.boxout * 0.35 + attr.vertical * 0.12 + a.p.heightIn * 0.45;
      const sideMult = a.side === offSide ? R.offWeightMult : 1;
      candidates.push(a);
      weights.push(prox * rebSkill * sideMult);
    }
  }
  if (candidates.length === 0) {
    // nobody near (shouldn't happen) — closest player gets it. Prefer players
    // who haven't fouled out: the main loop filters them, and this fallback
    // handing a ghost actor the ball was an audited invariant violation in
    // the bench-exhausted degenerate state.
    const all = [...onCourt(s, 0), ...onCourt(s, 1)];
    const live = all.filter((x) => !x.fouledOut);
    const pool = live.length > 0 ? live : all;
    pool.sort((x, y) => dist(x.pos, spot) - dist(y.pos, spot));
    return pool[0]!;
  }
  return candidates[s.rng.weighted(weights)]!;
}

// ---------- openness (shared by AI) ----------

/** 0 = smothered .. 1 = wide open, from the shooter's perspective right now */
export function openness(s: GameState, a: Agent): number {
  return 1 - contestAt(s, a, a.pos).level;
}

/** shooter gravity: how far out and how tightly a defense must respect this player */
/**
 * Shooter gravity ∈ [0,1] — how much respect the defense must pay this player
 * beyond the arc. The single most important derived quantity for SPACING:
 * it shrinks the on-ball gap defenders keep, reduces how far help defenders
 * sag off, and steers help rotations away from shooters.
 *
 * Weighted gravityThreeWeight ABILITY / gravityTendWeight WILLINGNESS on purpose:
 * a great shooter who never shoots eventually gets ignored, and a volume gunner
 * who can't shoot still commands *some* attention. Both terms are needed — this
 * is why "Curry-ness" requires elite `three` AND heavy `shotThree`.
 */
export function gravity(s: GameState, a: Agent): number {
  const A = s.params.ai;
  return clamp((a.p.attr.three / 100) * A.gravityThreeWeight + (a.p.tend.shotThree / 100) * A.gravityTendWeight, 0, 1);
}

/** rough top speed available right now, accounting for fatigue */
export function currentMaxSpeed(s: GameState, a: Agent): number {
  const f = s.params.fatigue;
  const energyMult = f.minSpeedMult + (1 - f.minSpeedMult) * (a.energy / 100);
  return sprintSpeed(a.p.attr) * energyMult;
}
