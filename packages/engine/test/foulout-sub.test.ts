/**
 * Foul-out → substitution, pinned at the event stream (test-quality audit of
 * the engine suite, finding M19).
 *
 * The gap: `replaceFouledOut` (sim/subs.ts:551-567, called synchronously from
 * recordFoul, fouls.ts:110) turned into a no-op survived the audited engine
 * suite. `liveOnCourt` (sim/state.ts:464-466) filters `fouledOut` from every
 * actor query, so invariants.test.ts's "fouled-out players never act again"
 * held vacuously — the fouled-out player ghost-stood in the lineup for the
 * rest of the game and only a 50-game league-stat band two packages away
 * (harness/test/readme.test.ts) drifted red. fouls.test.ts pins the per-call
 * unit contract on a hand-built state; this file pins the documented STREAM
 * shape on real games, from the public GameResult boundary only.
 *
 * Spec source — core/events.ts FoulEvent doc (events.ts:381-387): "the engine
 * immediately attempts a replacement (sim/fouls.ts recordFoul -> sim/subs.ts
 * replaceFouledOut), so a `fouledOut: true` foul is followed by a
 * `substitution` event for the same player UNLESS the team's entire bench is
 * already on the floor or fouled out" (the empty-bench early return,
 * subs.ts:559). recordFoul emits the foul (fouls.ts:99-109) and calls
 * replaceFouledOut on the next line (fouls.ts:110), which emits through
 * swapPlayers (subs.ts:51) with nothing in between — the substitution is the
 * immediately-next event, stamped at the same game-clock instant.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type GameResult } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

/**
 * Foul-outs are rare at calibrated whistle rates (~0.8/game across the
 * invariants pool), so these games crank the whistle knobs through the public
 * per-game GameConfig.params override (game.ts:39) — the calibrated defaults
 * in sim/params.ts are untouched. Values are FEEL — test forcing, not
 * calibration: roughly 1.4-12x the swept rates in params.foul.ts:68-146, all
 * under the shootFoulCap 0.6 ceiling. At these rates most of both 10-man
 * rosters reach the NBA six-foul limit, exercising BOTH documented arms:
 * measured on the two seeds below, 18-19 foul-outs per game — 10 with an
 * eligible bench body (the replacement arm) and 8-9 after the bench is
 * exhausted (the play-on arm).
 */
const FORCED_WHISTLES = {
  foul: {
    shootRim: 0.55,        // shooting-foul chance per rim attempt (default 0.3998)
    shootPaint: 0.42,      // per paint attempt (default 0.1304)
    shootMid: 0.3,         // per mid attempt (default 0.05)
    shootThree: 0.15,      // per three attempt (default 0.012)
    reachInPerSec: 0.09,   // reach-ins per second of on-ball pressure (default ~0.019)
    looseBallPerReb: 0.12  // loose-ball fouls per contested rebound (default ~0.038)
  }
};

// sim once, assert many. Fresh literal seeds (prefix unused elsewhere); an
// rng-reordering engine change may reshuffle foul-out counts — if a vacuity
// floor below trips, re-scout seeds; do not weaken the assertions.
const results: GameResult[] = [];
for (const seed of ['foulout-sub-0', 'foulout-sub-1']) {
  const { home, away } = sampleMatchup();
  results.push(simulateGame({ seed, home, away, collectFrames: false, params: FORCED_WHISTLES }));
}

describe('foul-out produces a substitution when the bench has bodies (audit M19)', () => {
  it('every fouledOut foul with an eligible bench body is immediately followed by the substitution taking him out', () => {
    let withBench = 0;
    for (const r of results) {
      // Bench eligibility is derived from the STREAM — roster minus on-court
      // minus already-fouled-out — never from engine internals. This is
      // exactly replaceFouledOut's own filter (subs.ts:558) minus the DNP
      // scratch term: the sample teams carry no rotationMinutes, so the
      // scratch filter is inert on these fixtures.
      const rosters: [Set<string>, Set<string>] = [
        new Set(r.teams[0].players.map((p) => p.id)),
        new Set(r.teams[1].players.map((p) => p.id))
      ];
      let on: [Set<string>, Set<string>] = [new Set(), new Set()];
      const fouledOut = new Set<string>();
      r.events.forEach((e, idx) => {
        if (e.type === 'game_start') {
          on = [new Set(e.home.lineup), new Set(e.away.lineup)];
        }
        if (e.type === 'substitution') {
          for (const id of e.out) on[e.team].delete(id);
          for (const id of e.in) on[e.team].add(id);
        }
        if (e.type !== 'foul' || !e.fouledOut) return;
        // eligibility at this whistle: the fouler himself is on court, so
        // the on-court subtraction already excludes him
        const eligible = new Set(
          [...rosters[e.team]].filter((id) => !on[e.team].has(id) && !fouledOut.has(id))
        );
        fouledOut.add(e.on);
        const nxt = r.events[idx + 1];
        if (eligible.size === 0) {
          // the documented exception (events.ts:385-387, subs.ts:559):
          // nobody left in uniform — play on shorthanded. No replacement may
          // be conjured; a checkSubs rotation sub can legitimately follow
          // the whistle, but never one benching the fouled-out man twice
          // (checkSubs skips fouled-out outgoing players, subs.ts:341).
          if (nxt?.type === 'substitution') expect(nxt.out).not.toContain(e.on);
          return;
        }
        withBench += 1;
        // the pin M19 exists for: the replacement is immediate — foul event
        // (fouls.ts:99), then replaceFouledOut → swapPlayers → substitution
        // (fouls.ts:110, subs.ts:566, :51) with no event and no tick between
        expect(nxt?.type).toBe('substitution');
        if (nxt?.type !== 'substitution') return; // unreachable — the expect above threw; TS narrowing only
        expect(nxt.team).toBe(e.team);
        expect(nxt.out).toContain(e.on);
        // same game-clock instant: both events are emitted inside the same
        // synchronous recordFoul call, before any clock movement
        expect(nxt.t).toBe(e.t);
        for (const id of nxt.in) {
          // the incoming body is a real bench option — on the roster, not
          // already on the floor, and NOT himself fouled out (subs.ts:558)
          expect(eligible.has(id)).toBe(true);
          expect(fouledOut.has(id)).toBe(false);
        }
      });
    }
    // anti-vacuity floor: measured 10 eligible-bench foul-outs per game on
    // these seeds (20 across the pool). A reshuffle that zeroed this would
    // reduce the pin to an unexecuted branch — fail loudly instead so the
    // pool gets re-scouted deliberately. 2: FEEL, the anti-vacuity floor
    // (any smaller and one lucky draw could carry the gate).
    expect(withBench).toBeGreaterThanOrEqual(2);
  });

  it('a fouled-out player never returns: no later substitution lists him as incoming', () => {
    // Every lineup-insertion path filters fouledOut — the crunch return
    // (subs.ts:354), the concede bench fill (subs.ts:376), the fatigue
    // rotation (subs.ts:450), and the foul-out replacement itself
    // (subs.ts:558) — so once a fouledOut: true foul names a player, no
    // substitution event may ever carry him in `in` again.
    let disqualified = 0;
    for (const r of results) {
      const fouledOut = new Set<string>();
      for (const e of r.events) {
        if (e.type === 'foul' && e.fouledOut) fouledOut.add(e.on);
        if (e.type === 'substitution') {
          for (const id of e.in) expect(fouledOut.has(id)).toBe(false);
        }
      }
      disqualified += fouledOut.size;
    }
    // existence floor: measured 18 + 19 disqualified players on these
    // seeds. 2: FEEL, the anti-vacuity floor, far under the measurement.
    expect(disqualified).toBeGreaterThanOrEqual(2);
  });
});
