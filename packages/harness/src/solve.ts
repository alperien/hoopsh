/**
 * The inverse solver — ratings authoring from a stat line.
 *
 * Input: a target season line (pts / ast / trb / 3PA / 3P% / FT%) plus
 * position and body. Output: a full 38-dial profile whose season-scale sim
 * averages reproduce it, printed as roster-ready JSON.
 *
 * Two phases:
 *   1. ANALYTIC SEED — the engine's forward models are known algebra, so
 *      they invert: FT% inverts the freeThrowP curve (base + swing + elite
 *      kick), 3P% inverts the three-point make logit at a typical
 *      catch-and-shoot contest, scoring volume maps onto the usage dial's
 *      USG% scale, and the remaining dials come from a position archetype.
 *      This lands the search in the right basin for free.
 *   2. LOCAL REFINEMENT — perturbation search over the ~17 stat-relevant
 *      dials, scored by weighted normalized error against the targets,
 *      evaluated on the fidelity harness with common random numbers
 *      (identical game seeds per iteration) so candidates compare fairly.
 *
 * Solved profiles are CONTEXT-RELATIVE: the evaluation embeds the player in
 * a league-neutral cast against the sample teams — the same convention as
 * the fidelity benchmarks. A profile tuned here will drift on a very
 * different roster (that is basketball, not a bug).
 *
 * Run: npm run solve -- --pos PG --pts 27 --ast 7 --trb 5 --tpa 9
 *        [--tppct 0.39] [--ftpct 0.88] [--height 76] [--weight 200]
 *        [--iters 10] [--cands 3] [--games 8] [--name "Solved Player"]
 */

import {
  Rng, clamp, defaultParams, type Player, type Team
} from '@hoopsh/engine';
import {
  benchBig, benchScorer, comboGuard, glueForward, postAnchor, rimRunner,
  scoringWing, threeAndD
} from '@hoopsh/data';
import { runBenchmark, type AggLine } from './fidelity.js';

// -------------------------------------------------------------------- args

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (name: string): number | undefined => {
  const v = flag(name);
  return v === undefined ? undefined : Number(v);
};

const pos = (flag('pos') ?? 'SG') as Player['pos'];
const targets = {
  pts: num('pts'),
  ast: num('ast'),
  trb: num('trb'),
  tpa: num('tpa'),
  tpPct: num('tppct'),
  ftPct: num('ftpct')
};
const ITERS = num('iters') ?? 10;
const CANDS = num('cands') ?? 3;
const GAMES = num('games') ?? 8;
const NAME = flag('name') ?? 'Solved Player';

// ------------------------------------------------------------ analytic seed

/** position archetype = the complete-dial starting template */
const TEMPLATES: Record<Player['pos'], (w: { id: string; name: string; pos: Player['pos'] }) => Player> = {
  PG: comboGuard, SG: scoringWing, SF: threeAndD, PF: glueForward, C: postAnchor
};

function analyticSeed(): Player {
  const p = TEMPLATES[pos]({ id: 'solve-x', name: NAME, pos });
  if (num('height') !== undefined) p.heightIn = num('height')!;
  if (num('weight') !== undefined) p.weightLb = num('weight')!;
  const P = defaultParams;
  const S = P.shot;

  // FT%: invert ft = base + swing·n (+ kick·(n−0.6)/0.4 above the knee)
  if (targets.ftPct !== undefined) {
    const kneeFt = S.ftBasePct + S.ftSkillSwing * 0.6;
    let n: number;
    if (targets.ftPct <= kneeFt) {
      n = (targets.ftPct - S.ftBasePct) / S.ftSkillSwing;
    } else {
      // above the knee both terms are linear in n — solve jointly
      n = (targets.ftPct - S.ftBasePct + (S.ftEliteKick * 0.6) / 0.4) /
          (S.ftSkillSwing + S.ftEliteKick / 0.4);
    }
    p.attr.freeThrow = Math.round(clamp(50 * (1 + n), 1, 99));
  }

  // 3P%: invert the make logit at a typical open catch-and-shoot
  // (contest ≈ 0.3, one foot beyond the line, neutral delivery)
  if (targets.tpPct !== undefined) {
    const logit = Math.log(targets.tpPct / (1 - targets.tpPct));
    const ambient = S.contestCoef * (0.3 - S.contestMidpoint) - 0.055;
    const n = (logit - S.baseThree - ambient) / S.skillCoefThree;
    p.attr.three = Math.round(clamp(50 * (1 + n), 1, 99));
  }

  // scoring volume → usage (the dial IS a USG% scale: 50 = 20%, +10 = +2.4%)
  if (targets.pts !== undefined) {
    p.tend.usage = Math.round(clamp(50 + (targets.pts - 13) * 2.1, 15, 99));
  }
  // three-point appetite from attempt volume
  if (targets.tpa !== undefined) {
    p.tend.shotThree = Math.round(clamp(35 + targets.tpa * 4.5, 5, 99));
    p.tend.pullUp = Math.round(clamp(30 + targets.tpa * 3, 10, 95));
  }
  // playmaking from assists (creation routing needs handle+vision together)
  if (targets.ast !== undefined) {
    p.attr.passVision = Math.round(clamp(42 + targets.ast * 6, 25, 99));
    p.attr.passAcc = Math.round(clamp(45 + targets.ast * 5, 25, 99));
    p.tend.passOut = Math.round(clamp(38 + targets.ast * 4, 20, 95));
    p.attr.ballHandle = Math.round(clamp(Math.max(p.attr.ballHandle, p.attr.passVision - 8), 25, 99));
  }
  // rebounding from boards
  if (targets.trb !== undefined) {
    p.attr.defReb = Math.round(clamp(28 + targets.trb * 5.5, 15, 99));
    p.attr.boxout = Math.round(clamp(p.attr.defReb - 6, 10, 99));
    p.attr.offReb = Math.round(clamp(12 + targets.trb * 3.5, 5, 99));
  }
  return p;
}

// ------------------------------------------------------------------- scorer

interface Achieved { pts: number; ast: number; trb: number; tpa: number; tpPct: number; ftPct: number }

function lineOf(agg: AggLine): Achieved {
  const g = Math.max(1, agg.games);
  return {
    pts: agg.pts / g, ast: agg.ast / g, trb: agg.trb / g, tpa: agg.tpa / g,
    tpPct: agg.tpm / Math.max(1, agg.tpa), ftPct: agg.ftm / Math.max(1, agg.fta)
  };
}

/** weighted normalized squared error — scales are "one noticeable unit" */
const SCALES: Record<keyof Achieved, number> = {
  pts: 2.5, ast: 1.1, trb: 1.1, tpa: 1.2, tpPct: 0.02, ftPct: 0.025
};

function scoreLine(a: Achieved): number {
  let err = 0;
  for (const k of Object.keys(SCALES) as (keyof Achieved)[]) {
    const t = targets[k];
    if (t === undefined) continue;
    const d = (a[k] - t) / SCALES[k];
    err += d * d;
  }
  return err;
}

// --------------------------------------------------------------- evaluation

/** league-neutral supporting cast, fidelity-benchmark convention */
function hostTeam(star: Player): Team {
  const cast = [
    comboGuard({ id: 'sv-2', name: 'Cast Two', pos: 'PG' }),
    threeAndD({ id: 'sv-3', name: 'Cast Three', pos: 'SG' }),
    glueForward({ id: 'sv-4', name: 'Cast Four', pos: 'PF' }),
    rimRunner({ id: 'sv-5', name: 'Cast Five', pos: 'C' }),
    benchScorer({ id: 'sv-6', name: 'Cast Six', pos: 'SG' }),
    threeAndD({ id: 'sv-7', name: 'Cast Seven', pos: 'SF' }),
    benchBig({ id: 'sv-8', name: 'Cast Eight', pos: 'C' }),
    glueForward({ id: 'sv-9', name: 'Cast Nine', pos: 'PF' }),
    comboGuard({ id: 'sv-10', name: 'Cast Ten', pos: 'PG' })
  ];
  return {
    id: 'fid-solve', name: 'Solver Hosts', abbrev: 'SLV',
    players: [star, ...cast],
    starters: [star.id, 'sv-2', 'sv-3', 'sv-4', 'sv-5'],
    tactics: { pace: 50, threeBias: 50, helpAggr: 50 },
    rotationMinutes: { [star.id]: 35 }
  };
}

function evaluate(p: Player, games: number): { score: number; line: Achieved } {
  const agg = runBenchmark(hostTeam(p), p.id, games);
  const line = lineOf(agg);
  return { score: scoreLine(line), line };
}

// --------------------------------------------------------------- refinement

/** the stat-relevant dial subset the search may move */
const SEARCH_DIALS: { path: 'attr' | 'tend'; key: string }[] = [
  { path: 'attr', key: 'three' }, { path: 'attr', key: 'midRange' },
  { path: 'attr', key: 'finishing' }, { path: 'attr', key: 'freeThrow' },
  { path: 'attr', key: 'passVision' }, { path: 'attr', key: 'passAcc' },
  { path: 'attr', key: 'ballHandle' }, { path: 'attr', key: 'defReb' },
  { path: 'attr', key: 'offReb' }, { path: 'attr', key: 'boxout' },
  { path: 'tend', key: 'usage' }, { path: 'tend', key: 'shotThree' },
  { path: 'tend', key: 'shotRim' }, { path: 'tend', key: 'pullUp' },
  { path: 'tend', key: 'drive' }, { path: 'tend', key: 'passOut' },
  { path: 'tend', key: 'offBallMotion' }
];

function perturb(rng: Rng, base: Player, step: number): Player {
  const p: Player = structuredClone(base);
  // move 2-4 random dials per candidate — small, local moves
  const moves = 2 + Math.floor(rng.float() * 3);
  for (let m = 0; m < moves; m++) {
    const d = SEARCH_DIALS[Math.floor(rng.float() * SEARCH_DIALS.length)]!;
    const bag = d.path === 'attr' ? (p.attr as unknown as Record<string, number>) : (p.tend as unknown as Record<string, number>);
    bag[d.key] = Math.round(clamp(bag[d.key]! + (rng.float() * 2 - 1) * step, 1, 99));
  }
  return p;
}

// --------------------------------------------------------------------- main

const fmtA = (a: Achieved) =>
  `pts ${a.pts.toFixed(1)}  ast ${a.ast.toFixed(1)}  trb ${a.trb.toFixed(1)}  ` +
  `3PA ${a.tpa.toFixed(1)}  3P% ${(a.tpPct * 100).toFixed(1)}  FT% ${(a.ftPct * 100).toFixed(1)}`;

// an empty objective is a no-op, not a solve: without this, a bare
// `npm run solve` reported err 0.00 "convergence" on nothing and printed an
// unoptimized profile as a success (independent-review finding)
if (Object.values(targets).every((v) => v === undefined)) {
  console.error('solve: no targets given — pass at least one of --pts --ast --trb --tpa --tppct --ftpct');
  console.error('example: npm run solve -- --pos PG --pts 27 --ast 7 --trb 5 --tpa 9 --tppct 0.39');
  process.exit(1);
}

const rng = new Rng('inverse-solver');
let best = analyticSeed();
let bestEval = evaluate(best, GAMES);
console.log(`analytic seed        err ${bestEval.score.toFixed(2)}   ${fmtA(bestEval.line)}`);

let step = 14;
for (let i = 1; i <= ITERS; i++) {
  for (let c = 0; c < CANDS; c++) {
    const cand = perturb(rng, best, step);
    const ev = evaluate(cand, GAMES);
    if (ev.score < bestEval.score) {
      best = cand;
      bestEval = ev;
    }
  }
  console.log(`iter ${String(i).padStart(2)}  step ${step.toFixed(1).padStart(4)}  err ${bestEval.score.toFixed(2)}   ${fmtA(bestEval.line)}`);
  step = Math.max(4, step * 0.85);
}

const final = evaluate(best, Math.max(20, GAMES * 2));
console.log(`\nverify (${Math.max(20, GAMES * 2)} games)  err ${final.score.toFixed(2)}   ${fmtA(final.line)}`);
console.log('targets              ' + Object.entries(targets).filter(([, v]) => v !== undefined)
  .map(([k, v]) => `${k} ${v}`).join('  '));
console.log('\n— solved profile (roster-ready JSON) —');
console.log(JSON.stringify(best, null, 2));
