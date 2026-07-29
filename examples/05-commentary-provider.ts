/**
 * 05 — Plug in your own color commentary (the narration seam)
 *
 * WHAT THIS TEACHES
 *   Narration is layered: the play-by-play is template-generated from
 *   events, and COLOR commentary comes from a pluggable `CommentaryProvider`
 *   — the seam where an LLM (or anything else) slots in. A provider is one
 *   object: `{ name, async generate(window) }`. It receives self-contained
 *   windows of the game (events + detected narrative moments + score +
 *   rosters) and returns time-stamped lines; `buildBroadcastScript()`
 *   interleaves them with the play-by-play. Below is "Stats Corner": a
 *   30-line provider that reacts to hot shooters and scoring runs with
 *   numbers instead of clichés.
 *
 * RUN IT
 *   npm run example:05
 *
 * WHAT YOU SHOULD SEE
 *   Cue counts (play-by-play vs color), then broadcast excerpts around the
 *   custom provider's lines, each tagged [Stats Corner]. Finishes in
 *   ~1 second.
 */

import { simulateGame } from '@hoopsh/engine';
import type { ShotEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { buildBroadcastScript, formatScript } from '@hoopsh/narration';
import type { ColorLine, CommentaryProvider, CommentaryWindow } from '@hoopsh/narration';

// ---- 1. the provider ----------------------------------------------------------
// Stateless per window BY DESIGN (see packages/narration/src/provider.ts):
// everything generate() needs arrives as arguments, so an LLM-backed
// implementation is the same shape — build a prompt from `w`, parse lines out.
class StatsCornerProvider implements CommentaryProvider {
  name = 'stats-corner';

  async generate(w: CommentaryWindow): Promise<ColorLine[]> {
    const lines: ColorLine[] = [];
    const last = w.events[w.events.length - 1];
    if (!last) return lines;

    // React to a hot shooter: 2+ made threes by one player inside one window.
    const treys = new Map<string, number>();
    for (const e of w.events) {
      if (e.type === 'shot' && (e as ShotEvent).three && (e as ShotEvent).made) {
        const s = e as ShotEvent;
        treys.set(s.shooter, (treys.get(s.shooter) ?? 0) + 1);
      }
    }
    for (const [id, n] of treys) {
      if (n < 2) continue;
      const shooter = w.teams.flatMap((t) => t.players).find((p) => p.id === id);
      lines.push({
        t: last.t, speaker: 'color',
        text: `[Stats Corner] ${shooter?.name ?? id} has ${n} threes in this stretch alone — ` +
          `somebody on the scouting report is getting yelled at.`
      });
    }

    // React to detected run moments with the score attached.
    for (const m of w.moments) {
      if (m.kind === 'run' && m.team !== undefined) {
        lines.push({
          t: m.t, speaker: 'color',
          text: `[Stats Corner] That's a ${w.teams[m.team].abbrev} run — score check: ` +
            `${w.score[0]}-${w.score[1]}. Runs decide close games; timeouts exist to end them.`
        });
      }
    }
    return lines;
  }
}

// ---- 2. play a game, build the two-voice script ---------------------------------
const { home, away } = sampleMatchup();
const result = simulateGame({ seed: 'rain', home, away });

const cues = await buildBroadcastScript(result.events, [home, away], new StatsCornerProvider(), {
  seed: 'booth',                    // seeds the PBP's phrasing choices
  periods: result.rules.periods     // keeps period labels right for non-4-period packs
});

const color = cues.filter((c) => c.speaker === 'color');
console.log(`Broadcast script: ${cues.length} cues — ${cues.length - color.length} play-by-play, ` +
  `${color.length} color lines from provider "stats-corner".`);
console.log('');

// ---- 3. print excerpts around one of each kind of provider line ------------------
const firstRun = color.find((c) => c.text.includes('run'));
const firstHot = color.find((c) => c.text.includes('threes in this stretch'));
for (const line of [firstRun, firstHot]) {
  if (!line) continue;
  const at = cues.indexOf(line);
  const excerpt = cues.slice(Math.max(0, at - 2), at + 1);
  console.log(formatScript(excerpt, result.rules.periods));
  console.log('  ---');
}
console.log('');
console.log('Swap StatsCornerProvider for an LLM call and nothing else changes —');
console.log('that interface is the whole integration contract.');
