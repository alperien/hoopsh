/**
 * 02 — Write your own event-stream consumer
 *
 * WHAT THIS TEACHES
 *   "The events are the contract." The engine guarantees the event stream
 *   fully describes the game (packages/engine/src/core/events.ts) — so any
 *   stat nobody has built yet is just a fold over `result.events`. This file
 *   computes three things NO box score gives you: every lead change, each
 *   team's biggest scoring run, and each team's largest lead — using nothing
 *   but the `score: [home, away]` field that rides on every single event.
 *
 * RUN IT
 *   npm run example:02
 *
 * WHAT YOU SHOULD SEE
 *   A list of every lead change with the game clock, then each team's biggest
 *   run and largest lead. Finishes in ~1 second.
 */

import { simulateGame } from '@hoopsh/engine';
import type { GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const { home, away } = sampleMatchup();
// demo seed re-anchored at the #74 amended-dose landing ('crunch-time'
// went lead-change-quiet on the reshuffled stream; this one shows 4
// changes and 17-0 / 10-0 runs)
const result = simulateGame({ seed: 'crunch-time-2', home, away });
const abbrev = [home.abbrev, away.abbrev] as const;

const clockOf = (e: GameEvent): string => {
  const m = Math.floor(e.clock / 60);
  const s = Math.floor(e.clock % 60).toString().padStart(2, '0');
  return `Q${e.period} ${m}:${s}`;
};

// ---- 1. every lead change --------------------------------------------------
// A lead change = the team in front is not the team that was in front the
// last time anyone was in front (ties in between don't count as a change).
// We never touch shot/rebound/foul semantics — only the running score.
let leader: 0 | 1 | null = null;
const changes: { label: string; score: [number, number] }[] = [];
for (const e of result.events) {
  const [h, a] = e.score;
  const now: 0 | 1 | null = h > a ? 0 : a > h ? 1 : null;
  if (now !== null && now !== leader) {
    if (leader !== null) changes.push({ label: `[${clockOf(e)}] ${abbrev[now]} take the lead, ${h}-${a}`, score: e.score });
    leader = now;
  }
}
console.log(`Lead changes: ${changes.length}`);
for (const c of changes) console.log(`  ${c.label}`);
console.log('');

// ---- 2. each team's biggest run ---------------------------------------------
// A run = consecutive points by one team with zero answer from the other.
// Walk the score deltas event by event; any event can score (shots, FTs).
const bestRun: [number, number] = [0, 0];
let runTeam: 0 | 1 | null = null;
let runPts = 0;
let prev: [number, number] = [0, 0];
for (const e of result.events) {
  const dh = e.score[0] - prev[0];
  const da = e.score[1] - prev[1];
  prev = e.score;
  const scored: 0 | 1 | null = dh > 0 ? 0 : da > 0 ? 1 : null;
  if (scored === null) continue;
  const pts = dh + da; // only one side is ever nonzero per event
  if (scored === runTeam) runPts += pts;
  else { runTeam = scored; runPts = pts; }
  if (runPts > bestRun[runTeam]) bestRun[runTeam] = runPts;
}
console.log(`Biggest run, ${abbrev[0]}: ${bestRun[0]}-0`);
console.log(`Biggest run, ${abbrev[1]}: ${bestRun[1]}-0`);
console.log('');

// ---- 3. largest lead ---------------------------------------------------------
const bigLead: [number, number] = [0, 0];
for (const e of result.events) {
  const diff = e.score[0] - e.score[1];
  if (diff > bigLead[0]) bigLead[0] = diff;
  if (-diff > bigLead[1]) bigLead[1] = -diff;
}
console.log(`Largest lead, ${abbrev[0]}: ${bigLead[0]}`);
console.log(`Largest lead, ${abbrev[1]}: ${bigLead[1]}`);
console.log('');
console.log(`Final: ${abbrev[0]} ${result.finalScore[0]} — ${abbrev[1]} ${result.finalScore[1]}`);
console.log('(none of the numbers above exist in the box score — they were all');
console.log(' folded from result.events, the one contract every consumer shares)');
