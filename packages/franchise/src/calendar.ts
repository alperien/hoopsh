/**
 * calendar.ts - the season calendar and phase machine. OWNER: spine task.
 *
 * The calendar is the season's fixed scaffold: one CalendarDay per league
 * day, camp through the end of free agency, built deterministically from
 * (params, season) with no RNG. It carries PLANNED phases and marked ritual
 * days; league.phase itself is owned by tick.ts, which follows this scaffold
 * but transitions on real outcomes (a finals sweep moves the league to
 * 'lottery' while the calendar still shows unused playoff window days --
 * the lottery ceremony then waits for its marked night).
 *
 * Layout, in order (docs/FRANCHISE.md §8):
 *   camp            params.calendar.campDays. Preseason friendlies live on
 *                   schedule rows inside this window (the marks vocabulary
 *                   in types.ts has no preseason mark by design: preseason
 *                   days are ordinary camp days whose games the schedule
 *                   generator places).
 *   regular         params.calendar.regularSeasonDays, with marks:
 *                   seasonOpener (first day), tradeDeadline, allStar (the
 *                   break's first day; the break spans ALL_STAR_BREAK_DAYS
 *                   game-free days that the schedule generator leaves
 *                   empty), lastRegularDay (final day).
 *   playin          PLAYIN_DAYS days.
 *   playoffs        PLAYOFF_WINDOW_DAYS days. Actual series games are
 *                   scheduled dynamically by postseason.advancePostseason;
 *                   the calendar only reserves the window and carries a
 *                   nominal finalsStart mark for display.
 *   lottery         1 day, marked lotteryNight.
 *   draft           LOTTERY_TO_DRAFT_DEAD_DAYS dead days + draft night
 *                   (marked draftNight). The dead days already carry phase
 *                   'draft' because tick.ts flips league.phase to 'draft'
 *                   the moment the lottery resolves; the 'offseason' Phase
 *                   value stays reserved for saves/UI and is never produced
 *                   by this builder (the dead gaps fold into their adjacent
 *                   ritual phases).
 *   moratorium      DRAFT_TO_MORATORIUM_DEAD_DAYS dead days + the real
 *                   MORATORIUM_DAYS moratorium, marked moratoriumEnds on
 *                   its last day.
 *   freeAgency      params.calendar.offseasonDays; the last calendar day is
 *                   the rollover trigger. The real league's dead August and
 *                   September compress into the rollover itself (the quiet
 *                   period fast-forwards, docs/FRANCHISE.md §8).
 *
 * Labels are real month/day arithmetic from a fixed anchor: the season
 * opener sits on Oct 21 of the season year (real openers cluster in the
 * third week of October), and every other day counts forward or back from
 * it through non-leap month lengths. Leap years are deliberately ignored:
 * the league's years are fictional, and a Feb 29 that exists in some
 * seasons and not others would buy no realism for the bookkeeping cost.
 */
import type { CalendarDay, League, LeagueDate, Phase, Season } from './types.js';
import type { FranchiseParams } from './params.js';

// Window lengths not in FranchiseParams.calendar: these are calendar
// STRUCTURE (the shape of the league year), not sweepable behavior levers,
// so they live here with provenance rather than in the frozen params shape.
const PLAYIN_DAYS = 4;                  // REAL: the play-in runs four nights (Tue-Fri)
const PLAYOFF_WINDOW_DAYS = 60;         // REAL-ish: mid-April through mid-June
const FINALS_NOMINAL_OFFSET = 46;       // FEEL: nominal finals-open day inside the window, display only
const LOTTERY_TO_DRAFT_DEAD_DAYS = 3;   // FEEL: compressed lottery-to-draft gap (real is ~5 weeks)
const DRAFT_TO_MORATORIUM_DEAD_DAYS = 4;// FEEL: compressed draft-to-July-1 gap
const MORATORIUM_DAYS = 6;              // REAL: the July moratorium runs about six days (Jul 1-6)
const ALL_STAR_BREAK_DAYS = 4;          // REAL: the all-star break is a 4-day game gap; the schedule generator honors it

// Fictional-calendar arithmetic. Non-leap month lengths; see file header
// for why leap years are ignored.
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // REAL: Jan..Dec, non-leap
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// 0-based day-of-year of Oct 21 (293 = Jan..Sep = 273 days, + 20): the
// season-opener anchor. REAL-ish: NBA openers cluster around Oct 21.
const OPENER_DAY_OF_YEAR = 293;
const DAYS_PER_YEAR = 365; // REAL non-leap year; leap days ignored (see header)

/**
 * Display label for a calendar day: 'Tue, Oct 21' style. Pure arithmetic,
 * no Date object (determinism law). `calendarDay` counts from day 0 of the
 * season; the opener (calendarDay === campDays) lands on Oct 21 of the
 * season year, so camp counts backward from there and the offseason spills
 * into the following calendar year naturally.
 *
 * Weekdays advance one step per fictional year (365 mod 7 = 1), the same
 * drift real years have; the zero offset is chosen so the 2026 opener reads
 * as a Tuesday, matching the real league's traditional opening night.
 */
function dayLabel(season: Season, calendarDay: number, campDays: number): string {
  const absolute = OPENER_DAY_OF_YEAR - campDays + calendarDay;
  // ((x % n) + n) % n keeps the day-of-year positive even if a huge camp
  // window ever pushed day 0 into the previous calendar year.
  const doy = ((absolute % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const weekday = WEEKDAY_NAMES[(((season * DAYS_PER_YEAR + absolute) % 7) + 7) % 7]!;
  let m = 0;
  let rem = doy;
  while (rem >= MONTH_LENGTHS[m]!) {
    rem -= MONTH_LENGTHS[m]!;
    m += 1;
  }
  return `${weekday}, ${MONTH_NAMES[m]} ${rem + 1}`;
}

/**
 * Build the full deterministic calendar for a season (camp through the end
 * of free agency). Called by tick.ts at lazy init and at every season
 * rollover. Throws on a params shape that cannot produce a coherent season
 * (marks outside the regular window) -- a mis-set calendar is a config
 * error that must fail loudly, not a playable league.
 */
export function buildSeasonCalendar(params: FranchiseParams, season: Season): CalendarDay[] {
  const cal = params.calendar;
  const regularStart = cal.campDays;
  const lastRegular = cal.campDays + cal.regularSeasonDays - 1;
  if (cal.tradeDeadlineDayIndex < regularStart || cal.tradeDeadlineDayIndex > lastRegular) {
    throw new Error(`buildSeasonCalendar: tradeDeadlineDayIndex ${cal.tradeDeadlineDayIndex} outside the regular season [${regularStart}, ${lastRegular}]`);
  }
  if (cal.allStarDayIndex < regularStart || cal.allStarDayIndex + ALL_STAR_BREAK_DAYS > lastRegular) {
    throw new Error(`buildSeasonCalendar: allStarDayIndex ${cal.allStarDayIndex} does not leave room for the ${ALL_STAR_BREAK_DAYS}-day break inside the regular season`);
  }

  const days: CalendarDay[] = [];
  const push = (phase: Phase, marks: CalendarDay['marks'] = []): void => {
    days.push({ day: days.length, phase, label: dayLabel(season, days.length, cal.campDays), marks });
  };

  for (let i = 0; i < cal.campDays; i++) push('camp');

  for (let i = 0; i < cal.regularSeasonDays; i++) {
    const marks: CalendarDay['marks'] = [];
    const idx = days.length;
    if (i === 0) marks.push('seasonOpener');
    if (idx === cal.tradeDeadlineDayIndex) marks.push('tradeDeadline');
    if (idx === cal.allStarDayIndex) marks.push('allStar');
    if (i === cal.regularSeasonDays - 1) marks.push('lastRegularDay');
    push('regular', marks);
  }

  for (let i = 0; i < PLAYIN_DAYS; i++) push('playin');

  for (let i = 0; i < PLAYOFF_WINDOW_DAYS; i++) {
    push('playoffs', i === FINALS_NOMINAL_OFFSET ? ['finalsStart'] : []);
  }

  push('lottery', ['lotteryNight']);

  for (let i = 0; i < LOTTERY_TO_DRAFT_DEAD_DAYS; i++) push('draft');
  push('draft', ['draftNight']);

  for (let i = 0; i < DRAFT_TO_MORATORIUM_DEAD_DAYS + MORATORIUM_DAYS; i++) {
    const isLast = i === DRAFT_TO_MORATORIUM_DEAD_DAYS + MORATORIUM_DAYS - 1;
    push('moratorium', isLast ? ['moratoriumEnds'] : []);
  }

  for (let i = 0; i < cal.offseasonDays; i++) push('freeAgency');

  return days;
}

/** The league's current date. */
export function currentDate(league: League): LeagueDate {
  return { season: league.season, day: league.day };
}

/**
 * Planned phase for an arbitrary day of a calendar, clamped: days before
 * day 0 read as the first day, days past the end as the last (callers may
 * probe "tomorrow" on the final day without guarding). An empty calendar
 * (a league before its lazy init, see tick.ts) reads as 'camp', the phase
 * every season opens in.
 */
export function phaseOn(calendar: CalendarDay[], day: number): Phase {
  if (calendar.length === 0) return 'camp';
  const clamped = Math.min(Math.max(day, 0), calendar.length - 1);
  return calendar[clamped]!.phase;
}
