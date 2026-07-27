/**
 * Injection tripwire for the viewer.
 *
 * The replay feed renderer used to build list items via innerHTML string
 * interpolation of player names taken straight from whatever replay JSON the
 * file picker loaded — a real script-injection sink (a crafted player name
 * executed markup the moment its line rendered). The fix builds feed DOM
 * with createElement/textContent exclusively.
 *
 * This test is deliberately blunt: NO use of innerHTML anywhere in the
 * viewer, ever. textContent/replaceChildren cover every legitimate need this
 * file has; if a future feature genuinely requires markup injection it must
 * come through a sanitizer and consciously rewrite this test.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('viewer injection tripwire', () => {
  it('index.html never uses innerHTML', () => {
    const html = readFileSync(path.resolve(HERE, '..', 'index.html'), 'utf8');
    expect(html).not.toContain('innerHTML');
  });

  it('embed.mjs never uses innerHTML', () => {
    const js = readFileSync(path.resolve(HERE, '..', 'embed.mjs'), 'utf8');
    expect(js).not.toContain('innerHTML');
  });
});
