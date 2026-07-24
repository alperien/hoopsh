/**
 * The sweepable knob registry: which SimParams the optimizer may touch,
 * and the sane range for each. Paths are dot-notation into SimParams.
 *
 * Deliberately NOT swept: tick rate, court/rules values, rating curves,
 * and anything that changes the meaning of a rating (those are design,
 * not calibration).
 */

export interface Knob {
  path: string;
  lo: number;
  hi: number;
}

export const SWEEPABLE: Knob[] = [
  // pace & decision economy
  { path: 'decide.continuationMax', lo: 1.3, hi: 1.72 },
  { path: 'decide.continuationCurve', lo: 0.14, hi: 0.45 },
  { path: 'decide.temperature', lo: 0.035, hi: 0.09 },
  { path: 'decide.intervalSec', lo: 0.55, hi: 0.9 },
  { path: 'decide.threeAppetite', lo: 0.8, hi: 1.1 },
  { path: 'decide.driveAppetite', lo: 0.9, hi: 1.45 },
  { path: 'decide.transitionBonus', lo: 0.05, hi: 0.25 },

  // shot resolution
  { path: 'shot.baseRim', lo: 0.4, hi: 0.78 },
  { path: 'shot.basePaint', lo: -0.72, hi: -0.25 },
  { path: 'shot.baseMid', lo: -0.85, hi: -0.45 },
  { path: 'shot.baseThree', lo: -1.02, hi: -0.65 },
  { path: 'shot.contestCoef', lo: -1.5, hi: -0.82 },
  { path: 'shot.blockBase', lo: 0.18, hi: 0.45 },
  { path: 'shot.ftBasePct', lo: 0.69, hi: 0.75 },

  // fouls
  { path: 'foul.shootRim', lo: 0.26, hi: 0.52 },
  { path: 'foul.shootPaint', lo: 0.1, hi: 0.26 },
  { path: 'foul.reachInPerSec', lo: 0.008, hi: 0.026 },
  { path: 'foul.looseBallPerReb', lo: 0.01, hi: 0.04 },

  // turnovers
  { path: 'pass.riskBase', lo: -4.3, hi: -3.3 },
  { path: 'pass.stealShare', lo: 0.4, hi: 0.7 },

  // rebounding
  { path: 'reb.offWeightMult', lo: 0.6, hi: 1.25 },
  { path: 'reb.missDistBase', lo: 3.0, hi: 5.5 },

  // AI utility layer
  { path: 'ai.swingBase', lo: 0.0, hi: 0.08 },
  { path: 'ai.holdHalfcourt', lo: -0.08, hi: 0.05 },
  { path: 'ai.contestBrakeBase', lo: 0.3, hi: 0.75 },
  { path: 'ai.crashBase', lo: 0.15, hi: 0.4 },
  { path: 'ai.cutRateScale', lo: 0.003, hi: 0.011 }
];

/** set a dot-path on a nested object (mutates) */
export function setPath(obj: Record<string, unknown>, path: string, value: number): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]!] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** get a dot-path from a nested object */
export function getPath(obj: Record<string, unknown>, path: string): number {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur as number;
}
