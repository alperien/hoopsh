/**
 * The sweepable knob registry: which SimParams the optimizer may touch,
 * and the sane range for each. Paths are dot-notation into SimParams
 * (resolved by getPath below into packages/engine/src/sim/params.ts'
 * nested SimParams object — see that file for what each individual constant
 * physically means; this file only adds the SEARCH-relevant metadata: is it
 * sweepable at all, and if so, what's the safe range to perturb it within).
 *
 * WHAT MAKES A KNOB SWEEPABLE vs. deliberately excluded: a knob belongs here
 * only if it's a CALIBRATION lever — a constant whose value affects realism
 * metrics (the NBA_BANDS) but doesn't change what a rating or rule MEANS.
 * Deliberately NOT swept, on principle rather than oversight:
 *   - tick rate / geometry / rules constants (court dimensions, shot-clock
 *     length, foul-out threshold, …) — these are FACTS about the sport, not
 *     free parameters; sweeping them would "calibrate" by breaking the rules
 *     instead of tuning behavior within them;
 *   - rating curves (model/derived.ts — what "90 speed" cashes out to in
 *     ft/sec, what "70 three" cashes out to in shot-make logits) — these
 *     define what a rating physically IS. If the sweep could freely rescale
 *     them, two runs of the search could reach equally-passing-bands league
 *     averages that mean completely different things by a rating value, and
 *     archetype fixtures (data/archetypes.ts) would stop being trustworthy
 *     acceptance tests for "does 99 three feel like a 99 three shooter";
 *   - anything that would change a RULE's shape rather than its rate (e.g.
 *     which fouls exist, how bonus free throws are awarded) — those are
 *     `rules/rulepack.ts` data, not sim/params.ts numbers, and aren't even
 *     addressable by a SimParams dot-path in the first place.
 * In short: design decisions (what does this rating/rule mean) are off
 * limits; calibration decisions (how often does this happen at the margin)
 * are the whole point of this registry. When in doubt, ask "does nudging
 * this value change what a player/rule IS, or just how often something
 * fires" — the sweep only ever touches the latter.
 *
 * Each `lo`/`hi` here is a SEARCH SAFETY RAIL, not itself a calibration
 * claim — it just bounds how far perturb() (sweep.ts) is allowed to push a
 * knob away from its params.ts default before clamping. A range that's too
 * narrow starves the search of the room it needs to fix a drifted band; too
 * wide and the search wastes iterations exploring values a human would
 * immediately recognize as basketball-nonsensical (e.g. a rim make-chance
 * so high blocks become mathematically irrelevant). The ranges below were
 * hand-picked around each constant's shipped SWEPT/REAL value (see
 * params.ts) with enough headroom for the search to move meaningfully in
 * either direction — see the per-group notes for anything non-obvious about
 * a specific range's shape.
 */

export interface Knob {
  path: string;
  lo: number;
  hi: number;
}

export const SWEEPABLE: Knob[] = [
  // Pace & decision economy — these knobs mostly move HOW MANY possessions
  // happen and HOW they're spent (shoot now vs. keep working), so they're
  // the primary levers on the 'pace', 'fga', and shot-mix-adjacent bands.
  { path: 'decide.continuationMax', lo: 1.3, hi: 1.72 },
  { path: 'decide.continuationCurve', lo: 0.14, hi: 0.45 },
  { path: 'decide.temperature', lo: 0.035, hi: 0.09 },
  { path: 'decide.intervalSec', lo: 0.55, hi: 0.9 },
  // threeAppetite/driveAppetite ranges stay centered near 1.0 (neutral) —
  // these are ERA KNOBS by design (see params.ts's comment on them: a 1995
  // pack would set threeAppetite ≈ 0.4). Letting the sweep push them far
  // from 1.0 during MODERN-NBA calibration would blur the line between "the
  // search corrected a modeling bug" and "the search invented a fictional
  // era" — the range is deliberately tight enough that big swings still
  // have to come from an explicit era-pack override, not sweep drift.
  // threeAppetite hi widened 1.1 -> 1.45 after the texture increment:
  // quieter off-ball defense (stillness deadbands) guards shooters closer,
  // and pass-back damping cut swing volume — the catch-and-shoot economy
  // needed a stronger era knob to reach the 33%+ 3PA-share band again.
  { path: 'decide.threeAppetite', lo: 0.8, hi: 1.45 },
  // driveAppetite lo widened 0.9 -> 0.7 for the same reason: slower
  // defensive stances made drives cheap; the optimizer needs room to damp
  // the flood directly rather than only via contest penalties.
  { path: 'decide.driveAppetite', lo: 0.7, hi: 1.45 },
  { path: 'decide.transitionBonus', lo: 0.05, hi: 0.25 },

  // Shot resolution — the zone base rates and contest coefficient are THE
  // primary levers on FG%/3P%/eFG%/TS% bands; ftBasePct and blockBase are
  // narrower because they're each pinned close to a REAL/near-real anchor
  // (see params.ts: ftBasePct is measured from FT% by rating; blockBase
  // reallocates misses to blocks without touching FG%) rather than needing
  // wide exploration room.
  { path: 'shot.baseRim', lo: 0.4, hi: 0.78 },
  { path: 'shot.basePaint', lo: -0.72, hi: -0.25 },
  { path: 'shot.baseMid', lo: -0.85, hi: -0.45 },
  { path: 'shot.baseThree', lo: -1.02, hi: -0.65 },
  // contestCoef lo widened -1.5 -> -2.0 after the speed fix: the pin
  // experiment proved the shooting calibration had absorbed the overspeed
  // (slower world at fixed constants = FG%/ORtg UP), so re-fitting the
  // slower engine needs deeper contest punishment than the old prior —
  // the optimizer pinned ORtg 122-126 with every other dial at boundary.
  { path: 'shot.contestCoef', lo: -2.0, hi: -0.82 },
  { path: 'shot.blockBase', lo: 0.18, hi: 0.45 },
  // ftBasePct's floor was the fitted value itself ("explore up only"),
  // authored when league FT% read low. Post-endgame the league mix sits
  // ~2pp ABOVE the real 78.4% (league-averages-2023-24.json) and the 2026-07-28
  // sweep converged pinned at that floor — the wall, not the optimum. Floor
  // widened 0.69 → 0.66 so the sweep can trade the league mean down; identity
  // spread stays in ftSkillSwing/ftEliteKick, and the star-fixture FT
  // tripwires remain the guardrail against overcorrection.
  { path: 'shot.ftBasePct', lo: 0.66, hi: 0.75 },

  // Fouls — shootRim/shootPaint are THE lever on FTA/game (band 18-27, see
  // params.ts) and are flagged there as "the most coupling-sensitive knobs
  // in the file" (AGENTS.md §2.4's incident: raising one foul rate once
  // collapsed league 3P rate by 8 points through the FT-attempt/shot-attempt
  // interaction) — expect these two to move together with shot.* knobs
  // during a sweep rather than in isolation.
  // shootRim hi raised 0.52 -> 0.56 at the FLOW landing (ffit-rhythm §8
  // bake note): the fitted start point 0.51974 sat 0.0003 under the old
  // wall, and the optimizer has been wall-pinned here once before (0daa112).
  { path: 'foul.shootRim', lo: 0.26, hi: 0.56 },
  { path: 'foul.shootPaint', lo: 0.1, hi: 0.26 },
  { path: 'foul.reachInPerSec', lo: 0.008, hi: 0.026 },
  { path: 'foul.looseBallPerReb', lo: 0.01, hi: 0.04 },
  // Rhythm-wave levers (ffit-rhythm §8 bake note): the cumulative-load pool
  // and its foul-mix couplings went live with the FLOW flip; these ranges
  // hand the re-center sweep ownership instead of hand-nudging.
  { path: 'fatigue.loadPerSec', lo: 0.006, hi: 0.018 },
  { path: 'endgame.deadGameBoost', lo: 0.1, hi: 0.5 },
  { path: 'foul.loadReachSwing', lo: 0.6, hi: 2.0 },
  { path: 'foul.loadShootSwing', lo: 0.2, hi: 0.9 },
  // chargePerDrive is consumed per SECOND of committed drive time (see
  // params.ts: × dt × chargeTickMult), so the realized league rate rides on
  // drive exposure: at current exposure the rail spans ≈0.6 (lo) → ≈3.1 (hi)
  // offensive fouls per team-game around the default's ~1.3 (real NBA ~1.3).
  // The old unregistered 0.012 (≈4.6/tg, 3× real — what ate the pf band's
  // headroom) sits deliberately OUTSIDE the rail.
  { path: 'foul.chargePerDrive', lo: 0.0015, hi: 0.008 },

  // Turnovers — riskBase is the primary lever on TOV/game (band 11.5-15.5);
  // stealShare only redistributes the SAME turnover total between steals and
  // dead-ball (OOB) turnovers, so it's tuned by the STL band, not the TOV
  // band — moving it never changes total turnovers, just who "gets credit."
  //
  // riskBase rails narrowed [-4.3, -3.3] → [-3.8, -3.7] at the session-7
  // re-price (the ai.swingBase doctrine, both directions): the bands see
  // NEITHER of this dial's true walls. The HI wall is texture — the corpus
  // reads 2.84 passes/poss against the sim's ~1.6-1.7, and the region
  // above ~-3.7 re-creates the over-priced-risk economy the measured dose
  // grid priced at ~0.1 passes/poss per 0.15 logits. The LO wall is talent
  // separation — the -3.82 cell met bands with MORE volume but spent 4.2
  // points of favorite-win at n=1080 (the pre-registered -4.0 line), and
  // the sweep cannot see favorite-win any more than it can see volume.
  // Both walls are measured doctrine, revisable only with fresh
  // measurement (session-7 register row).
  { path: 'pass.riskBase', lo: -3.8, hi: -3.7 },
  { path: 'pass.stealShare', lo: 0.4, hi: 0.7 },

  // Rebounding — offWeightMult is THE lever on ORB% (band 20-30%, see
  // params.ts); missDistBase controls how far rebounds scatter from the
  // rim as a function of shot distance (a real, documented long-rebound
  // effect), which mostly affects who on the floor is positioned to grab
  // them rather than the total rebound count.
  { path: 'reb.offWeightMult', lo: 0.6, hi: 1.25 },
  { path: 'reb.missDistBase', lo: 3.0, hi: 5.5 },

  // AI utility layer — these tune the AI's DECISION weights (ball movement,
  // half-court patience, how hard a contest brakes a shot attempt, offensive
  // crash rate, cut frequency) rather than any single resolution
  // probability, so their effect on the bands is more diffuse/second-order
  // than the resolution-layer knobs above — expect the search to lean on
  // these later, for fine centering, rather than for the first big
  // corrections.
  // swingBase capped at 0.045: at 0.064 the sweep met every league band by
  // reviving hot-potato swing offense — assists re-pooled at wing hubs and
  // the floor-general hierarchy collapsed (Stage 2 incident). Ball-movement
  // intrinsic value is a STYLE lever; bands cannot see creation structure,
  // so the range must not let the optimizer trade it away.
  { path: 'ai.swingBase', lo: 0.0, hi: 0.045 },
  // Flow-tier levers (added with the game-flow gates; see
  // data/nba/flow-reference.json): steal->score-in-6s ran 13% vs the real
  // ~29% before the wave2 steal-break premium (decide.stealBreakBonus) —
  // these knobs keep transition texture reachable by the sweep.
  //
  // putbackChance RE-AIMED (wave2): the old [0.1, 0.5] range was built on a
  // WRONG reference — the anchor's 0.33 divided by all OREB rows including
  // ~38% team-rebound bookkeeping; the corrected 184-game corpus value is
  // 0.716 of PLAYER OREBs (flow-reference.json putbackWithin6sShareOfOreb,
  // grade A), so the sim's ~50% is too LOW, not too high. The range must
  // not invite the optimizer to suppress putbacks. Note the knob SATURATES
  // upward (probed 0.4532 -> 0.65: share flat at ~52% — the auto branch
  // only reaches <6 ft rim grabs); the remaining gap lives in post-OREB
  // patience (14s-clock continuation ≈ 1.36 vs a contested second-chance
  // look), which belongs to the decide-tier knobs.
  { path: 'reb.putbackChance', lo: 0.35, hi: 0.8 },
  // …and the saturation wall named above, now reachable (audit H-01 hoist
  // from possession.ts): the putback-eligibility radius is the
  // mutation-proven volume lever (6 → 0 dropped putbacks 199 → 96 over 40
  // games) and it binds putbackChance's upward range — expect the pair to
  // move together. The rail brackets the paint: 4 ft (restricted-area grabs
  // only) to 9 ft (the whole lane).
  { path: 'reb.putbackRadiusFt', lo: 4, hi: 9 },
  { path: 'ai.driveTransitionMult', lo: 1.0, hi: 2.4 },
  { path: 'ai.transitionPullUpBonus', lo: 0.2, hi: 0.8 },
  { path: 'ai.holdHalfcourt', lo: -0.08, hi: 0.05 },
  { path: 'ai.contestBrakeBase', lo: 0.3, hi: 0.75 },
  { path: 'ai.crashBase', lo: 0.15, hi: 0.4 },
  // crashBase's geometry sibling (audit H-01 hoist from ai/offense.ts): how
  // wide crashers spread around the rim shapes second-chance POSITIONING —
  // tight (2 ft) piles everyone into the restricted area, wide (8 ft)
  // covers long caroms. A rebound-path magnitude ("how well does the crash
  // work"), not a window/threshold, so it belongs on the surface with the
  // crash rate itself.
  { path: 'ai.crashScatterFt', lo: 2, hi: 8 },
  { path: 'ai.cutRateScale', lo: 0.003, hi: 0.011 },
  // Mid-range restoration (wave2/midrange): the demand term's magnitude and
  // the supply line's pop rate are the two calibration levers on mid-range
  // volume (real 14-19.5 ft band ≈ 6.8% of FGA; the sim ran 1.4% before the
  // mechanism landed). The green-light SHAPE (tendency floor, distance
  // ceiling, pop-eligibility cut) is identity definition — what a mid-range
  // player IS — and stays off the sweep surface, same doctrine as
  // pnrRollGravityCut and dunkerGravityThreshold.
  { path: 'ai.midRangeBonus', lo: 0.25, hi: 0.9 },
  { path: 'ai.pnrMidPopChance', lo: 0.2, hi: 0.75 },
  { path: 'ai.driveMidStopChance', lo: 0.15, hi: 0.6 },
  // midRangeBonus's off-dribble-three sibling (concept-1 flavor; the
  // green-light gate shape stays off the surface, same doctrine). Range
  // re-based around the flow re-fit's 0.70 (refit-g5: the measured dose
  // curve is convex — 0.35 → 2.50 unassisted made 3s/g, 0.70 → 3.81 vs
  // gate floor 3.0). The lo rail sits at the old fitted 0.35, the dose
  // table's known do-little point; note 0.70 buys G5 by spending
  // assisted-share floor margin (center 54.7 vs floor 54), so a sweep
  // moving this dial should watch astdShare with it.
  { path: 'ai.pullUpThreeBonus', lo: 0.35, hi: 1.0 },
  // #74 transition carry (unassisted-creation arc, increment 1): the
  // per-possession arming chance of the beaten-break gather-through-windup
  // carry — pure dose, so the whole [0, 1] interval is legal. The landing
  // value is FEEL (the increment selects it against the fgPct ceiling; see
  // the params.ai comment); registered so the coordinated re-sweep can
  // trade the carry's make surplus against the jumper economy it funds.
  // The beaten-break SHAPE (defendersBack < transSetBackCount, the gather
  // riding the existing windup) is definition, not calibration, and stays
  // off the surface — as does the F1 gather gate (ai.transCarryGatherFt):
  // reach is part of what a carry IS, and a sweep pushing it outward
  // would re-create the unbounded release-gap tail the bound exists to
  // remove (PR #75 probe F1).
  { path: 'ai.transCarryScale', lo: 0, hi: 1 },

  // Endgame layer (params.endgame; live only under GameConfig.endgame) —
  // registered for the flag-ON coordinated re-sweep: the n=1260/arm flag-on
  // survey measured fga 93.31 vs its 92.0 ceiling (3/3 seed bases), driven
  // by the layer's possession mix (hurry quick shots, 2-for-1 early
  // releases, fewer milked violations), so re-centering has to trade these
  // magnitudes against the pace/volume knobs. In a flag-OFF run they are
  // unread — dead search dimensions — so sweep with the flag on (or once it
  // defaults on). Only MAGNITUDE dials are registered; the window/threshold
  // dials (leadHoldClockSec, hurryClockSec, the 2-for-1 window, the foul
  // window/deficit gates), the chase-aliveness arithmetic (when a deficit
  // reads dead), hunt geometry, and the timeout triggers stay OFF the
  // surface: they define WHEN a real coach's behavior activates —
  // identity-shape, same doctrine as the mid-range green-light shape above.
  // timeoutRunPts additionally has no cited real base rate to calibrate
  // against (nba-ground-truth row 34): nothing for a band to aim at.
  //
  // endgame.scale was DE-REGISTERED at the FLOW landing (was [0.5, 1.5]):
  // it is a style lever the band objective cannot see. The assembly
  // re-sweep sold the Q4-min quarter shape through it (scale 1 → 0.5
  // flattened G7's quarter curve while buying pace/ortg); restoring 1 put
  // the shape back for 2 verify edge-fails (f-assembly §6.1, confirmed
  // from the reach side by knot-combo §5.1). The ai.swingBase precedent,
  // verbatim: bands cannot see flow structure, so the range must not let
  // the optimizer trade it away. Re-register only if the flow gates join
  // the sweep objective.
  { path: 'endgame.leadHoldMaxBoost', lo: 0.25, hi: 0.8 },
  { path: 'endgame.hurryMaxCut', lo: 0.25, hi: 0.7 },
  // probed at 0.3 the 2-for-1 window's shot rate barely moved over flag-off
  // (params.ts: the tent shape halves the average cut) — lo sits at that
  // measured do-nothing point rather than lower
  { path: 'endgame.twoForOneCut', lo: 0.3, hi: 0.7 },
  // multiplies foul.reachInPerSec (itself swept above): the PAIR sets
  // late-game foul-parade FT volume — expect them to move together
  { path: 'endgame.foulHuntRateMult', lo: 30, hi: 90 },

  // Concept 7 (score pressure) master — budgets the live channel-2
  // defensive-intensity coupling (scale × scorePressureDefGain; the gain
  // itself is a FITTED magnitude, θ-ladder provenance in params.ts, and
  // stays OFF the surface — the master is the one sweep-owned dial, the
  // shape endgame.scale had before its de-registration above). The lo
  // rail is a DISTRIBUTIONAL floor,
  // not a band-safety bound: the band objective cannot see what this knob
  // is for — margin mean-reversion, blowout tails, corr(h,a) are
  // distributional stats in no scoring path — so a sweep chasing league
  // means could zero the coupling at no visible cost and silently
  // re-fatten the 30+ tail. 0.5 keeps at least half the fitted reversion;
  // the oos distributional report is the backstop that catches drift the
  // bands can't. Same doctrine as the ai.swingBase cap above ("bands
  // cannot see creation structure").
  { path: 'ai.scorePressureScale', lo: 0.5, hi: 1.5 }
];

/** set a dot-path on a nested object (mutates).
 *
 * UNWIRED — no consumer in the repo today (AGENTS.md DO-NOT #5; scan
 * finding B2-4): sweep.ts builds candidate override objects with its own
 * nested-object builder (evaluateCandidate) and reads knobs only via
 * getPath. Wiring condition: a tool that needs to mutate a params object in
 * place along a knob path; if the next change to this file still finds no
 * caller, delete it. */
export function setPath(obj: Record<string, unknown>, path: string, value: number): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]!] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** get a dot-path from a nested object */
export function getPath(obj: Record<string, unknown>, path: string): number {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur as number;
}
