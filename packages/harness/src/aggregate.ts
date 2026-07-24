/**
 * Aggregate many box scores into league-average per-team per-game numbers,
 * then evaluate them against acceptance bands.
 */

import type { BoxScore } from '@hoopsh/stats';
import { orbPct, ortg } from '@hoopsh/stats';
import type { Band } from './bands.js';

export interface Accumulator {
  games: number; // team-games
  pts: number; fga: number; fgm: number; tpa: number; tpm: number;
  fta: number; ftm: number; orb: number; drb: number; trb: number;
  ast: number; stl: number; blk: number; tov: number; pf: number;
  poss: number; paceSum: number; orbPctSum: number; ortgSum: number;
}

export function emptyAcc(): Accumulator {
  return {
    games: 0, pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0,
    orb: 0, drb: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    poss: 0, paceSum: 0, orbPctSum: 0, ortgSum: 0
  };
}

export function accumulate(acc: Accumulator, box: BoxScore): void {
  for (const side of [0, 1] as const) {
    const t = box.teams[side];
    const opp = box.teams[side === 0 ? 1 : 0];
    acc.games += 1;
    acc.pts += t.pts; acc.fga += t.fga; acc.fgm += t.fgm;
    acc.tpa += t.tpa; acc.tpm += t.tpm; acc.fta += t.fta; acc.ftm += t.ftm;
    acc.orb += t.orb; acc.drb += t.drb; acc.trb += t.trb;
    acc.ast += t.ast; acc.stl += t.stl; acc.blk += t.blk;
    acc.tov += t.tov; acc.pf += t.pf; acc.poss += t.poss;
    acc.paceSum += box.pace;
    acc.orbPctSum += orbPct(t, opp);
    acc.ortgSum += ortg(t);
  }
}

export function mergeAcc(a: Accumulator, b: Accumulator): Accumulator {
  const out = emptyAcc();
  for (const k of Object.keys(out) as (keyof Accumulator)[]) {
    out[k] = a[k] + b[k];
  }
  return out;
}

export interface LeagueAverages {
  games: number;
  [metric: string]: number;
}

export function finalize(acc: Accumulator): LeagueAverages {
  const g = Math.max(1, acc.games);
  return {
    games: acc.games,
    pace: acc.paceSum / g,
    pts: acc.pts / g,
    fga: acc.fga / g,
    fgPct: acc.fga === 0 ? 0 : acc.fgm / acc.fga,
    tpaShare: acc.fga === 0 ? 0 : acc.tpa / acc.fga,
    tpPct: acc.tpa === 0 ? 0 : acc.tpm / acc.tpa,
    fta: acc.fta / g,
    ftPct: acc.fta === 0 ? 0 : acc.ftm / acc.fta,
    orbPct: acc.orbPctSum / g,
    trb: acc.trb / g,
    ast: acc.ast / g,
    stl: acc.stl / g,
    blk: acc.blk / g,
    tov: acc.tov / g,
    pf: acc.pf / g,
    ortg: acc.ortgSum / g
  };
}

export interface BandResult {
  band: Band;
  value: number;
  pass: boolean;
}

export function evaluate(avgs: LeagueAverages, bands: Band[]): BandResult[] {
  return bands.map((band) => {
    const value = avgs[band.metric] ?? NaN;
    return { band, value, pass: value >= band.lo && value <= band.hi };
  });
}

export function formatReport(results: BandResult[]): string {
  const fmt = (v: number, pct?: boolean): string =>
    pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1);
  const rows = results.map((r) => {
    const status = r.pass ? ' OK ' : 'FAIL';
    const range = `${fmt(r.band.lo, r.band.pct)} – ${fmt(r.band.hi, r.band.pct)}`;
    return `${status}  ${r.band.label.padEnd(28)} ${fmt(r.value, r.band.pct).padStart(8)}   target ${range}`;
  });
  const passed = results.filter((r) => r.pass).length;
  return [
    `Realism acceptance report — ${passed}/${results.length} bands passing`,
    '─'.repeat(72),
    ...rows
  ].join('\n');
}
