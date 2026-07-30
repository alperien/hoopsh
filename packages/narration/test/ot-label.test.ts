/**
 * Overtime bracket labels in the booth pipeline — the booth-side sibling of
 * scan finding B6-6 (which fixed only the legacy formatScript): a period
 * beyond regulation must render as overtime, never "Q5". Convention matched
 * to the already-correct paths (pbp.ts periodName, broadcast.ts formatScript,
 * the viewer's pLabel): the first overtime is bare "OT", later ones are
 * numbered "OT2", "OT3", …
 *
 * Consumer tier: hand-built cues, no engine involvement — this pins the
 * formatter's labeling alone.
 */

import { describe, expect, it } from 'vitest';
import { formatBoothScript, type BoothCue } from '@hoopsh/narration';

const cueAt = (period: number): BoothCue => ({
  wt: period * 1000,
  t: period * 720,
  period,
  clock: 300,
  score: [100, 100],
  speaker: 'pbp',
  voice: 'corbin',
  register: 'flat',
  kind: 'shot_made',
  text: 'Bucket.'
});

describe('booth overtime labels (formatBoothScript)', () => {
  it('renders regulation periods as Q1..Q4 under the default 4-period pack', () => {
    for (const p of [1, 2, 3, 4]) {
      expect(formatBoothScript([cueAt(p)])).toContain(`[Q${p} `);
    }
  });

  it('renders the first overtime as OT, not Q5', () => {
    const script = formatBoothScript([cueAt(5)]);
    expect(script).toContain('[OT ');
    expect(script).not.toContain('[Q5');
  });

  it('numbers the second overtime OT2, not Q6', () => {
    const script = formatBoothScript([cueAt(6)]);
    expect(script).toContain('[OT2 ');
    expect(script).not.toContain('[Q6');
  });

  it('honors a forwarded regulation period count (halves pack: period 3 is OT)', () => {
    expect(formatBoothScript([cueAt(3)], undefined, 2)).toContain('[OT ');
  });
});
