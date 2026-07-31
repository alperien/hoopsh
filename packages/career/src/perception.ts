/**
 * perception.ts - the one fog primitive for players OUTSIDE the league
 * (prospects in circuits): recruiting programs and NBA scouts both read
 * you through this, so the two systems can never diverge. OWNER: stock
 * task (recruiting consumes). STATUS: implemented (build wave A).
 *
 * Contract mirrors franchise scouting.ts's determinism law: a FIXED
 * number of gaussian draws from a fresh stream per (observerKey, player)
 * call, never a shared advancing stream; error sd narrows with coverage.
 * franchise/src/scouting.ts is the anchor for the whole shape (its
 * noiseTable/biasTable/errorSdFor trio); once the career player enters
 * the league's draft class (stock.ts#enterDraftClass) that file's fog
 * takes over the read natively.
 *
 * Streams (career.seed root; fixed draw counts per call):
 *   career-scout:<observerKey>:<playerId>   12 gaussian draws (6 groups x
 *                                           now+ceiling) - one observer's
 *                                           persistent read on one player
 *   career-scout-bias:<observerKey>         6 gaussian draws - the
 *                                           observer's per-group lean (his
 *                                           shooting scout runs hot),
 *                                           coverage never shrinks it
 */
import { clamp } from '@hoopsh/engine';
import type { AttrGroup, FrPlayer } from '@hoopsh/franchise';
import { streamRng } from '@hoopsh/franchise';
import { groupMean } from '../../franchise/src/people/dev.js';
import type { CareerParams } from './params.js';

/**
 * Stable group iteration order (types.ts PotentialProfile declaration
 * order, identical to franchise scouting.ts GROUP_ORDER). Slot i of the
 * noise table is group i's now read; slot i+6 its ceiling read - a fixed
 * mapping so a read can never migrate between groups.
 */
export const GROUP_ORDER: readonly AttrGroup[] = [
  'phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental',
];

// Error-band constants. FEEL, anchored: they mirror the franchise fog's
// calibrated values (franchise params.scouting baseErrorSd 9 /
// fullCoverageErrorSd 4 / teamBiasSd 3, consumed by scouting.ts) so a
// prospect crossing the draft-entry seam feels the SAME fog before and
// after the handoff. Module constants rather than career params because
// the frozen CareerParams.stock shape carries no error-band fields; a
// future params-shape reopen can promote them.
const BASE_ERROR_SD = 9;           // FEEL: rating points of read error at zero coverage (mirrors scouting.ts anchor)
const FULL_COVERAGE_ERROR_SD = 4;  // FEEL: error sd at coverage 100 - never zero, the draft stays a gamble (mirrors scouting.ts anchor)
const OBSERVER_BIAS_SD = 3;        // FEEL: persistent per-group observer lean (mirrors franchise teamBiasSd)

export interface PerceivedGroups {
  now: Record<AttrGroup, number>;
  ceiling: Record<AttrGroup, number>;
}

/**
 * What one observer believes about a circuit player. observerKey is
 * stable per observer (a program id, an NBA team's scoutSeed); coverage
 * 0-100 narrows the error like franchise scouting coverage does.
 *
 * Now reads target the truth of the current dials (groupMean over attr);
 * ceiling reads target the hidden potential. Both get the observer's
 * persistent per-group bias plus coverage-scaled noise, clamped to the
 * 0-100 rating scale. Pure read: only fresh fixed-count streams are
 * drawn (file header), so call order can never change a belief.
 *
 * `params` is part of the frozen signature but unread today (STAGED):
 * the error bands are the module constants above; the parameter is the
 * seam a params-shape reopen would wire them through.
 */
export function perceiveProspect(
  seed: string,
  observerKey: string | number,
  player: FrPlayer,
  coverage: number,
  params: CareerParams,
): PerceivedGroups {
  void params; // STAGED seam, see JSDoc - referenced so the intent is explicit

  // per-(observer, player) noise: 2 kinds x 6 groups = 12 fixed draws,
  // every call, no exceptions (the franchise noiseTable discipline)
  const noiseRng = streamRng(seed, 'career-scout', String(observerKey), player.id);
  const noise: number[] = [];
  for (let i = 0; i < GROUP_ORDER.length * 2; i++) noise.push(noiseRng.gaussian(0, 1));

  // per-observer bias: the persistent DIRECTION of this observer's error,
  // one draw per group, shared by the group's now and ceiling reads.
  // More coverage sharpens the read; it never buys different scouts.
  const biasRng = streamRng(seed, 'career-scout-bias', String(observerKey));
  const bias: number[] = [];
  for (let i = 0; i < GROUP_ORDER.length; i++) bias.push(biasRng.gaussian(0, OBSERVER_BIAS_SD));

  // linear ease from the zero-coverage band to the full-coverage band
  // (identical shape to franchise scouting.ts#errorSdFor)
  const sd = BASE_ERROR_SD
    + (FULL_COVERAGE_ERROR_SD - BASE_ERROR_SD) * (clamp(coverage, 0, 100) / 100);

  const now = {} as Record<AttrGroup, number>;
  const ceiling = {} as Record<AttrGroup, number>;
  GROUP_ORDER.forEach((g, gi) => {
    now[g] = clamp(groupMean(player.attr, g) + bias[gi]! + noise[gi]! * sd, 0, 100);
    ceiling[g] = clamp(
      player.potential[g] + bias[gi]! + noise[gi + GROUP_ORDER.length]! * sd, 0, 100,
    );
  });
  return { now, ceiling };
}
