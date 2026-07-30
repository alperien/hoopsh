/**
 * Season layer — schedule generation, a deterministic multi-game driver, and
 * standings accumulation on top of the single-game engine.
 *
 * Design constraints this file answers to (see docs/SEASON.md for the full
 * rationale):
 *
 *  1. DETERMINISM — a season is a pure function of (seed base, schedule,
 *     rosters). Every game's seed is derived from the season seed base plus
 *     the game's schedule position and matchup (`gameSeed`), so re-running
 *     the same season reproduces byte-identical standings, and reordering
 *     unrelated schedule entries doesn't perturb games that didn't move.
 *
 *  2. GAMES ARE INDEPENDENT — deliberately. No fatigue carryover, injuries,
 *     rest, or travel today (docs/SEASON.md documents the seams where those
 *     would attach and what the omission costs in prediction accuracy).
 *     Independence is what makes the next point possible:
 *
 *  3. PARALLELISM IS A SEAM, NOT A FEATURE OF THIS FILE — `runSeason` hands
 *     the full task list to a `SimulateGames` function and folds standings
 *     from the returned outcomes AFTER sorting them by schedule index. The
 *     default implementation (`simulateTasksSequential`) is a plain
 *     in-process loop; a worker-pool runner (wave1/runner) can be dropped in
 *     by passing its own `SimulateGames` — completion ORDER cannot matter
 *     because nothing is accumulated until every outcome is in hand and
 *     re-sorted. Do not add cross-game state inside the seam without reading
 *     docs/SEASON.md first: independence is the property that makes the seam
 *     order-insensitive.
 */

import { simulateGame, type Team } from '@hoopsh/engine';
import { boxScore, type PlayerLine, type TeamTotals } from '@hoopsh/stats';

// ------------------------------------------------------------- schedule

/** One fixture: team IDS (not Team objects) so schedules serialize cleanly. */
export interface ScheduledGame {
  home: string;
  away: string;
  /** free-form date/round label — carried through untouched. This is the
   *  hook a future rest/travel model keys on; nothing reads it today. */
  date?: string;
}

/**
 * Generate a round-robin schedule via the classic circle method.
 *
 * - `rounds` full round-robins are concatenated (default 2 — a "double
 *   round-robin", every pair meeting once in each building).
 * - Home/away is balanced two ways. Within a cycle, the fixed pivot's game
 *   alternates venue by round parity and every other pairing takes venue
 *   from its ring-position parity — measured across n=4..10 this keeps
 *   every team's single-cycle |home − away| within 1 game (2 for odd
 *   leagues, which also carry a bye), where naive round-parity assignment
 *   let one team play an entire cycle away. Across cycles, every odd cycle
 *   mirrors the even one, so any (a,b) pair that met with `a` at home in
 *   cycle 0 meets with `b` at home in cycle 1 — with rounds=2 every pair
 *   plays exactly once in each team's building.
 * - Odd team counts get a bye: a phantom team joins the ROTATING ring (the
 *   fixed pivot slot stays a real team — `slots[0]`), and any pairing
 *   against the phantom is dropped, so each round one team rests. (A prior
 *   version of this line said the PIVOT becomes the phantom — backwards:
 *   under that mental model the k===0 venue-parity branch would never fire
 *   for odd leagues, when in the real code it fires for a real team's game
 *   every non-bye round. The inline comment at the `slots` construction
 *   below was always correct.)
 * - Deterministic: output depends only on `teamIds` order and `rounds`.
 *
 * `date` is set to the 0-based round label `"r<round>"` (rounds count across
 * cycles), which doubles as documentation of WHICH games could run in
 * parallel even under a future cross-game-state model: games in the same
 * round share no team.
 */
export function roundRobin(teamIds: readonly string[], rounds = 2): ScheduledGame[] {
  const ids = [...teamIds];
  if (new Set(ids).size !== ids.length) {
    throw new Error(`roundRobin: duplicate team ids in ${JSON.stringify(ids)}`);
  }
  if (ids.length < 2) throw new Error('roundRobin: need at least 2 teams');
  // exported API, same doctrine as the id checks above (audit L-41): a
  // fractional `rounds` silently ran a WHOLE extra cycle (`cycle < 1.5`
  // executes cycles 0 and 1) and a non-positive one returned an empty
  // schedule that downstream code happily "simulated" as a 0-game season
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`roundRobin: rounds must be an integer >= 1, got ${rounds}`);
  }
  const BYE = null;
  // even slot count: odd league sizes rotate a phantom whose games are byes
  const slots: (string | null)[] = ids.length % 2 === 0 ? ids : [...ids, BYE];
  const n = slots.length;
  const roundsPerCycle = n - 1;
  const out: ScheduledGame[] = [];

  for (let cycle = 0; cycle < rounds; cycle++) {
    // circle method: slots[0] fixed, the rest rotate one step per round
    const rot = slots.slice(1);
    for (let r = 0; r < roundsPerCycle; r++) {
      const ring = [slots[0], ...rot];
      const globalRound = cycle * roundsPerCycle + r;
      for (let k = 0; k < n / 2; k++) {
        // ring has exactly n entries (the fixed slot + the n-1 rotating), so
        // k and n-1-k are in bounds; undefined is a phantom of
        // noUncheckedIndexedAccess, while null (the bye) is real.
        const a = ring[k] as string | null;
        const b = ring[n - 1 - k] as string | null;
        if (a === BYE || b === BYE) continue;
        // venue rule (empirically the best of the simple circle-method
        // assignments — see the doc comment): pivot game alternates by
        // round, others take ring-position parity; odd cycles mirror.
        const aHome = k === 0 ? r % 2 === 0 : k % 2 === 1;
        let home = aHome ? a : b;
        let away = aHome ? b : a;
        if (cycle % 2 === 1) [home, away] = [away, home];
        out.push({ home, away, date: `r${globalRound}` });
      }
      rot.unshift(rot.pop()!);
    }
  }
  return out;
}

// ------------------------------------------------------- the simulate seam

/** One game, fully specified — the unit of work the parallelism seam sees.
 *  Everything a worker needs travels IN the task (seed, both rosters); the
 *  task closes over no season state, which is what makes it shippable to a
 *  worker thread/process by a future parallel runner. */
export interface GameTask {
  /** position in the season schedule — also the standings fold order */
  index: number;
  seed: string;
  home: Team;
  away: Team;
  date?: string;
}

/** Slim per-game result — scores plus box-score totals, NOT the event
 *  stream (a full 1230-game season of raw events would be memory-hostile;
 *  totals and player lines are what standings and distributions consume). */
export interface GameOutcome {
  index: number;
  seed: string;
  date?: string;
  homeId: string;
  awayId: string;
  /** [home, away] final score */
  score: [number, number];
  /** [home, away] team totals from the box score */
  totals: [TeamTotals, TeamTotals];
  /** per-player box lines for both sides (player-level distributions) */
  players: PlayerLine[];
}

/**
 * THE PARALLELISM SEAM. `runSeason`/`simulateMatchup` build the complete
 * task list up front and call one of these; the default below is a
 * sequential in-process loop. The wave1/runner worker pool replaces it by
 * satisfying this same signature — outcomes may be produced IN ANY ORDER
 * (callers re-sort by `task.index` before folding), and `onOutcome` is an
 * optional progress tap, also order-agnostic.
 */
export type SimulateGames = (
  tasks: readonly GameTask[],
  onOutcome?: (o: GameOutcome) => void
) => GameOutcome[] | Promise<GameOutcome[]>;

/** Simulate one task in-process: engine game + box score, no frames. */
export function simulateTask(task: GameTask): GameOutcome {
  const result = simulateGame({
    seed: task.seed,
    home: task.home,
    away: task.away,
    collectFrames: false
  });
  const box = boxScore(result.events, [task.home, task.away]);
  return {
    index: task.index,
    seed: task.seed,
    date: task.date,
    homeId: task.home.id,
    awayId: task.away.id,
    score: result.finalScore,
    totals: box.teams,
    players: box.players
  };
}

/** Default seam implementation: one game at a time, current process. */
export const simulateTasksSequential: SimulateGames = (tasks, onOutcome) => {
  const out: GameOutcome[] = [];
  for (const t of tasks) {
    const o = simulateTask(t);
    out.push(o);
    onOutcome?.(o);
  }
  return out;
};

// ------------------------------------------------------------ seeding

/**
 * Per-game seed: season seed base + schedule position + matchup.
 *
 * Position alone would suffice for reproducibility; including the matchup
 * ids buys a second property for free — a given (position, home, away)
 * triple simulates identically even if OTHER schedule entries around it are
 * edited, which keeps "tweak the schedule, diff the standings" experiments
 * interpretable. Mirrors run.ts's `${base}-${i}` convention, extended.
 */
export function gameSeed(seedBase: string, index: number, homeId: string, awayId: string): string {
  return `${seedBase}:g${index}:${awayId}@${homeId}`;
}

/** Build the full, self-contained task list for a schedule. Loud on a
 *  schedule that names a team the roster set doesn't contain. */
export function buildTasks(
  teams: readonly Team[],
  schedule: readonly ScheduledGame[],
  seedBase: string
): GameTask[] {
  const byId = new Map<string, Team>();
  for (const t of teams) {
    if (byId.has(t.id)) throw new Error(`buildTasks: duplicate team id "${t.id}"`);
    byId.set(t.id, t);
  }
  return schedule.map((g, i) => {
    const home = byId.get(g.home);
    const away = byId.get(g.away);
    if (!home) throw new Error(`schedule game ${i}: unknown home team "${g.home}"`);
    if (!away) throw new Error(`schedule game ${i}: unknown away team "${g.away}"`);
    if (g.home === g.away) throw new Error(`schedule game ${i}: ${g.home} cannot play itself`);
    return { index: i, seed: gameSeed(seedBase, i, g.home, g.away), home, away, date: g.date };
  });
}

// ------------------------------------------------------------ standings

/** W/L + points split for one venue (home or away). */
export interface VenueRecord {
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** Per-team season averages of the team's own counting stats. Ratio stats
 *  (fgPct/tpPct/ftPct) are volume-weighted (sum of makes / sum of attempts),
 *  matching aggregate.ts's rationale — NOT a mean of per-game percentages. */
export interface TeamSeasonAverages {
  pts: number; fga: number; fgPct: number; tpa: number; tpPct: number;
  fta: number; ftPct: number; trb: number; ast: number; stl: number;
  blk: number; tov: number; pf: number; poss: number;
}

export interface TeamStanding {
  teamId: string;
  games: number;
  wins: number;
  losses: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  /** total point differential; sums to exactly zero league-wide */
  diff: number;
  avgMargin: number;
  home: VenueRecord;
  away: VenueRecord;
  avg: TeamSeasonAverages;
  /**
   * Strength of schedule = mean of opponents' FINAL win percentage over this
   * team's games (with multiplicity — playing a strong team twice counts it
   * twice). This is the plain "opponents' winning percentage" (OWP); it does
   * NOT remove games-vs-this-team from the opponents' records and does not
   * recurse into opponents' opponents (the NCAA RPI-style refinement) —
   * documented in docs/SEASON.md.
   */
  sos: number;
}

/**
 * Fold outcomes into standings. Pure and order-insensitive: outcomes are
 * sorted by schedule index first, and every stat is a sum, so any completion
 * order from a parallel seam produces identical standings.
 *
 * `teamIds` (optional) pins the standings to a known roster set so a team
 * that went winless-AND-gameless (0 scheduled games) still appears; when
 * omitted, the team list is derived from the outcomes.
 */
export function computeStandings(
  outcomes: readonly GameOutcome[],
  teamIds?: readonly string[]
): TeamStanding[] {
  const ordered = [...outcomes].sort((a, b) => a.index - b.index);

  interface Acc {
    games: number; wins: number; losses: number;
    // spelled out (matching the exported VenueRecord) because `tot.pf` below
    // is personal FOULS — the same two-letter code with two meanings inside
    // one accumulator was a reader trap
    pointsFor: number; pointsAgainst: number;
    home: VenueRecord; away: VenueRecord;
    tot: { fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
           trb: number; ast: number; stl: number; blk: number; tov: number; pf: number; poss: number };
    opponents: string[]; // with multiplicity, for SOS
  }
  const emptyVenue = (): VenueRecord => ({ wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 });
  const emptyAcc = (): Acc => ({
    games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0,
    home: emptyVenue(), away: emptyVenue(),
    tot: { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, poss: 0 },
    opponents: []
  });

  const accs = new Map<string, Acc>();
  for (const id of teamIds ?? []) accs.set(id, emptyAcc());
  const acc = (id: string): Acc => {
    let a = accs.get(id);
    if (!a) {
      if (teamIds) throw new Error(`computeStandings: outcome references team "${id}" not in teamIds`);
      a = emptyAcc();
      accs.set(id, a);
    }
    return a;
  };

  for (const o of ordered) {
    const [hs, as] = o.score;
    if (hs === as) {
      // the engine plays overtime until someone leads (possession.ts
      // endPeriod) — a tie reaching standings means the outcome is corrupt
      throw new Error(`game ${o.index} (${o.awayId}@${o.homeId}): tied ${hs}-${as}, engine games cannot tie`);
    }
    const h = acc(o.homeId);
    const a = acc(o.awayId);
    const homeWon = hs > as;

    h.games += 1; a.games += 1;
    h.pointsFor += hs; h.pointsAgainst += as; a.pointsFor += as; a.pointsAgainst += hs;
    h.wins += homeWon ? 1 : 0; h.losses += homeWon ? 0 : 1;
    a.wins += homeWon ? 0 : 1; a.losses += homeWon ? 1 : 0;
    h.home.wins += homeWon ? 1 : 0; h.home.losses += homeWon ? 0 : 1;
    h.home.pointsFor += hs; h.home.pointsAgainst += as;
    a.away.wins += homeWon ? 0 : 1; a.away.losses += homeWon ? 1 : 0;
    a.away.pointsFor += as; a.away.pointsAgainst += hs;
    h.opponents.push(o.awayId);
    a.opponents.push(o.homeId);

    for (const side of [0, 1] as const) {
      const t = o.totals[side];
      const mine = side === 0 ? h : a;
      mine.tot.fgm += t.fgm; mine.tot.fga += t.fga;
      mine.tot.tpm += t.tpm; mine.tot.tpa += t.tpa;
      mine.tot.ftm += t.ftm; mine.tot.fta += t.fta;
      mine.tot.trb += t.trb; mine.tot.ast += t.ast; mine.tot.stl += t.stl;
      mine.tot.blk += t.blk; mine.tot.tov += t.tov; mine.tot.pf += t.pf;
      mine.tot.poss += t.poss;
    }
  }

  // pass 2: SOS needs everyone's FINAL win pct
  const winPct = new Map<string, number>();
  for (const [id, a] of accs) winPct.set(id, a.games === 0 ? 0 : a.wins / a.games);

  const standings: TeamStanding[] = [];
  for (const [teamId, a] of accs) {
    const g = Math.max(1, a.games);
    standings.push({
      teamId,
      games: a.games,
      wins: a.wins,
      losses: a.losses,
      winPct: a.games === 0 ? 0 : a.wins / a.games,
      pointsFor: a.pointsFor,
      pointsAgainst: a.pointsAgainst,
      diff: a.pointsFor - a.pointsAgainst,
      avgMargin: (a.pointsFor - a.pointsAgainst) / g,
      home: a.home,
      away: a.away,
      avg: {
        pts: a.pointsFor / g,
        fga: a.tot.fga / g,
        fgPct: a.tot.fga === 0 ? 0 : a.tot.fgm / a.tot.fga,
        tpa: a.tot.tpa / g,
        tpPct: a.tot.tpa === 0 ? 0 : a.tot.tpm / a.tot.tpa,
        fta: a.tot.fta / g,
        ftPct: a.tot.fta === 0 ? 0 : a.tot.ftm / a.tot.fta,
        trb: a.tot.trb / g,
        ast: a.tot.ast / g,
        stl: a.tot.stl / g,
        blk: a.tot.blk / g,
        tov: a.tot.tov / g,
        pf: a.tot.pf / g,
        poss: a.tot.poss / g
      },
      sos: a.opponents.length === 0
        ? 0
        : a.opponents.reduce((s, id) => s + (winPct.get(id) ?? 0), 0) / a.opponents.length
    });
  }

  // sort: win pct, then total point differential, then id (total order so
  // equal-record ties are still byte-stable across runs)
  standings.sort((x, y) =>
    y.winPct - x.winPct || y.diff - x.diff || (x.teamId < y.teamId ? -1 : x.teamId > y.teamId ? 1 : 0)
  );
  return standings;
}

// ------------------------------------------------------------ the driver

export interface SeasonOptions {
  /** roster set; schedule entries refer to these by team id */
  teams: readonly Team[];
  /** explicit fixture list; defaults to a double round-robin over `teams`
   *  in the order given */
  schedule?: readonly ScheduledGame[];
  /** season seed base (default "season") — see gameSeed for derivation */
  seedBase?: string;
  /** THE PARALLELISM SEAM — see SimulateGames; defaults to the in-process
   *  sequential loop */
  simulate?: SimulateGames;
  /** progress tap; may fire in any order under a parallel seam */
  onGame?: (o: GameOutcome) => void;
}

export interface SeasonResult {
  seedBase: string;
  schedule: ScheduledGame[];
  /** per-game results, in schedule order */
  outcomes: GameOutcome[];
  /** sorted standings (win pct desc, diff desc, id) */
  standings: TeamStanding[];
}

/**
 * Simulate a season: build every game task up front, run them through the
 * simulate seam, then fold standings from the (re-sorted) outcomes.
 * Async only because a parallel seam is async; the default seam never yields.
 */
export async function runSeason(opts: SeasonOptions): Promise<SeasonResult> {
  const seedBase = opts.seedBase ?? 'season';
  const schedule = [...(opts.schedule ?? roundRobin(opts.teams.map((t) => t.id)))];
  const tasks = buildTasks(opts.teams, schedule, seedBase);
  const sim = opts.simulate ?? simulateTasksSequential;
  const outcomes = [...await sim(tasks, opts.onGame)].sort((a, b) => a.index - b.index);
  if (outcomes.length !== tasks.length) {
    throw new Error(`simulate seam returned ${outcomes.length} outcomes for ${tasks.length} tasks`);
  }
  // Index COVERAGE, not just count: a seam that duplicates one index and
  // drops another (an overlapping worker-slice bug whose total length still
  // matches) would otherwise fold silently — one game double-counted into
  // standings, another never simulated (scan finding B3-3). After the sort,
  // position i must hold index i exactly. Belt-and-braces in the spirit of
  // parallel.ts's assembled-length check, because this seam is the
  // advertised drop-in point for the wave1/runner worker pool.
  for (let i = 0; i < outcomes.length; i++) {
    if (outcomes[i]!.index !== i) {
      throw new Error(`simulate seam returned duplicate/missing game indices (sorted position ${i} holds index ${outcomes[i]!.index})`);
    }
  }
  const standings = computeStandings(outcomes, opts.teams.map((t) => t.id));
  return { seedBase, schedule, outcomes, standings };
}
