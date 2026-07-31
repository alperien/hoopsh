/**
 * fastsim.ts - the pre-entry world sim (docs/CAREER.md register C11): a
 * deterministic, engine-free SimulateJobs that keeps the NBA structurally
 * real (standings, lotteries, draft classes, transactions) while you are
 * still in high school. Box-score fidelity begins the season you arrive,
 * when the career tick switches the league to the provided worker pool.
 *
 * Lifted from the franchise autosim gate's fake sim (test/autosim.test.ts)
 * and kept shape-compatible with applyGameResults: lines reference the
 * job's ACTUAL projected rosters, minutes look like a rotation, points
 * follow a declining-share split. Deterministic per job seed.
 */
import { Rng } from '@hoopsh/engine';
import type { GameJob, GameJobResult, SimulateJobs } from '@hoopsh/franchise';

// FEEL constants: a plausible box shape, not a calibrated one (C11).
const SHARES = [0.24, 0.19, 0.15, 0.12, 0.10, 0.08, 0.07, 0.05]; // declining scoring shares, 8-man rotation
const MINUTES = [36, 34, 32, 30, 26, 22, 18, 12];                // rotation minutes ladder

export const fastSim: SimulateJobs = (jobs: GameJob[]): GameJobResult[] => {
  return jobs.map(job => {
    const rng = new Rng(`fast:${job.seed}`);
    let hs = 95 + rng.int(35); // FEEL: finals live in the 95-129 band
    let as = 95 + rng.int(35);
    if (hs === as) hs += 1;    // the engine never ties; neither does the fast world
    const mkLines = (team: GameJob['home'], teamPts: number, side: 0 | 1) => {
      const ids = team.players.slice(0, 8);
      let assigned = 0;
      return ids.map((p, i) => {
        const pts = i === ids.length - 1 ? Math.max(0, teamPts - assigned) : Math.round(teamPts * SHARES[i]!);
        assigned += pts;
        return {
          playerId: p.id, teamId: team.id, starter: i < 5,
          min: MINUTES[i]!, pts,
          fgm: Math.max(0, Math.round(pts * 0.38)), fga: Math.max(1, Math.round(pts * 0.85)),
          tpm: Math.round(pts * 0.12), tpa: Math.round(pts * 0.3),
          ftm: Math.round(pts * 0.14), fta: Math.round(pts * 0.18),
          orb: rng.int(3), drb: 2 + rng.int(6), ast: rng.int(8), stl: rng.int(3),
          blk: rng.int(2), tov: rng.int(4), pf: rng.int(5),
          plusMinus: (side === 0 ? hs - as : as - hs) > 0 ? rng.int(15) : -rng.int(15),
        };
      });
    };
    const totals = (pts: number) => ({
      pts, fgm: Math.round(pts * 0.37), fga: 88, tpm: Math.round(pts * 0.12), tpa: 35,
      ftm: Math.round(pts * 0.15), fta: 20, orb: 10, drb: 33, ast: 25, stl: 7,
      blk: 4, tov: 13, pf: 19, pace: 98, fastbreakPts: 12, biggestLead: Math.abs(hs - as) + 4,
    });
    return {
      index: job.index,
      gameId: job.gameId,
      final: [hs, as] as [number, number],
      ot: 0,
      lines: [...mkLines(job.home, hs, 0), ...mkLines(job.away, as, 1)],
      totals: [totals(hs), totals(as)] as GameJobResult['totals'],
      keyPlays: [],
    };
  });
};
