/**
 * Spec-derived tests for @hoopsh/stats' derived helpers — fgPct/tpPct/ftPct/
 * tsPct/efgPct/ortg/orbPct — and BoxScoreOptions.paceMinutes.
 *
 * Expectations come from the derived-helpers section header and per-function
 * JSDoc in packages/stats/src/box.ts (standard basketball-analytics formulas;
 * "each guards its own zero-attempt case so an 0-for-0 shooter/team reads as
 * 0% rather than NaN") and from the BoxScoreOptions/pace JSDoc. These helpers
 * are exported with zero direct tests (findings/spec-consumers.md UNCOVERED
 * entries; coverage baseline: box.ts lines 440-476 unexecuted).
 *
 * Exact rationals (dyadic fractions like 1/2, 3/4, 1/8) are pinned with toBe;
 * non-exact values are bracketed with >=/<= per the shim's matcher surface.
 */

import { describe, expect, it } from 'vitest';
import { makePlayer, type GameEvent, type Team } from '@hoopsh/engine';
import { boxScore, efgPct, fgPct, ftPct, orbPct, ortg, tpPct, tsPct, type TeamTotals } from '@hoopsh/stats';

// Inline fixture per repo convention (no shared test helpers exist — the
// box.test.ts team() factory, copied):
function team(prefix: string, name: string): Team {
  const pos = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const players = Array.from({ length: 5 }, (_, i) =>
    makePlayer({ id: `${prefix}${i}`, name: `${name} ${i}`, pos: pos[i] })
  );
  return {
    id: prefix, name, abbrev: prefix.toUpperCase(),
    players, starters: players.map((p) => p.id),
    tactics: { pace: 50, threeBias: 50, helpAggr: 50 }
  };
}

const home = team('h', 'Home');
const away = team('a', 'Away');

// ortg/orbPct are declared against full TeamTotals (they are team-rate
// helpers); build the honest full shape and override only the fields a case
// is about.
function totals(partial: Partial<TeamTotals>): TeamTotals {
  return {
    side: 0, teamId: 't',
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    poss: 0, fastbreakPts: 0, timeouts: 0,
    ...partial
  };
}

describe('shooting percentage helpers (spec: box.ts derived-helpers JSDoc)', () => {
  it('fgPct is makes over attempts', () => {
    // spec: standard FG% definition (box.ts derived section header)
    expect(fgPct({ fgm: 1, fga: 2 })).toBe(0.5);
    expect(fgPct({ fgm: 3, fga: 4 })).toBe(0.75);
    expect(fgPct({ fgm: 5, fga: 5 })).toBe(1);
  });

  it('a 0-for-0 line reads 0, not NaN, from every percentage helper', () => {
    // spec: box.ts derived section header — "an 0-for-0 shooter/team reads as
    // 0% rather than NaN (silent NaN propagation into a league-average report
    // is exactly the kind of bug this module exists to prevent)".
    expect(fgPct({ fgm: 0, fga: 0 })).toBe(0);
    expect(tpPct({ tpm: 0, tpa: 0 })).toBe(0);
    expect(ftPct({ ftm: 0, fta: 0 })).toBe(0);
    expect(tsPct({ pts: 0, fga: 0, fta: 0 })).toBe(0);
    expect(efgPct({ fgm: 0, tpm: 0, fga: 0 })).toBe(0);
  });

  it('tpPct and ftPct follow the same makes/attempts shape', () => {
    // spec: standard 3P% / FT% definitions (box.ts derived section header)
    expect(tpPct({ tpm: 2, tpa: 5 })).toBe(0.4);
    expect(ftPct({ ftm: 9, fta: 12 })).toBe(0.75);
  });

  it('efgPct credits a made three as 1.5 makes', () => {
    // spec: box.ts efgPct JSDoc — "(fgm + 0.5·tpm) / fga … the standard eFG%
    // definition"; example from findings/spec-consumers.md.
    expect(efgPct({ fgm: 4, tpm: 2, fga: 10 })).toBe(0.5);
    // with no threes it degenerates to plain FG%
    expect(efgPct({ fgm: 5, tpm: 0, fga: 10 })).toBe(0.5);
    // a perfect three-point night exceeds 1.0 — the standard definition has
    // no clamp (2-for-2, both threes: (2 + 1) / 2)
    expect(efgPct({ fgm: 2, tpm: 2, fga: 2 })).toBe(1.5);
  });

  it('tsPct is pts / (2·(fga + 0.44·fta)) with the REAL 0.44 FT weighting', () => {
    // spec: box.ts tsPct JSDoc — the standard TS% definition; 0.44 is REAL
    // provenance ("not tuned by this codebase"), so the formula is pinnable.
    // With no FTs the denominator is exactly 2·fga (dyadic, exact):
    expect(tsPct({ pts: 20, fga: 20, fta: 0 })).toBe(0.5);
    // Full formula, same arithmetic shape as the documented definition:
    expect(tsPct({ pts: 31, fga: 20, fta: 10 })).toBe(31 / (2 * (20 + 0.44 * 10)));
    // 31 / 48.8 ≈ 0.63525 — bracket the non-exact value
    expect(tsPct({ pts: 31, fga: 20, fta: 10 })).toBeGreaterThan(0.6352);
    expect(tsPct({ pts: 31, fga: 20, fta: 10 })).toBeLessThan(0.6353);
  });

  it('tsPct is nonzero for an FT-only scorer (guard is on the true-attempt denominator, not fga)', () => {
    // spec: box.ts tsPct — denom is 2·(fga + 0.44·fta); a 0-FGA player with
    // FTAs has a real denominator. 2 / (2·0.88) ≈ 1.1364. Would go red if the
    // zero guard were "simplified" to fga === 0.
    const v = tsPct({ pts: 2, fga: 0, fta: 2 });
    expect(v).toBeGreaterThan(1.13);
    expect(v).toBeLessThan(1.14);
  });
});

describe('team rate helpers ortg / orbPct (spec: box.ts JSDoc)', () => {
  it('ortg is points per 100 possessions', () => {
    // spec: box.ts ortg JSDoc — "points scored per 100 possessions"
    expect(ortg(totals({ pts: 100, poss: 80 }))).toBe(125);
    expect(ortg(totals({ pts: 50, poss: 100 }))).toBe(50);
  });

  it('ortg guards zero possessions with 0', () => {
    // spec: findings/spec-consumers.md "ortg = pts/poss×100 with 0-poss→0
    // guard" (box.ts:479-481)
    expect(ortg(totals({ pts: 12, poss: 0 }))).toBe(0);
  });

  it('orbPct is own ORB over the contested pool own-ORB + opp-DRB', () => {
    // spec: box.ts orbPct JSDoc — "own offensive boards over … own-ORB +
    // opp-DRB", needs BOTH sides' totals. Decoy fields (own.drb, opp.orb)
    // pinned high so reading the wrong side goes red.
    const own = totals({ orb: 10, drb: 999 });
    const opp = totals({ orb: 999, drb: 30 });
    expect(orbPct(own, opp)).toBe(0.25);
    // perfect offensive-glass game: opp never secured a defensive board
    expect(orbPct(totals({ orb: 4 }), totals({ drb: 0 }))).toBe(1);
  });

  it('orbPct guards a zero contested pool with 0', () => {
    // spec: findings/spec-consumers.md "orbPct … with 0-denominator→0"
    expect(orbPct(totals({ orb: 0 }), totals({ drb: 0 }))).toBe(0);
  });
});

describe('helpers compose with boxScore output, and BoxScoreOptions.paceMinutes sets the pace basis', () => {
  // Hand-built known stream (the sanctioned consumer-test technique — see
  // box.test.ts and AGENTS.md §2.3: stats folds events, tests must not
  // re-derive game logic). Both time axes + period/clock/score stamped per
  // core/events.ts Base.
  let clk = 720;
  const mk = (partial: Partial<GameEvent> & { type: GameEvent['type'] }, t: number, score: [number, number]): GameEvent =>
    ({ t, wt: t, period: 1, clock: (clk -= 1), score, ...partial } as GameEvent);

  // 4 possessions (2 per side) across 120 game-clock seconds:
  //  h0 makes two 2s; a0 makes a 3, then misses a 2 rebounded by h2.
  const events: GameEvent[] = [
    mk({ type: 'game_start', home: { teamId: 'h', lineup: home.starters }, away: { teamId: 'a', lineup: away.starters } } as Partial<GameEvent> & { type: 'game_start' }, 0, [0, 0]),
    mk({ type: 'possession_start', team: 0, kind: 'tip' } as Partial<GameEvent> & { type: 'possession_start' }, 1, [0, 0]),
    mk({ type: 'shot', team: 0, shooter: 'h0', x: 88, y: 25, distFt: 3, zone: 'rim', three: false, moveType: 'drive', contest: 0.3, made: true, points: 2 } as Partial<GameEvent> & { type: 'shot' }, 20, [2, 0]),
    mk({ type: 'possession_end', team: 0, outcome: 'made_fg' } as Partial<GameEvent> & { type: 'possession_end' }, 20, [2, 0]),
    mk({ type: 'possession_start', team: 1, kind: 'inbound' } as Partial<GameEvent> & { type: 'possession_start' }, 21, [2, 0]),
    mk({ type: 'shot', team: 1, shooter: 'a0', x: 25, y: 47, distFt: 24, zone: 'three', three: true, moveType: 'catch_shoot', contest: 0.2, made: true, points: 3 } as Partial<GameEvent> & { type: 'shot' }, 50, [2, 3]),
    mk({ type: 'possession_end', team: 1, outcome: 'made_fg' } as Partial<GameEvent> & { type: 'possession_end' }, 50, [2, 3]),
    mk({ type: 'possession_start', team: 0, kind: 'inbound' } as Partial<GameEvent> & { type: 'possession_start' }, 51, [2, 3]),
    mk({ type: 'shot', team: 0, shooter: 'h0', x: 80, y: 25, distFt: 9, zone: 'paint', three: false, moveType: 'pull_up', contest: 0.4, made: true, points: 2 } as Partial<GameEvent> & { type: 'shot' }, 80, [4, 3]),
    mk({ type: 'possession_end', team: 0, outcome: 'made_fg' } as Partial<GameEvent> & { type: 'possession_end' }, 80, [4, 3]),
    mk({ type: 'possession_start', team: 1, kind: 'inbound' } as Partial<GameEvent> & { type: 'possession_start' }, 81, [4, 3]),
    mk({ type: 'shot', team: 1, shooter: 'a0', x: 20, y: 25, distFt: 15, zone: 'mid', three: false, moveType: 'pull_up', contest: 0.5, made: false, points: 0 } as Partial<GameEvent> & { type: 'shot' }, 110, [4, 3]),
    mk({ type: 'rebound', team: 0, player: 'h2', offensive: false, x: 22, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 111, [4, 3]),
    mk({ type: 'possession_end', team: 1, outcome: 'def_rebound' } as Partial<GameEvent> & { type: 'possession_end' }, 111, [4, 3]),
    mk({ type: 'period_end' } as Partial<GameEvent> & { type: 'period_end' }, 120, [4, 3]),
    mk({ type: 'game_end' } as Partial<GameEvent> & { type: 'game_end' }, 120, [4, 3])
  ];

  const box = boxScore(events, [home, away]);
  const p = (id: string) => box.players.find((x) => x.id === id)!;

  it('poss folds one increment per possession_end, per team', () => {
    // spec: box.ts fold write map — "possession_end: totals.poss (the ONLY
    // poss increment)"; 2 possession_end events per side above.
    expect(box.teams[0].poss).toBe(2);
    expect(box.teams[1].poss).toBe(2);
    expect(box.periods).toBe(1); // "period_end: periods" — one period_end
  });

  it('pace = (totalPoss/2) · (paceMinutes / gameMinutes), default 48-minute basis', () => {
    // spec: boxScore pace JSDoc — possessions per team per paceMinutes
    // (default 48) of game clock; gameMinutes from the last event's t.
    // 4 poss over 120 s (2 min): (4/2)·(48/2) = 48 exactly.
    expect(box.pace).toBe(48);
    // spec: BoxScoreOptions JSDoc — a league-aware caller passes its own
    // regulation length; same stream on a 40-minute basis: (4/2)·(40/2) = 40.
    expect(boxScore(events, [home, away], { paceMinutes: 40 }).pace).toBe(40);
  });

  it('an empty event stream folds to zero pace, zero periods — never NaN', () => {
    // spec: boxScore pace JSDoc — "Math.max(1, …) guards against a division
    // by zero if this were ever called on a zero-length/empty event stream".
    const empty = boxScore([], [home, away]);
    expect(empty.pace).toBe(0);
    expect(empty.periods).toBe(0);
    expect(empty.finalScore).toEqual([0, 0]);
  });

  it('percentage helpers accept a PlayerLine and team-rate helpers accept folded TeamTotals', () => {
    // spec: box.ts derived section header — "applied uniformly whether the
    // caller passes team totals or … a single player's line".
    expect(fgPct(p('h0'))).toBe(1);          // 2-for-2
    expect(fgPct(p('a0'))).toBe(0.5);        // 1-for-2
    expect(efgPct(p('a0'))).toBe(0.75);      // (1 + 0.5·1) / 2
    expect(ortg(box.teams[0])).toBe(200);    // 4 pts / 2 poss · 100
    expect(ortg(box.teams[1])).toBe(150);    // 3 pts / 2 poss · 100
  });
});
