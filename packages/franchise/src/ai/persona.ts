/**
 * ai/persona.ts — GM personas and timeline re-evaluation. OWNER: ai-trade
 * task. STATUS: mixed stub — generatePersona THROWS (genesis needs it and
 * genesis is a sibling: it uses a temporary flat persona until this
 * lands); reevaluateTimelines is INERT (spine calls it at season points).
 */
import type { Rng } from '@hoopsh/engine';
import type { GmPersona, League } from '../types.js';

export function generatePersona(rng: Rng): GmPersona {
  // TEMPORARY default persona so genesis can run before ai-trade lands.
  // The ai-trade task replaces this with sampled distributions.
  return { name: 'Front Office', timeline: 'retool', risk: 50, pickLove: 50, starChase: 50, patience: 50 };
}

/** Re-read record/core-age/assets; move timelines. INERT until ai-trade lands. */
export function reevaluateTimelines(league: League): void {
  // INERT until ai-trade task lands: timelines are static.
}
