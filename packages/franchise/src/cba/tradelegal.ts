/**
 * cba/tradelegal.ts - trade legality: the deadline and July-moratorium
 * freezes, salary matching bands, apron restrictions, the Stepien rule,
 * recent-signee freezes, roster bounds.
 *
 * Every rule cites docs/history/franchise-research/06-cba-rules.md
 * ("research 06", mostly §6). Money is integer dollars.
 *
 * Register of simplifications (docs/FRANCHISE.md §13 discipline):
 * - T1 Cash, sign-and-trades, and non-simultaneous TPEs are not modeled
 *   (register F3); the matching bands below are the simultaneous-trade
 *   rules only.
 * - T2 The Stepien check ignores pick protections: a protected pick
 *   counts as owned even though it might not convey. Real front offices
 *   argue this both ways; the simple reading is the permissive one.
 * - T3 Roster bounds: post-trade rosters must land in [8, 15]. The real
 *   floor is 14 with short dip allowances (research 06 §8); 8 is the
 *   game-night uniform minimum. The AI roster-upkeep layer keeps teams
 *   near 14-15; legality only guards the hard floor.
 * - T4 The matching bands' small/expanded thresholds index to the cap by
 *   ratio from the 2026-27 anchors (research 06 §6 notes the indexing).
 * - T5 The moratorium freeze binds the whole 'moratorium' phase, which
 *   folds the post-draft dead days in (calendar.ts builder note), so
 *   late-June trades freeze a few days early. The signing rules already
 *   read the phase the same way (ai/fa.ts, cba/contracts.ts).
 */
import type { League, TeamId, TradeOffer } from '../types.js';
import type { Legality } from './contracts.js';
import { capSheet } from './cap.js';

/** This-season cap salary of a player, for matching math. */
function tradeSalary(league: League, playerId: string): number {
  const contract = league.players[playerId]?.contract;
  if (!contract) return 0;
  const row = contract.years.find(y => y.season === league.season);
  return row ? row.salary : 0;
}

/**
 * Max incoming salary for a team sending `outgoing` dollars out
 * (research 06 §6, 2026-27 anchors):
 * - below both aprons, incoming <= max of three formulas:
 *     200% of outgoing + $250k                 (small-salary band)
 *     outgoing + expanded-TPE amount           ($9,096,000 in 2026-27)
 *     125% of outgoing + $250k                 (large-salary band)
 * - at/over the first apron (or landing there): 100%, no buffer
 *   (research 06 §6: "apron teams match at <= 100%").
 * The expanded-TPE amount indexes to the cap (T4): 9.096M / 164.961M of
 * the current cap.
 */
export function maxIncomingFor(league: League, teamId: string, outgoing: number): number {
  const sheet = capSheet(league, teamId);
  if (sheet.overApron1) return outgoing; // 100% flat, research 06 §6
  const cba = league.params.cba;
  // 9_096_000 / genesisCap = REAL 2026-27 expanded-TPE ratio (research 06 §6)
  const expandedTpe = Math.round(sheet.cap * (9_096_000 / cba.genesisCap));
  const small = 2 * outgoing + cba.tradeMatchBufferDollars;   // 200% + 250k
  const mid = outgoing + expandedTpe;
  const large = Math.round(1.25 * outgoing) + cba.tradeMatchBufferDollars; // 125% + 250k
  const best = Math.max(small, mid, large);
  // an under-apron team cannot use the expanded bands to jump the first
  // apron: taking back more than 100% hard-caps there (research 06 §6),
  // so the take-back may not carry the team past apron1
  const roomToApron1 = sheet.apron1 - sheet.total;
  return Math.max(outgoing, Math.min(best, outgoing + Math.max(0, roomToApron1)));
}

/** LeagueDate comparison: (season, day) lexicographic. */
function dateLte(a: { season: number; day: number }, b: { season: number; day: number }): boolean {
  return a.season < b.season || (a.season === b.season && a.day <= b.day);
}

/**
 * The trade deadline day: the calendar mark when built, else the params
 * index. Mirror of ai/trade.ts#tradeDeadlineDay - legality cannot import
 * from ai/ (ai/trade.ts consumes this module; the import would be
 * circular), so the read is duplicated here. Keep the two in sync.
 */
function tradeDeadlineDay(league: League): number {
  const marked = league.calendar.find(d => d.marks.includes('tradeDeadline'));
  return marked ? marked.day : league.params.calendar.tradeDeadlineDayIndex;
}

/**
 * True from the day after the deadline through the end of the postseason
 * (research 06 §6: the deadline closes in-season trading), and through
 * the July moratorium (#249; types.ts: deals agreed but not signable).
 * Mirror of ai/trade.ts#tradingFrozen - see tradeDeadlineDay above for
 * why the predicate lives twice.
 */
function tradingFrozen(league: League): boolean {
  if (league.phase === 'playin' || league.phase === 'playoffs' || league.phase === 'moratorium') return true;
  return league.phase === 'regular' && league.day > tradeDeadlineDay(league);
}

/**
 * Full legality verdict for a two-team offer. Checks the deadline freeze
 * first, then both directions: player ownership and tradeability, salary
 * matching per apron status, second-apron aggregation, roster bounds,
 * pick ownership, and Stepien.
 * Pure read; executeTrade calls it and throws on failure.
 */
export function validateTrade(league: League, offer: TradeOffer): Legality {
  const errors: string[] = [];
  const from = league.teams[offer.from];
  const to = league.teams[offer.to];
  if (!from) return { ok: false, errors: [`unknown team ${offer.from}`] };
  if (!to) return { ok: false, errors: [`unknown team ${offer.to}`] };
  if (offer.from === offer.to) return { ok: false, errors: ['a team cannot trade with itself'] };

  // deadline law (#231) and the July moratorium (#249): the freeze binds
  // the ledger, not just the desk. respondToOffer refuses frozen talks at
  // the negotiation surface, but every EXECUTION path funnels through this
  // verdict (executeTrade throws on !ok), so the user's inbox accept at
  // deadline+1, the AI paths, and any future caller all hit the same wall.
  if (tradingFrozen(league)) {
    return league.phase === 'moratorium'
      ? { ok: false, errors: ['the July moratorium is in effect; trades complete when free agency opens'] }
      : { ok: false, errors: [`the trade deadline (day ${tradeDeadlineDay(league)}) has passed; trading reopens after the postseason`] };
  }

  const now = { season: league.season, day: league.day };

  // per-side player checks + salary sums
  const sides: Array<{ team: TeamId; players: string[]; label: string }> = [
    { team: offer.from, players: offer.give.players, label: 'give' },
    { team: offer.to, players: offer.get.players, label: 'get' },
  ];
  const outgoing: Record<string, number> = { [offer.from]: 0, [offer.to]: 0 };
  for (const side of sides) {
    const roster = league.teams[side.team]!.roster;
    const twoWay = league.teams[side.team]!.twoWay;
    for (const pid of side.players) {
      const player = league.players[pid];
      if (!player) { errors.push(`unknown player ${pid}`); continue; }
      if (!roster.includes(pid) && !twoWay.includes(pid)) {
        errors.push(`${player.name} is not on ${side.team}`);
        continue;
      }
      const contract = player.contract;
      if (!contract) { errors.push(`${player.name} has no contract to trade`); continue; }
      // 10-days and rest-of-season deals are untradeable (research 06 §4)
      if (contract.kind === 'tenDay' || contract.kind === 'restOfSeason') {
        errors.push(`${player.name} is on a ${contract.kind} deal and cannot be traded`);
      }
      // recent-signee freeze (research 06 §6; one day-count knob per params)
      if (contract.tradeableFrom && !dateLte(contract.tradeableFrom, now)) {
        errors.push(`${player.name} was signed recently and is untradeable until s${contract.tradeableFrom.season} d${contract.tradeableFrom.day}`);
      }
      outgoing[side.team]! += tradeSalary(league, pid);
    }
  }

  // pick ownership
  const pickSides: Array<{ team: TeamId; picks: string[] }> = [
    { team: offer.from, picks: offer.give.picks },
    { team: offer.to, picks: offer.get.picks },
  ];
  for (const side of pickSides) {
    const owned = new Set(league.teams[side.team]!.picks.map(p => p.id));
    for (const pickId of side.picks) {
      if (!owned.has(pickId)) errors.push(`${side.team} does not own pick ${pickId}`);
    }
  }

  // salary matching, both directions (a trade must be legal for BOTH teams)
  for (const [team, other] of [[offer.from, offer.to], [offer.to, offer.from]] as const) {
    const incoming = outgoing[other]!;
    const out = outgoing[team]!;
    if (incoming === 0) continue; // taking back nothing is always legal
    const sheet = capSheet(league, team);
    // a team with cap space absorbs into space without matching
    // (research 06 §5-6: room teams simply use room); space counts holds
    if (sheet.spaceWithHolds >= incoming - out) continue;
    const maxIn = maxIncomingFor(league, team, out);
    if (incoming > maxIn) {
      errors.push(`${team} cannot take back ${incoming} for ${out} outgoing (limit ${maxIn})`);
    }
  }

  // second-apron restrictions (research 06 §6): no aggregation, 100% max
  for (const team of [offer.from, offer.to] as const) {
    const sheet = capSheet(league, team);
    if (!sheet.overApron2) continue;
    const sending = team === offer.from ? offer.give.players : offer.get.players;
    const standardOut = sending.filter(pid => league.teams[team]!.roster.includes(pid));
    if (standardOut.length > 1) {
      errors.push(`${team} is over the second apron and cannot aggregate ${standardOut.length} salaries`);
    }
  }

  // roster bounds after the swap (T3): standard roster in [8, 15]
  for (const [team, sends, gets] of [
    [offer.from, offer.give, offer.get],
    [offer.to, offer.get, offer.give],
  ] as const) {
    const roster = league.teams[team]!.roster;
    const sendStd = sends.players.filter(p => roster.includes(p)).length;
    const getStd = gets.players.filter(p => {
      const otherTeam = team === offer.from ? offer.to : offer.from;
      return league.teams[otherTeam]!.roster.includes(p);
    }).length;
    const after = roster.length - sendStd + getStd;
    if (after > league.params.cba.rosterMax) errors.push(`${team} would carry ${after} standard contracts (max ${league.params.cba.rosterMax})`);
    if (after < 8) errors.push(`${team} would fall to ${after} players (hard floor 8)`); // 8 = REAL game-night uniform minimum, research 06 §8
  }

  // Stepien rule (research 06 §6): no team may be left without an owned
  // first-round pick in two consecutive FUTURE drafts. The scan covers
  // only seasons the team's own firsts are materialized for (genesis
  // materializes 7 years out): beyond that horizon ownership is
  // indeterminate and legality gives the benefit of the doubt.
  for (const team of [offer.from, offer.to] as const) {
    const gaining = team === offer.from ? offer.get.picks : offer.give.picks;
    const losing = team === offer.from ? offer.give.picks : offer.get.picks;
    const losingSet = new Set(losing);
    let horizon = league.season; // furthest season this team's own R1 exists
    for (const p of league.teams[team]!.picks) {
      if (p.round === 1 && p.originalTeam === team && p.season > horizon) horizon = p.season;
    }
    const ownedAfter = new Set<number>(); // seasons with an owned R1 pick after the swap
    for (const p of league.teams[team]!.picks) {
      if (p.round === 1 && !losingSet.has(p.id)) ownedAfter.add(p.season);
    }
    const otherTeam = team === offer.from ? offer.to : offer.from;
    for (const pickId of gaining) {
      const p = league.teams[otherTeam]!.picks.find(x => x.id === pickId);
      if (p && p.round === 1) ownedAfter.add(p.season);
    }
    for (let y = league.season + 1; y + 1 <= horizon; y++) {
      if (!ownedAfter.has(y) && !ownedAfter.has(y + 1)) {
        errors.push(`${team} would have no first-round pick in ${y} and ${y + 1} (Stepien rule)`);
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
