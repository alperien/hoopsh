/**
 * Shared career test fixture - a minimal, type-complete CareerState in
 * the middle of a high school season, so build-wave tasks can test
 * before creation.ts lands (and with fewer moving parts after). Not a
 * calibration object: four tiny HS teams, archetype rosters, a fixture
 * league underneath.
 */
import type {
  ApproachCard, CareerState, Circuit, CircuitTeam, CoachState, WeekPlan,
} from '../src/types.js';
import { defaultCareerParams } from '../src/params.js';
import type { FrPlayer, PlayerId } from '@hoopsh/franchise';
import { fixtureLeague, fixturePlayer } from '../../franchise/test/fixture.js';

const HS_TEAMS: Array<[string, string, string, [string, string]]> = [
  ['hs-oakridge', 'Oak Ridge Central', 'OAK', ['#1d3557', '#f4a261']],
  ['hs-westfield', 'Westfield Prep', 'WST', ['#0a6640', '#f2c14e']],
  ['hs-mercer', 'Mercer County', 'MER', ['#8d1f2c', '#0f2f56']],
  ['hs-lakeview', 'Lakeview', 'LKV', ['#5c1f8a', '#c0c0c0']],
];

export interface CareerFixtureOpts {
  seed?: string;
  /** my quality tilt: fixture players are archetype clones; index picks one */
  meIndex?: number;
}

export function fixtureCareer(opts: CareerFixtureOpts = {}): CareerState {
  const seed = opts.seed ?? 'career-fixture';
  const params = defaultCareerParams();
  const year = 2026;

  // circuit population: 4 teams x 8 kids, me on team 0, the rival on team 1
  const players: Record<PlayerId, FrPlayer> = {};
  let seq = 9000; // clear of the league fixture's p0001.. range
  const teams: CircuitTeam[] = HS_TEAMS.map(([id, name, abbrev, colors], t) => {
    const roster: PlayerId[] = [];
    for (let i = 0; i < 8; i++) {
      const pid = `p${String(++seq).padStart(4, '0')}`;
      const kid = fixturePlayer(pid, null, year, i);
      // seventeen-year-olds: re-age the fixture body and blank the ledger
      kid.bornSeason = year - 17;
      kid.status = 'prospect';
      kid.contract = null;
      kid.draft = null;
      players[pid] = kid;
      roster.push(pid);
    }
    return { id, name, abbrev, colors, quality: 34, roster, starters: roster.slice(0, 5) };
  });

  const me = teams[0]!.roster[opts.meIndex ?? 0]!;
  const rivalId = teams[1]!.roster[0]!;
  players[me]!.name = 'Fixture Me';
  players[rivalId]!.name = 'Fixture Rival';

  const schedule: Circuit['schedule'] = [];
  // a tiny double round-robin across 6 weeks, two games most weeks
  let w = 0;
  for (let round = 0; round < 2; round++) {
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        schedule.push({
          id: `c${year}-w${w}-${teams[b]!.id}@${teams[a]!.id}-r${round}`,
          week: w,
          homeIdx: round === 0 ? a : b,
          awayIdx: round === 0 ? b : a,
          type: 'regular',
        });
        w = (w + 1) % 6;
      }
    }
  }
  schedule.sort((x, y) => x.week - y.week || x.id.localeCompare(y.id));

  const circuit: Circuit = {
    id: `hs-${year}`,
    kind: 'hs',
    year,
    packId: 'prep',
    teams,
    myTeamIdx: 0,
    schedule,
    results: {},
    standings: teams.map((_, teamIdx) => ({ teamIdx, w: 0, l: 0, pf: 0, pa: 0 })),
    bracket: [],
    complete: false,
  };

  const coach: CoachState = {
    name: 'Coach Wexler',
    personality: 'systems',
    trust: 50,
    role: 'starter',
    plan: {
      assertiveness: [30, 64], range: [30, 64], motor: [36, 70],
      defense: [33, 67], playmaking: [33, 67],
    },
    greenLight: false,
    grades: [],
    roleClock: { above: 0, below: 0 },
  };

  const neutralCard: ApproachCard = {
    assertiveness: 50, range: 50, motor: 50, defense: 50, playmaking: 50,
  };
  const weekPlan: WeekPlan = { slots: ['extraWork', 'body', 'rest'], focus: 'scoring' };

  return {
    seed,
    params,
    clock: { phase: 'hs', year, week: params.tick.hsSeasonStartWeek + 2 },
    me,
    players,
    rivalId,
    creation: {
      firstName: 'Fixture', lastName: 'Me', nationality: 'us',
      birthplace: 'Testville, Ohio', pos: players[me]!.pos,
      heightIn: players[me]!.heightIn, weightLb: players[me]!.weightLb,
      background: 'aau', preset: 'fourstar',
      budget: { phys: 20, scoring: 25, playmaking: 20, defense: 20, rebounding: 10, mental: 15 },
      signatures: ['movement-shooter', 'three-and-d'],
    },
    circuit,
    circuitHistory: [],
    energy: 80,
    weekPlan,
    coach,
    recruiting: { programs: [], interest: [], offers: [] },
    stock: { rank: null, history: [], perTeam: {}, combineDone: false, workoutsDone: [], workoutInvites: [] },
    phone: [],
    approach: neutralCard,
    nextApproach: null,
    ledger: [],
    league: fixtureLeague({ teams: 30, seed: `${seed}:league` }),
    nbaTeam: null,
    choiceLog: [],
    choiceSeq: 0,
    events: [],
    epilogue: null,
  };
}
