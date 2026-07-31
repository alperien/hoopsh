/**
 * recruiting.ts - programs, the interest ladder, offers, signing.
 * OWNER: recruiting task. Implements docs/CAREER.md "Recruiting and
 * draft stock": programs hold scouted reads on you, never your true
 * sheet; interest climbs a ladder one rung at a time; offers are alive
 * (they cool, they expire, classes fill); and the pro alternatives (a
 * Euro club, the NBL Next Star slot) arrive alongside the letters.
 *
 * Perception seam: every read of me flows through ONE injectable
 * `perceive` function defaulting to perceiveProspect (perception.ts,
 * the shared fog primitive the stock task owns). updateRecruiting takes
 * it as an optional trailing parameter, so the frozen barrel signature
 * is unchanged for one-argument callers; tests inject a deterministic
 * stand-in until perception lands.
 *
 * Registered rng streams (franchise rng.ts discipline: fresh streams,
 * fixed draw counts per call, all derived from career.seed):
 *   career-recruit:<year>:<week>     weekly interest noise. Exactly one
 *                                    gaussian per program, drawn up
 *                                    front in programs order, so a
 *                                    closed program still consumes its
 *                                    slot and never reshuffles a
 *                                    sibling's draw.
 *   career-recruit:need:<programId>  stable positional need: five
 *                                    draws, one per position, the same
 *                                    value every week by construction.
 * buildPrograms draws from the CALLER's rng (the creation-time stream
 * belongs to whoever builds the career); its per-program draw order is
 * documented on the function.
 *
 * Every rung move, offer, pull, and close appends a CareerEvent of kind
 * 'recruiting' with a stated reason: the events feed is the phone
 * task's source material. This module never writes phone messages.
 */
import { clamp } from '@hoopsh/engine';
import type { Rng } from '@hoopsh/engine';
import { groupMean, streamRng } from '@hoopsh/franchise';
import type { AttrGroup, FrPlayer } from '@hoopsh/franchise';
import { perceiveProspect } from './perception.js';
import type {
  CareerState, InterestRung, Program, RecruitState, RoleId, RouteOffer,
} from './types.js';

// ---------------------------------------------------------------------------
// vocabulary (fixed orders, so nothing ever iterates an uncontrolled key set)

/** Ladder order per the InterestRung contract; params.recruiting
 * .rungThresholds[k-1] gates entry into RUNGS[k]. */
const RUNGS: readonly InterestRung[] = ['none', 'questionnaire', 'letter', 'texts', 'visit', 'offer'];

/** Role ladder in promise order (types.ts RoleId order). */
const ROLE_LADDER: readonly RoleId[] = ['garbage', 'bench', 'rotation', 'sixthMan', 'starter', 'featured', 'franchise'];

/** Stable group iteration order (PotentialProfile declaration order). */
const GROUP_ORDER: readonly AttrGroup[] = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'];

/** Lineup-order positions for the stable per-program need table. */
const POSITIONS: readonly FrPlayer['pos'][] = ['PG', 'SG', 'SF', 'PF', 'C'];

// ---------------------------------------------------------------------------
// recruiting-texture constants. Module-level because career params.ts is
// frozen outside this task's manifest; the genuinely sweepable levers
// (weights, thresholds, windows, money) already live in params.recruiting
// and are read from there (the scouting.ts report-texture precedent).

/** FEEL: the 3/5/6 tier split (blue bloods / high-majors / mid-majors)
 * the default 14-program board was authored against. */
const TIER_SPLIT_AT_14 = [3, 5, 6] as const;
const DEFAULT_BOARD = 14; // the params.recruiting.programCount default the split above describes

const COACH_DEV_BASE = [76, 66, 56] as const; // FEEL devQuality 0-100 by tier: blue-blood staffs develop pros; mid-major staffs are a coin flip
const COACH_DEV_SD = 7;   // FEEL: staff-to-staff spread inside a tier
const COACH_DEV_MIN = 35; // FEEL: even the worst D1 staff teaches something
const COACH_DEV_MAX = 92; // FEEL: nobody develops perfectly

/** Style poles cycled across the board so run-and-gun and grinder
 * programs BOTH exist every career (docs/CAREER.md: a run-and-gun
 * program inflates counting stats, a grinder teaches defense). Values
 * on the Coach.pace / Coach.threeBias 0-100 scale, 50 = league normal. */
const STYLE_POLES = [
  { pace: 34, threeBias: 44 }, // FEEL: the grinder: walk it up, guard people
  { pace: 50, threeBias: 52 }, // FEEL: the balanced program
  { pace: 68, threeBias: 62 }, // FEEL: run-and-gun: pace and threes inflate your box score
] as const;
const STYLE_JITTER_SD = 4; // FEEL: no two programs play identical ball
const STYLE_MIN = 20;      // FEEL: bounds of watchable college basketball
const STYLE_MAX = 85;

/** Fictional program names in the register of real college basketball
 * (docs/CAREER.md: fictional everywhere). Tier 1 carries flagship
 * weight; tiers 2-3 read like the mid-major Tuesday-night slate. */
const TIER_NAMES: Record<1 | 2 | 3, readonly string[]> = {
  1: ['Meridian State', 'Carolina Central', 'Blue Ridge', 'Cathedral', 'Atlantic Commonwealth', 'Lake State'],
  2: ['Fort Duquesne', 'Western Plains State', 'Gulf Coast Tech', 'Piedmont', 'Summit Valley', 'North Harbor', 'Redwood A&M'],
  3: ['Carolina Baptist', 'St. Brendan', 'East Fork State', 'Cedar Grove', 'Twin Rivers', 'Palmetto Wesleyan', 'Harlow College', 'Ridgeline'],
};

/** Recruiting-footprint regions. A program's region is its home turf;
 * a kid's comes from his birthplace (homeRegionOf). */
const REGIONS: readonly string[] = ['Northeast', 'Mid-Atlantic', 'Southeast', 'Midwest', 'Southwest', 'Mountain West', 'West Coast'];

// promised-role pricing against the public consensus on my level
const LEVEL_HIGH_MAJOR = 50; // FEEL: consensus level (0-100) of a legit high-major senior
const LEVEL_HEADLINER = 58;  // FEEL: a national headliner; programs sell the keys

// interest-score texture
const NOW_WEIGHT = 0.45;     // FEEL: recruiters buy the present...
const CEILING_WEIGHT = 0.55; // FEEL: ...but pay for the projection
const TIER_BAR = [58, 51, 44] as const; // FEEL: perceived rating a staff must see before real interest, by tier: blue bloods are harder to impress
const PERCEIVED_SLOPE = 2.5; // FEEL: interest points per perceived rating point above/below the tier bar
const REGION_MATCH = 100;    // FEEL: the local kid maxes the region component: the hometown fans already know your name
const REGION_FAR = 30;       // FEEL: programs still recruit nationally, just cooler
const WEEK_NOISE_SD = 2;     // FEEL: week-to-week scouting mood, small against the 12-point rung gaps
const RUNG_HYSTERESIS = 3;   // FEEL: courtship inertia: a staff does not un-send a letter (or pull an offer) over rounding noise
const COVERAGE_PER_GAME = 6; // FEEL: coverage points of tape per game played, before circuit exposure scaling
const TIER_COVERAGE_MULT = [1.5, 1.2, 1.0] as const; // FEEL: blue bloods scout everyone; mid-majors lean on regional tape
const EXPOSURE_SCORE_SCALE = 2.0; // FEEL: a half-season of prep tape is full exposure for a college staff; converts the NBA-grade coverage scale up

// the cold-stretch window (docs brief: last-3 games 25%+ under the season average)
const FORM_WINDOW_GAMES = 3; // FEEL: your last three games are what the staff just watched
const BAD_FORM_RATIO = 0.75; // the 25%-below-season-average slump trigger (FEEL)

// the pro alternatives
const PRO_CEILING_BAR = 62; // FEEL: perceived ceiling mean in top-30ish draft stock territory; pro clubs move at that read
const PRO_MIN_GAMES = 3;    // FEEL: pro clubs wire offers off real senior tape, not camp buzz
const EURO_CLUB_NAME = 'BC Dalmatia';         // fictional Adriatic club (universe is fictional everywhere)
const EURO_COACH_DEV = 82;  // FEEL: the best development on the board, if you survive the grown men (docs/CAREER.md)
const EURO_STYLE = { pace: 42, threeBias: 56 } as const; // FEEL: half-court FIBA ball with real spacing
const NBL_CLUB_NAME = 'Port Victoria Sharks'; // fictional NBL side
const NBL_COACH_DEV = 68;   // FEEL: decent development; the slot is a showcase first
const NBL_STYLE = { pace: 56, threeBias: 52 } as const; // FEEL: open, pro-paced showcase league

// ---------------------------------------------------------------------------
// small helpers

/** One-decimal display rounding for stat lines quoted in event reasons. */
function round1(x: number): number {
  return Math.round(x * 10) / 10; // 10: one-decimal display scale, not a lever
}

/** '$180k' money display. Hand-rolled: toLocaleString varies by
 * platform and would break byte-identical careers. */
function fmtMoney(n: number): string {
  return `$${Math.round(n / 1000)}k`; // 1000: dollars-to-thousands display scale
}

/** Mean over the six perceived groups in fixed order. */
function meanGroups(groups: Record<AttrGroup, number>): number {
  let sum = 0;
  for (const g of GROUP_ORDER) sum += groups[g];
  return sum / GROUP_ORDER.length;
}

/** The public consensus on a senior's broad level: mean of the six TRUE
 * group means. Deliberately not fog: mixtapes, camps, and rankings make
 * the broad level common knowledge; perception error applies to the
 * projection detail, not to whether you are a four-star. */
function consensusLevel(me: FrPlayer): number {
  let sum = 0;
  for (const g of GROUP_ORDER) sum += groupMean(me.attr, g);
  return sum / GROUP_ORDER.length;
}

/** A kid's home region: a stable function of his birthplace text (a
 * fact of geography, not a die roll, so no rng and nothing to store). */
function homeRegionOf(career: CareerState): string {
  const place = career.creation.birthplace;
  let h = 0;
  for (let i = 0; i < place.length; i++) h = ((h * 31) + place.charCodeAt(i)) >>> 0; // 31: classic polynomial string-hash base, not a tunable
  return REGIONS[h % REGIONS.length]!;
}

/** This program's positional need at MY position, 0-100, from a fresh
 * fixed-draw stream ('career-recruit:need:<programId>'): five draws,
 * one per position, every call, so the board reads the same every week
 * (scouting.ts persistence discipline). A guard-needy program courts
 * guards harder all season. */
function needFor(seed: string, programId: string, pos: FrPlayer['pos']): number {
  const rng = streamRng(seed, 'career-recruit', 'need', programId);
  let need = 50; // FEEL: neutral midpoint; always overwritten because pos is one of POSITIONS
  for (const p of POSITIONS) {
    const v = rng.float() * 100; // 100: the 0-100 need scale
    if (p === pos) need = v;
  }
  return need;
}

/** My regular-season line this circuit year, summed across stints. */
function seasonLine(me: FrPlayer, year: number): { gp: number; pts: number } {
  let gp = 0;
  let pts = 0;
  for (const row of me.seasons) {
    if (row.season === year && row.type === 'regular') {
      gp += row.gp;
      pts += row.pts;
    }
  }
  return { gp, pts };
}

/** Scoring average over my last FORM_WINDOW_GAMES circuit games, read
 * from circuit.results in schedule-then-bracket order (the circuits
 * contract keeps both arrays chronological). Null until the window
 * fills: nobody cools on two games of tape. */
function recentForm(career: CareerState): number | null {
  const c = career.circuit;
  if (!c) return null;
  const pts: number[] = [];
  for (const g of [...c.schedule, ...c.bracket]) {
    const rec = c.results[g.id];
    if (!rec) continue;
    for (const line of rec.lines) {
      if (line.playerId === career.me) {
        pts.push(line.pts);
        break;
      }
    }
  }
  if (pts.length < FORM_WINDOW_GAMES) return null;
  let sum = 0;
  for (const p of pts.slice(-FORM_WINDOW_GAMES)) sum += p;
  return sum / FORM_WINDOW_GAMES;
}

/** Scouting coverage a program has on me, 0-100. Games played are the
 * exposure currency (params.stock.exposure.hs scales the HS circuit's
 * visibility) and tier multiplies reach: blue-blood networks see every
 * gym, mid-majors lean on regional tape. */
function coverageFor(gp: number, tier: 1 | 2 | 3, career: CareerState): number {
  return clamp(gp * COVERAGE_PER_GAME * career.params.stock.exposure.hs * TIER_COVERAGE_MULT[tier - 1]!, 0, 100);
}

/** The 0-100 interest score: the params.recruiting-weighted blend of
 * what their scouts believe (vs the tier's bar), stable positional
 * need, region match, and exposure. Pure; the caller adds the weekly
 * noise from the registered week stream. */
function interestScore(career: CareerState, me: FrPlayer, program: Program, perceived: number, coverage: number): number {
  const p = career.params.recruiting;
  // 50 = perceived exactly at the tier's bar; the slope prices distance from it
  const perceivedScore = clamp(50 + (perceived - TIER_BAR[program.tier - 1]!) * PERCEIVED_SLOPE, 0, 100);
  const need = needFor(career.seed, program.id, me.pos);
  const region = program.region === homeRegionOf(career) ? REGION_MATCH : REGION_FAR;
  const exposure = clamp(coverage * EXPOSURE_SCORE_SCALE, 0, 100);
  return clamp(
    p.wPerceived * perceivedScore + p.wNeed * need + p.wRegion * region + p.wExposure * exposure,
    0, 100,
  );
}

/** Append a 'recruiting' CareerEvent with a stated reason (the
 * explained-consequence lint reads reason; the phone task reads the
 * feed). Ids are unique by construction: events only ever append, and
 * the running event count is part of the id. */
function pushEvent(career: CareerState, reason: string, delta?: number): void {
  const ev = {
    id: `rec-${career.clock.year}w${career.clock.week}-${career.events.length}`,
    clock: { ...career.clock }, // snapshot: the live clock keeps moving
    kind: 'recruiting' as const,
    reason,
  };
  career.events.push(delta === undefined ? ev : { ...ev, delta });
}

/** Program name for an offer's event lines ('the club' fallbacks keep
 * reasons nonempty even on malformed data). */
function destName(rec: RecruitState, offer: RouteOffer): string {
  if (offer.kind !== 'college') return offer.clubName ?? 'the club';
  return rec.programs.find(x => x.id === offer.programId)?.name ?? offer.programId ?? 'the program';
}

// ---------------------------------------------------------------------------
// buildPrograms

/** The tier list for a board of `count` programs: 3/5/6 at the default
 * 14, proportional otherwise, at least one per tier so every prestige
 * rung exists to choose against. Boards below three programs are not a
 * recruiting fantasy; count clamps up to three. */
function tierPlan(count: number): Array<1 | 2 | 3> {
  const n = Math.max(3, count); // 3: one program per tier minimum
  const t1 = Math.max(1, Math.round((n * TIER_SPLIT_AT_14[0]) / DEFAULT_BOARD));
  const t2 = Math.max(1, Math.round((n * TIER_SPLIT_AT_14[1]) / DEFAULT_BOARD));
  const t3 = Math.max(1, n - t1 - t2);
  const plan: Array<1 | 2 | 3> = [];
  for (let i = 0; i < t1; i++) plan.push(1);
  for (let i = 0; i < t2; i++) plan.push(2);
  for (let i = 0; i < t3; i++) plan.push(3);
  return plan;
}

/** What a program promises a recruit at my consensus level: the blue
 * blood sells development behind pros (bench), the high-major sells
 * rotation minutes, the mid-major sells the keys. Better kids get
 * bigger promises everywhere, capped at 'featured': nobody promises a
 * high school senior the franchise. */
function promiseFor(tier: 1 | 2 | 3, level: number): RoleId {
  const base = tier === 1 ? 1 : tier === 2 ? 2 : 4; // ROLE_LADDER indices: bench / rotation / starter
  const bump = level >= LEVEL_HEADLINER ? 2 : level >= LEVEL_HIGH_MAJOR ? 1 : 0;
  return ROLE_LADDER[Math.min(base + bump, ROLE_LADDER.length - 2)]!; // length-2 = 'featured' cap
}

/**
 * Build the college recruiting board at career creation:
 * params.recruiting.programCount programs across three prestige tiers.
 * Pure construction from the caller's rng (the creation-time stream is
 * the caller's to own) in a FIXED per-program draw order: name index,
 * region, coachDev gaussian, pace jitter, threeBias jitter (five draws
 * per program, consumed even when a name pool runs dry), so a board is
 * a pure function of the stream handed in. Called once when the HS
 * phase opens; mutates nothing on the career.
 */
export function buildPrograms(career: CareerState, rng: Rng): Program[] {
  const p = career.params.recruiting;
  const me = career.players[career.me];
  if (!me) throw new Error('career/recruiting: career.me is not in career.players');
  const level = consensusLevel(me);
  // copies: name draws are without replacement inside one board
  const pools: Record<1 | 2 | 3, string[]> = {
    1: [...TIER_NAMES[1]],
    2: [...TIER_NAMES[2]],
    3: [...TIER_NAMES[3]],
  };
  const tiers = tierPlan(p.programCount);
  const programs: Program[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;
    const pool = pools[tier];
    const nameIdx = rng.int(Math.max(1, pool.length)); // draw even on an empty pool: fixed draw count
    const region = REGIONS[rng.int(REGIONS.length)]!;
    const coachDev = Math.round(clamp(COACH_DEV_BASE[tier - 1]! + rng.gaussian(0, COACH_DEV_SD), COACH_DEV_MIN, COACH_DEV_MAX));
    const pole = STYLE_POLES[i % STYLE_POLES.length]!; // cycling the poles inside each tier block keeps both styles present at every prestige level
    const pace = Math.round(clamp(pole.pace + rng.gaussian(0, STYLE_JITTER_SD), STYLE_MIN, STYLE_MAX));
    const threeBias = Math.round(clamp(pole.threeBias + rng.gaussian(0, STYLE_JITTER_SD), STYLE_MIN, STYLE_MAX));
    // pool overflow (programCount raised far past the default) falls back
    // to a region-built name; still fictional, still unique via the index
    const name = pool.length > 0 ? pool.splice(nameIdx, 1)[0]! : `${region} ${tier === 1 ? 'State' : 'College'} ${i + 1}`;
    programs.push({
      id: `prog-${String(i + 1).padStart(2, '0')}`,
      name,
      tier,
      coachDev,
      style: { pace, threeBias },
      promisedRole: promiseFor(tier, level),
      nil: p.nilByTier[tier - 1]!,
      region,
    });
  }
  return programs;
}

// ---------------------------------------------------------------------------
// the weekly update

/** Snapshot a college program's terms into a live RouteOffer. Tier-1
 * offers carry a signing-day hold (an expiresWeek a full calendar year
 * out: a blue blood keeps the scholarship warm, and both the window
 * sweep and class-fill day skip tier 1); everyone else's window is
 * params.recruiting.offerWindowWeeks. */
function extendCollegeOffer(career: CareerState, rec: RecruitState, program: Program): RouteOffer {
  const p = career.params.recruiting;
  const hold = program.tier === 1 ? career.params.tick.weeksPerYear : p.offerWindowWeeks;
  const offer: RouteOffer = {
    id: `off-${program.id}`,
    kind: 'college',
    programId: program.id,
    money: program.nil,
    coachDev: program.coachDev,
    promisedRole: program.promisedRole,
    style: { ...program.style }, // snapshot: an offer is terms, not a live pointer
    expiresWeek: career.clock.week + hold,
  };
  rec.offers.push(offer);
  return offer;
}

/** Event line for an up-move below 'offer' (the offer itself carries
 * its own line). Quotes my season scoring when there is tape. */
function upReason(program: Program, rung: InterestRung, gp: number, seasonAvg: number): string {
  const form = gp > 0 ? ` after watching ${round1(seasonAvg)} a game` : ' off summer-circuit tape';
  switch (rung) {
    case 'questionnaire': return `${program.name} mailed a questionnaire${form}`;
    case 'letter': return `${program.name} sent a letter from the head coach${form}`;
    case 'texts': return `${program.name} opened a text thread: an assistant checks in weekly now`;
    case 'visit': return `${program.name} scheduled an in-home visit: the head coach is coming`;
    default: return `${program.name} moved up the board`; // unreachable: 'offer' and 'none' are never targets here
  }
}

/** The pro alternatives: when a neutral pro read of my ceiling clears
 * top-30ish territory, a Euro club and the NBL Next Star slot each
 * surface ONCE per career. Offers stay in the array dead or alive
 * (liveness rides on expiresWeek), so the once-guard is a simple scan. */
function maybeRouteOffers(
  career: CareerState, rec: RecruitState, me: FrPlayer, gp: number,
  perceive: typeof perceiveProspect,
): void {
  if (gp < PRO_MIN_GAMES) return; // pro clubs sign tape, not camp buzz
  const p = career.params.recruiting;
  const week = career.clock.week;
  // pro scouting departments run blue-blood reach: worldwide networks
  const coverage = coverageFor(gp, 1, career);
  if (!rec.offers.some(o => o.kind === 'euro')) {
    const read = perceive(career.seed, 'route:euro', me, coverage, career.params);
    if (meanGroups(read.ceiling) >= PRO_CEILING_BAR) {
      rec.offers.push({
        id: 'off-route-euro',
        kind: 'euro',
        clubName: EURO_CLUB_NAME,
        money: p.euroOfferMoney,
        coachDev: EURO_COACH_DEV,
        promisedRole: 'bench', // you earn minutes against grown men (docs/CAREER.md)
        style: { ...EURO_STYLE },
        expiresWeek: week + p.offerWindowWeeks,
      });
      pushEvent(career, `${EURO_CLUB_NAME} tabled a pro contract: ${fmtMoney(p.euroOfferMoney)} a season, the best coaching on the board, every minute earned`);
    }
  }
  if (!rec.offers.some(o => o.kind === 'nbl')) {
    const read = perceive(career.seed, 'route:nbl', me, coverage, career.params);
    if (meanGroups(read.ceiling) >= PRO_CEILING_BAR) {
      rec.offers.push({
        id: 'off-route-nbl',
        kind: 'nbl',
        clubName: NBL_CLUB_NAME,
        money: p.nblOfferMoney,
        coachDev: NBL_COACH_DEV,
        promisedRole: 'starter', // the Next Star slot is a guaranteed showcase
        style: { ...NBL_STYLE },
        expiresWeek: week + p.offerWindowWeeks,
      });
      pushEvent(career, `${NBL_CLUB_NAME} offered the Next Star slot: ${fmtMoney(p.nblOfferMoney)}, a starter's showcase on a short season`);
    }
  }
}

/**
 * Weekly recruiting update, called by the week tick during the HS
 * phase. Recomputes every open program's perception and interest score,
 * moves rungs (at most ONE per program per week, either direction:
 * courtship has pacing), extends and pulls offers, runs class-fill day
 * and window expiry, and surfaces the pro route offers. Mutates
 * career.recruiting and appends explained CareerEvents; writes nothing
 * else.
 *
 * The cold-stretch rule, precisely: a "bad week" is when my last
 * FORM_WINDOW_GAMES (3) games in circuit.results average 25%+ below my
 * season scoring average (pts/gp from my season rows). Each consecutive
 * bad week drags the stored perceived read down by
 * params.recruiting.coolPerBadWeek (never above the fresh fog read); a
 * normal week snaps the read back to the tape.
 *
 * `perceive` is an optional trailing parameter (default
 * perceiveProspect) so the frozen barrel signature holds for
 * one-argument callers; tests inject a deterministic stand-in.
 */
export function updateRecruiting(
  career: CareerState,
  perceive: typeof perceiveProspect = perceiveProspect,
): void {
  const rec = career.recruiting;
  // recruiting is a high-school courtship: no board, a signed kid, or a
  // non-HS phase means nobody is calling this week
  if (!rec || rec.committedTo || career.clock.phase !== 'hs') return;
  if (rec.programs.length === 0) return;
  const me = career.players[career.me];
  if (!me) return; // pre-creation states have nobody to scout

  const { year, week } = career.clock;
  const p = career.params.recruiting;

  // production signals: season line from my rows, recent form from the
  // game log (see the cold-stretch rule in the function doc)
  const { gp, pts } = seasonLine(me, year);
  const seasonAvg = gp > 0 ? pts / gp : 0;
  const recent = recentForm(career);
  const badWeek = recent !== null && seasonAvg > 0 && recent < seasonAvg * BAD_FORM_RATIO;

  // weekly noise: one gaussian per program in programs order, drawn up
  // front so a closed program still consumes its slot and can never
  // reshuffle a sibling's draw ('career-recruit:<year>:<week>')
  const weekRng = streamRng(career.seed, 'career-recruit', year, week);
  const noise: number[] = rec.programs.map(() => weekRng.gaussian(0, WEEK_NOISE_SD));

  for (let i = 0; i < rec.programs.length; i++) {
    const program = rec.programs[i]!;
    let interest = rec.interest.find(x => x.programId === program.id);
    if (!interest) {
      // first evaluation puts the program on the board at 'none'.
      // lastMoveWeek backdates one week so a fresh entry is
      // move-eligible now: the field records rung moves and none has
      // happened yet.
      interest = { programId: program.id, rung: 'none', perceived: 0, lastMoveWeek: week - 1, closed: false };
      rec.interest.push(interest);
    }
    if (interest.closed) continue;

    // their fog read of me, coverage growing with my games played;
    // slumps drag the stored read (see the cold-stretch rule above)
    const coverage = coverageFor(gp, program.tier, career);
    const fog = perceive(career.seed, program.id, me, coverage, career.params);
    const fogBlend = NOW_WEIGHT * meanGroups(fog.now) + CEILING_WEIGHT * meanGroups(fog.ceiling);
    // (floor 1: perceived 0 is the fresh-entry sentinel above, so a long
    // slump may not decay a real read back into "never scouted")
    interest.perceived = badWeek && interest.perceived > 0
      ? Math.max(1, Math.min(fogBlend, interest.perceived) - p.coolPerBadWeek)
      : fogBlend;

    const score = interestScore(career, me, program, interest.perceived, coverage) + noise[i]!;
    const r = RUNGS.indexOf(interest.rung);

    if (r === RUNGS.length - 1) {
      // at 'offer' the only move left is losing it: below the offer
      // threshold (minus courtship inertia) the staff pulls the paper
      const offer = rec.offers.find(o => o.kind === 'college' && o.programId === program.id);
      if (offer && week < offer.expiresWeek && score < p.rungThresholds[RUNGS.length - 2]! - RUNG_HYSTERESIS) {
        offer.expiresWeek = week; // dead now: openOffers reads liveness off expiresWeek
        interest.closed = true;
        interest.closedReason = 'cooled off';
        interest.lastMoveWeek = week;
        pushEvent(
          career,
          badWeek && recent !== null
            ? `${program.name} pulled the offer after a cold stretch: ${round1(recent)} a game over the last three`
            : `${program.name} pulled the offer: the staff moved on to other names`,
          -1,
        );
      }
      continue;
    }

    // pacing: one rung per week in either direction (also guards a
    // double update inside one week, which must not double-climb)
    if (interest.lastMoveWeek >= week) continue;

    if (score >= p.rungThresholds[r]!) { // rungThresholds[r] gates RUNGS[r+1]
      const next = RUNGS[r + 1]!;
      if (next === 'offer') {
        // a tier 2-3 program cannot offer once its class has filled:
        // that scholarship went to a kid who said yes faster
        if (program.tier !== 1 && week >= p.classFillWeek) continue;
        interest.rung = next;
        interest.lastMoveWeek = week;
        const offer = extendCollegeOffer(career, rec, program);
        pushEvent(
          career,
          `${program.name} put a committable offer on the table: ${offer.promisedRole} role, ${fmtMoney(offer.money)} NIL, ${program.tier === 1 ? 'held to signing day' : `a ${p.offerWindowWeeks}-week window`}`,
          1,
        );
      } else {
        interest.rung = next;
        interest.lastMoveWeek = week;
        pushEvent(career, upReason(program, next, gp, seasonAvg), 1);
      }
    } else if (r > 0 && score < p.rungThresholds[r - 1]! - RUNG_HYSTERESIS) {
      // cooling: fall one rung when the score no longer holds the
      // CURRENT rung's own gate (hysteresis stops noise flapping)
      interest.rung = RUNGS[r - 1]!;
      interest.lastMoveWeek = week;
      pushEvent(
        career,
        badWeek && recent !== null
          ? `${program.name} cooled after ${round1(recent)} a game over the last three (season: ${round1(seasonAvg)})`
          : `${program.name} cooled off: the staff is looking at other names`,
        -1,
      );
    }
  }

  // class-fill day: tier 2-3 scholarships are finite; unanswered offers
  // close when their classes fill. Blue bloods hold to signing day.
  if (week >= p.classFillWeek) {
    for (const offer of rec.offers) {
      if (offer.kind !== 'college' || week >= offer.expiresWeek) continue;
      const program = rec.programs.find(x => x.id === offer.programId);
      const interest = rec.interest.find(x => x.programId === offer.programId);
      if (!program || program.tier === 1 || !interest || interest.closed) continue;
      offer.expiresWeek = week;
      interest.closed = true;
      interest.closedReason = 'class filled';
      pushEvent(career, `${program.name} filled its class: the scholarship went to a kid who committed`);
    }
  }

  // window expiry: an offer you sat on lapses at expiresWeek
  for (const offer of rec.offers) {
    if (offer.kind === 'college') {
      if (week < offer.expiresWeek) continue;
      const interest = rec.interest.find(x => x.programId === offer.programId);
      if (!interest || interest.closed) continue; // closed already told this story (pull / fill / signed elsewhere)
      interest.closed = true;
      interest.closedReason = 'offer expired';
      pushEvent(career, `${destName(rec, offer)} let the offer lapse: the window closed unanswered`);
    } else if (week === offer.expiresWeek) {
      // route offers have no interest row; exact-week equality is the
      // one-shot guard (the tick calls this once per week by contract)
      pushEvent(career, `${offer.clubName ?? 'the club'} moved on: the contract window closed unanswered`);
    }
  }

  maybeRouteOffers(career, rec, me, gp, perceive);
}

// ---------------------------------------------------------------------------
// offers on the table, and the commitment

/**
 * The route offers on the table right now. Liveness rides on
 * expiresWeek (a pull, a filled class, and 'signed elsewhere' all set
 * it to the current week, so one filter serves every close path); after
 * commitment only the signed deal remains on the table.
 */
export function openOffers(career: CareerState): RouteOffer[] {
  const rec = career.recruiting;
  if (!rec) return [];
  if (rec.committedTo) return rec.offers.filter(o => o.id === rec.committedTo);
  return rec.offers.filter(o => career.clock.week < o.expiresWeek);
}

/**
 * Commit to one live offer: the signing-day moment. Sets
 * recruiting.committedTo, kills every other live offer (their interest
 * rows close 'signed elsewhere'), and states all of it in the event
 * log. Called by tick.ts on the commitCollege / acceptOffer choices;
 * exported from this module (not the frozen barrel) for package
 * internals and tests.
 * Throws on an unknown, dead, or double commitment: choice validation
 * is the tick's job, and a bad id reaching this deep is a bug to
 * surface, not absorb (fail-loud repo convention).
 */
export function commitToOffer(career: CareerState, offerId: string): void {
  const rec = career.recruiting;
  if (!rec) throw new Error('career/recruiting: no recruiting state to commit in');
  if (rec.committedTo) throw new Error(`career/recruiting: already committed to ${rec.committedTo}`);
  const offer = rec.offers.find(o => o.id === offerId);
  if (!offer) throw new Error(`career/recruiting: unknown offer ${offerId}`);
  const week = career.clock.week;
  if (week >= offer.expiresWeek) throw new Error(`career/recruiting: offer ${offerId} is no longer live`);

  rec.committedTo = offerId;
  const dest = destName(rec, offer);
  pushEvent(
    career,
    offer.kind === 'college'
      ? `Committed to ${dest}: ${offer.promisedRole} role promised, ${fmtMoney(offer.money)} NIL`
      : `Signed with ${dest}: ${fmtMoney(offer.money)} a season, ${offer.promisedRole} role`,
  );

  for (const other of rec.offers) {
    if (other.id === offerId || week >= other.expiresWeek) continue;
    other.expiresWeek = week; // off the board
    if (other.programId) {
      const interest = rec.interest.find(x => x.programId === other.programId);
      if (interest && !interest.closed) {
        interest.closed = true;
        interest.closedReason = 'signed elsewhere';
      }
    }
    pushEvent(career, `${destName(rec, other)} came off the board: signed elsewhere`);
  }
}
