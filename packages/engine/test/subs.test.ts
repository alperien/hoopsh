/**
 * Substitution mechanics — direct swapPlayers pins.
 *
 * Scan a5 (MED): swapPlayers handed the OUTGOING player's own defensive
 * assignment to the sub, but never re-pointed the OTHER team's defenders
 * whose man was the outgoing player. Matchups are only healed at
 * startPossession, and subs land at continuation dead balls / FT entries
 * where the same possession resumes — so a defender kept guarding the
 * benched man's frozen coordinates (measured ~300 stale defender-ticks per
 * game, in waves of up to four defenders at once). These pins build minimal
 * hand states (the concede.test.ts pattern) and assert the repaired
 * invariant directly: after a swap, no on-court defender's manId names an
 * off-court body.
 */
import { describe, expect, it } from 'vitest';
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { swapPlayers } from '../src/sim/subs.js';
import type { Agent, GameState } from '../src/sim/state.js';

function mkAgent(id: string, side: 0 | 1, onCourt: boolean, manId: string | null): Agent {
  return {
    p: { id },
    side,
    pos: { x: 47, y: 25 },
    vel: { x: 0, y: 0 },
    onCourt,
    manId,
    spotKey: null
  } as unknown as Agent;
}

// swapPlayers touches: lineup, the two agents, the opposing on-court five
// (via onCourt), and emit's stamp fields. A hand-built state suffices.
function mkState(): GameState {
  const agents = new Map<string, Agent>();
  // side 0: h1..h5 on court, h6 on the bench; side 1: a1..a5 guarding h1..h5
  for (let i = 1; i <= 6; i++) agents.set(`h${i}`, mkAgent(`h${i}`, 0, i <= 5, null));
  for (let i = 1; i <= 5; i++) agents.set(`a${i}`, mkAgent(`a${i}`, 1, true, `h${i}`));
  return {
    agents,
    lineup: [['h1', 'h2', 'h3', 'h4', 'h5'], ['a1', 'a2', 'a3', 'a4', 'a5']],
    t: 0,
    wallT: 0,
    period: 1,
    clock: 720,
    score: [0, 0],
    events: []
  } as unknown as GameState;
}

describe('swapPlayers matchup hand-off (scan a5)', () => {
  it('re-points the opposing defender whose man was subbed out', () => {
    const s = mkState();
    const out = s.agents.get('h3')!;
    const into = s.agents.get('h6')!;
    swapPlayers(s, 0, out, into);
    // the defender who guarded the outgoing man now guards his replacement
    expect(s.agents.get('a3')!.manId).toBe('h6');
    // the invariant the scan measured 8,916 live-tick violations of:
    // nobody on the floor is assigned to a benched body
    for (const id of s.lineup[1]) {
      const man = s.agents.get(s.agents.get(id)!.manId!)!;
      expect(man.onCourt).toBe(true);
    }
  });

  it('defenders assigned to OTHER men are untouched, and the sub inherits the outgoing assignment', () => {
    const s = mkState();
    const out = s.agents.get('h3')!;
    out.manId = 'a2'; // the outgoing man was guarding somebody himself
    const into = s.agents.get('h6')!;
    swapPlayers(s, 0, out, into);
    expect(into.manId).toBe('a2'); // pre-existing inheritance intact
    expect(s.agents.get('a1')!.manId).toBe('h1');
    expect(s.agents.get('a5')!.manId).toBe('h5');
    // exactly one substitution event, stamped for the right team
    const subs = s.events.filter((e) => e.type === 'substitution');
    expect(subs.length).toBe(1);
  });
});

// ------------------------------------------------------------------ audit H-02

describe('crunch covers the OT tip stoppage (audit H-02)', () => {
  it('the OT tip dead ball never benches starters — they are exactly who crunch rides', () => {
    // endPeriod resets the clock to otMinutes*60 and immediately runs a
    // checkSubs pass. The old crunch predicate (`clock < crunchClockSec`,
    // strict) read that one stoppage — the only OT moment with the clock at
    // exactly 300 — as non-crunch, so the fatigue rotation benched gassed
    // starters at the tip of every overtime and the first in-OT whistle
    // pulled them straight back (audit H-02: 12/12 OT games affected, 1-4
    // starters benched per tip on these very seeds). Subs AT the tip
    // stoppage may only flow starter-IN (the crunch return); a starter
    // going OUT there is the bug.
    //
    // Seeds probed to reach OT on the current rng stream (5/5 at anchor).
    // An rng-reordering change may reshuffle which seeds go to OT — if the
    // vacuity floor below trips, re-scan for OT seeds and re-anchor the
    // list; do not weaken the starter assertion.
    let otGames = 0;
    for (const i of [6, 26, 130, 146, 150]) {
      const { home, away } = sampleMatchup();
      const r = simulateGame({ seed: `otseek-${i}`, home, away, collectFrames: false });
      if (!r.events.some((e) => e.period > r.rules.periods)) continue;
      otGames++;
      const starters = [new Set(home.starters), new Set(away.starters)] as const;
      const otTipClock = r.rules.otMinutes * 60;
      for (const e of r.events) {
        if (e.type !== 'substitution') continue;
        if (e.period <= r.rules.periods || e.clock !== otTipClock) continue;
        expect(starters[e.team].has(e.out[0]!)).toBe(false);
      }
    }
    expect(otGames).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------- audits M-13 / M-14

describe('rotationMinutes edge semantics (audits M-13/M-14)', () => {
  it('a player id colliding with an Object.prototype key still rotates (M-13)', () => {
    // Team.rotationMinutes is a plain object; the old bare index read of
    // rotationMinutes["constructor"] returned the INHERITED constructor
    // function, the minutes-pace math went NaN, the NaN poisoned the leash
    // clamp (tiredAt = NaN, energy < NaN always false) and the player was
    // never substituted for the rest of the game — strict validation green.
    // The data pack validator now rejects such ids, but the engine boundary
    // accepts raw Team objects, so the read itself must be own-property
    // safe. Red on the old read: zero substitutions of this starter.
    const { home, away } = sampleMatchup();
    const victim = home.starters[0]!;
    const evil = structuredClone(home);
    for (const p of evil.players) if (p.id === victim) p.id = 'constructor';
    evil.starters = evil.starters.map((id) => (id === victim ? 'constructor' : id));
    evil.rotationMinutes = {}; // present-but-empty is enough to poison the old read
    const r = simulateGame({ seed: 'proto-key-0', home: evil, away, collectFrames: false });
    const outs = r.events.filter(
      (e) => e.type === 'substitution' && e.team === 0 && e.out[0] === 'constructor'
    );
    expect(outs.length).toBeGreaterThanOrEqual(1); // the normal fatigue rotation reaches him
  });

  it('rotationMinutes 0 is a DNP scratch: never auto-inserted, not even in garbage time (M-14)', () => {
    // The old Math.max(1, …) division floor made an unplayed 0-target player
    // read pace 0 — "maximally behind target" — which sorted him FIRST in
    // the eager-return queue: the scratch became the highest-priority sub
    // (audit M-14). The controller's own limit semantics point the other
    // way: any second played against a 0 target is infinitely ahead of
    // pace, i.e. he never comes in. Red on the old floor: the scratch
    // entered within the first rotation wave.
    const { home, away } = sampleMatchup();
    const team = structuredClone(home);
    const scratchId = team.players.map((p) => p.id).find((id) => !team.starters.includes(id))!;
    team.rotationMinutes = { [scratchId]: 0 };
    for (const seed of ['scratch-0', 'scratch-1']) {
      const r = simulateGame({ seed, home: team, away, collectFrames: false });
      for (const e of r.events) {
        if (e.type === 'substitution' && e.team === 0) {
          expect(e.in).not.toContain(scratchId);
        }
        // and he is never in an opening lineup either (sanity: not a starter)
        if (e.type === 'game_start') expect(e.home.lineup).not.toContain(scratchId);
      }
    }
  });
});
