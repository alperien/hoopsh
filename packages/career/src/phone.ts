/**
 * phone.ts - the narrative layer: state-backed messages, few and
 * consequential. OWNER: phone task. STATUS: mixed stub - generation
 * INERT (tick calls after every week/day), choice application THROWS.
 * Discipline (docs/CAREER.md): every message quotes real state; caps per
 * season; character voices, no memes; no filler quizzes.
 */
import type { CareerState, PhoneMessage } from './types.js';

/** Generate this week's messages from state deltas. INERT until the phone task lands. */
export function generatePhone(career: CareerState): PhoneMessage[] {
  return []; // the phone is silent until the phone task lands
}

/** Apply an answered choice; every effect lands in the event log with a reason. */
export function applyPhoneChoice(career: CareerState, messageId: string, choiceId: string): { ok: boolean; errors: string[] } {
  throw new Error('career/phone: not implemented (phone task lands this)');
}
