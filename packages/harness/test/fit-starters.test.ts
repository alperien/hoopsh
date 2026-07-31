/**
 * Starters come from games-started, not minutes (REGISTER W65): real
 * lineups are not recoverable from mpg — the measured incident is OKC's
 * double-big front line, where the fitter benched Hartenstein (24.2 real
 * mpg, 60+ starts) behind a higher-mpg guard and the positional rotation
 * then starved him to ~8 sim minutes. assembleTeamPack is exported and
 * pure, so the ordering contract is unit-pinned here; the season-file
 * validator's optional-gs rule rides along.
 */
import { describe, expect, it } from 'vitest';
import { analyticFit, assembleTeamPack, validateSeasonLines, type SeasonLine } from '../src/fit-roster.js';

const line = (name: string, pos: SeasonLine['pos'], mpg: number, gs: number | undefined): SeasonLine => ({
  name, pos, heightIn: 78, weightLb: 210, mpg,
  pts: 10, reb: 4, ast: 2, stl: 0.8, blk: 0.5, tov: 1.5,
  fga: 9, fgPct: 0.47, tpa: 3, tpPct: 0.35, fta: 2.5, ftPct: 0.78,
  ...(gs === undefined ? {} : { gs })
});

const fitsOf = (lines: SeasonLine[]) => lines.map((l) => ({ player: analyticFit(l).player, line: l }));

describe('starters from games-started (fit-roster.ts assembleTeamPack)', () => {
  it('a low-minute regular starter beats a high-minute bench player', () => {
    // the Hartenstein shape: fewer minutes, near-every-game starter
    const lines = [
      line('Bench Sixth Man', 'SG', 30, 4),
      line('Starter Center', 'C', 24, 70),
      line('Starter PG', 'PG', 33, 78),
      line('Starter Wing', 'SF', 31, 74),
      line('Starter Forward', 'PF', 29, 72),
      line('Starter Guard', 'SG', 28, 66),
      line('Deep Bench', 'C', 14, 0),
      line('Bench Wing', 'SF', 18, 2)
    ];
    const pack = assembleTeamPack(fitsOf(lines), { id: 't', name: 'T', abbrev: 'TTT' });
    const starterNames = pack.team.starters.map((id) =>
      pack.team.players.find((p) => p.id === id)!.name);
    expect(starterNames).toContain('Starter Center');
    expect(starterNames).not.toContain('Bench Sixth Man');
    expect(starterNames.length).toBe(5);
  });

  it('ties on games-started break by minutes, and no gs data falls back to the mpg ordering', () => {
    const tied = fitsOf([
      line('A More Minutes', 'PG', 34, 41),
      line('B Fewer Minutes', 'SG', 22, 41),
      line('C', 'SF', 30, 41), line('D', 'PF', 28, 41), line('E', 'C', 26, 41),
      line('F Bench', 'SG', 20, 3), line('G Bench', 'SF', 15, 0), line('H Bench', 'C', 13, 0)
    ]);
    const p1 = assembleTeamPack(tied, { id: 't', name: 'T', abbrev: 'TTT' });
    expect(p1.team.starters[0]).toBe(p1.team.players.find((p) => p.name === 'A More Minutes')!.id);

    // pre-gs season files: every line lacks gs — pure mpg ordering, the
    // exact pre-landing behavior (compatibility contract)
    const legacy = fitsOf([
      line('Big Minutes', 'PG', 36, undefined), line('B', 'SG', 30, undefined),
      line('C', 'SF', 28, undefined), line('D', 'PF', 26, undefined),
      line('E', 'C', 24, undefined), line('F', 'SG', 20, undefined),
      line('G', 'SF', 16, undefined), line('H', 'C', 13, undefined)
    ]);
    const p2 = assembleTeamPack(legacy, { id: 't', name: 'T', abbrev: 'TTT' });
    expect(p2.team.starters[0]).toBe(p2.team.players.find((p) => p.name === 'Big Minutes')!.id);
  });

  it('minutes targets go to the core nine only (the pigeonhole rule, W65)', () => {
    // twelve fitted players; the mpg-ordered top nine carry targets, the
    // tail is untargeted fill — the shape that revives the engine's
    // proactive eager-return (its out-swap requires an untargeted body)
    // and matches real single-game rotations (240 minutes cannot hold
    // twelve season averages)
    const lines = Array.from({ length: 12 }, (_, i) =>
      line(`P${String(i).padStart(2, '0')}`, (['PG','SG','SF','PF','C'] as const)[i % 5], 34 - i * 2, 50 - i));
    const pack = assembleTeamPack(fitsOf(lines), { id: 't', name: 'T', abbrev: 'TTT' });
    const targets = Object.keys(pack.team.rotationMinutes ?? {});
    expect(targets.length).toBe(9);
    const byName = new Map(pack.team.players.map((p) => [p.id, p.name]));
    const targetNames = targets.map((id) => byName.get(id)!).sort();
    // exactly the nine highest-mpg players (P00..P08)
    expect(targetNames).toEqual(Array.from({ length: 9 }, (_, i) => `P${String(i).padStart(2, '0')}`));
  });

  it('the validator accepts a well-formed gs and rejects a malformed one, when present', () => {
    const base = {
      kind: 'season-lines', provenance: 'unit test',
      team: { id: 't', name: 'T', abbrev: 'TTT' },
      players: [line('P', 'PG', 30, 50)]
    };
    expect(validateSeasonLines(base).issues).toEqual([]);
    const bad = JSON.parse(JSON.stringify(base)) as { players: { gs: unknown }[] };
    bad.players[0]!.gs = 'sixty';
    expect(validateSeasonLines(bad).issues.length).toBeGreaterThan(0);
  });
});
