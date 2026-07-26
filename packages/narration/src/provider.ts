/**
 * Color commentary providers.
 *
 * The engine emits facts; providers turn stretches of facts into voice.
 * `TemplateColorProvider` is the zero-cost deterministic fallback.
 * LLM-backed providers implement the same interface: they receive a window of
 * events + narrative context + box-score snapshot and return color lines.
 * (Keeping this async and stateless per-window makes it trivial to swap a
 * real LLM in — see the CommentaryProvider interface docs below.)
 *
 * V1 REFERENCE LAYER (freeze lifted 2026-07 with the booth decision,
 * docs/BROADCAST.md): this remains the LLM integration seam — a future
 * LLM-backed provider still implements this exact interface, and
 * docs/BROADCAST.md §11 plans upgrading CommentaryWindow to carry the
 * booth's Beat[]/SenseSnapshot. The engine never depends on this file — it
 * only ever consumes `GameEvent`s produced elsewhere (AGENTS.md §1.3/§6).
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
  // free-form notes accumulated across windows (storylines) — this is the
  // one field that lets a provider carry continuity ACROSS windows despite
  // `generate()` itself being stateless per call (see CommentaryProvider
  // below): a provider that wants to reference "as mentioned earlier" can
  // push a note here and the caller (broadcast.ts) threads it into the next
  // window's `storylines`, rather than the provider needing to hold its own
  // internal memory between calls.
  storylines: string[];
}

export interface ColorLine {
  t: number;
  text: string;
  speaker: 'color';
}

/**
 * The integration point for a real commentary backend (LLM or otherwise).
 * Deliberately async and stateless-per-window:
 *  - async: the obvious reason is network latency to an LLM API, but it also
 *    means a provider CAN be zero-cost synchronous work wrapped in a resolved
 *    promise (see TemplateColorProvider below) — the interface doesn't force
 *    every implementation to pay for a real await.
 *  - stateless per window (no `this` state assumed by callers, no session
 *    handle passed in): every `generate()` call receives everything it needs
 *    — the event window, detected moments, score/clock, full team rosters,
 *    and the `storylines` continuity notes — as plain arguments. This is
 *    what makes swapping a real LLM in trivial (per the header note above):
 *    an implementation can build one prompt from `w` and return parsed
 *    lines, with no session/connection lifecycle to manage across calls.
 */
export interface CommentaryProvider {
  name: string;
  generate(window: CommentaryWindow): Promise<ColorLine[]>;
}

/**
 * Deterministic rule-based color — the no-LLM fallback. Exists so the
 * broadcast pipeline (broadcast.ts) always has SOME CommentaryProvider to
 * call even with no LLM configured: fixed template text per moment kind,
 * wrapped in `async` only to satisfy the CommentaryProvider interface
 * (there's no actual asynchronous work happening below — every line is
 * plain string construction).
 */
export class TemplateColorProvider implements CommentaryProvider {
  name = 'template-color';

  async generate(w: CommentaryWindow): Promise<ColorLine[]> {
    const lines: ColorLine[] = [];
    // empty-window guard: an empty `w.events` means there's nothing to react
    // to, so bail before even looking at `w.moments` (in practice moments
    // can't fire without events, but this keeps the guard explicit rather
    // than implicit in the loop below never running).
    const last = w.events[w.events.length - 1];
    if (!last) return lines;

    // dispatch on moment kind — one hardcoded color-commentary template per
    // kind, but only for run/milestone/clutch_start: lead_change and tie
    // moments produce no color line here (renderMoment() in pbp.ts already
    // renders a PBP line for those — "X take the lead." / "We're tied at
    // N." — so this provider only adds color commentary on top of the three
    // kinds that most benefit from extra texture beyond the bare PBP call).
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
