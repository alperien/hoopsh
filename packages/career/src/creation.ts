/**
 * creation.ts - CreationSpec -> a career at week zero. OWNER: creation
 * task. STATUS: STAGED stub from the contracts wave; signatures frozen.
 * Builds me (an FrPlayer at 17: budget across groups over the base,
 * background priors, signature tendency templates, hidden ceilings
 * sampled over the visible priors), the rival, the NBA world (franchise
 * createLeague), and the empty career ledgers. Circuit generation is the
 * circuits task; tick lazy-initializes the HS circuit on first advance.
 */
import type { CareerState, CreationSpec } from './types.js';
import type { CareerParams } from './params.js';

export interface CreateCareerOpts {
  seed: string;
  spec: CreationSpec;
  params?: Partial<CareerParams>;
}

/** Validate a spec against its preset budget and body bounds. */
export function validateCreation(spec: CreationSpec, params: CareerParams): { ok: boolean; errors: string[] } {
  throw new Error('career/creation: not implemented (creation task lands this)');
}

export function createCareer(opts: CreateCareerOpts): CareerState {
  throw new Error('career/creation: not implemented (creation task lands this)');
}
