/**
 * #161 — break frames carry no stale holder, pinned as a PROPERTY (the
 * deadcarry.test.ts shape, its sibling on the same dead phase).
 *
 * The mechanism under pin: endPeriod builds its dead phase without
 * deadBall (the bypass #115 layer B had to cover for ball POSITION), and
 * before the fix it never cleared ball.holderId — so at every period
 * break whose horn caught a live holder, break frames carried his
 * holderSlot through the entire break while the #115 relay walked the
 * ball away from him (issue #161; quantified in the PR #160 Red Team
 * probe, finding 4). endPeriod now nulls the holder where it constructs
 * the dead phase — the same first act deadBall performs at every other
 * stoppage — and the resume's giveBall stamps the actual taker on its
 * own tick (the Red Team decomposition found that stamp exact in every
 * case; clause 2 pins it so it stays exact).
 *
 * Why a property and not a checksum: same reason as deadcarry.test.ts —
 * the F3 re-anchor doctrine re-bakes stream checksums on every
 * legitimate upstream reorder, and a stale holder re-introduced inside
 * such a commit would bake itself into the new pins silently. A
 * property over simulated frames survives every re-anchor by
 * construction.
 *
 * Two clauses, over every (period_end, next possession_start) window —
 * regulation breaks and OT-entry breaks alike (the OT leg rides the
 * otseek anchor pool, re-anchored by the seed-pin helper; an OT resume
 * is the 'tip' possession kind per the events.ts contract):
 *   1. BREAK-CLEAN — every interior break frame shows holderSlot -1.
 *      Nobody holds the ball through a break: the officials walk it
 *      (the #115 relay) and no giveBall runs until the resume.
 *      Interior = strictly after the horn's own frame (> pe.wt) and
 *      clear of the resume tick's rounding seam (< ps.wt - 0.051:
 *      frame wt is round1, event wt round2, so the resume tick's own
 *      frame can read up to 0.05 under its event — the 1dp-vs-2dp seam
 *      deadcarry brackets from the event side with 0.001).
 *   2. RESUME-STAMP — the first frame at/after each window's
 *      possession_start (wt >= ps.wt - 0.051) already shows a holder,
 *      with the ball exactly on his body (frame ball columns equal the
 *      holder slot's columns — round1 of the same copied floats, exact
 *      by construction). Catches a lagging or clobbered acquisition
 *      stamp — the failure deadcarry's arrival clause steps over (it
 *      `continue`s on a slot of -1; this clause fails on it).
 *
 * Pre-fix signature (measured at a95db372, the #161 promotion base, on
 * both pools): 315 stale interior frames across 20 of 48 windows —
 * every stale window's horn caught a live holder. FT-horn and
 * scramble-horn breaks were already clean (those phases null the holder
 * on entry), which is why 28 windows read clean at base. (The draft's
 * pre-#174 base read 391 across 19 of 48; the #174 stream reshuffle
 * re-rolled which horns catch a live holder, as it must.)
 *
 * Vacuity floors sit well under the pool scout (breakholder-1..8 +
 * SEED_PINS.otseek.seeds, measured at the landing: 48 break windows, 6
 * OT-entry windows, 608 interior frames, 48 resume checks), so no
 * clause can pass on an empty slice. The OT floor of 2 follows the
 * otseek consumer convention (subs.test.ts, audit H-02).
 *
 * Mutant verified RED against this file at the promotion (the pin run
 * against pristine a95db372, fix absent — the mutation-shields
 * doctrine; verbatim output in the landing PR): clause 1 fires at the
 * full 315 with clause 2 green — the stale id lies about the break,
 * never about the resume.
 */
import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { SEED_PINS } from './seed-pins.gen.js';

const POOL = [
  ...Array.from({ length: 8 }, (_, i) => `breakholder-${i + 1}`),
  ...SEED_PINS.otseek.seeds
];

describe('#161: break frames carry no stale holder (break-window holder property)', () => {
  it('every interior break frame is holderless; the resume frame shows the taker, ball on body', () => {
    let breakWindows = 0;
    let otWindows = 0;
    let interiorFrames = 0;
    let staleInterior = 0;
    let resumeChecks = 0;
    let resumeMisses = 0;

    for (const seed of POOL) {
      const { home, away } = sampleMatchup();
      const r = simulateGame({ seed, home, away, collectFrames: true });
      const F = r.frames;
      const evs = r.events as GameEvent[];
      const starts = evs.filter((e) => e.type === 'possession_start');
      const ends = evs.filter((e) => e.type === 'period_end');

      for (const pe of ends) {
        const ps = starts.find((x) => x.wt > pe.wt);
        if (!ps) continue; // the game-end period_end opens no window
        breakWindows += 1;
        if (ps.type === 'possession_start' && ps.kind === 'tip') otWindows += 1;

        // clause 1 — interior break frames are holderless
        for (const fr of F) {
          if (fr[0]! > pe.wt + 1e-9 && fr[0]! < ps.wt - 0.051) {
            interiorFrames += 1;
            if (fr[5]! >= 0) staleInterior += 1;
          }
        }

        // clause 2 — the resume frame shows the taker, ball on his body
        let ri = -1;
        for (let i = 0; i < F.length; i++) {
          if (F[i]![0]! >= ps.wt - 0.051) { ri = i; break; }
        }
        if (ri < 0) continue; // horn-adjacent resume with no frame after (unreachable in practice)
        resumeChecks += 1;
        const fr = F[ri]!;
        const slot = fr[5]!;
        if (slot < 0 || fr[3]! !== fr[6 + slot * 2]! || fr[4]! !== fr[7 + slot * 2]!) {
          resumeMisses += 1;
        }
      }
    }

    // vacuity floors, well under the pool scout (see header)
    expect(breakWindows).toBeGreaterThanOrEqual(32);
    expect(otWindows).toBeGreaterThanOrEqual(2);
    expect(interiorFrames).toBeGreaterThanOrEqual(400);
    expect(resumeChecks).toBeGreaterThanOrEqual(32);

    // the properties
    expect(staleInterior).toBe(0);
    expect(resumeMisses).toBe(0);
  });
});
