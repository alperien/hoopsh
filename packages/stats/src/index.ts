// Package barrel — @hoopsh/stats' only consumer-facing surface is
// event-folding (box.ts). Nothing else lives here yet; add new stat modules
// as siblings of box.ts and re-export them here rather than growing box.ts
// past its single responsibility (fold events -> box score -> derived %s).
export {
  boxScore, fgPct, tpPct, ftPct, tsPct, efgPct, ortg, orbPct
} from './box.js';
export type { BoxScore, BoxScoreOptions, PlayerLine, TeamTotals, ZoneLine } from './box.js';
