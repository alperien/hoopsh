/**
 * 03 — Author your own team (a data pack from scratch)
 *
 * WHAT THIS TEACHES
 *   Teams are DATA, not code: a JSON "team pack" that `loadTeamPack()`
 *   validates strictly and hands to the engine. This file builds an
 *   8-player team programmatically (`makePlayer` fills league-average 50s
 *   for every dial you don't set), turns it into pack JSON with
 *   `toTeamPack()`, deliberately breaks the JSON four ways a hand-editor
 *   would, shows the validator catching every mistake with a JSONPath and a
 *   plain-English message — then loads the clean pack and plays it against
 *   a shipped team.
 *
 *   THE ONE GOTCHA WORTH LEARNING HERE: `loadTeamPack()` returns an
 *   envelope, `{ team, issues }` — NOT a bare Team. `team` is null whenever
 *   `issues` is non-empty; always check before handing it to the engine.
 *
 *   Prefer files over code? The same loop exists as CLI tooling:
 *     npm run roster:new -- --name "My Team" --out my-team.team.json
 *     npm run roster:validate -- my-team.team.json
 *     npm run sim -- --home my-team.team.json
 *   (full guide: docs/ROSTERS.md)
 *
 * RUN IT
 *   npm run example:03
 *
 * WHAT YOU SHOULD SEE
 *   Four validation issues (each with a JSONPath), then a clean load, then a
 *   final score plus a mini box score proving the roster plays like its
 *   dials say it should. Finishes in ~1 second.
 */

import { makePlayer, makeTactics, simulateGame } from '@hoopsh/engine';
import type { Player, Team } from '@hoopsh/engine';
import { loadTeamPack, meridianMonarchs, toTeamPack } from '@hoopsh/data';
import { boxScore } from '@hoopsh/stats';

// ---- 1. author a roster in code ---------------------------------------------
// Every rating is 0-100 (50 = league average). You only specify what makes a
// player HIMSELF; makePlayer defaults the rest. The dials below are the
// team's identity — watch them show up in the box score at the bottom.
const p = (
  id: string, name: string, pos: Player['pos'], heightIn: number,
  attr: Parameters<typeof makePlayer>[0]['attr'],
  tend: Parameters<typeof makePlayer>[0]['tend']
): Player => makePlayer({ id, name, pos, heightIn, attr, tend });

const players: Player[] = [
  // A movement sniper: elite three, wants nothing but threes, high usage.
  p('bay-01', 'Juno Reyes', 'SG', 76,
    { three: 97, freeThrow: 92, midRange: 70, speed: 80, stamina: 85 },
    { shotThree: 92, shotRim: 20, shotMid: 15, offBallMotion: 88, usage: 74 }),
  // A jumbo initiator: 6'10" point-forward who lives on drives and dimes.
  p('bay-02', 'Oskar Lindqvist', 'PF', 82,
    { ballHandle: 88, passVision: 92, passAcc: 90, finishing: 82, drawFoul: 78, strength: 80 },
    { drive: 80, passOut: 75, shotThree: 25, iso: 55, usage: 70 }),
  // A rim-running center: dunks, boards, blocks — please don't let him shoot.
  p('bay-03', 'Moses Adeyemi', 'C', 84,
    { finishing: 90, vertical: 88, offReb: 85, defReb: 82, block: 84, three: 10 },
    { shotRim: 90, shotThree: 2, shotMid: 5, crashOffReb: 85, usage: 40 }),
  // A point-of-attack pest: defense and corner threes only.
  p('bay-04', 'Dree Calloway', 'PG', 72,
    { perimeterD: 90, steal: 86, lateral: 88, three: 72 },
    { shotThree: 65, gambleSteal: 70, usage: 35 }),
  // Glue wing — league-average everything (the makePlayer defaults, on purpose).
  p('bay-05', 'Sam Whitfield', 'SF', 79, {}, {}),
  // Bench: a microwave scorer, a bruiser, a steady backup guard.
  p('bay-06', 'Tay Brooks', 'SG', 77, { three: 80, midRange: 78 }, { pullUp: 70, usage: 65 }),
  p('bay-07', 'Big Ed Kowalczyk', 'C', 85, { strength: 88, boxout: 84, interiorD: 78 }, { post: 45, usage: 30 }),
  p('bay-08', 'Nico Fontaine', 'PG', 74, { passAcc: 78, decisions: 80 }, { usage: 40 })
];

const bayline: Team = {
  id: 'bayline',
  name: 'Bayline Squid',
  abbrev: 'BAY',
  players,
  starters: ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05'],
  tactics: makeTactics({ pace: 60, threeBias: 62, helpAggr: 55 })
};

// ---- 2. a Team <-> pack JSON round trip --------------------------------------
// toTeamPack wraps the team in the versioned pack envelope. This JSON string
// is EXACTLY what you'd save as bayline.team.json and pass to
// `npm run sim -- --home bayline.team.json`.
const packJson = JSON.stringify(toTeamPack(bayline), null, 2);
console.log(`Authored a pack: ${bayline.name}, ${players.length} players, ${packJson.length} bytes of JSON.`);
console.log('');

// ---- 3. break it the way hand-editors actually do, and watch the validator --
const broken = JSON.parse(packJson);
broken.team.players[0].heightIn = 205;          // centimeters, not inches
broken.team.players[1].attr.three = '96';       // quoted number
delete broken.team.players[2].tend.usage;       // deleted a required dial
broken.team.starters[3] = 'bay-99';             // typo'd starter id

const bad = loadTeamPack(JSON.stringify(broken));
console.log(`Validation of the broken pack: team is ${bad.team === null ? 'null' : 'set'}, ${bad.issues.length} issues —`);
for (const issue of bad.issues) console.log(`  ${issue.path} — ${issue.message}`);
console.log('');

// ---- 4. the clean pack loads: check the envelope, then play ------------------
const good = loadTeamPack(packJson);
if (good.team === null) {
  // (unreachable here — but this check is the habit the envelope demands)
  throw new Error(`pack invalid: ${good.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
}
console.log(`Clean pack loads with ${good.issues.length} issues.`);

const opponent = meridianMonarchs(); // shipped team
const result = simulateGame({ seed: 'maiden-voyage', home: good.team, away: opponent });
console.log(`Final: ${good.team.abbrev} ${result.finalScore[0]} — ${opponent.abbrev} ${result.finalScore[1]}`);
console.log('');

// ---- 5. did the dials mean anything? ------------------------------------------
const box = boxScore(result.events, [good.team, opponent]);
console.log(`${bayline.name} box (pts / 3PM-3PA / reb / ast):`);
for (const line of box.players.filter((l) => l.team === 0 && l.min > 0)) {
  console.log(
    `  ${line.name.padEnd(18)} ${String(line.pts).padStart(3)}  ` +
    `${line.tpm}-${line.tpa}  ${String(line.trb).padStart(2)}reb  ${line.ast}ast`
  );
}
console.log('');
console.log('(the sniper hunts threes, the jumbo initiator racks assists, the rim');
console.log(' runner boards — the pack is an honest description of a team)');
