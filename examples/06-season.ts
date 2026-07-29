/**
 * 06 — Run a small season (schedule → games → standings)
 *
 * WHAT THIS TEACHES
 *   The season layer: `roundRobin()` builds a schedule, `runSeason()` plays
 *   it (seeded, deterministic — every game's seed derives from seedBase),
 *   and `computeStandings()` folds outcomes into a table with W-L, point
 *   differential, home/away splits, and strength of schedule. There is
 *   deliberately NO cross-game state — no injuries or fatigue carry-over —
 *   a season is just independent games plus pure folds (docs/SEASON.md).
 *
 *   NOTE THE IMPORTS: the season layer lives in @hoopsh/harness, the one
 *   repo-internal package (it reads repo paths, so it isn't part of the
 *   embeddable surface the other examples use). Inside the repo we import
 *   its modules by relative path.
 *
 * RUN IT
 *   npm run example:06
 *
 * WHAT YOU SHOULD SEE
 *   Six game results (4 teams, single round-robin) and a standings table
 *   where wins+losses sum to the games played and the diff column sums to
 *   zero. Finishes in a few seconds — it really plays all six games.
 */

import { makeLeague } from '../packages/harness/src/league.js';
import { roundRobin, runSeason } from '../packages/harness/src/season.js';

// Four generated fictional teams. makeLeague is pure in (n, seed): everyone
// who runs this file gets the same league.
const teams = makeLeague(4, 'demo-league');
console.log(`League: ${teams.map((t) => t.name).join(', ')}`);
console.log('');

// A single round-robin (every pair meets once; rounds: 2 would give everyone
// a home AND an away date). runSeason defaults to double round-robin if you
// omit `schedule`.
const schedule = roundRobin(teams.map((t) => t.id), 1);
const season = await runSeason({ teams, schedule, seedBase: 'demo-season' });

console.log(`Results (${season.outcomes.length} games):`);
for (const o of season.outcomes) {
  const winner = o.score[0] > o.score[1] ? o.homeId : o.awayId;
  console.log(
    `  ${o.homeId.padEnd(12)} ${String(o.score[0]).padStart(3)} — ` +
    `${String(o.score[1]).padEnd(3)} ${o.awayId.padEnd(12)} (${winner} win, seed ${o.seed})`
  );
}
console.log('');

// Standings arrive sorted (win pct, then diff). Every stat below is a pure
// fold over the outcomes — re-fold in any order, same table.
console.log('Team          W-L   PF   PA   diff   SOS');
for (const s of season.standings) {
  console.log(
    `  ${s.teamId.padEnd(12)}${s.wins}-${s.losses}  ${String(s.pointsFor).padStart(3)}  ` +
    `${String(s.pointsAgainst).padStart(3)}  ${String(s.diff).padStart(4)}   ${s.sos.toFixed(3)}`
  );
}
const totalWins = season.standings.reduce((n, s) => n + s.wins, 0);
const totalDiff = season.standings.reduce((n, s) => n + s.diff, 0);
console.log('');
console.log(`Sanity: total wins ${totalWins} = games ${season.outcomes.length}; diff sums to ${totalDiff}.`);
console.log('Deterministic: rerun this file — same six finals, same table.');
