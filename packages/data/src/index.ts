// Package barrel — three groups: reusable ratings-profile builders
// (archetypes.js, also used directly by tests as acceptance fixtures — see
// archetypes.ts's file header), the two calibration rosters + their default
// matchup (teams.js — see teams.ts's file header for why these two specific
// teams are load-bearing for calibration, not just demo flavor), and the
// data-pack validation surface (schema.js — the mod/content boundary).
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
