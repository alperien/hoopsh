/**
 * Psyche-layer tests (people/psyche.ts + its couplings into
 * disposition.ts and dev.ts): lazy init idempotence, determinism, bounded
 * on-court effects, professionalism damping, chemistry churn decay and
 * pace, morale coupling direction, dev spillover bounds, lifestyle
 * effects, and the style law (no em dashes in user-facing copy).
 * Scenarios are hand-built on the shared fixtureLeague like people.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type {
  FrPlayer, GameLine, GameRecord, League, PlayerSeasonRow, TeamTotalsLite,
} from '../src/types.js';
import { fixtureLeague } from './fixture.js';
import {
  CHEM_BASE, CONF_BASE, LIFESTYLE_KEYS, PSYCHE_OFFENSE_KEYS,
  assignLifestyle, chemDevFactor, chemistryTargetFor, confidencePhrase,
  confidenceTargetFor, defaultPsycheParams, driftedProneness, initPsyche,
  lifestyleFatigueFactor, lifestyleMoraleDelta, lifestyleNews,
  lifestylePhrase, playerPsyche, psycheAttrShift, teamChemistry,
  teamChemistryFor, updatePsyche,
} from '../src/people/psyche.js';
import type { PlayerPsyche, TeamPsyche } from '../src/people/psyche.js';
import { moraleFor } from '../src/people/disposition.js';
import { agingGraceFor, applyAging, reviewPlayerDevelopment, ATTR_GROUPS } from '../src/people/dev.js';
import type { AttrGroup } from '../src/types.js';
import { defaultFranchiseParams } from '../src/params.js';

// ---------------------------------------------------------------------------
// scenario helpers

type PsyPlayer = FrPlayer & { psyche?: PlayerPsyche };
type PsyTeam = League['teams'][string] & { psyche?: TeamPsyche };

function seasonRow(
  season: number, teamId: string,
  x: { min: number; gp: number; pts: number; fgm: number; fga: number; tpm: number },
): PlayerSeasonRow {
  return {
    season, teamId, type: 'regular', gp: x.gp, gs: x.gp, min: x.min,
    pts: x.pts, fgm: x.fgm, fga: x.fga, tpm: x.tpm, tpa: x.tpm * 2,
    ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0,
  };
}

function gameLine(
  playerId: string, teamId: string,
  x: { min: number; pts: number; fgm: number; fga: number; tpm: number },
): GameLine {
  return {
    playerId, teamId, starter: true, min: x.min,
    pts: x.pts, fgm: x.fgm, fga: x.fga, tpm: x.tpm, tpa: x.tpm * 2,
    ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0,
  };
}

function zeroTotals(): TeamTotalsLite {
  return {
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0,
    ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pace: 0, fastbreakPts: 0, biggestLead: 0,
  };
}

function addResult(league: League, day: number, lines: GameLine[]): void {
  const tids = Object.keys(league.teams).sort();
  const id = `s${league.season}-d${day}-${tids[1]}@${tids[0]}`;
  const existing = league.results[id];
  if (existing) {
    // one shared record per fixture day: fabricating form for a second
    // player merges his lines instead of erasing the first player's
    existing.lines.push(...lines);
    return;
  }
  const rec: GameRecord = {
    id, date: { season: league.season, day },
    type: 'regular', home: tids[0]!, away: tids[1]!, seed: 'psyche-test',
    final: [100, 90], ot: 0, lines, totals: [zeroTotals(), zeroTotals()], keyPlays: [],
  };
  league.results[id] = rec;
}

/** Baseline season: 25 mpg, 14.4 pts/36, .500 eFG. */
const BASELINE = { min: 1000, gp: 40, pts: 400, fgm: 160, fga: 360, tpm: 40 };
/** A hot recent game: 30 min, 30 pts/36 pace, .66 eFG. */
const HOT_GAME = { min: 30, pts: 25, fgm: 9, fga: 16, tpm: 3 };
/** A cold recent game: 18 min, 8 pts/36 pace, .20 eFG. */
const COLD_GAME = { min: 18, pts: 4, fgm: 2, fga: 10, tpm: 0 };

/** Give a player a baseline season plus five recent games of the given shape. */
function fabricateForm(league: League, playerId: string, game: typeof HOT_GAME): void {
  const player = league.players[playerId]!;
  const teamId = player.contract!.teamId;
  player.seasons.push(seasonRow(league.season, teamId, BASELINE));
  for (let day = 1; day <= 5; day++) addResult(league, day, [gameLine(playerId, teamId, game)]);
}

// ---------------------------------------------------------------------------
// lazy init

describe('initPsyche (lazy init)', () => {
  it('fills confidence at the neutral baseline and a lifestyle from the label set, for every non-retired player', () => {
    const league = fixtureLeague();
    initPsyche(league);
    for (const player of Object.values(league.players)) {
      const psy = playerPsyche(player)!;
      expect(psy.confidence).toBe(CONF_BASE);
      expect(LIFESTYLE_KEYS).toContain(psy.lifestyle);
    }
    for (const team of Object.values(league.teams)) {
      expect(teamChemistry(team)).toBe(CHEM_BASE);
      // current roster seeds as settled: no phantom churn on genesis/old saves
      const psy = (team as PsyTeam).psyche!;
      for (const pid of team.roster) expect(psy.tenureDays[pid]!).toBeGreaterThanOrEqual(60);
    }
  });

  it('is idempotent: calling initPsyche twice changes nothing', () => {
    const league = fixtureLeague();
    initPsyche(league);
    const once = JSON.stringify(league);
    initPsyche(league);
    expect(JSON.stringify(league)).toBe(once);
  });

  it('assigns lifestyles deterministically from the seed and leans on the disposition axes', () => {
    const a = fixtureLeague();
    const b = fixtureLeague();
    initPsyche(a);
    initPsyche(b);
    for (const id of Object.keys(a.players)) {
      expect(playerPsyche(a.players[id]!)!.lifestyle).toBe(playerPsyche(b.players[id]!)!.lifestyle);
    }
    // axes lead: a maxed-out night-owl profile cannot roll gym rat
    const p = a.players[Object.keys(a.players).sort()[0]!]!;
    p.disposition = { ambition: 50, loyalty: 10, professionalism: 0, marketPref: 100 };
    p.workEthic = 0;
    const label = assignLifestyle(a.seed, p);
    expect(['nightlife', 'mediaDarling']).toContain(label);
  });
});

// ---------------------------------------------------------------------------
// the weekly step

describe('updatePsyche (weekly pulse)', () => {
  it('is deterministic: the same league state steps to the same psyche state', () => {
    const build = (): League => {
      const league = fixtureLeague();
      const team = league.teams[league.userTeam]!;
      fabricateForm(league, team.roster[0]!, HOT_GAME);
      fabricateForm(league, team.roster[1]!, COLD_GAME);
      return league;
    };
    const a = build();
    const b = build();
    for (let week = 0; week < 3; week++) {
      a.day = b.day = week * 7;
      updatePsyche(a);
      updatePsyche(b);
    }
    expect(JSON.stringify(a.players)).toBe(JSON.stringify(b.players));
    expect(JSON.stringify(a.teams)).toBe(JSON.stringify(b.teams));
  });

  it('is idempotent per day: a re-entered day moves nothing twice', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    fabricateForm(league, team.roster[0]!, HOT_GAME);
    league.day = 7;
    updatePsyche(league);
    const once = JSON.stringify(league);
    updatePsyche(league);
    expect(JSON.stringify(league)).toBe(once);
  });

  it('bounds the step: confidence moves at most confStep per update, no teleporting', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    const hotId = team.roster[0]!;
    fabricateForm(league, hotId, HOT_GAME);
    updatePsyche(league);
    const conf = playerPsyche(league.players[hotId]!)!.confidence;
    const target = confidenceTargetFor(league, team, league.players[hotId]!);
    expect(target).toBeGreaterThan(CONF_BASE + defaultPsycheParams().confStep); // the shock is real
    expect(conf - CONF_BASE).toBeLessThanOrEqual(defaultPsycheParams().confStep);
    expect(conf).toBeGreaterThan(CONF_BASE); // and it moved toward it
  });

  it('chemistry moves slower than confidence under same-size shocks', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    const hotId = team.roster[0]!;
    fabricateForm(league, hotId, HOT_GAME);
    initPsyche(league);
    // force both stored values equally far from their targets
    (team as PsyTeam).psyche!.chemistry = 20;
    (league.players[hotId] as PsyPlayer).psyche!.confidence = 20;
    updatePsyche(league);
    const chemMoved = teamChemistry(team)! - 20;
    const confMoved = playerPsyche(league.players[hotId]!)!.confidence - 20;
    expect(chemMoved).toBeLessThanOrEqual(defaultPsycheParams().chemStep);
    expect(confMoved).toBeLessThanOrEqual(defaultPsycheParams().confStep);
    expect(chemMoved).toBeLessThan(confMoved);
  });

  it('keeps a stable room still: fixture baseline recomputes to the baseline, no oscillation', () => {
    const league = fixtureLeague();
    for (let week = 0; week < 6; week++) {
      league.day = week * 7;
      updatePsyche(league);
      for (const team of Object.values(league.teams)) {
        expect(teamChemistry(team)).toBe(CHEM_BASE); // quiet by design
      }
    }
  });
});

// ---------------------------------------------------------------------------
// confidence math

describe('confidence target (pure recompute)', () => {
  it('professionalism damps swings: a pro-90 player moves less than a pro-20 player under the same shocks', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    const proId = team.roster[0]!;
    const volatileId = team.roster[1]!;
    for (const [id, prof] of [[proId, 90], [volatileId, 20]] as const) {
      const p = league.players[id]!;
      p.disposition.professionalism = prof;
      p.disposition.ambition = 50;
    }
    fabricateForm(league, proId, HOT_GAME);
    fabricateForm(league, volatileId, HOT_GAME);

    const proUp = confidenceTargetFor(league, team, league.players[proId]!) - CONF_BASE;
    const volUp = confidenceTargetFor(league, team, league.players[volatileId]!) - CONF_BASE;
    expect(proUp).toBeGreaterThan(0);
    expect(proUp).toBeLessThan(volUp);

    // same property on the downside: swap in cold games
    const league2 = fixtureLeague();
    const team2 = league2.teams[league2.userTeam]!;
    for (const [id, prof] of [[proId, 90], [volatileId, 20]] as const) {
      const p = league2.players[id]!;
      p.disposition.professionalism = prof;
      p.disposition.ambition = 50;
    }
    fabricateForm(league2, proId, COLD_GAME);
    fabricateForm(league2, volatileId, COLD_GAME);
    const proDown = CONF_BASE - confidenceTargetFor(league2, team2, league2.players[proId]!);
    const volDown = CONF_BASE - confidenceTargetFor(league2, team2, league2.players[volatileId]!);
    expect(proDown).toBeGreaterThan(0);
    expect(proDown).toBeLessThan(volDown);

    // the measurable damping guard: swing spread (up + down) is smaller for the pro
    expect(proUp + proDown).toBeLessThan(volUp + volDown);
  });

  it('ambition amplifies both directions', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    const alphaId = team.roster[0]!;
    const soldierId = team.roster[1]!;
    for (const [id, amb] of [[alphaId, 90], [soldierId, 20]] as const) {
      const p = league.players[id]!;
      p.disposition.ambition = amb;
      p.disposition.professionalism = 50;
    }
    fabricateForm(league, alphaId, HOT_GAME);
    fabricateForm(league, soldierId, HOT_GAME);
    const alphaUp = confidenceTargetFor(league, team, league.players[alphaId]!) - CONF_BASE;
    const soldierUp = confidenceTargetFor(league, team, league.players[soldierId]!) - CONF_BASE;
    expect(alphaUp).toBeGreaterThan(soldierUp);
  });

  it('is quiet before the season has shape: no rows, no results, target sits at the baseline', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    for (const pid of team.roster) {
      expect(confidenceTargetFor(league, team, league.players[pid]!)).toBe(CONF_BASE);
    }
  });

  it('stays inside 0-100 and integer for extreme inputs', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    const id = team.roster[0]!;
    const p = league.players[id]!;
    p.disposition.ambition = 100;
    p.disposition.professionalism = 0;
    p.morale = 0;
    fabricateForm(league, id, COLD_GAME);
    league.standings[team.id] = {
      teamId: team.id, w: 0, l: 20, homeW: 0, homeL: 10, awayW: 0, awayL: 10,
      confW: 0, confL: 12, divW: 0, divL: 4, ptsFor: 1800, ptsAgainst: 2400,
      streak: -20, last10: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const target = confidenceTargetFor(league, team, p);
    expect(Number.isInteger(target)).toBe(true);
    expect(target).toBeGreaterThanOrEqual(0);
    expect(target).toBeLessThan(CONF_BASE);
  });
});

// ---------------------------------------------------------------------------
// chemistry math

describe('chemistry target (pure recompute)', () => {
  it('roster churn drags the room and time together heals it', () => {
    const league = fixtureLeague();
    initPsyche(league);
    const tids = Object.keys(league.teams).sort();
    const settled = league.teams[tids[0]!]!;
    const churned = league.teams[tids[1]!]!;
    const churnedPsy = (churned as PsyTeam).psyche!;
    for (const pid of churned.roster) churnedPsy.tenureDays[pid] = 0; // five trades landed yesterday, so to speak
    const settledTarget = chemistryTargetFor(league, settled);
    const churnedTarget = chemistryTargetFor(league, churned);
    expect(churnedTarget).toBeLessThan(settledTarget);

    // decay property: the drag fades monotonically as tenure grows
    let prev = churnedTarget;
    for (const tenure of [15, 30, 45, 60]) {
      for (const pid of churned.roster) churnedPsy.tenureDays[pid] = tenure;
      const t = chemistryTargetFor(league, churned);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(prev).toBe(settledTarget); // fully healed at BOND_DAYS
  });

  it('heals through the weekly pulse: a churned room dips, then recovers, without oscillating', () => {
    const league = fixtureLeague();
    initPsyche(league);
    const team = league.teams[league.userTeam]!;
    const psy = (team as PsyTeam).psyche!;
    for (const pid of team.roster) psy.tenureDays[pid] = 0;
    const series: number[] = [];
    for (let week = 0; week < 14; week++) {
      league.day = week * 7;
      updatePsyche(league);
      series.push(teamChemistry(team)!);
    }
    const low = Math.min(...series);
    expect(low).toBeLessThanOrEqual(CHEM_BASE - 5); // the dip is visible
    expect(series[series.length - 1]!).toBeGreaterThanOrEqual(CHEM_BASE - 1); // and it heals
    // no oscillation: once recovery starts, the series never falls back by more than the deadband
    const lowAt = series.indexOf(low);
    for (let i = lowAt; i + 1 < series.length; i++) {
      expect(series[i + 1]!).toBeGreaterThanOrEqual(series[i]! - 1);
    }
  });

  it('a new arrival enters the bond map at zero (trades reset bonds)', () => {
    const league = fixtureLeague();
    league.day = 0;
    updatePsyche(league);
    const tids = Object.keys(league.teams).sort();
    const a = league.teams[tids[0]!]!;
    const b = league.teams[tids[1]!]!;
    const moved = b.roster[0]!;
    b.roster = b.roster.filter((id) => id !== moved);
    a.roster = [...a.roster, moved];
    league.day = 7;
    updatePsyche(league);
    const psyA = (a as PsyTeam).psyche!;
    expect(psyA.tenureDays[moved]).toBe(0);
    expect((b as PsyTeam).psyche!.tenureDays[moved]).toBe(undefined); // pruned from the old room
  });

  it('professionalism mix and the record move the target in the right directions, bounded', () => {
    const league = fixtureLeague();
    initPsyche(league);
    const team = league.teams[league.userTeam]!;
    for (const pid of team.roster) league.players[pid]!.disposition.professionalism = 95;
    league.standings[team.id] = {
      teamId: team.id, w: 18, l: 2, homeW: 9, homeL: 1, awayW: 9, awayL: 1,
      confW: 10, confL: 1, divW: 4, divL: 0, ptsFor: 2300, ptsAgainst: 2000,
      streak: 8, last10: [1, 1, 1, 1, 1, 1, 1, 1, 0, 1],
    };
    const good = chemistryTargetFor(league, team);
    expect(good).toBeGreaterThan(CHEM_BASE);
    expect(good).toBeLessThanOrEqual(100);

    for (const pid of team.roster) {
      league.players[pid]!.disposition.professionalism = 10;
      league.players[pid]!.disposition.ambition = 90;
      league.players[pid]!.seasons.push(seasonRow(league.season, team.id, { min: 150, gp: 10, pts: 50, fgm: 20, fga: 50, tpm: 5 }));
    }
    league.standings[team.id]!.w = 2;
    league.standings[team.id]!.l = 18;
    const bad = chemistryTargetFor(league, team);
    expect(bad).toBeLessThan(CHEM_BASE);
    expect(bad).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// the on-court seam (register F1-A)

describe('psycheAttrShift (pre-degrade seam)', () => {
  it('never exceeds the hard caps, in either direction, for any state', () => {
    const league = fixtureLeague();
    initPsyche(league);
    const params = defaultPsycheParams();
    const team = league.teams[league.userTeam]!;
    const player = league.players[team.roster[0]!] as PsyPlayer;
    const teamPsy = (team as PsyTeam).psyche!;

    for (const conf of [0, 10, 50, 90, 100]) {
      for (const chem of [0, 20, 60, 90, 100]) {
        player.psyche!.confidence = conf;
        teamPsy.chemistry = chem;
        const shift = psycheAttrShift(league, team, player);
        expect(Number.isFinite(shift)).toBe(true);
        expect(Math.abs(shift)).toBeLessThanOrEqual(params.confAttrCap + params.chemAttrCap);
      }
    }
    // component caps: isolate each
    player.psyche!.confidence = 100;
    teamPsy.chemistry = CHEM_BASE;
    expect(psycheAttrShift(league, team, player)).toBe(params.confAttrCap);
    player.psyche!.confidence = 0;
    expect(psycheAttrShift(league, team, player)).toBe(-params.confAttrCap);
    player.psyche!.confidence = CONF_BASE;
    teamPsy.chemistry = 100;
    expect(psycheAttrShift(league, team, player)).toBe(params.chemAttrCap);
    teamPsy.chemistry = 0;
    expect(psycheAttrShift(league, team, player)).toBe(-params.chemAttrCap);
  });

  it('reads missing psyche state as exactly zero (old saves, mid-day draftees)', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    const player = league.players[team.roster[0]!]!;
    expect(psycheAttrShift(league, team, player)).toBe(0);
  });

  it('is integer-safe through the projection rounding pass', () => {
    const league = fixtureLeague();
    initPsyche(league);
    const team = league.teams[league.userTeam]!;
    const player = league.players[team.roster[0]!] as PsyPlayer;
    player.psyche!.confidence = 100;
    (team as PsyTeam).psyche!.chemistry = 100;
    const shift = psycheAttrShift(league, team, player);
    for (const k of PSYCHE_OFFENSE_KEYS) {
      const projected = Math.max(0, Math.round(player.attr[k] + shift));
      expect(Number.isInteger(projected)).toBe(true);
      expect(projected).toBeGreaterThanOrEqual(0);
      expect(projected).toBeLessThanOrEqual(103); // 100-rated dial + 2.5 cap, pre-engine-clamp headroom is bounded
    }
  });
});

// ---------------------------------------------------------------------------
// couplings: morale and development

describe('morale coupling (disposition.ts)', () => {
  it('a better room lifts morale, a sour one drags it, both modestly', () => {
    const league = fixtureLeague();
    initPsyche(league);
    const team = league.teams[league.userTeam]!;
    const player = league.players[team.roster[0]!]!;
    const teamPsy = (team as PsyTeam).psyche!;
    teamPsy.chemistry = 100;
    const high = moraleFor(league, player);
    teamPsy.chemistry = 20;
    const low = moraleFor(league, player);
    expect(high).toBeGreaterThan(low);
    expect(high - low).toBeLessThanOrEqual(6); // 2 x the +-3 cap, before damping
  });

  it('no psyche state means exactly the pre-psyche baseline (register F1 behavior preserved)', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    for (const pid of team.roster) {
      expect(moraleFor(league, league.players[pid]!)).toBe(70);
    }
  });
});

describe('development spillover (dev.ts)', () => {
  it('chemDevFactor is bounded 0.95-1.05 and neutral on null', () => {
    expect(chemDevFactor(null)).toBe(1);
    for (const chem of [0, 10, 20, 60, 90, 100]) {
      const f = chemDevFactor(chem);
      expect(f).toBeGreaterThanOrEqual(0.95);
      expect(f).toBeLessThanOrEqual(1.05);
    }
    expect(chemDevFactor(100)).toBe(1.05);
    expect(chemDevFactor(20)).toBe(0.95);
    expect(chemDevFactor(CHEM_BASE)).toBe(1);
  });

  it('a good room grows a young player faster than a sour one, same dice', () => {
    const params = defaultFranchiseParams();
    const grow = (chemistry: number): number => {
      const league = fixtureLeague();
      const team = league.teams[league.userTeam]!;
      const id = team.roster[0]!;
      const p = league.players[id]!;
      p.bornSeason = league.season - 21;
      for (const g of Object.keys(ATTR_GROUPS) as AttrGroup[]) {
        for (const k of ATTR_GROUPS[g]) p.attr[k] = 60;
        p.potential[g] = 90;
      }
      p.seasons.push(seasonRow(league.season, team.id, { min: 2400, gp: 70, pts: 900, fgm: 350, fga: 800, tpm: 80 }));
      reviewPlayerDevelopment(p, {
        seed: league.seed, season: league.season, day: 0, when: 'offseason',
        coachDev: 50, chemistry, dev: params.dev, aging: params.aging,
      });
      let sum = 0;
      for (const g of Object.keys(ATTR_GROUPS) as AttrGroup[]) {
        for (const k of ATTR_GROUPS[g]) sum += p.attr[k];
      }
      return sum;
    };
    const good = grow(100);
    const bad = grow(20);
    expect(good).toBeGreaterThan(bad);
    expect(good - bad).toBeLessThanOrEqual(8); // a tailwind, never a cheat code
  });
});

// ---------------------------------------------------------------------------
// lifestyle effects

describe('lifestyle (assignment and effects)', () => {
  it('fatigue factors stay inside 0.85-1.15 for every label, neutral when unassigned', () => {
    const league = fixtureLeague();
    const player = Object.values(league.players)[0] as PsyPlayer;
    expect(lifestyleFatigueFactor(player)).toBe(1);
    for (const lifestyle of LIFESTYLE_KEYS) {
      player.psyche = { confidence: 50, lifestyle };
      const f = lifestyleFatigueFactor(player);
      expect(f).toBeGreaterThanOrEqual(0.85);
      expect(f).toBeLessThanOrEqual(1.15);
    }
  });

  it('proneness drifts at most one point per season and clamps at 5 and 95', () => {
    const league = fixtureLeague();
    const player = Object.values(league.players)[0] as PsyPlayer;
    player.health.proneness = 50;
    expect(driftedProneness(player)).toBe(50); // unassigned: no drift

    player.psyche = { confidence: 50, lifestyle: 'nightlife' };
    expect(driftedProneness(player)).toBe(51);
    player.health.proneness = 95;
    expect(driftedProneness(player)).toBe(95); // clamp top

    player.psyche = { confidence: 50, lifestyle: 'gymRat' };
    player.health.proneness = 6;
    expect(driftedProneness(player)).toBe(5);
    player.health.proneness = 5;
    expect(driftedProneness(player)).toBe(5); // clamp bottom
  });

  it('applyAging applies the drift once per rollover through the lifestyle', () => {
    const league = fixtureLeague();
    const team = league.teams[league.userTeam]!;
    const player = league.players[team.roster[0]!] as PsyPlayer;
    player.psyche = { confidence: 50, lifestyle: 'nightlife' };
    player.health.proneness = 50;
    applyAging(league);
    expect(player.health.proneness).toBe(51);
  });

  it('morale texture is at most one point either way', () => {
    const league = fixtureLeague();
    const player = Object.values(league.players)[0] as PsyPlayer;
    expect(lifestyleMoraleDelta(player)).toBe(0);
    for (const lifestyle of LIFESTYLE_KEYS) {
      player.psyche = { confidence: 50, lifestyle };
      expect(Math.abs(lifestyleMoraleDelta(player))).toBeLessThanOrEqual(1);
    }
  });

  it('the news beat is rare, deterministic, and wire-weight only', () => {
    const run = (): number => {
      const league = fixtureLeague();
      league.phase = 'regular';
      initPsyche(league);
      let count = 0;
      for (let day = 0; day < 200; day++) {
        league.day = day;
        const items = lifestyleNews(league);
        expect(items.length).toBeLessThanOrEqual(1); // never more than one a day
        for (const item of items) {
          expect(item.weight).toBe(1);
          expect(item.players.length).toBe(1);
          expect(item.teams.length).toBe(1);
          expect(item.headline.length).toBeGreaterThan(0);
        }
        count += items.length;
      }
      return count;
    };
    const a = run();
    expect(a).toBeLessThanOrEqual(14); // a few per season, not spam (rate 0.02 x 200 days ~ 4)
    expect(run()).toBe(a); // deterministic
  });

  it('never prints outside the regular season', () => {
    const league = fixtureLeague();
    initPsyche(league);
    for (let day = 0; day < 100; day++) {
      league.day = day;
      expect(lifestyleNews(league)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// aging texture (dev.ts)

describe('aging grace (dev.ts)', () => {
  it('is a bounded persistent trait with real spread across a cohort', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 200; i++) {
      const g = agingGraceFor('fixture', `p${String(i).padStart(4, '0')}`);
      expect(g).toBe(agingGraceFor('fixture', `p${String(i).padStart(4, '0')}`)); // never re-rolled
      expect(g).toBeGreaterThanOrEqual(0.85);
      expect(g).toBeLessThanOrEqual(1.20);
      min = Math.min(min, g);
      max = Math.max(max, g);
    }
    expect(max - min).toBeGreaterThan(0.15); // some age gracefully, some do not
  });
});

// ---------------------------------------------------------------------------
// visible texture and the style law

describe('phrases and copy (style law)', () => {
  it('confidencePhrase covers the scale with dry prose', () => {
    expect(confidencePhrase(90)).toBe('playing free');
    expect(confidencePhrase(65)).toBe('feeling good');
    expect(confidencePhrase(50)).toBe('level');
    expect(confidencePhrase(30)).toBe('pressing');
    expect(confidencePhrase(10)).toBe('in his head');
  });

  it('no em dashes anywhere in user-facing copy', () => {
    for (let c = 0; c <= 100; c += 5) expect(confidencePhrase(c)).not.toContain('\u2014');
    for (const lifestyle of LIFESTYLE_KEYS) {
      expect(lifestylePhrase(lifestyle)).not.toContain('\u2014');
      expect(lifestylePhrase(lifestyle).length).toBeGreaterThan(0);
    }
    // scan actual generated beats across many days
    const league = fixtureLeague();
    league.phase = 'regular';
    initPsyche(league);
    for (let day = 0; day < 400; day++) {
      league.day = day;
      for (const item of lifestyleNews(league)) {
        expect(item.headline).not.toContain('\u2014');
        expect(item.body).not.toContain('\u2014');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// distribution sanity (calibration guard, unit-sized)

describe('calibration guards', () => {
  it('a mixed-form month leaves confidence spread but sane, everything integer inside 0-100', () => {
    const league = fixtureLeague();
    const shapes = [HOT_GAME, COLD_GAME, null, HOT_GAME, null, COLD_GAME, null, null, HOT_GAME, COLD_GAME];
    for (const tid of Object.keys(league.teams).sort()) {
      const team = league.teams[tid]!;
      team.roster.forEach((pid, i) => {
        const shape = shapes[i % shapes.length];
        if (shape) fabricateForm(league, pid, shape);
        else league.players[pid]!.seasons.push(seasonRow(league.season, tid, BASELINE));
      });
    }
    for (let week = 1; week <= 6; week++) {
      league.day = week * 7;
      updatePsyche(league);
    }
    const confs: number[] = [];
    for (const team of Object.values(league.teams)) {
      for (const pid of team.roster) confs.push(playerPsyche(league.players[pid]!)!.confidence);
    }
    for (const c of confs) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(100);
    }
    const lo = Math.min(...confs);
    const hi = Math.max(...confs);
    expect(lo).toBeLessThan(CONF_BASE);      // slumps exist
    expect(hi).toBeGreaterThan(CONF_BASE);   // heaters exist
    expect(lo).toBeGreaterThan(0);           // nobody pegged to the floor
    expect(hi).toBeLessThan(100);            // nobody pegged to the ceiling
    // and free agents / uninvolved arms of the league were not touched
    expect(teamChemistryFor(league, 'no-such-player')).toBe(null);
  });
});
