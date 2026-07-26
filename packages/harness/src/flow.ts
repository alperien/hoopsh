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
 * enforced test in test/flow.test.ts once it holds). Known gaps are
 * expected and documented — most notably everything downstream of the
 * missing endgame layer (no timeouts, no intentional fouling, no clock
 * kill: REFACTOR.md roadmap M4), which this tool exists to hold honest
 * acceptance criteria for.
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
 *   possession length — possession_end.t - possession_start.t (game-clock
 *     seconds; FT sequences freeze t, matching how possession-length data
 *     is usually reported against the shot/game clock).
 *
 * Run: npm run flow [-- --games 48 --seed flow --endgame]
 * (--endgame runs with GameConfig.endgame ON — the off/on comparison for
 *  the endgame layer's target metrics: clutch FT share, Q4 shape, tails.)
 */

import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { flagNumber, flagValue } from './args.js';

interface GameFlow {
  leadChanges: number;
  ties: number;
  largestLead: number;
  runs8: number;
  runs10: number;
  maxRun: number;
  maxDroughtSec: number;
  qPts: [number, number, number, number];
  clutchPts: number;
  clutchFTPts: number;
  hadClutch: boolean;
  led10InQ4Lost: boolean;
  led10InQ4: boolean;
  possLens: number[];
  // grammar
  oreb: number;
  putback6: number;
  steals: number;
  stealScore6: number;
  andOnes: number;
  secondChancePoss: number;
  poss: number;
}

export function gameFlow(events: GameEvent[]): GameFlow {
  const f: GameFlow = {
    leadChanges: 0, ties: 0, largestLead: 0, runs8: 0, runs10: 0, maxRun: 0,
    maxDroughtSec: 0, qPts: [0, 0, 0, 0], clutchPts: 0, clutchFTPts: 0,
    hadClutch: false, led10InQ4Lost: false, led10InQ4: false, possLens: [],
    oreb: 0, putback6: 0, steals: 0, stealScore6: 0, andOnes: 0,
    secondChancePoss: 0, poss: 0
  };
  let leader = 0;
  let prev: [number, number] = [0, 0];
  const lastScoreT: [number, number] = [0, 0];
  const maxDrought: [number, number] = [0, 0];
  let q4Led10By: -1 | 0 | 1 = 0; // which side (as sign) led by 10+ in Q4
  let possStart = -1;
  let possHadOreb = false;
  const REG = 4 * 12 * 60;

  const closeRun = (side: number, run: number) => {
    if (run >= 8) f.runs8++;
    if (run >= 10) f.runs10++;
    f.maxRun = Math.max(f.maxRun, run);
    return side;
  };
  let runSide = -1;
  let run = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const scored = e.score[0] + e.score[1] > prev[0] + prev[1];
    if (scored) {
      const side = e.score[0] > prev[0] ? 0 : 1;
      const pts = e.score[0] - prev[0] + (e.score[1] - prev[1]);
      if (e.period >= 1 && e.period <= 4) f.qPts[e.period - 1] += pts;
      // droughts (regulation only)
      if (e.t <= REG) {
        maxDrought[side] = Math.max(maxDrought[side], e.t - lastScoreT[side]);
        lastScoreT[side] = e.t;
      }
      // runs
      if (runSide === side) run += pts;
      else { if (runSide !== -1) closeRun(runSide, run); runSide = side; run = pts; }
      // lead bookkeeping
      const margin = e.score[0] - e.score[1];
      const newLeader = margin > 0 ? 1 : margin < 0 ? -1 : 0;
      if (newLeader === 0 && leader !== 0) f.ties++;
      if (newLeader !== 0 && leader !== 0 && newLeader !== leader) f.leadChanges++;
      if (newLeader !== 0) leader = newLeader;
      f.largestLead = Math.max(f.largestLead, Math.abs(margin));
      // clutch window
      const prevMargin = Math.abs(prev[0] - prev[1]);
      if (e.period === 4 && e.clock <= 120 && prevMargin <= 5) {
        f.hadClutch = true;
        f.clutchPts += pts;
        if (e.type === 'free_throw') f.clutchFTPts += pts;
      }
      // Q4 10+ lead tracking
      if (e.period === 4 && Math.abs(margin) >= 10) {
        q4Led10By = margin > 0 ? 1 : -1;
        f.led10InQ4 = true;
      }
      prev = [e.score[0], e.score[1]];
    }

    switch (e.type) {
      case 'possession_start':
        possStart = e.t;
        possHadOreb = false;
        break;
      case 'possession_end':
        f.poss++;
        if (possStart >= 0) f.possLens.push(Math.max(0, e.t - possStart));
        if (possHadOreb) f.secondChancePoss++;
        possStart = -1;
        break;
      case 'rebound':
        if (e.offensive) {
          f.oreb++;
          possHadOreb = true;
          // putback within 6s of game clock by the rebounding team
          for (let j = i + 1; j < events.length; j++) {
            const n = events[j]!;
            if (n.t - e.t > 6) break;
            if (n.type === 'shot' && n.team === e.team) { f.putback6++; break; }
            if (n.type === 'turnover' || (n.type === 'rebound')) break;
          }
        }
        break;
      case 'turnover':
        if (e.stolenBy) {
          f.steals++;
          const thiefSide = e.team === 0 ? 1 : 0;
          for (let j = i + 1; j < events.length; j++) {
            const n = events[j]!;
            if (n.t - e.t > 6) break;
            if (n.type === 'shot' && n.made && n.team === thiefSide) { f.stealScore6++; break; }
            if (n.type === 'turnover' || n.type === 'rebound') break;
          }
        }
        break;
      case 'shot':
        if (e.foul?.andOne) f.andOnes++;
        break;
    }
  }
  closeRun(runSide, run);
  // drought tails to the regulation horn
  for (const s of [0, 1] as const) {
    maxDrought[s] = Math.max(maxDrought[s], REG - lastScoreT[s]);
  }
  f.maxDroughtSec = Math.max(maxDrought[0], maxDrought[1]);
  // comeback: a side led by 10+ in Q4; did it lose?
  if (q4Led10By !== 0) {
    const final = prev[0] - prev[1];
    f.led10InQ4Lost = (q4Led10By > 0 && final < 0) || (q4Led10By < 0 && final > 0);
  }
  return f;
}

export interface FlowAverages {
  games: number;
  leadChanges: number; ties: number; largestLead: number;
  runs8: number; runs10: number; maxRun: number;
  maxDroughtSec: number;
  qPts: [number, number, number, number];
  clutchFTShare: number; clutchGames: number;
  comebackRate: number; led10Games: number;
  possP50: number; possShare0to8: number; possShare16plus: number;
  putbackShare: number; stealConvShare: number; andOnes: number;
  secondChanceShare: number;
}

export function measureFlow(games: number, seedBase: string, endgame = false): FlowAverages {
  const flows: GameFlow[] = [];
  for (let i = 0; i < games; i++) {
    const { home, away } = sampleMatchup();
    const flip = i % 2 === 1;
    const r = simulateGame({
      seed: `${seedBase}-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false,
      endgame
    });
    flows.push(gameFlow(r.events));
  }
  const avg = (get: (f: GameFlow) => number) => flows.reduce((s, f) => s + get(f), 0) / flows.length;
  const allPoss = flows.flatMap((f) => f.possLens).sort((a, b) => a - b);
  const clutch = flows.filter((f) => f.hadClutch && f.clutchPts > 0);
  const led10 = flows.filter((f) => f.led10InQ4);
  return {
    games,
    leadChanges: avg((f) => f.leadChanges),
    ties: avg((f) => f.ties),
    largestLead: avg((f) => f.largestLead),
    runs8: avg((f) => f.runs8),
    runs10: avg((f) => f.runs10),
    maxRun: avg((f) => f.maxRun),
    maxDroughtSec: avg((f) => f.maxDroughtSec),
    qPts: [0, 1, 2, 3].map((i) => avg((f) => f.qPts[i]!)) as [number, number, number, number],
    clutchFTShare: clutch.length ? clutch.reduce((s, f) => s + f.clutchFTPts / f.clutchPts, 0) / clutch.length : 0,
    clutchGames: clutch.length,
    comebackRate: led10.length ? led10.filter((f) => f.led10InQ4Lost).length / led10.length : 0,
    led10Games: led10.length,
    possP50: allPoss[Math.floor(allPoss.length / 2)] ?? 0,
    possShare0to8: allPoss.filter((x) => x <= 8).length / Math.max(1, allPoss.length),
    possShare16plus: allPoss.filter((x) => x >= 16).length / Math.max(1, allPoss.length),
    putbackShare: avg((f) => f.oreb) > 0 ? avg((f) => f.putback6) / avg((f) => f.oreb) : 0,
    stealConvShare: avg((f) => f.steals) > 0 ? avg((f) => f.stealScore6) / avg((f) => f.steals) : 0,
    andOnes: avg((f) => f.andOnes),
    secondChanceShare: avg((f) => f.poss) > 0 ? avg((f) => f.secondChancePoss) / (avg((f) => f.poss) / 2) : 0
  };
}

// ------------------------------------------------------------------ report

const isMain = process.argv[1]?.endsWith('flow.ts');
if (isMain) {
  const games = flagNumber(process.argv, '--games', 48);
  const seedBase = flagValue(process.argv, '--seed', 'flow');
  // --endgame: run with the endgame layer ON (GameConfig.endgame) — this is
  // the intended off/on comparison tool for exactly the metrics the layer
  // exists to move (clutch FT share, Q4 profile, possession-length tails)
  const endgame = process.argv.includes('--endgame');
  console.log(`Measuring game flow over ${games} games (seed base "${seedBase}"${endgame ? ', endgame layer ON' : ''})...\n`);
  const t0 = performance.now();
  const m = measureFlow(games, seedBase, endgame);
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
    ['OREB -> putback <=6s', `${(m.putbackShare * 100).toFixed(0)}%`, '~33%', 'B'],
    ['Steal -> score <=6s', `${(m.stealConvShare * 100).toFixed(0)}%`, '~29%', 'B'],
    ['And-ones / game', m.andOnes.toFixed(1), '~4.8', 'B'],
    ['2nd-chance poss share', `${(m.secondChanceShare * 100).toFixed(0)}%`, '~12-15%', 'C']
  ];
  console.log('Game-flow report — sim vs real NBA (see data/nba/flow-reference.json for sources)');
  console.log('─'.repeat(88));
  for (const [name, sim, ref, grade] of rows) {
    console.log(`  ${name.padEnd(26)} sim ${sim.padEnd(18)} real ${ref.padEnd(34)} [${grade}]`);
  }
  if (endgame) {
    console.log('\nEndgame layer ON (GameConfig.endgame): clutch FT share, timeouts, and the foul');
    console.log('parade are live — compare against a flag-off run of the same seeds/games.');
  } else {
    console.log('\nKnown gaps expected while the endgame layer ships flag-OFF (GameConfig.endgame,');
    console.log('REFACTOR.md M4): clutch FT share, comeback texture, and everything downstream of');
    console.log('timeouts/intentional fouling. Re-run with --endgame for the layer-on numbers.');
  }
}
