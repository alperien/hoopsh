/**
 * Genesis suite - createLeague and the people generators (people/gen.ts).
 * Shared-build pattern: create one league (plus its first draft class)
 * once, assert many (PLAYBOOK Recipe F).
 *
 * Provenance: these encode the genesis acceptance criteria from the build
 * brief (docs/FRANCHISE.md sections 5-7) - legal payroll structure at day
 * zero, a plausible age pyramid, ratings inside the engine's validation
 * bounds, and full determinism (a league is a pure function of its seed).
 */
import { describe, expect, it } from 'vitest';
import { ATTR_KEYS, TEND_KEYS } from '@hoopsh/data';
import { createLeague } from '../src/genesis.js';
import { generateDraftClass, generateCoach } from '../src/people/gen.js';
import { isFamousName } from '../src/people/names.js';
import { streamRng } from '../src/rng.js';
import { FRANCHISES } from '../src/teamdata.js';
import type { FrPlayer, League } from '../src/types.js';

const OPTS = { seed: 'genesis-suite', userTeam: 'cas' } as const;

/** Build once (league + first draft class); every describe below reads this. */
function build(): { league: League; prospects: FrPlayer[] } {
  const league = createLeague(OPTS);
  const prospects = generateDraftClass(league, league.season);
  return { league, prospects };
}

const { league, prospects } = build();
const teams = Object.values(league.teams);
const everyone = Object.values(league.players);
const rosterIds = teams.flatMap((t) => t.roster);
const lines = league.capLines[league.season]!;

/** This season's payroll for one team: standard-roster salaries only (two-ways are off the cap). */
function payrollOf(teamId: string): number {
  let sum = 0;
  for (const id of league.teams[teamId]!.roster) {
    const y = league.players[id]!.contract!.years.find((row) => row.season === league.season)!;
    sum += y.salary;
  }
  return sum;
}

describe('createLeague structure', () => {
  it('is deterministic: same seed and opts produce a deep-equal league and class', () => {
    const again = build();
    expect(JSON.stringify(again.league)).toBe(JSON.stringify(league));
    expect(JSON.stringify(again.prospects)).toBe(JSON.stringify(prospects));
  });

  it('rejects an unknown user team instead of building a broken league', () => {
    expect(() => createLeague({ seed: 'x', userTeam: 'not-a-team' })).toThrow();
  });

  it('fields all 30 franchises, 15 per conference, identities from teamdata', () => {
    expect(teams.length).toBe(30);
    expect(teams.filter((t) => t.conference === 'East').length).toBe(15);
    expect(teams.filter((t) => t.conference === 'West').length).toBe(15);
    for (const f of FRANCHISES) {
      const t = league.teams[f.id]!;
      expect(t.abbrev).toBe(f.abbrev);
      expect(t.division).toBe(f.division);
    }
  });

  it('starts at camp day zero with the spine lazy-init contract intact', () => {
    expect(league.phase).toBe('camp');
    expect(league.day).toBe(0);
    expect(league.calendar.length).toBe(0);
    expect(league.schedule.length).toBe(0);
    // live params ride the league (saves keep their calibration)
    expect(league.params.gen.draftPoolSize).toBe(prospects.length);
    expect(lines.minSalaryFloor).toBe(Math.round(league.params.cba.genesisCap * league.params.cba.minPayrollPctOfCap));
  });

  it('gives the user team a vacant GM chair and every AI team a persona', () => {
    for (const t of teams) {
      if (t.id === OPTS.userTeam) expect(t.gm).toBe(null);
      else expect(t.gm).toBeTruthy();
    }
  });
});

describe('genesis rosters', () => {
  it('carries 14-15 standard players and 0-2 two-ways per team, all healthy', () => {
    for (const t of teams) {
      expect(t.roster.length).toBeGreaterThanOrEqual(14);
      expect(t.roster.length).toBeLessThanOrEqual(15);
      expect(t.twoWay.length).toBeLessThanOrEqual(2);
      let healthy = 0;
      for (const id of t.roster) {
        const p = league.players[id]!;
        expect(p.status).toBe('roster');
        if (p.health.injury === null) healthy++;
      }
      // gameday needs eight dressable players; genesis starts everyone healthy
      expect(healthy).toBeGreaterThanOrEqual(8);
    }
  });

  it('names five distinct starters from the roster', () => {
    for (const t of teams) {
      expect(new Set(t.rotation.starters).size).toBe(5);
      for (const id of t.rotation.starters) expect(t.roster).toContain(id);
    }
  });

  it('holds its own first and second round picks seven drafts out', () => {
    for (const t of teams) {
      expect(t.picks.length).toBe(14);
      for (const pk of t.picks) {
        expect(pk.owner).toBe(t.id);
        expect(pk.originalTeam).toBe(t.id);
        expect(pk.id).toBe(`${pk.season}-r${pk.round}-${t.id}`);
      }
      const r1 = t.picks.filter((pk) => pk.round === 1);
      expect(r1.length).toBe(7);
      expect(r1.some((pk) => pk.season === league.season)).toBeTruthy();
    }
  });

  it('keeps the league age pyramid near the researched mean', () => {
    const ages = rosterIds.map((id) => league.season - league.players[id]!.bornSeason);
    const mean = ages.reduce((a, b) => a + b, 0) / ages.length;
    expect(Math.abs(mean - league.params.gen.genesisAgeMean)).toBeLessThan(1.5);
    for (const a of ages) {
      expect(a).toBeGreaterThanOrEqual(19);
      expect(a).toBeLessThanOrEqual(38);
    }
  });

  it('hires coaches with real identities and dials inside their design bands', () => {
    for (const t of teams) {
      expect(t.coach.devQuality).toBeGreaterThanOrEqual(30);
      expect(t.coach.devQuality).toBeLessThanOrEqual(90);
      expect(t.coach.obedience).toBeGreaterThanOrEqual(60);
      expect(t.coach.obedience).toBeLessThanOrEqual(95);
      expect(t.coach.hiredOn.season).toBe(league.season);
      expect(t.rotation.b2bRestBelow).toBe(league.params.rotation.b2bRestBelow);
    }
  });
});

describe('genesis cap sheets', () => {
  const payrolls = teams.map((t) => payrollOf(t.id));

  it('puts every team at or above the 90% payroll floor and none over the second apron', () => {
    for (const p of payrolls) {
      expect(p).toBeGreaterThanOrEqual(lines.minSalaryFloor);
      expect(p).toBeLessThanOrEqual(lines.apron2);
    }
  });

  it('opens with a plausible tax picture: 2-6 teams over the line', () => {
    const overTax = payrolls.filter((p) => p > lines.tax).length;
    expect(overTax).toBeGreaterThanOrEqual(2);
    expect(overTax).toBeLessThanOrEqual(6);
  });

  it('writes integer-dollar genesis contracts inside the max-salary rail', () => {
    for (const id of rosterIds) {
      const c = league.players[id]!.contract!;
      expect(c.means).toBe('genesis');
      expect(c.years.length).toBeGreaterThanOrEqual(1);
      expect(c.years.length).toBeLessThanOrEqual(4);
      expect(c.years[0]!.season).toBe(league.season);
      for (const y of c.years) {
        expect(Number.isInteger(y.salary)).toBeTruthy();
        expect(y.salary).toBeGreaterThan(0);
        // 35% of cap is the CBA's highest max tier; genesis never exceeds it
        expect(y.salary).toBeLessThanOrEqual(Math.round(lines.cap * 0.35 * 1.09)); // raises may compound above year one at up to ~8-9%
      }
      expect(c.years[0]!.salary).toBeLessThanOrEqual(Math.round(lines.cap * 0.35));
    }
  });

  it('prices the youngest on rookie-scale paper and two-ways on two-way paper', () => {
    let rookieDeals = 0;
    for (const id of rosterIds) {
      const p = league.players[id]!;
      const age = league.season - p.bornSeason;
      if (age <= 22) {
        expect(p.contract!.kind).toBe('rookieScale');
        rookieDeals++;
      } else {
        expect(p.contract!.kind).toBe('standard');
      }
    }
    expect(rookieDeals).toBeGreaterThan(0);
    for (const t of teams) {
      for (const id of t.twoWay) {
        expect(league.players[id]!.contract!.kind).toBe('twoWay');
      }
    }
  });
});

describe('generated people', () => {
  it('keeps every rating finite and inside 0-100, bodies inside engine bounds', () => {
    for (const p of everyone) {
      for (const k of ATTR_KEYS) {
        const v = p.attr[k];
        expect(Number.isFinite(v)).toBeTruthy();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      for (const k of TEND_KEYS) {
        const v = p.tend[k];
        expect(Number.isFinite(v)).toBeTruthy();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(p.heightIn).toBeGreaterThanOrEqual(60);
      expect(p.heightIn).toBeLessThanOrEqual(96);
      expect(p.wingspanIn).toBeGreaterThanOrEqual(p.heightIn - 1);
      for (const g of ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'] as const) {
        expect(p.potential[g]).toBeGreaterThanOrEqual(0);
        expect(p.potential[g]).toBeLessThanOrEqual(100);
      }
    }
  });

  it('never reuses an id or a name, and never prints a famous one', () => {
    const ids = everyone.map((p) => p.id);
    const names = everyone.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const id of ids) expect(/^p\d{4,}$/.test(id)).toBeTruthy();
    for (const n of names) expect(isFamousName(n)).toBe(false);
  });

  it('stocks a veteran free-agent market with clean rights', () => {
    expect(league.freeAgents.length).toBeGreaterThanOrEqual(40);
    expect(league.freeAgents.length).toBeLessThanOrEqual(80);
    for (const id of league.freeAgents) {
      const p = league.players[id]!;
      expect(p.status).toBe('freeAgent');
      expect(p.contract).toBe(null);
      expect(p.rights).toBe(null);
      expect(league.season - p.bornSeason).toBeGreaterThanOrEqual(24);
    }
  });

  it('couples usage appetite to roster standing: stars demand the ball, fringe players do not', () => {
    for (const t of teams) {
      const salaries = t.roster.map((id) => ({
        usage: league.players[id]!.tend.usage,
        salary: league.players[id]!.contract!.years[0]!.salary,
      }));
      const star = salaries.find((s) => s.salary >= 0.25 * lines.cap);
      if (star) expect(star.usage).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('draft class generation', () => {
  it('produces the full pool, registered on the league and returned', () => {
    expect(prospects.length).toBe(league.params.gen.draftPoolSize);
    expect(league.draftClass.length).toBe(prospects.length);
    for (const p of prospects) {
      expect(league.draftClass).toContain(p.id);
      expect(league.players[p.id]).toBeTruthy();
      expect(p.status).toBe('draftEligible');
      expect(p.contract).toBe(null);
      expect(p.draft).toBe(null);
    }
  });

  it('ages the class per the prospect mix: freshmen outnumber the true senior tail', () => {
    // Guard corrected at the #143 landing. The old form compared freshmen
    // to the WHOLE 22-plus bucket - a property the calibrated age mix
    // only holds ~70-75% of single-class seeds (measured: 6/20 fail on
    // unmodified main, 5/20 on the #143 branch). Real classes run
    // senior-heavy across the full pool while freshmen own the lottery
    // (the W79 register, gen.test.ts); the single-class form of that
    // truth is freshmen > the TRUE four-year tail (age 23), which holds
    // 20/20 scanned seeds on both sides of #143. The 20-class 2x version
    // lives in gen.test.ts; the eligibility window stays pinned here.
    const ages = prospects.map((p) => league.season - p.bornSeason);
    for (const a of ages) {
      expect(a).toBeGreaterThanOrEqual(19);
      expect(a).toBeLessThanOrEqual(23);
    }
    const freshmen = ages.filter((a) => a === 19).length;
    const tail = ages.filter((a) => a === 23).length;
    expect(freshmen).toBeGreaterThan(tail);
  });

  it('hits the international share exactly via the forced-kind quota', () => {
    const intl = prospects.filter((p) => p.origin === 'international').length;
    expect(intl).toBe(Math.round(league.params.gen.draftPoolSize * league.params.gen.intlShare));
  });

  it('gives prospects ceiling headroom that vets no longer have', () => {
    // a 19-year-old's ceiling sits above his raw current dials; a 30+ vet's
    // ceiling IS his current level (headroom near zero at 27+)
    let youngWithHeadroom = 0;
    let young = 0;
    for (const p of prospects) {
      if (league.season - p.bornSeason !== 19) continue;
      young++;
      const mean = (p.potential.scoring + p.potential.playmaking) / 2;
      const cur = (avgGroup(p, 'scoring') + avgGroup(p, 'playmaking')) / 2;
      if (mean > cur + 1) youngWithHeadroom++;
    }
    expect(young).toBeGreaterThan(0);
    expect(youngWithHeadroom).toBeGreaterThan(young * 0.5);
    for (const id of league.freeAgents) {
      const p = league.players[id]!;
      if (league.season - p.bornSeason < 30) continue;
      expect(p.potential.scoring).toBeLessThanOrEqual(Math.round(avgGroup(p, 'scoring')) + 1);
    }
  });
});

describe('coach generation', () => {
  it('is deterministic per stream and unique per sequence', () => {
    const a = generateCoach(streamRng('coach-seed', 'genesis'), 0);
    const b = generateCoach(streamRng('coach-seed', 'genesis'), 0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const rng = streamRng('coach-seed', 'genesis');
    const c0 = generateCoach(rng, 0);
    const c1 = generateCoach(rng, 1);
    expect(c0.id).not.toBe(c1.id);
  });
});

/** Mean of the attribute group backing one PotentialProfile entry (mirrors types.ts). */
function avgGroup(p: FrPlayer, g: 'scoring' | 'playmaking'): number {
  const keys = g === 'scoring'
    ? (['finishing', 'midRange', 'three', 'freeThrow', 'drawFoul'] as const)
    : (['ballHandle', 'passAcc', 'passVision'] as const);
  let sum = 0;
  for (const k of keys) sum += p.attr[k];
  return sum / keys.length;
}
