// @hoopsh/narration — the broadcast layer: template play-by-play with
// game-context awareness, plus the pluggable color-commentary seam
// (CommentaryProvider) for LLM or custom providers.
//
// Start here: `buildBroadcastScript(events, teams, provider, opts?)` →
// `BroadcastCue[]` — feed it a game's event stream and a provider
// (TemplateColorProvider works out of the box); see provider.ts for the
// async-and-stateless provider contract.
//
// Package barrel: re-exports the narration public surface (play-by-play,
// narrative-context tracking, commentary providers, broadcast-script
// assembly). Maintained template layer (docs/INTERNALS.md "Consumers" note,
// ARCHITECTURE.md §6; the frozen prototype is the VIEWER — audit L-33) —
// see the header comments in pbp.ts/context.ts/provider.ts/broadcast.ts for
// what each piece does; the engine never imports from this package
// (AGENTS.md §1.3/§6).
export { generatePlayByPlay, makeLookup } from './pbp.js';
export type { NarrationLine } from './pbp.js';
export { ContextTracker } from './context.js';
export type { NarrativeMoment } from './context.js';
export { TemplateColorProvider } from './provider.js';
export type { CommentaryProvider, CommentaryWindow, ColorLine } from './provider.js';
export { buildBroadcastScript, formatScript } from './broadcast.js';
export type { BroadcastCue } from './broadcast.js';
export { shotCall, distPhrase } from './shotcall.js';
export type { ShotCall, ShotLike, ShooterTraits } from './shotcall.js';

/**
 * Named form of `buildBroadcastScript()`'s optional `opts` parameter (the
 * signature keeps it inline; this alias exists so consumers can type their
 * own options objects). `seed` keys the provider's deterministic choices,
 * `windowEvents` sets the commentary-window size, `periods` is the
 * regulation period count (default 4 — pass the rule pack's value when
 * simulating non-NBA formats so period labels stay right).
 */
export interface BroadcastOptions {
  seed?: string;
  windowEvents?: number;
  periods?: number;
}

// ---- the booth (production layer) ----
// Two-voice broadcast pipeline: sense.ts (running truth) → beats.ts (what is
// worth saying) → booth.ts (turn-taking director) → voice.ts/personas.ts
// (how each voice sounds). Entry point: `buildBoothScript(events, teams, opts?)`.
export { buildBoothScript, formatBoothScript } from './booth.js';
export type { BoothCue, BoothOptions, BoothConfig } from './booth.js';
export { compileBeats } from './beats.js';
export type { Beat, BeatKind, BeatTag, NoteKind, Register, SenseSnapshot } from './beats.js';
export { GameSense } from './sense.js';
export type { PlayerLine, TeamSense, PossessionSense, SenseDelta } from './sense.js';
export { makeGeo, shotSpot } from './geometry.js';
export type { ShotSpot, GeoContext } from './geometry.js';
export type { VoicePack, Signature, RenderContext } from './voice.js';
export { fillSlots, LineDealer, resolvePool, clockPhrase, periodPhrase, mmss, ordinal, minutesText, runText } from './voice.js';
export { CORBIN, TREMAINE, BOONE, BOOTH_PRESETS } from './personas.js';
export type { BoothPresetId } from './personas.js';
