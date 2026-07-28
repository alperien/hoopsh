/**
 * Type declarations for roster-new.mjs, hand-maintained (the runtime is
 * type-stripped Node with no build step, so nothing generates these; see
 * tsconfig.json's paths comment for the typecheck-gate context). Declares
 * every export of the .mjs; keep the two files in sync in the same commit.
 * CLI-only surface (the wizard, flag parsing, main) is unexported there and
 * so has no declaration here.
 */

import type { Player, Tactics } from '@hoopsh/engine';
import type { TeamPack } from '@hoopsh/data';

/** One scaffold-menu row: the REAL @hoopsh/data builder + an editorial pitch. */
export interface ArchetypeEntry {
  /** Archetype builder: seeds a full 38-dial Player from just an identity. */
  fn: (who: { id: string; name: string }) => Player;
  /** What the archetype is FOR (display text); the numbers live in @hoopsh/data. */
  blurb: string;
}

/**
 * The scaffold menu: slug -> builder + blurb, in wizard display order
 * (starters first). A registry test discovers every archetype-shaped export
 * in @hoopsh/data and fails if one is missing from this menu.
 */
export const ARCHETYPES: {
  floorGeneral: ArchetypeEntry;
  eliteShooter: ArchetypeEntry;
  scoringWing: ArchetypeEntry;
  threeAndD: ArchetypeEntry;
  comboGuard: ArchetypeEntry;
  glueForward: ArchetypeEntry;
  postAnchor: ArchetypeEntry;
  stretchBig: ArchetypeEntry;
  rimRunner: ArchetypeEntry;
  benchScorer: ArchetypeEntry;
  benchBig: ArchetypeEntry;
};

/** A key of the scaffold menu: the only slugs buildRoster accepts at runtime. */
export type ArchetypeSlug = keyof typeof ARCHETYPES;

/**
 * Default archetype cycle for an N-player roster: balanced starting five,
 * then bench priorities, sliced to the requested size. Throws unless N is a
 * whole number within [MIN_PLAYERS, 15].
 */
export function defaultSlots(n: number): ArchetypeSlug[];

/** Slugify a team name for ids/filenames: "Oak City Owls" -> "oak-city-owls". */
export function slugify(name: string): string;

/** Scaffold options for buildRoster. */
export interface RosterOptions {
  /** Team display name. */
  name: string;
  /** Scoreboard tag, e.g. "OWL". */
  abbrev: string;
  /** Team id; defaults to slugify(name). */
  id?: string;
  /**
   * Archetype slug per player; the first STARTERS_COUNT start. Typed as
   * string[] (not ArchetypeSlug[]) because the runtime contract is "any
   * string, unknown slugs throw with the valid menu"; tests exercise that
   * error path deliberately.
   */
  slots: string[];
  /** Overrides merged over the neutral { pace: 50, threeBias: 50, helpAggr: 50 }. */
  tactics?: Partial<Tactics>;
}

/**
 * Build a complete, validated TeamPack from scaffold options (pure, no
 * I/O). Throws on unknown archetype slugs, and throws if the generated pack
 * would not satisfy validateTeamPack(): a scaffold that can emit an invalid
 * pack is a bug in roster-new.mjs, never something handed to the user.
 */
export function buildRoster(opts: RosterOptions): TeamPack;

/**
 * Pack -> on-disk JSON text, with the editor "$schema" pointer (relative
 * path from outFile to the committed schema) injected as the first key.
 */
export function packText(pack: TeamPack, outFile: string): string;
