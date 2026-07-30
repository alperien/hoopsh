/**
 * The FLOW program scoreboard: 13 gates, one command, one table.
 *
 *   npm run flowboard [-- --games 20 --seed flowboard --corpus data/nba/pbp-plays]
 *
 * Prints the program's judgment instrument (findings/fdesign-judge.md §3):
 * gates T1/T2 (blind discrimination under the fair matched-representation
 * protocol, measured by the statistical judge below) and G1-G11 (dead-ball /
 * texture structure the enforced flow gates cannot see), each with its corpus
 * reference, the current sim value, the target band, and a verdict. Writes
 * out/scoreboard.json. This is the command the flow arcs re-run after every
 * change; a G-row graduates into test/flow.test.ts once it holds (house
 * ratchet convention).
 *
 * Measurement doctrine, one algorithm, two adapters: every gate is computed
 * from `NeutralRow`s (turing.ts's fair schema) by the same functions for the
 * sim side (live games) and the corpus side (the committed 184-game shards),
 * so definitions cannot fork between sides. Corpus references are therefore
 * live-computed at print time, never hand-typed (AGENTS §4.4: no stale
 * quotes); the design doc's §3 numbers serve as the cross-check. The target
 * bands are the design doc's, encoded once in GATE_BANDS with provenance.
 * The one exception is G11's dunk count, which needs the call-word channel
 * (narration shotCall / bbref "dunk" text); it rides the NeutralGame
 * side-channel, documented there.
 *
 * The statistical judge (T1/T2): a deterministic, in-repo stand-in for the
 * out-of-band LLM panel (the repo is zero-dep by law: no API calls here).
 * Structural discriminators only; every feature reads NeutralRows that both
 * sides produce through the matched-representation mappers, so format cannot
 * carry a verdict, only basketball structure can. Per-feature decision
 * thresholds are learned on a train split (games, not windows, so sibling
 * windows never straddle the split) and scored on the held-out half:
 * accuracy-weighted vote, majority verdict, Wilson 95% CI on held-out
 * accuracy. The per-feature accuracies are the tell table. A statistical
 * judge is sharper than a naive human/LLM panel on rate features (it cannot
 * be fooled by prose intuition), so read T1/T2 here as the discriminability
 * upper bound under fair representation; panel runs on the same packs
 * (npm run turing) remain the protocol for human-register verdicts.
 *
 * Determinism: same flags => byte-identical output (all randomness through
 * seeded Rng; corpus games season-spread by seeded shuffle).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Rng } from '@hoopsh/engine';
import { checkFlags, flagNumber, flagValue } from './args.js';
import {
  anonymizeWindow, coreFilter, cutWindows, loadCorpus, realToNeutral, simNeutralGames,
  type NeutralGame, type NeutralRow, type WindowKind, type WindowSpec
} from './turing.js';

// ---------------------------------------------------------------- helpers

/** game-clock seconds elapsed since tip (mirrors tools/parse-nba.mjs `elapsed`) */
const elapsed = (q: number, clock: number): number =>
  q <= 4 ? (q - 1) * 720 + (720 - clock) : 2880 + (q - 5) * 300 + (300 - clock);

/** period-opening clock value (720s regulation quarters, 300s OT) */
const periodLen = (q: number): number => (q <= 4 ? 720 : 300);

const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i]!;
};

/** Wilson 95% score interval; mirrors tools/parse-nba.mjs `wilson95` */
export function wilson95(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / den;
  return [Math.max(0, c - half), Math.min(1, c + half)];
}

/** a LIVE row for gate G10 / the judge's cluster feature: play happening with
 *  the clock conceptually running; everything else is a dead-ball stack row */
const isLiveRow = (r: NeutralRow): boolean =>
  (r.type === 'shot' && r.actor !== 'TEAM') || r.type === 'tov' || (r.type === 'reb' && r.actor !== 'TEAM');

/** rows only the officiating/vocabulary layer produces; sim streams emit
 *  none of these today (gate G2's judge-side shadow) */
const isJunkRow = (r: NeutralRow): boolean =>
  r.type === 'replay' || r.type === 'violation' ||
  (r.type === 'jump' && r.clock !== periodLen(r.q)) ||
  (r.type === 'tov' && r.tov!.sub === 'violation') ||
  (r.type === 'foul' && (r.foul!.klass === 'technical' || r.foul!.klass === 'flagrant')) ||
  (r.type === 'ft' && r.ft!.klass !== 'plain') ||
  (r.type === 'shot' && r.actor === 'TEAM');

// ------------------------------------------- shared row-scan measurements
// One implementation per definition, consumed by both the per-game gate
// stats and the judge's window features, so the definitions cannot fork.

/** G9: game-clock deltas miss -> PLAYER rebound (dead-ball TEAM formalities
 *  excluded by the player filter; interleaved sub rows skipped) */
export function rebMissDeltas(rows: readonly NeutralRow[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.type !== 'reb' || r.actor === 'TEAM') continue;
    let j = i - 1;
    while (j >= 0 && rows[j]!.type === 'sub' && rows[j]!.q === r.q) j--;
    if (j < 0) continue;
    const prev = rows[j]!;
    if (prev.q !== r.q) continue;
    const miss =
      (prev.type === 'shot' && prev.actor !== 'TEAM' && !prev.shot!.made) ||
      (prev.type === 'ft' && !prev.ft!.made && prev.ft!.n === prev.ft!.of);
    if (!miss) continue;
    const d = prev.clock - r.clock;
    if (d >= 0) out.push(d);
  }
  return out;
}

/** G10: [same-second live pairs, all live pairs]. Adjacent same-quarter
 *  pairs where both rows are live; the share is among live pairs (dead-ball
 *  stacks legitimately share seconds and are excluded from the denominator;
 *  reproduces the design audit's corpus 4.6%, all-pairs 32%). */
export function sameSecPairs(rows: readonly NeutralRow[]): [number, number] {
  let shared = 0;
  let live = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    if (a.q !== b.q) continue;
    if (!(isLiveRow(a) && isLiveRow(b))) continue;
    live++;
    if (a.clock === b.clock) shared++;
  }
  return [shared, live];
}

/**
 * G8c: substitutions <= 2s of game clock after a made FG with no stoppage row
 * between (only other sub rows may intervene); the live-ball-sub half of the
 * whistle-cadence tell. `excludeEndgame` skips Q4 <= 3:00 (the gate's corpus
 * definition); the judge's window feature keeps everything it sees.
 */
export function subAfterMakeCount(rows: readonly NeutralRow[], excludeEndgame: boolean): number {
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.type !== 'sub') continue;
    if (excludeEndgame && r.q === 4 && r.clock <= 180) continue;
    let j = i - 1;
    while (j >= 0 && rows[j]!.type === 'sub' && rows[j]!.q === r.q) j--;
    if (j < 0) continue;
    const prev = rows[j]!;
    if (prev.q !== r.q) continue;
    if (prev.type === 'shot' && prev.actor !== 'TEAM' && prev.shot!.made && prev.clock - r.clock <= 2) n++;
  }
  return n;
}

/**
 * Possession count from neutral rows (G11 denominator), corpus definition
 * (flow-reference.json meta): boundaries = made FG (and-one trips close at
 * the FT sequence instead), defensive rebound (player or TEAM), turnover,
 * made final FT of a plain trip, period end on a live possession.
 */
export function countPossessions(rows: readonly NeutralRow[]): number {
  let n = 0;
  let open = false;
  let lastQ = rows.length > 0 ? rows[0]!.q : 1;
  const close = (): void => { n++; open = false; };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.q !== lastQ) {
      if (open) close();
      lastQ = r.q;
    }
    switch (r.type) {
      case 'tov': close(); break;
      case 'reb':
        if (!r.reb!.off) close(); else open = true;
        break;
      case 'shot': {
        if (r.actor === 'TEAM') break; // anonymous heave formality
        if (r.shot!.made) {
          // and-one: a shooting-foul row within 1s follows; the FT trip closes it
          let andOne = false;
          for (let j = i + 1; j < Math.min(i + 4, rows.length); j++) {
            const f = rows[j]!;
            if (f.q !== r.q || r.clock - f.clock > 1) break;
            if (f.type === 'foul' && f.foul!.klass === 'shooting') { andOne = true; break; }
          }
          if (!andOne) close(); else open = true;
        } else open = true;
        break;
      }
      case 'ft':
        if (r.ft!.klass === 'plain' && r.ft!.made && r.ft!.n === r.ft!.of) close(); else open = true;
        break;
      case 'foul':
      case 'jump':
        open = true;
        break;
      default: break; // sub/timeout/violation/replay don't open or close possessions
    }
  }
  if (open) n++;
  return n;
}

// ---------------------------------------------------- per-game gate stats

export interface GateStats {
  timeouts: number; qWith1: number; qWith2: number;                       // G1
  junk: Record<string, number>;                                          // G2
  openerElapsed: number[];                                               // G3 (Q2-Q4)
  orebPlayer: number; putbackAtt: number; putback3: number; putbackMade: number; // G4
  made3: number; made3Assisted: number;                                  // G5
  heaveAtt: number; heaveMade: number; heaveDecided: number;             // G6
  qPts: [number, number, number, number]; min48: number;                 // G7
  ftPtsQ: [number, number, number, number];
  subsInFtWindow: number; ft2Q1Cases: number; ft2Q1Pulled: number;       // G8 a/b
  subAfterMake: number; subs: number;                                    // G8 c/d
  rebDeltas: number[];                                                   // G9
  sameSecLive: number; adjPairs: number;                                 // G10
  madeDunks: number; madeRim: number; madePaint: number; poss: number;   // G11
}

/** All G1-G11 raw counters for one game; same function for sim and corpus. */
export function gateStatsForGame(g: NeutralGame): GateStats {
  const rows = g.rows;
  const s: GateStats = {
    timeouts: 0, qWith1: 0, qWith2: 0, junk: {}, openerElapsed: [],
    orebPlayer: 0, putbackAtt: 0, putback3: 0, putbackMade: 0,
    made3: 0, made3Assisted: 0, heaveAtt: 0, heaveMade: 0, heaveDecided: 0,
    qPts: [0, 0, 0, 0], min48: 0, ftPtsQ: [0, 0, 0, 0],
    subsInFtWindow: 0, ft2Q1Cases: 0, ft2Q1Pulled: 0,
    subAfterMake: subAfterMakeCount(rows, true), subs: 0,
    rebDeltas: rebMissDeltas(rows),
    sameSecLive: 0, adjPairs: 0,
    madeDunks: g.madeDunks, madeRim: 0, madePaint: 0, poss: countPossessions(rows)
  };
  [s.sameSecLive, s.adjPairs] = sameSecPairs(rows);

  const jc = (k: string): void => { s.junk[k] = (s.junk[k] ?? 0) + 1; };
  const toPerQ = [0, 0, 0, 0];
  let prevTotal = 0;
  let prevPair: [number, number] = [0, 0]; // running [A,B] for margin checks
  const foulCount = new Map<string, number>();
  const ft2Cases: { actor: string; at: number; pulled: boolean }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;

    // G2 census categories (design doc §3 G2 row, category by category)
    if (r.type === 'replay') jc('replay');
    if (r.type === 'tov' && r.tov!.sub === 'shotclock') jc('shotclockTO');
    if (r.type === 'tov' && r.tov!.sub === 'violation') {
      const w = r.tov!.g2 ?? 'other';
      jc(w === 'traveling' ? 'traveling' : w === 'off goaltending' ? 'goaltend' : 'miscDeadTO');
    }
    if (r.type === 'jump' && r.clock !== periodLen(r.q)) jc('midGameJump');
    if (r.type === 'foul' && r.foul!.klass === 'technical') jc('tech');
    if (r.type === 'foul' && r.foul!.klass === 'flagrant') jc('flagrant');
    if (r.type === 'foul' && r.foul!.g2 === 'take') jc('takeFoul');
    if (r.type === 'violation') {
      const v = r.viol!.sub;
      jc(v === 'def3sec' ? 'def3sec' : v === 'goaltend' ? 'goaltend' :
        v === 'kicked' ? 'kicked' : v === 'delay' ? 'delay' : 'miscViolation');
    }
    if (r.type === 'ft' && r.ft!.klass !== 'plain') jc('techClassFT');

    if (r.type === 'timeout') {
      s.timeouts++;
      if (r.q <= 4) toPerQ[r.q - 1]!++;
    }
    if (r.type === 'sub') s.subs++;

    // G8a: a sub strictly inside an FT trip; an FT attempt behind it and one
    // ahead of it at the frozen clock (subs after the foul but before the
    // trip's first attempt don't count; measures 14.2/g on the corpus vs the
    // design audit's 15.0; the residual is trips whose sub shares the second
    // with the foul row only)
    if (r.type === 'sub') {
      let before = false;
      let after = false;
      for (let j = i - 1; j >= 0 && rows[j]!.q === r.q && rows[j]!.clock === r.clock; j--) {
        if (rows[j]!.type === 'ft') { before = true; break; }
      }
      for (let j = i + 1; j < rows.length && rows[j]!.q === r.q && rows[j]!.clock === r.clock; j++) {
        if (rows[j]!.type === 'ft') { after = true; break; }
      }
      if (before && after) s.subsInFtWindow++;
      // G8b resolution: was a foul-trouble case pulled within 120s?
      for (const c of ft2Cases) {
        if (!c.pulled && r.sub!.out === c.actor && elapsed(r.q, r.clock) - c.at <= 120) c.pulled = true;
      }
    }

    // G8b case collection: a player's SECOND foul while still in Q1
    if (r.type === 'foul' && r.actor && r.actor !== 'TEAM' &&
      (r.foul!.klass === 'shooting' || r.foul!.klass === 'personal' ||
        r.foul!.klass === 'looseball' || r.foul!.klass === 'offensive')) {
      const c = (foulCount.get(r.actor) ?? 0) + 1;
      foulCount.set(r.actor, c);
      if (c === 2 && r.q === 1) ft2Cases.push({ actor: r.actor, at: elapsed(r.q, r.clock), pulled: false });
    }

    // G3: first attack of the Q2-Q4 opening possession (first shot, turnover,
    // or shooting foul of the quarter: how long the opener took to attack).
    // Definition note: counts ALL Q2-Q4 openers (corpus n=552 -> 2.7% <=8s,
    // median 16s); the design audit's 1.7% (n=475) additionally excluded
    // quarters it could not attribute to the arrow team. Both sit an order
    // of magnitude from the sim's ~40%; the same rule runs on both sides.
    if (r.q >= 2 && r.q <= 4) {
      const isFirstOfQ = i === 0 || rows[i - 1]!.q !== r.q;
      if (isFirstOfQ) {
        for (let j = i; j < rows.length && rows[j]!.q === r.q; j++) {
          const a = rows[j]!;
          if (a.type === 'shot' || a.type === 'tov' || (a.type === 'foul' && a.foul!.klass === 'shooting')) {
            s.openerElapsed.push(720 - a.clock);
            break;
          }
        }
      }
    }

    // G4: player OREB -> next FGA by the rebounding team within 6s
    if (r.type === 'reb' && r.reb!.off && r.actor !== 'TEAM') {
      s.orebPlayer++;
      for (let j = i + 1; j < rows.length && rows[j]!.q === r.q; j++) {
        const a = rows[j]!;
        if (a.type === 'reb' || a.type === 'tov') break;
        if (a.type === 'shot' && a.actor !== 'TEAM') {
          if (a.side === r.side && r.clock - a.clock <= 6) {
            s.putbackAtt++;
            if (a.shot!.pts === 3) s.putback3++;
            if (a.shot!.made) s.putbackMade++;
          }
          break; // first FGA ends the scan either way
        }
      }
    }

    if (r.type === 'shot' && r.actor !== 'TEAM') {
      const sh = r.shot!;
      if (sh.made && sh.pts === 3) {
        s.made3++;
        if (sh.assist) s.made3Assisted++;
      }
      if (sh.made && sh.pts === 2 && sh.distFt !== null) {
        // bbref shooting-split distance buckets: rim 0-3 ft, paint (non-rim)
        // 4-10 ft; the one channel both sides carry is distance, and these
        // cuts reproduce the design audit's corpus shares (15.8%/7.8%)
        if (sh.distFt <= 3) s.madeRim++;
        else if (sh.distFt <= 10) s.madePaint++;
      }
      // G6: an attributed heave row, >= 35 ft inside the final 4s of a period
      if (sh.distFt !== null && sh.distFt >= 35 && r.clock <= 4) {
        s.heaveAtt++;
        if (sh.made) s.heaveMade++;
        const margin = Math.abs(prevPair[0] - prevPair[1]);
        if (r.q === 4 && r.clock <= 60 && margin >= 10) s.heaveDecided++;
      }
    }

    // G7: score deltas by quarter (regulation only) + final-minute points
    if (r.score) {
      const tot = r.score[0] + r.score[1];
      const d = tot - prevTotal;
      if (d > 0 && r.q <= 4) {
        s.qPts[r.q - 1]! += d;
        if (r.q === 4 && r.clock <= 60) s.min48 += d;
      }
      prevTotal = tot;
      prevPair = [r.score[0], r.score[1]];
    }
    if (r.type === 'ft' && r.ft!.made && r.q <= 4) s.ftPtsQ[r.q - 1]!++;
  }

  s.qWith1 = toPerQ.filter((x) => x >= 1).length;
  s.qWith2 = toPerQ.filter((x) => x >= 2).length;
  s.ft2Q1Cases = ft2Cases.length;
  s.ft2Q1Pulled = ft2Cases.filter((c) => c.pulled).length;
  return s;
}

// -------------------------------------------------------------- aggregation

export interface GateValues {
  games: number;
  g1: { perGame: number; q1Cov: number; q2Cov: number };
  g2: { perGame: number; cats: Record<string, number>; catsAtLeast03: number };
  g3: { share8: number; median: number; n: number };
  g4: { putback: number; quick3: number; fgPct: number; orebPerGame: number };
  g5: { perGame: number; assisted: number };
  g6: { perGame: number; att: number; made: number; decidedPerGame: number };
  g7: { qPts: number[]; q4Delta: number; q4IsMin: boolean; min48: number; ftClimb: number };
  g8: { a: number; b: number; bCases: number; c: number; d: number };
  g9: { p50: number; share1: number; n: number };
  g10: { share: number; pairs: number };
  g11: { dunks: number; rimShare: number; paintShare: number; possPerGame: number };
}

/** Reduce per-game stats to the scoreboard's aggregate values (means per
 *  game; pooled shares where the corpus reference pools, e.g. putbacks). */
export function aggregateGates(list: readonly GateStats[]): GateValues {
  const n = list.length;
  const sum = (f: (s: GateStats) => number): number => list.reduce((a, s) => a + f(s), 0);
  const per = (f: (s: GateStats) => number): number => (n === 0 ? 0 : sum(f) / n);

  const cats: Record<string, number> = {};
  for (const s of list) for (const [k, v] of Object.entries(s.junk)) cats[k] = (cats[k] ?? 0) + v;
  for (const k of Object.keys(cats)) cats[k] = cats[k]! / Math.max(1, n);

  const openers = list.flatMap((s) => s.openerElapsed).sort((a, b) => a - b);
  const deltas = list.flatMap((s) => s.rebDeltas).sort((a, b) => a - b);
  const qPts = [0, 1, 2, 3].map((q) => per((s) => s.qPts[q]!));
  const q123 = (qPts[0]! + qPts[1]! + qPts[2]!) / 3;
  const ftQ1 = sum((s) => s.ftPtsQ[0]!);
  const ftQ4 = sum((s) => s.ftPtsQ[3]!);
  const putAtt = sum((s) => s.putbackAtt);
  const bCases = sum((s) => s.ft2Q1Cases);
  const pairs = sum((s) => s.adjPairs);
  const poss = sum((s) => s.poss);

  return {
    games: n,
    g1: {
      perGame: per((s) => s.timeouts),
      q1Cov: n === 0 ? 0 : sum((s) => s.qWith1) / (4 * n),
      q2Cov: n === 0 ? 0 : sum((s) => s.qWith2) / (4 * n)
    },
    g2: {
      perGame: per((s) => Object.values(s.junk).reduce((a, b) => a + b, 0)),
      cats,
      catsAtLeast03: Object.values(cats).filter((v) => v >= 0.3).length
    },
    g3: {
      share8: openers.length === 0 ? 0 : openers.filter((x) => x <= 8).length / openers.length,
      median: percentile(openers, 0.5),
      n: openers.length
    },
    g4: {
      putback: putAtt === 0 && sum((s) => s.orebPlayer) === 0 ? 0 : putAtt / Math.max(1, sum((s) => s.orebPlayer)),
      quick3: putAtt === 0 ? 0 : sum((s) => s.putback3) / putAtt,
      fgPct: putAtt === 0 ? 0 : sum((s) => s.putbackMade) / putAtt,
      orebPerGame: per((s) => s.orebPlayer)
    },
    g5: {
      perGame: per((s) => s.made3 - s.made3Assisted),
      assisted: sum((s) => s.made3) === 0 ? 0 : sum((s) => s.made3Assisted) / sum((s) => s.made3)
    },
    g6: {
      perGame: per((s) => s.heaveAtt),
      att: sum((s) => s.heaveAtt),
      made: sum((s) => s.heaveMade),
      decidedPerGame: per((s) => s.heaveDecided)
    },
    g7: {
      qPts,
      q4Delta: q123 - qPts[3]!,
      q4IsMin: qPts[3]! <= Math.min(qPts[0]!, qPts[1]!, qPts[2]!),
      min48: per((s) => s.min48),
      ftClimb: ftQ1 === 0 ? 0 : (ftQ4 - ftQ1) / ftQ1
    },
    g8: {
      a: per((s) => s.subsInFtWindow),
      b: bCases === 0 ? 0 : sum((s) => s.ft2Q1Pulled) / bCases,
      bCases,
      c: per((s) => s.subAfterMake),
      d: per((s) => s.subs)
    },
    g9: {
      p50: percentile(deltas, 0.5),
      share1: deltas.length === 0 ? 0 : deltas.filter((d) => d <= 1).length / deltas.length,
      n: deltas.length
    },
    g10: {
      share: pairs === 0 ? 0 : sum((s) => s.sameSecLive) / pairs,
      pairs
    },
    g11: {
      dunks: per((s) => s.madeDunks),
      rimShare: poss === 0 ? 0 : sum((s) => s.madeRim) / poss,
      paintShare: poss === 0 ? 0 : sum((s) => s.madePaint) / poss,
      possPerGame: per((s) => s.poss)
    }
  };
}

// -------------------------------------------------------- statistical judge

export interface Excerpt { rows: NeutralRow[]; label: 'sim' | 'real'; game: number }

/** window features: structural rates only, all from NeutralRows both sides
 *  produce through the matched mappers. null = feature abstains (no material
 *  in this window, e.g. no miss->rebound pair). */
export const JUDGE_FEATURES: { name: string; fn: (rows: readonly NeutralRow[]) => number | null }[] = [
  {
    name: 'reb<=1s share', // G9's spine; tell C
    fn: (rows) => {
      const d = rebMissDeltas(rows);
      return d.length === 0 ? null : d.filter((x) => x <= 1).length / d.length;
    }
  },
  {
    name: 'live same-sec pairs', // G10
    fn: (rows) => {
      const [live, all] = sameSecPairs(rows);
      return all === 0 ? null : live / all;
    }
  },
  {
    name: 'timeout rate', // G1
    fn: (rows) => rows.filter((r) => r.type === 'timeout').length / rows.length
  },
  {
    name: 'officiating vocab', // G2 (census; ~0 both sides under core)
    fn: (rows) => rows.filter(isJunkRow).length / rows.length
  },
  {
    name: 'live-ball subs', // G8c
    fn: (rows) => subAfterMakeCount(rows, false) / rows.length
  },
  {
    name: 'clock gap p50', // row density; pace texture
    fn: (rows) => {
      const gaps: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        if (rows[i]!.q === rows[i - 1]!.q) gaps.push(rows[i - 1]!.clock - rows[i]!.clock);
      }
      gaps.sort((a, b) => a - b);
      return gaps.length === 0 ? null : percentile(gaps, 0.5);
    }
  }
];

export interface Cut { thr: number; hiIsSim: boolean; acc: number }

/** learn the best single-threshold rule on train values (balanced accuracy;
 *  deterministic tie-break: first candidate). Exported for the arithmetic pins. */
export function learnCut(vals: readonly { v: number; sim: boolean }[]): Cut {
  const uniq = [...new Set(vals.map((x) => x.v))].sort((a, b) => a - b);
  const nSim = vals.filter((x) => x.sim).length;
  const nReal = vals.length - nSim;
  if (uniq.length < 2 || nSim === 0 || nReal === 0) return { thr: uniq[0] ?? 0, hiIsSim: true, acc: 0.5 };
  let best: Cut = { thr: uniq[0]!, hiIsSim: true, acc: 0 };
  for (let i = 0; i < uniq.length - 1; i++) {
    const thr = (uniq[i]! + uniq[i + 1]!) / 2;
    for (const hiIsSim of [true, false]) {
      let okSim = 0;
      let okReal = 0;
      for (const x of vals) {
        const saysSim = x.v > thr === hiIsSim;
        if (x.sim && saysSim) okSim++;
        if (!x.sim && !saysSim) okReal++;
      }
      const acc = (okSim / nSim + okReal / nReal) / 2;
      if (acc > best.acc) best = { thr, hiIsSim, acc };
    }
  }
  return best;
}

export interface JudgeReport {
  kind: WindowKind;
  variant: 'census' | 'core';
  nEval: number;
  nTrain: number;
  acc: number;
  ci: [number, number];
  simAsReal: number;
  realAsSim: number;
  rejected: number;
  tells: { name: string; trainAcc: number; evalAcc: number; evalN: number }[];
}

/**
 * The fair discrimination protocol, statistically judged: cut windows from
 * both sides (one cutter, one anonymizer, one schema), split by game into
 * train/eval halves, learn per-feature thresholds on train, majority-vote on
 * eval, Wilson 95% CI. `realCap` caps windows per real game (season spread).
 */
export function discriminate(
  simGames: readonly NeutralGame[],
  realGames: readonly NeutralGame[],
  opts: { kind: WindowKind; variant: 'census' | 'core'; seed: string; realCap?: number; strat?: 'clutch' | 'decided' | 'any' }
): JudgeReport {
  const rng = new Rng(`${opts.seed}-judge-${opts.kind}-${opts.variant}`);
  const perGame = opts.kind === 'mid' ? 3 : 1;
  const spec: WindowSpec = { kind: opts.kind, perGame, strat: opts.strat ?? 'any' };
  let rejected = 0;

  const finish = (w: NeutralRow[]): NeutralRow[] | null => {
    if (opts.variant === 'core') {
      const f = coreFilter(w);
      if (f.rejected) { rejected++; return null; }
      return f.rows;
    }
    return w;
  };

  const excerpts: Excerpt[] = [];
  simGames.forEach((g, gi) => {
    for (const w of cutWindows(g.rows, spec, rng)) {
      const rows = finish(w);
      if (rows && rows.length >= 8) excerpts.push({ rows: anonymizeWindow(rows), label: 'sim', game: gi });
    }
  });
  const simN = excerpts.length;
  const realOrder = rng.shuffle(realGames.map((_, i) => i)); // season spread
  const cap = Math.min(opts.realCap ?? 2, perGame);
  for (const gi of realOrder) {
    if (excerpts.length - simN >= simN) break;
    let took = 0;
    for (const w of cutWindows(realGames[gi]!.rows, spec, rng)) {
      if (took >= cap || excerpts.length - simN >= simN) break;
      const rows = finish(w);
      if (rows && rows.length >= 8) { excerpts.push({ rows: anonymizeWindow(rows), label: 'real', game: gi }); took++; }
    }
  }

  // balance sides, then split by game (sibling windows never straddle)
  const sims = excerpts.filter((e) => e.label === 'sim');
  const reals = excerpts.filter((e) => e.label === 'real');
  const n = Math.min(sims.length, reals.length);
  const used = [...sims.slice(0, n), ...reals.slice(0, n)];
  const half = (labels: Excerpt[]): Set<number> => {
    const games = [...new Set(labels.map((e) => e.game))];
    return new Set(rng.shuffle(games).slice(0, Math.ceil(games.length / 2)));
  };
  const simTrain = half(used.filter((e) => e.label === 'sim'));
  const realTrain = half(used.filter((e) => e.label === 'real'));
  const inTrain = (e: Excerpt): boolean => (e.label === 'sim' ? simTrain.has(e.game) : realTrain.has(e.game));
  const train = used.filter(inTrain);
  const evalSet = used.filter((e) => !inTrain(e));

  // learn each feature's cut on train
  const featVals = (e: Excerpt): (number | null)[] => JUDGE_FEATURES.map((f) => f.fn(e.rows));
  const trainVals = train.map((e) => ({ vs: featVals(e), sim: e.label === 'sim' }));
  const cuts: Cut[] = JUDGE_FEATURES.map((_, fi) =>
    learnCut(trainVals.flatMap((t) => (t.vs[fi] === null ? [] : [{ v: t.vs[fi]!, sim: t.sim }]))));

  // weighted majority vote on eval
  let ok = 0;
  let simAsReal = 0;
  let realAsSim = 0;
  const featOk = JUDGE_FEATURES.map(() => 0);
  const featN = JUDGE_FEATURES.map(() => 0);
  for (const e of evalSet) {
    const vs = featVals(e);
    let score = 0;
    vs.forEach((v, fi) => {
      if (v === null) return;
      const c = cuts[fi]!;
      const saysSim = v > c.thr === c.hiIsSim;
      score += (c.acc - 0.5) * (saysSim ? 1 : -1);
      featN[fi]!++;
      if (saysSim === (e.label === 'sim')) featOk[fi]!++;
    });
    const verdict: 'sim' | 'real' = score > 0 ? 'sim' : score < 0 ? 'real' : (rng.int(2) === 0 ? 'sim' : 'real');
    if (verdict === e.label) ok++;
    else if (e.label === 'sim') simAsReal++;
    else realAsSim++;
  }

  const nEval = evalSet.length;
  const nSimEval = evalSet.filter((e) => e.label === 'sim').length;
  return {
    kind: opts.kind, variant: opts.variant, nEval, nTrain: train.length,
    acc: nEval === 0 ? 0 : ok / nEval,
    ci: wilson95(ok, nEval),
    simAsReal: nSimEval === 0 ? 0 : simAsReal / nSimEval,
    realAsSim: nEval - nSimEval === 0 ? 0 : realAsSim / (nEval - nSimEval),
    rejected,
    tells: JUDGE_FEATURES.map((f, fi) => ({
      name: f.name,
      trainAcc: cuts[fi]!.acc,
      evalAcc: featN[fi]! === 0 ? 0.5 : featOk[fi]! / featN[fi]!,
      evalN: featN[fi]!
    }))
  };
}

// ------------------------------------------------------------- gate table

export type Verdict = 'PASS' | 'LOW' | 'HIGH' | 'FAIL';

const inBand = (v: number, lo: number, hi: number): Verdict => (v < lo ? 'LOW' : v > hi ? 'HIGH' : 'PASS');

export interface GateRow {
  id: string; label: string; cls: string;
  corpus: string; sim: string; band: string;
  verdict: Verdict; detail: string;
}

const pct = (x: number, d = 1): string => `${(100 * x).toFixed(d)}%`;
const f1 = (x: number): string => x.toFixed(1);
const f2 = (x: number): string => x.toFixed(2);

/**
 * Assemble the 13-row table. Target bands are the design doc §3's, encoded
 * here once (band widths are the designer's engineering judgment pending the
 * parse-nba distribution re-derivation the doc assigns to the reference
 * pipeline); corpus/sim columns are live-computed by this run.
 */
export function gateTable(real: GateValues, sim: GateValues, t1: JudgeReport, t2: JudgeReport): GateRow[] {
  const rows: GateRow[] = [];
  const push = (id: string, label: string, cls: string, corpus: string, simS: string, band: string,
    verdict: Verdict, detail = ''): void => {
    rows.push({ id, label, cls, corpus, sim: simS, band, verdict, detail });
  };

  const tGate = (id: string, label: string, r: JudgeReport, interim: number): void => {
    // gate on the program-end band (<=55%); the interim milestone is printed.
    // CI lower bound touching 50% is the "indistinguishable" end state.
    const v: Verdict = r.acc <= 0.55 ? 'PASS' : 'HIGH';
    push(id, label, 'S', '50% = indistinguishable',
      `${pct(r.acc)} [${pct(r.ci[0], 0)},${pct(r.ci[1], 0)}] n=${r.nEval}`,
      `end<=55% (interim<=${(interim * 100).toFixed(0)}%)`, v,
      `sim-as-real ${pct(r.simAsReal, 0)}, real-as-sim ${pct(r.realAsSim, 0)}`);
  };
  tGate('T1', 'blind discrimination (census, mid)', t1, 0.70);
  tGate('T2', 'blind discrimination (core, mid)', t2, 0.60);

  {
    const v = sim.g1;
    const c = real.g1;
    const ok = inBand(v.perGame, 8.5, 13);
    const cov = v.q1Cov >= 0.99;
    push('G1', 'timeouts/g; quarters >=1 TO', 'S',
      `${f1(c.perGame)}/g; ${pct(c.q1Cov, 0)}`, `${f1(v.perGame)}/g; ${pct(v.q1Cov, 0)}`,
      '8.5-13/g AND every Q >=1', ok === 'PASS' && cov ? 'PASS' : ok !== 'PASS' ? ok : 'FAIL',
      cov ? '' : 'quarter coverage below 99%');
  }
  {
    const v = sim.g2;
    const c = real.g2;
    const ok = inBand(v.perGame, 6, 11);
    const catsOk = v.catsAtLeast03 >= 5;
    push('G2', 'officiating junk rows/g', 'S',
      `${f1(c.perGame)}/g (${c.catsAtLeast03} cats >=0.3)`, `${f1(v.perGame)}/g (${v.catsAtLeast03} cats >=0.3)`,
      '6-11/g AND >=5 cats >=0.3/g', ok === 'PASS' && catsOk ? 'PASS' : ok !== 'PASS' ? ok : 'FAIL',
      catsOk ? '' : 'category spread too thin');
  }
  {
    const v = sim.g3;
    const c = real.g3;
    const shareOk = v.share8 <= 0.06;
    const medOk = v.median >= 14 && v.median <= 18;
    push('G3', 'Q2-Q4 opener: attack <=8s; median', 'S',
      `${pct(c.share8)}; ${f1(c.median)}s (n=${c.n})`, `${pct(v.share8)}; ${f1(v.median)}s (n=${v.n})`,
      '<=6%; median 14-18s', shareOk && medOk ? 'PASS' : 'FAIL',
      `${shareOk ? '' : 'rushed openers'}${!shareOk && !medOk ? ', ' : ''}${medOk ? '' : 'median off'}`);
  }
  {
    const v = sim.g4;
    const c = real.g4;
    const checks: [string, Verdict][] = [
      ['putback', inBand(v.putback, 0.62, 0.80)], ['quick-3', inBand(v.quick3, 0.20, 0.36)],
      ['FG%', inBand(v.fgPct, 0.46, 0.60)], ['OREB/g', inBand(v.orebPerGame, 19, 26)]
    ];
    const bad = checks.filter(([, x]) => x !== 'PASS');
    push('G4', 'OREB economy (<=6s FGA; 3-share; FG%; OREB/g)', 'S',
      `${pct(c.putback, 0)}; ${pct(c.quick3, 0)}; ${pct(c.fgPct, 0)}; ${f1(c.orebPerGame)}`,
      `${pct(v.putback, 0)}; ${pct(v.quick3, 0)}; ${pct(v.fgPct, 0)}; ${f1(v.orebPerGame)}`,
      '62-80%; 20-36%; 46-60%; 19-26', bad.length === 0 ? 'PASS' : 'FAIL',
      bad.map(([k, x]) => `${k} ${x}`).join(', '));
  }
  {
    const v = sim.g5;
    const c = real.g5;
    const a = inBand(v.perGame, 3.0, 4.9);
    const b = inBand(v.assisted, 0.80, 0.90);
    push('G5', 'unassisted made 3s/g; assisted share', 'S',
      `${f2(c.perGame)}/g; ${pct(c.assisted, 0)}`, `${f2(v.perGame)}/g; ${pct(v.assisted, 0)}`,
      '3.0-4.9/g; 80-90%', a === 'PASS' && b === 'PASS' ? 'PASS' : a !== 'PASS' ? a : 'FAIL',
      b === 'PASS' ? '' : `assisted share ${b}`);
  }
  {
    const v = sim.g6;
    const c = real.g6;
    const rateOk = v.perGame <= 0.3;
    const decidedOk = v.decidedPerGame <= 0.05;
    // The makes clause is report-only below the pool this gate's own design
    // note demands (makes need a >=600-game pool: at a realistic ~3% heave
    // FG% and <=0.3 logged heaves/g, a 48-game run expects ~0.4 makes, so
    // 0 makes is the LIKELY healthy outcome and gating on it fails honest
    // engines). Rate and decided-share stay gated at any n.
    const makesGated = v.att >= 180; // ~600 games at 0.3/g
    const makesOk = !makesGated || v.made > 0;
    push('G6', 'heave economy (>=35ft, last 4s)', 'S',
      `${f2(c.perGame)}/g (${c.made}/${c.att} made); decided ${f2(c.decidedPerGame)}/g`,
      `${f2(v.perGame)}/g (${v.made}/${v.att} made); decided ${f2(v.decidedPerGame)}/g`,
      '<=0.3/g; decided ~0; makes gated at n>=180 att', rateOk && makesOk && decidedOk ? 'PASS' : 'FAIL',
      [rateOk ? '' : 'too many logged heaves', makesOk ? '' : '0 makes at a gated sample',
        makesGated ? '' : `makes ${v.made}/${v.att} (report-only below 180 att)`,
        decidedOk ? '' : 'decided-game heaves'].filter(Boolean).join(', '));
  }
  {
    const v = sim.g7;
    const c = real.g7;
    const shapeOk = v.q4IsMin && v.q4Delta >= 1.5 && v.q4Delta <= 4.5;
    const minOk = inBand(v.min48, 4.4, 6.0) === 'PASS';
    const climbOk = v.ftClimb >= 0.25;
    push('G7', 'Q4 curve (qPts; min-48; FT climb)', 'S',
      `${c.qPts.map((x) => x.toFixed(0)).join('/')}; ${f1(c.min48)}; ${pct(c.ftClimb, 0)}`,
      `${v.qPts.map((x) => x.toFixed(0)).join('/')}; ${f1(v.min48)}; ${pct(v.ftClimb, 0)}`,
      'Q4 min by 1.5-4.5; 4.4-6.0; >=+25%', shapeOk && minOk && climbOk ? 'PASS' : 'FAIL',
      [shapeOk ? '' : `Q4 ${v.q4IsMin ? 'delta off' : 'not the min quarter'}`,
        minOk ? '' : 'min-48 off', climbOk ? '' : 'FT climb flat'].filter(Boolean).join(', '));
  }
  {
    const v = sim.g8;
    const c = real.g8;
    const checks: [string, Verdict][] = [
      ['a', inBand(v.a, 10, 20)], ['b', inBand(v.b, 0.40, 0.75)],
      ['c', inBand(v.c, 0.5, 2.5)], ['d', inBand(v.d, 45, 65)]
    ];
    const bad = checks.filter(([, x]) => x !== 'PASS');
    push('G8', 'sub grammar (a FT-window; b foul-trouble; c live-ball; d volume)', 'S',
      `${f1(c.a)}; ${pct(c.b, 0)} (n=${c.bCases}); ${f2(c.c)}; ${f1(c.d)}`,
      `${f1(v.a)}; ${pct(v.b, 0)} (n=${v.bCases}); ${f2(v.c)}; ${f1(v.d)}`,
      '10-20; 40-75%; 0.5-2.5; 45-65', bad.length === 0 ? 'PASS' : 'FAIL',
      bad.map(([k, x]) => `${k} ${x}`).join(', '));
  }
  {
    const v = sim.g9;
    const c = real.g9;
    const p50Ok = v.p50 >= 2 && v.p50 <= 4;
    const shareOk = v.share1 <= 0.30;
    push('G9', 'rebound cadence (miss->reb dt)', 'S',
      `p50 ${f1(c.p50)}s; <=1s ${pct(c.share1)} (n=${c.n})`,
      `p50 ${f1(v.p50)}s; <=1s ${pct(v.share1)} (n=${v.n})`,
      'p50 2-4s; <=1s share <=30%', p50Ok && shareOk ? 'PASS' : 'FAIL',
      [p50Ok ? '' : 'p50 off', shareOk ? '' : 'instant-rebound spike'].filter(Boolean).join(', '));
  }
  {
    const v = sim.g10;
    const c = real.g10;
    push('G10', 'same-second LIVE clusters', 'S',
      `${pct(c.share)} of pairs`, `${pct(v.share)} of pairs`,
      '2-10% live-pair share', inBand(v.share, 0.02, 0.10));
  }
  {
    const v = sim.g11;
    const c = real.g11;
    const dunksOk = inBand(v.dunks, 7, 13);
    const rimOk = inBand(v.rimShare, 0.135, 0.18);
    const orderOk = v.rimShare > v.paintShare;
    push('G11', 'shot diet (made dunks/g; rim vs paint poss share)', 'S+F',
      `${f1(c.dunks)}/g; rim ${pct(c.rimShare)} > paint ${pct(c.paintShare)}`,
      `${f1(v.dunks)}/g; rim ${pct(v.rimShare)} ${v.rimShare > v.paintShare ? '>' : '<'} paint ${pct(v.paintShare)}`,
      '7-13/g; rim 13.5-18% AND rim>paint',
      dunksOk === 'PASS' && rimOk === 'PASS' && orderOk ? 'PASS' : 'FAIL',
      [dunksOk === 'PASS' ? '' : `dunks ${dunksOk}`, rimOk === 'PASS' ? '' : `rim share ${rimOk}`,
        orderOk ? '' : 'rim/paint INVERTED'].filter(Boolean).join(', '));
  }
  return rows;
}

// ------------------------------------------------------------------- main

/** every flag this CLI reads — the checkFlags vocabulary below. Exported so
 *  the flag-guard test can pin that the allow-list stays in sync with the
 *  reads (this CLI once had no checkFlags at all: a typo'd flag silently
 *  graded the defaults). */
export const FLOWBOARD_CLI_FLAGS: readonly string[] =
  ['--games', '--seed', '--corpus', '--out', '--real-cap'];

const isMain = process.argv[1]?.endsWith('scoreboard.ts');
if (isMain) {
  // declared vocabulary — a typo'd or `=`-spelled flag dies here instead of
  // silently grading the defaults (args.ts checkFlags, audit H-03)
  checkFlags(process.argv, FLOWBOARD_CLI_FLAGS);
  const games = flagNumber(process.argv, '--games', 20);
  // Mirrors cli.ts's REGISTER W13 guard: `--games 0` used to print an
  // all-NaN gate table and exit 0, so a scripted caller checking exit codes
  // saw success on a run that simulated NOTHING. A scoreboard over zero
  // games is a misconfiguration, never a pass — die loudly before
  // simulating anything.
  if (!Number.isInteger(games) || games < 1) {
    console.error(`--games requires an integer >= 1, got ${games} — refusing to grade a run that simulates nothing`);
    process.exit(1);
  }
  const seed = flagValue(process.argv, '--seed', 'flowboard');
  const corpusDir = flagValue(process.argv, '--corpus', 'data/nba/pbp-plays');
  const outFile = flagValue(process.argv, '--out', 'out/scoreboard.json');
  const realCap = flagNumber(process.argv, '--real-cap', 2);

  if (!existsSync(corpusDir)) {
    console.error(`corpus dir not found: ${corpusDir} — the scoreboard is UNMEASURABLE without the real side`);
    process.exit(1);
  }

  console.log(`FLOW scoreboard: ${games} sim games (seed "${seed}") vs committed corpus (${corpusDir})...`);
  const t0 = performance.now();

  const simGames = simNeutralGames(games, seed);
  const corpus = loadCorpus(corpusDir);
  const realGames = corpus.map((g) => realToNeutral(g.plays, g.id));
  const tSim = performance.now();

  const simAgg = aggregateGates(simGames.map(gateStatsForGame));
  const realAgg = aggregateGates(realGames.map(gateStatsForGame));

  const t1 = discriminate(simGames, realGames, { kind: 'mid', variant: 'census', seed, realCap });
  const t2 = discriminate(simGames, realGames, { kind: 'mid', variant: 'core', seed, realCap });
  const variants = [
    t1, t2,
    discriminate(simGames, realGames, { kind: 'quarter', variant: 'census', seed, realCap }),
    discriminate(simGames, realGames, { kind: 'final3', variant: 'census', seed, realCap }),
    discriminate(simGames, realGames, { kind: 'full', variant: 'census', seed, realCap: 1 })
  ];

  const table = gateTable(realAgg, simAgg, t1, t2);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);

  console.log(`(sim+parse ${((tSim - t0) / 1000).toFixed(1)}s, total ${secs}s)\n`);
  console.log(`FLOW PROGRAM SCOREBOARD — 13 gates (fdesign-judge.md §3); corpus n=${realAgg.games}, sim n=${simAgg.games}`);
  const W = [4, 44, 40, 40, 34, 6];
  const line = (c: string[]): string =>
    c.map((s, i) => s.length > W[i]! ? s.slice(0, W[i]! - 1) + '…' : s.padEnd(W[i]!)).join(' ');
  console.log('─'.repeat(W.reduce((a, b) => a + b + 1, 0)));
  console.log(line(['#', 'gate', `corpus (n=${realAgg.games})`, `sim (n=${simAgg.games})`, 'target band', 'verdict']));
  console.log('─'.repeat(W.reduce((a, b) => a + b + 1, 0)));
  for (const r of table) {
    console.log(line([r.id, r.label, r.corpus, r.sim, r.band, r.verdict]));
    if (r.verdict !== 'PASS' && r.detail) console.log(line(['', `  └ ${r.detail}`, '', '', '', '']));
  }
  console.log('─'.repeat(W.reduce((a, b) => a + b + 1, 0)));
  const passed = table.filter((r) => r.verdict === 'PASS').length;
  console.log(`${passed}/13 gates pass\n`);

  console.log('Fair discrimination protocol (statistical judge, held-out games; 50% = indistinguishable):');
  for (const v of variants) {
    console.log(`  ${v.kind.padEnd(8)} ${v.variant.padEnd(7)} acc ${pct(v.acc).padEnd(7)} ` +
      `CI [${pct(v.ci[0], 0)},${pct(v.ci[1], 0)}]  n=${String(v.nEval).padEnd(4)} ` +
      `sim-as-real ${pct(v.simAsReal, 0).padEnd(5)} real-as-sim ${pct(v.realAsSim, 0)}` +
      (v.rejected ? `  (core-rejected ${v.rejected})` : ''));
  }
  const topTells = [...t1.tells].sort((a, b) => b.evalAcc - a.evalAcc).slice(0, 3);
  console.log(`  T1 top tells: ${topTells.map((t) => `${t.name} ${pct(t.evalAcc, 0)}`).join(' · ')}`);
  console.log('\nNote: T1/T2 gate on the program-end band. The statistical judge is the in-repo');
  console.log('instrument; LLM/human panel packs come from `npm run turing` (same schema, same windows).');

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString().slice(0, 10),
    flags: { games, seed, corpus: corpusDir, realCap },
    protocol: 'fdesign-judge.md §2-§3; statistical judge on matched-representation NeutralRows',
    gates: table,
    discrimination: variants,
    values: { sim: simAgg, corpus: realAgg },
    exclusions: {
      sim: simGames.reduce<Record<string, number>>((acc, g) => {
        for (const [k, v] of Object.entries(g.excluded)) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      }, {}),
      real: realGames.reduce<Record<string, number>>((acc, g) => {
        for (const [k, v] of Object.entries(g.excluded)) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      }, {})
    }
  }, null, 1));
  console.log(`\nwrote ${outFile}`);
}
