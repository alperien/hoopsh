/**
 * phone.ts - the career mode's narrative surface: a diegetic message
 * inbox with zero cutscenes (docs/CAREER.md, The phone). OWNER: phone
 * task. STATUS: implemented (build wave B); summit-and-wire fix (wave C).
 *
 * Discipline, in priority order:
 * 1. State-backed, always. Every message quotes real state: the actual
 *    grade note from coach.grades, the actual rung move in
 *    recruiting.interest, the actual stock reason from stock.history,
 *    the rival's actual box line from the circuit results, the actual
 *    pick number off league.transactions on draft night. If the state
 *    did not happen, the message does not exist. A week with nothing
 *    real to say produces zero messages; silence is content.
 * 2. Few and consequential. Hard per-thread season caps
 *    (params.phone.capsPerSeason) plus the burst guard
 *    (params.phone.threadCooldownWeeks). Recruiter and wire threads
 *    carry in-module caps because the frozen params shape holds no keys
 *    for them. FOUR named payoff moments ride OUTSIDE the caps
 *    (commitment, draft night, the title game, the NBA debut): the caps
 *    exist to stop filler, and a cap that silences the biggest night of
 *    a career is the bug this file was reopened to fix. Everything else,
 *    including every wire story, stays capped.
 * 3. Character voices, no memes. The coach texts terse and film-first
 *    in lowercase; mom watches every game and worries about the body;
 *    the agent is transactional and slightly too smooth; the rival
 *    needles; media asks loaded questions; recruiters write in the
 *    formal register; the mentor has seen everything twice; the wire
 *    writes like a beat reporter under one fixed byline (K. Osei, The
 *    Ledger) and quotes real numbers in every line.
 * 4. Choices only where a real decision exists: scheduling the
 *    recruiting visit, answering media, engaging the rival, the family
 *    ask, and the role-promise grievance. Everything else is read-only
 *    texture; no quiz bolted onto it.
 * 5. Every consequence explained: applyPhoneChoice appends CareerEvents
 *    with nonempty reasons (the explained-consequence lint reads them).
 * 6. Ghost-proof. A recruiting thread only speaks when its rung move is
 *    corroborated by a positive recruiting event logged THIS week (events
 *    carry (year, week), so a stale lastMoveWeek from a dead season can
 *    never resurrect a program when the week numbers wrap), and only in
 *    the HS phase, pre-commitment, on an open interest row. One sender
 *    never lands two messages in one week.
 * 7. Anti-repeat. A thread never repeats a byte-identical body within
 *    ANTIREPEAT_WEEKS (derived from career.phone itself, so it survives
 *    save/load with no new state).
 *
 * Streams (career.seed root, franchise rng.ts doctrine):
 *   career-phone:<year>:<week>       phrasing-variant picks; exactly one
 *                                    int draw per ADMITTED message, in
 *                                    admission order, so draw counts are
 *                                    a pure function of state (the
 *                                    anti-repeat filter reads career.phone,
 *                                    which is state too)
 *   career-phone-coach:<programId>   a program's recruiting coach
 *                                    surname; no week in the path
 *                                    because the man does not change
 *                                    names between letters
 *   career-phone-close:<programId>   the losing finalist's door-close
 *                                    temperature (classy or bitter); one
 *                                    chance draw, personality is stable
 */
import { clamp } from '@hoopsh/engine';
import { streamRng } from '@hoopsh/franchise';
import type { FrPlayer, GameLine, GameRecord, TeamId } from '@hoopsh/franchise';
import type {
  CareerEvent, CareerState, CircuitKind, GameGrade, InterestRung, PhoneChoice,
  PhoneMessage, Program, RoleId, RouteOffer, ThreadId,
} from './types.js';

// ---------------------------------------------------------------------------
// module constants (message texture; the sweepable frequency levers live in
// params.phone)

/** FEEL: per-program season cap. The whole recruiting arc is questionnaire, letter, texts, visit, offer: five beats plus one nudge of slack. The frozen params shape carries no recruiter key, so the cap lives here. */
const RECRUITER_CAP_PER_SEASON = 6;

/** FEEL: wire stories per season. The desk covers milestones, honors, and draft night; ten a season reads like a beat, not a feed. params.phone.capsPerSeason is another task's shape this wave, so the wire cap lives here beside the recruiter cap. */
const WIRE_CAP_PER_SEASON = 10;

/** FEEL: anti-repeat window in weeks. A thread never sends a byte-identical body twice inside this window (the measured defect: mom repeated one template four straight weeks). Derived from career.phone, no new state. */
const ANTIREPEAT_WEEKS = 8;

/** REAL-ish: the banner number. Career points cross a 1,000 step and the gym hangs a sign; the wire files the story. */
const MILESTONE_STEP = 1000;

/** The wire's one fixed byline (fictional universe, fictional desk). Picked once and kept so the career reads like one reporter followed it. */
const WIRE_BYLINE = 'K. Osei, The Ledger';

/** FEEL: the line that makes a beat writer drive over (mirrors stock.ts SHOCK_GAME_PTS: the 30-point game is the doc's own named shock). */
const MEDIA_GAME_PTS = 30;

/** FEEL: final margin that earns the blowout question. */
const MEDIA_BLOWOUT_MARGIN = 20;

/** FEEL: consecutive team wins before the streak question. */
const MEDIA_STREAK_GAMES = 4;

/** FEEL: the slump question mirrors recruiting.ts's cold-stretch rule: last three games 25%+ under the season scoring average. */
const SLUMP_WINDOW_GAMES = 3;
const SLUMP_RATIO = 0.75;
/** FEEL: no slump questions off a three-game season; the average has to mean something first. */
const SLUMP_MIN_GAMES = 5;

/** FEEL: the rival line that earns an unprompted needle from another gym. */
const RIVAL_STATEMENT_PTS = 28;

/** FEEL: mock-ladder moves smaller than this stay between the agent and his coffee; the thread only carries moves worth a phone buzz. */
const AGENT_MOVE_MIN = 3;

/** FEEL: adherence under this reads as a night meaningfully off the plan (trust.ts scales deviation so ~20 points of dial overflow lands here). */
const OFF_SCRIPT_ADHERENCE = 60;

/** FEEL: a mentor is the oldest teammate at or past this age; younger rooms have no mentor and the thread stays silent. */
const MENTOR_MIN_AGE = 30;

/** FEEL: perceived-interest points a scheduled in-home visit buys (the staff sees the family, the family sees the staff). */
const VISIT_PERCEIVED_BUMP = 3;

/** FEEL: perceived-interest points a polite no costs (coaches remember). */
const VISIT_DECLINE_COOL = 2;

/** FEEL: morale swing for owning the media moment / crediting the room / no-commenting it away. */
const MEDIA_MORALE = { lean: 3, team: 1, shrug: -1 } as const;

/** FEEL: morale stakes of the rival thread: flexing a win feels great, talking back after a loss hands him receipts, leaving him on read is quiet discipline either way. */
const RIVAL_MORALE = { replyWon: 3, replyLost: -2, mute: 1 } as const;

/** FEEL: the family ask. Going home restores the person and costs some rest; saying no sits wrong for a few days. */
const FAMILY_GO_MORALE = 4;
const FAMILY_GO_ENERGY = -8;
const FAMILY_STAY_MORALE = -2;

/** FEEL: grievance answers. Letting it go settles the person; making it known costs a little standing with the staff and buys a little self-respect; the on-record demand is pure catharsis plus a paper trail (pre-NBA has no trade machinery to threaten with, so the event IS the effect). */
const PROMISE_LET_GO_MORALE = 2;
const PROMISE_KNOWN_TRUST_COST = 2;
const PROMISE_KNOWN_MORALE = 1;
const PROMISE_DEMAND_MORALE = 3;

/** Fictional recruiting-coach surname pool (program identity flavor, not @hoopsh/data content). */
const RECRUITER_SURNAMES: readonly string[] = [
  'Hartley', 'Reyes', 'Calhoun', 'Brandt', 'Okafor', 'Marchetti', 'Doyle',
  'Whitfield', 'Kessler', 'Aldana', 'Pruitt', 'Novak', 'Beaumont', 'Rucker',
  'Sandoval', 'Tillman',
];

/** Interest ladder, in climb order (types.ts InterestRung doc). */
const RUNG_ORDER: readonly InterestRung[] = [
  'none', 'questionnaire', 'letter', 'texts', 'visit', 'offer',
];

/** Role ladder in promise order (types.ts RoleId order); the grievance compares along it. */
const ROLE_ORDER: readonly RoleId[] = [
  'garbage', 'bench', 'rotation', 'sixthMan', 'starter', 'featured', 'franchise',
];

/** Fixed admission order across threads: byte-stable output and draw order. Recruiter threads rank after the named eight, in interest-array order. */
const THREAD_RANK: Record<string, number> = {
  coach: 0, agent: 1, family: 2, rival: 3, media: 4, teammate: 5, mentor: 6, wire: 7,
};

/** Human label per role for message copy ('sixthMan' reads wrong in a text). */
const ROLE_LABEL: Record<RoleId, string> = {
  garbage: 'garbage-time', bench: 'bench', rotation: 'rotation',
  sixthMan: 'sixth man', starter: 'starter', featured: 'featured', franchise: 'franchise',
};

// ---------------------------------------------------------------------------
// shared lookups

/** Me, wherever I currently live (career.players pre-entry, league.players after). */
function meOf(career: CareerState): FrPlayer {
  const me = career.players[career.me] ?? career.league.players[career.me];
  if (!me) throw new Error('career/phone: my player is missing from both pools');
  return me;
}

/** '180,000' without locale machinery (byte-stable across platforms). */
function fmtNum(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** '$180,000'. */
function fmtMoney(n: number): string {
  return `$${fmtNum(n)}`;
}

function rungIdx(r: InterestRung): number {
  return RUNG_ORDER.indexOf(r);
}

function roleIdx(r: RoleId): number {
  return ROLE_ORDER.indexOf(r);
}

/** One-decimal display for averages quoted in copy. */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Display name for a game participant's team, from the circuit first, the league second, the raw id as the honest last resort. */
function teamNameOf(career: CareerState, teamId: string): string {
  const ct = career.circuit?.teams.find(t => t.id === teamId);
  if (ct) return ct.name;
  return career.league.teams[teamId]?.name ?? teamId;
}

/** 'New York Excelsiors': how a draft-night call names a franchise. */
function nbaTeamNameOf(career: CareerState, teamId: string): string {
  const t = career.league.teams[teamId];
  return t ? `${t.city} ${t.name}` : teamId;
}

/** The stable, career-long surname of a program's recruiting coach. */
function recruiterSurname(career: CareerState, programId: string): string {
  return streamRng(career.seed, 'career-phone-coach', programId).pick(RECRUITER_SURNAMES);
}

/** '58-52' with the winner first: how a final gets texted. */
function fmtScore(final: [number, number]): string {
  const hi = Math.max(final[0], final[1]);
  const lo = Math.min(final[0], final[1]);
  return `${hi}-${lo}`;
}

/** Absolute week index on the career calendar, for windows that must survive year wraps. */
function absWeekOf(career: CareerState, clock: { year: number; week: number }): number {
  return clock.year * career.params.tick.weeksPerYear + clock.week;
}

/**
 * Whether a once-ever beat already landed, derived from message history:
 * tagged messages carry '#<tag>#' inside their ids, so the phone itself
 * is the memory (no new CareerState fields, byte-stable across save/load).
 * Members of one burst share a tag and generate in the SAME week, before
 * any of them is pushed into career.phone, so a shared tag never blocks a
 * sibling inside its own burst; it only blocks replays in later weeks.
 */
function alreadySent(career: CareerState, tag: string): boolean {
  const needle = `#${tag}#`;
  return career.phone.some(m => m.id.includes(needle));
}

/** Bodies this thread sent inside the anti-repeat window (discipline rule 7). */
function recentBodySet(career: CareerState, thread: ThreadId): Set<string> {
  const now = absWeekOf(career, career.clock);
  const out = new Set<string>();
  for (const m of career.phone) {
    if (m.thread !== thread) continue;
    if (now - absWeekOf(career, m.clock) < ANTIREPEAT_WEEKS) out.add(m.body);
  }
  return out;
}

interface WeekRecord {
  record: GameRecord;
  myLine: GameLine | null;
  rivalLine: GameLine | null;
}

/**
 * This week's finished games that can carry a message: circuit results
 * dated to the current career week plus, in the NBA phase, league results
 * inside the current league-day window (the week tick advances
 * params.tick.leagueDaysPerWeek days per career week). Sorted by game id:
 * result maps iterate in insertion order, which is deterministic but not
 * a contract worth leaning on.
 */
function weekRecords(career: CareerState): WeekRecord[] {
  const out: WeekRecord[] = [];
  const add = (record: GameRecord): void => {
    out.push({
      record,
      myLine: record.lines.find(l => l.playerId === career.me) ?? null,
      rivalLine: record.lines.find(l => l.playerId === career.rivalId) ?? null,
    });
  };
  if (career.circuit) {
    for (const record of Object.values(career.circuit.results)) {
      if (record.date.season === career.clock.year && record.date.day === career.clock.week) add(record);
    }
  }
  if (career.clock.phase === 'nba') {
    const windowStart = career.league.day - career.params.tick.leagueDaysPerWeek;
    for (const record of Object.values(career.league.results)) {
      if (record.date.season === career.league.season
        && record.date.day > windowStart && record.date.day <= career.league.day) add(record);
    }
  }
  out.sort((a, b) => (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0));
  return out;
}

/** Events already logged for the current (year, week): the week's real deltas. */
function eventsThisWeek(career: CareerState): CareerEvent[] {
  return career.events.filter(e =>
    e.clock.year === career.clock.year && e.clock.week === career.clock.week);
}

/**
 * Events inside a trailing window of `back` weeks (absolute weeks, so the
 * year wrap does not hide anything). Needed because season folds and honor
 * harvests land AFTER the phone already generated for their week: the wire
 * picks those stories up on the next pass, like a desk reading yesterday's
 * results.
 */
function eventsWithinWeeks(career: CareerState, back: number): CareerEvent[] {
  const now = absWeekOf(career, career.clock);
  return career.events.filter(e => {
    const at = absWeekOf(career, e.clock);
    return now - at >= 0 && now - at <= back;
  });
}

/** The record a grade points at, wherever it lives. */
function recordForGrade(career: CareerState, grade: GameGrade): GameRecord | null {
  return career.circuit?.results[grade.gameId]
    ?? career.league.results[grade.gameId]
    ?? null;
}

/** Whether a record's date sits in the current career week (circuit weeks) or the current NBA-phase day window. */
function recordIsThisWeek(career: CareerState, record: GameRecord): boolean {
  if (career.circuit?.results[record.id]) {
    return record.date.season === career.clock.year && record.date.day === career.clock.week;
  }
  if (career.clock.phase !== 'nba') return false;
  const windowStart = career.league.day - career.params.tick.leagueDaysPerWeek;
  return record.date.season === career.league.season
    && record.date.day > windowStart && record.date.day <= career.league.day;
}

// ---------------------------------------------------------------------------
// state detectors for the summit beats (read-only; no new CareerState fields)

/** My draftSelection off the league's real ledger, if the night has happened. */
function draftTxOf(career: CareerState, playerId: string): { teamId: TeamId; round: number; pick: number } | null {
  for (const tx of career.league.transactions) {
    if (tx.kind === 'draftSelection' && tx.playerId === playerId) {
      return { teamId: tx.teamId, round: tx.round, pick: tx.pick };
    }
  }
  return null;
}

/** The offer the career signed (recruiting.committedTo), if any. */
function committedOffer(career: CareerState): RouteOffer | null {
  const rec = career.recruiting;
  if (!rec?.committedTo) return null;
  return rec.offers.find(o => o.id === rec.committedTo) ?? null;
}

/** Display name of an offer's destination (program or club). */
function destOf(career: CareerState, offer: RouteOffer): string {
  if (offer.kind !== 'college') return offer.clubName ?? 'the club';
  return career.recruiting?.programs.find(p => p.id === offer.programId)?.name ?? 'the program';
}

/**
 * The losing finalist of the recruitment: the non-committed program that
 * climbed highest (rung, then perceived, then id for the tie). Only
 * programs that reached the living room count as finalists; a letter is
 * not a courtship.
 */
function losingFinalist(career: CareerState, committedProgramId: string | undefined): { program: Program; interestIdx: number } | null {
  const rec = career.recruiting;
  if (!rec) return null;
  let best: { program: Program; interestIdx: number; rung: number; perceived: number } | null = null;
  for (let i = 0; i < rec.interest.length; i++) {
    const interest = rec.interest[i]!;
    if (committedProgramId !== undefined && interest.programId === committedProgramId) continue;
    const r = rungIdx(interest.rung);
    if (r < rungIdx('visit')) continue;
    const program = rec.programs.find(p => p.id === interest.programId);
    if (!program) continue;
    const wins = !best
      || r > best.rung
      || (r === best.rung && interest.perceived > best.perceived)
      || (r === best.rung && interest.perceived === best.perceived && program.id < best.program.id);
    if (wins) best = { program, interestIdx: i, rung: r, perceived: interest.perceived };
  }
  return best ? { program: best.program, interestIdx: best.interestIdx } : null;
}

/** Kind-appropriate title vocabulary, mirroring circuits.ts finish strings. */
function titleWords(kind: CircuitKind): { champion: string; theFinal: string } {
  if (kind === 'hs') return { champion: 'state champion', theFinal: 'the state final' };
  if (kind === 'college') return { champion: 'national champion', theFinal: 'the national final' };
  return { champion: 'league champion', theFinal: 'the final' };
}

interface TitleOutcome {
  record: GameRecord;
  champion: boolean;
  score: string;
  kind: CircuitKind;
}

/** The championship final, if my team played it this week (win or lose). */
function titleGameThisWeek(career: CareerState): TitleOutcome | null {
  const circuit = career.circuit;
  if (!circuit) return null;
  const myTeamId = circuit.teams[circuit.myTeamIdx]?.id;
  if (!myTeamId) return null;
  for (const g of circuit.bracket) {
    if (g.type !== 'bracket' || g.round !== 'F') continue;
    const record = circuit.results[g.id];
    if (!record || !recordIsThisWeek(career, record)) continue;
    if (record.home !== myTeamId && record.away !== myTeamId) continue;
    const champion = record.home === myTeamId
      ? record.final[0] > record.final[1]
      : record.final[1] > record.final[0];
    return { record, champion, score: fmtScore(record.final), kind: circuit.kind };
  }
  return null;
}

/**
 * The bracket-seed week: the postseason exists and none of it has been
 * played (rounds seed one at a time, so this is true exactly once per
 * bracket phase; the year tag keeps it once per season). Returns my
 * opening opponent and my table record for the copy.
 */
function bracketSetThisWeek(career: CareerState): { opp: string; w: number; l: number } | null {
  const circuit = career.circuit;
  if (!circuit || circuit.complete || circuit.bracket.length === 0) return null;
  if (circuit.bracket.some(g => circuit.results[g.id])) return null;
  const mine = circuit.bracket.find(g =>
    g.homeIdx === circuit.myTeamIdx || g.awayIdx === circuit.myTeamIdx);
  if (!mine) return null;
  const oppIdx = mine.homeIdx === circuit.myTeamIdx ? mine.awayIdx : mine.homeIdx;
  const opp = circuit.teams[oppIdx]?.name ?? 'the other side';
  const table = circuit.standings.find(s => s.teamIdx === circuit.myTeamIdx);
  return { opp, w: table?.w ?? 0, l: table?.l ?? 0 };
}

/** Total NBA regular-season games on my sheet (rows whose team is a league team). */
function myNbaGamesTotal(career: CareerState): number {
  const me = meOf(career);
  let gp = 0;
  for (const row of me.seasons) {
    if (row.type === 'regular' && career.league.teams[row.teamId]) gp += row.gp;
  }
  return gp;
}

/** The debut week: my first NBA regular-season minutes happened inside this week's window. */
function debutThisWeek(career: CareerState): { record: GameRecord; line: GameLine } | null {
  if (career.clock.phase !== 'nba') return null;
  const played = weekRecords(career).filter(r =>
    r.record.type === 'regular' && r.myLine && r.myLine.min > 0);
  if (played.length === 0) return null;
  if (myNbaGamesTotal(career) !== played.length) return null;
  const first = played[0]!;
  return { record: first.record, line: first.myLine! };
}

/** The oldest teammate past MENTOR_MIN_AGE on my NBA roster; the mentor voice. */
function mentorOf(career: CareerState): FrPlayer | null {
  if (career.clock.phase !== 'nba' || !career.nbaTeam) return null;
  const team = career.league.teams[career.nbaTeam];
  if (!team) return null;
  let best: FrPlayer | null = null;
  for (const pid of team.roster) {
    if (pid === career.me) continue;
    const p = career.league.players[pid];
    if (!p) continue;
    if (career.league.season - p.bornSeason < MENTOR_MIN_AGE) continue;
    if (!best || p.bornSeason < best.bornSeason
      || (p.bornSeason === best.bornSeason && p.id < best.id)) best = p;
  }
  return best;
}

// ---------------------------------------------------------------------------
// the promise ledger (docs/CAREER.md: "a team that promised the starting job
// and buried you owes you a grievance the phone will conduct")

interface PromiseContext {
  /** stable dedupe key for the once-per-stint grievance and satisfied beats */
  key: string;
  promised: RoleId;
  dest: string;
  /** graded games under this promise (see the per-phase derivations below) */
  games: number;
  refs: PhoneMessage['refs'];
}

/**
 * The grace period before a grievance, read from career.params where the
 * frozen shape put it (params.nbabridge.promiseGraceGames, FEEL 20). The
 * trust section is checked first because the params task may migrate the
 * lever there this wave; this module never redefines the number.
 */
function promiseGraceGames(career: CareerState): number {
  const trustSide = (career.params.trust as { promiseGraceGames?: number }).promiseGraceGames;
  return trustSide ?? career.params.nbabridge.promiseGraceGames;
}

/** My played games in the active circuit (min > 0 lines in its results). */
function myPlayedGamesInCircuit(career: CareerState): number {
  const c = career.circuit;
  if (!c) return 0;
  let n = 0;
  for (const record of Object.values(c.results)) {
    const line = record.lines.find(l => l.playerId === career.me);
    if (line && line.min > 0) n += 1;
  }
  return n;
}

/**
 * The live role promise, derived entirely from existing state:
 * - college/euro/nbl: the committed offer's promisedRole. The games
 *   counter is my played games in that circuit kind (archived seasons'
 *   gp plus the live circuit), which works because the design has no
 *   transfers: every game of that kind was played under that promise.
 * - nba: the promisedRole parsed from the most recent signing event
 *   (nbabridge writes 'signed: <team>, ... (<role> role promised)'),
 *   valid only while that event names my CURRENT team (a draft or a
 *   trade voids the paper promise: nobody promised the drafted rookie
 *   anything). The games counter is coach.grades.length: the NBA coach
 *   ledger resets on every locker-room change, so its length IS my
 *   graded games under this staff, DNPs included (being nailed to the
 *   bench is exactly the buried case the grievance exists for).
 */
function promiseContext(career: CareerState): PromiseContext | null {
  const phase = career.clock.phase;
  if (phase === 'college' || phase === 'euro' || phase === 'nbl') {
    const offer = committedOffer(career);
    if (!offer || offer.kind !== phase) return null;
    let games = 0;
    for (const s of career.circuitHistory) {
      if (s.kind === phase) games += s.myLine.gp;
    }
    if (career.circuit?.kind === phase) games += myPlayedGamesInCircuit(career);
    const refs: PhoneMessage['refs'] = offer.programId ? { programId: offer.programId } : {};
    return { key: offer.id, promised: offer.promisedRole, dest: destOf(career, offer), games, refs };
  }
  if (phase === 'nba' && career.nbaTeam) {
    const tname = nbaTeamNameOf(career, career.nbaTeam);
    for (let i = career.events.length - 1; i >= 0; i--) {
      const e = career.events[i]!;
      if (e.kind !== 'contract' || !e.reason.startsWith('signed: ')) continue;
      if (!e.reason.includes(tname)) return null; // last signing was elsewhere: no live promise here
      const m = / \((\w+) role promised\)/.exec(e.reason);
      if (!m) return null;
      const promised = m[1] as RoleId;
      if (!ROLE_ORDER.includes(promised)) return null;
      return {
        key: `nba-${career.nbaTeam}`,
        promised,
        dest: tname,
        games: career.coach.grades.length,
        refs: { teamId: career.nbaTeam },
      };
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// candidates: everything the week COULD say, before caps and cooldowns

interface Candidate {
  thread: ThreadId;
  /** admission rank across threads (THREAD_RANK or 8+ for recruiters) */
  threadRank: number;
  /** within-thread priority; the burst guard keeps one message a week, so the biggest beat wins the slot */
  priority: number;
  from: string;
  /** fully interpolated phrasings; the weekly stream picks one (minus the anti-repeat window) */
  variants: string[];
  choices?: PhoneChoice[];
  deadlineWeek?: number;
  refs?: PhoneMessage['refs'];
  /**
   * Skip season cap and cooldown: reserved for the named payoff moments
   * (commitment, draft night, the title final, the NBA debut) plus the
   * undrafted aftermath. Documented in the header: a cap that mutes the
   * biggest night of a career is the measured bug, not discipline.
   */
  capExempt?: boolean;
  /**
   * Once-ever marker baked into the message id ('#tag#'); alreadySent
   * reads it back from career.phone, so scan-based detections (a
   * commitment that stays committed, a draft tx that stays in the ledger)
   * fire exactly once with zero new state.
   */
  tag?: string;
}

/** The coach's one text for the week: a role move outranks any single night; a night off the script outranks a clean one (that is who he is). */
function coachCandidates(career: CareerState, out: Candidate[]): void {
  const t = career.params.trust;
  const roleLabel = ROLE_LABEL[career.coach.role];

  // a role move this week: the only place role conversations happen
  const roleEv = eventsThisWeek(career).filter(e => e.kind === 'role').pop();
  if (roleEv) {
    const up = (roleEv.delta ?? 0) > 0;
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 100,
      from: career.coach.name,
      variants: up
        ? [
          `talked to the staff. the ${roleLabel} job is yours. ${roleEv.reason}. do not make me regret the call`,
          `new plan sheet this week. ${roleLabel} minutes. you earned it: ${roleEv.reason}`,
          `you are my ${roleLabel} now. ${roleEv.reason}. the standard moves with the job`,
        ]
        : [
          `moving you to ${roleLabel} for now. ${roleEv.reason}. the door back is the same door you came in`,
          `role talk after practice. you are at ${roleLabel}. ${roleEv.reason}. the tape does not lie and neither do i`,
          `this is not personal, it is the film: ${roleEv.reason}. ${roleLabel} until it turns`,
        ],
    });
  }

  // the bracket seed: the season's second act announced in his voice
  const seeded = bracketSetThisWeek(career);
  if (seeded) {
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 96,
      from: career.coach.name, capExempt: true, tag: `bkt${career.clock.year}`,
      variants: [
        `the bracket is set. ${seeded.opp} first. ${seeded.w}-${seeded.l} earned us the seed and the seed means nothing now. film tomorrow`,
        `the bracket is set: we open with ${seeded.opp}. everything before this was rehearsal. bring your real self monday`,
        `bracket came out. ${seeded.opp}. ${seeded.w} wins bought us this game and nothing after it. one night at a time now`,
        `it is ${seeded.opp} in the opener. the bracket is set and so is my rotation. do not make me rethink either`,
      ],
    });
  }

  // the postmortem: the final was this week, name the season honestly
  const title = titleGameThisWeek(career);
  if (title) {
    const table = career.circuit!.standings.find(s => s.teamIdx === career.circuit!.myTeamIdx);
    const w = table?.w ?? 0;
    const l = table?.l ?? 0;
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 99,
      from: career.coach.name, capExempt: true, tag: `post${career.clock.year}`,
      refs: { gameId: title.record.id },
      variants: title.champion
        ? [
          `${w}-${l} and the last game of the year was ours. i have coached a long time for a locker room that sounds like that. proud of you`,
          `season closed: champions. ${w}-${l}. in july nobody will remember the february slog. i will. that is where this was won`,
          `we finished it. ${title.score}. enjoy every second of this week, then remember: banners age fast in my gym`,
          `champions. i graded every night of this season and tonight i am putting the pen down. ${w}-${l}. thank you`,
        ]
        : [
          `${w}-${l} and one game short. i will not pretend the ending does not sting. i will also not pretend that season was anything but real`,
          `we lost the last one, ${title.score}. the season was still ${w}-${l} and nobody hands you that. the gap is one possession wide`,
          `final hurt. good. sleep on it, then look at ${w}-${l} and tell me this group did not move. see you in the spring`,
          `${title.score}. i watched you shake hands like a pro after. seasons end. what you built this year does not`,
        ],
    });
  }

  // the NBA debut: the first league tape gets its own text, quoting the line
  const debut = debutThisWeek(career);
  if (debut) {
    const { pts, ast } = debut.line;
    const reb = debut.line.orb + debut.line.drb;
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 97,
      from: career.coach.name, capExempt: true, tag: 'debut',
      refs: { gameId: debut.record.id },
      variants: [
        `${pts}, ${reb} and ${ast} in your first one. the league book on you starts tonight. write it yourself`,
        `debut done. ${pts} points. the speed is the league, the game is still the game. film at nine`,
        `first nba tape: ${pts}-${reb}-${ast}. nerves showed for a quarter, work showed for three. good ratio`,
        `welcome to the league. ${pts} in game one. nobody remembers debuts except mothers and coaches. we both saw a player`,
      ],
    });
  }

  // the week's graded nights: keep the loudest one (later game wins ties)
  let best: { priority: number; grade: GameGrade; record: GameRecord; pts: number } | null = null;
  for (const grade of career.coach.grades) {
    const record = recordForGrade(career, grade);
    if (!record || !recordIsThisWeek(career, record)) continue;
    const line = record.lines.find(l => l.playerId === career.me);
    if (!line || line.min <= 0) continue; // a DNP got its grade note; no text on top
    const offScript = grade.adherence < OFF_SCRIPT_ADHERENCE;
    const hot = grade.production >= t.promoteAt;
    const cold = grade.production <= t.demoteAt;
    const priority = offScript && hot ? 90 : offScript ? 85 : hot ? 80 : cold ? 70 : 0;
    if (priority === 0) continue; // an ordinary night inside the plan needs no text
    if (!best || priority >= best.priority) best = { priority, grade, record, pts: line.pts };
  }
  if (best) {
    const { grade, record, pts } = best;
    const offScript = grade.adherence < OFF_SCRIPT_ADHERENCE;
    const hot = grade.production >= t.promoteAt;
    const variants = offScript && hot
      ? [
        `${pts} is ${pts}. the plan was not. i graded you ${grade.adherence} on staying inside it. film thursday`,
        `i will take the ${pts}. i will not take how we got there. my book says "${grade.note}"`,
        `good ${pts}. wrong script. bring your shoes to film, we are walking every possession we called`,
        `${pts} points, graded ${grade.adherence} against the plan. one of those numbers is a problem. thursday`,
      ]
      : offScript
        ? [
          `the plan is not a suggestion. ${grade.adherence} on staying inside it and ${pts} to show for the freelancing. film`,
          `my note from tonight reads "${grade.note}". we are watching it together`,
          `you hunted outside what we called and it got you ${pts}. the tape does not blink. monday, early`,
          `graded ${grade.adherence} against the plan. that is not a talent problem, it is a choices problem. come see me`,
        ]
        : hot
          ? [
            `${pts} inside the offense. that is the whole idea. same again next game`,
            `graded you ${grade.production} for the night. the plan works when you work it`,
            `${pts} and nothing forced. watched it back twice. this is the standard now`,
            `that is what the job looks like. ${pts}. get your rest`,
          ]
          : [
            `rough one. ${pts} points and the book says "${grade.note}". next practice is the answer`,
            `everyone has a ${pts}-point night in them. what matters is what tuesday looks like. be early`,
            `not your night. graded ${grade.production} for the ${roleLabel} job. we go back to basics this week`,
            `saw it. ${pts}. no speech, just work. first drill is yours tomorrow`,
          ];
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: best.priority,
      from: career.coach.name, variants, refs: { gameId: record.id },
    });
  }
}

/** The agent's display name for the phase: a family advisor until one can legally sign. */
function agentFrom(career: CareerState): string {
  return career.clock.phase === 'hs' || career.clock.phase === 'college'
    ? 'Uncle Dee (advisor)'
    : 'Marta (agent)';
}

/** The agent (a family advisor until one can legally sign): stock reads, quoting the ladder's own stated reason. Small drifts stay unsent. */
function agentCandidates(career: CareerState, out: Candidate[]): void {
  const from = agentFrom(career);

  // the draft-class entry week: the file goes real, the tone flips
  // professional (the year-wrap phase event lands in this week's feed)
  const entered = eventsThisWeek(career).some(e =>
    e.kind === 'phase' && e.reason.includes('pre-draft window opens'));
  if (entered) {
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 95,
      from: 'Marta (agent)', tag: 'file',
      variants: [
        'Marta. From this week I represent you, and this stops being a story about potential. The file went to all thirty rooms this morning. Everything you do until June is an exhibit',
        'It is paperwork season. The class list has your name on it as of today. From here the calls come through me, the film speaks for you, and neither of us reads comment sections',
        'Welcome to the pre-draft window. Thirty teams, one file, your name on the cover. Train like the number is wrong in whichever direction keeps you hungry',
        'The advisor era is over. Agent era. Combine, workouts, war rooms. I talk, you play, we pick the suit later',
      ],
    });
  }

  const stock = career.stock;
  if (!stock) return;
  const weekEntries = stock.history.filter(h =>
    h.year === career.clock.year && h.week === career.clock.week);
  const entry = weekEntries[weekEntries.length - 1];
  if (!entry) return;
  const idx = stock.history.lastIndexOf(entry);
  const prev = idx > 0 ? stock.history[idx - 1] : undefined;

  // the ladder's stated reasons are complete sentences in the insider's
  // voice, so the agent forwards them in quotes rather than restating
  // the number they already carry
  let variants: string[] | null = null;
  if (entry.rank === null) {
    variants = [
      `Straight talk: "${entry.reason}". Off the boards this week. The way back on is film they cannot ignore`,
      `"${entry.reason}". No number next to your name right now. That is information, not a verdict`,
      `The boards dropped you. Their reason: "${entry.reason}". We work. We do not scroll`,
    ];
  } else if (!prev || prev.rank === null) {
    variants = [
      `You are a real name now. Their words: "${entry.reason}". Do not read the mocks, that is my job`,
      `It is in print: "${entry.reason}". We stay boring and we keep working`,
      `The market opened on you: "${entry.reason}". I worry about the number, you play`,
    ];
  } else {
    const delta = prev.rank - entry.rank; // +N picks climbed
    if (delta >= AGENT_MOVE_MIN) {
      variants = [
        `Up ${delta} to ${entry.rank}. The wire's line: "${entry.reason}". My phone is doing its job, you keep doing yours`,
        `The boards moved you to ${entry.rank}. Stated reason: "${entry.reason}". Do not read the rest of the page`,
        `${entry.rank} now, ${delta} better than last week. "${entry.reason}". Markets chase. We do not`,
      ];
    } else if (delta <= -AGENT_MOVE_MIN) {
      variants = [
        `Down ${-delta} to ${entry.rank}. "${entry.reason}". Boards overreact on the way down too. We do not`,
        `You will hear you slid to ${entry.rank}. The reason on the wire: "${entry.reason}". It is priced in. Keep playing`,
        `${entry.rank} this week. "${entry.reason}". Nobody remembers a February board in June. Work`,
      ];
    } else if (delta === 0) {
      // a story entry with the number unmoved is a real beat (the combine measurement lands here)
      variants = [
        `"${entry.reason}". The number held at ${entry.rank}. Steady is a result too`,
        `News from the ladder: "${entry.reason}". You sit at ${entry.rank}. No panic in this office`,
      ];
    }
  }
  if (!variants) return; // a 1-2 pick drift is coffee talk, not a phone buzz
  out.push({
    thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 80, from, variants,
  });
}

/**
 * The promise ledger, conducted by the agent (docs/CAREER.md): after
 * params grace games below the promised role, the grievance; on the rung
 * finally reached, the satisfied beat. Both once per promise context,
 * derived states only.
 */
function promiseCandidates(career: CareerState, out: Candidate[]): void {
  const ctx = promiseContext(career);
  if (!ctx) return;
  const from = agentFrom(career);
  const cur = career.coach.role;
  const curIdx = roleIdx(cur);
  const promIdx = roleIdx(ctx.promised);
  const promLabel = ROLE_LABEL[ctx.promised];
  const curLabel = ROLE_LABEL[cur];

  if (curIdx < promIdx && ctx.games >= promiseGraceGames(career)) {
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 85,
      from, tag: `grv-${ctx.key}`, refs: ctx.refs,
      variants: [
        `Time to talk about the promise. ${ctx.dest} said ${promLabel}; ${ctx.games} games in, you sit at ${curLabel}. That gap is theirs to explain or yours to carry. Which is it going to be?`,
        `I keep a file. ${ctx.dest} promised the ${promLabel} job and after ${ctx.games} games the sheet says ${curLabel}. We can let the film argue for us, or we can make some noise`,
        `${ctx.games} games at ${ctx.dest} and the ${promLabel} promise is still parked at ${curLabel}. I do not forget terms. Tell me how loud to be`,
        `The promise was ${promLabel}. The reality after ${ctx.games} games is ${curLabel}. The grace period is over by my math. Your move, and I back any of them`,
      ],
      choices: [
        { id: 'promise-let-go', label: 'Let it go' },
        { id: 'promise-make-known', label: 'Make it known' },
        { id: 'promise-demand', label: 'Demand action' },
      ],
    });
    return;
  }

  // the promise met: a role move this week carried you across the line
  const rose = eventsThisWeek(career).some(e => e.kind === 'role' && (e.delta ?? 0) > 0);
  if (rose && curIdx >= promIdx && curIdx - 1 < promIdx) {
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 70,
      from, tag: `kept-${ctx.key}`, refs: ctx.refs,
      variants: [
        `For the record: ${ctx.dest} said ${promLabel} and you are the ${promLabel}. Kept promises get remembered in this office too`,
        `The file closes clean: promised ${promLabel}, playing ${promLabel}. Rare enough to text about`,
        `They kept their word. ${promLabel}, like the paper said. I like doing business with people like that. Now keep taking the minutes`,
      ],
    });
  }
}

/** Family: sparse grounding beats. Mom watches every game and worries about the body; the season caps keep her two or three texts a year, and the payoff nights ride outside them. */
function familyCandidates(career: CareerState, out: Candidate[]): void {
  const me = meOf(career);
  const events = eventsThisWeek(career);

  // the title game: win or lose, mom is the voice of the biggest night
  const title = titleGameThisWeek(career);
  if (title) {
    const words = titleWords(title.kind);
    out.push({
      thread: 'family', threadRank: THREAD_RANK.family!, priority: 96,
      from: 'Mom', capExempt: true, tag: `fin${career.clock.year}`,
      refs: { gameId: title.record.id },
      variants: title.champion
        ? [
          `You are a ${words.champion}. I said it out loud three times in the parking lot just to hear it. Tonight's ticket goes in a frame`,
          `${title.score}. A ${words.champion}. I hugged strangers, baby. STRANGERS`,
          `My son the ${words.champion}. I am not sleeping and I do not care. I am reliving ${title.score} until the sun comes up`,
          `A ${words.champion}! Your grandmother heard me scream from the porch. Come home safe, the cake goes in the oven the second you text back`,
          `They can never take tonight away. ${words.champion}. I kept every ticket this season and this one gets the frame`,
        ]
        : [
          `${title.score}. I know, baby. I kept the ticket anyway. I keep them all, that is where the whole story lives`,
          `You lost ${words.theFinal} tonight and I watched you shake their hands like a grown man anyway. The ticket stays in my purse. So does the pride`,
          `Not tonight. ${title.score}. Soup is on when you get home and we are not talking about it unless you want to`,
          `I saw the ending. I also saw the season. Tonight's ticket goes in the shoebox with all the others, and one day you will want it`,
        ],
    });
  }

  // commitment day: real feelings, the program's actual name
  // (built in commitmentCandidates so the burst stays in one place)

  // draft and debut nights are built in their own burst builders below

  // a new injury this week (week.ts logs it with a negative delta; the clearance event carries none)
  const hurt = events.some(e => e.kind === 'injury' && (e.delta ?? 0) < 0);
  if (hurt && me.health.injury) {
    const weeks = Math.max(1, Math.round(me.health.injury.outDays / 7));
    const weekWord = weeks === 1 ? 'week' : 'weeks';
    out.push({
      thread: 'family', threadRank: THREAD_RANK.family!, priority: 90, from: 'Mom',
      variants: [
        `Saw you limp off. Coach says about ${weeks} ${weekWord}. Ice it like your uncle never did`,
        `They told me ${me.health.injury.label}, ${weeks} ${weekWord}. The gym will still be there. Let it heal`,
        `I watched it back twice to see how you landed. ${me.health.injury.label}. Rest means rest, baby`,
        `The trainer talked to me because you would not. ${me.health.injury.label}, ${weeks} ${weekWord}. Healing is training too, do not argue with your mother`,
        `I do not care about the standings, I care about the landing. ${weeks} ${weekWord} means ${weeks} ${weekWord}. We will do puzzles`,
      ],
    });
  }

  // the season opener: mom is in the stands for the first one every year
  // (the docs promise two or three family beats a season; the opener is
  // the reliable one, injuries and empty tanks are the conditional ones)
  if (career.circuit) {
    let playedThisSeason = 0;
    for (const record of Object.values(career.circuit.results)) {
      const l = record.lines.find(x => x.playerId === career.me);
      if (l && l.min > 0) playedThisSeason += 1;
    }
    const playedThisWeek = weekRecords(career).filter(r => r.myLine && r.myLine.min > 0);
    // opener week = every game I have played this season happened this
    // week (school ball plays twice a week, so counting games instead of
    // weeks would let the opener slip past unremarked)
    if (playedThisSeason > 0 && playedThisSeason === playedThisWeek.length) {
      const record = playedThisWeek[0]!.record; // mom texts about the first one, not the best one
      const myLine = playedThisWeek[0]!.myLine!;
      const myHome = myLine.teamId === record.home;
      const won = myHome ? record.final[0] > record.final[1] : record.final[1] > record.final[0];
      out.push({
        thread: 'family', threadRank: THREAD_RANK.family!, priority: 70, from: 'Mom',
        variants: won
          ? [
            `First one of the season and you gave me ${myLine.pts} points. I clapped too loud and I am not sorry`,
            `Opening night, ${myLine.pts} points, a win. Eat something real tonight, not gas station food`,
            `Season is open. ${myLine.pts} from my seat in the third row. I kept the ticket`,
            `Opening night again. ${myLine.pts} points, and you found me in the stands before tipoff like always. That is my favorite part and it is not close`,
            `${myLine.pts} in the opener. New season, same third row. I brought your cousin and she is hoarse now`,
            `Season one game old and you already gave them ${myLine.pts}. The whole drive home was radio and grinning`,
          ]
          : [
            `${myLine.pts} points. They got the game but I saw you out there. Long season, baby`,
            `Opening night did not go your way. ${myLine.pts} still came home with you. Soup is on the stove`,
            `They tell me the first one matters least. ${myLine.pts} points says you showed up anyway`,
            `An opener is a comma, not a period. ${myLine.pts} points. Eat something and call me tomorrow`,
            `${myLine.pts} on opening night. They were bigger. You were braver. The season is long and I have snacks`,
            `First game went to them. Your ${myLine.pts} still happened, I counted every one. Bed early tonight`,
          ],
        refs: { gameId: record.id },
      });
    }
  }

  // running on empty: the allocation logged it, mom saw it in the free throws
  const gassed = events.some(e => e.kind === 'energy' && e.reason.startsWith('running on empty'));
  if (gassed) {
    out.push({
      thread: 'family', threadRank: THREAD_RANK.family!, priority: 60, from: 'Mom',
      variants: [
        `You look tired on the stream. A mother can tell from the free throws. Come home Sunday, I am cooking`,
        `All that gym time and you think I cannot see it in your legs. Sunday dinner. Bring your laundry`,
        `Grandma asked why you look skinny. I told her you are running on fumes. Sunday? ❤️`,
        `You are running on fumes, I can hear it in your texts even. Sunday. One afternoon will not cost you the season, it might save it`,
        `I know that empty-tank look even through a screen. Home Sunday, plate of real food, back by dark. Deal?`,
      ],
      choices: [
        { id: 'family-go', label: 'Go home Sunday' },
        { id: 'family-stay', label: 'Stay in the gym' },
      ],
    });
  }
}

/** The rival: head-to-heads get a needle with stakes; his statement lines elsewhere get a read-only jab. He always texts first. */
function rivalCandidates(career: CareerState, out: Candidate[]): void {
  const rival = career.players[career.rivalId] ?? career.league.players[career.rivalId];
  if (!rival) return;
  for (const { record, myLine, rivalLine } of weekRecords(career)) {
    if (!rivalLine) continue;
    if (myLine && myLine.min > 0 && rivalLine.teamId !== myLine.teamId) {
      // the head-to-head: stakes for whoever answers
      const myHome = myLine.teamId === record.home;
      const iWon = myHome ? record.final[0] > record.final[1] : record.final[1] > record.final[0];
      const score = fmtScore(record.final);
      const myReb = myLine.orb + myLine.drb;
      out.push({
        thread: 'rival', threadRank: THREAD_RANK.rival!, priority: 90, from: rival.name,
        variants: iWon
          ? [
            `enjoy it. i still put up ${rivalLine.pts} in your gym. run it back in the bracket`,
            `${score}. refs liked you tonight. they usually do`,
            `you got the win, i got ${rivalLine.pts}. we both know which one travels`,
          ]
          : [
            `${myLine.pts} and ${myReb} huh. cute`,
            `checked the box score twice to make sure. ${myLine.pts} points. see you next time`,
            `${score}. i would say good game but you were there`,
            `everybody said you were the problem tonight. ${myLine.pts} points of problem apparently`,
          ],
        choices: iWon
          ? [
            { id: 'reply-won', label: 'Send him the scoreboard' },
            { id: 'rival-mute', label: 'Leave him on read' },
          ]
          : [
            { id: 'reply-lost', label: 'Say something back' },
            { id: 'rival-mute', label: 'Leave him on read' },
          ],
        refs: { players: [career.rivalId], gameId: record.id },
      });
    } else if (!myLine && rivalLine.pts >= RIVAL_STATEMENT_PTS) {
      // his big night in somebody else's gym
      const oppId = rivalLine.teamId === record.home ? record.away : record.home;
      const opp = teamNameOf(career, oppId);
      out.push({
        thread: 'rival', threadRank: THREAD_RANK.rival!, priority: 50, from: rival.name,
        variants: [
          `${rivalLine.pts} on ${opp} tonight. you keeping count over there or should i keep you posted`,
          `${opp} tried to double me. ${rivalLine.pts}. anyway how was your week`,
          `scoreboard says ${rivalLine.pts}. just making sure your phone still works`,
        ],
        refs: { players: [career.rivalId], gameId: record.id },
      });
    }
  }
}

/**
 * Media context for the week: which loaded question the beat writer gets
 * to ask. Angles key to real, checkable state (the statement line, the
 * fresh role move, the blowout margin, the rivalry box score, the live
 * win streak, the measured slump), never to a generic quiz.
 */
function mediaCandidates(career: CareerState, out: Candidate[]): void {
  const from = 'Dana Marsh (beat writer)';
  const records = weekRecords(career);
  const playedThisWeek = records.filter(r => r.myLine && r.myLine.min > 0);

  // the statement game travels (the doc names the 30-point night the shock that moves boards)
  let big: { pts: number; opp: string; gameId: string } | null = null;
  for (const { record, myLine } of records) {
    if (!myLine || myLine.pts < MEDIA_GAME_PTS) continue;
    if (!big || myLine.pts > big.pts) {
      const oppId = myLine.teamId === record.home ? record.away : record.home;
      big = { pts: myLine.pts, opp: teamNameOf(career, oppId), gameId: record.id };
    }
  }
  if (big) {
    out.push({
      thread: 'media', threadRank: THREAD_RANK.media!, priority: 80, from,
      variants: [
        `${big.pts} against ${big.opp}. People around this circuit say you are the best player in it. Are they right?`,
        `On the record: ${big.pts} points. The word scouts keep reaching for with you is ceiling. What word would you use?`,
        `${big.pts} on ${big.opp}. Your coach preaches the system. Was that the system tonight, or was that you?`,
        `${big.pts} tonight. Off-the-record answers make better quotes, so: how much of that was anger?`,
        `The ${big.pts}-point night will travel. When the calls start coming, and they will, what do you want them to have watched?`,
        `${big.pts} on ${big.opp} and the gym went quiet in the third. Do you notice the quiet, or is that just us up here?`,
      ],
      choices: [
        { id: 'media-lean', label: 'Own it' },
        { id: 'media-team', label: 'Credit the room' },
        { id: 'media-shrug', label: 'No comment' },
      ],
      refs: { gameId: big.gameId },
    });
  }

  // a promotion is a story with a microphone in it
  const promo = eventsThisWeek(career).filter(e => e.kind === 'role' && (e.delta ?? 0) > 0).pop();
  if (promo) {
    const roleLabel = ROLE_LABEL[career.coach.role];
    out.push({
      thread: 'media', threadRank: THREAD_RANK.media!, priority: 60, from,
      variants: [
        `The ${roleLabel} move is official. Quick quote for tomorrow: did the coaches catch up to you, or did you catch up to the job?`,
        `You are the ${roleLabel} now. On the record: is the job yours to keep, or is somebody else's name still on the door?`,
        `New role, same gym. What is the first thing that changes on film that the stands will not notice?`,
        `The ${roleLabel} job comes with the loudest seat. Who texted you first when the news broke, and what did they say?`,
      ],
      choices: [
        { id: 'media-lean', label: 'The job was mine already' },
        { id: 'media-team', label: 'Point at the coaches' },
        { id: 'media-shrug', label: 'Decline the victory lap' },
      ],
    });
  }

  // the blowout: winners get asked about style points
  for (const { record, myLine } of playedThisWeek) {
    const myHome = myLine!.teamId === record.home;
    const margin = myHome ? record.final[0] - record.final[1] : record.final[1] - record.final[0];
    if (margin < MEDIA_BLOWOUT_MARGIN) continue;
    const oppId = myHome ? record.away : record.home;
    const opp = teamNameOf(career, oppId);
    const score = fmtScore(record.final);
    out.push({
      thread: 'media', threadRank: THREAD_RANK.media!, priority: 55, from,
      variants: [
        `A ${margin}-point final over ${opp}. Winners get asked about style points: was that a message game, or does it just look like one from press row?`,
        `${score}. At what point in a night like that do you start playing the standings instead of the opponent?`,
        `Blowouts bore everybody except coaches. ${margin} points. What does the film session even look like after a game with no adversity in it?`,
        `${score} over ${opp}. Some teams ease up at twenty. Yours kept pressing. Whose call was that?`,
      ],
      choices: [
        { id: 'media-lean', label: 'It was a message' },
        { id: 'media-team', label: 'Just execution' },
        { id: 'media-shrug', label: 'Next question' },
      ],
      refs: { gameId: record.id },
    });
    break; // one blowout question a week is plenty
  }

  // the rivalry: the two names every scout sheet staples together
  const rival = career.players[career.rivalId] ?? career.league.players[career.rivalId];
  if (rival) {
    for (const { record, myLine, rivalLine } of records) {
      if (!myLine || myLine.min <= 0 || !rivalLine || rivalLine.teamId === myLine.teamId) continue;
      out.push({
        thread: 'media', threadRank: THREAD_RANK.media!, priority: 50, from,
        variants: [
          `You and ${rival.name} again. ${myLine.pts} to his ${rivalLine.pts}. Fifteen-year rivalries start somewhere. Is this one?`,
          `On the record about ${rival.name}: he says this circuit runs through his gym. Your ${myLine.pts} tonight argues back. Care to say it out loud?`,
          `${rival.name} had ${rivalLine.pts}, you had ${myLine.pts}. Every scout sheet I see staples you two together. Does that flatter you or bother you?`,
          `The building watched you and ${rival.name} all night. Honest question: do you two like each other, or is the handshake the whole relationship?`,
        ],
        choices: [
          { id: 'media-lean', label: 'It runs through me' },
          { id: 'media-team', label: 'Respect him, next' },
          { id: 'media-shrug', label: 'Not doing the rivalry bit' },
        ],
        refs: { gameId: record.id, players: [career.rivalId] },
      });
      break;
    }
  }

  // the streak: superstition is a story
  if (playedThisWeek.length > 0 && career.circuit) {
    const c = career.circuit;
    const myTeamId = c.teams[c.myTeamIdx]?.id;
    if (myTeamId) {
      const results: Array<{ week: number; id: string; won: boolean }> = [];
      for (const g of [...c.schedule, ...c.bracket]) {
        const rec = c.results[g.id];
        if (!rec || (rec.home !== myTeamId && rec.away !== myTeamId)) continue;
        const won = rec.home === myTeamId ? rec.final[0] > rec.final[1] : rec.final[1] > rec.final[0];
        results.push({ week: g.week, id: g.id, won });
      }
      results.sort((a, b) => a.week - b.week || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let streak = 0;
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i]!.won) streak += 1;
        else break;
      }
      if (streak >= MEDIA_STREAK_GAMES) {
        out.push({
          thread: 'media', threadRank: THREAD_RANK.media!, priority: 45, from,
          variants: [
            `${streak} straight wins. Streaks make teams superstitious. What is the thing nobody in your locker room will say out loud?`,
            `The streak sits at ${streak}. When did you last lose, and be honest: do you remember it too well or not at all?`,
            `${streak} in a row. Every run has the one game it should have lost. Which was yours?`,
            `Winning ${streak} straight changes how a gym sounds. What changed since the last loss that a box score will not show?`,
          ],
          choices: [
            { id: 'media-lean', label: 'Feed the streak talk' },
            { id: 'media-team', label: 'One game at a time' },
            { id: 'media-shrug', label: 'Not jinxing it' },
          ],
        });
      }

      // the slump: the recruiting model's own cold-stretch rule, asked out loud
      const myPts: number[] = [];
      for (const g of [...c.schedule, ...c.bracket]) {
        const rec = c.results[g.id];
        if (!rec) continue;
        const line = rec.lines.find(l => l.playerId === career.me);
        if (line && line.min > 0) myPts.push(line.pts);
      }
      if (myPts.length >= SLUMP_MIN_GAMES) {
        const seasonAvg = myPts.reduce((s, p) => s + p, 0) / myPts.length;
        const tail = myPts.slice(-SLUMP_WINDOW_GAMES);
        const recent = tail.reduce((s, p) => s + p, 0) / tail.length;
        if (seasonAvg > 0 && recent < seasonAvg * SLUMP_RATIO) {
          const r = round1(recent);
          const a = round1(seasonAvg);
          out.push({
            thread: 'media', threadRank: THREAD_RANK.media!, priority: 40, from,
            variants: [
              `Three games at ${r} a night against a season of ${a}. Slump, scheme, or something you are not telling me?`,
              `The last three: ${r} a game. Your season says ${a}. What does the film say that the numbers do not?`,
              `${r} a night this stretch, ${a} on the year. Coaches call it variance. Players call it a slump. What do you call it?`,
            ],
            choices: [
              { id: 'media-lean', label: 'It turns this week' },
              { id: 'media-team', label: 'Winning is the stat' },
              { id: 'media-shrug', label: 'No comment' },
            ],
          });
        }
      }
    }
  }
}

/** A teammate after a tournament win: pure texture, read-only, teenage volume without internet slang. */
function teammateCandidates(career: CareerState, out: Candidate[]): void {
  const circuit = career.circuit;
  if (!circuit) return;
  const myTeamId = circuit.teams[circuit.myTeamIdx]?.id;
  if (!myTeamId) return;
  const mate = circuit.teams[circuit.myTeamIdx]!.starters.find(pid => pid !== career.me);
  const mateName = mate ? career.players[mate]?.name : undefined;
  if (!mate || !mateName) return;

  for (const { record } of weekRecords(career)) {
    if (record.home !== myTeamId && record.away !== myTeamId) continue;
    const game = [...circuit.schedule, ...circuit.bracket].find(g => g.id === record.id);
    if (!game || game.type === 'regular') continue;
    const weWon = record.home === myTeamId
      ? record.final[0] > record.final[1]
      : record.final[1] > record.final[0];
    if (!weWon) continue;
    const round = game.round === 'F' ? 'the final'
      : game.round === 'SF' ? 'the semifinal'
        : game.round === 'QF' ? 'the quarterfinal'
          : game.round === 'R16' ? 'the round of 16'
            : game.type === 'confTourney' ? 'the conference tournament' : 'the bracket';
    const score = fmtScore(record.final);
    out.push({
      thread: 'teammate', threadRank: THREAD_RANK.teammate!, priority: 40,
      from: `${mateName} (teammate)`,
      variants: [
        `${score}. we are through ${round}. gym is going to be LOUD next week`,
        `won ${round} ${score}. coach smiled. he actually smiled`,
        `${score} in ${round}. i am not sleeping tonight and honestly neither should you`,
        `${score}. i have watched the last play nine times. NINE. we are actually good`,
        `coach let the locker room music stay on after ${round}. ${score}. historic night all around`,
        `my mom cried, your mom cried, i think the ref almost cried. ${score}. gym at six because i cannot sleep anyway`,
        `they are printing shirts. SHIRTS. ${score} in ${round} and we are on a shirt`,
      ],
      refs: { players: [mate], gameId: record.id },
    });
  }
}

/**
 * The vet mentor (docs/CAREER.md: lessons, loyalty, perspective): the
 * oldest teammate past thirty on my NBA roster. Two state-backed beats:
 * the debut welcome and the demotion-week perspective. No mentor in the
 * room, no thread.
 */
function mentorCandidates(career: CareerState, out: Candidate[]): void {
  const mentor = mentorOf(career);
  if (!mentor) return;
  const age = career.league.season - mentor.bornSeason;
  const from = `${mentor.name} (vet)`;

  const debut = debutThisWeek(career);
  if (debut) {
    out.push({
      thread: 'mentor', threadRank: THREAD_RANK.mentor!, priority: 80,
      from, tag: 'debut', refs: { players: [mentor.id], gameId: debut.record.id },
      variants: [
        `${mentor.name}. rook. shootaround comes an hour early with me from now on. first lesson is free: this league tests your sleep before it tests your handle`,
        `good first one, rook. ${age} years old means i have already made every mistake you are about to. sit next to me on the plane`,
        `saw the debut. real minutes, real nerves, real player. rule one in this room: vets eat first, rooks carry the film bag, everybody guards`,
        `welcome to the show, rook. one thing worth texting after game one: be early, everywhere, always. the rest we cover at practice`,
      ],
    });
  }

  const demoted = eventsThisWeek(career).some(e => e.kind === 'role' && (e.delta ?? 0) < 0);
  if (demoted) {
    out.push({
      thread: 'mentor', threadRank: THREAD_RANK.mentor!, priority: 60,
      from, refs: { players: [mentor.id] },
      variants: [
        `heard about the role. i have been benched by better teams than this one, rook. the ones who last treat it like weather`,
        `role news reached my locker before you did. i lost my starting job twice and took it back twice. the tape is the only appeal that works`,
        `do not sulk past thursday. this league forgets sulkers and promotes workers. i have watched it happen for a decade`,
        `benches are where pros get made. tourists complain, residents renovate. be a resident this week`,
      ],
    });
  }
}

/**
 * The wire: the news desk writing about ME (docs/CAREER.md). One fixed
 * byline, every line quoting real numbers: career scoring milestones off
 * the season rows, honors off the honor events (read on a one-week lag
 * because folds and harvests land after the phone's weekly pass), and
 * draft night off the transaction ledger (built in draftNightCandidates
 * with the rest of that burst).
 */
function wireCandidates(career: CareerState, out: Candidate[]): void {
  const me = meOf(career);

  // career scoring milestone: the rows are the accumulated truth; this
  // week's lines say whether the crossing happened tonight
  let total = 0;
  for (const row of me.seasons) total += row.pts;
  const played = weekRecords(career).filter(r => r.myLine && r.myLine.min > 0);
  const weekPts = played.reduce((s, r) => s + r.myLine!.pts, 0);
  if (weekPts > 0) {
    const before = total - weekPts;
    const k = Math.floor(total / MILESTONE_STEP);
    if (k >= 1 && before < k * MILESTONE_STEP) {
      const mark = k * MILESTONE_STEP;
      const last = played[played.length - 1]!;
      const oppId = last.myLine!.teamId === last.record.home ? last.record.away : last.record.home;
      const opp = teamNameOf(career, oppId);
      const pts = last.myLine!.pts;
      out.push({
        thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 80,
        from: WIRE_BYLINE, tag: `mile${mark}`, refs: { gameId: last.record.id },
        variants: [
          `${fmtNum(mark)} career points for ${me.name}, crossed with ${pts} against ${opp}. Round numbers are arbitrary. Watching him get there was not`,
          `${me.name} passed ${fmtNum(mark)} career points tonight, ${pts} against ${opp} doing the honors. The ledger keeps count so the highlight reels do not have to`,
          `Milestone watch closed: ${fmtNum(mark)} career points for ${me.name}. The ${pts}-point night against ${opp} did it`,
          `${fmtNum(mark)} career points for ${me.name}, sealed with ${pts} on ${opp}. Ask him and he will shrug. Ask anyone who has guarded him and they will not`,
        ],
      });
    }
  }

  // honors, read off the real events on a one-week lag (function doc):
  // fires only when every honor in the window is untold, so a digest
  // never half-repeats itself
  const honors = eventsWithinWeeks(career, 1).filter(e => e.kind === 'honor');
  if (honors.length > 0 && honors.every(e => !alreadySent(career, `wr-${e.id}`))) {
    const quoted = honors.slice(0, 3).map(e => e.reason).join('; ');
    out.push({
      thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 60,
      from: WIRE_BYLINE, tag: `wr-${honors[0]!.id}`,
      variants: [
        `The season's ledger on ${me.name}: ${quoted}. Written plainly because it does not need help`,
        `For the record: ${quoted}. ${me.name}'s file gets thicker`,
        `${quoted}. That is the line under ${me.name}'s season. The Ledger prints what held up`,
      ],
    });
  }
}

/**
 * The commitment burst: the payoff of the whole recruiting arc, fired on
 * the committedTo transition (detected by scan plus the once-ever tag,
 * because the signing can happen through a choice OR the signing-day
 * autopick at the year wrap). Three voices in one week: mom with the
 * program's real name, the rival with a needle, and the losing finalist
 * closing the door classy or bitter by stable personality draw. EXEMPT
 * from per-thread season caps: this is the moment the caps exist to
 * protect, and a mom who spent her three texts on openers must still get
 * signing day.
 */
function commitmentCandidates(career: CareerState, out: Candidate[]): void {
  const phase = career.clock.phase;
  if (phase !== 'hs' && phase !== 'college' && phase !== 'euro' && phase !== 'nbl') return;
  const offer = committedOffer(career);
  if (!offer) return;
  const dest = destOf(career, offer);
  const refs: PhoneMessage['refs'] = offer.programId ? { programId: offer.programId } : {};

  out.push({
    thread: 'family', threadRank: THREAD_RANK.family!, priority: 98,
    from: 'Mom', capExempt: true, tag: 'commit', refs,
    variants: [
      `${dest}. Baby, I said it out loud in the kitchen just to hear it. Your grandmother is already telling the whole church`,
      `I framed the first letter they sent and now I get to hang it. ${dest}. Your father would have driven there tonight`,
      `You picked ${dest} and I cried in the car so you would not see. Proud is too small a word`,
      `${dest}!! I am buying the ugliest sweatshirt they sell and wearing it everywhere, do not fight me on this`,
      `Sat with it all night. ${dest} is getting the kid who shoveled the driveway to get shots up. They have no idea`,
    ],
  });

  const rival = career.players[career.rivalId] ?? career.league.players[career.rivalId];
  if (rival) {
    out.push({
      thread: 'rival', threadRank: THREAD_RANK.rival!, priority: 95,
      from: rival.name, capExempt: true, tag: 'commit', refs: { players: [career.rivalId] },
      variants: [
        `heard about ${dest}. congrats i guess. see you in the bracket before you go`,
        `${dest}? interesting. i would have picked somewhere that actually runs offense`,
        `so it is ${dest}. good. now i know exactly where to find you for the next four years`,
        `everybody keeps sending me your ${dest} announcement. tell them to stop. anyway congrats or whatever`,
      ],
    });
  }

  const loser = losingFinalist(career, offer.programId);
  if (loser) {
    const surname = recruiterSurname(career, loser.program.id);
    const bitter = streamRng(career.seed, 'career-phone-close', loser.program.id).chance(0.5);
    out.push({
      thread: `recruiter:${loser.program.id}`,
      threadRank: 8 + loser.interestIdx,
      priority: 90,
      from: `Coach ${surname} (${loser.program.name})`,
      capExempt: true, tag: 'commit', refs: { programId: loser.program.id },
      variants: bitter
        ? [
          `Saw the news. Committing to ${dest} without a call, after everything this staff put in. Good luck`,
          `So the visit meant nothing. Noted. ${dest} had better be everything they promised`,
          `We held a scholarship for you while other kids begged for it. A text would have been decent. Anyway`,
        ]
        : [
          `Coach ${surname} here. You told us before the wire did, and that counts for something. ${dest} is getting a pro. Our door stays open`,
          `Classy of you to call the staff this morning. Go be great at ${dest}. If it ever stops fitting, you have my number`,
          `No hard feelings from this staff. We recruit kids and we root for the ones we lose. Beat everyone except us`,
        ],
    });
  }
}

/**
 * Draft night, read off the league's real transaction ledger the week
 * after the night resolves (the tick runs the draft after the phone's
 * weekly pass, so the burst lands with the morning-after texts). Four
 * voices: the agent's call naming the pick and the mock gap, mom's room,
 * the rival's pick against mine with his real numbers, and the wire
 * story with the birthplace arc. EXEMPT from caps (header rationale).
 * Undrafted careers get the agent's honest morning-after instead.
 */
function draftNightCandidates(career: CareerState, out: Candidate[]): void {
  const mine = draftTxOf(career, career.me);

  if (!mine) {
    // sixty names, none of them yours: the stock event is the receipt
    const passed = eventsWithinWeeks(career, 1).some(e =>
      e.kind === 'stock' && e.reason.startsWith('sixty names'));
    if (passed) {
      out.push({
        thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 90,
        from: 'Marta (agent)', capExempt: true, tag: 'undrafted',
        variants: [
          'Sixty names and not ours. I will not spin it. Summer league lists open this morning and I already made two calls. The route changes, the destination does not',
          'No call last night. I know what it cost to watch. Here is what is real: rooms passed on a name, not on a player. We go make the name undeniable',
          'Undrafted. The word stings until you count how many careers started there. Camp invites are the new draft and I am working the phones today',
        ],
      });
    }
    return;
  }

  const team = nbaTeamNameOf(career, mine.teamId);
  const pick = mine.pick;
  const mock = career.stock?.rank ?? null;
  const me = meOf(career);

  // the agent's call: the pick, the team, and the mock-vs-pick gap named
  let agentVariants: string[];
  if (mock === null) {
    agentVariants = [
      `${team}, pick ${pick}. The boards never printed a number for you and a war room just did. That is the only ladder that pays`,
      `No mock had you. ${team} called at ${pick} anyway. Scouts type, rooms decide. Congratulations`,
      `Pick ${pick}, ${team}. The consensus never saw you coming, which makes this my favorite kind of phone call`,
      `${team} at ${pick} and not one board saw it. Enjoy tonight. Tomorrow we are nobody's surprise ever again`,
    ];
  } else if (pick < mock) {
    agentVariants = [
      `${team}, pick ${pick}. Boards had you ${mock}; the room that mattered did not. This is the call I do this job for`,
      `They called at ${pick}. ${team}. The boards said ${mock} this morning and the boards are now recycling. Congratulations, kid`,
      `Pick ${pick} to ${team}. We beat the consensus by ${mock - pick} spots. Sleep tonight, work tomorrow`,
      `Boards ${mock}, reality ${pick}. ${team} paid for the file, not the chatter. This is a good night. Let it be one`,
    ];
  } else if (pick > mock) {
    agentVariants = [
      `${team} at ${pick}. Boards had you ${mock} and rooms got cute. Every one of those ${pick - mock} spots is money they owe you an apology for. We collect on the floor`,
      `You slid to ${pick}. I will not dress it up. ${team} still called, and everybody who passed now schedules you twice a year`,
      `${pick}, ${team}. The boards said ${mock}. The gap is fuel and the rookie scale at ${pick} is a bet on yourself. We like that bet`,
      `Green room got long, I know. ${mock} on the boards, ${pick} on the night. ${team} gets the chip AND the shoulder. Their gain`,
    ];
  } else {
    agentVariants = [
      `${team} at ${pick}, right on the number. The market read you clean for once. Now we outplay the slot anyway`,
      `Pick ${pick}, exactly where the boards had you. ${team}. Boring draft nights make the best careers`,
      `${mock} on the boards, ${pick} on the night. ${team}. The market and the room agreed on you, which almost never happens`,
      `Right on the consensus: ${pick}, ${team}. No drama, all business. My favorite kind of night in this job`,
    ];
  }
  out.push({
    thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 100,
    from: 'Marta (agent)', capExempt: true, tag: 'draftnight',
    refs: { teamId: mine.teamId },
    variants: agentVariants,
  });

  // mom: the room
  out.push({
    thread: 'family', threadRank: THREAD_RANK.family!, priority: 99,
    from: 'Mom', capExempt: true, tag: 'draftnight', refs: { teamId: mine.teamId },
    variants: [
      `The whole room screamed when they said your name. Your uncle knocked over the dip. ${team}. My baby`,
      `I have watched you dribble in the hallway since you were six and tonight a man in a suit said your name on television. ${team}. Pick ${pick}`,
      `Grandma made them replay it four times. Pick ${pick}. I kept the napkin I cried into and that is normal now`,
      `${team}. I do not even know where that is on a map yet, but I know they just got the hardest worker I ever raised`,
      `Everybody is still here eating and yelling. You should hear this house. Pick ${pick}, baby. PICK ${pick}`,
    ],
  });

  // the rival: his pick against mine, real numbers when he has them
  const rival = career.players[career.rivalId] ?? career.league.players[career.rivalId];
  if (rival) {
    const his = draftTxOf(career, career.rivalId);
    let rivalVariants: string[];
    if (his && his.pick < pick) {
      rivalVariants = [
        `${his.pick}. you went ${pick}. i will save you a seat in the lottery suite next time`,
        `they called my name ${pick - his.pick} picks before yours. fifteen years of this and the scoreboard still likes me`,
        `${his.pick} and ${pick}. the draft finally put it in writing. see you on somebody's opening night`,
      ];
    } else if (his) {
      rivalVariants = [
        `fine. ${pick} beats ${his.pick}. enjoy the one night the numbers went your way`,
        `${his.pick} to your ${pick}. whatever. careers are long and i hold grudges professionally`,
        `you went ${pick}, i went ${his.pick}. rooms overthink. floors do not. see you in the league`,
      ];
    } else {
      rivalVariants = [
        `sixty picks and none for me. do not text back. i will see you in summer league and it will be personal`,
        `they passed on me sixty times and called you at ${pick}. congrats, genuinely. now watch what a chip does`,
        `no name for me last night. yours went at ${pick}. keep the jersey clean until i get there`,
      ];
    }
    out.push({
      thread: 'rival', threadRank: THREAD_RANK.rival!, priority: 96,
      from: rival.name, capExempt: true, tag: 'draftnight',
      refs: { players: [career.rivalId] },
      variants: rivalVariants,
    });
  }

  // the wire story: pick, team, the one-line arc from the birthplace
  const home = career.creation.birthplace;
  out.push({
    thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 100,
    from: WIRE_BYLINE, capExempt: true, tag: 'draftnight', refs: { teamId: mine.teamId },
    variants: [
      `From ${home} to pick ${pick}: the ${team} select ${me.name}. The building believed before the boards did`,
      `The ${team} take ${me.name} at pick ${pick}. In ${home} they are honking horns tonight`,
      `Pick ${pick}: ${me.name}, ${team}. Some numbers are just numbers. In ${home}, this one is a street party`,
      `${me.name} to the ${team} at pick ${pick}. The scouts called it a projection. ${home} called it Tuesday`,
    ],
  });
}

/**
 * The NBA debut, mom's side (the coach text builds in coachCandidates,
 * the mentor welcome in mentorCandidates; they share the 'debut' tag and
 * the same detection, so the whole beat lands in one week). EXEMPT from
 * caps: the debut usually shares a career year with a full pre-NBA
 * season that already spent the family budget.
 */
function debutCandidates(career: CareerState, out: Candidate[]): void {
  const debut = debutThisWeek(career);
  if (!debut) return;
  const pts = debut.line.pts;
  out.push({
    thread: 'family', threadRank: THREAD_RANK.family!, priority: 95,
    from: 'Mom', capExempt: true, tag: 'debut', refs: { gameId: debut.record.id },
    variants: [
      `Your first real one. ${pts} points in an NBA building. I wore the jersey to work and dared anybody to say something`,
      `I watched the whole thing standing up. ${pts} in your first NBA game. Every hallway dribble was worth it`,
      `${pts} points, baby. First one. I recorded it and I am never deleting it. The cable box dies with that game on it`,
      `First NBA game. ${pts}. Your grandmother lit a candle and then talked trash, in that order`,
      `An NBA box score with your name in it. ${pts} points. I printed it. Paper lasts, baby`,
    ],
  });
}

/** Recruiters: one thread per program, each beat driven by the interest ladder's actual rung move this week. Formal on paper, warmer by text, exactly like the real arc. */
function recruiterCandidates(career: CareerState, out: Candidate[]): void {
  const rec = career.recruiting;
  if (!rec) return;
  // GHOST GUARD (header rule 6): recruiting is a high-school courtship.
  // Outside the HS phase, or after the commitment, the staffs are done
  // writing: the per-year season caps reset every January, and a stale
  // lastMoveWeek can collide with a live clock.week years later (the
  // measured bug: an NBA franchise player getting college mail in 2029).
  // The one post-commitment recruiter message is the finalist's door
  // close, built in commitmentCandidates.
  if (career.clock.phase !== 'hs' || rec.committedTo) return;
  rec.interest.forEach((interest, i) => {
    if (interest.closed || interest.lastMoveWeek !== career.clock.week) return;
    const program = rec.programs.find(p => p.id === interest.programId);
    if (!program) return;
    // corroboration: the rung move must have logged its positive
    // recruiting event THIS week (events carry (year, week), so this is
    // the year-aware check the bare lastMoveWeek comparison cannot be).
    // recruiting.ts opens every up-move reason with the program's name.
    const movedThisWeek = eventsThisWeek(career).some(e =>
      e.kind === 'recruiting' && (e.delta ?? 0) > 0 && e.reason.startsWith(program.name));
    if (!movedThisWeek) return;
    // recruiting.ts stamps lastMoveWeek on COOLING drops too, and it logs
    // every drop as a negative-delta recruiting event opening with the
    // program's name. A staff that just cooled does not text you about
    // it: the drop's story lives in the event log, the phone stays quiet.
    const cooled = eventsThisWeek(career).some(e =>
      e.kind === 'recruiting' && (e.delta ?? 0) < 0 && e.reason.startsWith(program.name));
    if (cooled) return;
    const thread: ThreadId = `recruiter:${program.id}`;
    const threadRank = 8 + i;
    const surname = recruiterSurname(career, program.id);
    const refs: PhoneMessage['refs'] = { programId: program.id };

    // the questionnaire rung stays OFF the phone by design: the doc's
    // recruiter thread starts at letters ("letters that become texts
    // that become home visits that become offers"), and a fourteen-
    // program questionnaire wave in one week is the repeated-generic-
    // event killer in person. The event log already tells that story.
    if (interest.rung === 'letter') {
      // quote the most recent real film they could have pulled
      const played = weekRecordsAllSeason(career).filter(r => r.myLine && r.myLine.min > 0);
      const last = played[played.length - 1];
      const variants = last
        ? (() => {
          const oppId = last.myLine!.teamId === last.record.home ? last.record.away : last.record.home;
          const opp = teamNameOf(career, oppId);
          const pts = last.myLine!.pts;
          return [
            `Coach ${surname} watched the ${opp} tape twice. ${pts} points travels. He wants to see it in person this spring`,
            `From the desk of Coach ${surname}: the staff graded your ${opp} game. The ${pts} was not the part that impressed them, but it did not hurt`,
            `${program.name} put a letter in the mail the morning after ${opp}. ${pts} points will do that. The film room found you`,
          ];
        })()
        : [
          `A letter from ${program.name}. Coach ${surname} writes that the staff has opened a file and intends to keep it open`,
          `${program.name} sent a real letter, signed by Coach ${surname} himself. Short, formal, pointed: they are watching now`,
        ];
      out.push({ thread, threadRank, priority: 50, from: `${program.name} Basketball`, variants, refs });
    } else if (interest.rung === 'texts') {
      out.push({
        thread, threadRank, priority: 60, from: `Coach ${surname} (${program.name})`,
        variants: [
          `This is Coach ${surname} at ${program.name}. I would rather talk in your living room than in another letter. When can we come by?`,
          `Coach ${surname} here. Staff meeting ran long because of your tape. I want to sit down with your family. Can we set a date?`,
          `You have my number now. Coach ${surname}, ${program.name}. One home visit, no promises we cannot keep. Say the word`,
        ],
        choices: [
          { id: 'visit-yes', label: 'Set up the visit' },
          { id: 'visit-no', label: 'Not yet' },
        ],
        deadlineWeek: career.clock.week + career.params.phone.decisionDeadlineWeeks,
        refs,
      });
    } else if (interest.rung === 'visit') {
      out.push({
        thread, threadRank, priority: 55, from: `Coach ${surname} (${program.name})`,
        variants: [
          `Coach ${surname} sat in your kitchen for two hours and mostly talked to your mother. That is how the good ones close`,
          `The ${program.name} visit is done. He left a playbook page with your name already written on it. Subtle it was not`,
        ],
        refs,
      });
    } else if (interest.rung === 'offer') {
      const offer = rec.offers.find(o => o.programId === program.id);
      const money = fmtMoney(offer?.money ?? program.nil);
      const role = ROLE_LABEL[offer?.promisedRole ?? program.promisedRole];
      out.push({
        thread, threadRank, priority: 70, from: `Coach ${surname} (${program.name})`,
        variants: [
          `It is official: ${program.name} is offering. A ${role} role and ${money} behind it. Coach ${surname} said the word that matters: committable`,
          `Coach ${surname} called it in himself. Committable offer from ${program.name}: ${role} minutes promised, ${money} on the table`,
          `${program.name}. Committable. ${role} role, ${money}. Hats get bought for mornings like this`,
        ],
        refs,
      });
    }
  });
}

/**
 * My played games this season, in date order, for the recruiter letter's
 * film quote (a letter can reference any tape from the season, not just
 * this week's).
 */
function weekRecordsAllSeason(career: CareerState): WeekRecord[] {
  const out: WeekRecord[] = [];
  if (!career.circuit) return out;
  for (const record of Object.values(career.circuit.results)) {
    const myLine = record.lines.find(l => l.playerId === career.me) ?? null;
    if (myLine) out.push({ record, myLine, rivalLine: null });
  }
  out.sort((a, b) => a.record.date.day - b.record.date.day
    || (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// generatePhone

/**
 * Generate this week's messages from state deltas. Called once per career
 * week by week.ts AFTER games are graded and the systems have pulsed, so
 * everything below reads settled state. Returns messages; the caller owns
 * pushing them into career.phone (and dedupes on id).
 *
 * Admission: candidates build in a fixed order, sort by (thread rank,
 * priority), then pass, per candidate: the burst guard (one message per
 * thread per week), the sender guard (one message per SENDER per week,
 * across threads), the once-ever tag, and, unless the candidate is one
 * of the cap-exempt payoff moments, the cooldown and the season cap.
 * One rng int draw per ADMITTED message keeps the stream a pure function
 * of state, which is what makes two identical careers read identically;
 * the anti-repeat filter narrows the pool from career.phone, which is
 * state too.
 */
export function generatePhone(career: CareerState): PhoneMessage[] {
  const { year, week } = career.clock;
  const caps = career.params.phone.capsPerSeason;
  const cooldown = career.params.phone.threadCooldownWeeks;

  const candidates: Candidate[] = [];
  coachCandidates(career, candidates);
  agentCandidates(career, candidates);
  promiseCandidates(career, candidates);
  familyCandidates(career, candidates);
  rivalCandidates(career, candidates);
  mediaCandidates(career, candidates);
  teammateCandidates(career, candidates);
  mentorCandidates(career, candidates);
  wireCandidates(career, candidates);
  recruiterCandidates(career, candidates);
  commitmentCandidates(career, candidates);
  draftNightCandidates(career, candidates);
  debutCandidates(career, candidates);
  if (candidates.length === 0) return []; // silence is content

  // stable admission order: thread rank, then priority, then build order
  const indexed = candidates.map((c, i) => ({ c, i }));
  indexed.sort((a, b) =>
    a.c.threadRank - b.c.threadRank || b.c.priority - a.c.priority || a.i - b.i);

  const capFor = (thread: ThreadId): number => {
    if (thread.startsWith('recruiter:')) return RECRUITER_CAP_PER_SEASON;
    if (thread === 'wire') return WIRE_CAP_PER_SEASON; // params.phone carries no wire key (module constant, header rule 2)
    const key = thread as keyof typeof caps;
    return caps[key] ?? 0; // a thread without a cap entry stays silent here
  };
  const seasonCount = (thread: ThreadId): number =>
    career.phone.filter(m => m.thread === thread && m.clock.year === year).length;
  const lastWeekOf = (thread: ThreadId): number | null => {
    let last: number | null = null;
    for (const m of career.phone) {
      if (m.thread !== thread || m.clock.year !== year) continue;
      if (last === null || m.clock.week > last) last = m.clock.week;
    }
    return last;
  };

  const rng = streamRng(career.seed, 'career-phone', year, week);
  const admittedPerThread: Record<string, number> = {};
  const recentByThread = new Map<ThreadId, Set<string>>();
  const seenFrom = new Set<string>();
  const messages: PhoneMessage[] = [];

  for (const { c } of indexed) {
    const already = admittedPerThread[c.thread] ?? 0;
    if (cooldown > 0 && already > 0) continue; // one message per thread per week under the burst guard
    if (seenFrom.has(c.from)) continue; // one sender, one message, one week (header rule 6)
    if (c.tag && alreadySent(career, c.tag)) continue; // once-ever beats never replay
    if (!c.capExempt) {
      const last = lastWeekOf(c.thread);
      if (cooldown > 0 && last !== null && week - last < cooldown) continue;
      if (seasonCount(c.thread) + already >= capFor(c.thread)) continue;
    }

    // anti-repeat: drop variants the thread sent inside the window; a
    // fully burned pool falls back to the whole pool (saying the thing
    // again beats silence on a real beat)
    let recent = recentByThread.get(c.thread);
    if (!recent) {
      recent = recentBodySet(career, c.thread);
      recentByThread.set(c.thread, recent);
    }
    let pool = c.variants.filter(v => !recent.has(v));
    if (pool.length === 0) pool = c.variants;

    const body = pool[rng.int(pool.length)]!;
    const msg: PhoneMessage = {
      id: `ph-${c.thread}-${c.tag ? `#${c.tag}#-` : ''}${year}w${week}-${already}`,
      clock: { ...career.clock },
      thread: c.thread,
      from: c.from,
      body,
    };
    if (c.choices) msg.choices = c.choices.map(ch => ({ ...ch }));
    if (c.deadlineWeek !== undefined) msg.deadlineWeek = c.deadlineWeek;
    if (c.refs) msg.refs = c.refs;
    admittedPerThread[c.thread] = already + 1;
    seenFrom.add(c.from);
    messages.push(msg);
  }
  return messages;
}

// ---------------------------------------------------------------------------
// applyPhoneChoice

/** Append one explained consequence of an answered message. */
function pushChoiceEvent(
  career: CareerState, messageId: string, seq: number,
  kind: CareerEvent['kind'], reason: string, delta?: number,
): void {
  career.events.push({
    id: `ev-phone-${messageId}-${seq}`,
    clock: { ...career.clock },
    kind,
    reason,
    ...(delta !== undefined ? { delta } : {}),
  });
}

/**
 * Apply an answered choice: validate, mutate the real state the choice
 * names, log every consequence with a reason, mark the message answered.
 * Never throws on a bad id: the phone is a UI surface and the polite
 * error is the contract ({ ok: false, errors }); nothing mutates on any
 * error path.
 */
export function applyPhoneChoice(career: CareerState, messageId: string, choiceId: string): { ok: boolean; errors: string[] } {
  const msg = career.phone.find(m => m.id === messageId);
  if (!msg) return { ok: false, errors: [`career/phone: no message '${messageId}'`] };
  if (!msg.choices || msg.choices.length === 0) {
    return { ok: false, errors: [`career/phone: message '${messageId}' carries no choices`] };
  }
  if (msg.chosen !== undefined) {
    return { ok: false, errors: [`career/phone: message '${messageId}' was already answered`] };
  }
  if (!msg.choices.some(c => c.id === choiceId)) {
    return { ok: false, errors: [`career/phone: message '${messageId}' has no choice '${choiceId}'`] };
  }
  if (msg.deadlineWeek !== undefined
    && (career.clock.year > msg.clock.year || career.clock.week > msg.deadlineWeek)) {
    return { ok: false, errors: [`career/phone: message '${messageId}' expired in week ${msg.deadlineWeek}`] };
  }

  const me = meOf(career);
  const moveMorale = (delta: number): void => {
    me.morale = clamp(me.morale + delta, 0, 100);
  };

  if (choiceId === 'visit-yes' || choiceId === 'visit-no') {
    const programId = msg.refs?.programId;
    const interest = programId
      ? career.recruiting?.interest.find(x => x.programId === programId)
      : undefined;
    const program: Program | undefined = programId
      ? career.recruiting?.programs.find(p => p.id === programId)
      : undefined;
    if (!interest || !program) {
      return { ok: false, errors: [`career/phone: message '${messageId}' names no live recruiting interest`] };
    }
    msg.chosen = choiceId;
    if (choiceId === 'visit-yes') {
      // the ladder only climbs from here: never demote a program that already sat in the living room or offered
      if (rungIdx(interest.rung) < rungIdx('visit')) {
        interest.rung = 'visit';
        interest.lastMoveWeek = career.clock.week;
      }
      interest.perceived = clamp(interest.perceived + VISIT_PERCEIVED_BUMP, 0, 100);
      pushChoiceEvent(career, messageId, 0, 'recruiting',
        `scheduled the ${program.name} in-home visit; the staff moved their number up`, VISIT_PERCEIVED_BUMP);
    } else {
      interest.perceived = clamp(interest.perceived - VISIT_DECLINE_COOL, 0, 100);
      pushChoiceEvent(career, messageId, 0, 'recruiting',
        `told ${program.name} not yet on the home visit; the staff cooled a step`, -VISIT_DECLINE_COOL);
    }
    return { ok: true, errors: [] };
  }

  if (choiceId === 'media-lean' || choiceId === 'media-team' || choiceId === 'media-shrug') {
    msg.chosen = choiceId;
    if (choiceId === 'media-lean') {
      moveMorale(MEDIA_MORALE.lean);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'owned the moment with the beat writer; it read confident in print', MEDIA_MORALE.lean);
    } else if (choiceId === 'media-team') {
      moveMorale(MEDIA_MORALE.team);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'pointed the story at the locker room; the room noticed', MEDIA_MORALE.team);
    } else {
      moveMorale(MEDIA_MORALE.shrug);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'no-commented the beat writer; the moment passed unclaimed', MEDIA_MORALE.shrug);
    }
    return { ok: true, errors: [] };
  }

  if (choiceId === 'reply-won' || choiceId === 'reply-lost' || choiceId === 'rival-mute') {
    msg.chosen = choiceId;
    if (choiceId === 'reply-won') {
      moveMorale(RIVAL_MORALE.replyWon);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'sent the rival the scoreboard; some texts write themselves', RIVAL_MORALE.replyWon);
    } else if (choiceId === 'reply-lost') {
      moveMorale(RIVAL_MORALE.replyLost);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'talked back after the loss; he had the box score and used it', RIVAL_MORALE.replyLost);
    } else {
      moveMorale(RIVAL_MORALE.mute);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'left the rival on read; nothing good lives in that thread', RIVAL_MORALE.mute);
    }
    return { ok: true, errors: [] };
  }

  if (choiceId === 'family-go' || choiceId === 'family-stay') {
    msg.chosen = choiceId;
    if (choiceId === 'family-go') {
      moveMorale(FAMILY_GO_MORALE);
      career.energy = clamp(career.energy + FAMILY_GO_ENERGY, 0, 100);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'went home Sunday; the table did what the gym cannot', FAMILY_GO_MORALE);
      pushChoiceEvent(career, messageId, 1, 'energy',
        'the trip home and back cost some rest', FAMILY_GO_ENERGY);
    } else {
      moveMorale(FAMILY_STAY_MORALE);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'told the family not this week; the quiet after the call stuck around', FAMILY_STAY_MORALE);
    }
    return { ok: true, errors: [] };
  }

  // the promise grievance: every effect lands in state consumers that
  // exist today (morale is read by the game-night projection; coach.trust
  // feeds planFor and the green light) and every effect is explained.
  // Widening the plan directly would need approach.ts's cooperation, so
  // the pressure routes through trust (the seam is noted in the module
  // report; nothing here fakes a mechanism that does not exist).
  if (choiceId === 'promise-let-go' || choiceId === 'promise-make-known' || choiceId === 'promise-demand') {
    msg.chosen = choiceId;
    if (choiceId === 'promise-let-go') {
      moveMorale(PROMISE_LET_GO_MORALE);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'let the broken role promise go; the work will do the talking', PROMISE_LET_GO_MORALE);
    } else if (choiceId === 'promise-make-known') {
      career.coach.trust = clamp(Math.round((career.coach.trust - PROMISE_KNOWN_TRUST_COST) * 10) / 10, 5, 99);
      pushChoiceEvent(career, messageId, 0, 'trust',
        'the agent made the broken role promise known; the staff heard it and did not love the messenger', -PROMISE_KNOWN_TRUST_COST);
      moveMorale(PROMISE_KNOWN_MORALE);
      pushChoiceEvent(career, messageId, 1, 'morale',
        'stopped swallowing the broken promise; saying it out loud sat better', PROMISE_KNOWN_MORALE);
    } else {
      pushChoiceEvent(career, messageId, 0, 'contract',
        'demanded the promised role on the record; the file now says what was said in the living room');
      moveMorale(PROMISE_DEMAND_MORALE);
      pushChoiceEvent(career, messageId, 1, 'morale',
        'drew the line under the promise; self-respect is a stat too', PROMISE_DEMAND_MORALE);
    }
    return { ok: true, errors: [] };
  }

  // a choice id this module never generated: refuse rather than guess
  return { ok: false, errors: [`career/phone: unhandled choice '${choiceId}' on message '${messageId}'`] };
}
