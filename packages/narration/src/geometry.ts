/**
 * Court geography for narration: converts shot coordinates into the floor
 * names a broadcast actually says — "the left corner", "the right elbow",
 * "the top of the arc".
 *
 * Consumer-tier module (AGENTS.md §4.3): reads only event fields and the
 * engine's exported rule-pack/court geometry. Court dimensions are NEVER
 * duplicated here — they derive from the same RulePack the sim used, so a
 * league with different geometry (NCAA/EuroLeague) names its floor correctly
 * for free.
 *
 * Left/right convention: from the OFFENSE's perspective facing the basket it
 * is attacking (attacking the high-x rim, left = higher y; attacking the
 * low-x rim, left = lower y). Real broadcasts mix camera-side and
 * offense-side naming game to game; the booth picks offense-side and applies
 * it everywhere — consistency is what matters for a reader, not the choice.
 */

import { makeCourt, NBA, type Court, type RulePack, type ShotEvent } from '@hoopsh/engine';

export interface ShotSpot {
  /** definite-article floor name for prose: "the left corner" */
  name: string;
  /** bare form for tight constructions: "left corner" */
  short: string;
  side: 'left' | 'right' | 'center';
  /** comfortably behind the arc: 27+ ft (FEEL — where "deep" starts sounding right) */
  deep: boolean;
  /** 32+ ft (FEEL) — logo range; broadcasters stop naming the wing out here */
  logo: boolean;
  /** 40+ ft (FEEL) — a backcourt/midcourt heave, named by distance not by spot */
  heave: boolean;
}

/** Everything shot-spot naming needs from the league: built once per script. */
export interface GeoContext {
  court: Court;
  rules: RulePack;
}

export function makeGeo(rules: RulePack = NBA): GeoContext {
  return { court: makeCourt(rules), rules };
}

/**
 * Infer which rim a shot attacked by matching the event's own distFt against
 * the distance to each rim. Nearest-rim inference would misclassify heaves
 * (a 60-footer is nearer the shooter's OWN rim); distFt is authoritative
 * because the engine computed it against the attacked rim when it classified
 * the shot.
 */
function attackedRimIndex(geo: GeoContext, e: Pick<ShotEvent, 'x' | 'y' | 'distFt'>): 0 | 1 {
  const [r0, r1] = geo.court.rims;
  const d0 = Math.hypot(e.x - r0.x, e.y - r0.y);
  const d1 = Math.hypot(e.x - r1.x, e.y - r1.y);
  return Math.abs(d0 - e.distFt) <= Math.abs(d1 - e.distFt) ? 0 : 1;
}

function sideOf(geo: GeoContext, rimIdx: 0 | 1, y: number, centeredWithin: number): 'left' | 'right' | 'center' {
  const lateral = y - geo.court.centerY;
  if (Math.abs(lateral) < centeredWithin) return 'center';
  // facing +x (attacking the high-x rim), the shooter's left hand points
  // toward +y; facing -x it points toward -y.
  const left = rimIdx === 1 ? lateral > 0 : lateral < 0;
  return left ? 'left' : 'right';
}

/**
 * Name the floor for a shot event. Pure function of the event + league
 * geometry; the same (event, rules) pair always names the same spot.
 */
export function shotSpot(e: Pick<ShotEvent, 'x' | 'y' | 'distFt' | 'zone' | 'three'>, geo: GeoContext): ShotSpot {
  const rimIdx = attackedRimIndex(geo, e);
  const rim = geo.court.rims[rimIdx];
  const distFromBaseline = rimIdx === 0 ? e.x : geo.court.length - e.x;
  const lateral = Math.abs(e.y - geo.court.centerY);
  const deep = e.three && e.distFt >= 27;
  const logo = e.three && e.distFt >= 32;
  const heave = e.distFt >= 40;

  const spot = (name: string, side: ShotSpot['side']): ShotSpot => ({
    name: `the ${name}`,
    short: name,
    side,
    deep,
    logo,
    heave
  });

  if (heave) {
    // named by distance in templates ("from {dist} feet"); the spot text is a
    // fallback for templates that only have a {spot} slot.
    return { name: 'way beyond the arc', short: 'way beyond the arc', side: 'center', deep: true, logo: true, heave: true };
  }

  if (e.zone === 'three') {
    // corner threes live below the corner break — the SAME boundary the
    // engine's classifyShot uses, read from the rule pack rather than
    // re-typed here.
    if (distFromBaseline <= geo.rules.three.cornerBreakFt) {
      const side = sideOf(geo, rimIdx, e.y, 0);
      return spot(`${side} corner`, side);
    }
    const side = sideOf(geo, rimIdx, e.y, 6); // 6 ft (FEEL): "top of the arc" tolerance
    if (side === 'center') return spot('top of the arc', 'center');
    return spot(`${side} wing`, side);
  }

  if (e.zone === 'mid') {
    // 5 ft (FEEL): a jumper this close to the baseline reads as "baseline"
    // regardless of exact angle.
    if (distFromBaseline <= 5 && lateral > 6) {
      const side = sideOf(geo, rimIdx, e.y, 0);
      return spot(`${side} baseline`, side);
    }
    // elbow box: where the free-throw line meets the lane — ~13-19 ft up the
    // floor from the rim, 4-11 ft off center (FEEL box around the real elbow;
    // the engine does not model lane lines, so this is a naming region, not
    // a rules boundary).
    const upFloor = rimIdx === 0 ? e.x - rim.x : rim.x - e.x;
    if (upFloor >= 13 && upFloor <= 19 && lateral >= 4 && lateral <= 11) {
      const side = sideOf(geo, rimIdx, e.y, 0);
      return spot(`${side} elbow`, side);
    }
    if (lateral < 4 && e.distFt >= 12) return spot('free-throw line', 'center');
    const side = sideOf(geo, rimIdx, e.y, 4);
    if (side === 'center') return spot('top of the key', 'center');
    return spot(`${side} wing`, side);
  }

  if (e.zone === 'paint') {
    const side = sideOf(geo, rimIdx, e.y, 5);
    // the short corner: baseline-adjacent paint real estate outside the
    // restricted area — a real named spot bigs float to.
    if (distFromBaseline <= 6 && side !== 'center') return spot(`${side} short corner`, side);
    return spot('lane', side);
  }

  // zone 'rim'
  return spot('rim', 'center');
}
