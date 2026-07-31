/**
 * @hoopsh/career - the domain model. This file is the contract every
 * career module builds against; frozen before the build waves
 * (docs/CAREER.md, Build plan). Changing a shape here mid-wave is a
 * stop-and-escalate, not an edit.
 *
 * Design laws inherited from the repo:
 * - Determinism: a career is a pure function of (seed, choice log). No
 *   Math.random, no Date, no wall clock anywhere in @hoopsh/career.
 * - Zero I/O: browser-safe. Persistence and workers live in @hoopsh/app.
 * - The world reacts and explains itself: every consequential delta lands
 *   in the event log with a stated reason (the lint gate reads it).
 * - The career player IS an FrPlayer. Pre-NBA he lives in career.players;
 *   at draft entry he is inserted into the League's draft class and every
 *   franchise system sees him natively.
 */

import type { RulePack } from '@hoopsh/engine';
import type {
  AttrGroup, FrPlayer, GameRecord, League, PlayerId, SimulateJobs, TeamId,
} from '@hoopsh/franchise';

// ---------------------------------------------------------------------------
// clock and phases

/**
 * Career phases in journey order. 'draftPrep' is the window between the
 * route's last game and draft night (combine, workouts, green room).
 */
export type CareerPhase =
  | 'hs' | 'college' | 'euro' | 'nbl'
  | 'draftPrep' | 'nba' | 'china' | 'retired';

/**
 * The career clock. Pre-NBA phases tick by week (year = the calendar year
 * of the season's opening fall, matching franchise Season numbering). In
 * the NBA phase the embedded league's (season, day) is the truth and week
 * derives for allocation cadence.
 */
export interface CareerClock {
  phase: CareerPhase;
  year: number;
  week: number;
}

// ---------------------------------------------------------------------------
// creation

export type BackgroundId = 'aau' | 'coachs-son' | 'playground' | 'late-bloomer' | 'academy';

export type SignatureId =
  | 'movement-shooter' | 'downhill' | 'point-forward' | 'rim-runner'
  | 'three-and-d' | 'post-hub' | 'glue';

export type PresetId = 'walkon' | 'fourstar' | 'phenom';

export interface CreationSpec {
  firstName: string;
  lastName: string;
  nationality: 'us' | 'intl';
  /** birthplace display ('Akron, Ohio' or 'Split, Croatia') */
  birthplace: string;
  pos: FrPlayer['pos'];
  heightIn: number;
  weightLb: number;
  wingspanIn?: number;
  background: BackgroundId;
  preset: PresetId;
  /** points allocated across the six groups; validated against the preset budget */
  budget: Record<AttrGroup, number>;
  signatures: [SignatureId, SignatureId];
}

// ---------------------------------------------------------------------------
// circuits (every league that is not the NBA)

export type CircuitKind = 'hs' | 'college' | 'euro' | 'nbl' | 'china';

export interface CircuitTeam {
  id: string;            // circuit-local ('hs-oakridge')
  name: string;          // 'Oak Ridge Central'
  abbrev: string;
  colors: [string, string];
  /** 0-100 program strength; drives roster generation and AI quality */
  quality: number;
  roster: PlayerId[];    // ids into career.players
  starters: PlayerId[];
}

export interface CircuitGame {
  id: string;            // 'c<year>-w<week>-<away>@<home>'
  week: number;
  homeIdx: number;       // index into circuit.teams
  awayIdx: number;
  type: 'regular' | 'confTourney' | 'bracket';
  /** bracket round label when type is bracket ('R16', 'QF', 'SF', 'F') */
  round?: string;
}

export interface CircuitStandingRow {
  teamIdx: number;
  w: number; l: number;
  pf: number; pa: number;
}

export interface Circuit {
  id: string;
  kind: CircuitKind;
  year: number;
  packId: PackId;
  teams: CircuitTeam[];
  myTeamIdx: number;
  schedule: CircuitGame[];
  /** results keyed by CircuitGame.id; GameRecord teamIds are circuit team ids */
  results: Record<string, GameRecord>;
  standings: CircuitStandingRow[];
  /** single-elimination state; empty until the bracket seeds */
  bracket: CircuitGame[];
  /** true when the season (incl. bracket exit) is over */
  complete: boolean;
}

/** Compact archive of a finished circuit season, for the career page. */
export interface CircuitSummary {
  year: number;
  kind: CircuitKind;
  teamName: string;
  w: number; l: number;
  myLine: { gp: number; min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tpm: number; fgPct: number };
  finish: string;        // 'lost state semifinal', 'national champion', '7th'
  honors: string[];      // 'conference MVP'
}

export type PackId = 'prep' | 'ncaa' | 'fiba' | 'nbl' | 'cba';

/** The rule packs circuits play under; literals live in packs.ts (data, not engine code). */
export type CareerPacks = Record<PackId, RulePack>;

// ---------------------------------------------------------------------------
// the week

export type WeekSlotId = 'practice' | 'extraWork' | 'film' | 'body' | 'rest' | 'life';

export interface WeekPlan {
  /** slots beyond mandatory practice; validated against params.week.slotCount */
  slots: WeekSlotId[];
  /** attribute-group focus consumed by extraWork slots */
  focus: AttrGroup;
}

export interface WeekDigest {
  clock: CareerClock;
  gamesPlayed: string[];       // circuit game ids or league GameIds
  messages: string[];          // phone message ids added
  events: string[];            // event-log ids added
  energy: number;
  stockMove?: { from: number | null; to: number | null; reason: string };
  phaseChangedTo?: CareerPhase;
}

// ---------------------------------------------------------------------------
// approach, trust, role

export type ApproachDial = 'assertiveness' | 'range' | 'motor' | 'defense' | 'playmaking';

/** 0-100 per dial; 50 = play your normal game. */
export type ApproachCard = Record<ApproachDial, number>;

export type ApproachRanges = Record<ApproachDial, [number, number]>;

export type RoleId = 'garbage' | 'bench' | 'rotation' | 'sixthMan' | 'starter' | 'featured' | 'franchise';

export type CoachPersonality = 'playersCoach' | 'disciplinarian' | 'systems' | 'ridesHotHand';

export interface GameGrade {
  gameId: string;
  /** 0-100: how faithfully the approach stayed inside the plan */
  adherence: number;
  /** 0-100: production for the role (role-relative, not raw) */
  production: number;
  trustDelta: number;
  /** the coach's stated reason; the explained-consequence lint reads it */
  note: string;
}

export interface CoachState {
  name: string;
  personality: CoachPersonality;
  /** 0-100 */
  trust: number;
  role: RoleId;
  /** allowed approach ranges, derived from role + personality + trust */
  plan: ApproachRanges;
  greenLight: boolean;
  grades: GameGrade[];
  /**
   * Reacting-world counters: consecutive games outproducing/underproducing
   * the role band. trust.ts MUST move the role when `above` reaches
   * params.trust.reactGames (the flagship acceptance gate).
   */
  roleClock: { above: number; below: number };
}

// ---------------------------------------------------------------------------
// phone

export type ThreadId =
  | 'coach' | 'agent' | 'teammate' | 'mentor' | 'rival' | 'family' | 'media' | 'wire'
  | `recruiter:${string}`;

export interface PhoneChoice {
  id: string;
  label: string;
}

export interface PhoneMessage {
  id: string;
  clock: CareerClock;
  thread: ThreadId;
  from: string;          // display name ('Coach Wexler', 'Marta (agent)')
  body: string;
  choices?: PhoneChoice[];
  /** set once the user answered (choice id); unanswered decisions block nothing unless deadlineWeek set */
  chosen?: string;
  deadlineWeek?: number;
  /** referenced entities for UI linking */
  refs?: { players?: PlayerId[]; gameId?: string; programId?: string; teamId?: TeamId };
}

// ---------------------------------------------------------------------------
// recruiting and offers

export interface Program {
  id: string;
  name: string;           // 'Carolina Baptist', 'Fort Duquesne'
  tier: 1 | 2 | 3;        // 1 = blue blood
  /** feeds the real dev system as coach devQuality */
  coachDev: number;
  style: { pace: number; threeBias: number };
  promisedRole: RoleId;
  nil: number;            // integer dollars per season
  region: string;
}

/** Interest ladder rungs, in order. */
export type InterestRung = 'none' | 'questionnaire' | 'letter' | 'texts' | 'visit' | 'offer';

export interface RecruitInterest {
  programId: string;
  rung: InterestRung;
  /** perceived value of me by this program's scouts (their fog) */
  perceived: number;
  /** week of the last rung move, for pacing */
  lastMoveWeek: number;
  /** offer pulled or class filled */
  closed: boolean;
  closedReason?: string;
}

export interface RouteOffer {
  id: string;
  kind: 'college' | 'euro' | 'nbl';
  programId?: string;     // college
  clubName?: string;      // euro/nbl
  /** salary (pro) or NIL (college), integer dollars per season */
  money: number;
  coachDev: number;
  promisedRole: RoleId;
  style: { pace: number; threeBias: number };
  expiresWeek: number;
}

export interface RecruitState {
  programs: Program[];
  interest: RecruitInterest[];
  offers: RouteOffer[];
  committedTo?: string;   // offer id
}

// ---------------------------------------------------------------------------
// draft stock

export interface StockEntry {
  week: number;
  year: number;
  /** projected pick 1..60, or null = undrafted territory */
  rank: number | null;
  reason: string;
}

export interface StockState {
  /** current projected pick; null before any coverage or off the board */
  rank: number | null;
  history: StockEntry[];
  /** per-NBA-team perceived value of me (their scouts' fog), recomputed weekly */
  perTeam: Record<TeamId, number>;
  combineDone: boolean;
  /** teams whose workout invites were accepted */
  workoutsDone: TeamId[];
  /** open invites awaiting a choice */
  workoutInvites: TeamId[];
}

// ---------------------------------------------------------------------------
// money and the record

export interface LedgerEntry {
  year: number;
  label: string;          // 'rookie scale year 2', 'NIL: Carolina Baptist', 'Shanghai contract'
  amount: number;         // integer dollars
}

export interface CareerEvent {
  id: string;
  clock: CareerClock;
  kind: 'trust' | 'role' | 'stock' | 'morale' | 'energy' | 'injury' | 'money'
    | 'dev' | 'recruiting' | 'contract' | 'phase' | 'honor' | 'transaction';
  /** human-stated cause; the explained-consequence lint fails on empty */
  reason: string;
  delta?: number;
}

export interface Epilogue {
  retiredYear: number;
  seasonsPlayed: number;
  careerEarnings: number;
  rings: number;
  honors: string[];
  hofYear?: number;
  hofInducted?: boolean;
  jerseyRetiredBy?: TeamId;
  storyId?: string;       // the wire's retirement story (news id in the league)
}

// ---------------------------------------------------------------------------
// choices (the determinism spine)

export type CareerChoice =
  | { kind: 'setWeekPlan'; plan: WeekPlan }
  | { kind: 'setApproach'; card: ApproachCard; playingHurt?: boolean }
  | { kind: 'respondPhone'; messageId: string; choiceId: string }
  | { kind: 'acceptOffer'; offerId: string }
  | { kind: 'commitCollege'; offerId: string }
  | { kind: 'declareDraft' }
  | { kind: 'returnToSchool' }
  | { kind: 'attendWorkout'; teamId: TeamId }
  | { kind: 'declineWorkout'; teamId: TeamId }
  | { kind: 'signAgent'; agentId: string }
  | { kind: 'contractDecision'; decisionId: string; choiceId: string }
  | { kind: 'requestTrade' }
  | { kind: 'withdrawTradeRequest' }
  | { kind: 'acceptNbaOffer'; offerId: string }
  | { kind: 'acceptAbroadOffer'; offerId: string }
  | { kind: 'retire' };

export interface LoggedChoice {
  seq: number;
  clock: CareerClock;
  choice: CareerChoice;
}

// ---------------------------------------------------------------------------
// the career root

export interface CareerState {
  /** determinism root; every stream derives from this under the 'career' namespace */
  seed: string;
  params: import('./params.js').CareerParams;
  clock: CareerClock;
  /** my player id (in career.players pre-NBA; in league.players after entry) */
  me: PlayerId;
  /** circuit population incl. me and the rival, pre-NBA */
  players: Record<PlayerId, FrPlayer>;
  rivalId: PlayerId;
  creation: CreationSpec;
  circuit: Circuit | null;
  circuitHistory: CircuitSummary[];
  /** 0-100; the week economy's currency */
  energy: number;
  weekPlan: WeekPlan;
  coach: CoachState;
  recruiting: RecruitState | null;
  stock: StockState | null;
  phone: PhoneMessage[];
  /** default card; nextApproach overrides for the next game only */
  approach: ApproachCard;
  nextApproach: (ApproachCard & { playingHurt?: boolean }) | null;
  ledger: LedgerEntry[];
  /**
   * The NBA world, alive from career start (personas scout you from day
   * one). Pre-entry it advances on the internal fast sim (register C11);
   * from your draft season it advances on the provided SimulateJobs.
   */
  league: League;
  /** the team I play for after entry */
  nbaTeam: TeamId | null;
  choiceLog: LoggedChoice[];
  choiceSeq: number;
  events: CareerEvent[];
  epilogue: Epilogue | null;
}

// ---------------------------------------------------------------------------
// tick surfaces (career plans; app executes sims)

export interface ChoiceResult {
  ok: boolean;
  errors: string[];
}

/** Re-exported seam so app code imports one package for career running. */
export type { SimulateJobs };

// ---------------------------------------------------------------------------
// save file

export const CAREER_SAVE_FORMAT_VERSION = 1;

export interface CareerSave {
  formatVersion: typeof CAREER_SAVE_FORMAT_VERSION;
  meta: { name: string; savedAt: CareerClock };
  career: CareerState;
}
