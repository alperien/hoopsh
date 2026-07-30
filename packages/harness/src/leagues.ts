/**
 * League selection for the harness: one id ('nba' | 'ncaa') resolves to the
 * rule pack, the acceptance bands, and the pace-normalization basis that must
 * always travel TOGETHER. The trap this module exists to prevent: mixing NBA
 * bands with the NCAA rule pack (a meaningless comparison — see
 * data/ncaa/README.md §6.3), or reporting a 40-minute game's pace on the
 * 48-minute basis (§5's pace-normalization warning: a real ~68 poss/40 NCAA
 * game would read ≈81.6 and look absurdly fast against a poss/40 band).
 *
 * Naming note: league.ts (singular) is the deterministic fictional-league
 * GENERATOR for the season driver — unrelated. This module is league
 * CONFIGURATION.
 *
 * NCAA bands load at resolve time from data/ncaa/acceptance-bands.json — the
 * research deliverable itself (with per-band provenance), not a hand-copied
 * duplicate that could drift. Only the Band fields the report machinery
 * reads (metric/label/lo/hi/pct) are lifted; provenance stays in the JSON.
 * The pace band is used in its real-world poss/40 convention (lo 66/hi 71)
 * because the pipeline passes paceMinutes to boxScore — option (a) of the
 * JSON's paceNormalizationWarning; its paceOn48MinBasis alternative is for
 * pipelines that DON'T normalize, and using both would double-correct.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NBA, NCAA, type RulePack } from '@hoopsh/engine';
import { NBA_BANDS, type Band } from './bands.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NCAA_BANDS_PATH = path.resolve(HERE, '..', '..', '..', 'data', 'ncaa', 'acceptance-bands.json');

export interface LeagueConfig {
  id: string;
  /** display name for report headers */
  name: string;
  rules: RulePack;
  bands: Band[];
  /** pace basis = the league's regulation minutes (rules.periods × rules.periodMinutes), fed to boxScore's paceMinutes */
  paceMinutes: number;
  /**
   * Whether the engine has actually been calibrated against these bands.
   * NBA: yes — the ratchet gate applies. NCAA: no — the pack is structurally
   * correct but every probability model is still NBA-fit, so batch reports
   * are measurement, not acceptance (cli.ts keeps the gate off by default).
   */
  calibrated: boolean;
}

/** Shape of one entry in data/ncaa/acceptance-bands.json's `bands` array (extra provenance fields tolerated and ignored). */
interface BandsJsonEntry {
  metric?: unknown; label?: unknown; lo?: unknown; hi?: unknown; pct?: unknown;
}

/**
 * Load the proposed NCAA bands from the research deliverable. Loud on any
 * malformed entry (args.ts's silent-corruption doctrine): a band with a
 * missing bound would otherwise fail every run as NaN with no hint why.
 */
export function loadNcaaBands(jsonPath: string = NCAA_BANDS_PATH): Band[] {
  let raw: string;
  try {
    raw = readFileSync(jsonPath, 'utf8');
  } catch (err) {
    // carry the real cause (audit L-44): this catch used to report EVERY
    // read failure as "not found" — a permissions error or a directory at
    // the path sent the reader hunting for a file that was right there
    throw new Error(
      `NCAA bands file could not be read at ${jsonPath} (${(err as Error).message}) — ` +
      'expected the data/ncaa research deliverable'
    );
  }
  const doc = JSON.parse(raw) as { bands?: BandsJsonEntry[] };
  if (!Array.isArray(doc.bands) || doc.bands.length === 0) {
    throw new Error(`${jsonPath}: expected a non-empty "bands" array`);
  }
  return doc.bands.map((b, i) => {
    if (typeof b.metric !== 'string' || typeof b.label !== 'string' ||
        typeof b.lo !== 'number' || !Number.isFinite(b.lo) ||
        typeof b.hi !== 'number' || !Number.isFinite(b.hi) || b.lo > b.hi) {
      throw new Error(`${jsonPath}: bands[${i}] is malformed (need string metric/label and finite lo <= hi)`);
    }
    return {
      metric: b.metric,
      label: b.label,
      lo: b.lo,
      hi: b.hi,
      ...(b.pct === true ? { pct: true } : {})
    };
  });
}

export const LEAGUE_IDS = ['nba', 'ncaa'] as const;

/**
 * Resolve a --league flag value into the config triple. Throws (loudly, with
 * the valid ids) on anything else — a typo'd league must never silently run
 * as the NBA default. EuroLeague has a rule pack but no acceptance bands
 * yet, so it is deliberately NOT resolvable here until someone does the
 * band research the NCAA got.
 */
export function resolveLeague(id: string): LeagueConfig {
  if (id === 'nba') {
    return {
      id, name: NBA.name, rules: NBA, bands: NBA_BANDS,
      paceMinutes: NBA.periods * NBA.periodMinutes, // 48
      calibrated: true
    };
  }
  if (id === 'ncaa') {
    return {
      id, name: NCAA.name, rules: NCAA, bands: loadNcaaBands(),
      paceMinutes: NCAA.periods * NCAA.periodMinutes, // 40
      calibrated: false
    };
  }
  throw new Error(`unknown league "${id}" (valid: ${LEAGUE_IDS.join(', ')})`);
}
