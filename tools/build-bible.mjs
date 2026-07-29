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

// canonical reading order: what → why → where → how-it's-measured → law →
// procedure → builder → content-authoring → multi-game → vocabulary →
// curriculum
const SOURCES = [
  'README.md',
  'ARCHITECTURE.md',
  'docs/INTERNALS.md',
  'docs/CALIBRATION.md',
  'AGENTS.md',
  'docs/PLAYBOOK.md',
  'docs/EMBEDDING.md',
  'docs/ROSTERS.md',
  'docs/SEASON.md',
  'docs/GLOSSARY.md',
  'docs/ONBOARDING.md'
];
// docs/REGISTER.md and docs/history/* are excluded BY DESIGN — do not add
// them: the Bible is the agent context-pack; agents reach the register via
// row citations, and history would re-bloat the one file whose size is the
// point (docs/README.md maintenance rule 4).

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

// The divider renders (blockquote), not just an HTML comment: a searcher
// landing mid-file sees whose copy they're reading and where to edit.
const divider = (name, i) => `

---
---

<!-- ================= SOURCE: ${name} ================= -->

> Part ${i + 1}/${SOURCES.length} of the generated Bible — canonical source: \`${name}\`. Edit there, then \`npm run docs:bible\`.

`;

let out = header;
SOURCES.forEach((src, i) => {
  out += divider(src, i);
  out += readFileSync(path.join(ROOT, src), 'utf8').trim();
  out += '\n';
});

writeFileSync(path.join(ROOT, 'docs/BIBLE.md'), out);
const lines = out.split('\n').length;
console.log(`wrote docs/BIBLE.md (${lines} lines from ${SOURCES.length} sources)`);
