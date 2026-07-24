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
  let best = 0;
  let by: string | null = null;
  let bestReach = 0;
  for (const d of onCourt(s, other(shooter.side))) {
    if (d.fouledOut) continue;
    const dd = dist(d.pos, pos);
    if (dd > radius) continue;
    const closing = 1 - dd / radius;
    const skill = 0.55 + 0.45 * (d.p.attr.contestSkill / 100);
    const stunned = s.t < d.screenStunUntil ? 0.45 : 1;
    const level = closing * skill * stunned;
    if (level > best) {
      best = level;
      by = d.p.id;
      bestReach = reachFt(d.p);
    }
  }
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
  let best = 0;
  let by: string | null = null;
  let bestReach = 0;
  for (const d of onCourt(s, other(shooter.side))) {
    if (d.fouledOut) continue;
    const lead = windupSec * 0.8;
    const proj = {
      x: d.pos.x + d.vel.x * lead,
      y: d.pos.y + d.vel.y * lead
    };
    const dd = Math.min(dist(d.pos, pos), dist(proj, pos));
    if (dd > radius) continue;
    const closing = 1 - dd / radius;
    const skill = 0.55 + 0.45 * (d.p.attr.contestSkill / 100);
    const stunned = s.t < d.screenStunUntil ? 0.45 : 1;
    const level = closing * skill * stunned;
    if (level > best) {
      best = level;
      by = d.p.id;
      bestReach = reachFt(d.p);
    }
  }
  const heightAdvFt = by ? reachFt(shooter.p) - bestReach : 0.5;
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
  contest: Contest
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
  const distAdj =
    zone === 'three' ? -0.055 * Math.max(0, distFt - 23) :
    zone === 'rim' ? -0.09 * distFt : 0;

  const heightTerm = zone === 'rim' ? P.rimHeightCoef * clamp(contest.heightAdvFt, -1.5, 1.5) : 0;

  const fatigue = P.fatigueCoef * (1 - shooter.energy / 100);

  return sigmoid(base + skill + contestTerm + moveAdj + distAdj + heightTerm + fatigue);
}

/** expected points for a shot from here, including free-throw EV — used by the AI */
export function shotEV(
  s: GameState,
  shooter: Agent,
  pos: V2,
  moveType: ShotMoveType,
  contest: Contest
): { ev: number; p: number; zone: ShotZone; three: boolean; distFt: number } {
  const rim = attackedRim(s, shooter.side);
  const loc = classifyShot(s.rules, s.court, rim, pos);
  const p = shotMakeP(s, shooter, loc.zone, loc.distFt, moveType, contest);
  const pts = loc.three ? 3 : 2;
  const pFoul = shootingFoulP(s, shooter, loc.zone, contest);
  const ftP = freeThrowP(s, shooter);
  const ftEV = pFoul * (loc.three ? 3 : 2) * ftP * (1 - p); // crude: foul mostly matters on misses
  return { ev: p * pts + ftEV, p, zone: loc.zone, three: loc.three, distFt: loc.distFt };
}

export function freeThrowP(s: GameState, shooter: Agent): number {
  const P = s.params.shot;
  return clamp(P.ftBasePct + P.ftSkillSwing * n(shooter.p.attr.freeThrow), 0.3, 0.98);
}

/** chance a rim/paint miss is credited as a block by the best contester */
export function blockP(s: GameState, zone: ShotZone, contest: Contest): number {
  if (contest.by === null || (zone !== 'rim' && zone !== 'paint')) return 0;
  const blocker = agent(s, contest.by);
  const P = s.params.shot;
  const skill = P.blockSkillCoef * n(blocker.p.attr.block);
  return clamp((P.blockBase + skill * 0.14) * contest.level * 1.8, 0, 0.5);
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
  const contestMult = 1 + (F.contestFactor - 1) * contest.level;
  const draw = 1 + 0.65 * n(shooter.p.attr.drawFoul);
  let aggr = 1;
  if (contest.by) {
    aggr = 1 + 0.5 * n(agent(s, contest.by).p.tend.foulAggr);
  }
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
    const dLane = distToLane(a, b, d.pos);
    if (dLane > 6) continue;
    const along = clamp(1 - dLane / 6, 0, 1);
    const stealSkill = 0.5 + 0.5 * (d.p.attr.steal / 100);
    const contribution = along * stealSkill;
    occlusion += contribution * 0.6;
    if (contribution > dangerScore) {
      dangerScore = contribution;
      dangerId = d.p.id;
    }
  }
  // long cross-court passes are riskier
  const lengthTerm = 0.12 * Math.max(0, passLen - 25) / 10;
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
  const mean = R.missDistBase + R.missDistCoef * shotDistFt;
  const d = Math.max(1, s.rng.gaussian(mean, mean * 0.45));
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
      const d = dist(a.pos, spot);
      if (d > 24) continue;
      const prox = 1 / Math.pow(1 + d, R.proximityPower);
      const attr = a.p.attr;
      const rebSkill = a.side === offSide
        ? attr.offReb * 0.6 + attr.vertical * 0.25 + a.p.heightIn * 0.6
        : attr.defReb * 0.45 + attr.boxout * 0.25 + attr.vertical * 0.12 + a.p.heightIn * 0.6;
      const sideMult = a.side === offSide ? R.offWeightMult : 1;
      candidates.push(a);
      weights.push(prox * rebSkill * sideMult);
    }
  }
  if (candidates.length === 0) {
    // nobody near (shouldn't happen) — closest player on defense gets it
    const all = [...onCourt(s, 0), ...onCourt(s, 1)];
    all.sort((x, y) => dist(x.pos, spot) - dist(y.pos, spot));
    return all[0]!;
  }
  return candidates[s.rng.weighted(weights)]!;
}

// ---------- openness (shared by AI) ----------

/** 0 = smothered .. 1 = wide open, from the shooter's perspective right now */
export function openness(s: GameState, a: Agent): number {
  return 1 - contestAt(s, a, a.pos).level;
}

/** shooter gravity: how far out and how tightly a defense must respect this player */
export function gravity(a: Agent): number {
  return clamp((a.p.attr.three / 100) * 0.65 + (a.p.tend.shotThree / 100) * 0.35, 0, 1);
}

/** rough top speed available right now, accounting for fatigue */
export function currentMaxSpeed(s: GameState, a: Agent): number {
  const f = s.params.fatigue;
  const energyMult = f.minSpeedMult + (1 - f.minSpeedMult) * (a.energy / 100);
  return sprintSpeed(a.p.attr) * energyMult;
}
