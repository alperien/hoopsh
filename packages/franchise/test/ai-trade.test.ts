/**
 * AI trade engine battery - personas, the value model, negotiation, and
 * the league pulse. The heart is the FLEECE SUITE: the five documented
 * ways users rob sim AIs (research 05 A5) must fail here through valuation
 * alone (no bolt-on caps, research 01 finding 2), while the anti-cowardice
 * case - a fair star trade - must still clear. A trade AI that only says
 * no is as broken as one that says yes to everything.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '@hoopsh/engine';
import type { DraftPick, League, PlayerId, TeamId, TradeOffer } from '../src/types.js';
import { generatePersona, reevaluateTimelines } from '../src/ai/persona.js';
import { abilityScore, fairAav, offerNet, pickValue, playerValue } from '../src/ai/valuation.js';
import { aiTradePulse, respondToOffer } from '../src/ai/trade.js';
import { validateTrade } from '../src/cba/tradelegal.js';
import { executeTrade } from '../src/transactions.js';
import { applyUserAction } from '../src/tick.js';
import { expireInboxDeadlines } from '../src/inbox.js';
import { streamRng } from '../src/rng.js';
import { fixtureLeague } from './fixture.js';

// ---------------------------------------------------------------- helpers

/** Set every attribute to one flat number so abilityScore(p) === x exactly. */
function flatAttr(league: League, pid: PlayerId, x: number): void {
  const attr = league.players[pid]!.attr as unknown as Record<string, number>;
  for (const key of Object.keys(attr)) attr[key] = x;
}

function setAge(league: League, pid: PlayerId, age: number): void {
  league.players[pid]!.bornSeason = league.season - age;
}

/** Replace the contract with per-season salaries starting this season. */
function setContract(league: League, pid: PlayerId, salaries: number[]): void {
  const c = league.players[pid]!.contract!;
  c.years = salaries.map((salary, i) => ({ season: league.season + i, salary, guaranteed: salary }));
}

function setStanding(league: League, teamId: TeamId, w: number, l: number): void {
  league.standings[teamId] = {
    teamId, w, l, homeW: 0, homeL: 0, awayW: 0, awayL: 0, confW: 0, confL: 0,
    divW: 0, divL: 0, ptsFor: 0, ptsAgainst: 0, streak: 0, last10: [],
  };
}

function addPick(league: League, owner: TeamId, season: number, opts: { protectTopN?: number; originalTeam?: TeamId; round?: 1 | 2 } = {}): DraftPick {
  const originalTeam = opts.originalTeam ?? owner;
  const round = opts.round ?? 1;
  const pick: DraftPick = {
    id: `${season}-r${round}-${originalTeam}`, season, round, originalTeam, owner,
    ...(opts.protectTopN ? { protection: { topN: opts.protectTopN, throughSeason: season + 2 } } : {}),
  };
  league.teams[owner]!.picks.push(pick);
  return pick;
}

/** Own firsts 2027..2033 so single-pick trades never trip the Stepien rule. */
function fullPickLadder(league: League, teamId: TeamId): void {
  for (let s = league.season + 1; s <= league.season + 7; s++) addPick(league, teamId, s);
}

// fixture team ids in FRANCHISES order: nye is ALWAYS the user team
const USER = 'nye';
const AI_A = 'bka';
const AI_B = 'bos';
const AI_C = 'phi';

// -------------------------------------------------------------- personas

describe('generatePersona', () => {
  it('is deterministic for a seed and samples with real spread inside the clamps', () => {
    expect(generatePersona(new Rng('gm-7'))).toEqual(generatePersona(new Rng('gm-7')));

    const rng = new Rng('persona-mix');
    const names = new Set<string>();
    const counts = { contend: 0, retool: 0, rebuild: 0 };
    let lo = 100;
    let hi = 0;
    for (let i = 0; i < 300; i++) {
      const p = generatePersona(rng);
      names.add(p.name);
      counts[p.timeline]++;
      for (const trait of [p.risk, p.pickLove, p.starChase, p.patience]) {
        lo = Math.min(lo, trait);
        hi = Math.max(hi, trait);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(5);   // clamp floor holds
    expect(hi).toBeLessThanOrEqual(95);     // clamp ceiling holds
    expect(hi - lo).toBeGreaterThan(40);    // sd 18 must produce real spread, not a mush of 50s
    expect(names.size).toBeGreaterThan(10); // the surname pool is actually being used
    expect(names.has('Front Office')).toBe(false); // the stub default is gone
    // genesis mix ~40/35/25 within sampling noise (n=300, +/- ~0.08)
    expect(counts.contend / 300).toBeGreaterThan(0.32);
    expect(counts.contend / 300).toBeLessThan(0.48);
    expect(counts.rebuild / 300).toBeGreaterThan(0.17);
    expect(counts.rebuild / 300).toBeLessThan(0.33);
  });
});

describe('reevaluateTimelines', () => {
  it('moves AI timelines from record and core; the user team keeps its own strategy', () => {
    const league = fixtureLeague(); // 4 teams: nye (user), bka, bos, phi
    // bka: a real core (three 85s, age 26) and a 50-20 record => contend
    for (const pid of league.teams[AI_A]!.roster.slice(0, 3)) {
      flatAttr(league, pid, 85);
      setAge(league, pid, 26);
    }
    setStanding(league, AI_A, 50, 20);
    // bos: bottom record, everyone 29 and mediocre, no young core => rebuild
    for (const pid of league.teams[AI_B]!.roster) {
      flatAttr(league, pid, 50);
      setAge(league, pid, 29);
    }
    setStanding(league, AI_B, 10, 60);
    // phi: a .500 team => the honest middle
    setStanding(league, AI_C, 35, 35);
    // nye (user): mid record; strategy must NOT be touched
    setStanding(league, USER, 30, 40);
    league.teams[USER]!.strategy.timeline = 'contend';

    reevaluateTimelines(league);
    expect(league.teams[AI_A]!.strategy.timeline).toBe('contend');
    expect(league.teams[AI_B]!.strategy.timeline).toBe('rebuild');
    expect(league.teams[AI_C]!.strategy.timeline).toBe('retool');
    expect(league.teams[USER]!.strategy.timeline).toBe('contend'); // user's own call stands
    // the persona's TEMPERAMENT is stable; only the live posture moved
    expect(league.teams[AI_A]!.gm!.timeline).toBe('retool');
  });
});

// -------------------------------------------------------------- valuation

describe('valuation: players', () => {
  it('scores ability on position norms (flat sheet of X scores exactly X)', () => {
    const league = fixtureLeague();
    const star = league.teams[AI_A]!.roster[0]!;
    const scrub = league.teams[AI_A]!.roster[1]!;
    flatAttr(league, star, 88);
    flatAttr(league, scrub, 40);
    expect(abilityScore(league.players[star]!)).toBeGreaterThan(87.99);
    expect(abilityScore(league.players[star]!)).toBeLessThan(88.01);
    expect(abilityScore(league.players[star]!)).toBeGreaterThan(abilityScore(league.players[scrub]!));
    // fair pay tracks ability and respects the max-tier ceiling
    expect(fairAav(league, 90)).toBeGreaterThan(fairAav(league, 70));
    expect(fairAav(league, 99)).toBeLessThanOrEqual(Math.round(164_961_000 * 0.35)); // REAL 35% top max tier
  });

  it('prices contracts: a bargain ADDS value, an albatross is NEGATIVE', () => {
    const league = fixtureLeague();
    const bargain = league.teams[AI_A]!.roster[0]!;
    const albatross = league.teams[AI_A]!.roster[1]!;
    for (const pid of [bargain, albatross]) {
      flatAttr(league, pid, 60); // rotation-level talent either way
      setAge(league, pid, 26);
    }
    setContract(league, bargain, [2_400_000, 2_400_000]);   // REAL-ish vet-minimum scale (research 06 4)
    setContract(league, albatross, [30_000_000, 30_000_000, 30_000_000]); // near-max money for a bench player
    const vBargain = playerValue(league, AI_B, bargain);
    const vAlbatross = playerValue(league, AI_B, albatross);
    expect(vBargain).toBeGreaterThan(0);
    expect(vAlbatross).toBeLessThan(0); // negative values are how salary dumps price
    expect(vBargain).toBeGreaterThan(vAlbatross);
  });

  it('applies the age curve and the timeline lens', () => {
    const league = fixtureLeague();
    const young = league.teams[AI_A]!.roster[0]!;
    const old = league.teams[AI_A]!.roster[1]!;
    for (const pid of [young, old]) {
      flatAttr(league, pid, 80);
      setContract(league, pid, [20_000_000, 20_000_000]);
    }
    setAge(league, young, 24);
    setAge(league, old, 34); // deep past the hard-fall knee at 31
    expect(playerValue(league, AI_B, young)).toBeGreaterThan(playerValue(league, AI_B, old));

    // the same 31-year-old is worth less to a rebuilder than to a contender
    const vet = league.teams[AI_A]!.roster[2]!;
    flatAttr(league, vet, 82);
    setAge(league, vet, 31);
    setContract(league, vet, [20_000_000, 20_000_000]);
    league.teams[AI_B]!.strategy.timeline = 'rebuild';
    league.teams[AI_C]!.strategy.timeline = 'contend';
    expect(playerValue(league, AI_C, vet)).toBeGreaterThan(playerValue(league, AI_B, vet));
  });
});

describe('valuation: picks and packages', () => {
  it('prices picks by standing, distance, and protection', () => {
    const league = fixtureLeague({ teams: 30 });
    // records known: the worst team's pick projects high-lottery
    setStanding(league, AI_A, 5, 50);  // bka: the league's basement
    setStanding(league, AI_B, 50, 5);  // bos: the league's best
    const badTeamPick = addPick(league, AI_C, league.season + 1, { originalTeam: AI_A });
    const goodTeamPick = addPick(league, AI_C, league.season + 1, { originalTeam: AI_B });
    expect(pickValue(league, AI_C, badTeamPick)).toBeGreaterThan(pickValue(league, AI_C, goodTeamPick));

    // distance discounts: a 2032 first < the same team's 2028 first
    const near = addPick(league, AI_C, league.season + 2, { originalTeam: AI_C });
    const far = addPick(league, AI_C, league.season + 6, { originalTeam: AI_C });
    expect(pickValue(league, AI_C, near)).toBeGreaterThan(pickValue(league, AI_C, far));

    // protection shaves by conveyance probability
    const clean = addPick(league, 'tor', league.season + 3, { originalTeam: 'tor' });
    const shaved = addPick(league, 'tor', league.season + 4, { originalTeam: 'tor', protectTopN: 12 });
    // same team, one season further out but top-12 protected: strictly less
    expect(pickValue(league, AI_C, shaved)).toBeLessThan(pickValue(league, AI_C, clean));
  });

  it('offerNet is each side\'s own ledger: a one-sided gift nets opposite signs', () => {
    const league = fixtureLeague();
    const gift = league.teams[USER]!.roster[0]!;
    flatAttr(league, gift, 75);
    setAge(league, gift, 25);
    setContract(league, gift, [5_000_000, 5_000_000]); // clear bargain deal
    const offer: TradeOffer = {
      from: USER, to: AI_A,
      give: { players: [gift], picks: [] },
      get: { players: [], picks: [] },
    };
    expect(offerNet(league, AI_A, offer)).toBeGreaterThan(0);
    expect(offerNet(league, USER, offer)).toBeLessThan(0);
  });
});

// ------------------------------------------------------------ fleece suite

/** Fleece fixture: bka carries a 28-year-old star on a fair max-ish deal. */
function fleeceLeague(): { league: League; star: PlayerId } {
  const league = fixtureLeague();
  const star = league.teams[AI_A]!.roster[0]!;
  flatAttr(league, star, 88);
  setAge(league, star, 28);
  setContract(league, star, [41_000_000, 41_000_000, 41_000_000]); // ~fairAav(88): a fair deal, not a bargain
  return { league, star };
}

describe('fleece suite: the documented exploits fail on valuation alone', () => {
  it('(a) star-for-scraps: three minimum bodies never buy the best player', () => {
    const { league, star } = fleeceLeague();
    const scraps = league.teams[USER]!.roster.slice(0, 3);
    for (const pid of scraps) {
      flatAttr(league, pid, 46); // fringe talent: replacement level is free
      setAge(league, pid, 27);
      setContract(league, pid, [2_400_000, 2_400_000]); // REAL-ish minimum scale
    }
    const verdict = respondToOffer(league, {
      from: USER, to: AI_A,
      give: { players: scraps, picks: [] },
      get: { players: [star], picks: [] },
    });
    expect(verdict.accept).toBe(false);
    expect(verdict.walkAway).toBe(true);
    expect(verdict.reasoning).toContain('best player');
    // the walk-away leaves memory: a cooldown the rumor mill can read
    expect(league.negotiations.length).toBe(1);
    expect(league.negotiations[0]!.cooldownUntil).toBeTruthy();
  });

  it('(b) the pick-flip: a heavily protected far-future first does not buy a starter', () => {
    const league = fixtureLeague();
    const starter = league.teams[AI_A]!.roster[0]!;
    flatAttr(league, starter, 74);
    setAge(league, starter, 26);
    setContract(league, starter, [10_000_000, 10_000_000]);
    fullPickLadder(league, USER); // Stepien-safe: losing one first leaves no gap
    const flip = addPick(league, USER, league.season + 6, { protectTopN: 12 });
    const verdict = respondToOffer(league, {
      from: USER, to: AI_A,
      give: { players: [], picks: [flip.id] },
      get: { players: [starter], picks: [] },
    });
    expect(verdict.accept).toBe(false);
    // protection shaving + future discount leave the pick nearly worthless
    expect(pickValue(league, AI_A, flip)).toBeLessThan(5);
  });

  it('(c) a salary dump needs a sweetener; with a real first a rebuilder takes it', () => {
    const make = (): { league: League; bad: PlayerId } => {
      const league = fixtureLeague({ teams: 30 });
      const bad = league.teams[USER]!.roster[0]!;
      flatAttr(league, bad, 55);
      setAge(league, bad, 30);
      setContract(league, bad, [30_000_000]); // one expiring albatross: negative value
      league.teams[AI_A]!.strategy.timeline = 'rebuild'; // the natural dump partner
      setStanding(league, USER, 5, 50); // the user is BAD: its own first projects high-lottery
      return { league, bad };
    };

    // without a sweetener: rejected outright
    const dry = make();
    const dumpVerdict = respondToOffer(dry.league, {
      from: USER, to: AI_A,
      give: { players: [dry.bad], picks: [] },
      get: { players: [], picks: [] },
    });
    expect(dumpVerdict.accept).toBe(false);
    expect(dumpVerdict.reasoning).toContain('sweetener');

    // with the user's own (high-lottery-projecting) first attached: accepted
    const wet = make();
    fullPickLadder(wet.league, USER);
    const sweetener = wet.league.teams[USER]!.picks.find(p => p.season === wet.league.season + 1)!;
    expect(playerValue(wet.league, AI_A, wet.bad)).toBeLessThan(0); // the dump is priced honestly
    expect(pickValue(wet.league, AI_A, sweetener)).toBeGreaterThan(20); // a basement team's first is real currency
    const sweetVerdict = respondToOffer(wet.league, {
      from: USER, to: AI_A,
      give: { players: [wet.bad], picks: [sweetener.id] },
      get: { players: [], picks: [] },
    });
    expect(sweetVerdict.accept).toBe(true);
  });

  it('(d) anti-cowardice: a fair star trade IS accepted and executes legally', () => {
    const { league, star } = fleeceLeague();
    league.teams[AI_A]!.strategy.timeline = 'rebuild'; // the seller's window is closed
    league.teams[USER]!.strategy.timeline = 'contend'; // the buyer's window is open
    const young = league.teams[USER]!.roster[0]!;
    flatAttr(league, young, 72);
    setAge(league, young, 23);
    setContract(league, young, [8_000_000, 8_000_000, 8_000_000]); // rookie-deal bargain: the premium asset
    const filler = league.teams[USER]!.roster[1]!;
    flatAttr(league, filler, 66);
    setAge(league, filler, 27);
    setContract(league, filler, [12_000_000, 12_000_000]); // matching salary, mild value
    fullPickLadder(league, USER);
    const picks = league.teams[USER]!.picks;
    const first1 = picks.find(p => p.season === league.season + 2)!;
    const first2 = picks.find(p => p.season === league.season + 4)!;
    const offer: TradeOffer = {
      from: USER, to: AI_A,
      give: { players: [young, filler], picks: [first1.id, first2.id] },
      get: { players: [star], picks: [] },
    };
    const verdict = respondToOffer(league, offer);
    expect(verdict.accept).toBe(true);
    // and the deal is league-legal end to end, not just palatable
    expect(validateTrade(league, offer).ok).toBe(true);
    executeTrade(league, offer);
    expect(league.teams[USER]!.roster).toContain(star);
    expect(league.teams[AI_A]!.roster).toContain(young);
  });

  it('(e) determinism: the same league state and offer produce identical verdict JSON', () => {
    const { league, star } = fleeceLeague();
    const offer: TradeOffer = {
      from: USER, to: AI_A,
      give: { players: league.teams[USER]!.roster.slice(0, 2), picks: [] },
      get: { players: [star], picks: [] },
    };
    const a = structuredClone(league);
    const b = structuredClone(league);
    expect(JSON.stringify(respondToOffer(a, offer))).toBe(JSON.stringify(respondToOffer(b, offer)));
    expect(JSON.stringify(a.negotiations)).toBe(JSON.stringify(b.negotiations));
  });
});

describe('respondToOffer: negotiation texture', () => {
  it('refuses to move an untouchable and hangs up', () => {
    const { league, star } = fleeceLeague();
    league.teams[AI_A]!.strategy.untouchables = [star];
    const rich = league.teams[USER]!.roster[0]!;
    flatAttr(league, rich, 90); // an overpay on paper - does not matter
    setAge(league, rich, 24);
    const verdict = respondToOffer(league, {
      from: USER, to: AI_A,
      give: { players: [rich], picks: [] },
      get: { players: [star], picks: [] },
    });
    expect(verdict.accept).toBe(false);
    expect(verdict.walkAway).toBe(true);
    expect(verdict.reasoning).toContain('untouchable');
  });

  it('counters a light-but-close offer by asking for the cheapest bridge', () => {
    const league = fixtureLeague();
    const starter = league.teams[AI_A]!.roster[0]!;
    flatAttr(league, starter, 74);
    setAge(league, starter, 26);
    setContract(league, starter, [10_000_000, 10_000_000]);
    const young = league.teams[USER]!.roster[0]!;
    flatAttr(league, young, 72);
    setAge(league, young, 25);
    setContract(league, young, [10_000_000, 10_000_000]);
    fullPickLadder(league, USER);
    const offer: TradeOffer = {
      from: USER, to: AI_A,
      give: { players: [young], picks: [] },
      get: { players: [starter], picks: [] },
    };
    const verdict = respondToOffer(league, offer);
    expect(verdict.accept).toBe(false);
    expect(verdict.walkAway).not.toBe(true);
    expect(verdict.counter).toBeTruthy();
    const counter = verdict.counter!;
    // the counter asks for exactly one more piece from the proposer
    const added = (counter.give.players.length + counter.give.picks.length)
      - (offer.give.players.length + offer.give.picks.length);
    expect(added).toBe(1);
    expect(validateTrade(league, counter).ok).toBe(true);
    // the bridge actually clears: the counter is better for the receiver
    expect(offerNet(league, AI_A, counter)).toBeGreaterThan(offerNet(league, AI_A, offer));
    // the live offer the UI reads is the counter, stashed in negotiations
    expect(league.negotiations.length).toBe(1);
    expect(JSON.stringify(league.negotiations[0]!.lastOffer)).toBe(JSON.stringify(counter));
    expect(league.negotiations[0]!.temperature).not.toBe('cold');
  });

  it('the deadline means deadline: no talks after the mark', () => {
    const { league, star } = fleeceLeague();
    league.phase = 'regular';
    league.day = league.params.calendar.tradeDeadlineDayIndex + 1;
    const verdict = respondToOffer(league, {
      from: USER, to: AI_A,
      give: { players: [league.teams[USER]!.roster[0]!], picks: [] },
      get: { players: [star], picks: [] },
    });
    expect(verdict.accept).toBe(false);
    expect(verdict.reasoning).toContain('deadline');
  });

  it('the July moratorium hangs up the phones (#249)', () => {
    const league = fixtureLeague();
    league.phase = 'moratorium';
    const verdict = respondToOffer(league, {
      from: USER, to: AI_A,
      give: { players: [league.teams[USER]!.roster[0]!], picks: [] },
      get: { players: [league.teams[AI_A]!.roster[0]!], picks: [] },
    });
    expect(verdict.accept).toBe(false);
    expect(verdict.reasoning).toContain('moratorium');
  });
});

// ------------------------------------------------------------ league pulse

/** Pulse fixture: one AI contender flush with picks, one seller with a rental vet. */
function pulseLeague(sellerId: TeamId): { league: League; vet: PlayerId } {
  const league = fixtureLeague({ teams: 6 }); // nye user, bka bos phi tor chi AI
  league.phase = 'regular';
  league.day = league.params.calendar.tradeDeadlineDayIndex - 7; // inside deadline season
  league.params.trade.deadlinePulse = 1; // force the pulse: the test is about the machinery, not the dice
  league.teams[AI_A]!.strategy.timeline = 'contend';
  league.teams[AI_A]!.gm!.starChase = 70;
  fullPickLadder(league, AI_A);
  league.teams[sellerId]!.strategy.timeline = 'rebuild';
  const vet = league.teams[sellerId]!.roster[0]!;
  flatAttr(league, vet, 84);
  setAge(league, vet, 29);
  setContract(league, vet, [30_000_000]); // expiring: the classic deadline rental
  return { league, vet };
}

describe('aiTradePulse', () => {
  it('executes one legal AI-AI deadline trade: contender buys the rebuilder\'s rental', () => {
    const { league, vet } = pulseLeague(AI_B);
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(1); // capped at one AI-AI trade per pulse day
    expect(txs[0]!.kind).toBe('trade');
    expect(league.teams[AI_A]!.roster).toContain(vet); // the star-chaser got his man
    expect(league.transactions.length).toBe(1);
    // the seller got real assets back, not nothing
    const tx = txs[0]! as Extract<typeof txs[0], { kind: 'trade' }>;
    const sellerGot = tx.players.filter(m => m.to === AI_B).length + tx.picks.filter(m => m.to === AI_B).length;
    expect(sellerGot).toBeGreaterThan(0);
  });

  it('is deterministic: cloned leagues pulse to identical transactions', () => {
    const { league } = pulseLeague(AI_B);
    const a = structuredClone(league);
    const b = structuredClone(league);
    expect(JSON.stringify(aiTradePulse(a))).toBe(JSON.stringify(aiTradePulse(b)));
    expect(JSON.stringify(a.teams[AI_A]!.roster)).toBe(JSON.stringify(b.teams[AI_A]!.roster));
  });

  it('proposes to the user via the inbox when the user is the natural counterparty', () => {
    const { league, vet } = pulseLeague(USER); // the USER is the rebuilder holding the rental
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(0); // never auto-executes against the user
    expect(league.teams[USER]!.roster).toContain(vet); // nothing moved
    expect(league.inbox.length).toBe(1);
    const item = league.inbox[0]!;
    expect(item.kind).toBe('decision');
    expect(item.choices!.map(c => c.id).join(',')).toBe('accept,decline,counter');
    expect(item.body).toContain('offers');
    // the live offer is stashed in negotiations for the trade desk
    expect(league.negotiations.length).toBe(1);
    expect(league.negotiations[0]!.lastOffer.to).toBe(USER);
    expect(league.negotiations[0]!.lastOffer.get.players).toContain(vet);
  });

  it('goes quiet after the deadline even at pulse probability 1', () => {
    const { league } = pulseLeague(AI_B);
    league.day = league.params.calendar.tradeDeadlineDayIndex + 1;
    expect(aiTradePulse(league).length).toBe(0);
    expect(league.transactions.length).toBe(0);
  });

  it('goes quiet through the July moratorium even at pulse probability 1 (#249)', () => {
    const { league } = pulseLeague(AI_B);
    league.phase = 'moratorium'; // phase decides; the deadline-week day index is irrelevant here
    league.params.trade.offseasonPulse = 1; // the offseason dice at certainty: the gate on trial, not the dice
    expect(aiTradePulse(league).length).toBe(0);
    expect(league.transactions.length).toBe(0);
    expect(league.negotiations.length).toBe(0); // no probes, no memory: the wire never woke
    expect(league.inbox.length).toBe(0);
  });

  it('the day after the moratorium the wire is live again: free agency executes the same deal (#249)', () => {
    const { league, vet } = pulseLeague(AI_B);
    league.phase = 'freeAgency';
    league.params.trade.offseasonPulse = 1;
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(1);
    expect(league.teams[AI_A]!.roster).toContain(vet);
  });
});

// ------------------------------------------------- the accept path (#158)

/**
 * The response side of the pulse's user offer: before this battery, the
 * inbox asked Accept/Decline/Counter and the accept executed NOTHING
 * (issue #158) - the offer lived only in negotiations.lastOffer, which no
 * endpoint served. The contract pinned here: the item carries a frozen
 * copy of the offer, accept executes exactly that copy, every other exit
 * (decline, expiry, dead deal) leaves rosters untouched, and a persona-run
 * user seat can never reach the path at all.
 */
describe('the trade-offer accept path (#158)', () => {
  it('the inbox item carries a frozen copy of the live offer', () => {
    const { league } = pulseLeague(USER);
    aiTradePulse(league);
    const item = league.inbox[0]!;
    expect(item.offer).toBeDefined();
    expect(JSON.stringify(item.offer)).toBe(JSON.stringify(league.negotiations[0]!.lastOffer));
  });

  it('accept executes exactly the offer the item posted, even after the stash moves', () => {
    const { league, vet } = pulseLeague(USER);
    aiTradePulse(league);
    const item = league.inbox[0]!;
    const posted = structuredClone(item.offer!);
    expect(posted.give.players.length + posted.give.picks.length).toBeGreaterThan(0);
    // intervening desk talks move the live stash IN PLACE; the item's
    // frozen copy must not care (a shared reference dies here)
    league.negotiations[0]!.lastOffer.give.players.length = 0;
    league.negotiations[0]!.lastOffer.give.picks.length = 0;
    const result = applyUserAction(league, { kind: 'respondToRequest', requestId: item.id, choice: 'accept' });
    expect(result.ok).toBe(true);
    expect(item.resolved).toBe(true);
    // the buyer got his man; every posted piece landed where it was promised
    expect(league.teams[AI_A]!.roster).toContain(vet);
    for (const pid of posted.give.players) expect(league.teams[USER]!.roster).toContain(pid);
    for (const pickId of posted.give.picks) {
      expect(league.teams[USER]!.picks.some(p => p.id === pickId)).toBe(true);
    }
    expect(league.transactions.filter(t => t.kind === 'trade').length).toBe(1);
    // consummated talks leave the rumor mill (the AI-AI discipline)
    expect(league.negotiations.length).toBe(0);
  });

  it('decline resolves the item and leaves the world untouched', () => {
    const { league } = pulseLeague(USER);
    aiTradePulse(league);
    const item = league.inbox[0]!;
    const before = JSON.stringify({ teams: league.teams, players: league.players, transactions: league.transactions });
    const result = applyUserAction(league, { kind: 'respondToRequest', requestId: item.id, choice: 'decline' });
    expect(result.ok).toBe(true);
    expect(item.resolved).toBe(true);
    expect(JSON.stringify({ teams: league.teams, players: league.players, transactions: league.transactions })).toBe(before);
    // a phone no is not a consummation: the rumor mill keeps its smoke
    expect(league.negotiations.length).toBe(1);
  });

  it('an ignored offer expires by the morning sweep without executing', () => {
    const { league, vet } = pulseLeague(USER);
    aiTradePulse(league);
    const item = league.inbox[0]!;
    const before = JSON.stringify({ teams: league.teams, transactions: league.transactions });
    league.day = item.deadline!.day + 1; // the clock runs out unanswered
    expireInboxDeadlines(league);
    expect(item.resolved).toBe(true);
    expect(JSON.stringify({ teams: league.teams, transactions: league.transactions })).toBe(before);
    expect(league.teams[USER]!.roster).toContain(vet);
  });

  it('a dead deal denies the accept and leaves the item open', () => {
    const { league, vet } = pulseLeague(USER);
    aiTradePulse(league);
    const item = league.inbox[0]!;
    // the asked-for vet leaves the roster before the user answers
    const team = league.teams[USER]!;
    team.roster = team.roster.filter(pid => pid !== vet);
    league.players[vet]!.status = 'freeAgent';
    const result = applyUserAction(league, { kind: 'respondToRequest', requestId: item.id, choice: 'accept' });
    expect(result.ok).toBe(false);
    expect(item.resolved).toBe(false); // saying no to a dead deal is still the user's word
    expect(league.transactions.length).toBe(0);
  });

  it('a persona-run user seat never reaches the path: the pulse trades AI-AI instead', () => {
    const { league, vet } = pulseLeague(USER);
    league.teams[USER]!.gm = generatePersona(streamRng(league.seed, 'genesis', 'user-gm'));
    const txs = aiTradePulse(league);
    expect(txs.length).toBe(1); // executed on the wire, no human in the loop
    expect(league.inbox.length).toBe(0);
    expect(league.inbox.some(i => i.offer !== undefined)).toBe(false);
    expect(league.teams[AI_A]!.roster).toContain(vet);
  });

  it('a loaded save answers exactly like the live session', () => {
    const { league } = pulseLeague(USER);
    aiTradePulse(league);
    const loaded = JSON.parse(JSON.stringify(league)) as League;
    const item = league.inbox[0]!;
    for (const l of [league, loaded]) {
      const result = applyUserAction(l, { kind: 'respondToRequest', requestId: item.id, choice: 'accept' });
      expect(result.ok).toBe(true);
    }
    expect(JSON.stringify(loaded.teams)).toBe(JSON.stringify(league.teams));
    expect(JSON.stringify(loaded.transactions)).toBe(JSON.stringify(league.transactions));
  });
});
