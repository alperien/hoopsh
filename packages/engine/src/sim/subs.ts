/**
 * Substitutions: swapping players in/out of the lineup, fatigue-driven
 * rotation checks, and fouled-out replacement.
 *
 * `checkSubs` is called only from dead-ball choke points (`deadBall`,
 * `endPeriod` in possession.ts, `enterFreeThrows` in fouls.ts) — never
 * mid-live-play, since real substitutions only happen at stoppages.
 * `replaceFouledOut` is called synchronously from `recordFoul` the instant a
 * sixth (or rule-pack-defined) personal foul is charged.
 */

import type { TeamSide } from '../core/events.js';
import { clamp } from '../core/rng.js';
import { agent, emit, onCourt, other, type Agent, type GameState } from './state.js';

/**
 * Swap one on-court player for one bench player in a team's lineup slot.
 * Inherits the outgoing player's position/defensive assignment/spacing spot
 * so the incoming player steps into the same role rather than teleporting to
 * a default spot — the replay shows a clean hand-off, not a jump-cut.
 * Resets velocity to zero (a fresh substitute walks on, doesn't inherit
 * momentum) and emits the `substitution` event that stats/box.ts uses to
 * track exact minutes played.
 */
export function swapPlayers(s: GameState, side: TeamSide, out: Agent, into: Agent): void {
  const slots = s.lineup[side];
  const idx = slots.indexOf(out.p.id);
  if (idx === -1) return;
  slots[idx] = into.p.id;
  out.onCourt = false;
  into.onCourt = true;
  into.pos = { ...out.pos };
  into.vel = { x: 0, y: 0 };
  into.manId = out.manId;
  into.spotKey = out.spotKey;
  // The role hand-off runs in BOTH directions: opponents whose assignment
  // pointed at the outgoing player now guard the substitute. Matchups are
  // otherwise assigned only at startPossession, and several sub windows
  // resume the SAME possession (continuation dead balls, FT entries) — so a
  // defender whose manId named the benched man kept guarding a ghost's
  // frozen spot while the fresh sub played unassigned (scan a5: ~300 stale
  // defender-ticks/game; sim/ai audit A9-2: ~21 s of broken coverage per
  // default game).
  for (const d of onCourt(s, other(side))) {
    if (d.manId === out.p.id) d.manId = into.p.id;
  }
  emit(s, { type: 'substitution', team: side, out: [out.p.id], in: [into.p.id] });
}

/**
 * Fatigue- and situation-driven rotation pass over both lineups. Called at
 * every dead-ball opportunity (never mid-possession). Two distinct policies:
 * in "crunch time" (see `crunch` below) starters get pulled back onto the
 * floor over tired bench players regardless of the normal fatigue thresholds;
 * otherwise it's a simple energy-threshold check per player, pulling in the
 * best-rested same-position bench option.
 * `protect`: a player id who must stay on the floor no matter what (e.g. the
 * free-throw shooter mid-sequence) — skipped entirely by this pass.
 */
/**
 * Own-property read of a coach's minutes target (Team.rotationMinutes).
 * rotationMinutes is a plain JSON object keyed by player id, and a roster id
 * that collides with an Object.prototype key ("constructor", "toString", …)
 * made the bare index read return the INHERITED FUNCTION instead of
 * undefined — the NaN pace that followed poisoned the leash clamp and that
 * player was simply never substituted, with strict validation green (audit
 * M-13; the data-pack validator now also rejects such ids at load time, but
 * the engine boundary accepts raw Team objects from any caller).
 */
function rotationTarget(s: GameState, teamIdx: TeamSide, id: string): number | undefined {
  const rot = s.teams[teamIdx].rotationMinutes;
  if (rot === undefined || !Object.prototype.hasOwnProperty.call(rot, id)) return undefined;
  return rot[id];
}

/** an explicit rotationMinutes target of 0 is a DNP scratch — see minutesPace */
function isScratched(s: GameState, teamIdx: TeamSide, id: string): boolean {
  return rotationTarget(s, teamIdx, id) === 0;
}

/**
 * Minutes pace vs a coach's target (Team.rotationMinutes): <1 behind, >1
 * ahead, null when the player has no target or the game just started.
 * Consumed by checkSubs on BOTH sides of the rotation — the pull leash and
 * the eager return — so a targeted star both stays out longer and comes back
 * sooner.
 *
 * A target of 0 is an explicit DNP SCRATCH — the controller's own limit
 * semantics: any second played against a 0 target is infinitely ahead of
 * pace, so the pace reads Infinity (held back by the aheadHoldPace filter
 * forever; pulled at the full leash if somehow on court). The old
 * Math.max(1, …) division floor inverted exactly the not-yet-played case —
 * 0 seconds / floor 1 read pace 0, "maximally behind", and the scratch
 * jumped the entire bench queue as the TOP-priority eager return (audit
 * M-14). The concede fill and the fouled-out replacement below honor the
 * scratch explicitly (isScratched): a healthy scratch is not in uniform,
 * so he does not mop up garbage time and cannot be an emergency body —
 * bench-exhausted games play on shorthanded, the same play-on rule as a
 * fully fouled-out bench.
 */
function minutesPace(s: GameState, teamIdx: TeamSide, a: Agent): number | null {
  const target = rotationTarget(s, teamIdx, a.p.id);
  if (target === undefined) return null;
  if (target === 0) return Infinity; // DNP scratch: permanently ahead of pace
  const gameSec = s.rules.periods * s.rules.periodMinutes * 60;
  const elapsed = Math.min(1, s.t / gameSec);
  if (elapsed <= 0.02) return null;
  return a.secondsPlayed / Math.max(1, target * 60 * elapsed);
}

/**
 * Garbage-time concede hysteresis — updates the per-side "this game is
 * decided" flags (GameState.conceded) that checkSubs' concede branch reads.
 * Called once per checkSubs pass (dead balls, the only places subs can
 * happen); together with the unconditional crunch clear at the call site it
 * is the only writer of s.conceded. Final scheduled period (or OT) only,
 * matching the crunch predicate's period gate; any earlier period clears
 * both flags (belt-and-suspenders — a stale flag also cannot survive into
 * OT, which arrives tied and exits below the line at its first dead ball).
 *
 * The trigger is a clock-scaled margin line, not a flat threshold:
 *   line(clock) = concedeMarginBase + concedeMarginPerMin × minutes left
 * because the "safe" lead grows with remaining time (margin divergence is
 * √t diffusion; the linear line tracks the classic safe-lead heuristics
 * within a point or two across the window). The LEADER concedes at the
 * line; the trailing coach holds hope concedeTrailLagPts longer — so
 * "leader first" is structural, not scheduled. Exit sits concedeExitPts
 * below entry: re-inserting starters is a deliberate act, not a flicker,
 * and because the line itself falls as the clock runs, re-entry after an
 * exit means re-stretching the lead against a falling bar. No rng, no
 * events — a game that never crosses the line is byte-identical.
 */
export function updateConcede(s: GameState): void {
  if (s.period < s.rules.periods) {
    s.conceded[0] = false;
    s.conceded[1] = false;
    return;
  }
  const P = s.params.sub;
  const line = P.concedeMarginBase + P.concedeMarginPerMin * (s.clock / 60);
  for (const side of [0, 1] as TeamSide[]) {
    const lead = s.score[side] - s.score[other(side)];
    // the trailer's bar sits concedeTrailLagPts above the leader's
    const enterAt = lead >= 0 ? line : line + P.concedeTrailLagPts;
    const m = Math.abs(lead);
    if (m >= enterAt) s.conceded[side] = true;
    else if (m < enterAt - P.concedeExitPts) s.conceded[side] = false;
    // inside [enterAt − concedeExitPts, enterAt): hold the current state
  }
}

/**
 * Dead-ball substitution pass. Per on-court player the FIRST matching regime
 * wins — crunch > concede > fatigue/minutes rotation — and the `continue`s
 * ARE that precedence (see the ordering-trap note on the concede branch).
 */
export function checkSubs(s: GameState, protect?: string): void {
  const P = s.params.sub;
  // crunch-time definition: final scheduled period under 5 minutes (300s)
  // left — or ANY overtime stoppage — and a one-possession-ish game (10
  // points or fewer): this is when coaches ride their best five regardless
  // of the clock's fatigue read. The OT arm is load-bearing, not redundant:
  // overtime exists because the game is close and late, and its opening
  // stoppage arrives with clock set to exactly otMinutes*60 — a clock-only
  // strict `<` excluded that one dead ball, so the fatigue rotation benched
  // gassed starters at every OT tip and the first in-OT whistle pulled them
  // straight back (audit H-02: 12/12 OT games affected, 39 players benched
  // at exactly 300.0). It also keeps a custom pack whose otMinutes exceeds
  // crunchClockSec/60 riding starters through the whole extra period.
  const crunch =
    s.period >= s.rules.periods &&
    (s.clock < P.crunchClockSec || s.period > s.rules.periods) &&
    Math.abs(s.score[0] - s.score[1]) <= P.crunchMarginPts;
  // GARBAGE-TIME CONCEDE, hysteresis update (once per pass, before the
  // player loop). The order is the contract: crunch clears concede
  // UNCONDITIONALLY — a blown-open game that tightens back into
  // one-possession territory inside 5:00 gets its starters back through the
  // crunch branch below no matter what the concede flags said (the 20→8
  // collapse path rides this precedence).
  if (crunch) s.conceded = [false, false];
  else updateConcede(s);

  for (const side of [0, 1] as TeamSide[]) {
    const team = s.teams[side];
    const starters = new Set(team.starters);
    for (const id of [...s.lineup[side]]) {
      if (id === protect) continue;
      const a = agent(s, id);
      if (a.fouledOut) continue;
      if (crunch) {
        // close & late: get starters back on the floor if they can stand —
        // energy > 35 is a much looser bar than the normal readyThreshold
        // (88): in crunch time you play your starter gassed rather than sit
        // him for a fresher bench piece
        if (!starters.has(id)) {
          const starter = team.starters
            .map((sid) => agent(s, sid))
            .find((x) =>
              !x.onCourt && !x.fouledOut && x.energy > P.crunchEnergyMin &&
              // a scratched starter is contradictory input, but the scratch
              // contract is total: 0-target players are never auto-inserted
              !isScratched(s, side, x.p.id));
          if (starter) swapPlayers(s, side, a, starter);
        }
        continue;
      }
      if (s.conceded[side]) {
        // decided game: starters come OUT, and whoever's on the bench closes
        // it. ORDERING TRAP: this branch must sit BEFORE the fatigue/minutes
        // rotation below — a starter benched in a conceded Q4 immediately
        // reads behind pace with rising energy, and the controller's
        // eager-return path would re-insert him at the very next dead ball
        // and fight the concede forever. The `continue` suspends the fatigue
        // rotation AND the minutes controller while the side stays conceded.
        if (starters.has(id)) {
          const bench = team.players
            .map((p) => agent(s, p.id))
            .filter((b) =>
              !b.onCourt && !b.fouledOut && !starters.has(b.p.id) &&
              // a DNP scratch (rotationMinutes 0) is not in uniform — even
              // garbage time doesn't activate him (see minutesPace)
              !isScratched(s, side, b.p.id) &&
              b.energy > P.concedeEnergyMin);
          if (bench.length > 0) {
            // same-position preference, then most-rested (the same
            // Number(bool) sort trick as the rotation below)
            bench.sort((x, y) =>
              Number(y.p.pos === a.p.pos) - Number(x.p.pos === a.p.pos) ||
              y.energy - x.energy);
            swapPlayers(s, side, a, bench[0]!);
          }
        }
        continue;
      }
      // starters run longer stints; bench players yield the floor back sooner —
      // a starter plays until tiredThreshold, a reserve is pulled 12 energy
      // points earlier (shorter leash, deeper bench rotation)
      let tiredAt = starters.has(id) ? P.tiredThreshold : P.tiredThreshold + P.benchTiredBonus;
      // minutes-aware leash: with a coach's target (Team.rotationMinutes) a
      // behind-pace player is ridden deeper into fatigue and an ahead-of-pace
      // one rests earlier. Teams without targets are byte-identical to the
      // old behavior — this field had sat UNWIRED since the Team interface
      // gained it (the fidelity casts were requesting star minutes into the
      // void, and the hub benchmark ran 32 min against a 36 target).
      const pace = minutesPace(s, side, a);
      if (pace !== null) {
        tiredAt += clamp((pace - 1) * P.rotationLeashScale, -P.rotationLeashMax, P.rotationLeashMax);
      }
      if (a.energy < tiredAt) {
        // behind-pace targeted players return EAGERLY (reduced ready bar and
        // sorted first): the bench-sit, not the pull timing, is what actually
        // caps a star's minutes — the leash alone moved him +0.5 a game
        // the eager-return gate sets the equilibrium: targets settle at
        // ~gate x target minutes (0.92 produced 33 of 36). 0.97 with the
        // ahead-hold at 1.08 brackets the target from both sides.
        const behindPace = (b: Agent) => {
          const bp = minutesPace(s, side, b);
          return bp !== null && bp < P.eagerReturnPace;
        };
        const bench = team.players
          .map((p) => agent(s, p.id))
          .filter((b) => {
            if (b.onCourt || b.fouledOut) return false;
            // the controller's other half: a target player AHEAD of pace is
            // HELD BACK even when rested — without this, most-rested sorting
            // returned the star at every dead ball and targets read 44 min
            const bp = minutesPace(s, side, b);
            if (bp !== null && bp > P.aheadHoldPace) return false;
            return b.energy >= (behindPace(b) ? P.readyThreshold - P.readyReliefBonus : P.readyThreshold);
          });
        if (bench.length === 0) continue;
        // prefer behind-pace targets, then a same-position replacement
        // (Number(bool) sorts true before false when used as the primary
        // comparator), then most-rested among ties
        bench.sort((x, y) =>
          Number(behindPace(y)) - Number(behindPace(x)) ||
          Number(y.p.pos === a.p.pos) - Number(x.p.pos === a.p.pos) ||
          y.energy - x.energy
        );
        swapPlayers(s, side, a, bench[0]!);
      }
    }
  }
}

/**
 * Immediately replace a fouled-out player with the best available bench
 * option. Called synchronously from `recordFoul` the moment `fouler.fouls`
 * crosses the rule pack's foul-out limit — unlike `checkSubs`, this fires
 * mid-live-play (a foul-out can happen at any point in the action), not just
 * at dead-ball checkpoints, because the rules require it immediately.
 */
export function replaceFouledOut(s: GameState, out: Agent): void {
  const side = out.side;
  const bench = s.teams[side].players
    .map((p) => agent(s, p.id))
    // a DNP scratch (rotationMinutes 0, see minutesPace) is not in uniform:
    // he cannot be the emergency body either — a team that scratched its
    // whole bench plays on shorthanded, same as a fully fouled-out bench
    .filter((a) => !a.onCourt && !a.fouledOut && !isScratched(s, side, a.p.id));
  if (bench.length === 0) return; // nobody left — play on (edge case)
  // same-position preference first (see the identical trick in checkSubs),
  // then most-rested — a foul-out replacement isn't fatigue-triggered, so
  // energy is just a tiebreaker among equally-positioned options, not a gate
  bench.sort((a, b) =>
    Number(b.p.pos === out.p.pos) - Number(a.p.pos === out.p.pos) || b.energy - a.energy
  );
  swapPlayers(s, side, out, bench[0]!);
}
