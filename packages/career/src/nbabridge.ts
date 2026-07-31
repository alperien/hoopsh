/**
 * nbabridge.ts - the player's seat inside the franchise sim: entry after
 * the draft, my game projection (approach + franchise gameday), player-
 * side contracts and agency, trades-to-me reactions, FA offers, the
 * descent market. OWNER: nba task. STATUS: implemented (build wave B).
 *
 * The franchise league advances through franchise/tick.ts advanceDay;
 * this module wraps career concerns around it. One career week in the
 * NBA phase = params.tick.leagueDaysPerWeek real league days on the
 * caller's sim; the weekly allocation (week.ts resolveAllocation) runs
 * once at the top of the week, exactly the pre-NBA economy.
 *
 * THE APPROACH SWAP (the agreed pattern): on a day my team plays,
 * league.players[me] is swapped for applyApproach(me, card) so the
 * franchise gameday projects MY adjusted tendencies for that game only,
 * and the original object is restored in a finally block. applyApproach
 * shallow-copies only attr and tend, so seasons/health/devLog/awards are
 * SHARED references and every stat row, injury, and dev note written
 * during the day lands durably. Scalar fields written onto the copy
 * during the day (morale pulses, status/contract/rights changes,
 * two-way game counters) plus any in-day attr/tend deltas (the all-star
 * development review) are reconciled back onto the original after the
 * restore, so the swap is loss-free and leak-free both ways.
 *
 * INJURIES: inside the NBA my body rides the franchise injury system
 * natively (I live in league.players; rollPostGameInjuries and
 * advanceRecoveries own the odometer). No career-side injury rolls here.
 * PLAYING HURT: when the card says playingHurt but I carry a franchise
 * injury with remainingDays > 0, the franchise availability logic
 * (gameday healthyPool) sits me anyway; v1 does not fight it. The card
 * is consumed as a DNP grade that night, which the coach note explains.
 *
 * COACH RESET RULES (the ledger continues, the person changes):
 * - New team = new coach = fresh CoachState. Trust re-earns from a
 *   40-55 baseline set by the sampled personality (playersCoach 55,
 *   ridesHotHand 50, systems 45, disciplinarian 40); grades and role
 *   clocks zero.
 * - Personality samples from streamRng(seed, 'career-nba-coach', teamId)
 *   (one int draw). Registered limitation: the stream keys on the team,
 *   so a mid-career replacement bench on the SAME team re-samples the
 *   same personality.
 * - Role at a TEAM change comes from my draft slot: round 1 pick 1-14
 *   (the lottery) starts 'rotation', later first-rounders and round 2
 *   start 'bench', undrafted starts 'garbage'. An FA signing instead
 *   starts at the offer's promisedRole (the promise is the role). A
 *   coach CHANGE on the same team keeps my role (the roster spot does
 *   not evaporate) but resets trust/personality/grades.
 * - The career coach mirrors the franchise coach by name; a franchise
 *   coachChange transaction for my team triggers the reset.
 *
 * DECISION ID CONVENTIONS (applyContractDecision):
 * - 'option:<season>'    my player option for <season>; choices
 *                        'exercise' | 'decline'
 * - 'extension:<season>' rookie-scale extension window open during
 *                        league season <season>; choices 'accept'
 *                        (fair-value terms, built and executed through
 *                        the franchise contract machinery) | 'decline'
 * - 'qo:<season>'        the qualifying offer while restricted in
 *                        league season <season>; choices 'accept'
 *                        (sign the one-year tender) | 'decline'
 * Window events push ONCE per decision id (stable event id
 * 'ev-contract-<decisionId with : replaced by ->'); an unanswered player
 * option rides as exercised at the rollover (franchise convention).
 *
 * OFFER ID CONVENTIONS (buildMyOffers):
 * - NBA offers:    id 'nba:<teamId>:<season>', clubName = the NBA team's
 *                  display name. RouteOffer.kind is a frozen three-way
 *                  enum ('college' | 'euro' | 'nbl') with no NBA arm, so
 *                  NBA offers carry kind 'nbl' as a PLACEHOLDER ONLY:
 *                  the 'nba:' id prefix is authoritative and tick/UI
 *                  resolve NBA-ness from it, never from kind.
 * - Abroad offers: id 'abroad:china:<season>' / 'abroad:euro:<season>',
 *                  kind 'euro' for both (again: the id prefix is
 *                  authoritative; the frozen enum has no 'china' arm).
 *                  China pays inside 1.5x-3x my NBA minimum around
 *                  params.money.chinaSalaryMean; Europe pays
 *                  params.money.euroVetSalaryMean and develops (the
 *                  week economy's coachDevFor prices Euro staffs high).
 * - The offer's years are derived from age at acceptance (27-and-under
 *   3 years, 33-and-over 1 year, else 2), documented here because the
 *   frozen RouteOffer shape carries no years field.
 *
 * MONEY: signings record the deal's first contract year through
 * money.recordEarning using the accrual's own label convention
 * ('<team name>, contract year <season>') so money.accrueSeason's
 * (year, label) dedupe suppresses a double count when the season-end
 * accrual fires for the same year. Later years belong to accrueSeason.
 * Abroad acceptance records nothing here: the abroad accrual pays at
 * the year wrap from the committed offer.
 *
 * TRADE REQUESTS: no CareerState flag field exists, so a pending request
 * is represented in the event log (reason prefixes 'asked out:' /
 * 'trade request withdrawn'); the latest one wins. v1 consequence: the
 * ask weighs on morale (params.nbabridge.requestMoraleCost) and fires a
 * phone-visible event. A real AI-reaction hook (the trade pulse pricing
 * my request) needs a franchise seam and is reported, not faked.
 *
 * Streams (career.seed root; fixed draw counts per call):
 *   career-gm-fill                     persona backfill (shared with
 *                                      tick.ts: first filler wins,
 *                                      second call no-ops)
 *   career-nba-coach:<teamId>          1 int draw (personality)
 *   career-nba-offers:<year>:<week>    5 draws (2 money jitters, 1
 *                                      gaussian, 2 club picks), drawn
 *                                      up front whatever the branch
 */
import { clamp } from '@hoopsh/engine';
import type {
  Contract, DayDigest, FrPlayer, League, SimulateJobs, TeamId, Transaction,
} from '@hoopsh/franchise';
import {
  advanceDay, availableMeans, buildContract, capSheet, executeExtension,
  executeOptionDecision, executeSigning, executeWaive, generatePersona,
  groupMean, maxSalaryFor, minSalaryFor, qualifyingOfferFor, streamRng,
  validateSigning,
} from '@hoopsh/franchise';
import type {
  ApproachCard, CareerState, CoachPersonality, RoleId, RouteOffer, WeekDigest,
} from './types.js';
import { fastSim } from './fastsim.js';
import { applyApproach, planFor } from './approach.js';
import { updateAfterGame } from './trust.js';
import { resolveAllocation } from './week.js';
import { generatePhone } from './phone.js';
import { recordEarning } from './money.js';

// ---------------------------------------------------------------------------
// module constants (conventions and feel; sweepable levers live in params)

const PERSONALITIES: readonly CoachPersonality[] = [
  'playersCoach', 'disciplinarian', 'systems', 'ridesHotHand',
];

/** Fresh-coach trust baseline, 40-55 by personality (header rules). */
const TRUST_BY_PERSONALITY: Record<CoachPersonality, number> = {
  playersCoach: 55, ridesHotHand: 50, systems: 45, disciplinarian: 40,
};

const LOTTERY_PICKS = 14;        // REAL: picks 1-14 are the lottery
const YOUNG_AGE_MAX = 27;        // REAL-ish: mirrors the FA market's term bands (ai/fa.ts)
const OLD_AGE_MIN = 33;          // REAL-ish: 33+ vets sign short
const ABROAD_AGE = 31;           // FEEL: past 31 the overseas money calls even a rostered vet
const ROOM_OFFER_COUNT = 2;      // FEEL: two teams with real space surface concrete numbers
const CHINA_MIN_MULT = 1.5;      // FEEL: docs/CAREER.md descent brief, China pays 1.5-3x my NBA minimum
const CHINA_MAX_MULT = 3;
// Fair-AAV mapping mirrors ai/fa.ts fairAav and the spine's option proxy so
// my market reads the same scale the AI front offices use. The overall here
// is the mean of the six group means (groupMean is the exported seam;
// gameday's abilityScore is not in the barrel), which tracks it closely.
const FAIR_ABILITY_FLOOR = 40;   // FEEL: replacement level on the ability scale
const FAIR_ABILITY_SPAN = 140;   // FEEL: slope of the ability-to-cap-share line
const FAIR_SHARE_MIN = 0.02;     // FEEL: nobody prices below a fringe-minimum share
const FAIR_SHARE_MAX = 0.35;     // REAL: the 35% max tier caps any ask

const GROUPS = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'] as const;

/** Invented clubs, fictional-universe law (docs/CAREER.md decisions). */
const CHINA_CLUBS = ['Shanghai Mariners', 'Beijing Emperors', 'Guangzhou Harbor', 'Chengdu Blaze'];
const EURO_CLUBS = ['Vitoria Basket', 'Pallacanestro Adria', 'BC Ruthenia', 'Olympia Pireo'];

// ---------------------------------------------------------------------------
// small shared helpers

function ok(): { ok: boolean; errors: string[] } { return { ok: true, errors: [] }; }
function deny(...errors: string[]): { ok: boolean; errors: string[] } { return { ok: false, errors }; }

function pushEvent(career: CareerState, kind: CareerState['events'][number]['kind'], reason: string, delta?: number): void {
  career.events.push({
    id: `ev-${kind}-${career.clock.year}w${career.clock.week}-${career.events.length}`,
    clock: { ...career.clock },
    kind,
    reason,
    ...(delta !== undefined ? { delta } : {}),
  });
}

/** Push an event with a STABLE id exactly once (window/dedupe events). */
function pushEventOnce(career: CareerState, id: string, kind: CareerState['events'][number]['kind'], reason: string): boolean {
  if (career.events.some(e => e.id === id)) return false;
  career.events.push({ id, clock: { ...career.clock }, kind, reason });
  return true;
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(Math.round(n / 100_000) / 10).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

function teamName(league: League, teamId: TeamId | null | undefined): string {
  const t = teamId ? league.teams[teamId] : undefined;
  return t ? `${t.city} ${t.name}` : String(teamId ?? 'the team');
}

/** Me in the league pool; null pre-entry (the bridge is post-entry only). */
function leagueMe(career: CareerState): FrPlayer | null {
  return career.league.players[career.me] ?? null;
}

/**
 * Local mirror of cba/contracts.ts signingSeason (not exported through the
 * frozen franchise barrel; reported). Post-finals phases price against the
 * next league year.
 */
function signingSeasonOf(league: League): number {
  switch (league.phase) {
    case 'lottery':
    case 'draft':
    case 'moratorium':
    case 'freeAgency':
    case 'offseason':
      return league.season + 1;
    default:
      return league.season;
  }
}

/** Crude overall: mean of the six group means (see FAIR_* provenance). */
function overallOf(p: FrPlayer): number {
  let sum = 0;
  for (const g of GROUPS) sum += groupMean(p.attr, g);
  return sum / GROUPS.length;
}

/** The cap the market prices against, backstopped for hand-built states. */
function pricingCap(league: League): number {
  const lines = league.capLines[signingSeasonOf(league)] ?? league.capLines[league.season];
  return lines ? lines.cap : league.params.cba.genesisCap;
}

/** A front office's fair-value read of my AAV (mirrors ai/fa.ts fairAav). */
function fairAavOf(league: League, p: FrPlayer): number {
  const raw = (overallOf(p) - FAIR_ABILITY_FLOOR) / FAIR_ABILITY_SPAN;
  const share = Math.min(FAIR_SHARE_MAX, Math.max(FAIR_SHARE_MIN, raw));
  return Math.round(pricingCap(league) * share);
}

// the aging curve and the tape on the market's read of me (fix wave C:
// the measured defect was a declining 30-year-old commanding a third of an
// inflated cap because fairAav priced the sheet with no age or form term)
const AGE_DISCOUNT_START = 28;   // FEEL: the market starts pricing the decline before the sheet shows it
const AGE_DISCOUNT_PER_YEAR = 0.08; // CAL: age 30 offers ~84 percent of sheet-fair, age 32 ~68
const AGE_DISCOUNT_FLOOR = 0.45; // FEEL: name value never prices to zero
const FORM_GP_MIN = 8;
const FORM_PPG_ANCHOR = 12;      // FEEL: the line where the tape neither helps nor hurts
const FORM_FACTOR_MIN = 0.8;
const FORM_FACTOR_MAX = 1.1;

/**
 * What the market pays against the sheet: an age curve (front offices
 * price the decline into multi-year money before the attributes move) and
 * the last real season's tape (points and impact, bounded so a bad year
 * discounts the offer without erasing the resume).
 */
function marketFactorOf(league: League, p: FrPlayer): number {
  const age = league.season - p.bornSeason;
  const ageF = age <= AGE_DISCOUNT_START
    ? 1
    : Math.max(AGE_DISCOUNT_FLOOR, 1 - AGE_DISCOUNT_PER_YEAR * (age - AGE_DISCOUNT_START));
  const played = p.seasons.filter(s => s.gp >= FORM_GP_MIN);
  const last = played[played.length - 1];
  let formF = 1;
  if (last) {
    const ppg = last.pts / last.gp;
    const pm = last.plusMinus / last.gp;
    formF = Math.max(FORM_FACTOR_MIN, Math.min(FORM_FACTOR_MAX,
      1 + (ppg - FORM_PPG_ANCHOR) * 0.01 + pm * 0.01));
  }
  return ageF * formF;
}

/** Contract length by age at signing (header convention; no years on RouteOffer). */
function yearsForAge(age: number): number {
  if (age <= YOUNG_AGE_MAX) return 3;
  if (age >= OLD_AGE_MIN) return 1;
  return 2;
}

/** No career week ever waits on a human chair: backfill AI personas. */
function ensureAiSeats(career: CareerState): void {
  const league = career.league;
  const rng = streamRng(career.seed, 'career-gm-fill');
  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;
    if (team.gm === null) team.gm = generatePersona(rng);
  }
}

// ---------------------------------------------------------------------------
// the coach ledger across teams

/** Role a fresh NBA coach starts me at, from the draft slot (header rules). */
function draftRole(me: FrPlayer): RoleId {
  const d = me.draft;
  if (!d || d.round === 0) return 'garbage';
  if (d.round === 1 && d.pick <= LOTTERY_PICKS) return 'rotation';
  return 'bench';
}

/**
 * Install a fresh CoachState for the bench at teamId (header reset rules).
 * The event explains the reset (pillar 2); the plan derives from the new
 * role + personality through the same planFor every grade reads.
 */
function freshCoach(career: CareerState, teamId: TeamId, role: RoleId, reason: string): void {
  const team = career.league.teams[teamId];
  const rng = streamRng(career.seed, 'career-nba-coach', teamId);
  const personality = PERSONALITIES[rng.int(PERSONALITIES.length)]!;
  career.coach = {
    name: team?.coach.name ?? 'the new coach',
    personality,
    trust: TRUST_BY_PERSONALITY[personality],
    role,
    plan: {
      assertiveness: [0, 100], range: [0, 100], motor: [0, 100],
      defense: [0, 100], playmaking: [0, 100],
    },
    greenLight: false,
    grades: [],
    roleClock: { above: 0, below: 0 },
  };
  career.coach.plan = planFor(career);
  pushEvent(career, 'role',
    `${reason}: ${career.coach.name} runs the bench (${personality}); the ladder starts at ${role}, trust at ${career.coach.trust}`);
}

/**
 * The career coach mirrors the franchise coach by name; a mismatch means a
 * new locker room (draft entry, an offseason signing applied outside the
 * week loop) and resets the ledger. Role from the draft slot (a rookie
 * re-earns everything; a moved vet re-earns too, and the reacting-world
 * invariant promotes a hot player within reactGames).
 */
function ensureNbaCoach(career: CareerState, reason: string): void {
  const teamId = career.nbaTeam;
  if (!teamId) return;
  const team = career.league.teams[teamId];
  const me = leagueMe(career);
  if (!team || !me) return;
  if (career.coach.name === team.coach.name) return;
  freshCoach(career, teamId, draftRole(me), reason);
}

// ---------------------------------------------------------------------------
// the week

/** Whether my team has a game scheduled today (league slate + play-in). */
function dayHasMyGame(league: League, teamId: TeamId): boolean {
  for (const g of league.schedule) {
    if (g.date.season === league.season && g.date.day === league.day
      && (g.home === teamId || g.away === teamId)) return true;
  }
  for (const g of league.playin) {
    if (g.date.season === league.season && g.date.day === league.day
      && (g.home === teamId || g.away === teamId)) return true;
  }
  return false;
}

/**
 * After the restore, fold back everything franchise systems durably wrote
 * onto the swapped copy (header: THE APPROACH SWAP). attr/tend reconcile
 * by DELTA against the projection snapshot so the card's own shift never
 * leaks; scalars assign (the copy started as the original's values).
 */
function reconcileSwap(
  original: FrPlayer, projected: FrPlayer,
  attrBase: FrPlayer['attr'], tendBase: FrPlayer['tend'],
): void {
  for (const k of Object.keys(projected.attr) as Array<keyof FrPlayer['attr']>) {
    const d = projected.attr[k] - attrBase[k];
    if (d !== 0) original.attr[k] = clamp(Math.round(original.attr[k] + d), 0, 100);
  }
  for (const k of Object.keys(projected.tend) as Array<keyof FrPlayer['tend']>) {
    const d = projected.tend[k] - tendBase[k];
    if (d !== 0) original.tend[k] = clamp(Math.round(original.tend[k] + d), 0, 100);
  }
  original.morale = projected.morale;
  original.status = projected.status;
  original.contract = projected.contract;
  original.rights = projected.rights;
  if (projected.twoWayGamesUsed !== undefined) original.twoWayGamesUsed = projected.twoWayGamesUsed;
  if (projected.retiredSeason !== undefined) original.retiredSeason = projected.retiredSeason;
  // seasons, health, devLog, awards are shared references by construction
}

/** Advance one league day with my approach projected onto my real tendencies. */
async function advanceMyGameDay(career: CareerState, sim: SimulateJobs): Promise<DayDigest> {
  const league = career.league;
  const original = league.players[career.me]!;
  const card: ApproachCard & { playingHurt?: boolean } = career.nextApproach ?? { ...career.approach };
  const projected = applyApproach(original, card, career.params);
  const attrBase = { ...projected.attr };
  const tendBase = { ...projected.tend };
  league.players[career.me] = projected;
  try {
    return await advanceDay(league, sim);
  } finally {
    league.players[career.me] = original; // the swap never leaks
    reconcileSwap(original, projected, attrBase, tendBase);
  }
}

/** React to today's ledger: trades of me, waives, upstairs option calls, bench changes. */
function reactToTransactions(career: CareerState, txStart: number): void {
  const league = career.league;
  const fresh: Transaction[] = league.transactions.slice(txStart);
  for (const tx of fresh) {
    if (tx.kind === 'trade') {
      const move = tx.players.find(m => m.playerId === career.me);
      if (!move) continue;
      const from = teamName(league, move.from);
      const to = teamName(league, move.to);
      career.nbaTeam = move.to;
      pushEvent(career, 'transaction', `traded: ${from} to ${to}; new locker, new math`);
      const me = leagueMe(career);
      if (me) freshCoach(career, move.to, draftRole(me), 'traded in');
    } else if (tx.kind === 'waive' && tx.playerId === career.me) {
      pushEvent(career, 'transaction', `waived by ${teamName(league, tx.teamId)}; the market is the message`);
      career.nbaTeam = null;
    } else if (tx.kind === 'optionDecision' && tx.playerId === career.me) {
      // team options are the club's call; a PLAYER option resolving here
      // means the franchise AI pass decided over my head (defect reported:
      // ai/fa.ts runAiOffseasonDecisions lacks the careerControlled skip)
      pushEvent(career, 'contract', tx.option === 'team'
        ? `the club ${tx.exercised ? 'picked up' : 'declined'} the team option (${teamName(league, tx.teamId)})`
        : `the player option resolved ${tx.exercised ? 'in' : 'out'} upstairs before the phone rang`);
    } else if (tx.kind === 'coachChange' && tx.teamId === career.nbaTeam) {
      // same team, new bench: role survives, trust re-earns (header rules)
      freshCoach(career, tx.teamId, career.coach.role, 'the bench turned over');
    }
  }
}

/** Grade my team's finished games from the day digest; pay the legs. */
function gradeMyGames(career: CareerState, gameIds: string[], digest: WeekDigest): void {
  const teamId = career.nbaTeam;
  if (!teamId) return;
  const league = career.league;
  for (const id of gameIds) {
    const record = league.results[id];
    if (!record || (record.home !== teamId && record.away !== teamId)) continue;
    digest.gamesPlayed.push(id);
    const line = record.lines.find(l => l.playerId === career.me);
    updateAfterGame(career, record); // DNPs grade as 'nothing to grade' by design
    if (line && line.min > 0) {
      // the game bill mirrors week.ts: only minutes played drain the tank
      career.energy = clamp(Math.round(career.energy - career.params.week.gameEnergyCost), 0, 100);
    }
  }
}

/**
 * Surface my pending contract decisions once per window (header decision
 * id conventions). Pure detection: the answers arrive through
 * applyContractDecision; unanswered options ride as exercised at the
 * rollover (franchise convention, stated in the event).
 */
function detectContractWindows(career: CareerState): void {
  const league = career.league;
  const me = leagueMe(career);
  if (!me) return;

  // restricted summer: the qualifying offer is on the table
  if (me.status === 'freeAgent' && me.rights?.restricted && me.rights.qualifyingOffer !== undefined) {
    const id = `qo:${league.season}`;
    pushEventOnce(career, `ev-contract-${id.replace(':', '-')}`, 'contract',
      `restricted summer: the qualifying offer sits at ${fmtMoney(me.rights.qualifyingOffer)} for one year; take the tender or test the sheets (decision ${id})`);
  }

  const c = me.contract;
  if (!c) return;

  // my player option for the incoming league year
  const next = signingSeasonOf(league);
  if (next > league.season) {
    const year = c.years.find(y => y.playerOption === true && y.season === next);
    if (year) {
      const id = `option:${next}`;
      pushEventOnce(career, `ev-contract-${id.replace(':', '-')}`, 'contract',
        `the player option is live: ${fmtMoney(year.salary)} for ${next} is mine to take or leave; silence rides as opting in (decision ${id})`);
    }
  }

  // rookie-scale extension window, extensionWindowDays before season end
  if (c.kind === 'rookieScale'
    && league.season - c.signedOn.season >= 2
    && league.calendar.length > 0
    && league.day >= league.calendar.length - career.params.nbabridge.extensionWindowDays) {
    const id = `extension:${league.season}`;
    pushEventOnce(career, `ev-contract-${id.replace(':', '-')}`, 'contract',
      `extension window: the club can extend the rookie deal now or let the restricted summer decide it (decision ${id})`);
  }
}

/**
 * The natural fade (the descent, played honestly): unsigned into camp
 * with nothing above two-way money on the table. One event per season;
 * the phone dramatizes, the abroad offers stay live in buildMyOffers.
 */
function detectTheFade(career: CareerState): void {
  const league = career.league;
  const me = leagueMe(career);
  if (!me || me.status !== 'freeAgent') return;
  if (league.phase !== 'camp' && league.phase !== 'regular') return;
  if (overallOf(me) >= career.params.nbabridge.nbaMarketFloor) return;
  pushEventOnce(career, `ev-phase-fade-${league.season}`, 'phase',
    'camp opened and the league never called above two-way money: the descent is a door, not a cliff; China and Europe pay real money');
}

/**
 * Resolve one NBA-phase week: the allocation once up top, then
 * params.tick.leagueDaysPerWeek real league days on the caller's sim,
 * with the approach swap wrapped tightly around advanceDay on my game
 * days. Grades, energy, trades-to-me, contract windows, and the phone
 * all fold into the digest. Mutates; tick.ts owns the career clock.
 */
export async function resolveNbaWeek(career: CareerState, sim: SimulateJobs): Promise<WeekDigest> {
  const league = career.league;
  if (!leagueMe(career)) {
    throw new Error('career/nbabridge: I am not in league.players (resolveNbaWeek is post-entry only)');
  }
  const digest: WeekDigest = {
    clock: { ...career.clock },
    gamesPlayed: [],
    messages: [],
    events: [],
    energy: career.energy,
  };
  const eventsBefore = career.events.length;

  ensureAiSeats(career);                       // no week waits on a human chair
  ensureNbaCoach(career, 'a new locker room'); // draft entry / offseason moves
  resolveAllocation(career);                   // the week economy, once, up top

  for (let d = 0; d < career.params.tick.leagueDaysPerWeek; d++) {
    const txStart = league.transactions.length;
    const playsToday = career.nbaTeam !== null
      && leagueMe(career) !== null
      && dayHasMyGame(league, career.nbaTeam);
    const dayDigest = playsToday
      ? await advanceMyGameDay(career, sim)
      : await advanceDay(league, sim);
    reactToTransactions(career, txStart);
    gradeMyGames(career, dayDigest.games, digest);
  }

  detectContractWindows(career);
  detectTheFade(career);

  const msgs = generatePhone(career);
  for (const m of msgs) {
    if (!career.phone.some(x => x.id === m.id)) {
      career.phone.push(m);
      digest.messages.push(m.id);
    }
  }

  digest.events = career.events.slice(eventsBefore).map(e => e.id);
  digest.energy = career.energy;
  return digest;
}

/** Advance the league N days on the internal fast sim (pre-entry world, register C11). */
export async function advanceLeagueFast(career: CareerState, days: number): Promise<void> {
  for (let i = 0; i < days; i++) {
    await advanceDay(career.league, fastSim);
  }
}

// ---------------------------------------------------------------------------
// my market

/** Role an offer's money reads as (FEEL bands on the exception scale). */
function roleForMoney(league: League, money: number, min: number): RoleId {
  const mle = Math.round(pricingCap(league) * league.params.cba.mlePctOfCap);
  if (money >= mle) return 'starter';
  if (money >= 2 * min) return 'rotation';
  return 'bench';
}

function nbaOffer(league: League, teamId: TeamId, season: number, money: number, role: RoleId, expiresWeek: number): RouteOffer {
  const team = league.teams[teamId]!;
  return {
    id: `nba:${teamId}:${season}`,
    kind: 'nbl', // PLACEHOLDER: the 'nba:' id prefix is authoritative (file header)
    clubName: `${team.city} ${team.name}`,
    money,
    coachDev: team.coach.devQuality,
    promisedRole: role,
    style: { pace: team.coach.pace, threeBias: team.coach.threeBias },
    expiresWeek,
  };
}

/** The contender whose minimum call always comes: best record, then timeline, then id. */
function pickContender(league: League, exclude: Set<TeamId>): TeamId | null {
  let best: TeamId | null = null;
  let bestKey = -1;
  for (const tid of Object.keys(league.teams).sort()) {
    if (exclude.has(tid)) continue;
    const s = league.standings[tid];
    const gp = s ? s.w + s.l : 0;
    const pct = gp > 0 ? s!.w / gp : 0.5;
    const key = pct + (league.teams[tid]!.strategy.timeline === 'contend' ? 0.1 : 0);
    if (key > bestKey) {
      bestKey = key;
      best = tid;
    }
  }
  return best;
}

/**
 * My concrete FA offers when I hit the market (career-side market view).
 * Deterministic per (career, year, week): teams with room and a need
 * offer near my fair value, a contender always floats the minimum, and
 * below the market floor only two-way money calls. The descent doors
 * (China, Europe) open when NBA interest is thin or age passes 31.
 * Pure view: recomputed on demand, applied through applyNbaOffer /
 * applyAbroadOffer. Conventions in the file header.
 */
export function buildMyOffers(career: CareerState): RouteOffer[] {
  const league = career.league;
  const me = leagueMe(career);
  if (!me || me.status !== 'freeAgent') return [];

  const season = signingSeasonOf(league);
  const rng = streamRng(career.seed, 'career-nba-offers', career.clock.year, career.clock.week);
  // fixed draw block: every call draws the same count whatever the branch
  const jitterA = rng.range(0.9, 1.1);
  const jitterB = rng.range(0.85, 1.05);
  const chinaN = rng.gaussian(0, 1);
  const chinaClub = CHINA_CLUBS[rng.int(CHINA_CLUBS.length)]!;
  const euroClub = EURO_CLUBS[rng.int(EURO_CLUBS.length)]!;

  const value = overallOf(me);
  const min = minSalaryFor(league, me);
  const max = maxSalaryFor(league, me);
  const fair = Math.round(fairAavOf(league, me) * marketFactorOf(league, me));
  const age = league.season - me.bornSeason;
  const expires = career.clock.week + career.params.recruiting.offerWindowWeeks;
  const sheetSeason = league.capLines[season] ? season : league.season;
  const out: RouteOffer[] = [];
  const offering = new Set<TeamId>();

  if (value >= career.params.nbabridge.nbaMarketFloor) {
    // teams with real room, richest first (need is priced into the jitter band)
    const room = Object.keys(league.teams).sort()
      .map(tid => ({ tid, space: capSheet(league, tid, sheetSeason).spaceWithHolds }))
      .filter(t => t.space >= min)
      .sort((a, b) => b.space - a.space || (a.tid < b.tid ? -1 : 1));
    const jitters = [jitterA, jitterB];
    for (let i = 0; i < Math.min(ROOM_OFFER_COUNT, room.length); i++) {
      const { tid, space } = room[i]!;
      const money = Math.max(min, Math.min(Math.round(fair * jitters[i]!), space, max));
      out.push(nbaOffer(league, tid, season, money, roleForMoney(league, money, min), expires));
      offering.add(tid);
    }
    // the contender's minimum: always one call from a winner
    const contender = pickContender(league, offering);
    if (contender) {
      out.push(nbaOffer(league, contender, season, min, 'bench', expires));
      offering.add(contender);
    }
  } else {
    // below replacement: two-way / camp-flyer money only, thinnest roster calls
    const thin = Object.keys(league.teams).sort(
      (a, b) => league.teams[a]!.roster.length - league.teams[b]!.roster.length || (a < b ? -1 : 1),
    )[0];
    if (thin) {
      const rookieMin = Math.round(pricingCap(league) * league.params.cba.minSalaryPctByYos[0]!);
      const twoWay = Math.round(rookieMin * league.params.cba.twoWaySalaryPctOfRookieMin);
      out.push(nbaOffer(league, thin, season, twoWay, 'garbage', expires));
      offering.add(thin);
    }
  }

  // the descent doors: thin NBA interest or the age line
  const thinInterest = value < career.params.nbabridge.nbaMarketFloor || out.length <= 1;
  if (thinInterest || age > ABROAD_AGE) {
    const m = career.params.money;
    const chinaMoney = Math.round(clamp(
      m.chinaSalaryMean + chinaN * m.chinaSalarySd,
      CHINA_MIN_MULT * min, CHINA_MAX_MULT * min,
    ));
    out.push({
      id: `abroad:china:${season}`,
      kind: 'euro', // PLACEHOLDER: the 'abroad:china:' id prefix is authoritative (file header)
      clubName: chinaClub,
      money: Math.max(1, chinaMoney),
      coachDev: 40, // mirrors week.ts coachDevFor: the money years are not a classroom
      promisedRole: 'featured',
      style: { pace: 60, threeBias: 55 },
      expiresWeek: expires,
    });
    out.push({
      id: `abroad:euro:${season}`,
      kind: 'euro',
      clubName: euroClub,
      money: m.euroVetSalaryMean,
      coachDev: 64, // mirrors week.ts coachDevFor: Europe teaches best if you survive it
      promisedRole: 'rotation',
      style: { pace: 44, threeBias: 45 },
      expiresWeek: expires,
    });
  }

  return out.slice(0, career.params.nbabridge.faOfferCount);
}

// ---------------------------------------------------------------------------
// choice application seams (tick.ts routes here; never throw for a bad id,
// return { ok: false, errors } instead)

/**
 * A pending contract decision answered (extension, option, qualifying
 * offer). Decision id and choice conventions in the file header. All
 * mutations go through the franchise executors (executeOptionDecision,
 * executeExtension, executeSigning) so cap and ledger truth stay
 * franchise-owned; executor throws surface as errors, never as throws.
 */
export function applyContractDecision(career: CareerState, decisionId: string, choiceId: string): { ok: boolean; errors: string[] } {
  const league = career.league;
  const me = leagueMe(career);
  if (!me) return deny('no league contract file to decide on yet');
  const [kind, seasonStr] = decisionId.split(':');
  const season = Number(seasonStr);
  if (!kind || !Number.isFinite(season)) return deny(`malformed decision id '${decisionId}'`);

  try {
    if (kind === 'option') {
      if (choiceId !== 'exercise' && choiceId !== 'decline') return deny(`option decisions take 'exercise' or 'decline', not '${choiceId}'`);
      const c = me.contract;
      const year = c?.years.find(y => y.playerOption === true && y.season === season);
      if (!c || !year) return deny(`no live player option for ${season}`);
      const exercised = choiceId === 'exercise';
      executeOptionDecision(league, c.teamId, career.me, 'player', exercised);
      pushEvent(career, 'contract', exercised
        ? `opted in: ${fmtMoney(year.salary)} for ${season} stays on the books (${teamName(league, c.teamId)})`
        : `opted out: ${fmtMoney(year.salary)} left on the table; betting on the market`);
      return ok();
    }

    if (kind === 'extension') {
      if (choiceId !== 'accept' && choiceId !== 'decline') return deny(`extension decisions take 'accept' or 'decline', not '${choiceId}'`);
      const c = me.contract;
      if (!c || c.kind !== 'rookieScale') return deny('no rookie-scale deal to extend');
      if (league.season - c.signedOn.season < 2) return deny('the extension window opens after year three of the rookie deal');
      if (season !== league.season) return deny(`that extension window (${season}) is not this season's (${league.season})`);
      if (choiceId === 'decline') {
        pushEvent(career, 'contract', 'passed on the extension: the qualifying offer year and the restricted summer come into view');
        return ok();
      }
      // fair-value terms; validateSigning rejects the 'extension' means by
      // design (extensions flow through their own executor), so the bounds
      // are enforced here and buildContract + executeExtension do the rest.
      // Franchise register X4 applies: the extension replaces future years.
      const start = Math.min(
        Math.max(Math.round(fairAavOf(league, me) * marketFactorOf(league, me)), minSalaryFor(league, me)),
        maxSalaryFor(league, me));
      const years = 4; // REAL-ish: the standard rookie-extension shape
      const contract = buildContract(league, c.teamId, career.me, { years, startSalary: start }, 'extension');
      executeExtension(league, c.teamId, career.me, contract);
      const first = contract.years[0]!;
      pushEvent(career, 'contract',
        `extended: ${years}y starting at ${fmtMoney(start)} (${teamName(league, c.teamId)}); the rookie deal's future years fold into it`);
      recordEarning(career, career.clock.year, `${league.teams[c.teamId]?.name ?? c.teamId}, contract year ${first.season}`, first.salary);
      return ok();
    }

    if (kind === 'qo') {
      if (choiceId !== 'accept' && choiceId !== 'decline') return deny(`qualifying offer decisions take 'accept' or 'decline', not '${choiceId}'`);
      if (me.status !== 'freeAgent' || !me.rights?.restricted) return deny('no qualifying offer is on the table');
      if (choiceId === 'decline') {
        pushEvent(career, 'contract', 'declined the qualifying offer year; restricted market it is, sheets and all');
        return ok();
      }
      const rightsTeam = me.rights.teamId;
      const qo = me.rights.qualifyingOffer ?? qualifyingOfferFor(league, career.me);
      const terms = { years: 1, startSalary: qo };
      const means = availableMeans(league, rightsTeam, career.me, terms)[0];
      if (!means) {
        return deny(...validateSigning(league, rightsTeam, career.me, terms, 'bird').errors);
      }
      executeSigning(league, rightsTeam, career.me, buildContract(league, rightsTeam, career.me, terms, means));
      career.nbaTeam = rightsTeam;
      ensureNbaCoach(career, 'back on the tender');
      const first = leagueMe(career)!.contract!.years[0]!;
      pushEvent(career, 'contract',
        `signed the qualifying offer: 1y ${fmtMoney(qo)} (${teamName(league, rightsTeam)}); unrestricted next summer`);
      recordEarning(career, career.clock.year, `${league.teams[rightsTeam]?.name ?? rightsTeam}, contract year ${first.season}`, first.salary);
      return ok();
    }
  } catch (err) {
    return deny(err instanceof Error ? err.message : String(err));
  }

  return deny(`unknown decision '${decisionId}'`);
}

/**
 * Accept one of buildMyOffers' NBA offers (undrafted or FA market).
 * Signs through the franchise validators/executors; a two-way tier offer
 * (money under my minimum) signs as a real two-way contract. Restricted
 * simplification (registered): accepting an outside offer while holding
 * a tender signs directly, no offer-sheet match window on me in v1.
 */
export function applyNbaOffer(career: CareerState, offerId: string): { ok: boolean; errors: string[] } {
  const league = career.league;
  const me = leagueMe(career);
  if (!me) return deny('the league has no file on me yet (offers come after draft entry)');
  const parts = offerId.split(':');
  if (parts.length !== 3 || parts[0] !== 'nba') return deny(`malformed NBA offer id '${offerId}'`);
  const teamId = parts[1]! as TeamId;
  if (!league.teams[teamId]) return deny(`unknown team '${teamId}'`);
  if (me.status !== 'freeAgent') return deny('only a free agent signs off the market');

  try {
    const offer = buildMyOffers(career).find(o => o.id === offerId);
    if (!offer) return deny('that offer is not on the table this week');
    const age = league.season - me.bornSeason;
    const min = minSalaryFor(league, me);
    const start = signingSeasonOf(league);

    if (offer.money < min) {
      // two-way tier: a real two-way contract through the signing executor
      const contract: Contract = {
        id: `ct-${career.me}-s${league.season}d${league.day}-twoway`,
        playerId: career.me,
        teamId,
        years: [{ season: start, salary: offer.money, guaranteed: 0 }],
        kind: 'twoWay',
        means: 'minimum',
        signedOn: { season: league.season, day: league.day },
        birdYearsAtSigning: 0,
      };
      executeSigning(league, teamId, career.me, contract);
    } else {
      const terms = { years: yearsForAge(age), startSalary: offer.money };
      let means = availableMeans(league, teamId, career.me, terms)[0];
      let finalTerms = terms;
      if (!means) {
        // the room moved since the offer printed: the minimum ladder rung
        finalTerms = { years: 1, startSalary: min };
        means = availableMeans(league, teamId, career.me, finalTerms)[0];
      }
      if (!means) return deny(...validateSigning(league, teamId, career.me, terms, 'capSpace').errors);
      executeSigning(league, teamId, career.me, buildContract(league, teamId, career.me, finalTerms, means));
    }

    const teamChanged = career.nbaTeam !== teamId;
    career.nbaTeam = teamId;
    if (career.clock.phase !== 'nba') {
      if (career.circuit && !career.circuit.complete) {
        career.circuit = null; // the league call outranks the season abroad
        pushEvent(career, 'phase', 'left the overseas season mid-book: the league called');
      }
      career.clock.phase = 'nba';
      pushEvent(career, 'phase', `the market said yes: ${teamName(league, teamId)}`);
    }
    delete career.players[career.me]; // one pool: post-entry I live in league.players
    if (teamChanged || career.coach.name !== league.teams[teamId]!.coach.name) {
      freshCoach(career, teamId, offer.promisedRole, 'signed off the market');
    }
    const signed = leagueMe(career)!.contract!;
    const first = signed.years[0]!;
    pushEvent(career, 'contract',
      `signed: ${teamName(league, teamId)}, ${signed.years.length}y starting at ${fmtMoney(first.salary)} (${offer.promisedRole} role promised)`);
    recordEarning(career, career.clock.year, `${league.teams[teamId]!.name}, contract year ${first.season}`, first.salary);
    return ok();
  } catch (err) {
    return deny(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Accept an abroad offer (the descent: China, Europe). Moves phase; the
 * circuit machinery takes over from tick. The accepted offer commits
 * into career.recruiting so the abroad accrual (money.accrueSeason) pays
 * the deal's salary at the year wrap and the circuit can carry the club
 * name. If a contract binds me, the club releases me franchise-style
 * (executeWaive: the buyout reads as dead money on their books,
 * registered simplification). careerControlled stays: my life decisions
 * remain mine, and the league keeps my file for the road back.
 */
export function applyAbroadOffer(career: CareerState, offerId: string): { ok: boolean; errors: string[] } {
  const league = career.league;
  const me = leagueMe(career);
  if (!me) return deny('the abroad fork opens after league entry (pre-draft routes go through recruiting)');
  const parts = offerId.split(':');
  if (parts.length !== 3 || parts[0] !== 'abroad' || (parts[1] !== 'china' && parts[1] !== 'euro')) {
    return deny(`malformed abroad offer id '${offerId}'`);
  }
  if (career.clock.phase !== 'nba') return deny('the descent forks from the NBA phase');
  const dest = parts[1];
  let offer: RouteOffer | undefined;
  try {
    offer = buildMyOffers(career).find(o => o.id === offerId);
    if (!offer) return deny('that offer is not on the table this week');
    if (me.contract && me.status === 'roster') {
      executeWaive(league, me.contract.teamId, career.me, false);
      // the waive transaction reads 'the market is the message' in the day
      // loop; here the message is mine: I chose the door
    }
  } catch (err) {
    return deny(err instanceof Error ? err.message : String(err));
  }
  if (!offer) return deny('that offer is not on the table this week'); // narrowing guard; handled above

  career.nbaTeam = null;
  career.circuit = null;
  career.clock.phase = dest === 'china' ? 'china' : 'euro';
  // commit the deal where the accrual and the circuit builder read it
  if (!career.recruiting) career.recruiting = { programs: [], interest: [], offers: [] };
  career.recruiting.offers.push(offer);
  career.recruiting.committedTo = offer.id;
  // I stay in league.players (history, the road back); the circuit
  // machinery reads career.players, so the SAME object rides both pools.
  // Registered hazard: a JSON save during an abroad phase must rebind the
  // two references on load or they fork (app-layer note).
  career.players[career.me] = me;
  pushEvent(career, 'phase', dest === 'china'
    ? `took the CBA money: ${offer.clubName}, ${fmtMoney(offer.money)} a season; gaudy stat lines, short season`
    : `signed abroad: ${offer.clubName}, ${fmtMoney(offer.money)} a season; the Euro game teaches`);
  return ok();
}

/**
 * Raise or withdraw my trade request; the team reacts on its own clock.
 * v1 (registered): the request lives in the event log (no CareerState
 * flag field exists), weighs on morale by params.nbabridge
 * .requestMoraleCost, and is phone-visible; actual trades still happen
 * organically through the AI pulse. A real AI-reaction hook (the pulse
 * pricing my request) needs a franchise seam and is reported, not faked.
 */
export function setTradeRequest(career: CareerState, on: boolean): { ok: boolean; errors: string[] } {
  const league = career.league;
  const me = leagueMe(career);
  if (career.clock.phase !== 'nba' || !career.nbaTeam || !me) return deny('there is no team to ask out of');
  if (me.status !== 'roster' && me.status !== 'gleague') return deny('only a rostered player files a request');

  // the latest request/withdrawal in the event log is the pending truth
  let pending = false;
  for (let i = career.events.length - 1; i >= 0; i--) {
    const r = career.events[i]!.reason;
    if (r.startsWith('asked out:')) { pending = true; break; }
    if (r.startsWith('trade request withdrawn')) { pending = false; break; }
  }
  if (on && pending) return deny('the request is already on the record');
  if (!on && !pending) return deny('no request to withdraw');

  const cost = career.params.nbabridge.requestMoraleCost;
  if (on) {
    me.morale = clamp(me.morale - cost, 0, 100);
    pushEvent(career, 'transaction', `asked out: a trade request is on the record with ${teamName(league, career.nbaTeam)}; the room knows`);
    pushEvent(career, 'morale', 'the ask weighs: playing nights in a building you asked to leave', -cost);
  } else {
    me.morale = clamp(me.morale + cost, 0, 100);
    pushEvent(career, 'transaction', 'trade request withdrawn: heads down, back to work');
    pushEvent(career, 'morale', 'the air cleared: the request is off the record', cost);
  }
  return ok();
}
