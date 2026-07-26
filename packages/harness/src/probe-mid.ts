/**
 * Mid-range probe — the measurement artifact for the wave2/midrange mission.
 *
 *   npm run probe:mid [-- --games 8 --seed midprobe]
 *
 * Reports the league shot mix by zone, the DISTANCE distribution inside the
 * mid zone (the diagnosis was that the few "mid" shots were 20-ft arc-toes,
 * not real 16-footers — a share number alone cannot see that), the moveType
 * breakdown of mid attempts, and per-player mid diets for the archetype
 * fixtures whose identities gate the mid-range decisiveness term.
 *
 * Reference (184-game corpus era, real NBA): 14-19.5 ft attempts are ~6.8%
 * of FGA. The sim's pre-fix state: ~1.4% with a ~20 ft median.
 */

import { simulateGame } from '@hoopsh/engine';
import type { GameEvent, ShotEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const games = Number(argOf('--games') ?? 8);
const seedBase = argOf('--seed') ?? 'midprobe';

const shots: ShotEvent[] = [];
let ptsSum = 0;
let possSum = 0;
for (let i = 0; i < games; i++) {
  const { home, away } = sampleMatchup();
  const flip = i % 2 === 1;
  const result = simulateGame({
    seed: `${seedBase}-${i}`,
    home: flip ? away : home,
    away: flip ? home : away,
    collectFrames: false
  });
  for (const ev of result.events as GameEvent[]) {
    if (ev.type === 'shot') shots.push(ev);
    if (ev.type === 'shot' && ev.made) ptsSum += ev.points;
    if (ev.type === 'free_throw' && ev.made) ptsSum += 1;
    if (ev.type === 'possession_end') possSum += 1;
  }
}

const fga = shots.length;
const byZone = { rim: 0, paint: 0, mid: 0, three: 0 };
for (const sh of shots) byZone[sh.zone] += 1;

const mids = shots.filter((sh) => sh.zone === 'mid').map((sh) => sh.distFt).sort((a, b) => a - b);
const band = shots.filter((sh) => sh.distFt >= 14 && sh.distFt <= 19.5);
const made = (arr: ShotEvent[]) => arr.filter((sh) => sh.made).length;

const q = (p: number): number => {
  if (mids.length === 0) return NaN;
  const idx = Math.min(mids.length - 1, Math.floor(p * mids.length));
  return mids[idx]!;
};

console.log(`games=${games} FGA=${fga} (${(fga / (2 * games)).toFixed(1)}/team-game)`);
console.log('zone shares of FGA:');
for (const z of ['rim', 'paint', 'mid', 'three'] as const) {
  const zshots = shots.filter((sh) => sh.zone === z);
  console.log(
    `  ${z.padEnd(5)} ${((byZone[z] / fga) * 100).toFixed(1).padStart(5)}%  ` +
    `FG% ${zshots.length ? ((made(zshots) / zshots.length) * 100).toFixed(1) : '--'}`
  );
}
console.log(`14-19.5 ft band share of FGA: ${((band.length / fga) * 100).toFixed(2)}% (real NBA ~6.8%)`);
console.log(`mid-zone attempts: ${mids.length} (${((mids.length / fga) * 100).toFixed(2)}% of FGA)`);
if (mids.length > 0) {
  console.log(`mid distance p10/p25/p50/p75/p90: ${[0.1, 0.25, 0.5, 0.75, 0.9].map((p) => q(p).toFixed(1)).join(' / ')}`);
  const bins = new Map<string, number>();
  for (const d of mids) {
    const b = `${Math.floor(d / 2) * 2}-${Math.floor(d / 2) * 2 + 2}ft`;
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  console.log('mid distance histogram:', [...bins.entries()].sort().map(([k, v]) => `${k}:${v}`).join(' '));
  const moves = new Map<string, number>();
  const midShots = shots.filter((sh) => sh.zone === 'mid');
  for (const sh of midShots) moves.set(sh.moveType, (moves.get(sh.moveType) ?? 0) + 1);
  console.log('mid moveType mix:', [...moves.entries()].map(([k, v]) => `${k}:${v}`).join(' '));
}

// per-player mid diet for the identity-gate check (rim-runners must NOT
// pick up 16-footers; the mid-identity fixtures should)
const perPlayer = new Map<string, { fga: number; mid: number; midDistSum: number }>();
for (const sh of shots) {
  const rec = perPlayer.get(sh.shooter) ?? { fga: 0, mid: 0, midDistSum: 0 };
  rec.fga += 1;
  if (sh.zone === 'mid') { rec.mid += 1; rec.midDistSum += sh.distFt; }
  perPlayer.set(sh.shooter, rec);
}
console.log('\nper-player mid share (fixtures of interest):');
const interest = [
  ['brk-ratliff', 'rimRunner'], ['mon-halvorsen', 'rimRunner'],
  ['brk-marsh', 'benchBig'], ['mon-yaro', 'benchBig'],
  ['mon-osei', 'postAnchor'], ['brk-vance', 'benchScorer'], ['mon-quick', 'benchScorer'],
  ['brk-holloway', 'scoringWing'], ['mon-adler', 'scoringWing'],
  ['brk-mercer', 'eliteShooter'], ['mon-vance', 'floorGeneral'],
  ['brk-okafor', 'threeAndD'], ['mon-cole', 'comboGuard']
] as const;
for (const [id, arch] of interest) {
  const rec = perPlayer.get(id);
  if (!rec) continue;
  const share = rec.fga ? (rec.mid / rec.fga) * 100 : 0;
  const avgD = rec.mid ? (rec.midDistSum / rec.mid).toFixed(1) : '--';
  console.log(
    `  ${arch.padEnd(12)} ${id.padEnd(14)} FGA/g ${(rec.fga / games).toFixed(1).padStart(4)}  ` +
    `mid/g ${(rec.mid / games).toFixed(2)}  midShare ${share.toFixed(1).padStart(4)}%  avgMidDist ${avgD}`
  );
}
console.log(`\nleague pts/game(team)=${(ptsSum / (2 * games)).toFixed(1)}`);
