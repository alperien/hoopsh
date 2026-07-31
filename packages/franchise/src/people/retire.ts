/**
 * people/retire.ts - retirement hazard at season end. OWNER: people task.
 *
 * A hazard model on age shaped by role, body, and trajectory
 * (docs/FRANCHISE.md §5): career-length distribution is an acceptance
 * band, not an accident. Targets research 05 B3: rotation players retire
 * mid-30s (the test in test/people.test.ts pins the hazard-implied median
 * between 33 and 38 for a 600-minute role player); fringe players walk
 * away sooner, broken bodies sooner still, and guaranteed money keeps
 * stars in uniform.
 *
 * runRetirements MUTATES NOTHING: it rolls the hazard and returns the
 * ids. The spine executes each retirement through
 * transactions.executeRetirement (the only writer of roster/contract
 * state), which flips status and appends the Transaction. Sub-30 medical
 * retirements (a second Achilles, for instance) are not modeled in v1;
 * lift alongside a forced-retirement seam on the injury model.
 *
 * Randomness: stream 'retire:<season>' (rng.ts registry), one uniform
 * draw per eligible player in sorted-id order.
 */
import type { FranchiseParams } from '../params.js';
import type { FrPlayer, League, Season } from '../types.js';
import { streamRng } from '../rng.js';
import { regularSeasonTotals } from './dev.js';

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export interface RetireFactors {
  /** age at the season being closed out */
  age: number;
  /** regular-season minutes in the season just played */
  seasonMinutes: number;
  /** career wear, 0-100 */
  wear: number;
  /** consecutive seasons (0-2 tracked) the devLog shows net negative movement */
  decliningSeasons: number;
  /** contract seasons still owed beyond the season being closed out */
  contractYearsRemaining: number;
}

/**
 * Pure per-season retirement hazard. Exported so the cohort-shape test
 * (and any front-office UI) can hit the math without rolling.
 */
export function retireHazardFor(params: FranchiseParams, x: RetireFactors): number {
  const r = params.retire;
  if (x.age < r.minLeagueAge) return 0; // nobody hangs it up young in v1 (see header)
  // Logistic hazard centered on baseAge: absent other pressure, the
  // league-shaped player's odds of walking away pass 50/50 around 35.
  let h = 1 / (1 + Math.exp(-(x.age - r.baseAge) * r.hazardSteepness));
  // Out of the rotation: under 600 minutes (about 7 a night across a full
  // season, FEEL threshold) the league is telling him it is over.
  if (x.seasonMinutes < 600) h *= r.fringeRoleBoost;
  // A chronically broken body quits sooner: linear on wear past 60, up to
  // 1.75x at wear 100. FEEL.
  if (x.wear > 60) h *= 1 + 0.75 * ((x.wear - 60) / 40);
  // Two straight seasons of decline reads as the end from the inside too.
  // FEEL 1.5x.
  if (x.decliningSeasons >= 2) h *= 1.5;
  // Guaranteed money keeps stars in uniform: with 2+ seasons still owed,
  // almost nobody walks away from the checks mid-contract. FEEL 0.15x.
  if (x.contractYearsRemaining >= 2) h *= 0.15;
  return clamp(h, 0, 0.99); // 0.99 ceiling: even the 45-year-old gets a coin with two sides
}

/** Net devLog movement for one season (all groups, reviews plus aging). */
function seasonDevSum(player: FrPlayer, season: Season): number {
  let sum = 0;
  for (const note of player.devLog) {
    if (note.date.season !== season) continue;
    for (const d of Object.values(note.deltas)) sum += d ?? 0;
  }
  return sum;
}

/** Consecutive declining seasons ending at `season`, capped at 2 (all the hazard reads). */
function decliningSeasons(player: FrPlayer, season: Season): number {
  let n = 0;
  for (const s of [season, season - 1]) {
    if (seasonDevSum(player, s) < 0) n++;
    else break;
  }
  return n;
}

/** Contract seasons owed beyond the season being closed out. */
function contractYearsRemaining(player: FrPlayer, season: Season): number {
  if (!player.contract) return 0;
  let n = 0;
  for (const y of player.contract.years) {
    if (y.season > season) n++;
  }
  return n;
}

/**
 * Roll retirements at season end. Called by the spine at rollover, after
 * applyAging (so the just-finished season's decline is on the log).
 * MUTATES NOTHING and returns the retiring player ids, sorted, for the
 * spine to execute one by one via transactions.executeRetirement.
 */
export function runRetirements(league: League): string[] {
  const rng = streamRng(league.seed, 'retire', league.season);
  const out: string[] = [];
  for (const id of Object.keys(league.players).sort()) {
    const player = league.players[id]!;
    if (player.status === 'retired') continue;
    const age = league.season - player.bornSeason;
    if (age < league.params.retire.minLeagueAge) continue; // no draw spent on the young
    const h = retireHazardFor(league.params, {
      age,
      seasonMinutes: regularSeasonTotals(player, league.season).min,
      wear: player.health.wear,
      decliningSeasons: decliningSeasons(player, league.season),
      contractYearsRemaining: contractYearsRemaining(player, league.season),
    });
    if (rng.chance(h)) out.push(id);
  }
  return out.sort();
}
