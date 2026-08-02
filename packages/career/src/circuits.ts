/**
 * circuits.ts - every league that is not the NBA: generation, schedules,
 * brackets, game jobs, result folds, summaries. OWNER: circuits task.
 * STATUS: implemented (career build wave A).
 *
 * A Circuit is a lightweight season, not a League (docs/CAREER.md,
 * Architecture): teams, a weekly schedule, standings, a single-elimination
 * postseason. Games flow through the franchise GameJob seam with the
 * circuit's own rule pack riding GameJob.rules, so a prep quarter and an
 * NCAA half are engine-real for every game I am part of.
 *
 * RNG streams (career namespace, franchise rng.ts doctrine - one derived
 * stream per subsystem so draws never reshuffle each other):
 *   career-circuit:<year>:<kind>     circuit generation; callers derive it
 *                                    via streamRng(career.seed, ...) and
 *                                    pass it into buildCircuit
 *   career-circuit:<year>:bracket    seedBracket's stream (reserved: today's
 *                                    seeding is standings-deterministic and
 *                                    draws nothing)
 *   career-circuit:<year>:national   the college national at-large field,
 *                                    drawn INSIDE applyCircuitResults when
 *                                    the conference final resolves (the
 *                                    frozen fold signature carries no rng)
 *   game seeds                       `${career.seed}:circuit:<gameId>` -
 *                                    the circuit-label twin of franchise
 *                                    gameSeedFor, so a circuit game can
 *                                    never share an engine seed with a
 *                                    league game
 *
 * APPROACH RECONCILIATION (build-wave seam): my pre-game approach card is
 * projected here by approach.ts#applyApproach (reconciled; the local
 * approach task's applyApproach (approach.ts) lands, that module becomes
 * the single projection source and the week task swaps this shift out;
 * shiftForApproach stays a small exported function precisely so it is
 * replaceable without touching job construction.
 */
import { clamp } from '@hoopsh/engine';
import type { Player, Rng, Team, Tendencies } from '@hoopsh/engine';
import { ATTR_KEYS } from '@hoopsh/data';
import { generateName, generatePlayer, streamRng } from '@hoopsh/franchise';
import type {
  FrPlayer, GameJob, GameJobResult, GameRecord, PlayerId, PlayerSeasonRow,
} from '@hoopsh/franchise';
import { applyApproach, applyLegs } from './approach.js';
import { PACKS } from './packs.js';
import type { CareerParams } from './params.js';
import type {
  ApproachCard, CareerState, Circuit, CircuitGame, CircuitKind,
  CircuitSummary, CircuitTeam, PackId, RoleId, RouteOffer,
} from './types.js';

// ---------------------------------------------------------------------------
// structural constants (shape of the circuit world, not sweepable levers -
// the sweepable quality/count knobs live in params.circuits)

/** Rule pack per circuit kind (packs.ts literals; docs/CAREER.md routes). */
const PACK_BY_KIND: Record<CircuitKind, PackId> = {
  hs: 'prep', college: 'ncaa', euro: 'fiba', nbl: 'nbl', china: 'cba',
};

/**
 * Dressed roster sizes. 8 for HS is the small-school varsity reality (and
 * keeps the generated population compact); 10 elsewhere gives the engine's
 * rotation logic real legs for 40-minute games.
 */
const ROSTER_SIZE: Record<CircuitKind, number> = {
  hs: 8, college: 10, euro: 10, nbl: 10, china: 10,
};

/**
 * Generated-player age bands [min, max], inclusive. REAL-ish: a varsity
 * roster mixes sophomores and seniors; college runs freshmen to fifth
 * years; the pro circuits are grown men, the doc's whole point about
 * going overseas at eighteen.
 */
const AGE_BAND: Record<CircuitKind, [number, number]> = {
  hs: [16, 18], college: [18, 22], euro: [19, 34], nbl: [19, 34], china: [19, 34],
};

/** Rounds packed per calendar week. 2 = the Tuesday/Friday doubleheader cadence of school ball; the compact pro circuits keep the same rhythm. */
const ROUNDS_PER_WEEK = 2;

/** FEEL: club-strength spread inside one pro league table (a domestic league has a flag-bearer and a relegation candidate). */
const TEAM_QUALITY_SD_PRO = 5;

/** FEEL: within-roster quality spread - every team dresses a star and a ninth man. */
const PLAYER_QUALITY_SD = 7;

/** FEEL: tier quality is a band, not a point - programs inside a tier still differ year to year. */
const TIER_QUALITY_SD = 3;

/** FEEL: a committee seed line is a band, not a point (national at-large strength noise). */
const NATIONAL_QUALITY_SD = 3;

/** Pro playoff field: top 4 by the table. Real leagues run best-of-3 here; v1 compresses to best-of-1 (see seedBracket). */
const PRO_PLAYOFF_TEAMS = 4;

/** Quality clamp rails for drawn team strengths. FEEL: below 5 nothing fields a team; above 95 is beyond a generational program. */
const QUALITY_RAIL_LO = 5;
const QUALITY_RAIL_HI = 95;

/** Name-collision re-roll bound, mirroring people/gen.ts MAX_NAME_REROLLS: pools are large enough that hitting it means corruption, so fail loud. */
const MAX_NAME_REROLLS = 32;

// ---------------------------------------------------------------------------
// name pools (in-module by design: circuit identities are career flavor,
// not @hoopsh/data content). Everything here is fictional; real-sounding
// is the register (docs/CAREER.md: 'fictional everywhere').

type PoolEntry = [name: string, abbrev: string, colors: [string, string]];

/** US high schools with regional flavor: county schools, saints, heights. */
const HS_POOL: readonly PoolEntry[] = [
  ['Oak Ridge Central', 'ORC', ['#1d3557', '#f4a261']],
  ['St. Aloysius', 'ALO', ['#5b1622', '#d9c47e']],
  ['Harrison County', 'HCO', ['#14532d', '#e5e7eb']],
  ['Lincoln Heights', 'LHT', ['#7c2d12', '#fbbf24']],
  ['Riverside', 'RIV', ['#0c4a6e', '#bae6fd']],
  ['Falls Church', 'FCH', ['#3b0764', '#e9d5ff']],
  ['Northgate', 'NGT', ['#111827', '#f87171']],
  ['Ellsworth', 'ELL', ['#065f46', '#fde68a']],
  ['Piedmont Valley', 'PVL', ['#1e3a8a', '#fca5a5']],
  ['Bishop Kearney', 'BKY', ['#581c87', '#fcd34d']],
  ['Maplewood', 'MPL', ['#7f1d1d', '#d1d5db']],
  ['Fort Recovery', 'FTR', ['#0f766e', '#fed7aa']],
  ['Crestline', 'CRL', ['#334155', '#a5f3fc']],
  ['Delano South', 'DLS', ['#713f12', '#bbf7d0']],
  ['Whitfield Academy', 'WFA', ['#4c1d95', '#f9fafb']],
  ['Grover Cleveland', 'GCL', ['#991b1b', '#93c5fd']],
];

/**
 * College programs, Program-register style ('Carolina Baptist', 'Fort
 * Duquesne'). Sized for a 10-team conference PLUS a 15-team national
 * at-large field drawn from the leftovers.
 */
const COLLEGE_POOL: readonly PoolEntry[] = [
  ['Carolina Baptist', 'CBP', ['#00429d', '#ffd662']],
  ['Fort Duquesne', 'FDQ', ['#7a0019', '#ffcc33']],
  ['Ashmont State', 'ASH', ['#004225', '#c0c0c0']],
  ['Meridian Tech', 'MRT', ['#1c2951', '#f56600']],
  ['St. Brigid', 'BRG', ['#2d5234', '#f1e6b2']],
  ['Talbot University', 'TAL', ['#3c1053', '#b3a369']],
  ['Cumberland A&M', 'CAM', ['#5e0009', '#e8e3d3']],
  ['Northern Ridge', 'NRD', ['#00274c', '#ffcb05']],
  ['Lakemont', 'LKM', ['#154734', '#ddcba4']],
  ['Verona College', 'VER', ['#6a0032', '#a2aaad']],
  ['Holt University', 'HLT', ['#002d62', '#c8102e']],
  ['Pacific Grove', 'PGV', ['#00563f', '#ffb81c']],
  ['Amherst Valley', 'AMV', ['#41273b', '#f5f1e7']],
  ['Bluefield Wesleyan', 'BWS', ['#003087', '#a4bcc2']],
  ['Carverton', 'CVT', ['#4b116f', '#ff8200']],
  ['Dunmore State', 'DNM', ['#8c1d40', '#ffc627']],
  ['East Chesapeake', 'ECH', ['#0b6b3a', '#f0ebd8']],
  ['Farrington', 'FAR', ['#1b365d', '#dd550c']],
  ['Glen Iris', 'GLI', ['#5d1725', '#cfb87c']],
  ['Hargrove Military', 'HGM', ['#37424a', '#c4262e']],
  ['Iron City College', 'IRC', ['#101820', '#ffb612']],
  ['Juniper State', 'JUN', ['#00447c', '#f4aa00']],
  ['Kingsbridge', 'KBR', ['#622128', '#97999b']],
  ['Loyola of the Plains', 'LOP', ['#005eb8', '#e4d5b7']],
  ['Mount Cardigan', 'MTC', ['#2c5234', '#eaaa00']],
  ['New Albion', 'NAL', ['#041e42', '#c99700']],
];

/** Continental clubs: Adriatic/eastern phonetics, all fictional (no real club names - docs/CAREER.md 'fictional everywhere'). */
const EURO_POOL: readonly PoolEntry[] = [
  ['KK Adria', 'ADR', ['#0d2c54', '#ffffff']],
  ['BC Dunav', 'DNV', ['#00594c', '#f2c75c']],
  ['KK Panonija', 'PAN', ['#7b1e3a', '#e8e8e8']],
  ['BC Karpaty', 'KRP', ['#1a4789', '#ffd100']],
  ['Egeo Basket', 'EGE', ['#003da5', '#f8f8f8']],
  ['KK Jadranska', 'JAD', ['#8f1d21', '#0f2f56']],
  ['BC Baltika', 'BLT', ['#00205b', '#ff9e1b']],
  ['Iberia CB', 'IBE', ['#9d1c31', '#f7b500']],
  ['AS Lutetia', 'LUT', ['#151f6d', '#d0d3d4']],
  ['BC Ruhrstadt', 'RUH', ['#2d2926', '#ffb500']],
  ['Hellas BC', 'HEL', ['#006098', '#f6f6f6']],
  ['KK Sava', 'SAV', ['#215732', '#dcb47a']],
  ['BC Vistula', 'VIS', ['#aa1e2e', '#e5e1d8']],
  ['Tirreno Basket', 'TIR', ['#123f6d', '#e0aa0f']],
];

/** Australian NBL clubs: real cities, invented nicknames (the actual NBL identities stay out of the fictional universe). */
const NBL_POOL: readonly PoolEntry[] = [
  ['Perth Quokkas', 'PER', ['#c8102e', '#101820']],
  ['Sydney Mariners', 'SYD', ['#012169', '#ffb81c']],
  ['Melbourne Metros', 'MEL', ['#101820', '#78be20']],
  ['Brisbane Bandicoots', 'BRI', ['#5f259f', '#ff8200']],
  ['Adelaide Arrows', 'ADL', ['#00263a', '#eeb111']],
  ['Cairns Reef', 'CNS', ['#008eaa', '#ff6720']],
  ['Hobart Huskies', 'HOB', ['#00594f', '#a2aaad']],
  ['Geelong Gulls', 'GEE', ['#003865', '#e13a3e']],
  ['Newcastle Norsemen', 'NEW', ['#41273b', '#00a9e0']],
  ['Wollongong Wombats', 'WOL', ['#6c1d45', '#ffc72c']],
  ['Darwin Monsoon', 'DAR', ['#00558c', '#f1b434']],
  ['Canberra Cockatoos', 'CBR', ['#00843d', '#ffcd00']],
];

/** Chinese clubs: real cities, invented nicknames, same fictional-universe rule as the NBL pool. */
const CHINA_POOL: readonly PoolEntry[] = [
  ['Nanjing Monarchs', 'NAN', ['#9e1b32', '#ffd100']],
  ['Chengdu Pandas', 'CHD', ['#101820', '#ffffff']],
  ['Wuhan River Kings', 'WUH', ['#004c97', '#c5b783']],
  ['Xi\'an Terracotta', 'XAN', ['#6b3529', '#e3d4ad']],
  ['Qingdao Seawolves', 'QIN', ['#00629b', '#9ea2a2']],
  ['Hangzhou Herons', 'HGZ', ['#006272', '#f0b323']],
  ['Kunming Peaks', 'KUN', ['#284734', '#cf7f00']],
  ['Dalian Tide', 'DLT', ['#003594', '#8bb8e8']],
  ['Changsha Fire', 'CHS', ['#ba0c2f', '#ff8f1c']],
  ['Harbin Ice Dragons', 'HRB', ['#41b6e6', '#0d1f2d']],
  ['Suzhou Silk', 'SUZ', ['#5c462b', '#e8ce8c']],
  ['Xiamen Pearls', 'XMN', ['#00857d', '#efdbb2']],
];

const POOL_BY_KIND: Record<CircuitKind, readonly PoolEntry[]> = {
  hs: HS_POOL, college: COLLEGE_POOL, euro: EURO_POOL, nbl: NBL_POOL, china: CHINA_POOL,
};

// ---------------------------------------------------------------------------
// shared helpers

/**
 * Plain mean of all engine attributes, mirroring franchise
 * gameday.ts#abilityScore (that helper is not exported from the franchise
 * barrel, and franchise files are out of this task's scope). Fixed
 * ATTR_KEYS order keeps float sums bit-stable, same doctrine.
 */
function abilityScoreOf(p: FrPlayer): number {
  let sum = 0;
  for (const k of ATTR_KEYS) sum += p.attr[k];
  return sum / ATTR_KEYS.length;
}

/**
 * Next free career-local id number. Circuit kids mint in their own 'c'
 * alphabet because the two id spaces must never collide and only one of
 * them can see the other: league draft classes continue the 'p' sequence
 * by scanning league.players alone (people/gen.ts), and franchise code
 * never reads career state. Any 'p' id minted here would sit above the
 * league's watermark once draft entry lifts it, and the first post-entry
 * class would re-mint my retained HS teammates' numbers onto NBA rookies
 * (issue #83). An alphabet the league cannot produce keeps the maps
 * disjoint by construction, with no watermark to maintain. Scanned
 * rather than counted (people/gen.ts doctrine: a save/load cycle carries
 * no counter) and scanned across BOTH maps so an id that ever crossed
 * the seam stays burned.
 */
function nextIdSeq(career: CareerState): number {
  let seq = 1;
  for (const map of [career.players, career.league.players]) {
    for (const id of Object.keys(map)) {
      const m = /^c(\d+)$/.exec(id);
      if (m) seq = Math.max(seq, Number(m[1]) + 1);
    }
  }
  return seq;
}

/**
 * Format a career-local player id. Mirrors people/gen.ts's four-digit
 * padding so ids read the same either side of the seam; the alphabet
 * carries the invariant, the padding is convention.
 */
function careerLocalId(seq: number): PlayerId {
  return `c${String(seq).padStart(4, '0')}`;
}

/** All names already on a box score somewhere (career circuits + the NBA world). */
function usedNames(career: CareerState): Set<string> {
  const used = new Set<string>();
  for (const p of Object.values(career.players)) used.add(p.name);
  for (const p of Object.values(career.league.players)) used.add(p.name);
  return used;
}

/**
 * Re-roll a generated player's name until it is unique, keeping the draw
 * inside the passed rng stream. Bounded like people/gen.ts: 32 straight
 * collisions against pools this large means corrupted state, so fail loud
 * rather than printing two kids with one name on a recruiting page.
 */
function ensureUniqueCircuitName(rng: Rng, p: FrPlayer, used: Set<string>): void {
  for (let i = 0; i < MAX_NAME_REROLLS && used.has(p.name); i++) {
    const n = generateName(rng, { bornYear: p.bornSeason });
    p.name = `${n.first} ${n.last}`;
    p.birthplace = n.birthplace;
    p.origin = n.origin;
    p.originDetail = n.originDetail;
  }
  if (used.has(p.name)) throw new Error(`circuits: could not find a unique name for ${p.id}`);
  used.add(p.name);
}

/** Circuit-local team id: kind plus a slug of the name ('hs-oakridgecentral'). */
function teamIdFor(kind: CircuitKind, name: string, taken: Set<string>): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  let id = `${kind}-${slug}`;
  // defensive disambiguation: pools hold unique names, so a collision only
  // happens if a recruiting-supplied name slugs onto a pool name
  for (let i = 2; taken.has(id); i++) id = `${kind}-${slug}${i}`;
  taken.add(id);
  return id;
}

/** The committed route offer when its kind matches this circuit's, else null (fixture careers and walk-on paths carry no commitment). */
function committedOffer(career: CareerState, kind: CircuitKind): RouteOffer | null {
  if (kind !== 'college' && kind !== 'euro' && kind !== 'nbl') return null;
  const rec = career.recruiting;
  if (!rec || !rec.committedTo) return null;
  const offer = rec.offers.find((o) => o.id === rec.committedTo);
  return offer && offer.kind === kind ? offer : null;
}

/** The engine seed for one circuit game (see the module header's stream registry). */
function circuitGameSeed(careerSeed: string, gameId: string): string {
  return `${careerSeed}:circuit:${gameId}`;
}

interface TeamSpec {
  kind: CircuitKind;
  name: string;
  abbrev: string;
  colors: [string, string];
  quality: number;
  /** existing career players placed first (me, the HS rival); never regenerated */
  include?: PlayerId[];
}

/**
 * Build one circuit team: fill the roster with generatePlayer kids around
 * the team's quality, store them into career.players, pick starters as the
 * top 5 by ability (a circuit coach starts his best five; positional
 * nicety is below this fidelity tier). Draw order per generated player is
 * fixed: age, then the generatePlayer block, then name re-rolls.
 */
function fillTeam(
  career: CareerState, rng: Rng, spec: TeamSpec,
  idSeq: { next: number }, used: Set<string>, takenIds: Set<string>,
): CircuitTeam {
  const [ageMin, ageMax] = AGE_BAND[spec.kind];
  const roster: PlayerId[] = [...(spec.include ?? [])];
  while (roster.length < ROSTER_SIZE[spec.kind]) {
    const age = ageMin + rng.int(ageMax - ageMin + 1); // uniform across the band
    const seq = idSeq.next++;
    const p = generatePlayer(rng, {
      age,
      season: career.clock.year,
      quality: clamp(rng.gaussian(spec.quality, PLAYER_QUALITY_SD), QUALITY_RAIL_LO, QUALITY_RAIL_HI),
      idSeq: seq,
      params: career.league.params,
    });
    // a circuit kid is career-local for life: re-key him out of gen.ts's
    // 'p' alphabet before the id reaches any map, roster, or box score,
    // or the league's first post-entry draft class re-mints his number
    // onto an NBA rookie (nextIdSeq above, issue #83). Draws nothing.
    p.id = careerLocalId(seq);
    // circuit players are not league members: neutral prospect status, no
    // contract or draft record until the real pipeline touches them
    p.status = 'prospect';
    ensureUniqueCircuitName(rng, p, used);
    career.players[p.id] = p;
    roster.push(p.id);
  }
  const starters = [...roster]
    .sort((a, b) =>
      abilityScoreOf(career.players[b]!) - abilityScoreOf(career.players[a]!) || (a < b ? -1 : 1))
    .slice(0, 5);
  return {
    id: teamIdFor(spec.kind, spec.name, takenIds),
    name: spec.name,
    abbrev: spec.abbrev,
    colors: spec.colors,
    quality: Math.round(spec.quality),
    roster,
    starters,
  };
}

// ---------------------------------------------------------------------------
// schedule generation (circle-method round robin)

/**
 * Round-robin schedule via the circle method: every round each team plays
 * once, so `gamesPerTeam` rounds give every team exactly that many games
 * (even team counts; an odd count gets a ghost bye and lands within 1,
 * unreachable with the shipped params). ROUNDS_PER_WEEK rounds share a
 * week, and weeks are ABSOLUTE career weeks from the kind's season start.
 */
function buildRoundRobin(teams: CircuitTeam[], year: number, gamesPerTeam: number, startWeek: number): CircuitGame[] {
  const n = teams.length;
  const slots = n % 2 === 0 ? n : n + 1; // ghost slot for odd counts; pairings against it are byes
  const roundsPerCycle = slots - 1;
  const games: CircuitGame[] = [];
  const ids = new Set<string>();
  for (let round = 0; round < gamesPerTeam; round++) {
    const cycle = Math.floor(round / roundsPerCycle);
    const r = round % roundsPerCycle;
    const week = startWeek + Math.floor(round / ROUNDS_PER_WEEK);
    // circle rotation: slot 0 fixed, the rest rotate by r
    const pos: number[] = [0];
    for (let i = 1; i < slots; i++) pos.push(((i - 1 + r) % (slots - 1)) + 1);
    for (let k = 0; k < slots / 2; k++) {
      const a = pos[k]!;
      const b = pos[slots - 1 - k]!;
      if (a >= n || b >= n) continue; // ghost bye
      // alternating polarity splits home dates near-evenly inside a cycle;
      // the cycle term flips the return fixture into the other gym
      const homeIdx = (r + k + cycle) % 2 === 0 ? a : b;
      const awayIdx = homeIdx === a ? b : a;
      let id = `c${year}-w${week}-${teams[awayIdx]!.id}@${teams[homeIdx]!.id}`;
      // defensive: unreachable with the shipped params (a pairing repeats
      // only across cycles, which land in different weeks), kept so a
      // future param change cannot silently overwrite a result key
      if (ids.has(id)) id = `${id}-b`;
      ids.add(id);
      games.push({ id, week, homeIdx, awayIdx, type: 'regular' });
    }
  }
  games.sort((x, y) => x.week - y.week || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return games;
}

// ---------------------------------------------------------------------------
// buildCircuit

/**
 * Build the circuit for a career year of the given kind (rosters
 * included). Mutates career.players (generated kids are stored there; me
 * and the HS rival are placed, never regenerated) and returns the Circuit;
 * the caller (tick.ts) owns assigning career.circuit.
 *
 * rng: the caller-derived 'career-circuit:<year>:<kind>' stream. Draw
 * order is fixed: name-pool shuffle, per-slot team qualities, then rosters
 * in team order.
 */
export function buildCircuit(career: CareerState, kind: CircuitKind, rng: Rng): Circuit {
  const cp = career.params.circuits;
  const year = career.clock.year;
  const teamCount = kind === 'hs' ? cp.hsTeams
    : kind === 'college' ? cp.collegeConfTeams
    : kind === 'euro' ? cp.euroTeams
    : kind === 'nbl' ? cp.nblTeams : cp.chinaTeams;

  const pool = [...POOL_BY_KIND[kind]];
  if (pool.length < teamCount) throw new Error(`circuits: ${kind} name pool smaller than the field`);
  rng.shuffle(pool);

  // identity slot 0 is MY team; a committed route offer can override the
  // name (the program I signed with is a real identity, not a pool draw)
  const offer = committedOffer(career, kind);
  const identities: PoolEntry[] = pool.slice(0, teamCount).map((e, i) => {
    if (i !== 0) return e;
    const name = kind === 'college'
      ? (offer?.programId
          ? career.recruiting?.programs.find((p) => p.id === offer.programId)?.name ?? e[0]
          : e[0])
      : (offer?.clubName ?? e[0]);
    return [name, e[1], e[2]];
  });

  // team qualities, slot order (fixed draw order: slots that need no draw
  // skip it deterministically)
  const qualities: number[] = [];
  for (let i = 0; i < teamCount; i++) {
    if (kind === 'hs') {
      // my school is built around me: a modest supporting cast, exactly the
      // myHsTeamQuality knob; rivals' schools spread around the circuit mean
      qualities.push(i === 0
        ? cp.myHsTeamQuality
        : clamp(rng.gaussian(cp.hsQualityMean, cp.hsQualitySd), QUALITY_RAIL_LO, QUALITY_RAIL_HI));
    } else if (kind === 'college') {
      if (i === 0) {
        // my program's strength comes from the committed offer's program
        // tier; absent a commitment (fixture careers), a mid-tier program
        // is the honest default (noted in the task report)
        const program = offer?.programId
          ? career.recruiting?.programs.find((p) => p.id === offer.programId)
          : undefined;
        const tier = program?.tier ?? 2;
        qualities.push(cp.collegeQualityByTier[tier - 1]!);
      } else {
        // the conference table mixes tiers: one more blue blood, a mid
        // pack, and bottom feeders (FEEL cycle), each fuzzed inside its tier
        const tierCycle: ReadonlyArray<1 | 2 | 3> = [1, 2, 2, 3, 3, 1, 2, 3, 2];
        const tier = tierCycle[(i - 1) % tierCycle.length]!;
        qualities.push(clamp(
          cp.collegeQualityByTier[tier - 1]! + rng.gaussian(0, TIER_QUALITY_SD),
          QUALITY_RAIL_LO, QUALITY_RAIL_HI,
        ));
      }
    } else {
      // pro clubs, mine included: I signed with a REAL club, not one built
      // around me (grown men, minutes to earn - docs/CAREER.md)
      const mean = kind === 'euro' ? cp.euroQualityMean : kind === 'nbl' ? cp.nblQualityMean : cp.chinaQualityMean;
      qualities.push(clamp(rng.gaussian(mean, TEAM_QUALITY_SD_PRO), QUALITY_RAIL_LO, QUALITY_RAIL_HI));
    }
  }

  // the HS rival plays for the strongest OTHER school (the phone tracks him
  // for fifteen years; he has to be a real circuit opponent, and giving him
  // the best supporting cast makes the head-to-heads mean something)
  let rivalSlot = -1;
  if (kind === 'hs') {
    rivalSlot = 1;
    for (let i = 2; i < teamCount; i++) {
      if (qualities[i]! > qualities[rivalSlot]!) rivalSlot = i;
    }
  }

  const idSeq = { next: nextIdSeq(career) };
  const used = usedNames(career);
  const takenIds = new Set<string>();
  const teams: CircuitTeam[] = identities.map(([name, abbrev, colors], i) =>
    fillTeam(career, rng, {
      kind, name, abbrev, colors,
      quality: qualities[i]!,
      include: i === 0 ? [career.me] : i === rivalSlot ? [career.rivalId] : undefined,
    }, idSeq, used, takenIds));

  const gamesPerTeam = kind === 'hs' ? cp.hsRegularGames
    : kind === 'college' ? cp.collegeConfGames
    : kind === 'euro' ? cp.euroGames
    : kind === 'nbl' ? cp.nblGames : cp.chinaGames;
  const startWeek = kind === 'hs' ? career.params.tick.hsSeasonStartWeek
    : kind === 'college' ? career.params.tick.collegeSeasonStartWeek
    : career.params.tick.proSeasonStartWeek;

  return {
    id: `${kind}-${year}`,
    kind,
    year,
    packId: PACK_BY_KIND[kind],
    teams,
    myTeamIdx: 0,
    schedule: buildRoundRobin(teams, year, gamesPerTeam, startWeek),
    results: {},
    standings: teams.map((_, teamIdx) => ({ teamIdx, w: 0, l: 0, pf: 0, pa: 0 })),
    bracket: [],
    complete: false,
  };
}

// ---------------------------------------------------------------------------
// the approach shift (local seam; see the module header's reconciliation note)

/**
 * Minimal local projection of the pre-game approach card onto MY
 * tendencies, magnitude params.trust.approachTendencyMax at a dial's
 * extremes (50 = play your normal game). Returns a new Tendencies; never
 * mutates. Replaced by approach.ts#applyApproach as the single source once
 * the approach task lands (the week task reconciles); exported separately
 * so the swap is one import.
 */
export function shiftForApproach(tend: Tendencies, card: ApproachCard, params: CareerParams): Tendencies {
  const max = params.trust.approachTendencyMax;
  const d = (dial: number): number => ((dial - 50) / 50) * max; // linear from the neutral 50
  const delta: Partial<Record<keyof Tendencies, number>> = {};
  const bump = (k: keyof Tendencies, v: number): void => { delta[k] = (delta[k] ?? 0) + v; };

  // assertiveness: take over = demand possessions; the whole shot diet
  // rises at HALF magnitude so it stacks with (not doubles) the range dial
  const a = d(card.assertiveness);
  bump('usage', a);
  bump('shotRim', a / 2);
  bump('shotMid', a / 2);
  bump('shotThree', a / 2);
  // range: let it fly = threes and pull-ups
  const r = d(card.range);
  bump('shotThree', r);
  bump('pullUp', r);
  // motor: empty the tank = crash the glass, with a light gambling edge
  // (the energy cost of the dial is the week task's business, not mine)
  const m = d(card.motor);
  bump('crashOffReb', m);
  bump('gambleSteal', m / 2);
  // defense: gamble = passing lanes and physical closeouts; more steals AND
  // more fouls, the honest tradeoff the engine already prices
  const df = d(card.defense);
  bump('gambleSteal', df);
  bump('foulAggr', df);
  // playmaking: make the extra pass = swing appetite up, clear-outs down
  const pm = d(card.playmaking);
  bump('passOut', pm);
  bump('iso', -pm);

  const out: Tendencies = { ...tend };
  for (const k of Object.keys(delta) as Array<keyof Tendencies>) {
    out[k] = Math.round(clamp(out[k] + (delta[k] ?? 0), 0, 100));
  }
  return out;
}

// ---------------------------------------------------------------------------
// game jobs

/**
 * Neutral tactics for circuit teams: a circuit team's identity lives in
 * its roster quality, not bench scheming, EXCEPT my own committed
 * program/club, whose promised system (pace, three bias) is the one
 * recruiting term the doc makes mechanical ('a run-and-gun program
 * inflates counting stats').
 */
function tacticsFor(career: CareerState, circuit: Circuit, teamIdx: number): Team['tactics'] {
  if (teamIdx === circuit.myTeamIdx) {
    const offer = committedOffer(career, circuit.kind);
    if (offer) return { pace: offer.style.pace, threeBias: offer.style.threeBias, helpAggr: 50 };
  }
  return { pace: 50, threeBias: 50, helpAggr: 50 }; // engine-neutral (pace is a staged dial anyway)
}

/**
 * The roles that own a place in the starting five. Below this line a
 * promotion is minutes and a longer leash; AT it the promotion is the
 * opening tip (docs/CAREER.md pillar 1: a role move must be felt in the
 * next box score). garbage/bench/rotation/sixthMan come off the bench -
 * the sixth man by definition, the rest by the depth chart.
 */
const STARTING_ROLES: ReadonlySet<RoleId> = new Set(['starter', 'featured', 'franchise']);

/**
 * Project one circuit team into an engine Team. Circuit players are not
 * league members, so attributes and tendencies project DIRECTLY (no
 * injury/fatigue/HCA pipeline; that projection depth belongs to the
 * franchise gameday). ME, the felt loop's whole surface:
 *  - the approach card shifts my tendencies (approach.ts applyApproach,
 *    the one projection source; playing hurt dulls the whole sheet);
 *  - tired legs dull my attributes (approach.ts applyLegs on
 *    career.energy: the week economy's teeth on the floor);
 *  - MY ROLE OWNS MY MINUTES (params.trust.minutesByRole): the coach's
 *    target rides Team.rotationMinutes - the engine's real minutes
 *    controller (subs.ts leash + eager return) - scaled from the table's
 *    48-minute shape to this pack's game length, and the starting five
 *    is role-gated by STARTING_ROLES. A promotion changes the next box
 *    score's shape by mechanism, not by label.
 */
function projectCircuitTeam(career: CareerState, circuit: Circuit, teamIdx: number): Team {
  const t = circuit.teams[teamIdx];
  if (!t) throw new Error(`circuits: no team at index ${teamIdx}`);
  // a listed player does not dress: I sit out my recovery weeks, and the
  // next-best body starts in my place (the week task owns the clock)
  const meListed = (pid: string): boolean => {
    if (pid !== career.me) return false;
    const p = career.players[pid];
    return Boolean(p?.health.injury && p.health.injury.remainingDays > 0);
  };
  const available = t.roster.filter(pid => !meListed(pid));
  const players: Player[] = available.map((pid) => {
    const p = career.players[pid];
    if (!p) throw new Error(`circuits: roster references unknown player '${pid}'`);
    if (pid === career.me) {
      // card first (tendencies + hurt debuff), then the legs tax (attrs)
      const carded = applyApproach(p, career.nextApproach ?? career.approach, career.params);
      const projected = applyLegs(carded, career.energy, career.params);
      return {
        id: p.id, name: p.name, pos: p.pos,
        heightIn: p.heightIn, weightLb: p.weightLb, wingspanIn: p.wingspanIn,
        attr: projected.attr, tend: projected.tend,
      };
    }
    return {
      id: p.id, name: p.name, pos: p.pos,
      heightIn: p.heightIn, weightLb: p.weightLb, wingspanIn: p.wingspanIn,
      attr: { ...p.attr }, tend: { ...p.tend },
    };
  });
  let starters = [...t.starters];
  const bestBench = (exclude: readonly string[]): string | undefined =>
    available.filter(pid => !exclude.includes(pid)).sort((a, b) =>
      abilityScoreOf(career.players[b]!) - abilityScoreOf(career.players[a]!) || (a < b ? -1 : 1))[0];
  if (starters.includes(career.me) && !available.includes(career.me)) {
    const sub = bestBench(starters);
    starters = sub
      ? starters.map(pid => (pid === career.me ? sub : pid))
      : starters.filter(pid => pid !== career.me);
  }

  // minutes follow the role (my team's whole sheet; the felt-loop fix)
  let rotationMinutes: Record<string, number> | undefined;
  if (teamIdx === circuit.myTeamIdx && available.includes(career.me)) {
    const role = career.coach.role;
    if (STARTING_ROLES.has(role) && !starters.includes(career.me)) {
      // the job says I start: the weakest incumbent yields the spot
      const weakest = [...starters].sort((a, b) =>
        abilityScoreOf(career.players[a]!) - abilityScoreOf(career.players[b]!) || (a < b ? -1 : 1))[0];
      starters = starters.map(pid => (pid === weakest ? career.me : pid));
    } else if (!STARTING_ROLES.has(role) && starters.includes(career.me)) {
      // the job says I watch the tip: the best bench body starts instead
      const sub = bestBench(starters);
      if (sub) starters = starters.map(pid => (pid === career.me ? sub : pid));
    }
    // The coach's minutes sheet, a real document: gameMinutes x 5 slots
    // split across the dressed roster. MY line is the role's target
    // (params.trust.minutesByRole), scaled from the table's NBA 48-minute
    // shape to this pack's game (prep 32, FIBA/NCAA 40): a garbage role
    // in prep is ~2.7 minutes of mop-up, a franchise role ~25 of 32.
    // TEAMMATES fill the remainder by ability rank. The whole-team sheet
    // matters mechanically: with only MY line targeted, the engine's
    // quarter wave kept re-inserting the freshest body (me) regardless of
    // pace, and a garbage role measured 16.7 minutes; with every line
    // targeted, behind-pace teammates outrank me for every re-entry and
    // the role gradient is real (measured 5.7 / 12.6 / 22.7 / 25.6 min
    // at garbage / rotation / starter / franchise in prep).
    const pack = PACKS[circuit.packId];
    const gameMinutes = pack.periods * pack.periodMinutes;
    const myTarget = Math.max(1, career.params.trust.minutesByRole[role] * (gameMinutes / 48));
    rotationMinutes = { [career.me]: Math.round(myTarget * 10) / 10 };
    const mates = available.filter(pid => pid !== career.me).sort((a, b) =>
      abilityScoreOf(career.players[b]!) - abilityScoreOf(career.players[a]!) || (a < b ? -1 : 1));
    // rank weights n..1 in a waterfall: each share caps at the game
    // length and the overflow stays in the pot for the smaller weights
    // (weights descend, so the waterfall is exact in one pass); floors at
    // 1 minute because an explicit 0 target is the engine's DNP-scratch
    // semantics (subs.ts), and the end of a rotation is not a scratch
    let rest = gameMinutes * 5 - myTarget;
    let wSum = (mates.length * (mates.length + 1)) / 2;
    mates.forEach((pid, i) => {
      const w = mates.length - i;
      const share = Math.min(gameMinutes, Math.max(1, rest * w / wSum));
      rotationMinutes![pid] = Math.round(share * 10) / 10;
      rest -= share;
      wSum -= w;
    });
  }

  return {
    id: t.id, name: t.name, abbrev: t.abbrev,
    players,
    starters,
    tactics: tacticsFor(career, circuit, teamIdx),
    ...(rotationMinutes ? { rotationMinutes } : {}),
  };
}

/**
 * Jobs for this week's circuit games (schedule plus any seeded bracket
 * round), sorted by game id so job indexes are deterministic (the
 * planDayJobs convention). My games carry detail 'events' (the ticker and
 * replay want my full stream); everyone else folds in the worker. Every
 * job rides the circuit's rule pack and the registered circuit game seed.
 */
export function circuitWeekJobs(career: CareerState, week: number): GameJob[] {
  const circuit = career.circuit;
  if (!circuit) throw new Error('circuits: circuitWeekJobs with no active circuit');
  const games = [...circuit.schedule, ...circuit.bracket]
    .filter((g) => g.week === week && !circuit.results[g.id])
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return games.map((g, index) => ({
    index,
    gameId: g.id,
    seed: circuitGameSeed(career.seed, g.id),
    home: projectCircuitTeam(career, circuit, g.homeIdx),
    away: projectCircuitTeam(career, circuit, g.awayIdx),
    detail: (g.homeIdx === circuit.myTeamIdx || g.awayIdx === circuit.myTeamIdx ? 'events' : 'fold') as GameJob['detail'],
    rules: PACKS[circuit.packId],
  }));
}

// ---------------------------------------------------------------------------
// result folds

/** Zeroed circuit stat row. Circuit seasons fold into ONE 'regular' row per player: recruiters, development, and the stock ladder read a season's whole body of work, so a separate playoff row would fragment the critical contract. */
function freshRow(season: number, teamId: string): PlayerSeasonRow {
  return {
    season, teamId, type: 'regular',
    gp: 0, gs: 0, min: 0, pts: 0,
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    plusMinus: 0,
  };
}

/**
 * Fold finished circuit games, in job-index order (the applyGameResults
 * convention): store GameRecords into circuit.results (teamIds are circuit
 * team ids; the record's day field carries the ABSOLUTE career week, since
 * circuit calendars are weekly), accumulate per-player season rows in
 * career.players, fold regular-season standings (bracket games live in the
 * bracket, not the table - the franchise convention), then advance the
 * bracket when a round completes. Energy costs are the week task's
 * business, not this fold's.
 */
export function applyCircuitResults(career: CareerState, results: GameJobResult[]): void {
  const circuit = career.circuit;
  if (!circuit) throw new Error('circuits: applyCircuitResults with no active circuit');
  const sorted = [...results].sort((a, b) => a.index - b.index);
  for (const r of sorted) {
    const game = circuit.schedule.find((g) => g.id === r.gameId)
      ?? circuit.bracket.find((g) => g.id === r.gameId);
    if (!game) throw new Error(`circuits: result for unknown game '${r.gameId}'`);
    // refolding a stored game would double every stat row silently
    if (circuit.results[r.gameId]) throw new Error(`circuits: duplicate result for '${r.gameId}'`);
    const home = circuit.teams[game.homeIdx]!;
    const away = circuit.teams[game.awayIdx]!;

    const record: GameRecord = {
      id: r.gameId,
      date: { season: circuit.year, day: game.week },
      type: game.type === 'regular' ? 'regular' : 'playoffs',
      home: home.id,
      away: away.id,
      seed: circuitGameSeed(career.seed, r.gameId),
      final: r.final,
      ot: r.ot,
      lines: r.lines,
      totals: r.totals,
      keyPlays: r.keyPlays,
    };
    circuit.results[r.gameId] = record;

    for (const line of record.lines) {
      const player = career.players[line.playerId];
      // a line naming an unknown player is corrupted state, not a case to
      // paper over (the applyGameResults trust doctrine)
      if (!player) throw new Error(`circuits: line for unknown player '${line.playerId}' in ${r.gameId}`);
      let row = player.seasons.find((s) => s.season === circuit.year && s.teamId === line.teamId && s.type === 'regular');
      if (!row) {
        row = freshRow(circuit.year, line.teamId);
        player.seasons.push(row);
      }
      const played = line.min > 0;
      if (played) {
        row.gp += 1;
        if (line.starter) row.gs += 1;
      }
      row.min += line.min;
      row.pts += line.pts;
      row.fgm += line.fgm; row.fga += line.fga;
      row.tpm += line.tpm; row.tpa += line.tpa;
      row.ftm += line.ftm; row.fta += line.fta;
      row.orb += line.orb; row.drb += line.drb;
      row.ast += line.ast; row.stl += line.stl; row.blk += line.blk;
      row.tov += line.tov; row.pf += line.pf;
      row.plusMinus += line.plusMinus;
    }

    if (game.type === 'regular') {
      const hRow = circuit.standings.find((s) => s.teamIdx === game.homeIdx);
      const aRow = circuit.standings.find((s) => s.teamIdx === game.awayIdx);
      if (!hRow || !aRow) throw new Error(`circuits: standings row missing for ${r.gameId}`);
      if (record.final[0] > record.final[1]) { hRow.w += 1; aRow.l += 1; } else { aRow.w += 1; hRow.l += 1; }
      hRow.pf += record.final[0]; hRow.pa += record.final[1];
      aRow.pf += record.final[1]; aRow.pa += record.final[0];
    }
  }
  advanceBracket(career, circuit);
}

// ---------------------------------------------------------------------------
// brackets (single elimination, reseeded every round)

/**
 * Standings order over team indexes below `limit` (limits college seeding
 * to the conference block once national at-large teams are appended):
 * wins, then point differential, then points for, then team index. Point
 * differential is the classic table tiebreak; head-to-head is an honest
 * v1 omission at circuit depth.
 */
function standingsOrder(circuit: Circuit, limit: number): number[] {
  return circuit.standings
    .filter((s) => s.teamIdx < limit)
    .sort((a, b) => b.w - a.w || (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || a.teamIdx - b.teamIdx)
    .map((s) => s.teamIdx);
}

/** Round label by field size; a non-power-of-two field opens with a play-in 'R1' (the 10-team conference tourney's 7v10 / 8v9 night). */
function appendEliminationRound(circuit: Circuit, alive: number[], week: number, type: 'confTourney' | 'bracket'): void {
  const m = alive.length;
  const pow = 2 ** Math.floor(Math.log2(m));
  let pairs: Array<[number, number]>;
  let label: string;
  if (m === pow) {
    label = m === 2 ? 'F' : m === 4 ? 'SF' : m === 8 ? 'QF' : `R${m}`;
    pairs = [];
    // reseeded pairing: best remaining hosts worst remaining (the doc's own
    // word for the HS bracket; simpler than fixed bracket paths and keeps
    // the earned-seed edge every round). Neutral-site finals are unmodeled.
    for (let k = 0; k < m / 2; k++) pairs.push([alive[k]!, alive[m - 1 - k]!]);
  } else {
    // play-in among the bottom seeds cuts the field to the next power of two
    const q = 2 * (m - pow);
    const tail = alive.slice(m - q);
    label = 'R1';
    pairs = [];
    for (let k = 0; k < q / 2; k++) pairs.push([tail[k]!, tail[q - 1 - k]!]);
  }
  for (const [hi, lo] of pairs) {
    const homeTeam = circuit.teams[hi]!;
    const awayTeam = circuit.teams[lo]!;
    circuit.bracket.push({
      id: `c${circuit.year}-w${week}-${awayTeam.id}@${homeTeam.id}`,
      week,
      homeIdx: hi,
      awayIdx: lo,
      type,
      round: label,
    });
  }
}

/**
 * My national seed from the conference tournament result. FEEL committee:
 * the champion lands a protected 3 line; earlier exits drift toward the
 * field's soft bottom. The invited field is generated around my team
 * either way (register C3: a full college world is out of scope, so an
 * at-large snub is not modeled - the drama machine always runs).
 */
function nationalSeedForMe(circuit: Circuit, fieldSize: number): number {
  let lostAt: string | null = null;
  let wonFinal = false;
  for (const g of circuit.bracket) {
    if (g.type !== 'confTourney') continue;
    if (g.homeIdx !== circuit.myTeamIdx && g.awayIdx !== circuit.myTeamIdx) continue;
    const rec = circuit.results[g.id];
    if (!rec) continue;
    const iWon = (rec.final[0] > rec.final[1]) === (g.homeIdx === circuit.myTeamIdx);
    if (!iWon) lostAt = g.round ?? null;
    else if (g.round === 'F') wonFinal = true;
  }
  // FEEL seed lines: champ 3, final 6, semifinal 9, quarterfinal 12, else 14
  const seed = wonFinal ? 3 : lostAt === 'F' ? 6 : lostAt === 'SF' ? 9 : lostAt === 'QF' ? 12 : 14;
  return Math.min(seed, fieldSize);
}

/**
 * National field in seed order. At-large teams were appended to
 * circuit.teams in ascending seed order skipping my line, so the order is
 * fully derivable from state (no extra Circuit fields; the shape is
 * frozen).
 */
function nationalFieldOrder(career: CareerState, circuit: Circuit): number[] {
  const confN = career.params.circuits.collegeConfTeams;
  const fieldSize = career.params.circuits.nationalBracketTeams;
  const mySeed = nationalSeedForMe(circuit, fieldSize);
  const order: number[] = [];
  let genIdx = confN;
  for (let s = 1; s <= fieldSize; s++) order.push(s === mySeed ? circuit.myTeamIdx : genIdx++);
  return order;
}

/**
 * Generate the national at-large field (register C3's 'invited field':
 * fresh teams of tier-appropriate quality around my seed) and seed the
 * opening national round. Draws the registered
 * 'career-circuit:<year>:national' stream because the frozen
 * applyCircuitResults signature carries no rng.
 */
function seedNationalField(career: CareerState, circuit: Circuit, week: number): void {
  const cp = career.params.circuits;
  const rng = streamRng(career.seed, 'career-circuit', circuit.year, 'national');
  const fieldSize = cp.nationalBracketTeams;
  const mySeed = nationalSeedForMe(circuit, fieldSize);
  const pool = COLLEGE_POOL.filter((e) => !circuit.teams.some((t) => t.name === e[0]));
  rng.shuffle(pool);
  const idSeq = { next: nextIdSeq(career) };
  const used = usedNames(career);
  const takenIds = new Set<string>(circuit.teams.map((t) => t.id));
  let poolAt = 0;
  for (let s = 1; s <= fieldSize; s++) {
    if (s === mySeed) continue;
    const entry = pool[poolAt++];
    if (!entry) throw new Error('circuits: college name pool exhausted for the national field');
    // committee bands over a 16 field (FEEL): the top four lines are blue
    // bloods, the middle is the mid-major mass, the bottom is auto-bid
    // champions from small leagues
    const tier = s <= 4 ? 1 : s <= 10 ? 2 : 3;
    const quality = clamp(
      cp.collegeQualityByTier[tier - 1]! + rng.gaussian(0, NATIONAL_QUALITY_SD),
      QUALITY_RAIL_LO, QUALITY_RAIL_HI,
    );
    const team = fillTeam(career, rng, {
      kind: 'college', name: entry[0], abbrev: entry[1], colors: entry[2], quality,
    }, idSeq, used, takenIds);
    circuit.teams.push(team);
    // zero row keeps standings total over teams; bracket games never fold
    // the table, so these rows stay zero by construction
    circuit.standings.push({ teamIdx: circuit.teams.length - 1, w: 0, l: 0, pf: 0, pa: 0 });
  }
  appendEliminationRound(circuit, nationalFieldOrder(career, circuit), week, 'bracket');
}

/** Field order for the phase the bracket is currently in. */
function phaseField(career: CareerState, circuit: Circuit, inConf: boolean): number[] {
  if (circuit.kind === 'college') {
    return inConf
      ? standingsOrder(circuit, career.params.circuits.collegeConfTeams)
      : nationalFieldOrder(career, circuit);
  }
  if (circuit.kind === 'hs') return standingsOrder(circuit, circuit.teams.length);
  return standingsOrder(circuit, circuit.teams.length).slice(0, PRO_PLAYOFF_TEAMS);
}

/**
 * Advance the postseason once every seeded bracket game has a result:
 * losers are out, survivors (in seed order) re-pair into the next round,
 * the college conference final hands off to the national field, and the
 * final of the LAST phase completes the circuit. Rounds seed one at a
 * time, so my elimination never stops the bracket: the state final and
 * the national champion resolve whether I am standing or watching (the
 * rival might be the one cutting nets, and the phone will know).
 */
function advanceBracket(career: CareerState, circuit: Circuit): void {
  if (circuit.complete || circuit.bracket.length === 0) return;
  if (circuit.bracket.some((g) => !circuit.results[g.id])) return; // a round is still in flight
  const natGames = circuit.bracket.filter((g) => g.type === 'bracket');
  const inConf = circuit.kind === 'college' && natGames.length === 0;
  const phaseGames = inConf ? circuit.bracket.filter((g) => g.type === 'confTourney') : natGames;
  const beaten = new Set<number>();
  let lastWeek = 0;
  for (const g of phaseGames) {
    const rec = circuit.results[g.id]!;
    beaten.add(rec.final[0] > rec.final[1] ? g.awayIdx : g.homeIdx);
    lastWeek = Math.max(lastWeek, g.week);
  }
  const alive = phaseField(career, circuit, inConf).filter((idx) => !beaten.has(idx));
  if (alive.length <= 1) {
    if (inConf) seedNationalField(career, circuit, lastWeek + 1);
    else circuit.complete = true;
    return;
  }
  appendEliminationRound(circuit, alive, lastWeek + 1, inConf ? 'confTourney' : 'bracket');
}

/**
 * Seed the postseason when the regular slate ends: the HS state bracket
 * of 8 (all schools, reseeded by the table), the college conference
 * tournament (all 10 by standings seed; the national field follows from
 * applyCircuitResults when the conference final resolves), or the pro
 * playoff of the top 4. Pro leagues really play best-of-3 here; v1
 * compresses to best-of-1 single games (the circuit calendar carries no
 * multi-game series weeks yet - registered simplification).
 *
 * Idempotent: a second call is a no-op (reseeding would duplicate the
 * field). rng: the frozen signature's stream; current seeding is fully
 * standings-deterministic, and the only random postseason draw (the
 * national at-large field) happens at the conference-final fold, so the
 * parameter draws nothing today.
 */
export function seedBracket(career: CareerState, rng: Rng): void {
  void rng; // reserved by the frozen contract (see JSDoc)
  const circuit = career.circuit;
  if (!circuit) throw new Error('circuits: seedBracket with no active circuit');
  if (circuit.bracket.length > 0) return;
  if (circuit.schedule.some((g) => !circuit.results[g.id])) {
    throw new Error('circuits: seedBracket before the regular slate finished');
  }
  let lastWeek = 0;
  for (const g of circuit.schedule) lastWeek = Math.max(lastWeek, g.week);
  const week = lastWeek + 1;
  if (circuit.kind === 'hs') {
    appendEliminationRound(circuit, standingsOrder(circuit, circuit.teams.length), week, 'bracket');
  } else if (circuit.kind === 'college') {
    appendEliminationRound(circuit, standingsOrder(circuit, career.params.circuits.collegeConfTeams), week, 'confTourney');
  } else {
    appendEliminationRound(circuit, standingsOrder(circuit, circuit.teams.length).slice(0, PRO_PLAYOFF_TEAMS), week, 'bracket');
  }
}

// ---------------------------------------------------------------------------
// summaries

/** '3rd' style ordinal for finish strings. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem = n % 10;
  return `${n}${rem === 1 ? 'st' : rem === 2 ? 'nd' : rem === 3 ? 'rd' : 'th'}`;
}

/** Human noun for a bracket round label. */
function roundNoun(label: string | undefined): string {
  return label === 'F' ? 'final'
    : label === 'SF' ? 'semifinal'
    : label === 'QF' ? 'quarterfinal'
    : label === 'R16' ? 'round of 16'
    : 'first round';
}

/** My team's run through one bracket phase: champion, the round I lost, or absent. */
function myPhaseOutcome(circuit: Circuit, type: 'confTourney' | 'bracket'): { champion: boolean; lostAt: string | null; played: boolean } {
  let champion = false;
  let lostAt: string | null = null;
  let played = false;
  for (const g of circuit.bracket) {
    if (g.type !== type) continue;
    if (g.homeIdx !== circuit.myTeamIdx && g.awayIdx !== circuit.myTeamIdx) continue;
    const rec = circuit.results[g.id];
    if (!rec) continue;
    played = true;
    const iWon = (rec.final[0] > rec.final[1]) === (g.homeIdx === circuit.myTeamIdx);
    if (!iWon) lostAt = g.round ?? null;
    else if (g.round === 'F') champion = true;
  }
  return { champion, lostAt, played };
}

/** My finish string, kind-appropriate ('state champion', 'lost the national quarterfinal', '3rd in conference'). */
function finishString(career: CareerState, circuit: Circuit): string {
  if (circuit.kind === 'hs') {
    const o = myPhaseOutcome(circuit, 'bracket');
    if (o.champion) return 'state champion';
    if (o.lostAt) return `lost the state ${roundNoun(o.lostAt)}`;
    const rank = standingsOrder(circuit, circuit.teams.length).indexOf(circuit.myTeamIdx) + 1;
    return `${ordinal(rank)} in the region`;
  }
  if (circuit.kind === 'college') {
    const nat = myPhaseOutcome(circuit, 'bracket');
    if (nat.champion) return 'national champion';
    if (nat.lostAt) return `lost the national ${roundNoun(nat.lostAt)}`;
    const conf = myPhaseOutcome(circuit, 'confTourney');
    if (conf.champion) return 'conference tournament champion';
    const rank = standingsOrder(circuit, career.params.circuits.collegeConfTeams).indexOf(circuit.myTeamIdx) + 1;
    return `${ordinal(rank)} in conference`;
  }
  const o = myPhaseOutcome(circuit, 'bracket');
  if (o.champion) return 'league champion';
  if (o.lostAt) return `lost the ${roundNoun(o.lostAt)}`;
  const rank = standingsOrder(circuit, circuit.teams.length).indexOf(circuit.myTeamIdx) + 1;
  return `${ordinal(rank)} in the league`;
}

/**
 * Compact summary of the active circuit season for circuitHistory: my
 * team's table record (the bracket run lives in the finish string), my
 * aggregated line, and simple scoring honors computed from the stored
 * season rows. Total points decide the scoring honors (every team plays
 * the same slate, so totals and per-game agree); a shared lead still
 * credits me (a co-champion scoring title reads as leading).
 */
export function summarizeCircuit(career: CareerState): CircuitSummary {
  const circuit = career.circuit;
  if (!circuit) throw new Error('circuits: summarizeCircuit with no active circuit');
  const myTeam = circuit.teams[circuit.myTeamIdx];
  if (!myTeam) throw new Error('circuits: my team index is out of range');
  const table = circuit.standings.find((s) => s.teamIdx === circuit.myTeamIdx);
  if (!table) throw new Error('circuits: my standings row is missing');

  // my aggregated line from the stored rows (ONE row by construction; the
  // find-or-create fold keys on season/team/type)
  const me = career.players[career.me];
  const myRows = (me?.seasons ?? []).filter((s) => s.season === circuit.year && s.teamId === myTeam.id && s.type === 'regular');
  const agg = { gp: 0, min: 0, pts: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tpm: 0, fgm: 0, fga: 0 };
  for (const row of myRows) {
    agg.gp += row.gp; agg.min += row.min; agg.pts += row.pts;
    agg.orb += row.orb; agg.drb += row.drb; agg.ast += row.ast;
    agg.stl += row.stl; agg.blk += row.blk; agg.tpm += row.tpm;
    agg.fgm += row.fgm; agg.fga += row.fga;
  }

  // scoring totals across the circuit's season rows, for the honors
  const teamIds = new Set(circuit.teams.map((t) => t.id));
  let teamBest = 0;
  let circuitBest = 0;
  let myPts = 0;
  const myRoster = new Set(myTeam.roster);
  for (const [pid, p] of Object.entries(career.players)) {
    let pts = 0;
    let inCircuit = false;
    for (const row of p.seasons) {
      if (row.season === circuit.year && row.type === 'regular' && teamIds.has(row.teamId)) {
        pts += row.pts;
        inCircuit = true;
      }
    }
    if (!inCircuit) continue;
    circuitBest = Math.max(circuitBest, pts);
    if (myRoster.has(pid)) teamBest = Math.max(teamBest, pts);
    if (pid === career.me) myPts = pts;
  }
  const honors: string[] = [];
  if (agg.gp > 0 && myPts >= teamBest) honors.push('team leading scorer');
  if (agg.gp > 0 && myPts >= circuitBest) honors.push('circuit scoring leader');

  return {
    year: circuit.year,
    kind: circuit.kind,
    teamName: myTeam.name,
    w: table.w,
    l: table.l,
    myLine: {
      gp: agg.gp, min: agg.min, pts: agg.pts,
      reb: agg.orb + agg.drb, ast: agg.ast, stl: agg.stl, blk: agg.blk, tpm: agg.tpm,
      // 3-decimal shooting display convention (0.472), 0 before any attempt
      fgPct: agg.fga > 0 ? Math.round((agg.fgm / agg.fga) * 1000) / 1000 : 0,
    },
    finish: finishString(career, circuit),
    honors,
  };
}
