/**
 * Injection tripwire for the viewer.
 *
 * The replay feed renderer used to build list items via innerHTML string
 * interpolation of player names taken straight from whatever replay JSON the
 * file picker loaded — a real script-injection sink (a crafted player name
 * executed markup the moment its line rendered). The fix builds feed DOM
 * with createElement/textContent exclusively.
 *
 * This test is deliberately blunt: NO use of innerHTML — or any sibling
 * markup-injection sink (outerHTML, insertAdjacentHTML, document.write,
 * DOMParser, createContextualFragment) — anywhere in the viewer, ever.
 * The original tripwire banned only the literal `innerHTML`, so a regression
 * that merely switched sinks would have sailed past it (scan finding
 * B6-11). textContent/replaceChildren cover every legitimate need this
 * file has; if a future feature genuinely requires markup injection it must
 * come through a sanitizer and consciously rewrite this test.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// every DOM sink that parses a string as markup; keep in sync with the
// header note above
const MARKUP_SINKS = [
  'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write',
  'DOMParser', 'createContextualFragment'
];

describe('viewer injection tripwire', () => {
  it('index.html never uses a markup-injection sink', () => {
    const html = readFileSync(path.resolve(HERE, '..', 'index.html'), 'utf8');
    for (const sink of MARKUP_SINKS) expect(html).not.toContain(sink);
  });

  it('embed.mjs never uses a markup-injection sink', () => {
    const js = readFileSync(path.resolve(HERE, '..', 'embed.mjs'), 'utf8');
    for (const sink of MARKUP_SINKS) expect(js).not.toContain(sink);
  });
});
