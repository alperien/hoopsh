/**
 * phone-shared.ts - the phone family's shared vocabulary: message-texture
 * constants, the state-reading lookups every thread leans on, and the
 * Candidate contract between the per-thread builders and generatePhone's
 * admission pass. The discipline rules, the rng-stream doctrine, and the
 * module map live in phone.ts.
 */
import { streamRng } from '@hoopsh/franchise';
import type { FrPlayer, GameLine, GameRecord } from '@hoopsh/franchise';
import type {
  CareerEvent, CareerState, GameGrade, InterestRung, PhoneChoice, PhoneMessage,
  RoleId, ThreadId,
} from './types.js';

// ---------------------------------------------------------------------------
// module constants (message texture; the sweepable frequency levers live in
// params.phone)

/** FEEL: per-program season cap. The whole recruiting arc is questionnaire, letter, texts, visit, offer: five beats plus one nudge of slack. The frozen params shape carries no recruiter key, so the cap lives here. */
export const RECRUITER_CAP_PER_SEASON = 6;

/** FEEL: wire stories per season. The desk covers milestones, honors, and draft night; ten a season reads like a beat, not a feed. params.phone.capsPerSeason is another task's shape this wave, so the wire cap lives here beside the recruiter cap. */
export const WIRE_CAP_PER_SEASON = 10;

/** FEEL: anti-repeat window in weeks. A thread never sends a byte-identical body twice inside this window (the measured defect: mom repeated one template four straight weeks). Derived from career.phone, no new state. */
const ANTIREPEAT_WEEKS = 8;

/** REAL-ish: the banner number. Career points cross a 1,000 step and the gym hangs a sign; the wire files the story. */
export const MILESTONE_STEP = 1000;

/** The wire's one fixed byline (fictional universe, fictional desk). Picked once and kept so the career reads like one reporter followed it. */
export const WIRE_BYLINE = 'K. Osei, The Ledger';

/** FEEL: the line that makes a beat writer drive over (mirrors stock.ts SHOCK_GAME_PTS: the 30-point game is the doc's own named shock). */
export const MEDIA_GAME_PTS = 30;

/** FEEL: final margin that earns the blowout question. */
export const MEDIA_BLOWOUT_MARGIN = 20;

/** FEEL: consecutive team wins before the streak question. */
export const MEDIA_STREAK_GAMES = 4;

/** FEEL: the slump question mirrors recruiting.ts's cold-stretch rule: last three games 25%+ under the season scoring average. */
export const SLUMP_WINDOW_GAMES = 3;
export const SLUMP_RATIO = 0.75;
/** FEEL: no slump questions off a three-game season; the average has to mean something first. */
export const SLUMP_MIN_GAMES = 5;

/** FEEL: the rival line that earns an unprompted needle from another gym. */
export const RIVAL_STATEMENT_PTS = 28;

/** FEEL: mock-ladder moves smaller than this stay between the agent and his coffee; the thread only carries moves worth a phone buzz. */
export const AGENT_MOVE_MIN = 3;

/** FEEL: adherence under this reads as a night meaningfully off the plan (trust.ts scales deviation so ~20 points of dial overflow lands here). */
export const OFF_SCRIPT_ADHERENCE = 60;

/** FEEL: a mentor is the oldest teammate at or past this age; younger rooms have no mentor and the thread stays silent. */
export const MENTOR_MIN_AGE = 30;

/** FEEL: perceived-interest points a scheduled in-home visit buys (the staff sees the family, the family sees the staff). */
export const VISIT_PERCEIVED_BUMP = 3;

/** FEEL: perceived-interest points a polite no costs (coaches remember). */
export const VISIT_DECLINE_COOL = 2;

/** FEEL: morale swing for owning the media moment / crediting the room / no-commenting it away. */
export const MEDIA_MORALE = { lean: 3, team: 1, shrug: -1 } as const;

/** FEEL: morale stakes of the rival thread: flexing a win feels great, talking back after a loss hands him receipts, leaving him on read is quiet discipline either way. */
export const RIVAL_MORALE = { replyWon: 3, replyLost: -2, mute: 1 } as const;

/** FEEL: the family ask. Going home restores the person and costs some rest; saying no sits wrong for a few days. */
export const FAMILY_GO_MORALE = 4;
export const FAMILY_GO_ENERGY = -8;
export const FAMILY_STAY_MORALE = -2;

/** FEEL: grievance answers. Letting it go settles the person; making it known costs a little standing with the staff and buys a little self-respect; the on-record demand is pure catharsis plus a paper trail (pre-NBA has no trade machinery to threaten with, so the event IS the effect). */
export const PROMISE_LET_GO_MORALE = 2;
export const PROMISE_KNOWN_TRUST_COST = 2;
export const PROMISE_KNOWN_MORALE = 1;
export const PROMISE_DEMAND_MORALE = 3;

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
export const ROLE_ORDER: readonly RoleId[] = [
  'garbage', 'bench', 'rotation', 'sixthMan', 'starter', 'featured', 'franchise',
];

/** Fixed admission order across threads: byte-stable output and draw order. Recruiter threads rank after the named eight, in interest-array order. */
export const THREAD_RANK: Record<string, number> = {
  coach: 0, agent: 1, family: 2, rival: 3, media: 4, teammate: 5, mentor: 6, wire: 7,
};

/** Human label per role for message copy ('sixthMan' reads wrong in a text). */
export const ROLE_LABEL: Record<RoleId, string> = {
  garbage: 'garbage-time', bench: 'bench', rotation: 'rotation',
  sixthMan: 'sixth man', starter: 'starter', featured: 'featured', franchise: 'franchise',
};

// ---------------------------------------------------------------------------
// shared lookups

/** Me, wherever I currently live (career.players pre-entry, league.players after). */
export function meOf(career: CareerState): FrPlayer {
  const me = career.players[career.me] ?? career.league.players[career.me];
  if (!me) throw new Error('career/phone: my player is missing from both pools');
  return me;
}

/** '180,000' without locale machinery (byte-stable across platforms). */
export function fmtNum(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** '$180,000'. */
export function fmtMoney(n: number): string {
  return `$${fmtNum(n)}`;
}

export function rungIdx(r: InterestRung): number {
  return RUNG_ORDER.indexOf(r);
}

export function roleIdx(r: RoleId): number {
  return ROLE_ORDER.indexOf(r);
}

/** One-decimal display for averages quoted in copy. */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Display name for a game participant's team, from the circuit first, the league second, the raw id as the honest last resort. */
export function teamNameOf(career: CareerState, teamId: string): string {
  const ct = career.circuit?.teams.find(t => t.id === teamId);
  if (ct) return ct.name;
  return career.league.teams[teamId]?.name ?? teamId;
}

/** 'New York Excelsiors': how a draft-night call names a franchise. */
export function nbaTeamNameOf(career: CareerState, teamId: string): string {
  const t = career.league.teams[teamId];
  return t ? `${t.city} ${t.name}` : teamId;
}

/** The stable, career-long surname of a program's recruiting coach. */
export function recruiterSurname(career: CareerState, programId: string): string {
  return streamRng(career.seed, 'career-phone-coach', programId).pick(RECRUITER_SURNAMES);
}

/** '58-52' with the winner first: how a final gets texted. */
export function fmtScore(final: [number, number]): string {
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
export function alreadySent(career: CareerState, tag: string): boolean {
  const needle = `#${tag}#`;
  return career.phone.some(m => m.id.includes(needle));
}

/** Bodies this thread sent inside the anti-repeat window (discipline rule 7). */
export function recentBodySet(career: CareerState, thread: ThreadId): Set<string> {
  const now = absWeekOf(career, career.clock);
  const out = new Set<string>();
  for (const m of career.phone) {
    if (m.thread !== thread) continue;
    if (now - absWeekOf(career, m.clock) < ANTIREPEAT_WEEKS) out.add(m.body);
  }
  return out;
}

export interface WeekRecord {
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
export function weekRecords(career: CareerState): WeekRecord[] {
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
export function eventsThisWeek(career: CareerState): CareerEvent[] {
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
export function eventsWithinWeeks(career: CareerState, back: number): CareerEvent[] {
  const now = absWeekOf(career, career.clock);
  return career.events.filter(e => {
    const at = absWeekOf(career, e.clock);
    return now - at >= 0 && now - at <= back;
  });
}

/** The record a grade points at, wherever it lives. */
export function recordForGrade(career: CareerState, grade: GameGrade): GameRecord | null {
  return career.circuit?.results[grade.gameId]
    ?? career.league.results[grade.gameId]
    ?? null;
}

/** Whether a record's date sits in the current career week (circuit weeks) or the current NBA-phase day window. */
export function recordIsThisWeek(career: CareerState, record: GameRecord): boolean {
  if (career.circuit?.results[record.id]) {
    return record.date.season === career.clock.year && record.date.day === career.clock.week;
  }
  if (career.clock.phase !== 'nba') return false;
  const windowStart = career.league.day - career.params.tick.leagueDaysPerWeek;
  return record.date.season === career.league.season
    && record.date.day > windowStart && record.date.day <= career.league.day;
}

// ---------------------------------------------------------------------------
// candidates: everything the week COULD say, before caps and cooldowns

export interface Candidate {
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
   * undrafted aftermath. Documented in phone.ts's header: a cap that mutes the
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
