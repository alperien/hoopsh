/**
 * Archived awards carry printable winner names (issue #188): the almanac
 * screen printed raw ids ("Most valuable player: p0016") because
 * AwardResult carries ids only and the archive is meant to be
 * self-contained printed history. archiveSeason bakes winnerNames at
 * write time, the records book's own pattern (updateRecords resolves
 * holderName the same way, with the same honest raw-id fallback).
 */
import { describe, expect, it } from 'vitest';
import { archiveSeason } from '../src/media/almanac.js';
import type { League, PlayoffSeries, TeamId } from '../src/types.js';
import { fixtureLeague } from './fixture.js';

function finishedSeason(): { league: League; champ: TeamId; runnerUp: TeamId } {
  const league = fixtureLeague();
  const ids = Object.keys(league.teams);
  const champ = ids[0]!;
  const runnerUp = ids[1]!;
  const finals: PlayoffSeries = {
    id: `s${league.season}-finals`, round: 4, conference: 'Finals',
    high: champ, low: runnerUp, highSeed: 1, lowSeed: 2,
    wins: [4, 1], games: [], winner: champ,
  };
  league.playoffs.push(finals);
  league.awards.push(
    { season: league.season, kind: 'mvp', winners: ['p0001'], ballot: [{ id: 'p0001', share: 0.7 }] },
    { season: league.season, kind: 'coy', winners: [runnerUp], ballot: [{ id: runnerUp, share: 0 }] },
    // a man the league no longer carries: the fallback must stay honest
    { season: league.season, kind: 'fmvp', winners: ['p9999'], ballot: [] },
  );
  return { league, champ, runnerUp };
}

const { league, runnerUp } = finishedSeason();
const archive = archiveSeason(league);

describe('archiveSeason bakes winner names (#188)', () => {
  it('archives the finished season', () => {
    expect(archive).toBeTruthy();
    expect(archive!.awards.length).toBe(3);
  });

  it('resolves player winners through league.players, parallel to winners', () => {
    const mvp = archive!.awards.find(x => x.kind === 'mvp')!;
    expect(mvp.winnerNames).toEqual(['Fixture P0001']);
  });

  it('resolves team-kind winners (coy) through league.teams', () => {
    const coy = archive!.awards.find(x => x.kind === 'coy')!;
    expect(coy.winnerNames).toEqual([league.teams[runnerUp]!.name]);
  });

  it('falls back to the raw id for names the league no longer carries', () => {
    const fmvp = archive!.awards.find(x => x.kind === 'fmvp')!;
    expect(fmvp.winnerNames).toEqual(['p9999']);
  });

  it('leaves the live award rows untouched (the archive copies, not aliases)', () => {
    for (const a of league.awards) expect('winnerNames' in a).toBe(false);
  });
});
