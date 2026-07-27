/**
 * Deterministic fictional-league generation for the season driver, plus the
 * team-strength fixtures the Monte-Carlo sanity tests need.
 *
 * This is HARNESS TOOLING, not calibration data: the two @hoopsh/data
 * rosters (cascadiaBreakers/meridianMonarchs) remain the calibration teams
 * (see teams.ts's file header); the teams generated here exist so `npm run
 * season -- --teams N` can field an N-team league without hand-writing N
 * rosters, and so tests can construct "same team, clearly stronger/weaker"
 * pairs. Generation is a pure function of (n, seed): the engine's own
 * seeded Rng drives every choice, so a league is exactly as reproducible as
 * a game.
 */

import { Rng, clamp, makeTactics, type Player, type Team } from '@hoopsh/engine';
import {
  benchBig, benchScorer, comboGuard, eliteShooter, floorGeneral,
  glueForward, postAnchor, rimRunner, scoringWing, stretchBig, threeAndD
} from '@hoopsh/data';

// city/nickname pools sized coprime (18 and 17) so the (k mod 18, k mod 17)
// pairing stays unique for k < 306 teams — comfortably past any league size
// this repo will simulate.
const CITIES = [
  'Aurora', 'Basalt', 'Cinder', 'Delmar', 'Ember', 'Fenwick', 'Granite', 'Harbor',
  'Ironwood', 'Juniper', 'Kestrel', 'Lumen', 'Mesa', 'Nimbus', 'Onyx', 'Pinnacle',
  'Quarry', 'Redcliff'
];
const NICKNAMES = [
  'Comets', 'Drift', 'Falcons', 'Herons', 'Lynx', 'Mariners', 'Nomads', 'Otters',
  'Pike', 'Ravens', 'Sables', 'Titans', 'Urchins', 'Vipers', 'Wolves', 'Yaks',
  'Zephyrs'
];
const FIRST = [
  'Ade', 'Bram', 'Cy', 'Dex', 'Emil', 'Finn', 'Gus', 'Hale', 'Ike', 'Jori',
  'Kal', 'Lior', 'Milo', 'Nash', 'Oz', 'Pax', 'Quin', 'Rune', 'Sol', 'Tevin',
  'Usher', 'Vico', 'Wes', 'Xan'
];
const LAST = [
  'Ashford', 'Bell', 'Calder', 'Dorsey', 'Ellison', 'Frost', 'Garland', 'Hollis',
  'Ives', 'Joyner', 'Kade', 'Lockwood', 'Mercer', 'Nyberg', 'Okada', 'Pruitt',
  'Quill', 'Rhodes', 'Stroud', 'Tiller', 'Ueda', 'Vance', 'Whitlock', 'Yoder'
];

type Maker = (who: { id: string; name: string; pos?: Player['pos'] }) => Player;

// archetype pools per lineup slot — starters first five, bench last five.
// Pools deliberately overlap so two generated teams can share a style but
// never (statistically) a whole roster.
const SLOTS: { pos: Player['pos']; pool: Maker[] }[] = [
  { pos: 'PG', pool: [floorGeneral, comboGuard, eliteShooter] },
  { pos: 'SG', pool: [scoringWing, threeAndD, comboGuard, benchScorer] },
  { pos: 'SF', pool: [threeAndD, scoringWing, glueForward] },
  { pos: 'PF', pool: [postAnchor, glueForward, stretchBig] },
  { pos: 'C', pool: [rimRunner, benchBig, stretchBig, postAnchor] },
  { pos: 'PG', pool: [comboGuard, floorGeneral] },
  { pos: 'SG', pool: [benchScorer, comboGuard, threeAndD] },
  { pos: 'SF', pool: [glueForward, scoringWing] },
  { pos: 'PF', pool: [glueForward, stretchBig, benchBig] },
  { pos: 'C', pool: [benchBig, rimRunner] }
];

/** Clone a player with every ATTRIBUTE shifted by `delta` (clamped 1..99,
 *  inside the 0-100 data-pack contract). Tendencies are left alone — this
 *  changes how GOOD a team is, not how it plays. */
export function scalePlayer(p: Player, delta: number): Player {
  const attr = { ...p.attr };
  for (const k of Object.keys(attr) as (keyof Player['attr'])[]) {
    attr[k] = clamp(Math.round(attr[k] + delta), 1, 99);
  }
  return { ...p, attr };
}

/** Uniformly stronger/weaker copy of a team (every player's every attribute
 *  shifted by `delta`), re-identified so the copy can share a court with its
 *  source. The Monte-Carlo "strong beats weak" sanity check is built on
 *  this. */
export function scaleTeam(team: Team, delta: number, idSuffix = `x${delta}`): Team {
  const renamed = cloneTeamWithIds(team, idSuffix);
  return {
    ...renamed,
    players: renamed.players.map((p) => scalePlayer(p, delta))
  };
}

/** Deep-copy a team under new player/team ids (`<id>-<suffix>`). Needed to
 *  play a team "against itself": box scores key player lines by player id,
 *  so both sides sharing ids would merge their stat lines. */
export function cloneTeamWithIds(team: Team, suffix: string): Team {
  const rename = (id: string): string => `${id}-${suffix}`;
  return {
    ...team,
    id: rename(team.id),
    name: `${team.name} (${suffix})`,
    players: team.players.map((p) => ({
      ...p,
      id: rename(p.id),
      attr: { ...p.attr },
      tend: { ...p.tend }
    })),
    starters: team.starters.map(rename),
    tactics: { ...team.tactics }
  };
}

/**
 * Generate the k-th team of a league deterministically from `seed`.
 *
 * Identity (city/nickname) is positional; roster and tactics come from an
 * Rng seeded `${seed}:team${k}`, so team k is stable regardless of how many
 * other teams are generated. Each team also gets a QUALITY OFFSET drawn
 * uniformly from [-strengthSpread, +strengthSpread] and applied to every
 * attribute — without it a generated league is nearly flat and standings
 * are mostly noise; with it the standings table has real structure for SOS
 * and the Monte-Carlo API to chew on.
 */
export function makeLeagueTeam(k: number, seed: string, strengthSpread = 5): Team {
  // Exported API: a negative or fractional k would otherwise surface as an
  // opaque `undefined.toLowerCase` TypeError from the positional lookups
  // below (JS % is signed). The guard also makes the `!` assertions honest.
  if (!Number.isInteger(k) || k < 0) throw new Error(`makeLeagueTeam: need an integer k >= 0, got ${k}`);
  const rng = new Rng(`${seed}:team${k}`);
  const city = CITIES[k % CITIES.length]!;
  const nick = NICKNAMES[k % NICKNAMES.length]!;
  const id = `lg${k}-${city.toLowerCase()}`;
  const delta = Math.round(rng.range(-strengthSpread, strengthSpread));

  const players: Player[] = SLOTS.map((slot, i) => {
    const make = slot.pool[rng.int(slot.pool.length)]!; // Rng.int(n) is always in [0, n)
    const name = `${FIRST[rng.int(FIRST.length)]} ${LAST[rng.int(LAST.length)]}`;
    return scalePlayer(
      make({ id: `${id}-p${i}`, name, pos: slot.pos }),
      delta
    );
  });

  return {
    id,
    name: `${city} ${nick}`,
    abbrev: (city.slice(0, 2) + nick[0]).toUpperCase(),
    players,
    starters: players.slice(0, 5).map((p) => p.id),
    tactics: makeTactics({
      pace: Math.round(rng.range(42, 70)),
      threeBias: Math.round(rng.range(40, 70)),
      helpAggr: Math.round(rng.range(45, 65))
    })
  };
}

/** Generate an n-team league. Pure in (n, seed): same inputs, same teams. */
export function makeLeague(n: number, seed = 'league', strengthSpread = 5): Team[] {
  if (!Number.isInteger(n) || n < 2) throw new Error(`makeLeague: need an integer n >= 2, got ${n}`);
  return Array.from({ length: n }, (_, k) => makeLeagueTeam(k, seed, strengthSpread));
}
