/**
 * Late-transaction news gate (issue #118): transactions created AFTER the
 * day's pulse still print the day they happen. Draft-night selections and
 * squeeze waives land in the transitions block; retirements land in the
 * rollover; the paused draft's re-entry path skips the pulse entirely.
 * Each seam runs a second desk pass, idempotent by story id.
 *
 * Two scenarios: an AI-run year (with a determinism twin advanced in
 * lockstep), and a human-chair year to the draft so the pause/resume
 * re-entry path is the one printing the war room's picks.
 *
 * COMPUTE BUDGET: three fake-sim league years less a stub (the twin pair
 * through year one, the human chair stopping at the draft), zero engine
 * games — the autosim.test.ts budget class.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '@hoopsh/engine';
import {
  advanceDay, applyUserAction, createLeague, generatePersona, streamRng,
} from '../src/index.js';
import { COLUMNIST } from '../src/media/news.js';
import type {
  GameJob, GameJobResult, League, LeagueDate, Transaction,
} from '../src/types.js';

/** Deterministic plausible result from the job seed alone (copied from autosim.test.ts, file-local there). */
function fakeSim(jobs: GameJob[]): GameJobResult[] {
  return jobs.map(job => {
    const rng = new Rng(`fake:${job.seed}`);
    let hs = 95 + rng.int(35);
    let as = 95 + rng.int(35);
    if (hs === as) hs += 1; // the engine never ties; neither does the fake
    const mkLines = (team: GameJob['home'], teamPts: number, side: 0 | 1) => {
      const ids = team.players.slice(0, 8);
      const shares = [0.24, 0.19, 0.15, 0.12, 0.10, 0.08, 0.07, 0.05];
      let assigned = 0;
      return ids.map((p, i) => {
        const pts = i === ids.length - 1 ? teamPts - assigned : Math.round(teamPts * shares[i]!);
        assigned += pts;
        const min = [36, 34, 32, 30, 26, 22, 18, 12][i]!;
        return {
          playerId: p.id, teamId: team.id, starter: i < 5,
          min, pts,
          fgm: Math.max(0, Math.round(pts * 0.38)), fga: Math.max(1, Math.round(pts * 0.85)),
          tpm: Math.round(pts * 0.12), tpa: Math.round(pts * 0.3),
          ftm: Math.round(pts * 0.14), fta: Math.round(pts * 0.18),
          orb: rng.int(3), drb: 2 + rng.int(6), ast: rng.int(8), stl: rng.int(3),
          blk: rng.int(2), tov: rng.int(4), pf: rng.int(5),
          plusMinus: (side === 0 ? hs - as : as - hs) > 0 ? rng.int(15) : -rng.int(15),
        };
      });
    };
    const totals = (pts: number) => ({
      pts, fgm: Math.round(pts * 0.37), fga: 88, tpm: Math.round(pts * 0.12), tpa: 35,
      ftm: Math.round(pts * 0.15), fta: 20, orb: 10, drb: 33, ast: 25, stl: 7,
      blk: 4, tov: 13, pf: 19, pace: 98, fastbreakPts: 12, biggestLead: Math.abs(hs - as) + 4,
    });
    return {
      index: job.index,
      gameId: job.gameId,
      final: [hs, as] as [number, number],
      ot: 0,
      lines: [...mkLines(job.home, hs, 0), ...mkLines(job.away, as, 1)],
      totals: [totals(hs), totals(as)] as GameJobResult['totals'],
      keyPlays: [],
    };
  });
}

const BUDGET = 240_000;
const sameDate = (a: LeagueDate, b: LeagueDate): boolean => a.season === b.season && a.day === b.day;
type DraftTx = Extract<Transaction, { kind: 'draftSelection' }>;
type RetireTx = Extract<Transaction, { kind: 'retirement' }>;

// ---- scenario A: an AI-run year, with a determinism twin in lockstep ----

const A_SEED = 'newsdesk-gate';

interface RunA {
  league: League;
  twin: League;
  /** every digest's newsIds across the whole year, in day order */
  digestNewsIds: string[];
  /** the digest of the day the draft completed (phase flipped to moratorium) */
  draftDigestIds: string[];
  /** the digest of the rollover day */
  rolloverDigestIds: string[];
}

// One shared run for every assertion below: the shim has no beforeAll, so
// the run starts once at module load and each test awaits it.
const runA: Promise<RunA> = (async () => {
  const mk = (): League => {
    const league = createLeague({ seed: A_SEED, userTeam: 'nye' });
    // every chair AI-run so draft night never pauses (autosim.test.ts pattern)
    league.teams.nye!.gm = generatePersona(streamRng(A_SEED, 'genesis', 'user-gm'));
    return league;
  };
  const league = mk();
  const twin = mk();
  const digestNewsIds: string[] = [];
  let draftDigestIds: string[] = [];
  let rolloverDigestIds: string[] = [];
  const start = league.season;
  let guard = 0;
  while (league.season < start + 1 && guard++ < 500) {
    const d = await advanceDay(league, fakeSim);
    await advanceDay(twin, fakeSim);
    digestNewsIds.push(...d.newsIds);
    if (d.phaseChangedTo === 'moratorium') draftDigestIds = d.newsIds;
    if (d.seasonRolledTo !== undefined) rolloverDigestIds = d.newsIds;
  }
  return { league, twin, digestNewsIds, draftDigestIds, rolloverDigestIds };
})();

describe('late-transaction news, AI-run year (issue #118)', () => {
  it('prints one story per draft-night selection, dated and surfaced the night it happens', { timeout: BUDGET }, async () => {
    const { league, draftDigestIds } = await runA;
    const picks = league.transactions.filter((t): t is DraftTx => t.kind === 'draftSelection');
    const stories = league.news.filter(n => n.type === 'draft');
    expect(picks.length).toBeGreaterThanOrEqual(55); // 60 slots minus edge cases, the autosim floor
    expect(stories.length).toBe(picks.length);
    for (const tx of picks) {
      const mine = stories.filter(n => n.players[0] === tx.playerId);
      expect(mine.length).toBe(1);
      const story = mine[0]!;
      expect(story.teams).toEqual([tx.teamId]);
      expect(sameDate(story.date, tx.date)).toBe(true);
      expect(story.headline.includes(league.players[tx.playerId]!.name)).toBe(true);
      // the desk's weighting: a top-5 pick is front page, round 2 is wire
      expect(story.weight).toBe(tx.round === 2 ? 1 : tx.pick <= 5 ? 3 : 2);
      expect(draftDigestIds.includes(story.id)).toBe(true);
    }
  });

  it('keeps the rookie deal off the wire: the pick story carries the contract line', { timeout: BUDGET }, async () => {
    const { league } = await runA;
    const picks = league.transactions.filter((t): t is DraftTx => t.kind === 'draftSelection');
    const drafted = new Set(picks.map(t => t.playerId));
    const draftDate = picks[0]!.date;
    // a same-night squeeze WAIVE of a fresh second-rounder is legitimate
    // coverage and does happen; only the signing-shaped story is mechanism
    const signingShaped = league.news.filter(n =>
      n.type === 'transactionWire' && sameDate(n.date, draftDate)
      && n.players.some(p => drafted.has(p))
      && /sign|lands with|commit/.test(n.headline));
    expect(signingShaped.length).toBe(0);
  });

  it('prints the retirement retrospectives the day the rollover logs them', { timeout: BUDGET }, async () => {
    const { league, rolloverDigestIds } = await runA;
    const retirements = league.transactions.filter((t): t is RetireTx => t.kind === 'retirement');
    const stories = league.news.filter(n => n.type === 'retirement');
    expect(retirements.length).toBeGreaterThanOrEqual(1); // the genesis old guard hangs them up
    expect(stories.length).toBe(retirements.length);
    for (const tx of retirements) {
      const mine = stories.filter(n => n.players[0] === tx.playerId);
      expect(mine.length).toBe(1);
      const story = mine[0]!;
      expect(sameDate(story.date, tx.date)).toBe(true);
      expect(story.byline).toBe(COLUMNIST);
      expect(story.weight).toBe(2);
      expect(story.body.includes('retires')).toBe(true);
      expect(rolloverDigestIds.includes(story.id)).toBe(true);
    }
  });

  it('surfaces every story in exactly one day digest, no duplicates in the feed', { timeout: BUDGET }, async () => {
    const { league, digestNewsIds } = await runA;
    expect(new Set(league.news.map(n => n.id)).size).toBe(league.news.length);
    // the digests' union IS the feed: nothing prints invisibly, nothing twice
    expect(digestNewsIds.length).toBe(league.news.length);
    expect(new Set(digestNewsIds).size).toBe(digestNewsIds.length);
    const feed = new Set(league.news.map(n => n.id));
    expect(digestNewsIds.every(id => feed.has(id))).toBe(true);
  });

  it('replays byte-identical through the draft night and rollover seams', { timeout: BUDGET }, async () => {
    const { league, twin } = await runA;
    expect(JSON.stringify(league) === JSON.stringify(twin)).toBe(true);
  });
});

// ---- scenario B: a human chair, so the paused draft's re-entry prints ----

const B_SEED = 'newsdesk-pause';

interface RunB {
  league: League;
  pauses: number;
  userPicks: string[];
  digestNewsIds: string[];
}

const runB: Promise<RunB> = (async () => {
  // no persona installed: the user's chair is human (gm === null), so the
  // draft pauses on each of the user's picks and resumes through the
  // re-entry path that skips the daily pulse
  const league = createLeague({ seed: B_SEED, userTeam: 'nye' });
  const digestNewsIds: string[] = [];
  const userPicks: string[] = [];
  let pauses = 0;
  let guard = 0;
  while (league.phase !== 'moratorium' && guard++ < 600) {
    const d = await advanceDay(league, fakeSim);
    digestNewsIds.push(...d.newsIds);
    const paused = league.phase === 'draft' && league.inbox.some(i =>
      i.kind === 'decision' && !i.resolved && i.id.startsWith(`draft-${league.season}-pick-`));
    if (paused) {
      pauses += 1;
      const board = league.draftClass.filter(id => league.players[id]?.status === 'draftEligible');
      const res = applyUserAction(league, { kind: 'draftPick', playerId: board[0]! });
      if (!res.ok) throw new Error(`draftPick failed: ${res.errors.join('; ')}`);
      userPicks.push(board[0]!);
    }
  }
  return { league, pauses, userPicks, digestNewsIds };
})();

describe('late-transaction news, human chair (issue #118)', () => {
  it('pauses twice for the user and prints every pick, the war room picks included', { timeout: BUDGET }, async () => {
    const { league, pauses, userPicks } = await runB;
    expect(league.phase).toBe('moratorium'); // the draft completed
    // the user holds exactly its own two picks (no actions moved any)
    expect(pauses).toBe(2);
    expect(userPicks.length).toBe(2);
    const picks = league.transactions.filter((t): t is DraftTx => t.kind === 'draftSelection');
    const stories = league.news.filter(n => n.type === 'draft');
    expect(stories.length).toBe(picks.length);
    for (const pid of userPicks) {
      const story = stories.find(n => n.players[0] === pid)!;
      expect(Boolean(story)).toBe(true);
      expect(story.teams).toEqual(['nye']);
    }
  });

  it('no story goes unsurfaced across the pause and resume days', { timeout: BUDGET }, async () => {
    const { league, digestNewsIds } = await runB;
    expect(digestNewsIds.length).toBe(league.news.length);
    expect(new Set(digestNewsIds).size).toBe(digestNewsIds.length);
    const feed = new Set(league.news.map(n => n.id));
    expect(digestNewsIds.every(id => feed.has(id))).toBe(true);
  });
});
