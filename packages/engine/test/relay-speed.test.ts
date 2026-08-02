/**
 * #166 — mid-relay ball speed inside whistle-to-resume windows, pinned as a
 * PROPERTY (the deadcarry.test.ts shape, its registered sibling on the same
 * dead phase; filed from the PR #160 Red Team probe, findings 3 and 1,
 * advisory record 5155984052).
 *
 * The gap this closes: the #115/#160 relay (deadBall/endPeriod stamp
 * carryFrom/carryT0/carryDur; tickDead lerps the ball whistle-spot → the
 * handler-designate's current body across the stoppage's own resumeIn) was
 * unbounded by any test between whistle and resume. deadcarry clause 2
 * bounds period-break windows only; clause 1 requires a holder on the right
 * frame and a parked left window — mid-relay pairs are holderless and never
 * parked. A regression that snaps the ball mid-window (35-89 ft pairs, the
 * pre-#115 teleport magnitude) passed the entire suite at this test's base;
 * the whistle-gated mutant in the record below demonstrates exactly that.
 *
 * Why a property and not a checksum: same F3 re-anchor doctrine as
 * deadcarry/ftcarry — stream checksums get re-baked on every legitimate
 * upstream reorder, so a relay broken inside such a commit would bake its
 * own breakage into the new pins silently. A property over simulated frames
 * survives every re-anchor by construction.
 *
 * The construction (issue #166's own pin, the #82 triage bracketing):
 *   - A window opens at every foul/violation/timeout event — the
 *     officiating whistles — and closes at the next event tick with
 *     strictly greater wt. Same-tick administrative events (substitutions,
 *     replay reviews, a timeout called at the whistle) share the opener's
 *     wt and do not close the window; the closer is in practice the resume
 *     (possession_start), a free throw, or the first live event after an
 *     event-less continuation resume.
 *   - A frame pair is checked when the last event tick at-or-before its
 *     left frame contains an opener (so the pair sits inside that opener's
 *     window), no event lands strictly inside the pair, and BOTH frames are
 *     holderless (slot −1) — the mid-relay class. The 0.001 seam covers the
 *     2dp-event vs 1dp-frame rounding, per the strictly-after-left
 *     convention. Pairs with a holder are clause-1 deadcarry territory;
 *     pairs containing the closer are excluded by event-lessness.
 *   - Checked pairs are pure dead-phase relay motion plus the free-throw
 *     line carry inside foul→free_throw windows (fouls.ts nulls holderId at
 *     trip entry; that carry is separately pinned tighter by ftcarry).
 *
 * The bound: 24 ft per adjacent frame pair (one pair = 0.2 s wall at
 * frameEvery 2 / tickHz 10). Derivation, all three legs measured:
 *   - observed envelope at this base: max 16.64 ft/pair over 6120 checked
 *     pairs (relayspeed-1..8), 16.47 over 27695 pairs on the 40-game wide
 *     scout (relayspeed-9..48) — matching the Red Team's 16.6 at #160's
 *     head, so this file measures with the same instrument;
 *   - physical ceiling of a legitimate relay: full-court diagonal
 *     (~106.5 ft) across the shortest stoppage (move.deadBallSideOutSec
 *     1.2 s) ≈ 17.7 ft/pair, plus ~1-1.5 ft for the moving lerp endpoint
 *     (the designate walks to his inbound spot while the relay tracks
 *     him) — 24 clears the ceiling class, so the pin guards regression
 *     blowups, not seed noise;
 *   - signal margin: the snap class reads 35-89 ft/pair, 1.5-3.7× the
 *     bound. 24 is the top of issue #166's historical envelope (~18-24)
 *     and also clears the fastest ball motion anywhere in the sim (pass
 *     flights ≤ 118 ft/s ≈ 23.6 ft/pair), so no legitimate class can
 *     false-positive it even at the construction's edges.
 *
 * Coverage boundary (deliberate, the issue's own scope): turnover-,
 * team-rebound-, post-make-, and free_throw-governed stoppages host relays
 * too but are not opened here. tickDead is the single relay driver for
 * every dead phase, so a lerp regression manifests inside the covered
 * windows regardless (scouted non-opener maxima 9.1-16.4 ft/pair — the
 * same envelope). Period breaks stay with deadcarry clause 2.
 *
 * Second motivation, the C1 floor (issue #166): #160's relay put a
 * permanent ~0.25/g relay-caused floor under the C1 foul-crossing metric
 * (11 of 12 head C1 rows are post-whistle relay motion caught by
 * off-cadence whistle bracketing — frameEvery 2 leaves the whistle tick
 * frameless about half the time). A future FT-carry regression below that
 * floor is invisible to C1 alone; this window bound is the guard that sees
 * what C1 no longer can, resolving the issue's either/or in favor of the
 * test pin (no C1 refinement needed).
 *
 * Vacuity floors sit well under the pool scout (relayspeed-1..8, measured
 * at base 88775586: 335 fouls, 8 violations, 94 timeouts, 419 windows
 * contributing pairs, 47 windows relaying 40+ ft, 6120 checked pairs), so
 * the bound cannot pass on an empty slice. The 40-ft window-travel floor
 * proves the fast cross-court class — the envelope's stress case — exists
 * in the pool.
 *
 * Mutants re-applied and verified RED against this file before landing,
 * in-tree and restored (the mutation-shields doctrine; outputs in the
 * PR):
 *   - whistle-gated park-then-snap (deadBall stamps a marker; tickDead
 *     parks marked relays at carryFrom until half the stoppage, then
 *     snaps to the designate; endPeriod unmarked, so break relays stay
 *     honest): THIS FILE RED at actual 84.71 ft. Every other PROPERTY
 *     test stays green — deadcarry (all three clauses) and ftcarry
 *     included; the only co-movers are 19 baked stream-checksum rows,
 *     which re-bake values-only on every legitimate frames-touching PR
 *     by the F3 re-anchor doctrine and so cannot guard this class. That
 *     is the issue's "passes the entire suite today" gap, demonstrated.
 *   - unconditional park-then-snap (breaks included): this file RED and
 *     deadcarry RED together (its clause-1 C2 signature, actual 7 — the
 *     break-window snap pairs ride the stale horn-holder frames of PR
 *     #160's out-of-scope finding 1). Break-hosted snaps land on
 *     deadcarry, whistle-hosted snaps land here: the two pins partition
 *     the dead-phase domain.
 */
import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const POOL = Array.from({ length: 8 }, (_, i) => `relayspeed-${i + 1}`);

/** the officiating whistles — issue #166's window openers */
const OPENERS = new Set<string>(['foul', 'violation', 'timeout']);

// 2dp-event vs 1dp-frame rounding seam (#82 triage convention, the same
// 0.001 deadcarry clause 1 uses)
const SEAM = 0.001;

describe('#166: mid-relay ball speed stays inside the physical envelope across whistle-to-resume windows', () => {
  it('no event-less holderless frame pair inside a whistle window moves the ball more than 24 ft', () => {
    let fouls = 0;
    let violations = 0;
    let timeouts = 0;
    let windows = 0;
    let long40 = 0;
    let checkedPairs = 0;
    let maxPairFt = 0;

    for (const seed of POOL) {
      const { home, away } = sampleMatchup();
      const r = simulateGame({ seed, home, away, collectFrames: true });
      const F = r.frames;
      const evs = r.events as GameEvent[];

      for (const e of evs) {
        if (e.type === 'foul') fouls += 1;
        if (e.type === 'violation') violations += 1;
        if (e.type === 'timeout') timeouts += 1;
      }

      let lo = 0;            // first event strictly after the left frame (seam applied)
      let govWt = -1;        // wt of the governing event tick (last at-or-before left)
      let govOpen = false;   // that tick contains an opener → the pair is in-window
      let winKey = -1;       // governing wt of the window currently accumulating pairs
      let winFirst: [number, number] | null = null; // first checked pair's left ball pos
      let winLast: [number, number] | null = null;  // latest checked pair's right ball pos
      const flushWindow = (): void => {
        if (winFirst !== null && winLast !== null) {
          windows += 1;
          const travel = Math.hypot(winLast[0] - winFirst[0], winLast[1] - winFirst[1]);
          // 40 ft — the issue's cross-court fast-relay class (the envelope's
          // stress case: long carry over the 1.2 s side-out floor)
          if (travel >= 40) long40 += 1;
        }
        winFirst = null;
        winLast = null;
      };

      for (let k = 1; k < F.length; k++) {
        const L = F[k - 1]!;
        const R = F[k]!;
        const before = lo;
        while (lo < evs.length && evs[lo]!.wt <= L[0]! + SEAM) lo += 1;
        if (lo > before) {
          // re-derive the governing tick: every trailing event sharing the
          // last at-or-before wt (same-tick events carry byte-identical
          // round2 wt, so float equality groups exactly)
          govWt = evs[lo - 1]!.wt;
          govOpen = false;
          for (let j = lo - 1; j >= 0 && evs[j]!.wt === govWt; j--) {
            if (OPENERS.has(evs[j]!.type)) { govOpen = true; break; }
          }
        }
        let hi = lo;
        while (hi < evs.length && evs[hi]!.wt <= R[0]! + SEAM) hi += 1;
        if (hi - lo > 0) continue;              // an event lands strictly inside the pair
        if (!govOpen || govWt < 0) continue;    // not inside a whistle window
        if (L[5]! >= 0 || R[5]! >= 0) continue; // mid-relay pairs are holderless on BOTH frames
        const d = Math.hypot(R[3]! - L[3]!, R[4]! - L[4]!);
        checkedPairs += 1;
        if (d > maxPairFt) maxPairFt = d;
        if (winKey !== govWt) {
          flushWindow();
          winKey = govWt;
        }
        if (winFirst === null) winFirst = [L[3]!, L[4]!];
        winLast = [R[3]!, R[4]!];
      }
      flushWindow();
    }

    // vacuity floors, well under the pool scout (see header): the premise
    // classes must exist or the bound asserts over nothing
    expect(fouls).toBeGreaterThanOrEqual(200);
    expect(violations).toBeGreaterThanOrEqual(2);   // rare whistle class (kicked balls, goaltends)
    expect(timeouts).toBeGreaterThanOrEqual(40);
    expect(windows).toBeGreaterThanOrEqual(250);
    expect(long40).toBeGreaterThanOrEqual(20);      // the cross-court fast class exists
    expect(checkedPairs).toBeGreaterThanOrEqual(3500);

    // the property: the relay never exceeds its physical envelope
    expect(maxPairFt).toBeLessThanOrEqual(24);
  });
});
