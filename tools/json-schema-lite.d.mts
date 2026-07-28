/**
 * Type declarations for json-schema-lite.mjs, hand-maintained (the runtime
 * is type-stripped Node with no build step, so nothing generates these; see
 * tsconfig.json's paths comment for the typecheck-gate context). Declares
 * every export of the .mjs; keep the two files in sync in the same commit.
 *
 * Deliberately imports nothing: json-schema-lite.mjs is dependency-free, and
 * its declaration must not misrepresent that surface (its { path, message }
 * error shape mirrors validateTeamPack()'s ValidationIssue CONVENTION but is
 * a separate type; the evaluator does not depend on @hoopsh/data).
 */

/** One validation failure: JSONPath-style location + plain-English reason. */
export interface SchemaError {
  path: string;
  message: string;
}

/**
 * A schema node in the draft 2020-12 SUBSET the evaluator implements: the
 * keys here are exactly its IMPLEMENTED (assertion) + ANNOTATIONS lists.
 * validate() THROWS on any other key (the honesty mechanism in the .mjs
 * header), so this type is closed on purpose: a schema that needs a new
 * keyword extends the evaluator and this type together.
 */
export interface SchemaNode {
  // assertion keywords (IMPLEMENTED)
  type?: string | string[];
  const?: unknown;
  enum?: readonly unknown[];
  properties?: Record<string, SchemaNode>;
  required?: readonly string[];
  additionalProperties?: boolean | SchemaNode;
  items?: SchemaNode;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  $ref?: string;
  // annotation-only keywords (ANNOTATIONS; no assertion semantics)
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  $defs?: Record<string, SchemaNode>;
  examples?: readonly unknown[];
  default?: unknown;
}

/**
 * Validate `data` against `schema`, returning every failure (empty = valid).
 * `root` (default: `schema`) anchors internal '#/...' $ref resolution;
 * `path` (default: '$') prefixes reported locations. Throws (does not
 * return errors) on unimplemented assertion keywords and unresolvable refs.
 */
export function validate(
  schema: SchemaNode,
  data: unknown,
  root?: SchemaNode,
  path?: string
): SchemaError[];
