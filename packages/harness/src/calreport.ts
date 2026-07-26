/**
 * Calibration report — where the sim actually SITS, computed, not eyeballed.
 *
 * The noise floor (noise-floor.gen.ts) holds everything needed to state the
 * sim's position precisely, but a 500-line generated table read by eye loses
 * patterns — the third review demonstrated this by computing, from our own
 * table, a 12-metric directional signature (friction/volume statistics
 * pinned near band floors, accuracy/efficiency statistics pinned near
 * ceilings) that the hand-written report had reduced to "two grazes".
 * This tool makes that computation permanent.
 *
 * Doctrine it enforces:
 *   - CENTERS are quoted from the LARGEST window (n40 — the grand mean over
 *     every simulated game), with a standard error (sd/√bases). Quoting a
 *     smaller nested window's mean as "the center" is the error the review
 *     caught: the n24/n12 numbers exist for GATE widths, not for position.
 *   - Distances to band edges are reported both in gate-σ (n24 sd — what the
 *     tripwire feels) and in se units (what the position claim can support).
 *   - |distance| < 2·se ⇒ "edge-unresolved": the sample cannot say which
 *     side of the edge the true center is on. Say that, not "on the edge".
 *
 * Run: npm run calreport
 */

import { NOISE_FLOOR } from './noise-floor.gen.js';
import { NBA_BANDS } from './bands.js';
import { TARGETS } from './fidelity.js';

interface M { mean: number; sd: number; n: number }
type LeagueRow = { n12: M; n24: M; n40: M };

const league = NOISE_FLOOR.league as unknown as Record<string, LeagueRow>;
const stars = NOISE_FLOOR.stars as unknown as Record<string, Record<string, { n12: M; n40: M }>>;

const fmt = (x: number, pct: boolean) => (pct ? `${(100 * x).toFixed(1)}%` : x.toFixed(2));

console.log(`Calibration report — centers from n40 (grand mean), gates from n24/n12 sd`);
console.log(`floor sample: ${NOISE_FLOOR.meta.leagueBases} league bases; generated ${NOISE_FLOOR.meta.generatedAt}\n`);

interface Sig { metric: string; edge: 'floor' | 'ceiling'; gateSigma: number; seDist: number }
const signature: Sig[] = [];

console.log('── league (band metrics)');
for (const b of NBA_BANDS) {
  const r = league[b.metric];
  if (!r) continue;
  const c = r.n40.mean;
  const se = r.n40.sd / Math.sqrt(r.n40.n);
  const gateSd = r.n24.sd;
  const dLo = c - b.lo;
  const dHi = b.hi - c;
  const nearFloor = Math.abs(dLo) < Math.abs(dHi);
  const d = nearFloor ? dLo : dHi; // positive = inside the band
  const seDist = d / se;
  const gateSigma = d / gateSd;
  const pct = b.lo > 0 && b.lo < 1;
  const pos =
    seDist < -2 ? 'OUTSIDE' :
    Math.abs(seDist) < 2 ? 'edge-unresolved' :
    gateSigma < 1.5 ? 'hugs edge' : 'inside';
  if (pos !== 'inside') signature.push({ metric: b.metric, edge: nearFloor ? 'floor' : 'ceiling', gateSigma, seDist });
  console.log(
    `  ${b.metric.padEnd(10)} center ${fmt(c, pct).padStart(7)} ±${fmt(se, pct)}se` +
    `  band [${fmt(b.lo, pct)} .. ${fmt(b.hi, pct)}]` +
    `  nearest ${nearFloor ? 'floor' : 'ceil '} ${gateSigma >= 0 ? '+' : ''}${gateSigma.toFixed(1)}σ / ${seDist >= 0 ? '+' : ''}${seDist.toFixed(1)}se` +
    `  ${pos}${b.ratchet ? ' (ratchet)' : ''}`
  );
}

if (signature.length > 0) {
  console.log('\n── signature (metrics at/near edges, grouped by direction)');
  const floors = signature.filter((s) => s.edge === 'floor').map((s) => s.metric);
  const ceils = signature.filter((s) => s.edge === 'ceiling').map((s) => s.metric);
  if (floors.length) console.log(`  hugging floors:   ${floors.join(', ')}`);
  if (ceils.length) console.log(`  hugging ceilings: ${ceils.join(', ')}`);
  console.log('  read the lists as ONE defect with a direction, not independent grazes');
}

console.log('\n── star benchmarks (identity targets; centers from n40)');
for (const [starId, targets] of Object.entries(TARGETS)) {
  const floor = stars[starId];
  if (!floor) continue;
  for (const t of targets) {
    const r = floor[t.label];
    if (!r) continue;
    const c = r.n40.mean;
    const se = r.n40.sd / Math.sqrt(r.n40.n);
    const inside = c >= t.lo && c <= t.hi;
    const d = inside ? Math.min(c - t.lo, t.hi - c) : c < t.lo ? c - t.lo : c - t.hi; // signed: negative below floor, positive above ceiling when outside
    const flag = inside ? 'inside' : `OUTSIDE by ${fmt(Math.abs(d), !!t.pct)} (${(Math.abs(d) / se).toFixed(1)}se)`;
    console.log(
      `  ${starId.replace('fid-', '').padEnd(7)} ${t.label.padEnd(10)} center ${fmt(c, !!t.pct).padStart(7)} ±${fmt(se, !!t.pct)}se` +
      `  target [${fmt(t.lo, !!t.pct)} .. ${fmt(t.hi, !!t.pct)}]  ${flag}${t.ratchet ? ' (ratchet)' : ''}`
    );
  }
}
