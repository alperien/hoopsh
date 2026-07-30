/**
 * Judgment-instrument tests: the fair-protocol neutral schema (turing.ts) and
 * the 13-gate scoreboard arithmetic (scoreboard.ts).
 *
 * The load-bearing property is fairness by construction: a sim event and a
 * real bbref text row describing the same play must normalize to rows that
 * render byte-identically through the one shared template, pinned below as
 * a unit test, because the whole redesign exists to remove the two-generator
 * format term from the discrimination measurement. The rest pins the honest-
 * exclusion ledger (symmetric drops, counted), the loud-failure contract on
 * degenerate input, and the scoreboard's arithmetic (known-input gate stats,
 * Wilson intervals, threshold learning).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng, simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import {
  anonymizeWindow, coreFilter, cutWindows, loadCorpus, realToNeutral, renderNeutral, simToNeutral,
  type NeutralRow, type RealPlayRow
} from '../src/turing.js';
import {
  aggregateGates, countPossessions, gateStatsForGame, learnCut, rebMissDeltas,
  sameSecPairs, subAfterMakeCount, wilson95
} from '../src/scoreboard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(HERE, '..', '..', '..', 'data', 'nba', 'pbp-plays');

/** the full judge-visible row taxonomy (census) */
const CENSUS_TYPES = new Set(['shot', 'ft', 'reb', 'tov', 'foul', 'sub', 'timeout', 'jump', 'violation', 'replay']);
/** types a SIM stream produces — the full census since the officiating
 *  vocabulary went live (ffit-officiating): violation/replay/mid-game jump
 *  rows are now sim-producible too */
const SIM_TYPES = new Set(['shot', 'ft', 'reb', 'tov', 'foul', 'sub', 'timeout', 'jump', 'violation', 'replay']);

const base = { t: 100, wt: 120, period: 2, clock: 400, score: [23, 20] as [number, number] };
const ev = (over: Record<string, unknown>): GameEvent => ({ ...base, ...over } as unknown as GameEvent);

describe('neutral mapper round-trip', () => {
  it('a committed corpus game normalizes without crashing, all rows in taxonomy', () => {
    const games = loadCorpus(CORPUS_DIR);
    expect(games.length).toBeGreaterThanOrEqual(100);
    const g = realToNeutral(games[0]!.plays, games[0]!.id);
    expect(g.rows.length).toBeGreaterThan(300);
    for (const r of g.rows) expect(CENSUS_TYPES.has(r.type)).toBe(true);
    // the real side's period markers are dropped-and-counted (>= 4 quarters)
    expect(g.excluded['real.periodMarker']).toBeGreaterThanOrEqual(4);
    expect(g.excluded['real.unparsed'] ?? 0).toBe(0);
  });

  it('a sim game normalizes; row types stay inside the census taxonomy', () => {
    const { home, away } = sampleMatchup();
    const r = simulateGame({ seed: 'scoreboard-test-1', home, away, collectFrames: false });
    const g = simToNeutral(r.events);
    expect(g.rows.length).toBeGreaterThan(300);
    for (const row of g.rows) expect(SIM_TYPES.has(row.type)).toBe(true);
    // symmetric-exclusion ledger: pass/possession/period markers counted, never silent
    expect(g.excluded['sim.pass']).toBeGreaterThan(0);
    expect(g.excluded['sim.possessionMarker']).toBeGreaterThan(0);
    expect(g.excluded['sim.periodMarker']).toBeGreaterThanOrEqual(8);
  });

  it('degenerate input fails LOUDLY (unparse abort threshold), never quietly thins', () => {
    const junk: RealPlayRow[] = Array.from({ length: 50 }, (_, i) => ({
      q: 1, clockSec: 700 - i, side: 'h', text: `totally not basketball row ${i}`, a: 0, h: 0
    }));
    expect(() => realToNeutral(junk, 'degenerate')).toThrow(/unparse rate/);
  });
});

describe('corpus-validated mapping conventions (both sides identical)', () => {
  it('a fouled MISS drops the sim shot row (bbref logs no FGA), counted', () => {
    const g = simToNeutral([
      ev({ type: 'shot', team: 0, shooter: 's1', x: 10, y: 25, distFt: 3, zone: 'rim', three: false, moveType: 'drive', contest: 0.5, made: false, points: 0, foul: { by: 'd1', ftAwarded: 2, andOne: false } }),
      ev({ type: 'foul', team: 1, on: 'd1', kind: 'shooting', drawnBy: 's1', personalCount: 1, teamCountInPeriod: 1, inBonus: false, fouledOut: false })
    ]);
    expect(g.rows.length).toBe(1);
    expect(g.rows[0]!.type).toBe('foul');
    expect(g.excluded['sim.fouledMissShotRow']).toBe(1);
  });

  it('an offensive-foul turnover emits the bbref PAIR, foul row first', () => {
    const g = simToNeutral([
      ev({ type: 'turnover', team: 0, player: 'p1', kind: 'off_foul' }),
      ev({ type: 'foul', team: 0, on: 'p1', kind: 'offensive', drawnBy: 'd1', personalCount: 2, teamCountInPeriod: 1, inBonus: false, fouledOut: false })
    ]);
    expect(g.rows.map((r) => r.type)).toEqual(['foul', 'tov']);
    expect(g.rows[0]!.foul!.klass).toBe('offensive');
    expect(g.rows[1]!.tov!.sub).toBe('offfoul');
  });

  it('dead-ball formality rebounds keep their TEAM row (bbref logs the same)', () => {
    const g = simToNeutral([
      ev({ type: 'rebound', team: 0, offensive: true, deadBall: true, x: 5, y: 25 })
    ]);
    expect(g.rows[0]!.actor).toBe('TEAM');
    expect(g.rows[0]!.reb!.off).toBe(true);
  });

  it('real foul rows flip to the FOULING side, so the ensuing FTs read coherently', () => {
    // bbref logs personal/shooting fouls in the fouled team's column; the
    // neutral row must carry the fouler's side (the sim convention)
    const g = realToNeutral([
      { q: 2, clockSec: 300, side: 'h', text: 'Shooting foul by A. Defender (drawn by B. Shooter)', a: 10, h: 12 },
      { q: 2, clockSec: 300, side: 'h', text: 'B. Shooter makes free throw 1 of 2', a: 10, h: 13 }
    ], 'conv');
    expect(g.rows[0]!.side).toBe('B'); // fouler opposite the 'h' column
    expect(g.rows[1]!.side).toBe('A'); // shooter in his own column
  });
});

describe('fairness by construction: one renderer, byte-identical output', () => {
  it('equivalent sim events and real text rows render to identical strings', () => {
    const sim = simToNeutral([
      ev({ type: 'shot', team: 0, shooter: 's1', x: 10, y: 40, distFt: 25.7, zone: 'three', three: true, moveType: 'catch_shoot', contest: 0.2, made: true, points: 3, assist: 's2' }),
      ev({ type: 'timeout', team: 1, reason: 'stop_run', remaining: 5, clock: 380 }),
      ev({ type: 'rebound', team: 1, offensive: false, x: 30, y: 10, clock: 361 })
    ]);
    const real = realToNeutral([
      { q: 2, clockSec: 400, side: 'h', text: 'J. Tatum makes 3-pt jump shot from 26 ft (assist by D. White)', a: 20, h: 23 },
      { q: 2, clockSec: 380, side: 'a', text: 'Cleveland full timeout', a: 20, h: 23 },
      { q: 2, clockSec: 361, side: 'a', text: 'Defensive rebound by Team', a: 20, h: 23 }
    ], 'pair');
    const simTxt = anonymizeWindow(sim.rows).map((r) => renderNeutral(r));
    const realTxt = anonymizeWindow(real.rows).map((r) => renderNeutral(r));
    expect(simTxt).toEqual(realTxt);
    expect(simTxt[0]).toBe('[Q2 6:40] A1 makes 3-pt from 26 ft (assist A2) (23-20)');
    expect(simTxt[1]).toBe('[Q2 6:20] timeout B');
    expect(simTxt[2]).toBe('[Q2 6:01] B TEAM defensive rebound');
  });

  it('anonymization: first-appearing side becomes A and score slots follow', () => {
    const real = realToNeutral([
      { q: 3, clockSec: 500, side: 'a', text: 'L. James makes 2-pt layup from 2 ft', a: 50, h: 44 },
      { q: 3, clockSec: 480, side: 'h', text: 'J. Tatum makes 2-pt layup from 3 ft', a: 50, h: 46 }
    ], 'anon');
    const rows = anonymizeWindow(real.rows);
    // away ('B' at map time) appears first -> relabeled 'A', scores swapped to match
    expect(rows[0]!.side).toBe('A');
    expect(rows[0]!.score).toEqual([50, 44]);
    expect(rows[1]!.side).toBe('B');
    expect(rows[1]!.score).toEqual([50, 46]);
    expect(rows[0]!.actor).toBe('A1');
    expect(rows[1]!.actor).toBe('B1');
  });

  it('core filter drops vocabulary rows (counted) and rejects tech-FT windows', () => {
    const real = realToNeutral([
      { q: 2, clockSec: 500, side: 'h', text: 'Instant Replay (Challenge: Ruling Stands)', a: 10, h: 10 },
      { q: 2, clockSec: 490, side: 'h', text: 'Violation by N. Claxton (kicked ball)', a: 10, h: 10 },
      { q: 2, clockSec: 480, side: 'h', text: 'J. Tatum makes 2-pt layup from 3 ft', a: 10, h: 12 },
      { q: 2, clockSec: 470, side: 'a', text: 'D. Mitchell makes technical free throw', a: 11, h: 12 }
    ], 'core');
    const f = coreFilter(real.rows);
    expect(f.rejected).toBeTruthy(); // technical FT is a score-bearing unmappable
    expect(f.dropped['core.replay']).toBe(1);
    expect(f.dropped['core.violation']).toBe(1);
    expect(f.rows.some((r) => r.type === 'replay' || r.type === 'violation')).toBe(false);
    expect(f.rows.some((r) => r.type === 'shot')).toBe(true);
  });
});

describe('window cutter (one implementation, both sides)', () => {
  const rows: NeutralRow[] = [];
  for (let q = 1; q <= 4; q++) {
    for (let i = 0; i < 60; i++) {
      rows.push({
        q, clock: 720 - i * 12, side: i % 2 === 0 ? 'A' : 'B', actor: `p${i % 7}`, type: 'shot',
        shot: { pts: 2, made: i % 3 === 0, distFt: 10, assist: null, block: null },
        score: i % 3 === 0 ? [i, i] : null
      });
    }
  }

  it('mid windows: exact length, Q2-Q3 only, deterministic for a fixed seed', () => {
    const a = cutWindows(rows, { kind: 'mid', len: 14, perGame: 3 }, new Rng('w1'));
    const b = cutWindows(rows, { kind: 'mid', len: 14, perGame: 3 }, new Rng('w1'));
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
    for (const w of a) {
      expect(w.length).toBe(14);
      for (const r of w) expect(r.q === 2 || r.q === 3).toBe(true);
    }
  });

  it('final3 windows carry only Q4 rows at or under 3:00', () => {
    const w = cutWindows(rows, { kind: 'final3' }, new Rng('w2'));
    expect(w.length).toBe(1);
    for (const r of w[0]!) {
      expect(r.q).toBe(4);
      expect(r.clock).toBeLessThanOrEqual(180);
    }
  });
});

describe('scoreboard arithmetic pins', () => {
  it('wilson95 matches the reference implementation values', () => {
    const [lo, hi] = wilson95(90, 100);
    expect(Math.abs(lo - 0.8262)).toBeLessThan(0.001); // tools/parse-nba.mjs rounds to .826
    expect(Math.abs(hi - 0.9448)).toBeLessThan(0.001);
    expect(wilson95(0, 0)).toEqual([0, 1]);
    const [l2, h2] = wilson95(30, 60); // p=.5 at the judge's quick-run scale
    expect(l2).toBeGreaterThan(0.37);
    expect(h2).toBeLessThan(0.63);
  });

  it('learnCut finds a separating threshold with the right direction', () => {
    const cut = learnCut([
      { v: 0.9, sim: true }, { v: 0.8, sim: true }, { v: 1.0, sim: true },
      { v: 0.1, sim: false }, { v: 0.2, sim: false }, { v: 0.0, sim: false }
    ]);
    expect(cut.acc).toBe(1);
    expect(cut.hiIsSim).toBe(true);
    expect(cut.thr).toBeGreaterThan(0.2);
    expect(cut.thr).toBeLessThan(0.8);
    const inv = learnCut([
      { v: 0.1, sim: true }, { v: 0.2, sim: true },
      { v: 0.8, sim: false }, { v: 0.9, sim: false }
    ]);
    expect(inv.acc).toBe(1);
    expect(inv.hiIsSim).toBe(false);
  });

  it('gate stats on a hand-built game hit exact known values', () => {
    const mk = (over: Partial<NeutralRow>): NeutralRow => ({
      q: 1, clock: 600, side: 'A', actor: 'x1', type: 'shot',
      shot: { pts: 2, made: false, distFt: 10, assist: null, block: null }, score: null, ...over
    } as NeutralRow);
    const rows: NeutralRow[] = [
      // miss -> player rebound 1s apart (quick), then miss -> rebound 3s apart
      mk({ clock: 600 }),
      mk({ clock: 599, type: 'reb', actor: 'x2', side: 'B', reb: { off: false }, shot: undefined }),
      mk({ clock: 500, side: 'B', actor: 'x3' }),
      mk({ clock: 497, type: 'reb', actor: 'x4', side: 'A', reb: { off: true }, shot: undefined }),
      // putback attempt 2s after the OREB, made 3 (assisted) for G4/G5
      mk({ clock: 495, side: 'A', actor: 'x5', shot: { pts: 3, made: true, distFt: 24, assist: 'x4', block: null }, score: [3, 0] }),
      // live same-second pair: turnover + shot in the same second
      mk({ clock: 400, type: 'tov', side: 'B', actor: 'x6', tov: { live: true, steal: 'x7', sub: 'lostball' }, shot: undefined }),
      mk({ clock: 400, side: 'A', actor: 'x7', shot: { pts: 2, made: true, distFt: 1, assist: null, block: null }, score: [5, 0] }),
      // sub 1s after that make -> live-ball sub (G8c)
      mk({ clock: 399, type: 'sub', actor: 'x9', sub: { in: 'x9', out: 'x1' }, shot: undefined }),
      // two timeouts in Q1
      mk({ clock: 300, type: 'timeout', actor: 'TEAM', shot: undefined }),
      mk({ clock: 200, type: 'timeout', actor: 'TEAM', side: 'B', shot: undefined })
    ];
    const s = gateStatsForGame({ rows, excluded: {}, madeDunks: 2 });
    expect(s.timeouts).toBe(2);
    expect(s.qWith1).toBe(1);
    expect(s.qWith2).toBe(1);
    expect(s.rebDeltas).toEqual([1, 3]);
    expect(s.orebPlayer).toBe(1);
    expect(s.putbackAtt).toBe(1);
    expect(s.putback3).toBe(1);
    expect(s.putbackMade).toBe(1);
    expect(s.made3).toBe(1);
    expect(s.made3Assisted).toBe(1);
    expect(s.subAfterMake).toBe(1);
    expect(s.sameSecLive).toBe(1);
    expect(s.madeDunks).toBe(2);
    expect(s.madeRim).toBe(1); // the 1-ft make
    const agg = aggregateGates([s]);
    expect(agg.g1.perGame).toBe(2);
    expect(agg.g9.share1).toBe(0.5);
    expect(agg.g5.assisted).toBe(1);
  });

  it('shared measurement helpers agree with the pinned fixture', () => {
    const rows: NeutralRow[] = [
      { q: 1, clock: 100, side: 'A', actor: 'a', type: 'shot', shot: { pts: 2, made: true, distFt: 5, assist: null, block: null }, score: [2, 0] },
      { q: 1, clock: 99, side: 'A', actor: 'b', type: 'sub', sub: { in: 'b', out: 'c' }, score: null }
    ];
    expect(subAfterMakeCount(rows, false)).toBe(1);
    expect(subAfterMakeCount([{ ...rows[0]!, q: 4, clock: 100 }, { ...rows[1]!, q: 4, clock: 99 }], true)).toBe(0);
    expect(sameSecPairs(rows)).toEqual([0, 0]); // a sub row is not a live row
    expect(rebMissDeltas(rows)).toEqual([]);
  });

  it('possession counter tracks the committed corpus within tolerance', () => {
    const games = loadCorpus(CORPUS_DIR);
    // the committed derived metrics carry parse-nba's own possession counts
    const corpusJson = JSON.parse(
      readFileSync(path.resolve(CORPUS_DIR, '..', 'pbp-corpus.json'), 'utf8')
    ) as { games: { id: string; poss: { n: number } }[] };
    for (const g of games.slice(0, 3)) {
      const reference = corpusJson.games.find((x) => x.id === g.id)!.poss.n;
      const mine = countPossessions(realToNeutral(g.plays, g.id).rows);
      // +-6% covers the definitional edge cases (and-one detection via clock
      // proximity, OT boundaries) without letting the counter drift silently
      expect(Math.abs(mine - reference) / reference).toBeLessThan(0.06);
    }
  });
});
