/**
 * packs.ts - the rule packs circuits play under. Rule packs are data by
 * engine design (rules/rulepack.ts), so career-mode leagues define their
 * own literals here without touching the engine. NCAA re-exports the
 * engine's own pack; the rest follow real rule books with the same known
 * simplifications the engine's NCAA pack documents (which fouls count is
 * code, not data; media timeouts unmodeled). Structural values are REAL
 * rule-book numbers; none of these packs is statistically calibrated yet
 * (docs/CAREER.md register C9, the NCAA pack's own standing today).
 */

import { EUROLEAGUE, NBA, NCAA } from '@hoopsh/engine';
import type { RulePack } from '@hoopsh/engine';
import type { CareerPacks } from './types.js';

/**
 * US high school (NFHS rules, the shape most states play):
 * 4x8-minute quarters on a HS court, no NBA-depth three-point line, 35s
 * shot clock (adopted state by state through the 2020s; we play WITH a
 * clock so possessions terminate), one-and-one bonus at 7 with double
 * bonus at 10, five fouls out.
 */
export const PREP: RulePack = {
  ...NBA,
  id: 'prep',
  name: 'High school (NFHS)',
  // 84x50: the standard US high school court (10 ft shorter than pro).
  courtLengthFt: 84,
  courtWidthFt: 50,
  rimInsetFt: 5.25,
  keyWidthFt: 12,
  ftLineFt: 19,
  // 19.75 ft flat-radius HS arc; corner distance equals the arc (the HS
  // line is a constant radius, no straightened corner), break tiny.
  three: { arcRadiusFt: 19.75, cornerDistFt: 19.75, cornerBreakFt: 5 },
  periods: 4,
  periodMinutes: 8,
  otMinutes: 4,
  shotClockSec: 35,
  shotClockOffRebSec: 20,
  teamFoulBonusAt: 7,
  bonusRule: 'oneAndOne',
  doubleBonusAt: 10,
  bonusFreeThrows: 2,
  teamFoulsCarryToOT: true,
  foulOutAt: 5,
  timeoutsPerGame: 5,
  advanceAfterTimeout: false,
};

/**
 * FIBA senior rules for the European circuit: 4x10 quarters, the FIBA
 * 6.75 m arc (22.15 ft, 21.65 corner), 24s clock, bonus at 5 with flat
 * two shots, five fouls out. The engine ships a EUROLEAGUE stub already;
 * this re-export keeps circuit code on one import path.
 */
export const FIBA: RulePack = { ...EUROLEAGUE, id: 'fiba', name: 'FIBA (Euro club)' };

/**
 * Australia's NBL plays FIBA rules with local flavor the pack cannot
 * express (no structural differences at our modeling depth): same
 * literal, distinct id so circuit texture and news can tell them apart.
 */
export const NBL: RulePack = { ...EUROLEAGUE, id: 'nbl', name: 'NBL (Australia)' };

/**
 * The Chinese league also plays FIBA-shaped rules; the scoring-friendly
 * texture comes from roster quality and pace tendencies, not the pack.
 */
export const CBA_CHINA: RulePack = { ...EUROLEAGUE, id: 'cba', name: 'CBA (China)' };

export const PACKS: CareerPacks = {
  prep: PREP,
  ncaa: NCAA,
  fiba: FIBA,
  nbl: NBL,
  cba: CBA_CHINA,
};
