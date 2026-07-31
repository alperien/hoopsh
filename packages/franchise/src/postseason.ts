/**
 * postseason.ts — play-in, bracket, series state, lottery. OWNER: schedule
 * task. STATUS: STAGED stub; signatures frozen.
 */
import type { Rng } from '@hoopsh/engine';
import type { League, LotteryResult, PlayoffSeries, ScheduledGame } from './types.js';

/** Called at the last regular-season day: build the play-in slate. */
export function buildPlayin(league: League): ScheduledGame[] {
  throw new Error('franchise/postseason: not implemented (schedule task lands this)');
}

/** Advance postseason state after a day's results; schedules next games. */
export function advancePostseason(league: League): ScheduledGame[] {
  throw new Error('franchise/postseason: not implemented (schedule task lands this)');
}

export function buildFirstRound(league: League): PlayoffSeries[] {
  throw new Error('franchise/postseason: not implemented (schedule task lands this)');
}

/** The lottery drawing (real odds table from params.schedule.lotteryOdds). */
export function runLottery(league: League, rng: Rng): LotteryResult {
  throw new Error('franchise/postseason: not implemented (schedule task lands this)');
}
