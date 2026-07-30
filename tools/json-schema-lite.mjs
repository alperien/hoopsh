// Minimal JSON Schema (draft 2020-12 subset) evaluator — the exerciser for
// tools/gen-schema.mjs's generated team-pack schema.
//
// WHY THIS EXISTS: the npm registry is firewalled in this environment (see
// tools/register.mjs), so there is no ajv to validate the generated schema
// against. Shipping a schema nobody ever executed is exactly how editor
// tooling drifts into lying, so this file implements the SUBSET of draft
// 2020-12 the generated schema actually uses, and the gen-schema test suite
// runs real packs (shipped rosters, scaffolded rosters, hand-broken packs)
// through it.
//
// THE HONESTY MECHANISM: validate() THROWS on any assertion keyword it does
// not implement, rather than skipping it the way a lenient evaluator would.
// A schema change that starts using an unimplemented keyword (say,
// patternProperties) cannot silently pass the test suite as a no-op — it
// fails loudly until the keyword is implemented here. That property is what
// makes "the schema is exercised" a real claim instead of a vibe. Annotation
// keywords that carry no assertion semantics ($schema, $id, title,
// description, $defs, examples, default) are the explicit ignore list.
//
// Scope honesty: this is NOT a general JSON Schema implementation (no
// anchors, no external refs, no allOf/anyOf, no unevaluatedProperties, no
// $dynamicRef). If gen-schema.mjs ever needs those, prefer extending this
// file over hand-waving — the whole point is that every keyword the schema
// emits has a tested runtime meaning. When npm access lands, an ajv-based
// test can supersede this file; the test suite is already shaped for that
// swap (same cases, different engine).

/** Assertion keywords implemented below. Anything else that asserts → throw. */
const IMPLEMENTED = new Set([
  'type', 'const', 'enum',
  'properties', 'required', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'minimum', 'maximum', 'minLength',
  '$ref'
]);

/** Annotation-only keywords: legal to appear, no assertion semantics. */
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs', 'examples', 'default']);

function typeOf(x) {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  // 'object' | 'string' | 'number' | 'boolean'. JSON.parse never yields NaN/undefined —
  // but an overflowing literal (1e999) parses to Infinity, which reads 'number' here;
  // callers needing finiteness must check it themselves (release-audit L-62).
  return typeof x;
}

/** Resolve an internal '#/...' JSON-pointer $ref against the root schema. */
function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`json-schema-lite: only internal '#/' refs supported, got ${ref}`);
  let node = root;
  for (const seg of ref.slice(2).split('/')) {
    const key = seg.replaceAll('~1', '/').replaceAll('~0', '~');
    node = node?.[key];
    if (node === undefined) throw new Error(`json-schema-lite: unresolvable $ref ${ref}`);
  }
  return node;
}

/**
 * Validate `data` against `schema`, returning a list of { path, message }
 * (empty = valid). `root` defaults to `schema` itself; `path` is a
 * JSONPath-style location mirroring validateTeamPack()'s convention so test
 * output reads the same for both validators.
 */
export function validate(schema, data, root = schema, path = '$') {
  const errors = [];

  // Refuse to no-op an unknown assertion keyword (see file header).
  for (const key of Object.keys(schema)) {
    if (!IMPLEMENTED.has(key) && !ANNOTATIONS.has(key)) {
      throw new Error(`json-schema-lite: unimplemented keyword '${key}' at ${path} — extend json-schema-lite.mjs`);
    }
  }

  // Draft 2020-12 allows $ref with sibling keywords: evaluate the referenced
  // schema AND the siblings against the same instance.
  if (schema.$ref !== undefined) {
    errors.push(...validate(resolveRef(schema.$ref, root), data, root, path));
  }

  if (schema.type !== undefined) {
    const t = typeOf(data);
    const want = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = want.some((w) => w === t || (w === 'integer' && t === 'number' && Number.isInteger(data)));
    if (!ok) {
      errors.push({ path, message: `expected ${want.join('|')}, got ${t}` });
      return errors; // wrong shape — deeper keyword checks would just cascade noise
    }
  }

  if (schema.const !== undefined && data !== schema.const) {
    errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
  }
  if (schema.enum !== undefined && !schema.enum.includes(data)) {
    errors.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}` });
  }

  if (typeOf(data) === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({ path, message: `must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({ path, message: `must be <= ${schema.maximum}` });
    }
  }

  if (typeOf(data) === 'string' && schema.minLength !== undefined && data.length < schema.minLength) {
    errors.push({ path, message: `must be at least ${schema.minLength} character(s)` });
  }

  if (typeOf(data) === 'object') {
    // Object.hasOwn, never `in`: `in` consults the prototype chain, so a pack
    // key named toString/constructor/valueOf would satisfy `required` on an
    // empty object and bypass additionalProperties:false by "validating"
    // against an inherited builtin (b7-F3). Draft 2020-12 (and ajv) treat
    // only own properties as present.
    for (const req of schema.required ?? []) {
      if (!Object.hasOwn(data, req)) errors.push({ path: `${path}.${req}`, message: 'missing required property' });
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(data)) {
      if (Object.hasOwn(props, k)) {
        errors.push(...validate(props[k], v, root, `${path}.${k}`));
      } else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}.${k}`, message: 'unknown property (typo?)' });
      } else if (typeof schema.additionalProperties === 'object') {
        errors.push(...validate(schema.additionalProperties, v, root, `${path}.${k}`));
      }
    }
  }

  if (typeOf(data) === 'array') {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({ path, message: `need at least ${schema.minItems} items` });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({ path, message: `need at most ${schema.maxItems} items` });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(data.map((x) => JSON.stringify(x)));
      if (seen.size !== data.length) errors.push({ path, message: 'items must be unique' });
    }
    if (schema.items !== undefined) {
      data.forEach((item, i) => errors.push(...validate(schema.items, item, root, `${path}[${i}]`)));
    }
  }

  return errors;
}
