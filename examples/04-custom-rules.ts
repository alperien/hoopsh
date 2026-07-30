/**
 * 04 — A variant league (RulePack is data, not code)
 *
 * WHAT THIS TEACHES
 *   Everything the referee knows lives in one plain object: `RulePack`
 *   (packages/engine/src/rules/rulepack.ts — the interface JSDoc is the
 *   field reference). To invent a league you spread a shipped pack and
 *   override fields — no engine source is touched, and the engine honors
 *   every override: period length, shot clock, bonus shape, foul-out
 *   threshold, even the three-point arc geometry. Below, the same two teams
 *   and the same seed play once under NBA rules and once in a rec league
 *   with 10-minute quarters, a 30-second clock, an NCAA-style one-and-one
 *   bonus, and a shorter FIBA-ish arc.
 *
 * RUN IT
 *   npm run example:04
 *
 * WHAT YOU SHOULD SEE
 *   A side-by-side comparison: the rec game's regulation ends at 2400
 *   game-seconds (4x10min) vs the NBA's 2880 (4x12min), scores scale down
 *   with the shorter game, threes get shorter than the NBA arc allows, and
 *   one-and-one front ends appear (they can't exist under NBA rules).
 *   Finishes in ~2 seconds.
 */

import { classifyShot, makeCourt, NBA, simulateGame } from '@hoopsh/engine';
import type { FreeThrowEvent, GameResult, RulePack } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

// ---- 1. the whole league definition ------------------------------------------
const REC: RulePack = {
  ...NBA,
  id: 'rec-league',
  name: 'Harbor Rec League',
  periodMinutes: 10,                 // 4x10 instead of 4x12
  shotClockSec: 30,                  // slower game...
  shotClockOffRebSec: 20,
  teamFoulBonusAt: 6,                // ...with an NCAA-style bonus:
  bonusRule: 'oneAndOne',            // make the front end to earn the second
  doubleBonusAt: 9,
  foulOutAt: 5,                      // stricter disqualification
  three: { arcRadiusFt: 22.15, cornerDistFt: 21.65, cornerBreakFt: 9.85 }
};

// ---- 2. the arc override, proven with pure geometry -----------------------------
// classifyShot is the engine's own zone classifier. Stand a shooter 23.0 ft
// straight out from the rim: under each pack's court, what is that shot?
const spot = { x: NBA.rimInsetFt + 23.0, y: NBA.courtWidthFt / 2 };
const callUnder = (rules: RulePack): string => {
  const court = makeCourt(rules);
  const loc = classifyShot(rules, court, court.rims[0], spot);
  return loc.three ? 'a THREE' : `a long TWO (zone: ${loc.zone})`;
};
console.log(`A 23.0 ft shot from the top is ${callUnder(NBA)} in the ${NBA.name},`);
console.log(`and ${callUnder(REC)} in the ${REC.name}. Same spot, different rule book.`);
console.log('');

// ---- 3. same teams, same seed, two rule books ---------------------------------
// seed re-anchored at the FLOW rebase: the reshuffled stream left the old
// 'sunday-run' rec game bonus-quiet (0 front ends); this one shows 4
const SEED = 'saturday-run';
const game = (rules?: RulePack): GameResult => {
  const { home, away } = sampleMatchup();
  return simulateGame({ seed: SEED, home, away, rules });
};
const nba = game();          // rules omitted = NBA default
const rec = game(REC);

// ---- 4. read the differences straight off the event streams --------------------
const summarize = (r: GameResult) => {
  const regPeriods = r.rules.periods;
  const regEnd = r.events.find((e) => e.type === 'period_end' && e.period === regPeriods);
  if (!regEnd) throw new Error('no regulation-final period_end event?');
  const oneAndOnes = r.events.filter(
    (e): e is FreeThrowEvent => e.type === 'free_throw' && (e as FreeThrowEvent).oneAndOne === true
  );
  return {
    id: r.rules.id,
    label: `${r.rules.name} (${r.rules.periods}x${r.rules.periodMinutes}min, ${r.rules.shotClockSec}s clock)`,
    regEndT: regEnd.t,
    score: r.finalScore,
    points: r.finalScore[0] + r.finalScore[1],
    oneAndOneFTs: oneAndOnes.length
  };
};

for (const s of [summarize(nba), summarize(rec)]) {
  console.log(s.label);
  console.log(`  rules id echoed by the result: ${s.id}`);
  console.log(`  regulation ends at t=${s.regEndT}s of game clock`);
  console.log(`  final: ${s.score[0]}-${s.score[1]} (${s.points} total points)`);
  console.log(`  one-and-one front ends shot: ${s.oneAndOneFTs}`);
  console.log('');
}

console.log('Same teams, same seed — only the rule pack changed. The rec game is');
console.log(`${2880 - 2400} game-seconds shorter, scores scale with it, and the`);
console.log('one-and-one exists only where its rule does.');
console.log('');
console.log('CAVEAT (honest edge): simulateGame validates ratings loudly, but a');
console.log('rule pack missing required fields fails mid-game, not at the boundary —');
console.log('always spread a shipped pack (...NBA) so every field stays present.');
