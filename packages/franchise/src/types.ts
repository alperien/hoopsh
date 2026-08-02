/**
 * @hoopsh/franchise — the domain model. This file is the contract every
 * franchise module builds against; it was written and frozen before the
 * build waves (docs/FRANCHISE.md §14) so that parallel implementers share
 * one vocabulary. Changing a shape here mid-wave is a stop-and-escalate,
 * not an edit.
 *
 * Design laws inherited from the repo (AGENTS.md):
 * - Determinism: a league is a pure function of (leagueSeed, action log).
 *   No Math.random, no Date, no wall-clock anywhere in @hoopsh/franchise.
 * - Zero I/O: this package is browser-safe. Persistence, workers, and the
 *   clock live in @hoopsh/app.
 * - Money is integer dollars. Rounding rules live where the math lives.
 * - The engine is consumed through its public API only. Engine `Player`
 *   objects are PROJECTIONS of `FrPlayer` built per game (gameday.ts);
 *   nothing engine-side is stored.
 */

import type {
  Attributes, Tendencies, Position, RulePack, Team, GameEvent,
} from '@hoopsh/engine';

// ---------------------------------------------------------------------------
// ids and time

/** Stable for a whole career: 'p' + zero-padded genesis/draft sequence. */
export type PlayerId = string;
/** Three-letter lowercase franchise id, e.g. 'cas'. Never reused. */
export type TeamId = string;
/** 's<season>-d<day>-<away>@<home>' — readable, sortable, unique. */
export type GameId = string;
/** '<season>-r<round>-<originalTeam>', e.g. '2029-r1-cas'. */
export type PickId = string;
export type CoachId = string;
export type ContractId = string;
export type NewsId = string;
export type SeriesId = string;

/**
 * A season is named by its starting calendar year (2026 = the 2026-27
 * season). Player age is `season - bornSeason`: age at season start, held
 * for the whole season. Birthdays inside a season are not modeled
 * (register F11, docs/FRANCHISE.md §13).
 */
export type Season = number;

/** A point on the league calendar. `day` indexes the season's CalendarDay array. */
export interface LeagueDate {
  season: Season;
  day: number;
}

export type Phase =
  | 'offseason'    // post-finals dead period, before the draft
  | 'draft'        // lottery already resolved; draft night(s)
  | 'moratorium'   // free agency opens, deals agreed but not signable
  | 'freeAgency'   // signings legal; market clears over weeks
  | 'camp'         // training camp + preseason
  | 'regular'      // 82 games; allStar break and trade deadline are days inside it
  | 'playin'       // seeds 7-10 mini-tournament
  | 'playoffs'     // four best-of-7 rounds
  | 'lottery';     // between finals and draft; the odds ceremony

/** One day on the calendar, generated deterministically at season start. */
export interface CalendarDay {
  day: number;
  phase: Phase;
  /** display label like 'Mon, Oct 26'. Fictional years share real month shapes. */
  label: string;
  /** flags for special days; empty most days */
  marks: Array<'seasonOpener' | 'allStar' | 'tradeDeadline' | 'lotteryNight'
    | 'draftNight' | 'moratoriumEnds' | 'finalsStart' | 'lastRegularDay'>;
}

// ---------------------------------------------------------------------------
// people

/** Hidden per-group ceilings (0-100). Development pulls dials toward these. */
export interface PotentialProfile {
  phys: number;       // speed, accel, strength, vertical, lateral, stamina
  scoring: number;    // finishing, midRange, three, freeThrow, drawFoul
  playmaking: number; // ballHandle, passAcc, passVision
  defense: number;    // perimeterD, interiorD, steal, block, contestSkill
  rebounding: number; // offReb, defReb, boxout
  mental: number;     // decisions, consistency
}

export type AttrGroup = keyof PotentialProfile;

/** Off-court personality. NEVER projected onto engine dials in v1 (register F1). */
export interface Disposition {
  /** wants stardom, usage, a max: drives extension demands and FA choices */
  ambition: number;
  /** discounts money/role to stay put; low loyalty shops every summer */
  loyalty: number;
  /** locker-room reliability; low values raise trade-request volatility */
  professionalism: number;
  /** 0 = content anywhere, 100 = wants the biggest stage (market size weight in FA) */
  marketPref: number;
}

export type InjurySeverity = 'minor' | 'moderate' | 'major' | 'seasonEnding';

export interface Injury {
  /** catalog key from people/injury.ts, e.g. 'ankle-sprain' */
  kind: string;
  /** display name, e.g. 'sprained left ankle' */
  label: string;
  severity: InjurySeverity;
  /** the game it is attributed to (narratively; rolls are post-game, register F2) */
  gameId?: GameId;
  startedOn: LeagueDate;
  /** calendar days out at assignment */
  outDays: number;
  /** decremented by the day loop; 0 = cleared at next morning tick */
  remainingDays: number;
}

export interface Health {
  /** 0-100; sampled at generation, mostly stable */
  proneness: number;
  /** 0-100 accumulated career wear; raises hazard and accelerates aging */
  wear: number;
  injury: Injury | null;
  /** career log, newest last */
  history: Injury[];
}

/** Bird-rights tier a team holds on its own free agent. */
export type BirdTier = 'bird' | 'earlyBird' | 'nonBird';

export interface FreeAgentRights {
  teamId: TeamId;
  tier: BirdTier;
  /** integer dollars counted against the holding team's cap until renounced/signed */
  capHold: number;
  /** restricted FA only */
  qualifyingOffer?: number;
  restricted: boolean;
}

export interface ContractYear {
  season: Season;
  /** integer dollars */
  salary: number;
  /** guaranteed portion, integer dollars (== salary when fully guaranteed) */
  guaranteed: number;
  teamOption?: boolean;
  playerOption?: boolean;
}

export type ContractKind = 'standard' | 'rookieScale' | 'twoWay' | 'tenDay' | 'restOfSeason';

/** How the deal fit under the cap; determines legality checks and Bird continuity. */
export type SigningMeans =
  | 'capSpace' | 'bird' | 'earlyBird' | 'nonBird' | 'mle' | 'taxMle' | 'room'
  | 'bae' | 'minimum' | 'rookieScale' | 'extension' | 'genesis';

export interface Contract {
  id: ContractId;
  playerId: PlayerId;
  teamId: TeamId;
  /** current + future seasons only; past years move to the player's ledger */
  years: ContractYear[];
  kind: ContractKind;
  means: SigningMeans;
  signedOn: LeagueDate;
  /** consecutive seasons with the team (incl. via trade) at signing, for Bird math */
  birdYearsAtSigning: number;
  /** recently-signed trade restriction, if any */
  tradeableFrom?: LeagueDate;
}

export type SeasonType = 'regular' | 'playoffs';

/** Career stat totals for one player-season-team stint. Integers except min/plusMinus. */
export interface PlayerSeasonRow {
  season: Season;
  teamId: TeamId;
  type: SeasonType;
  gp: number; gs: number;
  min: number;
  pts: number;
  fgm: number; fga: number;
  tpm: number; tpa: number;
  ftm: number; fta: number;
  orb: number; drb: number;
  ast: number; stl: number; blk: number; tov: number; pf: number;
  plusMinus: number;
}

export interface DevNote {
  date: LeagueDate;
  /** per-group deltas actually applied at this review */
  deltas: Partial<Record<AttrGroup, number>>;
  /** the stated reasons, for the player card ('earned 34 min/g', 'age 31 decline') */
  reasons: string[];
}

export type PlayerStatus = 'roster' | 'gleague' | 'freeAgent' | 'prospect' | 'retired' | 'draftEligible';

export interface DraftInfo {
  season: Season;
  round: 1 | 2 | 0; // 0 = undrafted
  pick: number;     // 0 when undrafted
  teamId: TeamId | null;
}

export interface FrPlayer {
  id: PlayerId;
  name: string;
  pos: Position;
  bornSeason: Season;
  birthplace: string;
  origin: 'college' | 'international' | 'prep';
  /** college name / club country, for the bio line */
  originDetail: string;
  heightIn: number;
  weightLb: number;
  wingspanIn: number;
  /** the truth the engine sees (after game-day projection) */
  attr: Attributes;
  tend: Tendencies;
  potential: PotentialProfile;
  /** 0-100; growth multiplier and decline softener */
  workEthic: number;
  disposition: Disposition;
  health: Health;
  /** off-court morale 0-100; drives requests/decisions only (register F1, amended F1-A) */
  morale: number;
  /**
   * Psyche state (people/psyche.ts, register F1-A): confidence 0-100 and
   * a lifestyle label. Absent until initPsyche lazily fills it (old
   * saves, fresh draftees); absent reads as neutral everywhere.
   */
  psyche?: {
    confidence: number;
    lifestyle: 'gymRat' | 'quietPro' | 'familyMan' | 'nightlife' | 'mediaDarling' | 'gamerHermit';
  };
  status: PlayerStatus;
  contract: Contract | null;
  /** set while a free agent; cleared on signing */
  rights: FreeAgentRights | null;
  draft: DraftInfo | null;
  seasons: PlayerSeasonRow[];
  awards: AwardRef[];
  devLog: DevNote[];
  /**
   * Archetype id the player was generated from (people/archetypes.ts
   * catalog). Optional: pre-wave saves lack it; readers go through
   * archetypeOf/archetypeLabelOf which handle the absence.
   */
  archetype?: string;
  /** deterministic seed for the procedural portrait */
  faceSeed: number;
  retiredSeason?: Season;
  /** two-way contract game counter for the current season */
  twoWayGamesUsed?: number;
}

// ---------------------------------------------------------------------------
// teams

export interface Coach {
  id: CoachId;
  name: string;
  /** engine tactics preferences projected into Team.tactics */
  pace: number;       // 0-100 (staged engine dial; stored anyway per ROSTERS.md)
  threeBias: number;  // 0-100
  helpAggr: number;   // 0-100
  /** development multiplier source, 0-100 */
  devQuality: number;
  /** how strictly the coach follows the GM's rotation: 0 = coach's own, 100 = exact */
  obedience: number;
  hiredOn: LeagueDate;
  contractSeasons: number;
}

export type Timeline = 'contend' | 'retool' | 'rebuild';

/** AI front-office persona; sampled at genesis, drifts only on GM change. */
export interface GmPersona {
  name: string;
  timeline: Timeline;
  /** 0-100: appetite for variance (blockbusters, boom picks) */
  risk: number;
  /** 0-100: hoards picks vs ships them */
  pickLove: number;
  /** 0-100: how hard they chase stars at the deadline */
  starChase: number;
  /** 0-100: patience before folding in negotiations */
  patience: number;
}

export interface Owner {
  name: string;
  /** 0-100 willingness to pay tax/aprons */
  taxAppetite: number;
  /** 0-100; low patience fires GMs/coaches fast */
  patience: number;
  /** what the owner demands this season; re-set each October */
  expectation: 'title' | 'contend' | 'playoffs' | 'playin' | 'develop' | 'rebuild';
}

export interface PickProtection {
  /** conveys only if the pick lands outside the top N of the draft order */
  topN: number;
  /** if unconveyed, rolls with the same protection through this season... */
  throughSeason: Season;
  /** ...then extinguishes (simplification; no swap rights in v1, register F12) */
}

export interface DraftPick {
  id: PickId;
  season: Season;
  round: 1 | 2;
  originalTeam: TeamId;
  owner: TeamId;
  protection?: PickProtection;
  /** set once the draft order is known / pick is used */
  resolvedNumber?: number;
}

export interface FrTeam {
  id: TeamId;
  city: string;
  name: string;
  abbrev: string; // 3 uppercase letters
  conference: 'East' | 'West';
  division: string;
  /** [primary, secondary] hex colors for scorebug/monogram */
  colors: [string, string];
  arena: string;
  founded: Season;
  owner: Owner;
  /** null = user-controlled */
  gm: GmPersona | null;
  coach: Coach;
  /** standard roster (max 15), ids into league.players */
  roster: PlayerId[];
  /** two-way slots (max 3) */
  twoWay: PlayerId[];
  /** user/AI-set depth+minutes policy; projected to engine rotationMinutes per game */
  rotation: RotationPolicy;
  picks: DraftPick[];
  /** consecutive tax seasons ended, for repeater status */
  taxSeasonsRecent: Season[];
  /** persistent per-team scouting error seed (their scouts are wrong differently) */
  scoutSeed: number;
  /**
   * Locker-room state (people/psyche.ts, register F1-A): chemistry 0-100,
   * bond ages in days, and the weekly-update stamp. Absent until
   * initPsyche runs; absent reads as neutral everywhere.
   */
  psyche?: {
    chemistry: number;
    tenureDays: Record<PlayerId, number>;
    updatedOn: LeagueDate | null;
  };
  strategy: {
    timeline: Timeline;
    /** ids the front office will not shop (AI teams; advisory for user team) */
    untouchables: PlayerId[];
  };
}

export interface RotationPolicy {
  /** exact target minutes per player id; missing id = coach decides */
  minutes: Record<PlayerId, number>;
  starters: PlayerId[];
  /** sit players whose fatigue is below this on the second night of a B2B */
  b2bRestBelow: number;
  /** DNP list (healthy scratches) */
  scratches: PlayerId[];
}

// ---------------------------------------------------------------------------
// season structures

export interface ScheduledGame {
  id: GameId;
  date: LeagueDate;
  type: 'preseason' | SeasonType | 'playin';
  home: TeamId;
  away: TeamId;
  seriesId?: SeriesId;
}

/** Compact team totals persisted per game (full events are not kept for every game). */
export interface TeamTotalsLite {
  pts: number; fgm: number; fga: number; tpm: number; tpa: number;
  ftm: number; fta: number; orb: number; drb: number; ast: number;
  stl: number; blk: number; tov: number; pf: number;
  pace: number; fastbreakPts: number;
  /** largest lead, for recap color */
  biggestLead: number;
}

export interface GameLine {
  playerId: PlayerId;
  teamId: TeamId;
  starter: boolean;
  min: number;
  pts: number; fgm: number; fga: number; tpm: number; tpa: number;
  ftm: number; fta: number; orb: number; drb: number; ast: number;
  stl: number; blk: number; tov: number; pf: number;
  plusMinus: number;
}

/** One moment worth retelling, extracted from events in the worker fold. */
export interface KeyPlay {
  /** game-clock context */
  period: number;
  clock: string; // 'Q4 2:31'
  score: [number, number];
  kind: 'run' | 'leadChange' | 'buzzer' | 'milestone' | 'bigShot' | 'swat' | 'takeover';
  text: string;
}

export interface GameRecord {
  id: GameId;
  date: LeagueDate;
  type: 'preseason' | SeasonType | 'playin';
  home: TeamId;
  away: TeamId;
  seed: string;
  final: [number, number]; // [home, away]
  /** overtime periods played (0 = regulation) */
  ot: number;
  lines: GameLine[];
  totals: [TeamTotalsLite, TeamTotalsLite];
  keyPlays: KeyPlay[];
  /** app-side replay JSON path for watched/featured games; absent otherwise */
  replayFile?: string;
  seriesId?: SeriesId;
  /** the crew that worked the game: id plus surname snapshot (officials.ts) */
  officials?: import('./officials.js').GameOfficials;
}

export interface TeamStanding {
  teamId: TeamId;
  w: number; l: number;
  homeW: number; homeL: number;
  awayW: number; awayL: number;
  confW: number; confL: number;
  divW: number; divL: number;
  ptsFor: number; ptsAgainst: number;
  streak: number; // +3 = won 3 straight, -2 = lost 2
  last10: Array<0 | 1>;
}

export interface PlayoffSeries {
  id: SeriesId;
  round: 1 | 2 | 3 | 4; // 4 = finals
  conference: 'East' | 'West' | 'Finals';
  /** better seed first; holds 2-2-1-1-1 home court */
  high: TeamId;
  low: TeamId;
  highSeed: number;
  lowSeed: number;
  wins: [number, number]; // [high, low]
  games: GameId[];
  winner?: TeamId;
}

export interface LotteryResult {
  season: Season;
  /** final draft order for round 1 (team ids, pick 1 first) */
  order: TeamId[];
  /** teams that jumped, for the story */
  movement: Array<{ teamId: TeamId; from: number; to: number }>;
}

// ---------------------------------------------------------------------------
// scouting

/** [low, high] bounds the user's scouts put on a 0-100 quantity. */
export type ScoutRange = [number, number];

export interface ScoutReport {
  playerId: PlayerId;
  /** per-group current-ability ranges */
  current: Record<AttrGroup, ScoutRange>;
  /** per-group ceiling ranges */
  ceiling: Record<AttrGroup, ScoutRange>;
  /** 0-100 how much scouting has been invested (drives range width) */
  coverage: number;
  role: string;        // 'movement shooter with a live handle'
  comparison: string;  // 'a sturdier Theo June'
  strengths: string[];
  flags: string[];
  updatedOn: LeagueDate;
}

// ---------------------------------------------------------------------------
// transactions, negotiation, news

export type Transaction =
  | { kind: 'trade'; date: LeagueDate; teams: [TeamId, TeamId];
      players: Array<{ playerId: PlayerId; from: TeamId; to: TeamId }>;
      picks: Array<{ pickId: PickId; from: TeamId; to: TeamId }>; }
  | { kind: 'signing'; date: LeagueDate; teamId: TeamId; playerId: PlayerId;
      contract: Contract; offerSheet?: boolean }
  | { kind: 'waive'; date: LeagueDate; teamId: TeamId; playerId: PlayerId; stretched: boolean }
  | { kind: 'claim'; date: LeagueDate; teamId: TeamId; playerId: PlayerId }
  | { kind: 'draftSelection'; date: LeagueDate; teamId: TeamId; playerId: PlayerId; round: 1 | 2; pick: number }
  | { kind: 'extension'; date: LeagueDate; teamId: TeamId; playerId: PlayerId; contract: Contract }
  | { kind: 'optionDecision'; date: LeagueDate; teamId: TeamId; playerId: PlayerId;
      option: 'team' | 'player'; exercised: boolean }
  | { kind: 'assignment'; date: LeagueDate; teamId: TeamId; playerId: PlayerId; to: 'gleague' | 'roster' }
  | { kind: 'coachChange'; date: LeagueDate; teamId: TeamId; coach: Coach; fired?: CoachId }
  | { kind: 'retirement'; date: LeagueDate; playerId: PlayerId }
  | { kind: 'matchDecision'; date: LeagueDate; teamId: TeamId; playerId: PlayerId; matched: boolean };

/** A concrete two-team offer, from the proposer's perspective. */
export interface TradeOffer {
  from: TeamId;
  to: TeamId;
  /** what `from` sends */
  give: { players: PlayerId[]; picks: PickId[] };
  /** what `from` receives */
  get: { players: PlayerId[]; picks: PickId[] };
}

export interface TradeVerdict {
  accept: boolean;
  /** deterministic explanation for the UI/news ('need the pick to move salary') */
  reasoning: string;
  /** present when the AI counters instead of accepting/walking */
  counter?: TradeOffer;
  /** true = do not re-approach for a while (cooldown recorded on negotiation state) */
  walkAway?: boolean;
}

/** Live negotiation memory; the rumor mill reads real entries only. */
export interface Negotiation {
  teams: [TeamId, TeamId];
  about: PlayerId[];
  lastOffer: TradeOffer;
  temperature: 'cold' | 'warm' | 'hot';
  rounds: number;
  lastDate: LeagueDate;
  cooldownUntil?: LeagueDate;
}

export type NewsType =
  | 'recap' | 'injury' | 'transactionWire' | 'rumor' | 'awardRace' | 'award'
  | 'milestone' | 'record' | 'draft' | 'lottery' | 'preview' | 'review'
  | 'firing' | 'hiring' | 'retirement' | 'standingsWatch' | 'streak' | 'feature';

export interface NewsItem {
  id: NewsId;
  date: LeagueDate;
  type: NewsType;
  headline: string;
  body: string;
  /** one of the fixed byline voices (media/news.ts) */
  byline: string;
  players: PlayerId[];
  teams: TeamId[];
  gameId?: GameId;
  /** 3 = front page, 2 = story, 1 = wire brief */
  weight: 1 | 2 | 3;
}

export interface AwardRef {
  season: Season;
  kind: AwardKind;
  /** e.g. 'MVP', 'All-League First Team', 'Player of the Week' */
  label: string;
}

export type AwardKind =
  | 'mvp' | 'dpoy' | 'roy' | 'smoy' | 'mip' | 'coy' | 'fmvp'
  | 'allLeague1' | 'allLeague2' | 'allLeague3'
  | 'allDefense1' | 'allDefense2' | 'allRookie'
  | 'allStar' | 'potw' | 'potm' | 'scoringTitle';

export interface AwardResult {
  season: Season;
  kind: AwardKind;
  winners: PlayerId[] | TeamId[];
  /** top of the ballot with vote shares, for the story */
  ballot: Array<{ id: PlayerId; share: number }>;
  /**
   * Printable winner names, parallel to winners. Baked by archiveSeason
   * (media/almanac.ts) so the archive is self-contained history, following the
   * records book's holderName pattern (issue #188). Absent on live-season
   * award rows and on archives written before the field existed: renderers
   * fall back to the raw id.
   */
  winnerNames?: string[];
}

// ---------------------------------------------------------------------------
// records & history

export interface RecordBookEntry {
  key: string;          // 'game-pts', 'season-tpm', 'career-ast', ...
  label: string;        // 'Most points, game'
  holderId: PlayerId | TeamId;
  holderName: string;
  value: number;
  season: Season;
  gameId?: GameId;
}

export interface SeasonArchive {
  season: Season;
  champion: TeamId;
  runnerUp: TeamId;
  finalStandings: TeamStanding[];
  awards: AwardResult[];
  playoffs: PlayoffSeries[];
  lottery: LotteryResult;
  /** league per-game averages, for drift monitoring and the almanac */
  leagueAverages: Record<string, number>;
  draftClass: Array<{ pick: number; round: 1 | 2; teamId: TeamId; playerId: PlayerId }>;
}

// ---------------------------------------------------------------------------
// user actions (the determinism spine: league = f(seed, action log))

export type UserAction =
  | { kind: 'setRotation'; rotation: RotationPolicy }
  | { kind: 'setTactics'; pace: number; threeBias: number; helpAggr: number }
  | { kind: 'proposeTrade'; offer: TradeOffer }
  | { kind: 'acceptCounter'; offer: TradeOffer }
  | { kind: 'signFreeAgent'; playerId: PlayerId; years: number; startSalary: number;
      means: SigningMeans; options?: { lastYearTeam?: boolean; lastYearPlayer?: boolean } }
  | { kind: 'offerSheet'; playerId: PlayerId; years: number; startSalary: number }
  | { kind: 'matchOfferSheet'; playerId: PlayerId; matched: boolean }
  | { kind: 'waive'; playerId: PlayerId; stretch: boolean }
  | { kind: 'claimWaiver'; playerId: PlayerId }
  | { kind: 'draftPick'; playerId: PlayerId }
  | { kind: 'exerciseOption'; playerId: PlayerId; exercised: boolean }
  | { kind: 'extend'; playerId: PlayerId; years: number; startSalary: number }
  | { kind: 'assign'; playerId: PlayerId; to: 'gleague' | 'roster' }
  | { kind: 'scout'; playerId: PlayerId; points: number }
  | { kind: 'hireCoach'; coachId: CoachId }
  | { kind: 'fireCoach' }
  | { kind: 'renounceRights'; playerId: PlayerId }
  | { kind: 'setStrategy'; timeline: Timeline; untouchables: PlayerId[] }
  | { kind: 'respondToRequest'; requestId: string; choice: string };

/** A logged action: what the user did, when, in order. Replayable. */
export interface LoggedAction {
  seq: number;
  date: LeagueDate;
  action: UserAction;
}

/** What one advanced day produced; the UI's daily digest. */
export interface DayDigest {
  date: LeagueDate;
  phase: Phase;
  /** games completed today */
  games: GameId[];
  /** transactions appended today (indexes into league.transactions) */
  transactionCount: number;
  /** news appended today */
  newsIds: NewsId[];
  /** inbox items added today */
  inboxIds: string[];
  /** set when the day crossed a phase boundary */
  phaseChangedTo?: Phase;
  /** set when a season rollover happened inside this advance */
  seasonRolledTo?: Season;
}

/** Inbox item: something that wants the user's attention today. */
export interface InboxItem {
  id: string;
  date: LeagueDate;
  kind: 'decision' | 'notice';
  title: string;
  body: string;
  /** present on decision items; choices map to respondToRequest actions */
  choices?: Array<{ id: string; label: string }>;
  /**
   * The live trade proposal this decision item answers, frozen at post
   * time (a copy, never a reference into league.negotiations: intervening
   * desk talks may move the stash, and a loaded save must answer exactly
   * like the live session that wrote it). 'accept' executes exactly this
   * offer (tick.ts respondToRequest); absent on notices and on decision
   * items whose choices are navigational.
   */
  offer?: TradeOffer;
  deadline?: LeagueDate;
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// league root

export interface League {
  /** determinism root; every RNG stream derives from this (rng.ts) */
  seed: string;
  /**
   * The live parameter set (params.ts). Serialized with the league so a
   * save keeps its calibration; modules read league.params, never
   * defaultFranchiseParams() directly (sweeps vary params per league).
   */
  params: import('./params.js').FranchiseParams;
  season: Season;
  /** genesis season (display: 'founded 2026') */
  startSeason: Season;
  day: number;
  phase: Phase;
  calendar: CalendarDay[];
  userTeam: TeamId;
  teams: Record<TeamId, FrTeam>;
  players: Record<PlayerId, FrPlayer>;
  /** current season's full slate, ordered by (day, id) */
  schedule: ScheduledGame[];
  /** results by game id (this season; archives hold the past) */
  results: Record<GameId, GameRecord>;
  standings: Record<TeamId, TeamStanding>;
  playoffs: PlayoffSeries[];
  playin: ScheduledGame[];
  lottery: LotteryResult | null;
  /** current draft class prospects (status 'draftEligible'), by id in players */
  draftClass: PlayerId[];
  /** user-team scouting reports by player id */
  scouting: Record<PlayerId, ScoutReport>;
  freeAgents: PlayerId[];
  /** pending offer sheets awaiting match decisions */
  offerSheets: Array<{ playerId: PlayerId; from: TeamId; contract: Contract; decideBy: LeagueDate }>;
  waiverWire: Array<{ playerId: PlayerId; clearsOn: LeagueDate }>;
  negotiations: Negotiation[];
  transactions: Transaction[];
  news: NewsItem[];
  inbox: InboxItem[];
  awards: AwardResult[];
  records: RecordBookEntry[];
  archives: SeasonArchive[];
  /** dead cap from stretched waivers, per team per season */
  deadMoney: Record<TeamId, Array<{ season: Season; amount: number; playerId: PlayerId }>>;
  /** cap/tax/apron lines by season (economy.ts grows them) */
  capLines: Record<Season, { cap: number; tax: number; apron1: number; apron2: number; minSalaryFloor: number }>;
  actionLog: LoggedAction[];
  /** monotonically increasing action sequence */
  actionSeq: number;
  /**
   * Player ids whose life decisions belong to a human career (the career
   * mode's seam): retirement hazard skips them, the AI option pass leaves
   * their player options alone, and the FA market never signs them to a
   * decision. Absent/empty on GM saves; purely additive.
   */
  careerControlled?: PlayerId[];
  /**
   * Referee crews (officials.ts). Generated once at genesis; absent on
   * saves from before the feature, and every officials read no-ops
   * cleanly then (results byte-identical to the pre-officials pipeline).
   */
  officials?: import('./officials.js').OfficialsState;
}

// ---------------------------------------------------------------------------
// game-day pipeline shapes (franchise plans; app executes)

/** Everything a worker needs to sim one game. Self-contained by design. */
export interface GameJob {
  index: number;
  gameId: GameId;
  seed: string;
  /** fully projected engine teams (injuries/fatigue/rotation/HCA already applied) */
  home: Team;
  away: Team;
  /** 'events' = return the full stream (user/featured games); 'fold' = fold in worker */
  detail: 'events' | 'fold';
  /**
   * Rule pack override for non-NBA circuits (the career mode's leagues).
   * Absent = the NBA pack, exactly the franchise's existing behavior.
   * Carried by the job so workers and folds stay self-contained.
   */
  rules?: RulePack;
  /**
   * Per-game SimParams override for simulateGame's public `params` input
   * (officiating tightness rides here; officials.ts officialsJobExtras).
   * Plain numbers only: jobs cross the worker boundary as JSON. Absent =
   * engine stock params, exactly the existing behavior.
   */
  params?: import('@hoopsh/engine').GameConfig['params'];
}

export interface GameJobResult {
  index: number;
  gameId: GameId;
  final: [number, number];
  ot: number;
  lines: GameLine[];
  totals: [TeamTotalsLite, TeamTotalsLite];
  keyPlays: KeyPlay[];
  /** present iff detail === 'events' */
  events?: GameEvent[];
}

/**
 * The execution seam between franchise (plans jobs) and app (owns workers).
 * Implementations must return results for every job, in any order; callers
 * re-sort by index. A sequential in-process implementation ships in
 * gameday.ts for tests and single-game days.
 */
export type SimulateJobs = (jobs: GameJob[]) => Promise<GameJobResult[]> | GameJobResult[];

// ---------------------------------------------------------------------------
// save file

// The load check is STRICT equality (app/saves.ts), so a bump refuses
// every existing save. Additive params keys are NOT a bump: they fill
// from defaults on load (withFranchiseParams in app/saves.ts - the #184
// wire dials landed this way). Bump only for structural breaks the
// loader cannot default.
export const SAVE_FORMAT_VERSION = 1;

export interface SaveFile {
  formatVersion: typeof SAVE_FORMAT_VERSION;
  /** app metadata; excluded from determinism hashes */
  meta: { name: string; hoopshCommit?: string; savedAtDay: LeagueDate };
  league: League;
}
