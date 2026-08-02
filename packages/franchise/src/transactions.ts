/**
 * transactions.ts - the ONLY writers of roster/contract/pick state.
 * Every executor validates first (never trust the caller), mutates the
 * league, appends the Transaction to the ledger, and returns it. News and
 * inbox items are NOT written here: the media layer reads
 * league.transactions and writes the paper trail itself.
 *
 * Register of simplifications:
 * - X1 The waiver wire is immediate: a waived player becomes a free agent
 *   the same day (rights: null). The 48-hour claim window and waiver
 *   priority order are out of v1; executeClaim therefore signs the player
 *   to a fresh one-year minimum instead of assuming his old contract.
 * - X2 executeTrade keeps birdYearsAtSigning unchanged: Bird rights travel
 *   with a trade (research 06 §5, "rights travel in trades").
 * - X3 Round-2 picks sign 2-year minimum deals (the Second-Round Pick
 *   Exception's 3-4 year shapes are out of v1; research 06 §9).
 * - X4 executeExtension replaces the contract's future years wholesale
 *   with the new deal starting at the extension's first season; real
 *   extensions append to the existing years. The cap totals are the same;
 *   the ledger loses the "original vs extended" distinction.
 */
import type {
  Contract, FrPlayer, League, LeagueDate, PlayerId, TeamId, TradeOffer, Transaction,
} from './types.js';
import { minSalaryFor, rookieScaleContract, signingSeason, validateSigning, yearsOfService } from './cba/contracts.js';
import { validateTrade } from './cba/tradelegal.js';

/** The ledger append + return, shared by every executor. */
function ledger(league: League, tx: Transaction): Transaction {
  league.transactions.push(tx);
  return tx;
}

function now(league: League): LeagueDate {
  return { season: league.season, day: league.day };
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`transactions: unknown ${label}`);
  return value;
}

/** Remove a player id from whichever list of the team holds it. */
function dropFromTeam(league: League, teamId: TeamId, playerId: PlayerId): void {
  const team = must(league.teams[teamId], `team ${teamId}`);
  const r = team.roster.indexOf(playerId);
  if (r >= 0) team.roster.splice(r, 1);
  const w = team.twoWay.indexOf(playerId);
  if (w >= 0) team.twoWay.splice(w, 1);
  // rotation hygiene: a departed player must not linger in policy
  const rot = team.rotation;
  delete rot.minutes[playerId];
  rot.starters = rot.starters.filter(id => id !== playerId);
  rot.scratches = rot.scratches.filter(id => id !== playerId);
}

/** Execute a validated trade: players, contracts, picks, ledger. */
export function executeTrade(league: League, offer: TradeOffer): Transaction {
  const verdict = validateTrade(league, offer);
  if (!verdict.ok) throw new Error(`illegal trade: ${verdict.errors.join('; ')}`);

  const moves: Array<{ playerId: PlayerId; from: TeamId; to: TeamId }> = [];
  const moveSide = (players: PlayerId[], from: TeamId, to: TeamId): void => {
    for (const pid of players) {
      const player = must(league.players[pid], `player ${pid}`);
      const wasTwoWay = league.teams[from]!.twoWay.includes(pid);
      dropFromTeam(league, from, pid);
      const target = must(league.teams[to], `team ${to}`);
      if (wasTwoWay) target.twoWay.push(pid);
      else target.roster.push(pid);
      if (player.contract) player.contract.teamId = to; // Bird years unchanged (X2)
      moves.push({ playerId: pid, from, to });
    }
  };
  moveSide(offer.give.players, offer.from, offer.to);
  moveSide(offer.get.players, offer.to, offer.from);

  const pickMoves: Array<{ pickId: string; from: TeamId; to: TeamId }> = [];
  const movePicks = (picks: string[], from: TeamId, to: TeamId): void => {
    const fromTeam = league.teams[from]!;
    const toTeam = league.teams[to]!;
    for (const pickId of picks) {
      const idx = fromTeam.picks.findIndex(p => p.id === pickId);
      const pick = fromTeam.picks[idx]!;
      fromTeam.picks.splice(idx, 1);
      pick.owner = to;
      toTeam.picks.push(pick);
      pickMoves.push({ pickId, from, to });
    }
  };
  movePicks(offer.give.picks, offer.from, offer.to);
  movePicks(offer.get.picks, offer.to, offer.from);

  return ledger(league, {
    kind: 'trade', date: now(league), teams: [offer.from, offer.to],
    players: moves, picks: pickMoves,
  });
}

/**
 * Execute a signing whose contract is already built (buildContract or a
 * rookie-scale/two-way construction). Validation: for standard free-agent
 * deals the caller ran validateSigning to pick the means; this executor
 * re-checks the structural facts it can see (signable status, roster and
 * two-way ceilings) so a stale contract object cannot slip in.
 *
 * Lockstep: sheetExecutionBlock (tick.ts) mirrors these structural
 * re-checks so offer-sheet resolution can route around a block instead
 * of dying on the throw mid-day (#185). A structural throw added here
 * needs its mirror there.
 */
export function executeSigning(league: League, teamId: TeamId, playerId: PlayerId, contract: Contract, offerSheet?: boolean): Transaction {
  const player = must(league.players[playerId], `player ${playerId}`);
  const team = must(league.teams[teamId], `team ${teamId}`);
  if (player.status !== 'freeAgent' && player.status !== 'draftEligible') {
    throw new Error(`cannot sign ${player.name}: status ${player.status}`);
  }
  const cba = league.params.cba;
  if (contract.kind === 'twoWay') {
    if (team.twoWay.length >= cba.twoWaySlots) throw new Error(`two-way slots full (${cba.twoWaySlots})`);
    // 3 = REAL two-way service ceiling (research 06 §4: players with 4+
    // years of service cannot sign two-ways)
    if (yearsOfService(player) > 3) throw new Error(`${player.name} has too much service time for a two-way`);
  } else if (team.roster.length >= cba.rosterMax) {
    throw new Error(`roster already at the ${cba.rosterMax}-man maximum`);
  }

  player.contract = contract;
  player.status = 'roster';
  player.rights = null;
  const fa = league.freeAgents.indexOf(playerId);
  if (fa >= 0) league.freeAgents.splice(fa, 1);
  const dc = league.draftClass.indexOf(playerId);
  if (dc >= 0) league.draftClass.splice(dc, 1);
  if (contract.kind === 'twoWay') {
    team.twoWay.push(playerId);
    player.twoWayGamesUsed = 0;
  } else {
    team.roster.push(playerId);
  }

  return ledger(league, {
    kind: 'signing', date: now(league), teamId, playerId, contract,
    ...(offerSheet ? { offerSheet: true } : {}),
  });
}

/**
 * Waive a player. Remaining guaranteed money becomes dead cap: on the
 * scheduled years as-is, or stretched over 2n+1 seasons (research 06 §12)
 * with integer rows whose remainder lands on the first season.
 */
export function executeWaive(league: League, teamId: TeamId, playerId: PlayerId, stretch: boolean): Transaction {
  const player = must(league.players[playerId], `player ${playerId}`);
  const team = must(league.teams[teamId], `team ${teamId}`);
  if (!team.roster.includes(playerId) && !team.twoWay.includes(playerId)) {
    throw new Error(`${player.name} is not on ${teamId}`);
  }
  const contract = player.contract;
  const dead = league.deadMoney[teamId] ?? (league.deadMoney[teamId] = []);

  if (contract) {
    const remaining = contract.years.filter(y => y.season >= league.season && y.guaranteed > 0);
    if (stretch && remaining.length > 0) {
      let total = 0;
      for (const y of remaining) total += y.guaranteed;
      // 2n+1 (research 06 §12): n = remaining seasons on the deal
      const n = remaining.length;
      const span = league.params.cba.stretchMultiplier * n + 1;
      const per = Math.floor(total / span); // ROUNDING: floor, remainder to season 1
      const remainder = total - per * span;
      for (let i = 0; i < span; i++) {
        dead.push({ season: league.season + i, amount: per + (i === 0 ? remainder : 0), playerId });
      }
    } else {
      for (const y of remaining) dead.push({ season: y.season, amount: y.guaranteed, playerId });
    }
  }

  dropFromTeam(league, teamId, playerId);
  player.contract = null;
  player.status = 'freeAgent';
  player.rights = null; // a waived player is unrestricted with no hold (X1)
  league.freeAgents.push(playerId);

  return ledger(league, { kind: 'waive', date: now(league), teamId, playerId, stretched: stretch });
}

/**
 * Claim a "waived" player. Under the immediate-FA simplification (X1) a
 * claim is a fresh one-year minimum signing through the normal validator.
 */
export function executeClaim(league: League, teamId: TeamId, playerId: PlayerId): Transaction {
  const player = must(league.players[playerId], `player ${playerId}`);
  const terms = { years: 1, startSalary: minSalaryFor(league, player) };
  const verdict = validateSigning(league, teamId, playerId, terms, 'minimum');
  if (!verdict.ok) throw new Error(`claim failed: ${verdict.errors.join('; ')}`);
  const contract: Contract = {
    id: `ct-${playerId}-s${league.season}d${league.day}-claim`,
    playerId, teamId,
    years: [{ season: signingSeason(league), salary: terms.startSalary, guaranteed: terms.startSalary }],
    kind: 'restOfSeason',
    means: 'minimum',
    signedOn: now(league),
    birdYearsAtSigning: 0,
  };
  executeSigning(league, teamId, playerId, contract);
  // executeSigning appended a 'signing' row; the claim row is the ledger
  // truth the news desk prints (both remain, the signing is the mechanism)
  return ledger(league, { kind: 'claim', date: now(league), teamId, playerId });
}

/**
 * Draft-night selection: round 1 signs the rookie scale immediately;
 * round 2 signs a 2-year minimum (X3). Prospects always fit the roster
 * bound check here rather than in validateSigning (a draft pick is not a
 * free-agency signing).
 */
export function executeDraftSelection(league: League, teamId: TeamId, playerId: PlayerId, round: 1 | 2, pick: number): Transaction {
  const player = must(league.players[playerId], `player ${playerId}`);
  const team = must(league.teams[teamId], `team ${teamId}`);
  if (player.status !== 'draftEligible') throw new Error(`${player.name} is not draft-eligible`);
  if (team.roster.length >= league.params.cba.rosterMax) {
    throw new Error(`roster already at the ${league.params.cba.rosterMax}-man maximum; clear a spot before the pick`);
  }

  player.draft = { season: signingSeason(league), round, pick, teamId };
  let contract: Contract;
  if (round === 1) {
    contract = rookieScaleContract(league, teamId, playerId, pick);
  } else {
    const start = signingSeason(league);
    const min = minSalaryFor(league, player);
    contract = {
      id: `ct-${playerId}-s${league.season}d${league.day}`,
      playerId, teamId,
      // 2-year minimum with year 2 non-guaranteed: the common real shape
      // for second-rounders outside the SRP exception (X3)
      years: [
        { season: start, salary: min, guaranteed: min },
        { season: start + 1, salary: min, guaranteed: 0 },
      ],
      kind: 'standard',
      means: 'minimum',
      signedOn: now(league),
      birdYearsAtSigning: 0,
    };
  }
  executeSigning(league, teamId, playerId, contract);
  return ledger(league, { kind: 'draftSelection', date: now(league), teamId, playerId, round, pick });
}

/**
 * Team or player option decision. Exercising keeps the year (and marks it
 * guaranteed for team options); declining truncates the contract at the
 * option year, which sends the player to free agency at the ledger roll.
 */
export function executeOptionDecision(league: League, teamId: TeamId, playerId: PlayerId, option: 'team' | 'player', exercised: boolean): Transaction {
  const player = must(league.players[playerId], `player ${playerId}`);
  const contract = player.contract;
  if (!contract || contract.teamId !== teamId) throw new Error(`${player.name} has no contract with ${teamId}`);
  const idx = contract.years.findIndex(y => (option === 'team' ? y.teamOption : y.playerOption));
  if (idx < 0) throw new Error(`${player.name} has no ${option} option year`);
  const year = contract.years[idx]!;
  if (exercised) {
    if (option === 'team') year.guaranteed = year.salary; // exercised team option becomes guaranteed money
    delete year.teamOption;
    delete year.playerOption;
  } else {
    contract.years.splice(idx); // the option year and anything after it vanish
  }
  return ledger(league, { kind: 'optionDecision', date: now(league), teamId, playerId, option, exercised });
}

/** Replace the contract's future with the extension deal (X4). */
export function executeExtension(league: League, teamId: TeamId, playerId: PlayerId, contract: Contract): Transaction {
  const player = must(league.players[playerId], `player ${playerId}`);
  if (!player.contract || player.contract.teamId !== teamId) {
    throw new Error(`${player.name} has no contract with ${teamId} to extend`);
  }
  player.contract = contract;
  return ledger(league, { kind: 'extension', date: now(league), teamId, playerId, contract });
}

/** G-League assignment / recall. Status toggle only; development effects live in people/dev. */
export function executeAssignment(league: League, teamId: TeamId, playerId: PlayerId, to: 'gleague' | 'roster'): Transaction {
  const player = must(league.players[playerId], `player ${playerId}`);
  const team = must(league.teams[teamId], `team ${teamId}`);
  if (!team.roster.includes(playerId) && !team.twoWay.includes(playerId)) {
    throw new Error(`${player.name} is not with ${teamId}`);
  }
  player.status = to === 'gleague' ? 'gleague' : 'roster';
  return ledger(league, { kind: 'assignment', date: now(league), teamId, playerId, to });
}

/** Retirement: the ledger row plus the roster/contract cleanup. */
export function executeRetirement(league: League, playerId: PlayerId, date: LeagueDate): Transaction {
  const player = must(league.players[playerId], `player ${playerId}`);
  if (player.contract) {
    dropFromTeam(league, player.contract.teamId, playerId);
    player.contract = null;
  }
  const fa = league.freeAgents.indexOf(playerId);
  if (fa >= 0) league.freeAgents.splice(fa, 1);
  player.status = 'retired';
  player.rights = null;
  player.retiredSeason = league.season;
  return ledger(league, { kind: 'retirement', date, playerId });
}
