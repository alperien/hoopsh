/**
 * Old saves must keep loading when params grow new keys (#184).
 *
 * The loader's formatVersion check is STRICT equality, so a version
 * bump refuses every existing save on disk. The additive-params
 * contract instead: loadLeague and loadCareer run loaded params
 * through withFranchiseParams, so keys that did not exist when the
 * save was written fill from today's defaults while every value the
 * save carries wins. This battery doctors a fresh save into the
 * pre-#184 shape (the six wire-cadence keys deleted) and proves it
 * loads, keeps its own values, and gains working defaults - and that
 * a genuinely foreign formatVersion still refuses.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLeague, defaultFranchiseParams } from '@hoopsh/franchise';
import { loadLeague, saveLeague, savesDir } from '../src/saves.js';

// unique name: a regression must produce gitignored debris, never
// clobber a real save (the save-guard.test.ts convention)
const SAVE_NAME = 'test-save-format-v1params';
const file = (): string => path.join(savesDir(), `${SAVE_NAME}.json`);

// exactly what a pre-#184 save lacks: the grown params.trade keys
const GROWN_KEYS = [
  'regularAttempts', 'deadlineAttempts', 'deadlineFloorTrades',
  'deadlineFloorDays', 'deadlineDayMaxTrades', 'userOfferPulse',
] as const;

describe('additive params keys fill on load', () => {
  it('a save missing the #184 dials loads; saved values win, grown keys default', () => {
    const league = createLeague({ seed: 'save-format-1', userTeam: 'nye' });
    league.params.trade.fleeceFloor = -0.123; // a customized value the fill must not clobber
    league.params.trade.deadlinePulse = 0.09; // the pre-#184 cadence: the save's own world constant
    saveLeague(league, SAVE_NAME);
    try {
      const raw = JSON.parse(readFileSync(file(), 'utf8')) as {
        formatVersion: number;
        league: { params: { trade: Record<string, number> } };
      };
      expect(raw.formatVersion).toBe(1); // additive keys are NOT a format bump
      for (const key of GROWN_KEYS) delete raw.league.params.trade[key];
      writeFileSync(file(), JSON.stringify(raw));

      const loaded = loadLeague(SAVE_NAME);
      const def = defaultFranchiseParams();
      for (const key of GROWN_KEYS) {
        expect(loaded.params.trade[key]).toBe(def.trade[key]); // grown keys fill from defaults
      }
      expect(loaded.params.trade.fleeceFloor).toBe(-0.123); // saved values win
      expect(loaded.params.trade.deadlinePulse).toBe(0.09); // even where today's default moved
    } finally {
      rmSync(file(), { force: true });
    }
  });

  it('a genuinely foreign formatVersion still refuses: bumps stay meaningful', () => {
    const league = createLeague({ seed: 'save-format-2', userTeam: 'nye' });
    saveLeague(league, SAVE_NAME);
    try {
      const raw = JSON.parse(readFileSync(file(), 'utf8')) as { formatVersion: number };
      raw.formatVersion = 99;
      writeFileSync(file(), JSON.stringify(raw));
      expect(() => loadLeague(SAVE_NAME)).toThrow(/format 99/);
    } finally {
      rmSync(file(), { force: true });
    }
  });
});
