/**
 * Aggregation math (harness/src/aggregate.ts) on hand-built box summaries —
 * the layer every batch/sweep verdict flows through, previously covered only
 * indirectly by many-game integration runs (realism/parallel).
 *
 * Spec sources, cited per test: aggregate.ts's file header (two team-games
 * per box), the Accumulator/finalize doc comments (the three divisor
 * conventions), the evaluate() comment (NaN fails loudly, inclusive bounds),
 * and bands.ts:37-40 (metric-name wiring). Fixtures are synthetic
 * TeamGameSummary objects (the season.test.ts mkTotals pattern) with numbers
 * chosen so each divisor convention produces a DIFFERENT answer than its
 * rival convention would — a test that cannot tell pooled from mean-of-means
 * apart proves nothing.
 *
 * SWEPT discipline (AGENTS.md DO-NOT #1): no band VALUES or band COUNT are
 * pinned — bands.ts owns those. Zero sims.
 */
import { describe, expect, it } from 'vitest';
import type { TeamTotals } from '@hoopsh/stats';
import {
  accumulate, emptyAcc, evaluate, finalize, formatReport, mergeAcc,
  type LeagueAverages, type TeamGameSummary
} from '../src/aggregate.js';
import { NBA_BANDS } from '../src/bands.js';

// all-zero team line to override per test (season.test.ts mkTotals shape)
function mkTotals(side: 0 | 1, over: Partial<TeamTotals> = {}): TeamTotals {
  return {
    side, teamId: side === 0 ? 'h' : 'a', pts: 0, fgm: 0, fga: 0, tpm: 0,
    tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, trb: 0, ast: 0, stl: 0, blk: 0,
    tov: 0, pf: 0, poss: 0, fastbreakPts: 0, timeouts: 0, ...over
  };
}

function mkBox(pace: number, t0: Partial<TeamTotals>, t1: Partial<TeamTotals>): TeamGameSummary {
  return { teams: [mkTotals(0, t0), mkTotals(1, t1)], pace };
}

describe('accumulate: one box = TWO team-games', () => {
  it('games advances by 2, counting stats sum both sides, pace/orbPct/ortg are captured once PER SIDE (aggregate.ts header + accumulate JSDoc)', () => {
    // spec: "each simulated GAME contributes TWO team-games ... a 100-game
    // batch run produces 200 team-games' worth of signal"; getting it wrong
    // halves `games` and skews any raw-count metric 2x
    const acc = emptyAcc();
    const box = mkBox(100, // pace enters ONCE PER SIDE -> paceSum 200
      { pts: 110, fga: 90, fgm: 45, orb: 10, drb: 30, tov: 12, poss: 100 },
      { pts: 100, fga: 88, fgm: 40, orb: 10, drb: 30, tov: 14, poss: 100 });
    accumulate(acc, box);
    expect(acc.games).toBe(2);
    expect(acc.pts).toBe(210);
    expect(acc.fga).toBe(178);
    expect(acc.fgm).toBe(85);
    expect(acc.tov).toBe(26);
    expect(acc.poss).toBe(200);
    expect(acc.paceSum).toBe(200);
    // orbPct per side needs the OPPONENT's totals (accumulate JSDoc):
    // side0 10/(10+30) + side1 10/(10+30) = 0.25 + 0.25
    expect(acc.orbPctSum).toBe(0.5);
    // ortg per side: 110/100*100 + 100/100*100
    expect(acc.ortgSum).toBe(210);

    accumulate(acc, box); // folding a second game keeps summing
    expect(acc.games).toBe(4);
    expect(acc.pts).toBe(420);
  });
});

describe('finalize: the three divisor conventions (finalize JSDoc)', () => {
  it('fgPct pools makes over attempts (volume-weighted) — NOT the mean of per-game percentages', () => {
    // spec: finalize JSDoc — "naively averaging each game's fgPct would let
    // a team's one blowout 2-of-20 shooting night pull the season average
    // down disproportionately". Volumes differ across the two boxes so the
    // two conventions disagree: pooled 32/100 = 0.32, mean-of-pcts 0.425.
    const acc = emptyAcc();
    accumulate(acc, mkBox(100, { fgm: 6, fga: 10 }, { fgm: 6, fga: 10 }));   // 0.60 nights
    accumulate(acc, mkBox(100, { fgm: 10, fga: 40 }, { fgm: 10, fga: 40 })); // 0.25 nights
    const f = finalize(acc);
    expect(f.fgPct).toBeGreaterThanOrEqual(0.3199);
    expect(f.fgPct).toBeLessThanOrEqual(0.3201);
    // a mean-of-means implementation would report 0.425 here
    expect(f.fgPct).toBeLessThan(0.4);
  });

  it('tpaShare/tpPct/ftPct follow the same pooled convention; astdShare is ast over made FGs', () => {
    // spec: finalize JSDoc bullet 3 + astdShare comment ("every assist marks
    // exactly one assisted made FG, so league assisted share is directly
    // ast/fgm")
    const acc = emptyAcc();
    accumulate(acc, mkBox(100,
      { fga: 40, fgm: 20, tpa: 10, tpm: 5, fta: 20, ftm: 15, ast: 12 },
      { fga: 60, fgm: 20, tpa: 30, tpm: 5, fta: 5, ftm: 1, ast: 8 }));
    const f = finalize(acc);
    expect(f.tpaShare).toBe(40 / 100); // (10+30)/(40+60), not mean(0.25, 0.5)
    expect(f.tpPct).toBe(10 / 40);
    expect(f.ftPct).toBe(16 / 25);     // (15+1)/(20+5), not mean(0.75, 0.2)
    expect(f.astdShare).toBe(20 / 40); // (12+8)/(20+20)
  });

  it('pace and ortg are means of per-game values, NOT recomputed from grand totals (Accumulator JSDoc: "mean of means")', () => {
    // spec: Accumulator doc — pace/ortg/orbPct "can't just be
    // summed-then-divided from raw counts ... the 'average game's pace'
    // treats each game equally rather than weighting long games more".
    // Numbers chosen so the rival convention disagrees: mean-of-per-side
    // ortg = (100+100+150+90)/4 = 110; pooled pts/poss would be
    // 410/380*100 = 107.89...
    const acc = emptyAcc();
    accumulate(acc, mkBox(100, { pts: 100, poss: 100 }, { pts: 100, poss: 100 }));
    accumulate(acc, mkBox(96, { pts: 120, poss: 80 }, { pts: 90, poss: 100 }));
    const f = finalize(acc);
    expect(f.pace).toBe(98);   // (100+100+96+96)/4
    expect(f.ortg).toBe(110);
    expect(f.ortg).not.toBe((410 / 380) * 100);
  });

  it('counting stats divide by team-games (per-game averages)', () => {
    const acc = emptyAcc();
    accumulate(acc, mkBox(100, { pts: 120, trb: 44, stl: 8 }, { pts: 100, trb: 40, stl: 6 }));
    const f = finalize(acc);
    // one box = 2 team-games, so per-game means divide the both-sides sums by 2
    expect(f.pts).toBe(110); // (120+100)/2
    expect(f.trb).toBe(42);  // (44+40)/2
    expect(f.stl).toBe(7);   // (8+6)/2
  });

  it('a zero-game accumulator finalizes to all-zero averages, never NaN (finalize JSDoc: Math.max(1, games) guard)', () => {
    // spec: "a zero-game batch reads back as all-zero averages rather than
    // NaN-poisoning every downstream band check"
    const f = finalize(emptyAcc());
    for (const v of Object.values(f)) {
      expect(v).toBe(0);
    }
  });
});

describe('mergeAcc (mergeAcc JSDoc: component-wise addition then finalize matches single-accumulator results)', () => {
  it('merge equals single-accumulator folding: exactly for count sums, to within one float reassociation ulp for the *Sum fields', () => {
    // spec: mergeAcc doc — "The merge itself is EXACT ... component-wise
    // addition followed by finalize() gives the identical LeagueAverages as
    // accumulating everything into one Accumulator from the start."
    // FINDING (see the it.todo below): that claim holds exactly for the
    // integer counting sums, but the pre-averaged *Sum fields are float
    // additions and merge reassociates them — (a1+a2)+(b1+b2) vs
    // ((a1+a2)+b1)+b2 — so bit-identity is NOT guaranteed, only 1-ulp
    // agreement. This test pins the true property.
    const box1 = mkBox(100, { pts: 110, fga: 90, fgm: 45, orb: 8, drb: 32, poss: 99 }, { pts: 104, fga: 88, fgm: 41, orb: 11, drb: 30, poss: 98 });
    const box2 = mkBox(95, { pts: 96, fga: 84, fgm: 38, orb: 12, drb: 28, poss: 91 }, { pts: 99, fga: 86, fgm: 40, orb: 9, drb: 33, poss: 92 });
    const a = emptyAcc(); accumulate(a, box1);
    const b = emptyAcc(); accumulate(b, box2);
    const combined = emptyAcc(); accumulate(combined, box1); accumulate(combined, box2);
    const merged = mergeAcc(a, b);
    // integer-sum fields: bit-exact
    const floatFields = new Set(['paceSum', 'orbPctSum', 'ortgSum']);
    for (const k of Object.keys(combined) as (keyof typeof combined)[]) {
      if (!floatFields.has(k)) expect(merged[k]).toBe(combined[k]);
    }
    // float-sum fields: equal up to reassociation
    for (const k of ['paceSum', 'orbPctSum', 'ortgSum'] as const) {
      expect(Math.abs(merged[k] - combined[k])).toBeLessThan(1e-9);
    }
  });

  // SPEC-VS-IMPL DISAGREEMENT (reported upstream, not committed as a failing
  // test): mergeAcc's JSDoc says the merge is "EXACT" / gives "the identical
  // LeagueAverages", and names that exactness as the wiring condition for a
  // sharded reducer. Verified counterexample: with the box1/box2 fixture
  // above, mergeAcc(a, b).orbPctSum differs from the single-accumulator
  // orbPctSum in the last ulp (…556 vs …557) because float addition is not
  // associative. A sharded consumer wanting worker-count-invariant digits
  // (the flow-metrics.ts header's standard) cannot get them from this merge;
  // the doc should claim exactness for count fields only.
  it.todo('mergeAcc *Sum fields are bit-identical to single-accumulator folding (doc\'s "EXACT" claim — currently false by one ulp)');
});

describe('evaluate: band checks', () => {
  it('band bounds are INCLUSIVE on both edges (evaluate: pass = value >= lo && value <= hi)', () => {
    const avgs: LeagueAverages = { games: 2, pace: 0 };
    const band = { metric: 'pace', label: 'Pace', lo: 95, hi: 103.5 };
    const at = (v: number) => evaluate({ ...avgs, pace: v }, [band])[0]!.pass;
    expect(at(95)).toBe(true);        // exactly lo passes
    expect(at(103.5)).toBe(true);     // exactly hi passes
    expect(at(94.9)).toBe(false);
    expect(at(103.6)).toBe(false);
  });

  it('a metric missing from the averages FAILS LOUDLY as NaN (evaluate JSDoc: "a typo\'d or not-yet-wired metric name FAILS")', () => {
    // spec: evaluate doc comment — `?? NaN` plus NaN comparisons being false
    // is the deliberate loud-failure mechanism
    const res = evaluate({ games: 0 }, [{ metric: 'ghost', label: 'Ghost', lo: 0, hi: 1 }])[0]!;
    expect(Number.isNaN(res.value)).toBe(true);
    expect(res.pass).toBe(false);
  });

  it('NBA_BANDS wiring: every metric matches a finalize() key, rails are ordered, metrics unique (bands.ts:37-40)', () => {
    // spec: bands.ts — "every metric here must have a matching key there or
    // evaluate() reads NaN and the band always fails loudly". Structure
    // only: band VALUES and the band COUNT are bands.ts's own (AGENTS §2.1
    // "the list grows").
    const known = Object.keys(finalize(emptyAcc()));
    for (const b of NBA_BANDS) {
      expect(known).toContain(b.metric);
      expect(b.lo).toBeLessThanOrEqual(b.hi);
    }
    expect(new Set(NBA_BANDS.map((b) => b.metric)).size).toBe(NBA_BANDS.length);
  });
});

describe('formatReport grammar (formatReport JSDoc: aligned OK/FAIL table, pct hint formatting)', () => {
  it('renders pass counts, OK/FAIL rows, and formats pct bands as x100 with one decimal', () => {
    const results = evaluate(
      { games: 2, pace: 98.04, fgPct: 0.5 },
      [
        { metric: 'pace', label: 'Pace (poss/48 per team)', lo: 95, hi: 103.5 },
        { metric: 'fgPct', label: 'FG%', lo: 0.44, hi: 0.495, pct: true }
      ]
    );
    const report = formatReport(results);
    expect(report).toContain('Realism acceptance report — 1/2 bands passing');
    expect(report).toContain(' OK ');
    expect(report).toContain('FAIL');
    expect(report).toContain('50.0%');  // pct band: x100, one decimal, % suffix
    expect(report).toContain('44.0% – 49.5%'); // pct formatting applies to the target range too
    expect(report).toContain('98.0');   // non-pct value: plain one-decimal
    expect(report).toContain('Pace (poss/48 per team)');
  });
});
