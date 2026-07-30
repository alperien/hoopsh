/**
 * Type declarations for parse-nba.mjs — hand-maintained (the runtime is
 * type-stripped Node with no build step, so nothing generates these; see
 * tsconfig.json's paths comment for the typecheck-gate context). Declares
 * every export of the .mjs; keep the two files in sync in the same commit.
 * CLI-only surface (flag parsing, corpus aggregation/writing, main) is
 * unexported there and so has no declaration here.
 */

/** One parsed play row — the tuple schema of the committed shards, objectified. */
export interface PbpPlay {
  /** Period: 1-4 regulation quarters, >= 5 are 300s overtime periods. */
  q: number;
  /** Game clock remaining in the period, whole seconds (bbref tenths dropped). */
  clockSec: number;
  /** Column the row sat in: the acting team for plays, null for neutral rows. */
  side: 'away' | 'home' | null;
  /** bbref's own play text, tags stripped. */
  text: string;
  /** Away score after the row. */
  a: number;
  /** Home score after the row. */
  h: number;
}

/** pbp table HTML -> play rows. Throws when the table is missing or suspiciously short. */
export function extractPlays(html: string, id: string): PbpPlay[];

/** Scorebox HTML -> teams, final, date. Throws on parse failure or a home/game-id mismatch. */
export function extractGameMeta(html: string, id: string): {
  away: string;
  home: string;
  boxFinal: number[];
  date: string;
};

/**
 * Three-way score validation (see the function header in parse-nba.mjs) plus
 * the advisory clock-sanity count. `clockJumps` never affects `ok`.
 */
export function validateGame(plays: PbpPlay[], boxFinal: readonly number[]): {
  ok: boolean;
  scoreboardFinal: number[];
  textFinal: number[];
  boxFinal: readonly number[];
  mismatches: number;
  clockJumps: number;
};

/** Game-flow metrics (mirrors harness/src/flow.ts operational definitions). */
export function flowMetrics(plays: PbpPlay[]): {
  leadChanges: number;
  ties: number;
  largestLead: number;
  runs8: number;
  runs10: number;
  maxRun: number;
  maxDroughtSec: number;
  qPts: number[];
  clutchPts: number;
  clutchFTPts: number;
  clutchShare: number | null;
  led10InQ4: boolean;
  led10Lost: boolean;
  finalMargin: number;
};

/** Event-grammar counts (putbacks, steal conversions, strict and-ones, …). */
export function grammarMetrics(plays: PbpPlay[]): {
  orebPlayer: number;
  orebAll: number;
  putback6: number;
  putback6Legacy: number;
  putback6LegacyDen: number;
  steals: number;
  stealScore6: number;
  stealScore6Legacy: number;
  andOnes: number;
};

/**
 * Possession segmentation. `lens` excludes zero-length possessions (b7-F5
 * basis quirk documented at the implementation); `secondChance` counts
 * possessions with >= 1 LIVE offensive rebound (dead-ball team-rebound
 * bookkeeping never marks — release-audit H-06).
 */
export function possessionMetrics(plays: PbpPlay[]): {
  lens: number[];
  secondChance: number;
  n: number;
};
