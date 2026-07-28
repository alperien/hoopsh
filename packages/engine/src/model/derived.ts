/**
 * Rating curves: 0-100 ratings -> physical/model quantities.
 * These curves are part of the calibration surface: documented, centralized,
 * and deliberately boring. Tune here to change what a "90 speed" means.
 *
 * Every curve below is linear in the raw 0-100 rating (no S-curves at the
 * attribute layer; the sigmoid nonlinearity already lives downstream in the
 * probability models). 50 always lands on a plausible "average NBA rotation
 * player" value; 0 and 100 are deliberately extreme (replacement level and
 * all-time outlier) so the full roster spread stays inside real-world bounds.
 */

import type { Attributes, Player } from './player.js';

/**
 * Max flat-out sprint speed, ft/s. Range 18 (rating 0) .. 28 (rating 100).
 * NBA players top out around 20-22 mph in a straight-line sprint (≈ 29-32
 * ft/s), but that's a track-style all-out effort; real on-court bursts are
 * shorter and interrupted by cuts, so the ceiling here sits a bit under that
 * physical max. The low end models a plodding, ground-bound center (~18
 * ft/s) who still has to jog the floor. Worked example: speed 90 -> 18 + 0.9
 * * 10 = 27 ft/s, i.e. a plus-athlete wing, just under the top end.
 */
export function sprintSpeed(attr: Attributes): number {
  return 18 + (attr.speed / 100) * 10;
}

/**
 * Acceleration off a stop or change of direction, ft/s^2. Range 16 (rating 0)
 * .. 30 (rating 100). This is the "first step" dial, separate from top
 * speed: a player can be a poor sprinter but still explosive out of a stance
 * (or vice versa, a long-strider who takes a beat to get going). Worked example:
 * accel 50 -> 16 + 0.5 * 14 = 23 ft/s^2, roughly a beat behind a defender's
 * closeout if he starts flat-footed a half-second late.
 */
export function acceleration(attr: Attributes): number {
  return 16 + (attr.accel / 100) * 14;
}

/**
 * Lateral defensive slide speed, ft/s. Range 14 (rating 0) .. 23 (rating
 * 100), deliberately slower than sprintSpeed's ceiling: a defensive
 * slide keeps the hips and shoulders square to the ball-handler rather than
 * turning and running. This is what caps how well a defender can stay in
 * front of a drive (see ai.ts `moveSpeed`, which uses this instead of sprint
 * speed while `intent === 'defend'`). Worked example: lateral 70 -> 14 + 0.7
 * * 9 = 20.3 ft/s, enough to mirror most drives but not run one down from a
 * standstill.
 */
export function lateralSpeed(attr: Attributes): number {
  return (14 + (attr.lateral / 100) * 9);
}

/**
 * Standing reach approximation, ft: the effective "how high can this player
 * contest/finish at" number consumed by contestAt/anticipatedContest (contest
 * quality) and shotMakeP's rim height term (finishing over length).
 *
 * Formula: (heightIn * 1.31 + (wingspan - heightIn) * 0.6) / 12.
 * The 1.31 factor is a standard anthropometric rule of thumb: a person's
 * standing reach (fingertips overhead) runs about 1.31x their height, since
 * reach = height + arm length + hand length, and arms/hands scale with
 * height. The (wingspan - heightIn) term is the "ape index" (how much
 * longer a player's arm span is than their height), and only 0.6 of that
 * extra span converts to reach, because reach is a mostly-vertical
 * measurement while wingspan is measured horizontally arms-out; a long
 * wingspan doesn't translate 1:1 into extra overhead height. Falls back to
 * heightIn + 2 when a player has no recorded wingspan (a modest, "average
 * proportions" guess). Worked example: a 6'8" (80 in) player with an 84 in
 * wingspan -> (80 * 1.31 + 4 * 0.6) / 12 = (104.8 + 2.4) / 12 ≈ 8.93 ft.
 */
export function reachFt(p: Player): number {
  const wingspan = p.wingspanIn ?? p.heightIn + 2;
  return (p.heightIn * 1.31 + (wingspan - p.heightIn) * 0.6) / 12;
}

/**
 * The rating-to-model bridge: 50 -> 0, 0 -> -1, 100 -> +1.
 * Every probability model in resolve.ts adds `coef * n(rating)` as a logit
 * term rather than using the raw 0-100 value directly. A rating of exactly
 * 50 therefore contributes nothing to any formula it feeds: a league-average
 * player is, by construction, invisible to the model, and the "base"
 * constants in SimParams are calibrated as "what happens when everyone
 * involved is exactly average." Ratings above 50 push a term positive (helps
 * the outcome the coefficient is signed toward), below 50 push it negative,
 * symmetric around the average. This is what makes SimParams safe to tune
 * independently of any specific roster: change a base rate and you've
 * changed the league-average outcome; change a skillCoef and you've changed
 * how much a player's rating can move that outcome away from average.
 */
export function n(rating: number): number {
  return (rating - 50) / 50;
}
