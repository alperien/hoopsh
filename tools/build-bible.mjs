#!/usr/bin/env node
// Compile the source documents into docs/BIBLE.md — one file containing
// everything, for handing to an agent in a single context window or reading
// offline. The Bible is GENERATED: never edit it directly, never let it become
// a second source of truth. Regenerate with `npm run docs:bible` in the same
// commit as any source-doc edit (see docs/README.md maintenance rules).
// The header derives its document count from SOURCES.length, so adding a
// document to the list below is the whole job here (plus the hub-table row
// and reading-path mention docs/README.md rule 4 requires).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// canonical reading order: what → why → where → law → procedure →
// content-authoring → curriculum
const SOURCES = [
  'README.md',
  'ARCHITECTURE.md',
  'docs/INTERNALS.md',
  'AGENTS.md',
  'docs/PLAYBOOK.md',
  'docs/ROSTERS.md',
  'docs/ONBOARDING.md'
];

const COUNT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten'][SOURCES.length] ?? String(SOURCES.length);

const header = `<!-- ============================================================
  GENERATED FILE — DO NOT EDIT.
  This is the hoopsh Bible: all ${COUNT} source documents compiled in canonical
  reading order. Edit the sources, then regenerate: npm run docs:bible
  Sources (in order): ${SOURCES.join(' · ')}
============================================================ -->

# 📖 The hoopsh Bible — everything, one file

> Generated from the ${COUNT} source documents. If this file and a source document
> disagree, the source is right and this file is stale — regenerate it.

## Contents
${SOURCES.map((s, i) => `${i + 1}. **${s}**`).join('\n')}

`;

const divider = (name) => `

---
---

<!-- ================= SOURCE: ${name} ================= -->

`;

let out = header;
for (const src of SOURCES) {
  out += divider(src);
  out += readFileSync(path.join(ROOT, src), 'utf8').trim();
  out += '\n';
}

writeFileSync(path.join(ROOT, 'docs/BIBLE.md'), out);
const lines = out.split('\n').length;
console.log(`wrote docs/BIBLE.md (${lines} lines from ${SOURCES.length} sources)`);
