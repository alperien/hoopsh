/**
 * The rules landing's dedicated pins (REGISTER W63): the NBA last-2:00
 * team-foul penalty, the OT bonus threshold, and the made-basket clock
 * stops — each asserted at the layer it lives in.
 *
 * Three layers, three test shapes:
 *   1. bonusFreeThrowAward is a pure function — direct unit truth-table,
 *      every path, every pack.
 *   2. The window bookkeeping (teamFoulsLate bumps, per-period resets,
 *      offensive-foul exclusion) is stream-visible: inBonus is documented
 *      as reconstructible from prior foul events alone (events.ts), so the
 *      pins recompute it from the stream and demand agreement — the same
 *      derivation events.test.ts checks, here aimed at the AWARD side:
 *      a window trip must actually pay free throws.
 *   3. The clock stops are physics: a frozen make-inbound leaves the next
 *      possession_start at the make's clock; a running one consumes
 *      move.madeBasketResumeSec. The NCAA and FIBA packs are the built-in
 *      controls — same scan, opposite expectations, so these assertions
 *      cannot pass vacuously against a pack-blind implementation.
 *
 * Seeds are scouted on the landing tree (see each block); the re-anchor
 * protocol is the same as events.test.ts's header.
 */
import { describe, expect, it } from 'vitest';
import {
  simulateGame, NBA, NCAA, EUROLEAGUE, bonusFreeThrowAward, defaultParams,
  type GameEvent, type GameResult, type RulePack
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const game = (seed: string, rules?: RulePack): GameResult => {
  const { home, away } = sampleMatchup();
  return simulateGame({ seed, home, away, ...(rules ? { rules } : {}) });
};

// ------------------------------------------------- 1. the award truth table

describe('bonusFreeThrowAward: the three penalty paths (rulepack.ts)', () => {
  it('regulation threshold: pays at teamFoulBonusAt, silent below it', () => {
    expect(bonusFreeThrowAward(NBA, 4)).toBe(null);
    expect(bonusFreeThrowAward(NBA, 5)).toEqual({ shots: 2, oneAndOne: false });
    expect(bonusFreeThrowAward(NBA, 9)).toEqual({ shots: 2, oneAndOne: false });
  });

  it('OT threshold: the NBA drops to 4; the context flag alone flips the award', () => {
    expect(bonusFreeThrowAward(NBA, 4, { isOT: true })).toEqual({ shots: 2, oneAndOne: false });
    expect(bonusFreeThrowAward(NBA, 3, { isOT: true })).toBe(null);
    // carry-over leagues keep their regulation threshold in OT
    expect(bonusFreeThrowAward(NCAA, 6, { isOT: true })).toBe(null);
    expect(bonusFreeThrowAward(EUROLEAGUE, 4, { isOT: true })).toBe(null);
  });

  it('late window: pays from the trigger foul, only inside the window, only where the rule exists', () => {
    const ctx = (lateWindowFouls: number, clockSec: number) => ({ lateWindowFouls, clockSec });
    // below the count thresholds, the window path is the only route to FTs
    expect(bonusFreeThrowAward(NBA, 2, ctx(2, 90))).toEqual({ shots: 2, oneAndOne: false });
    expect(bonusFreeThrowAward(NBA, 2, ctx(1, 90))).toBe(null); // first window foul is free
    expect(bonusFreeThrowAward(NBA, 2, ctx(2, 121))).toBe(null); // outside the window
    // leagues without the rule never pay this path
    expect(bonusFreeThrowAward(NCAA, 2, ctx(5, 30))).toBe(null);
    expect(bonusFreeThrowAward(EUROLEAGUE, 2, ctx(5, 30))).toBe(null);
  });

  it('the window path never manufactures a one-and-one, and never shadows the NCAA tiers', () => {
    // NCAA regulation tiers are untouched by the (absent) window rule
    expect(bonusFreeThrowAward(NCAA, 7)).toEqual({ shots: 2, oneAndOne: true });
    expect(bonusFreeThrowAward(NCAA, 10)).toEqual({ shots: NCAA.bonusFreeThrows, oneAndOne: false });
    // an NBA window award is the flat award, by rule
    const award = bonusFreeThrowAward(NBA, 1, { lateWindowFouls: 3, clockSec: 10 });
    expect(award?.oneAndOne).toBe(false);
  });

  it('call sites without context keep regulation semantics (the compatibility contract)', () => {
    // the exact shape every pre-landing caller used — no OT drop, no window
    expect(bonusFreeThrowAward(NBA, 4)).toBe(null);
    expect(bonusFreeThrowAward(NCAA, 7)).toEqual({ shots: 2, oneAndOne: true });
  });
});

// -------------------------------------- 2. window bookkeeping on the stream

/** this team's counting fouls this period, total and inside the window,
 *  BEFORE-and-including each foul — the consumer-side derivation the
 *  events.ts doc promises */
function scanFouls(g: GameResult): {
  windowTripPaid: number; windowTripUnpaid: number;
  resetViolations: number; bonusMismatch: number;
} {
  const rules = g.rules;
  let period = 0;
  const counts: [number, number] = [0, 0];
  const late: [number, number] = [0, 0];
  let windowTripPaid = 0;
  let windowTripUnpaid = 0;
  let resetViolations = 0;
  let bonusMismatch = 0;
  const ev = g.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]!;
    if (e.period !== period) {
      period = e.period;
      late[0] = 0; late[1] = 0;
      if (!(period > rules.periods && rules.teamFoulsCarryToOT)) { counts[0] = 0; counts[1] = 0; }
    }
    if (e.type !== 'foul') continue;
    const counting = e.kind !== 'offensive' && e.kind !== 'technical';
    if (counting) {
      counts[e.team] += 1;
      if (rules.lateWindowSec > 0 && e.clock <= rules.lateWindowSec) late[e.team] += 1;
    }
    // stamped team count must agree with the derivation (a bookkeeping pin
    // events.test.ts also holds; kept here so THIS file fails standalone)
    if (counting && e.teamCountInPeriod !== counts[e.team]) resetViolations += 1;
    const threshold = e.period > rules.periods ? rules.teamFoulBonusAtOT : rules.teamFoulBonusAt;
    // the FULL derivation vs the stamped flag, on EVERY foul event —
    // this is the leak detector: a teamFoulsLate count leaking across a
    // period boundary (or an offensive foul bumping it) shows up as a
    // stamped/derived disagreement here, window paths included
    const derived =
      e.teamCountInPeriod >= threshold ||
      (rules.lateWindowSec > 0 && e.clock <= rules.lateWindowSec &&
        late[e.team] >= rules.lateWindowFoulBonusAt);
    if (e.inBonus !== derived) bonusMismatch += 1;
    // the window trip: penalty state reached WITHOUT the count threshold
    if (counting && e.inBonus && e.teamCountInPeriod < threshold &&
        (e.kind === 'reach' || e.kind === 'loose_ball' || e.kind === 'take')) {
      // a non-shooting penalty foul must be followed by free throws before
      // the next possession changes anything material
      let paid = false;
      for (let j = i + 1; j < ev.length && j < i + 8; j++) {
        const x = ev[j]!;
        if (x.type === 'free_throw') { paid = true; break; }
        if (x.type === 'substitution' || x.type === 'timeout' || x.type === 'foul') continue;
        break;
      }
      if (paid) windowTripPaid += 1; else windowTripUnpaid += 1;
    }
  }
  return { windowTripPaid, windowTripUnpaid, resetViolations, bonusMismatch };
}

describe('the last-2:00 window on real streams (REGISTER W63)', () => {
  // seeds scouted per the re-anchor protocol (a reshuffle that starves the
  // vacuity floors fails loudly; re-scan latewin-1..80). Current anchor:
  // the #74 amended-dose landing — 62 and 73 host three paid trips each,
  // 9 and 26 two (10 total, 0 unpaid anywhere on the 80-seed scan; trips
  // run ~0.2-0.3/game by nature — below-threshold teams with two window
  // fouls)
  const pool = [game('latewin-62'), game('latewin-73'), game('latewin-9'), game('latewin-26')];

  it('window trips exist, and every one of them pays free throws', () => {
    let paid = 0;
    let unpaid = 0;
    for (const g of pool) {
      const s = scanFouls(g);
      paid += s.windowTripPaid;
      unpaid += s.windowTripUnpaid;
    }
    expect(paid).toBeGreaterThanOrEqual(2); // vacuity floor (scouted 5)
    expect(unpaid).toBe(0); // a penalized non-shooting foul NEVER goes unpaid
  });

  it('the stamped team counts and every inBonus flag agree with the stream derivation', () => {
    for (const g of pool) {
      const s = scanFouls(g);
      expect(s.resetViolations).toBe(0);
      expect(s.bonusMismatch).toBe(0);
    }
  });

  it('the window resets at every period boundary: an early-period foul below threshold is never penalized', () => {
    let checked = 0;
    for (const g of pool) {
      const counts: [number, number] = [0, 0];
      let period = 0;
      for (const e of g.events) {
        if (e.period !== period) { period = e.period; counts[0] = 0; counts[1] = 0; }
        if (e.type !== 'foul') continue;
        const counting = e.kind !== 'offensive' && e.kind !== 'technical';
        if (counting) counts[e.team] += 1;
        // outside the window, below threshold: inBonus must be false — a
        // leaked window count from the previous period would show up here
        if (counting && e.clock > g.rules.lateWindowSec && e.teamCountInPeriod < g.rules.teamFoulBonusAt &&
            e.period <= g.rules.periods) {
          expect(e.inBonus).toBe(false);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(40); // the common case, well sampled
  });

  it('leagues without the rule never enter the penalty below their thresholds', () => {
    for (const g of [game('latewin-ncaa-1', NCAA), game('latewin-euro-1', EUROLEAGUE)]) {
      let fouls = 0;
      const counts: [number, number] = [0, 0];
      let period = 0;
      for (const e of g.events) {
        if (e.period !== period) {
          const wasOT = period > g.rules.periods;
          period = e.period;
          const isOT = period > g.rules.periods;
          if (!((isOT || wasOT) && g.rules.teamFoulsCarryToOT)) { counts[0] = 0; counts[1] = 0; }
        }
        if (e.type !== 'foul') continue;
        if (e.kind !== 'offensive' && e.kind !== 'technical') counts[e.team] += 1;
        fouls += 1;
        if (e.teamCountInPeriod < g.rules.teamFoulBonusAt) expect(e.inBonus).toBe(false);
      }
      expect(fouls).toBeGreaterThan(20);
    }
  });
});

// ------------------------------------------------- 3. the clock-stop physics

/**
 * Clean made-FG inbounds: made shot -> possession_end -> possession_start
 * with nothing but substitutions between (no and-one, no timeout, no review
 * — each of those freezes or restructures the dead ball on its own terms).
 * Returns [clockAtMake, clockAtNextStart] pairs per period class.
 */
function makeInbounds(g: GameResult): { period: number; at: number; next: number }[] {
  const out: { period: number; at: number; next: number }[] = [];
  const ev = g.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]!;
    if (e.type !== 'shot' || !e.made) continue;
    // reject and-ones: a free throw before the next possession_start
    let j = i + 1;
    let clean = true;
    let next: GameEvent | null = null;
    for (; j < ev.length; j++) {
      const x = ev[j]!;
      if (x.type === 'possession_start') { next = x; break; }
      if (x.type === 'possession_end' || x.type === 'substitution') continue;
      clean = false; break;
    }
    if (!clean || !next || next.period !== e.period) continue;
    out.push({ period: e.period, at: e.clock, next: next.clock });
  }
  return out;
}

describe('made-basket clock stops, per pack (REGISTER W63)', () => {
  const resume = defaultParams.move.madeBasketResumeSec;

  const classify = (rules: RulePack, seedBase: string, n: number) => {
    const frozen: string[] = [];
    const running: string[] = [];
    for (let k = 0; k < n; k++) {
      const g = game(`${seedBase}-${k}`, rules === NBA ? undefined : rules);
      for (const m of makeInbounds(g)) {
        const finalClass = m.period >= rules.periods;
        const stopSec = finalClass ? rules.makeStopClockFinalSec : rules.makeStopClockEarlySec;
        const tag = `${seedBase}-${k} Q${m.period} ${m.at}s`;
        const consumed = m.at - m.next;
        if (m.at <= stopSec) {
          // frozen: the inbound consumes no game clock at all
          if (Math.abs(consumed) < 0.011) frozen.push(tag);
          else running.push(`LEAK ${tag} -> ${m.next}`);
        } else if (Math.abs(consumed) < 0.011) {
          // a full stop where the pack says the clock runs — the bug class
          frozen.push(`STUCK ${tag} -> ${m.next}`);
        } else if (consumed >= resume - 0.7) {
          // the ordinary running inbound: ~madeBasketResumeSec consumed
          running.push(tag);
        }
        // the thin middle (partial consumption near a period horn or an
        // early whistle) is deliberately unclassified — neither regime's
        // assertion should ride on ambiguous rows
      }
    }
    return { frozen, running };
  };

  it('NBA: frozen inside the final-2:00 and Q1-Q3 last-minute windows, running everywhere else', () => {
    const r = classify(NBA, 'clockstop', 3);
    const leaks = r.running.filter((t) => t.startsWith('LEAK'));
    const stuck = r.frozen.filter((t) => t.startsWith('STUCK'));
    expect(leaks).toEqual([]);
    expect(stuck).toEqual([]);
    // vacuity: both regimes actually sampled (scouted: >=4 frozen window
    // makes and dozens of running ones across 3 games)
    expect(r.frozen.length).toBeGreaterThanOrEqual(3);
    expect(r.running.length).toBeGreaterThanOrEqual(30);
  });

  it('NCAA: no early-period stop at all; the final-minute stop belongs to the second half', () => {
    const r = classify(NCAA, 'clockstop-ncaa', 3);
    expect(r.running.filter((t) => t.startsWith('LEAK'))).toEqual([]);
    expect(r.frozen.filter((t) => t.startsWith('STUCK'))).toEqual([]);
    expect(r.running.length).toBeGreaterThanOrEqual(30);
  });

  it('EuroLeague: the FIBA final-2:00 stop only — a Q1-Q3 last-minute make runs', () => {
    const r = classify(EUROLEAGUE, 'clockstop-euro', 3);
    expect(r.running.filter((t) => t.startsWith('LEAK'))).toEqual([]);
    expect(r.frozen.filter((t) => t.startsWith('STUCK'))).toEqual([]);
    expect(r.running.length).toBeGreaterThanOrEqual(30);
  });
});
