/**
 * Out-of-sample validation — the answer to "the sweep tunes what grades it."
 *
 * Every calibration number in this repo was fit on the two sample rosters.
 * This runner generates ROSTERS THE SWEEP HAS NEVER SEEN — position-slotted
 * archetype teams with seeded rating jitter — and checks two things on them:
 *
 *   1. The NBA acceptance bands. Passing here means the calibration
 *      generalizes across the roster distribution, not just the two teams it
 *      was fit on. (It cannot prove identification — see INTERNALS'
 *      "what locked does and does not claim" — but it removes the
 *      fit-to-the-training-set objection.)
 *   2. DISTRIBUTIONAL realism, which league means cannot see: score-margin
 *      spread, blowout and close-game rates, overtime rate, single-game team
 *      scoring extremes, quarter profiles. Reported against real NBA
 *      references, REPORT-ONLY for now (the ratchet convention: they become
 *      enforced once they hold).
 *
 * Run: npm run oos [-- --teams 12 --games 60 --jitter 8 --seed oos]
 */

import { Rng, clamp, simulateGame, type Player, type Team } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import {
  benchBig, benchScorer, comboGuard, eliteShooter, floorGeneral, glueForward,
  postAnchor, rimRunner, scoringWing, stretchBig, threeAndD
} from '@hoopsh/data';
import { accumulate, emptyAcc, evaluate, finalize, formatReport } from './aggregate.js';
import { NBA_BANDS } from './bands.js';

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const TEAMS = Number(argOf('--teams') ?? 12);
const GAMES = Number(argOf('--games') ?? 60);
const JITTER = Number(argOf('--jitter') ?? 8);
const SEED = argOf('--seed') ?? 'oos';

// ------------------------------------------------------- roster generation

type Named = { id: string; name: string; pos: Player['pos'] };
type Builder = (who: Named) => Player;

/** plausible archetypes per starting slot — mirrors how real rosters skew */
const SLOT_POOLS: Record<Player['pos'], Builder[]> = {
  PG: [floorGeneral, comboGuard, eliteShooter],
  SG: [scoringWing, threeAndD, comboGuard, eliteShooter],
  SF: [threeAndD, scoringWing, glueForward],
  PF: [glueForward, stretchBig, postAnchor],
  C: [postAnchor, rimRunner, benchBig, stretchBig]
};
const BENCH_POOLS: Record<string, Builder[]> = {
  G: [benchScorer, comboGuard, threeAndD],
  F: [glueForward, threeAndD, scoringWing],
  C: [benchBig, rimRunner, stretchBig]
};

function jitterRatings(rng: Rng, p: Player, j: number): void {
  const bags = [p.attr as unknown as Record<string, number>, p.tend as unknown as Record<string, number>];
  for (const bag of bags) {
    for (const k of Object.keys(bag)) {
      bag[k] = Math.round(clamp(bag[k]! + rng.range(-j, j), 1, 99));
    }
  }
}

export function randomTeam(rng: Rng, id: string): Team {
  const starters: Player[] = (['PG', 'SG', 'SF', 'PF', 'C'] as const).map((pos, i) => {
    const pool = SLOT_POOLS[pos];
    const p = pool[Math.floor(rng.float() * pool.length)]!({
      id: `${id}-${i + 1}`, name: `${id.toUpperCase()} ${pos}`, pos
    });
    jitterRatings(rng, p, JITTER);
    return p;
  });
  const bench: Player[] = (['G', 'G', 'F', 'F', 'C'] as const).map((slot, i) => {
    const pool = BENCH_POOLS[slot]!;
    const pos: Player['pos'] = slot === 'G' ? (i === 0 ? 'PG' : 'SG') : slot === 'C' ? 'C' : (i === 2 ? 'SF' : 'PF');
    const p = pool[Math.floor(rng.float() * pool.length)]!({
      id: `${id}-${i + 6}`, name: `${id.toUpperCase()} B${i + 1}`, pos
    });
    jitterRatings(rng, p, JITTER);
    return p;
  });
  return {
    id: `oos-${id}`, name: `Team ${id.toUpperCase()}`, abbrev: id.toUpperCase().slice(0, 3),
    players: [...starters, ...bench],
    starters: starters.map((p) => p.id),
    tactics: {
      pace: Math.round(clamp(50 + rng.range(-14, 14), 20, 80)),
      threeBias: Math.round(clamp(50 + rng.range(-14, 14), 20, 80)),
      helpAggr: Math.round(clamp(50 + rng.range(-14, 14), 20, 80))
    }
  };
}

// ------------------------------------------------------------ distribution

export interface GameFinal { home: number; away: number; periods: number; quarters: [number, number][] }

export interface DistReport {
  marginAvg: number; marginSd: number;
  blowoutPct: number; closePct: number; otPct: number;
  teamMin: number; teamMax: number;
  quarterAvg: number[];
}

export function distributionOf(finals: GameFinal[]): DistReport {
  const margins = finals.map((f) => Math.abs(f.home - f.away));
  const mAvg = margins.reduce((a, b) => a + b, 0) / margins.length;
  const mSd = Math.sqrt(margins.reduce((a, m) => a + (m - mAvg) ** 2, 0) / margins.length);
  const teamScores = finals.flatMap((f) => [f.home, f.away]);
  const qn = Math.max(...finals.map((f) => Math.min(4, f.quarters.length)));
  const quarterAvg: number[] = [];
  for (let q = 0; q < qn; q++) {
    const vals = finals.flatMap((f) => (f.quarters[q] ? [f.quarters[q]![0], f.quarters[q]![1]] : []));
    quarterAvg.push(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length));
  }
  return {
    marginAvg: mAvg, marginSd: mSd,
    blowoutPct: margins.filter((m) => m >= 20).length / margins.length,
    closePct: margins.filter((m) => m <= 5).length / margins.length,
    otPct: finals.filter((f) => f.periods > 4).length / finals.length,
    teamMin: Math.min(...teamScores), teamMax: Math.max(...teamScores),
    quarterAvg
  };
}

/** REAL NBA references (2015-2025 ballpark) — report-only until they hold */
export function formatDistribution(d: DistReport): string {
  const row = (label: string, val: string, ref: string) =>
    ` info  ${label.padEnd(26)} ${val.padStart(8)}   NBA ~${ref}`;
  return [
    'Distributional report (REPORT-ONLY — ratchet convention)',
    row('avg final margin', d.marginAvg.toFixed(1), '11-12'),
    row('margin std dev', d.marginSd.toFixed(1), '8-9'),
    row('blowout share (20+)', `${(100 * d.blowoutPct).toFixed(0)}%`, '15-20%'),
    row('close-game share (<=5)', `${(100 * d.closePct).toFixed(0)}%`, '20-26%'),
    row('overtime share', `${(100 * d.otPct).toFixed(1)}%`, '5-7%'),
    row('team single-game min/max', `${d.teamMin}/${d.teamMax}`, '~68 / ~155 across a season'),
    row('quarter scoring profile', d.quarterAvg.map((q) => q.toFixed(1)).join(' '), '28-29 each, Q4 a shade lower')
  ].join('\n');
}

/** period-end scores from the event stream (per game) */
export function finalsOf(events: { type: string; period?: number; score?: [number, number] }[]): GameFinal {
  const perEnd: [number, number][] = [];
  let last: [number, number] = [0, 0];
  let periods = 0;
  for (const e of events) {
    if (e.type === 'period_end' && e.score) {
      periods = Math.max(periods, e.period ?? periods + 1);
      perEnd.push([e.score[0] - last[0], e.score[1] - last[1]]);
      last = e.score;
    }
    if (e.type === 'game_end' && e.score) last = e.score;
  }
  return { home: last[0], away: last[1], periods: Math.max(periods, perEnd.length), quarters: perEnd };
}

// ------------------------------------------------------------------ runner

if (import.meta.main) {
  const rng = new Rng(`${SEED}-teams`);
  const teams: Team[] = [];
  for (let i = 0; i < TEAMS; i++) teams.push(randomTeam(rng, `t${i + 1}`));
  console.log(`Out-of-sample: ${TEAMS} generated rosters (jitter ±${JITTER}), ${GAMES} games\n`);

  const acc = emptyAcc();
  const finals: GameFinal[] = [];
  for (let g = 0; g < GAMES; g++) {
    const hi = Math.floor((g * 7919) % TEAMS); // deterministic pairing walk
    let ai = Math.floor((g * 104729 + 1) % TEAMS);
    if (ai === hi) ai = (ai + 1) % TEAMS;
    const home = teams[hi]!;
    const away = teams[ai]!;
    const result = simulateGame({ seed: `${SEED}-${g}`, home, away, collectFrames: false });
    accumulate(acc, boxScore(result.events, [home, away]));
    finals.push(finalsOf(result.events as never));
    if ((g + 1) % 10 === 0) process.stdout.write(`  ${g + 1}/${GAMES}\r`);
  }
  console.log('');
  console.log(formatReport(evaluate(finalize(acc), NBA_BANDS)));
  console.log('');
  console.log(formatDistribution(distributionOf(finals)));
}
