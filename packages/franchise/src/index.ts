/**
 * @hoopsh/franchise — deterministic franchise/GM league layer on the
 * hoopsh engine. Pure logic, zero I/O, browser-safe (persistence and
 * workers live in @hoopsh/app). The design document is docs/FRANCHISE.md;
 * the per-module map is docs/FRANCHISE_INTERNALS.md.
 *
 * This barrel was frozen in the contracts wave (docs/FRANCHISE.md §14):
 * build tasks implement modules behind it without editing it. Start here:
 * `createLeague(opts)` -> `League`; drive time with `advanceDay(league,
 * sim)`; apply the user's moves with `applyUserAction(league, action)`.
 */

// contracts
export * from './types.js';
export { defaultFranchiseParams, withFranchiseParams } from './params.js';
export type { FranchiseParams } from './params.js';
export { streamRng, gameSeedFor } from './rng.js';
export { FRANCHISES } from './teamdata.js';
export type { FranchiseSeed } from './teamdata.js';

// league lifecycle (spine)
export { createLeague } from './genesis.js';
export type { CreateLeagueOpts } from './genesis.js';
export { buildSeasonCalendar, currentDate, phaseOn } from './calendar.js';
export { advanceDay, applyUserAction } from './tick.js';
export type { ActionResult } from './tick.js';
export {
  projectTeam, planDayJobs, foldEvents, extractKeyPlays,
  applyGameResults, simulateJobsInline,
} from './gameday.js';

// season structure
export { generateSchedule } from './schedule.js';
export { emptyStanding, applyResultToStandings, conferenceSeeds } from './standings.js';
export { buildPlayin, advancePostseason, buildFirstRound, runLottery } from './postseason.js';

// league office
export { capSheet, rollCapLines, taxBillFor } from './cba/cap.js';
export type { CapSheet } from './cba/cap.js';
export {
  yearsOfService, maxSalaryFor, minSalaryFor, rookieScaleContract,
  availableMeans, validateSigning, buildContract, qualifyingOfferFor,
} from './cba/contracts.js';
export type { Legality, SigningTerms } from './cba/contracts.js';
export { validateTrade, maxIncomingFor } from './cba/tradelegal.js';
export {
  executeTrade, executeSigning, executeWaive, executeClaim,
  executeDraftSelection, executeOptionDecision, executeExtension,
  executeAssignment, executeRetirement,
} from './transactions.js';

// people
export { generateName, generateNameOfKind, isFamousName, personName } from './people/names.js';
export type { GeneratedName, NameKind, NameOpts, PersonRole } from './people/names.js';
export { generatePlayer, generateDraftClass, generateCoach, classStrengthFor } from './people/gen.js';
export type { GenPlayerOpts } from './people/gen.js';
export {
  ARCHETYPES, archetypeById, archetypeOf, archetypeLabelOf,
} from './people/archetypes.js';
export type { Archetype, ArchetypeId } from './people/archetypes.js';
export { runDevelopmentReview, reviewPlayerDevelopment, applyAging, distributeGrowth, groupMean, ATTR_GROUPS } from './people/dev.js';
export type { DevReviewCtx } from './people/dev.js';
export { rollPostGameInjuries, advanceRecoveries } from './people/injury.js';
export { updateDispositions } from './people/disposition.js';
export { runRetirements } from './people/retire.js';

// front offices
export { generatePersona, reevaluateTimelines } from './ai/persona.js';
export { playerValue, pickValue, offerNet } from './ai/valuation.js';
export { respondToOffer, aiTradePulse } from './ai/trade.js';
export { runFreeAgencyDay, runAiOffseasonDecisions } from './ai/fa.js';
export { aiSelect, tapeAdjust } from './ai/draftai.js';
export { depthChart, defaultRotation, aiRosterUpkeep } from './ai/roster.js';
export { perceivedGroup, buildUserReport, runCombine } from './scouting.js';

// media & history
export { writeDailyNews } from './media/news.js';
export { championshipNews, lotteryNightNews } from './media/moments.js';
export { recapGame } from './media/recap.js';
export {
  initOfficials, officialsStateOf, dayAssignments, crewForGame,
  gameTightness, crewAttrDelta, officiatingParamsFor, officialsJobExtras,
  officialsStamp, officialsRecapLine, officialsNewsFor, officialsParamsOf,
  DEFAULT_OFFICIALS_PARAMS,
} from './officials.js';
export type { RefCrew, OfficialsState, GameOfficials, OfficialsParams } from './officials.js';
export { confidencePhrase, lifestylePhrase, updatePsyche, initPsyche } from './people/psyche.js';
export { updateAwardRaces, voteSeasonAwards, selectAllStars } from './media/awards.js';
export { updateRecords, archiveSeason } from './media/almanac.js';
