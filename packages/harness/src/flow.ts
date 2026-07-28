/**
 * Game-flow forensics: does the game arc like basketball.
 *
 * The acceptance bands grade season-scale averages and texture.ts grades
 * frame-level feel; neither can see the shape of a single game. A sim can
 * pass every band while its games never trade runs, never change leaders,
 * and end close games without the foul parade. Flow is the layer the eye
 * judges when it says "this reads like basketball". This tool
 * measures that layer with the same operational definitions applied to real
 * NBA play-by-play (see data/nba/flow-reference.json for the reference
 * values, their sources, and provenance grades).
 *
 * Report-only by default (house ratchet convention: a metric becomes an
 * enforced test in test/flow.test.ts once it holds). Known gaps are
 * expected and documented, most notably everything downstream of the
 * missing endgame layer (no timeouts, no intentional fouling, no clock
 * kill: REFACTOR.md roadmap M4), which this tool exists to hold honest
 * acceptance criteria for.
 *
 * Operational definitions (keep in sync with the reference file; a metric
 * is only comparable if both sides count the same way):
 *   lead change: the scoreboard leader flips sign between two scoring
 *     events (tie interludes don't count as changes; a tie is counted once
 *     when entered from a led state).
 *   run: consecutive unanswered points by one team; an 8-0 inside a 12-0
 *     counts once (runs are maximal).
 *   drought: one team's longest gap between its own scoring events on the
 *     game clock (t), tip and final horn included as endpoints, regulation
 *     only (OT excluded for cross-game comparability).
 *   clutch window: Q4, game clock <= 2:00, margin within 5 before the
 *     scoring event. clutchFTShare = FT points / all points inside that.
 *   Q4 comeback: a team leads by 10+ at any point in Q4 and loses.
 *   possession length: possession_end.t - possession_start.t (game-clock
 *     seconds; FT sequences freeze t, matching how possession-length data
 *     is usually reported against the shot/game clock).
 *
 * The measurement/reduction code itself lives in flow-metrics.ts (so the
 * parallel runner's worker can import it without importing this CLI); games
 * are distributed across worker subprocesses by parallel.ts. Bit-identical
 * results for any --workers value, --workers 1 = plain single process.
 *
 * Run: npm run flow [-- --games 48 --seed flow --workers N --endgame --league nba|ncaa]
 * (--endgame simulates with GameConfig.endgame on: the off/on comparison
 *  for the endgame layer's target metrics, clutch FT share and Q4 shape.)
 * (--league swaps the rule pack and re-anchors the period-structure metrics
 *  to that league's regulation shape; under 'ncaa' the clutch window and
 *  comeback tracking read the second half as the final period and droughts
 *  span 40 minutes. The reference column stays NBA: college flow reference
 *  data is calibration-milestone work, so treat non-NBA runs as raw
 *  measurement, not a comparison.)
 */

import { flagNumber, flagValue } from './args.js';
import { reduceFlows, type FlowAverages } from './flow-metrics.js';
import { resolveLeague } from './leagues.js';
import { resolveWorkerCount, runGames, runGamesInProcess } from './parallel.js';

// Re-exported so existing importers of the flow measurement keep working;
// the implementation moved to flow-metrics.ts (see header).
export { gameFlow, reduceFlows } from './flow-metrics.js';
export type { GameFlow, FlowAverages } from './flow-metrics.js';

/**
 * Measure `games` games single-process, synchronously (the test suite's
 * entry point, test/flow.test.ts). Same per-game path and reduction as the
 * parallel CLI below: runGamesInProcess is the identical inner loop the
 * workers run, so this and `npm run flow -- --workers N` cannot drift.
 */
export function measureFlow(games: number, seedBase: string, league = 'nba'): FlowAverages {
  return reduceFlows(runGamesInProcess('flow', seedBase, 0, games, undefined, league));
}

// ------------------------------------------------------------------ report

const isMain = process.argv[1]?.endsWith('flow.ts');
if (isMain) {
  main().catch((err) => {
    // a failed parallel run (worker crash, envelope mismatch) lands here:
    // print the whole story and exit nonzero; never a partial report
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const games = flagNumber(process.argv, '--games', 48);
  const seedBase = flagValue(process.argv, '--seed', 'flow');
  const league = resolveLeague(flagValue(process.argv, '--league', 'nba'));
  const workers = resolveWorkerCount(flagValue(process.argv, '--workers', 'auto'));
  const endgame = process.argv.includes('--endgame');
  console.log(`Measuring game flow over ${games} ${league.name} games (seed base "${seedBase}", ${workers} worker${workers === 1 ? '' : 's'}${endgame ? ', endgame ON' : ''})...\n`);
  const t0 = performance.now();
  const flows = await runGames({ task: endgame ? 'flowEndgame' : 'flow', games, seedBase, league: league.id, workers });
  const m = reduceFlows(flows);
  console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)\n`);

  // reference values: data/nba/flow-reference.json (values + provenance)
  const rows: [string, string, string, string][] = [
    ['Lead changes / game', m.leadChanges.toFixed(1), '~6.5 (6-game 25-26 sample) / ~9-10 (published avgs)', 'B'],
    ['Ties / game', m.ties.toFixed(1), '~5.7', 'B'],
    ['Largest lead / game', m.largestLead.toFixed(1), '~21.3', 'B'],
    ['Runs >=8-0 / game', m.runs8.toFixed(2), '~3.3', 'B'],
    ['Runs >=10-0 / game', m.runs10.toFixed(2), '~1.8', 'B'],
    ['Max run / game', m.maxRun.toFixed(1), '~12.5', 'B'],
    ['Max team drought (s)', m.maxDroughtSec.toFixed(0), '~295', 'B'],
    ['Q pts profile', m.qPts.map((x) => x.toFixed(0)).join('/'), '58.5/56.3/58.0/54.2 (Q4 lowest)', 'B'],
    ['Clutch FT share', `${(m.clutchFTShare * 100).toFixed(0)}% (${m.clutchGames}g)`, '30-50%+ (foul game; sample thin)', 'C'],
    ['Q4 10+ lead lost', `${(m.comebackRate * 100).toFixed(0)}% (${m.led10Games}g)`, '~5-10%', 'C'],
    ['Possession length p50 (s)', m.possP50.toFixed(1), '~11-14', 'B'],
    ['Poss <=8s share', `${(m.possShare0to8 * 100).toFixed(0)}%`, '~25-35%', 'C'],
    ['Poss >=16s share', `${(m.possShare16plus * 100).toFixed(0)}%`, '~25-35%', 'C'],
    // putback reference corrected (wave2): 0.716 of player OREBs from the
    // 184-game corpus (grade A); the old ~33% divided by all OREB rows
    // including team-rebound bookkeeping (flow-reference.json
    // putbackWithin6sShareOfOreb.basis). Sim ~50% is low, not high.
    ['OREB -> putback <=6s', `${(m.putbackShare * 100).toFixed(0)}%`, '~72%', 'A'],
    ['Steal -> score <=6s', `${(m.stealConvShare * 100).toFixed(0)}%`, '~29%', 'A'],
    ['And-ones / game', m.andOnes.toFixed(1), '~4.8', 'B'],
    ['2nd-chance poss share', `${(m.secondChanceShare * 100).toFixed(0)}%`, '~12-15%', 'C']
  ];
  console.log('Game-flow report — sim vs real NBA (see data/nba/flow-reference.json for sources)');
  console.log('─'.repeat(88));
  for (const [name, sim, ref, grade] of rows) {
    console.log(`  ${name.padEnd(26)} sim ${sim.padEnd(18)} real ${ref.padEnd(34)} [${grade}]`);
  }
  console.log('\nKnown gaps expected until the endgame layer lands (REFACTOR.md M4): clutch FT share,');
  console.log('comeback texture, and anything downstream of timeouts/intentional fouling.');
  if (league.id !== 'nba') {
    console.log(`\nNOTE: the reference column above is NBA data — this was a ${league.name} run, so read the sim`);
    console.log('column as raw measurement; league-specific flow references are calibration-milestone work.');
  }
}
