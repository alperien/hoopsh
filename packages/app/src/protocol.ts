/**
 * protocol.ts — the frozen UI<->server contract (contracts wave,
 * docs/FRANCHISE.md §14). The server (server.ts) implements exactly these
 * routes; the browser UI (public/js/api.js) calls exactly these routes.
 * The UI is plain JS and cannot import this file: it follows the JSDoc
 * mirror in public/js/api.js, and THIS file is the source of truth.
 *
 * Conventions: JSON bodies both ways; errors are { error: string } with
 * 4xx/5xx; ids are franchise ids. Long operations (multi-day sim) run
 * server-side; the UI polls /api/sim/status.
 *
 * ROUTES (method path -> response):
 *   GET  /api/meta                 -> { saves: SaveSummary[]; version: number }
 *   POST /api/new                  -> body NewLeagueBody; { ok: true } (league becomes current)
 *   POST /api/load                 -> { name: string }; { ok: true }
 *   POST /api/save                 -> { name?: string }; { ok: true; name: string }
 *   GET  /api/summary              -> Summary (the office screen payload)
 *   GET  /api/team/:id             -> TeamView
 *   GET  /api/player/:id           -> PlayerView
 *   GET  /api/league/standings     -> { standings: TeamStanding[]; seeds: { East: string[]; West: string[] } }
 *   GET  /api/league/leaders?stat= -> { rows: LeaderRow[] } (per-game, qualified)
 *   GET  /api/league/stats?view=   -> { rows: object[] } (team/player tables, view = teams|players)
 *   GET  /api/league/transactions  -> { transactions: Transaction[] } (newest first, capped)
 *   GET  /api/news?page=&team=     -> { items: NewsItem[]; hasMore: boolean }
 *   GET  /api/inbox                -> { items: InboxItem[] }
 *   GET  /api/schedule/:teamId     -> { games: ScheduleRow[] }
 *   GET  /api/game/:id             -> GameView (box, key plays, recap news id)
 *   GET  /api/game/:id/broadcast   -> { cues: BroadcastCue[] } (narration package shape)
 *   GET  /api/game/:id/replay      -> replay JSON (engine buildReplay output) or 404
 *   GET  /api/draft/board          -> { prospects: ProspectRow[]; myPicks: DraftPick[]; order: string[] }
 *   GET  /api/fa/market            -> { players: FaRow[]; capContext: CapSheet }
 *   GET  /api/cap/:teamId          -> CapSheet
 *   GET  /api/almanac/:season?     -> SeasonArchive | { seasons: number[] } (no arg = index)
 *   GET  /api/records              -> { records: RecordBookEntry[] }
 *   POST /api/action               -> { action: UserAction }; ActionResult (validation errors inline)
 *   POST /api/trade/evaluate       -> { offer: TradeOffer }; TradeVerdict (no execution)
 *   POST /api/sim/advance          -> { days?: number; toDate?: LeagueDate; stopOnInbox?: boolean }; { started: true }
 *   GET  /api/sim/status           -> SimStatus (poll during advance)
 *   POST /api/sim/watch/:gameId    -> { ok: true } (mark today's user game for full-event watch mode)
 */
import type {
  CapSheet, DayDigest, DraftPick, GameLine, InboxItem, LeagueDate, NewsItem,
  Phase, ScoutReport, TeamStanding, TeamTotalsLite, Transaction,
} from '@hoopsh/franchise';

export interface SaveSummary { name: string; savedAtDay: LeagueDate; userTeam: string; seasonLabel: string; }

export interface NewLeagueBody { seed?: string; userTeam: string; name: string; startSeason?: number; }

/** The office screen: everything the day view needs in one call. */
export interface Summary {
  date: LeagueDate; dateLabel: string; phase: Phase;
  userTeam: string;
  record: { w: number; l: number; confSeed: number };
  todayGame: { gameId: string; opponent: string; home: boolean } | null;
  inboxOpen: number;
  headlines: NewsItem[];
  digest: DayDigest | null;
  simRunning: boolean;
}

export interface SimStatus {
  running: boolean;
  currentDay: LeagueDate;
  target: LeagueDate | null;
  daysDone: number;
  daysTotal: number;
  /** digests of days completed since the client's last poll cursor */
  digests: DayDigest[];
  stoppedFor: 'inbox' | 'target' | 'phase' | null;
}

export interface TeamView {
  team: object;              // FrTeam minus internals (scoutSeed)
  standings: TeamStanding;
  roster: PlayerRow[];
  cap: CapSheet;
  upcoming: ScheduleRow[];
  recent: ScheduleRow[];
}

export interface PlayerRow {
  id: string; name: string; pos: string; age: number;
  heightLabel: string; ovr: number;      // display grade (see ui: derived 5-tool summary)
  salary: number; years: number;
  status: string; injuryLabel: string | null;
  perGame: Record<string, number>;       // current-season per-game line
}

export interface PlayerView {
  player: object;            // FrPlayer minus hidden truth for non-user teams? v1: full for user, ranges for prospects
  report: ScoutReport | null;
  seasons: object[];         // career table rows
  gameLog: Array<{ gameId: string; date: LeagueDate; line: GameLine }>;
  news: NewsItem[];
}

export interface LeaderRow { playerId: string; name: string; teamId: string; value: number; gp: number; }

export interface ScheduleRow {
  gameId: string; date: LeagueDate; dateLabel: string;
  home: string; away: string;
  final: [number, number] | null; ot: number;
  userGame: boolean;
}

export interface GameView {
  gameId: string; date: LeagueDate; home: string; away: string;
  final: [number, number]; ot: number;
  lines: GameLine[]; totals: [TeamTotalsLite, TeamTotalsLite];
  keyPlays: object[];
  recap: NewsItem | null;
  hasReplay: boolean; hasBroadcast: boolean;
}

export interface ProspectRow {
  id: string; name: string; pos: string; age: number; heightLabel: string;
  origin: string;
  report: ScoutReport | null;   // null = unscouted beyond the combine floor
  projectedPick: string;        // 'lottery', 'late first', ...
}

export interface FaRow {
  id: string; name: string; pos: string; age: number; ovr: number;
  askYears: number; askSalary: number;   // agent's opening ask
  interest: 'high' | 'medium' | 'low';   // in the USER team, from fit/market
  rights: string | null;                 // 'RFA (CHA)' etc.
}

export type { Transaction, InboxItem, NewsItem, DraftPick };
