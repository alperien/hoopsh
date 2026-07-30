/**
 * sim/fouls.ts — recordFoul bookkeeping and the enterFreeThrows setup path.
 *
 * Spec sources: fouls.ts:21-77 (FoulOutcome contract, offensive fouls are
 * personal-only, the bump-then-lookup bonus ordering, foul-out replacement),
 * fouls.ts:81-150 (dead ball, windup cleared, pack-derived FT line, freeze),
 * events.ts:322-339 (FoulEvent fields), rules/rulepack.ts (thresholds — read
 * from the NBA pack, never written as literals).
 *
 * ncaa-rules.test.ts owns bonusFreeThrowAward arithmetic and one-and-one
 * sequencing; invariants.test.ts owns the team-foul reset/monotonic chain.
 * This file pins the per-call unit contract those suites only reach
 * end-to-end. States are hand-built (concede.test.ts doctrine) with the
 * fields recordFoul/enterFreeThrows/checkSubs/swapPlayers read.
 */

import { describe, expect, it } from 'vitest';
import {
  NBA, bonusFreeThrowAward, makeCourt, makePlayer, withParams,
  type GameEvent, type Position
} from '@hoopsh/engine';
import { enterFreeThrows, recordFoul } from '../src/sim/fouls.js';
import type { Agent, GameState, Phase } from '../src/sim/state.js';

const P = withParams();
const court = makeCourt(NBA);

interface AgentSpec {
  id: string;
  side: 0 | 1;
  pos?: Position;
  x?: number;
  y?: number;
  fouls?: number;
  energy?: number;
  onCourt?: boolean;
  intent?: string;
}

function mkAgent(o: AgentSpec): Agent {
  return {
    p: makePlayer({ id: o.id, pos: o.pos ?? 'SF' }),
    side: o.side,
    pos: { x: o.x ?? 47, y: o.y ?? 25 },
    vel: { x: 0, y: 0 },
    energy: o.energy ?? 100,
    secondsPlayed: 0,
    fouls: o.fouls ?? 0,
    onCourt: o.onCourt ?? true,
    fouledOut: false,
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
 * pendingRelease for the dead-ball reset.
 */
function mkState(o?: { teamFouls?: [number, number]; benchIds?: string[] }): {
  s: GameState; agents: Map<string, Agent>;
} {
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
    params: P, rules: NBA, court,
    period: 1, clock: 480, t: 100, wallT: 140, score: [10, 12],
    teamFoulsPeriod: o?.teamFouls ?? [0, 0],
    conceded: [false, false],
    teams: [
      { id: 'h', starters: [...homeIds], players: roster(homeIds, o?.benchIds ?? []) },
      { id: 'a', starters: [...awayIds], players: roster(awayIds) }
    ],
    lineup: [homeIds, awayIds],
    agents,
    ball: { holderId: 'h1', pos: { x: 47, y: 25 }, flight: null },
    pendingRelease: { shooterId: 'h1', moveType: 'pull_up', releaseAt: 101, contest0: 0.3 },
    phase: { kind: 'live' },
    events: [] as GameEvent[]
  } as unknown as GameState;
  return { s, agents };
}

const lastEvent = (s: GameState): GameEvent => s.events[s.events.length - 1]!;

describe('recordFoul (fouls.ts:36-77)', () => {
  it('a defensive foul bumps personal AND team-period counts and stamps the full foul event', () => {
    const { s, agents } = mkState({ teamFouls: [2, 0] });
    const fouler = agents.get('h3')!;
    const victim = agents.get('a2')!;
    const out = recordFoul(s, fouler, 'reach', victim);
    expect(fouler.fouls).toBe(1);
    expect(s.teamFoulsPeriod[0]).toBe(3);
    expect(out).toEqual({ fouledOut: false, inBonus: false, bonus: null });
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
    // emit stamps time/score context (state.ts:334-347)
    expect(e.t).toBe(100);
    expect(e.clock).toBe(480);
    expect(e.score).toEqual([10, 12]);
  });

  it('an offensive foul is personal-only: the team-period count never moves and no shots can result', () => {
    // fouls.ts:55, 61 — countsTeam gate; events.ts:66-69; the known
    // simplification applies the NBA rule under every pack
    const { s, agents } = mkState({ teamFouls: [9, 0] }); // deep in the bonus
    const fouler = agents.get('h4')!;
    const out = recordFoul(s, fouler, 'offensive');
    expect(s.teamFoulsPeriod[0]).toBe(9);
    expect(out.bonus).toBe(null);
    const e = lastEvent(s);
    if (e.type !== 'foul') return;
    expect(e.teamCountInPeriod).toBe(9);
    expect(e.personalCount).toBe(1);
  });

  it('the foul that reaches teamFoulBonusAt already pays at the new tier (bump before lookup)', () => {
    // fouls.ts:58-61 — "on the seventh team foul…" reads the count WITH this
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
    // fouls.ts:62-75; subs.ts:243-248 — a 5-man roster has no replacement, so
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
    // effect") + subs.ts:236-256 — the swap happens synchronously, and the
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
});

describe('enterFreeThrows (fouls.ts:81-150)', () => {
  it('parks the ball dead and kills any pending windup — the ghost-shot fix', () => {
    // fouls.ts:94-102 (scan a1): a stale windup surviving the trip
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
  });

  it('a one-and-one trip is stamped when the bonus award says so', () => {
    // fouls.ts:87-90 — bonus callers pass FoulOutcome.bonus.oneAndOne through
    const { s, agents } = mkState();
    enterFreeThrows(s, agents.get('h2')!, 2, true);
    const ph = s.phase as Extract<Phase, { kind: 'freethrows' }>;
    expect(ph.oneAndOne).toBe(true);
    expect(ph.of).toBe(2);
  });

  it('the shooter walks to the PACK-DERIVED line and the ball waits with him', () => {
    // fouls.ts:119-131 — ftLineFt − rimInsetFt replaced a hardcoded 13.75
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
    // fouls.ts:133-149 — cosmetic lane arrangement, shooter skipped
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
    // fouls.ts:93, 115 — checkSubs(s, shooter.p.id): the fatigue rotation
    // must not yank the shooter between the whistle and his attempt. The
    // shooter is gassed far below any pull threshold and a rested
    // same-position bench body is available; without the protect argument
    // this exact state swaps him out.
    const { s, agents } = mkState({ benchIds: ['h6'] });
    const shooter = agents.get('h1')!;
    (shooter as unknown as { energy: number }).energy = 1;
    enterFreeThrows(s, shooter, 2);
    expect(shooter.onCourt).toBe(true);
    expect(s.lineup[0]).toContain('h1');
    const ph = s.phase as Extract<Phase, { kind: 'freethrows' }>;
    expect(ph.shooterId).toBe('h1');
  });
});
