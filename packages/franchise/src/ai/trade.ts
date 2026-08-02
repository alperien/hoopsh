/**
 * ai/trade.ts - negotiation and the league trade pulse. OWNER: ai-trade
 * task.
 *
 * Anti-fleece = the valuation floor plus persona patience, never bolt-on
 * caps (docs/FRANCHISE.md §7; research 01 finding 2: BBGM's hard 2-pick cap
 * was hated as tedium and eventually removed). Anti-cowardice = pressure
 * states: a disgruntled player, a rebuilder holding an expiring vet in
 * deadline week - pressure lowers the accept bar toward (never past) the
 * fleece floor, so star trades happen because situations force them.
 *
 * Determinism: respondToOffer draws NO randomness - a verdict is a pure
 * function of (league, offer), so the UI can preview it and a replayed
 * action log reproduces it byte for byte (it does mutate
 * league.negotiations: memory is state). aiTradePulse draws only from the
 * registered 'trade:<season>:<day>' stream (rng.ts) in a fixed order.
 *
 * Threshold constants specific to negotiation texture live here (the
 * frozen params.trade section carries the calibratable levers:
 * acceptThreshold/fleeceFloor/counterThreshold/pulses/cooldown).
 */
import type {
  DraftPick, FrTeam, League, LeagueDate, Negotiation, PlayerId, TeamId,
  TradeOffer, TradeVerdict, Transaction,
} from '../types.js';
import { streamRng } from '../rng.js';
import { maxIncomingFor, validateTrade } from '../cba/tradelegal.js';
import { executeTrade } from '../transactions.js';
import { abilityScore, offerNet, packageSizeM, pickValue, playerValue } from './valuation.js';

// --------------------------------------------------------------------------
// shared negotiation math

// Persona/pressure shifts on the accept bar (all FEEL):
const PATIENCE_BAR_SWING = 0.05;    // FEEL max shift a 100-patience persona adds to the accept bar
const DISGRUNTLED_RELIEF = 0.06;    // FEEL bar drop when the asked-for player wants out
const DEADLINE_SELLER_RELIEF = 0.04; // FEEL bar drop for a rebuilder shopping an expiring vet in deadline week
/** FEEL "deadline season": the fortnight before the mark. Exported so the GM desk (inbox.ts) frames the same window it prices. */
export const DEADLINE_WINDOW_DAYS = 14;
const EXPIRING_VET_AGE = 28;        // FEEL the age where an expiring deal is a rental, not a keeper
const TEMP_HOT_GAP = 0.05;          // FEEL within 5% of acceptance = hot talks
const TEMP_WARM_GAP = 0.15;         // FEEL within 15% = warm
const MAX_COUNTER_TRIES = 12;       // FEEL bounded counter search (assets probed per response)
const MIN_ASK_VALUE_M = 0.25;       // FEEL never counter by asking for sub-quarter-million flotsam

/** LeagueDate strict less-than, (season, day) lexicographic. */
function dateLt(a: LeagueDate, b: LeagueDate): boolean {
  return a.season < b.season || (a.season === b.season && a.day < b.day);
}

// tradeDeadlineDay and tradingFrozen are mirrored in cba/tradelegal.ts (which cannot import from ai/); keep the two in sync.
/** The trade deadline day: the calendar mark when built, else the params index. Pure read; exported for the GM desk (inbox.ts). */
export function tradeDeadlineDay(league: League): number {
  const marked = league.calendar.find(d => d.marks.includes('tradeDeadline'));
  return marked ? marked.day : league.params.calendar.tradeDeadlineDayIndex;
}

/** True from the day after the deadline through the end of the postseason. */
function tradingFrozen(league: League): boolean {
  if (league.phase === 'playin' || league.phase === 'playoffs') return true;
  return league.phase === 'regular' && league.day > tradeDeadlineDay(league);
}

/** True inside the pre-deadline fortnight of the regular season. Pure read; exported for the GM desk (inbox.ts). */
export function inDeadlineWindow(league: League): boolean {
  if (league.phase !== 'regular') return false;
  const daysOut = tradeDeadlineDay(league) - league.day;
  return daysOut >= 0 && daysOut <= DEADLINE_WINDOW_DAYS;
}

/** Remaining contract seasons from this season on. */
function contractSeasonsLeft(league: League, playerId: PlayerId): number {
  const contract = league.players[playerId]?.contract;
  if (!contract) return 0;
  return contract.years.filter(y => y.season >= league.season).length;
}

interface OfferEval {
  net: number;        // $M net to the receiver, its own valuation
  size: number;       // $M gross package size (floored)
  threshold: number;  // accept fraction after persona/pressure shifts
  target: number;     // $M the receiver needs to say yes
  gapFrac: number;    // (target - net) / size: how far talks are from done
  pressures: string[]; // which pressure states fired, for the reasoning line
}

/**
 * Score an offer from the receiving side: net, size, and the accept bar
 * after persona patience and pressure states. The bar never drops below
 * params.trade.fleeceFloor - that floor IS the anti-fleece property.
 */
function evaluateOffer(league: League, receiver: TeamId, offer: TradeOffer): OfferEval {
  const t = league.params.trade;
  const team = league.teams[receiver]!;
  const net = offerNet(league, receiver, offer);
  const size = packageSizeM(league, receiver, offer);

  let threshold = t.acceptThreshold;
  const pressures: string[] = [];
  // patient GMs hold out for more; impatient ones fold a little early
  const patience = team.gm ? team.gm.patience : 50; // 50 = neutral for the user team
  threshold += ((patience - 50) / 100) * PATIENCE_BAR_SWING; // 50 = neutral trait midpoint, /100 -> fraction

  const outgoing = receiver === offer.from ? offer.give.players : offer.get.players;
  for (const pid of outgoing) {
    const p = league.players[pid];
    if (!p) continue;
    if (p.morale < t.requestMoraleFloor) {
      threshold -= DISGRUNTLED_RELIEF;
      pressures.push(`${p.name} wants out`);
      break; // one disgruntled headliner is pressure enough
    }
  }
  if (team.strategy.timeline === 'rebuild' && inDeadlineWindow(league)) {
    const sellingRental = outgoing.some(pid => {
      const p = league.players[pid];
      if (!p) return false;
      const age = league.season - p.bornSeason;
      return age >= EXPIRING_VET_AGE && contractSeasonsLeft(league, pid) <= 1;
    });
    if (sellingRental) {
      threshold -= DEADLINE_SELLER_RELIEF;
      pressures.push('an expiring vet walks for nothing in July');
    }
  }
  threshold = Math.max(t.fleeceFloor, threshold); // the anti-fleece floor is absolute

  const target = threshold * size;
  return { net, size, threshold, target, gapFrac: (target - net) / size, pressures };
}

/** 'the Reyes front office' when a persona exists, else the city. */
function frontOfficeName(team: FrTeam): string {
  return team.gm ? `the ${team.gm.name} front office` : `the ${team.city} front office`;
}

/** Human-readable pick tag for reasoning lines and inbox bodies. */
function describePick(pick: DraftPick): string {
  const round = pick.round === 1 ? 'first' : 'second';
  const prot = pick.protection ? ` (top-${pick.protection.topN} protected)` : '';
  return `the ${pick.season} ${round} (via ${pick.originalTeam.toUpperCase()})${prot}`;
}

/** Negotiation record between two teams, order-insensitive. */
function findNegotiation(league: League, a: TeamId, b: TeamId): Negotiation | undefined {
  return league.negotiations.find(
    n => (n.teams[0] === a && n.teams[1] === b) || (n.teams[0] === b && n.teams[1] === a),
  );
}

/** Upsert the pair's negotiation memory; the rumor mill reads these. */
function recordNegotiation(
  league: League, offer: TradeOffer, temperature: Negotiation['temperature'], cooldown: boolean,
): void {
  const today: LeagueDate = { season: league.season, day: league.day };
  const about = [...offer.give.players, ...offer.get.players];
  let neg = findNegotiation(league, offer.from, offer.to);
  if (!neg) {
    neg = { teams: [offer.from, offer.to], about, lastOffer: offer, temperature, rounds: 0, lastDate: today };
    league.negotiations.push(neg);
  }
  neg.about = about;
  neg.lastOffer = offer;
  neg.temperature = temperature;
  neg.rounds += 1;
  neg.lastDate = today;
  if (cooldown) {
    neg.cooldownUntil = { season: league.season, day: league.day + league.params.trade.cooldownDays };
  } else {
    delete neg.cooldownUntil;
  }
}

function temperatureFor(gapFrac: number): Negotiation['temperature'] {
  if (gapFrac <= TEMP_HOT_GAP) return 'hot';
  if (gapFrac <= TEMP_WARM_GAP) return 'warm';
  return 'cold';
}

/**
 * Consummated talks leave the rumor mill: drop the pair's negotiation
 * memory once a deal executes (the wire story replaces the smoke).
 * Called by the AI-AI pulse below and by the user's inbox accept
 * (tick.ts respondToRequest). Mutates only league.negotiations.
 */
export function clearNegotiation(league: League, a: TeamId, b: TeamId): void {
  const idx = league.negotiations.findIndex(
    n => (n.teams[0] === a && n.teams[1] === b) || (n.teams[0] === b && n.teams[1] === a),
  );
  if (idx >= 0) league.negotiations.splice(idx, 1);
}

// --------------------------------------------------------------------------
// counters

interface AskCandidate {
  kind: 'player' | 'pick';
  id: string;
  value: number; // receiver's valuation, $M
}

/** Proposer assets the receiver could ask for, cheapest first (its own valuation). */
function askCandidates(league: League, receiver: TeamId, offer: TradeOffer): AskCandidate[] {
  const proposer = league.teams[offer.from]!;
  const alreadyGiving = new Set(offer.give.players);
  const alreadyGivingPicks = new Set(offer.give.picks);
  const untouchable = new Set(proposer.strategy.untouchables);
  const out: AskCandidate[] = [];
  for (const pid of proposer.roster) {
    if (alreadyGiving.has(pid) || untouchable.has(pid)) continue; // never counter with untouchables
    const contract = league.players[pid]?.contract;
    if (!contract || contract.kind === 'tenDay' || contract.kind === 'restOfSeason') continue;
    const value = playerValue(league, receiver, pid);
    if (value >= MIN_ASK_VALUE_M) out.push({ kind: 'player', id: pid, value });
  }
  for (const pick of proposer.picks) {
    if (alreadyGivingPicks.has(pick.id)) continue;
    const value = pickValue(league, receiver, pick);
    if (value >= MIN_ASK_VALUE_M) out.push({ kind: 'pick', id: pick.id, value });
  }
  out.sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : 1)); // cheapest ask that clears wins
  return out;
}

/** Deep-copy an offer (small arrays; structuredClone would also work). */
function cloneOffer(offer: TradeOffer): TradeOffer {
  return {
    from: offer.from, to: offer.to,
    give: { players: [...offer.give.players], picks: [...offer.give.picks] },
    get: { players: [...offer.get.players], picks: [...offer.get.picks] },
  };
}

/**
 * Build a counter for the receiving team: first ask the proposer for the
 * cheapest additional asset that clears acceptance; failing that, drop the
 * least valuable piece the receiver was asked to send. Bounded search;
 * every candidate must pass validateTrade. Returns null when nothing
 * bridges the gap.
 */
function buildCounter(
  league: League, receiver: TeamId, offer: TradeOffer,
): { counter: TradeOffer; ask: string } | null {
  let tries = 0;
  for (const cand of askCandidates(league, receiver, offer)) {
    if (tries >= MAX_COUNTER_TRIES) break;
    tries += 1;
    const candidate = cloneOffer(offer);
    if (cand.kind === 'player') candidate.give.players.push(cand.id);
    else candidate.give.picks.push(cand.id);
    const ev = evaluateOffer(league, receiver, candidate);
    if (ev.net < ev.target) continue; // this ask does not get there yet
    if (!validateTrade(league, candidate).ok) continue; // Stepien/matching/roster says no
    const ask = cand.kind === 'player'
      ? league.players[cand.id]!.name
      : describePick(league.teams[offer.from]!.picks.find(p => p.id === cand.id)!);
    return { counter: candidate, ask };
  }

  // no single add clears: try sending less instead (drop the cheapest piece
  // the receiver was asked to give, player or pick)
  const receiverTeam = league.teams[receiver]!;
  const sends: Array<{ kind: 'player' | 'pick'; id: string; value: number; label: string }> = [];
  for (const pid of offer.get.players) {
    sends.push({ kind: 'player', id: pid, value: playerValue(league, receiver, pid), label: league.players[pid]?.name ?? pid });
  }
  for (const pickId of offer.get.picks) {
    const pick = receiverTeam.picks.find(p => p.id === pickId);
    if (pick) sends.push({ kind: 'pick', id: pickId, value: pickValue(league, receiver, pick), label: describePick(pick) });
  }
  sends.sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : 1));
  for (const drop of sends.slice(0, 3)) { // 3 = FEEL: only the fringe of the package is negotiable this way
    const candidate = cloneOffer(offer);
    if (drop.kind === 'player') candidate.get.players = candidate.get.players.filter(pid => pid !== drop.id);
    else candidate.get.picks = candidate.get.picks.filter(id => id !== drop.id);
    if (candidate.get.players.length === 0 && candidate.get.picks.length === 0) continue; // a trade must trade something
    const ev = evaluateOffer(league, receiver, candidate);
    if (ev.net < ev.target) continue;
    if (!validateTrade(league, candidate).ok) continue;
    return { counter: candidate, ask: `keep ${drop.label}` };
  }
  return null;
}

// --------------------------------------------------------------------------
// respondToOffer

/**
 * Deterministic verdict for the team on the RECEIVING end (offer.to) of a
 * proposal. Accepts when net value clears the persona/pressure-adjusted
 * bar, walks away (with a cooldown recorded) when the offer is insulting,
 * and otherwise counters with the cheapest bridge it can find. Mutates
 * ONLY league.negotiations (memory); execution belongs to the caller
 * (tick.ts for user trades, aiTradePulse for AI-AI). Reasoning strings
 * name the basketball logic for the UI and the news desk.
 */
export function respondToOffer(league: League, offer: TradeOffer): TradeVerdict {
  const t = league.params.trade;
  const receiver = league.teams[offer.to];
  const proposer = league.teams[offer.from];
  if (!receiver || !proposer) {
    return { accept: false, reasoning: 'no such front office to call', walkAway: true };
  }

  // deadline law: no trades between the deadline and the new league year
  if (tradingFrozen(league)) {
    return { accept: false, reasoning: 'the deadline has passed; call back in July', walkAway: true };
  }

  // memory: a front office that walked away does not pick up for a while
  const existing = findNegotiation(league, offer.from, offer.to);
  const today: LeagueDate = { season: league.season, day: league.day };
  if (existing?.cooldownUntil && dateLt(today, existing.cooldownUntil)) {
    return { accept: false, reasoning: `${frontOfficeName(receiver)} is not taking calls after the last round of talks`, walkAway: true };
  }

  // an offer the league office would void gets a flat no, not a negotiation
  const legality = validateTrade(league, offer);
  if (!legality.ok) {
    return { accept: false, reasoning: `the league office would void this: ${legality.errors[0]}` };
  }

  // untouchables end talks immediately - that is what the word means
  const asked = offer.get.players; // what the proposer wants = what the receiver sends
  const untouchable = asked.find(pid => receiver.strategy.untouchables.includes(pid));
  if (untouchable) {
    const verdict: TradeVerdict = {
      accept: false,
      reasoning: `${league.players[untouchable]?.name ?? untouchable} is untouchable; there is no offer here`,
      walkAway: true,
    };
    recordNegotiation(league, offer, 'cold', true);
    return verdict;
  }

  const ev = evaluateOffer(league, receiver.id, offer);

  if (ev.net >= ev.target) {
    const why = ev.pressures.length > 0
      ? `${ev.pressures[0]}; this return works for us`
      : 'fair value both ways; done';
    recordNegotiation(league, offer, 'hot', false);
    return { accept: true, reasoning: why };
  }

  if (ev.net < t.counterThreshold * ev.size) {
    // insultingly light: name the insult when the receiver is being asked
    // for its best player, or being used as a dumping ground
    let why = `${frontOfficeName(receiver)} sees nothing here worth a call back`;
    const best = [...receiver.roster]
      .sort((a, b) => playerValue(league, receiver.id, b) - playerValue(league, receiver.id, a))[0];
    let incoming = 0;
    for (const pid of offer.give.players) incoming += playerValue(league, receiver.id, pid);
    if (best && asked.includes(best)) {
      why = 'we are not moving our best player for salary filler';
    } else if (incoming < 0) {
      why = 'we are not a dumping ground; that contract needs a sweetener attached';
    }
    recordNegotiation(league, offer, 'cold', true);
    return { accept: false, reasoning: why, walkAway: true };
  }

  // close enough to talk: counter with the cheapest bridge
  const bridged = buildCounter(league, receiver.id, offer);
  if (bridged) {
    const verdict: TradeVerdict = {
      accept: false,
      reasoning: bridged.ask.startsWith('keep ')
        ? `${bridged.ask} and we have a deal`
        : `add ${bridged.ask} and we talk`,
      counter: bridged.counter,
    };
    recordNegotiation(league, bridged.counter, temperatureFor(ev.gapFrac), false);
    return verdict;
  }

  recordNegotiation(league, offer, temperatureFor(ev.gapFrac), false);
  return { accept: false, reasoning: 'close, but nothing on the table bridges the gap' };
}

// --------------------------------------------------------------------------
// the league pulse

const MAX_PACKAGE_ADDS = 5;   // FEEL a sensible AI package tops out around 5 pieces
const MAX_ASSEMBLY_SCANS = 24; // FEEL bounded search over buyer assets per pulse
const YOUNG_ASSET_AGE = 25;    // FEEL "young" for a contender's sweetener purposes
const SALARY_LEAD_TRIES = 3;   // FEEL matching-money leads probed in pass 2 before giving up
const CORE_SALARY_SHARE = 0.18; // FEEL pay above ~18% of cap marks a core piece whatever its surplus reads

/** Per-day probability the wire wakes up, by calendar phase. */
function pulseChance(league: League): number {
  if (tradingFrozen(league)) return 0; // deadline means deadline
  const t = league.params.trade;
  if (league.phase === 'regular') return inDeadlineWindow(league) ? t.deadlinePulse : t.regularPulse;
  if (league.phase === 'offseason' || league.phase === 'lottery' || league.phase === 'draft'
    || league.phase === 'moratorium' || league.phase === 'freeAgency') {
    return t.offseasonPulse;
  }
  return t.regularPulse; // camp: preseason tinkering
}

/** Buyer/seller pairs whose timelines are complementary; buyer is always AI. */
function complementaryPairs(league: League): Array<{ buyer: TeamId; seller: TeamId }> {
  const today: LeagueDate = { season: league.season, day: league.day };
  const ids = Object.keys(league.teams).sort();
  const tier1: Array<{ buyer: TeamId; seller: TeamId }> = [];
  const tier2: Array<{ buyer: TeamId; seller: TeamId }> = [];
  for (const buyerId of ids) {
    const buyer = league.teams[buyerId]!;
    if (!buyer.gm) continue; // the proposer is always an AI front office
    for (const sellerId of ids) {
      if (sellerId === buyerId) continue;
      const seller = league.teams[sellerId]!;
      const neg = findNegotiation(league, buyerId, sellerId);
      if (neg?.cooldownUntil && dateLt(today, neg.cooldownUntil)) continue; // walked away recently
      const b = buyer.strategy.timeline;
      const s = seller.strategy.timeline;
      if (b === 'contend' && s === 'rebuild') tier1.push({ buyer: buyerId, seller: sellerId });
      else if ((b === 'contend' && s === 'retool') || (b === 'retool' && s === 'rebuild')) {
        tier2.push({ buyer: buyerId, seller: sellerId });
      }
    }
  }
  return tier1.length > 0 ? tier1 : tier2;
}

/**
 * The seller's most valuable movable rental: best expiring or disgruntled
 * vet, priced by the BUYER's board. Pure read (no rng, no mutation);
 * exported for the GM desk (inbox.ts), which frames deadline-day items
 * with the same asset the pulse itself would shop.
 */
export function pickSellerTarget(league: League, buyer: TeamId, seller: TeamId): PlayerId | null {
  const team = league.teams[seller]!;
  const t = league.params.trade;
  let best: PlayerId | null = null;
  let bestValue = 0;
  for (const pid of team.roster) {
    const p = league.players[pid];
    if (!p || team.strategy.untouchables.includes(pid)) continue;
    const age = league.season - p.bornSeason;
    const expiring = contractSeasonsLeft(league, pid) <= 1;
    const disgruntled = p.morale < t.requestMoraleFloor;
    if (age < EXPIRING_VET_AGE && !disgruntled) continue; // sellers move vets, not their kids
    if (!expiring && !disgruntled) continue;
    const value = playerValue(league, buyer, pid); // what the BUYER would pay for him
    if (value > bestValue) { bestValue = value; best = pid; }
  }
  return best;
}

/** Buyer assets a contender sensibly ships: picks and young players, cheap-to-it first. */
function buyerSweeteners(league: League, buyer: TeamId): Array<{ kind: 'player' | 'pick'; id: string; value: number; season?: number }> {
  const team = league.teams[buyer]!;
  const out: Array<{ kind: 'player' | 'pick'; id: string; value: number; season?: number }> = [];
  for (const pick of team.picks) {
    out.push({ kind: 'pick', id: pick.id, value: pickValue(league, buyer, pick), season: pick.season });
  }
  for (const pid of team.roster) {
    const p = league.players[pid];
    if (!p || team.strategy.untouchables.includes(pid)) continue;
    const contract = p.contract;
    if (!contract || contract.kind === 'tenDay' || contract.kind === 'restOfSeason') continue;
    const age = league.season - p.bornSeason;
    // a contender ships youth and salary ballast, not its rotation core -
    // and never its own bad contracts: attaching negative value to a BUY
    // package only poisons the seller's ledger (dumps are their own deal
    // shape, priced by the sweetener math in respondToOffer)
    const value = playerValue(league, buyer, pid);
    if (value < 0) continue;
    // the filler line alone is a trap: a fairly-paid STAR prices near
    // zero surplus (pay tracks worth) and reads as filler by value - the
    // core-salary guard keeps the franchise off the sweetener table
    const row = contract.years.find(y => y.season === league.season);
    const capNow = league.capLines[league.season]?.cap ?? league.params.cba.genesisCap;
    const corePaid = (row ? row.salary : 0) >= capNow * CORE_SALARY_SHARE;
    if (age <= YOUNG_ASSET_AGE || (value < 12 && !corePaid)) out.push({ kind: 'player', id: pid, value }); // 12 = FEEL $M line between filler and core
  }
  out.sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : 1)); // give up what you value least
  return out;
}

type Sweetener = { kind: 'player' | 'pick'; id: string; value: number; season?: number };

/** This-season salary of a sweetener candidate, for matching math; picks carry no salary. */
function candidateSalary(league: League, cand: Sweetener): number {
  if (cand.kind !== 'player') return 0;
  const contract = league.players[cand.id]?.contract;
  const row = contract?.years.find(y => y.season === league.season);
  return row ? row.salary : 0;
}

/**
 * One bounded greedy walk: add candidates in the given order, skipping any
 * piece that flips the buyer under its own bar, until both accept bars and
 * validateTrade clear. Shared by assembleOffer's two passes (value-first,
 * then salary-first). Returns the package and both final evals; mutates
 * nothing outside the offer it builds.
 */
function walkPackage(
  league: League, buyer: TeamId, seller: TeamId, target: PlayerId, candidates: Sweetener[],
): { offer: TradeOffer; closed: boolean; sellerEval: OfferEval; buyerEval: OfferEval } {
  const offer: TradeOffer = {
    from: buyer, to: seller,
    give: { players: [], picks: [] },
    get: { players: [target], picks: [] },
  };
  const usedPickSeasons = new Set<number>();
  let scans = 0;
  let adds = 0;
  let idx = 0;
  while (adds < MAX_PACKAGE_ADDS && idx < candidates.length && scans < MAX_ASSEMBLY_SCANS) {
    const sellerEval = evaluateOffer(league, seller, offer);
    const buyerEval = evaluateOffer(league, buyer, offer);
    if (sellerEval.net >= sellerEval.target && buyerEval.net >= buyerEval.target
      && validateTrade(league, offer).ok) {
      return { offer, closed: true, sellerEval, buyerEval };
    }
    const cand = candidates[idx]!;
    idx += 1;
    scans += 1;
    if (cand.kind === 'pick' && cand.season !== undefined) {
      // keep consecutive-season firsts out of one package (Stepien shape)
      if (usedPickSeasons.has(cand.season - 1) || usedPickSeasons.has(cand.season + 1) || usedPickSeasons.has(cand.season)) continue;
    }
    const tentative = cloneOffer(offer);
    if (cand.kind === 'pick') tentative.give.picks.push(cand.id);
    else tentative.give.players.push(cand.id);
    // never add a piece that flips the buyer under its own bar
    const tentativeBuyer = evaluateOffer(league, buyer, tentative);
    if (tentativeBuyer.net < tentativeBuyer.target) continue;
    offer.give = tentative.give;
    if (cand.kind === 'pick' && cand.season !== undefined) usedPickSeasons.add(cand.season);
    adds += 1;
  }
  const sellerEval = evaluateOffer(league, seller, offer);
  const buyerEval = evaluateOffer(league, buyer, offer);
  const closed = sellerEval.net >= sellerEval.target && buyerEval.net >= buyerEval.target
    && validateTrade(league, offer).ok;
  return { offer, closed, sellerEval, buyerEval };
}

/**
 * Assemble a buyer offer for one seller asset that clears BOTH sides'
 * accept bars and validateTrade. Pass 1 adds the buyer's least-valued
 * assets first (give up what you value least). When that walk clears both
 * value bars but league law still says no - the usual culprit is the
 * salary-matching bands, because picks carry no salary and a pick-heavy
 * package cannot legally return a big expiring contract - pass 2 rebuilds
 * the package salary-first, shipping the fairly-paid ballast the buyer
 * barely values, the way real deadline packages carry matching money.
 * Bounded search; null when no package closes. Near-miss talks record
 * negotiation smoke for the rumor mill unless recordSmoke is false
 * (the directed user pass probes quietly; its SENT offer is what lands
 * on the desk).
 */
function assembleOffer(
  league: League, buyer: TeamId, seller: TeamId, target: PlayerId, recordSmoke: boolean = true,
): TradeOffer | null {
  const candidates = buyerSweeteners(league, buyer);
  const valueFirst = walkPackage(league, buyer, seller, target, candidates);
  if (valueFirst.closed) return valueFirst.offer;

  const bothBarsCleared = valueFirst.sellerEval.net >= valueFirst.sellerEval.target
    && valueFirst.buyerEval.net >= valueFirst.buyerEval.target;
  if (bothBarsCleared) {
    // Value said yes, league law said no - the usual culprit is salary
    // matching, because picks carry no salary. Real deadline packages
    // lead with MATCHING MONEY: the CHEAPEST single contract whose
    // salary legalizes the return (tried cheapest-up, a few deep), then
    // the value order for the rest. When no single contract matches,
    // aggregate cheapest-up until the band clears - the classic
    // three-fillers-and-a-pick shape. Cheapest-first is the realism
    // guard: salary-descending order would lead with the best-paid
    // roster and offer the franchise to absorb a rental.
    const targetRow = league.players[target]!.contract?.years.find(y => y.season === league.season);
    const incoming = targetRow ? targetRow.salary : 0;
    const bySalaryAsc = candidates
      .filter(c => candidateSalary(league, c) > 0)
      .sort((a, b) => candidateSalary(league, a) - candidateSalary(league, b)
        || a.value - b.value || (a.id < b.id ? -1 : 1));
    const sufficient = bySalaryAsc
      .filter(c => maxIncomingFor(league, buyer, candidateSalary(league, c)) >= incoming);
    const leads: Sweetener[][] = sufficient.slice(0, SALARY_LEAD_TRIES).map(c => [c]);
    if (leads.length === 0) {
      const stack: Sweetener[] = [];
      let sum = 0;
      for (const c of bySalaryAsc) {
        stack.push(c);
        sum += candidateSalary(league, c);
        if (maxIncomingFor(league, buyer, sum) >= incoming) {
          leads.push([...stack]);
          break;
        }
      }
    }
    for (const lead of leads) {
      const rest = candidates.filter(c => !lead.includes(c));
      const salaryFirst = walkPackage(league, buyer, seller, target, [...lead, ...rest]);
      if (salaryFirst.closed) return salaryFirst.offer;
    }
  }

  // close-but-no talks are real negotiation state: the rumor mill may print smoke
  if (recordSmoke && valueFirst.sellerEval.gapFrac <= TEMP_WARM_GAP) {
    recordNegotiation(league, valueFirst.offer, temperatureFor(valueFirst.sellerEval.gapFrac), false);
  }
  return null;
}

/** Compact human-readable offer summary for the user's inbox. */
function summarizeOffer(league: League, offer: TradeOffer): string {
  const names = (players: PlayerId[], picks: string[], owner: TeamId): string => {
    const parts: string[] = [];
    for (const pid of players) parts.push(league.players[pid]?.name ?? pid);
    for (const pickId of picks) {
      const pick = league.teams[owner]!.picks.find(p => p.id === pickId);
      if (pick) parts.push(describePick(pick));
    }
    return parts.length > 0 ? parts.join(', ') : 'nothing';
  };
  const from = league.teams[offer.from]!;
  return `${frontOfficeName(from)} (${from.abbrev}) offers ${names(offer.give.players, offer.give.picks, offer.from)} `
    + `for ${names(offer.get.players, offer.get.picks, offer.to)}. `
    + `Accept executes the deal as offered; the live offer is on file at the trade desk to counter.`;
}

/**
 * Land an AI-built offer on the human user's desk: an inbox decision
 * (Accept/Decline/Counter) carrying a frozen copy of the offer - accept
 * executes exactly that copy (tick.ts respondToRequest) - with the live
 * offer also stashed in league.negotiations for the trade desk to read.
 * Dedupes on the deterministic day/proposer id. Shared by the organic
 * pulse (user sampled as the natural seller) and the directed
 * deadline-window pass (#184). Mutates league.inbox and negotiations.
 */
function pushUserOffer(league: League, offer: TradeOffer): void {
  const id = `trade-offer-s${league.season}d${league.day}-${offer.from}`;
  if (!league.inbox.some(i => i.id === id)) {
    league.inbox.push({
      id,
      date: { season: league.season, day: league.day },
      kind: 'decision',
      title: `Trade offer from ${league.teams[offer.from]!.city}`,
      body: summarizeOffer(league, offer),
      // frozen copy: the stash below is live desk memory and can move
      // under later talks; the item must execute what it promised
      offer: cloneOffer(offer),
      choices: [
        { id: 'accept', label: 'Accept' },
        { id: 'decline', label: 'Decline' },
        { id: 'counter', label: 'Counter' },
      ],
      // the offer stands to the deadline in deadline season, else as
      // long as a walk-away memory would (cooldownDays); the spine's
      // morning sweep retires it once the date passes (tick.ts), so an
      // ignored offer never wedges the advance loop forever
      deadline: inDeadlineWindow(league)
        ? { season: league.season, day: tradeDeadlineDay(league) }
        : { season: league.season, day: league.day + league.params.trade.cooldownDays },
      resolved: false,
    });
  }
  recordNegotiation(league, offer, 'warm', false); // the trade desk reads lastOffer
}

/** Executed trades so far inside this season's deadline window. Ledger-derived: no new save state. */
function windowTradesSoFar(league: League, deadlineDay: number): number {
  return league.transactions.filter(tx => tx.kind === 'trade'
    && tx.date.season === league.season
    && tx.date.day >= deadlineDay - DEADLINE_WINDOW_DAYS && tx.date.day <= deadlineDay).length;
}

/** Flip proposer and receiver: identical trade content, inbound framing. */
function mirrorOffer(offer: TradeOffer): TradeOffer {
  return {
    from: offer.to, to: offer.from,
    give: { players: [...offer.get.players], picks: [...offer.get.picks] },
    get: { players: [...offer.give.players], picks: [...offer.give.picks] },
  };
}

const USER_OFFER_PROBES = 4;   // FEEL bounded counterparty teams probed per directed attempt
const USER_OFFER_EVE_DAYS = 1; // FEEL deadline-eve backstop: this close to the mark, a windowful of silence forces one attempt

/**
 * Build one situation-driven offer AT the human user chair, or null when
 * no counterparty and package genuinely exist. The user's timeline picks
 * the direction with the same complementary tiers the league pulse uses:
 * a selling chair (rebuild/retool) draws an AI buyer calling about its
 * movable vet; a competitive chair (contend/retool) draws an AI seller
 * pitching its rental, assembled from the user's own board and mirrored
 * into an inbound offer. Every package clears both accept bars and league
 * law - a plausible offer, never filler. Probes record no smoke; only the
 * sent offer becomes desk state.
 */
function assembleUserOffer(league: League, rng: ReturnType<typeof streamRng>): TradeOffer | null {
  const userId = league.userTeam;
  const user = league.teams[userId]!;
  const today: LeagueDate = { season: league.season, day: league.day };
  const ut = user.strategy.timeline;
  const probes: Array<{ dir: 'sell' | 'buy'; other: TeamId }> = [];
  for (const id of Object.keys(league.teams).sort()) {
    if (id === userId) continue;
    const team = league.teams[id]!;
    if (!team.gm) continue;
    const neg = findNegotiation(league, id, userId);
    if (neg?.cooldownUntil && dateLt(today, neg.cooldownUntil)) continue; // walked away recently
    const tl = team.strategy.timeline;
    if ((tl === 'contend' && (ut === 'rebuild' || ut === 'retool')) || (tl === 'retool' && ut === 'rebuild')) {
      probes.push({ dir: 'sell', other: id });
    }
    if ((ut === 'contend' && (tl === 'rebuild' || tl === 'retool')) || (ut === 'retool' && tl === 'rebuild')) {
      probes.push({ dir: 'buy', other: id });
    }
  }
  for (let tried = 0; probes.length > 0 && tried < USER_OFFER_PROBES; tried++) {
    const probe = rng.pick(probes);
    probes.splice(probes.indexOf(probe), 1);
    if (probe.dir === 'sell') {
      const target = pickSellerTarget(league, probe.other, userId);
      if (!target) continue;
      const offer = assembleOffer(league, probe.other, userId, target, false);
      if (offer) return offer; // from = the AI buyer: already inbound
    } else {
      const target = pickSellerTarget(league, userId, probe.other);
      if (!target) continue;
      const offer = assembleOffer(league, userId, probe.other, target, false);
      if (offer) return mirrorOffer(offer); // reframe: the AI seller pitches its rental
    }
  }
  return null;
}

/**
 * The directed offer cadence (#184): inside deadline season a human user
 * chair gets called directly, on its own dial (params.trade.userOfferPulse),
 * independent of whether the league pulse sampled the user organically.
 * Fires only when no other offer sits unresolved on the desk; the
 * deadline-eve backstop converts a fully quiet window into one forced
 * attempt, so a chair with a workable situation sees the market call.
 * Draws in fixed order from the caller's day stream. No-op for persona
 * chairs and outside the window.
 */
function userOfferPass(league: League, rng: ReturnType<typeof streamRng>): void {
  if (!inDeadlineWindow(league)) return;
  const user = league.teams[league.userTeam];
  if (!user || user.gm !== null) return; // persona-run seats trade AI-AI
  if (league.inbox.some(i => i.id.startsWith('trade-offer-') && !i.resolved)) return; // one live decision at a time
  const dl = tradeDeadlineDay(league);
  const gotOneThisWindow = league.inbox.some(i => i.id.startsWith('trade-offer-')
    && i.date.season === league.season
    && i.date.day >= dl - DEADLINE_WINDOW_DAYS && i.date.day <= dl);
  const forced = dl - league.day <= USER_OFFER_EVE_DAYS && !gotOneThisWindow;
  if (!forced && !rng.chance(league.params.trade.userOfferPulse)) return;
  const offer = assembleUserOffer(league, rng);
  if (offer) pushUserOffer(league, offer);
}

/**
 * The daily league pulse, sized by #184: with a per-day, phase-dependent
 * probability the wire wakes and probes several complementary buyer/seller
 * pairs (params.trade.regularAttempts / deadlineAttempts), executing the
 * first AI-AI deal that clears both bars and league law. Execution stays
 * capped at ONE deal per day - the wire should crackle, not spam - except
 * deadline day itself, which allows params.trade.deadlineDayMaxTrades. A
 * conversion floor forces the pulse across the window's last
 * deadlineFloorDays until the window holds deadlineFloorTrades deals, so
 * a silent deadline is a tail event, not the mode. When a probed pair's
 * natural counterparty is the human user chair, the offer lands via
 * pushUserOffer and the day's probing stops; the directed userOfferPass
 * then runs on its own cadence. Never auto-executes against a human
 * chair. All randomness from the registered 'trade:<season>:<day>'
 * stream, drawn in fixed order. Returns the transactions it executed
 * (empty most days).
 */
export function aiTradePulse(league: League): Transaction[] {
  const executed: Transaction[] = [];
  if (tradingFrozen(league)) return executed; // deadline means deadline
  const t = league.params.trade;
  const rng = streamRng(league.seed, 'trade', league.season, league.day);
  const window = inDeadlineWindow(league);
  const dl = tradeDeadlineDay(league);
  const humanChair = league.teams[league.userTeam]!.gm === null;

  const floorActive = window
    && dl - league.day < t.deadlineFloorDays
    && windowTradesSoFar(league, dl) < t.deadlineFloorTrades;

  const chance = pulseChance(league);
  if (floorActive || (chance > 0 && rng.chance(chance))) {
    const attempts = window ? t.deadlineAttempts : t.regularAttempts;
    const dayCap = league.day === dl ? t.deadlineDayMaxTrades : 1;
    let pairs = complementaryPairs(league);
    // the floor guarantees LEAGUE deals; an offer parked on the user's desk cannot satisfy it
    if (floorActive && humanChair) pairs = pairs.filter(p => p.seller !== league.userTeam);
    for (let i = 0; i < attempts && executed.length < dayCap && pairs.length > 0; i++) {
      const pair = rng.pick(pairs);
      pairs = pairs.filter(p => p !== pair); // a probed pair is done for the day
      const target = pickSellerTarget(league, pair.buyer, pair.seller);
      if (!target) continue;
      const offer = assembleOffer(league, pair.buyer, pair.seller, target);
      if (!offer) continue;
      if (pair.seller === league.userTeam && humanChair) {
        // a HUMAN GM chair is the natural counterparty: propose, never
        // execute; one live decision at a time ends the day's probing.
        // (A persona-run user seat trades like any AI team.)
        pushUserOffer(league, offer);
        break;
      }
      // AI-AI: both bars cleared inside assembleOffer; executeTrade re-validates
      executed.push(executeTrade(league, offer));
      clearNegotiation(league, pair.buyer, pair.seller);
      // rosters just moved: today's remaining probes exclude both parties
      pairs = pairs.filter(p => p.buyer !== pair.buyer && p.seller !== pair.buyer
        && p.buyer !== pair.seller && p.seller !== pair.seller);
    }
  }

  userOfferPass(league, rng);
  return executed;
}
