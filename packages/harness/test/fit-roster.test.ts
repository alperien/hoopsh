/**
 * Analytic-layer tests for the stats→ratings fitter (fit-roster.ts).
 *
 * Deliberately SIMULATION-FREE: everything here checks the documented
 * algebra of layer 1 (the analytic priors) plus schema plumbing, so the
 * suite stays fast and deterministic. The centerpiece is the known-answer
 * round-trip: season lines CONSTRUCTED from the engine's own forward models
 * at known ratings must invert back to those ratings — and a league-average
 * line must land on the engine's formula-neutral defaults (rating 50 is
 * invisible to every probability model by construction; a league-average
 * box line must therefore fit to ~50s). Refinement (layer 2) is exercised
 * only for its budget guard, which throws BEFORE any game is simulated.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateTeamPack } from '@hoopsh/data';
import {
  analyticFit, assembleTeamPack, deriveRates, forwardFtPct, forwardThreePct,
  invertFreeThrow, invertThree, refineFit, usageDial, validateSeasonLines,
  zoneRefs, MAX_GAMES_PER_ITER, MAX_ITERS,
  type SeasonLine
} from '../src/fit-roster.js';

// repo root: packages/harness/test -> three levels up
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** a complete, editable baseline line (values overridden per test) */
function line(partial: Partial<SeasonLine>): SeasonLine {
  return {
    name: 'Test Player', pos: 'SF', heightIn: 79, weightLb: 220, mpg: 30,
    pts: 14, reb: 5, ast: 3, stl: 1, blk: 0.5, tov: 1.8,
    fga: 12, fgPct: 0.47, tpa: 4.5, tpPct: 0.36, fta: 3, ftPct: 0.78,
    ...partial
  };
}

describe('known-answer round-trips (forward model -> line -> inverted rating)', () => {
  it('3P%: forwardThreePct then invertThree recovers the rating (±1 rounding)', () => {
    for (const truth of [55, 70, 80, 92]) {
      for (const pullUpShare of [0.15, 0.35, 0.55]) {
        const pct = forwardThreePct(truth, pullUpShare);
        const recovered = invertThree(pct, pullUpShare);
        expect(Math.abs(recovered - truth)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('FT%: exact piecewise inverse of freeThrowP on both sides of the elite knee', () => {
    for (const truth of [40, 65, 80, 88, 96]) {
      const recovered = invertFreeThrow(forwardFtPct(truth));
      expect(Math.abs(recovered - truth)).toBeLessThanOrEqual(1);
    }
  });

  it('usage dial is the exact inverse of decide.ts usageTarget algebra', () => {
    // decide.ts: targetShare = 0.20 + (usage-50)/100 * usageShareSwing(0.24)
    expect(usageDial(0.2)).toBe(50);   // league-average load
    expect(usageDial(0.296)).toBe(90); // superstar load: 0.2 + 0.4*0.24 = 0.296
    expect(usageDial(0.104)).toBe(10); // screener load: 0.2 - 0.4*0.24
  });

  it('synthetic star: shooting dials constructed at known ratings invert back', () => {
    const truthThree = 84;
    const truthFt = 90;
    // pullUpShare depends only on tpa+ast, never tpPct — so deriving it
    // first and constructing tpPct from it is a legitimate round-trip
    const base = line({ pos: 'SG', tpa: 7, fga: 16, pts: 22 });
    const pus = deriveRates(base).pullUpShare;
    const l = line({
      ...base, tpa: 7, tpPct: forwardThreePct(truthThree, pus),
      ftPct: forwardFtPct(truthFt)
    });
    const fit = analyticFit(l);
    expect(Math.abs(fit.player.attr.three - truthThree)).toBeLessThanOrEqual(1);
    expect(Math.abs(fit.player.attr.freeThrow - truthFt)).toBeLessThanOrEqual(1);
    expect(fit.player.tend.usage).toBe(usageDial(fit.rates.usgPct));
  });

  it('league-average line fits to the formula-neutral player (the 50s fixpoint)', () => {
    // Build a line that IS the league average by construction: league shot
    // mix via explicit shotZones, 2P% equal to the reference model's own
    // league 2P% at that mix, USG exactly 20%, league-ish everything else.
    const mpg = 30;
    const fga = 12;
    const tpa = fga * 0.38;                    // league three share
    const zones = { rimShare2: 0.516, midShare2: 0.29 }; // -> FGA mix ~.32/.12/.18
    const Z = zoneRefs();
    const twoPa = fga - tpa;
    const mixRim = zones.rimShare2 * (twoPa / fga);
    const mixMid = zones.midShare2 * (twoPa / fga);
    const mixPaint = (1 - zones.rimShare2 - zones.midShare2) * (twoPa / fga);
    const leagueTwoPct =
      (mixRim * Z.rim.leaguePct + mixPaint * Z.paint.leaguePct + mixMid * Z.mid.leaguePct) /
      (mixRim + mixPaint + mixMid);
    const tpPct = 0.36;
    const fta = 2.0;
    const tov = 0.2 * mpg * 2.3 - fga - 0.44 * fta; // used = 20% of plays
    const fgPct = (twoPa * leagueTwoPct + tpa * tpPct) / fga;
    const l = line({ fga, tpa, tpPct, fta, tov, fgPct, mpg, shotZones: zones });

    const fit = analyticFit(l);
    // formula-neutral attributes: 50 contributes NOTHING to any model
    expect(Math.abs(fit.player.attr.finishing - 50)).toBeLessThanOrEqual(3);
    expect(Math.abs(fit.player.attr.midRange - 50)).toBeLessThanOrEqual(3);
    // default tendencies are the league-average identity (player.ts)
    expect(Math.abs(fit.player.tend.shotRim - 50)).toBeLessThanOrEqual(4);
    expect(Math.abs(fit.player.tend.shotMid - 30)).toBeLessThanOrEqual(4);
    expect(Math.abs(fit.player.tend.shotThree - 40)).toBeLessThanOrEqual(4);
    expect(fit.player.tend.usage).toBe(50);
  });
});

describe('directional sanity (more of the stat -> more of the dial)', () => {
  it('assists raise passVision; boards raise the rebound dials; FTr raises drawFoul', () => {
    const lo = analyticFit(line({ ast: 2, tov: 1.5 }));
    const hi = analyticFit(line({ ast: 9, tov: 2.5 }));
    expect(hi.player.attr.passVision).toBeGreaterThan(lo.player.attr.passVision);
    expect(hi.player.attr.passAcc).toBeGreaterThan(lo.player.attr.passAcc);

    const loReb = analyticFit(line({ reb: 3, orb: 0.4 }));
    const hiReb = analyticFit(line({ reb: 11, orb: 3 }));
    expect(hiReb.player.attr.offReb).toBeGreaterThan(loReb.player.attr.offReb);
    expect(hiReb.player.attr.defReb).toBeGreaterThan(loReb.player.attr.defReb);
    expect(hiReb.player.tend.crashOffReb).toBeGreaterThan(loReb.player.tend.crashOffReb);

    const loFt = analyticFit(line({ fta: 1.2 }));
    const hiFt = analyticFit(line({ fta: 7 }));
    expect(hiFt.player.attr.drawFoul).toBeGreaterThan(loFt.player.attr.drawFoul);
  });

  it('every dial stays inside the schema range on absurd inputs', () => {
    const extreme = analyticFit(line({
      pts: 45, ast: 14, reb: 18, stl: 4, blk: 4, tov: 7, fga: 32, tpa: 18,
      tpPct: 0.55, fgPct: 0.6, fta: 14, ftPct: 0.99, mpg: 44, orb: 6
    }));
    const bags = [extreme.player.attr, extreme.player.tend] as unknown as Record<string, number>[];
    for (const bag of bags) {
      for (const k of Object.keys(bag)) {
        expect(bag[k]).toBeGreaterThanOrEqual(1);
        expect(bag[k]).toBeLessThanOrEqual(99);
      }
    }
  });
});

describe('season-line schema validation', () => {
  it('rejects percentages given as 45.4 instead of 0.454, 3PA > FGA, missing provenance', () => {
    const bad = {
      kind: 'season-lines',
      players: [line({ tpPct: 45.4, tpa: 20, fga: 12 })]
    };
    const { file, issues } = validateSeasonLines(bad);
    expect(file).toBe(null);
    const paths = issues.map((i) => i.path).join(' ');
    expect(paths).toContain('provenance');
    expect(paths).toContain('tpPct');
    expect(paths).toContain('tpa');
  });

  it('accepts the shipped example files (data/nba/*.season.json)', () => {
    for (const f of ['example-stars.season.json', 'example-role-players.season.json']) {
      const raw: unknown = JSON.parse(readFileSync(path.join(ROOT, 'data', 'nba', f), 'utf8'));
      const { file, issues } = validateSeasonLines(raw);
      expect(issues).toEqual([]);
      expect(file !== null).toBe(true);
    }
  });
});

describe('team pack emission', () => {
  it('analytic fits assemble into a pack that passes validateTeamPack with zero issues', () => {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(ROOT, 'data', 'nba', 'example-stars.season.json'), 'utf8'));
    const { file } = validateSeasonLines(raw);
    const fits = file!.players.map((l) => ({ player: analyticFit(l).player, line: l }));
    const pack = assembleTeamPack(fits, file!.team);
    expect(validateTeamPack(pack)).toEqual([]);
    expect(pack.team.starters.length).toBe(5);
    expect(pack.team.players.length).toBeGreaterThanOrEqual(8);
    // fitted stars start (highest mpg first)
    expect(pack.team.starters).toContain('fit-example-guard-curry-like');
  });
});

describe('refinement budget guard (throws before any game is simulated)', () => {
  it('rejects > MAX_ITERS iterations and > MAX_GAMES_PER_ITER games per iteration', () => {
    const seed = analyticFit(line({})).player;
    expect(() => refineFit(seed, line({}), {
      iters: MAX_ITERS + 1, cands: 2, games: 4, refine: true, seedBase: 't'
    })).toThrow(/exceeds the hard budget/);
    expect(() => refineFit(seed, line({}), {
      iters: 5, cands: 3, games: 3, refine: true, seedBase: 't'
    })).toThrow(/exceeds the hard budget/);
    expect(3 * 3).toBeGreaterThan(MAX_GAMES_PER_ITER);
  });
});
