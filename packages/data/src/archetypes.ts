/**
 * Archetype builders — reusable ratings profiles for tests, fixtures, and
 * quick roster assembly. Each returns a full Player via engine defaults.
 *
 * These are also the acceptance fixtures: the archetype test suite asserts
 * that an "elite shooter" actually behaves like one at season scale. That
 * dual role shapes how these should be edited: a rating tweak here isn't
 * just "this fictional player got better at X", it can silently change what
 * a passing archetype test means. If you touch a number in this file,
 * check whether an archetype test (packages/engine/test, search for the
 * archetype's name) is asserting on the specific behavior that rating
 * drives, before assuming the change is cosmetic.
 *
 * Each archetype below is named for the REAL-WORLD PLAYER TYPE it's meant
 * to approximate (not any specific real player — these are composites/
 * fixtures, not likenesses), with the 2-3 ratings that most define that
 * type called out. All ratings are 0-100 (see @hoopsh/data's schema.ts,
 * which enforces this same range for hand-edited packs).
 */

import { makePlayer, type Player, type Position } from '@hoopsh/engine';

interface Named {
  id: string;
  name: string;
  pos?: Position;
  heightIn?: number;
  weightLb?: number;
}

/**
 * Off-movement three-point assassin (the "plays like Curry" fixture).
 * Defining ratings: three=99 (as high as the scale allows — the whole
 * archetype exists to be the unambiguous best three-point shooter in any
 * roster), pullUp=82 (score off the dribble, not just catch-and-shoot),
 * offBallMotion=90 (constant relocating off screens rather than standing
 * in one spot — what makes the "gravity" this archetype creates on defense
 * feel earned rather than scripted). Deliberately weak on the other end
 * (interiorD=30, block=20) and at the rim (finishing=78 is good but not
 * elite) — this is a shooting specialist, not a two-way star, and the
 * archetype test suite should be checking that the offense (efficiency,
 * three-point volume) is elite while defense/rim scoring are merely average.
 */
export function eliteShooter(who: Named): Player {
  return makePlayer({
    pos: 'PG', heightIn: 74, weightLb: 185, ...who,
    attr: {
      speed: 82, accel: 86, lateral: 72, stamina: 88, strength: 48, vertical: 68,
      finishing: 78, midRange: 88, three: 99, freeThrow: 99, drawFoul: 62,
      ballHandle: 94, passAcc: 86, passVision: 84,
      perimeterD: 58, interiorD: 30, steal: 62, block: 20, contestSkill: 50,
      offReb: 25, defReb: 42, boxout: 30,
      decisions: 88, consistency: 84
    },
    tend: {
      shotRim: 34, shotMid: 22, shotThree: 92, pullUp: 82,
      drive: 44, passOut: 60, iso: 45, post: 4,
      offBallMotion: 90, crashOffReb: 12,
      gambleSteal: 40, foulAggr: 30, pushPace: 62
    }
  });
}

/**
 * Lob-catching, rim-running, rebound-eating center. Defining ratings:
 * finishing=94 + vertical=88 (score almost exclusively above the rim —
 * dunks/lobs, not touch shots), offReb/defReb/boxout all 80s-90s (a
 * rebounding-first center), and three=12 with shotThree tendency=1 (this
 * archetype essentially never shoots threes — by the engine's
 * gravity(a) = clamp(0.65×three/100 + 0.35×shotThree/100, 0, 1) formula
 * from sim/resolve.ts, that works out to gravity ≈ 0.65×0.12 + 0.35×0.01
 * ≈ 0.08, i.e. defenses correctly read this player as a total non-threat
 * beyond ~15 feet and don't have to guard him out there). midRange=28 and
 * ballHandle=28 keep this player firmly a roll-and-finish, not a
 * face-up-and-shoot, big.
 */
export function rimRunner(who: Named): Player {
  return makePlayer({
    pos: 'C', heightIn: 84, weightLb: 260, ...who,
    attr: {
      speed: 62, accel: 55, lateral: 45, stamina: 72, strength: 92, vertical: 88,
      finishing: 94, midRange: 28, three: 12, freeThrow: 52, drawFoul: 70,
      ballHandle: 28, passAcc: 48, passVision: 42,
      perimeterD: 34, interiorD: 88, steal: 30, block: 90, contestSkill: 86,
      offReb: 92, defReb: 88, boxout: 88,
      decisions: 60, consistency: 70
    },
    tend: {
      shotRim: 96, shotMid: 5, shotThree: 1, pullUp: 4,
      drive: 20, passOut: 35, iso: 5, post: 45,
      offBallMotion: 55, crashOffReb: 92,
      gambleSteal: 18, foulAggr: 58, pushPace: 35
    }
  });
}

/**
 * Pass-first table-setter who lives in the paint-to-kick game. Defining
 * ratings: passAcc=97 + passVision=98 (both near the top of the scale —
 * this is THE passing archetype in the file, distinct from eliteShooter's
 * passAcc=86/passVision=84, which are merely good-for-a-scorer) and
 * decisions=95 (rarely a bad shot-vs-pass read). drive=72 alongside
 * passOut=92 is the "paint-to-kick" signature: gets into the lane
 * constantly but the tendency numbers say the resulting look is much more
 * often a kickout than a shot attempt. three=62 is good-not-great — a
 * knockdown shooter this is not, but defenses still have to respect it.
 */
export function floorGeneral(who: Named): Player {
  return makePlayer({
    pos: 'PG', heightIn: 76, weightLb: 200, ...who,
    attr: {
      speed: 84, accel: 82, lateral: 70, stamina: 86, strength: 60, vertical: 62,
      finishing: 80, midRange: 68, three: 62, freeThrow: 80, drawFoul: 66,
      ballHandle: 96, passAcc: 97, passVision: 98,
      perimeterD: 60, interiorD: 36, steal: 66, block: 22, contestSkill: 48,
      offReb: 20, defReb: 48, boxout: 32,
      decisions: 95, consistency: 82
    },
    tend: {
      shotRim: 55, shotMid: 30, shotThree: 38, pullUp: 40,
      drive: 72, passOut: 92, iso: 30, post: 6,
      offBallMotion: 40, crashOffReb: 8,
      gambleSteal: 45, foulAggr: 28, pushPace: 74
    }
  });
}

/**
 * Corner-spacing, point-of-attack stopper — the archetype the "3&D" label
 * literally names. Defining ratings: three=82 (a genuine catch-and-shoot
 * weapon) paired with pullUp=12 (almost never creates his own three off
 * the dribble — this is a spot-up shooter, not an isolation scorer, which
 * shotThree=84/drive=28/iso=6 all reinforce) and perimeterD=90 +
 * steal=78 + contestSkill=82 (a legitimate lockdown wing defender, not
 * just "plays defense" filler). offBallMotion=50 is middling — this
 * player's game is standing in the corner and defending, not the
 * ceaseless relocating of eliteShooter (offBallMotion=90).
 */
export function threeAndD(who: Named): Player {
  return makePlayer({
    pos: 'SF', heightIn: 79, weightLb: 220, ...who,
    attr: {
      speed: 74, accel: 72, lateral: 84, stamina: 84, strength: 74, vertical: 72,
      finishing: 66, midRange: 55, three: 82, freeThrow: 78, drawFoul: 40,
      ballHandle: 52, passAcc: 60, passVision: 52,
      perimeterD: 90, interiorD: 62, steal: 78, block: 48, contestSkill: 82,
      offReb: 38, defReb: 60, boxout: 58,
      decisions: 74, consistency: 76
    },
    tend: {
      shotRim: 30, shotMid: 12, shotThree: 84, pullUp: 12,
      drive: 28, passOut: 62, iso: 6, post: 4,
      offBallMotion: 50, crashOffReb: 30,
      gambleSteal: 62, foulAggr: 42, pushPace: 45
    }
  });
}

/**
 * Do-everything scoring wing — the "bucket-getter" who can score from all
 * three levels. Defining ratings: finishing=88, midRange=82, three=74 are
 * all genuinely good (no clear weak level to attack, unlike eliteShooter's
 * rim/mid falloff or threeAndD's near-absent shot creation) and drawFoul=82
 * is the highest in the file — this player draws whistles at an elite rate,
 * living at the free-throw line as much as scoring in the paint. iso=60 +
 * pullUp=58 + drive=74 together say most of this scoring comes from
 * self-creation rather than off-ball movement (offBallMotion=58 is only
 * middling), distinguishing this from a pure catch-and-shoot wing.
 */
export function scoringWing(who: Named): Player {
  return makePlayer({
    pos: 'SG', heightIn: 78, weightLb: 215, ...who,
    attr: {
      speed: 84, accel: 84, lateral: 74, stamina: 84, strength: 72, vertical: 84,
      finishing: 88, midRange: 82, three: 74, freeThrow: 84, drawFoul: 82,
      ballHandle: 84, passAcc: 72, passVision: 68,
      perimeterD: 68, interiorD: 52, steal: 58, block: 42, contestSkill: 60,
      offReb: 34, defReb: 56, boxout: 44,
      decisions: 76, consistency: 78
    },
    tend: {
      shotRim: 62, shotMid: 42, shotThree: 52, pullUp: 58,
      drive: 74, passOut: 42, iso: 78, post: 12,
      offBallMotion: 58, crashOffReb: 22,
      gambleSteal: 38, foulAggr: 36, pushPace: 55
    }
  });
}

/**
 * Bruising post scorer with soft touch — an old-school back-to-the-basket
 * big. Defining ratings: strength=90 (highest in the file alongside
 * rimRunner) + post tendency=78 (by far the highest post tendency of any
 * archetype — this player's offense specifically routes through the low
 * block, not just "is a big who sometimes scores inside") and midRange=74
 * (the "soft touch" — a legitimate face-up/turnaround jumper, unlike
 * rimRunner's midRange=28, which is what separates a post scorer from a
 * pure rim-runner big). three=34 with shotThree tendency=8 says this
 * player will occasionally step out but is not a stretch four.
 */
export function postAnchor(who: Named): Player {
  return makePlayer({
    pos: 'PF', heightIn: 82, weightLb: 250, ...who,
    attr: {
      speed: 56, accel: 52, lateral: 50, stamina: 76, strength: 90, vertical: 60,
      finishing: 84, midRange: 74, three: 34, freeThrow: 72, drawFoul: 76,
      ballHandle: 44, passAcc: 62, passVision: 66,
      perimeterD: 40, interiorD: 82, steal: 34, block: 62, contestSkill: 76,
      offReb: 78, defReb: 84, boxout: 90,
      decisions: 70, consistency: 78
    },
    tend: {
      shotRim: 78, shotMid: 34, shotThree: 8, pullUp: 12,
      drive: 26, passOut: 48, iso: 26, post: 78,
      offBallMotion: 35, crashOffReb: 78,
      gambleSteal: 20, foulAggr: 50, pushPace: 30
    }
  });
}

/**
 * Steady rotation guard — a solid combo (scoring/playmaking hybrid) guard
 * who'd start on a below-average team and come off the bench on a good
 * one. Defining ratings: everything sits in the 60s-70s range with no
 * standout elite trait (contrast with floorGeneral's 95+ passing or
 * eliteShooter's 99 three) — that flatness IS the archetype: a
 * dependable, no-real-weakness rotation piece rather than a specialist.
 * three=70/shotThree=62 make this a credible enough shooter that defenses
 * can't fully ignore him, and decisions=70 keeps turnovers manageable
 * without floorGeneral-level table-setting.
 */
export function comboGuard(who: Named): Player {
  return makePlayer({
    pos: 'SG', heightIn: 76, weightLb: 200, ...who,
    attr: {
      speed: 78, accel: 76, lateral: 68, stamina: 80, strength: 58, vertical: 64,
      finishing: 70, midRange: 68, three: 70, freeThrow: 80, drawFoul: 48,
      ballHandle: 76, passAcc: 72, passVision: 66,
      perimeterD: 62, interiorD: 34, steal: 56, block: 22, contestSkill: 50,
      offReb: 22, defReb: 44, boxout: 30,
      decisions: 70, consistency: 68
    },
    tend: {
      shotRim: 42, shotMid: 30, shotThree: 62, pullUp: 42,
      drive: 48, passOut: 60, iso: 20, post: 4,
      offBallMotion: 60, crashOffReb: 14,
      gambleSteal: 40, foulAggr: 34, pushPace: 55
    }
  });
}

/**
 * Big-minutes glue forward — the "does a little of everything, nothing
 * spectacular, never hurts you" role player teams build depth around.
 * Defining ratings: perimeterD=70 and interiorD=72 are both solidly good
 * (versatile defender who can guard multiple positions, unlike threeAndD's
 * perimeter-only 90/62 split) and three=58 is just competent enough to
 * space the floor without being a real weapon. No rating in this profile
 * cracks 80 on offense — deliberately unglamorous, this archetype's value
 * is in playing 30+ solid minutes without a hole in the profile, not in
 * any single elite skill.
 */
export function glueForward(who: Named): Player {
  return makePlayer({
    pos: 'PF', heightIn: 80, weightLb: 235, ...who,
    attr: {
      speed: 68, accel: 64, lateral: 66, stamina: 82, strength: 78, vertical: 70,
      finishing: 74, midRange: 60, three: 58, freeThrow: 74, drawFoul: 50,
      ballHandle: 54, passAcc: 64, passVision: 60,
      perimeterD: 70, interiorD: 72, steal: 52, block: 52, contestSkill: 70,
      offReb: 56, defReb: 72, boxout: 74,
      decisions: 72, consistency: 74
    },
    tend: {
      shotRim: 52, shotMid: 22, shotThree: 48, pullUp: 14,
      drive: 32, passOut: 58, iso: 8, post: 22,
      offBallMotion: 48, crashOffReb: 52,
      gambleSteal: 30, foulAggr: 44, pushPace: 42
    }
  });
}

/**
 * Backup rim protector — a limited but useful reserve center, "bring
 * energy off the bench and protect the rim" rather than a featured
 * scorer. Defining ratings: block=78 + interiorD=78 + offReb/defReb/
 * boxout all 80-82 keep this a genuinely useful rebounding/rim-protection
 * piece, but finishing=78/midRange=30/three=8 with decisions=56 (the
 * lowest of any center-type archetype here) mark this as a bench-caliber,
 * not a starter-caliber, offensive game — rimRunner's higher ceiling
 * (finishing=94, decisions=60, vertical=88 vs. this player's 70) is the
 * deliberate contrast: same rough shape (paint-bound big), clearly a tier
 * below.
 */
export function benchBig(who: Named): Player {
  return makePlayer({
    pos: 'C', heightIn: 83, weightLb: 255, ...who,
    attr: {
      speed: 52, accel: 48, lateral: 42, stamina: 70, strength: 84, vertical: 70,
      finishing: 78, midRange: 30, three: 8, freeThrow: 58, drawFoul: 56,
      ballHandle: 24, passAcc: 44, passVision: 38,
      perimeterD: 30, interiorD: 78, steal: 26, block: 78, contestSkill: 78,
      offReb: 80, defReb: 80, boxout: 82,
      decisions: 56, consistency: 62
    },
    tend: {
      shotRim: 92, shotMid: 6, shotThree: 1, pullUp: 2,
      drive: 12, passOut: 40, iso: 4, post: 38,
      offBallMotion: 40, crashOffReb: 86,
      gambleSteal: 16, foulAggr: 62, pushPace: 28
    }
  });
}

/**
 * Microwave bench scorer — instant offense off the bench, the "sixth man
 * who can heat up fast" type. Defining ratings: pullUp=68 + three=78 +
 * shotThree tendency=66 (a shot-hunting scorer who creates his own three
 * rather than waiting for a pass) and iso=52 (comfortable putting the ball
 * on the floor and going to work alone) contrast with decisions=54 and
 * consistency=58 — both the lowest offensive-decision-quality numbers of
 * any perimeter archetype here, which is the deliberate trade-off: high
 * scoring ceiling, streaky/inconsistent floor, exactly what "microwave"
 * implies (can go on a heater, can also go cold and keep shooting anyway).
 */
export function benchScorer(who: Named): Player {
  return makePlayer({
    pos: 'SG', heightIn: 77, weightLb: 205, ...who,
    attr: {
      speed: 80, accel: 80, lateral: 58, stamina: 78, strength: 56, vertical: 72,
      finishing: 76, midRange: 78, three: 78, freeThrow: 86, drawFoul: 58,
      ballHandle: 80, passAcc: 58, passVision: 50,
      perimeterD: 44, interiorD: 28, steal: 44, block: 18, contestSkill: 40,
      offReb: 20, defReb: 38, boxout: 24,
      decisions: 54, consistency: 58
    },
    tend: {
      shotRim: 48, shotMid: 44, shotThree: 66, pullUp: 68,
      drive: 58, passOut: 28, iso: 52, post: 4,
      offBallMotion: 64, crashOffReb: 12,
      gambleSteal: 44, foulAggr: 36, pushPace: 60
    }
  });
}

/**
 * Modern floor-spacing center — a big who stretches the defense beyond
 * the arc instead of posting up. Defining ratings: three=76 + freeThrow=82
 * (a legitimate outside shooter, distinct from rimRunner's 12/52 — this
 * archetype plays in space, not the paint) paired with shotThree=78 (heavily
 * prefers the three-point line, unlike rimRunner's shotThree=1) and gravity ≈
 * 0.77 (calculated as 0.65×76/100 + 0.35×78/100; exceeds the 0.42 threshold
 * in ai.ts#assignSpots so defenses cannot park him at the dunker spot). Post
 * tendency=8 and midRange=36 say this is not a back-to-basket big; finishing=80
 * and strength=88 keep him a legitimate rim threat when defenders sag. Interior
 * defense stays elite (84) but block=72 is lower than rimRunner's 90 — this
 * player prioritizes shooting over rim protection, the modern trade-off.
 */
export function stretchBig(who: Named): Player {
  return makePlayer({
    pos: 'C', heightIn: 84, weightLb: 265, ...who,
    attr: {
      speed: 66, accel: 62, lateral: 48, stamina: 78, strength: 88, vertical: 80,
      finishing: 80, midRange: 36, three: 76, freeThrow: 82, drawFoul: 58,
      ballHandle: 38, passAcc: 56, passVision: 52,
      perimeterD: 42, interiorD: 84, steal: 36, block: 72, contestSkill: 74,
      offReb: 62, defReb: 82, boxout: 80,
      decisions: 68, consistency: 74
    },
    tend: {
      shotRim: 58, shotMid: 12, shotThree: 78, pullUp: 22,
      drive: 24, passOut: 44, iso: 8, post: 8,
      offBallMotion: 62, crashOffReb: 48,
      gambleSteal: 22, foulAggr: 48, pushPace: 40
    }
  });
}
