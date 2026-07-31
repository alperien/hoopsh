/**
 * Circuit tests: generation determinism, schedule shape, one engine-real
 * high school season played week by week through the job/fold seam, state
 * bracket propagation with controlled winners, season-row accumulation,
 * summaries, and a college generation sanity pass.
 *
 * COMPUTE BUDGET: engine games are the expensive part. This file plays
 * exactly ONE full HS regular slate engine-real (8 teams x 14 games / 2 =
 * 56 prep games, ~0.4s each, ~25s total; the bracket feeds hand-built
 * results for controlled winner propagation, the franchise postseason
 * test's pattern). Run once, assert many. Do not add a second full season.
 *
 * SIBLING REALITY (build wave): drives circuits.ts directly with
 * fixtureCareer + franchise simulateJobsInline; creation.ts / week.ts /
 * approach.ts stubs are never called.
 *
 * Score-band provenance: the brief estimated a 35-110 prep band; the
 * measured deterministic sample (seed 'career-fixture') spans 17-48 per
 * side, because quality-30 teenagers under the UNCALIBRATED prep pack
 * (docs/CAREER.md register C9; packs.ts header) shoot like teenagers.
 * The felt-loop fix's rotation sheet (minutes follow the role) shifted
 * my team's game trajectories and the same seed now bottoms at 14 (one
 * quality-24 side's cold night). The asserted 12-110 band brackets
 * today's reality and the C9 calibration arc's headroom; the floor still
 * proves a real basketball game broke out.
 */
import { describe, expect, it } from 'vitest';
import { simulateJobsInline, streamRng } from '@hoopsh/franchise';
import type { GameJob, GameJobResult, GameLine, TeamTotalsLite } from '@hoopsh/franchise';
import {
  applyCircuitResults, buildCircuit, circuitWeekJobs, seedBracket,
  shiftForApproach, summarizeCircuit,
} from '../src/circuits.js';
import { applyApproach } from '../src/approach.js';
import { fixtureCareer } from './fixture.js';

// the shared HS world: built once, played once, asserted many times
const CAREER = fixtureCareer();
const YEAR = CAREER.clock.year;
const HS = buildCircuit(CAREER, 'hs', streamRng(CAREER.seed, 'career-circuit', YEAR, 'hs'));
CAREER.circuit = HS;
const CP = CAREER.params.circuits;
const REGULAR_GAMES = (CP.hsTeams * CP.hsRegularGames) / 2; // 56: every pairing twice on an 8-team double round robin

// the shared college world: generation sanity plus the hand-fed postseason
// chain (conference tourney into the national at-large field)
const COLLEGE = fixtureCareer({ seed: 'career-college' });
const CONF = buildCircuit(COLLEGE, 'college', streamRng(COLLEGE.seed, 'career-circuit', COLLEGE.clock.year, 'college'));
COLLEGE.circuit = CONF;

/** Standings seed order, replicated from the module's documented tiebreak (wins, then differential, then points for, then index). */
function seedOrder(): number[] {
  return [...HS.standings]
    .sort((a, b) => b.w - a.w || (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || a.teamIdx - b.teamIdx)
    .map((s) => s.teamIdx);
}

/** Hand-built controlled result (the franchise postseason test's feedResult pattern). In bracket rounds the home side IS the higher seed by the hosting rule, so homeWins=true means the high seed advances. */
function fedResult(job: GameJob, homeWins: boolean): GameJobResult {
  const mkLines = (team: GameJob['home'], pts: number, diff: number): GameLine[] => {
    const per = Math.floor(pts / team.players.length);
    return team.players.map((p, i) => ({
      playerId: p.id, teamId: team.id, starter: team.starters.includes(p.id),
      min: i < 5 ? 28 : 12, // a tight bracket rotation: starters heavy, bench short
      pts: i === 0 ? pts - per * (team.players.length - 1) : per,
      fgm: 3, fga: 7, tpm: 0, tpa: 1, ftm: 1, fta: 2,
      orb: 1, drb: 2, ast: 1, stl: 0, blk: 0, tov: 1, pf: 2,
      plusMinus: diff,
    }));
  };
  const totals = (pts: number, diff: number): TeamTotalsLite => ({
    pts, fgm: 24, fga: 55, tpm: 3, tpa: 10, ftm: 9, fta: 12, orb: 8, drb: 18,
    ast: 12, stl: 5, blk: 2, tov: 10, pf: 14, pace: 62, fastbreakPts: 6,
    biggestLead: Math.max(diff, 0) + 4,
  });
  // 66-52: FEEL, a plausible prep/college bracket margin
  const [hp, ap] = homeWins ? [66, 52] : [52, 66];
  return {
    index: job.index, gameId: job.gameId, final: [hp, ap], ot: 0,
    lines: [...mkLines(job.home, hp, hp - ap), ...mkLines(job.away, ap, ap - hp)],
    totals: [totals(hp, hp - ap), totals(ap, ap - hp)],
    keyPlays: [],
  };
}

describe('buildCircuit: the high school circuit', () => {
  it('is deterministic: same seed, same stream, byte-identical circuit', () => {
    const again = fixtureCareer();
    const rebuilt = buildCircuit(again, 'hs', streamRng(again.seed, 'career-circuit', again.clock.year, 'hs'));
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(HS));
  });

  it('builds 8 schools on the prep pack with 8-man rosters stored in career.players', () => {
    expect(HS.teams.length).toBe(CP.hsTeams);
    expect(HS.packId).toBe('prep');
    expect(HS.year).toBe(YEAR);
    expect(HS.complete).toBe(false);
    for (const t of HS.teams) {
      expect(t.roster.length).toBe(8);
      expect(t.starters.length).toBe(5);
      for (const pid of t.roster) expect(Boolean(CAREER.players[pid])).toBe(true);
      for (const pid of t.starters) expect(t.roster).toContain(pid);
    }
    expect(HS.standings.length).toBe(CP.hsTeams);
  });

  it('places me on my team and the rival on the strongest OTHER school', () => {
    expect(HS.teams[HS.myTeamIdx]!.roster).toContain(CAREER.me);
    expect(HS.teams[HS.myTeamIdx]!.roster).not.toContain(CAREER.rivalId);
    const rivalTeamIdx = HS.teams.findIndex((t) => t.roster.includes(CAREER.rivalId));
    expect(rivalTeamIdx).toBeGreaterThanOrEqual(0);
    expect(rivalTeamIdx).not.toBe(HS.myTeamIdx);
    for (let i = 0; i < HS.teams.length; i++) {
      if (i === HS.myTeamIdx || i === rivalTeamIdx) continue;
      expect(HS.teams[rivalTeamIdx]!.quality).toBeGreaterThanOrEqual(HS.teams[i]!.quality);
    }
  });

  it('holds the quality and age bands: my modest supporting cast, teenage opponents', () => {
    expect(HS.teams[HS.myTeamIdx]!.quality).toBe(CP.myHsTeamQuality);
    for (let i = 0; i < HS.teams.length; i++) {
      if (i === HS.myTeamIdx) continue;
      // gaussian(hsQualityMean 30, sd 8) clamped to the 5-95 rails; 60 is
      // mean + 3.75 sd, beyond any plausible draw
      expect(HS.teams[i]!.quality).toBeGreaterThanOrEqual(5);
      expect(HS.teams[i]!.quality).toBeLessThanOrEqual(60);
    }
    for (const t of HS.teams) {
      for (const pid of t.roster) {
        if (pid === CAREER.me || pid === CAREER.rivalId) continue; // placed, not generated
        const age = YEAR - CAREER.players[pid]!.bornSeason;
        expect(age).toBeGreaterThanOrEqual(16);
        expect(age).toBeLessThanOrEqual(18);
      }
    }
  });

  it('starts the best five: no bench player out-rates a starter', () => {
    // plain attribute mean, the module's documented starter ordering
    const ability = (pid: string): number => {
      const attr = CAREER.players[pid]!.attr as unknown as Record<string, number>;
      const keys = Object.keys(attr);
      return keys.reduce((s, k) => s + attr[k]!, 0) / keys.length;
    };
    for (const t of HS.teams) {
      const starterMin = Math.min(...t.starters.map(ability));
      const bench = t.roster.filter((pid) => !t.starters.includes(pid));
      const benchMax = Math.max(...bench.map(ability));
      expect(starterMin).toBeGreaterThanOrEqual(benchMax);
    }
  });
});

describe('the schedule', () => {
  it('gives every school hsRegularGames within tolerance 1, weeks ascending from the season start', () => {
    const counts = new Map<number, number>();
    let lastWeek = -1;
    for (const g of HS.schedule) {
      counts.set(g.homeIdx, (counts.get(g.homeIdx) ?? 0) + 1);
      counts.set(g.awayIdx, (counts.get(g.awayIdx) ?? 0) + 1);
      expect(g.week).toBeGreaterThanOrEqual(lastWeek); // sorted ascending
      lastWeek = g.week;
      expect(g.type).toBe('regular');
    }
    expect(counts.size).toBe(CP.hsTeams);
    for (const c of counts.values()) {
      expect(c).toBeGreaterThanOrEqual(CP.hsRegularGames - 1);
      expect(c).toBeLessThanOrEqual(CP.hsRegularGames + 1);
    }
    expect(Math.min(...HS.schedule.map((g) => g.week))).toBe(CAREER.params.tick.hsSeasonStartWeek);
  });

  it('plays 1-2 games per team per week', () => {
    const perTeamWeek = new Map<string, number>();
    for (const g of HS.schedule) {
      for (const idx of [g.homeIdx, g.awayIdx]) {
        const key = `${idx}:${g.week}`;
        perTeamWeek.set(key, (perTeamWeek.get(key) ?? 0) + 1);
      }
    }
    for (const n of perTeamWeek.values()) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
  });
});

describe('circuitWeekJobs', () => {
  const firstWeek = Math.min(...HS.schedule.map((g) => g.week));
  const jobs = circuitWeekJobs(CAREER, firstWeek);

  it('builds one job per unplayed game, id-sorted, on the circuit pack and the registered seed stream', () => {
    expect(jobs.length).toBe(HS.schedule.filter((g) => g.week === firstWeek).length);
    for (let i = 0; i < jobs.length; i++) {
      expect(jobs[i]!.index).toBe(i);
      if (i > 0) expect(jobs[i - 1]!.gameId < jobs[i]!.gameId).toBe(true);
      expect(jobs[i]!.rules?.id).toBe('prep');
      expect(jobs[i]!.seed).toBe(`${CAREER.seed}:circuit:${jobs[i]!.gameId}`);
    }
  });

  it("keeps the full stream for MY games only: detail 'events' vs 'fold'", () => {
    const myId = HS.teams[HS.myTeamIdx]!.id;
    let mine = 0;
    for (const j of jobs) {
      const involvesMe = j.home.id === myId || j.away.id === myId;
      expect(j.detail).toBe(involvesMe ? 'events' : 'fold');
      if (involvesMe) mine += 1;
    }
    expect(mine).toBeGreaterThanOrEqual(1); // a round robin plays every team every round
  });

  it('projects my approach card through approach.ts, the one projection source', () => {
    const card = { assertiveness: 100, range: 50, motor: 50, defense: 50, playmaking: 100 };
    CAREER.nextApproach = card;
    const shifted = circuitWeekJobs(CAREER, firstWeek);
    const myTeamId = HS.teams[HS.myTeamIdx]!.id;
    const job = shifted.find((j) => j.home.id === myTeamId || j.away.id === myTeamId)!;
    const side = job.home.id === myTeamId ? job.home : job.away;
    const projectedMe = side.players.find((p) => p.id === CAREER.me)!;
    const canonical = applyApproach(CAREER.players[CAREER.me]!, card, CAREER.params);
    expect(projectedMe.tend).toEqual(canonical.tend); // byte-for-byte the canonical projection
    expect(projectedMe.attr).toEqual(canonical.attr); // the card never touches ability
    expect(projectedMe.tend.usage).toBeGreaterThan(CAREER.players[CAREER.me]!.tend.usage);
    // a teammate's identity is untouched by my card
    const mate = side.players.find((p) => p.id !== CAREER.me)!;
    expect(mate.tend).toEqual(CAREER.players[mate.id]!.tend);
    CAREER.nextApproach = null;
  });

  it('shiftForApproach is a no-op at the neutral card (50 = play your normal game)', () => {
    const base = CAREER.players[CAREER.me]!.tend;
    const neutral = shiftForApproach(base, CAREER.approach, CAREER.params);
    expect(neutral).toEqual(base);
  });
});

describe('minutes follow the role (the felt-loop projection)', () => {
  /** My team's projected job side for the first schedule week of a fresh world. */
  function myJobSide(career: ReturnType<typeof fixtureCareer>) {
    const circuit = career.circuit!;
    const myTeamId = circuit.teams[circuit.myTeamIdx]!.id;
    const week = Math.min(...circuit.schedule.map((g) => g.week));
    const jobs = circuitWeekJobs(career, week);
    const job = jobs.find((j) => j.home.id === myTeamId || j.away.id === myTeamId)!;
    return { mine: job.home.id === myTeamId ? job.home : job.away, other: job.home.id === myTeamId ? job.away : job.home };
  }

  function freshWorld(role: 'garbage' | 'bench' | 'rotation' | 'sixthMan' | 'starter' | 'featured' | 'franchise') {
    const career = fixtureCareer();
    career.circuit = buildCircuit(career, 'hs', streamRng(career.seed, 'career-circuit', career.clock.year, 'hs'));
    career.coach.role = role;
    return career;
  }

  it('a bench role watches the tip and carries a mop-up minutes line', () => {
    const career = freshWorld('garbage');
    const { mine } = myJobSide(career);
    expect(mine.starters).not.toContain(career.me);
    expect(mine.starters.length).toBe(5);
    // prep is a 32-minute game: the NBA-shaped table scales by 32/48,
    // written to the sheet at 0.1-minute precision
    const target = Math.round(Math.max(1, career.params.trust.minutesByRole.garbage * (32 / 48)) * 10) / 10;
    expect(mine.rotationMinutes?.[career.me]).toBe(target);
  });

  it('a starter role owns the tip; featured/franchise tilt the sheet further', () => {
    const starter = freshWorld('starter');
    const { mine: s } = myJobSide(starter);
    expect(s.starters).toContain(starter.me);
    const franchise = freshWorld('franchise');
    const { mine: f } = myJobSide(franchise);
    expect(f.starters).toContain(franchise.me);
    expect(f.rotationMinutes![franchise.me]!).toBeGreaterThan(s.rotationMinutes![starter.me]!);
    // the promotion ladder is monotone in the sheet
    const rotation = freshWorld('rotation');
    const { mine: r } = myJobSide(rotation);
    expect(r.starters).not.toContain(rotation.me);
    expect(s.rotationMinutes![starter.me]!).toBeGreaterThan(r.rotationMinutes![rotation.me]!);
  });

  it('the whole sheet is the coach s minutes budget: every dressed teammate has a line, five slots split', () => {
    const career = freshWorld('starter');
    const { mine, other } = myJobSide(career);
    const sheet = mine.rotationMinutes!;
    for (const p of mine.players) {
      expect(sheet[p.id]).toBeGreaterThan(0); // never a DNP-scratch 0 (engine semantics)
      expect(sheet[p.id]).toBeLessThanOrEqual(32);
    }
    const total = Object.values(sheet).reduce((s, m) => s + m, 0);
    expect(Math.abs(total - 32 * 5)).toBeLessThan(3); // gameMinutes x 5 slots, rounding tolerance
    expect(other.rotationMinutes).toBe(undefined); // opponents run the engine default
  });
});

describe('tired legs in the projection (energy on the floor)', () => {
  it('a 0-energy week dulls my projected attributes by the full debuff; a rested week is untouched', () => {
    const career = fixtureCareer();
    career.circuit = buildCircuit(career, 'hs', streamRng(career.seed, 'career-circuit', career.clock.year, 'hs'));
    const circuit = career.circuit;
    const myTeamId = circuit.teams[circuit.myTeamIdx]!.id;
    const week = Math.min(...circuit.schedule.map((g) => g.week));
    const meAt = (energy: number) => {
      career.energy = energy;
      const job = circuitWeekJobs(career, week).find((j) => j.home.id === myTeamId || j.away.id === myTeamId)!;
      const side = job.home.id === myTeamId ? job.home : job.away;
      return side.players.find((p) => p.id === career.me)!;
    };
    const rested = meAt(80);
    const empty = meAt(0);
    const base = career.players[career.me]!;
    const d = career.params.week.energyLegsDebuff;
    expect(rested.attr).toEqual(base.attr);
    expect(empty.attr.three).toBe(Math.max(0, base.attr.three - d));
    expect(empty.attr.speed).toBe(Math.max(0, base.attr.speed - d));
    expect(empty.tend).toEqual(rested.tend); // tired legs never change what I want
    career.energy = 80;
  });
});

describe('a full engine-real HS season', () => {
  it('plays the regular slate week by week through the job/fold seam', () => {
    const weeks = [...new Set(HS.schedule.map((g) => g.week))].sort((a, b) => a - b);
    for (const w of weeks) {
      const jobs = circuitWeekJobs(CAREER, w);
      applyCircuitResults(CAREER, simulateJobsInline(jobs));
    }
    expect(Object.keys(HS.results).length).toBe(REGULAR_GAMES);
    // a played week folds to nothing new: no unplayed games remain in it
    expect(circuitWeekJobs(CAREER, weeks[0]!).length).toBe(0);
  });

  it('lands prep finals in a plausible band with no ties (see the header provenance note)', () => {
    let violations = 0;
    for (const rec of Object.values(HS.results)) {
      for (const side of rec.final) {
        if (side < 12 || side > 110) violations += 1;
      }
      if (rec.final[0] === rec.final[1]) violations += 1; // the engine never ties
      if (rec.ot < 0) violations += 1;
    }
    expect(violations).toBe(0);
  });

  it('labels prep clocks as quarters and only OT-labels actual overtime (rules rode the job)', () => {
    let violations = 0;
    for (const rec of Object.values(HS.results)) {
      for (const kp of rec.keyPlays) {
        if (kp.clock.startsWith('H')) violations += 1; // halves are the NCAA pack, not prep
        if (kp.clock.startsWith('OT') && rec.ot < 1) violations += 1;
      }
    }
    expect(violations).toBe(0);
  });

  it('folds standings that account for every game', () => {
    let w = 0;
    let l = 0;
    for (const s of HS.standings) {
      w += s.w;
      l += s.l;
      expect(s.w + s.l).toBe(CP.hsRegularGames);
      expect(s.pf).toBeGreaterThan(0);
    }
    expect(w).toBe(REGULAR_GAMES);
    expect(l).toBe(REGULAR_GAMES);
  });

  it('rejects refolding a stored game (double-counted stats fail loud)', () => {
    const anyId = Object.keys(HS.results)[0]!;
    const rec = HS.results[anyId]!;
    let threw = false;
    try {
      applyCircuitResults(CAREER, [{
        index: 0, gameId: anyId, final: rec.final, ot: rec.ot,
        lines: rec.lines, totals: rec.totals, keyPlays: rec.keyPlays,
      }]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('the state bracket', () => {
  it('seeds all 8 schools reseeded by the table, high seed hosting', () => {
    seedBracket(CAREER, streamRng(CAREER.seed, 'career-circuit', YEAR, 'bracket'));
    expect(HS.bracket.length).toBe(4);
    const order = seedOrder();
    const lastRegWeek = Math.max(...HS.schedule.map((g) => g.week));
    for (let k = 0; k < 4; k++) {
      const g = HS.bracket[k]!;
      expect(g.round).toBe('QF');
      expect(g.type).toBe('bracket');
      expect(g.week).toBe(lastRegWeek + 1);
      expect(g.homeIdx).toBe(order[k]);      // best remaining hosts
      expect(g.awayIdx).toBe(order[7 - k]);  // worst remaining visits
    }
  });

  it('is idempotent: a second seeding call cannot duplicate the field', () => {
    seedBracket(CAREER, streamRng(CAREER.seed, 'career-circuit', YEAR, 'bracket'));
    expect(HS.bracket.length).toBe(4);
  });

  it('propagates winners round by round to a champion and completes the circuit', () => {
    const order = seedOrder();
    while (!HS.complete) {
      const pending = HS.bracket.filter((g) => !HS.results[g.id]);
      const week = Math.min(...pending.map((g) => g.week));
      const jobs = circuitWeekJobs(CAREER, week);
      applyCircuitResults(CAREER, jobs.map((j) => fedResult(j, true)));
    }
    expect(HS.bracket.length).toBe(7); // 4 QF + 2 SF + 1 F
    const final = HS.bracket.find((g) => g.round === 'F')!;
    expect(Boolean(final)).toBe(true);
    // home always won, and the bracket reseeds best-vs-worst, so the top
    // seed hosts every round and takes the title (the controlled pattern)
    expect(final.homeIdx).toBe(order[0]);
    expect(HS.complete).toBe(true);
  });
});

describe('season rows and the summary', () => {
  it('accumulates MY season rows: the critical contract for development, recruiting, and stock', () => {
    const myTeamId = HS.teams[HS.myTeamIdx]!.id;
    const rows = CAREER.players[CAREER.me]!.seasons.filter(
      (s) => s.season === YEAR && s.teamId === myTeamId && s.type === 'regular');
    expect(rows.length).toBe(1); // one row per season-team stint, bracket included
    const row = rows[0]!;
    let pts = 0;
    let played = 0;
    for (const rec of Object.values(HS.results)) {
      for (const line of rec.lines) {
        if (line.playerId !== CAREER.me) continue;
        pts += line.pts;
        if (line.min > 0) played += 1;
      }
    }
    expect(row.gp).toBeGreaterThan(0);
    expect(row.gp).toBe(played);
    expect(row.pts).toBe(pts); // the row is exactly the sum of my lines
  });

  it('summarizes the season: record, my line, a nonempty finish, honest honors', () => {
    const summary = summarizeCircuit(CAREER);
    const myTeamId = HS.teams[HS.myTeamIdx]!.id;
    const row = CAREER.players[CAREER.me]!.seasons.find(
      (s) => s.season === YEAR && s.teamId === myTeamId && s.type === 'regular')!;
    expect(summary.teamName).toBe(HS.teams[HS.myTeamIdx]!.name);
    expect(summary.w + summary.l).toBe(CP.hsRegularGames); // the table is the regular season
    expect(summary.myLine.gp).toBe(row.gp);
    expect(summary.myLine.pts).toBe(row.pts);
    expect(summary.finish.length).toBeGreaterThan(0);
    // an 8-team state bracket always contains my school, so the finish is
    // always a state outcome, champion or a named exit round
    expect(/^(state champion|lost the state (final|semifinal|quarterfinal))$/.test(summary.finish)).toBe(true);
    // honors cross-check against the stored records: leading my own team
    const teamPts = new Map<string, number>();
    for (const rec of Object.values(HS.results)) {
      for (const line of rec.lines) {
        if (line.teamId !== myTeamId) continue;
        teamPts.set(line.playerId, (teamPts.get(line.playerId) ?? 0) + line.pts);
      }
    }
    const myPts = teamPts.get(CAREER.me) ?? 0;
    const iLead = [...teamPts.values()].every((v) => v <= myPts);
    expect(summary.honors.includes('team leading scorer')).toBe(iLead);
  });
});

describe('buildCircuit: college sanity', () => {
  it('builds the 10-program conference on the NCAA pack with 10-man rosters', () => {
    expect(CONF.teams.length).toBe(CP.collegeConfTeams);
    expect(CONF.packId).toBe('ncaa');
    for (const t of CONF.teams) expect(t.roster.length).toBe(10);
  });

  it('defaults MY program to the mid tier when no commitment exists (fixture careers)', () => {
    expect(CONF.teams[CONF.myTeamIdx]!.quality).toBe(CP.collegeQualityByTier[1]);
    expect(CONF.teams[CONF.myTeamIdx]!.roster).toContain(COLLEGE.me);
  });

  it('fills conference rosters with college-age players and a full conference slate', () => {
    for (const t of CONF.teams) {
      for (const pid of t.roster) {
        if (pid === COLLEGE.me) continue;
        const age = COLLEGE.clock.year - COLLEGE.players[pid]!.bornSeason;
        expect(age).toBeGreaterThanOrEqual(18);
        expect(age).toBeLessThanOrEqual(22);
      }
    }
    const counts = new Map<number, number>();
    for (const g of CONF.schedule) {
      counts.set(g.homeIdx, (counts.get(g.homeIdx) ?? 0) + 1);
      counts.set(g.awayIdx, (counts.get(g.awayIdx) ?? 0) + 1);
    }
    for (const c of counts.values()) {
      expect(c).toBeGreaterThanOrEqual(CP.collegeConfGames - 1);
      expect(c).toBeLessThanOrEqual(CP.collegeConfGames + 1);
    }
  });
});

describe('the college postseason chain (hand-fed, no engine cost)', () => {
  // regular season fed so the LOWER team index always wins: the table then
  // orders strictly [0..9] with my program on top, making every later
  // pairing a deterministic structural fact rather than an rng artifact
  const idxOf = (teamId: string): number => CONF.teams.findIndex((t) => t.id === teamId);

  it('finishes the regular slate and opens the conference tourney with the 7v10 / 8v9 night', () => {
    const weeks = [...new Set(CONF.schedule.map((g) => g.week))].sort((a, b) => a - b);
    for (const w of weeks) {
      const jobs = circuitWeekJobs(COLLEGE, w);
      applyCircuitResults(COLLEGE, jobs.map((j) => fedResult(j, idxOf(j.home.id) < idxOf(j.away.id))));
    }
    expect(Object.keys(CONF.results).length).toBe((CP.collegeConfTeams * CP.collegeConfGames) / 2);
    seedBracket(COLLEGE, streamRng(COLLEGE.seed, 'career-circuit', COLLEGE.clock.year, 'bracket'));
    // 10 is not a power of two: seeds 7-10 play a 2-game play-in round
    expect(CONF.bracket.length).toBe(2);
    for (const g of CONF.bracket) {
      expect(g.type).toBe('confTourney');
      expect(g.round).toBe('R1');
    }
    expect(CONF.bracket[0]!.homeIdx).toBe(6); // seed 7 hosts seed 10
    expect(CONF.bracket[0]!.awayIdx).toBe(9);
    expect(CONF.bracket[1]!.homeIdx).toBe(7); // seed 8 hosts seed 9
    expect(CONF.bracket[1]!.awayIdx).toBe(8);
  });

  it('hands the conference final off to a generated national field and plays to completion', () => {
    while (!CONF.complete) {
      const pending = CONF.bracket.filter((g) => !CONF.results[g.id]);
      const week = Math.min(...pending.map((g) => g.week));
      const jobs = circuitWeekJobs(COLLEGE, week);
      // high seed hosts every bracket round, so homeWins walks the chalk
      applyCircuitResults(COLLEGE, jobs.map((j) => fedResult(j, true)));
    }
    const confGames = CONF.bracket.filter((g) => g.type === 'confTourney');
    const natGames = CONF.bracket.filter((g) => g.type === 'bracket');
    expect(confGames.length).toBe(9);  // R1 2 + QF 4 + SF 2 + F 1
    expect(natGames.length).toBe(15);  // R16 8 + QF 4 + SF 2 + F 1
    // the invited field: 15 fresh at-large programs appended with zero table rows
    expect(CONF.teams.length).toBe(CP.collegeConfTeams + CP.nationalBracketTeams - 1);
    expect(CONF.standings.length).toBe(CONF.teams.length);
    let atLargeGames = 0;
    for (const s of CONF.standings) {
      if (s.teamIdx >= CP.collegeConfTeams) atLargeGames += s.w + s.l;
    }
    expect(atLargeGames).toBe(0); // bracket games never fold the table
    // the conference champion draws the FEEL 3 line, so I host my R16 game
    const myR16 = natGames.find((g) => g.round === 'R16' && (g.homeIdx === 0 || g.awayIdx === 0))!;
    expect(myR16.homeIdx).toBe(0);
    expect(CONF.complete).toBe(true);
  });

  it('summarizes the run: conference champion falls in the national semifinal, by construction', () => {
    // chalk walk: as the 3 line I win R16 and the QF, then visit the 2 seed
    // in the semifinal, where the home side (the higher seed) wins
    const summary = summarizeCircuit(COLLEGE);
    expect(summary.finish).toBe('lost the national semifinal');
    expect(summary.kind).toBe('college');
    expect(summary.teamName).toBe(CONF.teams[0]!.name);
    expect(summary.w).toBe(CP.collegeConfGames); // lower index won every regular game
    expect(summary.myLine.gp).toBeGreaterThan(0);
  });
});
