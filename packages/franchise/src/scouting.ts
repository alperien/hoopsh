/**
 * scouting.ts - the fog of war. OWNER: ai-team task.
 *
 * Design law (docs/FRANCHISE.md 9): the fog belongs to the FUTURE, not the
 * present. Rostered pros read exact for current ability, everyone's (register
 * F5: league personnel knowledge is near-perfect; blurring the trade UI makes
 * it dishonest, not fun). Prospects' current ability and EVERYONE's ceiling
 * are perceived through deterministic per-team error, so busts and steals are
 * produced by the gap between the scouted range and the truth, at scale,
 * which is where the research says the uncertainty belongs (research 01 Q3:
 * "busts and steals happen ... because a player was just better/worse than
 * scouts thought"; research 04 steal 2: perceived-vs-true is the game).
 *
 * Determinism discipline: a team's read on a player is PERSISTENT, never
 * re-rolled. Every call derives FRESH rng streams and consumes a fixed draw
 * count, so call order can never change what a scout believes (rng.ts
 * registry: 'scout:<teamId>:<playerId>'). Two error terms:
 *  - per-player noise from 'scout:<teamId>:<playerId>' (their read on him),
 *    sd shrinking with coverage but never to zero (the draft stays a gamble);
 *  - per-team-per-group bias from 'scout:<teamId>:<scoutSeed>' (their
 *    international scout runs hot, differently from yours), sd flat at
 *    params.scouting.teamBiasSd. FrTeam.scoutSeed exists exactly for this:
 *    re-rolling a team's scouting identity (GM change) moves its biases.
 */
import { clamp } from '@hoopsh/engine';
import type {
  AttrGroup, FrPlayer, League, ScoutRange, ScoutReport, TeamId,
} from './types.js';
import { streamRng } from './rng.js';
import { ATTR_GROUPS, groupMean } from './people/dev.js';
import { archetypeLabelOf } from './people/archetypes.js';

// Re-exported group vocabulary: ATTR_GROUPS (people/dev.ts) is the one
// runtime copy of the PotentialProfile comment in types.ts; scouting reads
// the same mapping so a new dial can never fall between the two modules.
// STAGED re-export: the draft-room screen (Build C) groups a report's dial
// rows with this exact mapping.
export { ATTR_GROUPS };

/** Stable group iteration order (PotentialProfile declaration order). */
export const GROUP_ORDER: readonly AttrGroup[] = [
  'phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental',
];

// Report-texture constants: presentation conventions of the scouting memo,
// not sweepable market levers (those live in params.scouting).
const RANGE_HALF_SDS = 1.5;      // FEEL: printed range = perceived +/- 1.5 error sd (~87% of truths land inside; honest but not safe)
const MEDICAL_FLAG_PRONENESS = 70; // FEEL: proneness above this reads as a durability red flag in the medical file
const OLD_PROSPECT_AGE = 22;     // REAL-ish: a 22+ prospect is a four-year senior; short runway is a standard scouting note
const TEEN_PROSPECT_AGE = 19;    // REAL: 19 is the one-and-done floor; a teenager is all projection
const STRENGTH_BAR = 68;         // FEEL: a perceived group read in the high 60s is a sellable strength on a memo
const VETERAN_COMP_AGE = 24;     // FEEL: a comparison must be a known quantity, not another kid

/** True when the fog applies to this player's CURRENT ability (docs/FRANCHISE.md 9). */
function isProspect(player: FrPlayer): boolean {
  return player.status === 'draftEligible';
}

/**
 * Scouting coverage a team has on a player, 0-100. The user's coverage is
 * the invested ledger (league.scouting, fed by scout actions and the
 * combine); AI departments run at flat combine-level coverage (FEEL: every
 * front office attends the combine; deeper per-prospect investment is the
 * user's game, and a flat AI floor keeps their boards honestly foggy).
 */
function coverageFor(league: League, teamId: TeamId, playerId: string): number {
  if (teamId === league.userTeam) {
    return clamp(league.scouting[playerId]?.coverage ?? 0, 0, 100);
  }
  return clamp(league.params.scouting.combineCoverage, 0, 100);
}

/** Error sd at a coverage level: baseErrorSd at 0 easing to fullCoverageErrorSd at 100 (never zero). */
function errorSdFor(league: League, coverage: number): number {
  const s = league.params.scouting;
  return s.baseErrorSd + (s.fullCoverageErrorSd - s.baseErrorSd) * (clamp(coverage, 0, 100) / 100);
}

/**
 * The full 12-slot standard-normal noise table for one team's read on one
 * player: index = group position in GROUP_ORDER, +6 for ceiling reads. A
 * fresh stream and a FIXED draw count per call: the same slot always holds
 * the same value, so a scout's read is persistent and call-order-proof.
 */
function noiseTable(league: League, teamId: TeamId, playerId: string): number[] {
  const rng = streamRng(league.seed, 'scout', teamId, playerId);
  const table: number[] = [];
  // 2 kinds x 6 groups = 12 fixed draws, every call, no exceptions
  for (let i = 0; i < GROUP_ORDER.length * 2; i++) table.push(rng.gaussian(0, 1));
  return table;
}

/**
 * Per-team-per-group bias, the persistent DIRECTION of a franchise's
 * scouting error ("your international scout runs hot; so does theirs,
 * differently" - docs/FRANCHISE.md 9). Derived from the team's scoutSeed in
 * the registered 'scout:<teamId>:<...>' family; the seed occupies the
 * playerId slot and can never collide with a real id (generated ids are
 * 'p'-prefixed strings, scoutSeed is a number). Coverage never shrinks the
 * bias: money buys sharper reads, not different scouts.
 */
function biasTable(league: League, teamId: TeamId): number[] {
  const team = league.teams[teamId];
  if (!team) throw new Error(`scouting: unknown team ${teamId}`);
  const rng = streamRng(league.seed, 'scout', teamId, team.scoutSeed);
  const table: number[] = [];
  for (let i = 0; i < GROUP_ORDER.length; i++) {
    table.push(rng.gaussian(0, league.params.scouting.teamBiasSd));
  }
  return table;
}

/**
 * What this team believes a player's group value is (AI decision input and
 * the source of the user's report ranges). kind 'current' on a non-prospect
 * returns the exact truth (register F5); prospects and every 'ceiling' read
 * get truth + persistent deterministic error (bias + coverage-scaled
 * noise), clamped to the 0-100 rating scale. Pure read; draws only fresh
 * fixed-count streams (see file header).
 */
export function perceivedGroup(
  league: League, teamId: TeamId, playerId: string, group: AttrGroup, kind: 'current' | 'ceiling',
): number {
  const player = league.players[playerId];
  if (!player) throw new Error(`scouting: unknown player ${playerId}`);
  const truth = kind === 'current' ? groupMean(player.attr, group) : player.potential[group];
  if (kind === 'current' && !isProspect(player)) return truth; // the fog belongs to the future (F5)

  const gi = GROUP_ORDER.indexOf(group);
  const slot = kind === 'ceiling' ? gi + GROUP_ORDER.length : gi;
  const z = noiseTable(league, teamId, playerId)[slot]!;
  const bias = biasTable(league, teamId)[gi]!;
  const sd = errorSdFor(league, coverageFor(league, teamId, playerId));
  return clamp(truth + bias + z * sd, 0, 100);
}

/** [low, high] printed range around a perceived value, integer points, clamped to the scale. */
function rangeAround(perceived: number, halfWidth: number): ScoutRange {
  return [
    clamp(Math.round(perceived - halfWidth), 0, 100),
    clamp(Math.round(perceived + halfWidth), 0, 100),
  ];
}

// Memo vocabulary: how a scout names a position and a dominant tool.
const POS_NOUN: Record<FrPlayer['pos'], string> = {
  PG: 'guard', SG: 'guard', SF: 'wing', PF: 'forward', C: 'big',
};
const GROUP_ADJ: Record<AttrGroup, string> = {
  phys: 'explosive', scoring: 'scoring', playmaking: 'playmaking',
  defense: 'defensive-minded', rebounding: 'glass-cleaning', mental: 'high-IQ',
};
const GROUP_TOOL: Record<AttrGroup, string> = {
  phys: 'real athletic tools', scoring: 'a scorer\'s touch', playmaking: 'live passing vision',
  defense: 'defensive chops', rebounding: 'a nose for the ball', mental: 'a steady head',
};

/** Groups sorted by a perceived-value map, best first, GROUP_ORDER as the tiebreak. */
function groupsByStrength(values: Record<AttrGroup, number>): AttrGroup[] {
  return [...GROUP_ORDER].sort(
    (a, b) => values[b] - values[a] || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
  );
}

/**
 * Cosine similarity between two 6-dim group profiles. Shape similarity, not
 * size: a comp is about HOW a player plays, so a smaller version of the
 * same profile still reads as the same mold.
 */
function cosine(a: Record<AttrGroup, number>, b: Record<AttrGroup, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const g of GROUP_ORDER) {
    dot += a[g] * b[g];
    na += a[g] * a[g];
    nb += b[g] * b[g];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * (Re)build the user team's scouting report for a player at his CURRENT
 * coverage (league.scouting ledger). Pure construction: returns the report
 * without storing it (runCombine and the scouting UI own the write). Ranges
 * are perceived value +/- a coverage-driven width; the role line comes from
 * the strongest perceived groups + position; the comparison is the most
 * profile-similar rostered veteran by group cosine similarity (falling back
 * to a role phrase in a league with no vets to point at); confidence is the
 * coverage itself, which the UI must treat honestly (docs/FRANCHISE.md 9).
 */
export function buildUserReport(league: League, playerId: string): ScoutReport {
  const player = league.players[playerId];
  if (!player) throw new Error(`scouting: unknown player ${playerId}`);
  const coverage = clamp(league.scouting[playerId]?.coverage ?? 0, 0, 100);
  const halfWidth = errorSdFor(league, coverage) * RANGE_HALF_SDS;

  const perceivedCur = {} as Record<AttrGroup, number>;
  const perceivedCeil = {} as Record<AttrGroup, number>;
  const current = {} as Record<AttrGroup, ScoutRange>;
  const ceiling = {} as Record<AttrGroup, ScoutRange>;
  for (const g of GROUP_ORDER) {
    perceivedCur[g] = perceivedGroup(league, league.userTeam, playerId, g, 'current');
    perceivedCeil[g] = perceivedGroup(league, league.userTeam, playerId, g, 'ceiling');
    current[g] = rangeAround(perceivedCur[g], halfWidth);
    ceiling[g] = rangeAround(perceivedCeil[g], halfWidth);
  }

  const ranked = groupsByStrength(perceivedCur);
  const top = ranked[0]!;
  const second = ranked[1]!;
  const archLabel = archetypeLabelOf(player);
  let role = archLabel !== '' ? archLabel : `${GROUP_ADJ[top]} ${POS_NOUN[player.pos]}`;
  if (perceivedCur[second] >= STRENGTH_BAR) role += ` with ${GROUP_TOOL[second]}`;

  // comparison: the most profile-similar rostered veteran (their current
  // dials are league-public truth, F5), by cosine over group means
  let comp: FrPlayer | null = null;
  let compSim = -1;
  for (const vid of Object.keys(league.players).sort()) {
    const vet = league.players[vid]!;
    if (vid === playerId || vet.status !== 'roster') continue;
    if (league.season - vet.bornSeason < VETERAN_COMP_AGE) continue;
    const profile = {} as Record<AttrGroup, number>;
    for (const g of GROUP_ORDER) profile[g] = groupMean(vet.attr, g);
    const sim = cosine(perceivedCur, profile);
    if (sim > compSim) {
      compSim = sim;
      comp = vet;
    }
  }
  const comparison = comp ? `the mold of ${comp.name}` : `a ${role}`;

  const strengths: string[] = [];
  for (const g of ranked) {
    if (perceivedCur[g] >= STRENGTH_BAR && strengths.length < 3) strengths.push(GROUP_TOOL[g]);
  }

  const flags: string[] = [];
  const age = league.season - player.bornSeason;
  if (age >= OLD_PROSPECT_AGE) flags.push(`already ${age}: the runway is short`);
  if (age <= TEEN_PROSPECT_AGE) flags.push(`${age} years old: everything here is projection`);
  if (player.health.proneness > MEDICAL_FLAG_PRONENESS) flags.push('medical: durability concerns in the file');

  return {
    playerId,
    current,
    ceiling,
    coverage, // confidence IS coverage: the UI prints what the scouts earned
    role,
    comparison,
    strengths,
    flags,
    updatedOn: { season: league.season, day: league.day },
  };
}

/** Full-width placeholder so buildUserReport has a coverage ledger row to read. */
function placeholderReport(league: League, playerId: string, coverage: number): ScoutReport {
  const wide: ScoutRange = [0, 100];
  return {
    playerId,
    current: { phys: wide, scoring: wide, playmaking: wide, defense: wide, rebounding: wide, mental: wide },
    ceiling: { phys: wide, scoring: wide, playmaking: wide, defense: wide, rebounding: wide, mental: wide },
    coverage,
    role: '',
    comparison: '',
    strengths: [],
    flags: [],
    updatedOn: { season: league.season, day: league.day },
  };
}

/**
 * Combine day: every draft-class member gains params.scouting.combineCoverage
 * coverage (the one scouting event everyone attends), and the user's reports
 * refresh at the new coverage. Called by the spine at the lottery-to-draft
 * transition (tick.ts). Mutates league.scouting only.
 */
export function runCombine(league: League): void {
  for (const pid of league.draftClass) {
    if (!league.players[pid]) continue;
    const prior = league.scouting[pid];
    const coverage = clamp((prior?.coverage ?? 0) + league.params.scouting.combineCoverage, 0, 100);
    if (prior) prior.coverage = coverage;
    else league.scouting[pid] = placeholderReport(league, pid, coverage);
    // rebuild at the post-combine coverage (buildUserReport reads the ledger)
    league.scouting[pid] = buildUserReport(league, pid);
  }
}
