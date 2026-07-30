/**
 * Game-flow forensics — does the game ARC like basketball?
 *
 * The acceptance bands grade season-scale AVERAGES and texture.ts grades
 * frame-level FEEL; neither can see the shape of a single game. A sim can
 * pass every band while its games never trade runs, never change leaders,
 * and end close games without the foul parade — flow is the layer the eye
 * actually judges when it says "this reads like basketball". This tool
 * measures that layer with the same operational definitions applied to real
 * NBA play-by-play (see data/nba/flow-reference.json for the reference
 * values, their sources, and provenance grades).
 *
 * REPORT-ONLY by default (house ratchet convention: a metric becomes an
 * enforced test in test/flow.test.ts once it holds). The endgame layer
 * (timeouts, intentional fouling, clock kill — docs/REGISTER.md M4) landed and
 * defaults ON (sim/game.ts `endgame ?? true`), so a default run measures it
 * live; this tool holds the acceptance criteria its target metrics (clutch
 * FT share, Q4 comeback texture) are judged by, and `--no-endgame` measures
 * the legacy path for the off/on comparison.
 *
 * Operational definitions (keep in sync with the reference file — a metric
 * is only comparable if both sides count the same way):
 *   lead change — the scoreboard leader flips sign between two SCORING
 *     events (tie interludes don't count as changes; a tie is counted once
 *     when entered from a led state).
 *   run — consecutive unanswered points by one team; an 8-0 inside a 12-0
 *     counts once (runs are maximal).
 *   drought — one team's longest gap between its own scoring events on the
 *     game clock (t), tip and final horn included as endpoints, regulation
 *     only (OT excluded for cross-game comparability).
 *   clutch window — Q4, game clock <= 2:00, margin within 5 BEFORE the
 *     scoring event. clutchFTShare = FT points / all points inside that.
 *   Q4 comeback — a team leads by 10+ at any point in Q4 and loses.
 *   possession length — boundary-to-boundary on the game clock: this
 *     possession_end.t minus the PREVIOUS possession_end.t within the period
 *     (period openers measure from possession_start, i.e. the period
 *     boundary). This is the corpus segmentation (made FG / defensive
 *     rebound / turnover / made final FT / period end are the boundaries),
 *     so post-make inbound time — the clock runs through it — counts toward
 *     the next possession on BOTH sides. FT sequences freeze t either way.
 *     (The old start-to-end read undercounted ~41% of sim possessions by the
 *     running post-make resume time; audit H-05.)
 *
 * The measurement/reduction code itself lives in flow-metrics.ts (so the
 * parallel runner's worker can import it without importing this CLI); games
 * are distributed across worker subprocesses by parallel.ts — bit-identical
 * results for any --workers value, --workers 1 = plain single process.
 *
 * Run: npm run flow [-- --games 48 --seed flow --workers N --no-endgame --league nba|ncaa]
 * (--no-endgame simulates with GameConfig.endgame OFF — the legacy path,
 *  i.e. the off/on comparison for the endgame layer's target metrics:
 *  clutch FT share, Q4 shape. A default run measures the shipped default,
 *  which is ON; --endgame forces ON explicitly and today equals the
 *  default — it stopped being a comparison when the default flipped.)
 * (--league swaps the rule pack and re-anchors the period-structure metrics
 *  to that league's regulation shape — under 'ncaa' the clutch window and
 *  comeback tracking read the SECOND HALF as the final period and droughts
 *  span 40 minutes. The reference column stays NBA: college flow reference
 *  data is calibration-milestone work, so treat non-NBA runs as raw
 *  measurement, not a comparison.)
 */

import ref from '../../../data/nba/flow-reference.json' with { type: 'json' };
import { checkFlags, flagNumber, flagValue } from './args.js';
import { reduceFlows, type FlowAverages } from './flow-metrics.js';
import { resolveLeague } from './leagues.js';
import { resolveWorkerCount, runGames, runGamesInProcess } from './parallel.js';

// Re-exported so existing importers of the flow measurement keep working;
// the implementation moved to flow-metrics.ts (see header).
export { gameFlow, reduceFlows } from './flow-metrics.js';
export type { GameFlow, FlowAverages } from './flow-metrics.js';

/**
 * Measure `games` games single-process, synchronously (the test suite's
 * entry point — test/flow.test.ts). Same per-game path and reduction as the
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
    // a failed parallel run (worker crash, envelope mismatch) lands here —
    // print the whole story and exit nonzero; never a partial report
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  // declared vocabulary — a typo'd or `=`-spelled flag dies here instead of
  // silently measuring the defaults (args.ts checkFlags, audit H-03)
  checkFlags(process.argv, ['--games', '--seed', '--league', '--workers', '--endgame', '--no-endgame']);
  const games = flagNumber(process.argv, '--games', 48);
  // W13 pattern (cli.ts --games guard, red-team MINOR-4; audit M-22):
  // `--games 0` printed an all-NaN flow report and exited 0 — a report over
  // zero games is a misconfiguration, never a measurement. Die before
  // simulating anything.
  if (!Number.isInteger(games) || games < 1) {
    console.error(`--games requires an integer >= 1, got ${games} — refusing to report on a run that simulates nothing`);
    process.exit(1);
  }
  const seedBase = flagValue(process.argv, '--seed', 'flow');
  const league = resolveLeague(flagValue(process.argv, '--league', 'nba'));
  const workers = resolveWorkerCount(flagValue(process.argv, '--workers', 'auto'));
  const endgame = process.argv.includes('--endgame');
  const noEndgame = process.argv.includes('--no-endgame');
  if (endgame && noEndgame) throw new Error('flow: --endgame and --no-endgame contradict each other — pass at most one');
  // default runs the engine's shipped default (endgame ON since the flip);
  // --no-endgame is the legacy side of the off/on comparison, --endgame
  // forces ON explicitly (identical games to the default today)
  const task = noEndgame ? 'flowNoEndgame' as const : endgame ? 'flowEndgame' as const : 'flow' as const;
  console.log(`Measuring game flow over ${games} ${league.name} games (seed base "${seedBase}", ${workers} worker${workers === 1 ? '' : 's'}${noEndgame ? ', endgame OFF (legacy)' : endgame ? ', endgame ON (the shipped default)' : ''})...\n`);
  const t0 = performance.now();
  const flows = await runGames({ task, games, seedBase, league: league.id, workers });
  const m = reduceFlows(flows);
  console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)\n`);

  // Reference column: values + provenance grades imported DIRECTLY from
  // data/nba/flow-reference.json (top of file) — the same institutionalized
  // pattern texture.ts uses for its tracking references, so the printed
  // comparison cannot drift from the citation file again. The previous
  // hardcoded column kept printing the retired n=6 anchor values after the
  // 184-game corpus regeneration flagged four rows as materially different
  // (meta.changesVsAnchor; scan finding b4-3) — droughts "~295" vs corpus
  // 226 and poss>=16s "~25-35%" vs corpus 43.1% both INVERTED the conclusion
  // a reader would draw from the sim column.
  const F = ref.flow;
  const G = ref.grammar;
  const pctRef = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const rows: [string, string, string, string][] = [
    // strict scoring-event leader flips — the only published league figure
    // (26.7 in 2023-24) counts every flip inside FT sequences and is not
    // comparable (meta.publishedSources.leadChanges)
    ['Lead changes / game', m.leadChanges.toFixed(1), `~${F.leadChangesPerGame.value} (strict flips)`, F.leadChangesPerGame.grade],
    ['Ties / game', m.ties.toFixed(1), `~${F.tiesPerGame.value}`, F.tiesPerGame.grade],
    ['Largest lead / game', m.largestLead.toFixed(1), `~${F.largestLeadPerGame.value}`, F.largestLeadPerGame.grade],
    ['Runs >=8-0 / game', m.runs8.toFixed(2), `~${F.runs8PerGame.value}`, F.runs8PerGame.grade],
    ['Runs >=10-0 / game', m.runs10.toFixed(2), `~${F.runs10PerGame.value}`, F.runs10PerGame.grade],
    ['Max run / game', m.maxRun.toFixed(1), `~${F.maxRunPerGame.value}`, F.maxRunPerGame.grade],
    ['Max team drought (s)', m.maxDroughtSec.toFixed(0), `~${F.maxTeamDroughtSec.value}`, F.maxTeamDroughtSec.grade],
    ['Q pts profile', m.qPts.map((x) => x.toFixed(0)).join('/'), `${F.quarterPtsProfile.value.join('/')} (Q4 lowest)`, F.quarterPtsProfile.grade],
    ['Clutch FT share', `${(m.clutchFTShare * 100).toFixed(0)}% (${m.clutchGames}g)`, `~${pctRef(F.clutchFTShare.value)} (n=${F.clutchFTShare.dist.qualifyingGames} qualifying)`, F.clutchFTShare.grade],
    ['Q4 10+ lead lost', `${(m.comebackRate * 100).toFixed(0)}% (${m.led10Games}g)`, `~${pctRef(F.q4Lead10LostRate.value)} (95% CI ${pctRef(F.q4Lead10LostRate.range[0]!)}-${pctRef(F.q4Lead10LostRate.range[1]!)})`, F.q4Lead10LostRate.grade],
    ['Possession length p50 (s)', m.possP50.toFixed(1), `~${F.possessionP50Sec.value}`, F.possessionP50Sec.grade],
    ['Poss <=8s share', `${(m.possShare0to8 * 100).toFixed(0)}%`, `~${pctRef(F.possessionShare0to8.value)}`, F.possessionShare0to8.grade],
    ['Poss >=16s share', `${(m.possShare16plus * 100).toFixed(0)}%`, `~${pctRef(F.possessionShare16plus.value)}`, F.possessionShare16plus.grade],
    ['OREB -> putback <=6s', `${(m.putbackShare * 100).toFixed(0)}%`, `~${pctRef(G.putbackWithin6sShareOfOreb.value)} (of player OREBs)`, G.putbackWithin6sShareOfOreb.grade],
    ['Steal -> score <=6s', `${(m.stealConvShare * 100).toFixed(0)}%`, `~${pctRef(G.stealToScoreWithin6sShare.value)}`, G.stealToScoreWithin6sShare.grade],
    ['And-ones / game', m.andOnes.toFixed(1), `~${G.andOnesPerGame.value}`, G.andOnesPerGame.grade],
    ['2nd-chance poss share', `${(m.secondChanceShare * 100).toFixed(0)}%`, `~${pctRef(G.secondChanceShareOfPoss.value)} (of all poss, both teams)`, G.secondChanceShareOfPoss.grade]
  ];
  console.log('Game-flow report — sim vs real NBA (see data/nba/flow-reference.json for sources)');
  console.log('─'.repeat(88));
  for (const [name, sim, ref, grade] of rows) {
    console.log(`  ${name.padEnd(26)} sim ${sim.padEnd(18)} real ${ref.padEnd(34)} [${grade}]`);
  }
  // footer states which config these games actually ran — the previous text
  // claimed the endgame layer was still missing after it landed and turned
  // ON by default (scan finding b4-4: the stale footer printed on the very
  // games that had just measured the layer live)
  if (noEndgame) {
    console.log('\nThis run measured the LEGACY path (endgame OFF): clutch FT share, comeback texture,');
    console.log('and anything downstream of timeouts/intentional fouling reflect the pre-endgame engine.');
  } else {
    console.log('\nThe endgame layer (timeouts, intentional fouling, clock kill) was ON for these games');
    console.log('(the shipped default); run with --no-endgame for the legacy side of the comparison.');
  }
  if (league.id !== 'nba') {
    console.log(`\nNOTE: the reference column above is NBA data — this was a ${league.name} run, so read the sim`);
    console.log('column as raw measurement; league-specific flow references are calibration-milestone work.');
  }
}
