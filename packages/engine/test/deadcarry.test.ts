/**
 * #115 — the dead-ball resume relay, pinned as a PROPERTY (the
 * ftcarry.test.ts shape, its registered sibling on the dead phase).
 *
 * The mechanism under pin, two layers:
 *   - layer A: giveBall stamps ball.pos to the new holder's body at the
 *     acquisition instant, and game.ts's stage-12 follows-holder write
 *     re-reads the live holder — after these, nothing live-reads
 *     dead-phase ball.pos but the frame recorder.
 *   - layer B: deadBall and endPeriod stamp carryFrom/carryT0/carryDur on
 *     the dead phase, and tickDead lerps the ball whistle-spot → the
 *     handler-designate's current body across the stoppage's own
 *     resumeIn, wallT-keyed. The giveBall stamp is the arrival write.
 *   Pre-fix signature (issue #115 at 400224f, 48 games): 70.23 event-less
 *   parked-then-jump ball relocations/g over 6 ft, max 89.3 ft —
 *   possession-start resumes 55.19/g, event-less continuations 15.04/g.
 *
 * Why a property and not a checksum: the F3 re-anchor doctrine means
 * stream checksums get re-baked on every legitimate upstream reorder, so
 * a relay broken INSIDE such a commit would bake its own breakage into
 * the new pins silently. A property over simulated frames survives every
 * re-anchor by construction.
 *
 * Three clauses:
 *   1. C2-ZERO — the issue's own acceptance signature, asserted at zero:
 *      no adjacent-frame pair may combine (a) ball delta > 6 ft, (b) no
 *      event strictly inside the pair (after-left/at-or-before-right, the
 *      #82 triage bracketing), (c) a ball parked >= 0.8 s ending at the
 *      left frame, (d) a holder on the right frame. Catches the full
 *      pre-#115 shape AND the layer-A-only shape (the kernel alone leaves
 *      15.60 event-less continuation snaps/g — measured at the layer A
 *      commit of the landing PR).
 *   2. BREAK-RELAY BOUND — period breaks are the issue's longest relays
 *      (a horn ball can sit a full court from the next inbound spot):
 *      inside every (period_end, next possession_start] window, each
 *      adjacent-frame ball delta obeys the break's own implied relay
 *      speed — dist(ball at break entry, ball at resume) / break wall
 *      duration × the pair's wallT gap — plus 6 ft slack. The slack
 *      covers frame round1 quantization, the off-cadence entry sample,
 *      and the moving lerp endpoint (the designate walks to his inbound
 *      spot while the relay tracks him). Measured max excess on the pool:
 *      3.535 ft over 258 pairs; a killed relay reads the whole jump on
 *      the arrival pair (~35-80 ft excess), so 6 keeps order-of-magnitude
 *      signal margin.
 *   3. ARRIVAL — the first frame at/after every possession_start that
 *      shows a holder shows the ball exactly on that holder's body
 *      (frame ball columns equal the holder slot's columns; both sides of
 *      the comparison are round1 of the same copied floats, so equality
 *      is exact by construction). This is the acquisition stamp's
 *      frame-visible face — it catches a clobbered stamp (the stage-12
 *      stale-binding defect read 17/1545 here before the re-read landed)
 *      and any relay that arrives somewhere other than the man play
 *      resumes through.
 *
 * Vacuity floors sit well under the pool scout (deadcarry-1..8, measured
 * at the landing: 928 inbound possession starts, 24 break windows, 5
 * kicked-ball continuations, 49 playerless offensive-rebound side-outs,
 * 7 breaks relaying 40+ ft, 258 bound pairs, 1527 arrival checks), so no
 * clause can pass on an empty slice. The kicked-ball and team-OREB
 * counts prove CONTINUATION stoppages exist in the pool — resumes that
 * emit no event are exactly the class only clause 1 can see.
 *
 * Mutants re-applied and verified RED against this file before landing,
 * in-tree and restored (the mutation-shields doctrine; outputs in the
 * landing PR):
 *   - layer-B revert (carry stamps + tickDead lerp removed, layer A
 *     kept): clause 1 fires on the event-less continuation class.
 *   - full pre-#115 revert (both layers): clauses 1 and 3 fire together
 *     (parked resumes everywhere; ball nowhere near the holder on
 *     possession-start frames).
 *
 * The sanctioned ball.pos read surface (#167): the frames-only warrant,
 * made greppable. The warrant behind layer B: during the stoppage
 * phases ('dead', 'freethrows') nothing reads s.ball.pos except the
 * frame recorder; stoppage-phase ball motion is frames/viewer surface,
 * never an input to decisions, probabilities, or events. The #160
 * review proved this once (statically at review: only recordFrame
 * reachable in a stoppage phase; dynamically: 569/569 paired games
 * event-identical under the Red Team's adversarial presets), and
 * nothing re-runs that proof. A new stoppage-phase ball.pos read
 * silently converts the carry from frames-only into a mechanics
 * change. Every s.ball.pos read site at this writing, with its phase
 * discipline:
 *   - game.ts#recordFrame: the frame recorder, the only reader
 *     reachable inside 'dead'/'freethrows' (game.ts#tick calls it
 *     every tick, all phases). Sanctioned; frames are the point.
 *   - ai/defense.ts#defenseTick (unmatched-man target, deny vector,
 *     ball distance, help spot): live ticks only; both dispatch sites
 *     (the stage-5 windup closeouts and the stage-12 brains) are
 *     inside game.ts#tickLive.
 *   - possession.ts#deadBall, possession.ts#endPeriod,
 *     fouls.ts#enterFreeThrows: the carryFrom stamps. Each reads
 *     ball.pos once at the whistle/horn instant (the live position
 *     where play stopped) to arm the frames-only relay.
 *   - possession.ts#tickScramble: the landing-spot lerp reads its own
 *     phase's ball.pos; 'scramble' is a live-ball phase (a rebound up
 *     for grabs), not a stoppage.
 * Two writes anchor the discipline without reading: giveBall's
 * acquisition stamp (possession.ts) is the relay's arrival write, and
 * game.ts stage 12's follows-holder write re-reads the live holder.
 * Review rule this list exists for: a PR adding an s.ball.pos read
 * must add its site and phase discipline here, and a read reachable
 * in a stoppage phase is a mechanics change (full ladder), whatever
 * the diff looks like. Provenance: #160 layer B (verdict comment
 * 5155936089), Red Team finding 6 (advisory comment 5155984052),
 * issue #167.
 */
import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const POOL = Array.from({ length: 8 }, (_, i) => `deadcarry-${i + 1}`);

describe('#115: the ball relays across dead-ball stoppages (resume-continuity property)', () => {
  it('no event-less parked-then-jump pair exists; break relays obey implied speed; the ball is on the holder at every possession start', () => {
    let c2sig = 0;
    let inboundStarts = 0;
    let breakWindows = 0;
    let kicked = 0;
    let teamOreb = 0;
    let long40 = 0;
    let boundPairs = 0;
    let maxExcessFt = 0;
    let arrivalChecks = 0;
    let arrivalMisses = 0;

    for (const seed of POOL) {
      const { home, away } = sampleMatchup();
      const r = simulateGame({ seed, home, away, collectFrames: true });
      const F = r.frames;
      const evs = r.events as GameEvent[];

      for (const e of evs) {
        if (e.type === 'possession_start' && e.kind === 'inbound') inboundStarts += 1;
        if (e.type === 'violation' && e.kind === 'kicked_ball') kicked += 1;
        if (e.type === 'rebound' && e.player === undefined && e.offensive) teamOreb += 1;
      }

      // ---- clause 1: the C2 signature, counted over every frame pair.
      // Event pointer convention: events with wt <= left frame's wt are
      // "before the pair" (strictly-after-left bracketing, #82 triage) —
      // 0.001 covers the 2dp-event vs 1dp-frame rounding seam.
      let lo = 0;
      for (let k = 1; k < F.length; k++) {
        const L = F[k - 1]!;
        const R = F[k]!;
        while (lo < evs.length && evs[lo]!.wt <= L[0]! + 0.001) lo += 1;
        let hi = lo;
        while (hi < evs.length && evs[hi]!.wt <= R[0]! + 0.001) hi += 1;
        if (R[5]! < 0 || hi - lo > 0) continue; // holder on right, no event inside
        const d = Math.hypot(R[3]! - L[3]!, R[4]! - L[4]!);
        if (d <= 6) continue;
        // parked >= 0.8s ending at the left frame (deltas are exactly 0
        // after round1 while the ball sits)
        let j = k - 1;
        let parked = true;
        while (j >= 1 && L[0]! - F[j - 1]![0]! <= 0.8 + 0.001) {
          const dd = Math.hypot(F[j]![3]! - F[j - 1]![3]!, F[j]![4]! - F[j - 1]![4]!);
          if (dd > 1e-6) { parked = false; break; }
          j -= 1;
        }
        if (!parked) continue;
        if (j === 0 && L[0]! - F[0]![0]! < 0.8 - 0.001) continue; // window truncated by game start
        if (j >= 1 && L[0]! - F[j - 1]![0]! < 0.8 - 0.001 && L[0]! - F[j]![0]! < 0.8 - 0.001) continue;
        c2sig += 1;
      }

      // ---- clause 2: break-relay bound + the long-relay premise
      const starts = evs.filter((e) => e.type === 'possession_start');
      const ends = evs.filter((e) => e.type === 'period_end');
      for (const pe of ends) {
        const ps = starts.find((x) => x.wt > pe.wt);
        if (!ps) continue; // the game-end period_end opens no window
        breakWindows += 1;
        let oi = -1;
        for (let i = 0; i < F.length; i++) { if (F[i]![0]! <= pe.wt + 1e-9) oi = i; else break; }
        let ri = -1;
        for (let i = 0; i < F.length; i++) { if (F[i]![0]! >= ps.wt - 1e-9) { ri = i; break; } }
        if (oi < 0 || ri < 0 || ri <= oi) continue;
        const o = F[oi]!;
        const rf = F[ri]!;
        const carryFt = Math.hypot(rf[3]! - o[3]!, rf[4]! - o[4]!);
        if (carryFt >= 40) long40 += 1;
        const dur = ps.wt - pe.wt;
        if (dur <= 0) continue;
        const impliedFtS = carryFt / dur;
        for (let i = oi; i < ri; i++) {
          const L = F[i]!;
          const R = F[i + 1]!;
          if (L[0]! <= pe.wt + 1e-9) continue; // the horn's own bracketing pair predates the break
          const d = Math.hypot(R[3]! - L[3]!, R[4]! - L[4]!);
          const excess = d - impliedFtS * (R[0]! - L[0]!);
          boundPairs += 1;
          if (excess > maxExcessFt) maxExcessFt = excess;
        }
      }

      // ---- clause 3: arrival exactness at every holder-visible possession start
      for (const ps of starts) {
        let fi = -1;
        for (let i = 0; i < F.length; i++) { if (F[i]![0]! >= ps.wt - 1e-9) { fi = i; break; } }
        if (fi < 0) continue; // horn-adjacent start with no frame after (unreachable in practice)
        const fr = F[fi]!;
        const slot = fr[5]!;
        if (slot < 0) continue; // ball airborne/loose on the sampled frame — no holder to pin to
        arrivalChecks += 1;
        const hx = fr[6 + slot * 2]!;
        const hy = fr[7 + slot * 2]!;
        if (fr[3]! !== hx || fr[4]! !== hy) arrivalMisses += 1;
      }
    }

    // vacuity floors, well under the pool scout (see header): the premise
    // classes must exist or the clauses assert over nothing
    expect(inboundStarts).toBeGreaterThanOrEqual(600);
    expect(breakWindows).toBeGreaterThanOrEqual(16);
    expect(kicked).toBeGreaterThanOrEqual(2);       // event-less continuation hosts
    expect(teamOreb).toBeGreaterThanOrEqual(20);    // more continuation hosts
    expect(long40).toBeGreaterThanOrEqual(2);       // the issue's headline full-court class
    expect(boundPairs).toBeGreaterThanOrEqual(150);
    expect(arrivalChecks).toBeGreaterThanOrEqual(1000);

    // the properties
    expect(c2sig).toBe(0);
    expect(maxExcessFt).toBeLessThanOrEqual(6);
    expect(arrivalMisses).toBe(0);
  });
});
