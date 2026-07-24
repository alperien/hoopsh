/**
 * Color commentary providers.
 *
 * The engine emits facts; providers turn stretches of facts into voice.
 * `TemplateColorProvider` is the zero-cost deterministic fallback.
 * LLM-backed providers implement the same interface: they receive a window of
 * events + narrative context + box-score snapshot and return color lines.
 * (Keeping this async and stateless per-window makes it trivial to swap a
 * real LLM in — see docs/narration.md.)
 */

import type { GameEvent, Team } from '@hoopsh/engine';
import type { NarrativeMoment } from './context.js';

export interface CommentaryWindow {
  /** events since the last window (chronological) */
  events: GameEvent[];
  /** narrative moments detected in this window */
  moments: NarrativeMoment[];
  /** running score at window end */
  score: [number, number];
  period: number;
  clock: number;
  teams: [Team, Team];
  /** free-form notes accumulated across windows (storylines) */
  storylines: string[];
}

export interface ColorLine {
  t: number;
  text: string;
  speaker: 'color';
}

export interface CommentaryProvider {
  name: string;
  generate(window: CommentaryWindow): Promise<ColorLine[]>;
}

/** deterministic rule-based color — the no-LLM fallback */
export class TemplateColorProvider implements CommentaryProvider {
  name = 'template-color';

  async generate(w: CommentaryWindow): Promise<ColorLine[]> {
    const lines: ColorLine[] = [];
    const last = w.events[w.events.length - 1];
    if (!last) return lines;

    for (const m of w.moments) {
      if (m.kind === 'run' && m.team !== undefined) {
        lines.push({
          t: m.t,
          speaker: 'color',
          text: `${w.teams[m.team].name} have all the momentum right now — ` +
            `the other side needs a timeout or a bucket, fast.`
        });
      }
      if (m.kind === 'milestone' && m.playerId) {
        const name = w.teams.flatMap((t) => t.players).find((p) => p.id === m.playerId)?.name ?? m.playerId;
        lines.push({
          t: m.t,
          speaker: 'color',
          text: `${name} has it going tonight. When a scorer sees a couple go down early, the rim starts looking like the ocean.`
        });
      }
      if (m.kind === 'clutch_start') {
        lines.push({
          t: m.t,
          speaker: 'color',
          text: `This is where rotations shorten and every possession becomes a chess move. Execution wins these minutes, not talent.`
        });
      }
    }
    return lines;
  }
}
