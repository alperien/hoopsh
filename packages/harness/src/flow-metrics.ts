/**
 * Per-game flow measurement + order-preserving reduction — the pure library
 * half of flow.ts (which keeps the CLI/report and the doctrine header; the
 * operational definitions of every metric below live THERE, next to the
 * reference-data provenance notes, and must stay in sync with
 * data/nba/flow-reference.json).
 *
 * Split out of flow.ts so the parallel game-runner (parallel.ts /
 * run-worker.ts) can import gameFlow() without importing flow.ts's CLI
 * module — flow.ts itself imports the runner, and this split keeps that
 * dependency a straight line instead of a cycle.
 *
 * DETERMINISM NOTE on reduceFlows: it folds per-game GameFlow rows in ARRAY
 * ORDER (game 0, 1, 2, …). Parallel runs concatenate worker slices back into
 * global game order before calling it, so the floating-point operation
 * sequence — and therefore every reported digit — is identical no matter how
 * many workers produced the rows. Keep it that way: any change that reduces
 * out-of-order (or inside the workers) breaks worker-count invariance.
 */

import type { GameEvent } from '@hoopsh/engine';

export interface GameFlow {
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

/**
 * Fold per-game GameFlow rows (in game order — see the header's determinism
 * note) into the report averages. Extracted verbatim from the old
 * measureFlow() tail so single-process and parallel runs share one reduction.
 */
export function reduceFlows(flows: GameFlow[]): FlowAverages {
  const avg = (get: (f: GameFlow) => number) => flows.reduce((s, f) => s + get(f), 0) / flows.length;
  const allPoss = flows.flatMap((f) => f.possLens).sort((a, b) => a - b);
  const clutch = flows.filter((f) => f.hadClutch && f.clutchPts > 0);
  const led10 = flows.filter((f) => f.led10InQ4);
  return {
    games: flows.length,
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
