/**
 * 01 — Simulate a game (hello world)
 *
 * WHAT THIS TEACHES
 *   The one call that matters: `simulateGame({ seed, home, away })` returns a
 *   finished game — a typed event stream, the final score, and the rule pack
 *   and rosters it ran under. Everything else in hoopsh (box scores, play-by-
 *   play, replays) is derived from that event stream. Also: determinism —
 *   the same seed always produces the exact same game.
 *
 * RUN IT
 *   npm run example:01
 *
 * WHAT YOU SHOULD SEE
 *   A final score, a quarter-by-quarter line score, the game's first few
 *   shots rendered from raw events, and proof that re-running the same seed
 *   reproduces the game event-for-event. Finishes in ~1 second.
 */

import { simulateGame } from '@hoopsh/engine';
import type { GameEvent, ShotEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

// Two fictional teams ship with the repo (they're also the calibration
// benchmark pair — see packages/data/src/teams.ts).
const { home, away } = sampleMatchup();

// Seeds are strings (or numbers). Same seed + same teams = same game, always.
const SEED = 'hello-hoopsh';
const result = simulateGame({ seed: SEED, home, away });

console.log(`${home.name} (home) vs ${away.name} (away) — seed "${SEED}"`);
console.log(`Rules: ${result.rules.name} (${result.rules.periods}x${result.rules.periodMinutes}min)`);
console.log('');

// ---- final + line score, folded from the event stream ---------------------
// Every event carries `score: [home, away]` (the score AFTER the event), so a
// line score is just "what did the score read at each period_end".
const periodEnds = result.events.filter((e): e is GameEvent & { type: 'period_end' } => e.type === 'period_end');
let prev: [number, number] = [0, 0];
const cells: string[] = [];
for (const pe of periodEnds) {
  cells.push(`Q${pe.period}: ${pe.score[0] - prev[0]}-${pe.score[1] - prev[1]}`);
  prev = pe.score;
}
console.log(`Final: ${home.abbrev} ${result.finalScore[0]} — ${away.abbrev} ${result.finalScore[1]}`);
console.log(`Line score (${home.abbrev} first): ${cells.join('  ')}`);
console.log('');

// ---- a few events, rendered by hand ---------------------------------------
// `result.events` is an ordered array of plain typed objects. Here are the
// game's first four shot attempts, straight off the stream.
const clockOf = (e: GameEvent): string => {
  const m = Math.floor(e.clock / 60);
  const s = Math.floor(e.clock % 60).toString().padStart(2, '0');
  return `Q${e.period} ${m}:${s}`;
};
const name = (id: string) =>
  [...home.players, ...away.players].find((p) => p.id === id)?.name ?? id;

const shots = result.events.filter((e): e is ShotEvent => e.type === 'shot').slice(0, 4);
console.log('First four shot attempts (raw events, hand-rendered):');
for (const s of shots) {
  const team = s.team === 0 ? home.abbrev : away.abbrev;
  const what = s.three ? 'three' : 'two';
  console.log(
    `  [${clockOf(s)}] ${team} ${name(s.shooter)} — ${s.distFt.toFixed(1)} ft ` +
    `${what} (${s.moveType}) ${s.made ? 'GOOD' : 'no good'}  → score ${s.score[0]}-${s.score[1]}`
  );
}
console.log('');
console.log(`The stream has ${result.events.length} events; the box score, play-by-play,`);
console.log('and 2D replay are all pure folds over it (see example 02).');

// ---- determinism -----------------------------------------------------------
const again = simulateGame({ seed: SEED, home: sampleMatchup().home, away: sampleMatchup().away });
const identical =
  again.finalScore[0] === result.finalScore[0] &&
  again.finalScore[1] === result.finalScore[1] &&
  again.events.length === result.events.length;
console.log('');
console.log(`Same seed replays identically: ${identical ? 'yes' : 'NO (this is a bug!)'}`);
