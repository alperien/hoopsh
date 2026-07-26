// Probe 6: season/Monte-Carlo layer.
import { simulateMatchup } from '/agent/w2-redteam/packages/harness/src/matchup.ts';
import { roundRobin, runSeason, computeStandings, buildTasks } from '/agent/w2-redteam/packages/harness/src/season.ts';
import { sampleMatchup } from '/agent/w2-redteam/packages/data/src/index.ts';

const { home, away } = sampleMatchup();
let fail = 0;
const bad = (m) => { fail++; console.log('FAIL:', m); };

// (a) does Monte-Carlo actually resample? n=6, margins must not all be equal
const d1 = await simulateMatchup(home, away, 6, { seedBase: 'rt-mc' });
const margins = d1.histogram.flatMap((b) => Array(b.count).fill(b.lo));
console.log('n=6 margins histogram:', JSON.stringify(d1.histogram), 'mean', d1.meanMargin.toFixed(1));
const distinctBins = d1.histogram.length;
if (distinctBins === 1 && d1.sdMargin === 0) bad('all 6 sims produced identical margins — NOT resampling');
else console.log('resampling: sdMargin =', d1.sdMargin.toFixed(2), '— distinct outcomes confirmed');

// (b) determinism: rerun byte-identical
const d2 = await simulateMatchup(home, away, 6, { seedBase: 'rt-mc' });
console.log('matchup rerun identical:', JSON.stringify(d1) === JSON.stringify(d2));

// (c) wilson/percentile edges: n=1
try {
  const d3 = await simulateMatchup(home, away, 1, { seedBase: 'rt-mc1' });
  console.log('n=1 ok: winProb', d3.homeWinProb, 'ci', d3.ci95.map((x) => x.toFixed(2)).join('..'), 'sd', d3.sdMargin);
} catch (e) { bad('n=1 crashed: ' + e.message); }

// (d) schedule pathology — all cheap, no sims:
try { roundRobin(['a', 'a', 'b']); bad('dup team ids accepted'); } catch (e) { console.log('dup ids loud:', e.message.slice(0, 60)); }
try { roundRobin(['solo']); bad('1-team league accepted'); } catch (e) { console.log('1-team loud:', e.message.slice(0, 60)); }
try { buildTasks([home, away], [{ home: home.id, away: home.id }], 's'); bad('self-matchup accepted'); } catch (e) { console.log('self-matchup loud:', e.message.slice(0, 70)); }
try { buildTasks([home, away], [{ home: home.id, away: 'ghost' }], 's'); bad('unknown team accepted'); } catch (e) { console.log('unknown team loud:', e.message.slice(0, 70)); }

// round-robin structure: 3 teams, 2 cycles (byes) — pairs meet twice, once in each building
const sched3 = roundRobin(['x', 'y', 'z']);
const counts = {};
for (const g of sched3) { counts[`${g.home}-${g.away}`] = (counts[`${g.home}-${g.away}`] ?? 0) + 1; }
console.log('3-team double RR fixtures:', JSON.stringify(counts), 'total', sched3.length);
const pairs = [['x', 'y'], ['x', 'z'], ['y', 'z']];
for (const [p, q] of pairs) {
  if ((counts[`${p}-${q}`] ?? 0) !== 1 || (counts[`${q}-${p}`] ?? 0) !== 1) bad(`pair ${p},${q} not balanced home/away`);
}

// (e) standings on a corrupt outcome: a tie must throw
try {
  computeStandings([{ index: 0, seed: 's', homeId: 'x', awayId: 'y', score: [100, 100], totals: [{}, {}], players: [] }]);
  bad('tied outcome accepted');
} catch (e) { console.log('tie loud:', e.message.slice(0, 70)); }

// (f) tiny real season: 3 teams x 1 cycle = 3 games (each team 2 games, 1 bye round)
import { cascadiaBreakers, meridianMonarchs } from '/agent/w2-redteam/packages/data/src/index.ts';
const t1 = cascadiaBreakers();
const t2 = meridianMonarchs();
const t3 = structuredClone(t1);
t3.id = 'clone3'; t3.name = 'Clone Three'; t3.abbrev = 'CL3';
const season = await runSeason({ teams: [t1, t2, t3], schedule: roundRobin([t1.id, t2.id, t3.id], 1), seedBase: 'rt-season' });
const sumDiff = season.standings.reduce((s, t) => s + t.diff, 0);
const sumW = season.standings.reduce((s, t) => s + t.wins, 0);
const sumL = season.standings.reduce((s, t) => s + t.losses, 0);
console.log('3-team season:', season.outcomes.length, 'games; diff zero-sum:', sumDiff, '; W==L:', sumW === sumL, `; per-team games: ${season.standings.map((t) => `${t.teamId}:${t.games}`).join(' ')}`);
if (sumDiff !== 0) bad('diff not zero-sum');
if (sumW !== sumL) bad('wins != losses');
if (season.standings.some((t) => t.games !== 2)) bad('bye handling broke per-team game count');

// (g) duplicate fixture in an explicit schedule (same matchup twice) — allowed? do seeds differ?
const dupTasks = buildTasks([t1, t2], [{ home: t1.id, away: t2.id }, { home: t1.id, away: t2.id }], 'rt-dup');
console.log('duplicate fixture seeds differ:', dupTasks[0].seed !== dupTasks[1].seed, `(${dupTasks[0].seed} vs ${dupTasks[1].seed})`);

// (h) empty schedule with pinned teams
const empty = await runSeason({ teams: [t1, t2], schedule: [], seedBase: 'rt-empty' });
console.log('empty schedule: standings rows', empty.standings.length, 'winPct', empty.standings.map((t) => t.winPct).join(','), 'sos', empty.standings.map((t) => t.sos).join(','));

console.log(fail === 0 ? 'SEASON LAYER: all probes pass' : `${fail} FAILURES`);
