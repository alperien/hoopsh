/**
 * cba/contracts.ts - contract construction and signing legality: service
 * years, max/min tiers, rookie scale, exceptions, Bird tiers, and the
 * validator every signing flows through. OWNER: cba task.
 *
 * Every rule cites docs/history/franchise-research/06-cba-rules.md
 * ("research 06"). Money is integer dollars; rounding points are commented.
 *
 * Register of simplifications (docs/FRANCHISE.md 6/13 discipline):
 * - C1 yearsOfService approximates real service accrual as: count of
 *   distinct seasons in the player's stat ledger, plus one for the season
 *   in progress when he is currently on a roster (status roster/gleague).
 *   The ledger is written at season end, so the in-progress season is not
 *   yet a row. Real YOS credits roster days; this counts seasons touched.
 * - C2 Early Bird ceiling is the player's max tier. Real: greater of 175%
 *   of prior salary or 105% of the league-average salary (research 06 5).
 *   FreeAgentRights does not carry prior salary in v1, so neither branch is
 *   computable; the max ceiling is the permissive-but-legal envelope. Lift
 *   when rights carry priorSalary.
 * - C3 Non-Bird ceiling is 120% of the applicable minimum. Real: greater of
 *   120% of prior salary or 120% of minimum (research 06 5); prior salary
 *   unavailable per C2, so only the minimum branch is kept (conservative:
 *   never authorizes an illegal deal).
 * - C4 Rookie scale uses a geometric pick curve (params rookieScalePick1PctOfCap
 *   and rookieScaleDecay) with flat 5% annual raises, floored at the rookie
 *   minimum. The real scale is a published per-pick table whose year-4 raise
 *   varies 26.1% to 80.5% by pick (research 06 3); the curve is the
 *   calibratable approximation.
 * - C5 Bi-Annual Exception "usable only every other year" (research 06 5) is
 *   NOT tracked: FrTeam has no BAE-usage field. BAE is treated as available
 *   whenever the apron-1 hard cap allows. Lift when team state records use.
 * - C6 The 105%-of-previous-salary max floor and Designated Veteran /
 *   Rose Rule tiers (research 06 2) are out of v1.
 * - C7 Hard caps are enforced at signing time only (a signing may not take
 *   the team past the apron its means hard-caps at). A persistent
 *   hard-capped-for-the-league-year flag is not stored.
 * - C8 The minimum exception ignores the vet-min reimbursement rule
 *   (research 06 4: 3+ YOS one-year minimums hit the cap at the 2-YOS
 *   rate); minimums count at face value.
 */
import type { Contract, ContractYear, FrPlayer, League, Season, SigningMeans, TeamId } from '../types.js';
import { capSheet } from './cap.js';

/**
 * The season a deal signed TODAY takes effect in. During the post-finals
 * phases (lottery, draft, moratorium, freeAgency, offseason) the league
 * year has turned even though `league.season` only increments at the
 * calendar rollover: a draft pick or July signing is season+1 business,
 * priced against season+1 cap lines (the spine calls rollCapLines at the
 * lottery transition so those lines exist). Integration fix by the
 * orchestrator; every cap-line lookup and contract-year construction in
 * this module flows through here.
 */
export function signingSeason(league: League): Season {
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

/** Cap line for the signing season; throws when it has not been rolled yet. */
function signingCap(league: League): number {
  const s = signingSeason(league);
  const cap = league.capLines[s]?.cap;
  if (cap === undefined) throw new Error(`no cap lines for signing season ${s}; rollCapLines must run at the lottery transition`);
  return cap;
}

export interface Legality { ok: boolean; errors: string[]; }

export interface SigningTerms {
  years: number;
  startSalary: number;
  raisesPct?: number;               // defaults to legal max for the means
  teamOptionLastYear?: boolean;
  playerOptionLastYear?: boolean;
}

/**
 * Years of service (seasons on any roster), driving the max tier, the
 * minimum table, and two-way eligibility. See header C1 for the
 * approximation. A drafted-but-unsigned prospect is 0; a rookie becomes 1
 * during his first season (matching real accrual: the service year is
 * earned over the season being played).
 */
export function yearsOfService(player: FrPlayer): number {
  const seasons = new Set<number>();
  for (const row of player.seasons) seasons.add(row.season);
  let yos = seasons.size;
  if (player.status === 'roster' || player.status === 'gleague') yos += 1;
  return yos;
}

/**
 * Max first-year salary: % of cap by service tier, 0-6 / 7-9 / 10+ years
 * (research 06 2; params.cba.maxPctByService = [0.25, 0.30, 0.35] REAL).
 * Anchor: 25% of the 2026-27 cap $164,961,000 is exactly $41,240,250.
 */
export function maxSalaryFor(league: League, player: FrPlayer): number {
  const cap = signingCap(league); // signing-season lines (see signingSeason)
  const yos = yearsOfService(player);
  // tier cutoffs 6 and 9 = REAL, research 06 2 (YOS 0-6 / 7-9 / 10+)
  const tier = yos <= 6 ? 0 : yos <= 9 ? 1 : 2;
  // ROUNDING: whole dollars; the published anchors are exact multiples so
  // this only matters for future odd-valued caps.
  return Math.round(cap * league.params.cba.maxPctByService[tier]!);
}

/**
 * Minimum salary by years of service, from the params %-of-cap table
 * (research 06 4 publishes the dollar scale; the table is indexed 0..10+,
 * so service beyond the last entry pins to it).
 */
export function minSalaryFor(league: League, player: FrPlayer): number {
  const cap = signingCap(league); // signing-season lines (see signingSeason)
  const table = league.params.cba.minSalaryPctByYos;
  const idx = Math.min(yearsOfService(player), table.length - 1);
  // ROUNDING: whole dollars, once.
  return Math.round(cap * table[idx]!);
}

/** The two-way salary: 50% of the rookie (0 YOS) minimum (research 06 4). */
function twoWaySalary(league: League): number {
  const cap = signingCap(league);
  const rookieMin = Math.round(cap * league.params.cba.minSalaryPctByYos[0]!);
  // ROUNDING: rounds the published rookie minimum first (that number is the
  // real anchor), then halves and rounds again, mirroring how the league
  // derives the two-way figure from the published minimum.
  return Math.round(rookieMin * league.params.cba.twoWaySalaryPctOfRookieMin);
}

/** Rookie-scale year-1 salary for a pick, floored at the rookie minimum (header C4). */
function rookieScaleYearOne(league: League, pick: number): number {
  const cba = league.params.cba;
  const cap = signingCap(league);
  // geometric decay down the board; pick 1 anchored as % of cap.
  // ROUNDING: whole dollars after the full product.
  const raw = Math.round(cap * cba.rookieScalePick1PctOfCap * Math.pow(cba.rookieScaleDecay, pick - 1));
  // no NBA contract pays below the applicable minimum: floor late-pick scale
  // amounts at the 0-YOS minimum (research 06 4 table is the floor of all pay)
  const rookieMin = Math.round(cap * cba.minSalaryPctByYos[0]!);
  return Math.max(raw, rookieMin);
}

/** Deterministic contract id: a player signs at most one deal per league day. */
function contractId(league: League, playerId: string): string {
  return `ct-${playerId}-s${league.season}d${league.day}`;
}

/**
 * The rookie-scale contract for a first-round pick: rookieScaleYears (2)
 * guaranteed seasons plus 2 team-option seasons, 5% annual raises off year 1
 * (research 06 3: real year-2/3 steps are ~5%; the varying year-4 step is
 * simplified away, header C4). Option years carry guaranteed 0 until the
 * option is exercised (executeOptionDecision), so waiving a rookie before
 * his options creates no dead money for those years.
 *
 * Called by executeDraftSelection for round-1 picks. Pure construction: no
 * league mutation, no validation (a draft pick is always signable).
 */
export function rookieScaleContract(league: League, teamId: TeamId, playerId: string, pick: number): Contract {
  const cba = league.params.cba;
  const y1 = rookieScaleYearOne(league, pick);
  // the scale's per-year step shares the 5% non-Bird raise knob (research 06
  // 2 and 3 both say 5%); raises are % of YEAR-1 salary, not compounding
  const raise = Math.round(y1 * cba.raisePctOther); // ROUNDING: raise amount fixed once, integer
  const guaranteedYears = cba.rookieScaleYears;
  // 2 = REAL, research 06 3: 4-year deals, years 3 and 4 are team options
  const optionYears = 2;
  const startSeason = signingSeason(league);
  const years: ContractYear[] = [];
  for (let i = 0; i < guaranteedYears + optionYears; i++) {
    const salary = y1 + raise * i;
    const isOption = i >= guaranteedYears;
    years.push({
      season: startSeason + i,
      salary,
      guaranteed: isOption ? 0 : salary,
      ...(isOption ? { teamOption: true } : {}),
    });
  }
  return {
    id: contractId(league, playerId),
    playerId,
    teamId,
    years,
    kind: 'rookieScale',
    means: 'rookieScale',
    signedOn: { season: league.season, day: league.day },
    birdYearsAtSigning: 0,
  };
}

// ---------------------------------------------------------------------------
// means legality

/** Exception amount as % of cap, rounded to whole dollars once. */
function exceptionAmount(league: League, pct: number): number {
  return Math.round(signingCap(league) * pct);
}

/** Max years a deal signed via this means may run (research 06 2 and 5). */
function maxYearsForMeans(league: League, means: SigningMeans): number {
  const cba = league.params.cba;
  switch (means) {
    case 'bird': return cba.maxYearsBird;        // 5, research 06 2
    case 'earlyBird': return cba.maxYearsOther;  // 4, research 06 5
    case 'nonBird': return cba.maxYearsOther;    // 4, research 06 5
    case 'mle': return 4;                        // 4 = REAL, research 06 5 exception table
    case 'taxMle': return 2;                     // 2 = REAL, research 06 5
    case 'room': return 3;                       // 3 = REAL, research 06 5
    case 'bae': return 2;                        // 2 = REAL, research 06 5
    case 'minimum': return 2;                    // 2 = REAL, research 06 4 minimum exception
    default: return cba.maxYearsOther;           // capSpace and everything else: 4, research 06 2
  }
}

/** Max annual raise for the means: 8% Bird/Early Bird, 5% otherwise (research 06 2 and 5). */
function maxRaiseForMeans(league: League, means: SigningMeans): number {
  const cba = league.params.cba;
  return means === 'bird' || means === 'earlyBird' ? cba.raisePctBird : cba.raisePctOther;
}

/**
 * Errors specific to signing via one means, or [] when that means works.
 * Shared by validateSigning (full verdict) and availableMeans (filter).
 */
function meansErrors(league: League, teamId: TeamId, player: FrPlayer, terms: SigningTerms, means: SigningMeans): string[] {
  const cba = league.params.cba;
  const sheet = capSheet(league, teamId, signingSeason(league));
  const errors: string[] = [];
  const salary = terms.startSalary;

  switch (means) {
    case 'capSpace': {
      // space must absorb the deal COUNTING holds (research 06 5: an
      // over-the-cap team's space is fiction until holds are resolved),
      // except the target's own hold: signing him replaces it.
      let space = sheet.spaceWithHolds;
      if (player.rights && player.rights.teamId === teamId) space += player.rights.capHold;
      if (space < salary) errors.push(`cap space ${space} cannot absorb salary ${salary} (holds counted)`);
      break;
    }
    case 'bird':
    case 'earlyBird':
    case 'nonBird': {
      // Bird family: only the team holding the matching rights tier
      if (!player.rights || player.rights.teamId !== teamId) {
        errors.push(`${means} requires this team to hold the player's free-agent rights`);
      } else if (player.rights.tier !== means) {
        errors.push(`rights tier is ${player.rights.tier}, not ${means}`);
      }
      if (means === 'nonBird') {
        // 1.20 = REAL, research 06 5: Non-Bird up to 120% of prior salary or
        // 120% of minimum; only the minimum branch is computable (header C3).
        // ROUNDING: whole dollars.
        const ceiling = Math.round(minSalaryFor(league, player) * 1.20);
        if (salary > ceiling) errors.push(`non-Bird ceiling ${ceiling} exceeded by ${salary}`);
      }
      if (means === 'earlyBird' && terms.years < 2) {
        // 2 = REAL, research 06 5: Early Bird deals are minimum 2 years
        errors.push('early Bird deals must run at least 2 years');
      }
      break;
    }
    case 'mle': {
      const amount = exceptionAmount(league, cba.mlePctOfCap);
      if (salary > amount) errors.push(`non-taxpayer MLE ${amount} exceeded by ${salary}`);
      // using the full MLE hard-caps at the first apron (research 06 Appendix A)
      if (sheet.total + salary > sheet.apron1) errors.push('MLE signing would leave team above apron 1 (hard cap)');
      break;
    }
    case 'taxMle': {
      const amount = exceptionAmount(league, cba.taxMlePctOfCap);
      if (salary > amount) errors.push(`taxpayer MLE ${amount} exceeded by ${salary}`);
      // any MLE use hard-caps at the second apron (research 06 Appendix A):
      // usable only when the team stays under apron 2 with the deal on the books
      if (sheet.total + salary > sheet.apron2) errors.push('taxpayer MLE signing would leave team above apron 2 (hard cap)');
      break;
    }
    case 'room': {
      const amount = exceptionAmount(league, cba.roomPctOfCap);
      if (salary > amount) errors.push(`room exception ${amount} exceeded by ${salary}`);
      // room exception belongs to teams operating under the cap (research 06 5);
      // v1 gates on current payroll at-or-under the cap rather than tracking
      // whether cap room was actually used first
      if (sheet.total > sheet.cap) errors.push('room exception requires a team at or under the cap');
      break;
    }
    case 'bae': {
      const amount = exceptionAmount(league, cba.baePctOfCap);
      if (salary > amount) errors.push(`bi-annual exception ${amount} exceeded by ${salary}`);
      // BAE hard-caps at the first apron (research 06 Appendix A); the
      // every-other-year restriction is untracked (header C5)
      if (sheet.total + salary > sheet.apron1) errors.push('BAE signing would leave team above apron 1 (hard cap)');
      break;
    }
    case 'minimum': {
      // the minimum exception pays exactly the applicable minimum and is
      // always available (research 06 4); the global floor check in
      // validateSigning forces salary >= minimum, this caps the other side
      const min = minSalaryFor(league, player);
      if (salary > min) errors.push(`minimum exception cannot pay ${salary} above the minimum ${min}`);
      break;
    }
    default:
      // rookieScale/extension/genesis flow through their own executors,
      // never through free-agency validation
      errors.push(`means ${means} is not signable via free agency`);
  }

  const maxYears = maxYearsForMeans(league, means);
  if (terms.years > maxYears) errors.push(`${means} deals max ${maxYears} years, asked ${terms.years}`);
  return errors;
}

/** Candidate order is the design's best-first order (docs/FRANCHISE.md 6). */
const MEANS_ORDER: SigningMeans[] = [
  'capSpace', 'bird', 'earlyBird', 'nonBird', 'mle', 'taxMle', 'room', 'bae', 'minimum',
];

/**
 * Which means could legally sign these terms, best first: cap space, then
 * Bird tiers (own free agents), then the exceptions by apron status, with
 * the minimum always last. The FA market AI and the signing UI both read
 * this; validateSigning is the authoritative check for the chosen means.
 */
export function availableMeans(league: League, teamId: TeamId, playerId: string, terms: SigningTerms): SigningMeans[] {
  if (!league.players[playerId]) throw new Error(`availableMeans: unknown player ${playerId}`);
  const out: SigningMeans[] = [];
  for (const means of MEANS_ORDER) {
    // validateSigning already folds in meansErrors, so one call per
    // candidate is the whole filter
    if (validateSigning(league, teamId, playerId, terms, means).ok) out.push(means);
  }
  return out;
}

/**
 * Full legality verdict for signing a player to terms via a means. Enforces:
 * player signability, means legality (amounts, rights, hard caps), max/min
 * salary bounds, years-by-means, raise limits, option sanity, and the
 * 15-man roster ceiling. Two-way and 10-day deals validate in
 * transactions.ts (their shapes are not expressible as SigningTerms).
 * Pure read; executeSigning calls it and throws on failure.
 */
export function validateSigning(league: League, teamId: TeamId, playerId: string, terms: SigningTerms, means: SigningMeans): Legality {
  const errors: string[] = [];
  const player = league.players[playerId];
  const team = league.teams[teamId];
  if (!player) return { ok: false, errors: [`unknown player ${playerId}`] };
  if (!team) return { ok: false, errors: [`unknown team ${teamId}`] };

  if (player.status !== 'freeAgent' && player.status !== 'draftEligible') {
    errors.push(`player status ${player.status} is not signable`);
  }
  if (!Number.isInteger(terms.startSalary) || terms.startSalary <= 0) {
    errors.push('startSalary must be a positive integer dollar amount');
  }
  if (!Number.isInteger(terms.years) || terms.years < 1) {
    errors.push('years must be a positive integer');
  }
  if (terms.teamOptionLastYear && terms.playerOptionLastYear) {
    errors.push('a year cannot be both a team option and a player option');
  }

  // global salary envelope: every contract sits between the player's
  // minimum and his max tier (research 06 2 and 4)
  const max = maxSalaryFor(league, player);
  const min = minSalaryFor(league, player);
  if (terms.startSalary > max) errors.push(`salary ${terms.startSalary} exceeds max ${max}`);
  if (terms.startSalary < min) errors.push(`salary ${terms.startSalary} below minimum ${min}`);

  // raise limit: 8% Bird family, 5% otherwise, measured off year-1 salary;
  // real deals may also decline by the same bound, so the magnitude is
  // what's checked (research 06 2)
  if (terms.raisesPct !== undefined) {
    const cap = maxRaiseForMeans(league, means);
    // 1e-6 tolerance absorbs integer-rounding of raise amounts when terms
    // are reconstructed from built contract rows (round(s*r)/s can exceed r
    // by up to 0.5/s, well under 1e-6 at NBA salaries)
    if (Math.abs(terms.raisesPct) > cap + 1e-6) {
      errors.push(`raises ${terms.raisesPct} exceed the ${cap} limit for ${means}`);
    }
  }

  errors.push(...meansErrors(league, teamId, player, terms, means));

  // 15-man standard roster ceiling (research 06 8); two-ways live in
  // team.twoWay and are checked in transactions.ts. Pending offer sheets
  // reserve spots: tick.ts resolves them by forced execution, so both
  // teams that might execute one must keep a spot open.
  if (!team.roster.includes(playerId)
    && team.roster.length + reservedSheetSpots(league, teamId, playerId) >= league.params.cba.rosterMax) {
    errors.push(`roster already at the ${league.params.cba.rosterMax}-man maximum`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Roster spots committed to unresolved offer sheets. Each pending sheet is
 * executed by tick.ts at the match deadline WITHOUT re-validation, onto one
 * of two teams: the rights-holding incumbent (matched) or the offering team
 * (unmatched). Both must therefore keep a spot open while the sheet is
 * live, or the forced execution would break the roster ceiling. The
 * sheet's own player never reserves against himself (executing HIS signing
 * consumes the reservation). Before #164 this was unreachable in organic
 * play: restricted free agents were scooped at minimums before the market
 * convened, so sheets never existed.
 */
export function reservedSheetSpots(league: League, teamId: TeamId, exceptPlayerId?: PlayerId): number {
  let n = 0;
  for (const s of league.offerSheets) {
    if (s.playerId === exceptPlayerId) continue;
    const incumbent = league.players[s.playerId]?.rights?.teamId;
    if (s.from === teamId || incumbent === teamId) n += 1;
  }
  return n;
}

/**
 * Build the exact integer contract rows for terms signed via a means.
 * Raises are a fixed dollar amount per year: the legal raise % of the
 * YEAR-1 salary (research 06 2: "8% of year-1 salary per year"), not
 * compounding. Team-option years carry guaranteed 0 until exercised;
 * player-option years are guaranteed (the player controls them).
 * Construction only: run validateSigning first (executeSigning does).
 */
export function buildContract(league: League, teamId: TeamId, playerId: string, terms: SigningTerms, means: SigningMeans): Contract {
  const player = league.players[playerId];
  if (!player) throw new Error(`buildContract: unknown player ${playerId}`);
  const raisePct = terms.raisesPct ?? maxRaiseForMeans(league, means);
  // ROUNDING: the annual raise amount is fixed once, in whole dollars
  const raise = Math.round(terms.startSalary * raisePct);
  const startSeason = signingSeason(league);
  const years: ContractYear[] = [];
  for (let i = 0; i < terms.years; i++) {
    const salary = terms.startSalary + raise * i;
    const last = i === terms.years - 1;
    const teamOption = last && terms.teamOptionLastYear === true;
    const playerOption = last && terms.playerOptionLastYear === true;
    years.push({
      season: startSeason + i,
      salary,
      guaranteed: teamOption ? 0 : salary, // v1: fully guaranteed except unexercised team options
      ...(teamOption ? { teamOption: true } : {}),
      ...(playerOption ? { playerOption: true } : {}),
    });
  }

  // Bird continuity at signing: rights tiers encode 3/2/1 prior seasons
  // with the team (research 06 5: full Bird 3, Early Bird 2, Non-Bird 1)
  let birdYears = 0;
  if (player.rights && player.rights.teamId === teamId) {
    birdYears = player.rights.tier === 'bird' ? 3 : player.rights.tier === 'earlyBird' ? 2 : 1;
  }

  const cba = league.params.cba;
  return {
    id: contractId(league, playerId),
    playerId,
    teamId,
    years,
    kind: 'standard',
    means,
    signedOn: { season: league.season, day: league.day },
    birdYearsAtSigning: birdYears,
    // recent-signee trade freeze (research 06 6: Dec 15 / 3 months, folded
    // into one day-count knob per the params register). Day arithmetic may
    // run past the calendar's end; LeagueDate comparisons are (season, day)
    // lexicographic so an oversized day still orders correctly.
    tradeableFrom: { season: league.season, day: league.day + cba.recentSigneeFreezeDays },
  };
}

/**
 * The qualifying offer that makes a pending free agent restricted.
 * Approximation (per design brief): rookie-scale year-4 salary x 1.25.
 * 1.25 = FEEL: research 06 3 puts the real pick-specific bump at +40%
 * (pick 1) to +60% (pick 30) of year-4 salary, so 1.25 undershoots; kept as
 * the briefed prior, flagged for calibration. Players without a rookie-scale
 * history (second-rounders, undrafted) get 125% of their minimum: research
 * 06 is silent on the exact non-scale QO formula, documented approximation.
 */
export function qualifyingOfferFor(league: League, playerId: string): number {
  const player = league.players[playerId];
  if (!player) throw new Error(`qualifyingOfferFor: unknown player ${playerId}`);
  // 1.25 = FEEL approximation of the QO bump (see JSDoc)
  const QO_BUMP = 1.25;
  if (player.contract && player.contract.kind === 'rookieScale') {
    const lastYear = player.contract.years[player.contract.years.length - 1]!;
    // ROUNDING: whole dollars once.
    return Math.round(lastYear.salary * QO_BUMP);
  }
  if (player.draft && player.draft.round === 1 && player.draft.pick >= 1) {
    // rights holder tendering a QO off the reconstructed scale (the deal may
    // already be off the books); rebuild year-4 from the same curve
    const y1 = rookieScaleYearOne(league, player.draft.pick);
    const raise = Math.round(y1 * league.params.cba.raisePctOther);
    // 3 = year-4 index on the 4-year scale shape (research 06 3)
    return Math.round((y1 + raise * 3) * QO_BUMP);
  }
  // non-scale players: minimum-based fallback (see JSDoc)
  return Math.round(minSalaryFor(league, player) * QO_BUMP);
}
