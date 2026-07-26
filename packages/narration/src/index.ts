// Package barrel: re-exports the narration public surface. Two layers live
// here (docs/BROADCAST.md):
//  - the BOOTH — the production broadcast engine (sense → beats → booth →
//    voices), added when the project-level decision (2026-07) lifted the
//    original freeze;
//  - the v1 prototype (pbp/context/provider/broadcast) — kept as the minimal
//    reference consumer with its behavior unchanged; existing callers and
//    tests continue to work against it.
// The engine never imports from this package (AGENTS.md §1.3/§6).

// ---- the booth (production layer) ----
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

// ---- v1 reference layer (behavior frozen-in-place, superseded by the booth) ----
export { generatePlayByPlay, makeLookup } from './pbp.js';
export type { NarrationLine } from './pbp.js';
export { ContextTracker } from './context.js';
export type { NarrativeMoment } from './context.js';
export { TemplateColorProvider } from './provider.js';
export type { CommentaryProvider, CommentaryWindow, ColorLine } from './provider.js';
export { buildBroadcastScript, formatScript } from './broadcast.js';
export type { BroadcastCue } from './broadcast.js';
