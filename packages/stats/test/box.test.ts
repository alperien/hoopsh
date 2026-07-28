/**
 * Direct box-score unit tests on a hand-built event stream.
 *
 * The engine's invariant suite exercises boxScore at scale over real games,
 * but nothing pinned its arithmetic against a KNOWN-answer stream, so a
 * miscounted FGA or a flipped plus-minus sign could only be caught
 * indirectly. These tests hand-author a tiny game with exact expected
 * tallies (review gap: stats had no dedicated test/).
 */

import { describe, expect, it } from 'vitest';
import { makePlayer, type GameEvent, type Team } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';

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

// base fields every event carries; `mk` stamps them so each case only states
// what it's testing
let clk = 720;
const mk = (partial: Partial<GameEvent> & { type: GameEvent['type'] }, t: number, score: [number, number]): GameEvent =>
  ({ t, wt: t, period: 1, clock: (clk -= 1), score, ...partial } as GameEvent);

// A tiny but structurally complete first quarter:
//  - h0 hits a 3 assisted by h1
//  - a0 misses a 2, blocked by h4; h2 grabs the defensive board
//  - h2 is stripped by a1 (steal)
//  - a2 is fouled shooting, hits 1 of 2 FTs
const events: GameEvent[] = [
  mk({ type: 'game_start', home: { teamId: 'h', lineup: home.starters }, away: { teamId: 'a', lineup: away.starters } } as Partial<GameEvent> & { type: 'game_start' }, 0, [0, 0]),
  mk({ type: 'possession_start', team: 0, kind: 'tip' } as Partial<GameEvent> & { type: 'possession_start' }, 1, [0, 0]),
  mk({ type: 'shot', team: 0, shooter: 'h0', x: 25, y: 47, distFt: 23.9, zone: 'three', three: true, moveType: 'catch_shoot', contest: 0.2, made: true, points: 3, assist: 'h1' } as Partial<GameEvent> & { type: 'shot' }, 10, [3, 0]),
  mk({ type: 'possession_end', team: 0, outcome: 'made_fg' } as Partial<GameEvent> & { type: 'possession_end' }, 10, [3, 0]),
  mk({ type: 'possession_start', team: 1, kind: 'inbound' } as Partial<GameEvent> & { type: 'possession_start' }, 12, [3, 0]),
  mk({ type: 'shot', team: 1, shooter: 'a0', x: 80, y: 25, distFt: 8, zone: 'paint', three: false, moveType: 'drive', contest: 0.7, made: false, points: 0, blockedBy: 'h4' } as Partial<GameEvent> & { type: 'shot' }, 20, [3, 0]),
  mk({ type: 'rebound', team: 0, player: 'h2', offensive: false, x: 78, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 21, [3, 0]),
  mk({ type: 'possession_end', team: 1, outcome: 'def_rebound' } as Partial<GameEvent> & { type: 'possession_end' }, 21, [3, 0]),
  mk({ type: 'possession_start', team: 0, kind: 'live_rebound' } as Partial<GameEvent> & { type: 'possession_start' }, 22, [3, 0]),
  mk({ type: 'turnover', team: 0, player: 'h2', kind: 'lost_ball', stolenBy: 'a1' } as Partial<GameEvent> & { type: 'turnover' }, 30, [3, 0]),
  mk({ type: 'possession_end', team: 0, outcome: 'turnover' } as Partial<GameEvent> & { type: 'possession_end' }, 30, [3, 0]),
  mk({ type: 'possession_start', team: 1, kind: 'steal' } as Partial<GameEvent> & { type: 'possession_start' }, 31, [3, 0]),
  mk({ type: 'foul', team: 0, on: 'h3', kind: 'shooting', drawnBy: 'a2', personalCount: 1, teamCountInPeriod: 1, inBonus: false, fouledOut: false } as Partial<GameEvent> & { type: 'foul' }, 40, [3, 0]),
  mk({ type: 'free_throw', team: 1, shooter: 'a2', n: 1, of: 2, made: true } as Partial<GameEvent> & { type: 'free_throw' }, 41, [3, 1]),
  mk({ type: 'free_throw', team: 1, shooter: 'a2', n: 2, of: 2, made: false } as Partial<GameEvent> & { type: 'free_throw' }, 42, [3, 1]),
  mk({ type: 'rebound', team: 0, player: 'h4', offensive: false, x: 78, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 43, [3, 1]),
  mk({ type: 'possession_end', team: 1, outcome: 'def_rebound' } as Partial<GameEvent> & { type: 'possession_end' }, 43, [3, 1]),
  mk({ type: 'period_end' } as Partial<GameEvent> & { type: 'period_end' }, 44, [3, 1]),
  mk({ type: 'game_end' } as Partial<GameEvent> & { type: 'game_end' }, 44, [3, 1])
];

describe('box score arithmetic on a known stream', () => {
  const box = boxScore(events, [home, away]);
  const p = (id: string) => box.players.find((x) => x.id === id)!;

  it('final score matches the last event', () => {
    expect(box.teams[0].pts).toBe(3);
    expect(box.teams[1].pts).toBe(1);
  });

  it('a made three counts as FGA, FGM, 3PA, 3PM, and 3 points — once each', () => {
    const h0 = p('h0');
    expect(h0.fga).toBe(1);
    expect(h0.fgm).toBe(1);
    expect(h0.tpa).toBe(1);
    expect(h0.tpm).toBe(1);
    expect(h0.pts).toBe(3);
    expect(h0.zones.three).toEqual({ a: 1, m: 1 });
  });

  it('the assist is credited to the passer, not the shooter', () => {
    expect(p('h1').ast).toBe(1);
    expect(p('h0').ast).toBe(0);
    expect(box.teams[0].ast).toBe(1);
  });

  it('a missed shot is an FGA but not an FGM, and never negative points', () => {
    const a0 = p('a0');
    expect(a0.fga).toBe(1);
    expect(a0.fgm).toBe(0);
    expect(a0.pts).toBe(0);
  });

  it('free throws are separate from field goals (FTA/FTM, +1 pt each make)', () => {
    const a2 = p('a2');
    expect(a2.fta).toBe(2);
    expect(a2.ftm).toBe(1);
    expect(a2.pts).toBe(1);
    expect(a2.fga).toBe(0); // an FT is not an FGA
  });

  it('a block credits the blocker; a steal credits the thief and a TO the loser', () => {
    expect(p('h4').blk).toBe(1);
    expect(p('a1').stl).toBe(1);
    expect(p('h2').tov).toBe(1);
  });

  it('defensive rebounds land as DRB/TRB, not ORB', () => {
    expect(p('h2').drb).toBe(1);
    expect(p('h2').orb).toBe(0);
    expect(p('h2').trb).toBe(1);
  });

  it('plus-minus is zero-sum and signed by who scored', () => {
    // team 0 scored 3 while all five of each side were on the floor, team 1
    // scored 1 the same way: net +2 for every home starter, -2 for every away
    expect(p('h0').plusMinus).toBe(2);
    expect(p('a0').plusMinus).toBe(-2);
    const sum = box.players.reduce((acc, x) => acc + x.plusMinus, 0);
    expect(sum).toBe(0);
  });

  it('minutes accrue only while on the floor and use game-clock time', () => {
    // every starter was on the floor for the whole 44s of game-clock time;
    // box.ts folds exact seconds then quantizes to 0.1-minute display
    // granularity, so 44s -> round(44/60 * 10)/10 = 0.7 min
    expect(p('h0').min).toBe(0.7);
  });

  it('points identity holds per team: PTS = 2·(FGM−3PM) + 3·3PM + FTM', () => {
    for (const t of box.teams) {
      expect(t.pts).toBe(2 * (t.fgm - t.tpm) + 3 * t.tpm + t.ftm);
    }
  });
});

describe('team rebounds in the box score (known stream)', () => {
  // A dead carom awarded to the defense (playerless team rebound), then a
  // FT trip whose missed FIRST attempt logs the dead-ball formality, whose
  // missed FINAL attempt is secured by a player. Official-scoring
  // convention: the team rebound counts in TEAM totals only; the dead-ball
  // formality counts NOWHERE (core/events.ts ReboundEvent).
  const events: GameEvent[] = [
    mk({ type: 'game_start', home: { teamId: 'h', lineup: home.starters }, away: { teamId: 'a', lineup: away.starters } } as Partial<GameEvent> & { type: 'game_start' }, 0, [0, 0]),
    mk({ type: 'possession_start', team: 0, kind: 'tip' } as Partial<GameEvent> & { type: 'possession_start' }, 1, [0, 0]),
    mk({ type: 'shot', team: 0, shooter: 'h0', x: 20, y: 25, distFt: 15, zone: 'mid', three: false, moveType: 'pull_up', contest: 0.4, made: false, points: 0 } as Partial<GameEvent> & { type: 'shot' }, 8, [0, 0]),
    // dead carom out of bounds: DEFENSIVE team rebound, nobody credited
    mk({ type: 'rebound', team: 1, offensive: false, x: 30, y: 10 } as Partial<GameEvent> & { type: 'rebound' }, 9, [0, 0]),
    mk({ type: 'possession_end', team: 0, outcome: 'def_rebound' } as Partial<GameEvent> & { type: 'possession_end' }, 9, [0, 0]),
    mk({ type: 'possession_start', team: 1, kind: 'inbound' } as Partial<GameEvent> & { type: 'possession_start' }, 11, [0, 0]),
    mk({ type: 'foul', team: 0, on: 'h3', kind: 'shooting', drawnBy: 'a0', personalCount: 1, teamCountInPeriod: 1, inBonus: false, fouledOut: false } as Partial<GameEvent> & { type: 'foul' }, 20, [0, 0]),
    mk({ type: 'free_throw', team: 1, shooter: 'a0', n: 1, of: 2, made: false } as Partial<GameEvent> & { type: 'free_throw' }, 21, [0, 0]),
    // the missed-non-final-FT scorekeeping formality; counts in NO totals
    mk({ type: 'rebound', team: 1, offensive: true, deadBall: true, x: 85, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 21, [0, 0]),
    mk({ type: 'free_throw', team: 1, shooter: 'a0', n: 2, of: 2, made: false } as Partial<GameEvent> & { type: 'free_throw' }, 22, [0, 0]),
    // the FINAL miss is a live scramble; a player secures this one
    mk({ type: 'rebound', team: 0, player: 'h4', offensive: false, x: 80, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 23, [0, 0]),
    mk({ type: 'possession_end', team: 1, outcome: 'def_rebound' } as Partial<GameEvent> & { type: 'possession_end' }, 23, [0, 0]),
    mk({ type: 'period_end' } as Partial<GameEvent> & { type: 'period_end' }, 24, [0, 0]),
    mk({ type: 'game_end' } as Partial<GameEvent> & { type: 'game_end' }, 24, [0, 0])
  ];
  const box = boxScore(events, [home, away]);
  const p = (id: string) => box.players.find((x) => x.id === id)!;

  it('a team rebound counts in team totals but on no player line', () => {
    expect(box.teams[1].drb).toBe(1);
    expect(box.teams[1].trb).toBe(1);
    const awayPlayerTrb = box.players.filter((x) => x.team === 1).reduce((acc, x) => acc + x.trb, 0);
    expect(awayPlayerTrb).toBe(0);
  });

  it('the dead-ball FT formality counts in NO rebound totals', () => {
    expect(box.teams[1].orb).toBe(0); // the formality was team 1's only "offensive rebound"
  });

  it('player rebounds still credit both the line and the team totals', () => {
    expect(p('h4').drb).toBe(1);
    expect(box.teams[0].drb).toBe(1);
    expect(box.teams[0].trb).toBe(1);
    expect(box.teams[0].orb).toBe(0);
  });

  it('team TRB identity holds: TRB = ORB + DRB including team rebounds', () => {
    for (const t of box.teams) expect(t.trb).toBe(t.orb + t.drb);
  });
});
