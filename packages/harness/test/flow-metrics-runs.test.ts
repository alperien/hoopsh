/**
 * gameFlow()/reduceFlows() (harness/src/flow-metrics.ts) on hand-built event
 * streams with known answers — 0% function coverage today: the only existing
 * consumer test (flow.test.ts) grades 24-game averages and cannot attribute
 * a wrong counter to a specific rule.
 *
 * Spec sources, cited per test: flow.ts's "Operational definitions" header
 * (lead change / run / drought / clutch window / Q4 comeback / possession
 * length — flow-metrics.ts's own header says the definitions "live THERE";
 * possession lengths are boundary-to-boundary within a period since audit
 * H-05), flow-metrics.ts's rebound-case comment (post release-audit: the
 * PUTBACK base is player+offensive+non-deadBall rebounds and official FGAs
 * only, audit M-49, while SECOND-CHANCE marking is broader — any LIVE
 * offensive rebound marks the possession, team caroms included, audit
 * L-45; scan-stop rules unchanged), and the reduceFlows share-basis
 * comments (b9-F1 pooled denominator). Complements flow-metrics.test.ts
 * (the audit's H-05/M-49/L-45 exhibits, one rule per minimal stream) by
 * grading the same rules folded into integrated streams with full
 * possession bookkeeping. Streams follow the stats/test/box.test.ts mk()
 * convention: every event stamps both time axes plus period/clock/score
 * (AGENTS §1.5), scores move by real basketball increments, and score is
 * AFTER the event.
 *
 * Zero sims; every expected number is hand-derived in a comment.
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@hoopsh/engine';
import { gameFlow, reduceFlows, type GameFlow } from '../src/flow-metrics.js';

type Stamp = { period?: number; clock?: number };
const mk = (
  partial: Partial<GameEvent> & { type: GameEvent['type'] },
  t: number,
  score: [number, number],
  s: Stamp = {}
): GameEvent =>
  ({ t, wt: t, period: s.period ?? 1, clock: s.clock ?? Math.max(0, 720 - t), score, ...partial } as GameEvent);

const shot = (
  team: 0 | 1, made: boolean, t: number, score: [number, number],
  extra: Partial<GameEvent> = {}, s: Stamp = {}
): GameEvent =>
  mk({
    type: 'shot', team, shooter: team === 0 ? 'h1' : 'a1', x: 25, y: 25,
    distFt: 10, zone: 'mid', three: false, moveType: 'pull_up', contest: 0,
    made, points: made ? 2 : 0, ...extra
  } as Partial<GameEvent> & { type: 'shot' }, t, score, s);

const three = (team: 0 | 1, t: number, score: [number, number], s: Stamp = {}): GameEvent =>
  shot(team, true, t, score, { zone: 'three', three: true, distFt: 24, points: 3 } as Partial<GameEvent>, s);

describe('runs, ties, lead changes, droughts (flow.ts operational definitions)', () => {
  // 0-0 -> home 8 straight -> away 10 straight (2,3,3,2) -> home 2. Hand-derived:
  //   runs are maximal unanswered stretches ("an 8-0 inside a 12-0 counts
  //   once"); thresholds are >= (a 10-0 run counts in runs8 AND runs10);
  //   the FIRST score creates a leader silently (no lead change, no tie);
  //   8-8 is a tie entered from a led state; 8-10 is the only leader flip;
  //   10-10 is a second tie (a tie does not clear the remembered leader).
  const events: GameEvent[] = [
    shot(0, true, 10, [2, 0]), shot(0, true, 20, [4, 0]),
    shot(0, true, 30, [6, 0]), shot(0, true, 40, [8, 0]),
    shot(1, true, 50, [8, 2]), three(1, 60, [8, 5]),
    three(1, 70, [8, 8]), shot(1, true, 80, [8, 10]),
    shot(0, true, 90, [10, 10])
  ];
  const f = gameFlow(events);

  it('runs are maximal and thresholds inclusive: 8-0 and 10-0 give runs8=2, runs10=1, maxRun=10', () => {
    expect(f.runs8).toBe(2);
    expect(f.runs10).toBe(1);
    expect(f.maxRun).toBe(10);
  });

  it('lead bookkeeping: 1 lead change, 2 ties, largest lead 8 — first score and tie interludes are not changes', () => {
    expect(f.leadChanges).toBe(1); // only 8-8 -> 8-10; a first-score-counts bug would read 2
    expect(f.ties).toBe(2);        // 8-8 and 10-10
    expect(f.largestLead).toBe(8);
  });

  it('scoring drought tails to the regulation horn (flow.ts: "tip and final horn included as endpoints")', () => {
    // away last scores at t=80 -> 2880-80 = 2800 is its horn-tail drought,
    // longer than any home gap (home last scores t=90 -> 2790)
    expect(f.maxDroughtSec).toBe(2800);
  });

  it('all points land in the period-1 slot of the quarter profile', () => {
    expect(f.qPts).toEqual([20, 0, 0, 0]);
  });
});

describe('OREB base, putbacks, second-chance marking (flow-metrics.ts rebound-case comment)', () => {
  it('the putback base is player OREBs only; any LIVE OREB marks a second chance; dead-ball rows count for nothing', () => {
    // spec: "The putback OREB base is PLAYER offensive rebounds only" but
    // "SECOND-CHANCE marking is broader than the putback base: the corpus
    // marks a possession on any LIVE offensive rebound, team rebounds
    // included" (audit L-45); dead-ball FT formalities "count for NOTHING
    // here" (scan finding b4-1/c3-F1)
    const events: GameEvent[] = [
      // possession 1: live player OREB — enters the base, marks the
      // possession, and the putback 3s later counts
      mk({ type: 'possession_start', team: 0, kind: 'inbound' } as Partial<GameEvent> & { type: 'possession_start' }, 10, [0, 0]),
      shot(0, false, 14, [0, 0]),
      mk({ type: 'rebound', team: 0, player: 'h2', offensive: true, x: 25, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 15, [0, 0]),
      shot(0, true, 18, [2, 0]),
      mk({ type: 'possession_end', team: 0, outcome: 'made_fg' } as Partial<GameEvent> & { type: 'possession_end' }, 19, [2, 0]),
      // possession 2: playerless TEAM offensive rebound, LIVE — outside the
      // putback base, but it marks the possession second-chance (L-45);
      // its inbound fires 2s after the make (the clock ran, see below)
      mk({ type: 'possession_start', team: 1, kind: 'inbound' } as Partial<GameEvent> & { type: 'possession_start' }, 21, [2, 0]),
      shot(1, false, 24, [2, 0]),
      mk({ type: 'rebound', team: 1, offensive: true, x: 25, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 25, [2, 0]),
      shot(1, true, 27, [2, 2]),
      mk({ type: 'possession_end', team: 1, outcome: 'made_fg' } as Partial<GameEvent> & { type: 'possession_end' }, 29, [2, 2]),
      // possession 3: dead-ball FT-formality rebound (playerless, offensive)
      // — excluded from the base AND from marking
      mk({ type: 'possession_start', team: 0, kind: 'inbound' } as Partial<GameEvent> & { type: 'possession_start' }, 29, [2, 2]),
      mk({ type: 'rebound', team: 0, offensive: true, deadBall: true, x: 25, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 30, [2, 2]),
      mk({ type: 'possession_end', team: 0, outcome: 'made_ft' } as Partial<GameEvent> & { type: 'possession_end' }, 31, [2, 2])
    ];
    const f = gameFlow(events);
    expect(f.oreb).toBe(1);             // the player board only (putback base)
    expect(f.putback6).toBe(1);         // shot by rebounding team 3s later
    expect(f.secondChancePoss).toBe(2); // possessions 1 AND 2; dead-ball 3 never marked
    expect(f.poss).toBe(3);
    // possession lengths are boundary-to-boundary within the period (flow.ts
    // definition, audit H-05): the period opener measures from its
    // possession_start (19-10=9); later ones from the PREVIOUS
    // possession_end (29-19=10, 31-29=2). Possession 2's inbound at t=21 is
    // deliberately 2s after the make, so the retired start-to-end read
    // (29-21=8) goes red here
    expect(f.possLens).toEqual([9, 10, 2]);
  });

  it('the putback window is 6 seconds of game clock — a shot 7s later does not count', () => {
    const events: GameEvent[] = [
      shot(0, false, 14, [0, 0]),
      mk({ type: 'rebound', team: 0, player: 'h2', offensive: true, x: 25, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 15, [0, 0]),
      shot(0, true, 22, [2, 0]) // 22 - 15 = 7 > 6
    ];
    const f = gameFlow(events);
    expect(f.oreb).toBe(1);
    expect(f.putback6).toBe(0);
  });

  it('the putback scan stops at a turnover row, and a steal converted within 6s counts for stealScore6 (both scan-stop rules in one honest stream)', () => {
    // spec: "the putback/steal forward scans still STOP on EVERY rebound row
    // (here and in the turnover case)". Home board at t=15, home coughs the
    // ball up, steals it straight back and scores at t=19: without the
    // turnover stop, that made shot (4s after the board) would read as a
    // putback. With it: putback6 0, and the steal-back converts within 6s.
    const events: GameEvent[] = [
      shot(0, false, 14, [0, 0]),
      mk({ type: 'rebound', team: 0, player: 'h2', offensive: true, x: 25, y: 25 } as Partial<GameEvent> & { type: 'rebound' }, 15, [0, 0]),
      mk({ type: 'turnover', team: 0, player: 'h2', kind: 'out_of_bounds' } as Partial<GameEvent> & { type: 'turnover' }, 16, [0, 0]),
      mk({ type: 'turnover', team: 1, player: 'a1', kind: 'bad_pass', stolenBy: 'h3' } as Partial<GameEvent> & { type: 'turnover' }, 17, [0, 0]),
      shot(0, true, 19, [2, 0])
    ];
    const f = gameFlow(events);
    expect(f.oreb).toBe(1);
    expect(f.putback6).toBe(0);    // scan stopped at the t=16 turnover
    expect(f.steals).toBe(1);      // only the stolenBy turnover counts
    expect(f.stealScore6).toBe(1); // thief's side scored 2s later
  });
});

describe('steals and conversion window (flow-metrics.ts turnover case)', () => {
  it('a turnover without stolenBy is not a steal; a conversion 7s later or a miss does not count as stealScore6', () => {
    const events: GameEvent[] = [
      // no stolenBy -> not a steal at all
      mk({ type: 'turnover', team: 0, player: 'h1', kind: 'shot_clock' } as Partial<GameEvent> & { type: 'turnover' }, 10, [0, 0]),
      // steal converted too late (7s)
      mk({ type: 'turnover', team: 0, player: 'h1', kind: 'lost_ball', stolenBy: 'a2' } as Partial<GameEvent> & { type: 'turnover' }, 20, [0, 0]),
      shot(1, true, 27, [0, 2]),
      // steal followed by a MISS within the window — only made shots convert
      mk({ type: 'turnover', team: 0, player: 'h1', kind: 'bad_pass', stolenBy: 'a3' } as Partial<GameEvent> & { type: 'turnover' }, 40, [0, 2]),
      shot(1, false, 43, [0, 2])
    ];
    const f = gameFlow(events);
    expect(f.steals).toBe(2);
    expect(f.stealScore6).toBe(0);
  });
});

describe('clutch window (flow.ts: "Q4, game clock <= 2:00, margin within 5 BEFORE the scoring event")', () => {
  it('gates on period=final, clock<=120, and the PRE-EVENT margin; free-throw points split out', () => {
    const events: GameEvent[] = [
      // establishes prev [10,8]; clock 200 > 120 -> outside the window
      shot(0, true, 2680, [10, 8], {}, { period: 4, clock: 200 }),
      three(0, 2740, [13, 8], { period: 4, clock: 140 }),                  // clock 140 > 120
      shot(0, true, 2750, [15, 8], {}, { period: 4, clock: 130 }),        // clock 130 > 120
      shot(0, true, 2770, [17, 8], {}, { period: 4, clock: 110 }),        // clock ok, but prev margin 7 > 5 — the margin gate
      three(1, 2775, [17, 11], { period: 4, clock: 105 }),                 // prev margin 9 > 5
      three(1, 2780, [17, 14], { period: 4, clock: 100 }),                 // prev margin 6 > 5
      shot(0, true, 2800, [19, 14], {}, { period: 4, clock: 80 }),        // prev margin 3 <= 5 -> CLUTCH +2
      mk({ type: 'free_throw', team: 0, shooter: 'h1', n: 1, of: 1, made: true } as Partial<GameEvent> & { type: 'free_throw' },
        2810, [20, 14], { period: 4, clock: 70 })                          // prev margin 5 <= 5 -> CLUTCH +1 (FT)
    ];
    const f = gameFlow(events);
    expect(f.hadClutch).toBe(true);
    expect(f.clutchPts).toBe(3);
    expect(f.clutchFTPts).toBe(1);
    expect(f.qPts).toEqual([0, 0, 0, 34]); // every point above is Q4
  });

  it('a tight finish in period 3 is NOT clutch under the NBA shape (final regulation period only)', () => {
    const events: GameEvent[] = [
      shot(0, true, 1500, [2, 0], {}, { period: 3, clock: 100 }) // margin/clock qualify, period does not
    ];
    expect(gameFlow(events).hadClutch).toBe(false);
  });

  it('under an NCAA 2x20 shape the SECOND HALF is the final period: same events flip hadClutch with the reg argument (gameFlow JSDoc)', () => {
    // spec: gameFlow JSDoc — "the 'Q4' metrics ... actually mean 'the final
    // regulation period' — under an NCAA pack (2x20) that's the second half"
    const events: GameEvent[] = [
      shot(0, true, 500, [2, 0], {}, { period: 1, clock: 300 }),
      shot(1, true, 600, [2, 2], {}, { period: 1, clock: 200 }),
      shot(0, true, 2300, [4, 2], {}, { period: 2, clock: 100 }) // prev margin 0, clock 100
    ];
    const ncaa = gameFlow(events, { periods: 2, periodMinutes: 20 });
    expect(ncaa.hadClutch).toBe(true);
    expect(ncaa.qPts).toEqual([4, 2, 0, 0]); // halves fill only the first two slots
    // identical stream under the default NBA shape: period 2 is mid-game
    expect(gameFlow(events).hadClutch).toBe(false);
  });
});

describe('overtime and the final-period lead metrics', () => {
  it('OT points belong to no quarter slot and OT scoring does not extend regulation droughts (flow-metrics.ts:93-98)', () => {
    // spec: qPts comment — "OT points belong to no quarter profile";
    // drought comment — "droughts (regulation only)" + tail to the horn
    const events: GameEvent[] = [
      shot(0, true, 2800, [2, 0], {}, { period: 4, clock: 80 }),
      shot(0, true, 2980, [4, 0], {}, { period: 5, clock: 200 }) // overtime
    ];
    const f = gameFlow(events);
    expect(f.qPts).toEqual([0, 0, 0, 2]); // the regulation basket sits in the Q4 slot
    expect(f.qPts[0] + f.qPts[1] + f.qPts[2] + f.qPts[3]).toBe(2); // 2 of the 4 pts fell outside regulation
    // away never scored: its drought spans all of regulation (2880s); the
    // home OT bucket at t=2980 must not have reset home's clock either way
    expect(f.maxDroughtSec).toBe(2880);
  });

  it('led10InQ4 requires the 10+ margin AT a final-period scoring event; losing afterwards flags the comeback (flow.ts: "Q4 comeback")', () => {
    const buildup = [
      shot(0, true, 100, [2, 0]), shot(0, true, 200, [4, 0]),
      shot(0, true, 300, [6, 0]), shot(0, true, 400, [8, 0]),
      shot(0, true, 500, [10, 0]) // margin 10 — but in period 1, so no flag
    ];
    // A: leads by 12 in Q4, then loses -> comeback
    const lost = gameFlow([
      ...buildup,
      shot(0, true, 2200, [12, 0], {}, { period: 4, clock: 680 }),
      three(1, 2300, [12, 3], { period: 4, clock: 580 }),
      three(1, 2400, [12, 6], { period: 4, clock: 480 }),
      three(1, 2500, [12, 9], { period: 4, clock: 380 }),
      three(1, 2600, [12, 12], { period: 4, clock: 280 }),
      three(1, 2700, [12, 15], { period: 4, clock: 180 })
    ]);
    expect(lost.led10InQ4).toBe(true);
    expect(lost.led10InQ4Lost).toBe(true);
    // B: same Q4 lead, holds on -> no comeback
    const held = gameFlow([
      ...buildup,
      shot(0, true, 2200, [12, 0], {}, { period: 4, clock: 680 })
    ]);
    expect(held.led10InQ4).toBe(true);
    expect(held.led10InQ4Lost).toBe(false);
    // C: the 10+ margin existed only in period 1 -> never flagged
    const early = gameFlow([
      ...buildup,
      shot(1, true, 2200, [10, 2], {}, { period: 4, clock: 680 })
    ]);
    expect(early.led10InQ4).toBe(false);
    expect(early.largestLead).toBe(10); // the lead was real, just not in Q4
  });
});

describe('and-ones and possession bookkeeping', () => {
  it('counts shots whose foul carries andOne: true, not every shooting foul (flow-metrics.ts shot case)', () => {
    const events: GameEvent[] = [
      shot(0, true, 10, [2, 0], { foul: { by: 'a2', ftAwarded: 1, andOne: true } } as Partial<GameEvent>),
      shot(0, false, 20, [2, 0], { foul: { by: 'a3', ftAwarded: 2, andOne: false } } as Partial<GameEvent>)
    ];
    expect(gameFlow(events).andOnes).toBe(1);
  });

  it('a possession_end without a matching start still counts the possession but fabricates no length (flow.ts possession-length definition)', () => {
    // spec: boundary-to-boundary (H-05) — an orphan end has no previous
    // in-period boundary AND no possession_start to fall back to, so no
    // length is recorded (the possStart -1 sentinel guards the push)
    const events: GameEvent[] = [
      mk({ type: 'possession_end', team: 0, outcome: 'turnover' } as Partial<GameEvent> & { type: 'possession_end' }, 30, [0, 0])
    ];
    const f = gameFlow(events);
    expect(f.poss).toBe(1);
    expect(f.possLens).toEqual([]);
  });
});

describe('reduceFlows share bases (flow-metrics.ts:233-245)', () => {
  function mkFlow(over: Partial<GameFlow> = {}): GameFlow {
    return {
      leadChanges: 0, ties: 0, largestLead: 0, runs8: 0, runs10: 0, maxRun: 0,
      maxDroughtSec: 0, qPts: [0, 0, 0, 0], clutchPts: 0, clutchFTPts: 0,
      hadClutch: false, led10InQ4Lost: false, led10InQ4: false, possLens: [],
      oreb: 0, putback6: 0, steals: 0, stealScore6: 0, andOnes: 0,
      secondChancePoss: 0, poss: 0, ...over
    };
  }

  it('putbackShare and stealConvShare are ratios of per-game AVERAGES, zero-guarded', () => {
    // avg(putback6)=2 over avg(oreb)=3 -> 2/3; avg(stealScore6)=1.5 over avg(steals)=3 -> 0.5
    const r = reduceFlows([
      mkFlow({ oreb: 4, putback6: 2, steals: 4, stealScore6: 1 }),
      mkFlow({ oreb: 2, putback6: 2, steals: 2, stealScore6: 2 })
    ]);
    expect(r.putbackShare).toBeGreaterThanOrEqual(2 / 3 - 1e-12);
    expect(r.putbackShare).toBeLessThanOrEqual(2 / 3 + 1e-12);
    expect(r.stealConvShare).toBe(0.5);
    // zero-denominator guards return 0, not NaN
    const zero = reduceFlows([mkFlow(), mkFlow()]);
    expect(zero.putbackShare).toBe(0);
    expect(zero.stealConvShare).toBe(0);
    expect(zero.secondChanceShare).toBe(0);
  });

  it('secondChanceShare pools BOTH teams over BOTH teams\' possessions — not the retired per-team half denominator (b9-F1 fix comment)', () => {
    // spec: "numerator and denominator on the same basis ... The retired
    // version divided by poss/2 ... and printed ~2x the reference"
    const r = reduceFlows([
      mkFlow({ secondChancePoss: 20, poss: 200 }),
      mkFlow({ secondChancePoss: 25, poss: 180 })
    ]);
    const pooled = 22.5 / 190;
    expect(r.secondChanceShare).toBeGreaterThanOrEqual(pooled - 1e-12);
    expect(r.secondChanceShare).toBeLessThanOrEqual(pooled + 1e-12);
    expect(r.secondChanceShare).toBeLessThan(2 * pooled); // the retired 2x basis would fail here
  });

  it('clutchFTShare averages per-game ratios over games that HAD clutch points; clutchGames counts them', () => {
    // spec: reduceFlows — clutch = flows with hadClutch && clutchPts > 0;
    // (0.5 + 0.75) / 2 = 0.625
    const r = reduceFlows([
      mkFlow({ hadClutch: true, clutchPts: 10, clutchFTPts: 5 }),
      mkFlow({ hadClutch: true, clutchPts: 0, clutchFTPts: 0 }), // scoreless window: excluded
      mkFlow({ hadClutch: false }),
      mkFlow({ hadClutch: true, clutchPts: 4, clutchFTPts: 3 })
    ]);
    expect(r.clutchGames).toBe(2);
    expect(r.clutchFTShare).toBe(0.625);
  });

  it('comebackRate is lost-after-leading over games with a Q4 10+ lead', () => {
    const r = reduceFlows([
      mkFlow({ led10InQ4: true, led10InQ4Lost: true }),
      mkFlow({ led10InQ4: true, led10InQ4Lost: false }),
      mkFlow() // never led by 10 in Q4: outside the base
    ]);
    expect(r.led10Games).toBe(2);
    expect(r.comebackRate).toBe(0.5);
  });

  it('possession-length stats pool every game\'s possLens; the 0-8s and 16s+ shares are INCLUSIVE at their boundaries', () => {
    // pooled sorted lens [4, 8, 10, 16, 20]: p50 slot floor(5/2)=2 -> 10;
    // <=8 catches {4, 8}; >=16 catches {16, 20}
    const r = reduceFlows([
      mkFlow({ possLens: [8, 20] }),
      mkFlow({ possLens: [10, 16, 4] })
    ]);
    expect(r.possP50).toBe(10);
    expect(r.possShare0to8).toBe(2 / 5);
    expect(r.possShare16plus).toBe(2 / 5);
  });

  it('plain metrics are per-game means and qPts averages slot-wise', () => {
    const r = reduceFlows([
      mkFlow({ andOnes: 3, leadChanges: 6, qPts: [10, 0, 0, 0] }),
      mkFlow({ andOnes: 1, leadChanges: 2, qPts: [20, 4, 0, 0] })
    ]);
    expect(r.games).toBe(2);
    expect(r.andOnes).toBe(2);
    expect(r.leadChanges).toBe(4);
    expect(r.qPts).toEqual([15, 2, 0, 0]);
  });
});
