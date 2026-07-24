/**
 * Rating curves: 0-100 ratings -> physical/model quantities.
 * These curves are part of the calibration surface — documented, centralized,
 * and deliberately boring. Tune here to change what a "90 speed" MEANS.
 */

import type { Attributes, Player } from './player.js';

/** max sprint speed, ft/s (NBA range roughly 18 (plodding big) .. 28 (elite)) */
export function sprintSpeed(attr: Attributes): number {
  return 18 + (attr.speed / 100) * 10;
}

/** acceleration, ft/s^2 */
export function acceleration(attr: Attributes): number {
  return 16 + (attr.accel / 100) * 14;
}

/** defensive lateral speed, ft/s */
export function lateralSpeed(attr: Attributes): number {
  return (14 + (attr.lateral / 100) * 9);
}

/** standing reach approximation, ft — used for contest/block effectiveness */
export function reachFt(p: Player): number {
  const wingspan = p.wingspanIn ?? p.heightIn + 2;
  return (p.heightIn * 1.31 + (wingspan - p.heightIn) * 0.6) / 12;
}

/** normalized rating helper: 50 -> 0, 0 -> -1, 100 -> +1 */
export function n(rating: number): number {
  return (rating - 50) / 50;
}
