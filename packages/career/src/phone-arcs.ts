/**
 * phone-arcs.ts - the formative arcs: scheduled, state-backed texture for
 * the three windows the #100 measurement found structurally silent (issue
 * #105): the circuit offseason, the pre-combine draftPrep block, and the
 * NBA draft-to-camp gap. Part of the phone surface; see phone.ts for the
 * discipline rules and module map.
 *
 * Why these exist: every other generator is conditional on something a
 * dead window never has (games, rung moves, board moves, transactions).
 * These windows still hold simulated truth - the archived season, the
 * training ledger, the per-team boards, the league running underneath,
 * the real rookie contract, the real depth chart - and a basketball life
 * has real rituals there: the exit meeting, the summer program, the
 * pre-draft block, the rookie summer. Each beat below narrates state that
 * exists, or it does not fire. Silence stays content; these are the weeks
 * where the fiction says somebody actually texts.
 *
 * Discipline, unchanged from phone.ts: season caps and cooldowns all
 * apply (nothing here is capExempt - exemption is reserved for the payoff
 * nights), anti-repeat applies, one rng draw per admitted message on the
 * existing weekly stream (this module draws nothing itself). Every beat
 * is once-per-window via the '#tag#' id mechanism.
 *
 * WINDOW TRIGGERS: each beat offers itself across a multi-week window
 * until admitted once, instead of firing on a single anchor week. A week
 * lost to a cap, a cooldown, or a louder thread slides the beat one week
 * instead of killing it. The windows are spaced so the drought bands hold
 * even when every coach-thread beat is cap-blocked (the measured worst
 * case: a loud season spends the coach cap before the fold, while a
 * locked-board phenom leaves the agent and wire threads nearly unused;
 * the mid-window beats lean on those two on purpose).
 */
import type { AttrGroup, FrPlayer } from '@hoopsh/franchise';
import { groupMean } from '@hoopsh/franchise';
import { agentFrom } from './phone-agent.js';
import {
  ROLE_LABEL, THREAD_RANK, fmtMoney, meOf, nbaTeamNameOf, round1, wireBylineOf,
} from './phone-shared.js';
import type { Candidate } from './phone-shared.js';
import type { CareerPhase, CareerState, CircuitSummary, PhoneChoice } from './types.js';

// ---------------------------------------------------------------------------
// cadence constants (module constants per the phone-shared precedent: the
// frozen params shape carries no arc keys, and module constants keep old
// saves loading unchanged)

/** FEEL: offseason beat windows in weeks after the fold. Spaced 5 apart so the longest measured offseason (34 weeks, #100) never runs more than ~6 silent weeks between beats, inside the <= 8 band #104 re-bases to (drip worst case + 1). */
const OFF_EXIT_WINDOW: [number, number] = [1, 5];
const OFF_LEDGER_WINDOW: [number, number] = [6, 10];
const OFF_BOARD_WINDOW: [number, number] = [11, 15];
const OFF_SEPT_WINDOW: [number, number] = [16, 20];
const OFF_BLOCK_WINDOW: [number, number] = [21, 25];

/** FEEL: the new-year camp countdown fires in the first month, before the season builds (tick.ts builds at seasonStartWeek; the earliest is proSeasonStartWeek 6). */
const OFF_CAMP_WINDOW: [number, number] = [1, 4];

/** FEEL: draftPrep beat windows in weeks of the draftPrep year. Six beats spaced <= 6 apart bridge w0 to the combine at w33; every one reads a fact that exists with the board locked (the measured silent case: 30-31 zero weeks of 39 on every seed). */
const DP_PROGRAM_WINDOW: [number, number] = [1, 5];
const DP_BOARD_WINDOW: [number, number] = [6, 11];
const DP_RACE_WINDOW: [number, number] = [12, 17];
const DP_WIND_WINDOW: [number, number] = [18, 23];
const DP_RUN_WINDOW: [number, number] = [24, 29];
const DP_COMBINE_WINDOW: [number, number] = [30, 32];

/** FEEL: entry beat windows in weeks since the draft transaction. The measured gap is 6-9 career weeks of league offseason; three beats plus the camp door keep it under 4. */
const NBA_PAPER_WINDOW: [number, number] = [1, 3];
const NBA_PACKAGE_WINDOW: [number, number] = [2, 5];
const NBA_ROOM_WINDOW: [number, number] = [4, 8];
/** FEEL: the camp door stays honest only near entry; a tenth-year camp is routine, not a beat. */
const NBA_CAMP_MAX_WEEKS_SINCE_DRAFT = 20;

/**
 * The six trainable groups in fixed order, mirroring tick.ts's
 * VALID_GROUPS (module-private there). A fixed local list keeps the
 * weakest-group tiebreak byte-stable; iterating somebody else's object
 * keys would tie our determinism to their literal's ordering. Exported
 * for phone.ts's arc-focus validation (one source, two consumers).
 */
export const TRAINABLE_GROUPS: readonly AttrGroup[] = [
  'phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental',
];

/** How a group reads in a text ('rebounding' is a stat column; 'the glass' is what a coach says). */
const GROUP_LABEL: Record<AttrGroup, string> = {
  phys: 'the frame', scoring: 'the scoring', playmaking: 'the playmaking',
  defense: 'the defense', rebounding: 'the glass', mental: 'the reads',
};

/** Circuit phases, mirroring tick.ts's list (module-private there). */
const CIRCUIT_PHASES: readonly CareerPhase[] = ['hs', 'college', 'euro', 'nbl', 'china'];

/** Season build week by phase, mirroring tick.ts#seasonStartWeek (module-private there). */
function seasonStartWeek(career: CareerState): number {
  const t = career.params.tick;
  switch (career.clock.phase) {
    case 'hs': return t.hsSeasonStartWeek;
    case 'college': return t.collegeSeasonStartWeek;
    default: return t.proSeasonStartWeek;
  }
}

// ---------------------------------------------------------------------------
// shared reads

function absWeek(career: CareerState, clock: { year: number; week: number }): number {
  return clock.year * career.params.tick.weeksPerYear + clock.week;
}

/**
 * Weeks since this year's season fold, read from the fold's own 'phase'
 * event ('season over...', tick.ts#foldSeason). Null when no fold happened
 * this career year (in-season, or the post-wrap stretch before the next
 * build, which the camp-countdown beat owns instead).
 */
function weeksSinceFold(career: CareerState): number | null {
  for (let i = career.events.length - 1; i >= 0; i--) {
    const e = career.events[i]!;
    if (e.kind !== 'phase' || !e.reason.startsWith('season over')) continue;
    if (e.clock.year !== career.clock.year) return null; // last fold was last year
    return career.clock.week - e.clock.week;
  }
  return null;
}

/** The offseason predicate: a circuit phase with no live season. */
function inOffseason(career: CareerState): boolean {
  return CIRCUIT_PHASES.includes(career.clock.phase) && career.circuit === null;
}

/** This year's archived season, the exit meeting's source of truth. */
function summaryThisYear(career: CareerState): CircuitSummary | null {
  for (let i = career.circuitHistory.length - 1; i >= 0; i--) {
    const s = career.circuitHistory[i]!;
    if (s.year === career.clock.year) return s;
  }
  return null;
}

/** The latest archived season regardless of year (the draftPrep block trains off the last real tape). */
function lastSummary(career: CareerState): CircuitSummary | null {
  return career.circuitHistory[career.circuitHistory.length - 1] ?? null;
}

/** Points per game off a summary's TOTALS line (the CircuitSummary trap: divide by gp). */
function summaryPpg(s: CircuitSummary): number | null {
  return s.myLine.gp > 0 ? round1(s.myLine.pts / s.myLine.gp) : null;
}

/**
 * The staff's read: the lowest-mean attribute group, in TRAINABLE_GROUPS
 * order on ties so two identical sheets read identically. This is what an exit
 * meeting is FOR - the honest gap, not the highlight reel.
 */
function weakestGroup(me: FrPlayer): AttrGroup {
  let worst: AttrGroup = TRAINABLE_GROUPS[0]!;
  for (const g of TRAINABLE_GROUPS) {
    if (groupMean(me.attr, g) < groupMean(me.attr, worst)) worst = g;
  }
  return worst;
}

/** Whether a group has nothing left to teach (the accrueTraining ceiling condition). */
function groupFinished(me: FrPlayer, group: AttrGroup): boolean {
  return groupMean(me.attr, group) >= me.potential[group];
}

/** The next-weakest group with headroom, for the finished-drawer read; null when the whole sheet is done. */
function nextOpenGroup(me: FrPlayer, not: AttrGroup): AttrGroup | null {
  let best: AttrGroup | null = null;
  for (const g of TRAINABLE_GROUPS) {
    if (g === not || groupFinished(me, g)) continue;
    if (best === null || groupMean(me.attr, g) < groupMean(me.attr, best)) best = g;
  }
  return best;
}

/**
 * Training points landed per group since a week of the CURRENT career
 * year, off the real devLog. Career-side rows are week-dated (week.ts
 * stamps (year, week)); league-side rows from the NBA dev review carry
 * league (season, day up to 313) and are excluded by the year match plus
 * the week-range guard, so a descent-phase offseason never mis-sums a
 * league date as a week.
 */
function devSince(career: CareerState, me: FrPlayer, sinceWeek: number): Partial<Record<AttrGroup, number>> {
  const out: Partial<Record<AttrGroup, number>> = {};
  for (const row of me.devLog) {
    if (row.date.season !== career.clock.year) continue;
    if (row.date.day < sinceWeek || row.date.day >= career.params.tick.weeksPerYear) continue;
    for (const g of TRAINABLE_GROUPS) {
      const d = (row.deltas as Partial<Record<AttrGroup, number>>)[g];
      if (d && d > 0) out[g] = (out[g] ?? 0) + d;
    }
  }
  return out;
}

/** '+2 the defense, +1 the reads' - the ledger line a real trainer texts. */
function fmtDevLine(deltas: Partial<Record<AttrGroup, number>>): string | null {
  const parts: string[] = [];
  for (const g of TRAINABLE_GROUPS) {
    const d = deltas[g];
    if (d && d > 0) parts.push(`+${d} ${GROUP_LABEL[g]}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * The board's named extremes: the warmest and coldest rooms by their real
 * perceived value of me (stock.perTeam), teamId-tiebroken so the sort is
 * byte-stable. Null when fewer than two rooms hold a number.
 */
function boardExtremes(career: CareerState): { high: string; low: string } | null {
  const stock = career.stock;
  if (!stock) return null;
  const entries = Object.entries(stock.perTeam)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (entries.length < 2) return null;
  return {
    high: nbaTeamNameOf(career, entries[0]![0]),
    low: nbaTeamNameOf(career, entries[entries.length - 1]![0]),
  };
}

/** League standings sorted worst-first, teamId-tiebroken (the tank-race read). */
function standingsWorstFirst(career: CareerState): Array<{ name: string; w: number; l: number }> {
  return Object.values(career.league.standings)
    .sort((a, b) => a.w - b.w || b.l - a.l || (a.teamId < b.teamId ? -1 : 1))
    .map(s => ({ name: nbaTeamNameOf(career, s.teamId), w: s.w, l: s.l }));
}

/** 77 -> 6'5" (combine copy quotes the real frame). */
function fmtHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** The focus decision every assignment beat carries: take the staff's group or keep your own program. Applied in phone.ts#applyPhoneChoice. */
function focusChoices(group: AttrGroup): PhoneChoice[] {
  return [
    { id: `arc-focus:${group}`, label: `Take the assignment (${GROUP_LABEL[group]})` },
    { id: 'arc-focus-keep', label: 'Keep your own program' },
  ];
}

function inWindow(x: number, [lo, hi]: [number, number]): boolean {
  return x >= lo && x <= hi;
}

// ---------------------------------------------------------------------------
// A. the circuit offseason arc

/**
 * The offseason program: exit meeting, summer ledger, summer board, the
 * September stakes, the winter block, and the new-year camp countdown.
 * Fires in any circuit phase with no live season; every beat quotes the
 * archive, the training ledger, the board, or the plan - state that
 * survives the fold.
 */
export function offseasonArcCandidates(career: CareerState, out: Candidate[]): void {
  if (!inOffseason(career)) return;
  const me = meOf(career);
  const year = career.clock.year;
  const since = weeksSinceFold(career);

  if (since !== null) {
    // the exit meeting: the season named honestly, the summer assignment set
    const summary = summaryThisYear(career);
    if (summary && inWindow(since, OFF_EXIT_WINDOW)) {
      const target = weakestGroup(me);
      const ppg = summaryPpg(summary);
      const line = ppg !== null ? `${ppg} a game on the year. ` : '';
      out.push({
        thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 62,
        from: career.coach.name, tag: `arc-exit-${year}`,
        variants: [
          `exit meeting, short version. ${summary.w}-${summary.l}, ${summary.finish}. ${line}the summer belongs to ${GROUP_LABEL[target]}. tell me you are taking the assignment`,
          `season file is closed: ${summary.finish}, ${summary.w}-${summary.l}. ${line}my summer note on you has one line and it says ${GROUP_LABEL[target]}. your call`,
          `we ended at ${summary.w}-${summary.l}. ${summary.finish}. ${line}watched your whole year back this week. the gap is ${GROUP_LABEL[target]}. summers decide who starts in the spring`,
          `postseason desk work done. ${summary.finish}. the tape says ${GROUP_LABEL[target]} is where your summer goes. agree or convince me`,
        ],
        choices: focusChoices(target),
      });
    }

    // the summer ledger: training truth since the horn, in real numbers
    if (inWindow(since, OFF_LEDGER_WINDOW)) {
      const foldWeek = career.clock.week - since;
      const landed = fmtDevLine(devSince(career, me, foldWeek));
      const focus = career.weekPlan.focus;
      let variants: string[];
      if (landed) {
        variants = [
          `Summer ledger, ${since} weeks since the horn: ${landed}. The file grows in the quiet months. Keep feeding it`,
          `Checked the development file today. ${landed} since the season closed. Nobody claps for July work, so I am texting you a clap`,
          `${landed}. That is the offseason so far, in writing. The gyms that matter are empty ones`,
        ];
      } else if (groupFinished(me, focus)) {
        const next = nextOpenGroup(me, focus);
        variants = next
          ? [
            `Honest read on the summer: ${GROUP_LABEL[focus]} has nothing left to give you. That drawer is full. ${GROUP_LABEL[next]} is where the file still has blank pages`,
            `The ${GROUP_LABEL[focus]} work has stopped paying and that is not a slump, that is a ceiling. Point the summer at ${GROUP_LABEL[next]} and it starts counting again`,
            `You have maxed what ${GROUP_LABEL[focus]} was ever going to be. No shame in a finished drawer. The open one is ${GROUP_LABEL[next]}`,
          ]
          : [
            `Strange summer read: the sheet is full. Every drawer. From here the job is keeping it, not growing it - legs, film, and showing up`,
            `Development file says there is nothing left to add, anywhere. That is rare air. The work now is maintenance and tape`,
          ];
      } else {
        const slots = career.weekPlan.slots.filter(s => s === 'extraWork' || s === 'film').length;
        variants = [
          `Ledger check, ${since} weeks in: the ${GROUP_LABEL[focus]} bank is filling, nothing landed yet. ${slots} work slots a week says it will. Compounding is boring until it is not`,
          `No new line in the development file yet - the ${GROUP_LABEL[focus]} work banks before it lands. The weekly plan I am looking at gets it there. Stay on it`,
          `Quiet weeks, filling bank. ${GROUP_LABEL[focus]} progress accrues before it prints. The plan holds; hold with it`,
        ];
      }
      out.push({
        thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 55,
        from: agentFrom(career), tag: `arc-led-${year}`, variants,
      });
    }

    // the summer board: what the thirty rooms think while nobody plays
    if (inWindow(since, OFF_BOARD_WINDOW) && career.stock && career.stock.rank !== null) {
      const rank = career.stock.rank;
      const rooms = boardExtremes(career);
      if (rooms) {
        out.push({
          thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 50,
          from: wireBylineOf(career), tag: `arc-brd-${year}`,
          variants: [
            `Summer board check: no games, same number - ${rank}. ${rooms.high}'s room grades him warmest; ${rooms.low} stays the holdout. Offseasons do not move locked boards. Falls do`,
            `The July mock is out and the number next to his name still reads ${rank}. Warmest room in the league: ${rooms.high}. Coldest: ${rooms.low}. The gyms are closed; the arguments are not`,
            `Board note from the quiet months: ${rank}, held. ${rooms.high} believes loudest, ${rooms.low} least. Nothing about that changes until somebody plays a game`,
          ],
        });
      }
    }

    // the September stakes: what the program plans around next
    if (inWindow(since, OFF_SEPT_WINDOW)) {
      const role = ROLE_LABEL[career.coach.role];
      const wrapWeeks = career.params.tick.weeksPerYear - career.clock.week;
      out.push({
        thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 50,
        from: agentFrom(career), tag: `arc-sep-${year}`,
        variants: [
          `Talked to the program this week. They are planning next season around you as the ${role}. The year turns in ${wrapWeeks} weeks; every one of them is yours before it is theirs`,
          `September call with the staff: the plan sheet has you down as the ${role}. Roles written in summer are pencil. The eraser is called training camp`,
          `Word from the program: ${role} is the job they are building around. ${wrapWeeks} weeks until the calendar flips. Arrive as the reason they were right`,
        ],
      });
    }

    // the winter block: the desk checks on the local kid's quiet season
    if (inWindow(since, OFF_BLOCK_WINDOW)) {
      const summary = summaryThisYear(career);
      const gym = career.weekPlan.slots.filter(s => s === 'extraWork' || s === 'film' || s === 'body').length;
      const seasonLine = summary && summary.myLine.gp > 0
        ? `${summary.myLine.pts} points over ${summary.myLine.gp} games last season`
        : 'a season already in the books';
      out.push({
        thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 45,
        from: wireBylineOf(career), tag: `arc-blk-${year}`,
        variants: [
          `Checked in on the offseason, ${since} weeks since the horn: ${gym} work sessions a week, doors closed, ${seasonLine} on the resume. The boring months write the loud ones`,
          `Offseason file: ${since} weeks of gym-rat quiet, ${gym} scheduled sessions a week. ${seasonLine} says the work has been paying for a while`,
          `The quiet-season note: nobody watches ${gym} weekly sessions in an empty gym, which is exactly why they matter. ${seasonLine}; the next number is being built right now`,
        ],
      });
    }
  } else {
    // the new year, before the season builds: the camp countdown
    const week = career.clock.week;
    const start = seasonStartWeek(career);
    const playedThisYear = career.circuitHistory.some(
      s => s.year === year && s.kind === (career.clock.phase as CircuitSummary['kind']),
    );
    if (inWindow(week, OFF_CAMP_WINDOW) && week < start && !playedThisYear) {
      const role = ROLE_LABEL[career.coach.role];
      const weeksOut = start - week;
      out.push({
        thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 60,
        from: career.coach.name, tag: `arc-camp-${year}`,
        variants: [
          `new year. schedule drops in ${weeksOut} weeks and my plan sheet already has you at ${role}. show up in the shape that keeps it there`,
          `camp countdown: ${weeksOut} weeks. the ${role} job is yours to walk in with and yours to lose. first practice sets the tone for forty`,
          `${weeksOut} weeks until the season is real again. i plan rotations in january, not november. you are penciled at ${role}. bring a pen`,
          `happy new year. ${weeksOut} weeks out. everything you did since the horn shows up in the first scrimmage. i will be watching for it`,
        ],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// B. the draftPrep arc (weeks 0-32, before the combine speaks)

/**
 * The pre-draft block: the program, the board spread, the league running
 * underneath, the training wind, and the combine countdown. Every beat
 * reads a fact that exists with the board locked - the measured defect
 * was a projected first pick hearing nothing for thirty weeks precisely
 * BECAUSE nothing moved.
 */
export function draftPrepArcCandidates(career: CareerState, out: Candidate[]): void {
  if (career.clock.phase !== 'draftPrep') return;
  const me = meOf(career);
  const year = career.clock.year;
  const week = career.clock.week;
  const from = agentFrom(career);

  // the program: the block starts, off the last real tape
  if (inWindow(week, DP_PROGRAM_WINDOW)) {
    const last = lastSummary(career);
    const target = weakestGroup(me);
    const tape = last
      ? (summaryPpg(last) !== null
        ? `The last tape says ${summaryPpg(last)} a game, ${last.finish}. `
        : `The last tape says ${last.finish}. `)
      : '';
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 60,
      from, tag: `arc-dp-prog-${year}`,
      variants: [
        `The block starts now. ${tape}Thirty rooms will spend months on that film, so we spend months on what it shows: ${GROUP_LABEL[target]}. I booked the facility. You book the habit`,
        `Pre-draft program, week one. ${tape}Every workout from here answers one question the film keeps asking, and the question is ${GROUP_LABEL[target]}. Take the plan or bring me a better one`,
        `Here is the block: ${tape}we attack ${GROUP_LABEL[target]} until June. Rooms draft answers, not highlights`,
      ],
      choices: focusChoices(target),
    });
  }

  // the board spread: the rooms named, number moved or not
  if (inWindow(week, DP_BOARD_WINDOW) && career.stock) {
    const rank = career.stock.rank;
    const rooms = boardExtremes(career);
    let variants: string[] | null = null;
    if (rank !== null && rooms) {
      variants = [
        `Board spread this month: the consensus holds you at ${rank}. Warmest room, ${rooms.high}. Coldest, ${rooms.low}. Thirty opinions, one number, months of noise left. We work`,
        `Where the rooms actually sit: ${rooms.high} highest on you, ${rooms.low} lowest, market says ${rank}. Spreads close at the combine, not on the phone`,
        `Monthly board read: ${rank} on the ladder. ${rooms.high} would take you early; ${rooms.low} wants proof. Both watch the same block you are in right now`,
      ];
    } else if (rank === null) {
      variants = [
        `Straight board talk: no number next to your name yet. The block is the argument. Undrafted in February means nothing; unready in June means everything`,
        `The boards have not printed you and I am fine with it. Numbers that arrive late arrive earned. The work is the whole case`,
      ];
    }
    if (variants) {
      out.push({
        thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 55,
        from, tag: `arc-dp-brd-${year}`, variants,
      });
    }
  }

  // the league underneath: the season sorting the top of my draft
  if (inWindow(week, DP_RACE_WINDOW)) {
    const worst = standingsWorstFirst(career);
    if (worst.length >= 2) {
      const [a, b] = [worst[0]!, worst[1]!];
      const live = career.league.phase === 'regular' || career.league.phase === 'playin';
      const rank = career.stock?.rank;
      const stake = rank !== null && rank !== undefined && rank <= 5
        ? 'The bottom of that table is a queue for his name'
        : 'The bottom of that table decides which rooms pick where he lands';
      out.push({
        thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 50,
        from: wireBylineOf(career), tag: `arc-dp-race-${year}`,
        variants: live
          ? [
            `Around the league: ${a.name} (${a.w}-${a.l}) and ${b.name} (${b.w}-${b.l}) own the bottom of the standings. ${stake}. Prospects train; franchises jockey`,
            `The other race: ${a.name} at ${a.w}-${a.l}, ${b.name} at ${b.w}-${b.l}, both closer to the first pick than the play-in. ${stake}`,
          ]
          : [
            `The season underneath sorted itself: ${a.name} (${a.w}-${a.l}) and ${b.name} (${b.w}-${b.l}) finished at the floor. ${stake}. June is closer than it reads`,
            `League ledger closed with ${a.name} ${a.w}-${a.l} and ${b.name} ${b.w}-${b.l} at the bottom. ${stake}`,
          ],
      });
    }
  }

  // the second wind: training truth mid-block
  if (inWindow(week, DP_WIND_WINDOW)) {
    const landed = fmtDevLine(devSince(career, me, 0));
    const focus = career.weekPlan.focus;
    let variants: string[];
    if (landed) {
      variants = [
        `Mid-block ledger: ${landed} since the window opened. That is what the rooms will call an improving player, and they pay for the slope, not the point`,
        `The file since week zero reads ${landed}. Half a block left. Slopes sell in June`,
        `Development sheet update: ${landed}. Keep the block boring and the draft gets interesting`,
      ];
    } else if (groupFinished(me, focus)) {
      const next = nextOpenGroup(me, focus);
      variants = next
        ? [
          `Mid-block truth: ${GROUP_LABEL[focus]} is a finished drawer - the work there stopped paying. ${GROUP_LABEL[next]} still has pages. Rooms notice a player who reads his own file right`,
          `Half the block gone and ${GROUP_LABEL[focus]} has given everything it had. That is a ceiling, not a plateau. Point the rest at ${GROUP_LABEL[next]}`,
        ]
        : [
          `Mid-block read: the sheet is full, every drawer. From here the block is about arriving in June exactly as advertised - legs fresh, film sharp`,
          `Nothing left to add anywhere on the sheet, which almost never gets to be said. The rest of the block is maintenance and interviews. Do not get bored; get ready`,
        ];
    } else {
      variants = [
        `Mid-block check: the ${GROUP_LABEL[focus]} bank is filling, nothing printed yet. Half a block is exactly when quitters change plans. We are not quitters`,
        `No new line on the sheet yet - ${GROUP_LABEL[focus]} accrues before it lands. The block holds. June does not care when it printed, only that it did`,
      ];
    }
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 50,
      from, tag: `arc-dp-wind-${year}`, variants,
    });
  }

  // the stretch run: the league's spring, priced against my June
  if (inWindow(week, DP_RUN_WINDOW)) {
    const worst = standingsWorstFirst(career);
    if (worst.length >= 1) {
      const a = worst[0]!;
      const playoffs = career.league.phase === 'playoffs' || career.league.phase === 'lottery'
        || career.league.phase === 'draft';
      out.push({
        thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 45,
        from: wireBylineOf(career), tag: `arc-dp-run-${year}`,
        variants: playoffs
          ? [
            `Sixteen teams are playing for June the loud way. ${a.name} finished ${a.w}-${a.l} and is playing for it the quiet way: ping-pong balls and prospect film. Draft season has functionally begun`,
            `The bracket owns the headlines; the draft owns the buildings that miss it. ${a.name}, ${a.w}-${a.l}, has watched more prospect tape than playoff tape this month`,
          ]
          : [
            `Stretch-run note: ${a.name} sits ${a.w}-${a.l} at the floor of the league, where the scouting departments do their loudest work of the year. The tape they are pulling has a familiar name on it`,
            `Late-season table: ${a.name} at ${a.w}-${a.l} holds the inside track on the first pick. Front offices call it evaluation season. Prospects call it the waiting room`,
          ],
      });
    }
  }

  // the combine countdown: the frame goes public in N weeks
  if (inWindow(week, DP_COMBINE_WINDOW) && career.stock && !career.stock.combineDone) {
    const weeksOut = career.params.tick.combineWeek - week;
    const h = fmtHeight(me.heightIn);
    const ws = fmtHeight(me.wingspanIn);
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 58,
      from, tag: `arc-dp-cmb-${year}`,
      variants: [
        `Combine in ${weeksOut} ${weeksOut === 1 ? 'week' : 'weeks'}. They will measure everything and publish all of it: the ${h}, the ${ws} wingspan, the whole frame. Numbers do not get nervous. Neither do we`,
        `${weeksOut} ${weeksOut === 1 ? 'week' : 'weeks'} to the combine. The tape stops being an argument and the tape measure starts: ${h} with a ${ws} span, on the record for thirty rooms`,
        `Logistics: combine in ${weeksOut} ${weeksOut === 1 ? 'week' : 'weeks'}. Every room gets the same sheet - ${h}, ${ws} reach, the athletic testing. Sleep like it is a game week, because it is`,
      ],
    });
  }
}

// ---------------------------------------------------------------------------
// C. the entry arc (draft night to the first camp grades)

/** The week the draft transaction landed, off my own event log (the 'drafted:' event is the entry receipt). Null before entry. */
function weeksSinceDraft(career: CareerState): number | null {
  for (let i = career.events.length - 1; i >= 0; i--) {
    const e = career.events[i]!;
    if (e.kind === 'transaction' && e.reason.startsWith('drafted:')) {
      return absWeek(career, career.clock) - absWeek(career, e.clock);
    }
  }
  return null;
}

/**
 * The rookie summer: the paper, the package, the room, the camp door.
 * The measured gap is the league's own offseason (draft -> moratorium ->
 * freeAgency -> camp) lived as an NBA career week with no games to grade;
 * what exists instead is the realest state of all - the contract, the
 * coach, the depth chart.
 */
export function entryArcCandidates(career: CareerState, out: Candidate[]): void {
  if (career.clock.phase !== 'nba' || !career.nbaTeam) return;
  const wsd = weeksSinceDraft(career);
  if (wsd === null || wsd < 1) return;
  const me = career.league.players[career.me];
  const team = career.league.teams[career.nbaTeam];
  if (!me || !team) return;
  const year = career.clock.year;

  // the paper: the rookie scale, in real dollars
  if (inWindow(wsd, NBA_PAPER_WINDOW) && me.contract && me.contract.years.length > 0) {
    const c = me.contract;
    const first = c.years[0]!;
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 60,
      from: agentFrom(career), tag: `arc-nba-ppr-${year}`,
      refs: { teamId: career.nbaTeam },
      variants: [
        `Paper is done. ${c.years.length} years on the rookie scale, ${fmtMoney(first.salary)} in year one. The slot sets the number; everything after this deal, you set. Frame the first stub`,
        `Signed and filed: ${c.years.length}-year rookie deal, ${fmtMoney(first.salary)} to start. Scale money is the league betting on the pick. The second contract is the league betting on the player`,
        `The rookie scale is official - ${fmtMoney(first.salary)} for year one of ${c.years.length}. Do not spend it like a veteran. Play like the number was an insult`,
      ],
    });
  }

  // the package: the real NBA coach sets the summer assignment
  if (inWindow(wsd, NBA_PACKAGE_WINDOW) && career.coach.name === team.coach.name) {
    const target = weakestGroup(me);
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 60,
      from: career.coach.name, tag: `arc-nba-pkg-${year}`,
      variants: [
        `summer package, rook. watched your file twice. this league will attack ${GROUP_LABEL[target]} until you fix it. fix it before it has a highlight reel`,
        `your summer assignment is ${GROUP_LABEL[target]}. every rookie gets one. the ones who take it seriously are the ones i still know in five years`,
        `welcome package: gym code, film login, and one job - ${GROUP_LABEL[target]}. camp is soon and camp does not grade on a curve`,
      ],
      choices: focusChoices(target),
    });
  }

  // the room: the depth chart named, by the money at my spot
  if (inWindow(wsd, NBA_ROOM_WINDOW)) {
    const mates = team.roster
      .filter(pid => pid !== career.me)
      .map(pid => career.league.players[pid])
      .filter((p): p is FrPlayer => Boolean(p && p.pos === me.pos))
      .sort((a, b) => {
        const sa = a.contract?.years[0]?.salary ?? 0;
        const sb = b.contract?.years[0]?.salary ?? 0;
        return sb - sa || (a.id < b.id ? -1 : 1);
      });
    if (mates.length > 0) {
      const names = mates.slice(0, 2).map(p => p.name).join(' and ');
      out.push({
        thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 55,
        from: agentFrom(career), tag: `arc-nba-room-${year}`,
        refs: { players: mates.slice(0, 2).map(p => p.id) },
        variants: [
          `Scouted your own locker room today: ${names} at your spot, both ahead of you on the payroll. Camp decides what the payroll cannot. That is the whole opportunity`,
          `The room at your position reads ${names}. Money says they are ahead. Minutes have never once asked the money. Take them in camp`,
          `Depth chart homework: ${names} play where you play. Learn everything they know, then beat them with it. Rookies who study the room own it fastest`,
        ],
      });
    }
  }

  // the camp door: the season gets real
  if (career.league.phase === 'camp' && wsd <= NBA_CAMP_MAX_WEEKS_SINCE_DRAFT) {
    const role = ROLE_LABEL[career.coach.role];
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 62,
      from: career.coach.name, tag: 'arc-nba-camp',
      variants: [
        `camp opens. the summer is graded and filed. you are penciled at ${role} and everything from here is tape. first drill sets your reputation. be early`,
        `doors open monday, rook. ${role} is the pencil mark next to your name. camp owns the pen. sleep, hydrate, show up violent`,
        `camp week. i do not care what the mocks said in june. the ${role} line on my sheet is written in sweat from here. bring yours`,
      ],
    });
  }
}
