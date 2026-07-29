// @hoopsh/data — the team/player content boundary: ratings-profile builders,
// the two calibration rosters, and TeamPack JSON validation/loading.
//
// Start here: `loadTeamPack(json)` → `TeamPackLoadResult` — it returns a
// { team, issues } envelope, NOT a bare Team; check `issues` before handing
// `team` to the engine (`team` is null when validation fails).
//
// Package barrel — three groups: reusable ratings-profile builders
// (archetypes.js, also used directly by tests as acceptance fixtures — see
// archetypes.ts's file header), the two calibration rosters + their default
// matchup (teams.js — see teams.ts's file header for why these two specific
// teams are load-bearing for calibration, not just demo flavor), and the
// data-pack validation surface (schema.js — the mod/content boundary).
import type { Team } from '@hoopsh/engine';
import type { ValidationIssue } from './schema.js';

export {
  eliteShooter, rimRunner, floorGeneral, threeAndD, scoringWing,
  postAnchor, comboGuard, glueForward, benchBig, benchScorer, stretchBig
} from './archetypes.js';
export { cascadiaBreakers, meridianMonarchs, sampleMatchup } from './teams.js';
export {
  DATA_PACK_VERSION, validateTeamPack, toTeamPack, loadTeamPack,
  // shared definitions (key lists + range rules) — exported for the roster
  // tooling (tools/gen-schema.mjs & friends) so the generated JSON Schema
  // derives from the exact arrays the validator enforces; see schema.ts.
  ATTR_KEYS, TEND_KEYS, TACTICS_KEYS, POSITIONS,
  RATING_MIN, RATING_MAX, HEIGHT_MIN_IN, HEIGHT_MAX_IN,
  MIN_PLAYERS, STARTERS_COUNT
} from './schema.js';
export type { TeamPack, ValidationIssue } from './schema.js';

/**
 * Named envelope returned by `loadTeamPack()`. `team` is null whenever
 * `issues` contains an error — never pass `team` to `simulateGame` without
 * checking `issues` first (a null team fails there with an unhelpful
 * "team.players is not iterable").
 */
export interface TeamPackLoadResult {
  team: Team | null;
  issues: ValidationIssue[];
}
