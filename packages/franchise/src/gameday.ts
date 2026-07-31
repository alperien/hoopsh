/**
 * gameday.ts - projection from franchise truth to engine inputs, and the
 * result fold back. OWNER: spine task.
 *
 * Projection applies, in order: roster health (injured players excluded),
 * fatigue (stamina debuff from B2B/trailing load), home-court advantage as
 * the road-team attribute debuff (params.hca; the engine is side-symmetric
 * by design and must stay that way -- SEASON.md), then rotation policy ->
 * engine starters/rotationMinutes. Everything the engine does not model
 * arrives here as a roster edit at task construction (SEASON.md seam 2);
 * the engine Team built here is a throwaway PROJECTION -- mutating it
 * changes nothing durable (docs/FRANCHISE_INTERNALS.md trap list).
 *
 * extractKeyPlays lives HERE (not media/) because workers fold with it:
 * full event streams are kept only for the user's games; every other game
 * persists as box + key plays, folded in the worker (FRANCHISE.md §4).
 */
import { simulateGame } from '@hoopsh/engine';
import type { GameEvent, Player, Team } from '@hoopsh/engine';
import { ATTR_KEYS } from '@hoopsh/data';
import { boxScore } from '@hoopsh/stats';
import type {
  FrPlayer, FrTeam, GameJob, GameJobResult, GameLine, GameRecord, KeyPlay,
  League, PlayerId, PlayerSeasonRow, ScheduledGame, TeamTotalsLite,
} from './types.js';
import { gameSeedFor } from './rng.js';
import { applyResultToStandings, emptyStanding } from './standings.js';

// Projection constants. These are structural conventions of the projection,
// not sweepable levers (the sweepable fatigue/HCA magnitudes live in
// params.fatigue / params.hca).
const FATIGUE_DEBUFF_CAP = 25;  // FEEL: even a brutal stretch never zeroes a pro's legs; caps stacked B2B+load debuffs

/**
 * The dials home court degrades on the road: offensive execution only.
 * Shooting, finishing, and decision speed travel badly; defense does not
 * (a uniform debuff self-cancels, W60's league-scale measurement).
 */
const HCA_OFFENSE_KEYS = [
  'finishing', 'midRange', 'three', 'freeThrow', 'passAcc', 'decisions',
] as const;
const REGULATION_PERIODS = 4;   // REAL: NBA regulation is four periods; box periods beyond this are overtime
const TEAM_MINUTES = 240;       // REAL: 5 positions x 48 minutes, the target every rotation renormalizes toward
const MAX_KEY_PLAYS = 8;        // FEEL: a recap reads like a recap at 3-8 moments, not a play-by-play dump
const RUN_POINTS = 10;          // REAL-ish: 10-0 is the broadcast convention for "a run"
const COMEBACK_POINTS = 15;     // FEEL: a 15-point hole flipped is retelling-worthy (real broadcast cutoff varies 15-20)
const LATE_CLOCK_SEC = 120;     // REAL: "clutch" lead changes are the final two minutes of Q4/OT
const BUZZER_CLOCK_SEC = 1;     // FEEL: a make with <= 1s on the period clock reads as a buzzer beater
const MILESTONE_PTS = 40;       // REAL-ish: the 40-point game is the standard individual-scoring headline

/**
 * Crude overall ability: the plain mean of all engine attributes. Used ONLY
 * as a deterministic fallback ordering (starter fill, derived rotations,
 * option-value proxies in tick.ts) until ai/roster.ts's depthChart becomes
 * the league's real depth source after the build wave -- the ai-team task
 * maintains team.rotation for AI teams daily once it lands, so this
 * ordering then only backstops policies that injuries have hollowed out.
 * Iterates ATTR_KEYS in its fixed declared order so float sums are
 * bit-stable regardless of how a player object was assembled.
 */
export function abilityScore(p: FrPlayer): number {
  let sum = 0;
  for (const k of ATTR_KEYS) sum += p.attr[k];
  return sum / ATTR_KEYS.length;
}

/**
 * Players a team can dress tonight: standard roster plus two-way players
 * inside their game limit (docs/FRANCHISE_INTERNALS.md trap list), status
 * 'roster' (a G-League assignment or free agent never projects), and no
 * open injury.
 */
function healthyPool(league: League, team: FrTeam): FrPlayer[] {
  const pool: FrPlayer[] = [];
  for (const id of team.roster) {
    const p = league.players[id];
    if (p && p.status === 'roster' && p.health.injury === null) pool.push(p);
  }
  for (const id of team.twoWay) {
    const p = league.players[id];
    if (!p || p.status !== 'roster' || p.health.injury !== null) continue;
    // Two-ways dress only inside the season game limit (REAL: 50-game cap).
    if ((p.twoWayGamesUsed ?? 0) < league.params.cba.twoWayGameLimit) pool.push(p);
  }
  return pool;
}

/** Whether this team has a stored result dated (season, day). */
function playedOn(league: League, teamId: string, season: number, day: number): boolean {
  for (const id of Object.keys(league.results)) {
    const r = league.results[id]!;
    if (r.date.season === season && r.date.day === day && (r.home === teamId || r.away === teamId)) return true;
  }
  return false;
}

/**
 * Minutes this player logged over the trailing load window, counting only
 * games above the load floor (short cameos do not wear a body; starters
 * carry load -- params.fatigue.loadMinutesFloor).
 */
function trailingLoadMinutes(league: League, playerId: PlayerId): number {
  const { loadWindowDays, loadMinutesFloor } = league.params.fatigue;
  const from = league.day - loadWindowDays;
  let total = 0;
  for (const id of Object.keys(league.results)) {
    const r = league.results[id]!;
    if (r.date.season !== league.season) continue;
    if (r.date.day < from || r.date.day >= league.day) continue;
    for (const line of r.lines) {
      if (line.playerId === playerId && line.min > loadMinutesFloor) total += line.min;
    }
  }
  return total;
}

/**
 * Project one franchise team into an engine Team for a specific game.
 * Pure read of league state (never mutates FrPlayer/FrTeam); called from
 * planDayJobs for both sides of every scheduled game.
 *
 * Tactics always read from team.coach: the user's setTactics action
 * mutates the coach's pace/threeBias/helpAggr prefs (tick.ts), so there is
 * exactly one tactics source whether a human or the AI runs the bench.
 */
export function projectTeam(league: League, teamId: string, opts: { isHome: boolean; gameId: string }): Team {
  const team = league.teams[teamId];
  if (!team) throw new Error(`projectTeam: unknown team '${teamId}'`);
  const params = league.params;
  const pool = healthyPool(league, team);
  // A league whose roster rules hold can always dress five; failing loud
  // beats silently fabricating bodies (trust pillar, FRANCHISE.md §1).
  if (pool.length < 5) {
    throw new Error(`projectTeam: ${teamId} has ${pool.length} healthy players; cannot field five for ${opts.gameId}`);
  }

  const backToBack = playedOn(league, teamId, league.season, league.day - 1);

  const players: Player[] = pool.map((p) => {
    const attr = { ...p.attr };
    // Fatigue arrives as a stamina debuff: tired legs drain faster in-game,
    // which the engine's own fatigue model then turns into shorter stints
    // and late-game slippage (SEASON.md seam: pre-degrade, do not re-model).
    let debuff = 0;
    if (backToBack) debuff += params.fatigue.b2bStaminaDebuff;
    debuff += params.fatigue.loadDebuffPer60Min * (trailingLoadMinutes(league, p.id) / 60);
    attr.stamina -= Math.min(debuff, FATIGUE_DEBUFF_CAP);
    if (!opts.isHome) {
      // Home court as a road debuff keeps the engine side-symmetric. A
      // UNIFORM debuff measured near zero at league scale (two acceptance
      // seasons read 48-51% home): worse offense and worse defense cancel.
      // So the debuff hits the offensive-execution dials only, which is
      // also the empirically real mechanism: road teams shoot and decide
      // worse, they do not forget how to defend (REGISTER W60).
      for (const k of HCA_OFFENSE_KEYS) attr[k] -= params.hca.roadAttrDebuff;
    }
    // One final integer pass: projected rosters stay integer-valued like
    // authored packs, and Math.round is platform-deterministic.
    for (const k of ATTR_KEYS) attr[k] = Math.max(0, Math.round(attr[k]));
    return {
      id: p.id, name: p.name, pos: p.pos,
      heightIn: p.heightIn, weightLb: p.weightLb, wingspanIn: p.wingspanIn,
      attr, tend: { ...p.tend },
    };
  });
  const projectedById = new Map(players.map((p) => [p.id, p]));

  // Fallback ordering by TRUE ability (pre-debuff): a road night must not
  // reshuffle who a team believes its best players are.
  const byAbility = [...pool].sort((a, b) => abilityScore(b) - abilityScore(a) || (a.id < b.id ? -1 : 1));

  const scratched = new Set(team.rotation.scratches);
  // Load management: on the second night of a back-to-back, a starter whose
  // PROJECTED stamina (after tonight's debuffs) sits below the policy's
  // b2bRestBelow threshold gets the night off.
  const rested = new Set<PlayerId>();
  if (backToBack) {
    for (const id of team.rotation.starters) {
      const proj = projectedById.get(id);
      if (proj && proj.attr.stamina < team.rotation.b2bRestBelow) rested.add(id);
    }
  }
  const sitsTonight = (id: PlayerId): boolean => scratched.has(id) || rested.has(id);

  const starters: string[] = team.rotation.starters.filter((id) => projectedById.has(id) && !sitsTonight(id));
  for (const p of byAbility) {
    if (starters.length >= 5) break;
    if (!sitsTonight(p.id) && !starters.includes(p.id)) starters.push(p.id);
  }
  // Last resort: fielding five outranks any rest/scratch policy (a coach
  // un-scratches a body before forfeiting). Only reachable when sits cut
  // the healthy pool below five.
  for (const p of byAbility) {
    if (starters.length >= 5) break;
    if (!starters.includes(p.id)) starters.push(p.id);
  }
  const starterSet = new Set(starters);

  const minutes: Record<string, number> = {};
  let explicitTotal = 0;
  const explicit: Array<[PlayerId, number]> = [];
  for (const [id, v] of Object.entries(team.rotation.minutes)) {
    if (!projectedById.has(id) || sitsTonight(id) || v <= 0) continue;
    explicit.push([id, v]);
    explicitTotal += v;
  }
  if (explicitTotal > 0) {
    // Renormalize the surviving targets toward 240: when an injury removes
    // a 34-minute wing, his minutes flow proportionally to everyone left,
    // which is how a real staff redistributes a night's workload.
    for (const [id, v] of explicit) minutes[id] = Math.round((v * TEAM_MINUTES) / explicitTotal);
  } else {
    // No policy on file: derive a 10-man rotation from the ability ordering
    // and the params.rotation tier arrays. ai/roster.ts's defaultRotation
    // replaces this as the default source once the ai-team task lands (it
    // maintains team.rotation for AI teams daily); this stays as the
    // in-projection backstop for an empty policy.
    const abilityStarters = byAbility.filter((p) => starterSet.has(p.id));
    abilityStarters.forEach((p, i) => {
      minutes[p.id] = params.rotation.starterMinutes[Math.min(i, params.rotation.starterMinutes.length - 1)]!;
    });
    const bench = byAbility.filter((p) => !starterSet.has(p.id) && !sitsTonight(p.id));
    bench.slice(0, params.rotation.benchMinutes.length).forEach((p, i) => {
      minutes[p.id] = params.rotation.benchMinutes[i]!;
    });
  }
  // Healthy scratches and rested starters are explicit zeros: the engine
  // reads a 0 target as a DNP scratch (sim/subs.ts) -- not in uniform, no
  // garbage-time mop-up. A last-resort promotion into the starting five
  // overrides the sit.
  for (const p of pool) {
    if (sitsTonight(p.id) && !starterSet.has(p.id)) minutes[p.id] = 0;
  }

  return {
    id: team.id,
    name: `${team.city} ${team.name}`,
    abbrev: team.abbrev,
    players,
    starters,
    tactics: { pace: team.coach.pace, threeBias: team.coach.threeBias, helpAggr: team.coach.helpAggr },
    rotationMinutes: minutes,
  };
}

/**
 * Plan the jobs for every game scheduled today (league.schedule plus the
 * play-in slate), sorted by game id so job indexes are deterministic.
 * detail 'events' keeps the full stream for the user's game (watch mode /
 * replay); every other game folds in the worker (FRANCHISE.md §4).
 */
export function planDayJobs(league: League): GameJob[] {
  const seen = new Set<string>();
  const today: ScheduledGame[] = [];
  for (const g of [...league.schedule, ...league.playin]) {
    if (g.date.season !== league.season || g.date.day !== league.day || seen.has(g.id)) continue;
    seen.add(g.id);
    today.push(g);
  }
  today.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return today.map((g, index) => ({
    index,
    gameId: g.id,
    seed: gameSeedFor(league.seed, g.id),
    home: projectTeam(league, g.home, { isHome: true, gameId: g.id }),
    away: projectTeam(league, g.away, { isHome: false, gameId: g.id }),
    detail: g.home === league.userTeam || g.away === league.userTeam ? 'events' : 'fold',
  }));
}

/** 'Q4 2:31' / 'OT 0:03' style game-clock context for a key play. */
function clockLabel(period: number, clock: number): string {
  const tag = period <= REGULATION_PERIODS ? `Q${period}` : period === REGULATION_PERIODS + 1 ? 'OT' : `OT${period - REGULATION_PERIODS}`;
  const m = Math.floor(clock / 60);
  const s = Math.floor(clock % 60);
  return `${tag} ${m}:${String(s).padStart(2, '0')}`;
}

/** Surname for recap text ('Mercer', not 'Del Mercer LLC'): last name token. */
function surname(names: Record<string, string>, id: string): string {
  const full = names[id] ?? id;
  const parts = full.split(' ');
  return parts[parts.length - 1]!;
}

/**
 * Key-play extraction used by the fold: scoring runs of RUN_POINTS+
 * unanswered, lead changes in the last two minutes of Q4/OT, buzzer
 * beaters, 40-point individual games, and completed 15+ point comebacks.
 * Text is plain and factual (no exclamation marks -- news register,
 * FRANCHISE.md §10); capped at MAX_KEY_PLAYS, trimming the least
 * retelling-worthy kinds first so a Q1 run never crowds out the buzzer
 * beater that decided it.
 */
export function extractKeyPlays(events: GameEvent[], names: Record<string, string>): KeyPlay[] {
  const plays: KeyPlay[] = [];

  // run tracking: consecutive points by one side with none conceded
  let runTeam: 0 | 1 | null = null;
  let runPts = 0;
  let runLast: { period: number; clock: number; score: [number, number]; scorer: string } | null = null;
  const flushRun = (): void => {
    if (runTeam !== null && runPts >= RUN_POINTS && runLast) {
      plays.push({
        period: runLast.period,
        clock: clockLabel(runLast.period, runLast.clock),
        score: [...runLast.score] as [number, number],
        kind: 'run',
        text: `${surname(names, runLast.scorer)} caps a ${runPts}-0 run`,
      });
    }
  };

  // leader / comeback tracking
  let lastLeader: 1 | -1 | null = null; // sign of home minus away, ignoring ties
  const maxDeficit: [number, number] = [0, 0];
  const comebackDone: [boolean, boolean] = [false, false];
  // milestone tracking: per-shooter running points
  const pts = new Map<string, number>();

  for (const e of events) {
    let scoringTeam: 0 | 1 | null = null;
    let scoredBy = '';
    let scored = 0;
    if (e.type === 'shot' && e.made) {
      scoringTeam = e.team;
      scoredBy = e.shooter;
      scored = e.points;
    } else if (e.type === 'free_throw' && e.made) {
      scoringTeam = e.team;
      scoredBy = e.shooter;
      scored = 1;
    }

    if (e.type === 'shot' && e.made && e.clock <= BUZZER_CLOCK_SEC) {
      const zoneText = e.three ? 'from deep' : e.zone === 'rim' ? 'at the rim' : e.zone === 'paint' ? 'in the paint' : 'from midrange';
      plays.push({
        period: e.period,
        clock: clockLabel(e.period, e.clock),
        score: [...e.score] as [number, number],
        kind: 'buzzer',
        text: `${surname(names, e.shooter)} beats the horn ${zoneText}`,
      });
    }

    if (scoringTeam !== null) {
      // runs
      if (runTeam === scoringTeam) {
        runPts += scored;
      } else {
        flushRun();
        runTeam = scoringTeam;
        runPts = scored;
      }
      runLast = { period: e.period, clock: e.clock, score: [...e.score] as [number, number], scorer: scoredBy };

      // milestones
      const total = (pts.get(scoredBy) ?? 0) + scored;
      pts.set(scoredBy, total);
      if (total >= MILESTONE_PTS && total - scored < MILESTONE_PTS) {
        plays.push({
          period: e.period,
          clock: clockLabel(e.period, e.clock),
          score: [...e.score] as [number, number],
          kind: 'milestone',
          text: `${surname(names, scoredBy)} reaches ${total} points`,
        });
      }

      // deficits and lead changes
      const margin = e.score[0] - e.score[1];
      maxDeficit[0] = Math.max(maxDeficit[0], -margin);
      maxDeficit[1] = Math.max(maxDeficit[1], margin);
      const sign: 1 | -1 | 0 = margin > 0 ? 1 : margin < 0 ? -1 : 0;
      if (sign !== 0) {
        const changed = lastLeader !== null && sign !== lastLeader;
        if (changed) {
          const leader: 0 | 1 = sign === 1 ? 0 : 1;
          if (!comebackDone[leader] && maxDeficit[leader] >= COMEBACK_POINTS) {
            // completing a 15+ point comeback IS the go-ahead moment, so it
            // reads as the leadChange kind with the comeback called out
            comebackDone[leader] = true;
            plays.push({
              period: e.period,
              clock: clockLabel(e.period, e.clock),
              score: [...e.score] as [number, number],
              kind: 'leadChange',
              text: `${surname(names, scoredBy)} completes the comeback from ${maxDeficit[leader]} down`,
            });
          } else if (e.period >= REGULATION_PERIODS && e.clock <= LATE_CLOCK_SEC) {
            plays.push({
              period: e.period,
              clock: clockLabel(e.period, e.clock),
              score: [...e.score] as [number, number],
              kind: 'leadChange',
              text: `${surname(names, scoredBy)} flips the lead, ${e.score[0]}-${e.score[1]}`,
            });
          }
        }
        lastLeader = sign;
      }
    }
  }
  flushRun();

  if (plays.length <= MAX_KEY_PLAYS) return plays;
  // Trim by kind worth, keeping chronology for the survivors. Lower rank =
  // more retelling-worthy; ties keep earlier plays (stable, deterministic).
  const rank: Record<KeyPlay['kind'], number> = {
    buzzer: 0, milestone: 1, leadChange: 2, run: 3, bigShot: 4, swat: 4, takeover: 4,
  };
  const keep = plays
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank[a.p.kind] - rank[b.p.kind] || a.i - b.i)
    .slice(0, MAX_KEY_PLAYS)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.p);
  return keep;
}

/**
 * Fold a finished game's events into the persisted result shape: box lines
 * via @hoopsh/stats (the repo's one authoritative event fold), lite team
 * totals, and key plays. Attaches the raw stream only for detail 'events'
 * jobs (the parallel runner's rule: aggregates cross the process boundary,
 * events do not, except for the user's own games).
 */
export function foldEvents(job: GameJob, events: GameEvent[]): GameJobResult {
  const box = boxScore(events, [job.home, job.away]);
  const names: Record<string, string> = {};
  for (const p of job.home.players) names[p.id] = p.name;
  for (const p of job.away.players) names[p.id] = p.name;
  const starters: [Set<string>, Set<string>] = [new Set(job.home.starters), new Set(job.away.starters)];

  const lines: GameLine[] = box.players.map((l) => ({
    playerId: l.id,
    teamId: l.team === 0 ? job.home.id : job.away.id,
    starter: starters[l.team].has(l.id),
    min: l.min,
    pts: l.pts, fgm: l.fgm, fga: l.fga, tpm: l.tpm, tpa: l.tpa,
    ftm: l.ftm, fta: l.fta, orb: l.orb, drb: l.drb, ast: l.ast,
    stl: l.stl, blk: l.blk, tov: l.tov, pf: l.pf,
    plusMinus: l.plusMinus,
  }));

  // biggest lead per side folds straight off the score progression
  let bigHome = 0;
  let bigAway = 0;
  for (const e of events) {
    bigHome = Math.max(bigHome, e.score[0] - e.score[1]);
    bigAway = Math.max(bigAway, e.score[1] - e.score[0]);
  }
  const toLite = (side: 0 | 1, biggestLead: number): TeamTotalsLite => {
    const t = box.teams[side];
    return {
      pts: t.pts, fgm: t.fgm, fga: t.fga, tpm: t.tpm, tpa: t.tpa,
      ftm: t.ftm, fta: t.fta, orb: t.orb, drb: t.drb, ast: t.ast,
      stl: t.stl, blk: t.blk, tov: t.tov, pf: t.pf,
      // one game has one pace; both lite rows carry it (box.pace is already
      // the per-team per-48 possession figure)
      pace: box.pace,
      fastbreakPts: t.fastbreakPts,
      biggestLead,
    };
  };

  return {
    index: job.index,
    gameId: job.gameId,
    final: box.finalScore,
    // overtime count derives from folded periods, not from a flag: the
    // stream is the only contract (AGENTS.md §1.3)
    ot: Math.max(0, box.periods - REGULATION_PERIODS),
    lines,
    totals: [toLite(0, bigHome), toLite(1, bigAway)],
    keyPlays: extractKeyPlays(events, names),
    ...(job.detail === 'events' ? { events } : {}),
  };
}

/** Zeroed stat row created the first time a player-season-team stint scores. */
function freshRow(season: number, teamId: string, type: 'regular' | 'playoffs'): PlayerSeasonRow {
  return {
    season, teamId, type,
    gp: 0, gs: 0, min: 0, pts: 0,
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    plusMinus: 0,
  };
}

/**
 * Apply completed results to league state, in schedule-index order:
 * GameRecord storage, player season rows, standings (regular season only;
 * play-in and playoff games touch neither the table nor the regular rows,
 * the real convention -- and preseason counts in no book at all), playoff
 * series win feeds (postseason.ts owns advancement and winner declaration;
 * this only stores what happened), and two-way game counters. Returns the
 * stored records; replayFile stays absent (the app sets it for games it
 * persisted streams for).
 */
export function applyGameResults(league: League, results: GameJobResult[]): GameRecord[] {
  const sorted = [...results].sort((a, b) => a.index - b.index);
  const records: GameRecord[] = [];
  for (const r of sorted) {
    const sched = league.schedule.find((g) => g.id === r.gameId) ?? league.playin.find((g) => g.id === r.gameId);
    if (!sched) throw new Error(`applyGameResults: result for unscheduled game '${r.gameId}'`);

    const record: GameRecord = {
      id: r.gameId,
      date: sched.date,
      type: sched.type,
      home: sched.home,
      away: sched.away,
      seed: gameSeedFor(league.seed, r.gameId),
      final: r.final,
      ot: r.ot,
      lines: r.lines,
      totals: r.totals,
      keyPlays: r.keyPlays,
      ...(sched.seriesId !== undefined ? { seriesId: sched.seriesId } : {}),
    };
    league.results[r.gameId] = record;

    if (record.type === 'regular' || record.type === 'playoffs') {
      const type = record.type;
      for (const line of record.lines) {
        const player = league.players[line.playerId];
        // A line naming an unknown player is corrupted state, not a case to
        // paper over: silently dropped stats are the trust failure this
        // layer exists to prevent.
        if (!player) throw new Error(`applyGameResults: line for unknown player '${line.playerId}' in ${r.gameId}`);
        let row = player.seasons.find((s) => s.season === league.season && s.teamId === line.teamId && s.type === type);
        if (!row) {
          row = freshRow(league.season, line.teamId, type);
          player.seasons.push(row);
        }
        const played = line.min > 0;
        if (played) {
          row.gp += 1;
          if (line.starter) row.gs += 1;
        }
        row.min += line.min;
        row.pts += line.pts;
        row.fgm += line.fgm; row.fga += line.fga;
        row.tpm += line.tpm; row.tpa += line.tpa;
        row.ftm += line.ftm; row.fta += line.fta;
        row.orb += line.orb; row.drb += line.drb;
        row.ast += line.ast; row.stl += line.stl; row.blk += line.blk;
        row.tov += line.tov; row.pf += line.pf;
        row.plusMinus += line.plusMinus;

        // two-way game counter: only regular-season appearances burn a
        // two-way game (REAL: the 50-game limit is a regular-season rule)
        if (type === 'regular' && played) {
          const team = league.teams[line.teamId];
          if (team && team.twoWay.includes(line.playerId)) {
            player.twoWayGamesUsed = (player.twoWayGamesUsed ?? 0) + 1;
          }
        }
      }
    }

    if (record.type === 'regular') {
      // The fold assumes rows exist; creating them here keeps the call safe
      // when results apply outside advanceDay (tests, tools).
      if (!league.standings[record.home]) league.standings[record.home] = emptyStanding(record.home);
      if (!league.standings[record.away]) league.standings[record.away] = emptyStanding(record.away);
      applyResultToStandings(league, record);
    }

    if (record.seriesId !== undefined) {
      const series = league.playoffs.find((s) => s.id === record.seriesId);
      if (series && !series.games.includes(record.id)) {
        series.games.push(record.id);
        const winner = record.final[0] > record.final[1] ? record.home : record.away;
        series.wins[winner === series.high ? 0 : 1] += 1;
      }
    }

    records.push(record);
  }
  return records;
}

/**
 * Sequential in-process SimulateJobs: engine game per job, folded here.
 * The seam implementation for tests and one-game days; the app's worker
 * pool replaces it behind the same signature (types.ts SimulateJobs).
 */
export function simulateJobsInline(jobs: GameJob[]): GameJobResult[] {
  const out: GameJobResult[] = [];
  for (const job of jobs) {
    const result = simulateGame({ seed: job.seed, home: job.home, away: job.away, collectFrames: false });
    out.push(foldEvents(job, result.events));
  }
  return out;
}
