/**
 * NCAA men's rule-pack verification — pins the three verified rule bugs from
 * data/ncaa/README.md (R1 bonus structure, R2 lane width, R4 OT foul
 * carryover) against the engine, and proves the NBA path is untouched.
 *
 * Two layers:
 *  1. Constants: every pack's bonus/lane/carryover fields match the cited
 *     rule-book values (README §1.1 table), and bonusFreeThrowAward's pure
 *     arithmetic matches the NCAA/NFHS Major Rules Differences doc.
 *  2. Behavior: event-stream properties over full simulated games — a
 *     one-and-one front-end miss ends the trip with a LIVE ball (no second
 *     attempt, no dead-ball formality rebound), the double bonus and the
 *     NBA's flat bonus always run the full two attempts, and OT team-foul
 *     counts carry (NCAA) vs reset (NBA).
 */

import { describe, expect, it } from 'vitest';
import {
  EUROLEAGUE, NBA, NCAA, bonusFreeThrowAward, simulateGame,
  type GameEvent, type RulePack
} from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

// ------------------------------------------------------------- §1 constants

describe('rule pack constants match the research doc (data/ncaa/README.md §1.1)', () => {
  it('NCAA men: one-and-one at 7, double bonus at 10, both flowing to 2-shot trips', () => {
    expect(NCAA.teamFoulBonusAt).toBe(7);
    expect(NCAA.bonusRule).toBe('oneAndOne');
    expect(NCAA.doubleBonusAt).toBe(10);
    expect(NCAA.bonusFreeThrows).toBe(2);
  });

  it('NCAA men: team fouls carry into OT (reset is end-of-first-half only)', () => {
    expect(NCAA.teamFoulsCarryToOT).toBe(true);
  });

  it('NCAA men: 12-ft lane (was inheriting the NBA 16 — R2)', () => {
    expect(NCAA.keyWidthFt).toBe(12);
  });

  it('NCAA men: the rest of the pack still matches the cited rule book (§1.1 verified-correct rows)', () => {
    expect(NCAA.periods).toBe(2);
    expect(NCAA.periodMinutes).toBe(20);
    expect(NCAA.otMinutes).toBe(5);
    expect(NCAA.shotClockSec).toBe(30);
    expect(NCAA.shotClockOffRebSec).toBe(20);
    expect(NCAA.foulOutAt).toBe(5);
    expect(NCAA.courtLengthFt).toBe(94);
    expect(NCAA.courtWidthFt).toBe(50);
    expect(NCAA.ftLineFt).toBe(19);
    expect(NCAA.rimInsetFt).toBe(5.25);
    expect(NCAA.three).toEqual({ arcRadiusFt: 22.15, cornerDistFt: 21.65, cornerBreakFt: 9.85 });
  });

  it('NBA: flat two-shot bonus at 5, per-period reset incl. OT, 16-ft lane', () => {
    expect(NBA.teamFoulBonusAt).toBe(5);
    expect(NBA.bonusRule).toBe('flat');
    // flat packs keep the double-bonus threshold degenerate: the flat bonus
    // IS the two-shot award from its first foul (rulepack.ts field doc)
    expect(NBA.doubleBonusAt).toBe(NBA.teamFoulBonusAt);
    expect(NBA.bonusFreeThrows).toBe(2);
    expect(NBA.teamFoulsCarryToOT).toBe(false);
    expect(NBA.keyWidthFt).toBe(16);
  });

  it('EuroLeague: flat two-shot bonus at 5 (no one-and-one in FIBA), OT extends the 4th period', () => {
    expect(EUROLEAGUE.teamFoulBonusAt).toBe(5);
    expect(EUROLEAGUE.bonusRule).toBe('flat');
    expect(EUROLEAGUE.doubleBonusAt).toBe(EUROLEAGUE.teamFoulBonusAt);
    expect(EUROLEAGUE.bonusFreeThrows).toBe(2);
    expect(EUROLEAGUE.teamFoulsCarryToOT).toBe(true); // FIBA Art. 41
    expect(EUROLEAGUE.foulOutAt).toBe(5);
  });

  it('advance-the-ball timeout is pack DATA: NBA and FIBA/EuroLeague have it, NCAA men do not (audit M-11)', () => {
    // NBA: the last-two-minutes advance. FIBA: frontcourt throw-in line
    // after a late timeout, Art. 17.2.4 (2018 rules) — EuroLeague plays
    // FIBA rules. NCAA men: no such rule, the throw-in stays where play
    // stopped — sim/endgame.ts maybeTimeout gates the 'advance' reason on
    // this field, so an NCAA stream can never contain one.
    expect(NBA.advanceAfterTimeout).toBe(true);
    expect(EUROLEAGUE.advanceAfterTimeout).toBe(true);
    expect(NCAA.advanceAfterTimeout).toBe(false);
  });
});

describe('bonusFreeThrowAward (pure rules arithmetic)', () => {
  it('NCAA: nothing below 7, one-and-one 7-9, flat two from 10 on', () => {
    expect(bonusFreeThrowAward(NCAA, 6)).toBe(null);
    expect(bonusFreeThrowAward(NCAA, 7)).toEqual({ shots: 2, oneAndOne: true });
    expect(bonusFreeThrowAward(NCAA, 9)).toEqual({ shots: 2, oneAndOne: true });
    expect(bonusFreeThrowAward(NCAA, 10)).toEqual({ shots: 2, oneAndOne: false });
    expect(bonusFreeThrowAward(NCAA, 15)).toEqual({ shots: 2, oneAndOne: false });
  });

  it('NBA: nothing below 5, flat two from 5 on — never a one-and-one', () => {
    expect(bonusFreeThrowAward(NBA, 4)).toBe(null);
    expect(bonusFreeThrowAward(NBA, 5)).toEqual({ shots: 2, oneAndOne: false });
    expect(bonusFreeThrowAward(NBA, 9)).toEqual({ shots: 2, oneAndOne: false });
  });

  it('EuroLeague: flat two from 5 on, same shape as the NBA', () => {
    expect(bonusFreeThrowAward(EUROLEAGUE, 4)).toBe(null);
    expect(bonusFreeThrowAward(EUROLEAGUE, 5)).toEqual({ shots: 2, oneAndOne: false });
    expect(bonusFreeThrowAward(EUROLEAGUE, 11)).toEqual({ shots: 2, oneAndOne: false });
  });
});

// ------------------------------------------------- §2 behavior (event stream)

function playEvents(seed: string, rules?: RulePack): GameEvent[] {
  const { home, away } = sampleMatchup();
  return simulateGame({ seed, home, away, rules, collectFrames: false }).events;
}

/** A non-shooting bonus trip reconstructed from the stream: the foul that opened it plus its free-throw attempts. */
interface BonusTrip {
  teamCount: number;
  attempts: { n: number; of: number; made: boolean; oneAndOne: boolean }[];
  /** first rebound event after the trip's last FT, before any foul/shot/turnover/period_end */
  nextRebound: { deadBall: boolean } | null;
}

/**
 * Fold non-shooting bonus trips (reach-in / loose-ball fouls with inBonus)
 * out of an event stream. Shooting-foul and and-one trips are excluded —
 * their FT count comes from the shot, not the bonus. Substitution and other
 * bookkeeping events between the foul and the line are skipped, matching how
 * the engine actually emits (checkSubs can fire inside enterFreeThrows).
 */
function collectBonusTrips(events: GameEvent[]): BonusTrip[] {
  const trips: BonusTrip[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type !== 'foul' || !e.inBonus || (e.kind !== 'reach' && e.kind !== 'loose_ball')) continue;
    const trip: BonusTrip = { teamCount: e.teamCountInPeriod, attempts: [], nextRebound: null };
    for (let j = i + 1; j < events.length; j++) {
      const x = events[j]!;
      if (x.type === 'free_throw') {
        trip.attempts.push({ n: x.n, of: x.of, made: x.made, oneAndOne: x.oneAndOne === true });
        continue;
      }
      if (x.type === 'rebound' && trip.attempts.length > 0 && trip.nextRebound === null) {
        trip.nextRebound = { deadBall: x.deadBall === true };
        // a dead-ball formality sits INSIDE the trip (between attempts) —
        // keep scanning for the remaining attempts; a live rebound ends it
        if (!x.deadBall) break;
        continue;
      }
      if (x.type === 'foul' || x.type === 'shot' || x.type === 'turnover' || x.type === 'period_end') break;
    }
    if (trip.attempts.length > 0) trips.push(trip);
  }
  return trips;
}

describe('one-and-one sequencing in NCAA games (R1)', () => {
  // Fixed seed prefix, bounded scan: keep simulating until the stream has
  // shown at least two missed front ends (the interesting case), so the
  // live-ball assertions below are actually exercised. At ~2 one-and-one
  // trips/game and league FT% ~75-80 on these rosters, 12 games without two
  // misses would itself be evidence something is wrong.
  const trips: BonusTrip[] = [];
  let games = 0;
  for (; games < 12; games++) {
    trips.push(...collectBonusTrips(playEvents(`oao-${games}`, NCAA)));
    if (trips.filter((t) => t.attempts[0]!.oneAndOne && !t.attempts[0]!.made).length >= 2) {
      games++;
      break;
    }
  }
  const oneAndOnes = trips.filter((t) => t.teamCount >= 7 && t.teamCount <= 9);
  const doubles = trips.filter((t) => t.teamCount >= 10);

  it(`the sample exercises both tiers (${games} games: ${oneAndOnes.length} one-and-one, ${doubles.length} double-bonus trips)`, () => {
    expect(oneAndOnes.length).toBeGreaterThan(0);
    expect(doubles.length).toBeGreaterThan(0);
    expect(oneAndOnes.filter((t) => !t.attempts[0]!.made).length).toBeGreaterThanOrEqual(2);
  });

  it('team fouls 7-9: every trip is stamped one-and-one with a potential 2', () => {
    for (const t of oneAndOnes) {
      expect(t.attempts[0]!.oneAndOne).toBe(true);
      expect(t.attempts[0]!.of).toBe(2);
    }
  });

  it('a missed front end ends the trip: no second attempt, and the rebound is LIVE (never the dead-ball formality)', () => {
    for (const t of oneAndOnes) {
      if (t.attempts[0]!.made) continue;
      expect(t.attempts.length).toBe(1);
      // period-end horn can preempt the scramble; otherwise the next board
      // off the miss must be a real live rebound
      if (t.nextRebound !== null) expect(t.nextRebound.deadBall).toBe(false);
    }
  });

  it('a made front end earns the second attempt', () => {
    for (const t of oneAndOnes) {
      if (!t.attempts[0]!.made) continue;
      expect(t.attempts.length).toBe(2);
      expect(t.attempts[1]!.n).toBe(2);
    }
  });

  it('team fouls 10+: the double bonus is a flat two — both attempts always happen, no one-and-one stamp, missed first shots log the dead-ball formality', () => {
    for (const t of doubles) {
      expect(t.attempts.length).toBe(2);
      expect(t.attempts[0]!.oneAndOne).toBe(false);
      expect(t.attempts[1]!.oneAndOne).toBe(false);
      if (!t.attempts[0]!.made) {
        // contrast with the front-end-miss case: the ball is DEAD between
        // attempts of a two-shot trip, so the formality rebound appears
        expect(t.nextRebound?.deadBall).toBe(true);
      }
    }
  });
});

describe('NBA bonus unchanged (control for R1)', () => {
  const trips = [
    ...collectBonusTrips(playEvents('nba-bonus-0')),
    ...collectBonusTrips(playEvents('nba-bonus-1'))
  ];

  it('bonus trips exist in the sample', () => {
    expect(trips.length).toBeGreaterThan(0);
  });

  it('every bonus trip from 5 team fouls on is a flat two: both attempts, never a one-and-one stamp', () => {
    for (const t of trips) {
      expect(t.teamCount).toBeGreaterThanOrEqual(5);
      expect(t.attempts.length).toBe(2);
      expect(t.attempts[0]!.oneAndOne).toBe(false);
      expect(t.attempts[1]!.oneAndOne).toBe(false);
    }
  });
});

// ------------------------------------------------------- §3 OT foul carryover

/**
 * Per-side team-foul evidence for the OT-carryover check, reconstructed from
 * foul events' stamped teamCountInPeriod. Only COUNTING fouls (kind !==
 * 'offensive') move the count, so offensive fouls are ignored on both sides
 * of the comparison.
 */
function otFoulEvidence(events: GameEvent[], regulationPeriods: number): {
  wentToOT: boolean;
  perSide: { lastRegCount: number; firstOTCount: number | null }[];
} {
  let wentToOT = false;
  const perSide = [
    { lastRegCount: 0, firstOTCount: null as number | null },
    { lastRegCount: 0, firstOTCount: null as number | null }
  ];
  for (const e of events) {
    if (e.type === 'period_start') continue;
    if (e.type === 'foul' && e.kind !== 'offensive') {
      const side = perSide[e.team]!;
      if (e.period === regulationPeriods) side.lastRegCount = e.teamCountInPeriod;
      if (e.period === regulationPeriods + 1 && side.firstOTCount === null) {
        wentToOT = true;
        side.firstOTCount = e.teamCountInPeriod;
      }
    }
    if (e.type === 'period_end' && e.period > regulationPeriods) wentToOT = true;
  }
  return { wentToOT, perSide };
}

/**
 * Scan seeds for an OT game where at least one side has both a counting foul
 * in the final regulation period AND one in the first OT — the minimal
 * evidence that distinguishes carryover from reset. Runs on a pack scaled to
 * 2-minute periods purely to make ties (and therefore OT) cheap to find: the
 * branch under test — endPeriod's reset on entering OT — never reads
 * periodMinutes, so the scaled pack exercises exactly the real packs' logic.
 */
function findOTEvidence(rules: RulePack, tag: string): { lastRegCount: number; firstOTCount: number }[] {
  const scaled: RulePack = { ...rules, periodMinutes: 2 };
  for (let i = 0; i < 120; i++) {
    const ev = otFoulEvidence(playEvents(`${tag}-${i}`, scaled), scaled.periods);
    if (!ev.wentToOT) continue;
    const usable = ev.perSide.filter(
      (s): s is { lastRegCount: number; firstOTCount: number } =>
        s.firstOTCount !== null && s.lastRegCount > 0
    );
    if (usable.length > 0) return usable;
  }
  throw new Error(`no OT game with usable foul evidence in 120 seeds for ${tag} — scan bound too tight?`);
}

describe('OT team-foul carryover (R4)', () => {
  it('NCAA: the first counting foul in OT continues the second-half count', () => {
    const sides = findOTEvidence(NCAA, 'otscan');
    for (const s of sides) {
      expect(s.firstOTCount).toBe(s.lastRegCount + 1);
    }
  });

  it('NBA: OT restarts the count at 1 regardless of the fourth-quarter count', () => {
    const sides = findOTEvidence(NBA, 'otscan-nba');
    for (const s of sides) {
      expect(s.firstOTCount).toBe(1);
    }
  });
});
