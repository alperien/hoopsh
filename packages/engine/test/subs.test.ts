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
