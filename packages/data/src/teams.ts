/**
 * Sample fictional teams: the engine's default demo and calibration
 * rosters. Two balanced, stylistically different squads. The Breakers play
 * five-out pace-and-space; the Monarchs play through the post with a
 * defense-first identity.
 *
 * These are the two calibration teams. Every NBA_BANDS acceptance range in
 * packages/harness/src/bands.ts and every default sweep candidate in
 * sweep.ts was measured/tuned against cascadiaBreakers() vs.
 * meridianMonarchs() specifically (via sampleMatchup(), used everywhere
 * from bench.ts to sweep-worker.ts as the default matchup). The
 * easy-to-miss consequence: editing a rating or tactics value here shifts
 * the league averages the bands were fit to, which can silently break
 * calibration — a band that passed before the edit may fail after it, with
 * nothing else having changed. Per AGENTS.md's ownership rules, treat
 * these two rosters with the same caution as a params.ts SWEPT constant:
 * after a deliberate edit, re-run `npm run batch` (or a fresh sweep) to
 * confirm the bands still hold. Don't assume it was safe.
 *
 * The stylistic contrast is load-bearing: tactics.pace=66/threeBias=68
 * (Breakers) vs. pace=46/threeBias=44 (Monarchs), plus the archetype mix
 * below (Breakers lean shooting/spacing archetypes: eliteShooter,
 * threeAndD, comboGuard, benchScorer; Monarchs lean post/defense
 * archetypes: postAnchor, floorGeneral, benchBig), mean a calibration run
 * stress-tests both ends of the engine's playing-style spectrum in the
 * same batch, not just one "default" style. run.ts's `mirror` option (each
 * team plays home half the time) exists so that contrast measures style,
 * not a home-side artifact; see its doc comment for the full rationale.
 */

import { makeTactics, type Team } from '@hoopsh/engine';
import {
  benchBig, benchScorer, comboGuard, eliteShooter, floorGeneral,
  glueForward, postAnchor, rimRunner, scoringWing, threeAndD
} from './archetypes.js';

/**
 * Five-out pace-and-space identity: high pace (66) and high threeBias (68)
 * tactics, an eliteShooter at the point (unusual positionally: a
 * shoot-first lead guard, not a traditional distributor), plus threeAndD
 * and comboGuard for perimeter depth. rimRunner at center fits this style
 * — a vertical, gravity-light dive man who clears space for shooters
 * rather than posting up and clogging it.
 */
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

/**
 * Post-up, defense-first identity: the stylistic opposite of the Breakers.
 * Low pace (46) and low threeBias (44) tactics, a traditional floorGeneral
 * (pass-first, not shoot-first) at the point, and a postAnchor at power
 * forward who actually uses the post tendency, unlike the Breakers' more
 * spacing-oriented forwards. Higher helpAggr (62 vs. 52) matches the
 * "defense-first" label: the tactics numbers say this team leans harder
 * into helping/rotating than initiating its own pace.
 */
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

/** The default matchup used everywhere a caller just needs "two reasonable
 * teams" without constructing its own roster: simone.ts's default demo
 * game, bench.ts's perf benchmark, run.ts's runBatch() fallback, and
 * sweep-worker.ts's per-candidate evaluation all call this rather than
 * cascadiaBreakers()/meridianMonarchs() directly. Cascadia is always
 * `home` here. Callers that need home/away balance apply their own flip
 * (see run.ts's `mirror` option and sweep-worker.ts's matching `flip`
 * line); this function never alternates on its own. */
export function sampleMatchup(): { home: Team; away: Team } {
  return { home: cascadiaBreakers(), away: meridianMonarchs() };
}
