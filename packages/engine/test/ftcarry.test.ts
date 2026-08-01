/**
 * #82 C1 — the free-throw ball carry, pinned as a PROPERTY (the delta-F1
 * honest-path shape from transcarry.test.ts, its registered sibling).
 *
 * The mechanism under pin: enterFreeThrows no longer snaps the ball to the
 * line at the whistle (that snap was the frame stream's largest teleport
 * class — 25.4 foul-crossing single-frame jumps/g, p50 13.9 ft, max ~75 ft,
 * issue #82). It stamps the whistle-caught spot + entry wallT on the
 * freethrows phase, and tickFreeThrows lerps the ball spot→line across the
 * move.ftSetupSec lead-in, wallT-keyed, with a byte-exact { ...ftSpot }
 * arrival write gated on the attempt's own countdown (fouls.ts).
 *
 * Why a property and not a checksum: the F3 header's own re-anchor doctrine
 * means stream checksums get re-baked on every legitimate upstream reorder,
 * so a carry broken INSIDE such a commit would bake its own breakage into
 * the new pins silently. A property over simulated frames survives every
 * re-anchor by construction.
 *
 * Three assertions per trip, all confined to the ritual's interior so the
 * out-of-scope teleport classes cannot pollute them (C2, the event-less
 * resume snap #115, lives at dead-ball resumes outside FT windows; C3, the
 * final-FT-miss rim seed — fouls.ts, ~13.75 ft ftSpot→rim on the attempt
 * tick, pre-existing, 5.3/g — is excluded surgically below):
 *   1. BOUND — every adjacent-frame ball delta strictly inside the carry
 *      window (entry, first attempt] obeys the trip's own implied carry
 *      speed: dist(origin, ftSpot) / ftSetupSec, times the pair's wallT
 *      gap, plus 0.5 ft slack. The slack covers frame round1 quantization
 *      (<= ~0.15 ft on a pair) plus the odd-tick origin sample (entry can
 *      land between frame ticks, so the origin frame can sit up to one
 *      0.1 s live step — sprint ~2.8 ft — before the true whistle spot,
 *      understating the implied speed by up to ~0.4 ft per pair). Measured
 *      max excess on the pool: 0.287 ft over n=1518 pairs; a killed lerp
 *      (the old entry snap restored) posts excesses of 5-70 ft, so 0.5
 *      keeps orders-of-magnitude signal margin. For a trip whose FIRST
 *      attempt is also its LAST and misses (1-of-1 non-technical miss,
 *      one-and-one front end included), the pair bracketing the attempt is
 *      excluded: the C3 rim seed lands on that very tick.
 *   2. DEPARTURE — the first in-window frame sits within the origin's
 *      implied reach: dist(that frame, origin) <= implied speed × elapsed
 *      since entry, plus 4 ft slack (one pre-whistle 0.1 s ball step at the
 *      off-cadence origin sample — sprint ~2.8 ft, a resolving shot flight
 *      ~3 ft; measured max excess 0.94 ft on the pool). This is the clause
 *      with teeth against the pre-#82 entry snap: the snap completes inside
 *      the whistle's own bracketing pair, which sits OUTSIDE the interior
 *      window (its left frame predates the whistle — and out-of-scope C2
 *      snaps can legitimately ride that same pair, so it cannot be pinned
 *      directly). A snapped ball reads at the LINE on the first in-window
 *      frame while the origin reads the whistle spot: every non-frame-tick
 *      trip longer than ~5 ft violates this bound by construction.
 *   3. ARRIVAL — the first frame at-or-after each free_throw event's wt
 *      shows the ball exactly at the trip's ftSpot (round1 of the same
 *      rule-pack derivation fouls.ts uses: NBA 19 − 5.25 = 13.75 ft from
 *      rim center, court centerline). Skipped only where the C3 rim seed
 *      overwrites the spot on the attempt tick itself: a trip-FINAL
 *      non-technical miss. Technical attempts are never skipped — a dead-
 *      ball tech miss produces no rebound and no rim seed by rule.
 *
 * Trip grouping: free_throw events keyed by the last preceding foul wt.
 * Every trip's entry shares its whistle's tick (recordFoul and
 * enterFreeThrows run in the same tick), and no foul can occur mid-trip
 * (no live actors during the ritual), so the key is exact.
 *
 * Vacuity floors sit well under the pool scout (203 trips, 1518 bound
 * pairs, 324 arrival checks, 4 carries over 40 ft — the issue's worst-case
 * backcourt class), so no assertion can pass on an empty slice.
 *
 * Two mutants were re-applied and verified RED against this file before
 * landing, in-tree and restored — the mutation-shields doctrine:
 *   - lerp-kill (entry snap restored, tick carry disabled — the pre-#82
 *     shape): the departure clause catches it (the snap completes before
 *     the first in-window frame, so departure reads the full jump).
 *   - t-for-wallT axis-mix (the AGENTS §1.5 trap, both stamps moved to the
 *     frozen game clock): the lerp parks at the origin and the arrival
 *     gate's nextIn arm relocates the whole jump onto the attempt tick's
 *     own bracketing pair, INSIDE the bound window — the bound clause
 *     catches it. Departure and arrival stay green under this mutant,
 *     which is why the bound clause exists as its own assertion.
 */
import { describe, expect, it } from 'vitest';
import {
  NBA, makeCourt, simulateGame, withParams, type GameEvent
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { attackedRim, round1, type GameState } from '../src/sim/state.js';

const POOL = Array.from({ length: 8 }, (_, i) => `ftcarry-${i + 1}`);

describe('#82 C1: the ball walks to the line (FT-carry honest-path property)', () => {
  it('carry deltas obey each trip\'s implied speed; the ball is exactly on the spot at every non-rim-seeded attempt', () => {
    // the same shipped values the sim ran with — the window is the existing
    // move.ftSetupSec lead-in (FEEL 1.4 s), deliberately not a new knob
    const ftSetupSec = withParams({}).move.ftSetupSec;
    const court = makeCourt(NBA);

    let trips = 0;
    let boundPairs = 0;
    let arrivalChecks = 0;
    let arrivalMisses = 0;
    let long40 = 0;
    let maxExcessFt = 0;
    let departures = 0;
    let maxDepartureExcessFt = 0;

    for (const seed of POOL) {
      const { home, away } = sampleMatchup();
      const r = simulateGame({ seed, home, away, collectFrames: true });
      const frames = r.frames;

      // group free_throw events into trips by the last preceding foul wt
      let lastFoulWt = -1;
      const tripsByEntry = new Map<number, Extract<GameEvent, { type: 'free_throw' }>[]>();
      for (const e of r.events as GameEvent[]) {
        if (e.type === 'foul') { lastFoulWt = e.wt; continue; }
        if (e.type !== 'free_throw') continue;
        const trip = tripsByEntry.get(lastFoulWt);
        if (trip) trip.push(e);
        else tripsByEntry.set(lastFoulWt, [e]);
      }

      for (const [entryWt, fts] of tripsByEntry) {
        trips += 1;
        const first = fts[0]!;
        // the trip's line spot — the same rule-pack derivation as
        // fouls.ts#ftLineSpot, recomputed independently so the pin also
        // catches a broken derivation, not just a broken carry
        const stub = { period: first.period, rules: NBA, court } as unknown as GameState;
        const rim = attackedRim(stub, first.team);
        const dir = rim.x > court.midX ? -1 : 1;
        const ftSpot = { x: rim.x + dir * (NBA.ftLineFt - NBA.rimInsetFt), y: court.centerY };

        // origin = the last frame at or before entry (the whistle-caught
        // ball spot, up to one off-cadence 0.1 s live step early)
        let oi = -1;
        for (let i = 0; i < frames.length; i++) {
          if (frames[i]![0]! <= entryWt + 1e-9) oi = i; else break;
        }
        if (oi < 0) continue; // no frame precedes the trip (unreachable in practice)
        const o = frames[oi]!;
        const carryFt = Math.hypot(o[3]! - ftSpot.x, o[4]! - ftSpot.y);
        if (carryFt > 40) long40 += 1;
        const impliedFtS = carryFt / ftSetupSec;

        // 1. BOUND over pairs strictly inside (entry, first attempt] —
        // excluding the attempt-bracketing pair when that attempt rim-seeds
        const firstSeedsRim = fts.length === 1 && !first.made && first.technical === undefined;
        for (let i = oi; i + 1 < frames.length; i++) {
          const L = frames[i]!;
          const R = frames[i + 1]!;
          if (L[0]! <= entryWt + 1e-9) continue;
          if (firstSeedsRim ? R[0]! >= first.wt - 1e-9 : R[0]! > first.wt + 1e-9) break;
          const d = Math.hypot(R[3]! - L[3]!, R[4]! - L[4]!);
          const excess = d - impliedFtS * (R[0]! - L[0]!);
          boundPairs += 1;
          if (excess > maxExcessFt) maxExcessFt = excess;
        }

        // 2. DEPARTURE — the first in-window frame is still within the
        // origin's implied reach (a snapped ball would already read at the
        // line, 13.9 ft median away)
        const w = frames[oi + 1];
        if (w !== undefined && w[0]! <= first.wt + 1e-9) {
          const dep = Math.hypot(w[3]! - o[3]!, w[4]! - o[4]!);
          const depExcess = dep - impliedFtS * (w[0]! - entryWt);
          departures += 1;
          if (depExcess > maxDepartureExcessFt) maxDepartureExcessFt = depExcess;
        }

        // 3. ARRIVAL at every attempt the rim seed cannot touch
        for (let k = 0; k < fts.length; k++) {
          const e = fts[k]!;
          const finalMiss = k === fts.length - 1 && !e.made && e.technical === undefined;
          if (finalMiss) continue; // C3: the rim seed lands on this tick
          let fi = -1;
          for (let i = 0; i < frames.length; i++) {
            if (frames[i]![0]! >= e.wt - 1e-9) { fi = i; break; }
          }
          if (fi < 0) continue; // no frame at or after the horn-adjacent attempt
          arrivalChecks += 1;
          const fr = frames[fi]!;
          if (fr[3]! !== round1(ftSpot.x) || fr[4]! !== round1(ftSpot.y)) arrivalMisses += 1;
        }
      }
    }

    // vacuity floors, well under the pool scout (203 trips / 1518 pairs /
    // 203 departures / 324 arrival checks): the premise classes must exist
    // or the properties assert over nothing
    expect(trips).toBeGreaterThanOrEqual(120);
    expect(boundPairs).toBeGreaterThanOrEqual(900);
    expect(departures).toBeGreaterThanOrEqual(120);
    expect(arrivalChecks).toBeGreaterThanOrEqual(200);
    // the issue's headline class — long backcourt carries — must be present
    expect(long40).toBeGreaterThanOrEqual(2);

    // the properties
    expect(maxExcessFt).toBeLessThanOrEqual(0.5);
    expect(maxDepartureExcessFt).toBeLessThanOrEqual(4);
    expect(arrivalMisses).toBe(0);
  });
});
