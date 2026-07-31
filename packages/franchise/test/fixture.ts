/**
 * Shared test fixture — a tiny, hand-rolled, type-complete League so that
 * build-wave tasks can test against real state before genesis lands (and
 * with fewer moving parts after). NOT a calibration object: 4 teams,
 * archetype rosters, flat contracts. Tests that need a full 30-team
 * league use createLeague once genesis exists.
 */
import type { Attributes, Tendencies } from '@hoopsh/engine';
import {
  eliteShooter, rimRunner, floorGeneral, threeAndD, scoringWing,
  postAnchor, comboGuard, glueForward, benchBig, benchScorer, stretchBig,
} from '@hoopsh/data';
import type {
  Contract, FrPlayer, FrTeam, League, PlayerId, Season, TeamId,
} from '../src/types.js';
import { defaultFranchiseParams } from '../src/params.js';
import { FRANCHISES } from '../src/teamdata.js';

const BUILDERS = [
  floorGeneral, eliteShooter, scoringWing, glueForward, rimRunner,
  comboGuard, threeAndD, postAnchor, benchScorer, stretchBig, benchBig,
] as const;

/** Positions matching BUILDERS order so fixture rosters are coherent. */
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'PF', 'SG', 'C', 'C'] as const;

function fixtureContract(playerId: PlayerId, teamId: TeamId, season: Season, salary: number, years: number): Contract {
  const rows = [];
  for (let i = 0; i < years; i++) rows.push({ season: season + i, salary, guaranteed: salary });
  return {
    id: `c-${playerId}`, playerId, teamId, years: rows,
    kind: 'standard', means: 'genesis', signedOn: { season, day: 0 },
    birdYearsAtSigning: 1,
  };
}

export function fixturePlayer(id: PlayerId, teamId: TeamId | null, season: Season, i: number): FrPlayer {
  const builder = BUILDERS[i % BUILDERS.length]!;
  const built = builder({ id, name: `Fixture ${id}` });
  const age = 22 + (i % 12);
  return {
    id,
    name: `Fixture ${id.toUpperCase()}`,
    pos: POSITIONS[i % POSITIONS.length]!,
    bornSeason: season - age,
    birthplace: 'Testville, USA',
    origin: 'college',
    originDetail: 'Fixture State',
    heightIn: built.heightIn,
    weightLb: built.weightLb,
    wingspanIn: built.wingspanIn ?? built.heightIn + 2,
    attr: { ...built.attr } as Attributes,
    tend: { ...built.tend } as Tendencies,
    potential: { phys: 80, scoring: 80, playmaking: 75, defense: 75, rebounding: 75, mental: 80 },
    workEthic: 60,
    disposition: { ambition: 50, loyalty: 50, professionalism: 60, marketPref: 50 },
    health: { proneness: 50, wear: 0, injury: null, history: [] },
    morale: 70,
    status: teamId ? 'roster' : 'freeAgent',
    contract: teamId ? fixtureContract(id, teamId, season, 10_000_000, 2) : null,
    rights: null,
    draft: { season: season - (age - 20), round: 1, pick: (i % 30) + 1, teamId },
    seasons: [],
    awards: [],
    devLog: [],
    faceSeed: i * 7919,
  };
}

export interface FixtureOpts {
  teams?: number;        // default 4
  playersPerTeam?: number; // default 10
  season?: Season;       // default 2026
  seed?: string;         // default 'fixture'
}

export function fixtureLeague(opts: FixtureOpts = {}): League {
  const teamCount = opts.teams ?? 4;
  const perTeam = opts.playersPerTeam ?? 10;
  const season = opts.season ?? 2026;
  const params = defaultFranchiseParams();

  const teams: Record<TeamId, FrTeam> = {};
  const players: Record<PlayerId, FrPlayer> = {};
  let seq = 0;

  for (let t = 0; t < teamCount; t++) {
    const fr = FRANCHISES[t]!;
    const roster: PlayerId[] = [];
    for (let i = 0; i < perTeam; i++) {
      const id = `p${String(++seq).padStart(4, '0')}`;
      players[id] = fixturePlayer(id, fr.id, season, i);
      roster.push(id);
    }
    teams[fr.id] = {
      id: fr.id, city: fr.city, name: fr.name, abbrev: fr.abbrev,
      conference: fr.conference, division: fr.division, colors: fr.colors,
      arena: fr.arena, founded: season,
      owner: { name: 'Fixture Owner', taxAppetite: 50, patience: 50, expectation: 'playoffs' },
      gm: t === 0 ? null : { name: 'Fixture GM', timeline: 'retool', risk: 50, pickLove: 50, starChase: 50, patience: 50 },
      coach: {
        id: `coach-${fr.id}`, name: 'Fixture Coach', pace: 50, threeBias: 50,
        helpAggr: 50, devQuality: 50, obedience: 80,
        hiredOn: { season, day: 0 }, contractSeasons: 3,
      },
      roster,
      twoWay: [],
      rotation: {
        minutes: {},
        starters: roster.slice(0, 5),
        b2bRestBelow: params.rotation.b2bRestBelow,
        scratches: [],
      },
      picks: [],
      taxSeasonsRecent: [],
      scoutSeed: t * 104729,
      strategy: { timeline: 'retool', untouchables: [] },
    };
  }

  const firstTeam = FRANCHISES[0]!.id;
  return {
    seed: opts.seed ?? 'fixture',
    params,
    season,
    startSeason: season,
    day: 0,
    phase: 'camp',
    calendar: [],
    userTeam: firstTeam,
    teams,
    players,
    schedule: [],
    results: {},
    standings: {},
    playoffs: [],
    playin: [],
    lottery: null,
    draftClass: [],
    scouting: {},
    freeAgents: [],
    offerSheets: [],
    waiverWire: [],
    negotiations: [],
    transactions: [],
    news: [],
    inbox: [],
    awards: [],
    records: [],
    archives: [],
    deadMoney: {},
    capLines: {
      [season]: {
        cap: params.cba.genesisCap,
        tax: params.cba.genesisTax,
        apron1: params.cba.genesisApron1,
        apron2: params.cba.genesisApron2,
        minSalaryFloor: Math.round(params.cba.genesisCap * params.cba.minPayrollPctOfCap),
      },
    },
    actionLog: [],
    actionSeq: 0,
  };
}
