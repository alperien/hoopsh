/**
 * Rule packs make leagues swappable data, not code.
 * NBA ships first; NCAA and EuroLeague follow the same interface.
 * Custom leagues are just JSON.
 *
 * Calibration status: NBA is the tuned, shipped pack — every probability
 * model in sim/resolve.ts and SimParams was fit assuming NBA's numbers below.
 * NCAA and EuroLeague are STRUCTURAL stubs: their court/clock/foul numbers
 * are the real, correct rule-book values for those leagues, but the
 * probability models themselves are not re-tuned for league-specific pace,
 * spacing, or skill distributions — swapping to NCAA today changes the
 * court/clock/foul math correctly but still plays like an NBA-caliber roster
 * on a smaller floor. Real per-league calibration is future work (see the
 * "league-expansion milestone" note below, kept from the original stub
 * comment).
 */

export interface ThreePointGeometry {
  /** arc radius from rim center, ft */
  arcRadiusFt: number;
  /** lateral distance from rim center to the straight corner line, ft */
  cornerDistFt: number;
  /** distance from baseline where the corner line meets the arc, ft */
  cornerBreakFt: number;
}

export interface RulePack {
  id: string;
  name: string;

  // court
  courtLengthFt: number;
  courtWidthFt: number;
  /** rim center distance from baseline */
  rimInsetFt: number;
  /**
   * UNWIRED — the paint/lane width (NBA 16 ft). Declared for completeness but
   * read nowhere: classifyShot() zones by rim distance (4/14 ft) rather than
   * lane geometry. Wire this when the post-up game needs true lane boundaries.
   */
  keyWidthFt: number;
  /** free-throw line distance from baseline */
  ftLineFt: number;
  three: ThreePointGeometry;

  // game format
  /** regulation periods (4 for NBA/EuroLeague quarters, 2 for NCAA halves) */
  periods: number;
  /** minutes per regulation period */
  periodMinutes: number;
  /** minutes per overtime period — always 5 across every pack below, matching real overtime length in each of these leagues */
  otMinutes: number;

  // clocks
  /** seconds a team has to attempt a shot before a shot-clock turnover (sim/game.ts tickLive) */
  shotClockSec: number;
  /** shot clock after an offensive rebound — shorter than a fresh possession's clock since the ball never left the frontcourt */
  shotClockOffRebSec: number;

  // fouls
  /** team fouls in a period that put the opponent in the bonus (non-shooting fouls start awarding free throws once reached) — sim/fouls.ts recordFoul's `inBonus` check */
  teamFoulBonusAt: number;
  /**
   * Shape of the bonus's FIRST tier — what a non-shooting defensive foul
   * awards from `teamFoulBonusAt` up to (not including) `doubleBonusAt`
   * (see bonusFreeThrowAward below):
   *  - 'flat'      — a fixed `bonusFreeThrows`-shot trip from the first bonus
   *                  foul on (modern NBA and FIBA/EuroLeague rule).
   *  - 'oneAndOne' — the shooter gets one attempt and EARNS the second only
   *                  by making the first; a front-end miss is a LIVE ball
   *                  (rebound scramble, sim/fouls.ts tickFreeThrows). This is
   *                  the CURRENT NCAA men's rule for team fouls 7-9 — not a
   *                  historical variant (a previous version of this comment
   *                  got that wrong; NCAA *women* are the ones who dropped
   *                  the one-and-one, and that's a different pack entirely).
   */
  bonusRule: 'flat' | 'oneAndOne';
  /**
   * Team fouls in a period at which EVERY bonus trip becomes a flat
   * `bonusFreeThrows`-shot award (the "double bonus"). Only meaningfully
   * distinct from `teamFoulBonusAt` under bonusRule 'oneAndOne' (NCAA men:
   * one-and-one at 7-9, double bonus at 10+). Flat-rule packs set it equal
   * to `teamFoulBonusAt`: the flat bonus IS the two-shot award from its
   * first foul, so the one-and-one window [teamFoulBonusAt, doubleBonusAt)
   * is empty by construction.
   */
  doubleBonusAt: number;
  /** free throws awarded on a flat bonus trip — i.e. at `doubleBonusAt`+ team fouls, and at every bonus trip for bonusRule 'flat' (sim/passing.ts attemptReachIn, sim/possession.ts tickScramble via fouls.ts recordFoul) */
  bonusFreeThrows: number;
  /**
   * Whether period team-foul counts CARRY into overtime instead of resetting
   * (sim/possession.ts endPeriod). NCAA men: true — team fouls reset only at
   * the end of the first half, so OT (and every further OT) inherits the
   * second half's running count (NCAA/NFHS Major Rules Differences, see
   * data/ncaa/README.md R4). FIBA/EuroLeague: true — extra periods are an
   * extension of the fourth period (FIBA Official Rules, Art. 41). NBA:
   * false — the count restarts each OT (the NBA's separate, lower OT bonus
   * threshold of 4 team fouls is NOT modeled; out of scope per R4).
   */
  teamFoulsCarryToOT: boolean;
  /** personal fouls that disqualify a player (sim/fouls.ts recordFoul's fouledOut check, sim/subs.ts replaceFouledOut) */
  foulOutAt: number;

  // timeouts
  /**
   * Team timeouts per game (flat per-game simplification of each league's
   * real budget rules — no per-half carryover or last-two-minute caps yet).
   * Consumed only by the endgame layer (sim/endgame.ts maybeTimeout).
   * GameConfig.endgame ships ON by default (the n=1260/arm survey flip), so
   * default-config games DO spend these; only an explicit `endgame: false`
   * legacy run leaves the budget untouched.
   */
  timeoutsPerGame: number;
  /**
   * Whether a late-game timeout lets the inbounding team ADVANCE the ball to
   * its frontcourt (sim/endgame.ts maybeTimeout reason 'advance', staged by
   * sim/possession.ts setupDeadTargets). True where the rule book has it:
   * NBA (last two minutes of Q4/OT) and FIBA/EuroLeague (FIBA Official
   * Rules Art. 17.2.4, frontcourt throw-in line, since the 2018 rules).
   * NCAA men have NO such rule — the throw-in stays where play stopped —
   * so a false here removes both the advance timeout and the
   * save-a-timeout-for-it suppression on stop-the-run calls.
   */
  advanceAfterTimeout: boolean;
}

export const NBA: RulePack = {
  id: 'nba',
  name: 'NBA',
  // 94x50 ft: the full NBA court footprint.
  courtLengthFt: 94,
  courtWidthFt: 50,
  // 5.25 ft: rim center sits this far in from the baseline (see geometry/court.ts makeCourt).
  rimInsetFt: 5.25,
  keyWidthFt: 16,
  // 19 ft: the real free-throw line distance from the baseline (see geometry/court.ts makeCourt).
  ftLineFt: 19,
  // real NBA three-point geometry: 23.75 ft arc, clipped to a 22 ft straight
  // corner line out to 14 ft from the baseline (see geometry/court.ts classifyShot).
  three: { arcRadiusFt: 23.75, cornerDistFt: 22, cornerBreakFt: 14 },
  periods: 4,
  periodMinutes: 12,
  otMinutes: 5,
  // 24-second shot clock; 14 seconds on an offensive rebound — real NBA rules.
  shotClockSec: 24,
  shotClockOffRebSec: 14,
  // bonus at 5 team fouls in a period, always a flat 2 free throws (so the
  // "double bonus" threshold coincides with the bonus itself), team fouls
  // reset every period including OT, disqualification at 6 personal fouls —
  // the real modern NBA thresholds. (The real NBA also drops the OT bonus
  // threshold to 4 and has a last-2:00 team-foul rule; neither is modeled.)
  teamFoulBonusAt: 5,
  bonusRule: 'flat',
  doubleBonusAt: 5,
  bonusFreeThrows: 2,
  teamFoulsCarryToOT: false,
  foulOutAt: 6,
  // 7 team timeouts per game — the real modern NBA budget (the real rule
  // also caps usage at 4 in the fourth period / 2 in the last three minutes;
  // that refinement is future work, see the interface note).
  timeoutsPerGame: 7,
  // the NBA advance-the-ball rule: a timeout in the last two minutes of the
  // fourth period/OT moves the throw-in to the frontcourt hashmark
  advanceAfterTimeout: true
};

/** placeholder stubs — tuned packs land with the league-expansion milestone */
export const NCAA: RulePack = {
  ...NBA,
  id: 'ncaa',
  name: 'NCAA (men)',
  // NCAA lane is 12 ft wide (NBA 16) — official court diagram, see
  // data/ncaa/README.md R2. Still UNWIRED (see the interface note), but the
  // pack must ship the correct league constant; this previously inherited
  // the NBA's 16 via the spread above.
  keyWidthFt: 12,
  // NCAA men's three-point line: shorter arc (22.15 ft) and much shallower
  // corner break (9.85 ft vs the NBA's 14 ft) — the corner line meets the arc
  // much closer to the baseline than in the NBA.
  three: { arcRadiusFt: 22.15, cornerDistFt: 21.65, cornerBreakFt: 9.85 },
  // NCAA plays two 20-minute halves rather than four quarters.
  periods: 2,
  periodMinutes: 20,
  // longer 30-second shot clock (20 after an offensive rebound) than the NBA's 24/14.
  shotClockSec: 30,
  shotClockOffRebSec: 20,
  // NCAA men's bonus (NCAA/NFHS Major Rules Differences, data/ncaa/README.md
  // R1): ONE-AND-ONE on team fouls 7-9 of a half — make the front end to earn
  // the second shot, miss it and the ball is live — then a flat two-shot
  // "double bonus" from the 10th team foul. Counts are per HALF (periods are
  // halves here, so the engine's per-period reset is the halftime reset) and
  // carry into overtime (R4: fouls reset only at the END of the first half).
  // Disqualification is stricter than the NBA's (5 personal fouls, not 6).
  // KNOWN SIMPLIFICATION: WHICH fouls count toward these thresholds is code,
  // not pack data — sim/fouls.ts applies the NBA counting rule (offensive
  // fouls are personal-only) under every pack, while NCAA men count
  // player-control fouls toward the team-foul total (never awarding shots),
  // so this pack under-counts toward its 7/10 thresholds (docs/INTERNALS.md
  // known simplifications; a10 contract scan F5). The threshold NUMBERS
  // above are the real rule-book values.
  teamFoulBonusAt: 7,
  bonusRule: 'oneAndOne',
  doubleBonusAt: 10,
  teamFoulsCarryToOT: true,
  foulOutAt: 5,
  // NCAA: 4 timeouts (3×30s + 1×60s) in the flat per-game simplification —
  // media-timeout structure is out of scope, same as the NBA note above.
  timeoutsPerGame: 4,
  // NCAA men have NO advance-the-ball rule: after any timeout the throw-in
  // is at the spot nearest where play stopped (this previously inherited
  // the NBA's true via the spread and NCAA endgames got the NBA advance —
  // audit M-11)
  advanceAfterTimeout: false
};

/** like NCAA, a structural stub — real EuroLeague rule-book numbers below, but not independently probability-tuned; see the calibration-status note above. */
export const EUROLEAGUE: RulePack = {
  ...NBA,
  id: 'euroleague',
  name: 'EuroLeague',
  // FIBA court dimensions in feet (28m x 15m), slightly smaller than the NBA's 94x50.
  courtLengthFt: 91.86,
  courtWidthFt: 49.21,
  // 5.15 ft: FIBA's rim-to-baseline distance, marginally different from the NBA's 5.25 ft.
  rimInsetFt: 5.15,
  // FIBA's three-point line: same shorter arc as NCAA (22.15 ft) with a similarly shallow corner break (9.85 ft).
  three: { arcRadiusFt: 22.15, cornerDistFt: 21.65, cornerBreakFt: 9.85 },
  // EuroLeague keeps four periods like the NBA, but shorter 10-minute ones.
  periods: 4,
  periodMinutes: 10,
  shotClockSec: 24,
  shotClockOffRebSec: 14,
  // bonus at 5 team fouls like the NBA — and like the NBA it's the flat
  // two-shot award from the first bonus foul (FIBA has no one-and-one; see
  // data/ncaa/README.md §6.1, which contrasts only NCAA men against the flat
  // rule) — but disqualification is stricter (5 personal fouls, FIBA rules),
  // and team fouls CARRY into overtime: FIBA Official Rules Art. 41 treats
  // extra periods as an extension of the fourth period.
  teamFoulBonusAt: 5,
  bonusRule: 'flat',
  doubleBonusAt: 5,
  teamFoulsCarryToOT: true,
  foulOutAt: 5,
  // FIBA/EuroLeague: 2 first-half + 3 second-half timeouts, flattened to 5
  // per game (same simplification as the other packs).
  timeoutsPerGame: 5,
  // FIBA has the advance since its 2018 rules: after a timeout taken by the
  // team entitled to a backcourt throw-in in the last two minutes of the
  // fourth period/OT, play resumes at the frontcourt throw-in line (FIBA
  // Official Rules Art. 17.2.4). Stated explicitly rather than inherited —
  // rule provenance belongs on the pack.
  advanceAfterTimeout: true
};

/**
 * What a bonus free-throw trip awards.
 *
 * `shots` is the number of attempts the trip can REACH — for a one-and-one
 * that's 2, but the second attempt exists only if the first is made
 * (sim/fouls.ts tickFreeThrows owns that sequencing; a front-end miss ends
 * the trip with a live ball).
 */
export interface BonusAward {
  shots: number;
  /** true: this trip is a one-and-one — the second shot must be earned */
  oneAndOne: boolean;
}

/**
 * Free throws a non-shooting DEFENSIVE foul awards, given the fouling team's
 * period team-foul count with this foul included. Returns null when the
 * fouling team is not yet in the bonus (play resumes with a side-out, no
 * shots). Pure rules arithmetic, deliberately stateless so it can be unit
 * tested against the rule book without a GameState; the live sequencing
 * (front-end-miss live rebound) lives in sim/fouls.ts.
 *
 * Shooting fouls never route through this — their FT count comes from the
 * shot (2/3/and-one) regardless of the bonus.
 */
export function bonusFreeThrowAward(rules: RulePack, teamFoulsInPeriod: number): BonusAward | null {
  if (teamFoulsInPeriod < rules.teamFoulBonusAt) return null;
  if (rules.bonusRule === 'oneAndOne' && teamFoulsInPeriod < rules.doubleBonusAt) {
    return { shots: 2, oneAndOne: true };
  }
  return { shots: rules.bonusFreeThrows, oneAndOne: false };
}
