// Generate the editor-facing JSON Schema (draft 2020-12) for TeamPack:
//   npm run schema:gen            regenerate data/schema/team-pack.schema.json
//   npm run schema:gen -- --check verify the committed file is current + exercise it
//
// Point a pack at it with a top-level
//   "$schema": "../../data/schema/team-pack.schema.json"
// (path relative to the pack file) and any JSON-Schema-aware editor gives
// autocomplete for all 38 rating keys, inline range errors, and hover docs
// pulled from the engine's own player-model comments. `npm run roster:new`
// emits packs with this line already in place.
//
// ANTI-DRIFT DESIGN (the reason this file is a generator, not a checked-in
// schema): every key list and numeric rule below is IMPORTED from
// @hoopsh/data's schema.ts — ATTR_KEYS, TEND_KEYS, TACTICS_KEYS, POSITIONS,
// RATING_MIN/MAX, HEIGHT_MIN/MAX_IN, MIN_PLAYERS, STARTERS_COUNT,
// DATA_PACK_VERSION — the same constants validateTeamPack() enforces at load
// time. There is no second hand-copied key list to forget when a new rating
// lands; add the key to schema.ts and regenerate. Per-rating hover docs are
// likewise EXTRACTED from packages/engine/src/model/player.ts's interface
// comments (the authoritative "what does this dial mean" text) rather than
// re-written here. The committed schema file is guarded by a
// regenerate-and-compare test (packages/data/test/gen-schema.test.ts), so it
// cannot go stale silently either.
//
// RELATION TO validateTeamPack() — deliberate, enumerated deltas only:
//   STRICTER (editor lint, catches mistakes the runtime validator ignores):
//     - unknown keys are rejected everywhere ("additionalProperties": false;
//       a typo'd tendency name gets flagged AT the typo, not just as a
//       missing-key error elsewhere). The root allows "$schema" itself.
//       Exception that is NOT a delta: inside attr/tend the runtime
//       validator rejects unknown keys too — the engine walks every key of
//       both bags and crashes on a non-numeric value (game.ts
//       assertValidRatings), so there the schema and the loader agree.
//     - wingspanIn/weightLb/rotationMinutes value types are checked by the
//       editor even where JSON cannot represent the non-finite numbers the
//       runtime validator guards against (JSON has no NaN/Infinity, so
//       "type": "number" is exactly the finiteness check).
//   LOOSER (rules draft 2020-12 cannot express — or not worth a hardcoded
//   enum here; validateTeamPack still enforces them, so
//   `npm run roster:validate` remains the final word):
//     - players[].id uniqueness across the roster
//     - every starters[] entry naming an id that exists in players[]
//     - rotationMinutes keys naming ids that exist in players[]
//     - players[].id must not collide with an Object.prototype key
//       ("constructor", "toString", ...) — ids key plain JSON objects
//       downstream and an inherited read silently corrupts (audit M-13);
//       the runtime check is `id in Object.prototype`, kept dynamic rather
//       than frozen into this schema as a static enum
//
// Run via the repo's zero-dependency runtime so the '@hoopsh/data' import
// resolves: node --import ./tools/register.mjs tools/gen-schema.mjs

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ATTR_KEYS, TEND_KEYS, TACTICS_KEYS, POSITIONS,
  RATING_MIN, RATING_MAX, HEIGHT_MIN_IN, HEIGHT_MAX_IN,
  MIN_PLAYERS, STARTERS_COUNT, DATA_PACK_VERSION
} from '@hoopsh/data';
import { validate } from './json-schema-lite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA_PATH = path.join(ROOT, 'data', 'schema', 'team-pack.schema.json');
const PLAYER_MODEL = path.join(ROOT, 'packages', 'engine', 'src', 'model', 'player.ts');

/**
 * Extract per-key doc comments from an interface body in player.ts — the
 * hover text an editor shows for each rating. Handles the two comment styles
 * that file uses: a JSDoc block immediately above the key, or a trailing
 * `// ...` on the key's own line. Section banners (`// physical`) are plain
 * line comments above a group, never JSDoc, so the look-back — which only
 * accepts a block whose closing star-slash sits directly above the key —
 * cannot mistake one for a description. Returns {} of key -> one-line text;
 * keys with no comment simply get no hover doc (a gap, not a failure — the
 * schema's job is ranges first, prose second).
 */
export function extractInterfaceDocs(source, interfaceName) {
  const iface = source.match(new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`));
  if (!iface) throw new Error(`gen-schema: interface ${interfaceName} not found in player.ts`);
  const lines = iface[1].split('\n');
  const docs = {};
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].match(/^\s*(\w+)\??:\s*(?:number|string)/);
    if (!key) continue;
    const trailing = lines[i].match(/;\s*\/\/\s*(.+)$/);
    if (trailing) {
      docs[key[1]] = trailing[1].trim();
      continue;
    }
    // walk back over a JSDoc block that ends directly above this key
    if (i > 0 && lines[i - 1].trim().endsWith('*/')) {
      const block = [];
      for (let j = i - 1; j >= 0; j--) {
        block.unshift(lines[j]);
        if (lines[j].includes('/**')) break;
      }
      docs[key[1]] = block.join(' ')
        .replace(/\/\*\*|\*\//g, '')
        .replace(/\s*\*\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return docs;
}

/** Build a properties map for one rating bag (attr/tend/tactics). */
function ratingProps(keys, docs) {
  const props = {};
  for (const k of keys) {
    props[k] = docs[k]
      ? { $ref: '#/$defs/rating', description: docs[k] }
      : { $ref: '#/$defs/rating' };
  }
  return props;
}

/** Assemble the full TeamPack JSON Schema object (deterministic key order). */
export function buildTeamPackSchema() {
  const playerSrc = readFileSync(PLAYER_MODEL, 'utf8');
  const attrDocs = extractInterfaceDocs(playerSrc, 'Attributes');
  const tendDocs = extractInterfaceDocs(playerSrc, 'Tendencies');
  const tacticsDocs = extractInterfaceDocs(playerSrc, 'Tactics');

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'hoopsh TeamPack',
    description:
      `GENERATED by tools/gen-schema.mjs from @hoopsh/data schema.ts — do not edit; ` +
      `regenerate with 'npm run schema:gen'. Hand-editable team/roster pack for the hoopsh ` +
      `engine (formatVersion ${DATA_PACK_VERSION}). This schema mirrors validateTeamPack() and adds editor lint ` +
      `(unknown keys rejected). Rules this schema cannot express are still enforced at load ` +
      `time by 'npm run roster:validate': player ids must be unique and must not collide with ` +
      `Object.prototype keys, and starters/rotationMinutes must reference ids that exist on the roster.`,
    type: 'object',
    required: ['formatVersion', 'kind', 'team'],
    properties: {
      $schema: {
        type: 'string',
        description: 'Optional editor hint — point at data/schema/team-pack.schema.json (relative to this file) for autocomplete and inline validation. Ignored by the loader.'
      },
      formatVersion: {
        const: DATA_PACK_VERSION,
        description: `Pack format version — must be exactly ${DATA_PACK_VERSION} (checked with !==, not >=; see DATA_PACK_VERSION in packages/data/src/schema.ts for the bump policy).`
      },
      kind: { const: 'team', description: 'Pack discriminator — team packs are the only kind today.' },
      team: { $ref: '#/$defs/team' }
    },
    additionalProperties: false,
    $defs: {
      rating: {
        type: 'number',
        minimum: RATING_MIN,
        maximum: RATING_MAX,
        description: `Every rating in the engine — attribute, tendency, or tactic — lives on the same ${RATING_MIN}-${RATING_MAX} scale. 50 is league average; attributes at 50 contribute exactly nothing to any probability model.`
      },
      attributes: {
        type: 'object',
        description: `What a player CAN do — all ${ATTR_KEYS.length} keys required, each ${RATING_MIN}-${RATING_MAX}. See packages/engine/src/model/player.ts for the authoritative meaning of each dial.`,
        required: [...ATTR_KEYS],
        properties: ratingProps(ATTR_KEYS, attrDocs),
        additionalProperties: false
      },
      tendencies: {
        type: 'object',
        description: `What a player WANTS to do — all ${TEND_KEYS.length} keys required, each ${RATING_MIN}-${RATING_MAX}. Shot-diet keys (shotRim/shotMid/shotThree) are relative appetites, not percentages.`,
        required: [...TEND_KEYS],
        properties: ratingProps(TEND_KEYS, tendDocs),
        additionalProperties: false
      },
      tactics: {
        type: 'object',
        description: 'Team-level style dials — required by the engine (the AI reads threeBias/helpAggr unconditionally; a missing tactics object would crash mid-game).',
        required: [...TACTICS_KEYS],
        properties: ratingProps(TACTICS_KEYS, tacticsDocs),
        additionalProperties: false
      },
      player: {
        type: 'object',
        required: ['id', 'name', 'pos', 'heightIn', 'weightLb', 'attr', 'tend'],
        properties: {
          id: { type: 'string', minLength: 1, description: 'Unique within the roster — starters and rotationMinutes reference this.' },
          name: { type: 'string', minLength: 1, description: 'Display name for box scores and play-by-play.' },
          pos: { enum: [...POSITIONS], description: 'Nominal position. The engine assigns matchups by body/skill, so this is descriptive, not prescriptive.' },
          heightIn: {
            type: 'number', minimum: HEIGHT_MIN_IN, maximum: HEIGHT_MAX_IN,
            description: `Height in inches, ${HEIGHT_MIN_IN}-${HEIGHT_MAX_IN} (5'0"-8'0"). Feeds shooting-over-defender geometry, rebounding, and matchup assignment.`
          },
          weightLb: {
            type: 'number',
            description: 'Weight in pounds. Read by defensive matchup-sorting every game — required (the sim refuses to start without it).'
          },
          wingspanIn: {
            type: 'number',
            description: 'Optional wingspan in inches; when absent the engine assumes heightIn + 2 (an average ape index). Feeds standing-reach contest geometry.'
          },
          attr: { $ref: '#/$defs/attributes' },
          tend: { $ref: '#/$defs/tendencies' }
        },
        additionalProperties: false
      },
      team: {
        type: 'object',
        required: ['id', 'name', 'abbrev', 'players', 'starters', 'tactics'],
        properties: {
          id: { type: 'string', minLength: 1, description: 'Stable team identifier (used in filenames and CLI flags).' },
          name: { type: 'string', minLength: 1, description: 'Full display name, e.g. "Cascadia Breakers".' },
          abbrev: { type: 'string', minLength: 1, description: 'Short scoreboard tag, e.g. "CAS".' },
          players: {
            type: 'array',
            minItems: MIN_PLAYERS,
            items: { $ref: '#/$defs/player' },
            description: `Roster — at least ${MIN_PLAYERS} players (the smallest roster the rotation model can run). Ids must be unique (enforced at load time).`
          },
          starters: {
            type: 'array',
            items: { type: 'string' },
            minItems: STARTERS_COUNT,
            maxItems: STARTERS_COUNT,
            uniqueItems: true,
            description: `Exactly ${STARTERS_COUNT} distinct player ids — the opening lineup. Each must exist in players[] (enforced at load time).`
          },
          tactics: { $ref: '#/$defs/tactics' },
          rotationMinutes: {
            type: 'object',
            additionalProperties: { type: 'number', minimum: 0 },
            description: 'Optional coach minutes targets, { playerId: minutes }. Players without a target sub on fatigue alone. NBA regulation max is 48 — higher is legal but implausible (roster:validate warns).'
          }
        },
        additionalProperties: false
      }
    }
  };
}

/** Serialize exactly as committed: 2-space indent + trailing newline. */
export function schemaText() {
  return JSON.stringify(buildTeamPackSchema(), null, 2) + '\n';
}

/**
 * --check gate: (1) committed file matches a fresh regeneration byte-for-byte,
 * (2) the schema actually accepts both shipped rosters and rejects a
 * deliberately broken variant, evaluated by json-schema-lite.mjs. Used by the
 * test suite and safe to wire into CI. Returns a list of failures.
 */
export function checkSchema() {
  const failures = [];
  const fresh = schemaText();
  if (!existsSync(SCHEMA_PATH)) {
    failures.push(`missing ${SCHEMA_PATH} — run: npm run schema:gen`);
    return failures;
  }
  if (readFileSync(SCHEMA_PATH, 'utf8') !== fresh) {
    failures.push('data/schema/team-pack.schema.json is stale — run: npm run schema:gen');
  }
  const schema = JSON.parse(fresh);
  for (const roster of ['breakers', 'monarchs']) {
    const file = path.join(ROOT, 'packages', 'data', 'rosters', `${roster}.team.json`);
    const pack = JSON.parse(readFileSync(file, 'utf8'));
    const errs = validate(schema, pack);
    if (errs.length > 0) {
      failures.push(`schema rejects shipped roster ${roster}: ${errs[0].path}: ${errs[0].message}`);
    }
    // sanity that the schema has teeth, not just that it says yes: break the
    // pack in a way only range/required checks would catch
    const broken = JSON.parse(JSON.stringify(pack));
    broken.team.players[0].attr.three = 400;
    delete broken.team.players[1].tend.usage;
    if (validate(schema, broken).length === 0) {
      failures.push(`schema failed to reject a broken ${roster} variant`);
    }
  }
  return failures;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  if (process.argv.includes('--check')) {
    const failures = checkSchema();
    if (failures.length > 0) {
      for (const f of failures) console.error(`schema:gen --check FAIL: ${f}`);
      process.exit(1);
    }
    console.log('schema:gen --check OK — committed schema is current and exercised');
  } else {
    mkdirSync(path.dirname(SCHEMA_PATH), { recursive: true });
    writeFileSync(SCHEMA_PATH, schemaText());
    console.log(`wrote ${path.relative(ROOT, SCHEMA_PATH)} (${ATTR_KEYS.length} attributes, ${TEND_KEYS.length} tendencies, derived from @hoopsh/data)`);
  }
}
