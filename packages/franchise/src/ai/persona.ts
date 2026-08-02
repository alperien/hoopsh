/**
 * ai/persona.ts - GM personas and timeline re-evaluation. OWNER: ai-trade
 * task.
 *
 * A persona is a front office's temperament, sampled once at genesis and
 * stable for the GM's tenure (types.ts: "drifts only on GM change"). The
 * LIVE posture is team.strategy.timeline, which reevaluateTimelines moves
 * with the standings and the roster: a contender that lost its core sells,
 * a rebuilder whose kids arrived buys. Persona shifts the evidence bar
 * (a star-chaser talks himself into contention a few wins earlier), it
 * never overrides the evidence - that separation is what keeps thirty AI
 * front offices legible over decades (docs/FRANCHISE.md §7).
 *
 * Determinism: generatePersona draws only from the Rng handed in (genesis
 * owns the 'genesis:team:<id>' stream). reevaluateTimelines draws NOTHING -
 * it is a pure recompute from league state, so calling it twice on the same
 * state is idempotent and no registered stream exists for it (rng.ts).
 *
 * Numeric constants live here rather than FranchiseParams because the
 * params SHAPE froze in the contracts wave (params.ts header) and the
 * trade section carries no persona fields; each carries provenance and is
 * a candidate for promotion when the params shape reopens.
 */
import type { Rng } from '@hoopsh/engine';
import type { GmPersona, League, Timeline } from '../types.js';
import { abilityScore } from './valuation.js';

/**
 * Surname pool for front offices: 'the Reyes front office' reads better in
 * news copy than 'GM 7'. 40 plausible surnames (FEEL), era- and
 * region-mixed like real league executive rosters, avoiding famous
 * basketball names so no generated GM collides with a real one.
 */
const GM_SURNAMES: readonly string[] = [
  'Abernathy', 'Alvarez', 'Baptiste', 'Bassett', 'Calloway', 'Carver',
  'Delgado', 'Draper', 'Ellison', 'Fontaine', 'Garrick', 'Grady',
  'Hargrove', 'Holloway', 'Ibarra', 'Jennings', 'Kessler', 'Kowalski',
  'Lachance', 'Landry', 'Marsh', 'Mercado', 'Nakamura', 'Novak',
  'Okafor', 'Ortega', 'Pemberton', 'Petrov', 'Quintana', 'Reyes',
  'Rowe', 'Sandoval', 'Sorensen', 'Talbot', 'Ueda', 'Vance',
  'Whitfield', 'Yamada', 'Zielinski', 'Boone',
];

// Genesis timeline mix (FEEL): ~40% of real front offices talk like
// contenders, ~35% are openly retooling, ~25% are torn down. The live
// posture re-sorts itself from records within a season anyway; the mix
// only shapes opening-day behavior.
const TIMELINE_CONTEND_P = 0.40; // FEEL
const TIMELINE_RETOOL_P = 0.35;  // FEEL

// Trait distribution (FEEL): gaussian around the neutral 50 with sd 18
// gives real spread (a 90-patience hoarder and a 12-patience gambler both
// exist in most leagues) while keeping the mass believable; clamped to
// [5, 95] so no trait multiplier ever degenerates to 0 or saturates.
const TRAIT_MEAN = 50; // FEEL neutral center of every 0-100 trait scale
const TRAIT_SD = 18;   // FEEL
const TRAIT_LO = 5;    // FEEL clamp floor
const TRAIT_HI = 95;   // FEEL clamp ceiling

/** One gaussian trait draw, clamped and rounded to a readable integer. */
function trait(rng: Rng): number {
  const raw = rng.gaussian(TRAIT_MEAN, TRAIT_SD);
  return Math.round(Math.min(TRAIT_HI, Math.max(TRAIT_LO, raw)));
}

/**
 * Sample a full GM persona from the provided stream. Called by genesis
 * once per AI team (and by any future GM-change flow). Draw order is
 * fixed - name, timeline, risk, pickLove, starChase, patience - so a
 * league's personas are byte-stable for a seed.
 */
export function generatePersona(rng: Rng): GmPersona {
  const name = rng.pick(GM_SURNAMES);
  const roll = rng.float();
  const timeline: Timeline = roll < TIMELINE_CONTEND_P
    ? 'contend'
    : roll < TIMELINE_CONTEND_P + TIMELINE_RETOOL_P ? 'retool' : 'rebuild';
  return {
    name,
    timeline,
    risk: trait(rng),
    pickLove: trait(rng),
    starChase: trait(rng),
    patience: trait(rng),
  };
}

// --------------------------------------------------------------------------
// timeline re-evaluation

// Evidence bars (all FEEL, candidates for acceptance calibration):
const CONTEND_WIN_PCT_BAR = 0.55;   // FEEL ~45 wins: the record a front office needs to believe
const CONTEND_CORE_BAR = 68;        // FEEL avg ability of the top-3 (age<=30) that reads as a playoff core (#184: at 72 no team in two measured seeds ever contended - the bar sat above the leagues it judged)
const CONTEND_RECORD_ONLY_MARGIN = 0.05; // FEEL a ~50-win-pace record buys at the deadline whatever the core's age - February buyers are defined by the race, not the roster sheet
const CORE_MAX_AGE = 30;            // FEEL a core piece past 30 is a closing window, not a foundation
const REBUILD_BOTTOM_SHARE = 8 / 30; // REAL-shaped: the league's bottom 8 of 30 is lottery-odds territory
const MIN_GAMES_FOR_RECORD = 20;     // FEEL quarter-season before the standings mean anything
const STAR_CHASE_BAR_SWING = 0.08;   // FEEL max win-pct bar shift a 100-starChase persona buys
const PRIOR_TIMELINE_BAR_SHIFT = 0.02; // FEEL a contend-temperament GM needs slightly less proof

/** Win pct from a standings row; null when the sample is too small. */
function pctOf(row: { w: number; l: number } | undefined): number | null {
  if (!row) return null;
  const games = row.w + row.l;
  return games >= MIN_GAMES_FOR_RECORD ? row.w / games : null;
}

/**
 * The record a front office reasons from: the current season once it has
 * a real sample (the February call), else last season's archived
 * standings (the September call, after the spine resets standings), else
 * null (genesis day: nobody has played).
 */
function recordPctFor(league: League, teamId: string): number | null {
  const current = pctOf(league.standings[teamId]);
  if (current !== null) return current;
  const lastArchive = league.archives[league.archives.length - 1];
  if (lastArchive) {
    const row = lastArchive.finalStandings.find(s => s.teamId === teamId);
    const archived = pctOf(row);
    if (archived !== null) return archived;
  }
  return null;
}

/**
 * Recompute every AI team's live timeline from record and core quality.
 * Callers decide the cadence (the spine invokes it at camp open, the
 * opener, and deadline week); this function only recomputes:
 * - no record evidence anywhere (genesis day: no standings, no archive):
 *   the persona's temperament stands - evidence can move a front office
 *   off its identity, the absence of evidence cannot (#184: the old
 *   neutral-0.5 fallback wiped the genesis contend/retool/rebuild mix to
 *   an all-retool league in which no complementary trade pair ever
 *   existed);
 * - contend when a real core (top-3 ability among age<=30 players) and
 *   the record both support it - persona starChase and a contend
 *   temperament lower the record bar a little - or when the record alone
 *   clears the bar with margin (the February buyer is defined by the
 *   race, not the roster sheet);
 * - rebuild when the record sits in the league's bottom-8 share. Having
 *   promising kids is no veto: a lottery team with a young core is the
 *   archetypal deadline seller - the kids are WHY the vets are movable
 *   (#184; the trade engine only ever shops age-28+ rentals, never the
 *   young core itself);
 * - retool otherwise (the honest middle where most of the league lives).
 * Mutates team.strategy.timeline for AI teams ONLY - the user team's
 * strategy is the user's own call (gm === null marks user control).
 * Draws no randomness; safe to call repeatedly.
 */
export function reevaluateTimelines(league: League): void {
  const teamIds = Object.keys(league.teams).sort(); // sorted: byte-stable regardless of insertion history
  // rank evidence-holding teams once, worst record first; no-evidence
  // teams keep their persona prior and stay out of the bottom-cut sort
  const withEvidence = teamIds
    .map(id => ({ id, pct: recordPctFor(league, id) }))
    .filter((row): row is { id: string; pct: number } => row.pct !== null)
    .sort((a, b) => a.pct - b.pct || (a.id < b.id ? -1 : 1));
  const rankFromBottom: Record<string, number> = {};
  withEvidence.forEach((row, i) => { rankFromBottom[row.id] = i + 1; });
  const bottomCut = Math.max(1, Math.round(teamIds.length * REBUILD_BOTTOM_SHARE));

  for (const teamId of teamIds) {
    const team = league.teams[teamId]!;
    if (!team.gm) continue; // user team keeps its own strategy
    const persona = team.gm;

    const pct = recordPctFor(league, teamId);
    if (pct === null) {
      // genesis day: nobody has played, nothing to re-evaluate
      team.strategy.timeline = persona.timeline;
      continue;
    }

    // core quality: best three abilities among players young enough to
    // still be a foundation when the window opens
    const abilities: number[] = [];
    for (const pid of team.roster) {
      const p = league.players[pid];
      if (!p) continue;
      const age = league.season - p.bornSeason;
      if (age <= CORE_MAX_AGE) abilities.push(abilityScore(p));
    }
    abilities.sort((a, b) => b - a);
    const top3 = abilities.slice(0, 3);
    // fewer than three core-age players = no core, whatever their level
    const coreScore = top3.length === 3 ? (top3[0]! + top3[1]! + top3[2]!) / 3 : 0;

    // star-chasers and contend-temperament GMs believe a few wins earlier
    let bar = CONTEND_WIN_PCT_BAR - ((persona.starChase - TRAIT_MEAN) / 100) * STAR_CHASE_BAR_SWING; // trait vs neutral midpoint, /100 -> fraction
    if (persona.timeline === 'contend') bar -= PRIOR_TIMELINE_BAR_SHIFT;
    if (persona.timeline === 'rebuild') bar += PRIOR_TIMELINE_BAR_SHIFT;

    let next: Timeline;
    if ((coreScore >= CONTEND_CORE_BAR && pct >= bar) || pct >= bar + CONTEND_RECORD_ONLY_MARGIN) next = 'contend';
    else if (rankFromBottom[teamId]! <= bottomCut) next = 'rebuild';
    else next = 'retool';
    team.strategy.timeline = next;
  }
}
