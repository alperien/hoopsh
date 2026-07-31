/**
 * The phone: state-backed messages, few and consequential
 * (docs/CAREER.md, The phone). The suite proves the discipline, not the
 * prose: silence on empty weeks, real numbers quoted, season caps held,
 * choices that mutate real state with explained consequences, and
 * byte-identical generation for identical careers.
 */
import { describe, expect, it } from 'vitest';
import type { GameLine, GameRecord } from '@hoopsh/franchise';
import { applyPhoneChoice, generatePhone } from '../src/phone.js';
import type { CareerState, PhoneMessage, Program } from '../src/types.js';
import { fixtureCareer } from './fixture.js';

const MY_TEAM = 'hs-oakridge';
const RIVAL_TEAM = 'hs-westfield';

function mkLine(playerId: string, teamId: string, over: Partial<GameLine> = {}): GameLine {
  return {
    playerId, teamId, starter: true, min: 30,
    pts: 12, fgm: 5, fga: 11, tpm: 1, tpa: 3, ftm: 1, fta: 2,
    orb: 1, drb: 4, ast: 3, stl: 1, blk: 0, tov: 2, pf: 2, plusMinus: 4,
    ...over,
  };
}

function mkRecord(career: CareerState, id: string, opts: {
  week?: number; home?: string; away?: string; final?: [number, number]; lines: GameLine[];
}): GameRecord {
  const totals = {
    pts: 60, fgm: 24, fga: 55, tpm: 5, tpa: 16, ftm: 7, fta: 10, orb: 8,
    drb: 20, ast: 14, stl: 5, blk: 2, tov: 9, pf: 12, pace: 66, fastbreakPts: 8, biggestLead: 9,
  };
  return {
    id,
    date: { season: career.clock.year, day: opts.week ?? career.clock.week },
    type: 'regular',
    home: opts.home ?? MY_TEAM,
    away: opts.away ?? RIVAL_TEAM,
    seed: 'g',
    final: opts.final ?? [62, 58],
    ot: 0,
    lines: opts.lines,
    totals: [totals, { ...totals, pts: 58 }],
    keyPlays: [],
  };
}

/** Store a finished game this week plus the coach's grade of my night. */
function gradeGame(career: CareerState, id: string, over: {
  pts?: number; adherence?: number; production?: number; note?: string; week?: number;
} = {}): GameRecord {
  const rec = mkRecord(career, id, {
    week: over.week,
    lines: [mkLine(career.me, MY_TEAM, { pts: over.pts ?? 26 })],
  });
  career.circuit!.results[id] = rec;
  career.coach.grades.push({
    gameId: id,
    adherence: over.adherence ?? 92,
    production: over.production ?? 80,
    trustDelta: 1.2,
    note: over.note ?? `outproduced the starter job (${over.production ?? 80})`,
  });
  return rec;
}

/** Mimic week.ts delivery: push with id dedupe. */
function deliver(career: CareerState, msgs: PhoneMessage[]): PhoneMessage[] {
  for (const m of msgs) {
    if (!career.phone.some(x => x.id === m.id)) career.phone.push(m);
  }
  return msgs;
}

function mkProgram(id = 'prog-cb'): Program {
  return {
    id, name: 'Carolina Baptist', tier: 1, coachDev: 70,
    style: { pace: 55, threeBias: 55 }, promisedRole: 'starter',
    nil: 180_000, region: 'South',
  };
}

describe('generatePhone stays silent without deltas', () => {
  it('a week with nothing real to say produces zero messages', () => {
    const career = fixtureCareer();
    expect(generatePhone(career)).toEqual([]);
    // and stays silent the following week too
    career.clock.week += 1;
    expect(generatePhone(career)).toEqual([]);
  });
});

describe('coach messages quote the real grade', () => {
  it('an off-script hot night gets a text with the actual points in it', () => {
    const career = fixtureCareer();
    gradeGame(career, 'g-hot', {
      pts: 26, adherence: 52, production: 78,
      note: 'went off script and it worked; the coach noticed both',
    });
    const msgs = generatePhone(career);
    const coach = msgs.find(m => m.thread === 'coach');
    expect(coach).toBeDefined();
    expect(coach!.from).toBe('Coach Wexler');
    expect(coach!.body).toContain('26');
    expect(coach!.refs?.gameId).toBe('g-hot');
    expect(coach!.choices).toBeUndefined(); // read-only texture, no quiz bolted on
  });

  it('an ordinary night inside the plan earns silence from the coach', () => {
    const career = fixtureCareer();
    gradeGame(career, 'g-meh', { pts: 14, adherence: 95, production: 50 });
    expect(generatePhone(career).filter(m => m.thread === 'coach')).toEqual([]);
  });
});

describe('family beats are sparse and real', () => {
  it('mom texts after the season opener, quoting the actual line', () => {
    const career = fixtureCareer();
    const rec = mkRecord(career, 'g-opener', {
      final: [59, 62], // a loss; mom does not care about the standings
      lines: [mkLine(career.me, MY_TEAM, { pts: 21 })],
    });
    career.circuit!.results[rec.id] = rec;
    const msgs = generatePhone(career);
    const mom = msgs.find(m => m.thread === 'family');
    expect(mom).toBeDefined();
    expect(mom!.from).toBe('Mom');
    expect(mom!.body).toContain('21');
    expect(mom!.choices).toBeUndefined();
  });

  it('the second game of the season is not an opener', () => {
    const career = fixtureCareer();
    const earlier = mkRecord(career, 'g-old', {
      week: career.clock.week - 2,
      lines: [mkLine(career.me, MY_TEAM, { pts: 15 })],
    });
    career.circuit!.results[earlier.id] = earlier;
    const rec = mkRecord(career, 'g-second', {
      lines: [mkLine(career.me, MY_TEAM, { pts: 21 })],
    });
    career.circuit!.results[rec.id] = rec;
    expect(generatePhone(career).filter(m => m.thread === 'family')).toEqual([]);
  });
});

describe('season caps hold under a flood', () => {
  it('26 weeks of statement games cannot exceed the coach and media caps', () => {
    const career = fixtureCareer();
    const year = career.clock.year;
    const start = career.clock.week;
    for (let w = start; w < start + 26; w++) {
      career.clock.week = w;
      gradeGame(career, `g-fl-${w}`, { pts: 31, adherence: 92, production: 80, week: w });
      deliver(career, generatePhone(career));
    }
    const count = (thread: string): number =>
      career.phone.filter(m => m.thread === thread && m.clock.year === year).length;
    expect(count('coach')).toBe(career.params.phone.capsPerSeason.coach);
    expect(count('media')).toBe(career.params.phone.capsPerSeason.media);
  });
});

describe('applyPhoneChoice', () => {
  function careerWithVisitAsk(): { career: CareerState; ask: PhoneMessage } {
    const career = fixtureCareer();
    const program = mkProgram();
    career.recruiting = {
      programs: [program],
      interest: [{
        programId: program.id, rung: 'texts', perceived: 60,
        lastMoveWeek: career.clock.week, closed: false,
      }],
      offers: [],
    };
    const msgs = deliver(career, generatePhone(career));
    const ask = msgs.find(m => m.thread === `recruiter:${program.id}`);
    if (!ask) throw new Error('test setup: the visit ask never generated');
    return { career, ask };
  }

  it('the visit ask arrives as a two-choice message with a deadline', () => {
    const { career, ask } = careerWithVisitAsk();
    expect(ask.choices?.length).toBe(2);
    expect(ask.deadlineWeek).toBe(career.clock.week + career.params.phone.decisionDeadlineWeeks);
    expect(ask.refs?.programId).toBe('prog-cb');
  });

  it('scheduling the visit climbs the rung, warms the board, and explains itself', () => {
    const { career, ask } = careerWithVisitAsk();
    const evBefore = career.events.length;
    const res = applyPhoneChoice(career, ask.id, 'visit-yes');
    expect(res.ok).toBe(true);
    const interest = career.recruiting!.interest[0]!;
    expect(interest.rung).toBe('visit');
    expect(interest.perceived).toBe(63);
    expect(interest.lastMoveWeek).toBe(career.clock.week);
    expect(ask.chosen).toBe('visit-yes');
    expect(career.events.length).toBe(evBefore + 1);
    const ev = career.events[career.events.length - 1]!;
    expect(ev.kind).toBe('recruiting');
    expect(ev.reason.length).toBeGreaterThan(0);
  });

  it('declining cools the board a step and still states its reason', () => {
    const { career, ask } = careerWithVisitAsk();
    const res = applyPhoneChoice(career, ask.id, 'visit-no');
    expect(res.ok).toBe(true);
    const interest = career.recruiting!.interest[0]!;
    expect(interest.rung).toBe('texts'); // no climb on a no
    expect(interest.perceived).toBe(58);
    expect(career.events[career.events.length - 1]!.reason.length).toBeGreaterThan(0);
  });

  it('bad ids refuse politely and mutate nothing', () => {
    const { career, ask } = careerWithVisitAsk();
    const snapshot = JSON.stringify({ e: career.events, i: career.recruiting!.interest });

    const missing = applyPhoneChoice(career, 'ph-nope', 'visit-yes');
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]).toContain('ph-nope');

    const badChoice = applyPhoneChoice(career, ask.id, 'bogus');
    expect(badChoice.ok).toBe(false);
    expect(ask.chosen).toBeUndefined();

    expect(JSON.stringify({ e: career.events, i: career.recruiting!.interest })).toBe(snapshot);

    // answered once is answered forever
    expect(applyPhoneChoice(career, ask.id, 'visit-yes').ok).toBe(true);
    const again = applyPhoneChoice(career, ask.id, 'visit-yes');
    expect(again.ok).toBe(false);
    expect(again.errors[0]).toContain('already answered');
  });

  it('a cooling rung move gets silence, not a warm letter', () => {
    const career = fixtureCareer();
    const program = mkProgram();
    // recruiting.ts just dropped this program from texts back to letter:
    // lastMoveWeek stamped, a negative-delta event logged in its voice
    career.recruiting = {
      programs: [program],
      interest: [{
        programId: program.id, rung: 'letter', perceived: 40,
        lastMoveWeek: career.clock.week, closed: false,
      }],
      offers: [],
    };
    career.events.push({
      id: 'ev-recruit-cool', clock: { ...career.clock }, kind: 'recruiting',
      reason: `${program.name} cooled off: the staff is looking at other names`, delta: -1,
    });
    expect(generatePhone(career).filter(m => m.thread.startsWith('recruiter:'))).toEqual([]);
  });

  it('an expired visit offer cannot be answered', () => {
    const { career, ask } = careerWithVisitAsk();
    career.clock.week = ask.deadlineWeek! + 1;
    const res = applyPhoneChoice(career, ask.id, 'visit-yes');
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('expired');
    expect(career.recruiting!.interest[0]!.rung).toBe('texts');
  });

  it('a read-only message refuses any answer', () => {
    const career = fixtureCareer();
    gradeGame(career, 'g-ro', { pts: 27, adherence: 50, production: 75 });
    const msgs = deliver(career, generatePhone(career));
    const coach = msgs.find(m => m.thread === 'coach')!;
    const res = applyPhoneChoice(career, coach.id, 'anything');
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('no choices');
  });

  it('media and family answers move morale and energy with stated reasons', () => {
    const career = fixtureCareer();
    const me = career.players[career.me]!;
    // an earlier game keeps the season-opener beat out of this week, so
    // the family slot belongs to the running-on-empty ask below
    const earlier = mkRecord(career, 'g-warm', {
      week: career.clock.week - 2,
      lines: [mkLine(career.me, MY_TEAM, { pts: 12 })],
    });
    career.circuit!.results[earlier.id] = earlier;
    gradeGame(career, 'g-big', { pts: 33, adherence: 90, production: 85 });
    career.events.push({
      id: 'ev-energy-test', clock: { ...career.clock }, kind: 'energy',
      reason: 'running on empty (24): the body is one bad landing from trouble',
    });
    const msgs = deliver(career, generatePhone(career));

    const media = msgs.find(m => m.thread === 'media')!;
    expect(media.choices?.length).toBe(3);
    let morale = me.morale;
    expect(applyPhoneChoice(career, media.id, 'media-lean').ok).toBe(true);
    expect(me.morale).toBe(Math.min(100, morale + 3));

    const family = msgs.find(m => m.thread === 'family')!;
    expect(family.choices?.length).toBe(2);
    morale = me.morale;
    const energy = career.energy;
    const evBefore = career.events.length;
    expect(applyPhoneChoice(career, family.id, 'family-go').ok).toBe(true);
    expect(me.morale).toBe(Math.min(100, morale + 4));
    expect(career.energy).toBe(Math.max(0, energy - 8));
    expect(career.events.length).toBe(evBefore + 2); // morale + energy, both explained
    for (const ev of career.events.slice(evBefore)) expect(ev.reason.length).toBeGreaterThan(0);
  });

  it('talking back to the rival after a loss costs what it costs', () => {
    const career = fixtureCareer();
    const me = career.players[career.me]!;
    const rec = mkRecord(career, 'g-h2h', {
      final: [58, 62], // the rival's gym night: away (his side) wins
      lines: [
        mkLine(career.me, MY_TEAM, { pts: 12, orb: 1, drb: 4 }),
        mkLine(career.rivalId, RIVAL_TEAM, { pts: 30 }),
      ],
    });
    career.circuit!.results[rec.id] = rec;
    const msgs = deliver(career, generatePhone(career));
    const rival = msgs.find(m => m.thread === 'rival')!;
    expect(rival.choices?.map(c => c.id)).toEqual(['reply-lost', 'rival-mute']);
    expect(rival.refs?.players).toEqual([career.rivalId]);
    const morale = me.morale;
    expect(applyPhoneChoice(career, rival.id, 'reply-lost').ok).toBe(true);
    expect(me.morale).toBe(Math.max(0, morale - 2));
    expect(career.events[career.events.length - 1]!.kind).toBe('morale');
  });
});

describe('determinism and message discipline', () => {
  function richWeek(career: CareerState): CareerState {
    const w = career.clock.week;
    // the loud graded night (coach + media)
    gradeGame(career, 'g-rich', {
      pts: 31, adherence: 52, production: 82,
      note: 'went off script and it worked; the coach noticed both',
    });
    // the head-to-head loss (rival, with stakes)
    const h2h = mkRecord(career, 'g-h2h', {
      final: [55, 63],
      lines: [
        mkLine(career.me, MY_TEAM, { pts: 18 }),
        mkLine(career.rivalId, RIVAL_TEAM, { pts: 29 }),
      ],
    });
    career.circuit!.results[h2h.id] = h2h;
    // the bracket win (teammate texture)
    career.circuit!.bracket.push({
      id: 'g-sf', week: w, homeIdx: 0, awayIdx: 2, type: 'bracket', round: 'SF',
    });
    const sf = mkRecord(career, 'g-sf', { away: 'hs-mercer', final: [70, 61], lines: [] });
    career.circuit!.results['g-sf'] = sf;
    // the first mock print (agent)
    career.stock!.history.push({
      week: w, year: career.clock.year, rank: 41,
      reason: 'the mock boards print his name for the first time, pick 41',
    });
    // the letter rung move (recruiter)
    career.recruiting!.programs.push(mkProgram());
    career.recruiting!.interest.push({
      programId: 'prog-cb', rung: 'letter', perceived: 55,
      lastMoveWeek: w, closed: false,
    });
    // the injury (family)
    const me = career.players[career.me]!;
    me.health.injury = {
      kind: 'ankle-sprain', label: 'a rolled ankle', severity: 'minor',
      gameId: 'g-rich', startedOn: { season: career.clock.year, day: w },
      outDays: 12, remainingDays: 12,
    };
    career.events.push({
      id: 'ev-injury-test', clock: { ...career.clock }, kind: 'injury',
      reason: 'a rolled ankle: out about 2 weeks', delta: -12,
    });
    return career;
  }

  it('two identical careers read the identical phone, byte for byte', () => {
    const a = generatePhone(richWeek(fixtureCareer()));
    const b = generatePhone(richWeek(fixtureCareer()));
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('every body is nonempty, every decision has at least two choices, every id is unique', () => {
    const career = richWeek(fixtureCareer());
    const msgs = generatePhone(career);
    const threads = msgs.map(m => m.thread).sort();
    expect(threads).toEqual([
      'agent', 'coach', 'family', 'media', 'recruiter:prog-cb', 'rival', 'teammate',
    ]);
    const ids = new Set(msgs.map(m => m.id));
    expect(ids.size).toBe(msgs.length);
    for (const m of msgs) {
      expect(m.body.length).toBeGreaterThan(0);
      expect(m.from.length).toBeGreaterThan(0);
      expect(m.clock).toEqual(career.clock);
      if (m.choices) expect(m.choices.length).toBeGreaterThanOrEqual(2);
    }
    // the burst guard: one message per thread per week
    const perThread = new Map<string, number>();
    for (const m of msgs) perThread.set(m.thread, (perThread.get(m.thread) ?? 0) + 1);
    for (const n of perThread.values()) expect(n).toBe(1);
  });

  it('ids are deterministic from (thread, year, week, index)', () => {
    const career = fixtureCareer();
    gradeGame(career, 'g-id', { pts: 26, adherence: 50, production: 75 });
    const [msg] = generatePhone(career);
    expect(msg!.id).toBe(`ph-coach-${career.clock.year}w${career.clock.week}-0`);
  });
});
