/**
 * Sample fictional teams — the engine's default demo & calibration rosters.
 * Deliberately built as two balanced, stylistically different squads:
 * the Breakers play five-out pace-and-space; the Monarchs play through
 * the post with a defense-first identity.
 */

import { makeTactics, type Team } from '@hoopsh/engine';
import {
  benchBig, benchScorer, comboGuard, eliteShooter, floorGeneral,
  glueForward, postAnchor, rimRunner, scoringWing, threeAndD
} from './archetypes.js';

export function cascadiaBreakers(): Team {
  const players = [
    eliteShooter({ id: 'brk-mercer', name: 'Kaito Mercer', pos: 'PG', heightIn: 74 }),
    scoringWing({ id: 'brk-holloway', name: 'Dre Holloway', pos: 'SG' }),
    threeAndD({ id: 'brk-okafor', name: 'Sam Okafor', pos: 'SF' }),
    glueForward({ id: 'brk-reyes', name: 'Mateo Reyes', pos: 'PF' }),
    rimRunner({ id: 'brk-ratliff', name: 'Bo Ratliff', pos: 'C' }),
    comboGuard({ id: 'brk-june', name: 'Theo June', pos: 'SG' }),
    benchScorer({ id: 'brk-vance', name: 'Ripley Voss', pos: 'SG' }),
    floorGeneral({ id: 'brk-ito', name: 'Ren Ito', pos: 'PG', heightIn: 73, weightLb: 180 }),
    benchBig({ id: 'brk-marsh', name: 'Dune Marsh', pos: 'C' }),
    glueForward({ id: 'brk-call', name: 'Avery Call', pos: 'PF', heightIn: 81 })
  ];
  return {
    id: 'breakers',
    name: 'Cascadia Breakers',
    abbrev: 'CAS',
    players,
    starters: ['brk-mercer', 'brk-holloway', 'brk-okafor', 'brk-reyes', 'brk-ratliff'],
    tactics: makeTactics({ pace: 66, threeBias: 68, helpAggr: 52 })
  };
}

export function meridianMonarchs(): Team {
  const players = [
    floorGeneral({ id: 'mon-vance', name: 'Elias Vance', pos: 'PG' }),
    comboGuard({ id: 'mon-cole', name: 'Marcus Cole', pos: 'SG' }),
    threeAndD({ id: 'mon-drummond', name: 'Ash Drummond', pos: 'SF' }),
    postAnchor({ id: 'mon-osei', name: 'Viktor Osei', pos: 'PF' }),
    rimRunner({ id: 'mon-halvorsen', name: 'Nils Halvorsen', pos: 'C' }),
    benchScorer({ id: 'mon-quick', name: 'Jerry Quick', pos: 'SG' }),
    scoringWing({ id: 'mon-adler', name: 'Kass Adler', pos: 'SF', heightIn: 79 }),
    comboGuard({ id: 'mon-pratt', name: 'Ozzie Pratt', pos: 'PG', heightIn: 74 }),
    benchBig({ id: 'mon-yaro', name: 'Big Sky Yaro', pos: 'C', heightIn: 85 }),
    glueForward({ id: 'mon-flores', name: 'Rio Flores', pos: 'PF' })
  ];
  return {
    id: 'monarchs',
    name: 'Meridian Monarchs',
    abbrev: 'MER',
    players,
    starters: ['mon-vance', 'mon-cole', 'mon-drummond', 'mon-osei', 'mon-halvorsen'],
    tactics: makeTactics({ pace: 46, threeBias: 44, helpAggr: 62 })
  };
}

export function sampleMatchup(): { home: Team; away: Team } {
  return { home: cascadiaBreakers(), away: meridianMonarchs() };
}
