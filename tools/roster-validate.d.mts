/**
 * Type declarations for roster-validate.mjs, hand-maintained (the runtime
 * is type-stripped Node with no build step, so nothing generates these; see
 * tsconfig.json's paths comment for the typecheck-gate context). Declares
 * every export of the .mjs; keep the two files in sync in the same commit.
 * CLI-only surface (report printing, main) is unexported there and so has no
 * declaration here.
 */

import type { TeamPack, ValidationIssue } from '@hoopsh/data';

/**
 * Fetch the value a JSONPath-style issue points at (e.g.
 * "$.team.players[3].attr.three"). Tolerant by design: missing segments
 * yield undefined, because it walks packs that just FAILED validation.
 */
export function getAtPath(obj: unknown, jsonPath: string): unknown;

/** A ValidationIssue enriched with the human-grade context the CLI prints. */
export interface ExplainedIssue extends ValidationIssue {
  /** What the pack actually says at `path` ("missing" when absent). */
  current: string;
  /** The legal range/shape, when the issue pattern is recognized. */
  legal?: string;
  /** A concrete edit that resolves the issue, when recognized. */
  fix?: string;
}

/**
 * Enrich one validateTeamPack() issue with { current, legal, fix }.
 * Pattern-matched on the validator's message/path text; unrecognized issues
 * pass through with just the raw path+message (never hidden). `pack` is the
 * raw parsed JSON, possibly null when the file wasn't JSON at all.
 */
export function explainIssue(pack: unknown, issue: ValidationIssue): ExplainedIssue;

/** One basketball-plausibility warning for a pack that loads fine. */
export interface RosterWarning {
  /** Stable heuristic id, e.g. "no-rim-protection". */
  code: string;
  /** What the warning is about (player, "starting five", "whole roster", …). */
  where: string;
  /** The measured numbers that tripped the heuristic. */
  detail: string;
  /** The basketball reasoning, stated so an author can knowingly ignore it. */
  why: string;
}

/**
 * Plausibility heuristics for VALID packs: legal numbers that will play
 * nothing like a real team. Call only after validation passes: it reads
 * team.players/starters/tend directly and assumes the pack shape holds.
 */
export function computeWarnings(pack: TeamPack): RosterWarning[];
