/**
 * @hoopsh/career - the career mode: one created player, the whole climb
 * (docs/CAREER.md). Pure and deterministic; persistence and workers live
 * in @hoopsh/app. This barrel was frozen in the contracts wave; build
 * tasks implement modules behind it without editing it.
 *
 * Start here: createCareer(opts) -> CareerState; drive time with
 * advanceCareerWeek(career, sim); apply the player's decisions with
 * applyChoice(career, choice).
 */

export * from './types.js';
export { defaultCareerParams } from './params.js';
export type { CareerParams } from './params.js';
export { PACKS, PREP, FIBA, NBL, CBA_CHINA } from './packs.js';
export { fastSim } from './fastsim.js';
export { perceiveProspect } from './perception.js';
export type { PerceivedGroups } from './perception.js';

export { createCareer, validateCreation } from './creation.js';
export type { CreateCareerOpts } from './creation.js';
export { buildCircuit, circuitWeekJobs, applyCircuitResults, seedBracket, summarizeCircuit } from './circuits.js';
export { buildPrograms, updateRecruiting, openOffers } from './recruiting.js';
export { updateStock, runCombineWeek, attendWorkout, enterDraftClass } from './stock.js';
export { applyApproach, deviationFrom, planFor } from './approach.js';
export { updateAfterGame, productionScore } from './trust.js';
export { resolveWeek } from './week.js';
export { generatePhone, applyPhoneChoice } from './phone.js';
export { resolveNbaWeek, buildMyOffers, advanceLeagueFast } from './nbabridge.js';
export { recordEarning, accrueSeason } from './money.js';
export { buildEpilogue, advanceLegacy } from './epilogue.js';
export { applyChoice, advanceCareerWeek } from './tick.js';
