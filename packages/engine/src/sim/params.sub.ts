/**
 * SimParams block `sub` — rotation thresholds, crunch/concede regimes,
 * minutes controller.
 *
 * Split out of sim/params.ts (#36): this module owns the block's interface,
 * calibrated defaults, and machine-readable per-knob provenance. The composed
 * surface (SimParams, defaultParams, paramProvenance, withParams) and the
 * reading guide for these numbers (logits, units, coupling) stay in
 * sim/params.ts. Values and comments moved verbatim at the split; provenance
 * tag meanings and adjudication rules live in params.provenance.ts.
 */

import type { Provenance } from './params.provenance.js';

export interface SubParams {
  /** energy threshold that queues a substitution at the next dead ball */
  tiredThreshold: number;
  /** extra energy points a bench player is pulled earlier than a starter */
  benchTiredBonus: number;
  rotationLeashScale: number;  // energy-leash points per 100% of minutes-pace deviation
  rotationLeashMax: number;    // leash adjustment cap (energy points)
  /** energy at which a bench player is considered ready */
  readyThreshold: number;
  /** ready-bar relief for a behind-pace targeted player (returns eagerly) */
  readyReliefBonus: number;
  /** minutes-pace below which a targeted player counts as behind (returns eager) */
  eagerReturnPace: number;
  /** minutes-pace above which a rested targeted player is held back */
  aheadHoldPace: number;
  /** crunch time: final period under this many clock seconds (every OT
   *  stoppage qualifies regardless of clock — subs.ts checkSubs), close game */
  crunchClockSec: number;
  /** crunch margin: absolute score gap at/under which crunch rotation applies */
  crunchMarginPts: number;
  /** crunch energy floor: a starter this rested can be pulled back on late */
  crunchEnergyMin: number;
  /** concede (garbage time): in the final period the LEADER pulls his
   *  starters once the margin clears a clock-scaled line —
   *  line(clock) = concedeMarginBase + concedeMarginPerMin × minutes left */
  concedeMarginBase: number;
  concedeMarginPerMin: number;
  /** extra margin the TRAILING coach needs before he concedes too */
  concedeTrailLagPts: number;
  /** hysteresis width: concede exits this many points below the entry line */
  concedeExitPts: number;
  /** energy floor for a garbage-time bench body (floor presence, not burst) */
  concedeEnergyMin: number;
  // --- rotation grammar (fdesign-rotations; wired STAGED, live since the
  // FLOW flip at the ffit-rotations corpus fits — see the defaults).
  // Field notes below that say "STAGED N" describe the staging
  // discipline's never-fire value, not the shipped default. All
  // when-dials (identity-shape windows); none are swept (knobs.ts
  // doctrine; the band objective is blind to sub timing).
  /** boundary-wave size cap per team per quarter break. REAL: measured
   *  per-team boundary swaps 1.3-1.8; 0 = STAGED off (wave never runs) */
  waveMaxPerTeam: number;
  /** minimum live-clock stint before a player is wave-eligible to sit.
   *  REAL-anchored FEEL: corpus starter first exit p25 = 345 s into the
   *  quarter; protects a late-quarter returnee from an instant re-sit */
  waveStintMinSec: number;
  /** ready-bar relief for wave entries (a boundary swap is planned, not
   *  forced): accepts readyThreshold − relief where the mid-quarter
   *  rotation demands the full bar. FEEL */
  waveReadyRelief: number;
  /** minimum live-clock bench rest before any return (wave entries and the
   *  fatigue rotation's bench filter; crunch exempt). FEEL: bench
   *  recovery refills 62→88 in ~47 s, an unrealistically fast churn floor
   *  that produces the Q2 dead-zone oscillation. STAGED 0 = off */
  subMinBenchSec: number;
  /** the classic foul-trouble bar: troubled above `period + offset`
   *  personals (offset 1 ⇒ 2 in Q1 / 3 by half / 4 in Q3 / 5 in Q4).
   *  REAL coaching orthodoxy; corpus pull rates 44-62% within a minute.
   *  STAGED 99 = bar unreachable (the concede-999 idiom) */
  ftroublePersonalOffset: number;
  /** a foul inside a period's last N clock seconds rides to the break (no
   *  nonsense pull at 0:05; the boundary wave handles him). FEEL, fitted
   *  to the corpus ~32% unpulled share of late-quarter 2nd fouls */
  ftroubleIgnoreClockSec: number;
  /** pull-leash relaxation (energy pts) while this stoppage carries a
   *  timeout (phase.timeout, the fdesign-timeouts §4 handshake): a huddle
   *  is when the coach makes the non-urgent swap he'd otherwise defer.
   *  FEEL: ~half the starter/bench leash gap. STAGED 0 = off */
  timeoutSubRelaxPts: number;
  // --- fit-identified hooks (findings/ffit-rotations.md §3): the flip
  // dials above cannot reach the G8 gates alone; these five carry the
  // missing mechanisms. Wired STAGED at legacy/never-fire values, live
  // since the FLOW flip at the fit-recommended values (see the
  // defaults). When-dials, not swept.
  /** post-make sub window (possession.ts deadBall): 1 = a made-basket
   *  dead ball with the clock still running hosts the rotation pass
   *  (legacy; ~30 live-ball subs/g vs corpus 1.16, the G8c tell); 0 =
   *  the real rule: no subs after a make unless the stoppage is real
   *  (a timeout froze the clock, or the caller stopped it). STAGED 1 */
  postMakeSubWindow: number;
  /** between-FT-attempt sub slot (fouls.ts tickFreeThrows, the staged
   *  urgentOnly caller in subs.ts): 0 = no call (legacy), 1 = urgentOnly
   *  (fdesign-rotations §2.5), 2 = full rotation pass in the gap, 3 =
   *  mode 2 plus the trip-entry pass goes urgentOnly (the routine
   *  rotation moves to the gap; trip entry otherwise harvests every
   *  pending swap before the first free_throw row and G8a reads 0).
   *  Real logs place 14.2 subs/g strictly between attempts. STAGED 0 */
  ftGapSubMode: number;
  /** pull-leash relaxation (energy pts) during the between-FT pass: the
   *  line is a planned window like a huddle, with its own smaller
   *  magnitude (the huddle's 8 overshot G8a to 19-25/g). STAGED 0 = off */
  ftGapRelaxPts: number;
  /** halftime-reset wave cap override: at the H2 boundary starters return
   *  (corpus Q3-start starter share 96.2%), so the reset ignores
   *  waveMaxPerTeam, the exit stint gate, and the bench-rest floor and
   *  swaps up to this many. The reset is a planned lineup restore, not a
   *  stint judgment. STAGED 0 = off */
  waveHalfResetMax: number;
  /** 1 = a rested behind-pace minutes target re-enters proactively at the
   *  next legal stoppage (one per side per pass) instead of waiting
   *  inside another player's pull. Needed once postMakeSubWindow 0 thins
   *  the window supply: the passive eager return alone left 35-target
   *  stars at ~29-32 min/g (ffit-rotations §3.4). STAGED 0 = off */
  eagerReturnProactive: number;
}

export const subDefaults: SubParams = {
  // Sub OUT below this energy (starters get a +12 allowance in subs.ts so
  // they play longer stints); a bench player must be at least `ready` to
  // come in, preventing exhausted-for-exhausted swaps. Together these two
  // numbers ARE the rotation pattern: ~8-9 man rotations, starters ~30-34
  // minutes. FEEL, validated by the archetype minutes test.
  tiredThreshold: 62,
  // FEEL — a reserve is pulled 12 energy points earlier than a starter
  // (shorter leash, deeper bench rotation). Was inline in subs.ts checkSubs.
  benchTiredBonus: 12,
  // FEEL — minutes-aware rotation: 10% behind a coach's minutes target buys
  // ~6 energy points of extra leash, capped so nobody plays to collapse
  rotationLeashScale: 60,
  rotationLeashMax: 14,
  readyThreshold: 88,
  // FEEL — rotation-controller gates, were inline in subs.ts checkSubs. A
  // behind-pace targeted player returns eagerly (ready bar relieved by 8,
  // pace < 0.97); an ahead-pace one is held back even when rested
  // (pace > 1.08). 0.97/1.08 bracket the target from both sides so minutes
  // settle at ~target (0.92 gate produced 33 of 36; these two tightened it).
  readyReliefBonus: 8,
  eagerReturnPace: 0.97,
  aheadHoldPace: 1.08,
  // FEEL — crunch time: the final scheduled period inside 5:00 (or ANY
  // point of OT — the tip stoppage included, audit H-02), within 10
  // points; coaches ride starters who can still stand (energy > 35)
  // regardless of the normal fatigue read. Were inline in checkSubs.
  crunchClockSec: 300,
  crunchMarginPts: 10,
  crunchEnergyMin: 35,
  // Concede (garbage time): in the final period starters come out once the
  // margin clears line(clock) = base + perMin × minutes remaining — the
  // linear stand-in for the classic safe-lead heuristics (James'
  // (lead − 3.5)² ≥ seconds left gives ~22.5 at 6:00, ~16.9 at 3:00; the
  // designed line sits within a point or two across the window). All FEEL
  // at the design-garbagetime.md values: base 15 / perMin 1.0 / lag 4 /
  // exit 6 / energyMin 25 — the leader concedes up 21 at 6:00, up 18 at
  // 3:00, up 27 at the Q4 tip; the trailer follows concedeTrailLagPts
  // later.
  // LIVE, verified on the COUPLED engine only (findings/
  // b2-verify-concede.md): with channel 2 carrying the margin coupling,
  // the OOS-walk 30+ regression that blocked the first flip attempt is
  // gone (Δ30+ −0.83pp ± 1.18 — treatment BELOW control), self-play 30+
  // improves −3.5pp (1.7se) and crosses the ≤16 signed-sd gate, close/OT
  // integrity spotless, bands untouched, starters' rest −0.8…−0.9 min/g.
  // Concede REQUIRES the live coupling — do not detach them: uncoupled,
  // generated pools' uneven bench units make post-entry bench-vs-bench
  // play margin-EXPANDING, not the zero-mean drift the design assumed
  // (walk 30+ 5.8→8.3% fam-a, 7.9→10.4% fam-b —
  // findings/b2-fit-concede-oos.md), and the trailLag ladder (4→8→12)
  // could not rescue it without surrendering the balanced-cohort
  // compression (findings/b2-fit-lagkeep.md); under the coupling the
  // adverse long-span flux flips sign and the regression dissolves
  // mechanistically, not by masking.
  concedeMarginBase: 15,
  concedeMarginPerMin: 1.0,
  // FEEL — the trailing coach holds hope ~a possession and a half longer;
  // he pulls only when the deficit is unambiguous (leader's bench first,
  // a token starter run for the trailer, then both benches — the real
  // garbage-time sequence).
  concedeTrailLagPts: 4,
  // FEEL — hysteresis ≈ two possessions: a single 3-and-FT swing cannot
  // flap the lineup, and re-entry must beat a falling line. CONSTRAINT:
  // base + lag − exit (designed: 13) must stay > endgame.foulMaxDeficit
  // (12) — a still-conceded trailer must never sit inside the intentional-
  // foul deficit window (concede.test.ts pins this).
  concedeExitPts: 6,
  // FEEL — any bench body who can stand plays garbage time: looser than
  // crunchEnergyMin 35 because the incoming player needs floor presence,
  // not burst (mostly a degenerate-roster guard — bench sitters recover
  // toward 100 anyway, movement.ts bench recovery).
  concedeEnergyMin: 25,
  // Rotation grammar (fdesign-rotations), live since the FLOW flip:
  // corpus-fitted by ffit-rotations (per-dial fit notes inline). Not
  // swept (when-dials).
  waveMaxPerTeam: 2, // REAL: per-team boundary swaps 1.3-1.8/period (ffit-rotations)
  waveStintMinSec: 420, // FIT: 7:00 of live clock before wave-eligible (B1 1.5-1.8 held, G8d churn shed; ffit-rotations §2)
  waveReadyRelief: 35, // FIT: reset/wave entries accept energy 53 (readyThreshold 88 − 35) — the Q3-start starter-share binder
  subMinBenchSec: 420, // FIT: pine before any return — the churn floor, the main G8d dial (ffit-rotations §2; 300 -> 420 at the rules landing: the new Q1-Q3 last-minute windows host extra rotation passes and d ran 67.7/g vs corpus 53.2 at 300; 345 measured no relief, 420 reads 62.0-63.5 in band — REGISTER W63)
  ftroublePersonalOffset: 1, // REAL: the classic period+1 foul-trouble bar
  ftroubleIgnoreClockSec: 420, // FIT: a foul inside the last 7:00 rides to the break (the fatigue oscillator re-subs riders within 120s, so the gate sits far above the design's 2:00; ffit-rotations O2)
  timeoutSubRelaxPts: 8, // FEEL: ≈ half the starter/bench leash gap (ffit-rotations)
  // fit-identified hooks (ffit-rotations §3), live:
  postMakeSubWindow: 0, // REAL rule: no live-ball subs after makes (G8c 31.3 → 0.0/g)
  ftGapSubMode: 3, // FIT: trip entry urgentOnly + full pass in the FT gap (G8a 0 → 14-19/g)
  ftGapRelaxPts: 3, // FEEL: the FT-line planned window, smaller than the huddle's 8
  waveHalfResetMax: 5, // FIT: halftime restores the five (Q3-start starter share 0.86-0.89 vs gate 0.85)
  eagerReturnProactive: 1 // FIT: rested behind-pace targets re-enter at the next legal stoppage; 35-target stars back to ~34.5-35.5 min/g (ffit-rotations §3.4)
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const subProvenance: Record<keyof SubParams, Provenance> = {
  tiredThreshold: 'FEEL',
  benchTiredBonus: 'FEEL',
  rotationLeashScale: 'FEEL',
  rotationLeashMax: 'FEEL',
  readyThreshold: 'FEEL',
  readyReliefBonus: 'FEEL',
  eagerReturnPace: 'FEEL',
  aheadHoldPace: 'FEEL',
  crunchClockSec: 'FEEL',
  crunchMarginPts: 'FEEL',
  crunchEnergyMin: 'FEEL',
  concedeMarginBase: 'FEEL',
  concedeMarginPerMin: 'FEEL',
  concedeTrailLagPts: 'FEEL',
  concedeExitPts: 'FEEL',
  concedeEnergyMin: 'FEEL',
  waveMaxPerTeam: 'REAL',
  waveStintMinSec: 'REAL',
  waveReadyRelief: 'REAL',
  subMinBenchSec: 'REAL',
  ftroublePersonalOffset: 'REAL',
  ftroubleIgnoreClockSec: 'REAL',
  timeoutSubRelaxPts: 'FEEL',
  postMakeSubWindow: 'REAL',
  ftGapSubMode: 'REAL',
  ftGapRelaxPts: 'FEEL',
  waveHalfResetMax: 'REAL',
  eagerReturnProactive: 'REAL'
};
