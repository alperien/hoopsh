/**
 * The wire cadence battery (#184): the four mechanisms that turned a
 * structurally dead in-season market into one that produces deals. At
 * shipped dials the wire ran two fully silent playtest seasons - zero
 * trades, zero AI offers, zero rumor stories - and the measured funnel
 * died before assembly on every sampled day. The mechanisms pinned here:
 *
 * - the deadline conversion floor: inside the window's last floorDays
 *   the pulse is forced until the window holds floorTrades deals, so a
 *   silent deadline is a tail event, not the mode. The floor guarantees
 *   LEAGUE deals: a human user chair can never satisfy it by paper
 *   parked on the desk, so user-seller pairs are excluded while it runs;
 * - the salary-first second assembly pass: when both value bars clear
 *   but league law refuses the package (picks carry no salary, so a
 *   pick-heavy package cannot legally return a big contract for an
 *   over-cap buyer), the walk rebuilds shipping matching money first,
 *   the way real deadline packages carry ballast;
 * - the directed user offer: a human chair inside the window gets called
 *   on its own dial (userOfferPulse), sell-side or mirrored buy-side,
 *   with a deadline-eve backstop that converts a fully quiet window into
 *   one forced attempt; one live offer at a time; never auto-executed;
 * - the deadline-day cap: deadline day itself may execute up to
 *   deadlineDayMaxTrades, every other day stays capped at one deal -
 *   crackle, not spam.
 *
 * Dials are dice; mechanisms are machinery. Every fixture here turns the
 * dice OFF (pulse 0) and lights exactly the mechanism on trial.
 */
import { describe, expect, it } from 'vitest';
import type { DraftPick, League, PlayerId, TeamId, Transaction } from '../src/types.js';
import { aiTradePulse } from '../src/ai/trade.js';
import { maxIncomingFor } from '../src/cba/tradelegal.js';
import { fixtureLeague } from './fixture.js';

// ---------------------------------------------------------------- helpers
// (local copies of the ai-trade.test.ts sculpting helpers: batteries stay
// independent, and these four lines of shaping are the whole overlap)

function flatAttr(league: League, pid: PlayerId, x: number): void {
  const attr = league.players[pid]!.attr as unknown as Record<string, number>;
  for (const key of Object.keys(attr)) attr[key] = x;
}

function setAge(league: League, pid: PlayerId, age: number): void {
  league.players[pid]!.bornSeason = league.season - age;
}

function setContract(league: League, pid: PlayerId, salaries: number[]): void {
  const c = league.players[pid]!.contract!;
  c.years = salaries.map((salary, i) => ({ season: league.season + i, salary, guaranteed: salary }));
}

function addPick(league: League, owner: TeamId, season: number): DraftPick {
  const pick: DraftPick = { id: `${season}-r1-${owner}`, season, round: 1, originalTeam: owner, owner };
  league.teams[owner]!.picks.push(pick);
  return pick;
}

function fullPickLadder(league: League, teamId: TeamId): void {
  for (let s = league.season + 1; s <= league.season + 7; s++) addPick(league, teamId, s);
}

const USER = 'nye'; // FRANCHISES order: nye is always the fixture user team

function deadline(league: League): number {
  return league.params.calendar.tradeDeadlineDayIndex;
}

/** A deadline-season league with the dice OFF: tests light one mechanism each. */
function wireLeague(opts: { teams?: number } = {}): League {
  const league = fixtureLeague({ teams: opts.teams ?? 6 });
  league.phase = 'regular';
  league.day = deadline(league) - 7;
  league.params.trade.deadlinePulse = 0;  // organic dice off
  league.params.trade.userOfferPulse = 0; // directed dice off
  return league;
}

/** Arm an AI team as the classic deadline buyer: contending, pick-rich. */
function armBuyer(league: League, id: TeamId): void {
  league.teams[id]!.strategy.timeline = 'contend';
  league.teams[id]!.gm!.starChase = 70;
  fullPickLadder(league, id);
}

/** Arm an AI team as the classic seller: rebuilding around an expiring rental vet. */
function armSeller(league: League, id: TeamId): PlayerId {
  league.teams[id]!.strategy.timeline = 'rebuild';
  const vet = league.teams[id]!.roster[0]!;
  flatAttr(league, vet, 84);
  setAge(league, vet, 29);
  setContract(league, vet, [30_000_000]);
  return vet;
}

type TradeTx = Extract<Transaction, { kind: 'trade' }>;

// -------------------------------------------------- the conversion floor

describe('the deadline conversion floor', () => {
  it('walks a silent window to floorTrades deals, one a day, then stands down', () => {
    const league = wireLeague({ teams: 6 });
    armBuyer(league, 'bka');
    armBuyer(league, 'bos');
    armSeller(league, 'phi');
    armSeller(league, 'tor');
    const dl = deadline(league);

    // dice off, floor not yet in reach: the wire stays silent
    league.day = dl - 5;
    expect(aiTradePulse(league).length).toBe(0);

    // the window's last floorDays: the floor forces conversion, capped at one deal a day
    league.day = dl - 2;
    expect(aiTradePulse(league).length).toBe(1);
    league.day = dl - 1;
    expect(aiTradePulse(league).length).toBe(1);

    // the window now holds floorTrades deals: the floor stands down, dice-off silence returns
    league.day = dl;
    expect(aiTradePulse(league).length).toBe(0);
    expect(league.transactions.filter(t => t.kind === 'trade').length).toBe(2);
  });

  it('a human chair cannot satisfy the floor: user-seller pairs are excluded, not deskified', () => {
    const league = wireLeague({ teams: 4 });
    armBuyer(league, 'bka');
    // the ONLY complementary seller is the human user's rebuilding chair
    league.teams[USER]!.strategy.timeline = 'rebuild';
    const vet = league.teams[USER]!.roster[0]!;
    flatAttr(league, vet, 84);
    setAge(league, vet, 29);
    setContract(league, vet, [30_000_000]);
    league.teams['bos']!.strategy.timeline = 'contend'; // no seller anywhere else
    league.teams['phi']!.strategy.timeline = 'contend';

    league.day = deadline(league) - 2; // floor active; eve backstop (dl-1) is not
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(0);
    expect(league.inbox.length).toBe(0); // the floor guarantees LEAGUE deals, never desk paper
    expect(league.teams[USER]!.roster).toContain(vet);
  });
});

// ---------------------------------------------- the salary-first pass 2

describe('the salary-first assembly pass', () => {
  /** This-season payroll from live contracts. */
  function payrollOf(league: League, teamId: TeamId): number {
    let sum = 0;
    for (const pid of league.teams[teamId]!.roster) {
      const row = league.players[pid]!.contract?.years.find(y => y.season === league.season);
      sum += row ? row.salary : 0;
    }
    return sum;
  }

  /** This-season salary of one player. */
  function salaryOf(league: League, pid: PlayerId): number {
    const row = league.players[pid]!.contract?.years.find(y => y.season === league.season);
    return row ? row.salary : 0;
  }

  /**
   * A buyer whose cheap currency cannot legally return the rental: two
   * stars push payroll over the cap (sized from the league's own cap
   * line, so cba recalibration cannot silently defuse the fixture), the
   * value-order currency is minimum contracts and picks (no matching
   * weight), and - when armed - two fairly-paid mid vets are the only
   * matching money, one cheaper than the other.
   */
  function ballastLeague(opts: { ballasts: boolean }): {
    league: League; b16: PlayerId; b22: PlayerId; rental: PlayerId;
  } {
    const league = wireLeague({ teams: 4 });
    armBuyer(league, 'bka');
    const rental = armSeller(league, 'phi');
    const buyer = league.teams['bka']!;
    const roster = buyer.roster;

    // min-salary scraps: the value-first walk's natural currency
    for (const pid of roster.slice(2, 4)) {
      flatAttr(league, pid, 48);
      setAge(league, pid, 26);
      setContract(league, pid, [2_400_000]);
    }
    // the ballast pair: fairly-paid vets the buyer barely values, both
    // legal matching money for a 30M return, one clearly cheaper
    const b16 = roster[4]!;
    const b22 = roster[5]!;
    if (opts.ballasts) {
      flatAttr(league, b16, 72);
      setAge(league, b16, 28);
      setContract(league, b16, [16_000_000]);
      flatAttr(league, b22, 76);
      setAge(league, b22, 29);
      setContract(league, b22, [22_000_000]);
    }
    // two stars sized so payroll lands ABOVE the cap (matching law bites)
    // but safely under the first apron (no hard-block in the way)
    const capLine = league.capLines[league.season]!;
    const others = payrollOf(league, 'bka') - 2 * 10_000_000; // star slots still hold fixture 10M deals
    const target = capLine.cap + Math.round((capLine.apron1 - capLine.cap) * 0.4);
    const starSalary = Math.round((target - others) / 2);
    for (const pid of roster.slice(0, 2)) {
      flatAttr(league, pid, 90);
      setAge(league, pid, 27);
      setContract(league, pid, [starSalary, starSalary]);
    }
    expect(payrollOf(league, 'bka')).toBeGreaterThan(capLine.cap);
    expect(payrollOf(league, 'bka')).toBeLessThan(capLine.apron1);

    league.params.trade.deadlinePulse = 1; // force the fire; the walk is on trial
    return { league, b16, b22, rental };
  }

  it('a matching-blocked package rebuilds around the CHEAPEST sufficient money', () => {
    const { league, b16, b22, rental } = ballastLeague({ ballasts: true });
    const stars = league.teams['bka']!.roster.slice(0, 2);
    const before = structuredClone(league); // band math is judged in the league the deal was struck in
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(1);
    expect(league.teams['bka']!.roster).toContain(rental);
    const tx = txs[0]! as TradeTx;
    // the cheaper ballast is the matching money: pass 2's signature
    expect(tx.players.some(m => m.playerId === b16 && m.to === 'phi')).toBe(true);
    // the pricier ballast and the franchise stay home
    expect(tx.players.some(m => m.playerId === b22)).toBe(false);
    for (const star of stars) expect(tx.players.some(m => m.playerId === star)).toBe(false);
    // and the deal was band-legal where it was struck
    const outSalary = tx.players.filter(m => m.from === 'bka')
      .reduce((sum, m) => sum + salaryOf(before, m.playerId), 0);
    expect(maxIncomingFor(before, 'bka', outSalary)).toBeGreaterThanOrEqual(30_000_000);
  });

  it('with no single matching contract, the pass aggregates cheap money - never the stars', () => {
    const { league, rental } = ballastLeague({ ballasts: false });
    const stars = league.teams['bka']!.roster.slice(0, 2);
    const before = structuredClone(league);
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(1);
    expect(league.teams['bka']!.roster).toContain(rental);
    const tx = txs[0]! as TradeTx;
    // several cheap contracts aggregate to the band; the franchise stays home
    const shipped = tx.players.filter(m => m.from === 'bka');
    expect(shipped.length).toBeGreaterThan(1);
    for (const star of stars) expect(tx.players.some(m => m.playerId === star)).toBe(false);
    const outSalary = shipped.reduce((sum, m) => sum + salaryOf(before, m.playerId), 0);
    expect(maxIncomingFor(before, 'bka', outSalary)).toBeGreaterThanOrEqual(30_000_000);
  });
});

// --------------------------------------------------- the directed offer

describe('the directed user offer', () => {
  function humanSellerLeague(): { league: League; vet: PlayerId } {
    const league = wireLeague({ teams: 6 });
    // every AI chair is a laddered contender: whichever counterparty the
    // directed pass draws can genuinely assemble, so these tests pin the
    // mechanism, not the draw order (and contend-only AIs leave the
    // eve-day floor no AI-AI pair to fire on)
    for (const id of ['bka', 'bos', 'phi', 'tor', 'chi'] as TeamId[]) armBuyer(league, id);
    league.teams[USER]!.strategy.timeline = 'rebuild';
    const vet = league.teams[USER]!.roster[0]!;
    flatAttr(league, vet, 84);
    setAge(league, vet, 29);
    setContract(league, vet, [30_000_000]);
    return { league, vet };
  }

  it('a selling human chair gets a plausible buyer call on the dial', () => {
    const { league, vet } = humanSellerLeague();
    league.params.trade.userOfferPulse = 1;
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(0); // never auto-executed against a human chair
    const items = league.inbox.filter(i => i.id.startsWith('trade-offer-'));
    expect(items.length).toBe(1);
    const item = items[0]!;
    expect(item.kind).toBe('decision');
    expect(item.choices!.map(c => c.id).join(',')).toBe('accept,decline,counter');
    expect(item.offer!.to).toBe(USER);
    expect(item.offer!.get.players).toContain(vet); // the call is about the movable vet
    expect(league.negotiations.length).toBe(1);     // the trade desk reads lastOffer
  });

  it('a contending human chair gets the seller pitch, mirrored inbound', () => {
    const league = wireLeague({ teams: 6 });
    league.teams[USER]!.strategy.timeline = 'contend';
    fullPickLadder(league, USER);
    const vet = armSeller(league, 'chi');
    // every other AI contends too: chi is the only complementary counterparty
    for (const id of ['bka', 'bos', 'phi', 'tor'] as TeamId[]) {
      league.teams[id]!.strategy.timeline = 'contend';
    }
    league.params.trade.userOfferPulse = 1;
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(0);
    const item = league.inbox.find(i => i.id.startsWith('trade-offer-'))!;
    expect(item).toBeTruthy();
    expect(item.offer!.from).toBe('chi');           // the seller pitches its rental...
    expect(item.offer!.to).toBe(USER);              // ...inbound to the user's desk
    expect(item.offer!.give.players).toContain(vet);
  });

  it('the deadline-eve backstop turns a quiet window into exactly one attempt', () => {
    const { league } = humanSellerLeague();
    league.params.trade.userOfferPulse = 0; // the dice never fire on their own
    league.day = deadline(league) - 1;      // deadline eve, window fully quiet
    aiTradePulse(league);
    expect(league.inbox.filter(i => i.id.startsWith('trade-offer-')).length).toBe(1);
  });

  it('one live offer at a time: an unresolved decision blocks the next call', () => {
    const { league } = humanSellerLeague();
    league.params.trade.userOfferPulse = 1;
    aiTradePulse(league);
    league.day += 1;
    aiTradePulse(league);
    expect(league.inbox.filter(i => i.id.startsWith('trade-offer-')).length).toBe(1);
  });
});

// ------------------------------------------------- the deadline-day cap

describe('the deadline-day cap', () => {
  function threePairLeague(): League {
    const league = wireLeague({ teams: 8 });
    const ais = Object.keys(league.teams).sort()
      .filter(id => id !== USER && league.teams[id]!.gm);
    for (const id of ais.slice(0, 3)) armBuyer(league, id);
    for (const id of ais.slice(3, 6)) armSeller(league, id);
    league.params.trade.deadlinePulse = 1;
    league.params.trade.deadlineAttempts = 8; // probing depth is not on trial; the cap is
    return league;
  }

  it('deadline day executes up to deadlineDayMaxTrades deals', () => {
    const league = threePairLeague();
    league.day = deadline(league);
    expect(league.params.trade.deadlineDayMaxTrades).toBe(3);
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(3);
    expect(league.transactions.filter(t => t.kind === 'trade').length).toBe(3);
  });

  it('every other window day stays capped at one deal', () => {
    const league = threePairLeague();
    league.day = deadline(league) - 5;
    expect(aiTradePulse(league).length).toBe(1);
  });
});
