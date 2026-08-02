/**
 * Trade legality - the deadline freeze at the ledger (#231, found in the
 * PR #213 review). The desk (ai/trade.ts respondToOffer) already refused
 * frozen talks, but the execution path (validateTrade -> executeTrade)
 * never consulted the boundary: an AI offer pending at the deadline could
 * be accepted at deadline+1 through respondToRequest. validateTrade is
 * the choke-point every path funnels through, so the wall lives there.
 * #249 extends the freeze through the July moratorium (phase 'moratorium':
 * deals agreed but not signable), pinned below at ledger and backstop.
 */
import { describe, expect, it } from 'vitest';
import type { InboxItem, League, TradeOffer } from '../src/types.js';
import { validateTrade } from '../src/cba/tradelegal.js';
import { executeTrade } from '../src/transactions.js';
import { applyUserAction } from '../src/tick.js';
import { fixtureLeague } from './fixture.js';

/**
 * A one-for-one swap at the fixture's flat equal salaries: legal on every
 * non-freeze rule (matching is equal money, rosters stay at 10, no picks,
 * no recent signees), so any refusal below is the freeze and only the
 * freeze. Proposed BY the AI team TO the user, the #231 shape.
 */
function legalOffer(league: League): TradeOffer {
  return {
    from: 'bka', to: 'nye',
    give: { players: [league.teams.bka!.roster[0]!], picks: [] },
    get: { players: [league.teams.nye!.roster[0]!], picks: [] },
  };
}

/** The AI offer of the #231 repro: posted on deadline day, live until it. */
function pendingOfferItem(league: League, deadlineDay: number): InboxItem {
  return {
    id: `trade-offer-s${league.season}d${deadlineDay}-bka`,
    date: { season: league.season, day: deadlineDay },
    kind: 'decision',
    title: 'Trade offer from Brooklyn',
    body: 'test offer',
    offer: legalOffer(league),
    choices: [
      { id: 'accept', label: 'Accept' },
      { id: 'decline', label: 'Decline' },
      { id: 'counter', label: 'Counter' },
    ],
    deadline: { season: league.season, day: deadlineDay },
    resolved: false,
  };
}

describe('the deadline freeze binds the ledger (#231)', () => {
  it('refuses an otherwise-legal trade the day after the deadline, naming the rule', () => {
    const league = fixtureLeague();
    // sanity: the offer is legal outside the freeze (camp, the fixture default)
    expect(validateTrade(league, legalOffer(league)).ok).toBe(true);

    league.phase = 'regular';
    league.day = 130; // = params.calendar.tradeDeadlineDayIndex default: deadline day itself stays open
    expect(validateTrade(league, legalOffer(league)).ok).toBe(true);

    league.day = 131; // deadline+1: the boundary flips exactly at the tick (#213 review, #231)
    const frozen = validateTrade(league, legalOffer(league));
    expect(frozen.ok).toBe(false);
    expect(frozen.errors.join(' ')).toContain('deadline');
  });

  it('freezes the postseason phases outright and reopens after them', () => {
    const league = fixtureLeague();
    league.day = 200; // any post-deadline day index; phase decides below
    for (const phase of ['playin', 'playoffs'] as const) {
      league.phase = phase;
      expect(validateTrade(league, legalOffer(league)).ok).toBe(false);
    }
    // the new league year: July business is legal business
    for (const phase of ['offseason', 'lottery', 'draft', 'freeAgency'] as const) {
      league.phase = phase;
      expect(validateTrade(league, legalOffer(league)).ok).toBe(true);
    }
  });

  it('reads the calendar mark over the params index, like the desk does', () => {
    const league = fixtureLeague();
    league.phase = 'regular';
    // a hand-built calendar with an early mark: the mark is the law
    league.calendar = [{ day: 50, phase: 'regular', label: 'Sun, Feb 1', marks: ['tradeDeadline'] }];
    league.day = 50;
    expect(validateTrade(league, legalOffer(league)).ok).toBe(true);
    league.day = 51;
    expect(validateTrade(league, legalOffer(league)).ok).toBe(false);
  });

  it('executeTrade throws rather than writing a frozen trade to the ledger', () => {
    const league = fixtureLeague();
    league.phase = 'regular';
    league.day = 131; // deadline+1 under the default 130 index
    let thrown = '';
    try {
      executeTrade(league, legalOffer(league));
    } catch (err) {
      thrown = String(err);
    }
    expect(thrown).toContain('deadline');
    expect(league.transactions.length).toBe(0);
  });

  it('the #231 repro: an offer pending at the deadline cannot be accepted at deadline+1', () => {
    const league = fixtureLeague();
    league.phase = 'regular';
    league.day = 131; // the advance loop's stop lands here when the item posts on deadline day
    league.inbox.push(pendingOfferItem(league, 130));
    const item = league.inbox[0]!;

    const result = applyUserAction(league, { kind: 'respondToRequest', requestId: item.id, choice: 'accept' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('deadline');
    // a refused validation leaves the item OPEN (tick.ts: saying no to a
    // dead deal is still the user's word to give) and the world untouched
    expect(item.resolved).toBe(false);
    expect(league.transactions.length).toBe(0);
    expect(league.teams.nye!.roster.length).toBe(10);
    expect(league.teams.bka!.roster.length).toBe(10);
  });

  it('the same accept on deadline day itself still executes (never-weaken: #213 keeps its stop)', () => {
    const league = fixtureLeague();
    league.phase = 'regular';
    league.day = 130; // the #213 stop: deadline morning, desk open
    league.inbox.push(pendingOfferItem(league, 130));
    const item = league.inbox[0]!;

    const result = applyUserAction(league, { kind: 'respondToRequest', requestId: item.id, choice: 'accept' });
    expect(result.ok).toBe(true);
    expect(item.resolved).toBe(true);
    expect(league.transactions.length).toBe(1);
    expect(league.transactions[0]!.kind).toBe('trade');
  });

  it('the #249 gap: the July moratorium freezes the ledger, and free agency reopens it', () => {
    const league = fixtureLeague();
    league.phase = 'moratorium';
    const frozen = validateTrade(league, legalOffer(league));
    expect(frozen.ok).toBe(false);
    expect(frozen.errors.join(' ')).toContain('moratorium');
    // the day after the moratorium: the market opens and the ledger follows
    league.phase = 'freeAgency';
    expect(validateTrade(league, legalOffer(league)).ok).toBe(true);
  });

  it('executeTrade backstop: a moratorium trade throws and the ledger stays clean (#249)', () => {
    const league = fixtureLeague();
    league.phase = 'moratorium';
    let thrown = '';
    try {
      executeTrade(league, legalOffer(league));
    } catch (err) {
      thrown = String(err);
    }
    expect(thrown).toContain('moratorium');
    expect(league.transactions.length).toBe(0);
  });
});
