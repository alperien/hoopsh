/**
 * Substitutions: swapping players in/out of the lineup, fatigue-driven
 * rotation checks, and fouled-out replacement.
 *
 * `checkSubs` is called only from stoppages (`deadBall`, `endPeriod` in
 * possession.ts, `enterFreeThrows` and the staged between-FT slot in
 * fouls.ts), never mid-live-play; real substitutions only happen at
 * stoppages.
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
  // stint/rest bookkeeping (state.ts Agent.lastSwapT doc); the only writer
  out.lastSwapT = s.t;
  into.lastSwapT = s.t;
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
    else if (!s.conceded[side]) {
      // Inside the band [enterAt − exit, enterAt) the FLAG holds — but the
      // flag is not the whole state. The engine evaluates concede only at
      // dead balls, and running-clock make-inbounds host no pass at all, so
      // a side can arrive at its first Q4 stoppage with a bench-shaped
      // floor (ordinary Q3-fatigue lineups) and a margin a HALF-POINT under
      // the moving line: flag false, rotation free, five starters flood
      // back — and the next whistle, one made FT later, is over the line
      // and concedes all five straight back out. Ten bodies in ten seconds
      // (measured: the concede-pin-0 fixture at Q4 9:28, m 24 vs bar 24.48,
      // full thrash cycle inside 10.1 s of game clock — REGISTER W67).
      // True hysteresis holds the OBSERVABLE state: a side already fielding
      // a conceded lineup (a full five with ≤1 starter) inside the band
      // STAYS conceded — re-inserting starters into a decided-enough game
      // requires the margin to actually fall through the exit floor,
      // exactly like the flag's own contract one line up. The five-body
      // guard keeps degenerate states (direct-unit fixtures) on the plain
      // flag contract.
      const bodies = onCourt(s, side);
      if (bodies.length === 5) {
        let startersOn = 0;
        const starters = new Set(s.teams[side].starters);
        for (const a of bodies) if (starters.has(a.p.id)) startersOn++;
        if (startersOn <= 1) s.conceded[side] = true;
      }
    }
    // inside [enterAt − concedeExitPts, enterAt): hold the current state
  }
}

/**
 * The classic coaching bar: a player is "in foul trouble" above
 * `period + ftroublePersonalOffset` personals (offset 1: 2 in Q1, 3 by
 * half, 4 in Q3, 5 in Q4). Self-clearing: the bar rises each period, so a
 * pulled player becomes eligible again at the next period start (corpus:
 * 87.7% of pulled players return no earlier than the next quarter). In OT
 * the bar reaches foulOutAt and the concept dissolves: ride him (real).
 * Crunch never consults this (its `continue` precedes the pull branch):
 * riding a 5-foul starter in a close endgame is the real override.
 * Live at the shipped offset 1 (the classic period+1 bar) since the FLOW
 * flip; 99 = the staged unreachable bar.
 */
function inFoulTrouble(s: GameState, a: Agent): boolean {
  return !a.fouledOut && a.fouls >= s.period + s.params.sub.ftroublePersonalOffset;
}

/**
 * Quarter-break wave (period-opening stoppage only; checkSubs' wave opt,
 * passed by possession.ts endPeriod): who sits = longest current stints;
 * who enters = freshest eligible bench, behind-pace targets first. Q1 start
 * and OT starts are excluded (period > 1, period <= rules.periods; OT is
 * crunch's floor, and corpus OT is near sub-free at 3.0/OT). Gated off under
 * crunch at the call site (a Q4 boundary inside a close game keeps its
 * five) and per-side under concede here. Entries are ranked by the same
 * minutesPace the eager-return path uses, so the 35-minute equilibrium is
 * preserved by construction; determinism rides roster/lineup insertion
 * order + stable sorts (AGENTS §1.2). Live at waveMaxPerTeam 2 since the
 * FLOW flip; 0 = staged inert.
 */
function quarterWave(s: GameState): void {
  const P = s.params.sub;
  if (P.waveMaxPerTeam <= 0) return; // 0 = staged-inert guard
  if (s.period <= 1 || s.period > s.rules.periods) return;
  for (const side of [0, 1] as TeamSide[]) {
    if (s.conceded[side]) continue; // concede outranks the wave
    const team = s.teams[side];
    const starters = new Set(team.starters);
    // second-half reset: at the halftime boundary starters return (real
    // Q3-start starter share 96.2%); generic over rule packs
    const halfReset = (s.period - 1) * 2 === s.rules.periods;
    const behindPace = (b: Agent): boolean => {
      const p = minutesPace(s, side, b);
      return p !== null && p < P.eagerReturnPace;
    };
    // With the halfReset override live the bench-rest floor must not gate
    // H2-boundary entries: halftime is 15 real minutes of rest, but s.t is
    // the live-clock axis and never advances through the break, so a
    // starter pulled late in Q2 would otherwise be blocked from opening Q3
    // (the real Q3-start starter share is 96.2%). Live at waveHalfResetMax
    // 5 since the FLOW flip; 0 = staged off.
    const skipBenchFloor = halfReset && P.waveHalfResetMax > 0;
    const entries = team.players.map((p) => agent(s, p.id)).filter((b) =>
      !b.onCourt && !b.fouledOut && !inFoulTrouble(s, b) &&
      // the scratch contract is total (audit M-13/M-14): a DNP scratch is
      // not in uniform, so the wave never inserts him either
      !isScratched(s, side, b.p.id) &&
      b.energy >= P.readyThreshold - P.waveReadyRelief &&
      // minutes targets are exempt from the bench floor (design OQ4
      // scoping; same rule as the fatigue-rotation filter below)
      (skipBenchFloor || minutesPace(s, side, b) !== null ||
        s.t - b.lastSwapT >= P.subMinBenchSec));
    entries.sort((x, y) =>
      Number(behindPace(y)) - Number(behindPace(x)) ||
      (halfReset ? Number(starters.has(y.p.id)) - Number(starters.has(x.p.id)) : 0) ||
      y.energy - x.energy);
    // The halftime reset is a planned lineup restore, not a stint judgment
    // (ffit-rotations §3.3): with waveHalfResetMax > 0 the H2 boundary
    // ignores the exit stint gate (a late-Q2 bench entrant re-sits so a
    // starter opens Q3) and swaps up to the override cap instead of
    // waveMaxPerTeam. STAGED 0 keeps the plain wave.
    const resetOverride = halfReset && P.waveHalfResetMax > 0;
    const exits = [...s.lineup[side]].map((id) => agent(s, id)).filter((a) =>
      !a.fouledOut &&
      (resetOverride || s.t - a.lastSwapT >= P.waveStintMinSec) &&
      !(halfReset && starters.has(a.p.id))); // never wave a starter out at the H2 reset
    exits.sort((x, y) =>
      Number(inFoulTrouble(s, y)) - Number(inFoulTrouble(s, x)) || // troubled first
      (s.t - y.lastSwapT) - (s.t - x.lastSwapT) ||                 // longest stint next
      x.energy - y.energy);
    const n = Math.min(
      resetOverride ? P.waveHalfResetMax : P.waveMaxPerTeam,
      exits.length, entries.length);
    for (let i = 0; i < n; i++) {
      const out = exits[i]!;
      // same-position preference among remaining entries (Number(bool)
      // idiom; the sort is stable, so the pace/reset/energy ranking above
      // survives as the within-group order)
      entries.sort((x, y) => Number(y.p.pos === out.p.pos) - Number(x.p.pos === out.p.pos));
      swapPlayers(s, side, out, entries.shift()!);
    }
  }
}

/**
 * Dead-ball substitution pass. Per on-court player the FIRST matching regime
 * wins — crunch > concede > foul-trouble pull > fatigue/minutes rotation —
 * and the `continue`s ARE that precedence (see the ordering-trap note on the
 * concede branch). The quarter-break wave runs before the player loop.
 */
export function checkSubs(
  s: GameState,
  protect?: string,
  opts?: {
    /** period-opening stoppage: run the quarter-break wave first (possession.ts endPeriod) */
    wave?: boolean;
    /** run only the urgent branches (foul-trouble pull + concede): no wave,
     *  no fatigue rotation, no proactive return. Callers: the between-FT
     *  slot and the mode-3 trip entry (fouls.ts, sub.ftGapSubMode, STAGED
     *  0 = never called); rng-free, so an idle call is a no-op. */
    urgentOnly?: boolean;
  }
): void {
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
  // the quarter-break wave runs before the player loop (the fatigue pass
  // then sees the post-wave lineup and normally has nothing left to do);
  // suppressed wholesale under crunch: a close Q4 opens with its five
  if (opts?.wave && !crunch && !opts.urgentOnly) quarterWave(s);
  // huddle relaxation (fdesign-timeouts §4 handshake): a timeout at this
  // stoppage loosens the pull leash below, and the coach makes the
  // non-urgent swap he'd otherwise defer. STAGED 0 relaxation = read-only.
  const huddle =
    (s.phase.kind === 'dead' || s.phase.kind === 'freethrows') &&
    s.phase.timeout !== undefined;
  // FT administration is itself a planned sub window (ffit-rotations §3.2):
  // the coach uses the dead seconds at the line the way he uses a huddle,
  // just less aggressively (own magnitude; FT windows host 33.8% of corpus
  // subs). A timeout at the line keeps the larger huddle relaxation.
  // STAGED 0 = read-only.
  const ftAdmin = s.phase.kind === 'freethrows' && !huddle;

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
        // him for a fresher bench piece. This filter is deliberately
        // foul-trouble-blind (no inFoulTrouble term): riding a 5-foul
        // starter in a close endgame is the crunch-overrides-trouble rule.
        // The `continue` also guarantees no foul-trouble pull under crunch.
        if (!starters.has(id) && !opts?.urgentOnly) {
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
              // troubled bodies enter only via crunch/foul-out (the
              // foul-trouble invariant; inert at the staged 99 offset)
              !b.onCourt && !b.fouledOut && !starters.has(b.p.id) &&
              // a DNP scratch (rotationMinutes 0) is not in uniform — even
              // garbage time doesn't activate him (see minutesPace)
              !isScratched(s, side, b.p.id) &&
              !inFoulTrouble(s, b) &&
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
      // Foul-trouble pull (fdesign-rotations §2.4, live at the shipped
      // offset 1): pull regardless of fatigue/minutes-pace; the replacement bar is
      // replaceFouledOut's (any standing non-troubled body, position first,
      // energy as tiebreaker), not readyThreshold, because the pull must
      // happen even with a gassed bench. A foul inside the period's last
      // ftroubleIgnoreClockSec rides to the break (the boundary wave then
      // handles him; troubled players sort first among wave exits).
      if (inFoulTrouble(s, a) && s.clock > P.ftroubleIgnoreClockSec) {
        const bench = team.players
          .map((p) => agent(s, p.id))
          // the scratch contract is total (audit M-13/M-14): never the
          // trouble replacement either
          .filter((b) =>
            !b.onCourt && !b.fouledOut && !inFoulTrouble(s, b) &&
            !isScratched(s, side, b.p.id));
        if (bench.length > 0) {
          bench.sort((x, y) =>
            Number(y.p.pos === a.p.pos) - Number(x.p.pos === a.p.pos) || y.energy - x.energy);
          swapPlayers(s, side, a, bench[0]!);
        }
        continue; // a troubled player never falls through to the fatigue rotation
      }
      // urgent-only pass (the between-FT slot): the routine fatigue/minutes
      // rotation is deferred to the next full stoppage
      if (opts?.urgentOnly) continue;
      // starters run longer stints; bench players yield the floor back sooner —
      // a starter plays until tiredThreshold, a reserve is pulled 12 energy
      // points earlier (shorter leash, deeper bench rotation)
      let tiredAt = starters.has(id) ? P.tiredThreshold : P.tiredThreshold + P.benchTiredBonus;
      // a huddle loosens the leash for this stoppage only (STAGED 0 = no-op)
      if (huddle) tiredAt += P.timeoutSubRelaxPts;
      // the FT-line planned window: a smaller relaxation (STAGED 0 = no-op)
      if (ftAdmin) tiredAt += P.ftGapRelaxPts;
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
            // Return-block trap: a just-pulled foul-troubled starter
            // immediately reads behind pace with rising energy; without
            // this filter the eager-return path re-inserts him at the very
            // next dead ball and ping-pongs forever (same trap the concede
            // branch documents). The bar self-clears at the next period.
            if (inFoulTrouble(s, b)) return false;
            // churn floor: nobody returns after less than subMinBenchSec of
            // pine (STAGED 0 = off; crunch exempt by construction, its
            // branch above has its own filter). Scoped to untargeted
            // players (design OQ4): a minutes target's returns belong to
            // the controller (the eager-return and ahead-hold brackets),
            // and the floor exists for the untargeted rank-and-file
            // oscillation. Un-scoped at 300 the floor forced every star
            // spell to outlast the pace decay (35-target stars read ~29
            // min/g, the design §4.2 tripwire); behind-pace-only scoping
            // still ran ~5-min spells, since an on-pace star had to decay
            // below the eager gate before the floor released him.
            if (minutesPace(s, side, b) === null && s.t - b.lastSwapT < P.subMinBenchSec) return false;
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
    // Proactive eager return (ffit-rotations §3.4, live at
    // eagerReturnProactive 1; 0 = off): a rested behind-pace minutes target
    // re-enters at the next legal stoppage even when nobody on the floor
    // reads tired. The eager-return path above is passive: it fires only
    // inside another player's pull, which the legacy engine hit every ~30 s
    // (checkSubs at every made-basket dead ball). With the real-rule
    // windows (postMakeSubWindow 0) on-court players hover above their bars
    // for minutes and a 35-target star settled at ~29-32 min/g. The real
    // coach re-inserts his star when the rest is done; he does not wait for
    // a teammate to collapse. One proactive return per side per pass. The
    // out-swap is the lowest pull-margin (energy minus bar) untargeted
    // on-court player; ahead-hold and the pull leash still bracket the
    // equilibrium, so targets settle near target minutes by the same math.
    // No-op for rosters without rotationMinutes, by construction.
    if (P.eagerReturnProactive > 0 && !crunch && !s.conceded[side] && !opts?.urgentOnly) {
      const rot = team.rotationMinutes;
      if (rot) {
        const cands = Object.keys(rot)
          .map((id) => agent(s, id))
          .filter((b) => {
            if (b.onCourt || b.fouledOut || inFoulTrouble(s, b)) return false;
            const bp = minutesPace(s, side, b);
            // full ready bar: a proactive return is a planned one, the
            // coach waits out real rest (entry at ~88 keeps the star's
            // on-court energy at the calibrated shooting baseline; the
            // opportunistic in-pull path above keeps the relief bar)
            return bp !== null && bp < P.eagerReturnPace &&
              b.energy >= P.readyThreshold;
          })
          .sort((x, y) => {
            const px = minutesPace(s, side, x) ?? 1;
            const py = minutesPace(s, side, y) ?? 1;
            return px - py; // most behind first
          });
        if (cands.length > 0) {
          const into = cands[0]!;
          const margin = (x: Agent): number => {
            let bar = starters.has(x.p.id) ? P.tiredThreshold : P.tiredThreshold + P.benchTiredBonus;
            const xp = minutesPace(s, side, x);
            if (xp !== null) bar += clamp((xp - 1) * P.rotationLeashScale, -P.rotationLeashMax, P.rotationLeashMax);
            return x.energy - bar;
          };
          const outs = [...s.lineup[side]]
            .filter((id) => id !== protect)
            .map((id) => agent(s, id))
            .filter((x) => !x.fouledOut && minutesPace(s, side, x) === null)
            .sort((x, y) =>
              Number(y.p.pos === into.p.pos) - Number(x.p.pos === into.p.pos) ||
              margin(x) - margin(y));
          if (outs.length > 0) swapPlayers(s, side, outs[0]!, into);
        }
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
