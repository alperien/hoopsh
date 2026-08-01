/**
 * retire.test.ts
 *
 * Retirement must end my league presence (issue #68; findings H-nba-1
 * in career-nba.md, H-seams-2 in franchise-seams.md).
 *
 * The bug: applyChoice('retire') and the age-40 forced wrap flipped
 * career.clock.phase and built the epilogue but touched no league
 * state - no executeRetirement, so my FrPlayer stayed status 'roster'
 * or 'freeAgent'. The retired-phase advance (one league season per
 * tick) then kept playing the "retired" player: fast-sim lines fold
 * into his seasons array and the ballots keep reading him. Franchise
 * cleanup never comes because retirement rolls and the FA market both
 * skip careerControlled players by design (the seam works; the career
 * side simply never called the executor).
 *
 * Red on unfixed code: after retiring, league status stays
 * 'roster'/'freeAgent', the contract survives, and one retired-phase
 * season advance grows my seasons array (82 games at roster slot 0).
 * Green on fixed code: both retire seams route through
 * executeRetirement (status 'retired', roster spot dropped, contract
 * void, FA pool exit, retiredSeason stamped) and the ghost stops
 * playing while the league itself keeps moving.
 */
import { describe, expect, it } from 'vitest';
import type { FrPlayer, TeamId } from '@hoopsh/franchise';
import { createLeague, FRANCHISES, generatePersona, streamRng } from '@hoopsh/franchise';
import type { CareerState } from '../src/types.js';
import { advanceCareerWeek, applyChoice } from '../src/tick.js';
import { fastSim } from '../src/fastsim.js';
import { fixtureCareer } from './fixture.js';

/**
 * Wire the fixture career into the NBA phase on a real genesis league:
 * me in league.players on a roster mid-contract, careerControlled set,
 * career pointers moved - the state applyNbaOffer/enterDraftClass
 * produce, hand-built the way the epilogue suite hand-builds its
 * minimal states. The genesis league (not the test fixture league)
 * because the retired-phase advance must roll a real season: the
 * fixture league has no calendar and stalls before rollover.
 */
function nbaCareer(seed: string): { career: CareerState; me: FrPlayer; teamId: TeamId } {
  const career = fixtureCareer({ seed });
  const league = createLeague({ seed: `${seed}:league`, userTeam: FRANCHISES[0]!.id });
  career.league = league;

  // no chair waits on a human: creation fills the null gm seat at career
  // start (creation.ts); the hand-wired state does the same or the draft
  // phase inside a season advance stalls on the user pick
  const gmRng = streamRng(league.seed, 'career-gm-fill');
  for (const t of Object.values(league.teams)) {
    if (t.gm === null) t.gm = generatePersona(gmRng);
  }

  const me = career.players[career.me]!;
  // elite dials and roster slot 0: the fast sim's 8-man rotation slices
  // roster order and the projection ladders on ability, so both together
  // guarantee the unfixed ghost visibly plays (the red demonstration)
  for (const k of Object.keys(me.attr)) (me.attr as unknown as Record<string, number>)[k] = 90;
  me.bornSeason = league.season - 30;
  me.status = 'roster';
  const teamId = Object.keys(league.teams).sort()[0]! as TeamId;
  me.contract = {
    id: `c-${career.me}`, playerId: career.me, teamId,
    years: [
      { season: league.season, salary: 10_000_000, guaranteed: 10_000_000 },
      { season: league.season + 1, salary: 10_000_000, guaranteed: 10_000_000 },
    ],
    kind: 'standard', means: 'genesis',
    signedOn: { season: league.season, day: 0 }, birdYearsAtSigning: 1,
  };
  league.players[career.me] = me;
  league.teams[teamId]!.roster.unshift(career.me);
  league.careerControlled = [career.me];
  delete career.players[career.me]; // post-entry: one pool (nbabridge convention)
  career.nbaTeam = teamId;
  career.clock.phase = 'nba';
  career.circuit = null;
  return { career, me, teamId };
}

describe("applyChoice('retire') ends the league presence", () => {
  it('retiring mid-contract leaves the roster, voids the deal, and books the transaction', () => {
    const { career, me, teamId } = nbaCareer('i68-retire-roster');
    const seasonAtRetire = career.league.season;

    const r = applyChoice(career, { kind: 'retire' });

    expect(r.ok).toBe(true);
    expect(career.clock.phase).toBe('retired');
    expect(career.epilogue).toBeTruthy();
    // the league side: the spine's own executor ran
    expect(me.status).toBe('retired');
    expect(me.contract).toBe(null);
    expect(me.retiredSeason).toBe(seasonAtRetire);
    expect(career.league.teams[teamId]!.roster).not.toContain(career.me);
    expect(career.league.freeAgents).not.toContain(career.me);
    const tx = career.league.transactions.filter(t => t.kind === 'retirement' && t.playerId === career.me);
    expect(tx.length).toBe(1);
  });

  it('retiring as a league free agent leaves the pool instead of idling in it forever', () => {
    const { career, me, teamId } = nbaCareer('i68-retire-fa');
    // between deals: the shape the issue calls the permanently idling
    // careerControlled free agent (the FA market skips me by design)
    const team = career.league.teams[teamId]!;
    team.roster = team.roster.filter(id => id !== career.me);
    me.contract = null;
    me.status = 'freeAgent';
    career.league.freeAgents.push(career.me);

    const r = applyChoice(career, { kind: 'retire' });

    expect(r.ok).toBe(true);
    expect(me.status).toBe('retired');
    expect(career.league.freeAgents).not.toContain(career.me);
  });
});

describe('the retired phase plays no ghost seasons', () => {
  it('a retired-phase season advance adds no season rows for me while the world moves on', async () => {
    const { career, me } = nbaCareer('i68-ghost');
    applyChoice(career, { kind: 'retire' });
    const rowsAtRetire = me.seasons.length;
    const fromSeason = career.league.season;
    const archivesBefore = career.league.archives.length;

    const digest = await advanceCareerWeek(career, fastSim); // one league season per retired tick

    expect(career.league.season).toBeGreaterThan(fromSeason);          // the world stayed alive
    expect(career.league.archives.length).toBeGreaterThan(archivesBefore);
    expect(me.seasons.length).toBe(rowsAtRetire);                      // the ball actually stopped
    expect(digest.gamesPlayed.length).toBe(0);
  });
});

describe('the age-40 forced wrap retires the league player too', () => {
  it('a china year wrap at forty ends the phase and the league presence together', async () => {
    const { career, me, teamId } = nbaCareer('i68-forty');
    const league = career.league;
    // the descent shape applyAbroadOffer leaves behind: waived into the FA
    // pool, career.nbaTeam cleared, me bound into BOTH pools (one object)
    const team = league.teams[teamId]!;
    team.roster = team.roster.filter(id => id !== career.me);
    me.contract = null;
    me.status = 'freeAgent';
    league.freeAgents.push(career.me);
    career.players[career.me] = me;
    career.nbaTeam = null;
    career.clock.phase = 'china';
    // forty at the wrap: transitionAtYearWrap reads age after the year increments
    me.bornSeason = (career.clock.year + 1) - 40;
    // the china season already played this year: a history row blocks a rebuild
    career.circuitHistory.push({
      year: career.clock.year, kind: 'china', teamName: 'Test CBA Club',
      w: 20, l: 10,
      myLine: { gp: 30, min: 34, pts: 22, reb: 6, ast: 5, stl: 1, blk: 0, tpm: 2, fgPct: 0.5 },
      finish: 'lost the final', honors: [],
    });
    career.clock.week = career.params.tick.weeksPerYear - 1; // the next advance wraps the year

    await advanceCareerWeek(career, fastSim);

    expect(career.clock.phase).toBe('retired');
    expect(career.epilogue).toBeTruthy();
    expect(me.status).toBe('retired');
    expect(league.freeAgents).not.toContain(career.me);
  });
});
