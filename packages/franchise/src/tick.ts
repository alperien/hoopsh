/**
 * tick.ts - the day loop: the only orchestrator of league time. OWNER:
 * spine task.
 *
 * Day order (docs/FRANCHISE.md §8), fixed here and nowhere else:
 *   morning        recoveries advance; expired offer sheets auto-resolve;
 *                  inbox items past their deadline retire (inbox.ts)
 *   AI block       timeline re-evaluation on season marks; trade pulse;
 *                  roster upkeep; the FA market in moratorium/freeAgency;
 *                  AI option/QO decisions on the option-deadline day
 *   games          planDayJobs -> SimulateJobs seam -> applyGameResults ->
 *                  post-game injury rolls
 *   league pulse   dispositions weekly; award races on cadence; the news
 *                  desk; recaps and record checks per finished game;
 *                  midseason development review at the all-star mark;
 *                  LAST, the GM desk surfaces what needs the user (#152)
 *   postseason     advancePostseason schedules the bracket's next games
 *   transitions    calendar marks and real outcomes move league.phase;
 *                  draft night can PAUSE the day on the user's pick; a
 *                  second desk pass prints the night's picks (#118)
 *   rollover       the last free-agency day closes the season; a second
 *                  desk pass prints the retirements it logs (#118)
 *
 * Determinism: a league is a pure function of (seed, action log). advanceDay
 * reads only league state, draws randomness only through registered
 * streamRng paths, and never touches the wall clock. advanceDay is async
 * solely because the SimulateJobs seam may be (worker pools); every other
 * step is synchronous.
 *
 * Robustness during the build wave: every sibling subsystem is called at
 * its documented point; the INERT stubs (people/*, media/*, most of ai/*)
 * simply produce nothing, so a league with media dark just writes no news.
 */
import { clamp } from '@hoopsh/engine';
import type {
  Coach, DayDigest, GameRecord, InboxItem, League, PlayerId,
  ScheduledGame, ScoutRange, Season, SimulateJobs, TeamId, UserAction,
} from './types.js';
import { buildSeasonCalendar, currentDate, optionDecisionDay, phaseOn } from './calendar.js';
import { abilityScore, applyGameResults, planDayJobs } from './gameday.js';
import { officialsNewsFor } from './officials.js';
import { expireInboxDeadlines, generateGmInbox } from './inbox.js';
import { streamRng } from './rng.js';
import { generateSchedule } from './schedule.js';
import { emptyStanding } from './standings.js';
import { advancePostseason, buildFirstRound, buildPlayin, runLottery } from './postseason.js';
import { capSheet, rollCapLines } from './cba/cap.js';
import {
  availableMeans, buildContract, maxSalaryFor, qualifyingOfferFor, validateSigning,
} from './cba/contracts.js';
import { validateTrade } from './cba/tradelegal.js';
import {
  executeAssignment, executeClaim, executeDraftSelection, executeExtension,
  executeOptionDecision, executeRetirement, executeSigning, executeTrade,
  executeWaive,
} from './transactions.js';
import { applyAging, runDevelopmentReview } from './people/dev.js';
import { advanceRecoveries, rollPostGameInjuries } from './people/injury.js';
import { updateDispositions } from './people/disposition.js';
import { updatePsyche } from './people/psyche.js';
import { runRetirements } from './people/retire.js';
import { generateCoach, generateDraftClass } from './people/gen.js';
import { reevaluateTimelines } from './ai/persona.js';
import { aiTradePulse, clearNegotiation, respondToOffer } from './ai/trade.js';
import { runAiOffseasonDecisions, runFreeAgencyDay } from './ai/fa.js';
import { aiRosterUpkeep } from './ai/roster.js';
import { aiSelect } from './ai/draftai.js';
import { runCombine } from './scouting.js';
import { writeDailyNews } from './media/news.js';
import { championshipNews, lotteryNightNews } from './media/moments.js';
import { recapGame } from './media/recap.js';
import { selectAllStars, updateAwardRaces, voteSeasonAwards } from './media/awards.js';
import { archiveSeason, updateRecords } from './media/almanac.js';

export interface ActionResult {
  ok: boolean;
  /** human-readable rule failures (cap engine wording), empty when ok */
  errors: string[];
}

// Spine constants: bookkeeping conventions, not sweepable behavior levers
// (the sweepable market/valuation magnitudes belong to their owner modules).
const CAP_HOLD_MULT = 1.5;      // FEEL: simplified flat cap-hold at 150% of last salary; the real CBA runs 150/190/250% by service tier (register-style simplification, clamped at the max)
const CORE_RANK = 6;            // FEEL: an RFA who would rank top-6 on his own roster is a keeper in the auto-match rule
const COACH_CANDIDATES = 3;     // FEEL: a firing produces a three-name shortlist, the classic coaching-search shape
const DISPOSITION_CADENCE = 7;  // FEEL: weekly locker-room pulse; daily would be noise (FRANCHISE.md anti-pattern list)

// ---------------------------------------------------------------- helpers

/** Index of the calendar day carrying a mark, or -1 (hand-built test calendars may omit marks). */
function markDay(calendar: League['calendar'], mark: string): number {
  return calendar.findIndex((d) => (d.marks as string[]).includes(mark));
}

function deny(...errors: string[]): ActionResult {
  return { ok: false, errors };
}

function pass(): ActionResult {
  return { ok: true, errors: [] };
}

function inRange(x: number, lo: number, hi: number): boolean {
  return Number.isFinite(x) && x >= lo && x <= hi;
}

/** Append an inbox item unless its id already exists (idempotency guard: re-entered days must not duplicate). */
function pushInbox(league: League, item: InboxItem): void {
  if (!league.inbox.some((i) => i.id === item.id)) league.inbox.push(item);
}

/** Append news items, skipping ids already present (guards a future media impl that self-appends AND returns). */
function appendNews(league: League, items: ReturnType<typeof writeDailyNews>): void {
  for (const item of items) {
    if (!league.news.some((n) => n.id === item.id)) league.news.push(item);
  }
}

const draftPausePrefix = (season: number): string => `draft-${season}-pick-`;
const draftPauseId = (season: number, overall: number): string => `${draftPausePrefix(season)}${overall}`;

/** Prospects still on the board: draft-class ids whose player is still draftEligible. */
function availableProspects(league: League): PlayerId[] {
  return league.draftClass.filter((id) => league.players[id]?.status === 'draftEligible');
}

/** Picks already made this season, derived from the transaction log (the League shape carries no draft cursor by design: the log IS the cursor, replay-safe). */
function draftPicksMade(league: League): number {
  return league.transactions.filter((t) => t.kind === 'draftSelection' && t.date.season === league.season).length;
}

/**
 * Owner of the pick originally belonging to `originalTeam` in `round`.
 * Protections are already final here: the owning modules settle protection
 * rolls when the order is known, so pick.owner is the draft-night truth.
 * Falls back to the original team when no pick object exists (pre-genesis
 * fixtures; genesis seeds picks seven seasons out).
 */
function pickOwner(league: League, originalTeam: TeamId, round: 1 | 2): TeamId {
  for (const tid of Object.keys(league.teams)) {
    for (const pick of league.teams[tid]!.picks) {
      if (pick.season === league.season && pick.round === round && pick.originalTeam === originalTeam) {
        return pick.owner;
      }
    }
  }
  return originalTeam;
}

/**
 * The resolved draft order, both rounds. Round 1 follows the lottery order;
 * round 2 reuses it as a v1 simplification (the real second round runs
 * straight record order; lift when postseason stamps resolvedNumber on
 * round-2 picks).
 */
function draftOrder(league: League): Array<{ teamId: TeamId; round: 1 | 2; pickInRound: number }> {
  if (!league.lottery) return [];
  const out: Array<{ teamId: TeamId; round: 1 | 2; pickInRound: number }> = [];
  for (const round of [1, 2] as const) {
    league.lottery.order.forEach((originalTeam, i) => {
      out.push({ teamId: pickOwner(league, originalTeam, round), round, pickInRound: i + 1 });
    });
  }
  return out;
}

/**
 * FEEL dollar proxy for what a front office thinks a player is worth per
 * season: the crude ability mean mapped onto the salary scale (ability 40
 * reads as a fringe minimum at 2% of cap, 89+ as a max-tier 35%). A
 * placeholder for ai/valuation.ts's real surplus-value model; used only
 * for the rollover's simplified AI option decisions.
 */
function perceivedOptionValue(league: League, playerId: PlayerId, season: number): number {
  const player = league.players[playerId]!;
  const lines = league.capLines[season] ?? league.capLines[league.season];
  const cap = lines ? lines.cap : league.params.cba.genesisCap;
  const share = clamp((abilityScore(player) - 40) / 140, 0.02, 0.35);
  return Math.round(cap * share);
}

/** 1 + how many roster players rate above this player (1 = best on the team). */
function coreRank(league: League, teamId: TeamId, playerId: PlayerId): number {
  const team = league.teams[teamId];
  const player = league.players[playerId];
  if (!team || !player) return 99; // unknowable rank: never reads as core
  const target = abilityScore(player);
  let better = 0;
  for (const id of team.roster) {
    const p = league.players[id];
    if (p && abilityScore(p) > target) better += 1;
  }
  return better + 1;
}

/**
 * Settle one offer sheet: matched hands the same terms to the incumbent,
 * unmatched lets the offering team sign. The signing itself goes through
 * the executor; the match DECISION record is spine bookkeeping (the frozen
 * barrel exposes no executor for it, and the decision mutates no roster
 * state on its own).
 */
function resolveOfferSheet(league: League, sheet: League['offerSheets'][number], matched: boolean): void {
  const player = league.players[sheet.playerId];
  const incumbent = player?.rights?.teamId ?? null;
  if (matched && incumbent) {
    executeSigning(league, incumbent, sheet.playerId, { ...sheet.contract, teamId: incumbent }, true);
  } else {
    executeSigning(league, sheet.from, sheet.playerId, sheet.contract, true);
  }
  if (incumbent) {
    league.transactions.push({
      kind: 'matchDecision', date: currentDate(league),
      teamId: incumbent, playerId: sheet.playerId, matched,
    });
  }
  league.offerSheets = league.offerSheets.filter((s) => s !== sheet);
  // the sheet's inbox clock (inbox.ts) dies with the sheet, on every
  // resolution path: user match action, morning auto-resolve, either way
  const clock = league.inbox.find(
    (i) => !i.resolved && i.id.startsWith('sheet-clock-') && i.id.endsWith(`-${sheet.playerId}`),
  );
  if (clock) clock.resolved = true;
}

/**
 * Morning auto-resolution of offer sheets whose match window expired. The
 * AI matching rule is deliberately simple and documented: keep your own
 * core (top CORE_RANK by ability on the incumbent roster) when the year-1
 * bill stays under the first apron. A user who let the clock run out
 * declined by inaction: deciding FOR the user would be a silent action,
 * the one thing the action log cannot represent.
 */
function resolveExpiredOfferSheets(league: League): void {
  const today = currentDate(league);
  const due = league.offerSheets.filter(
    (s) => s.decideBy.season < today.season || (s.decideBy.season === today.season && s.decideBy.day <= today.day),
  );
  for (const sheet of due) {
    const incumbent = league.players[sheet.playerId]?.rights?.teamId;
    let matched = false;
    // a persona-run user seat (career mode, autosims) auto-matches like
    // any AI team; only a HUMAN GM chair (gm === null) decides by hand
    const userIsHuman = league.teams[league.userTeam]?.gm === null;
    if (incumbent && (incumbent !== league.userTeam || !userIsHuman)) {
      const cs = capSheet(league, incumbent);
      const year1 = sheet.contract.years[0]?.salary ?? 0;
      matched = cs.total + year1 <= cs.apron1 && coreRank(league, incumbent, sheet.playerId) <= CORE_RANK;
    }
    resolveOfferSheet(league, sheet, matched);
  }
}

/** Route postseason-scheduled games to their home: play-in slate or the season schedule (kept ordered by day then id, the League.schedule contract). */
function routeScheduled(league: League, games: ScheduledGame[]): void {
  if (games.length === 0) return;
  for (const g of games) {
    if (g.type === 'playin') {
      if (!league.playin.some((x) => x.id === g.id)) league.playin.push(g);
    } else if (!league.schedule.some((x) => x.id === g.id)) {
      league.schedule.push(g);
    }
  }
  league.schedule.sort(
    (a, b) => a.date.season - b.date.season || a.date.day - b.date.day || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Run draft night from the next unmade pick. AI picks resolve through
 * aiSelect + the draft executor; the user's turn PAUSES the day with an
 * inbox decision (the draft is a calendar ritual, not a form -- the user
 * answers with a draftPick action and advances again). Returns false while
 * paused. Advancing again without picking re-issues the same pause.
 * A board smaller than the remaining picks ends the draft early (tiny test
 * classes; real pools exceed the pick count).
 */
function processDraft(league: League, order: ReturnType<typeof draftOrder>): boolean {
  let made = draftPicksMade(league);
  while (made < order.length) {
    const slot = order[made]!;
    const board = availableProspects(league);
    if (board.length === 0) break;
    // pause only for a HUMAN chair: gm === null means the user runs this
    // team; an autosim that installs a persona in the user seat drafts
    // straight through (the acceptance harness does exactly that)
    if (slot.teamId === league.userTeam && league.teams[slot.teamId]!.gm === null) {
      const id = draftPauseId(league.season, made + 1);
      // The 15-man wall on the clock item itself (#183): a pick signs a
      // standard contract on the spot, so a full roster cannot legally
      // select. The AI branch below waives its weakest body for exactly
      // this reason; the user seat decides for itself, so the item names
      // the wall and the two real outs instead.
      const squeezed = league.teams[slot.teamId]!.roster.length >= league.params.cba.rosterMax;
      const body = squeezed
        ? `Your selection is up, but your roster sits at the ${league.params.cba.rosterMax}-man maximum and a draft pick signs a standard contract on the spot. Clear a spot first: waive a player or trade a body out. Then make the pick from the draft board. The night waits on your pick; the day will not advance until it is in.`
        : 'Your selection is up. Open the draft board and make the pick.';
      const existing = league.inbox.find((i) => i.id === id);
      if (existing) {
        // The pick is still owed: re-issue the SAME pause with today's
        // roster truth, re-opening it if a navigational answer resolved
        // it. pushInbox's id dedupe used to eat the re-issue here and
        // wedge the league silently, with the docstring's "re-issues the
        // same pause" promise broken (#183). Only the CURRENT owed
        // pick's item is ever re-opened; made picks stay resolved.
        existing.body = body;
        existing.resolved = false;
      } else {
        pushInbox(league, {
          id,
          date: currentDate(league),
          kind: 'decision',
          title: `On the clock: round ${slot.round}, pick ${slot.pickInRound}`,
          body,
          choices: [{ id: 'open-draft', label: 'Go to the draft board' }],
          resolved: false,
        });
      }
      return false;
    }
    const team = league.teams[slot.teamId]!;
    if (team.roster.length >= league.params.cba.rosterMax) {
      // the draft-night squeeze: a full fifteen cannot sign the pick, so
      // the front office cuts its weakest body first (real teams waive
      // camp deals on draft night for exactly this reason)
      const weakest = [...team.roster]
        .sort((a, b) => abilityScore(league.players[a]!) - abilityScore(league.players[b]!))[0]!;
      executeWaive(league, slot.teamId, weakest, false);
    }
    const chosen = aiSelect(league, slot.teamId, board);
    executeDraftSelection(league, slot.teamId, chosen, slot.round, slot.pickInRound);
    made += 1;
  }
  // undrafted prospects hit the open market immediately (real convention)
  for (const id of availableProspects(league)) {
    const p = league.players[id]!;
    p.status = 'freeAgent';
    p.rights = null;
    if (!league.freeAgents.includes(id)) league.freeAgents.push(id);
  }
  league.draftClass = [];
  league.phase = 'moratorium';
  return true;
}

/**
 * July 1 in contract terms: shed every contract year through `ended` and
 * send players whose deals ran out to the market, incumbents holding
 * simplified Bird rights (3+ bird years = 'bird', 2 = 'earlyBird', else
 * 'nonBird'; cap hold at a flat 150% of last salary clamped by the max;
 * expiring rookie scale = restricted, with the QO priced immediately).
 * Called at the LOTTERY transition so the class hits its own July market
 * (a season's free agents shopping a year late was a measured defect),
 * and again from the rollover as an idempotent backstop: the second pass
 * finds the years already shed and releases nobody twice.
 */
function releaseExpiredContracts(league: League, ended: Season): void {
  for (const pid of Object.keys(league.players)) {
    const p = league.players[pid]!;
    const c = p.contract;
    if (!c || p.status === 'retired') continue;
    const shed = c.years.filter((y) => y.season <= ended);
    c.years = c.years.filter((y) => y.season > ended);
    if (c.years.length > 0) continue;
    if (shed.length === 0) continue; // backstop pass: already released
    // expired: to the market, incumbent holding rights
    const lastSalary = shed[shed.length - 1]!.salary;
    // Bird continuity simplified to signing tenure + seasons served under
    // this deal (a midseason trade preserving Bird years is folded in by
    // assuming continuity; register-style simplification).
    const birdYears = c.birdYearsAtSigning + (ended - c.signedOn.season + 1);
    const tier = birdYears >= 3 ? 'bird' : birdYears === 2 ? 'earlyBird' : 'nonBird';
    const restricted = c.kind === 'rookieScale'; // expiring rookie scale = restricted FA (REAL)
    const capHold = Math.min(Math.round(lastSalary * CAP_HOLD_MULT), maxSalaryFor(league, p));
    p.contract = null;
    p.status = 'freeAgent';
    p.rights = {
      teamId: c.teamId, tier, capHold, restricted,
      ...(restricted ? { qualifyingOffer: qualifyingOfferFor(league, pid) } : {}),
    };
    const team = league.teams[c.teamId];
    if (team) {
      team.roster = team.roster.filter((id) => id !== pid);
      team.twoWay = team.twoWay.filter((id) => id !== pid);
    }
    if (!league.freeAgents.includes(pid)) league.freeAgents.push(pid);
  }
}

/**
 * Close the season at the end of free agency: people arcs (aging, the
 * offseason development review, retirements), the contract-year rollover
 * (expiring deals send players to the market with simplified Bird rights:
 * 3+ bird years = 'bird', 2 = 'earlyBird', else 'nonBird'; cap hold at a
 * flat 150% of last salary clamped by the max -- the real tiered
 * percentages are a registered simplification), two-way counter resets,
 * next season's cap lines, simplified AI option decisions, and the fresh
 * calendar/schedule/standings. The August/September quiet period compresses
 * into this single step (FRANCHISE.md §8).
 */
function rolloverSeason(league: League, digest: DayDigest): void {
  const ended = league.season;
  const next = ended + 1;

  applyAging(league);
  runDevelopmentReview(league, 'offseason');
  for (const id of runRetirements(league)) executeRetirement(league, id, currentDate(league));
  // retirements land AFTER the day's pulse: a second desk pass prints the
  // retrospectives the day they happen, idempotent by story id (#118).
  // Must precede the season/day reset below; the desk dates and dedups
  // from league.season/league.day.
  appendNews(league, writeDailyNews(league));

  releaseExpiredContracts(league, ended); // backstop; the lottery transition did the real release

  // two-way game counters are a per-season allowance
  for (const pid of Object.keys(league.players)) {
    const p = league.players[pid]!;
    if (p.twoWayGamesUsed !== undefined) p.twoWayGamesUsed = 0;
  }

  // Usually a no-op: the lottery transition already rolled these lines
  // (rollCapLines is idempotent). Kept as the backstop for league states
  // that never crossed a lottery (hand-built saves, partial seasons).
  rollCapLines(league, next);

  // Simplified AI option pass for the incoming season: a team keeps an
  // option priced at or under its read of the player; a player opts in
  // when the deal beats his market read. The user's options resolve only
  // through explicit actions (an undecided user option rides as exercised;
  // ai/fa's option-deadline flow is the richer path once it lands).
  for (const tid of Object.keys(league.teams)) {
    const team = league.teams[tid]!;
    if (team.gm === null) continue;
    for (const pid of [...team.roster, ...team.twoWay]) {
      const c = league.players[pid]?.contract;
      if (!c) continue;
      const year = c.years.find((y) => y.season === next && (y.teamOption === true || y.playerOption === true));
      if (!year) continue;
      // the career seam: a controlled player's PLAYER option is his call,
      // never the AI pass's (team options stay the team's decision)
      if (year.playerOption === true && league.careerControlled?.includes(pid)) continue;
      const value = perceivedOptionValue(league, pid, next);
      const exercised = year.teamOption === true ? year.salary <= value : year.salary >= value;
      executeOptionDecision(league, tid, pid, year.teamOption === true ? 'team' : 'player', exercised);
    }
  }

  // the archive was written at the finals horn, BEFORE that season's
  // lottery and draft happened: stamp both into the closing season's book
  // now, so the almanac shows the order and the class the cycle produced
  const closingArchive = league.archives.find((a) => a.season === league.season);
  if (closingArchive) {
    if (league.lottery) closingArchive.lottery = league.lottery;
    closingArchive.draftClass = league.transactions
      .filter((tx) => tx.kind === 'draftSelection' && tx.date.season === league.season)
      .map((tx) => (tx.kind === 'draftSelection'
        ? { pick: tx.pick, round: tx.round, teamId: tx.teamId, playerId: tx.playerId }
        : null))
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.round - b.round || a.pick - b.pick);
  }

  league.season = next;
  league.day = 0;
  league.phase = 'camp';
  league.calendar = buildSeasonCalendar(league.params, next);
  league.schedule = generateSchedule(league, next, streamRng(league.seed, 'schedule', next));
  league.results = {};
  league.playoffs = [];
  league.playin = [];
  league.lottery = null;
  league.offerSheets = [];
  league.standings = {};
  for (const tid of Object.keys(league.teams)) league.standings[tid] = emptyStanding(tid);
  digest.seasonRolledTo = next;
}

// ------------------------------------------------------------ user actions

/**
 * Validate + apply a user action now, logging it for replay (the action
 * log plus the seed IS the save's determinism spine). Validation failures
 * return cap-engine-worded errors and are NEVER thrown; only corrupted
 * state throws. Trade/signing legality is checked through the cba
 * validators BEFORE any executor runs, so executors only ever see legal
 * requests.
 */
export function applyUserAction(league: League, action: UserAction): ActionResult {
  const result = performAction(league, action);
  if (result.ok) {
    league.actionSeq += 1;
    // the log stores a snapshot: a caller mutating its action object later
    // must not rewrite history
    league.actionLog.push({ seq: league.actionSeq, date: currentDate(league), action: structuredClone(action) });
  }
  return result;
}

function performAction(league: League, action: UserAction): ActionResult {
  const team = league.teams[league.userTeam];
  if (!team) throw new Error(`applyUserAction: user team '${league.userTeam}' missing from league`);
  const onTeam = (id: PlayerId): boolean => team.roster.includes(id) || team.twoWay.includes(id);

  switch (action.kind) {
    case 'setRotation': {
      const r = action.rotation;
      const errors: string[] = [];
      if (r.starters.length !== 5 || new Set(r.starters).size !== 5) errors.push('rotation needs exactly 5 unique starters');
      for (const id of r.starters) if (!onTeam(id)) errors.push(`starter ${id} is not on the roster`);
      for (const [id, v] of Object.entries(r.minutes)) {
        if (!onTeam(id)) errors.push(`minutes target for ${id}, who is not on the roster`);
        if (!inRange(v, 0, 48)) errors.push(`minutes target for ${id} must be 0-48`); // REAL: a player cannot exceed regulation 48
      }
      for (const id of r.scratches) if (!onTeam(id)) errors.push(`scratch ${id} is not on the roster`);
      if (!inRange(r.b2bRestBelow, 0, 100)) errors.push('b2bRestBelow must be 0-100');
      if (errors.length > 0) return deny(...errors);
      team.rotation = {
        minutes: { ...r.minutes },
        starters: [...r.starters],
        b2bRestBelow: r.b2bRestBelow,
        scratches: [...r.scratches],
      };
      return pass();
    }

    case 'setTactics': {
      if (!inRange(action.pace, 0, 100) || !inRange(action.threeBias, 0, 100) || !inRange(action.helpAggr, 0, 100)) {
        return deny('tactics values must be 0-100');
      }
      // User tactics live ON the coach record: gameday projection reads
      // coach prefs for every team, so the human bench and the AI bench go
      // through one seam.
      team.coach.pace = action.pace;
      team.coach.threeBias = action.threeBias;
      team.coach.helpAggr = action.helpAggr;
      return pass();
    }

    case 'setStrategy': {
      const bad = action.untouchables.filter((id) => !league.players[id]);
      if (bad.length > 0) return deny(`unknown players in untouchables: ${bad.join(', ')}`);
      team.strategy = { timeline: action.timeline, untouchables: [...action.untouchables] };
      return pass();
    }

    case 'scout': {
      const player = league.players[action.playerId];
      if (!player) return deny(`unknown player ${action.playerId}`);
      if (!Number.isFinite(action.points) || action.points <= 0) return deny('scout points must be positive');
      // Coverage ledger only: budget enforcement belongs to the scouting
      // module's own coverage math (its userPointsPerSeason params); the
      // spine records where the hours went.
      const bump = action.points * league.params.scouting.coveragePerPoint;
      const existing = league.scouting[action.playerId];
      if (existing) {
        existing.coverage = clamp(existing.coverage + bump, 0, 100);
        existing.updatedOn = currentDate(league);
      } else {
        // Placeholder report at full-width ranges: scouting.buildUserReport
        // (ai-team task) becomes the source of real ranges after the wave.
        const wide: ScoutRange = [0, 100];
        league.scouting[action.playerId] = {
          playerId: action.playerId,
          current: { phys: wide, scoring: wide, playmaking: wide, defense: wide, rebounding: wide, mental: wide },
          ceiling: { phys: wide, scoring: wide, playmaking: wide, defense: wide, rebounding: wide, mental: wide },
          coverage: clamp(bump, 0, 100),
          role: '', comparison: '', strengths: [], flags: [],
          updatedOn: currentDate(league),
        };
      }
      return pass();
    }

    case 'respondToRequest': {
      const item = league.inbox.find((i) => i.id === action.requestId);
      if (!item) return deny(`no inbox item ${action.requestId}`);
      if (item.kind !== 'decision') return deny('that inbox item is not a decision');
      if (item.resolved) return deny('that request is already resolved');
      if (item.choices && !item.choices.some((c) => c.id === action.choice)) {
        return deny(`'${action.choice}' is not one of the offered choices`);
      }
      // An attached offer makes 'accept' executable: the answer IS the
      // trade, at exactly the terms the item showed (acceptCounter
      // discipline: the other front office authored this offer, so it is
      // re-validated but never re-judged). A failed validation leaves the
      // item OPEN - the deal died since it was posted, and saying no to a
      // dead deal is still the user's word to give, not the validator's.
      if (item.offer && action.choice === 'accept') {
        const legality = validateTrade(league, item.offer);
        if (!legality.ok) return deny(...legality.errors);
        executeTrade(league, item.offer);
        clearNegotiation(league, item.offer.from, item.offer.to);
      }
      // The modules that created the item read the logged action for the
      // chosen answer; the spine's job is marking it answered.
      item.resolved = true;
      return pass();
    }

    case 'proposeTrade': {
      const offer = action.offer;
      if (offer.from !== league.userTeam) return deny('trade proposals must come from your own front office');
      if (!league.teams[offer.to]) return deny(`unknown team ${offer.to}`);
      const verdict = respondToOffer(league, offer);
      const today = currentDate(league);
      if (verdict.accept) {
        executeTrade(league, offer);
      } else if (verdict.counter) {
        // counter lands in the inbox; acceptCounter executes it later
        pushInbox(league, {
          id: `counter-${league.season}-${league.day}-${offer.to}`,
          date: today, kind: 'decision',
          title: `${league.teams[offer.to]!.city} counters your offer`,
          body: verdict.reasoning,
          choices: [{ id: 'review', label: 'Review the counter at the trade desk' }],
          resolved: false,
        });
        const pair = league.negotiations.find(
          (n) => (n.teams[0] === offer.from && n.teams[1] === offer.to) || (n.teams[0] === offer.to && n.teams[1] === offer.from),
        );
        if (pair) {
          pair.lastOffer = verdict.counter;
          pair.rounds += 1;
          pair.lastDate = today;
          pair.temperature = 'warm';
        } else {
          league.negotiations.push({
            teams: [offer.from, offer.to],
            about: [...offer.give.players, ...offer.get.players],
            lastOffer: verdict.counter,
            temperature: 'warm',
            rounds: 1,
            lastDate: today,
          });
        }
      } else {
        // a walk-away is still an answer: the action applied, the news is no
        pushInbox(league, {
          id: `declined-${league.season}-${league.day}-${offer.to}`,
          date: today, kind: 'notice',
          title: `${league.teams[offer.to]!.city} passes`,
          body: verdict.reasoning,
          resolved: false,
        });
      }
      return pass();
    }

    case 'acceptCounter': {
      const legality = validateTrade(league, action.offer);
      if (!legality.ok) return deny(...legality.errors);
      executeTrade(league, action.offer);
      return pass();
    }

    case 'signFreeAgent': {
      const player = league.players[action.playerId];
      if (!player) return deny(`unknown player ${action.playerId}`);
      if (player.status !== 'freeAgent') return deny(`${player.name} is not a free agent`);
      const terms = {
        years: action.years,
        startSalary: action.startSalary,
        teamOptionLastYear: action.options?.lastYearTeam,
        playerOptionLastYear: action.options?.lastYearPlayer,
      };
      const legality = validateSigning(league, league.userTeam, action.playerId, terms, action.means);
      if (!legality.ok) return deny(...legality.errors);
      const contract = buildContract(league, league.userTeam, action.playerId, terms, action.means);
      executeSigning(league, league.userTeam, action.playerId, contract);
      return pass();
    }

    case 'offerSheet': {
      const player = league.players[action.playerId];
      if (!player) return deny(`unknown player ${action.playerId}`);
      if (player.status !== 'freeAgent' || !player.rights?.restricted) return deny(`${player.name} is not a restricted free agent`);
      if (player.rights.teamId === league.userTeam) return deny('you hold this player\'s rights; negotiate directly instead of a sheet');
      const terms = { years: action.years, startSalary: action.startSalary };
      const means = availableMeans(league, league.userTeam, action.playerId, terms);
      if (means.length === 0) return deny('no legal signing means can carry these terms');
      const legality = validateSigning(league, league.userTeam, action.playerId, terms, means[0]!);
      if (!legality.ok) return deny(...legality.errors);
      const contract = buildContract(league, league.userTeam, action.playerId, terms, means[0]!);
      league.offerSheets.push({
        playerId: action.playerId,
        from: league.userTeam,
        contract,
        decideBy: { season: league.season, day: league.day + league.params.cba.offerSheetMatchDays },
      });
      return pass();
    }

    case 'matchOfferSheet': {
      const sheet = league.offerSheets.find(
        (s) => s.playerId === action.playerId && league.players[s.playerId]?.rights?.teamId === league.userTeam,
      );
      if (!sheet) return deny('no pending offer sheet on a player whose rights you hold');
      resolveOfferSheet(league, sheet, action.matched);
      return pass();
    }

    case 'waive': {
      if (!onTeam(action.playerId)) return deny('that player is not on your roster');
      executeWaive(league, league.userTeam, action.playerId, action.stretch);
      return pass();
    }

    case 'claimWaiver': {
      if (!league.waiverWire.some((w) => w.playerId === action.playerId)) return deny('that player is not on the waiver wire');
      executeClaim(league, league.userTeam, action.playerId);
      return pass();
    }

    case 'draftPick': {
      if (league.phase !== 'draft') return deny('the draft is not underway');
      const order = draftOrder(league);
      const made = draftPicksMade(league);
      const slot = order[made];
      if (!slot || slot.teamId !== league.userTeam) return deny('it is not your pick');
      if (!availableProspects(league).includes(action.playerId)) return deny('that prospect is not on the board');
      // the 15-man wall is a validation failure, not a thrown 500: this
      // function's contract says errors return, never throw (#183). Same
      // wording as executeDraftSelection's own backstop.
      if (team.roster.length >= league.params.cba.rosterMax) {
        return deny(`roster already at the ${league.params.cba.rosterMax}-man maximum; clear a spot before the pick`);
      }
      executeDraftSelection(league, league.userTeam, action.playerId, slot.round, slot.pickInRound);
      const pause = league.inbox.find((i) => i.id === draftPauseId(league.season, made + 1));
      if (pause) pause.resolved = true;
      return pass();
    }

    case 'exerciseOption': {
      const player = league.players[action.playerId];
      if (!player || !onTeam(action.playerId)) return deny('that player is not on your roster');
      const year = player.contract?.years.find((y) => y.season > league.season && y.teamOption === true);
      if (!year) return deny('no team option on this contract (player options belong to the player)');
      executeOptionDecision(league, league.userTeam, action.playerId, 'team', action.exercised);
      return pass();
    }

    case 'extend': {
      if (!onTeam(action.playerId)) return deny('that player is not on your roster');
      const terms = { years: action.years, startSalary: action.startSalary };
      const legality = validateSigning(league, league.userTeam, action.playerId, terms, 'extension');
      if (!legality.ok) return deny(...legality.errors);
      const contract = buildContract(league, league.userTeam, action.playerId, terms, 'extension');
      executeExtension(league, league.userTeam, action.playerId, contract);
      return pass();
    }

    case 'assign': {
      if (!onTeam(action.playerId)) return deny('that player is not on your roster');
      executeAssignment(league, league.userTeam, action.playerId, action.to);
      return pass();
    }

    case 'hireCoach': {
      const shortlist = league.inbox.find((i) => i.id.startsWith(`coach-hire-`) && i.kind === 'decision' && !i.resolved);
      if (!shortlist) return deny('there is no open coaching search');
      const candidates = JSON.parse(shortlist.body) as Coach[];
      const chosen = candidates.find((c) => c.id === action.coachId);
      if (!chosen) return deny(`unknown coach candidate ${action.coachId}`);
      team.coach = { ...chosen, hiredOn: currentDate(league) };
      shortlist.resolved = true;
      // coachChange is spine-owned: team.coach is not roster/contract/pick
      // state, so no transactions.ts executor exists for it
      league.transactions.push({ kind: 'coachChange', date: currentDate(league), teamId: league.userTeam, coach: team.coach });
      return pass();
    }

    case 'fireCoach': {
      const fired = team.coach;
      // NOTE: 'coach:<season>:<day>' is pending registration in rng.ts's
      // stream registry (frozen during the build wave; flagged to the
      // orchestrator). It follows the registry's naming scheme so the
      // header entry is a pure documentation add.
      const rng = streamRng(league.seed, 'coach', league.season, league.day);
      const candidates: Coach[] = [];
      for (let i = 0; i < COACH_CANDIDATES; i++) candidates.push(generateCoach(rng, i));
      // an interim runs the bench until the user hires: obedient, neutral
      // prefs, weak development (FEEL: interims keep seats warm)
      team.coach = {
        id: `interim-${league.userTeam}-${league.season}-${league.day}`,
        name: 'Interim Coach',
        pace: 50, threeBias: 50, helpAggr: 50, devQuality: 40, obedience: 90,
        hiredOn: currentDate(league), contractSeasons: 1,
      };
      league.transactions.push({
        kind: 'coachChange', date: currentDate(league), teamId: league.userTeam,
        coach: team.coach, fired: fired.id,
      });
      pushInbox(league, {
        id: `coach-hire-${league.season}-${league.day}`,
        date: currentDate(league),
        kind: 'decision',
        title: 'Coaching search: three candidates',
        // the shortlist itself rides in the body so hireCoach can resolve a
        // candidate id without a league-shape field for search state
        body: JSON.stringify(candidates),
        choices: candidates.map((c) => ({ id: c.id, label: c.name })),
        resolved: false,
      });
      return pass();
    }

    case 'renounceRights': {
      const player = league.players[action.playerId];
      if (!player || player.rights?.teamId !== league.userTeam) return deny('you hold no rights on that player');
      // a pure cap-bookkeeping clear: the hold vanishes, the player stays a
      // free agent; no executor exists because no roster state moves
      player.rights = null;
      return pass();
    }

    default: {
      // exhaustive: a new UserAction kind must be wired here deliberately
      const never: never = action;
      return deny(`unhandled action ${(never as { kind: string }).kind}`);
    }
  }
}

// ---------------------------------------------------------------- the day

/**
 * Advance one day. Mutates league; returns the digest the UI renders.
 * Lazy-initializes calendar + schedule on a fresh league (genesis returns
 * them empty by design). The ONLY mover of league time: anything that
 * happens daily is called from here in the header's documented order.
 * Draft night can return WITHOUT advancing the day (the user is on the
 * clock); every other call moves day forward by one or rolls the season.
 */
export async function advanceDay(league: League, sim: SimulateJobs): Promise<DayDigest> {
  if (league.calendar.length === 0) {
    league.calendar = buildSeasonCalendar(league.params, league.season);
    league.schedule = generateSchedule(league, league.season, streamRng(league.seed, 'schedule', league.season));
    league.phase = phaseOn(league.calendar, league.day);
  }
  // standings rows exist from day one: the UI renders a full table and the
  // standings fold never meets a missing row (idempotent, so hand-built
  // test leagues that skip lazy init are covered too)
  for (const tid of Object.keys(league.teams)) {
    if (!league.standings[tid]) league.standings[tid] = emptyStanding(tid);
  }

  const startPhase = league.phase;
  const txStart = league.transactions.length;
  const newsStart = league.news.length;
  const inboxStart = league.inbox.length;
  const digest: DayDigest = {
    date: currentDate(league), phase: league.phase,
    games: [], transactionCount: 0, newsIds: [], inboxIds: [],
  };
  const finish = (): DayDigest => {
    digest.phase = league.phase;
    digest.transactionCount = league.transactions.length - txStart;
    digest.newsIds = league.news.slice(newsStart).map((n) => n.id);
    digest.inboxIds = league.inbox.slice(inboxStart).map((i) => i.id);
    if (league.phase !== startPhase) digest.phaseChangedTo = league.phase;
    return digest;
  };

  const cal = league.calendar;
  const marks: string[] = cal[league.day] ? (cal[league.day]!.marks as string[]) : [];
  const draftIdx = markDay(cal, 'draftNight');

  // Draft-night RE-ENTRY: the paused day already ran its morning/AI/pulse,
  // so a resume goes straight back to the war room. Detected by the pause
  // inbox trail (pause items persist after resolution).
  if (
    league.phase === 'draft' && draftIdx >= 0 && league.day >= draftIdx
    && league.inbox.some((i) => i.id.startsWith(draftPausePrefix(league.season)))
  ) {
    const done = processDraft(league, draftOrder(league));
    // the paused day's pulse ran before the war room did: a second desk
    // pass prints the picks just made, or they never print at all (#118).
    // Deterministic per-day story ids keep the repeat idempotent under
    // appendNews's guard.
    appendNews(league, writeDailyNews(league));
    if (done) league.day += 1;
    return finish();
  }

  // day-start phase sync: camp rolls into the regular season on the
  // opener's morning -- the one purely calendar-driven transition
  if (league.phase === 'camp' && phaseOn(cal, league.day) === 'regular') league.phase = 'regular';

  // ------------------------------------------------------------- morning
  advanceRecoveries(league);
  resolveExpiredOfferSheets(league);
  expireInboxDeadlines(league);

  // ---------------------------------------------------- AI front offices
  // Timelines re-read at the season's inflection points: camp open, the
  // opener (expectations set), and deadline week (buyers become sellers).
  if (league.day === 0 || marks.includes('seasonOpener') || marks.includes('tradeDeadline')) {
    reevaluateTimelines(league);
  }
  aiTradePulse(league);
  aiRosterUpkeep(league);
  if (league.phase === 'moratorium' || league.phase === 'freeAgency') runFreeAgencyDay(league);
  if (league.day === optionDecisionDay(league.calendar, league.params)) runAiOffseasonDecisions(league);

  // --------------------------------------------------------------- games
  let records: GameRecord[] = [];
  const jobs = planDayJobs(league);
  if (jobs.length > 0) {
    const results = await sim(jobs);
    // a seam returning the wrong number of outcomes fails loudly (the
    // season layer's rule, SEASON.md)
    if (results.length !== jobs.length) {
      throw new Error(`advanceDay: SimulateJobs returned ${results.length} results for ${jobs.length} jobs`);
    }
    records = applyGameResults(league, results);
    rollPostGameInjuries(league, records);
    digest.games = records.map((r) => r.id);
  }

  // -------------------------------------------------------- league pulse
  if (league.day % DISPOSITION_CADENCE === 0) {
    updatePsyche(league); // step confidence/chemistry BEFORE morale reads the room (people/psyche.ts)
    for (const item of updateDispositions(league)) pushInbox(league, item);
  }
  if (league.phase === 'regular' && league.day % league.params.media.awardRaceCadenceDays === 0) {
    appendNews(league, updateAwardRaces(league));
  }
  appendNews(league, writeDailyNews(league));
  appendNews(league, officialsNewsFor(league, records));
  for (const rec of records) {
    const recap = recapGame(league, rec);
    if (recap) appendNews(league, [recap]);
    for (const entry of updateRecords(league, rec)) {
      const at = league.records.findIndex((r) => r.key === entry.key);
      if (at >= 0) league.records[at] = entry;
      else league.records.push(entry);
    }
  }
  if (marks.includes('allStar')) {
    // the break: midseason development review plus the all-star honors
    runDevelopmentReview(league, 'midseason');
    for (const award of selectAllStars(league)) league.awards.push(award);
  }
  // the GM desk speaks last in the pulse (FRANCHISE.md §8: after the news
  // desk, "the inbox surfaces what needs the user"), so its items read
  // today's full truth: the AI block's trades, the day's games and
  // injuries, the market's sheets. Human chair only; see inbox.ts.
  for (const item of generateGmInbox(league)) pushInbox(league, item);

  // ---------------------------------------------------- postseason motion
  let newlyScheduled: ScheduledGame[] = [];
  if (league.phase === 'playin' || league.phase === 'playoffs') {
    newlyScheduled = advancePostseason(league);
    routeScheduled(league, newlyScheduled);
  }

  // ----------------------------------------------------- phase transitions
  if (league.phase === 'regular' && marks.includes('lastRegularDay')) {
    league.playin = buildPlayin(league);
    league.phase = 'playin';
  } else if (
    league.phase === 'playin' && league.playin.length > 0
    && league.playin.every((g) => league.results[g.id] !== undefined)
    && newlyScheduled.length === 0
  ) {
    // the mini-tournament settled and scheduled nothing new: bracket time
    league.playoffs = buildFirstRound(league);
    league.phase = 'playoffs';
  } else if (league.phase === 'playoffs') {
    const finals = league.playoffs.find((s) => s.round === 4 && s.winner !== undefined);
    if (finals) {
      // the season's book closes at the horn: ballots and the archive are
      // written once, at this transition
      for (const award of voteSeasonAwards(league)) league.awards.push(award);
      const archive = archiveSeason(league);
      if (archive && !league.archives.some((a) => a.season === archive.season)) league.archives.push(archive);
      // the desk's championship story counts banners from the archives:
      // append AFTER the push so tonight's title is in the count (#111)
      appendNews(league, championshipNews(league));
      league.phase = 'lottery';
    }
  } else if (league.phase === 'lottery') {
    const lotteryIdx = markDay(cal, 'lotteryNight');
    if (league.lottery === null && lotteryIdx >= 0 && league.day >= lotteryIdx) {
      league.lottery = runLottery(league, streamRng(league.seed, 'lottery', league.season));
      // The league year turns here in cap terms: draft-night rookie deals
      // and July signings are season+1 business, priced against season+1
      // lines (cba/contracts.ts signingSeason). Roll them now; the call is
      // idempotent so the rollover backstop stays safe.
      rollCapLines(league, league.season + 1);
      // ...and the league year turns in CONTRACT terms too: deals whose
      // last season just ended release NOW, so this class shops in its
      // own July instead of a year late (a measured defect, Boardman's
      // out-of-scope finding during the build wave)
      releaseExpiredContracts(league, league.season);
      const prospects = generateDraftClass(league, league.season);
      for (const p of prospects) {
        if (!league.players[p.id]) league.players[p.id] = p;
      }
      league.draftClass = prospects.map((p) => p.id);
      runCombine(league);
      // the order story and the class preview print the night the order
      // exists; the daily pulse already ran for today, so append here (#111)
      appendNews(league, lotteryNightNews(league));
      league.phase = 'draft';
    }
  } else if (league.phase === 'draft' && draftIdx >= 0 && league.day >= draftIdx) {
    const done = processDraft(league, draftOrder(league));
    // draft-night selections (and any roster-squeeze waives) land AFTER
    // today's pulse: a second desk pass prints them the night they happen,
    // idempotent by story id (#118)
    appendNews(league, writeDailyNews(league));
    if (!done) return finish(); // the user is on the clock: the day holds
  } else if (league.phase === 'moratorium') {
    const morEnd = markDay(cal, 'moratoriumEnds');
    if (morEnd >= 0 && league.day >= morEnd) league.phase = 'freeAgency';
  }

  // ------------------------------------------------------------- rollover
  if (league.phase === 'freeAgency' && league.day >= cal.length - 1) {
    rolloverSeason(league, digest);
    return finish(); // day already reset to 0 of the new season
  }

  league.day += 1;
  return finish();
}
