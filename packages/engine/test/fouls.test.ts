/**
 * sim/fouls.ts — recordFoul bookkeeping and the enterFreeThrows setup path.
 *
 * Spec sources: fouls.ts:22-49 (FoulOutcome contract, incl. the techFT
 * rider), fouls.ts:51-126 (offensive fouls are personal-only, the
 * bump-then-lookup bonus ordering, foul-out replacement, the after-whistle
 * technical draw), fouls.ts:130-256 (dead ball, windup cleared, pack-derived
 * FT line, freeze, shooter protection), events.ts:70-93 (FoulKind — the
 * technical's snapshot-not-increment semantics), events.ts:357-391
 * (FoulEvent fields), rules/rulepack.ts (thresholds — read from the NBA
 * pack, never written as literals).
 *
 * The officiating wave put a live rng draw after every recordFoul whistle
 * (techPerFoulWhistle 0.017), so unit states pin each arm deterministically
 * rather than at the fitted rate's mercy (the officiating.test.ts
 * forced-rate idiom): bookkeeping tests zero the rate (the fouls.ts:96-98
 * gate short-circuits and the stream stays untouched), rider tests force it
 * to 1. officiating.test.ts owns the end-to-end tech emission and consumer
 * chain; ncaa-rules.test.ts owns bonusFreeThrowAward arithmetic and
 * one-and-one sequencing; invariants.test.ts owns the team-foul
 * reset/monotonic chain. This file pins the per-call unit contract those
 * suites only reach end-to-end. States are hand-built (concede.test.ts
 * doctrine) with the fields recordFoul/enterFreeThrows/checkSubs/swapPlayers
 * read.
 */

import { describe, expect, it } from 'vitest';
import {
  NBA, Rng, bonusFreeThrowAward, makeCourt, makePlayer, withParams,
  type GameEvent, type Position, type SimParams
} from '@hoopsh/engine';
import { enterFreeThrows, recordFoul } from '../src/sim/fouls.js';
import type { Agent, GameState, Phase } from '../src/sim/state.js';

const P = withParams();
const court = makeCourt(NBA);

// Deterministic tech-rider arms (see header). ZEROTECH pins the bookkeeping
// with no rider interleaved; FORCETECH pins the rider itself on every whistle.
const ZEROTECH = withParams({ officiating: { techPerFoulWhistle: 0 } });
const FORCETECH = withParams({ officiating: { techPerFoulWhistle: 1 } });

interface AgentSpec {
  id: string;
  side: 0 | 1;
  pos?: Position;
  x?: number;
  y?: number;
  fouls?: number;
  energy?: number;
  onCourt?: boolean;
  fouledOut?: boolean;
  intent?: string;
  /** freeThrow rating — the tech-rider shooter pick reads it (fouls.ts:118-123) */
  ft?: number;
}

function mkAgent(o: AgentSpec): Agent {
  return {
    p: makePlayer({ id: o.id, pos: o.pos ?? 'SF', attr: o.ft !== undefined ? { freeThrow: o.ft } : {} }),
    side: o.side,
    pos: { x: o.x ?? 47, y: o.y ?? 25 },
    vel: { x: 0, y: 0 },
    energy: o.energy ?? 100,
    secondsPlayed: 0,
    fouls: o.fouls ?? 0,
    onCourt: o.onCourt ?? true,
    fouledOut: o.fouledOut ?? false,
    // parked well before the tip so the churn floor (subs.ts subMinBenchSec,
    // read by the legacy full entry pass) never blocks a fixture bench body
    lastSwapT: -999,
    target: { x: o.x ?? 47, y: o.y ?? 25 },
    intent: o.intent ?? 'defend',
    sprinting: false,
    spotKey: null,
    manId: null
  } as unknown as Agent;
}

/**
 * 5v5 state (optionally with bench) carrying the slices recordFoul and
 * enterFreeThrows read: rules/params/court, foul counters, emit's stamp
 * fields, teams/lineup/agents for checkSubs and replaceFouledOut, ball and
 * pendingRelease for the dead-ball reset, and the rng the after-whistle
 * technical draw spends (fouls.ts:105-107).
 */
function mkState(o?: {
  teamFouls?: [number, number];
  teamFoulsLate?: [number, number];
  benchIds?: string[];
  params?: SimParams;
  seed?: string;
}): { s: GameState; agents: Map<string, Agent> } {
  const agents = new Map<string, Agent>();
  const homeIds: string[] = [];
  const awayIds: string[] = [];
  for (let i = 1; i <= 5; i++) {
    agents.set(`h${i}`, mkAgent({ id: `h${i}`, side: 0 }));
    homeIds.push(`h${i}`);
    agents.set(`a${i}`, mkAgent({ id: `a${i}`, side: 1 }));
    awayIds.push(`a${i}`);
  }
  for (const id of o?.benchIds ?? []) {
    agents.set(id, mkAgent({ id, side: 0, onCourt: false }));
  }
  const roster = (ids: string[], benchIds: string[] = []) =>
    [...ids, ...benchIds].map((id) => agents.get(id)!.p);
  const s = {
    params: o?.params ?? ZEROTECH,
    rules: NBA, court,
    period: 1, clock: 480, t: 100, wallT: 140, score: [10, 12],
    teamFoulsPeriod: o?.teamFouls ?? [0, 0],
    teamFoulsLate: o?.teamFoulsLate ?? [0, 0],
    conceded: [false, false],
    teams: [
      { id: 'h', starters: [...homeIds], players: roster(homeIds, o?.benchIds ?? []) },
      { id: 'a', starters: [...awayIds], players: roster(awayIds) }
    ],
    lineup: [homeIds, awayIds],
    agents,
    rng: new Rng(o?.seed ?? 'fouls-unit'),
    ball: { holderId: 'h1', pos: { x: 47, y: 25 }, flight: null },
    pendingRelease: { shooterId: 'h1', moveType: 'pull_up', releaseAt: 101, contest0: 0.3 },
    phase: { kind: 'live' },
    events: [] as GameEvent[]
  } as unknown as GameState;
  return { s, agents };
}

const lastEvent = (s: GameState): GameEvent => s.events[s.events.length - 1]!;

describe('recordFoul (fouls.ts:62-126)', () => {
  it('a defensive foul bumps personal AND team-period counts and stamps the full foul event', () => {
    const { s, agents } = mkState({ teamFouls: [2, 0] });
    const fouler = agents.get('h3')!;
    const victim = agents.get('a2')!;
    const out = recordFoul(s, fouler, 'reach', victim);
    expect(fouler.fouls).toBe(1);
    expect(s.teamFoulsPeriod[0]).toBe(3);
    expect(out).toEqual({ fouledOut: false, inBonus: false, bonus: null, techFT: null });
    // exactly one event: the zeroed tech gate rides no second foul row
    expect(s.events.length).toBe(1);
    const e = lastEvent(s);
    expect(e.type).toBe('foul');
    if (e.type !== 'foul') return;
    expect(e.team).toBe(0);
    expect(e.on).toBe('h3');
    expect(e.kind).toBe('reach');
    expect(e.drawnBy).toBe('a2');
    expect(e.personalCount).toBe(1);
    expect(e.teamCountInPeriod).toBe(3);
    expect(e.inBonus).toBe(false);
    expect(e.fouledOut).toBe(false);
    // emit stamps time/score context (state.ts:433-446)
    expect(e.t).toBe(100);
    expect(e.clock).toBe(480);
    expect(e.score).toEqual([10, 12]);
  });

  it('an offensive foul is personal-only: the team-period count never moves and no shots can result', () => {
    // fouls.ts:70-79 — countsTeam gate; events.ts:70-93; the known
    // simplification applies the NBA rule under every pack
    const { s, agents } = mkState({ teamFouls: [9, 0] }); // deep in the bonus
    const fouler = agents.get('h4')!;
    const out = recordFoul(s, fouler, 'offensive');
    expect(s.teamFoulsPeriod[0]).toBe(9);
    expect(out.bonus).toBe(null);
    expect(out.techFT).toBe(null);
    const e = lastEvent(s);
    if (e.type !== 'foul') return;
    expect(e.teamCountInPeriod).toBe(9);
    expect(e.personalCount).toBe(1);
  });

  it('the foul that reaches teamFoulBonusAt already pays at the new tier (bump before lookup)', () => {
    // fouls.ts:76-79 — "on the seventh team foul…" reads the count WITH this
    // foul included; thresholds come from the pack, not literals
    const { s, agents } = mkState({ teamFouls: [NBA.teamFoulBonusAt - 1, 0] });
    const out = recordFoul(s, agents.get('h2')!, 'reach', agents.get('a1')!);
    expect(out.inBonus).toBe(true);
    expect(out.bonus).toEqual(bonusFreeThrowAward(NBA, NBA.teamFoulBonusAt));
    expect(out.bonus).not.toBe(null);
    const e = lastEvent(s);
    if (e.type !== 'foul') return;
    expect(e.inBonus).toBe(true);
    // one short of the line stays out of the bonus
    const { s: s2, agents: ag2 } = mkState({ teamFouls: [NBA.teamFoulBonusAt - 2, 0] });
    const out2 = recordFoul(s2, ag2.get('h2')!, 'reach');
    expect(out2.inBonus).toBe(false);
    expect(out2.bonus).toBe(null);
  });

  it('the personal that reaches rules.foulOutAt disqualifies; with the bench exhausted, play on', () => {
    // fouls.ts:80-93; subs.ts:525-533 — a 5-man roster has no replacement, so
    // the fouled-out body legally stays in the lineup (the degenerate state
    // liveOnCourt exists for)
    const { s, agents } = mkState();
    const fouler = agents.get('h5')!;
    fouler.fouls = NBA.foulOutAt - 1;
    const out = recordFoul(s, fouler, 'loose_ball');
    expect(out.fouledOut).toBe(true);
    expect(fouler.fouledOut).toBe(true);
    const e = lastEvent(s);
    if (e.type !== 'foul') return;
    expect(e.fouledOut).toBe(true);
    expect(e.personalCount).toBe(NBA.foulOutAt);
    expect(s.lineup[0]).toContain('h5');
    // one personal short of the limit does not disqualify
    const { s: s2, agents: ag2 } = mkState();
    const early = ag2.get('h5')!;
    early.fouls = NBA.foulOutAt - 2;
    expect(recordFoul(s2, early, 'reach').fouledOut).toBe(false);
    expect(early.fouledOut).toBe(false);
  });

  it('a foul-out with a bench pulls the replacement in immediately, mid-play', () => {
    // fouls.ts JSDoc trap ("this can change who's on the floor as a side
    // effect") + subs.ts:518-541 — the swap happens synchronously, and the
    // substitution event follows the foul event
    const { s, agents } = mkState({ benchIds: ['h6'] });
    const fouler = agents.get('h1')!;
    fouler.fouls = NBA.foulOutAt - 1;
    recordFoul(s, fouler, 'shooting', agents.get('a1')!);
    expect(fouler.onCourt).toBe(false);
    expect(agents.get('h6')!.onCourt).toBe(true);
    expect(s.lineup[0]).toContain('h6');
    expect(s.lineup[0]).not.toContain('h1');
    const e = lastEvent(s);
    expect(e.type).toBe('substitution');
    if (e.type !== 'substitution') return;
    expect(e.out).toEqual(['h1']);
    expect(e.in).toEqual(['h6']);
    expect(s.events[s.events.length - 2]!.type).toBe('foul');
  });

  it('a technical rides the whistle: snapshot counts, and the FT pick is the best LIVE opposing shooter', () => {
    // fouls.ts:95-124 (officiating wave) — the tech is not a personal:
    // every stamped count repeats the trigger foul's values unchanged,
    // fouledOut is always false, and techFT is the highest freeThrow rating
    // on the OPPOSING floor through liveOnCourt (a fouled-out floor ghost is
    // never handed the ball). Forced rate 1 makes the draw deterministic.
    const { s, agents } = mkState({ teamFouls: [2, 0], params: FORCETECH });
    agents.get('h2')!.p.attr.freeThrow = 99;  // wrong-side decoy: fouler's own team
    agents.get('a1')!.p.attr.freeThrow = 99;  // best rating, but a fouled-out floor ghost
    agents.get('a1')!.fouledOut = true;       //   (bench-exhausted degenerate, still in lineup)
    agents.get('a4')!.p.attr.freeThrow = 90;  // the real coaching pick
    const fouler = agents.get('h3')!;
    const out = recordFoul(s, fouler, 'reach', agents.get('a2')!);
    expect(out.techFT).toBe(agents.get('a4'));
    expect(fouler.fouls).toBe(1); // the tech itself increments nothing
    expect(s.teamFoulsPeriod[0]).toBe(3);
    // exactly two foul rows: the personal, then its technical rider
    expect(s.events.map((e) => e.type)).toEqual(['foul', 'foul']);
    const personal = s.events[0]!;
    const tech = s.events[1]!;
    if (personal.type !== 'foul' || tech.type !== 'foul') return;
    expect(personal.kind).toBe('reach');
    expect(tech.kind).toBe('technical');
    expect(tech.team).toBe(0);
    expect(tech.on).toBe('h3');
    expect(tech.drawnBy).toBe(undefined);
    // stamped snapshots, not increments (events.ts:70-93)
    expect(tech.personalCount).toBe(personal.personalCount);
    expect(tech.teamCountInPeriod).toBe(personal.teamCountInPeriod);
    expect(tech.inBonus).toBe(personal.inBonus);
    expect(tech.fouledOut).toBe(false);
  });

  it('the tech draw runs AFTER the foul-out replacement, and a tech never disqualifies', () => {
    // fouls.ts:102-104 ("Draw order at this site is fixed: exactly one
    // chance() after the foul-out replacement") — so the emitted row order
    // is personal → substitution → technical, and the tech's snapshot
    // repeats the disqualifying personal's count without a second bump
    const { s, agents } = mkState({ benchIds: ['h6'], params: FORCETECH });
    const fouler = agents.get('h1')!;
    fouler.fouls = NBA.foulOutAt - 1;
    const out = recordFoul(s, fouler, 'shooting', agents.get('a1')!);
    expect(s.events.map((e) => e.type)).toEqual(['foul', 'substitution', 'foul']);
    expect(out.techFT).not.toBe(null);
    expect(out.techFT!.side).toBe(1); // the tech FT belongs to the fouler's opponents
    const personal = s.events[0]!;
    const tech = s.events[2]!;
    if (personal.type !== 'foul' || tech.type !== 'foul') return;
    expect(personal.fouledOut).toBe(true);
    expect(tech.kind).toBe('technical');
    expect(tech.fouledOut).toBe(false); // a tech never disqualifies in this model
    expect(tech.personalCount).toBe(NBA.foulOutAt);
    expect(fouler.fouls).toBe(NBA.foulOutAt); // snapshot, not an increment
  });

  it('the rate gate spends the stream honestly: zero draws at rate 0, exactly one when live', () => {
    // fouls.ts:96-98 — "the rate gate still runs before the draw, so a
    // zeroed rate leaves the rng stream untouched"; at any live rate the
    // site costs exactly one chance() per whistle, hit or miss
    // (fouls.ts:102-104). The §1.2 determinism contract hangs on this draw
    // budget: a same-seed fresh Rng replays the state rng's position
    // exactly. The live arm runs at the SHIPPED 0.017, not the forced 1 —
    // chance(1) never misses, so a short-circuited extra draw would hide
    // behind it (found by this pin's own sabotage check).
    const { s, agents } = mkState({ seed: 'tech-stream' });
    recordFoul(s, agents.get('h3')!, 'reach', agents.get('a2')!);
    expect(s.rng.float()).toBe(new Rng('tech-stream').float());
    const { s: s2, agents: ag2 } = mkState({ seed: 'tech-stream', params: P });
    recordFoul(s2, ag2.get('h3')!, 'reach', ag2.get('a2')!);
    const fresh = new Rng('tech-stream');
    fresh.float(); // the one chance() the whistle spent
    expect(s2.rng.float()).toBe(fresh.float());
  });
});

describe('enterFreeThrows (fouls.ts:158-256)', () => {
  it('parks the ball dead and kills any pending windup — the ghost-shot fix', () => {
    // fouls.ts:168-175 (scan a1): a stale windup surviving the trip
    // resurrected as a shot with pre-whistle contest/moveType
    const { s, agents } = mkState();
    enterFreeThrows(s, agents.get('h1')!, 2);
    expect(s.ball.holderId).toBe(null);
    expect(s.ball.flight).toBe(null);
    expect(s.pendingRelease).toBe(null);
  });

  it('the phase carries the trip contract: taken 0 of count, shooter, side, oneAndOne default false', () => {
    const { s, agents } = mkState();
    enterFreeThrows(s, agents.get('h2')!, 3);
    const ph = s.phase as Extract<Phase, { kind: 'freethrows' }>;
    expect(ph.kind).toBe('freethrows');
    expect(ph.shooterId).toBe('h2');
    expect(ph.side).toBe(0);
    expect(ph.taken).toBe(0);
    expect(ph.of).toBe(3);
    expect(ph.oneAndOne).toBe(false);
    expect(ph.nextIn).toBeGreaterThan(0);
    // no-tech trips stay byte-identical: the rider keys are conditionally
    // spread, never present-but-undefined (fouls.ts:186-191)
    expect('pre' in ph).toBe(false);
    expect('resume' in ph).toBe(false);
  });

  it('a one-and-one trip is stamped when the bonus award says so', () => {
    // fouls.ts:162-192 — bonus callers pass FoulOutcome.bonus.oneAndOne through
    const { s, agents } = mkState();
    enterFreeThrows(s, agents.get('h2')!, 2, true);
    const ph = s.phase as Extract<Phase, { kind: 'freethrows' }>;
    expect(ph.oneAndOne).toBe(true);
    expect(ph.of).toBe(2);
  });

  it('the shooter walks to the PACK-DERIVED line and the ball waits with him', () => {
    // fouls.ts:215-227 — ftLineFt − rimInsetFt replaced a hardcoded 13.75
    // that silently diverged for non-NBA packs; period 1, side 0 attacks the
    // high-x rim, so the line sits toward midcourt from it
    const { s, agents } = mkState();
    const shooter = agents.get('h3')!;
    enterFreeThrows(s, shooter, 2);
    const rim = court.rims[1];
    const ftSpot = { x: rim.x - (NBA.ftLineFt - NBA.rimInsetFt), y: court.centerY };
    expect(shooter.target).toEqual(ftSpot);
    expect(s.ball.pos).toEqual(ftSpot);
  });

  it('the other nine freeze for the ritual; the shooter keeps his own intent', () => {
    // fouls.ts:228-249 — cosmetic lane arrangement, shooter skipped
    const { s, agents } = mkState();
    const shooter = agents.get('h1')!;
    (shooter as unknown as { intent: string }).intent = 'spot';
    enterFreeThrows(s, shooter, 1);
    for (const [id, a] of agents) {
      if (id === 'h1') continue;
      expect((a as unknown as { intent: string }).intent).toBe('freeze');
    }
    expect((shooter as unknown as { intent: string }).intent).toBe('spot');
  });

  it('the man headed to the line is protected from the substitution pass', () => {
    // fouls.ts:199-211 — checkSubs(s, shooter.p.id, ...): the whistle's sub
    // window must not yank the shooter between the whistle and his attempt.
    // At the shipped sub.ftGapSubMode 3 the trip-entry pass is urgent-only,
    // so the live threat is the foul-trouble pull (subs.ts:374-388): the
    // shooter here is in period-1 trouble (fouls = period + offset) with a
    // clean same-position bench body available and the clock above
    // ftroubleIgnoreClockSec; without the protect argument this exact state
    // pulls him at the whistle.
    const { s, agents } = mkState({ benchIds: ['h6'] });
    const shooter = agents.get('h1')!;
    shooter.fouls = s.period + P.sub.ftroublePersonalOffset;
    enterFreeThrows(s, shooter, 2);
    expect(shooter.onCourt).toBe(true);
    expect(s.lineup[0]).toContain('h1');
    const ph = s.phase as Extract<Phase, { kind: 'freethrows' }>;
    expect(ph.shooterId).toBe('h1');
    // legacy entry modes (STAGED 0-2, fouls.ts:206-211) run the FULL pass at
    // the whistle: there the fatigue rotation is the threat, and a gassed
    // shooter with a rested bench body waiting is protected the same way
    const { s: s2, agents: ag2 } = mkState({
      benchIds: ['h6'],
      params: withParams({ sub: { ftGapSubMode: 1 } })
    });
    const gassed = ag2.get('h1')!;
    (gassed as unknown as { energy: number }).energy = 1;
    enterFreeThrows(s2, gassed, 2);
    expect(gassed.onCourt).toBe(true);
    expect(s2.lineup[0]).toContain('h1');
    expect((s2.phase as Extract<Phase, { kind: 'freethrows' }>).shooterId).toBe('h1');
  });
});
