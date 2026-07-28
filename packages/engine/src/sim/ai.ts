/**
 * AI brains: offensive decision-making, off-ball movement, defensive positioning.
 *
 * Design: behavior emerges from utility comparisons fed by the same
 * probability models that resolve outcomes. Drive-and-kick is not scripted:
 * help convergence lowers the drive EV and raises the kickout EV, so the pass
 * happens. Tendencies bias utilities; attributes change the underlying EVs.
 *
 * The layers live in ai/ as focused modules (this file is the stable
 * public surface; sim modules import from './ai.js' and never reach in):
 *   ai/decide.ts   decideBall: what the ball-handler does (expected-point
 *                  utilities + softmax; the EV doctrine lives in its header)
 *   ai/actions.ts  pnr/post/iso/dho lifecycle (thin scaffolding by design)
 *   ai/offense.ts  spacing spots, cuts, screens, shot-reaction crash/boxout
 *   ai/defense.ts  matchups, help, blitz, drop, containment, denial, sag
 *   ai/shared.ts   creation hierarchy, defender queries, locomotion policy
 *
 * The relationships that carry the most realism:
 *   gravity() → defensive gap and sag depth (why shooters create space)
 *   midRespect() → off-ball gap inside jumper range (why the elbow big is
 *     guarded at the FT line, and why his middy volume self-limits)
 *   help convergence → drive EV falls, kickout EV rises (drive-and-kick)
 *   screen stun → contest drops (why a pick-and-roll pull-up is a good shot)
 */

export { decideBall, type BallAction } from './ai/decide.js';
export { assignedDefender, onBallDefender, moveSpeed, midPullUpLight } from './ai/shared.js';
export { onShotReleased, assignSpots, offenseOffBallTick } from './ai/offense.js';
export { assignMatchups, defenseTick } from './ai/defense.js';
