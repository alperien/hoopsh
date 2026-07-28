/**
 * Type declarations for gen-schema.mjs, hand-maintained (the runtime is
 * type-stripped Node with no build step, so nothing generates these; see
 * tsconfig.json's paths comment for the typecheck-gate context). Declares
 * every export of the .mjs; keep the two files in sync in the same commit.
 */

import type { SchemaNode } from './json-schema-lite.mjs';

/** Absolute path of the committed schema: data/schema/team-pack.schema.json. */
export const SCHEMA_PATH: string;

/**
 * Extract per-key doc comments (JSDoc block above the key, or trailing `//`)
 * from an interface body in player.ts source text: the hover text the
 * generated schema ships for each rating. Keys with no comment are simply
 * absent from the result. Throws if the interface is not found.
 */
export function extractInterfaceDocs(
  source: string,
  interfaceName: string
): Record<string, string>;

/**
 * Assemble the full TeamPack JSON Schema object (deterministic key order),
 * with key lists and ranges imported live from @hoopsh/data. Reads
 * packages/engine/src/model/player.ts from disk for the hover docs.
 */
export function buildTeamPackSchema(): SchemaNode;

/** buildTeamPackSchema() serialized exactly as committed: 2-space indent + trailing newline. */
export function schemaText(): string;

/**
 * --check gate: committed file must match a fresh regeneration byte-for-byte,
 * and the schema must accept both shipped rosters while rejecting a
 * deliberately broken variant of each. Returns failure descriptions
 * (empty = pass).
 */
export function checkSchema(): string[];
