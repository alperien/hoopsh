/**
 * ai/roster.ts - depth charts, default rotations, and daily AI roster
 * upkeep. OWNER: ai-team task.
 *
 * Every AI front office runs the same machinery the user does
 * (docs/FRANCHISE.md 7: no CPU cheat lane, no CPU handicap): depth is
 * ability at the positions the lineup demands, rotations follow the
 * params.rotation minute tiers, and roster holes are patched through the
 * same validators and executors a user signing flows through. Upkeep is
 * deliberately BOUNDED AND QUIET: it fills legal minimums and fixes broken
 * rotations; it never writes news or inbox items (the media layer reads the
 * transaction ledger itself).
 *
 * abilityScore here is intentionally independent of ai/valuation.ts's
 * dollar-value model (sibling module): this is a lineup-ordering number, a
 * position-demand-weighted read of the 24 dials, not a market price.
 */
import type { Position } from '@hoopsh/engine';
import type {
  AttrGroup, Contract, FrPlayer, League, PlayerId, RotationPolicy, TeamId,
} from '../types.js';
import { groupMean } from '../people/dev.js';
import { buildContract, minSalaryFor, signingSeason, validateSigning } from '../cba/contracts.js';
import { executeSigning, executeWaive } from '../transactions.js';

/** Group iteration order (PotentialProfile declaration order, types.ts). */
const GROUP_KEYS: readonly AttrGroup[] = [
  'phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental',
];

/**
 * Position demand weights over the attribute groups (all FEEL: hand-set to
 * the obvious basketball shape, not statistically constrained). A point
 * guard lives on playmaking and decisions; a center is judged at the rim
 * and on the glass; wings carry two-way scoring loads. Weights are relative
 * within a row (positionBlend normalizes), so only the ratios matter.
 */
const POS_GROUP_WEIGHTS: Record<Position, Record<AttrGroup, number>> = {
  PG: { phys: 1.0, scoring: 1.2, playmaking: 1.6, defense: 0.9, rebounding: 0.4, mental: 1.2 },
  SG: { phys: 1.0, scoring: 1.5, playmaking: 1.0, defense: 1.0, rebounding: 0.5, mental: 1.0 },
  SF: { phys: 1.1, scoring: 1.3, playmaking: 0.8, defense: 1.2, rebounding: 0.8, mental: 1.0 },
  PF: { phys: 1.2, scoring: 1.0, playmaking: 0.6, defense: 1.2, rebounding: 1.3, mental: 0.9 },
  C:  { phys: 1.2, scoring: 0.9, playmaking: 0.5, defense: 1.4, rebounding: 1.5, mental: 0.9 },
};

// Upkeep policy constants: bookkeeping conventions, not sweepable market
// levers (the market's own magnitudes live in params.fa / params.cba).
const HEALTHY_BODY_FLOOR = 9;   // FEEL: below 9 healthy standard-roster players a staff converts a two-way (REAL floor is 8 active; 9 leaves a game-night margin)
const STARTER_SLOTS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C']; // REAL: the five lineup spots a plausible starting unit covers

/**
 * Position-demand-weighted blend of per-group values (0-100 in, 0-100 out).
 * Shared lens for TRUE ability (abilityScore) and for PERCEIVED ability
 * (ai/draftai.ts feeds scouted group reads through the same weights), so an
 * AI board and an AI depth chart judge players with one set of eyes.
 */
export function positionBlend(pos: Position, groups: Record<AttrGroup, number>): number {
  const weights = POS_GROUP_WEIGHTS[pos];
  let sum = 0;
  let weightSum = 0;
  for (const g of GROUP_KEYS) {
    sum += groups[g] * weights[g];
    weightSum += weights[g];
  }
  return sum / weightSum;
}

/**
 * Current on-court ability through the lens of the player's own position
 * (a rim-running center is not judged on passing vision). Deterministic
 * pure read of the true dials; the depth chart, the FA market's pecking
 * order, and roster upkeep all rank with this.
 */
export function abilityScore(player: FrPlayer): number {
  const groups = {} as Record<AttrGroup, number>;
  for (const g of GROUP_KEYS) groups[g] = groupMean(player.attr, g);
  return positionBlend(player.pos, groups);
}

/** Available tonight: on the active roster shape with no open injury. */
function isAvailable(player: FrPlayer): boolean {
  return player.status === 'roster' && player.health.injury === null;
}

/**
 * Best-first roster ordering for one team: available players first (an
 * injured star is still ON the chart, just below the bodies who can play),
 * ability-ordered inside each tier, id as the deterministic tiebreak.
 * Includes two-way players (they dress; gameday enforces their game limit).
 */
export function depthChart(league: League, teamId: TeamId): PlayerId[] {
  const team = league.teams[teamId];
  if (!team) throw new Error(`depthChart: unknown team ${teamId}`);
  const ids = [...team.roster, ...team.twoWay].filter((id) => league.players[id] !== undefined);
  return ids.sort((a, b) => {
    const pa = league.players[a]!;
    const pb = league.players[b]!;
    const availA = isAvailable(pa) ? 1 : 0;
    const availB = isAvailable(pb) ? 1 : 0;
    if (availA !== availB) return availB - availA;
    return abilityScore(pb) - abilityScore(pa) || (a < b ? -1 : 1);
  });
}

/**
 * Rotation policy from the depth chart and the params.rotation minute
 * tiers: five starters spanning the lineup positions plausibly (best
 * available at each spot, best-remaining when a spot has no natural fit),
 * starter minutes down the ability order, bench tiers for the next five,
 * nothing for players 11+ (a 10-man rotation is the real shape; gameday
 * renormalizes toward 240 on the night). Pure construction: callers
 * (aiRosterUpkeep, genesis) assign it to team.rotation.
 */
export function defaultRotation(league: League, teamId: TeamId): RotationPolicy {
  const params = league.params.rotation;
  const chart = depthChart(league, teamId);
  const available = chart.filter((id) => isAvailable(league.players[id]!));

  // starters: one plausible body per lineup spot, exact position first
  const starters: PlayerId[] = [];
  const taken = new Set<PlayerId>();
  for (const slot of STARTER_SLOTS) {
    const fit = available.find((id) => !taken.has(id) && league.players[id]!.pos === slot);
    if (fit) {
      starters.push(fit);
      taken.add(fit);
    }
  }
  // spots with no natural fit go to the best remaining bodies (a coach
  // starts his five best before he forfeits positional symmetry)
  for (const id of available) {
    if (starters.length >= 5) break;
    if (!taken.has(id)) {
      starters.push(id);
      taken.add(id);
    }
  }
  // a roster too thin/hurt for five available bodies still names a unit
  for (const id of chart) {
    if (starters.length >= 5) break;
    if (!taken.has(id)) {
      starters.push(id);
      taken.add(id);
    }
  }

  // minutes: starter tiers follow the ability order WITHIN the unit (the
  // best starter carries the heaviest load, whatever his position), bench
  // tiers run down the remaining chart; players 11+ get nothing
  const minutes: Record<PlayerId, number> = {};
  const starterByAbility = chart.filter((id) => starters.includes(id));
  starterByAbility.forEach((id, i) => {
    minutes[id] = params.starterMinutes[Math.min(i, params.starterMinutes.length - 1)]!;
  });
  const bench = available.filter((id) => !starters.includes(id));
  bench.slice(0, params.benchMinutes.length).forEach((id, i) => {
    minutes[id] = params.benchMinutes[i]!;
  });

  return {
    minutes,
    starters,
    b2bRestBelow: params.b2bRestBelow,
    scratches: [],
  };
}

/** Standard-roster players who could dress tonight. */
function healthyRosterCount(league: League, teamId: TeamId): number {
  const team = league.teams[teamId]!;
  let n = 0;
  for (const id of team.roster) {
    const p = league.players[id];
    if (p && isAvailable(p)) n += 1;
  }
  return n;
}

/** Best-available healthy free agents for minimum-money patch signings. */
function minimumMarket(league: League, teamId: TeamId): FrPlayer[] {
  const out: FrPlayer[] = [];
  for (const id of league.freeAgents) {
    const p = league.players[id];
    if (!p || p.status !== 'freeAgent') continue;
    if (p.health.injury !== null) continue; // nobody signs a body that cannot dress
    // a restricted FA belongs to the offer-sheet machinery, not a quiet minimum
    if (p.rights && p.rights.restricted && p.rights.teamId !== teamId) continue;
    if (league.offerSheets.some((s) => s.playerId === id)) continue; // spoken for until the match clock runs
    out.push(p);
  }
  return out.sort((a, b) => abilityScore(b) - abilityScore(a) || (a.id < b.id ? -1 : 1));
}

/**
 * Daily AI roster upkeep, run by the spine for every league day (tick.ts AI
 * block). Deterministic team order; user team untouched (the user runs
 * their own shop). Three quiet jobs per AI team:
 *  1. fill a roster below the 14-man minimum with best-available minimum
 *     free agents (skipped in moratorium/freeAgency, where the market
 *     module owns who signs where - upkeep must not scoop the market's
 *     stars at the minimum);
 *  2. convert the best healthy two-way to a rest-of-season minimum when
 *     fewer than HEALTHY_BODY_FLOOR standard-roster players can dress;
 *  3. refresh team.rotation via defaultRotation when injuries (or
 *     departures) broke the starting five.
 * All signings flow through validateSigning/executeSigning; anything that
 * cannot be done legally today is skipped without noise.
 */
export function aiRosterUpkeep(league: League): void {
  const cba = league.params.cba;
  // during the market window the FA module owns every signing decision
  const marketOwnsSignings = league.phase === 'moratorium' || league.phase === 'freeAgency';
  // signings price against the signing season's cap lines; a hand-built
  // league that never rolled them simply skips patch signings today
  const canPrice = league.capLines[signingSeason(league)] !== undefined;

  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;
    if (team.gm === null) continue; // user team: their roster, their calls

    // -- 1. minimum-money fills up to the roster floor
    if (!marketOwnsSignings && canPrice && team.roster.length < cba.rosterMin) {
      let need = cba.rosterMin - team.roster.length;
      for (const p of minimumMarket(league, tid)) {
        if (need <= 0) break;
        const terms = { years: 1, startSalary: minSalaryFor(league, p) };
        if (!validateSigning(league, tid, p.id, terms, 'minimum').ok) continue;
        executeSigning(league, tid, p.id, buildContract(league, tid, p.id, terms, 'minimum'));
        need -= 1;
      }
    }

    // -- 2. two-way conversion when the treatment room is full
    if (canPrice && healthyRosterCount(league, tid) < HEALTHY_BODY_FLOOR
      && team.roster.length < cba.rosterMax) {
      const candidates = team.twoWay
        .map((id) => league.players[id])
        .filter((p): p is FrPlayer => p !== undefined && isAvailable(p))
        .sort((a, b) => abilityScore(b) - abilityScore(a) || (a.id < b.id ? -1 : 1));
      const pick = candidates[0];
      if (pick) {
        // conversion is modeled as release-and-re-sign so both halves flow
        // through the executors (any remaining two-way guarantee rides as
        // dead money; at half the rookie minimum the cost is a rounding
        // error, registered simplification)
        executeWaive(league, tid, pick.id, false);
        const min = minSalaryFor(league, pick);
        const terms = { years: 1, startSalary: min };
        if (validateSigning(league, tid, pick.id, terms, 'minimum').ok) {
          const contract: Contract = {
            id: `ct-${pick.id}-s${league.season}d${league.day}-conv`,
            playerId: pick.id,
            teamId: tid,
            years: [{ season: signingSeason(league), salary: min, guaranteed: min }],
            kind: 'restOfSeason',
            means: 'minimum',
            signedOn: { season: league.season, day: league.day },
            birdYearsAtSigning: 0,
          };
          executeSigning(league, tid, pick.id, contract);
        }
        // a failed re-sign leaves him a free agent; the fill pass above
        // scoops him back tomorrow (quiet, self-healing)
      }
    }

    // -- 3. rotation repair when the named five can no longer take the floor
    const starters = team.rotation.starters;
    const broken = starters.length !== 5 || starters.some((id) => {
      const p = league.players[id];
      const onTeam = team.roster.includes(id) || team.twoWay.includes(id);
      return !p || !onTeam || !isAvailable(p);
    });
    if (broken) team.rotation = defaultRotation(league, tid);
  }
}
