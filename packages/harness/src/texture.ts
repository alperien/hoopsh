/**
 * Texture forensics — does the game READ as basketball?
 *
 * The acceptance bands grade season-scale AVERAGES; this tool grades the
 * moment-to-moment feel that the eye test flagged (players never standing
 * still, ping-pong passing bursts). It quantifies exactly those findings so
 * texture work has honest before/after numbers. REPORT-ONLY (ratchet
 * convention: numbers become enforced once they hold).
 *
 * Metrics:
 *   movement — per-player speeds between consecutive LIVE frames (game clock
 *     decreasing filters out dead balls/FT rituals; >30 ft/s pairs are
 *     dropped as substitution slot-swaps). NBA tracking reference — CITED,
 *     imported below from data/nba/tracking-references-2023-24.json: league
 *     AVG_SPEED 4.22 mph = 6.19 ft/s (UNITS MATTER — an earlier version of
 *     this header said "4.2 ft/s", a units-confused recollection that
 *     nearly drove a further round of engine slowing; the third review's
 *     warning that the target itself was recollection was exact).
 *     DEFINITIONS MATTER TOO: the NBA stat averages ALL on-court time
 *     including standing and dead balls, with an unpublished denominator
 *     (the AVG_SPEED column ≠ distance/minutes — a ~7% gap in both archived
 *     seasons), while this tool measures live-clock chord speed — a THIRD
 *     quantity. Sim-vs-NBA deltas under ~10-15% are definitional noise, not
 *     calibration signal (the data file's definitionTraps block is the full
 *     story). Standing still IS a basketball behavior — spacing is held,
 *     not jogged.
 *   passing — ping-pong share: an A→B pass answered by B→A within the window,
 *     the signature of utility ties oscillating; plus passes per possession
 *     (NBA 2023-24, same data file: 281.3 passes made / ~99 possessions per
 *     team-game ≈ 2.84–2.86 — the earlier uncited "~3.2: ~300 / ~95"
 *     overstated the numerator and understated the denominator).
 *
 * Run: npm run texture [-- --games 8 --seed texture]
 */

import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
// The cited reference values this report compares against. Provenance, exact
// definitions, and the definition traps live in the data file — printed
// numbers can never drift from the citation because they ARE the citation.
import ref from '../../../data/nba/tracking-references-2023-24.json' with { type: 'json' };

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const GAMES = Number(argOf('--games') ?? 8);
const SEED = argOf('--seed') ?? 'texture';
const PINGPONG_WINDOW_S = 3;

interface MoveAgg { speedSum: number; n: number; still: number; walk: number; run: number }
interface PassAgg { passes: number; pingpong: number; possessions: number }

const move: MoveAgg = { speedSum: 0, n: 0, still: 0, walk: 0, run: 0 };
const pass: PassAgg = { passes: 0, pingpong: 0, possessions: 0 };

for (let g = 0; g < GAMES; g++) {
  const { home, away } = sampleMatchup();
  const flip = g % 2 === 1;
  const result = simulateGame({
    seed: `${SEED}-${g}`,
    home: flip ? away : home,
    away: flip ? home : away,
    collectFrames: true
  });

  // ---- movement: consecutive live frames (clock strictly decreasing)
  const frames = result.frames;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    const dt = b[0]! - a[0]!;
    const liveClock = b[2]! < a[2]! && b[1] === a[1]; // same period, clock ran
    if (!liveClock || dt <= 0) continue;
    for (let p = 0; p < 10; p++) {
      const x0 = a[6 + p * 2]!;
      const y0 = a[7 + p * 2]!;
      const x1 = b[6 + p * 2]!;
      const y1 = b[7 + p * 2]!;
      const v = Math.hypot(x1 - x0, y1 - y0) / dt;
      if (v > 30) continue; // substitution slot swap, not motion
      move.speedSum += v;
      move.n++;
      if (v < 1) move.still++;
      else if (v < 6) move.walk++;
      else move.run++;
    }
  }

  // ---- passing: ping-pong pairs + per-possession volume
  let last: { from: string; to: string; wt: number } | null = null;
  for (const e of result.events as { type: string; from?: string; to?: string; wt?: number }[]) {
    if (e.type === 'possession_start') {
      pass.possessions++;
      last = null; // a return pass across possessions is not ping-pong
    }
    if (e.type !== 'pass') continue;
    pass.passes++;
    const cur = { from: e.from!, to: e.to!, wt: e.wt ?? 0 };
    if (last && cur.from === last.to && cur.to === last.from && cur.wt - last.wt < PINGPONG_WINDOW_S) {
      pass.pingpong++;
    }
    last = cur;
  }
}

const SPEED = ref.speedDistance.AVG_SPEED;
const PASSES = ref.passing.PASSES_MADE;
const PPP = ref.derived.passesPerPossession;
const row = (label: string, val: string, refStr: string) =>
  ` info  ${label.padEnd(30)} ${val.padStart(9)}   NBA ~${refStr}`;
console.log(`Texture forensics — ${GAMES} games (seed base '${SEED}')\n`);
console.log(row('avg live speed (ft/s)', (move.speedSum / move.n).toFixed(2), `${SPEED.ftps} (${SPEED.mph} mph, 2023-24 — see note)`));
console.log(row('stationary share (<1 ft/s)', `${((100 * move.still) / move.n).toFixed(0)}%`, 'large; standing holds spacing'));
console.log(row('walking share (1-6 ft/s)', `${((100 * move.walk) / move.n).toFixed(0)}%`, ''));
console.log(row('running share (>6 ft/s)', `${((100 * move.run) / move.n).toFixed(0)}%`, ''));
console.log(row('passes per possession', (pass.passes / pass.possessions).toFixed(2), `${PPP.range.join('–')} (${PASSES.perGame} passes/game, 2023-24)`));
console.log(row('ping-pong share of passes', `${((100 * pass.pingpong) / pass.passes).toFixed(1)}%`, 'rare; a return pass is a read, not a tie'));
console.log(`
 note  speed refs differ BY DEFINITION: the sim number is live-game-clock chord speed;
       NBA AVG_SPEED averages ALL on-court time (standing and dead balls included) with
       an unpublished denominator — the column ≠ distance/minutes (${ref.derived.distOverOnCourtTimeMph.mph} mph by division
       vs ${SPEED.mph} published, ~7% gap in both archived seasons). Deltas under ~10-15% are
       definitional noise, not a speed problem — the trap behind the 2026-07-26 units
       incident. Provenance + traps: data/nba/tracking-references-2023-24.json`);
