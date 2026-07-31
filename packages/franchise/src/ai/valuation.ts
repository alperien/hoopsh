/**
 * ai/valuation.ts - the value model: players, picks, packages. OWNER:
 * ai-trade task.
 *
 * The number every function returns is SURPLUS VALUE in millions-equivalent
 * units: what a player's projected on-court production over his contract is
 * worth beyond what he is paid. That framing is the anti-fleece foundation
 * (docs/FRANCHISE.md §7, research 01 finding 2): a minimum-salary body is
 * worth ~nothing no matter how many of them a user stacks, a bargain rookie
 * deal is a premium asset, and an albatross contract is a NEGATIVE number a
 * seller must pay picks to move - which is exactly how salary dumps price
 * in the real league. No bolt-on trade caps exist anywhere in this module;
 * BBGM's community hated those as tedium (research 01 finding 2, research
 * 05 A5e).
 *
 * Value is TEAM-CONTEXT, not global: the teamId argument is the valuing
 * front office, and its live timeline (team.strategy.timeline) plus persona
 * shift the number. A rebuilder discounts a 30-year-old's wins because it
 * cannot use them; a contender pays a star premium because playoff rounds
 * are won by the best player on the floor. Those two opposite lenses are
 * what OPEN the star-trade window (anti-cowardice): the buyer's number can
 * sit far above the seller's for the same player without either side being
 * wrong (research 05 A10 documents the failure mode when they cannot).
 *
 * Numeric constants live here rather than FranchiseParams because the
 * params SHAPE froze in the contracts wave (params.ts header) and the
 * trade section carries only the pick-curve/threshold knobs; everything
 * else carries provenance below and is a promotion candidate when the
 * shape reopens.
 *
 * Register of simplifications:
 * - V1 Option years are priced at face value (a team option is counted as
 *   if exercised). The upside/downside asymmetry of options is not priced.
 * - V2 Fair-AAV comparisons use the CURRENT season's cap for every future
 *   contract year; cap growth (3-8%/yr) makes future salaries slightly
 *   cheaper in reality, so long deals are valued a touch pessimistically.
 * - V3 No re-signing tail: value stops at the contract's end (capped at
 *   params.trade.horizonSeasons). Bird-rights retention value is unpriced,
 *   which makes expiring stars cheap at the deadline - that is the real
 *   rental market, kept deliberately.
 */
import type { Attributes } from '@hoopsh/engine';
import type { DraftPick, FrPlayer, League, TeamId, TradeOffer } from '../types.js';

// --------------------------------------------------------------------------
// ability

/** The attribute keys of each skill group (mirrors PotentialProfile's grouping). */
const GROUP_KEYS = {
  scoring: ['finishing', 'midRange', 'three', 'freeThrow', 'drawFoul'],
  playmaking: ['ballHandle', 'passAcc', 'passVision'],
  defense: ['perimeterD', 'interiorD', 'steal', 'block', 'contestSkill'],
  rebounding: ['offReb', 'defReb', 'boxout'],
  phys: ['speed', 'accel', 'strength', 'vertical', 'lateral', 'stamina'],
  mental: ['decisions', 'consistency'],
} as const satisfies Record<string, readonly (keyof Attributes)[]>;

type GroupName = keyof typeof GROUP_KEYS;

/**
 * Position norms: what each position is paid to do (all FEEL, sum to 1 per
 * position). Guards live on scoring+playmaking, wings on two-way play,
 * bigs on defense+glass; mental weight is flat because decision quality
 * travels with every role.
 */
const POSITION_GROUP_WEIGHTS: Record<string, Record<GroupName, number>> = {
  PG: { scoring: 0.28, playmaking: 0.30, defense: 0.16, rebounding: 0.04, phys: 0.12, mental: 0.10 },
  SG: { scoring: 0.34, playmaking: 0.20, defense: 0.18, rebounding: 0.05, phys: 0.13, mental: 0.10 },
  SF: { scoring: 0.30, playmaking: 0.16, defense: 0.22, rebounding: 0.09, phys: 0.13, mental: 0.10 },
  PF: { scoring: 0.26, playmaking: 0.10, defense: 0.26, rebounding: 0.15, phys: 0.13, mental: 0.10 },
  C:  { scoring: 0.22, playmaking: 0.06, defense: 0.30, rebounding: 0.20, phys: 0.12, mental: 0.10 },
};

/**
 * Compact 0-100 current-ability score: group means weighted by position
 * norms. A flat attribute sheet of X scores exactly X at every position
 * (weights sum to 1), which keeps the scale legible. Pure; exported
 * because roster/FA/persona logic all need one shared notion of "how good
 * is he right now".
 */
export function abilityScore(player: Pick<FrPlayer, 'pos' | 'attr'>): number {
  const weights = POSITION_GROUP_WEIGHTS[player.pos] ?? POSITION_GROUP_WEIGHTS.SF!;
  let score = 0;
  for (const group of Object.keys(GROUP_KEYS) as GroupName[]) {
    const keys = GROUP_KEYS[group];
    let sum = 0;
    for (const key of keys) sum += player.attr[key];
    score += (sum / keys.length) * weights[group];
  }
  return score;
}

// --------------------------------------------------------------------------
// production and fair pay curves

// On-court production curve (CAL): dollars-per-year a player of a given
// ability produces. Convex because star scarcity is the league's economy:
// you can only play five players, so one 90 beats two 70s in the games
// that matter. Anchors: ability 90 produces ~$60M/yr (economist estimates
// of superstar on-court value run $60-100M against ~$50M max salaries,
// which is WHY max deals are bargains), ability 75 (solid starter) ~$27M,
// ability 60 (rotation) ~$7M, and 42-and-below is replacement level that
// any team can sign for the minimum.
const REPLACEMENT_ABILITY = 42; // CAL replacement level: freely available talent produces no surplus
const PRODUCTION_EXPONENT = 2.15; // CAL convexity of star scarcity
const PRODUCTION_SCALE_M = 0.01458; // CAL sets ability 90 = ~$60M/yr through the exponent above

/** Millions of on-court value per season at an ability level. */
function productionPerYearM(ability: number): number {
  const above = Math.max(0, ability - REPLACEMENT_ABILITY);
  return PRODUCTION_SCALE_M * Math.pow(above, PRODUCTION_EXPONENT);
}

// Fair-AAV curve (CAL): what the open market would pay that ability.
// Quadratic in ability with a minimum-contract floor and the max-tier
// ceiling; the gap between production and fair pay at the very top is the
// max-contract subsidy (REAL: the CBA caps pay, not production).
const FAIR_AAV_FLOOR_PCT = 0.012;  // REAL-ish: veteran-minimum territory, ~1.2% of cap (research 06 §4 table)
const FAIR_AAV_BASE_ABILITY = 45;  // FEEL: below this the market only offers minimums
const FAIR_AAV_QUAD = 0.000128;    // CAL: lands ability 90 at ~27% of cap, 75 at ~13%
const FAIR_AAV_CEIL_PCT = 0.35;    // REAL: the 35% top max tier (research 06 §2)

/**
 * Fair market annual salary (integer dollars) for an ability level, priced
 * against the current season's cap line. The trade AI uses it to judge
 * whether a contract is a bargain or an albatross; tests anchor against it.
 */
export function fairAav(league: League, ability: number): number {
  const lines = league.capLines[league.season];
  if (!lines) throw new Error(`fairAav: no cap lines for season ${league.season}`);
  const above = Math.max(0, ability - FAIR_AAV_BASE_ABILITY);
  const pct = Math.min(FAIR_AAV_CEIL_PCT, FAIR_AAV_FLOOR_PCT + above * above * FAIR_AAV_QUAD);
  return Math.round(lines.cap * pct); // ROUNDING: whole dollars once
}

// --------------------------------------------------------------------------
// age, health, timeline lenses

// Age curve (REAL-shaped, research 05 B2: peak ~27, prime holds through
// ~30, visible decline after): projection multipliers on a season's
// production given the player's age IN that season.
const AGE_PEAK = 27;          // REAL consensus peak age
const AGE_PRIME_END = 30;     // REAL-ish: decline is visible after 30-31
const AGE_RISE_PER_YEAR = 0.035; // CAL upside per year under peak (a 23-year-old projects ~14% over his sheet)
const AGE_RISE_CAP = 1.25;    // FEEL cap so teenagers do not project absurdly
const AGE_FALL_PER_YEAR = 0.09;  // CAL hard fall per year past 30 (research 05 B2 "decline after 30-32")
const AGE_FALL_FLOOR = 0.25;  // FEEL even a 38-year-old's floor is not zero

/** Production multiplier for playing a season at a given age. */
function ageMultiplier(age: number): number {
  if (age < AGE_PEAK) return Math.min(AGE_RISE_CAP, 1 + AGE_RISE_PER_YEAR * (AGE_PEAK - age));
  if (age <= AGE_PRIME_END) return 1;
  return Math.max(AGE_FALL_FLOOR, 1 - AGE_FALL_PER_YEAR * (age - AGE_PRIME_END));
}

// Health lens (FEEL): chronic wear and above-average proneness discount
// every projected season - availability is production.
const WEAR_PENALTY_AT_100 = 0.35;      // FEEL a fully worn body loses ~a third of projection
const PRONENESS_PENALTY_AT_100 = 0.30; // FEEL discount at proneness 100 vs the 50 baseline
const HEALTH_MULT_FLOOR = 0.40;        // FEEL nobody projects below 40% for durability alone
const SEASON_CALENDAR_DAYS = 174;      // REAL ~174-day regular season (params.calendar default)
const INJURY_NOW_PENALTY = 0.6;        // FEEL an injured season-fraction is mostly lost value

function healthMultiplier(player: FrPlayer): number {
  // wear and proneness are 0-100 ratings; /100 maps to a fraction and 50
  // is the league-neutral proneness baseline (only ABOVE-average fragility
  // discounts - durability is priced as the absence of a problem)
  const wearPart = (player.health.wear / 100) * WEAR_PENALTY_AT_100;
  const pronePart = (Math.max(0, player.health.proneness - 50) / 100) * PRONENESS_PENALTY_AT_100;
  return Math.max(HEALTH_MULT_FLOOR, 1 - wearPart - pronePart);
}

// Timeline lenses (FEEL): applied to POSITIVE per-year surplus only. A bad
// contract is equally bad for everyone - discounting a liability would
// make rebuilders volunteer to be dumped on, the exploit research 05 A5d
// documents.
const REBUILD_VET_AGE = 29;        // FEEL a rebuilder cannot use age-29+ seasons
const REBUILD_VET_DISCOUNT = 0.55; // FEEL those seasons keep resale value only
const CONTEND_PROSPECT_AGE = 22;   // FEEL under-22 = unproven for a win-now roster
const CONTEND_PROSPECT_ABILITY = 70; // FEEL unless the kid is already this good
const CONTEND_PROSPECT_DISCOUNT = 0.6; // FEEL a contender cannot play a project

// Star premium (FEEL): contenders value top-end concentration beyond raw
// surplus - a playoff rotation has ~9 spots and the best player on the
// floor decides series, so consolidating two goods into one great is worth
// paying for. Scaled by persona starChase ("the star-chaser really does
// overpay at the deadline", docs/FRANCHISE.md §7).
const STAR_PREMIUM_ABILITY = 80;   // FEEL where "star" starts
const STAR_PREMIUM_PER_POINT = 0.06; // FEEL premium slope per ability point above 80
const STAR_CHASE_SCALE_LO = 0.6;   // FEEL premium scale at starChase 0
const STAR_CHASE_SCALE_SPAN = 0.8; // FEEL added scale at starChase 100 (so 50 = x1.0)

// Usage redundancy (FEEL small): a fourth high-usage star shares one ball.
const REDUNDANT_USAGE_TEND = 75;   // FEEL tend.usage at "needs the ball" level
const REDUNDANT_ABILITY = 75;      // FEEL only stars create real redundancy
const REDUNDANT_STAR_COUNT = 3;    // FEEL three incumbent hubs saturate an offense
const REDUNDANCY_DISCOUNT = 0.88;  // FEEL small by design; fit is a nudge, not a veto

// --------------------------------------------------------------------------
// player value

/**
 * Team-context surplus value of a player TO the valuing team, in
 * millions-equivalent units. Negative values are real and important: they
 * are how salary dumps price. Sums, per remaining contract season inside
 * params.trade.horizonSeasons: production (ability through the age curve
 * and health lens) minus salary, with the valuing team's timeline lens on
 * positive years, a contender star premium, and a light usage-redundancy
 * discount. Floored at minus the remaining guaranteed money - a bad deal
 * can always be waived, so its damage is bounded (research 05 A5d).
 * Pure read; never mutates.
 */
export function playerValue(league: League, teamId: TeamId, playerId: string): number {
  const player = league.players[playerId];
  if (!player) throw new Error(`playerValue: unknown player ${playerId}`);
  const team = league.teams[teamId];
  if (!team) throw new Error(`playerValue: unknown team ${teamId}`);
  const contract = player.contract;
  if (!contract) return 0; // no contract = nothing under team control to trade

  const timeline = team.strategy.timeline;
  const persona = team.gm; // null for the user team: neutral persona weights
  const ability = abilityScore(player);
  const age = league.season - player.bornSeason; // age convention: types.ts Season doc
  const perYear = productionPerYearM(ability);
  const health = healthMultiplier(player);

  const horizonEnd = league.season + league.params.trade.horizonSeasons;
  let total = 0;
  let guaranteedRemainingM = 0;
  for (const year of contract.years) {
    if (year.season < league.season) continue;
    guaranteedRemainingM += year.guaranteed / 1e6; // integer dollars -> millions-equivalent units
    if (year.season >= horizonEnd) continue; // beyond the pricing horizon (V3)
    const yearsOut = year.season - league.season;
    let production = perYear * ageMultiplier(age + yearsOut) * health;
    // a currently injured player loses most of the remaining injured
    // fraction of THIS season; future seasons price through proneness/wear
    if (yearsOut === 0 && player.health.injury) {
      const lostFrac = Math.min(1, player.health.injury.remainingDays / SEASON_CALENDAR_DAYS);
      production *= 1 - lostFrac * INJURY_NOW_PENALTY;
    }
    let surplus = production - year.salary / 1e6; // integer dollars -> millions
    if (surplus > 0) {
      // timeline lens on the upside only (see header note)
      if (timeline === 'rebuild' && age + yearsOut >= REBUILD_VET_AGE) surplus *= REBUILD_VET_DISCOUNT;
      if (timeline === 'contend' && age < CONTEND_PROSPECT_AGE && ability < CONTEND_PROSPECT_ABILITY) {
        surplus *= CONTEND_PROSPECT_DISCOUNT;
      }
    }
    total += surplus;
  }

  if (total > 0 && timeline === 'contend' && ability >= STAR_PREMIUM_ABILITY) {
    const chase = persona ? persona.starChase : 50; // 50 = neutral persona for the user team
    const chaseScale = STAR_CHASE_SCALE_LO + (chase / 100) * STAR_CHASE_SCALE_SPAN; // 0-100 trait -> fraction
    total *= 1 + (ability - STAR_PREMIUM_ABILITY) * STAR_PREMIUM_PER_POINT * chaseScale;
  }

  if (total > 0 && player.tend.usage >= REDUNDANT_USAGE_TEND && ability >= REDUNDANT_ABILITY) {
    let hubs = 0;
    for (const pid of team.roster) {
      if (pid === playerId) continue;
      const mate = league.players[pid];
      if (!mate) continue;
      if (mate.tend.usage >= REDUNDANT_USAGE_TEND && abilityScore(mate) >= REDUNDANT_ABILITY) hubs++;
    }
    if (hubs >= REDUNDANT_STAR_COUNT) total *= REDUNDANCY_DISCOUNT;
  }

  // waivability floor: the worst a contract can be is its guaranteed money
  return Math.max(total, -guaranteedRemainingM);
}

// --------------------------------------------------------------------------
// pick value

// Expected-slot model (FEEL bands): where a pick lands comes from its
// ORIGINAL team's standing today; the future is a league-average slot
// pulled toward that team's timeline, fading with distance (three summers
// out, anyone can be anything).
const LEAGUE_AVERAGE_SLOT = 15;     // REAL midpoint of a 30-team first round
const SLOT_LOTTERY_PULL = 0.15;     // FEEL lottery variance pulls a record-implied slot toward the middle
const SLOT_TIMELINE_REBUILD = 8;    // FEEL a rebuilding original team projects high-lottery
const SLOT_TIMELINE_CONTEND = 22;   // FEEL a contending original team projects late-first
const SLOT_PULL_BASE = 0.75;        // FEEL timeline pull strength for the very next draft
const SLOT_PULL_FADE_PER_SEASON = 0.15; // FEEL pull fades per season of distance
const SLOT_PULL_FLOOR = 0.15;       // FEEL some signal survives even far out
const ROUND2_SLOT_OFFSET = 30;      // REAL round-2 picks are slots 31-60
const MIN_GAMES_FOR_SLOT = 20;      // FEEL quarter-season of standings before the record speaks

// Protection conveyance bands (FEEL, rough by design): probability the pick
// actually conveys, from the gap between expected slot and the protection.
// A top-12-protected pick from a mid team mostly never becomes a pick.
const CONVEY_BANDS: ReadonlyArray<{ minDiff: number; p: number }> = [
  { minDiff: 9, p: 0.92 },   // FEEL comfortably outside the protection
  { minDiff: 5, p: 0.80 },   // FEEL likely out
  { minDiff: 1, p: 0.60 },   // FEEL coin-flip-plus
  { minDiff: -3, p: 0.35 },  // FEEL likely swallowed
  { minDiff: -Infinity, p: 0.15 }, // FEEL deep inside: a promise, not a pick
];

// Persona/timeline lenses on picks (FEEL): hoarders really value picks,
// contenders discount seconds that arrive after the window closes.
const PICK_LOVE_SCALE_LO = 0.85;   // FEEL pick multiplier at pickLove 0
const PICK_LOVE_SCALE_SPAN = 0.30; // FEEL added multiplier at pickLove 100 (so 50 = x1.0)
const CONTEND_FUTURE_FADE = 0.08;  // FEEL contender discount per season of pick distance
const CONTEND_FUTURE_FLOOR = 0.6;  // FEEL never below this: picks are still currency
const REBUILD_PICK_PREMIUM = 1.10; // FEEL a rebuilder's whole plan is picks

/** League-wide rank of a team's record, 1 = worst. Ties break by id (stable). */
function rankFromBottom(league: League, teamId: TeamId): { rank: number; games: number; teams: number } {
  const ids = Object.keys(league.teams).sort();
  const rows = ids.map(id => {
    const s = league.standings[id];
    const games = s ? s.w + s.l : 0;
    return { id, pct: games > 0 ? s!.w / games : 0.5, games };
  });
  rows.sort((a, b) => a.pct - b.pct || (a.id < b.id ? -1 : 1));
  const idx = rows.findIndex(r => r.id === teamId);
  return { rank: idx + 1, games: rows[idx]!.games, teams: ids.length };
}

/** Expected first-round slot for a pick, from standing or timeline pull. */
function expectedSlot(league: League, pick: DraftPick): number {
  if (pick.resolvedNumber) return pick.resolvedNumber; // order known: no model needed
  const seasonsOut = Math.max(0, pick.season - (league.season + 1)); // next draft = season+1 (contracts.ts signingSeason)
  const orig = league.teams[pick.originalTeam];
  if (seasonsOut === 0 && orig) {
    const { rank, games, teams } = rankFromBottom(league, pick.originalTeam);
    if (games >= MIN_GAMES_FOR_SLOT) {
      // worst record drafts first; the lottery pulls the implied slot
      // toward the middle (the odds table flattened in 2019, research 06)
      const implied = rank * (30 / teams); // scale small fixture leagues onto the 30-slot board
      return implied + (LEAGUE_AVERAGE_SLOT - implied) * SLOT_LOTTERY_PULL;
    }
  }
  const target = orig
    ? (orig.strategy.timeline === 'rebuild' ? SLOT_TIMELINE_REBUILD
      : orig.strategy.timeline === 'contend' ? SLOT_TIMELINE_CONTEND : LEAGUE_AVERAGE_SLOT)
    : LEAGUE_AVERAGE_SLOT;
  const pull = Math.max(SLOT_PULL_FLOOR, SLOT_PULL_BASE - SLOT_PULL_FADE_PER_SEASON * seasonsOut);
  return LEAGUE_AVERAGE_SLOT + (target - LEAGUE_AVERAGE_SLOT) * pull;
}

/**
 * Team-context value of a draft pick, in the same millions-equivalent
 * units as playerValue: params.trade.pickOneValue at slot 1 decaying
 * geometrically down the board (research 05 B7: steep at the top,
 * flattening tail in absolute increments), future seasons discounted,
 * protections shaved by rough conveyance-probability bands, then the
 * valuing team's pickLove/timeline lens. Pure read.
 */
export function pickValue(league: League, teamId: TeamId, pick: DraftPick): number {
  const t = league.params.trade;
  const team = league.teams[teamId];
  if (!team) throw new Error(`pickValue: unknown team ${teamId}`);
  const slot = expectedSlot(league, pick) + (pick.round === 2 ? ROUND2_SLOT_OFFSET : 0);
  let value = t.pickOneValue * Math.pow(t.pickValueDecay, slot - 1);

  const seasonsOut = Math.max(0, pick.season - (league.season + 1));
  value *= Math.pow(t.futurePickDiscount, seasonsOut);

  if (pick.protection) {
    const diff = slot - pick.protection.topN;
    for (const band of CONVEY_BANDS) {
      if (diff >= band.minDiff) { value *= band.p; break; }
    }
  }

  const persona = team.gm;
  const pickLove = persona ? persona.pickLove : 50; // neutral for the user team
  value *= PICK_LOVE_SCALE_LO + (pickLove / 100) * PICK_LOVE_SCALE_SPAN; // 0-100 trait -> fraction
  if (team.strategy.timeline === 'contend') {
    value *= Math.max(CONTEND_FUTURE_FLOOR, 1 - CONTEND_FUTURE_FADE * seasonsOut);
  } else if (team.strategy.timeline === 'rebuild') {
    value *= REBUILD_PICK_PREMIUM;
  }
  return value;
}

// --------------------------------------------------------------------------
// package math

/** Find a pick object by id on either team in the offer (owner holds it). */
function findPick(league: League, offer: TradeOffer, pickId: string): DraftPick {
  for (const teamId of [offer.from, offer.to]) {
    const pick = league.teams[teamId]?.picks.find(p => p.id === pickId);
    if (pick) return pick;
  }
  throw new Error(`offerNet: pick ${pickId} is owned by neither team in the offer`);
}

/**
 * Net value of an offer from `perspective`'s side, in millions-equivalent
 * units: sum of what it receives minus sum of what it sends, every asset
 * priced by ITS OWN valuation (team-context playerValue/pickValue).
 * Positive = that front office gains. Pure read.
 */
export function offerNet(league: League, perspective: TeamId, offer: TradeOffer): number {
  if (perspective !== offer.from && perspective !== offer.to) {
    throw new Error(`offerNet: ${perspective} is not a party to the offer`);
  }
  const receives = perspective === offer.from ? offer.get : offer.give;
  const sends = perspective === offer.from ? offer.give : offer.get;
  let net = 0;
  for (const pid of receives.players) net += playerValue(league, perspective, pid);
  for (const pickId of receives.picks) net += pickValue(league, perspective, findPick(league, offer, pickId));
  for (const pid of sends.players) net -= playerValue(league, perspective, pid);
  for (const pickId of sends.picks) net -= pickValue(league, perspective, findPick(league, offer, pickId));
  return net;
}

/**
 * Gross size of an offer from one side's view: the sum of absolute values
 * moving in both directions, floored so threshold math on tiny deals never
 * divides against ~zero. The trade engine scales its accept/walk bands by
 * this (params.trade.acceptThreshold is a FRACTION of package size).
 */
export function packageSizeM(league: League, perspective: TeamId, offer: TradeOffer): number {
  const MIN_PACKAGE_M = 4; // FEEL floor: even a minimum-for-minimum swap is a 4M-scale decision
  let size = 0;
  for (const side of [offer.give, offer.get]) {
    for (const pid of side.players) size += Math.abs(playerValue(league, perspective, pid));
    for (const pickId of side.picks) size += Math.abs(pickValue(league, perspective, findPick(league, offer, pickId)));
  }
  return Math.max(MIN_PACKAGE_M, size);
}
