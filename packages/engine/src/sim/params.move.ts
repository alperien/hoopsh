/**
 * SimParams block `move` — speeds, transition/advance definitions, dead-ball
 * timing.
 *
 * Split out of sim/params.ts (#36): this module owns the block's interface,
 * calibrated defaults, and machine-readable per-knob provenance. The composed
 * surface (SimParams, defaultParams, paramProvenance, withParams) and the
 * reading guide for these numbers (logits, units, coupling) stay in
 * sim/params.ts. Values and comments moved verbatim at the split; provenance
 * tag meanings and adjudication rules live in params.provenance.ts.
 */

import type { Provenance } from './params.provenance.js';

export interface MoveParams {
  /** halfcourt movement speed as a share of max sprint */
  halfcourtSpeedMult: number;
  /** soft-collision avoidance radius, ft */
  avoidRadiusFt: number;
  /** on-ball defender ideal gap vs average shooter, ft */
  defGapBaseFt: number;
  /** gap shrink per unit of shooter gravity (three rating & tendency) */
  defGapGravityFt: number;
  /** gap GROWTH per unit of drive threat (tend.drive x speed) — sag off the freight train */
  defGapDriveFt: number;
  /** distance from rim where help defense triggers on a drive */
  helpTriggerFt: number;
  /** contest radius — defenders inside this affect the shot */
  contestRadiusFt: number;
  /** contest-skill mix: share contributed by role defense (interiorD near
   *  the rim, perimeterD outside) vs generic contestSkill */
  contestDBlend: number;
  /** collision-separation share absorbed by a live poster's opponent */
  postLeanShare: number;
  /** interior-vs-perimeter role-defense boundary for the contest model, ft */
  nearRimFt: number;
  /** ball-handler speed (ft/s) above which dribble accounting accrues */
  dribbleSpeedFtS: number;
  /** seconds of dribbling above that speed per counted dribble (assist window) */
  dribbleSec: number;
  /** within this of the computed spot, off-ball players STOP (stillness-as-default) */
  arrivalDeadbandFt: number;
  /** defensive version: sag ideals drift with every ball move — reposition on the CATCH, not continuously */
  defDeadbandFt: number;
  /** defensive stance speed share when not sprinting (shuffle, don't glide) */
  stanceSpeedMult: number;
  /** defensive sprint multiplier on lateral speed (closeouts, help
   *  rotations, blitzes run hot; still capped by the fatigue-scaled max) */
  defSprintMult: number;
  /** off-ball spacing moves are WALKED (share of max) — spots are held, not chased */
  offBallWalkMult: number;
  /** the ball-handler's bring-up is a dribble-JOG (share of max), not a sprint */
  advanceJogMult: number;
  /** the retreat after a score/shot is a JOG (share of max) — nobody sprints back unpressured */
  getbackJogMult: number;
  /** non-sprint crash/boxout repositioning speed (share of max) — short, quick, not a dash */
  crashWorkMult: number;
  /** transition hard cap, sec — safety only; the real end is the defense getting SET */
  transitionMaxSec: number;
  /** the defense is SET once this many defenders are back — ends the
   *  transition phase (game.ts) and zeroes the transition continuation cut
   *  (ai/concepts.ts); shared definition lives in resolve.ts defendersBack */
  transSetBackCount: number;
  /** "back" = inside this distance of the rim being defended, ft */
  transBackRadiusFt: number;
  /** the advance→halfcourt flip: the offense initiates once the holder is
   *  inside this rim distance (the logo pickup), ft */
  advancePickupFt: number;
  /** dead-ball timing (the freeze applies fatigue; a clockRuns caller also
   *  burns game clock): the standard whistle/basket read, and the shorter
   *  same-possession side-out resume (no team change) */
  deadBallResumeSec: number;
  deadBallSideOutSec: number;
  /** made-basket dead time before the inbound (the game clock RUNS
   *  through it outside the final two minutes — real inbound time) */
  madeBasketResumeSec: number;
  /** free-throw trip cadence: walk-to-the-line lead-in, the between-
   *  attempts ritual, and the made-final-FT resume before the inbound */
  ftSetupSec: number;
  ftBetweenSec: number;
  ftMadeResumeSec: number;
}

export const moveDefaults: MoveParams = {
  // Nobody sprints in the half court: cruising speed is 72% of max.
  // (Sprinting is reserved for transition, cuts, closeouts, crashes.) FEEL.
  halfcourtSpeedMult: 0.72,
  // Soft body radius, ft — players push apart below this. Two shoulders'
  // width; prevents overlap without simulating real collisions. FEEL.
  avoidRadiusFt: 2.4,
  // On-ball defensive gap vs an average shooter, shrinking by up to
  // defGapGravityFt against a maximum-gravity shooter. THIS PAIR IS WHY
  // ELITE SHOOTERS CREATE SPACE: a defender must play Curry ~2.8 ft
  // tighter, which is what a drive attacks. FEEL, high realism impact.
  defGapBaseFt: 5.0,
  defGapGravityFt: 2.2,
  // FEEL — a full drive threat buys ~1.6 ft of cushion (concede the jumper)
  defGapDriveFt: 1.6,
  // A drive inside this distance from the rim summons help — the trigger
  // that makes drive-and-kick emerge without scripting it. FEEL.
  helpTriggerFt: 15,
  // Defenders within this radius affect a shot's contest level. Roughly the
  // distance from which a closeout can still bother a shooter. FEEL.
  contestRadiusFt: 6.5,
  // FEEL — role defense carries just under half the contest-skill definition
  contestDBlend: 0.45,
  // FEEL — post play is legal contact: the defender absorbs most of the
  // body separation when a live poster leans in (0.5 = symmetric)
  postLeanShare: 0.85,
  // Rim-proximity threshold for role-defense blending in the contest model:
  // inside nearRimFt the interior-defense skill (interiorD) applies instead
  // of perimeterD. Approximately the paint distance where rim protection
  // begins to matter more than perimeter footwork. FEEL.
  nearRimFt: 14,  // FEEL — interior-vs-perimeter role-defense boundary, ft
  // Dribble accounting for the assist window: while the holder moves faster
  // than dribbleSpeedFtS, every dribbleSec of it counts as one dribble.
  // FEEL — were inline literals in game.ts tickLive.
  dribbleSpeedFtS: 3.5,
  dribbleSec: 0.55,
  // Stillness-as-default: within the deadband of the computed spot an
  // off-ball player (either side) holds position instead of micro-chasing
  // a drifting target every tick. Texture forensics found 8.67 ft/s
  // average live speed vs the NBA's ~4.2 with only 28% of player-frames
  // stationary — real spacing is HELD, not jogged. FEEL.
  arrivalDeadbandFt: 1.4,
  // Defense holds a WIDER deadband: the sag ideal drifts a little with
  // every ball movement, and chasing each drift is the shuffle-noise the
  // texture probe measured. Real defenders re-position on the catch.
  // Containment, closeouts, helps, and denial are never deadbanded. FEEL.
  defDeadbandFt: 2.6,
  // Texture probe (by role, before these dials): defense averaged 8.7 ft/s
  // — every small sag adjustment ran at FULL lateral speed. A defender in
  // his stance shuffles; the defSprintMult below still applies to
  // closeouts, helps, and blitzes. FEEL.
  stanceSpeedMult: 0.48,
  // FEEL — the defensive sprint runs HOT on lateral quickness: closeouts,
  // help rotations, and blitzes beat the shuffle by 15%, still capped by
  // the fatigue-scaled sprint max (ai/shared.ts moveSpeed). Was the inline
  // 1.15 there — closeout speed is a contest-quality lever, not cosmetics
  // (audit H-01).
  defSprintMult: 1.15,
  // Off-ball offense averaged 7.4 ft/s: spot repositioning ran at the
  // 0.72 cruise. Spacing is walked to and HELD (cuts/crashes/transition
  // still sprint via the sprinting flag; the ball-holder keeps the cruise
  // multiplier — this only walks off-ball spacing moves). FEEL.
  offBallWalkMult: 0.3,
  // The bring-up: at the 0.72 cruise the handler crossed halfcourt at
  // ~13.7 ft/s (9+ mph) EVERY possession — the single largest contributor
  // to the speed signature (avg live speed 6.55 vs NBA ~4.2, and the
  // friction signature it drives — see INTERNALS + the speed-pin
  // experiment: the shooting calibration absorbs kinematics errors, so
  // this fix forces a re-fit by design). A real bring-up is a dribble-jog;
  // transition still sprints via the sprinting flag. FEEL.
  advanceJogMult: 0.42,
  // THE CRUISE FALLTHROUGH (frame-attribution probe, speed-fix branch):
  // moveSpeed's offense branch gave every non-defend/non-spot/non-advance
  // intent the 0.72 cruise — so all five defenders crossed the court at
  // ~13.7 ft/s after EVERY score (intent 'getback'), and non-sprint
  // crashers boxed out at the same. 'early' possession windows owned 42%
  // of all fast frames and scrambles another 20% before these dials.
  // Real players jog back (~8 ft/s) and work the boxout, not dash it. FEEL.
  getbackJogMult: 0.45,
  crashWorkMult: 0.5,
  // Transition used to end on a fixed 4.5s clock — the jog economy made
  // that expire mid-floor (defense not back, holder 40 ft out) and the
  // downhill archetype lost its window (drives 4.7 -> 1.27/game, fidelity
  // incident). Transition now ends when the DEFENSE IS SET (4+ defenders
  // inside 30 ft of their rim — arrival-based, like the advance flip);
  // this cap is the chaos-state safety net only. FEEL.
  transitionMaxSec: 7,
  // "The defense is set" — the shared arrival definition (was inline in
  // game.ts's phase flip; promoted when the decision layer started
  // reading the same measure for the transition continuation cut and the
  // defender-aware projected drive contest — resolve.ts defendersBack).
  // 4 of 5 back is a set defense (one trailer is normal); 30 ft covers
  // the arc plus a step — a defender beyond it cannot influence the
  // first action at the rim. FEEL.
  transSetBackCount: 4,
  transBackRadiusFt: 30,
  // FEEL — the advance→halfcourt flip: the offense initiates at the logo
  // pickup, ~36 ft from the rim — not at the arc (32 ft left 54% of the
  // downhill benchmark's decisions inside the drive-gated advance phase
  // after the jog economy; main had 36%). Was inline in game.ts tickLive
  // (audit H-01).
  advancePickupFt: 36,
  // Dead-ball timing (the freeze walk applies fatigue; a clockRuns caller
  // also burns game clock). FEEL — were inline in possession.ts (audit
  // H-01):
  //   deadBallResumeSec — the standard delay: long enough to read the
  //     whistle/basket on a replay viewer, short enough not to visibly
  //     slow the game's pace.
  //   deadBallSideOutSec — the same-possession side-out resume (loose-ball
  //     whistle, team-carom award, non-bonus reach-in): no team change, so
  //     the pause covers the whistle, not a full re-set.
  deadBallResumeSec: 1.8,
  deadBallSideOutSec: 1.2,
  // FEEL — made-basket dead time (was inline in shooting.ts, audit H-01):
  // the scoring team retreats and the inbound comes in over ~2.2 s with
  // the game clock RUNNING outside the final two minutes — the real
  // between-baskets inbound time, and a genuine pace lever (~40 makes a
  // game burn it).
  madeBasketResumeSec: 2.2,
  // FEEL — the free-throw trip cadence (were inline in fouls.ts, audit
  // H-01; fatigue accrues through the whole ritual): 1.4 s to walk to the
  // line and get set (quicker than a full dead-ball read — the whistle
  // already stopped play), 0.9 s of ritual dribble between attempts (the
  // shooter is already set), and a 1.6 s resume after a made final FT (a
  // clean possession change, same length as the period-opening delay).
  ftSetupSec: 1.4,
  ftBetweenSec: 0.9,
  ftMadeResumeSec: 1.6
};

/**
 * Per-knob provenance (REAL / SWEPT / FEEL — meanings and adjudication rules
 * in params.provenance.ts). The machine-checkable half of AGENTS.md DO-NOT
 * rule 1: test/params-provenance.test.ts asserts every knob carries a tag.
 */
export const moveProvenance: Record<keyof MoveParams, Provenance> = {
  halfcourtSpeedMult: 'FEEL',
  avoidRadiusFt: 'FEEL',
  defGapBaseFt: 'FEEL',
  defGapGravityFt: 'FEEL',
  defGapDriveFt: 'FEEL',
  helpTriggerFt: 'FEEL',
  contestRadiusFt: 'FEEL',
  contestDBlend: 'FEEL',
  postLeanShare: 'FEEL',
  nearRimFt: 'FEEL',
  dribbleSpeedFtS: 'FEEL',
  dribbleSec: 'FEEL',
  arrivalDeadbandFt: 'FEEL',
  defDeadbandFt: 'FEEL',
  stanceSpeedMult: 'FEEL',
  defSprintMult: 'FEEL',
  offBallWalkMult: 'FEEL',
  advanceJogMult: 'FEEL',
  getbackJogMult: 'FEEL',
  crashWorkMult: 'FEEL',
  transitionMaxSec: 'FEEL',
  transSetBackCount: 'FEEL',
  transBackRadiusFt: 'FEEL',
  advancePickupFt: 'FEEL',
  deadBallResumeSec: 'FEEL',
  deadBallSideOutSec: 'FEEL',
  madeBasketResumeSec: 'FEEL',
  ftSetupSec: 'FEEL',
  ftBetweenSec: 'FEEL',
  ftMadeResumeSec: 'FEEL'
};
