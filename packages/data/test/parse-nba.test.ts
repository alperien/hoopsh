/**
 * parse-nba.mjs corpus-definition tests — the dead-ball second-chance
 * exclusions, the strict and-one window, and the advisory clock-sanity check
 * (release-audit H-06 / L-54 / L-55 / L-56). Synthetic play rows use bbref's
 * exact phrasings: these definitions parse the committed corpus, so a
 * regression here silently re-inflates data/nba reference values the harness
 * gates against.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { grammarMetrics, possessionMetrics, validateGame, type PbpPlay } from '../../../tools/parse-nba.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Q1 rows with running scores carried forward; append the End row explicitly. */
const row = (clockSec: number, side: PbpPlay['side'], text: string, a = 0, h = 0): PbpPlay =>
  ({ q: 1, clockSec, side, text, a, h });

describe('possessionMetrics: dead-ball team rebounds never mark second chances (H-06)', () => {
  it('missed non-final FT bookkeeping does not mark (regression pin)', () => {
    const m = possessionMetrics([
      row(600, 'away', 'A. Sarr misses free throw 1 of 2'),
      row(600, 'away', 'Offensive rebound by Team'),
      row(600, 'away', 'A. Sarr makes free throw 2 of 2', 1, 0),
      row(0, null, 'End of 1st quarter', 1, 0)
    ]);
    expect(m.secondChance).toBe(0);
  });

  it('missed technical FT bookkeeping does not mark', () => {
    const m = possessionMetrics([
      row(500, 'away', 'K. Durant misses technical free throw'),
      row(500, 'away', 'Offensive rebound by Team'),
      row(480, 'away', 'K. Durant makes 2-pt jump shot from 8 ft', 2, 0),
      row(0, null, 'End of 1st quarter', 2, 0)
    ]);
    expect(m.secondChance).toBe(0);
  });

  it('an unsecured miss at the period horn does not mark, incl. after a heave', () => {
    for (const missText of ['C. Thomas misses 3-pt jump shot from 38 ft', 'Team misses heave shot']) {
      const m = possessionMetrics([
        row(300, 'home', 'J. Brown makes 2-pt jump shot from 18 ft', 0, 2),
        row(0, 'away', missText, 0, 2),
        row(0, 'away', 'Offensive rebound by Team', 0, 2),
        row(0, null, 'End of 1st quarter', 0, 2)
      ]);
      expect(m.secondChance).toBe(0);
    }
  });

  it('a team rebound at 0:00.x followed by LIVE action stays counted', () => {
    const m = possessionMetrics([
      row(0, 'away', 'E. Mobley misses 2-pt layup from 2 ft'),
      row(0, 'away', 'Offensive rebound by Team'),
      row(0, 'away', 'S. Fontecchio misses 2-pt layup from 3 ft'),
      row(0, null, 'End of 1st quarter')
    ]);
    expect(m.secondChance).toBe(1);
  });

  it('a player offensive rebound marks, as always', () => {
    const m = possessionMetrics([
      row(650, 'away', 'C. McCollum misses 2-pt jump shot from 6 ft'),
      row(649, 'away', 'Offensive rebound by A. Sarr'),
      row(645, 'away', 'A. Sarr makes 2-pt dunk from 1 ft', 2, 0),
      row(0, null, 'End of 1st quarter', 2, 0)
    ]);
    expect(m.secondChance).toBe(1);
  });

  it('"Defensive rebound by Team" after a missed technical FT closes nothing (H-06 micro)', () => {
    // away holds the ball throughout: make (close), missed tech FT + the
    // bookkeeping row, then away scores again. The bookkeeping row must not
    // split the second possession in two.
    const plays = [
      row(700, 'away', 'C. Cunningham makes 2-pt layup from 2 ft', 2, 0),
      row(650, 'away', 'D. Mitchell misses technical free throw', 2, 0),
      row(650, 'home', 'Defensive rebound by Team', 2, 0),
      row(600, 'away', 'C. Cunningham makes 2-pt layup from 3 ft', 4, 0),
      row(0, null, 'End of 1st quarter', 4, 0)
    ];
    expect(possessionMetrics(plays).n).toBe(3); // make, make, horn — no extra split

    // contrast: a PLAYER defensive rebound after a live miss still closes
    const live = [
      row(700, 'away', 'C. Cunningham makes 2-pt layup from 2 ft', 2, 0),
      row(650, 'away', 'K. George misses 2-pt layup from 4 ft', 2, 0),
      row(649, 'home', 'Defensive rebound by N. Queta', 2, 0),
      row(600, 'home', 'J. Brown makes 2-pt jump shot from 18 ft', 2, 2),
      row(0, null, 'End of 1st quarter', 2, 2)
    ];
    expect(possessionMetrics(live).n).toBe(4);
  });
});

describe('and-one window checks side and drawn-by player (L-54)', () => {
  const make = row(300, 'away', 'A. Star makes 2-pt layup from 2 ft', 2, 0);
  const end = row(0, null, 'End of 1st quarter', 2, 0);

  it('genuine and-one: foul in the shooter\'s column, drawn by the shooter', () => {
    const g = grammarMetrics([make, row(300, 'away', 'Shooting foul by B. Def (drawn by A. Star)', 2, 0), end]);
    expect(g.andOnes).toBe(1);
  });

  it('a foul drawn by someone else inside the window is not an and-one', () => {
    const g = grammarMetrics([make, row(300, 'away', 'Shooting foul by B. Def (drawn by C. Cutter)', 2, 0), end]);
    expect(g.andOnes).toBe(0);
  });

  it('a next-possession foul in the other column is not an and-one, and the make closes', () => {
    const foulOtherEnd = row(299, 'home', 'Shooting foul by A. Star (drawn by D. Rim)', 2, 0);
    expect(grammarMetrics([make, foulOtherEnd, end]).andOnes).toBe(0);
    // possession side of the same defect: the make must still be a boundary
    const m = possessionMetrics([make, foulOtherEnd, end]);
    expect(m.n).toBe(2); // make closes at 300s, horn closes the rest
  });
});

describe('validateGame clock sanity is advisory (L-55)', () => {
  it('counts backwards-clock and beyond-period rows without failing the game', () => {
    const plays: PbpPlay[] = [
      row(700, 'away', 'A. A makes 2-pt jump shot from 5 ft', 2, 0),
      row(0, null, 'End of 1st quarter', 2, 0),
      // bbref's between-period sub, stamped 12:00.0 of the OLD period
      row(720, 'home', 'B. B enters the game for C. C', 2, 0),
      { q: 2, clockSec: 500, side: 'home', text: 'D. D makes 2-pt layup from 1 ft', a: 2, h: 2 }
    ];
    const v = validateGame(plays, [2, 2]);
    expect(v.ok).toBe(true);
    expect(v.clockJumps).toBe(1);

    const clean = validateGame([plays[0]!, plays[1]!], [2, 0]);
    expect(clean.ok).toBe(true);
    expect(clean.clockJumps).toBe(0);
  });
});

describe('parse-nba CLI refuses subset writes over the committed corpus (L-56)', () => {
  const run = (...cliArgs: string[]) => spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'parse-nba.mjs'), ...cliArgs
  ], { encoding: 'utf8', cwd: ROOT });

  it('--games without a scratch --out-dir exits 2 and writes nothing', () => {
    const res = run('--games', '202511050BOS');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('--out-dir');
  });

  it('--games with --write-reference exits 2 (a subset reference lies about its n)', () => {
    const res = run('--games', '202511050BOS', '--out-dir', 'out/nba-subset-test', '--write-reference');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('--write-reference');
  });
});
