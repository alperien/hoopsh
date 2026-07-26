/**
 * Data packs: versioned JSON containers for teams/rosters, with validation.
 * The deep editor (roadmap) reads and writes exactly this format.
 *
 * This file IS the mod surface — it's the one place in the codebase that
 * defines what a hand-edited team file is allowed to look like. Anyone
 * writing a custom roster (or, eventually, the roadmap's visual editor)
 * only ever has to satisfy validateTeamPack(); they never need to know how
 * the engine internally represents a Team. That's a deliberate boundary:
 * export-rosters.ts (harness) produces packs FROM code-defined teams via
 * toTeamPack(), and simone.ts/cli.ts consume hand-edited packs back IN via
 * loadTeamPack() — the JSON on disk is the actual contract, this file is
 * just where it's enforced.
 *
 * VALIDATION PHILOSOPHY: strict rejection, not lenient fill-in. Every
 * problem becomes one ValidationIssue with a JSONPath-style `path` (e.g.
 * `$.team.players[3].attr.three`) and a plain-English `message`, and
 * loadTeamPack() refuses to hand back a Team at all if the issues list is
 * non-empty (see its last line: `team: issues.length === 0 ? … : null`).
 * There is no partial-pack recovery, no defaulting a missing rating to 50 —
 * a pack either fully satisfies the schema or it's rejected outright with a
 * full list of every problem (not just the first one hit), so a hand-editor
 * gets one error dump to fix everything, not a slow one-issue-at-a-time
 * loop. The alternative (silently defaulting bad fields) was rejected
 * because a silently-defaulted rating is exactly the kind of thing that
 * would make a custom roster play nothing like what its numbers say —
 * defeating the entire point of a data pack being an honest description of
 * a team.
 */

import type { Attributes, Player, Team, Tendencies } from '@hoopsh/engine';

// Bump this whenever the pack SHAPE changes in a way old packs can't satisfy
// (a renamed/added required field, a changed range). validateTeamPack()
// checks it exactly (`!==`), not >=, so old packs fail loudly and explicitly
// ("expected 1") rather than partially validating against a newer shape they
// were never written for.
// v2: tend.usage joined the player model (closed-loop share of offense) —
// v1 packs fail validation and need the field added (default 50 = neutral)
export const DATA_PACK_VERSION = 2;

export interface TeamPack {
  formatVersion: number;
  kind: 'team';
  team: Team;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

// Every Attributes/Tendencies key, enumerated by hand rather than derived
// via `Object.keys` on a sample object — this means validation is exhaustive
// even for a pack that's MISSING a key entirely (Object.keys on the pack's
// own data would only ever find what's already there). Keeping ATTR_KEYS/
// TEND_KEYS in sync with @hoopsh/engine's Attributes/Tendencies types is a
// manual responsibility of whoever adds a new rating there — TypeScript
// won't catch a forgotten key here since these are plain string arrays.
//
// EXPORTED (along with the range constants below) so authoring tooling —
// tools/gen-schema.mjs (the JSON Schema generator) and tools/roster-*.mjs —
// derives its key lists and ranges from the SAME arrays this validator
// enforces. That import edge is the anti-drift mechanism: there is no second
// hand-copied key list anywhere for a new rating to be forgotten from. Add a
// key here and every downstream tool picks it up on next run (the committed
// data/schema/team-pack.schema.json is guarded by a regenerate-and-compare
// test in packages/data/test/gen-schema.test.ts, so it can't go stale
// silently either).
export const ATTR_KEYS: (keyof Attributes)[] = [
  'speed', 'accel', 'strength', 'vertical', 'lateral', 'stamina',
  'finishing', 'midRange', 'three', 'freeThrow', 'drawFoul',
  'ballHandle', 'passAcc', 'passVision',
  'perimeterD', 'interiorD', 'steal', 'block', 'contestSkill',
  'offReb', 'defReb', 'boxout', 'decisions', 'consistency'
];

export const TEND_KEYS: (keyof Tendencies)[] = [
  'shotRim', 'shotMid', 'shotThree', 'pullUp',
  'drive', 'passOut', 'iso', 'post',
  'offBallMotion', 'crashOffReb', 'gambleSteal', 'foulAggr', 'pushPace', 'usage'
];

// The numeric rules the validator enforces, as named exports for the same
// tooling-derivation reason as ATTR_KEYS/TEND_KEYS above. The validator
// itself reads these constants (not re-typed literals), so a generated
// schema and validateTeamPack() can only ever disagree if someone edits one
// of these values and fails to regenerate — which the gen-schema test
// catches. Values are the engine's own contracts: heightIn bounds are
// generous human limits (5'0"–8'0"), MIN_PLAYERS is the smallest roster the
// rotation model can run without fouling out into a forfeit corner, and
// STARTERS_COUNT is basketball itself.
export const RATING_MIN = 0;
export const RATING_MAX = 100;
export const POSITIONS: readonly string[] = ['PG', 'SG', 'SF', 'PF', 'C'];
export const HEIGHT_MIN_IN = 60;
export const HEIGHT_MAX_IN = 96;
export const MIN_PLAYERS = 8;
export const STARTERS_COUNT = 5;
export const TACTICS_KEYS: readonly string[] = ['pace', 'threeBias', 'helpAggr'];

// Every rating in this engine — attribute or tendency alike — lives on the
// same 0-100 scale, so one helper covers both ATTR_KEYS and TEND_KEYS below.
function isRating(x: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x) && x >= RATING_MIN && x <= RATING_MAX;
}

// Validates ONE player object, appending every issue found (not just the
// first) to the shared `issues` array — this is why validateTeamPack()
// below can hand back a complete error report for a whole broken pack in
// one pass instead of the hand-editor fixing one field, re-running, hitting
// the next field, and so on.
function validatePlayer(p: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof p !== 'object' || p === null) {
    issues.push({ path, message: 'player must be an object' });
    return;
  }
  const pl = p as Partial<Player>;
  if (!pl.id || typeof pl.id !== 'string') issues.push({ path: `${path}.id`, message: 'missing id' });
  if (!pl.name || typeof pl.name !== 'string') issues.push({ path: `${path}.name`, message: 'missing name' });
  if (!POSITIONS.includes(pl.pos as string)) {
    issues.push({ path: `${path}.pos`, message: `invalid position ${String(pl.pos)}` });
  }
  if (typeof pl.heightIn !== 'number' || !Number.isFinite(pl.heightIn)
    || pl.heightIn < HEIGHT_MIN_IN || pl.heightIn > HEIGHT_MAX_IN) {
    issues.push({ path: `${path}.heightIn`, message: `heightIn must be a finite number ${HEIGHT_MIN_IN}-${HEIGHT_MAX_IN}` });
  }
  const attr = pl.attr as Record<string, unknown> | undefined;
  if (!attr) issues.push({ path: `${path}.attr`, message: 'missing attributes' });
  else {
    for (const k of ATTR_KEYS) {
      if (!isRating(attr[k])) issues.push({ path: `${path}.attr.${k}`, message: 'rating must be 0-100' });
    }
  }
  const tend = pl.tend as Record<string, unknown> | undefined;
  if (!tend) issues.push({ path: `${path}.tend`, message: 'missing tendencies' });
  else {
    for (const k of TEND_KEYS) {
      if (!isRating(tend[k])) issues.push({ path: `${path}.tend.${k}`, message: 'rating must be 0-100' });
    }
  }
}

/**
 * Validate a raw parsed pack top-to-bottom, returning every issue found
 * (empty array = valid). Structured as a series of early-outs only where a
 * missing field makes deeper checks meaningless (e.g. no `team` object at
 * all means there's nothing to validate players against), but otherwise
 * keeps accumulating into the same `issues` array so unrelated problems
 * (a bad formatVersion AND three players with out-of-range ratings) all
 * surface together.
 */
export function validateTeamPack(pack: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof pack !== 'object' || pack === null) {
    return [{ path: '$', message: 'pack must be an object' }];
  }
  const tp = pack as Partial<TeamPack>;
  if (tp.formatVersion !== DATA_PACK_VERSION) {
    issues.push({ path: '$.formatVersion', message: `expected ${DATA_PACK_VERSION}` });
  }
  if (tp.kind !== 'team') issues.push({ path: '$.kind', message: 'expected "team"' });
  const team = tp.team as Partial<Team> | undefined;
  if (!team || typeof team !== 'object') {
    issues.push({ path: '$.team', message: 'missing team' });
    return issues;
  }
  if (!team.id) issues.push({ path: '$.team.id', message: 'missing id' });
  // tactics is REQUIRED by the engine (ai reads threeBias/helpAggr
  // unconditionally, with no fallback) — a pack missing tactics wouldn't
  // fail gracefully at sim time, it would crash mid-game the first time the
  // AI needs a tactics-driven decision. Rejecting it here, at load time with
  // a clear message, is strictly better than that runtime crash — this is
  // the schema acting as a crash-prevention gate, not just a style check.
  const tactics = team.tactics as Record<string, unknown> | undefined;
  if (!tactics || typeof tactics !== 'object') {
    issues.push({ path: '$.team.tactics', message: 'missing tactics — need { pace, threeBias, helpAggr } each 0-100' });
  } else {
    for (const k of TACTICS_KEYS) {
      if (!isRating(tactics[k])) issues.push({ path: `$.team.tactics.${k}`, message: 'must be 0-100' });
    }
  }
  if (!Array.isArray(team.players) || team.players.length < MIN_PLAYERS) {
    issues.push({ path: '$.team.players', message: `need at least ${MIN_PLAYERS} players` });
  } else {
    team.players.forEach((p, i) => validatePlayer(p, `$.team.players[${i}]`, issues));
    const ids = new Set(team.players.map((p) => p.id));
    if (ids.size !== team.players.length) {
      issues.push({ path: '$.team.players', message: 'duplicate player ids' });
    }
    // Exactly 5, not "at least 5" — the engine's on-court model assumes
    // precisely five starters take the opening lineup; a 4- or 6-name
    // starters list isn't a smaller/larger valid roster, it's malformed.
    if (!Array.isArray(team.starters) || team.starters.length !== STARTERS_COUNT) {
      issues.push({ path: '$.team.starters', message: `exactly ${STARTERS_COUNT} starters required` });
    } else {
      for (const sid of team.starters) {
        if (!ids.has(sid)) issues.push({ path: '$.team.starters', message: `starter ${sid} not on roster` });
      }
      // A REPEATED id also isn't five starters — ["a","a","b","c","d"] passes
      // both checks above (length 5, every id on roster) yet hands the engine
      // an opening lineup where the same player occupies two of the five
      // on-court slots. game.ts's own validateTeam() has the same blind spot,
      // so nothing downstream would save the author from a very confusing
      // 4-player game; reject it here at load time like every other
      // crash-shaped malformation.
      if (new Set(team.starters).size !== STARTERS_COUNT) {
        issues.push({ path: '$.team.starters', message: 'duplicate starter ids' });
      }
    }
  }
  return issues;
}

/** Wrap a code-defined Team (e.g. @hoopsh/data's cascadiaBreakers()) as a
 * pack ready to JSON.stringify to disk — the export-rosters.ts harness
 * script's whole job, and the inverse of loadTeamPack() below. */
export function toTeamPack(team: Team): TeamPack {
  return { formatVersion: DATA_PACK_VERSION, kind: 'team', team };
}

/**
 * Parse + validate a pack from raw JSON text in one call — the entry point
 * simone.ts/cli.ts use for a `--home path/to/team.json` flag. Two distinct
 * failure paths report through the same ValidationIssue shape: a JSON
 * syntax error becomes one issue at path `$`, while a well-formed-but-
 * invalid pack goes through the full validateTeamPack() field-by-field
 * report. Either way `team` comes back null on any issue — see the schema
 * philosophy note at the top of this file for why there's no partial pack.
 */
export function loadTeamPack(json: string): { team: Team | null; issues: ValidationIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { team: null, issues: [{ path: '$', message: `invalid JSON: ${String(err)}` }] };
  }
  const issues = validateTeamPack(parsed);
  return { team: issues.length === 0 ? (parsed as TeamPack).team : null, issues };
}
