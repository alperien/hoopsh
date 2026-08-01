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
 * The exit code is the gate (issue #43): any enforced-row miss exits 1.
 * Ratchet rows (RTCH) and quarantined rows (QUAR) report loudly and never
 * gate — see Target.ratchet / Target.quarantine below for what each means.
 */

import { simulateGame, type Player, type Team } from '@hoopsh/engine';
import { boxScore, type PlayerLine } from '@hoopsh/stats';
import { checkFlags, flagNumber } from './args.js';
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
    ballHandle: 96, passAcc: 86, passVision: 72,
    perimeterD: 55, interiorD: 25, steal: 68, block: 12, contestSkill: 45,
    offReb: 22, defReb: 48, boxout: 25,
    decisions: 90, consistency: 85
  },
  tend: {
    shotRim: 26, shotMid: 20, shotThree: 86, pullUp: 66,
    drive: 38, passOut: 48, iso: 55, post: 3,
    offBallMotion: 96, crashOffReb: 8,
    gambleSteal: 55, foulAggr: 25, pushPace: 70, usage: 91
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
    // freeThrow 61 — the engine's own curve is the citation (W7 fixture
    // correction): resolve.ts#freeThrowP at 61 gives ftBasePct 0.69 +
    // ftSkillSwing 0.19 × n(61)=0.22 → 73.2% (elite kick starts at 80),
    // matching his real ~73.1%. The original hand-set 74 shot 78.1% through
    // the same curve — 5 points hot.
    finishing: 97, midRange: 82, three: 76, freeThrow: 61, drawFoul: 88,
    ballHandle: 90, passAcc: 95, passVision: 97,
    perimeterD: 72, interiorD: 70, steal: 70, block: 62, contestSkill: 65,
    offReb: 45, defReb: 86, boxout: 62,
    decisions: 96, consistency: 88
  },
  tend: {
    shotRim: 56, shotMid: 24, shotThree: 76, pullUp: 64,
    drive: 84, passOut: 70, iso: 60, post: 35,
    offBallMotion: 45, crashOffReb: 42,
    gambleSteal: 45, foulAggr: 40, pushPace: 75, usage: 90
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
    speed: 45, accel: 42, lateral: 38, stamina: 93, strength: 96, vertical: 35,
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
    gambleSteal: 40, foulAggr: 30, pushPace: 45, usage: 92
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
  rotationMinutes: { [star.id]: 35 } // real star load is ~34-35.5 a night
});

/** motion-and-gravity cast: a connector forward, shooting, and a rim-runner */
// The point-forward hub is the CAST mechanism that shapes the real elite
// shooter's assist profile: the offense INITIATES through the forward while
// the star plays off-ball, so the star's assists cap in the 5-7 range and
// his own makes become assisted catch-and-shoots. Authored after the noise
// floor measured his 40-game AST center at 9.64 vs the 4.5-8.5 identity
// range (+2σ) — the engine was giving him his hub's assists because the
// cast had no second creator to route through.
const dGreen = glueForward({ id: 'gsw-4', name: 'D. Green', pos: 'PF' });
dGreen.attr.passVision = 90;
dGreen.attr.passAcc = 86;
dGreen.attr.ballHandle = 74;
dGreen.tend.passOut = 78;
dGreen.tend.usage = 28; // initiates constantly, consumes possessions rarely

const curryTeam = team('fid-gsw', 'Bay Splash', 'BAY', curry, [
  comboGuard({ id: 'gsw-2', name: 'K. Poole', pos: 'SG' }),
  threeAndD({ id: 'gsw-3', name: 'A. Wiggs', pos: 'SF' }),
  dGreen,
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

export interface Target {
  label: string;
  lo: number;
  hi: number;
  pct?: boolean;
  /** declared destination, not yet an enforced floor — reported by the CLI,
   *  skipped by the test gate until its mechanism lands (same convention as
   *  Band.ratchet in bands.ts) */
  ratchet?: boolean;
  /** enforcement suspended pending the named owner ruling (a docs/REGISTER.md
   *  row, e.g. 'W29'). The CLI prints the miss loudly (QUAR mark plus a
   *  summary block) but does not count it toward the nonzero exit — a run
   *  red only on quarantined rows exits 0, so the exit code stays a signal
   *  for NEW regressions instead of permanent noise. UNLIKE ratchet rows,
   *  quarantined rows STAY in the widened tripwire (fidelity.test.ts): a
   *  further regression on a quarantined row still fails CI. Same
   *  loud-but-not-gating shape as ratchet, different meaning — ratchet: the
   *  mechanism has not landed; quarantine: the ruling on WHICH side moves
   *  (target vs fixture/engine) is pending. Set at most one of the two.
   *  Remove the flag when the ruling lands, whichever way it goes.
   *  The register-reference shape is enforced twice (PR #73 review): the
   *  template literal type gates the types CI job, and the zero-simulation
   *  inventory test in fidelity.test.ts gates every local `npm test`, where
   *  tsc is unavailable by design. */
  quarantine?: `W${number}`;
  get: (l: AggLine) => number;
}

export interface AggLine extends PlayerLine {
  games: number;
  postShots: number;
  driveShots: number;
}

const per = (f: (l: AggLine) => number) => (l: AggLine) => f(l) / Math.max(1, l.games);

/** the four states a graded row can land in; 'fail' is the only one that
 *  reaches the CLI's nonzero exit (issue #43) */
export type TargetGrade = 'ok' | 'fail' | 'ratchet-miss' | 'quarantined-miss';

/**
 * Grade one target row against its measured value. Pure — no side effects.
 * Called by the CLI runner below for every row; pinned by
 * harness/test/fidelity.test.ts. A value inside the range grades 'ok'
 * regardless of flags; outside it, ratchet outranks quarantine (rows should
 * carry at most one of the two — see the Target field docs).
 */
export function gradeTarget(t: Target, v: number): TargetGrade {
  if (v >= t.lo && v <= t.hi) return 'ok';
  if (t.ratchet) return 'ratchet-miss';
  return t.quarantine ? 'quarantined-miss' : 'fail';
}

/**
 * Composite prime-season ranges — REAL numbers. v2 tightened the slack edges
 * (the sides reality never approached); the contested edges are untouched.
 * Two rows are RATCHETS — real targets whose mechanisms are only partly
 * landed: downhill 3PA (the transition pull-up exists and doubled his
 * attempts, but reaching 3+ needs a larger transition share of his touches)
 * and hub Post shots (REGISTER W58 — real post-entry generation is the
 * missing mechanism). Two rows are QUARANTINED pending owner rulings (hub
 * TRB → W29, shooter AST → W71): reported loudly, not counted toward the
 * exit code, still gated by the widened tripwire. Quarantined target values
 * stay untouched while the ruling is pending — the ruling decides which
 * side moves.
 */
export const TARGETS: Record<string, Target[]> = {
  'fid-curry': [
    { label: 'PTS', lo: 24, hi: 32, get: per((l) => l.pts) },
    // QUARANTINED pending REGISTER W71: the W69 generalization audit
    // confirmed the probe era drifted the elite shooter's assists above his
    // identity ceiling at n=40 (W71 measured 9.0 vs the 8.5 ceiling; the
    // issue-#42 committed floor reads n40 grand center 8.64, se ≈ 0.15,
    // ~1.0 se over; the deterministic 40-game CLI slate reads 9.1). Accept
    // the redistributed archetype vs trim the fixture/probe dose is a
    // registered owner TRADE (a dose trim pays back the W69 pass-volume
    // win), not a bug fix — enforcement suspended until that ruling lands
    // (issue #43). Range deliberately untouched.
    { label: 'AST', lo: 4.5, hi: 8.5, quarantine: 'W71', get: per((l) => l.ast) },
    { label: 'TRB', lo: 3.5, hi: 6, get: per((l) => l.trb) },
    { label: '3PA', lo: 10, hi: 14, get: per((l) => l.tpa) },
    { label: '3P%', lo: 0.38, hi: 0.455, pct: true, get: (l) => l.tpm / Math.max(1, l.tpa) },
    { label: 'FT%', lo: 0.88, hi: 0.965, pct: true, get: (l) => l.ftm / Math.max(1, l.fta) },
    { label: '3PA share', lo: 0.5, hi: 0.68, pct: true, get: (l) => l.tpa / Math.max(1, l.fga) }
  ],
  'fid-lebron': [
    { label: 'PTS', lo: 23, hi: 30, get: per((l) => l.pts) },
    { label: 'AST', lo: 6, hi: 9.2, get: per((l) => l.ast) },
    { label: 'TRB', lo: 6, hi: 9, get: per((l) => l.trb) },
    { label: 'FG%', lo: 0.5, hi: 0.58, pct: true, get: (l) => l.fgm / Math.max(1, l.fga) },
    { label: '3PA', lo: 3, hi: 7.5, ratchet: true, get: per((l) => l.tpa) },
    { label: 'Drive shots', lo: 2.5, hi: 8, get: per((l) => l.driveShots) }
  ],
  'fid-jokic': [
    { label: 'PTS', lo: 19.5, hi: 28.5, get: per((l) => l.pts) },
    { label: 'AST', lo: 7, hi: 11, get: per((l) => l.ast) },
    // QUARANTINED pending REGISTER W29: the 10.0 floor WAS earned (minutes
    // controller + guard-crash economy) and enforced, but the engine
    // re-centered under it across later waves — committed noise floor
    // (issue #42 regen) n40 grand center 9.02, 8 bases, sd 0.26, se ≈ 0.09:
    // the floor sits ~10.7 se above the center. The deterministic 40-game
    // CLI slate reads 9.0. Whether the target re-bases (accept
    // garbage-rested centers) or the fixture moves (rotationMinutes 35 → 36)
    // is the open W29 owner ruling — enforcement suspended until it lands
    // (issue #43). Range deliberately untouched.
    { label: 'TRB', lo: 10, hi: 13, quarantine: 'W29', get: (l) => l.trb / Math.max(1, l.games) },
    { label: 'FG%', lo: 0.52, hi: 0.64, pct: true, get: (l) => l.fgm / Math.max(1, l.fga) },
    { label: '3PA', lo: 2, hi: 5.5, get: per((l) => l.tpa) },
    // ratchet: the 1.8 floor was never met — measured @40: 1.10 at this
    // gate's own landing arc (B2, b9346a1), 0.825 at post-audit main
    // (1897f8c), 0.825 with the flow flips live (they moved it exactly 0),
    // 0.60 after the flow re-fit (pullUpThreeBonus 0.70 trades post
    // touches for the G5 unassisted-3 volume; findings/refit-g5.md). The
    // wide era-floor n12 sds kept the z=3 tripwire green over the whole
    // trail; the flow-era floor regen tightened sd to ~0.12 and exposed
    // it. The missing mechanism is real post-entry generation — the same
    // interior-pressure root as flowboard G11 (rim share inverted, dunks
    // low) and D3's post fragility: REGISTER W53/W57/W58. Flip back when
    // the mechanics arc lands the post game.
    { label: 'Post shots', lo: 1.8, hi: 7, ratchet: true, get: per((l) => l.postShots) }
  ]
};

// ------------------------------------------------------------------ runner

export const BENCHMARKS: Team[] = [curryTeam, lebronTeam, jokicTeam];

export function runBenchmark(bench: Team, starId: string, games: number, seedBase = 'fid'): AggLine {
  // A zero/NaN game count used to skip the loop entirely and return `agg!`
  // — null typed as AggLine — so the caller crashed at its first property
  // read with an opaque TypeError (scan finding B3-1). A benchmark over no
  // games is a misconfiguration, never a measurement: same doctrine as
  // cli.ts's --games guard (red-team MINOR-4).
  if (!Number.isInteger(games) || games < 1) {
    throw new Error(`runBenchmark: games must be an integer >= 1, got ${games}`);
  }
  let agg: AggLine | null = null;
  for (let i = 0; i < games; i++) {
    const { home, away } = sampleMatchup();
    const opp = i % 2 === 0 ? home : away; // alternate opponents (CAS / MER)
    const flip = i % 4 >= 2;               // alternate home court
    const h = flip ? opp : bench;
    const a = flip ? bench : opp;
    const result = simulateGame({ seed: `${seedBase}-${starId}-${i}`, home: h, away: a, collectFrames: false });
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
      // NOTE: `zones` and `plusMinus` ride along from game 1's PlayerLine
      // spread and are NEVER accumulated — the loop below sums only the 16
      // listed counting keys, so on the returned AggLine those two fields
      // are first-game values wearing an aggregate's type. No current
      // consumer reads them (TARGETS getters, the CLI report, and
      // noisefloor.ts stick to the summed keys); a zone-based fidelity
      // target must fix the accumulation first (scan finding B3-5).
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
  // non-null: the games >= 1 guard above means the loop ran and assigned agg
  return agg!;
}

const fmt = (v: number, pct?: boolean) => (pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));

// the CLI report — the fine-grained 40-game read (the fast, widened GATE
// lives in packages/harness/test/fidelity.test.ts, same two-tier pattern as
// the band report vs the wide-band regression guard)
if (import.meta.main) {
  // args.ts's loud parser, not a bare Number(): `--games` dangling or typo'd
  // used to become NaN, skip every benchmark loop, and crash at the report
  // with an opaque null-property TypeError (scan finding B3-1 — the exact
  // incident class args.ts's header documents). checkFlags rejects unknown
  // and `=`-spelled flags the exact-token parser cannot see (audit H-03).
  checkFlags(process.argv, ['--games']);
  const games = flagNumber(process.argv, '--games', 40); // shorter reads swing +-3 pts
  if (!Number.isInteger(games) || games < 1) {
    console.error(`--games requires an integer >= 1, got ${games} — refusing to grade a run that simulates nothing`);
    process.exit(1);
  }
  let failures = 0;
  const quarantined: string[] = [];
  console.log(`Player-fidelity report — ${games} games per benchmark\n`);
  for (const bench of BENCHMARKS) {
    const star = bench.players[0]!;
    const agg = runBenchmark(bench, star.id, games);
    console.log(`── ${star.name} (${bench.name}) — ${(agg.min / agg.games).toFixed(1)} min/g`);
    for (const t of TARGETS[star.id]!) {
      const v = t.get(agg);
      const grade = gradeTarget(t, v);
      if (grade === 'fail') failures++;
      if (grade === 'quarantined-miss') {
        quarantined.push(`${star.name} ${t.label}: ${fmt(v, t.pct)} vs ${fmt(t.lo, t.pct)} – ${fmt(t.hi, t.pct)}  (docs/REGISTER.md ${t.quarantine})`);
      }
      const mark = grade === 'ok' ? ' OK ' : grade === 'ratchet-miss' ? 'RTCH' : grade === 'quarantined-miss' ? 'QUAR' : 'FAIL';
      console.log(
        ` ${mark}  ${t.label.padEnd(12)} ${fmt(v, t.pct).padStart(7)}   target ${fmt(t.lo, t.pct)} – ${fmt(t.hi, t.pct)}`
      );
    }
    console.log('');
  }
  if (quarantined.length > 0) {
    // loud by design: a quarantined miss must never read as a clean run
    console.log('QUARANTINED pending owner ruling — reported, NOT counted toward the exit code:');
    for (const q of quarantined) console.log(`  ${q}`);
    console.log('');
  }
  if (failures > 0) {
    // The exit code IS the gate (cli.ts band-gate doctrine). This block used
    // to print the miss count and fall off the end of the file — exit 0 with
    // FAIL rows on the board, the silent-regression channel issue #43 closed
    // (H-validate-1: Jokić TRB sat far under its enforced floor — ~10.7 se
    // at the issue-#42 committed floor — while the run reported success to
    // every script checking exit codes).
    console.error(`${failures} enforced range miss(es) — the exit code is the gate (issue #43).`);
    process.exit(1);
  }
  console.log('All enforced benchmark lines inside their ranges.');
}
