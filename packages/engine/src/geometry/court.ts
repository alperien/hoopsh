import type { RulePack } from '../rules/rulepack.js';
import type { V2 } from '../core/vec.js';
import { dist } from '../core/vec.js';
import type { ShotZone } from '../core/events.js';

/**
 * Court geometry derived from a rule pack.
 * Coordinates: origin at home baseline left corner; x runs the length of the
 * court, y the width. Home attacks the HIGH-x rim in periods 1-2 by convention
 * (the sim flips attack direction at halftime like real basketball).
 */
export interface Court {
  length: number;
  width: number;
  midX: number;
  centerY: number;
  /** rims[0] at low-x baseline, rims[1] at high-x baseline */
  rims: [V2, V2];
  ftSpots: [V2, V2];
}

export function makeCourt(rules: RulePack): Court {
  const w = rules.courtWidthFt;
  const l = rules.courtLengthFt;
  return {
    length: l,
    width: w,
    midX: l / 2,
    centerY: w / 2,
    rims: [
      { x: rules.rimInsetFt, y: w / 2 },
      { x: l - rules.rimInsetFt, y: w / 2 }
    ],
    ftSpots: [
      { x: rules.ftLineFt, y: w / 2 },
      { x: l - rules.ftLineFt, y: w / 2 }
    ]
  };
}

export interface ShotLocation {
  distFt: number;
  zone: ShotZone;
  three: boolean;
}

/**
 * Classify a shot location against the attacked rim.
 * Corner threes use the straight-line rule inside the corner-break distance;
 * everything past the break uses the arc.
 */
export function classifyShot(rules: RulePack, court: Court, rim: V2, p: V2): ShotLocation {
  const d = dist(p, rim);
  const distFromBaseline = rim.x < court.midX ? p.x : court.length - p.x;
  const lateral = Math.abs(p.y - court.centerY);

  let three: boolean;
  if (distFromBaseline <= rules.three.cornerBreakFt) {
    three = lateral >= rules.three.cornerDistFt;
  } else {
    three = d >= rules.three.arcRadiusFt;
  }

  let zone: ShotZone;
  if (three) zone = 'three';
  else if (d <= 4) zone = 'rim';
  else if (d <= 14) zone = 'paint';
  else zone = 'mid';

  return { distFt: d, zone, three };
}

/** halfcourt spacing spots for the offense attacking `rim` (5-out template) */
export function spacingSpots(court: Court, rim: V2): { key: string; pos: V2 }[] {
  // direction from rim toward midcourt
  const dir = rim.x < court.midX ? 1 : -1;
  const cy = court.centerY;
  const baselineX = rim.x - dir * 2.25; // roughly the baseline in front of rim

  const spot = (dx: number, y: number): V2 => ({ x: rim.x + dir * dx, y });

  return [
    { key: 'top', pos: spot(26, cy) },
    { key: 'wing_l', pos: spot(21, cy - 15.5) },
    { key: 'wing_r', pos: spot(21, cy + 15.5) },
    { key: 'corner_l', pos: { x: baselineX + dir * 4, y: cy - 21.5 } },
    { key: 'corner_r', pos: { x: baselineX + dir * 4, y: cy + 21.5 } },
    { key: 'dunker', pos: spot(4, cy + 9) },
    { key: 'elbow_l', pos: spot(16, cy - 8) },
    { key: 'elbow_r', pos: spot(16, cy + 8) },
    { key: 'short_roll', pos: spot(11, cy) }
  ];
}
