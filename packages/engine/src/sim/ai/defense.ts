/**
 * Man-to-man defense: size-sorted matchup assignment and the per-tick
 * positioning brain (help rotations, blitzes, drop coverage, on-ball
 * containment gaps, top-lock denial, help-side sag).
 */

import { clamp } from '../../core/rng.js';
import { dist, lerp, norm, scale, sub, add, type V2 } from '../../core/vec.js';
import type { TeamSide } from '../../core/events.js';
import { agent, attackedRim, liveOnCourt, onCourt, other, type Agent, type GameState } from '../state.js';
import { gravity, midRespect } from '../resolve.js';
import { foulHuntSide } from '../endgame.js';
import { scorePressureDefMult } from './concepts.js';

/** assign man matchups: sort both lineups by size and pair them */
export function assignMatchups(s: GameState, defSide: TeamSide): void {
  // same bench-exhausted fallback as assignSpots/bestHandler: when a whole
  // lineup has fouled out (legal with short rosters), play on rather than
  // index into an empty list — `o[...]!` crashed here in the audit fixture
  const pick = (side: TeamSide) => {
    const live = liveOnCourt(s, side);
    return live.length > 0 ? live : onCourt(s, side);
  };
  const defenders = pick(defSide);
  const attackers = pick(other(defSide));
  // Match by size: height plus a weight term (÷12 puts pounds on roughly the
  // same scale as inches, so a 250 lb wing sorts above a 240 lb one of equal
  // height). Crude but produces sane bigs-on-bigs, guards-on-guards pairings.
  const bySize = (arr: Agent[]) =>
    [...arr].sort((a, b) => (b.p.heightIn + b.p.weightLb / 12) - (a.p.heightIn + a.p.weightLb / 12));
  const d = bySize(defenders);
  const o = bySize(attackers);
  for (let i = 0; i < d.length; i++) {
    d[i]!.manId = o[Math.min(i, o.length - 1)]!.p.id;
  }
}

/**
 * Per-tick defensive positioning — the orchestrator. Each defender falls
 * through the phases in priority order; the first phase that claims him
 * positions him and the later ones never run:
 *
 *   1. pickHelper       — is a second body warranted, and who can be spared?
 *   2. positionHelper   — the chosen helper rotates (rim help, or the blitz)
 *   3. dropCoverage     — the screener's defender protects the paint (pnr)
 *   4. containOnBall    — the on-ball gap: shooting threat closes it, drive
 *                         threat opens it; closeouts; beaten-on-a-drive chase
 *   5. positionOffBall  — top-lock denial for extreme gravity, otherwise the
 *                         man-rim line with ball-distance/gravity-scaled sag
 */
export function defenseTick(s: GameState): void {
  const defSide = other(s.poss.team);
  const rim = defendedRimOf(s, defSide);
  const holderId = s.ball.holderId;
  const holder = holderId ? agent(s, holderId) : null;
  const helpAggr = s.teams[defSide].tactics.helpAggr / 100;
  const A = s.params.ai;

  // the blitz: an extreme-gravity HOLDER beyond the arc draws a second body —
  // denial's on-ball sibling, built to cap elite pull-up volume (the fidelity
  // benchmark kept 15+ deep attempts against single coverage). NOTE: from its
  // introducing commit until the pickHelper gate exemption below, the
  // near-rim helpTriggerFt gate vetoed every blitz-selected helper, so the
  // blitz positioning branch never ran — conclusions probed in that window
  // (e.g. live-dribble gating reading as a bit-identical no-op) were
  // measured against the dead branch.
  const blitz =
    holder !== null && gravity(s, holder) > A.denyGravityCut &&
    dist(holder.pos, rim) > A.blitzBeyondFt;
  const helper = pickHelper(s, defSide, rim, holder, blitz, helpAggr);
  // ENDGAME LAYER: a trailing defense hunting an intentional foul
  // (sim/endgame.ts) presses the ball — the on-ball defender abandons his
  // containment cushion and closes to grab range so the loaded reach-in
  // roll in passing.ts can actually connect. Flag off, never active.
  const hunting = s.endgame && foulHuntSide(s) === defSide;

  for (const d of liveOnCourt(s, defSide)) {
    d.intent = 'defend';
    d.sprinting = false;
    const man = d.manId ? agent(s, d.manId) : null;
    if (!man) { d.target = lerp(rim, s.ball.pos, 0.4); continue; }

    if (hunting && holder && man.p.id === holder.p.id) {
      // chase the ball for the grab: cushion collapses to foulHuntGapFt
      // (body-to-body, inside the loaded reach range), full sprint urgency
      d.target = add(holder.pos, scale(norm(sub(rim, holder.pos)), s.params.endgame.foulHuntGapFt));
      d.sprinting = true;
      continue;
    }
    if (helper && d.p.id === helper.p.id && holder) { positionHelper(s, d, holder, rim, blitz); continue; }
    if (holder && dropCoverage(s, d, man, holder, rim)) continue;
    if (holder && man.p.id === holder.p.id) { containOnBall(s, d, holder, rim); continue; }
    positionOffBall(s, d, man, rim, helpAggr);
  }
}

/**
 * Phase 1 — is a help rotation warranted, and who can be spared?
 * Drives trigger it; so does a live post-up being worked on the block — the
 * double-team is what turns the post into a passing hub (help leaves a
 * shooter; the poster sprays) — and so does the blitz.
 */
function pickHelper(
  s: GameState, defSide: TeamSide, rim: V2,
  holder: Agent | null, blitz: boolean, helpAggr: number
): Agent | null {
  if (!holder) return null;
  const A = s.params.ai;
  const actD = s.poss.action;
  const postWorking =
    actD?.kind === 'post' && actD.posterId === holder.p.id && actD.phase === 'working';
  if (!(s.t < holder.driveUntil || postWorking || blitz)) return null;
  // the near-rim radius belongs to the drive/post triggers only. The blitz
  // fires on a holder BEYOND blitzBeyondFt — outside helpTriggerFt by
  // construction — so applying this gate to it made the two conditions
  // mutually exclusive and the blitz branch in positionHelper unreachable
  // (shipped dead from its introducing commit; sim/ai line audit A9-1).
  if (!blitz && dist(holder.pos, rim) >= s.params.move.helpTriggerFt) return null;
  // nearest weak-side defender whose man has the least gravity
  let helper: Agent | null = null;
  let bestScore = Infinity;
  for (const d of liveOnCourt(s, defSide)) {
    if (!d.manId || d.manId === holder.p.id) continue;
    // Pick the helper: closest to the rim, but STRONGLY penalized for
    // leaving a shooter (gravity × 26 ft-equivalent). This is the real
    // help-defense dilemma — you rotate off the worst shooter, and elite
    // shooters effectively can't be helped off of. helpAggr scales how
    // much a team tolerates the risk.
    const man = agent(s, d.manId);
    // helperGravityCeil: the gravity-penalty factor at helpAggr=0 (maximum
    // reluctance), dropping to ceil−1 at helpAggr=1.0 — full aggression
    // still avoids leaving elite shooters open but rotates off of
    // average-gravity players much more willingly.
    // ...respect is the max of the three-point threat and the live mid
    // threat (midRespect — position-aware): helping off a mid big standing
    // AT the elbow concedes his drilled 16-footer, and pre-fix he was
    // always the first man chosen to rotate (lowest gravity near the rim),
    // which made the stationed elbow a free outlet on every drive.
    const respect = Math.max(gravity(s, man), midRespect(s, man));
    const score = dist(d.pos, rim) + respect * A.helperGravityWeight * (A.helperGravityCeil - helpAggr);
    if (score < bestScore) { bestScore = score; helper = d; }
  }
  return helper;
}

/** Phase 2 — the chosen helper rotates: rim help on a drive/post, or the blitz. */
function positionHelper(s: GameState, d: Agent, holder: Agent, rim: V2, blitz: boolean): void {
  if (blitz && s.t >= holder.driveUntil) {
    // blitz: close on the HOLDER, slightly rim-side — a stunting second
    // body that turns his pull-up into a contested look and invites the
    // pass out (assists rise league-wide; that's the point)
    d.target = lerp(holder.pos, rim, 0.08);
    d.sprinting = true;
    return;
  }
  // rotate to the rim, shaded 22% up the drive path — meet the driver at
  // the front of the rim rather than standing under the basket
  d.target = lerp(rim, holder.pos, 0.22);
  d.sprinting = true;
}

/**
 * Phase 3 — pick-and-roll drop coverage: the screener's defender protects the
 * paint. Returns whether this phase claimed the defender.
 */
function dropCoverage(s: GameState, d: Agent, man: Agent, holder: Agent, rim: V2): boolean {
  const act = s.poss.action;
  if (!(act && act.kind === 'pnr' && act.phase !== 'coming' && man.p.id === act.screenerId)) return false;
  const dRim = Math.max(1, dist(holder.pos, rim));
  d.target = lerp(rim, holder.pos, clamp(s.params.ai.pnrDropDepthFt / dRim, 0, 0.85));
  return true;
}

/** Phase 4 — on-ball containment: the gap, the closeout, the beaten-chase. */
function containOnBall(s: GameState, d: Agent, holder: Agent, rim: V2): void {
  const A = s.params.ai;
  const man = holder;
  // CONCEPT 7, CHANNEL 2 (score pressure — defensive intensity): the margin
  // leans the whole containment posture. SIGN: the pressure is read from the
  // DEFENDER's own side (d.side) — the defender's team TRAILING ⇒ press < 1
  // ⇒ tighter gap and less closeout slack (play up, contest everything);
  // LEADING ⇒ press > 1 ⇒ sag off (soft contests, protect the drive line,
  // let the clock work). No urgency fade on purpose — late-game defense
  // stays pressed (doctrine at concepts.ts#scorePressureDefMult). STAGED at
  // scorePressureDefGain 0 ⇒ press === 1 exactly ⇒ this function is
  // bit-identical to the unwired engine.
  const press = scorePressureDefMult(s, d.side);
  // shooting threat CLOSES the gap; drive threat OPENS it — you play a
  // downhill freight train from depth and concede the pull-up (this is
  // why a 92-drive point-forward gets his ~5 threes a game: they're
  // given, not taken; without it his pull-up never fired at 0.7 attempts)
  const driveThreat = (man.p.tend.drive / 100) * (man.p.attr.speed / 100);
  // the 2.2 ft floor is body space — the press tightens TO it, never through
  // it; the duck-under sag below stays unleaned (screen-navigation geometry,
  // not effort)
  let gap = Math.max(
    2.2,
    (s.params.move.defGapBaseFt - gravity(s, man) * s.params.move.defGapGravityFt
      + driveThreat * s.params.move.defGapDriveFt) * press
  );
  // ducking under a screen: drop back, concede the pull-up
  if (s.t < d.navUnderUntil) gap += A.pnrUnderSagFt;
  const toRim = norm(sub(rim, holder.pos));
  d.target = add(holder.pos, scale(toRim, gap));
  // closeout: sprint when caught out of position (e.g. after a swing pass) —
  // a pressing defense tolerates less separation before the sprint fires, a
  // sagging one lets more ride
  d.sprinting = dist(d.pos, holder.pos) > gap + A.closeoutSlackFt * press;
  // Beaten on a drive: abandon the cushion and chase the intercept point
  // 30% of the way to the rim — trail the drive rather than the man.
  if (s.t < holder.driveUntil) {
    d.target = lerp(holder.pos, rim, 0.3);
    d.sprinting = true;
  }
}

/**
 * Phase 5 — off-ball: guard the man-rim line, sagging with ball distance and
 * low gravity; extreme gravity flips to top-lock denial instead.
 */
function positionOffBall(s: GameState, d: Agent, man: Agent, rim: V2, helpAggr: number): void {
  const A = s.params.ai;
  // Respect what the man can hit FROM WHERE HE STANDS: the three-point
  // threat everywhere (gravity), or the live mid-range threat when he is
  // stationed inside jumper range (midRespect — the elbow big). Without the
  // mid half, his defender sagged 6+ ft off the elbow and every catch there
  // was a free 16-footer; guarding it honestly also pulls that defender out
  // of the paint, which is the spacing pressure the mid game really exerts.
  const g = Math.max(gravity(s, man), midRespect(s, man));
  // DENIAL: an all-time shooter doesn't get guarded, he gets denied — above
  // the gravity threshold the defender shades onto the man-BALL line (top-
  // lock) to take the catch away instead of protecting the drive line.
  // This is what actually caps an elite shooter's volume in real basketball:
  // the fidelity harness's 0.98-gravity benchmark took 22+ threes because
  // openness-priced passes kept finding him — denial prices the pass lane
  // itself (passRisk's lane occlusion reads the defender's position, so
  // feeds to a denied man become genuinely riskier and teammates benefit).
  if (g > A.denyGravityCut && s.ball.holderId && s.ball.holderId !== man.p.id) {
    const toBall = norm(sub(s.ball.pos, man.pos));
    d.target = add(man.pos, scale(toBall, A.denyDistFt));
    return;
  }
  const guardDist = A.guardDistBase + (1 - g) * A.guardDistOpen;
  const manToRim = norm(sub(rim, man.pos));
  // Stand on the man-rim line at guardDist — but never more than halfway to
  // the rim, or a defender guarding someone in the corner ends up under the
  // basket instead of between his man and it.
  const basePoint = add(man.pos, scale(manToRim, Math.min(guardDist, dist(man.pos, rim) * 0.5)));
  const ballDist = dist(man.pos, s.ball.pos);
  const sag = clamp((ballDist - A.sagStartFt) / A.sagRangeFt, 0, A.sagMax)
    * (1 - g * A.sagGravityCut) * (0.6 + helpAggr * 0.6);
  const helpSpot = lerp(rim, s.ball.pos, A.helpSpotPull);
  const ideal = lerp(basePoint, helpSpot, sag);
  // stillness-as-default: the sag point drifts a little with every ball
  // movement — inside the deadband a defender HOLDS his stance instead of
  // shuffling after a moving pixel (denial and on-ball work stay live;
  // this only quiets settled off-ball positioning)
  d.target = dist(d.pos, ideal) < s.params.move.defDeadbandFt ? d.pos : ideal;
}

function defendedRimOf(s: GameState, defSide: TeamSide): V2 {
  return attackedRim(s, other(defSide));
}
