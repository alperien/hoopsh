/**
 * ai/fa.ts - the free-agency market. OWNER: ai-team task.
 *
 * A market, not a lottery (docs/FRANCHISE.md 7; research 01 Q2/Q5: bid-based
 * free agency is the community's standing ask): players get decision days
 * from their market rank (stars first, the mid-tier scramble, a long tail of
 * minimums and camp deals), AI teams with a need bid real dollars through
 * the same validators the user faces, and the player weighs money, role,
 * winning, market size, and the incumbent's pull through his own
 * disposition. Restricted free agents route through offer sheets; the spine
 * auto-resolves expired match windows (tick.ts).
 *
 * Phases: the market ACTS only in 'freeAgency'. The moratorium is news-only
 * by real-league design (deals are agreed in smoke, nothing signs; the
 * rumor mill may read negotiation state, this module stages none in v1).
 *
 * Determinism: all randomness from the registered 'fa:<season>:<day>'
 * stream, one Rng per day, consumed in a fixed iteration order (market rank,
 * then team id). Decision days are pure functions of the market class, which
 * INCLUDES players already signed this window (their rank is not recycled;
 * without that, every top signing would stampede the tail forward).
 */
import type {
  FrPlayer, League, PlayerId, SigningMeans, TeamId, Transaction,
} from '../types.js';
import { streamRng } from '../rng.js';
import {
  availableMeans, buildContract, maxSalaryFor, minSalaryFor,
  qualifyingOfferFor, reservedSheetSpots, signingSeason, validateSigning,
} from '../cba/contracts.js';
import type { SigningTerms } from '../cba/contracts.js';
import { capSheet } from '../cba/cap.js';
import { executeOptionDecision, executeSigning } from '../transactions.js';
import { abilityScore } from './roster.js';

// Market texture constants: conventions of how the market clears, kept here
// with provenance (the calibratable weights/pace levers live in params.fa).
const STAR_TIER_FRACTION = 0.10; // FEEL: the top decile of the class are the board-setters who sign in the opening days
const SLIP_CHANCE = 0.25;        // FEEL: small seeded jitter; about a quarter of decision days slip while an agent waits on one more call
const YOUNG_AGE_MAX = 27;        // REAL-ish: 27-and-under free agents command term (3-4 years)
const OLD_AGE_MIN = 33;          // REAL-ish: 33+ vets sign short (1-2 years)
const POS_STOCK_TARGET = 3;      // FEEL: a 15-man roster carries about 3 bodies per position; fewer reads as a need
const CONTEND_VET_AGE = 27;      // FEEL: a contender's FA shopping skews to ready-now vets
const REBUILD_KID_AGE = 24;      // FEEL: a rebuilder collects youth
const REBUILD_PASS_AGE = 30;     // FEEL: a rebuilder passes on 30+ vets (minutes belong to the kids)
// Fair-AAV mapping mirrors the spine's option-value proxy (tick.ts
// perceivedOptionValue) so both sides of the books read the same scale:
// ability 40 prices as a fringe minimum near 2% of cap, 89+ as a max-tier 35%.
const FAIR_ABILITY_FLOOR = 40;   // FEEL: replacement level on the ability scale
const FAIR_ABILITY_SPAN = 140;   // FEEL: slope of the ability-to-cap-share line
const FAIR_SHARE_MIN = 0.02;     // FEEL: nobody prices below a fringe-minimum share
const FAIR_SHARE_MAX = 0.35;     // REAL: the 35% max tier is the ceiling of any ask
/** FEEL: how a player's agent scores a franchise's timeline as a winning destination. */
const WINNING_BY_TIMELINE: Record<'contend' | 'retool' | 'rebuild', number> = {
  contend: 1.0, retool: 0.55, rebuild: 0.15,
};
const DEFAULT_MARKET = 50;       // FEEL: unlisted market reads mid-sized

/**
 * FEEL: coarse market-size tiers (0-100) for the FA decision's market term,
 * loosely ordered on metro size; the league-lore markets (cas, mer) read
 * small on purpose. An inline table, not params: this is world flavor, not
 * a calibration lever.
 */
const MARKET_SIZE: Record<TeamId, number> = {
  nye: 100, bka: 100, las: 100, chi: 88, sfo: 85, tor: 85, dal: 82, hou: 82,
  phi: 80, atl: 78, bos: 78, mia: 78, was: 76, phx: 72, sea: 72, det: 70,
  den: 66, min: 62, lvs: 60, orl: 58, por: 55, cha: 55, cle: 55, ind: 52,
  sac: 52, mil: 48, nol: 45, cas: 45, uta: 42, mer: 40,
};

/** The day free agency opens: the day after the moratoriumEnds mark (hand-built calendars without marks open at day 0). */
function faOpenDay(league: League): number {
  const idx = league.calendar.findIndex((d) => (d.marks as string[]).includes('moratoriumEnds'));
  return idx >= 0 ? idx + 1 : 0;
}

/** Cap the market prices against: the signing season's line, backstopped for hand-built states. */
function pricingCap(league: League): number {
  const lines = league.capLines[signingSeason(league)] ?? league.capLines[league.season];
  return lines ? lines.cap : league.params.cba.genesisCap;
}

/**
 * A front office's fair-value read of a player's AAV: ability mapped onto
 * the salary scale (see the FAIR_* provenance block). Deterministic; the
 * winner's-curse jitter is applied by the bidder, not here.
 */
function fairAav(league: League, player: FrPlayer): number {
  const raw = (abilityScore(player) - FAIR_ABILITY_FLOOR) / FAIR_ABILITY_SPAN;
  const share = Math.min(FAIR_SHARE_MAX, Math.max(FAIR_SHARE_MIN, raw));
  return Math.round(pricingCap(league) * share);
}

/**
 * The season's market class, rank-ordered by ability: everyone currently
 * unsigned PLUS everyone who already signed inside this window (they keep
 * their rank so the tail's decision days stay put as the board clears).
 */
function marketClass(league: League, open: number): FrPlayer[] {
  const ids = new Set<PlayerId>();
  for (const id of league.freeAgents) {
    if (league.players[id]?.status === 'freeAgent') ids.add(id);
  }
  for (const tx of league.transactions) {
    if (tx.kind === 'signing' && tx.date.season === league.season && tx.date.day >= open) {
      ids.add(tx.playerId);
    }
  }
  return [...ids]
    .map((id) => league.players[id])
    .filter((p): p is FrPlayer => p !== undefined)
    .sort((a, b) => abilityScore(b) - abilityScore(a) || (a.id < b.id ? -1 : 1));
}

/**
 * The market tail's length in ACTUAL calendar days: params.fa.marketTailDays
 * compressed into whatever freeAgency window the calendar really has (the
 * real league's dead August and September compress into the rollover,
 * calendar.ts header), so the tail always clears before the season closes
 * (the acceptance gates forbid unsigned pileups at rollover). Hand-built
 * test leagues without a calendar use the params value as-is.
 */
function tailDaysFor(league: League, open: number): number {
  const tail = league.params.fa.marketTailDays;
  if (league.calendar.length === 0) return tail;
  return Math.max(1, Math.min(tail, league.calendar.length - 1 - open));
}

/**
 * Base decision day for a market rank: the top STAR_TIER_FRACTION of the
 * class decides inside params.fa.starsSignByDay; the tail spreads evenly
 * over the rest of the tail window (the September camp-deal drift lives at
 * the far end).
 */
function baseDecisionDay(league: League, rank: number, count: number, open: number, tailDays: number): number {
  const fa = league.params.fa;
  const stars = Math.max(1, Math.round(count * STAR_TIER_FRACTION));
  const signBy = Math.min(fa.starsSignByDay, tailDays); // a tiny window still clears stars first
  if (rank < stars) return open + Math.floor((rank * signBy) / stars);
  const tailSpan = Math.max(1, tailDays - signBy);
  const tailCount = Math.max(1, count - stars);
  return open + signBy + Math.floor(((rank - stars) * tailSpan) / tailCount);
}

/** Contract length by age: prime years command term, the old sign short. */
function yearsForAge(age: number, roll: number): number {
  // roll is 0 or 1 from the day stream: the low or high end of the age band
  if (age <= YOUNG_AGE_MAX) return 3 + roll; // 3-4 years
  if (age >= OLD_AGE_MIN) return 1 + roll;   // 1-2 years
  return 2 + roll;                            // 2-3 years in between
}

/**
 * Whether this AI team wants this free agent at all: position scarcity,
 * the roster floor, and timeline fit. Zero or below = no call is made.
 */
function needScore(league: League, teamId: TeamId, player: FrPlayer): number {
  const team = league.teams[teamId]!;
  let score = 0;
  let atPos = 0;
  for (const id of team.roster) {
    if (league.players[id]?.pos === player.pos) atPos += 1;
  }
  score += Math.max(0, POS_STOCK_TARGET - atPos);
  if (team.roster.length < league.params.cba.rosterMin) score += 1;
  const age = league.season - player.bornSeason;
  const timeline = team.strategy.timeline;
  if (timeline === 'contend' && age >= CONTEND_VET_AGE) score += 1;
  if (timeline === 'rebuild' && age <= REBUILD_KID_AGE) score += 1;
  if (timeline === 'rebuild' && age >= REBUILD_PASS_AGE) score -= 1;
  return score;
}

interface MarketBid {
  teamId: TeamId;
  terms: SigningTerms;
  means: SigningMeans;
  incumbent: boolean;
}

/**
 * The best LEGAL terms a team can put on the table at (or under) its target
 * AAV: try the target, then the MLE line, then the minimum, shortening
 * years when a means demands it. Bounded ladder; null when nothing is legal
 * (hard-capped, roster full, and so on).
 */
function bestLegalTerms(
  league: League, teamId: TeamId, player: FrPlayer, targetAav: number, years: number,
): { terms: SigningTerms; means: SigningMeans } | null {
  const min = minSalaryFor(league, player);
  const max = maxSalaryFor(league, player);
  const mle = Math.round(pricingCap(league) * league.params.cba.mlePctOfCap);
  const target = Math.min(Math.max(targetAav, min), max);
  const rungs = [...new Set([target, Math.min(mle, target), min])]
    .filter((s) => s >= min)
    .sort((a, b) => b - a);
  const yearShapes = [...new Set([years, Math.min(years, 2), 1])];
  for (const startSalary of rungs) {
    for (const y of yearShapes) {
      const terms: SigningTerms = { years: y, startSalary };
      const means = availableMeans(league, teamId, player.id, terms);
      if (means.length > 0) return { terms, means: means[0]! };
    }
  }
  return null;
}

/**
 * How the PLAYER scores one offer: money, role (projected depth slot),
 * winning (timeline), market size, and the incumbent's pull, weighted by
 * params.fa and scaled by his disposition (ambition amplifies money,
 * marketPref the stage, loyalty the incumbent). Relative number: only the
 * ordering across today's bids matters.
 */
function offerScore(league: League, player: FrPlayer, bid: MarketBid): number {
  const fa = league.params.fa;
  const d = player.disposition;
  const scale = (x: number): number => 0.5 + x / 100; // disposition 0 halves a weight, 100 lands 1.5x
  const team = league.teams[bid.teamId]!;
  const fair = fairAav(league, player);
  const money = fair > 0 ? bid.terms.startSalary / fair : 0;
  // role: where he slots on their depth chart tomorrow morning
  let better = 0;
  const own = abilityScore(player);
  for (const id of team.roster) {
    const p = league.players[id];
    if (p && abilityScore(p) > own) better += 1;
  }
  const role = Math.max(0, 1 - better / 10); // 10 = the rotation length a slot is measured against
  const winning = WINNING_BY_TIMELINE[team.strategy.timeline];
  const market = (MARKET_SIZE[bid.teamId] ?? DEFAULT_MARKET) / 100;
  const incumbent = bid.incumbent ? 1 : 0;
  return fa.wMoney * scale(d.ambition) * money
    + fa.wRole * role
    + fa.wWinning * winning
    + fa.wMarket * scale(d.marketPref) * market
    + fa.wIncumbent * scale(d.loyalty) * incumbent;
}

/** Tail drift: an unsigned minimum-tier player takes a camp deal with the thinnest roster that will have him. */
function campDeal(league: League, player: FrPlayer, out: Transaction[]): void {
  const teams = Object.keys(league.teams).sort(
    (a, b) => league.teams[a]!.roster.length - league.teams[b]!.roster.length || (a < b ? -1 : 1),
  );
  for (const tid of teams) {
    const team = league.teams[tid]!;
    if (team.gm === null) continue; // the user extends their own camp invites
    if (team.roster.length + reservedSheetSpots(league, tid, player.id) >= league.params.cba.rosterMax) continue;
    const terms: SigningTerms = { years: 1, startSalary: minSalaryFor(league, player) };
    const means = availableMeans(league, tid, player.id, terms);
    if (means.length === 0) continue;
    out.push(executeSigning(league, tid, player.id, buildContract(league, tid, player.id, terms, means[0]!)));
    return;
  }
}

/**
 * One free-agency day (spine calls this daily in moratorium/freeAgency,
 * tick.ts). Moratorium returns empty by design (news-only, see header).
 * Otherwise: every unsigned free agent whose decision day has arrived
 * collects bids from AI teams with a need and a legal means, scores them
 * through his disposition, and the best offer executes - or becomes an
 * offer sheet when he is restricted and the winner is not his rights
 * holder. Unsigned minimum-tier players drift to camp deals once the tail
 * ends. Returns the signings executed today.
 */
export function runFreeAgencyDay(league: League): Transaction[] {
  if (league.phase !== 'freeAgency') return []; // moratorium: agreements are smoke, nothing signs
  const out: Transaction[] = [];
  const open = faOpenDay(league);
  if (league.day < open) return [];
  const rng = streamRng(league.seed, 'fa', league.season, league.day);
  const klass = marketClass(league, open);
  if (klass.length === 0) return out;
  const tailDays = tailDaysFor(league, open);
  const tailEnd = open + tailDays;
  const teamIds = Object.keys(league.teams).sort();

  // ---- the owner's money picture, one sheet per team per market day (#164).
  // Two willingness overlays sit on top of CBA legality (bestLegalTerms):
  // a team under the salary floor is a buyer by rule (the floor was computed
  // on every cap line and enforced nowhere), and an owner spends past the
  // tax only as far as his appetite allows (taxAppetite was written at
  // genesis and read nowhere). Both read the signing season's books — the
  // label-season sheets are fiction between the lottery and the rollover
  // (#185). Intra-day staleness is tolerated the same way stale bids are:
  // execution re-validates.
  const willLines = league.capLines[signingSeason(league)];
  const will = new Map<TeamId, { underFloor: boolean; headroom: number }>();
  for (const tid of teamIds) {
    if (!willLines) { will.set(tid, { underFloor: false, headroom: Number.MAX_SAFE_INTEGER }); continue; }
    const total = capSheet(league, tid, signingSeason(league)).total;
    // appetite 0-100 maps the owner's spending ceiling onto [tax line, second apron]
    const ceiling = willLines.tax
      + Math.round((league.teams[tid]!.owner.taxAppetite / 100) * (willLines.apron2 - willLines.tax));
    will.set(tid, {
      underFloor: total < willLines.minSalaryFloor,
      headroom: ceiling - total,
    });
  }

  klass.forEach((player, rank) => {
    if (player.status !== 'freeAgent') return; // signed already (his rank still shapes the calendar)
    // the career seam: a controlled player's signing is HIS decision; the
    // market may court him but never signs him automatically
    // (League.careerControlled; the career bridge surfaces his offers)
    if (league.careerControlled?.includes(player.id)) return;
    if (league.offerSheets.some((s) => s.playerId === player.id)) return; // spoken for until the match clock runs
    const base = baseDecisionDay(league, rank, klass.length, open, tailDays);
    if (base > league.day) return; // his day has not come
    // seeded jitter: on the base day itself an agent may hold out one more
    // day for one more call; past the tail everyone decides
    if (base === league.day && league.day < tailEnd && rng.chance(SLIP_CHANCE)) return;

    // ---- collect bids
    const bids: MarketBid[] = [];
    const fair = fairAav(league, player);
    const age = league.season - player.bornSeason;
    for (const tid of teamIds) {
      const team = league.teams[tid]!;
      if (team.gm === null) continue; // the user bids through actions, never automatically
      // no bid without a roster spot (counting offer-sheet reservations): a
      // full team's money-legal offer would win the player's pick, fail
      // execution validation, quietly retry tomorrow forever, and block his
      // camp-deal drift — the post-#164 unsigned-star pileup in one line
      if (team.roster.length + reservedSheetSpots(league, tid, player.id) >= league.params.cba.rosterMax) continue;
      const incumbent = player.rights?.teamId === tid;
      const w = will.get(tid)!;
      // a team under the salary floor is a buyer by rule: being short of the
      // floor opens the need gate (#164's missing opposing force)
      if (!incumbent && !w.underFloor && needScore(league, tid, player) <= 0) continue;
      // the owner's ceiling: a tapped-out owner does not pick up the phone
      if (w.headroom < minSalaryFor(league, player)) continue;
      // winner's curse: independent per-team jitter around fair value
      const noisy = Math.round(fair * (1 + rng.gaussian(0, league.params.fa.bidNoiseSd)));
      const years = yearsForAge(age, rng.int(2));
      // an owner near his ceiling bids his remaining budget, not the fair
      // read: the target clamps to willingness headroom
      const legal = bestLegalTerms(league, tid, player, Math.min(noisy, w.headroom), years);
      if (!legal) continue;
      bids.push({ teamId: tid, terms: legal.terms, means: legal.means, incumbent });
    }
    if (bids.length === 0) {
      if (league.day >= tailEnd) campDeal(league, player, out); // September drift
      return;
    }

    // ---- the player picks (bids iterate in team-id order; strict > keeps
    // the first, so ties break deterministically)
    let best = bids[0]!;
    let bestScore = offerScore(league, player, best);
    for (const bid of bids.slice(1)) {
      const s = offerScore(league, player, bid);
      if (s > bestScore) {
        best = bid;
        bestScore = s;
      }
    }

    // ---- execute: a restricted player's outside winner files a sheet —
    // but only when the incumbent could execute a match today. tick.ts
    // resolves the deadline by forced execution, so a full-roster incumbent
    // (counting spots reserved by other live sheets) has no legal path to a
    // match; the winning outside offer signs directly instead, exactly as
    // an unmatched sheet would have resolved.
    const incumbentTid = player.rights?.teamId;
    const incumbentTeam = incumbentTid !== undefined ? league.teams[incumbentTid] : undefined;
    const incumbentCanMatch = incumbentTeam !== undefined
      && incumbentTeam.roster.length + reservedSheetSpots(league, incumbentTid!, player.id)
        < league.params.cba.rosterMax;
    if (player.rights?.restricted && best.teamId !== player.rights.teamId && incumbentCanMatch) {
      if (!validateSigning(league, best.teamId, player.id, best.terms, best.means).ok) return;
      league.offerSheets.push({
        playerId: player.id,
        from: best.teamId,
        contract: buildContract(league, best.teamId, player.id, best.terms, best.means),
        decideBy: { season: league.season, day: league.day + league.params.cba.offerSheetMatchDays },
      });
      return; // the spine resolves the match window (tick.ts)
    }
    // cap sheets moved while earlier decisions executed today: re-validate,
    // and let a stale bid quietly retry tomorrow
    if (!validateSigning(league, best.teamId, player.id, best.terms, best.means).ok) return;
    out.push(executeSigning(
      league, best.teamId, player.id,
      buildContract(league, best.teamId, player.id, best.terms, best.means),
    ));
  });

  return out;
}

/**
 * Tender decisions for restricted free agents whose rights an AI team
 * holds: keep the tender (and price the qualifying offer through
 * qualifyingOfferFor) when the player is worth the QO on the team's books,
 * withdraw it (he walks unrestricted) when he is not. The user's tenders
 * are never auto-decided (deciding for the user is the one silent action
 * the log cannot represent). Called from runAiOffseasonDecisions on the
 * spine's tender-deadline day; exported for the spine and tests.
 */
export function tenderQualifyingOffers(league: League): void {
  for (const pid of [...league.freeAgents].sort()) {
    const player = league.players[pid];
    if (!player || player.status !== 'freeAgent') continue;
    const rights = player.rights;
    if (!rights || !rights.restricted) continue; // rollover marks RFA eligibility (tick.ts)
    const team = league.teams[rights.teamId];
    if (!team || team.gm === null) continue; // user tenders stand as-is
    const qo = qualifyingOfferFor(league, pid);
    if (fairAav(league, player) >= qo) {
      rights.qualifyingOffer = qo; // tendered: the restriction holds
    } else {
      rights.restricted = false;   // not worth the QO: unrestricted, hold stays until renounced/signed
      delete rights.qualifyingOffer;
    }
  }
}

/**
 * AI option and qualifying-offer decisions at the offseason deadline (the
 * spine computes the day: params.fa.qualifyingOfferDecisionDay before free
 * agency opens, tick.ts). Team options exercise when the year is at or
 * under the team's fair-value read; player options exercise (opt IN) when
 * the salary beats the player's market read. The rollover's simplified
 * pass remains the backstop for anything undecided here (decided years
 * lose their option flag, so nothing double-fires).
 */
export function runAiOffseasonDecisions(league: League): Transaction[] {
  const out: Transaction[] = [];
  const target = signingSeason(league); // the league year being decided
  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;
    if (team.gm === null) continue; // the user's options resolve only through actions
    for (const pid of [...team.roster, ...team.twoWay]) {
      const player = league.players[pid];
      const contract = player?.contract;
      if (!player || !contract) continue;
      const year = contract.years.find(
        (y) => y.season === target && (y.teamOption === true || y.playerOption === true),
      );
      if (!year) continue;
      // a career-controlled player answers his own player option (the
      // career bridge surfaces the decision); team options stay the club's
      if (year.playerOption === true && league.careerControlled?.includes(pid)) continue;
      const worth = fairAav(league, player);
      const isTeam = year.teamOption === true;
      // a team keeps a year priced at/under its read; a player opts in when
      // the year beats what the market would pay him
      const exercised = isTeam ? year.salary <= worth : year.salary >= worth;
      out.push(executeOptionDecision(league, tid, pid, isTeam ? 'team' : 'player', exercised));
    }
  }
  tenderQualifyingOffers(league);
  return out;
}
