/**
 * The formative arcs (phone-arcs.ts, issue #105): scheduled state-backed
 * texture for the three measured dead windows - the circuit offseason,
 * the pre-combine draftPrep block, and the NBA draft-to-camp gap. The
 * suite proves the discipline, not the prose (phone.test.ts doctrine):
 * beats fire inside their windows and exactly once, cadence covers the
 * measured droughts inside the #104 band, cap-blocked beats degrade to
 * the designed fallback threads instead of dying, the assignment choice
 * mutates real state with an explained consequence, and generation stays
 * byte-identical for identical careers.
 */
import { describe, expect, it } from 'vitest';
import type { FrPlayer, TeamId } from '@hoopsh/franchise';
import { applyPhoneChoice, generatePhone } from '../src/phone.js';
import type { CareerState, PhoneMessage } from '../src/types.js';
import { fixtureCareer } from './fixture.js';

/** week.ts's own push-and-dedupe, so tags and caps read realistically. */
function pulse(career: CareerState): PhoneMessage[] {
  const msgs = generatePhone(career);
  for (const m of msgs) {
    if (!career.phone.some(x => x.id === m.id)) career.phone.push(m);
  }
  return msgs;
}

/** Fold the fixture's HS season: archive a summary, log the fold event, park the clock at the fold week. */
function intoOffseason(career: CareerState, foldWeek = 25): void {
  career.circuit = null;
  career.circuitHistory.push({
    year: career.clock.year, kind: 'hs', teamName: 'Oak Ridge Central',
    w: 18, l: 4,
    myLine: { gp: 22, min: 640, pts: 480, reb: 130, ast: 90, stl: 40, blk: 12, tpm: 50, fgPct: 0.51 },
    finish: 'lost the state final', honors: ['conference MVP'],
  });
  career.events.push({
    id: `ev-phase-${career.clock.year}w${foldWeek}-${career.events.length}`,
    clock: { phase: career.clock.phase, year: career.clock.year, week: foldWeek },
    kind: 'phase',
    reason: 'season over: lost the state final (conference MVP)',
  });
  career.clock.week = foldWeek;
}

/** A live board: a rank plus per-team values with named extremes. */
function giveBoard(career: CareerState, rank: number): void {
  career.stock!.rank = rank;
  const perTeam: Record<string, number> = {};
  Object.keys(career.league.teams).forEach((tid, i) => {
    perTeam[tid] = 50 + (i % 7); // spread with ties; the sort tiebreaks on teamId
  });
  career.stock!.perTeam = perTeam as Record<TeamId, number>;
}

/** Standings rows for the league-underneath beats (the fixture league ships an empty table). */
function giveStandings(career: CareerState): void {
  const standings: Record<string, { teamId: string; w: number; l: number; homeW: number; homeL: number; awayW: number; awayL: number; confW: number; confL: number; divW: number; divL: number; ptsFor: number; ptsAgainst: number; streak: number; last10: Array<0 | 1> }> = {};
  Object.keys(career.league.teams).forEach((tid, i) => {
    standings[tid] = {
      teamId: tid, w: i, l: 40 - i, homeW: 0, homeL: 0, awayW: 0, awayL: 0,
      confW: 0, confL: 0, divW: 0, divL: 0, ptsFor: 0, ptsAgainst: 0, streak: 0, last10: [],
    };
  });
  career.league.standings = standings as never;
}

function tagged(career: CareerState, tag: string): PhoneMessage[] {
  return career.phone.filter(m => m.id.includes(`#${tag}#`));
}

describe('the offseason arc (the measured 34-week window)', () => {
  it('the exit meeting fires after the fold, quotes the archived season, and carries the assignment', () => {
    const career = fixtureCareer();
    intoOffseason(career);
    career.clock.week = 27; // fold + 2, inside the exit window
    const msgs = pulse(career);
    const exit = msgs.find(m => m.id.includes('#arc-exit-2026#'));
    expect(exit).toBeTruthy();
    expect(exit!.thread).toBe('coach');
    expect(exit!.body.includes('lost the state final')).toBe(true); // the archive, not prose
    expect(exit!.choices!.length).toBe(2);
    expect(exit!.choices![0]!.id.startsWith('arc-focus:')).toBe(true);
    expect(exit!.choices![1]!.id).toBe('arc-focus-keep');
  });

  it('every beat fires exactly once (the tag survives the whole window)', () => {
    const career = fixtureCareer();
    intoOffseason(career);
    for (let w = 26; w <= 30; w++) {
      career.clock.week = w;
      pulse(career);
    }
    expect(tagged(career, 'arc-exit-2026').length).toBe(1);
  });

  it('a spent coach cap costs the coach beats, not the window: the agent ledger still lands', () => {
    const career = fixtureCareer();
    intoOffseason(career);
    for (let i = 0; i < career.params.phone.capsPerSeason.coach; i++) {
      career.phone.push({
        id: `ph-coach-fill-${i}`, thread: 'coach', from: career.coach.name,
        clock: { phase: 'hs', year: career.clock.year, week: 1 + i }, body: `film note ${i}`,
      });
    }
    career.clock.week = 27;
    pulse(career);
    expect(tagged(career, 'arc-exit-2026').length).toBe(0); // capped out, by design not exempt
    career.clock.week = 31; // the ledger window leans on the agent thread on purpose
    const msgs = pulse(career);
    const ledger = msgs.find(m => m.id.includes('#arc-led-2026#'));
    expect(ledger).toBeTruthy();
    expect(ledger!.thread).toBe('agent');
  });

  it('the whole arc bridges fold to the next build inside the #104 band (max gap <= 7 weeks)', () => {
    const career = fixtureCareer();
    giveBoard(career, 2);
    intoOffseason(career);
    const spoke: number[] = [25]; // the fold week itself carries the fold event
    for (let w = 26; w <= 51; w++) {
      career.clock.week = w;
      if (pulse(career).length > 0) spoke.push(w);
    }
    // the year turns; the camp countdown owns the pre-build stretch
    career.clock.year += 1;
    for (let w = 0; w <= 7; w++) {
      career.clock.week = w;
      if (pulse(career).length > 0) spoke.push(52 + w);
    }
    spoke.push(52 + 8); // the build week logs 'the hs season schedule is out' (tick.ts)
    for (const tag of ['arc-exit-2026', 'arc-led-2026', 'arc-brd-2026', 'arc-sep-2026', 'arc-blk-2026', 'arc-camp-2027']) {
      expect(tagged(career, tag).length).toBe(1);
    }
    let maxGap = 0;
    for (let i = 1; i < spoke.length; i++) maxGap = Math.max(maxGap, spoke[i]! - spoke[i - 1]!);
    expect(maxGap).toBeLessThanOrEqual(7); // < the re-based <= 8 zero-event band
  });

  it('no live board, no board beat: the wire never invents a number', () => {
    const career = fixtureCareer(); // fixture stock.rank is null
    intoOffseason(career);
    for (let w = 36; w <= 40; w++) {
      career.clock.week = w;
      pulse(career);
    }
    expect(tagged(career, 'arc-brd-2026').length).toBe(0);
  });
});

describe('the draftPrep arc (the measured 30-of-39 silent block)', () => {
  function intoDraftPrep(career: CareerState): void {
    career.circuit = null;
    career.clock = { phase: 'draftPrep', year: 2028, week: 0 };
    career.circuitHistory.push({
      year: 2027, kind: 'college', teamName: 'Fort Duquesne',
      w: 24, l: 9,
      myLine: { gp: 33, min: 1050, pts: 640, reb: 170, ast: 120, stl: 45, blk: 20, tpm: 70, fgPct: 0.49 },
      finish: 'lost the national semifinal', honors: [],
    });
    giveBoard(career, 1); // the measured worst case: a locked top pick
    giveStandings(career);
  }

  it('six beats bridge week 0 to the combine with a locked board (max gap <= 6)', () => {
    const career = fixtureCareer();
    intoDraftPrep(career);
    const spoke: number[] = [0]; // the window-open agent beat rides the phase event (existing content)
    for (let w = 1; w <= 33; w++) {
      career.clock.week = w;
      if (pulse(career).length > 0) spoke.push(w);
    }
    for (const tag of ['arc-dp-prog-2028', 'arc-dp-brd-2028', 'arc-dp-race-2028', 'arc-dp-wind-2028', 'arc-dp-run-2028', 'arc-dp-cmb-2028']) {
      expect(tagged(career, tag).length).toBe(1);
    }
    let maxGap = 0;
    for (let i = 1; i < spoke.length; i++) maxGap = Math.max(maxGap, spoke[i]! - spoke[i - 1]!);
    expect(maxGap).toBeLessThanOrEqual(6);
  });

  it('the program beat trains off the last real tape and offers the assignment', () => {
    const career = fixtureCareer();
    intoDraftPrep(career);
    career.clock.week = 2;
    const msgs = pulse(career);
    const prog = msgs.find(m => m.id.includes('#arc-dp-prog-2028#'));
    expect(prog).toBeTruthy();
    expect(prog!.thread).toBe('agent');
    expect(prog!.body.includes('19.4')).toBe(true); // 640 pts / 33 gp off the archive, not invented
    expect(prog!.choices!.length).toBe(2);
  });

  it('the race beat names the actual bottom of the real table', () => {
    const career = fixtureCareer();
    intoDraftPrep(career);
    career.clock.week = 13;
    const msgs = pulse(career);
    const race = msgs.find(m => m.id.includes('#arc-dp-race-2028#'));
    expect(race).toBeTruthy();
    expect(race!.thread).toBe('wire');
    const worstId = Object.keys(career.league.teams)[0]!; // w=0 by construction
    const worstName = `${career.league.teams[worstId]!.city} ${career.league.teams[worstId]!.name}`;
    expect(race!.body.includes(worstName)).toBe(true);
    expect(race!.body.includes('0-40')).toBe(true);
  });

  it('the combine countdown stands down once the combine is done', () => {
    const career = fixtureCareer();
    intoDraftPrep(career);
    career.stock!.combineDone = true;
    career.clock.week = 31;
    pulse(career);
    expect(tagged(career, 'arc-dp-cmb-2028').length).toBe(0);
  });
});

describe('the entry arc (the measured draft-to-camp gap)', () => {
  function intoEntryGap(career: CareerState): TeamId {
    const league = career.league;
    const tid = Object.keys(league.teams)[1]! as TeamId;
    const team = league.teams[tid]!;
    const me = career.players[career.me]!;
    delete career.players[career.me];
    me.status = 'roster';
    me.contract = {
      id: `ct-${career.me}-fixture`, playerId: career.me, teamId: tid,
      years: [{ season: league.season, salary: 2_000_000, guaranteed: 2_000_000 }],
      kind: 'rookieScale', means: 'rookieScale',
      signedOn: { season: league.season, day: 0 }, birdYearsAtSigning: 0,
    } as FrPlayer['contract'];
    league.players[career.me] = me;
    team.roster.unshift(career.me);
    career.nbaTeam = tid;
    career.clock = { phase: 'nba', year: 2028, week: 39 };
    career.circuit = null;
    career.coach.name = team.coach.name; // ensureNbaCoach's postcondition
    league.phase = 'freeAgency' as typeof league.phase;
    // a veteran at my spot, so the room read has somebody real to name
    const vetId = team.roster.find(pid => pid !== career.me && league.players[pid])!;
    league.players[vetId]!.pos = me.pos;
    career.events.push({
      id: `ev-transaction-2028w38-${career.events.length}`,
      clock: { phase: 'draftPrep', year: 2028, week: 38 },
      kind: 'transaction',
      reason: 'drafted: round 1, pick 5, Fixture Team',
      delta: 5,
    });
    return tid;
  }

  it('the paper, the package, the room, and the camp door land across the gap', () => {
    const career = fixtureCareer();
    const tid = intoEntryGap(career);
    const spoke: number[] = [38]; // draft week: the existing burst owns it
    for (let w = 39; w <= 47; w++) {
      career.clock.week = w;
      if (w === 46) career.league.phase = 'camp' as typeof career.league.phase;
      if (pulse(career).length > 0) spoke.push(w);
    }
    expect(tagged(career, 'arc-nba-ppr-2028').length).toBe(1);
    expect(tagged(career, 'arc-nba-pkg-2028').length).toBe(1);
    expect(tagged(career, 'arc-nba-room-2028').length).toBe(1);
    expect(tagged(career, 'arc-nba-camp').length).toBe(1);
    let maxGap = 0;
    for (let i = 1; i < spoke.length; i++) maxGap = Math.max(maxGap, spoke[i]! - spoke[i - 1]!);
    expect(maxGap).toBeLessThanOrEqual(4);

    const paper = tagged(career, 'arc-nba-ppr-2028')[0]!;
    expect(paper.body.includes('$2,000,000')).toBe(true); // the real contract, not a vibe
    const room = tagged(career, 'arc-nba-room-2028')[0]!;
    const vet = career.league.players[career.league.teams[tid]!.roster.find(p => p !== career.me)!]!;
    expect(room.body.includes(vet.name)).toBe(true); // the actual depth chart, by name
  });

  it('a tenth-year camp is routine, not a beat: the door only opens near entry', () => {
    const career = fixtureCareer();
    intoEntryGap(career);
    career.clock = { phase: 'nba', year: 2029, week: 30 }; // 44 weeks past the draft tx
    career.league.phase = 'camp' as typeof career.league.phase;
    pulse(career);
    expect(tagged(career, 'arc-nba-camp').length).toBe(0);
  });
});

describe('the assignment choice (arc-focus)', () => {
  function assignmentMessage(career: CareerState): PhoneMessage {
    const msg: PhoneMessage = {
      id: 'ph-coach-#arc-exit-2026#-2026w27-0',
      clock: { ...career.clock },
      thread: 'coach', from: career.coach.name, body: 'exit meeting',
      choices: [
        { id: 'arc-focus:defense', label: 'Take the assignment (the defense)' },
        { id: 'arc-focus-keep', label: 'Keep your own program' },
      ],
    };
    career.phone.push(msg);
    return msg;
  }

  it('taking the assignment moves the standing focus, with the consequence explained', () => {
    const career = fixtureCareer();
    expect(career.weekPlan.focus).toBe('scoring');
    const msg = assignmentMessage(career);
    const r = applyPhoneChoice(career, msg.id, 'arc-focus:defense');
    expect(r.ok).toBe(true);
    expect(career.weekPlan.focus).toBe('defense');
    expect(msg.chosen).toBe('arc-focus:defense');
    const ev = career.events[career.events.length - 1]!;
    expect(ev.kind).toBe('dev');
    expect(ev.reason.includes('extra work moves to defense')).toBe(true);
  });

  it('keeping your own program mutates nothing and still explains itself', () => {
    const career = fixtureCareer();
    const msg = assignmentMessage(career);
    const r = applyPhoneChoice(career, msg.id, 'arc-focus-keep');
    expect(r.ok).toBe(true);
    expect(career.weekPlan.focus).toBe('scoring');
    const ev = career.events[career.events.length - 1]!;
    expect(ev.reason.includes('kept his own program')).toBe(true);
  });

  it('an unknown group is refused with nothing mutated (the polite-error contract)', () => {
    const career = fixtureCareer();
    const msg: PhoneMessage = {
      id: 'ph-coach-bogus', clock: { ...career.clock }, thread: 'coach',
      from: career.coach.name, body: 'x',
      choices: [{ id: 'arc-focus:vibes', label: 'nope' }],
    };
    career.phone.push(msg);
    const r = applyPhoneChoice(career, msg.id, 'arc-focus:vibes');
    expect(r.ok).toBe(false);
    expect(career.weekPlan.focus).toBe('scoring');
    expect(msg.chosen).toBe(undefined);
    expect(career.events.length).toBe(0);
  });
});

describe('determinism', () => {
  it('two identical careers walk the same offseason into byte-identical phones', () => {
    const walk = (): string => {
      const career = fixtureCareer();
      giveBoard(career, 2);
      intoOffseason(career);
      for (let w = 26; w <= 48; w++) {
        career.clock.week = w;
        pulse(career);
      }
      return JSON.stringify(career.phone);
    };
    expect(walk()).toBe(walk());
  });
});
