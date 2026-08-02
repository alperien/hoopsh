/**
 * The phone: state-backed messages, few and consequential
 * (docs/CAREER.md, The phone). The suite proves the discipline, not the
 * prose: silence on empty weeks, real numbers quoted, season caps held,
 * choices that mutate real state with explained consequences, and
 * byte-identical generation for identical careers.
 *
 * Wave C additions prove the narrative fix: the ghost guard (recruiting
 * threads never resurrect outside the HS courtship), the summit beats
 * (bracket seed, the title final, commitment day, draft night, the NBA
 * debut), the wire thread with real numbers under its own cap, the
 * role-promise grievance on the params grace period, sender dedupe, and
 * the anti-repeat window.
 */
import { describe, expect, it } from 'vitest';
import type { GameLine, GameRecord, PlayerSeasonRow } from '@hoopsh/franchise';
import { applyPhoneChoice, generatePhone } from '../src/phone.js';
import {
  advisorDisplayOf, agentDisplayOf, beatWriterOf, wireBylineOf,
} from '../src/phone-shared.js';
import type { CareerState, PhoneMessage, Program, RouteOffer } from '../src/types.js';
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

function mkProgram(id = 'prog-cb', name = 'Carolina Baptist'): Program {
  return {
    id, name, tier: 1, coachDev: 70,
    style: { pace: 55, threeBias: 55 }, promisedRole: 'starter',
    nil: 180_000, region: 'South',
  };
}

/** A positive rung-move event in recruiting.ts's own shape (the phone requires the corroboration). */
function pushRungEvent(career: CareerState, programName: string, rung: 'letter' | 'texts' | 'visit' | 'offer'): void {
  const reason = rung === 'letter' ? `${programName} sent a letter from the head coach off summer-circuit tape`
    : rung === 'texts' ? `${programName} opened a text thread: an assistant checks in weekly now`
      : rung === 'visit' ? `${programName} scheduled an in-home visit: the head coach is coming`
        : `${programName} put a committable offer on the table: starter role, $180k NIL, held to signing day`;
  career.events.push({
    id: `rec-test-${career.events.length}`,
    clock: { ...career.clock },
    kind: 'recruiting',
    reason,
    delta: 1,
  });
}

function mkCollegeOffer(over: Partial<RouteOffer> = {}): RouteOffer {
  return {
    id: 'off-prog-cb',
    kind: 'college',
    programId: 'prog-cb',
    money: 180_000,
    coachDev: 70,
    promisedRole: 'starter',
    style: { pace: 55, threeBias: 55 },
    expiresWeek: 50,
    ...over,
  };
}

function mkSeasonRow(over: Partial<PlayerSeasonRow> & { season: number; teamId: string }): PlayerSeasonRow {
  return {
    type: 'regular', gp: 10, gs: 10, min: 280, pts: 150,
    fgm: 55, fga: 120, tpm: 15, tpa: 40, ftm: 25, fta: 30,
    orb: 10, drb: 40, ast: 30, stl: 10, blk: 5, tov: 20, pf: 20, plusMinus: 40,
    ...over,
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

  it('the wire narrates under its own season cap', () => {
    const career = fixtureCareer();
    const start = career.clock.week;
    // an honor lands every second week (folds and harvests are lumpy in
    // real careers too); 15 honors offered, the cap must hold at 10
    for (let i = 0; i < 30; i++) {
      career.clock.week = start + i;
      if (i % 2 === 0) {
        career.events.push({
          id: `ev-honor-test-${i}`,
          clock: { ...career.clock },
          kind: 'honor',
          reason: `all-circuit honor number ${i}`,
        });
      }
      deliver(career, generatePhone(career));
    }
    const wire = career.phone.filter(m => m.thread === 'wire');
    expect(wire.length).toBe(10);
    for (const m of wire) {
      expect(m.from).toContain(', The Ledger'); // the desk persists; the reporter is the career's seeded byline
      expect(m.body).toContain('all-circuit honor number');
    }
  });
});

describe('the ghosts stay dead', () => {
  it('an NBA-phase career gets zero recruiter messages, even on a stale week collision', () => {
    const career = fixtureCareer();
    career.clock.phase = 'nba';
    const program = mkProgram();
    career.recruiting = {
      programs: [program],
      interest: [{
        programId: program.id, rung: 'offer', perceived: 70,
        lastMoveWeek: career.clock.week, closed: false, // the ghost setup: caps reset, weeks collide
      }],
      offers: [mkCollegeOffer()],
    };
    pushRungEvent(career, program.name, 'offer'); // even a forged fresh event cannot beat the phase guard
    const msgs = generatePhone(career);
    expect(msgs.filter(m => m.thread.startsWith('recruiter:'))).toEqual([]);
  });

  it('a stale lastMoveWeek in a later HS year says nothing without a fresh rung event', () => {
    const career = fixtureCareer();
    career.clock.year += 1; // the per-year caps just reset; the old bug resurrected here
    const program = mkProgram();
    career.recruiting = {
      programs: [program],
      interest: [{
        programId: program.id, rung: 'texts', perceived: 60,
        lastMoveWeek: career.clock.week, closed: false,
      }],
      offers: [],
    };
    expect(generatePhone(career).filter(m => m.thread.startsWith('recruiter:'))).toEqual([]);
  });

  it('commitment ends the courtship: after the door-close week, recruiter silence', () => {
    const career = fixtureCareer();
    const winner = mkProgram('prog-cb', 'Carolina Baptist');
    const loser = mkProgram('prog-ms', 'Meridian State');
    career.recruiting = {
      programs: [winner, loser],
      interest: [
        { programId: winner.id, rung: 'offer', perceived: 75, lastMoveWeek: career.clock.week, closed: false },
        { programId: loser.id, rung: 'offer', perceived: 70, lastMoveWeek: career.clock.week, closed: true, closedReason: 'signed elsewhere' },
      ],
      offers: [mkCollegeOffer()],
      committedTo: 'off-prog-cb',
    };
    pushRungEvent(career, winner.name, 'offer'); // stale state that would have spoken pre-fix
    const week1 = deliver(career, generatePhone(career));
    const recruiterMsgs = week1.filter(m => m.thread.startsWith('recruiter:'));
    expect(recruiterMsgs.length).toBe(1); // the losing finalist's one door-close, nothing else
    expect(recruiterMsgs[0]!.thread).toBe('recruiter:prog-ms');
    career.clock.week += 1;
    const week2 = generatePhone(career);
    expect(week2.filter(m => m.thread.startsWith('recruiter:'))).toEqual([]);
  });
});

describe('the commitment burst', () => {
  function committedCareer(): CareerState {
    const career = fixtureCareer();
    const winner = mkProgram('prog-cb', 'Carolina Baptist');
    const loser = mkProgram('prog-ms', 'Meridian State');
    career.recruiting = {
      programs: [winner, loser],
      interest: [
        { programId: winner.id, rung: 'offer', perceived: 75, lastMoveWeek: career.clock.week - 2, closed: false },
        { programId: loser.id, rung: 'offer', perceived: 70, lastMoveWeek: career.clock.week - 2, closed: true, closedReason: 'signed elsewhere' },
      ],
      offers: [mkCollegeOffer()],
      committedTo: 'off-prog-cb',
    };
    return career;
  }

  it('fires mom, the rival, and the losing finalist, quoting the real program', () => {
    const career = committedCareer();
    const msgs = deliver(career, generatePhone(career));
    const mom = msgs.find(m => m.thread === 'family');
    const rival = msgs.find(m => m.thread === 'rival');
    const close = msgs.find(m => m.thread === 'recruiter:prog-ms');
    expect(mom).toBeDefined();
    expect(mom!.body).toContain('Carolina Baptist');
    expect(rival).toBeDefined();
    expect(rival!.body).toContain('Carolina Baptist');
    expect(close).toBeDefined();
    expect(close!.from).toContain('Meridian State');
    expect(close!.refs?.programId).toBe('prog-ms');
  });

  it('fires exactly once, and rides outside the family season cap', () => {
    const career = committedCareer();
    // mom already spent her whole season budget on ordinary weeks
    for (let i = 0; i < career.params.phone.capsPerSeason.family; i++) {
      career.phone.push({
        id: `ph-family-${career.clock.year}w${i + 1}-0`,
        clock: { phase: 'hs', year: career.clock.year, week: i + 1 },
        thread: 'family', from: 'Mom', body: `an earlier text ${i}`,
      });
    }
    const first = deliver(career, generatePhone(career));
    expect(first.filter(m => m.thread === 'family').length).toBe(1); // signing day still lands
    career.clock.week += 1;
    const second = generatePhone(career);
    expect(second.filter(m => m.id.includes('#commit#'))).toEqual([]);
  });
});

describe('draft night', () => {
  function draftedCareer(): CareerState {
    const career = fixtureCareer();
    career.clock.phase = 'nba';
    career.nbaTeam = 'nye';
    const me = career.players[career.me]!;
    delete career.players[career.me];
    me.status = 'roster';
    career.league.players[career.me] = me;
    career.stock!.rank = 21; // the final pre-draft mock: the gap the agent names
    career.league.transactions.push(
      { kind: 'draftSelection', date: { season: career.league.season, day: 200 }, teamId: 'nye', playerId: career.me, round: 1, pick: 4 },
      { kind: 'draftSelection', date: { season: career.league.season, day: 200 }, teamId: 'bos', playerId: career.rivalId, round: 1, pick: 11 },
    );
    return career;
  }

  it('the burst quotes the real pick, team, mock gap, and the rival numbers', () => {
    const career = draftedCareer();
    const msgs = deliver(career, generatePhone(career));

    const agent = msgs.find(m => m.thread === 'agent');
    expect(agent).toBeDefined();
    expect(agent!.from).toContain('(agent)'); // the AGENT calls on draft night, never the advisor
    expect(agent!.body).toContain('21'); // the mock the boards printed
    expect(/\b4\b/.test(agent!.body)).toBe(true); // the pick the room called
    expect(agent!.refs?.teamId).toBe('nye');

    const mom = msgs.find(m => m.thread === 'family');
    expect(mom).toBeDefined();
    expect(/New York Excelsiors|[Pp]ick 4/.test(mom!.body)).toBe(true);

    const rival = msgs.find(m => m.thread === 'rival');
    expect(rival).toBeDefined();
    expect(/\b11\b/.test(rival!.body)).toBe(true); // his real pick
    expect(/\b4\b/.test(rival!.body)).toBe(true);  // against mine

    const wire = msgs.find(m => m.thread === 'wire');
    expect(wire).toBeDefined();
    expect(wire!.from).toContain(', The Ledger');
    expect(wire!.body).toContain('Testville, Ohio'); // the birthplace arc
    expect(/\b4\b/.test(wire!.body)).toBe(true);
  });

  it('fires exactly once even though the transaction stays in the ledger forever', () => {
    const career = draftedCareer();
    deliver(career, generatePhone(career));
    career.clock.week += 1;
    const second = generatePhone(career);
    expect(second.filter(m => m.id.includes('#draftnight#'))).toEqual([]);
  });

  it('two identical draft nights read byte-identical', () => {
    const a = generatePhone(draftedCareer());
    const b = generatePhone(draftedCareer());
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('an undrafted night gets the agent morning-after, once', () => {
    const career = fixtureCareer();
    career.clock.phase = 'draftPrep';
    career.circuit = null;
    career.events.push({
      id: 'ev-stock-undrafted',
      clock: { ...career.clock },
      kind: 'stock',
      reason: 'sixty names, none of them yours: undrafted. The phone still works',
    });
    const msgs = deliver(career, generatePhone(career));
    const agent = msgs.find(m => m.thread === 'agent');
    expect(agent).toBeDefined();
    expect(agent!.id.includes('#undrafted#')).toBe(true);
    career.clock.week += 1;
    expect(generatePhone(career).filter(m => m.id.includes('#undrafted#'))).toEqual([]);
  });
});

describe('the summit beats', () => {
  it('the bracket seed gets the coach beat naming the opener', () => {
    const career = fixtureCareer();
    career.circuit!.standings.find(s => s.teamIdx === 0)!.w = 10;
    career.circuit!.standings.find(s => s.teamIdx === 0)!.l = 2;
    career.circuit!.bracket.push({
      id: 'g-qf', week: career.clock.week + 1, homeIdx: 0, awayIdx: 2, type: 'bracket', round: 'QF',
    });
    const msgs = generatePhone(career);
    const coach = msgs.find(m => m.thread === 'coach');
    expect(coach).toBeDefined();
    expect(coach!.body).toContain('Mercer County');
    expect(coach!.body.toLowerCase()).toContain('bracket');
  });

  it('the title win gets the proudest family text and the coach postmortem', () => {
    const career = fixtureCareer();
    career.circuit!.standings.find(s => s.teamIdx === 0)!.w = 12;
    career.circuit!.standings.find(s => s.teamIdx === 0)!.l = 2;
    career.circuit!.bracket.push({
      id: 'g-final', week: career.clock.week, homeIdx: 0, awayIdx: 2, type: 'bracket', round: 'F',
    });
    const rec = mkRecord(career, 'g-final', {
      away: 'hs-mercer', final: [70, 61],
      lines: [mkLine(career.me, MY_TEAM, { pts: 24 })],
    });
    career.circuit!.results['g-final'] = rec;
    const msgs = deliver(career, generatePhone(career));
    const mom = msgs.find(m => m.thread === 'family');
    expect(mom).toBeDefined();
    expect(mom!.body).toContain('state champion'); // the actual finish string
    const coach = msgs.find(m => m.thread === 'coach');
    expect(coach).toBeDefined();
    expect(coach!.id.includes('#post')).toBe(true);
    expect(/12-2|70-61/.test(coach!.body)).toBe(true); // the season named honestly
  });

  it('the title loss keeps the ticket anyway', () => {
    const career = fixtureCareer();
    career.circuit!.bracket.push({
      id: 'g-final', week: career.clock.week, homeIdx: 0, awayIdx: 2, type: 'bracket', round: 'F',
    });
    const rec = mkRecord(career, 'g-final', {
      away: 'hs-mercer', final: [58, 62],
      lines: [mkLine(career.me, MY_TEAM, { pts: 19 })],
    });
    career.circuit!.results['g-final'] = rec;
    const msgs = generatePhone(career);
    const mom = msgs.find(m => m.thread === 'family');
    expect(mom).toBeDefined();
    expect(/ticket|62-58/.test(mom!.body)).toBe(true);
  });

  it('the NBA debut sends mom, the coach with the actual line, and the vet mentor', () => {
    const career = fixtureCareer();
    career.clock.phase = 'nba';
    career.nbaTeam = 'nye';
    career.circuit = null;
    const me = career.players[career.me]!;
    delete career.players[career.me];
    me.status = 'roster';
    me.seasons.push(mkSeasonRow({ season: career.league.season, teamId: 'nye', gp: 1, pts: 18 }));
    career.league.players[career.me] = me;
    career.league.day = 7;
    const rec = mkRecord(career, 'g-debut', {
      home: 'nye', away: 'bos',
      lines: [mkLine(career.me, 'nye', { pts: 18, ast: 4, orb: 1, drb: 4 })],
    });
    rec.date = { season: career.league.season, day: 5 };
    career.league.results['g-debut'] = rec;

    const msgs = deliver(career, generatePhone(career));
    const mom = msgs.find(m => m.thread === 'family');
    expect(mom).toBeDefined();
    expect(mom!.body).toContain('18');
    const coach = msgs.find(m => m.thread === 'coach');
    expect(coach).toBeDefined();
    expect(coach!.body).toContain('18');
    const mentor = msgs.find(m => m.thread === 'mentor');
    expect(mentor).toBeDefined();
    expect(mentor!.from).toContain('(vet)');

    // the second week is not a debut
    career.clock.week += 1;
    career.league.day = 14;
    expect(generatePhone(career).filter(m => m.id.includes('#debut#'))).toEqual([]);
  });
});

describe('the wire quotes real numbers', () => {
  it('a career scoring milestone crossing files the story', () => {
    const career = fixtureCareer();
    const me = career.players[career.me]!;
    me.seasons.push(mkSeasonRow({ season: career.clock.year, teamId: MY_TEAM, gp: 39, pts: 1010 }));
    const rec = mkRecord(career, 'g-mile', {
      lines: [mkLine(career.me, MY_TEAM, { pts: 26 })],
    });
    career.circuit!.results[rec.id] = rec;
    const msgs = generatePhone(career);
    const wire = msgs.find(m => m.thread === 'wire');
    expect(wire).toBeDefined();
    expect(wire!.from).toContain(', The Ledger');
    expect(wire!.body).toContain('1,000'); // the crossed mark
    expect(wire!.body).toContain('26');    // the night that crossed it
  });

  it('no crossing, no story', () => {
    const career = fixtureCareer();
    const me = career.players[career.me]!;
    me.seasons.push(mkSeasonRow({ season: career.clock.year, teamId: MY_TEAM, gp: 30, pts: 800 }));
    const rec = mkRecord(career, 'g-nomile', {
      lines: [mkLine(career.me, MY_TEAM, { pts: 26 })],
    });
    career.circuit!.results[rec.id] = rec;
    // the opener beat may fire; the wire must not
    expect(generatePhone(career).filter(m => m.thread === 'wire')).toEqual([]);
  });

  it('honor events land as one-line stories, on the one-week lag', () => {
    const career = fixtureCareer();
    career.events.push({
      id: 'ev-honor-scoring-2026',
      clock: { phase: 'hs', year: career.clock.year, week: career.clock.week - 1 },
      kind: 'honor',
      reason: 'circuit scoring leader',
    });
    const msgs = generatePhone(career);
    const wire = msgs.find(m => m.thread === 'wire');
    expect(wire).toBeDefined();
    expect(wire!.body).toContain('circuit scoring leader');
  });
});

describe('the promise grievance', () => {
  function collegeWithPromise(over: { role?: CareerState['coach']['role']; gp?: number } = {}): CareerState {
    const career = fixtureCareer();
    career.clock.phase = 'college';
    career.coach.role = over.role ?? 'rotation';
    career.recruiting = {
      programs: [mkProgram()],
      interest: [],
      offers: [mkCollegeOffer({ promisedRole: 'starter' })],
      committedTo: 'off-prog-cb',
    };
    career.circuitHistory.push({
      year: career.clock.year - 1, kind: 'college', teamName: 'Carolina Baptist',
      w: 12, l: 6,
      myLine: { gp: over.gp ?? 21, min: 560, pts: 300, reb: 90, ast: 60, stl: 20, blk: 5, tpm: 30, fgPct: 0.46 },
      finish: '3rd in conference', honors: [],
    });
    return career;
  }

  it('fires after the grace games with the role still below the promise', () => {
    const career = collegeWithPromise({ role: 'rotation', gp: 21 });
    expect(career.params.nbabridge.promiseGraceGames).toBe(20); // the consumed lever
    const msgs = generatePhone(career);
    const grievance = msgs.find(m => m.thread === 'agent' && m.choices !== undefined);
    expect(grievance).toBeDefined();
    expect(grievance!.body).toContain('starter');   // the promise, named
    expect(grievance!.body).toContain('rotation');  // the reality, named
    expect(grievance!.body).toContain('21');        // the games counted
    expect(grievance!.choices!.map(c => c.id)).toEqual(['promise-let-go', 'promise-make-known', 'promise-demand']);
  });

  it('stays quiet inside the grace period', () => {
    const career = collegeWithPromise({ role: 'rotation', gp: 10 });
    expect(generatePhone(career).filter(m =>
      m.thread === 'agent' && m.choices?.some(c => c.id === 'promise-let-go'))).toEqual([]);
  });

  it('never grieves a kept promise', () => {
    const career = collegeWithPromise({ role: 'starter', gp: 30 });
    expect(generatePhone(career).filter(m =>
      m.thread === 'agent' && m.choices?.some(c => c.id === 'promise-let-go'))).toEqual([]);
  });

  it('sends the satisfied beat when the role rises to meet the promise, once', () => {
    const career = collegeWithPromise({ role: 'starter', gp: 12 });
    career.events.push({
      id: 'ev-role-test', clock: { ...career.clock }, kind: 'role',
      reason: 'outproduced the rotation role 6 games running', delta: 1,
    });
    const msgs = deliver(career, generatePhone(career));
    const kept = msgs.find(m => m.thread === 'agent');
    expect(kept).toBeDefined();
    expect(kept!.body).toContain('starter');
    expect(kept!.choices).toBeUndefined();
    // a later promotion week does not repeat the beat for the same promise
    career.clock.week += 1;
    career.events.push({
      id: 'ev-role-test-2', clock: { ...career.clock }, kind: 'role',
      reason: 'outproduced the starter role 6 games running', delta: 1,
    });
    expect(generatePhone(career).filter(m => m.id.includes('#kept-'))).toEqual([]);
  });

  it('conducts the NBA grievance off the signing event and the coach ledger', () => {
    const career = fixtureCareer();
    career.clock.phase = 'nba';
    career.nbaTeam = 'nye';
    career.circuit = null;
    const me = career.players[career.me]!;
    delete career.players[career.me];
    me.status = 'roster';
    career.league.players[career.me] = me;
    career.coach.role = 'bench';
    career.events.push({
      id: 'ev-contract-sign', clock: { ...career.clock }, kind: 'contract',
      reason: 'signed: New York Excelsiors, 2y starting at $4,000,000 (starter role promised)',
    });
    for (let g = 0; g < 21; g++) {
      career.coach.grades.push({
        gameId: `nba-g${g}`, adherence: 100, production: 0, trustDelta: 0,
        note: 'did not play; nothing to grade', // buried IS the case
      });
    }
    const msgs = generatePhone(career);
    const grievance = msgs.find(m => m.thread === 'agent' && m.choices !== undefined);
    expect(grievance).toBeDefined();
    expect(grievance!.body).toContain('starter');
    expect(grievance!.body).toContain('bench');
    expect(grievance!.refs?.teamId).toBe('nye');
  });

  it('every grievance answer mutates real state with explained events', () => {
    const career = collegeWithPromise({ role: 'rotation', gp: 21 });
    const me = career.players[career.me]!;
    const msgs = deliver(career, generatePhone(career));
    const grievance = msgs.find(m => m.thread === 'agent' && m.choices !== undefined)!;

    const trustBefore = career.coach.trust;
    const moraleBefore = me.morale;
    const evBefore = career.events.length;
    expect(applyPhoneChoice(career, grievance.id, 'promise-make-known').ok).toBe(true);
    expect(career.coach.trust).toBe(trustBefore - 2);
    expect(me.morale).toBe(Math.min(100, moraleBefore + 1));
    expect(career.events.length).toBe(evBefore + 2);
    for (const ev of career.events.slice(evBefore)) expect(ev.reason.length).toBeGreaterThan(0);

    // a second answer refuses: the grievance is conducted once
    const again = applyPhoneChoice(career, grievance.id, 'promise-demand');
    expect(again.ok).toBe(false);
    expect(again.errors[0]).toContain('already answered');
  });

  it('letting it go settles the person', () => {
    const career = collegeWithPromise({ role: 'rotation', gp: 21 });
    const me = career.players[career.me]!;
    const msgs = deliver(career, generatePhone(career));
    const grievance = msgs.find(m => m.thread === 'agent' && m.choices !== undefined)!;
    const moraleBefore = me.morale;
    expect(applyPhoneChoice(career, grievance.id, 'promise-let-go').ok).toBe(true);
    expect(me.morale).toBe(Math.min(100, moraleBefore + 2));
    expect(career.events[career.events.length - 1]!.kind).toBe('morale');
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
    pushRungEvent(career, program.name, 'texts'); // the rung move's own event, as recruiting.ts logs it
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

describe('anti-repeat and sender discipline', () => {
  it('mom never repeats a body across consecutive empty-tank weeks', () => {
    const career = fixtureCareer();
    const start = career.clock.week;
    for (let i = 0; i < career.params.phone.capsPerSeason.family; i++) {
      career.clock.week = start + i;
      career.events.push({
        id: `ev-energy-${i}`, clock: { ...career.clock }, kind: 'energy',
        reason: 'running on empty (22): the body is one bad landing from trouble',
      });
      deliver(career, generatePhone(career));
    }
    const bodies = career.phone.filter(m => m.thread === 'family').map(m => m.body);
    expect(bodies.length).toBe(career.params.phone.capsPerSeason.family);
    expect(new Set(bodies).size).toBe(bodies.length); // the measured defect: 4 straight identical weeks
  });

  it('no sender lands two messages in one week, even across a summit pile-up', () => {
    const career = fixtureCareer();
    // commitment week AND a head-to-head the same week: mom and the rival
    // both have two reasons to text
    const winner = mkProgram('prog-cb', 'Carolina Baptist');
    const loser = mkProgram('prog-ms', 'Meridian State');
    career.recruiting = {
      programs: [winner, loser],
      interest: [
        { programId: winner.id, rung: 'offer', perceived: 75, lastMoveWeek: career.clock.week - 1, closed: false },
        { programId: loser.id, rung: 'offer', perceived: 70, lastMoveWeek: career.clock.week - 1, closed: true, closedReason: 'signed elsewhere' },
      ],
      offers: [mkCollegeOffer()],
      committedTo: 'off-prog-cb',
    };
    const h2h = mkRecord(career, 'g-h2h', {
      final: [55, 63],
      lines: [
        mkLine(career.me, MY_TEAM, { pts: 18 }),
        mkLine(career.rivalId, RIVAL_TEAM, { pts: 29 }),
      ],
    });
    career.circuit!.results[h2h.id] = h2h;
    const rec = mkRecord(career, 'g-opener2', {
      lines: [mkLine(career.me, MY_TEAM, { pts: 22 })],
    });
    career.circuit!.results[rec.id] = rec;

    const msgs = generatePhone(career);
    const froms = msgs.map(m => m.from);
    expect(new Set(froms).size).toBe(froms.length);
    const perThread = new Map<string, number>();
    for (const m of msgs) perThread.set(m.thread, (perThread.get(m.thread) ?? 0) + 1);
    for (const n of perThread.values()) expect(n).toBe(1);
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
    // the letter rung move (recruiter), corroborated by its own event
    career.recruiting!.programs.push(mkProgram());
    career.recruiting!.interest.push({
      programId: 'prog-cb', rung: 'letter', perceived: 55,
      lastMoveWeek: w, closed: false,
    });
    pushRungEvent(career, 'Carolina Baptist', 'letter');
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

describe('the home cast is seeded per career (issue #109)', () => {
  // provenance: playtest session 1 opened two careers on opposite specs
  // (US aau fourstar vs intl playground walkon) and met the identical
  // four contacts — advisor, agent, beat writer, wire byline were
  // hardcoded. The cast must differ across seeds and hold within one.

  it('the four identities are stable for a career\'s whole life', () => {
    const career = fixtureCareer();
    const tuple = [advisorDisplayOf(career), agentDisplayOf(career), beatWriterOf(career), wireBylineOf(career)];
    // derivation is a pure function of the seed: asking twice, or after
    // the clock moves, never re-rolls a person
    career.clock.year += 3;
    career.clock.phase = 'nba';
    expect([advisorDisplayOf(career), agentDisplayOf(career), beatWriterOf(career), wireBylineOf(career)]).toEqual(tuple);
  });

  it('two seeds cast two different phones', () => {
    const a = fixtureCareer({ seed: 'career-fixture' });
    const b = fixtureCareer({ seed: 'career-fixture-b' });
    const tupleOf = (c: CareerState): string =>
      [advisorDisplayOf(c), agentDisplayOf(c), beatWriterOf(c), wireBylineOf(c)].join(' | ');
    // full-tuple collision odds across 16-entry pools are 16^-4; these
    // two seeds are verified distinct (re-pick the b seed if a pool
    // resize ever collides them)
    expect(tupleOf(a) === tupleOf(b)).toBe(false);
  });

  it('what the messages carry IS the cast: the wire byline on a story matches the derivation', () => {
    const career = fixtureCareer();
    career.events.push({
      id: 'ev-honor-cast', clock: { phase: 'hs', year: career.clock.year, week: career.clock.week - 1 },
      kind: 'honor', reason: 'circuit scoring leader',
    });
    const wire = generatePhone(career).find(m => m.thread === 'wire');
    expect(wire).toBeDefined();
    expect(wire!.from).toBe(wireBylineOf(career));
  });

  it('the agent introduction signs with the career\'s own agent, not a fixture name', () => {
    const career = fixtureCareer();
    career.clock.phase = 'draftPrep';
    career.events.push({
      id: 'ev-phase-prep', clock: { ...career.clock }, kind: 'phase',
      reason: 'in the draft: the pre-draft window opens',
    });
    const agent = generatePhone(career).find(m => m.thread === 'agent');
    expect(agent).toBeDefined();
    expect(agent!.from).toBe(agentDisplayOf(career));
    // the body may or may not sign the name (one of four variants does);
    // the contact card is the contract, the prose is texture
  });

  it('an international creation gets a family corner from home, never the county-gym uncle pool', () => {
    const us = fixtureCareer();
    const intl = fixtureCareer();
    intl.creation.nationality = 'intl';
    // the pools are disjoint by construction, so the same seed MUST
    // resolve to different advisors across the nationality line
    expect(advisorDisplayOf(us) === advisorDisplayOf(intl)).toBe(false);
    expect(advisorDisplayOf(intl)).toContain('(advisor)');
  });
});

describe('the closing windows speak (fix wave C, the Amari critique)', () => {
  it('a program calls once when its offer nears the lapse, and the agent names the chorus', () => {
    const career = fixtureCareer();
    career.clock.phase = 'hs';
    career.recruiting!.committedTo = undefined;
    career.recruiting!.programs = [
      { id: 'p1', name: 'Meridian State', tier: 1, coachDev: 80, style: { pace: 55, threeBias: 55 }, promisedRole: 'rotation', nil: 180000, region: 'Midwest' },
      { id: 'p2', name: 'Cathedral', tier: 2, coachDev: 60, style: { pace: 50, threeBias: 50 }, promisedRole: 'sixthMan', nil: 60000, region: 'Southeast' },
      { id: 'p3', name: 'Piedmont', tier: 3, coachDev: 45, style: { pace: 48, threeBias: 45 }, promisedRole: 'featured', nil: 15000, region: 'Mid-Atlantic' },
    ] as never;
    career.recruiting!.interest = career.recruiting!.programs.map(p => ({
      programId: p.id, rung: 'offer', perceived: 60, lastMoveWeek: 5, closed: false,
    })) as never;
    const wk = career.clock.week;
    career.recruiting!.offers = career.recruiting!.programs.map((p, i) => ({
      id: `off-${p.id}`, kind: 'college', programId: p.id, money: p.nil,
      coachDev: p.coachDev, promisedRole: p.promisedRole, style: p.style,
      expiresWeek: wk + 2,
    })) as never;

    const msgs = generatePhone(career);
    const warnings = msgs.filter(m => m.id.includes('#lapse-'));
    const chorus = msgs.filter(m => m.id.includes('#lapsechorus-'));
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(chorus.length).toBe(1);
    expect(chorus[0]!.body).toContain('Meridian State');
    for (const m of warnings) expect(m.body.length).toBeGreaterThan(20);

    // committed: the doors are already chosen; nobody warns about lapses
    career.phone.push(...msgs);
    career.recruiting!.committedTo = 'off-p1';
    const after = generatePhone(career);
    expect(after.some(m => m.id.includes('#lapse-'))).toBe(false);
  });
});
