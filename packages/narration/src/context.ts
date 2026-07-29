/**
 * Narrative context tracker: scoring runs, lead changes, milestones, clutch.
 * Both the template layer and LLM commentary providers feed on this.
 *
 * FROZEN PROTOTYPE per project decision (see docs/INTERNALS.md's "frozen
 * demo layer" note and ARCHITECTURE.md §6): kept as the reference consumer
 * of the event stream, showing what a narration/commentary experience built
 * on hoopsh's events looks like. The engine never depends on this package or
 * anything it decides — narration purely reads `GameEvent`s and never
 * influences game logic (AGENTS.md §1.3, §6). Frozen means: no new moment
 * kinds or threshold tuning is in scope here without a project-level
 * decision to unfreeze it; bugs found while reading this file are reported,
 * not silently fixed.
 *
 * Moment taxonomy (the `NarrativeMoment['kind']` union below), each fired at
 * most where noted:
 *  - `run`: one team scores 8, then 12, then 16 UNANSWERED points (any score
 *    by the other side resets the counter to 0 — see `runPts` below). Each
 *    threshold fires once per run, so an 8-0 run that continues to 16-0
 *    produces two moments (at 8 and at 12... and a third at 16), not one.
 *  - `milestone`: a player crosses 20/30/40/50 total points for the game,
 *    each threshold firing once per game per player (`milestonesHit` below
 *    guards against re-firing on every subsequent basket past the bar).
 *  - `lead_change`: the scoring team's basket flips which team has more
 *    points, and there WAS a clear leader immediately before (excludes the
 *    very first bucket of the game, since there's no prior leader to change
 *    away from).
 *  - `tie`: the score becomes even after having had a clear leader — the
 *    mirror case of lead_change.
 *  - `clutch_start`: fires exactly once per game, the first time play
 *    reaches the final period (period >= the ruleset's regulation period
 *    count, so overtime qualifies too) with the game clock at or under 3:00
 *    AND the margin at or under 6 points. All three conditions are
 *    basketball's working definition of "winning time" — a blowout in the
 *    final minutes isn't clutch, and a one-point game in the first quarter
 *    isn't either. The period count is a constructor input (default 4, NBA
 *    quarters) because "final period" is 2 under a halves ruleset — the
 *    old hardcoded `>= 4` made clutch unreachable in NCAA regulation.
 *
 * The 8/12/16, 20/30/40/50, 3:00, and 6-point numbers above are all FEEL
 * choices tuned for narration PACING (how often a moment fires over a
 * typical broadcast), not statistically derived or calibrated against real
 * broadcast conventions the way engine constants in SimParams are (AGENTS.md
 * §4.4/§5's REAL/SWEPT/FEEL provenance tags describe engine params; this
 * file's thresholds are narration-only and carry no such tag because
 * SimParams is engine-only surface, per AGENTS.md §1.4).
 */

import type { GameEvent, TeamSide } from '@hoopsh/engine';

export interface NarrativeMoment {
  kind: 'run' | 'lead_change' | 'milestone' | 'clutch_start' | 'tie';
  t: number;
  period: number;
  clock: number;
  team?: TeamSide;
  playerId?: string;
  detail: string;
}

export class ContextTracker {
  // regulation period count of the ruleset these events came from (NBA 4,
  // NCAA halves 2) — clutch_start's "final period" test below keys on it.
  // Plain field assignment, not a constructor parameter property (AGENTS.md
  // §1.7: erasable syntax only).
  private readonly finalPeriod: number;
  constructor(periods = 4) {
    this.finalPeriod = periods;
  }
  // per-team UNANSWERED points since the other side last scored — see the
  // reset-on-opponent-score line in update() below.
  private runPts: [number, number] = [0, 0];
  // -1 means "no leader yet" (tied, or game hasn't started scoring) — the
  // lead_change/tie logic below treats -1 as a sentinel distinct from either
  // real team side, not as "team -1".
  private lastLeader: TeamSide | -1 = -1;
  private playerPts = new Map<string, number>();
  // highest milestone bar (20/30/40/50) already announced per player, so a
  // player sitting at 42 points doesn't re-fire the 20 and 30 moments on
  // every subsequent bucket — only ever the NEXT bar up gets pushed.
  private milestonesHit = new Map<string, number>();
  // one-shot latch: clutch_start fires once per game, ever (see the
  // taxonomy note above) — this is what makes it "once", not the threshold
  // check itself, which would otherwise re-fire on every scoring play deep
  // in a close final period.
  private clutchAnnounced = false;
  readonly moments: NarrativeMoment[] = [];

  /** feed each event in order; returns moments newly created by this event */
  update(e: GameEvent): NarrativeMoment[] {
    const fresh: NarrativeMoment[] = [];
    const push = (m: NarrativeMoment): void => {
      this.moments.push(m);
      fresh.push(m);
    };

    const scored =
      (e.type === 'shot' && e.made && e.points > 0) ? { team: e.team, pts: e.points, playerId: e.shooter } :
      (e.type === 'free_throw' && e.made) ? { team: e.team, pts: 1, playerId: e.shooter } :
      null;

    if (scored) {
      // runs: credit the scoring team, then zero the OTHER team's counter —
      // in that order, so a team's own basket never clears its own tally
      // (only being scored ON by the opponent breaks a run). This is why
      // it's `runPts[opponent] = 0` and not `runPts = [0, 0]` reset-both.
      this.runPts[scored.team] += scored.pts;
      this.runPts[scored.team === 0 ? 1 : 0] = 0;
      const run = this.runPts[scored.team];
      // exact-equality checks (not >=) so a run that jumps straight from 6
      // to 9 via a three (skipping 8 outright) never fires the 8-run moment
      // it technically passed through — see the taxonomy note above on each
      // bar firing "once per run", which implicitly assumes the run lands
      // exactly on a bar at some point; a 3-point make can jump past one.
      if (run === 8 || run === 12 || run === 16) {
        push({
          kind: 'run', t: e.t, period: e.period, clock: e.clock, team: scored.team,
          detail: `${run}-0 run`
        });
      }

      // player milestones: same exact-vs-threshold subtlety doesn't apply
      // here because the check is `pts >= bar` (not `===`), so a player
      // jumping from 19 to 22 on a three still crosses the 20 bar correctly
      // — the `lastMs < bar` guard (not the crossing arithmetic) is what
      // prevents re-firing, and it's robust to skipped exact values.
      const pts = (this.playerPts.get(scored.playerId) ?? 0) + scored.pts;
      this.playerPts.set(scored.playerId, pts);
      const lastMs = this.milestonesHit.get(scored.playerId) ?? 0;
      for (const bar of [20, 30, 40, 50]) {
        if (pts >= bar && lastMs < bar) {
          this.milestonesHit.set(scored.playerId, bar);
          push({
            kind: 'milestone', t: e.t, period: e.period, clock: e.clock,
            team: scored.team, playerId: scored.playerId,
            detail: `${bar}+ points`
          });
        }
      }

      // lead changes / ties: both branches require `this.lastLeader !== -1`
      // — i.e. there must have been an actual prior leader — specifically to
      // suppress a false "tie"/"lead_change" moment on the very first score
      // of the game (0-0 -> 2-0 is team 0 taking an unremarkable first lead,
      // not a "lead change" from anything).
      const [h, a] = e.score;
      const leader: TeamSide | -1 = h > a ? 0 : a > h ? 1 : -1;
      if (leader === -1 && this.lastLeader !== -1) {
        push({ kind: 'tie', t: e.t, period: e.period, clock: e.clock, detail: `tied at ${h}` });
      } else if (leader !== -1 && this.lastLeader !== -1 && leader !== this.lastLeader) {
        push({
          kind: 'lead_change', t: e.t, period: e.period, clock: e.clock, team: leader,
          detail: 'lead change'
        });
      }
      // only overwrite lastLeader on a REAL leader (leader !== -1) — a tie
      // deliberately leaves lastLeader pointing at whoever led just before
      // the tie, so if that same team retakes the lead next basket it's
      // correctly NOT flagged as a lead_change (they never lost "leader"
      // status in this tracker's bookkeeping, only the scoreboard did).
      if (leader !== -1) this.lastLeader = leader;
    }

    // clutch time: final period (>= finalPeriod, so OT counts), last 3
    // minutes, margin within 6. Checked unconditionally on every event (not
    // just `scored` ones, unlike runs/milestones/lead-changes above) because
    // clock ticking into the window can make this true even on an event that
    // isn't itself a score (e.g. a rebound at 4:59 doesn't qualify, but the
    // very next non-scoring event after the clock crosses 3:00 should still
    // catch it rather than waiting for the next basket).
    if (!this.clutchAnnounced && e.period >= this.finalPeriod && e.clock <= 180 && Math.abs(e.score[0] - e.score[1]) <= 6) {
      this.clutchAnnounced = true;
      push({ kind: 'clutch_start', t: e.t, period: e.period, clock: e.clock, detail: 'clutch time' });
    }

    return fresh;
  }

  pointsFor(playerId: string): number {
    return this.playerPts.get(playerId) ?? 0;
  }

  currentRun(team: TeamSide): number {
    return this.runPts[team];
  }
}
