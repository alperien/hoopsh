/**
 * Narrative context tracker: scoring runs, lead changes, milestones, clutch.
 * Both the template layer and LLM commentary providers feed on this.
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
  private runPts: [number, number] = [0, 0];
  private lastLeader: TeamSide | -1 = -1;
  private playerPts = new Map<string, number>();
  private milestonesHit = new Map<string, number>();
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
      // runs
      this.runPts[scored.team] += scored.pts;
      this.runPts[scored.team === 0 ? 1 : 0] = 0;
      const run = this.runPts[scored.team];
      if (run === 8 || run === 12 || run === 16) {
        push({
          kind: 'run', t: e.t, period: e.period, clock: e.clock, team: scored.team,
          detail: `${run}-0 run`
        });
      }

      // player milestones
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

      // lead changes / ties
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
      if (leader !== -1) this.lastLeader = leader;
    }

    // clutch time: final period, last 3 minutes, margin within 6
    if (!this.clutchAnnounced && e.period >= 4 && e.clock <= 180 && Math.abs(e.score[0] - e.score[1]) <= 6) {
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
