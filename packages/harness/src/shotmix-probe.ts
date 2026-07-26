/**
 * Shot-mix / transition probe (wave2/shotmix) — the before/after instrument
 * for the decision-layer taxonomy + transition-urgency fixes.
 *
 * Measures, over a small batch (default 12 games, mirrored matchup — same
 * per-game path as runBatch):
 *   • shot-type mix: share of ATTEMPTS and MAKES by moveType, plus the
 *     interior-mislabel share (catch_shoot attempts from rim/paint — the
 *     taxonomy artifact this branch removes)
 *   • zone mix (rim/paint/mid/three shares of FGA) and per-zone FG%
 *   • assisted share of made FGs
 *   • flow grammar: OREB→putback ≤6s share (real 0.716) and
 *     steal→score ≤6s share (real 0.293), both with the exact
 *     flow-metrics.ts scan definitions
 *
 * Report-only: this is a probe, not a gate (gates live in test/flow.test.ts
 * and test/shotmix.test.ts). Run:
 *   node --disable-warning=ExperimentalWarning --import ./tools/register.mjs \
 *     packages/harness/src/shotmix-probe.ts [--games 12 --seed shotmix]
 */

import { simulateGame, type GameEvent, type ShotMoveType } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { flagNumber, flagValue } from './args.js';

const MOVES: ShotMoveType[] = ['catch_shoot', 'pull_up', 'drive', 'cut_finish', 'post', 'putback', 'heave'];
const ZONES = ['rim', 'paint', 'mid', 'three'] as const;

interface Tally {
  att: Record<string, number>;
  make: Record<string, number>;
  zoneAtt: Record<string, number>;
  zoneMake: Record<string, number>;
  /** catch_shoot attempts/makes released from rim/paint (the mislabel) */
  interiorCsAtt: number;
  interiorCsMake: number;
  fga: number;
  fgm: number;
  assisted: number;
  oreb: number;
  putback6: number;
  steals: number;
  stealScore6: number;
  /** shots by the stealing team within 6s of its own steal (attempt volume) */
  stealShot6: number;
}

function emptyTally(): Tally {
  const zero = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 0]));
  return {
    att: zero(MOVES), make: zero(MOVES), zoneAtt: zero(ZONES), zoneMake: zero(ZONES),
    interiorCsAtt: 0, interiorCsMake: 0, fga: 0, fgm: 0, assisted: 0,
    oreb: 0, putback6: 0, steals: 0, stealScore6: 0, stealShot6: 0
  };
}

export function tallyGame(events: GameEvent[], t: Tally): void {
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'shot') {
      t.fga++;
      t.att[e.moveType] = (t.att[e.moveType] ?? 0) + 1;
      t.zoneAtt[e.zone] = (t.zoneAtt[e.zone] ?? 0) + 1;
      const interior = e.zone === 'rim' || e.zone === 'paint';
      if (e.moveType === 'catch_shoot' && interior) t.interiorCsAtt++;
      if (e.made) {
        t.fgm++;
        t.make[e.moveType] = (t.make[e.moveType] ?? 0) + 1;
        t.zoneMake[e.zone] = (t.zoneMake[e.zone] ?? 0) + 1;
        if (e.assist) t.assisted++;
        if (e.moveType === 'catch_shoot' && interior) t.interiorCsMake++;
      }
    } else if (e.type === 'rebound' && e.offensive) {
      t.oreb++;
      // flow-metrics.ts putback definition: any FGA by the rebounding team
      // within 6s (game clock); forward scan stops at rebound/turnover
      for (let j = i + 1; j < events.length; j++) {
        const n = events[j]!;
        if (n.t - e.t > 6) break;
        if (n.type === 'shot' && n.team === e.team) { t.putback6++; break; }
        if (n.type === 'turnover' || n.type === 'rebound') break;
      }
    } else if (e.type === 'turnover' && e.stolenBy) {
      t.steals++;
      const thiefSide = e.team === 0 ? 1 : 0;
      let shot = false;
      for (let j = i + 1; j < events.length; j++) {
        const n = events[j]!;
        if (n.t - e.t > 6) break;
        if (n.type === 'shot' && n.team === thiefSide) {
          if (!shot) { t.stealShot6++; shot = true; }
          if (n.made) { t.stealScore6++; break; }
        }
        if (n.type === 'turnover' || n.type === 'rebound') break;
      }
    }
  }
}

export function runProbe(games: number, seedBase: string): Tally {
  const t = emptyTally();
  const { home, away } = sampleMatchup();
  for (let i = 0; i < games; i++) {
    const flip = i % 2 === 1;
    const r = simulateGame({
      seed: `${seedBase}-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false
    });
    tallyGame(r.events, t);
  }
  return t;
}

const isMain = process.argv[1]?.endsWith('shotmix-probe.ts');
if (isMain) {
  const games = flagNumber(process.argv, '--games', 12);
  const seed = flagValue(process.argv, '--seed', 'shotmix');
  const t0 = performance.now();
  const t = runProbe(games, seed);
  const pct = (num: number, den: number) => den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '—';
  console.log(`shot-mix probe — ${games} games, seed base "${seed}" (${((performance.now() - t0) / 1000).toFixed(1)}s)\n`);
  console.log(`moveType            att       att%      make      make%     FG%`);
  for (const m of MOVES) {
    const a = t.att[m] ?? 0, k = t.make[m] ?? 0;
    console.log(`  ${m.padEnd(14)} ${String(a).padStart(6)} ${pct(a, t.fga).padStart(9)} ${String(k).padStart(9)} ${pct(k, t.fgm).padStart(9)} ${pct(k, a).padStart(9)}`);
  }
  console.log(`\nzone                att       att%      FG%`);
  for (const z of ZONES) {
    const a = t.zoneAtt[z] ?? 0, k = t.zoneMake[z] ?? 0;
    console.log(`  ${z.padEnd(14)} ${String(a).padStart(6)} ${pct(a, t.fga).padStart(9)} ${pct(k, a).padStart(9)}`);
  }
  console.log(`\n  interior catch_shoot (mislabel)   ${pct(t.interiorCsAtt, t.fga)} of attempts, ${pct(t.interiorCsMake, t.fgm)} of makes`);
  console.log(`  assisted share of makes           ${pct(t.assisted, t.fgm)}   (band 54-62%)`);
  console.log(`  OREB -> FGA <=6s (putback share)  ${pct(t.putback6, t.oreb)}   (real 71.6%)`);
  console.log(`  steal -> score <=6s               ${pct(t.stealScore6, t.steals)}   (real 29.3%)`);
  console.log(`  steal -> FGA <=6s                 ${pct(t.stealShot6, t.steals)}`);
  console.log(`  FGA/game ${(t.fga / games).toFixed(1)}  FG% ${pct(t.fgm, t.fga)}  OREB/game ${(t.oreb / games).toFixed(1)}  steals/game ${(t.steals / games).toFixed(1)}`);
}
