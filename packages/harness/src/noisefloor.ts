/**
 * Noise floor — the sampling distribution of every gated statistic under the
 * null hypothesis (identical params, different seeds).
 *
 * The external review's sharpest process finding: "nobody has established
 * the sampling distribution of these statistics, so the thresholds are set
 * by feel and the widths are set by feel to compensate" — which makes it
 * impossible to tell "the sim changed" from "the seed changed". This tool
 * measures that distribution directly: many same-params batches across
 * independent seed bases, per-statistic mean and standard deviation at the
 * exact sample sizes the gates use (12 / 24 / 40 games).
 *
 * The gates then derive their widths FROM the measured floor (band edge
 * ± z·sd) instead of feel-widened percentages — see realism.test.ts and
 * fidelity.test.ts, which import the generated table.
 *
 * Run:
 *   npm run noisefloor -- --mode league   (writes out/noise-league.json)
 *   npm run noisefloor -- --mode stars    (writes out/noise-stars.json)
 *   npm run noisefloor -- --mode emit     (merges both into src/noise-floor.gen.ts)
 * Split into modes so each stage fits a CI/tool time budget; 'all' runs the
 * three in sequence.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { simulateGame } from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { sampleMatchup } from '@hoopsh/data';
import { accumulate, emptyAcc, finalize, type LeagueAverages } from './aggregate.js';
import { NBA_BANDS } from './bands.js';
import { BENCHMARKS, TARGETS, runBenchmark } from './fidelity.js';

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const MODE = argOf('--mode') ?? 'all';
const LEAGUE_BASES = Number(argOf('--leagueBases') ?? 20);
const STAR_BASES_12 = Number(argOf('--starBases12') ?? 8);
const STAR_BASES_40 = Number(argOf('--starBases40') ?? 4);

interface Moments { mean: number; sd: number; n: number }
function moments(xs: number[]): Moments {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const varc = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, xs.length - 1);
  return { mean, sd: Math.sqrt(varc), n: xs.length };
}

// ------------------------------------------------------------------- league

function leagueFloor(): Record<string, Record<string, Moments>> {
  console.log(`league: ${LEAGUE_BASES} seed bases × 40 games (windows: 3×12, 1×24, 1×40)`);
  // per metric, per window size: list of window-mean samples
  const samples: Record<string, Record<'n12' | 'n24' | 'n40', number[]>> = {};
  for (const b of NBA_BANDS) samples[b.metric] = { n12: [], n24: [], n40: [] };

  for (let base = 0; base < LEAGUE_BASES; base++) {
    const acc12 = [emptyAcc(), emptyAcc(), emptyAcc()];
    const acc24 = emptyAcc();
    const acc40 = emptyAcc();
    for (let g = 0; g < 40; g++) {
      const { home, away } = sampleMatchup();
      const flip = g % 2 === 1;
      const result = simulateGame({
        seed: `nf-${base}-${g}`,
        home: flip ? away : home,
        away: flip ? home : away,
        collectFrames: false
      });
      const box = boxScore(result.events, [flip ? away : home, flip ? home : away]);
      accumulate(acc40, box);
      if (g < 24) accumulate(acc24, box);
      if (g < 36) accumulate(acc12[Math.floor(g / 12)]!, box);
    }
    const record = (avgs: LeagueAverages, key: 'n12' | 'n24' | 'n40') => {
      for (const b of NBA_BANDS) samples[b.metric]![key].push(avgs[b.metric]!);
    };
    for (const a of acc12) record(finalize(a), 'n12');
    record(finalize(acc24), 'n24');
    record(finalize(acc40), 'n40');
    process.stdout.write(`  base ${base + 1}/${LEAGUE_BASES}\r`);
  }
  console.log('');
  const out: Record<string, Record<string, Moments>> = {};
  for (const b of NBA_BANDS) {
    out[b.metric] = {
      n12: moments(samples[b.metric]!.n12),
      n24: moments(samples[b.metric]!.n24),
      n40: moments(samples[b.metric]!.n40)
    };
  }
  return out;
}

// -------------------------------------------------------------------- stars

function starFloor(): Record<string, Record<string, Record<string, Moments>>> {
  const out: Record<string, Record<string, Record<string, Moments>>> = {};
  for (const bench of BENCHMARKS) {
    const starId = bench.players[0]!.id; // convention: the star is players[0], TARGETS keys on his id
    const targets = TARGETS[starId];
    if (!targets) continue;
    console.log(`star ${starId}: ${STAR_BASES_12} bases × 12 games + ${STAR_BASES_40} bases × 40 games`);
    const s12: Record<string, number[]> = {};
    const s40: Record<string, number[]> = {};
    for (const t of targets) { s12[t.label] = []; s40[t.label] = []; }
    for (let b = 0; b < STAR_BASES_12; b++) {
      const agg = runBenchmark(bench, starId, 12, `nf12x${b}`);
      for (const t of targets) s12[t.label]!.push(t.get(agg));
    }
    for (let b = 0; b < STAR_BASES_40; b++) {
      const agg = runBenchmark(bench, starId, 40, `nf40x${b}`);
      for (const t of targets) s40[t.label]!.push(t.get(agg));
    }
    out[starId] = {};
    for (const t of targets) {
      out[starId]![t.label] = { n12: moments(s12[t.label]!), n40: moments(s40[t.label]!) };
    }
  }
  return out;
}

// --------------------------------------------------------------------- emit

function emit(): void {
  const league = JSON.parse(readFileSync('out/noise-league.json', 'utf8'));
  const stars = JSON.parse(readFileSync('out/noise-stars.json', 'utf8'));
  const gen = {
    meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      leagueBases: LEAGUE_BASES,
      starBases12: STAR_BASES_12,
      starBases40: STAR_BASES_40,
      note: 'Sampling spread under the null (same params, different seeds). Regenerate after mechanics/param changes: npm run noisefloor'
    },
    league,
    stars
  };
  const body =
    `/**\n * GENERATED by \`npm run noisefloor\` — DO NOT HAND-EDIT.\n *\n` +
    ` * The measured sampling distribution (mean, sd, sample count) of every\n` +
    ` * gated statistic under the null, at the gates' sample sizes. The gates\n` +
    ` * derive widths from these sd values (edge ± z·sd) so a failure means\n` +
    ` * "the sim changed", not "the seed changed". Regenerate after mechanics\n` +
    ` * or calibration changes; the diff IS the noise-floor drift record.\n */\n\n` +
    `export const NOISE_FLOOR = ${JSON.stringify(gen, null, 2)} as const;\n`;
  writeFileSync('packages/harness/src/noise-floor.gen.ts', body);
  console.log('wrote packages/harness/src/noise-floor.gen.ts');
}

mkdirSync('out', { recursive: true });
if (MODE === 'league' || MODE === 'all') {
  writeFileSync('out/noise-league.json', JSON.stringify(leagueFloor(), null, 1));
  console.log('wrote out/noise-league.json');
}
if (MODE === 'stars' || MODE === 'all') {
  writeFileSync('out/noise-stars.json', JSON.stringify(starFloor(), null, 1));
  console.log('wrote out/noise-stars.json');
}
if (MODE === 'emit' || MODE === 'all') emit();
