/**
 * stock.ts - draft stock: per-team perception, the weekly mock, combine,
 * workouts, and the draft-night insertion. OWNER: stock task. STATUS:
 * implemented (build wave A).
 *
 * Design (docs/CAREER.md, Recruiting and draft stock): the weekly mock
 * ladder aggregates each NBA team's PRIVATE perceived value of me -
 * their scouts' coverage of my circuit, their positional need, their
 * persona's risk appetite - and every rank move lands in the history and
 * the event log with a stated, legible reason (pillar 2; the
 * explained-consequence lint reads both). The gap between the ladder and
 * my truth is the fog working on me.
 *
 * Coverage is DERIVED, never stored: a pure function of games played,
 * statement lines, the circuit's exposure multiplier, and the
 * combine/workout flags the state already carries (StockState froze with
 * no coverage ledger, deliberately - derived coverage cannot drift from
 * its causes across save/load).
 *
 * Streams (career.seed root; fixed draw counts per call):
 *   career-stock:<year>:<week>              1 gaussian draw - the week's
 *                                           market chatter on the consensus
 *   career-scout:* / career-scout-bias:*    via perceiveProspect
 *                                           (perception.ts header)
 * runCombineWeek/attendWorkout/enterDraftClass draw nothing themselves.
 *
 * The fog handoff: enterDraftClass moves me (and the rival) into
 * league.players with status 'draftEligible', so from that moment the
 * REAL franchise fog (scouting.ts, 'scout:<teamId>:<playerId>' streams
 * keyed by each team's scoutSeed) owns every front office's read, and
 * draft night (franchise tick.ts#processDraft) consumes the class
 * natively. perception.ts mirrors that fog pre-entry with the same
 * observerKey (scoutSeed), which is what makes the seam invisible.
 */
import { clamp } from '@hoopsh/engine';
import type { FrPlayer, TeamId } from '@hoopsh/franchise';
import { streamRng } from '@hoopsh/franchise';
import type { CareerPhase, CareerState, CircuitGame } from './types.js';
import { GROUP_ORDER, perceiveProspect } from './perception.js';

// ---------------------------------------------------------------------------
// module constants (market texture; the sweepable levers live in params.stock)

const DRAFT_SLOTS = 60;            // REAL: two rounds of thirty picks
const OFF_BOARD_RANK = DRAFT_SLOTS + 1; // virtual slot one past the board: where you climb from when you first appear, fall toward when you slide off
const MARKET_TOP_N = 8;            // FEEL: the consensus is made by the teams that want you - a mock slot reads like the lottery room, not the league median
const CONSENSUS_TOP = 78;          // FEEL: the consensus value that reads "first name called"; spans the board down to params.stock.draftableFloor
const CONSENSUS_NOISE_SD = 1.2;    // FEEL: value points of week-to-week market chatter (insider whispers, someone else's workout)
const INJURY_CONSENSUS_DISCOUNT = 6; // FEEL: value points a listed injury shaves off the market ("the ankle in February" - docs/CAREER.md); heals when he does
const SHOCK_GAME_PTS = 30;         // FEEL: the statement line that travels beyond the gym (docs/CAREER.md names the 30-point bracket game a shock)
const STATEMENT_MARGIN = 8;        // FEEL: points over his own season average that make a line a coverage magnet
const COVERAGE_FLOOR = 10;         // FEEL: word-of-mouth coverage before anyone flies in
const COVERAGE_PER_GAME = 2;       // FEEL: every game played is film someone can pull
const COVERAGE_PER_STATEMENT = 3;  // FEEL: extra eyes a statement line pulls into the next gym
const HISTORY_FILM_FACTOR = 0.5;   // FEEL: past seasons' games still count as film, at half weight (simplification: current circuit's exposure applies to the whole sum)
const NEED_PER_SLOT = 15;          // FEEL: value points per missing body at my position on a team's roster
const NEED_NEUTRAL = 50;           // FEEL: need score of a roster exactly at its expected positional share
const WORKOUT_INVITES_MIN = 3;     // FEEL: even a fringe name gets a few closer looks (docs/CAREER.md: 3-6 invites)
const WORKOUT_INVITES_MAX = 6;     // FEEL: the calendar caps how many gyms want a private day

/** Phases whose weeks carry a mock ladder (pre-entry journey + draft spring). */
const STOCK_PHASES: ReadonlySet<CareerPhase> = new Set(['hs', 'college', 'euro', 'nbl', 'draftPrep']);

// ---------------------------------------------------------------------------
// shared lookups

/** Me, wherever I currently live (career.players pre-entry, league.players after). */
function meOf(career: CareerState): FrPlayer {
  const me = career.players[career.me] ?? career.league.players[career.me];
  if (!me) throw new Error('career/stock: my player is missing from both pools');
  return me;
}

interface PlayedGame {
  game: CircuitGame;
  pts: number;
}

/** My played circuit games (schedule + bracket), with results, ordered by (week, id). */
function myGames(career: CareerState): PlayedGame[] {
  const c = career.circuit;
  if (!c) return [];
  const out: PlayedGame[] = [];
  for (const game of [...c.schedule, ...c.bracket]) {
    const record = c.results[game.id];
    const line = record?.lines.find(l => l.playerId === career.me);
    if (line && line.min > 0) out.push({ game, pts: line.pts });
  }
  out.sort((a, b) => a.game.week - b.game.week || a.game.id.localeCompare(b.game.id));
  return out;
}

/** How a stock reason names the stage a line happened on. */
function occasionOf(game: CircuitGame): string {
  if (game.type === 'confTourney') return 'conference tournament game';
  if (game.type === 'bracket') {
    if (game.round === 'F') return 'championship game';
    if (game.round === 'SF') return 'semifinal';
    if (game.round === 'QF') return 'quarterfinal';
    return 'bracket game';
  }
  return 'statement game';
}

/** 81 inches prints as '6-9', the way a measurement sheet reads. */
function fmtHeight(inches: number): string {
  return `${Math.floor(inches / 12)}-${inches % 12}`;
}

/**
 * Scouting coverage a team has on me, 0-100, derived (file header): the
 * circuit's exposure multiplier over (floor + film + statement lines),
 * plus the combine bump every team shares and the workout bump only the
 * gyms I visited earned. More coverage narrows perception error - it
 * never guarantees they LIKE what they see more clearly.
 */
function coverageFor(career: CareerState, teamId: TeamId): number {
  const stock = career.stock;
  const kind = career.circuit?.kind
    ?? career.circuitHistory[career.circuitHistory.length - 1]?.kind
    ?? 'hs';
  const exposure = career.params.stock.exposure[kind];
  const games = myGames(career);
  const seasonAvg = games.length > 0 ? games.reduce((s, g) => s + g.pts, 0) / games.length : 0;
  const statements = games.filter(g => g.pts >= seasonAvg + STATEMENT_MARGIN).length;
  const pastGp = career.circuitHistory.reduce((s, c) => s + c.myLine.gp, 0);
  let cov = exposure * (
    COVERAGE_FLOOR
    + COVERAGE_PER_GAME * (games.length + HISTORY_FILM_FACTOR * pastGp)
    + COVERAGE_PER_STATEMENT * statements
  );
  if (stock?.combineDone) cov += career.params.stock.combineCoverageBump;
  if (stock?.workoutsDone.includes(teamId)) cov += career.params.stock.workoutCoverageBump;
  return clamp(cov, 0, 100);
}

/**
 * Positional need, 0-100: NEED_NEUTRAL when the roster holds exactly its
 * expected share at my position (roster/5), one NEED_PER_SLOT step per
 * body over or under. Light by design - the real board math belongs to
 * franchise draftai.ts after entry.
 */
function needFor(career: CareerState, teamId: TeamId, pos: FrPlayer['pos']): number {
  const team = career.league.teams[teamId];
  if (!team) throw new Error(`career/stock: unknown team ${teamId}`);
  let count = 0;
  for (const pid of team.roster) {
    if (career.league.players[pid]?.pos === pos) count += 1;
  }
  const expected = team.roster.length / 5; // 5 on-court positions (REAL)
  return clamp(NEED_NEUTRAL + (expected - count) * NEED_PER_SLOT, 0, 100);
}

/**
 * One team's private value of me, 0-100: their fogged now/ceiling reads
 * (perceiveProspect, observerKey = the team's scoutSeed - the SAME
 * scouting identity franchise scouting.ts will use after entry) blended
 * with positional need. The persona's risk appetite tilts the wPersona
 * share of the weight between now and ceiling: a risk-loving front
 * office buys the ceiling story, a conservative one pays for the floor
 * (docs/CAREER.md). A user-chaired team (gm null) reads risk-neutral.
 */
function teamValue(career: CareerState, teamId: TeamId): number {
  const team = career.league.teams[teamId];
  if (!team) throw new Error(`career/stock: unknown team ${teamId}`);
  const me = meOf(career);
  const s = career.params.stock;
  const read = perceiveProspect(career.seed, team.scoutSeed, me, coverageFor(career, teamId), career.params);
  let now = 0;
  let ceiling = 0;
  for (const g of GROUP_ORDER) {
    now += read.now[g];
    ceiling += read.ceiling[g];
  }
  now /= GROUP_ORDER.length;
  ceiling /= GROUP_ORDER.length;
  const risk = (team.gm?.risk ?? 50) / 100; // 50 = the neutral trait center (ai/persona.ts)
  const wNow = s.wNow + s.wPersona * (1 - risk);
  const wCeiling = s.wCeiling + s.wPersona * risk;
  const value = wNow * now + wCeiling * ceiling + s.wNeed * needFor(career, teamId, me.pos);
  return Math.round(value * 10) / 10; // one decimal: legible, byte-stable
}

/** Recompute every team's private value into stock.perTeam (sorted ids: byte-stable). */
function recomputePerTeam(career: CareerState): string[] {
  const teamIds = Object.keys(career.league.teams).sort();
  const perTeam: Record<TeamId, number> = {};
  for (const tid of teamIds) perTeam[tid] = teamValue(career, tid);
  career.stock!.perTeam = perTeam;
  return teamIds;
}

/** Append the paired StockEntry + CareerEvent every stock consequence requires. */
function pushStockStory(career: CareerState, rank: number | null, reason: string, idSuffix: string, delta?: number): void {
  career.stock!.history.push({
    week: career.clock.week,
    year: career.clock.year,
    rank,
    reason,
  });
  career.events.push({
    id: `ev-stock-${career.clock.year}w${career.clock.week}-${idSuffix}`,
    clock: { ...career.clock },
    kind: 'stock',
    reason,
    ...(delta !== undefined ? { delta } : {}),
  });
}

// ---------------------------------------------------------------------------
// the weekly mock

/**
 * Weekly: recompute per-team perception, move the rank, write the reason.
 * Called by week.ts every pre-NBA week; quiet outside the stock phases.
 * Rank moves toward the market target under params.stock.weeklyMoveCap
 * (shockMoveCap on a shock week: a 30-point line, a listed injury, the
 * combine), because real boards are sticky - one insider does not reprint
 * sixty names overnight without a reason he can put his byline on.
 */
export function updateStock(career: CareerState): void {
  const stock = career.stock;
  if (!stock || !STOCK_PHASES.has(career.clock.phase)) return;
  const s = career.params.stock;
  const me = meOf(career);

  const teamIds = recomputePerTeam(career);

  // market consensus: mean of the top-N team values (the teams that want
  // you set your slot), plus this week's chatter - 1 fixed gaussian draw
  // from career-stock:<year>:<week> (file header)
  const top = teamIds
    .map(tid => stock.perTeam[tid]!)
    .sort((a, b) => b - a)
    .slice(0, MARKET_TOP_N);
  const weekRng = streamRng(career.seed, 'career-stock', career.clock.year, career.clock.week);
  let consensus = top.reduce((sum, v) => sum + v, 0) / Math.max(1, top.length)
    + weekRng.gaussian(0, CONSENSUS_NOISE_SD);
  const injury = me.health.injury;
  if (injury) consensus -= INJURY_CONSENSUS_DISCOUNT; // teams price the medical until he is cleared

  // the week's performance context, for shock flags and legible reasons
  const games = myGames(career);
  const seasonAvg = games.length > 0 ? games.reduce((sum, g) => sum + g.pts, 0) / games.length : 0;
  const weekGames = games.filter(g => g.game.week === career.clock.week);
  const bigGame = weekGames
    .filter(g => g.pts >= SHOCK_GAME_PTS)
    .sort((a, b) => b.pts - a.pts)[0] ?? null;
  // consecutive most-recent PLAYED weeks under his own season average
  const playedWeeks = [...new Set(games.map(g => g.game.week))].sort((a, b) => a - b);
  let slumpWeeks = 0;
  for (let i = playedWeeks.length - 1; i >= 0; i--) {
    const wk = playedWeeks[i]!;
    const wkGames = games.filter(g => g.game.week === wk);
    const wkAvg = wkGames.reduce((sum, g) => sum + g.pts, 0) / wkGames.length;
    if (wkAvg < seasonAvg) slumpWeeks += 1;
    else break;
  }
  const combineThisWeek = stock.combineDone && career.clock.week === career.params.tick.combineWeek;
  const shock = bigGame !== null || injury !== null || combineThisWeek;
  const cap = shock ? s.shockMoveCap : s.weeklyMoveCap;

  // target slot: linear map from the consensus band to the sixty picks
  const target = consensus < s.draftableFloor
    ? null
    : clamp(
      Math.round(1 + (CONSENSUS_TOP - consensus) * (DRAFT_SLOTS - 1) / (CONSENSUS_TOP - s.draftableFloor)),
      1, DRAFT_SLOTS,
    );

  const prev = stock.rank;
  let next: number | null;
  if (target === null) {
    next = null; // sliding off the board is not capped: undraftable is undraftable
  } else {
    const from = prev ?? OFF_BOARD_RANK; // first appearance climbs in from past the board
    next = clamp(from + clamp(target - from, -cap, cap), 1, DRAFT_SLOTS);
  }
  if (next === prev) return; // no move, no story (the lint reads reasons, not padding)

  // the stated reason, from the actual driver (pillar 2)
  const avgTxt = (Math.round(seasonAvg * 10) / 10).toFixed(1);
  const climbed = prev === null || (next !== null && next < prev);
  let reason: string;
  if (next === null) {
    reason = 'slid off the mock boards: the market read fell under draftable';
  } else if (prev === null) {
    reason = `the mock boards print his name for the first time, pick ${next}`;
  } else if (combineThisWeek) {
    reason = climbed
      ? `the post-combine reprice lands: up ${prev - next} spots`
      : `the post-combine reprice lands: down ${next - prev} spots`;
  } else if (bigGame && climbed) {
    reason = `the ${bigGame.pts}-point ${occasionOf(bigGame.game)} travels`;
  } else if (injury && !climbed) {
    reason = `${injury.label} puts the medical in every war room`;
  } else if (climbed) {
    reason = games.length > 0
      ? `the film keeps selling: ${avgTxt} a night moves the boards`
      : 'scouts like the profile: the boards drift up';
  } else if (slumpWeeks >= 2) {
    reason = `scouts cooled during the ${slumpWeeks}-week slump`;
  } else {
    reason = 'other names surged past him on the boards this week';
  }

  stock.rank = next;
  const delta = prev !== null && next !== null ? prev - next : undefined; // +N = climbed N picks
  pushStockStory(career, next, reason, 'move', delta);
}

// ---------------------------------------------------------------------------
// the combine

/**
 * Combine week: measurements go public; everyone reprices. Sets the
 * combineDone flag (which IS the all-team coverage bump - coverage is
 * derived, file header), recomputes every board at the new coverage, and
 * invites the 3-6 teams whose value of me runs highest into
 * stock.workoutInvites (they want a closer look). The measurement story
 * quotes my REAL height and wingspan - the fog never applied to a tape
 * measure. Idempotent: the combine happens once. Draws no randomness;
 * the tick owns the calendar (params.tick.combineWeek).
 */
export function runCombineWeek(career: CareerState): void {
  const stock = career.stock;
  if (!stock || stock.combineDone) return;
  const me = meOf(career);
  stock.combineDone = true; // from here every coverageFor call carries params.stock.combineCoverageBump

  const teamIds = recomputePerTeam(career);
  const ranked = [...teamIds].sort(
    (a, b) => stock.perTeam[b]! - stock.perTeam[a]! || a.localeCompare(b),
  );
  const interested = ranked.filter(tid => stock.perTeam[tid]! >= career.params.stock.draftableFloor).length;
  const invites = Math.min(
    ranked.length,
    clamp(interested, WORKOUT_INVITES_MIN, WORKOUT_INVITES_MAX),
  );
  stock.workoutInvites = ranked.slice(0, invites).filter(tid => !stock.workoutsDone.includes(tid));

  const reason = `measured ${fmtHeight(me.heightIn)} with a ${fmtHeight(me.wingspanIn)} wingspan at the combine; `
    + `${stock.workoutInvites.length} teams call about private workouts`;
  pushStockStory(career, stock.rank, reason, 'combine');
}

// ---------------------------------------------------------------------------
// workouts

/**
 * A workout with one team: their scouts see more truth. Moves the invite
 * to workoutsDone (which IS that team's coverage bump - derived, file
 * header) and re-derives ONLY that team's value; seeing more truth cuts
 * both ways, and the stated reason says which way it cut for them.
 * Throws on a team that never invited you - the choice validator
 * (tick.ts applyChoice) is the polite gate; this is the fail-loud one.
 * Draws no randomness (the perception streams are persistent reads).
 */
export function attendWorkout(career: CareerState, teamId: TeamId): void {
  const stock = career.stock;
  if (!stock) throw new Error('career/stock: no stock state to attend a workout from');
  const idx = stock.workoutInvites.indexOf(teamId);
  if (idx < 0) throw new Error(`career/stock: no open workout invite from ${teamId}`);
  const team = career.league.teams[teamId];
  if (!team) throw new Error(`career/stock: unknown team ${teamId}`);

  const before = stock.perTeam[teamId] ?? teamValue(career, teamId);
  stock.workoutInvites.splice(idx, 1);
  stock.workoutsDone.push(teamId);
  const after = teamValue(career, teamId); // re-derived at +workoutCoverageBump coverage
  stock.perTeam[teamId] = after;

  const delta = Math.round((after - before) * 10) / 10;
  const reason = delta > 0
    ? `the ${team.city} workout sold the room: seeing more up close moved their number up ${delta}`
    : delta < 0
      ? `the ${team.city} workout showed the flaws up close: their number came down ${Math.abs(delta)}`
      : `the ${team.city} workout confirmed the film: their number held`;
  career.events.push({
    id: `ev-stock-${career.clock.year}w${career.clock.week}-workout-${teamId}`,
    clock: { ...career.clock },
    kind: 'stock',
    reason,
    delta,
  });
}

// ---------------------------------------------------------------------------
// draft entry (the fog handoff)

/**
 * Draft entry: insert me (and the rival, when his path leads here - it
 * always does, the story demands the same class) into the league's draft
 * class so the real AI boards see us natively. Called by tick.ts at the
 * draftPrep end, before the league's draft night consumes the class
 * (franchise tick.ts#processDraft).
 *
 * Mechanics: both players MOVE from career.players into league.players
 * (types.ts: "in career.players pre-NBA; in league.players after entry")
 * with status 'draftEligible' - holding the same object in both pools
 * would fork into two diverging copies across a save/load cycle. Me onto
 * league.careerControlled (retirement, options, and the FA market defer
 * to my human); the rival's life belongs to the sim from here. From this
 * call on, franchise scouting.ts owns every team's read of us through
 * the same scoutSeed identities perception.ts mirrored pre-entry - the
 * design's fog handoff (file header). Idempotent.
 */
export function enterDraftClass(career: CareerState): void {
  const league = career.league;

  const enter = (id: string): void => {
    const player = career.players[id];
    if (!player) return; // already entered (or never existed pre-NBA)
    player.status = 'draftEligible';
    league.players[id] = player;
    delete career.players[id];
    if (!league.draftClass.includes(id)) league.draftClass.push(id);
  };

  const alreadyIn = league.draftClass.includes(career.me) || league.players[career.me] !== undefined;
  enter(career.me);   // me first: stable class order (me, rival, generated pool)
  enter(career.rivalId);

  // my life decisions stay mine whichever team drafts me (franchise seam)
  league.careerControlled ??= [];
  if (!league.careerControlled.includes(career.me)) league.careerControlled.push(career.me);

  if (alreadyIn) return; // idempotent: one entry, one story
  const rival = league.players[career.rivalId];
  const rivalTxt = rival ? `; ${rival.name} declares into the same class` : '';
  career.events.push({
    id: `ev-stock-${career.clock.year}w${career.clock.week}-entry`,
    clock: { ...career.clock },
    kind: 'stock',
    reason: `officially in the ${career.clock.year} draft class: the league's own scouts take over the file${rivalTxt}`,
  });
}
