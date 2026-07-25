/**
 * Player-fidelity harness — the Phase 2R acceptance gate.
 *
 * Three benchmark superstars chosen for maximum style spread — an off-ball
 * gravity shooter, a downhill point-forward, and a post-hub center — each
 * embedded in a purpose-built supporting cast, each validated against his
 * real-life season-scale stat ranges. The claim under test: HANDCRAFTED
 * RATINGS ALONE, run through the engine's spatial + decision machinery,
 * reproduce a real player's statistical identity. No per-player code paths
 * exist (AGENTS.md §6 prohibits them); if a benchmark misses, either the
 * profile is mis-authored or the engine is missing a mechanism.
 *
 * Targets are REAL numbers: composite prime-season ranges (roughly 2015-2024)
 * a fan would recognize, deliberately generous at v1 — they tighten as
 * fidelity matures, same convention as the archetype tests.
 *
 * Run: `npm run fidelity` (add `-- --games 36` to change the slate length).
 */

import { simulateGame, type Player, type Team } from '@hoopsh/engine';
import { boxScore, type PlayerLine } from '@hoopsh/stats';
import {
  benchBig, benchScorer, comboGuard, glueForward, rimRunner, sampleMatchup,
  scoringWing, stretchBig, threeAndD
} from '@hoopsh/data';

// ---------------------------------------------------------------- profiles

/**
 * The gravity benchmark: elite off-ball shooter whose three-point threat
 * (gravity ≈ 0.98) warps the defense. Fidelity hinges on volume + accuracy
 * from deep, high FT%, and secondary (not primary-volume) playmaking.
 */
const curry: Player = {
  id: 'fid-curry', name: 'S. Curry', pos: 'PG', heightIn: 74, weightLb: 185,
  attr: {
    speed: 84, accel: 90, lateral: 70, stamina: 90, strength: 45, vertical: 65,
    finishing: 84, midRange: 90, three: 99, freeThrow: 99, drawFoul: 68,
    ballHandle: 96, passAcc: 88, passVision: 88,
    perimeterD: 55, interiorD: 25, steal: 68, block: 12, contestSkill: 45,
    offReb: 22, defReb: 48, boxout: 25,
    decisions: 90, consistency: 85
  },
  tend: {
    shotRim: 26, shotMid: 20, shotThree: 86, pullUp: 66,
    drive: 38, passOut: 62, iso: 55, post: 3,
    offBallMotion: 96, crashOffReb: 8,
    gambleSteal: 55, foulAggr: 25, pushPace: 70
  }
};

/**
 * The downhill benchmark: point-forward who lives at the rim and creates for
 * everyone. Fidelity hinges on high-efficiency two-point volume off drives,
 * heavy assist creation, and strong (not center-grade) rebounding.
 */
const lebron: Player = {
  id: 'fid-lebron', name: 'L. James', pos: 'SF', heightIn: 81, weightLb: 250,
  attr: {
    speed: 90, accel: 88, lateral: 78, stamina: 92, strength: 97, vertical: 85,
    finishing: 97, midRange: 82, three: 76, freeThrow: 74, drawFoul: 88,
    ballHandle: 90, passAcc: 95, passVision: 97,
    perimeterD: 72, interiorD: 70, steal: 70, block: 62, contestSkill: 65,
    offReb: 45, defReb: 86, boxout: 62,
    decisions: 96, consistency: 88
  },
  tend: {
    shotRim: 60, shotMid: 26, shotThree: 68, pullUp: 40,
    drive: 92, passOut: 70, iso: 60, post: 35,
    offBallMotion: 45, crashOffReb: 42,
    gambleSteal: 45, foulAggr: 40, pushPace: 75
  }
};

/**
 * The hub benchmark: a post-up center who is also his team's best creator
 * (creation score 89.5 — the usage hierarchy must route the offense through
 * a CENTER for this profile to work). Fidelity hinges on huge rebounding,
 * elite efficiency on touch shots, and point-guard-grade assist totals —
 * the hardest line in the suite, gated on the assisted-share ratchet.
 */
const jokic: Player = {
  id: 'fid-jokic', name: 'N. Jokić', pos: 'C', heightIn: 83, weightLb: 284,
  attr: {
    speed: 45, accel: 42, lateral: 38, stamina: 82, strength: 96, vertical: 35,
    finishing: 94, midRange: 96, three: 80, freeThrow: 82, drawFoul: 78,
    ballHandle: 80, passAcc: 99, passVision: 99,
    perimeterD: 35, interiorD: 62, steal: 62, block: 38, contestSkill: 55,
    offReb: 88, defReb: 97, boxout: 92,
    decisions: 99, consistency: 90
  },
  tend: {
    shotRim: 62, shotMid: 58, shotThree: 56, pullUp: 42,
    drive: 25, passOut: 75, iso: 40, post: 92,
    offBallMotion: 30, crashOffReb: 55,
    gambleSteal: 40, foulAggr: 30, pushPace: 45
  }
};

// ------------------------------------------------------------------- casts

/** shared tactics baseline — league-neutral except where a star's real team leans */
const tactics = (pace: number, threeBias: number, helpAggr: number) => ({ pace, threeBias, helpAggr });

const team = (id: string, name: string, abbrev: string, star: Player, cast: Player[], t: ReturnType<typeof tactics>): Team => ({
  id, name, abbrev,
  players: [star, ...cast],
  starters: [star.id, ...cast.slice(0, 4).map((p) => p.id)],
  tactics: t,
  // the star carries a real superstar's load; the engine's rotation logic
  // fills the rest from the default derivation
  rotationMinutes: { [star.id]: 36 }
});

/** motion-and-gravity cast: a connector forward, shooting, and a rim-runner */
const curryTeam = team('fid-gsw', 'Bay Splash', 'BAY', curry, [
  comboGuard({ id: 'gsw-2', name: 'K. Poole', pos: 'SG' }),
  threeAndD({ id: 'gsw-3', name: 'A. Wiggs', pos: 'SF' }),
  glueForward({ id: 'gsw-4', name: 'D. Green', pos: 'PF' }),
  rimRunner({ id: 'gsw-5', name: 'K. Looney', pos: 'C' }),
  benchScorer({ id: 'gsw-6', name: 'B. Six', pos: 'SG' }),
  threeAndD({ id: 'gsw-7', name: 'B. Seven', pos: 'SF' }),
  benchBig({ id: 'gsw-8', name: 'B. Eight', pos: 'C' }),
  glueForward({ id: 'gsw-9', name: 'B. Nine', pos: 'PF' }),
  comboGuard({ id: 'gsw-10', name: 'B. Ten', pos: 'PG' })
], tactics(62, 64, 50));

/** spaced floor for a downhill creator: shooters everywhere plus a lob big */
const lebronTeam = team('fid-cle', 'Lakeshore Kings', 'LSK', lebron, [
  comboGuard({ id: 'cle-2', name: 'D. Guard', pos: 'PG' }),
  threeAndD({ id: 'cle-3', name: 'C. Wing', pos: 'SG' }),
  stretchBig({ id: 'cle-4', name: 'S. Four', pos: 'PF' }),
  rimRunner({ id: 'cle-5', name: 'R. Five', pos: 'C' }),
  benchScorer({ id: 'cle-6', name: 'B. Six', pos: 'SG' }),
  threeAndD({ id: 'cle-7', name: 'B. Seven', pos: 'SF' }),
  benchBig({ id: 'cle-8', name: 'B. Eight', pos: 'C' }),
  scoringWing({ id: 'cle-9', name: 'B. Nine', pos: 'SF' }),
  glueForward({ id: 'cle-10', name: 'B. Ten', pos: 'PF' })
], tactics(58, 58, 50));

/** cutters and shooters around the hub — the spray targets his sprays need */
const jokicTeam = team('fid-den', 'Mile High Hubs', 'MHH', jokic, [
  scoringWing({ id: 'den-2', name: 'J. Murr', pos: 'PG' }),
  threeAndD({ id: 'den-3', name: 'K. Pope', pos: 'SG' }),
  threeAndD({ id: 'den-4', name: 'M. Porter', pos: 'SF' }),
  glueForward({ id: 'den-5', name: 'A. Gord', pos: 'PF' }),
  benchScorer({ id: 'den-6', name: 'B. Six', pos: 'SG' }),
  comboGuard({ id: 'den-7', name: 'B. Seven', pos: 'PG' }),
  benchBig({ id: 'den-8', name: 'B. Eight', pos: 'C' }),
  threeAndD({ id: 'den-9', name: 'B. Nine', pos: 'SF' }),
  glueForward({ id: 'den-10', name: 'B. Ten', pos: 'PF' })
], tactics(50, 52, 55));

// ----------------------------------------------------------------- targets

interface Target {
  label: string;
  lo: number;
  hi: number;
  pct?: boolean;
  get: (l: AggLine) => number;
}

interface AggLine extends PlayerLine {
  games: number;
  postShots: number;
  driveShots: number;
}

const per = (f: (l: AggLine) => number) => (l: AggLine) => f(l) / Math.max(1, l.games);

/** composite prime-season ranges — REAL numbers, generous at v1 */
const TARGETS: Record<string, Target[]> = {
  'fid-curry': [
    { label: 'PTS', lo: 23, hi: 32, get: per((l) => l.pts) },
    { label: 'AST', lo: 4.5, hi: 8, get: per((l) => l.ast) },
    { label: 'TRB', lo: 3.5, hi: 6.5, get: per((l) => l.trb) },
    { label: '3PA', lo: 9, hi: 14, get: per((l) => l.tpa) },
    { label: '3P%', lo: 0.38, hi: 0.46, pct: true, get: (l) => l.tpm / Math.max(1, l.tpa) },
    { label: 'FT%', lo: 0.88, hi: 0.97, pct: true, get: (l) => l.ftm / Math.max(1, l.fta) },
    { label: '3PA share', lo: 0.5, hi: 0.72, pct: true, get: (l) => l.tpa / Math.max(1, l.fga) }
  ],
  'fid-lebron': [
    { label: 'PTS', lo: 23, hi: 31, get: per((l) => l.pts) },
    { label: 'AST', lo: 6, hi: 9.5, get: per((l) => l.ast) },
    { label: 'TRB', lo: 6, hi: 9.5, get: per((l) => l.trb) },
    { label: 'FG%', lo: 0.5, hi: 0.59, pct: true, get: (l) => l.fgm / Math.max(1, l.fga) },
    { label: '3PA', lo: 3, hi: 7.5, get: per((l) => l.tpa) },
    { label: 'Drive shots', lo: 2.5, hi: 9, get: per((l) => l.driveShots) }
  ],
  'fid-jokic': [
    { label: 'PTS', lo: 21, hi: 29.5, get: per((l) => l.pts) },
    { label: 'AST', lo: 7, hi: 11.5, get: per((l) => l.ast) },
    { label: 'TRB', lo: 10, hi: 13.5, get: per((l) => l.trb) },
    { label: 'FG%', lo: 0.52, hi: 0.65, pct: true, get: (l) => l.fgm / Math.max(1, l.fga) },
    { label: '3PA', lo: 2, hi: 5.5, get: per((l) => l.tpa) },
    { label: 'Post shots', lo: 2.5, hi: 8, get: per((l) => l.postShots) }
  ]
};

// ------------------------------------------------------------------ runner

const args = process.argv.slice(2);
const gamesIdx = args.indexOf('--games');
const GAMES = gamesIdx >= 0 ? Number(args[gamesIdx + 1]) : 40; // 24-game reads swung +-3 pts between samples

function runBenchmark(bench: Team, starId: string): AggLine {
  let agg: AggLine | null = null;
  for (let i = 0; i < GAMES; i++) {
    const { home, away } = sampleMatchup();
    const opp = i % 2 === 0 ? home : away; // alternate opponents (CAS / MER)
    const flip = i % 4 >= 2;               // alternate home court
    const h = flip ? opp : bench;
    const a = flip ? bench : opp;
    const result = simulateGame({ seed: `fid-${starId}-${i}`, home: h, away: a, collectFrames: false });
    const box = boxScore(result.events, [h, a]);
    const line = box.players.find((p) => p.id === starId);
    if (!line) throw new Error(`no line for ${starId}`);
    let postShots = 0;
    let driveShots = 0;
    for (const e of result.events) {
      if (e.type === 'shot' && e.shooter === starId) {
        if (e.moveType === 'post') postShots++;
        if (e.moveType === 'drive') driveShots++;
      }
    }
    if (!agg) {
      agg = { ...line, games: 1, postShots, driveShots };
    } else {
      agg.games++;
      agg.postShots += postShots;
      agg.driveShots += driveShots;
      for (const k of ['min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'trb', 'ast', 'stl', 'blk', 'tov', 'pf'] as const) {
        agg[k] += line[k];
      }
    }
  }
  return agg!;
}

const fmt = (v: number, pct?: boolean) => (pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));

let failures = 0;
console.log(`Player-fidelity report — ${GAMES} games per benchmark\n`);
for (const bench of [curryTeam, lebronTeam, jokicTeam]) {
  const star = bench.players[0]!;
  const agg = runBenchmark(bench, star.id);
  console.log(`── ${star.name} (${bench.name}) — ${(agg.min / agg.games).toFixed(1)} min/g`);
  for (const t of TARGETS[star.id]!) {
    const v = t.get(agg);
    const ok = v >= t.lo && v <= t.hi;
    if (!ok) failures++;
    console.log(
      ` ${ok ? ' OK ' : 'FAIL'}  ${t.label.padEnd(12)} ${fmt(v, t.pct).padStart(7)}   target ${fmt(t.lo, t.pct)} – ${fmt(t.hi, t.pct)}`
    );
  }
  console.log('');
}
console.log(failures === 0 ? 'All benchmark lines inside their ranges.' : `${failures} range misses.`);
