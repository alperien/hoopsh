/**
 * GameSense — the running truth a broadcast booth keeps in its head.
 *
 * A pure fold over the event stream (the same guarantee stats/box.ts relies
 * on: everything here is derivable from events alone — AGENTS.md §1.3).
 * Where box.ts folds once at game end, GameSense folds incrementally so the
 * booth can cite mid-game truth: "that's 24 for Mercer", "the Monarchs
 * haven't scored in four minutes", "he's got four fouls".
 *
 * update(e) additionally returns a SenseDelta — the transitions THIS event
 * caused (lead change, run threshold, milestone, drought broken, foul
 * trouble, double-double). The beat compiler turns deltas into tags and note
 * beats instead of re-deriving them; keeping detection here means the
 * booth's "what just changed" and its "what is true" can never disagree.
 *
 * All thresholds are FEEL constants tuned for narration pacing (how often a
 * note fires over a broadcast), same provenance stance as v1's context.ts —
 * they are narration-layer choices, not SimParams surface.
 */

import type { GameEvent, Team, TeamSide } from '@hoopsh/engine';

export interface PlayerLine {
  pts: number;
  fgm: number; fga: number;
  tpm: number; tpa: number;
  ftm: number; fta: number;
  oreb: number; dreb: number;
  ast: number; stl: number; blk: number; tov: number;
  pf: number;
  ptsThisPeriod: number;
  /** consecutive made FGs (resets on a miss) — 3+ reads as "heating up" */
  hitStreak: number;
  /** consecutive missed FGs (resets on a make) — 4+ reads as "ice cold" */
  missStreak: number;
}

export interface TeamSense {
  /** current unanswered-points run */
  run: number;
  /** game-clock time of this team's last point (for drought phrasing); -1 = none yet */
  lastScoreT: number;
  foulsThisPeriod: number;
  /** timeouts this team has been charged (coach calls + mandatory) */
  timeoutsTaken: number;
  /** true when the OPPONENT's fouling has put this team's offense in the bonus */
  offenseInBonus: boolean;
  biggestLead: number;
  fastbreakPts: number;
  secondChancePts: number;
  paintPts: number;
  tpm: number; tpa: number;
  tov: number;
}

export interface PossessionSense {
  team: TeamSide;
  kind: 'inbound' | 'live_rebound' | 'steal' | 'tip';
  startT: number;
  startWt: number;
  passes: number;
  lastPass: { from: string; to: string; kind: string; t: number } | null;
  orebs: number;
}

/** transitions caused by one event — consumed by the beat compiler */
export interface SenseDelta {
  /** the scoring team took a lead it did not hold before this event */
  goAhead?: TeamSide;
  tie?: number; // the tied score
  /** unanswered run reached a narration bar (8/12/16/20) */
  runReached?: { team: TeamSide; run: number };
  milestone?: { playerId: string; bar: number };
  /** scoring team had gone this many game-seconds without a point (fires at 240+) */
  droughtBrokenSecs?: number;
  /** a player reached a foul count worth flagging (3 in the 1st half, 4, 5) */
  foulTrouble?: { playerId: string; count: number };
  doubleDouble?: { playerId: string };
  clutchStart?: boolean;
}

const RUN_BARS = [8, 12, 16, 20]; // FEEL — 8 starts "timeout territory" talk
const MILESTONE_BARS = [20, 30, 40, 50]; // FEEL — same bars as v1 context.ts
const DROUGHT_NOTE_SECS = 240; // FEEL — 4 scoreless game-minutes is broadcast-worthy
const FASTBREAK_WINDOW_SECS = 8; // FEEL — steal/live-rebound converted this fast is "on the break"

function emptyLine(): PlayerLine {
  return {
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    ptsThisPeriod: 0, hitStreak: 0, missStreak: 0
  };
}

function emptyTeam(): TeamSense {
  return {
    run: 0, lastScoreT: -1, foulsThisPeriod: 0, timeoutsTaken: 0, offenseInBonus: false,
    biggestLead: 0, fastbreakPts: 0, secondChancePts: 0, paintPts: 0,
    tpm: 0, tpa: 0, tov: 0
  };
}

export class GameSense {
  readonly lines = new Map<string, PlayerLine>();
  readonly team: [TeamSense, TeamSense] = [emptyTeam(), emptyTeam()];
  readonly onCourt: [Set<string>, Set<string>] = [new Set(), new Set()];
  readonly sideOf = new Map<string, TeamSide>();
  poss: PossessionSense | null = null;
  leadChanges = 0;
  ties = 0;

  /** score/period team-level checkpoints for quarter recaps */
  private periodStart: { score: [number, number]; tpm: [number, number]; tov: [number, number]; paint: [number, number]; fb: [number, number] } =
    { score: [0, 0], tpm: [0, 0], tov: [0, 0], paint: [0, 0], fb: [0, 0] };
  private lastScore: [number, number] = [0, 0];
  private lastLeader: TeamSide | -1 = -1;
  private milestonesHit = new Map<string, number>();
  private ddAnnounced = new Set<string>();
  private ftFlagged = new Map<string, number>();
  private clutchAnnounced = false;

  readonly teams: [Team, Team];

  constructor(teams: [Team, Team]) {
    this.teams = teams;
    for (const side of [0, 1] as const) {
      for (const p of teams[side].players) {
        this.sideOf.set(p.id, side);
        this.lines.set(p.id, emptyLine());
      }
    }
  }

  line(id: string): PlayerLine {
    let l = this.lines.get(id);
    if (!l) {
      // unknown ids never happen with valid packs, but a sense layer must
      // not crash a broadcast over one — degrade to an empty line.
      l = emptyLine();
      this.lines.set(id, l);
    }
    return l;
  }

  margin(): number {
    return Math.abs(this.lastScore[0] - this.lastScore[1]);
  }

  leader(): TeamSide | -1 {
    const [h, a] = this.lastScore;
    return h > a ? 0 : a > h ? 1 : -1;
  }

  score(): [number, number] {
    return [this.lastScore[0], this.lastScore[1]];
  }

  /** game-clock seconds since `side` last scored (Infinity before their first point) */
  drought(side: TeamSide, tNow: number): number {
    const last = this.team[side].lastScoreT;
    return last < 0 ? Infinity : tNow - last;
  }

  /** top scorer on `side` right now: [playerId, points] (insertion order breaks ties deterministically) */
  topScorer(side: TeamSide): [string, number] {
    let best: [string, number] = ['', -1];
    for (const p of this.teams[side].players) {
      const pts = this.line(p.id).pts;
      if (pts > best[1]) best = [p.id, pts];
    }
    return best;
  }

  /** per-period team deltas since the last period_start — recap material */
  periodDeltas(): { pts: [number, number]; tpm: [number, number]; tov: [number, number]; paint: [number, number]; fb: [number, number] } {
    return {
      pts: [this.lastScore[0] - this.periodStart.score[0], this.lastScore[1] - this.periodStart.score[1]],
      tpm: [this.team[0].tpm - this.periodStart.tpm[0], this.team[1].tpm - this.periodStart.tpm[1]],
      tov: [this.team[0].tov - this.periodStart.tov[0], this.team[1].tov - this.periodStart.tov[1]],
      paint: [this.team[0].paintPts - this.periodStart.paint[0], this.team[1].paintPts - this.periodStart.paint[1]],
      fb: [this.team[0].fastbreakPts - this.periodStart.fb[0], this.team[1].fastbreakPts - this.periodStart.fb[1]]
    };
  }

  /** full-game team totals in the same shape as periodDeltas — final-recap material */
  gameTotals(): { pts: [number, number]; tpm: [number, number]; tov: [number, number]; paint: [number, number]; fb: [number, number] } {
    return {
      pts: [this.lastScore[0], this.lastScore[1]],
      tpm: [this.team[0].tpm, this.team[1].tpm],
      tov: [this.team[0].tov, this.team[1].tov],
      paint: [this.team[0].paintPts, this.team[1].paintPts],
      fb: [this.team[0].fastbreakPts, this.team[1].fastbreakPts]
    };
  }

  update(e: GameEvent): SenseDelta {
    const d: SenseDelta = {};

    switch (e.type) {
      case 'game_start': {
        for (const id of e.home.lineup) this.onCourt[0].add(id);
        for (const id of e.away.lineup) this.onCourt[1].add(id);
        break;
      }
      case 'period_start': {
        for (const l of this.lines.values()) l.ptsThisPeriod = 0;
        this.team[0].foulsThisPeriod = 0;
        this.team[1].foulsThisPeriod = 0;
        this.team[0].offenseInBonus = false;
        this.team[1].offenseInBonus = false;
        this.periodStart = {
          score: [this.lastScore[0], this.lastScore[1]],
          tpm: [this.team[0].tpm, this.team[1].tpm],
          tov: [this.team[0].tov, this.team[1].tov],
          paint: [this.team[0].paintPts, this.team[1].paintPts],
          fb: [this.team[0].fastbreakPts, this.team[1].fastbreakPts]
        };
        break;
      }
      case 'possession_start': {
        this.poss = {
          team: e.team, kind: e.kind, startT: e.t, startWt: e.wt,
          passes: 0, lastPass: null, orebs: 0
        };
        break;
      }
      case 'pass': {
        if (this.poss) {
          this.poss.passes += 1;
          this.poss.lastPass = { from: e.from, to: e.to, kind: e.kind, t: e.t };
        }
        break;
      }
      case 'shot': {
        const l = this.line(e.shooter);
        l.fga += 1;
        if (e.three) l.tpa += 1;
        this.team[e.team].tpa += e.three ? 1 : 0;
        if (e.assist) this.line(e.assist).ast += 1;
        if (e.blockedBy) this.line(e.blockedBy).blk += 1;
        if (e.made) {
          l.fgm += 1;
          l.hitStreak += 1;
          l.missStreak = 0;
          if (e.three) {
            l.tpm += 1;
            this.team[e.team].tpm += 1;
          }
          if (e.zone === 'rim' || e.zone === 'paint') this.team[e.team].paintPts += e.points;
          if (this.poss && this.poss.orebs > 0) this.team[e.team].secondChancePts += e.points;
          if (
            this.poss &&
            (this.poss.kind === 'steal' || this.poss.kind === 'live_rebound') &&
            this.poss.orebs === 0 &&
            e.t - this.poss.startT <= FASTBREAK_WINDOW_SECS
          ) {
            this.team[e.team].fastbreakPts += e.points;
          }
          this.applyScore(e, e.team, e.points, e.shooter, d);
        } else {
          l.missStreak += 1;
          l.hitStreak = 0;
        }
        break;
      }
      case 'free_throw': {
        const l = this.line(e.shooter);
        l.fta += 1;
        if (e.made) {
          l.ftm += 1;
          this.applyScore(e, e.team, 1, e.shooter, d);
        }
        break;
      }
      case 'rebound': {
        // playerless boards (team caroms, dead-ball formalities) carry no
        // actor since the flow contract made `player` optional: no line to
        // credit, but a live offensive team board still extends the
        // possession, matching the box-score fold's team-only crediting.
        // stage-2: vocabulary — give the booth a team-credited call here.
        if (e.player !== undefined) {
          const l = this.line(e.player);
          if (e.offensive) l.oreb += 1;
          else l.dreb += 1;
          this.checkDoubleDouble(e.player, d);
        }
        if (e.offensive && !e.deadBall && this.poss) this.poss.orebs += 1;
        break;
      }
      case 'turnover': {
        this.line(e.player).tov += 1;
        this.team[e.team].tov += 1;
        if (e.stolenBy) this.line(e.stolenBy).stl += 1;
        break;
      }
      case 'foul': {
        const l = this.line(e.on);
        l.pf = e.personalCount; // event carries the authoritative running total
        this.team[e.team].foulsThisPeriod = e.teamCountInPeriod;
        // e.inBonus means the fouling side's count has armed the bonus, which
        // belongs to the OTHER team's offense.
        if (e.inBonus) this.team[e.team === 0 ? 1 : 0].offenseInBonus = true;
        // foul-trouble bars: 3 personals before halftime, then 4 and 5 any
        // time (FEEL — the counts a real booth flags). fouledOut is its own
        // event field; the beat compiler tags it directly.
        const flaggedAt = this.ftFlagged.get(e.on) ?? 0;
        const bar =
          e.personalCount === 3 && e.period <= 2 ? 3 :
          e.personalCount === 4 ? 4 :
          e.personalCount === 5 ? 5 : 0;
        if (bar > 0 && flaggedAt < bar && !e.fouledOut) {
          this.ftFlagged.set(e.on, bar);
          d.foulTrouble = { playerId: e.on, count: e.personalCount };
        }
        break;
      }
      case 'timeout': {
        this.team[e.team].timeoutsTaken += 1;
        break;
      }
      case 'jump_ball':
      case 'violation':
      case 'replay_review':
        // flow-vocabulary stoppages: narrated from beats.ts directly; no
        // box-line or team-truth to fold here
        break;
      case 'substitution': {
        for (let i = 0; i < e.out.length; i++) {
          this.onCourt[e.team].delete(e.out[i]!);
          const inId = e.in[i];
          if (inId) this.onCourt[e.team].add(inId);
        }
        break;
      }
      default:
        break;
    }

    // clutch entry — the v1 context.ts definition, kept identical on purpose
    // (final period, ≤3:00, margin ≤6): the booth and any v1 consumer agree
    // on when "winning time" starts.
    if (!this.clutchAnnounced && e.period >= 4 && e.clock <= 180 && Math.abs(e.score[0] - e.score[1]) <= 6) {
      this.clutchAnnounced = true;
      d.clutchStart = true;
    }

    this.lastScore = [e.score[0], e.score[1]];
    return d;
  }

  /** shared bookkeeping for any scored point (FG or FT) */
  private applyScore(
    e: GameEvent,
    team: TeamSide,
    pts: number,
    playerId: string,
    d: SenseDelta
  ): void {
    const opp = team === 0 ? 1 : 0;
    const l = this.line(playerId);
    l.pts += pts;
    l.ptsThisPeriod += pts;

    // drought: how long the SCORING team had gone without a point before this
    const prevLast = this.team[team].lastScoreT;
    if (prevLast >= 0 && e.t - prevLast >= DROUGHT_NOTE_SECS) {
      d.droughtBrokenSecs = e.t - prevLast;
    }
    this.team[team].lastScoreT = e.t;

    // unanswered run: credit scorer, zero the opponent (a team's own basket
    // never clears its own tally — same ordering rationale as v1 context.ts)
    this.team[team].run += pts;
    this.team[opp].run = 0;
    const run = this.team[team].run;
    // exact-bar containment check: a 3 can jump a bar (7→10 skips 8), so test
    // "crossed" rather than "equals" — bars fire once per run via runFired.
    for (const bar of RUN_BARS) {
      if (run >= bar && run - pts < bar) {
        d.runReached = { team, run: bar };
        break;
      }
    }

    // milestones (20/30/40/50 once per player per game)
    const lastMs = this.milestonesHit.get(playerId) ?? 0;
    for (const bar of MILESTONE_BARS) {
      if (l.pts >= bar && lastMs < bar) {
        this.milestonesHit.set(playerId, bar);
        d.milestone = { playerId, bar };
      }
    }

    this.checkDoubleDouble(playerId, d);

    // lead accounting from the event's own post-score line
    const [h, a] = e.score;
    const leader: TeamSide | -1 = h > a ? 0 : a > h ? 1 : -1;
    if (leader !== -1) {
      const lead = Math.abs(h - a);
      if (lead > this.team[leader].biggestLead) this.team[leader].biggestLead = lead;
    }
    if (leader === -1 && this.lastLeader !== -1) {
      this.ties += 1;
      d.tie = h;
    } else if (leader !== -1 && this.lastLeader !== -1 && leader !== this.lastLeader) {
      this.leadChanges += 1;
      d.goAhead = leader;
    }
    if (leader !== -1) this.lastLeader = leader;
  }

  private checkDoubleDouble(playerId: string, d: SenseDelta): void {
    if (this.ddAnnounced.has(playerId)) return;
    const l = this.line(playerId);
    const cats = [l.pts, l.oreb + l.dreb, l.ast, l.stl, l.blk].filter((v) => v >= 10).length;
    if (cats >= 2) {
      this.ddAnnounced.add(playerId);
      d.doubleDouble = { playerId };
    }
  }
}
