/**
 * sim/resolve.ts — spec-derived unit pins for the probability core.
 *
 * Expectations come from the module's own JSDoc/comments (cited per test),
 * params.ts provenance doctrine, and AGENTS.md §6 (decision and resolution
 * share one model). Calibrated SWEPT magnitudes are never pinned: tests
 * assert clamps, gates, routing, monotonicity, and self-consistency, or
 * force their own magnitudes through withParams (the coupling.test.ts
 * pattern) so a re-sweep of the shipped defaults cannot move them.
 *
 * States are hand-built with ONLY the fields resolve.ts reads (the
 * concede.test.ts doctrine): params, rules, court, period, t, rng,
 * agents/lineup; agents carry p/side/pos/vel/energy/fouledOut/
 * catchQuality/screenStunUntil.
 */

import { describe, expect, it } from 'vitest';
import {
  NBA, Rng, clamp, classifyShot, makeCourt, makePlayer, reachFt, sprintSpeed, withParams,
  type SimParams
} from '@hoopsh/engine';
import { n } from '../src/model/derived.js';
import {
  anticipatedContest, blockP, contestAt, currentMaxSpeed, defendersBack, freeThrowP,
  gravity, midRespect, openness, passRisk, resolveRebound, resolveTeamReboundSide,
  sampleMissLanding, shootingFoulP, shotEV, shotMakeP, zoneSkill,
  type Contest
} from '../src/sim/resolve.js';
import { attackedRim, type Agent, type GameState } from '../src/sim/state.js';

const P = withParams(); // shipped defaults, read (never pinned) for thresholds
const court = makeCourt(NBA);

interface AgentSpec {
  id: string;
  side: 0 | 1;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  attr?: Parameters<typeof makePlayer>[0]['attr'];
  tend?: Parameters<typeof makePlayer>[0]['tend'];
  heightIn?: number;
  wingspanIn?: number;
  energy?: number;
  fouledOut?: boolean;
  catchQuality?: number;
  stunUntil?: number;
}

function mkAgent(o: AgentSpec): Agent {
  return {
    p: makePlayer({
      id: o.id, heightIn: o.heightIn ?? 78, wingspanIn: o.wingspanIn,
      attr: o.attr ?? {}, tend: o.tend ?? {}
    }),
    side: o.side,
    pos: { x: o.x ?? 20, y: o.y ?? 25 },
    vel: { x: o.vx ?? 0, y: o.vy ?? 0 },
    energy: o.energy ?? 100,
    onCourt: true,
    fouledOut: o.fouledOut ?? false,
    catchQuality: o.catchQuality ?? 0,
    screenStunUntil: o.stunUntil ?? 0
  } as unknown as Agent;
}

function mkState(params: SimParams, agents: Agent[], seed = 'd2res-0'): GameState {
  const map = new Map(agents.map((a) => [a.p.id, a]));
  const lineup: [string[], string[]] = [
    agents.filter((a) => a.side === 0).map((a) => a.p.id),
    agents.filter((a) => a.side === 1).map((a) => a.p.id)
  ];
  // period 1 => side 0 attacks the high-x rim (state.ts attackedRim)
  return {
    params, rules: NBA, court, period: 1, t: 0,
    rng: new Rng(seed), agents: map, lineup
  } as unknown as GameState;
}

/** a wide-open look: the shape contestAt documents for "nobody in radius" */
const OPEN: Contest = { level: 0, by: null, heightAdvFt: 0.5 };

// ---------------------------------------------------------------- freeThrowP

describe('freeThrowP (resolve.ts:220-230)', () => {
  it('a rating-50 shooter hits exactly the league base rate: n(50)=0 and no elite kick', () => {
    // resolve.ts:227-229 — base + swing*n + elite, with both skill terms zero at 50
    const s = mkState(P, []);
    const avg = mkAgent({ id: 'ft50', side: 0, attr: { freeThrow: 50 } });
    expect(freeThrowP(s, avg)).toBe(P.shot.ftBasePct);
  });

  it('clamps to the documented 0.3 floor and 0.98 ceiling for extreme finite ratings', () => {
    // resolve.ts:229 clamp(…, 0.3, 0.98). Extreme finite ratings are legal
    // engine input under the default 'finite' validation tier (game.ts).
    const s = mkState(P, []);
    expect(freeThrowP(s, mkAgent({ id: 'lo', side: 0, attr: { freeThrow: -100000 } }))).toBe(0.3);
    expect(freeThrowP(s, mkAgent({ id: 'hi', side: 0, attr: { freeThrow: 100000 } }))).toBe(0.98);
  });

  it('below rating 80 the elite kick contributes nothing: the value is exactly the linear model', () => {
    // resolve.ts:222-228 — "an elite kick above rating 80 (n > 0.6)"; at 79
    // the kick term is Math.max(0, negative) = 0, so base + swing*n(79) is
    // the whole formula (self-consistent read of params, no literal pinned).
    const s = mkState(P, []);
    const p79 = freeThrowP(s, mkAgent({ id: 'ft79', side: 0, attr: { freeThrow: 79 } }));
    expect(p79).toBe(P.shot.ftBasePct + P.shot.ftSkillSwing * n(79));
    const p60 = freeThrowP(s, mkAgent({ id: 'ft60', side: 0, attr: { freeThrow: 60 } }));
    expect(p60).toBe(P.shot.ftBasePct + P.shot.ftSkillSwing * n(60));
  });

  it('the elite tail has its own curvature: the 80->100 climb beats the 60->80 climb', () => {
    // resolve.ts:222-226 — a purely linear model provably cannot express the
    // league mean AND the elite tail (cited fidelity incident: a 99-rated
    // benchmark capped at 83%). If someone drops the kick, this goes red.
    const s = mkState(P, []);
    const at = (r: number) => freeThrowP(s, mkAgent({ id: `ft${r}`, side: 0, attr: { freeThrow: r } }));
    expect(at(100) - at(80)).toBeGreaterThan(at(80) - at(60));
    // and the base ordering is monotone in the rating
    expect(at(0)).toBeLessThan(at(50));
    expect(at(50)).toBeLessThan(at(100));
  });
});

// -------------------------------------------------------------------- blockP

describe('blockP (resolve.ts:232-244)', () => {
  const blocker = (block: number) => mkAgent({ id: 'blk', side: 1, attr: { block } });
  const withBlocker = (block: number) => mkState(P, [blocker(block)]);
  const contested = (level: number): Contest => ({ level, by: 'blk', heightAdvFt: 0 });

  it('no contester means exactly zero — you cannot block from nowhere', () => {
    // resolve.ts:234 first gate
    const s = mkState(P, []);
    expect(blockP(s, 'rim', { level: 1, by: null, heightAdvFt: 0.5 })).toBe(0);
  });

  it('zone gating: only rim and paint attempts can be blocked', () => {
    // resolve.ts:233-234 — "chance a rim/paint miss is credited as a block"
    const s = withBlocker(100);
    expect(blockP(s, 'mid', contested(1))).toBe(0);
    expect(blockP(s, 'three', contested(1))).toBe(0);
    expect(blockP(s, 'rim', contested(1))).toBeGreaterThan(0);
    expect(blockP(s, 'paint', contested(1))).toBeGreaterThan(0);
  });

  it('caps at params.shot.blockCap: even an extreme-finite Gobert cannot erase every miss', () => {
    // resolve.ts:239-243 clamp hi — the cap is read from params, not pinned
    const s = withBlocker(100000);
    expect(blockP(s, 'rim', contested(1))).toBe(P.shot.blockCap);
  });

  it('floors at 0 for an extreme-finite negative block rating', () => {
    // resolve.ts:243 clamp lo
    const s = withBlocker(-100000);
    expect(blockP(s, 'rim', contested(1))).toBe(0);
  });

  it('scales with contest level: zero contest blocks nothing, tighter contests block more', () => {
    // resolve.ts:238-240 — "you can't block what you aren't near"
    const s = withBlocker(80);
    expect(blockP(s, 'rim', contested(0))).toBe(0);
    expect(blockP(s, 'rim', contested(0.9))).toBeGreaterThan(blockP(s, 'rim', contested(0.4)));
  });
});

// ------------------------------------------------------------- shootingFoulP

describe('shootingFoulP (resolve.ts:248-274)', () => {
  it('hard-capped at shootFoulCap: hack-a-Shaq still leaves a clean-play chance', () => {
    // resolve.ts:273-274 — extreme finite drawFoul drives the product far
    // over the cap; the clamp must return exactly params.foul.shootFoulCap
    const hacker = mkAgent({ id: 'hack', side: 1, tend: { foulAggr: 100 } });
    const s = mkState(P, [hacker]);
    const magnet = mkAgent({ id: 'mag', side: 0, attr: { drawFoul: 100000 } });
    expect(shootingFoulP(s, magnet, 'rim', { level: 1, by: 'hack', heightAdvFt: 0 }))
      .toBe(P.foul.shootFoulCap);
  });

  it('floored at 0: a negative-extreme foul-drawing rating cannot go sub-zero', () => {
    // resolve.ts:274 clamp lo
    const s = mkState(P, []);
    const ghost = mkAgent({ id: 'gh', side: 0, attr: { drawFoul: -100000 } });
    expect(shootingFoulP(s, ghost, 'rim', OPEN)).toBe(0);
  });

  it('all-neutral inputs land exactly on the zone base — the zone routing is live', () => {
    // resolve.ts:254-258 zone lookup; contest 0 => contestMult 1, drawFoul 50
    // => draw 1, no contester => aggr 1. Expected value read back through the
    // same clamp so a re-sweep that pushes a base past the cap cannot break it.
    const s = mkState(P, []);
    const avg = mkAgent({ id: 'avg', side: 0, attr: { drawFoul: 50 } });
    expect(shootingFoulP(s, avg, 'rim', OPEN)).toBe(clamp(P.foul.shootRim, 0, P.foul.shootFoulCap));
    expect(shootingFoulP(s, avg, 'paint', OPEN)).toBe(clamp(P.foul.shootPaint, 0, P.foul.shootFoulCap));
    expect(shootingFoulP(s, avg, 'mid', OPEN)).toBe(clamp(P.foul.shootMid, 0, P.foul.shootFoulCap));
    expect(shootingFoulP(s, avg, 'three', OPEN)).toBe(clamp(P.foul.shootThree, 0, P.foul.shootFoulCap));
  });

  it('tight contests mean contact: a smothered shot draws more whistles than an open one', () => {
    // resolve.ts:260-267 contestMult 1.0 -> contestFactor
    const d = mkAgent({ id: 'd', side: 1, tend: { foulAggr: 50 } });
    const s = mkState(P, [d]);
    const avg = mkAgent({ id: 'avg', side: 0, attr: { drawFoul: 50 } });
    const tight = shootingFoulP(s, avg, 'rim', { level: 1, by: 'd', heightAdvFt: 0 });
    const open = shootingFoulP(s, avg, 'rim', OPEN);
    expect(tight).toBeGreaterThan(open);
  });

  it("hackers foul more: the DEFENDER's foulAggr tendency scales the rate", () => {
    // resolve.ts:262-271 — "hackers foul ~50% more"
    const hacker = mkAgent({ id: 'h', side: 1, tend: { foulAggr: 100 } });
    const saint = mkAgent({ id: 's', side: 1, tend: { foulAggr: 0 } });
    const s = mkState(P, [hacker, saint]);
    const avg = mkAgent({ id: 'avg', side: 0, attr: { drawFoul: 50 } });
    const vsHacker = shootingFoulP(s, avg, 'rim', { level: 0.5, by: 'h', heightAdvFt: 0 });
    const vsSaint = shootingFoulP(s, avg, 'rim', { level: 0.5, by: 's', heightAdvFt: 0 });
    expect(vsHacker).toBeGreaterThan(vsSaint);
  });
});

// ----------------------------------------------------------------- shotMakeP

describe('shotMakeP (resolve.ts:117-186)', () => {
  const s = mkState(P, []);
  const avg = mkAgent({ id: 'sh', side: 0 });

  it('is a probability: strict (0,1) across the rating book, [0,1] even at absurd extremes', () => {
    // resolve.ts:185 / params.ts header — P = sigmoid(logit). Strictly inside
    // (0,1) for legal 0-100 ratings; at extreme finite ratings the float
    // sigmoid may saturate but never escapes [0,1].
    const best = mkAgent({ id: 'b', side: 0, attr: { three: 100 } });
    const worst = mkAgent({ id: 'w', side: 0, attr: { three: 0 } });
    expect(shotMakeP(s, best, 'three', 24, 'catch_shoot', OPEN)).toBeLessThan(1);
    expect(shotMakeP(s, best, 'three', 24, 'catch_shoot', OPEN)).toBeGreaterThan(0);
    expect(shotMakeP(s, worst, 'three', 24, 'catch_shoot', OPEN)).toBeGreaterThan(0);
    expect(shotMakeP(s, worst, 'three', 24, 'catch_shoot', OPEN)).toBeLessThan(1);
    const godly = mkAgent({ id: 'g', side: 0, attr: { three: 100000 } });
    const hopeless = mkAgent({ id: 'h', side: 0, attr: { three: -100000 } });
    expect(shotMakeP(s, godly, 'three', 24, 'catch_shoot', OPEN)).toBeLessThanOrEqual(1);
    expect(shotMakeP(s, hopeless, 'three', 24, 'catch_shoot', OPEN)).toBeGreaterThanOrEqual(0);
  });

  it("size only matters at the rim: a 7-footer's reach is irrelevant on a jumper", () => {
    // resolve.ts:162-166 — heightTerm is rim-gated to exactly 0 elsewhere
    const at = (zone: 'mid' | 'three', adv: number) =>
      shotMakeP(s, avg, zone, zone === 'mid' ? 12 : 24, 'pull_up', { level: 0.4, by: null, heightAdvFt: adv });
    expect(at('mid', 0)).toBe(at('mid', 3));
    expect(at('three', -2)).toBe(at('three', 4));
  });

  it('at the rim the reach edge is clamped to ±rimHeightAdvClampFt (forced magnitudes)', () => {
    // resolve.ts:162-166 — forced coef/clamp per the coupling.test.ts pattern
    // so the pin survives any re-sweep of the shipped FEEL values
    const forced = withParams({ shot: { rimHeightCoef: 0.5, rimHeightAdvClampFt: 2 } });
    const fs = mkState(forced, []);
    const rim = (adv: number) =>
      shotMakeP(fs, avg, 'rim', 1, 'drive', { level: 0.3, by: null, heightAdvFt: adv });
    expect(rim(2)).toBe(rim(7));      // beyond the clamp adds nothing
    expect(rim(-2)).toBe(rim(-9));    // both directions
    expect(rim(0)).not.toBe(rim(1.5)); // inside the clamp the edge is live
  });

  it('delivery quality rides ONLY the catch-and-shoot; self-created shots get zero', () => {
    // resolve.ts:170-183 — passQ is moveType-gated
    const pull = (q: number) => shotMakeP(s, avg, 'mid', 15, 'pull_up', OPEN, q);
    expect(pull(1)).toBe(pull(-1));
    const forced = withParams({ shot: { passQualityCoef: 0.5, passQualityCenter: 0 } });
    const fs = mkState(forced, []);
    const cs = (q: number) => shotMakeP(fs, avg, 'three', 24, 'catch_shoot', OPEN, q);
    expect(cs(1)).not.toBe(cs(-1));
  });

  it("resolution reads the shooter's stamped catchQuality when no prospective delivery is passed", () => {
    // resolve.ts:125-128 — omitting catchQ falls back to shooter.catchQuality
    const catcher = mkAgent({ id: 'c', side: 0, catchQuality: 0.8 });
    const explicit = shotMakeP(s, catcher, 'three', 24, 'catch_shoot', OPEN, 0.8);
    const fallback = shotMakeP(s, catcher, 'three', 24, 'catch_shoot', OPEN);
    expect(fallback).toBe(explicit);
  });

  it('threes are penalized only beyond distPenaltyThreeFt (23 ft, REAL); deeper is worse', () => {
    // resolve.ts:149-158 — max(0, dist − threshold) is exactly 0 at or below
    // the line, so a 20-footer and a 23-footer share one make chance.
    // (distPenaltyThreeFt = 23 is a REAL rule-book pin per params.ts:804.)
    const at = (d: number) => shotMakeP(s, avg, 'three', d, 'catch_shoot', OPEN);
    expect(P.shot.distPenaltyThreeFt).toBe(23);
    expect(at(20)).toBe(at(23));
    expect(at(27)).toBeLessThan(at(23));
    expect(at(31)).toBeLessThan(at(27));
  });

  it('rim shots get harder away from point-blank: a dunk beats a 4-foot floater', () => {
    // resolve.ts:155-159 distPenaltyRimPerFt from 0 ft out
    const at = (d: number) => shotMakeP(s, avg, 'rim', d, 'drive', OPEN);
    expect(at(0)).toBeGreaterThan(at(4));
  });

  it('contested shots are harder — the core probabilistic-resolution bet', () => {
    // resolve.ts:139 contestTerm; events.ts:243 contest 0 = open, 1 = smothered
    const at = (level: number) => shotMakeP(s, avg, 'mid', 15, 'pull_up', { level, by: null, heightAdvFt: 0.5 });
    expect(at(0)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(1));
  });

  it('a gassed shooter shoots worse; a full tank is the neutral point', () => {
    // resolve.ts:168 fatigue = coef * (1 − energy/100), exactly 0 at 100
    const fresh = mkAgent({ id: 'f', side: 0, energy: 100 });
    const gassed = mkAgent({ id: 'g', side: 0, energy: 10 });
    expect(shotMakeP(s, fresh, 'mid', 15, 'pull_up', OPEN))
      .toBeGreaterThan(shotMakeP(s, gassed, 'mid', 15, 'pull_up', OPEN));
  });
});

describe('zoneSkill (resolve.ts:109-122)', () => {
  it('routes each zone to its own rating: rim=finishing, mid=midRange, three=three', () => {
    // resolve.ts:109-120 — zoneSkill now takes GameState (its only caller is
    // shotMakeP) because the paint blend reads params.shot (commit e296ae1,
    // audit H-01); the pure-rating zones route exactly as before.
    const s = mkState(P, []);
    const a = mkAgent({ id: 'z', side: 0, attr: { finishing: 77, midRange: 61, three: 43 } });
    expect(zoneSkill(s, a, 'rim')).toBe(77);
    expect(zoneSkill(s, a, 'mid')).toBe(61);
    expect(zoneSkill(s, a, 'three')).toBe(43);
  });

  it('the paint blend is touch, not power: midRange dominates finishing', () => {
    // resolve.ts:112-118 — WHY sagging off non-shooters works: a rim-runner's
    // open 9-foot floater is a win for the defense. The blend weights were
    // hoisted at identical values to params.shot.paintBlendFinishing/
    // .paintBlendMidRange (commit e296ae1, audit H-01) — tagged FEEL at
    // params.ts:877-884 and NOT registered on the harness SWEEPABLE surface
    // (d5a8b13 added no shot.paintBlend* knob), so the documented defaults
    // are exact-pinnable.
    const s = mkState(P, []);
    const touch = mkAgent({ id: 't', side: 0, attr: { finishing: 0, midRange: 100 } });
    const power = mkAgent({ id: 'p', side: 0, attr: { finishing: 100, midRange: 0 } });
    // the basketball point, params-free: touch beats power in the paint
    expect(zoneSkill(s, touch, 'paint')).toBeGreaterThan(zoneSkill(s, power, 'paint'));
    // touch-dominance now lives on the params surface itself
    expect(P.shot.paintBlendMidRange).toBeGreaterThan(P.shot.paintBlendFinishing);
    // the documented FEEL defaults, pinned exactly with their new provenance
    expect(P.shot.paintBlendFinishing).toBe(0.35);
    expect(P.shot.paintBlendMidRange).toBe(0.65);
    // and zoneSkill IS that params blend — wiring recomputed from the same
    // params instance (single-attr extremes keep the float products exact)
    expect(zoneSkill(s, touch, 'paint')).toBe(100 * P.shot.paintBlendMidRange);
    expect(zoneSkill(s, power, 'paint')).toBe(100 * P.shot.paintBlendFinishing);
    // the blend is a weighted mean: it stays inside [0, 100]
    expect(zoneSkill(s, power, 'paint')).toBeGreaterThan(0);
    expect(zoneSkill(s, power, 'paint')).toBeLessThan(50);
  });
});

// -------------------------------------------------------------------- shotEV

describe('shotEV self-consistency (resolve.ts:188-218, AGENTS.md §6)', () => {
  // a real contester in the map so shootingFoulP's aggr branch is exercised
  const defender = mkAgent({ id: 'dEV', side: 1, tend: { foulAggr: 65 } });
  const s = mkState(P, [defender]);
  const shooter = mkAgent({ id: 'ev', side: 0, attr: { three: 70, finishing: 65, freeThrow: 75 } });
  const rim = attackedRim(s, 0);
  const spots = [
    { name: 'rim', pos: { x: rim.x - 2, y: rim.y }, moveType: 'drive' as const },
    { name: 'mid', pos: { x: rim.x - 18, y: rim.y }, moveType: 'pull_up' as const },
    { name: 'atb three', pos: { x: rim.x - 26, y: rim.y }, moveType: 'catch_shoot' as const },
    { name: 'corner three', pos: { x: court.length - 5, y: rim.y - 23 }, moveType: 'catch_shoot' as const }
  ];
  const contest: Contest = { level: 0.45, by: 'dEV', heightAdvFt: 0.6 };

  it('the p the AI decides on IS shotMakeP for the identical inputs — beliefs never drift from reality', () => {
    // AGENTS.md §6: "shotEV wraps shotMakeP"; resolve.ts:196-199. Zone and
    // distance must be the same classifyShot read the resolution uses.
    for (const spot of spots) {
      const r = shotEV(s, shooter, spot.pos, spot.moveType, contest);
      const loc = classifyShot(NBA, court, rim, spot.pos);
      expect(r.zone).toBe(loc.zone);
      expect(r.three).toBe(loc.three);
      expect(r.distFt).toBe(loc.distFt);
      expect(r.p).toBe(shotMakeP(s, shooter, loc.zone, loc.distFt, spot.moveType, contest));
    }
  });

  it('ev decomposes exactly into make EV plus the documented free-throw EV term', () => {
    // resolve.ts:200-217 — ev = p*pts + pFoul*pts*ftP*(1−p), priced with the
    // same freeThrowP/shootingFoulP models that resolve the whistle
    for (const spot of spots) {
      const r = shotEV(s, shooter, spot.pos, spot.moveType, contest);
      const pts = r.three ? 3 : 2;
      const pFoul = shootingFoulP(s, shooter, r.zone, contest);
      const ftP = freeThrowP(s, shooter);
      expect(r.ev).toBe(r.p * pts + pFoul * pts * ftP * (1 - r.p));
    }
  });

  it('a prospective delivery (catchQ) flows through to the same p resolution would compute', () => {
    // resolve.ts:125-128, 199 — decideBall passes the holder's delivery
    const r = shotEV(s, shooter, spots[2]!.pos, 'catch_shoot', contest, 0.9);
    expect(r.p).toBe(shotMakeP(s, shooter, r.zone, r.distFt, 'catch_shoot', contest, 0.9));
  });

  it('the whistle is priced in: a contested rim attempt is worth more than its raw make EV', () => {
    // resolve.ts:203-216 — foul EV is additive on top of p*pts
    const r = shotEV(s, shooter, spots[0]!.pos, 'drive', contest);
    expect(r.ev).toBeGreaterThan(r.p * 2);
  });
});

// ------------------------------------------------------------------ contests

describe('contestAt / anticipatedContest (resolve.ts:21-101)', () => {
  const shooterAt = (x: number, y: number) => mkAgent({ id: 'sh', side: 0, x, y });

  it('nobody inside contestRadiusFt: level 0, no contester, and the documented +0.5 ft edge', () => {
    // resolve.ts:75-79 — the uncontested height advantage that keeps the
    // height term from swinging negative on unguarded makes
    const far = mkAgent({ id: 'far', side: 1, x: 5, y: 5 });
    const sh = shooterAt(70, 25);
    const s = mkState(P, [sh, far]);
    const c = contestAt(s, sh, sh.pos);
    expect(c.level).toBe(0);
    expect(c.by).toBe(null);
    expect(c.heightAdvFt).toBe(0.5);
  });

  it('level saturates at exactly 1 for an on-body extreme contester (clamp hi)', () => {
    // resolve.ts:79 clamp(best, 0, 1); skill floor/range forced so the pin
    // does not depend on shipped magnitudes
    const forced = withParams({ ai: { contestSkillFloor: 0.5, contestSkillRange: 0.5 } });
    const d = mkAgent({
      id: 'd', side: 1, x: 70, y: 25,
      attr: { contestSkill: 100000, perimeterD: 100000, interiorD: 100000 }
    });
    const sh = shooterAt(70, 25);
    const s = mkState(forced, [sh, d]);
    expect(contestAt(s, sh, sh.pos).level).toBe(1);
  });

  it('a fouled-out body cannot contest — the liveOnCourt ghost filter holds', () => {
    // state.ts:297-310 — handing ghosts an action was an audited invariant
    // violation; drop the fouledOut filter and this goes red
    const ghost = mkAgent({ id: 'g', side: 1, x: 70, y: 25, fouledOut: true });
    const sh = shooterAt(70, 25);
    const s = mkState(P, [sh, ghost]);
    const c = contestAt(s, sh, sh.pos);
    expect(c.level).toBe(0);
    expect(c.by).toBe(null);
  });

  it('heightAdvFt is shooter reach minus the credited contester reach', () => {
    // resolve.ts:24, 72, 78
    const d = mkAgent({ id: 'd', side: 1, x: 70, y: 25, heightIn: 90, wingspanIn: 94 });
    const sh = mkAgent({ id: 'sh', side: 0, x: 70, y: 25, heightIn: 80, wingspanIn: 84 });
    const s = mkState(P, [sh, d]);
    const c = contestAt(s, sh, sh.pos);
    expect(c.by).toBe('d');
    expect(c.heightAdvFt).toBe(reachFt(sh.p) - reachFt(d.p));
  });

  it('the best contest wins the credit: distance is the dominant term', () => {
    // resolve.ts:52-55 — linear falloff in distance at equal skill
    const near = mkAgent({ id: 'near', side: 1, x: 71, y: 25 });
    const off = mkAgent({ id: 'off', side: 1, x: 74, y: 25 });
    const sh = shooterAt(70, 25);
    const s = mkState(P, [sh, near, off]);
    expect(contestAt(s, sh, sh.pos).by).toBe('near');
  });

  it('anticipatedContest with zero windup degenerates to the present-time contest (shared core)', () => {
    // resolve.ts:27-36 — "Passing 0 degenerates the projection … both entry
    // points share every line of this loop"
    const d = mkAgent({ id: 'd', side: 1, x: 72, y: 26, vx: 3, vy: -1 });
    const sh = shooterAt(70, 25);
    const s = mkState(P, [sh, d]);
    expect(anticipatedContest(s, sh, sh.pos, 0)).toEqual(contestAt(s, sh, sh.pos));
  });

  it('anticipation sees the flying closeout: a defender not yet arrived still discourages the shot', () => {
    // resolve.ts:87-100 — defenders projected forward by the windup
    const forced = withParams({ ai: { windupProjShare: 1 } });
    const radius = forced.move.contestRadiusFt;
    const d = mkAgent({ id: 'd', side: 1, x: 40 + radius + 2, y: 25, vx: -(radius + 2), vy: 0 });
    const sh = shooterAt(40, 25);
    const s = mkState(forced, [sh, d]);
    expect(contestAt(s, sh, sh.pos).level).toBe(0);
    expect(anticipatedContest(s, sh, sh.pos, 1).level).toBeGreaterThan(0);
  });

  it('the defender contests from wherever is CLOSER: retreating never lowers the present contest', () => {
    // resolve.ts:48-50 — min(actual, projected) keeps anticipation honest
    const d = mkAgent({ id: 'd', side: 1, x: 41.5, y: 25, vx: 30, vy: 0 });
    const sh = shooterAt(40, 25);
    const s = mkState(P, [sh, d]);
    expect(anticipatedContest(s, sh, sh.pos, 1)).toEqual(contestAt(s, sh, sh.pos));
  });

  it('a screen-stunned defender still bothers the shot, at exactly the discounted rate', () => {
    // resolve.ts:64-68 — stun multiplies the level; forced mult 0.5 makes the
    // expectation exact in float arithmetic
    const forced = withParams({ ai: { pnrStunContestMult: 0.5 } });
    const mk = (stunUntil: number) => {
      const d = mkAgent({ id: 'd', side: 1, x: 71, y: 25, stunUntil });
      const sh = shooterAt(70, 25);
      return contestAt(mkState(forced, [sh, d]), sh, sh.pos); // s.t = 0
    };
    const clean = mk(0);       // 0 < 0 is false: not stunned
    const stunned = mk(5);     // 0 < 5: fighting through the screen
    expect(stunned.level).toBe(clean.level * 0.5);
    expect(stunned.level).toBeGreaterThan(0);
  });
});

describe('openness (resolve.ts:427-430)', () => {
  it('wide open is exactly 1; a saturated contest is exactly 0', () => {
    const sh = mkAgent({ id: 'sh', side: 0, x: 70, y: 25 });
    const alone = mkState(P, [sh]);
    expect(openness(alone, sh)).toBe(1);
    const forced = withParams({ ai: { contestSkillFloor: 0.5, contestSkillRange: 0.5 } });
    const d = mkAgent({
      id: 'd', side: 1, x: 70, y: 25,
      attr: { contestSkill: 100000, perimeterD: 100000, interiorD: 100000 }
    });
    const smothered = mkState(forced, [sh, d]);
    expect(openness(smothered, sh)).toBe(0);
  });
});

// ------------------------------------------------------------------ passRisk

describe('passRisk (resolve.ts:279-322)', () => {
  const passer = (attr?: AgentSpec['attr']) => mkAgent({ id: 'from', side: 0, x: 30, y: 25, attr });
  const receiver = (x: number) => mkAgent({ id: 'to', side: 0, x, y: 25 });

  it('turnoverP is a probability in (0,1)', () => {
    const f = passer(); const t = receiver(50);
    const s = mkState(P, [f, t]);
    const r = passRisk(s, f, t);
    expect(r.turnoverP).toBeGreaterThan(0);
    expect(r.turnoverP).toBeLessThan(1);
    expect(r.dangerId).toBe(null);
  });

  it('a defender beyond laneDangerFt is irrelevant: bit-identical to an empty floor', () => {
    // resolve.ts:299-302 — the reach-plus-step envelope gate
    const f = passer(); const t = receiver(50);
    const clean = passRisk(mkState(P, [f, t]), f, t);
    const bystander = mkAgent({ id: 'd', side: 1, x: 40, y: 25 + P.pass.laneDangerFt + 5 });
    const r = passRisk(mkState(P, [f, t, bystander]), f, t);
    expect(r.turnoverP).toBe(clean.turnoverP);
    expect(r.dangerId).toBe(null);
  });

  it('a body in the lane raises the risk and is flagged as the steal candidate', () => {
    // resolve.ts:287-313
    const f = passer(); const t = receiver(50);
    const clean = passRisk(mkState(P, [f, t]), f, t);
    const inLane = mkAgent({ id: 'd', side: 1, x: 40, y: 25 });
    const r = passRisk(mkState(P, [f, t, inLane]), f, t);
    expect(r.turnoverP).toBeGreaterThan(clean.turnoverP);
    expect(r.dangerId).toBe('d');
  });

  it('the most threatening lane defender wins the danger flag', () => {
    // resolve.ts:310-313 — highest contribution, not first seen
    const f = passer(); const t = receiver(50);
    const grazing = mkAgent({ id: 'graze', side: 1, x: 40, y: 25 + P.pass.laneDangerFt * 0.9 });
    const onLine = mkAgent({ id: 'online', side: 1, x: 45, y: 25 });
    const r = passRisk(mkState(P, [f, t, grazing, onLine]), f, t);
    expect(r.dangerId).toBe('online');
  });

  it('a fouled-out defender in the lane is a ghost: identical to an empty floor', () => {
    // state.ts:297-310 liveOnCourt filter
    const f = passer(); const t = receiver(50);
    const clean = passRisk(mkState(P, [f, t]), f, t);
    const ghost = mkAgent({ id: 'g', side: 1, x: 40, y: 25, fouledOut: true });
    const r = passRisk(mkState(P, [f, t, ghost]), f, t);
    expect(r.turnoverP).toBe(clean.turnoverP);
    expect(r.dangerId).toBe(null);
  });

  it('length is free up to longPassFt, then long skip passes cost', () => {
    // resolve.ts:315-318 — max(0, len − longPassFt): at or below the
    // threshold the length term is exactly 0
    const f = passer();
    const short = receiver(30 + 8);
    const atLine = receiver(30 + P.pass.longPassFt);
    const skip = receiver(30 + P.pass.longPassFt + 20);
    expect(passRisk(mkState(P, [f, short]), f, short).turnoverP)
      .toBe(passRisk(mkState(P, [f, atLine]), f, atLine).turnoverP);
    expect(passRisk(mkState(P, [f, skip]), f, skip).turnoverP)
      .toBeGreaterThan(passRisk(mkState(P, [f, atLine]), f, atLine).turnoverP);
  });

  it('an elite passer is safer than a butterfingered one on the identical pass', () => {
    // resolve.ts:319 skillTerm on passAcc/passVision
    const elite = passer({ passAcc: 100, passVision: 100 });
    const poor = passer({ passAcc: 0, passVision: 0 });
    const t = receiver(55);
    expect(passRisk(mkState(P, [elite, t]), elite, t).turnoverP)
      .toBeLessThan(passRisk(mkState(P, [poor, t]), poor, t).turnoverP);
  });
});

// --------------------------------------------------------- gravity/midRespect

describe('gravity and midRespect (resolve.ts:452-489)', () => {
  it('gravity clamps to [0,1]: zero dials are exactly 0, extreme dials exactly 1', () => {
    const s = mkState(P, []);
    const nobody = mkAgent({ id: 'n', side: 0, attr: { three: 0 }, tend: { shotThree: 0 } });
    const sun = mkAgent({ id: 's', side: 0, attr: { three: 100000 }, tend: { shotThree: 100000 } });
    expect(gravity(s, nobody)).toBe(0);
    expect(gravity(s, sun)).toBe(1);
  });

  it('both terms are live: ability without appetite and appetite without ability each command SOME respect', () => {
    // resolve.ts:458-462 — "a great shooter who never shoots eventually gets
    // ignored, and a volume gunner who can't shoot still commands *some*
    // attention. Both terms are needed." Zeroing either weight goes red here.
    const s = mkState(P, []);
    const ability = mkAgent({ id: 'a', side: 0, attr: { three: 100 }, tend: { shotThree: 0 } });
    const appetite = mkAgent({ id: 'b', side: 0, attr: { three: 0 }, tend: { shotThree: 100 } });
    expect(gravity(s, ability)).toBeGreaterThan(0);
    expect(gravity(s, appetite)).toBeGreaterThan(0);
  });

  it('midRespect is exactly 0 beyond midGreenMaxFt of the attacked rim — the three-point model owns it there', () => {
    // resolve.ts:485-488 distance gate
    const rim = attackedRim(mkState(P, []), 0); // high-x rim, period 1
    const far = mkAgent({
      id: 'f', side: 0, x: rim.x - (P.ai.midGreenMaxFt + 6), y: rim.y,
      attr: { midRange: 100 }, tend: { shotMid: 100 }
    });
    const near = mkAgent({
      id: 'nr', side: 0, x: rim.x - Math.min(P.ai.midGreenMaxFt - 2, 12), y: rim.y,
      attr: { midRange: 100 }, tend: { shotMid: 100 }
    });
    const s = mkState(P, [far, near]);
    expect(midRespect(s, far)).toBe(0);
    expect(midRespect(s, near)).toBeGreaterThan(0);
  });

  it('one respect doctrine: midRespect reuses gravity\'s exact weight pair', () => {
    // resolve.ts:478-483 — "the same ability-weighted/willingness-weighted
    // blend as gravity() (one respect doctrine, one pair of weights)"
    const rim = attackedRim(mkState(P, []), 0);
    const midMan = mkAgent({
      id: 'm', side: 0, x: rim.x - 10, y: rim.y,
      attr: { midRange: 63 }, tend: { shotMid: 37 }
    });
    const arcMan = mkAgent({ id: 'g', side: 0, attr: { three: 63 }, tend: { shotThree: 37 } });
    const s = mkState(P, [midMan, arcMan]);
    expect(midRespect(s, midMan)).toBe(gravity(s, arcMan));
  });
});

// ------------------------------------------------------------------ rebounds

describe('sampleMissLanding (resolve.ts:326-341)', () => {
  it('every sample lands inside the court with the 2 ft margin, with real spread', () => {
    const s = mkState(P, [], 'd2res-miss-1');
    const rim = court.rims[0];
    const xs: number[] = [];
    for (let i = 0; i < 200; i++) {
      const p = sampleMissLanding(s, rim, 24);
      expect(p.x).toBeGreaterThanOrEqual(2);
      expect(p.x).toBeLessThanOrEqual(court.length - 2);
      expect(p.y).toBeGreaterThanOrEqual(2);
      expect(p.y).toBeLessThanOrEqual(court.width - 2);
      xs.push(p.x);
    }
    expect(Math.min(...xs)).not.toBe(Math.max(...xs)); // a distribution, not a point
  });

  it('long shots rebound long — the tracking-data promise', () => {
    // resolve.ts:329-331 — mean carom distance grows with shot distance.
    // Deterministic under the fixed seeds; guards the missDistCoef wiring.
    const rim = court.rims[1];
    const meanDist = (shotDistFt: number, seed: string) => {
      const s = mkState(P, [], seed);
      let sum = 0;
      const N = 300;
      for (let i = 0; i < N; i++) {
        const p = sampleMissLanding(s, rim, shotDistFt);
        sum += Math.hypot(p.x - rim.x, p.y - rim.y);
      }
      return sum / N;
    };
    expect(meanDist(30, 'd2res-miss-far')).toBeGreaterThan(meanDist(2, 'd2res-miss-near'));
  });
});

describe('team-rebound side award and the rebound fallback (resolve.ts:389-423)', () => {
  // everyone far beyond reboundCutoffFt of the spot
  const spot = { x: 10, y: 10 };
  const farAgents = () => [
    mkAgent({ id: 'h1', side: 0 as const, x: 60, y: 25 }),
    mkAgent({ id: 'h2', side: 0 as const, x: 70, y: 40 }),
    mkAgent({ id: 'a1', side: 1 as const, x: 55, y: 30 }),
    mkAgent({ id: 'a2', side: 1 as const, x: 80, y: 12 })
  ];

  it('with nobody in reach the side award degrades to a fair coin — both sides occur, never a throw', () => {
    // resolve.ts:393-397 — Rng.weighted's all-zero uniform fallback
    const s = mkState(P, farAgents(), 'd2res-coin-1');
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(resolveTeamReboundSide(s, spot, 0));
    expect(seen.size).toBe(2);
    expect([...seen]).toContain(0);
    expect([...seen]).toContain(1);
  });

  it('consumes exactly ONE rng draw — the documented draw budget', () => {
    // resolve.ts:394-396: diverting caroms must not move ORB% expectation,
    // which requires a stable one-draw cost. Two same-seed streams: one runs
    // the award, the other skips one float; they must re-align after.
    const a = new Rng('d2res-draw-1');
    const b = new Rng('d2res-draw-1');
    const s = mkState(P, farAgents());
    (s as unknown as { rng: Rng }).rng = a;
    resolveTeamReboundSide(s, spot, 0);   // nobody-in-reach path
    b.float();
    expect(a.float()).toBe(b.float());
    // and again with live candidates in reach
    const nearSpot = { x: 60, y: 25 };
    resolveTeamReboundSide(s, nearSpot, 0);
    b.float();
    expect(a.float()).toBe(b.float());
  });

  it('resolveRebound with nobody in reach: the CLOSEST player gets it', () => {
    // resolve.ts:411-421 fallback
    const agents = farAgents(); // a1 at (55,30) is nearest to (10,10)? compute below
    const s = mkState(P, agents);
    const expected = [...agents].sort(
      (x, y) => Math.hypot(x.pos.x - spot.x, x.pos.y - spot.y) - Math.hypot(y.pos.x - spot.x, y.pos.y - spot.y)
    )[0]!;
    expect(resolveRebound(s, spot, 0).p.id).toBe(expected.p.id);
  });

  it('the fallback prefers live players: a fouled-out nearest body is passed over', () => {
    // resolve.ts:412-418 — handing a ghost the ball was an audited invariant
    // violation in the bench-exhausted degenerate state
    const agents = farAgents();
    const byDist = [...agents].sort(
      (x, y) => Math.hypot(x.pos.x - spot.x, x.pos.y - spot.y) - Math.hypot(y.pos.x - spot.x, y.pos.y - spot.y)
    );
    byDist[0]!.fouledOut = true;
    const s = mkState(P, agents);
    expect(resolveRebound(s, spot, 0).p.id).toBe(byDist[1]!.p.id);
  });

  it('bench-exhausted degenerate: with EVERYONE fouled out the nearest body still gets it (play on)', () => {
    // resolve.ts:417-418 — pool falls back to plain onCourt, never throws
    const agents = farAgents();
    for (const a of agents) a.fouledOut = true;
    const byDist = [...agents].sort(
      (x, y) => Math.hypot(x.pos.x - spot.x, x.pos.y - spot.y) - Math.hypot(y.pos.x - spot.x, y.pos.y - spot.y)
    );
    const s = mkState(P, agents);
    expect(resolveRebound(s, spot, 0).p.id).toBe(byDist[0]!.p.id);
  });
});

// ------------------------------------------------- defendersBack/currentMaxSpeed

describe('defendersBack (resolve.ts:442-449)', () => {
  it('counts live defenders inside transBackRadiusFt of the rim they protect', () => {
    const rim = attackedRim(mkState(P, []), 0); // offense side 0 attacks high-x rim
    const r = P.move.transBackRadiusFt;
    const back1 = mkAgent({ id: 'b1', side: 1, x: rim.x - (r - 3), y: rim.y });
    const back2 = mkAgent({ id: 'b2', side: 1, x: rim.x - 2, y: rim.y + 4 });
    const behind = mkAgent({ id: 'nb', side: 1, x: rim.x - (r + 8), y: rim.y });
    const s = mkState(P, [back1, back2, behind]);
    expect(defendersBack(s, 0)).toBe(2);
    back2.fouledOut = true; // ghosts are not back — they are gone
    expect(defendersBack(s, 0)).toBe(1);
  });
});

describe('currentMaxSpeed (resolve.ts:491-496)', () => {
  it('full tank runs the full rating-derived sprint speed; an empty tank runs minSpeedMult of it', () => {
    // resolve.ts:493-495 — energyMult = min + (1−min)·(energy/100)
    const f = P.fatigue;
    const fast = mkAgent({ id: 'f', side: 0, attr: { speed: 80 }, energy: 100 });
    const dead = mkAgent({ id: 'd', side: 0, attr: { speed: 80 }, energy: 0 });
    const s = mkState(P, []);
    expect(currentMaxSpeed(s, fast))
      .toBe(sprintSpeed(fast.p.attr) * (f.minSpeedMult + (1 - f.minSpeedMult) * 1));
    expect(currentMaxSpeed(s, dead)).toBe(sprintSpeed(dead.p.attr) * f.minSpeedMult);
    // fatigue slows you down monotonically
    const mid = mkAgent({ id: 'm', side: 0, attr: { speed: 80 }, energy: 40 });
    expect(currentMaxSpeed(s, mid)).toBeLessThan(currentMaxSpeed(s, fast));
    expect(currentMaxSpeed(s, mid)).toBeGreaterThan(currentMaxSpeed(s, dead));
  });
});
