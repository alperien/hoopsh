/**
 * Archetype builders — reusable ratings profiles for tests, fixtures, and
 * quick roster assembly. Each returns a full Player via engine defaults.
 *
 * These are also the acceptance fixtures: the archetype test suite asserts
 * that an "elite shooter" actually behaves like one at season scale.
 */

import { makePlayer, type Player, type Position } from '@hoopsh/engine';

interface Named {
  id: string;
  name: string;
  pos?: Position;
  heightIn?: number;
  weightLb?: number;
}

/** off-movement three-point assassin (the "plays like Curry" fixture) */
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

/** lob-catching, rim-running, rebound-eating center */
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

/** pass-first table-setter who lives in the paint-to-kick game */
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

/** corner-spacing, point-of-attack stopper */
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

/** do-everything scoring wing */
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
      drive: 74, passOut: 42, iso: 60, post: 12,
      offBallMotion: 58, crashOffReb: 22,
      gambleSteal: 38, foulAggr: 36, pushPace: 55
    }
  });
}

/** bruising post scorer with soft touch */
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

/** steady rotation guard */
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

/** big-minutes glue forward */
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

/** backup rim protector */
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

/** microwave bench scorer */
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
