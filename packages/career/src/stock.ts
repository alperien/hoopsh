/**
 * stock.ts - draft stock: per-team perception, the weekly mock, combine,
 * workouts, and the draft-night insertion. OWNER: stock task. STATUS:
 * implemented (build wave A; perception-economy fix wave B).
 *
 * Design (docs/CAREER.md, Recruiting and draft stock): the weekly mock
 * ladder aggregates each NBA team's PRIVATE perceived value of me -
 * their scouts' coverage of my circuit, their positional need, their
 * persona's risk appetite - and every rank move lands in the history
 * with a stated, legible reason (pillar 2; the explained-consequence
 * lint reads both). The gap between the ladder and my truth is the fog
 * working on me.
 *
 * THE PERCEPTION ECONOMY (fix wave B): a team's NOW read is no longer
 * the fogged attribute sheet alone. It blends the sheet with a
 * role-relative recent-production index built from my actual circuit
 * game lines (productionIndex below): points against the circuit's own
 * scoring environment, true-shooting efficiency, and the same
 * role-relative composite the coach grades with (trust.ts
 * productionScore). Games move the boards now; a chucker's 35% reads
 * visibly worse than an efficient scorer with the identical sheet.
 *
 * FEED HYGIENE (fix wave B): every rank move still lands in
 * stock.history (the ladder screen wants the full series), but moves
 * smaller than STOCK_EVENT_MOVE_MIN picks no longer push CareerEvents
 * unless the week carried a shock (statement game, injury, combine) or
 * a board edge (first print, sliding off). The measured noise walk -
 * a quarter of all career events were the alternating drift-up /
 * surged-past pair - stays on the ladder page, off the feed.
 *
 * MOCK-VS-BOARD CONVERGENCE (fix wave B): the audited ~15-pick gap
 * between the season mock and the real draft night came from mapping
 * consensus onto a hand-set value band while franchise draftai.ts
 * ranks the class with positionBlend over risk-weighted perceived
 * groups. In the draftPrep phase the mock now estimates my slot the way
 * the boards will actually compute it (boardTargetFor below): the exact
 * aiSelect valuation over every front office, ranked inside the live
 * draft class when the league has one, else against a measured
 * class-score curve (CLASS_CURVE), blended in harder after the combine.
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
 * The board estimator additionally READS the franchise fog
 * ('scout:<teamId>:<playerId>' streams on the league seed) through
 * perceivedGroup for prospects already in the league's class - fresh
 * fixed-draw streams there too, so no draw here can reshuffle anything.
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
import type { FrPlayer, GameLine, GameRecord, TeamId } from '@hoopsh/franchise';
import { perceivedGroup, streamRng, tapeAdjust } from '@hoopsh/franchise';
import { positionBlend } from '../../franchise/src/ai/roster.js';
import type { AttrGroup } from '@hoopsh/franchise';
import type { CareerPhase, CareerState, CircuitGame } from './types.js';
import { GROUP_ORDER, perceiveProspect } from './perception.js';
import { productionScore } from './trust.js';

// ---------------------------------------------------------------------------
// module constants (market texture; the sweepable levers live in params.stock)

const DRAFT_SLOTS = 60;            // REAL: two rounds of thirty picks
const OFF_BOARD_RANK = DRAFT_SLOTS + 1; // virtual slot one past the board: where you climb from when you first appear, fall toward when you slide off
const MARKET_TOP_N = 8;            // FEEL: the consensus is made by the teams that want you - a mock slot reads like the lottery room, not the league median
const CONSENSUS_TOP = 71;          // CAL (fix wave B, was FEEL 78): the consensus value that reads "first name called"; re-anchored to the measured teamValue of a class #1 (top-8 mean of ~0.9 x board-score 70 + need) so the season band no longer prints everyone ~15 picks late; spans down to params.stock.draftableFloor
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

// --- feed hygiene (fix wave B) ---
const STOCK_EVENT_MOVE_MIN = 3;    // FEEL: the game's own threshold for a move worth a buzz (mirrors phone.ts AGENT_MOVE_MIN - the agent already refused to text about smaller moves); sub-threshold moves stay in stock.history only

// --- production into perception (fix wave B) ---
// All module constants rather than params.stock fields: the frozen
// CareerParams.stock shape carries no production levers and params.ts is
// outside this fix's manifest; a params-shape reopen can promote them.
const PROD_WEIGHT = 0.30;          // FEEL (brief-anchored ~0.30): weight of the recent tape vs the fogged sheet in every NOW read; shared with recruiting.ts so the two systems can never diverge
const PROD_WINDOW_GAMES = 5;       // FEEL: the last five games - about 2-3 weeks of circuit ball, so a form change re-prices inside the reaction window the audit demanded
const PROD_MIN_GAMES = 2;          // FEEL: nobody re-prices a prospect on one night
const PROD_W_VOL = 0.30;           // FEEL: scoring volume against the circuit's own environment
const PROD_W_EFF = 0.40;           // FEEL: efficiency carries the flag - the audited 34.9% chucker must read visibly worse than a 55% scorer at equal volume
const PROD_W_COMP = 0.30;          // FEEL: the role-relative composite (the same trust.ts productionScore the coach grades with)
const TS_ZERO = 0.35;              // CAL: true-shooting that reads 0 (measured: engine prep stars run ~.55-.61 TS)
const TS_FULL = 0.68;              // CAL: true-shooting that reads 100
const FG_ZERO = 0.30;              // CAL: fg% anchors for archived seasons (CircuitSummary.myLine carries no free throws)
const FG_FULL = 0.62;              // CAL
const VOL_FULL_SHARE = 0.50;       // CAL: scoring half of an average team's total reads 100 (measured: engine prep teams average ~32 a game; a star carries ~15)
const PROD_HOT = 62;               // FEEL: a window hot enough to headline a climb's stated reason
const PROD_COLD = 40;              // FEEL: a window cold enough to headline a fall's stated reason

// --- mock-vs-board convergence (fix wave B) ---
// Mirrors of franchise ai/draftai.ts's PRIVATE valuation constants
// (CEIL_WEIGHT_BASE / CEIL_WEIGHT_RISK_SPAN / THIN_POS_COUNT /
// NEED_BONUS). Duplicated because that module deliberately does not
// export them and packages/franchise is frozen to this fix; if draftai
// re-tunes, re-mirror here or the estimator drifts.
const BOARD_CEIL_BASE = 0.3;
const BOARD_CEIL_RISK_SPAN = 0.4;
const BOARD_THIN_POS_COUNT = 2;
const BOARD_NEED_BONUS = 2;
const LIVE_CLASS_MIN = 20;         // FEEL: fewer eligible names than this is a consumed or half-built class, not a board to rank inside
/**
 * CAL: measured pick -> mean-over-teams aiSelect board score of generated
 * draft classes (8 classes on a career genesis league, real franchise fog
 * at combine coverage; sequential-selection bias measured under 1 pick, so
 * rank-in-class reads directly as the expected slot). The estimator
 * inverts this curve when the league's live class is not visible yet.
 */
const CLASS_CURVE: ReadonlyArray<readonly [number, number]> = [
  [1, 69.7], [3, 68.3], [5, 64.8], [8, 63.7], [12, 60.2],
  [18, 59.3], [25, 56.2], [35, 51.2], [45, 48.3], [60, 44.8],
];
const BOARD_BLEND_PRE = 0.5;       // FEEL: draftPrep weight on the board estimate before the combine (the market still argues with itself)
const BOARD_BLEND_POST = 0.85;     // FEEL: after the combine the war rooms have their numbers
const BOARD_BLEND_FINAL = 0.92;    // FEEL: the last week before the draft the mock IS the boards, give or take a leak

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
  line: GameLine;
  record: GameRecord;
}

/** My played circuit games (schedule + bracket), with results, ordered by (week, id). */
function myGames(career: CareerState): PlayedGame[] {
  const c = career.circuit;
  if (!c) return [];
  const out: PlayedGame[] = [];
  for (const game of [...c.schedule, ...c.bracket]) {
    const record = c.results[game.id];
    const line = record?.lines.find(l => l.playerId === career.me);
    if (record && line && line.min > 0) out.push({ game, pts: line.pts, line, record });
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

/** One-decimal display rounding for numbers quoted in reasons. */
function round1(x: number): number {
  return Math.round(x * 10) / 10; // 10: one-decimal display scale, not a lever
}

// ---------------------------------------------------------------------------
// the production index (fix wave B): what the tape says, 0-100

/** What productionIndex measured, for reason lines and tests. */
export interface ProductionRead {
  /** 0-100, same scale as an attribute read */
  index: number;
  /** games in the window (live circuit) or the archived season's gp */
  games: number;
  /** points per game across the window */
  ppg: number;
  /** true shooting across the window; null when the lines carry no shot data */
  ts: number | null;
}

/** Linear 0-100 ease between two anchors, clamped. */
function easeTo100(x: number, zero: number, full: number): number {
  return clamp(((x - zero) / (full - zero)) * 100, 0, 100);
}

/**
 * The circuit's scoring environment: mean points ONE team scores in a
 * finished game of this circuit. Derived from the stored finals, never
 * a constant, so prep ball and a Euro league each judge volume against
 * their own nights. Null until any game has been played.
 */
function scoringEnvironment(career: CareerState): number | null {
  const c = career.circuit;
  if (!c) return null;
  let pts = 0;
  let sides = 0;
  for (const record of Object.values(c.results)) {
    pts += record.final[0] + record.final[1];
    sides += 2;
  }
  return sides > 0 ? pts / sides : null;
}

/**
 * A season-average night as a GameLine, so an archived season can be
 * graded through the SAME trust.ts productionScore machinery a live
 * record is (reuse over re-derivation). CircuitSummary.myLine carries
 * no turnovers, so the composite reads a touch generous for archive
 * seasons - acceptable: the archive is the between-seasons fallback.
 */
function summaryAvgRecord(career: CareerState, s: CareerState['circuitHistory'][number]): GameRecord {
  const gp = Math.max(1, s.myLine.gp);
  const line: GameLine = {
    playerId: career.me, teamId: '', starter: true,
    min: s.myLine.min / gp, pts: s.myLine.pts / gp,
    fgm: 0, fga: 0, tpm: s.myLine.tpm / gp, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: s.myLine.reb / gp, ast: s.myLine.ast / gp,
    stl: s.myLine.stl / gp, blk: s.myLine.blk / gp, tov: 0, pf: 0, plusMinus: 0,
  };
  const zeroTotals = {
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0,
    ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pace: 0, fastbreakPts: 0, biggestLead: 0,
  };
  return {
    id: `prod-archive-${s.year}-${s.kind}`, date: { season: s.year, day: 0 },
    type: 'regular', home: '', away: '', seed: '', final: [0, 0], ot: 0,
    lines: [line], totals: [zeroTotals, zeroTotals], keyPlays: [],
  };
}

/**
 * The role-relative recent-production index (fix wave B): my last
 * PROD_WINDOW_GAMES circuit lines mapped onto the 0-100 attribute-read
 * scale from three legs - scoring volume against the circuit's own
 * environment, true-shooting efficiency (the leg that carries the most
 * weight: the chucker problem), and the role-relative composite via
 * trust.ts productionScore. Between seasons (circuit folded) it falls
 * back to the latest circuitHistory season line, without the volume leg
 * (the archive stores no opponent environment). Null with nothing to
 * read: fewer than PROD_MIN_GAMES lines anywhere. Pure arithmetic - no
 * rng, so both consumers (stock, recruiting) stay deterministic.
 */
export function productionIndex(career: CareerState): ProductionRead | null {
  const games = myGames(career);
  if (games.length >= PROD_MIN_GAMES) {
    const window = games.slice(-PROD_WINDOW_GAMES);
    let pts = 0;
    let fga = 0;
    let fta = 0;
    let comp = 0;
    for (const g of window) {
      pts += g.line.pts;
      fga += g.line.fga;
      fta += g.line.fta;
      comp += productionScore(career, g.record);
    }
    const ppg = pts / window.length;
    const ts = fga + fta > 0 ? pts / (2 * (fga + 0.44 * fta)) : null; // 0.44: the standard true-shooting FT possession weight (REAL)
    const env = scoringEnvironment(career);
    const volScore = env !== null && env > 0
      ? easeTo100(ppg / env, 0, VOL_FULL_SHARE)
      : 50; // no environment to judge against reads neutral (hand-built fixtures)
    const effScore = ts !== null ? easeTo100(ts, TS_ZERO, TS_FULL) : 50;
    const compScore = comp / window.length;
    return {
      index: clamp(PROD_W_VOL * volScore + PROD_W_EFF * effScore + PROD_W_COMP * compScore, 0, 100),
      games: window.length,
      ppg,
      ts,
    };
  }

  // between seasons: the latest archived season is the tape on the desk
  const last = career.circuitHistory[career.circuitHistory.length - 1];
  if (!last || last.myLine.gp < PROD_MIN_GAMES) return null;
  const gp = last.myLine.gp;
  const ppg = last.myLine.pts / gp;
  const effScore = last.myLine.fgPct > 0 ? easeTo100(last.myLine.fgPct, FG_ZERO, FG_FULL) : 50;
  const compScore = productionScore(career, summaryAvgRecord(career, last));
  // no volume leg without a stored environment: renormalize eff + comp
  const wSum = PROD_W_EFF + PROD_W_COMP;
  return {
    index: clamp((PROD_W_EFF * effScore + PROD_W_COMP * compScore) / wSum, 0, 100),
    games: gp,
    ppg,
    ts: null,
  };
}

/** The now-read blend both perception consumers share (fix wave B):
 * (1 - PROD_WEIGHT) x fogged sheet + PROD_WEIGHT x the tape. Exported for
 * recruiting.ts so the two systems price production identically. */
export function blendNowRead(attrNow: number, prod: ProductionRead | null): number {
  if (prod === null) return attrNow;
  return (1 - PROD_WEIGHT) * attrNow + PROD_WEIGHT * prod.index;
}

// ---------------------------------------------------------------------------
// coverage, need, and one team's private value

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
 * scouting identity franchise scouting.ts will use after entry), the now
 * read production-blended (fix wave B) and both reads aggregated through
 * positionBlend - the SAME position-demand lens franchise draftai.ts
 * ranks the class with, so the mock and the eventual boards price the
 * same shape of player. Positional need blends in at params weight; the
 * persona's risk appetite tilts the wPersona share of the weight between
 * now and ceiling (docs/CAREER.md). A user-chaired team (gm null) reads
 * risk-neutral.
 */
function teamValue(career: CareerState, teamId: TeamId): number {
  const team = career.league.teams[teamId];
  if (!team) throw new Error(`career/stock: unknown team ${teamId}`);
  const me = meOf(career);
  const s = career.params.stock;
  const read = perceiveProspect(career.seed, team.scoutSeed, me, coverageFor(career, teamId), career.params);
  const now = blendNowRead(positionBlend(me.pos, read.now), productionIndex(career));
  const ceiling = positionBlend(me.pos, read.ceiling);
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

// ---------------------------------------------------------------------------
// the board estimator (fix wave B): my slot the way draftai.ts will price it

/** aiSelect's exact valuation shape for one team's read of a prospect. */
function boardScoreOf(
  career: CareerState, teamId: TeamId, pos: FrPlayer['pos'],
  now: Record<AttrGroup, number>, ceiling: Record<AttrGroup, number>,
): number {
  const team = career.league.teams[teamId]!;
  const risk = team.gm ? team.gm.risk : 50;
  const cw = BOARD_CEIL_BASE + BOARD_CEIL_RISK_SPAN * (risk / 100);
  let atPos = 0;
  for (const pid of team.roster) {
    if (career.league.players[pid]?.pos === pos) atPos += 1;
  }
  return (1 - cw) * positionBlend(pos, now)
    + cw * positionBlend(pos, ceiling)
    + (atPos < BOARD_THIN_POS_COUNT ? BOARD_NEED_BONUS : 0);
}

/** My mean-over-teams board score through the mirror fog (perception.ts,
 * observerKey = each team's scoutSeed). Attr reads only, no production:
 * this estimates what franchise draftai.ts will price, and the franchise
 * fog reads the sheet. */
/**
 * The tape rides the mirror exactly as it rides the night: the shared
 * franchise tapeAdjust (one function, no constant drift) applies to every
 * scored prospect who has real season rows. Generated classmates read 0.
 */
function myBoardScore(career: CareerState, teamIds: string[]): number {
  const me = meOf(career);
  let sum = 0;
  for (const tid of teamIds) {
    const team = career.league.teams[tid]!;
    const read = perceiveProspect(career.seed, team.scoutSeed, me, coverageFor(career, tid), career.params);
    sum += boardScoreOf(career, tid, me.pos, read.now, read.ceiling);
  }
  return sum / Math.max(1, teamIds.length) + tapeAdjust(me);
}

/** Mean-over-teams board score of a prospect already in the league,
 * through the REAL franchise fog (the exact reads draft night will use). */
function leagueProspectScore(career: CareerState, teamIds: string[], pid: string): number {
  const p = career.league.players[pid]!;
  let sum = 0;
  for (const tid of teamIds) {
    const now = {} as Record<AttrGroup, number>;
    const ceiling = {} as Record<AttrGroup, number>;
    for (const g of GROUP_ORDER) {
      now[g] = perceivedGroup(career.league, tid, pid, g, 'current');
      ceiling[g] = perceivedGroup(career.league, tid, pid, g, 'ceiling');
    }
    sum += boardScoreOf(career, tid, p.pos, now, ceiling);
  }
  return sum / Math.max(1, teamIds.length) + tapeAdjust(p);
}

/** Invert CLASS_CURVE: the pick a mean board score reads as, linearly
 * interpolated between the measured anchors; null = under the pick-60
 * anchor, off the board. */
function pickFromCurve(score: number): number | null {
  const first = CLASS_CURVE[0]!;
  if (score >= first[1]) return first[0];
  for (let i = 0; i < CLASS_CURVE.length - 1; i++) {
    const [pickHi, scoreHi] = CLASS_CURVE[i]!;
    const [pickLo, scoreLo] = CLASS_CURVE[i + 1]!;
    if (score >= scoreLo) {
      const t = (scoreHi - score) / (scoreHi - scoreLo);
      return clamp(Math.round(pickHi + t * (pickLo - pickHi)), 1, DRAFT_SLOTS);
    }
  }
  return null;
}

/**
 * Where the real boards would slot me (fix wave B), draftPrep only:
 * my aiSelect-shaped mean board score, ranked inside the league's LIVE
 * draft class when one is visible (LIVE_CLASS_MIN+ draftEligible names -
 * their reads through the exact franchise fog draft night will use, plus
 * the rival through the mirror since he enters beside me), else against
 * the measured CLASS_CURVE. Returns undefined = no estimate (not
 * draftPrep), null = the boards would not draft me, or the pick.
 */
function boardTargetFor(career: CareerState): number | null | undefined {
  if (career.clock.phase !== 'draftPrep') return undefined;
  const teamIds = Object.keys(career.league.teams).sort();
  const mine = myBoardScore(career, teamIds);

  const eligible = career.league.draftClass.filter(
    pid => pid !== career.me && career.league.players[pid]?.status === 'draftEligible',
  );
  if (eligible.length >= LIVE_CLASS_MIN) {
    let ahead = 0;
    for (const pid of eligible) {
      if (leagueProspectScore(career, teamIds, pid) > mine) ahead += 1;
    }
    // the rival declares into the same class (enterDraftClass); read him
    // through the mirror while he is still career-side
    const rival = career.players[career.rivalId];
    if (rival) {
      let sum = 0;
      for (const tid of teamIds) {
        const team = career.league.teams[tid]!;
        const read = perceiveProspect(career.seed, team.scoutSeed, rival, coverageFor(career, tid), career.params);
        sum += boardScoreOf(career, tid, rival.pos, read.now, read.ceiling);
      }
      if (sum / teamIds.length + tapeAdjust(rival) > mine) ahead += 1;
    }
    const rank = 1 + ahead;
    return rank <= DRAFT_SLOTS ? rank : null;
  }
  return pickFromCurve(mine);
}

// ---------------------------------------------------------------------------
// the story writers

/** Append a StockEntry, and its paired CareerEvent when the move is loud
 * enough for the feed (fix wave B: the history is complete, the feed is
 * curated - see the file header's feed-hygiene note). */
function pushStockStory(
  career: CareerState, rank: number | null, reason: string, idSuffix: string,
  delta?: number, print = true,
): void {
  career.stock!.history.push({
    week: career.clock.week,
    year: career.clock.year,
    rank,
    reason,
  });
  if (!print) return;
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
 *
 * In draftPrep the target converges on the board estimator (file
 * header): pre-combine the market argues, post-combine the mock is
 * mostly the war rooms' own math.
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

  // consensus slot: linear map from the market band to the sixty picks
  const consensusTarget = consensus < s.draftableFloor
    ? null
    : clamp(
      Math.round(1 + (CONSENSUS_TOP - consensus) * (DRAFT_SLOTS - 1) / (CONSENSUS_TOP - s.draftableFloor)),
      1, DRAFT_SLOTS,
    );

  // draftPrep convergence (fix wave B): blend toward the boards' own math
  const board = boardTargetFor(career);
  let target = consensusTarget;
  if (board !== undefined) {
    const wBoard = !stock.combineDone
      ? BOARD_BLEND_PRE
      : career.clock.week >= career.params.tick.draftWeek - 1
        ? BOARD_BLEND_FINAL
        : BOARD_BLEND_POST;
    // a null on either side is a verdict, not a number: the heavier voice
    // wins, and at the pre-combine even weight (0.5) the market's read
    // survives - the combine is the moment the war rooms' math takes over
    if (board === null) {
      target = wBoard > 0.5 ? null : consensusTarget;
    } else if (consensusTarget === null) {
      target = wBoard > 0.5 ? board : null;
    } else {
      target = clamp(Math.round((1 - wBoard) * consensusTarget + wBoard * board), 1, DRAFT_SLOTS);
    }
  }

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
  const prod = productionIndex(career);
  const avgTxt = round1(seasonAvg).toFixed(1);
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
  } else if (board !== undefined) {
    // draftPrep, no circuit night to point at: the war rooms are the driver
    reason = climbed
      ? `the pre-draft boards tighten: war rooms sort the class with his name at ${next}`
      : 'the pre-draft boards tighten: other names sort ahead of him';
  } else if (climbed && prod !== null && prod.games >= PROD_MIN_GAMES && prod.index >= PROD_HOT) {
    reason = prod.ts !== null
      ? `the last ${prod.games} games travel: ${round1(prod.ppg).toFixed(1)} a night on ${Math.round(prod.ts * 100)}% true shooting`
      : `the last ${prod.games} games travel: ${round1(prod.ppg).toFixed(1)} a night`;
  } else if (climbed) {
    reason = games.length > 0
      ? `the film keeps selling: ${avgTxt} a night moves the boards`
      : 'scouts like the profile: the boards drift up';
  } else if (slumpWeeks >= 2) {
    reason = `scouts cooled during the ${slumpWeeks}-week slump`;
  } else if (prod !== null && prod.games >= PROD_MIN_GAMES && prod.index <= PROD_COLD) {
    reason = prod.ts !== null
      ? `the tape cooled: ${round1(prod.ppg).toFixed(1)} a night on ${Math.round(prod.ts * 100)}% true shooting over the last ${prod.games}`
      : `the tape cooled: ${round1(prod.ppg).toFixed(1)} a night over the last ${prod.games}`;
  } else {
    reason = 'other names surged past him on the boards this week';
  }

  stock.rank = next;
  const delta = prev !== null && next !== null ? prev - next : undefined; // +N = climbed N picks
  // feed hygiene (fix wave B): quiet weeks stay on the ladder page; shocks
  // and board edges always print
  const smallMove = prev !== null && next !== null && Math.abs(prev - next) < STOCK_EVENT_MOVE_MIN;
  const print = !smallMove || shock;
  pushStockStory(career, next, reason, 'move', delta, print);
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
