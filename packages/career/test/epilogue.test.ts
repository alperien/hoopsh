/**
 * epilogue.test.ts
 *
 * Ring accuracy for harvestSeasonHonors.
 *
 * The bug (findings/career-nba.md, CRITICAL): wasMySeason returned
 * true unconditionally when career.clock.phase === 'nba', and the
 * champion check compared archive.champion against the CURRENT team
 * pointer (career.nbaTeam), not the team the player was on that season.
 * Together: any archive where the current team was once champion granted
 * a ring, including pre-entry seasons the player never played in.
 *
 * The fix replaces the two-guard check with a look-up in
 * career.league.players[career.me].seasons: a ring fires if and only if
 * the player has a season row on the champion team for that specific season.
 *
 * Red on unfixed code (the pre-entry test): the unfixed path grants a ring
 * because wasMySeason returns true via the `|| phase === 'nba'` arm.
 * Green on fixed code: no season row → no ring.
 */
import { describe, it, expect } from 'vitest';
import type { CareerState } from '../src/types.js';
import { harvestSeasonHonors } from '../src/epilogue.js';

/** Minimal career state for epilogue tests — only the fields harvestSeasonHonors reads. */
function minimalCareer(opts: {
  phase?: string;
  nbaTeam?: string | null;
  mySeasonRows?: Array<{ season: number; teamId: string }>;
  archives?: Array<{ season: number; champion: string }>;
}): CareerState {
  const me = 'p-me';
  const rows = (opts.mySeasonRows ?? []).map(r => ({
    season: r.season,
    teamId: r.teamId,
    type: 'regular' as const,
    gp: 50, gs: 40, min: 1800,
    pts: 900, fgm: 340, fga: 680,
    tpm: 80, tpa: 200, ftm: 140, fta: 180,
    orb: 40, drb: 210, ast: 250, stl: 60, blk: 20, tov: 100, pf: 120,
    plusMinus: 80,
  }));

  return {
    me,
    seed: 'test',
    events: [],
    ledger: [],
    nbaTeam: (opts.nbaTeam ?? null) as CareerState['nbaTeam'],
    clock: {
      phase: (opts.phase ?? 'nba') as CareerState['clock']['phase'],
      year: 12,
      week: 0,
    },
    league: {
      players: {
        [me]: {
          seasons: rows,
        } as unknown as CareerState['league']['players'][string],
      },
      teams: {
        atl: { name: 'Atlanta Hawks' } as unknown as CareerState['league']['teams'][string],
        bos: { name: 'Boston Celtics' } as unknown as CareerState['league']['teams'][string],
      },
      archives: (opts.archives ?? []).map(a => ({
        season: a.season,
        champion: a.champion,
        runnerUp: 'bos',
        finalStandings: [],
        awards: [],
        playoffs: [],
        lottery: {} as unknown as CareerState['league']['archives'][0]['lottery'],
        leagueAverages: {},
        draftClass: [],  // non-undefined = fully stamped
      })),
    } as unknown as CareerState['league'],
  } as unknown as CareerState;
}

describe('harvestSeasonHonors ring accuracy', () => {
  it('does not grant a ring for a pre-entry season the player never played in', () => {
    // Season 8: ATL wins the title. Player is now on ATL (career.nbaTeam = 'atl')
    // but was drafted in season 10 and has no season row for season 8.
    // Unfixed code: wasMySeason returns true via `|| phase === 'nba'` -> ring granted.
    // Fixed code: no season row for (season=8, teamId='atl') -> no ring.
    const career = minimalCareer({
      phase: 'nba',
      nbaTeam: 'atl',
      mySeasonRows: [], // no season rows at all - player not yet in the league in s8
      archives: [{ season: 8, champion: 'atl' }],
    });

    harvestSeasonHonors(career);

    const rings = career.events.filter(e => e.id.startsWith('ev-honor-ring-'));
    expect(rings.length).toBe(0);
  });

  it('grants a ring when the player has a season row on the champion team', () => {
    // Season 11: ATL wins. Player has a season row for season 11 on ATL.
    const career = minimalCareer({
      phase: 'nba',
      nbaTeam: 'atl',
      mySeasonRows: [{ season: 11, teamId: 'atl' }],
      archives: [{ season: 11, champion: 'atl' }],
    });

    harvestSeasonHonors(career);

    const rings = career.events.filter(e => e.id === 'ev-honor-ring-11');
    expect(rings.length).toBe(1);
    expect(rings[0]!.reason).toContain('NBA champion');
  });

  it('does not grant a ring when traded away before the champion season', () => {
    // Season 12: BOS wins. Player was on BOS in seasons 10-11 but traded to ATL
    // before season 12 and has no season row on BOS for season 12.
    // career.nbaTeam = 'atl' (current team)
    // Unfixed: archive.champion ('bos') !== career.nbaTeam ('atl') -> no ring (different bug arm)
    // Fixed: no season row (season=12, teamId='bos') -> no ring either
    // Both pass, but this also documents the correct behavior.
    const career = minimalCareer({
      phase: 'nba',
      nbaTeam: 'atl',
      mySeasonRows: [
        { season: 10, teamId: 'bos' },
        { season: 11, teamId: 'bos' },
        // no row for season 12 on bos
      ],
      archives: [{ season: 12, champion: 'bos' }],
    });

    harvestSeasonHonors(career);

    const rings = career.events.filter(e => e.id.startsWith('ev-honor-ring-'));
    expect(rings.length).toBe(0);
  });

  it('grants an earned ring in descent phase when nbaTeam is null but season row exists', () => {
    // When a player descends (euro/china after their NBA career), applyAbroadOffer
    // clears career.nbaTeam to null. If a championship archive was stamped AFTER
    // the player left but for a season they did play (e.g., delayed archiving),
    // the unfixed code misses the ring: `career.nbaTeam && ...` short-circuits at null.
    // The fix checks the season row instead, which correctly grants the ring.
    //
    // Also verifies idempotence: a second harvest does not double-grant.
    const career = minimalCareer({
      phase: 'euro',
      nbaTeam: null,   // cleared by applyAbroadOffer
      mySeasonRows: [{ season: 11, teamId: 'atl' }],
      archives: [{ season: 11, champion: 'atl' }],
    });

    // First harvest: ring should be granted
    harvestSeasonHonors(career);
    expect(career.events.filter(e => e.id === 'ev-honor-ring-11').length).toBe(1);

    // Second harvest: idempotent
    harvestSeasonHonors(career);
    expect(career.events.filter(e => e.id === 'ev-honor-ring-11').length).toBe(1);
  });
});
