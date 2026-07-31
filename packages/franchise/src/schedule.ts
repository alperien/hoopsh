/**
 * schedule.ts — the 82-game regular-season schedule generator.
 *
 * Matchup formula (REAL, the NBA's own: research file 06 §10):
 *   16 division games (4 x 4 opponents)
 *   36 in-conference non-division (6 opponents x 4 games, 4 opponents x 3)
 *   30 cross-conference (2 x 15 opponents)
 * Which four same-conference opponents drop to 3 games rotates by season
 * (below). Day placement paces every team evenly, forbids three games on
 * consecutive days, and caps back-to-backs at the target so the count
 * lands near the real ~14 (params.schedule.b2bTarget) instead of the ~40
 * a random placement would produce.
 */

import type { Rng } from '@hoopsh/engine';
import type { League, ScheduledGame, Season, TeamId } from './types.js';

interface Matchup { home: TeamId; away: TeamId; }

/**
 * The 3-game-series rotation. Teams are indexed 0-4 inside each division
 * (sorted by id). For a pair (i in division A, j in division B) of the
 * same conference, the pair plays 3 games when (i + j + season + pairKey)
 * mod 5 < 2, else 4. Because j sweeps all five residues, every team gets
 * exactly two 3-game opponents in each other division (4 total) and three
 * 4-game opponents (6 total): 2 x (2x3 + 3x4) = 36 games. The season term
 * rotates WHICH opponents drop to 3 each year, like the real formula's
 * five-year cycle. Symmetric by construction (depends only on i + j and
 * the unordered division pair).
 */
function seriesLength(i: number, j: number, season: Season, pairKey: number): 3 | 4 {
  return ((i + j + season + pairKey) % 5) < 2 ? 3 : 4;
}

/** Deterministic Fisher-Yates on a copy. */
function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const a = out[i]!; out[i] = out[j]!; out[j] = a;
  }
  return out;
}

/** Build the full matchup multiset with home/away already assigned. */
function buildMatchups(league: League, season: Season): Matchup[] {
  const teams = Object.values(league.teams);
  const byDivision = new Map<string, TeamId[]>();
  for (const t of teams) {
    const list = byDivision.get(t.division) ?? [];
    list.push(t.id);
    byDivision.set(t.division, list);
  }
  // Stable intra-division indexing: sorted by id so the rotation is
  // reproducible regardless of object insertion order.
  for (const list of byDivision.values()) list.sort();
  const divisions = [...byDivision.keys()].sort();
  const divIndex = new Map(divisions.map((d, i) => [d, i]));
  const conferenceOf = (d: string): 'East' | 'West' => league.teams[byDivision.get(d)![0]!]!.conference;

  const games: Matchup[] = [];
  const series = (a: TeamId, b: TeamId, count: number, extraHomeToA: boolean): void => {
    // Even counts split evenly; odd counts give the extra home game to one
    // side deterministically, rotating by season so a 2-1 flips to 1-2 the
    // next time the pair meets at 3.
    const aHome = Math.floor(count / 2) + (count % 2 === 1 && extraHomeToA ? 1 : 0);
    for (let k = 0; k < count; k++) {
      if (k < aHome) games.push({ home: a, away: b });
      else games.push({ home: b, away: a });
    }
  };

  // Division: 4 games each pairing, 2 home and 2 away.
  for (const div of divisions) {
    const ids = byDivision.get(div)!;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) series(ids[i]!, ids[j]!, 4, true);
    }
  }

  // Same conference, other divisions: the rotation above.
  for (let a = 0; a < divisions.length; a++) {
    for (let b = a + 1; b < divisions.length; b++) {
      const divA = divisions[a]!, divB = divisions[b]!;
      if (conferenceOf(divA) !== conferenceOf(divB)) continue;
      // symmetric pair key: same value from either side of the pair
      const pairKey = (divIndex.get(divA)! + 1) * (divIndex.get(divB)! + 1);
      const idsA = byDivision.get(divA)!, idsB = byDivision.get(divB)!;
      for (let i = 0; i < idsA.length; i++) {
        for (let j = 0; j < idsB.length; j++) {
          const len = seriesLength(i, j, season, pairKey);
          series(idsA[i]!, idsB[j]!, len, (i + j + season) % 2 === 0);
        }
      }
    }
  }

  // Cross-conference: 2 games, one in each building.
  const east = teams.filter(t => t.conference === 'East').map(t => t.id).sort();
  const west = teams.filter(t => t.conference === 'West').map(t => t.id).sort();
  for (const e of east) for (const w of west) series(e, w, 2, true);

  return games;
}

/**
 * Generate the season's schedule. Deterministic in (league.seed, season):
 * callers pass streamRng(league.seed, 'schedule', season) per the rng
 * registry. Throws when placement cannot satisfy the hard constraints:
 * a deterministic failure is an algorithm bug to fix, never to tolerate.
 */
export function generateSchedule(league: League, season: Season, rng: Rng): ScheduledGame[] {
  const p = league.params;
  const totalDays = p.calendar.regularSeasonDays;
  const asStart = p.calendar.allStarDayIndex;
  // 4 empty days at the break (REAL: the league goes dark around all-star
  // weekend; the exhibition itself is not simulated, register F7).
  const isBreak = (d: number): boolean => d >= asStart && d < asStart + 4;

  const matchups = shuffled(buildMatchups(league, season), rng);
  const teamIds = Object.keys(league.teams).sort();
  const played = new Map<TeamId, Set<number>>(teamIds.map(id => [id, new Set<number>()]));
  const b2b = new Map<TeamId, number>(teamIds.map(id => [id, 0]));
  const total = new Map<TeamId, number>(teamIds.map(id => [id, 0]));
  const gamesPerTeam = p.calendar.regularSeasonGames;

  // Per-day quota: spread the slate evenly over playable days, remainder
  // to the earliest days (real Octobers run slightly denser than April).
  const playableDays: number[] = [];
  for (let d = 0; d < totalDays; d++) if (!isBreak(d)) playableDays.push(d);
  const totalGames = matchups.length;
  const baseQuota = Math.floor(totalGames / playableDays.length);
  const remainder = totalGames - baseQuota * playableDays.length;

  const canPlay = (id: TeamId, d: number, b2bCap: number): boolean => {
    const days = played.get(id)!;
    if (days.has(d)) return false;
    // no three games on consecutive days (REAL: no 3-in-3 in the modern league)
    if (days.has(d - 1) && days.has(d - 2)) return false;
    if (days.has(d + 1) && days.has(d + 2)) return false;
    if (days.has(d - 1) && days.has(d + 1)) return false;
    // back-to-back budget: the first pass caps at target so counts land
    // near the real ~14; the repair pass relaxes to target + tolerance
    if ((days.has(d - 1) || days.has(d + 1)) && b2b.get(id)! >= b2bCap) return false;
    return true;
  };

  const placedList: Array<{ m: Matchup; day: number }> = [];
  const place = (m: Matchup, d: number): void => {
    placedList.push({ m, day: d });
    for (const id of [m.home, m.away]) {
      const days = played.get(id)!;
      if (days.has(d - 1)) b2b.set(id, b2b.get(id)! + 1);
      if (days.has(d + 1)) b2b.set(id, b2b.get(id)! + 1); // repair inserts can form the pair backwards
      days.add(d);
      total.set(id, total.get(id)! + 1);
    }
  };

  let remaining = matchups;
  playableDays.forEach((d, dayIdx) => {
    const quota = baseQuota + (dayIdx < remainder ? 1 : 0);
    // Deficit pacing: prioritize matchups whose teams are furthest behind
    // the games-played pace line. This is what keeps every team finishing
    // at 82 without a constraint pile-up in April.
    const paceLine = gamesPerTeam * (dayIdx / playableDays.length);
    const scored = remaining
      .filter(m => canPlay(m.home, d, p.schedule.b2bTarget) && canPlay(m.away, d, p.schedule.b2bTarget))
      .map(m => ({
        m,
        score: (paceLine - total.get(m.home)!) + (paceLine - total.get(m.away)!),
      }))
      .sort((a, b) => b.score - a.score);
    const chosen = new Set<Matchup>();
    const busy = new Set<TeamId>();
    for (const { m } of scored) {
      if (chosen.size >= quota) break;
      if (busy.has(m.home) || busy.has(m.away)) continue;
      if (!canPlay(m.home, d, p.schedule.b2bTarget) || !canPlay(m.away, d, p.schedule.b2bTarget)) continue;
      chosen.add(m);
      busy.add(m.home); busy.add(m.away);
    }
    for (const m of chosen) place(m, d);
    remaining = remaining.filter(m => !chosen.has(m));
  });

  // Repair passes: anything the quota walk could not seat goes into the
  // first feasible day. Tier 1 keeps the B2B target; tier 2 relaxes to
  // target + tolerance (hard constraints, 3-in-a-row and one-per-day,
  // never relax); tier 3 evicts a movable game from a feasible day, seats
  // the stuck pair, and re-seats the evicted game under tier-2 rules.
  const seatDirect = (m: Matchup, cap: number): boolean => {
    for (const d of playableDays) {
      if (canPlay(m.home, d, cap) && canPlay(m.away, d, cap)) {
        place(m, d);
        return true;
      }
    }
    return false;
  };
  const unseat = (entry: { m: Matchup; day: number }): void => {
    placedList.splice(placedList.indexOf(entry), 1);
    for (const id of [entry.m.home, entry.m.away]) {
      const days = played.get(id)!;
      if (days.has(entry.day - 1)) b2b.set(id, b2b.get(id)! - 1);
      if (days.has(entry.day + 1)) b2b.set(id, b2b.get(id)! - 1);
      days.delete(entry.day);
      total.set(id, total.get(id)! - 1);
    }
  };
  const relaxedCap = p.schedule.b2bTarget + p.schedule.b2bTolerance;
  for (const m of remaining) {
    if (seatDirect(m, p.schedule.b2bTarget)) continue;
    if (seatDirect(m, relaxedCap)) continue;
    // tier 3: eviction. Find a day where only one placed game blocks the
    // pair, evict it, seat the pair, re-seat the evicted game elsewhere.
    let seated = false;
    for (const d of playableDays) {
      const blockers = placedList.filter(e => e.day === d
        && (e.m.home === m.home || e.m.away === m.home || e.m.home === m.away || e.m.away === m.away));
      if (blockers.length !== 1) continue;
      const evicted = blockers[0]!;
      unseat(evicted);
      if (canPlay(m.home, d, relaxedCap) && canPlay(m.away, d, relaxedCap)) {
        place(m, d);
        if (seatDirect(evicted.m, relaxedCap)) { seated = true; break; }
        // could not re-seat the evicted game: roll back both moves
        unseat(placedList[placedList.length - 1]!);
      }
      place(evicted.m, evicted.day);
    }
    if (!seated) {
      throw new Error(
        `schedule: could not seat ${m.away}@${m.home} (seed ${league.seed}, season ${season}); ` +
        'fix the placement algorithm, do not tolerate this',
      );
    }
  }

  // Always-on validation: a schedule bug caught here costs seconds; the
  // same bug surfacing in April costs a save file.
  for (const id of teamIds) {
    const n = total.get(id)!;
    if (n !== gamesPerTeam) throw new Error(`schedule: ${id} has ${n} games, wants ${gamesPerTeam}`);
    const days = [...played.get(id)!].sort((a, b) => a - b);
    for (let i = 2; i < days.length; i++) {
      if (days[i]! - days[i - 2]! === 2) throw new Error(`schedule: ${id} plays 3 straight ending day ${days[i]}`);
    }
  }

  placedList.sort((a, b) => a.day - b.day || (a.m.home + a.m.away).localeCompare(b.m.home + b.m.away));
  return placedList.map(({ m, day }) => ({
    id: `s${season}-d${day}-${m.away}@${m.home}`,
    date: { season, day },
    type: 'regular' as const,
    home: m.home,
    away: m.away,
  }));
}
