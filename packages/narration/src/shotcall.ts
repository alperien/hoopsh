/**
 * Shot-call classification: which basketball NAME a shot attempt gets in
 * text — layup / dunk / hook shot / tip-in / jump shot.
 *
 * Derived ENTIRELY from data already on the ShotEvent (zone, distFt,
 * moveType, made) plus the shooter's static attributes (vertical/finishing
 * decide who dunks) — no new event fields, no randomness: the same event
 * always renders the same call, so narration stays deterministic and
 * replay-stable.
 *
 * Why this exists: the PBP Turing baseline's judges flagged shot-type
 * monotony as a working tell — "every 2-point shot in the excerpt (seven
 * attempts, including makes at 5-8 ft) is labeled 'jump shot' with zero
 * layups or rim finishes" (data/nba/flow-reference.json meta.turingBaseline).
 * Real basketball-reference logs use a small fixed vocabulary; measured over
 * the six-game reference corpus (same games as flow-reference.json):
 *   3-pt jump shot 456 | 2-pt jump shot 275 | layup 245 | dunk 62 | hook 25
 * with distance profiles: dunks live at 0-2 ft (61/62), layups at 0-4 ft
 * (218/245) with a tail to 6-7 ft, hooks at 2-8 ft, and 2-pt jump shots
 * only start mattering at 4+ ft. The rules below reproduce that grammar
 * from the sim's own shot data.
 *
 * The thresholds are PRESENTATIONAL constants (they name shots, they do not
 * change any sim outcome), so they live here with the renderer rather than
 * on the engine's SimParams sweep surface.
 */

import type { ShotMoveType, ShotZone } from '@hoopsh/engine';

export type ShotCall = 'jump shot' | 'layup' | 'dunk' | 'hook shot' | 'tip-in';

/** the subset of ShotEvent the classifier reads */
export interface ShotLike {
  zone: ShotZone;
  distFt: number;
  moveType: ShotMoveType;
  three: boolean;
  made: boolean;
}

/** the shooter attributes that decide who throws it down */
export interface ShooterTraits {
  vertical: number;
  finishing: number;
}

// -- presentational thresholds (measured against the reference corpus) ------
/** real dunks sit at 0-2 ft (61/62 in the corpus) */
const DUNK_MAX_FT = 2.25;
/** 0.6·vertical + 0.4·finishing at/above this reads as a dunker — ground-bound
 *  finishers lay the same attempt in. Sized against roster attribute spreads
 *  so roughly the springiest quarter of rotations dunk their point-blank
 *  makes (real dunk share of 0-2 ft makes ≈ 27%). */
const DUNK_ATHLETE_SCORE = 74;
// KEEP IN SYNC: the engine's lob/leak-out gates mirror this score and the
// 0.6/0.4 blend (engine/src/sim/params.ts ai.lobAthleteGate/lobBlendVert/
// lobBlendFin) — the booth's definition of who dunks IS the engine's
// definition of who gets thrown the lob. The engine cannot import this
// package (it imports nothing); a sync test pins the pair from the outside.
/** a putback tapped straight back up from point-blank reads as a tip-in */
const TIP_IN_MAX_FT = 1.6;
/** drives/cuts/putbacks finish as layups out to the real layup tail (~6-7 ft) */
const LAYUP_DRIVE_MAX_FT = 6.5;
/** a stationary dump-off catch finishes as a layup from a bit closer in */
const LAYUP_CATCH_MAX_FT = 5.5;
/** post moves inside this are hooks; beyond it a post shot is a turnaround J */
const HOOK_MAX_FT = 13;
/** post moves closer than this are drop-step finishes, not hooks */
const HOOK_MIN_FT = 3;

/**
 * Name the shot. Deterministic; safe to call without traits (falls back to
 * layup rather than dunk when the shooter's athleticism is unknown).
 *
 * Order matters: tip-in and dunk claim the point-blank range first, the
 * hook claims post moves, the layup claims the rest of the close range by
 * how the shot was created (a 5-ft PULL-UP is a short jumper — real logs
 * are full of 4-6 ft jump shots — while a 5-ft drive finish is a layup),
 * and everything else is a jump shot.
 */
export function shotCall(e: ShotLike, traits?: ShooterTraits): ShotCall {
  if (e.three || e.moveType === 'heave') return 'jump shot';

  // point-blank putback with no gather: a tip
  if (e.moveType === 'putback' && e.distFt <= TIP_IN_MAX_FT) return 'tip-in';

  // dunks: point-blank MAKES by genuinely springy finishers. Made-gated on
  // purpose — a failed point-blank attempt is scored/logged as a missed
  // layup (control was never established), which also keeps the rare missed
  // dunk from over-appearing relative to the corpus. Every moveType
  // qualifies (heave is already gone): at ≤2 ft even the AI's "pull_up"
  // label just means a gather off the dribble, and that finish IS the dunk
  // when the finisher has the hops.
  if (
    e.made &&
    e.distFt <= DUNK_MAX_FT &&
    traits !== undefined &&
    0.6 * traits.vertical + 0.4 * traits.finishing >= DUNK_ATHLETE_SCORE
  ) {
    return 'dunk';
  }

  // a worked post move in hook range is a hook; closer is a drop step (layup)
  if (e.moveType === 'post' && e.distFt >= HOOK_MIN_FT && e.distFt <= HOOK_MAX_FT) {
    return 'hook shot';
  }

  // the rim zone is layup territory no matter how the shooter got there —
  // even a "pull-up" gather at 3 ft is a layup in scorer's terms
  if (e.zone === 'rim') return 'layup';

  // short finishes outside the strict rim zone, by creation type
  if (
    (e.moveType === 'drive' || e.moveType === 'cut_finish' || e.moveType === 'putback') &&
    e.distFt <= LAYUP_DRIVE_MAX_FT
  ) {
    return 'layup';
  }
  if (e.moveType === 'catch_shoot' && e.distFt <= LAYUP_CATCH_MAX_FT) return 'layup';

  return 'jump shot';
}

/**
 * The basketball-reference measurement phrase for a shot: "from N ft", or
 * "at rim" for point-blank attempts — bbref never prints "from 0 ft"
 * (corpus: 50 "at rim" lines, zero "from 0 ft"). Exported for the dry
 * bbref-register renderer (harness turing.ts) and tests.
 */
export function distPhrase(distFt: number): string {
  const ft = Math.round(distFt);
  return ft <= 0 ? 'at rim' : `from ${ft} ft`;
}
