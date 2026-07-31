/**
 * approach.ts - the pre-game card projected onto my real tendencies: the
 * career mode's agency core (docs/CAREER.md, The approach system). Every
 * dial is a real engine input, which is what makes the card trustworthy:
 * hunt threes and the attempts genuinely rise, and the box score answers
 * the same night.
 *
 * Streams: none. Projection is pure arithmetic; the only randomness in a
 * game night is the engine's own.
 */
import { clamp } from '@hoopsh/engine';
import type { FrPlayer } from '@hoopsh/franchise';
import type { ApproachCard, ApproachDial, ApproachRanges, CareerState, RoleId } from './types.js';
import type { CareerParams } from './params.js';

export const APPROACH_DIALS: readonly ApproachDial[] = [
  'assertiveness', 'range', 'motor', 'defense', 'playmaking',
];

/**
 * Per-dial tendency wiring. Weights are fractions of
 * params.trust.approachTendencyMax at a dial's extreme; signs follow the
 * dial's plain reading (assertiveness up = more usage and self-creation,
 * playmaking up = more extra passes and less iso). FEEL weights, chosen
 * so a maxed dial reads as a clearly different game, not a different
 * player: shot-diet identity stays his (the GM game's development rule,
 * applied to nights).
 *
 * Playmaking wiring (felt-loop A/B, 140 paired games per arm, fourstar
 * SG): the old passOut-only wiring moved assists +0.0 at a 65 dial, and
 * the isolation sweep found WHY - box assists are insensitive to every
 * tendency the card can reach (passOut +/-38 measured -0.07/-0.03 ast;
 * drive +32 -0.14; iso +32 -0.15; usage composites worse). Assist volume
 * routes through the creation hierarchy's ATTRIBUTES (passVision,
 * delivery quality), which the card must never touch. So the dial now
 * expresses the half the engine CAN feel: passOut 1.2 (swing appetite,
 * visibly a willing passer), usage -0.4 (the extra pass costs MY shots:
 * measured -1.0 fga at the extreme), iso -0.7 (clear-outs are the
 * anti-pass). The assist-response defect is reported upstream: it needs
 * an engine-side lever (swingPassOutScale-order), not louder wiring.
 */
const WIRING: Record<ApproachDial, Array<{ key: keyof FrPlayer['tend']; w: number }>> = {
  assertiveness: [
    { key: 'usage', w: 1.0 },
    { key: 'iso', w: 0.5 },
    { key: 'passOut', w: -0.4 },
  ],
  range: [
    { key: 'shotThree', w: 1.2 },
    { key: 'pullUp', w: 0.7 },
    { key: 'shotRim', w: -0.5 },
    { key: 'shotMid', w: -0.6 },
  ],
  motor: [
    { key: 'crashOffReb', w: 0.9 },
    { key: 'offBallMotion', w: 0.5 },
    { key: 'pushPace', w: 0.4 },
  ],
  defense: [
    { key: 'gambleSteal', w: 1.0 },
    { key: 'foulAggr', w: 0.6 },
  ],
  playmaking: [
    { key: 'passOut', w: 1.2 },
    { key: 'usage', w: -0.4 },
    { key: 'iso', w: -0.7 },
  ],
};

/**
 * A copy of me with the card applied. Tendencies move by up to
 * approachTendencyMax at a dial extreme; attributes NEVER move (the card
 * changes what I attempt, not what I can do), except playing hurt, which
 * debuffs the skill dials for the night through the real cost the wear
 * model then compounds (the caller owns the wear accrual).
 */
export function applyApproach(me: FrPlayer, card: ApproachCard & { playingHurt?: boolean }, params: CareerParams): FrPlayer {
  const out: FrPlayer = { ...me, attr: { ...me.attr }, tend: { ...me.tend } };
  const max = params.trust.approachTendencyMax;
  for (const dial of APPROACH_DIALS) {
    const t = (card[dial] - 50) / 50; // -1..1, 50 = play your normal game
    if (t === 0) continue;
    for (const { key, w } of WIRING[dial]) {
      out.tend[key] = clamp(Math.round(out.tend[key] + t * w * max), 0, 100);
    }
  }
  if (card.playingHurt) {
    // gutting it out: the whole skill sheet dulls for the night (FEEL: a
    // listed player is a diminished player everywhere, not one place)
    const d = params.trust.playHurtDialDebuff;
    for (const k of Object.keys(out.attr) as Array<keyof FrPlayer['attr']>) {
      out.attr[k] = clamp(Math.round(out.attr[k] - d), 0, 100);
    }
  }
  return out;
}

/**
 * The legs tax at game time, in attribute points: 0 at or above
 * params.week.energyLegsFloor, rising linearly to params.week
 * .energyLegsDebuff at energy 0. Pure math, exported for tests and UI
 * (the pre-game screen can show the exact cost of a grind week).
 */
export function legsDebuffAt(energy: number, params: CareerParams): number {
  const floor = params.week.energyLegsFloor;
  if (floor <= 0 || energy >= floor) return 0;
  return params.week.energyLegsDebuff * (floor - Math.max(0, energy)) / floor;
}

/**
 * A copy of me with tired legs: every attribute dulls by legsDebuffAt
 * (same whole-sheet shape as playing hurt, deliberately - an empty tank
 * and a bad ankle read the same on the floor). Tendencies never move: a
 * tired player still WANTS his game, he just executes it worse. This is
 * the week economy's teeth on the floor (the felt-loop A/B measured 41
 * zero-energy weeks costing nothing when hazard was the only consumer).
 * Called from the circuits ME projection with career.energy; a no-op
 * copy above the floor.
 */
export function applyLegs(me: FrPlayer, energy: number, params: CareerParams): FrPlayer {
  const d = legsDebuffAt(energy, params);
  const out: FrPlayer = { ...me, attr: { ...me.attr } };
  if (d <= 0) return out;
  for (const k of Object.keys(out.attr) as Array<keyof FrPlayer['attr']>) {
    out.attr[k] = clamp(Math.round(out.attr[k] - d), 0, 100);
  }
  return out;
}

/**
 * How far outside the plan a card sits, 0-100. Each dial contributes its
 * overflow beyond [lo, hi]; 25 points outside on one dial reads as a
 * clear deviation (the scale: a dial can overflow by at most ~50).
 */
export function deviationFrom(plan: ApproachRanges, card: ApproachCard): number {
  let overflow = 0;
  for (const dial of APPROACH_DIALS) {
    const [lo, hi] = plan[dial];
    const v = card[dial];
    overflow += Math.max(0, lo - v, v - hi);
  }
  // 2.0: five dials at a 10-point overflow each (50 total) reads as fully
  // off-script (100). FEEL scaling constant.
  return clamp(Math.round(overflow * 2.0), 0, 100);
}

/** Dial centers by role: bigger roles are ASKED to do more. FEEL table. */
const ROLE_CENTERS: Record<RoleId, Record<ApproachDial, number>> = {
  garbage: { assertiveness: 35, range: 45, motor: 60, defense: 50, playmaking: 55 },
  bench: { assertiveness: 40, range: 47, motor: 58, defense: 52, playmaking: 52 },
  rotation: { assertiveness: 45, range: 50, motor: 55, defense: 52, playmaking: 50 },
  sixthMan: { assertiveness: 55, range: 55, motor: 52, defense: 48, playmaking: 48 },
  starter: { assertiveness: 52, range: 50, motor: 52, defense: 52, playmaking: 50 },
  featured: { assertiveness: 60, range: 55, motor: 50, defense: 48, playmaking: 50 },
  franchise: { assertiveness: 65, range: 55, motor: 50, defense: 48, playmaking: 52 },
};

/**
 * Tonight's plan: centers by role, width by role (params), shaped by the
 * coach's personality, widened by the green light. The plan is the
 * coach's voice in numbers; trust.ts grades against it.
 */
export function planFor(career: CareerState): ApproachRanges {
  const { coach, params } = career;
  const width = params.trust.planWidthByRole[coach.role];
  const centers = ROLE_CENTERS[coach.role];
  // personality shapes (FEEL): the disciplinarian narrows everything; the
  // players' coach lives with more; the systems coach guards the shot
  // diet specifically; rides-hot-hand loosens after production (trust.ts
  // feeds that back through greenLight-like widening on grades).
  const personalityScale = coach.personality === 'disciplinarian' ? 0.8
    : coach.personality === 'playersCoach' ? 1.15 : 1.0;
  const greenBonus = coach.greenLight ? 10 : 0; // FEEL: the green light is real latitude

  const plan = {} as ApproachRanges;
  for (const dial of APPROACH_DIALS) {
    let half = (width / 2) * personalityScale + greenBonus;
    if (coach.personality === 'systems' && dial === 'range') half *= 0.7; // the system owns the shot diet
    const c = centers[dial];
    plan[dial] = [clamp(Math.round(c - half), 0, 100), clamp(Math.round(c + half), 0, 100)];
  }
  return plan;
}
