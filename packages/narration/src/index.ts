// Package barrel: re-exports the narration public surface (play-by-play,
// narrative-context tracking, commentary providers, broadcast-script
// assembly). Frozen prototype per project decision (docs/INTERNALS.md,
// ARCHITECTURE.md §6); the header comments in pbp.ts/context.ts/
// provider.ts/broadcast.ts say what each piece does and why it's frozen.
// The engine never imports from this package (AGENTS.md §1.3/§6).
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
