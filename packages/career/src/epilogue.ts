/**
 * epilogue.ts - the end of the story and what outlives it: season honor
 * harvesting (rings, awards read off the real league archives), the
 * retirement summary, the HOF ballot, the rafters. The epilogue is
 * assembled from state that actually happened; nothing here invents a
 * resume (docs/CAREER.md pillar 2).
 *
 * Streams: 'career-hof' the ballot's borderline coin.
 */
import { streamRng } from '@hoopsh/franchise';
import type { CareerState, Epilogue } from './types.js';
import { careerEarnings } from './money.js';

const AWARD_LABELS: Record<string, string> = {
  mvp: 'MVP', dpoy: 'Defensive Player of the Year', roy: 'Rookie of the Year',
  smoy: 'Sixth Man of the Year', mip: 'Most Improved', fmvp: 'Finals MVP',
  allLeague1: 'All-League First Team', allLeague2: 'All-League Second Team',
  allLeague3: 'All-League Third Team', allDefense1: 'All-Defense First Team',
  allDefense2: 'All-Defense Second Team', allRookie: 'All-Rookie Team',
  allStar: 'All-Star', scoringTitle: 'scoring title',
};

/**
 * Harvest the honors the league just archived: my awards off the real
 * ballots, a ring when my team won it all. Called at every career year
 * wrap (tick.ts); idempotent through event-id dedupe.
 */
export function harvestSeasonHonors(career: CareerState): void {
  const seen = new Set(career.events.filter(e => e.kind === 'honor').map(e => e.id));
  const push = (id: string, reason: string) => {
    if (seen.has(id)) return;
    career.events.push({ id, clock: { ...career.clock }, kind: 'honor', reason });
  };

  for (const archive of career.league.archives) {
    if (archive.draftClass !== undefined) { // a fully stamped archive
      // A ring requires a season row on the champion team for that specific
      // season. This is the only check that is correct across all phases:
      // - 'career.nbaTeam === archive.champion' used the current team pointer,
      //   granting pre-entry titles and missing rings after trades or descent.
      // - 'wasMySeason' returned true unconditionally while phase === 'nba',
      //   making the guard vacuous for any player in their NBA career.
      const onChampion = career.league.players[career.me]?.seasons.some(
        s => s.season === archive.season && s.teamId === archive.champion,
      );
      if (onChampion) {
        const team = career.league.teams[archive.champion]?.name ?? archive.champion;
        push(`ev-honor-ring-${archive.season}`, `NBA champion: ${team}, ${archive.season}`);
      }
    }
    for (const award of archive.awards) {
      if (!(award.winners as string[]).includes(career.me)) continue;
      // An honor attaches to a season actually played, which a season row
      // proves — the same evidence the ring branch reads. Without the gate
      // the retired-phase harvest read every new archive forever, and a
      // league-presence bug (issue #68: a ghost me still playing after
      // retirement) compounded into a posthumously growing resume.
      const played = career.league.players[career.me]?.seasons.some(
        s => s.season === award.season,
      );
      if (!played) continue;
      const label = AWARD_LABELS[award.kind] ?? award.kind;
      push(`ev-honor-${award.kind}-${award.season}`, `${label}, ${award.season}`);
    }
  }
}

/** Honors-weighted legacy score; the HOF and the rafters read it. */
export function legacyScore(career: CareerState): number {
  const honors = career.events.filter(e => e.kind === 'honor').map(e => e.reason);
  const count = (m: string) => honors.filter(h => h.includes(m)).length;
  const score = count('NBA champion') * 12
    + count('MVP,') * 15
    + count('Finals MVP') * 8
    + count('All-League') * 6
    + count('All-Star') * 3
    + count('All-Defense') * 3
    + count('scoring title') * 4
    + count('Rookie of the Year') * 4
    + Math.min(12, careerEarnings(career) / 20_000_000);
  return Math.round(score * 10) / 10;
}

/** The summary at the moment the ball stops. */
export function buildEpilogue(career: CareerState): Epilogue {
  harvestSeasonHonors(career);
  const honors = [...new Set(career.events.filter(e => e.kind === 'honor').map(e => e.reason))];
  const nbaSeasons = new Set(
    career.ledger.filter(e => e.label.includes('contract year')).map(e => e.year),
  ).size;
  return {
    retiredYear: career.clock.year,
    seasonsPlayed: career.circuitHistory.length + nbaSeasons,
    careerEarnings: careerEarnings(career),
    rings: honors.filter(h => h.includes('NBA champion')).length,
    honors,
  };
}

/**
 * The legacy clock, ticking at career year wraps after retirement: the
 * ballot arrives hofBallotYears after the jersey comes off; the rafters
 * answer two years in when one franchise owns the story.
 */
export function advanceLegacy(career: CareerState): void {
  const ep = career.epilogue;
  if (!ep) return;
  const since = career.clock.year - ep.retiredYear;
  const m = career.params.money;

  if (since === 2 && !ep.jerseyRetiredBy && career.nbaTeam && legacyScore(career) >= m.jerseyRetireScore) {
    ep.jerseyRetiredBy = career.nbaTeam;
    const team = career.league.teams[career.nbaTeam]?.name ?? career.nbaTeam;
    career.events.push({
      id: `ev-honor-rafters-${career.clock.year}`,
      clock: { ...career.clock },
      kind: 'honor',
      reason: `${team} raised the number to the rafters`,
    });
  }

  if (since === m.hofBallotYears && ep.hofInducted === undefined) {
    const score = legacyScore(career);
    let inducted = false;
    if (score >= m.hofScoreFloor) {
      inducted = true;
    } else if (score >= m.hofScoreFloor * 0.7) {
      // the borderline case goes to the room
      const rng = streamRng(career.seed, 'career-hof');
      inducted = rng.chance((score - m.hofScoreFloor * 0.7) / (m.hofScoreFloor * 0.3));
    }
    ep.hofInducted = inducted;
    if (inducted) {
      ep.hofYear = career.clock.year;
      career.events.push({
        id: `ev-honor-hof-${career.clock.year}`,
        clock: { ...career.clock },
        kind: 'honor',
        reason: `Hall of Fame, class of ${career.clock.year}`,
      });
    } else {
      career.events.push({
        id: `ev-phase-ballot-${career.clock.year}`,
        clock: { ...career.clock },
        kind: 'phase',
        reason: 'the ballot came and went; the phone stayed quiet',
      });
    }
  }
}
