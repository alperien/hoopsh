/**
 * tick.ts - the career master: applyChoice validates and logs the
 * player's decisions; advanceCareerWeek runs the phase machine
 * (docs/CAREER.md, The journey web). CareerState = f(seed, choiceLog):
 * both entry points are deterministic given the same inputs, and the
 * choice log is the replayable record.
 *
 * Phase machine: hs -> (college | euro | nbl) -> draftPrep -> nba ->
 * china -> retired. Circuit seasons build lazily at each phase's start
 * week and archive to circuitHistory when complete. The NBA world runs
 * underneath the whole time: pre-entry on the internal fast sim
 * (register C11), post-entry on the caller's SimulateJobs.
 *
 * Draft sync: the career calendar and the league calendar drift by
 * design (52 weeks vs 313 days); the one hard sync point is draft night.
 * At draftWeek the league drains forward to its draft phase, the class
 * gets me in it, and the real AI boards do the rest. Pre-entry drift is
 * invisible scenery; post-entry the career clock follows the league.
 *
 * Streams: 'career-circuit:<year>:<phase>' circuit builds;
 * 'career-gm-fill' persona backfill so no draft ever waits on a human.
 */
import type { SimulateJobs, TeamId } from '@hoopsh/franchise';
import { advanceDay, generatePersona, streamRng } from '@hoopsh/franchise';
import type {
  ApproachCard, CareerChoice, CareerPhase, CareerState, ChoiceResult,
  CircuitKind, RoleId, WeekDigest, WeekSlotId,
} from './types.js';
import { fastSim } from './fastsim.js';
import { buildCircuit, summarizeCircuit } from './circuits.js';
import { resolveWeek } from './week.js';
import { commitToOffer } from './recruiting.js';
import { applyPhoneChoice } from './phone.js';
import { enterDraftClass, runCombineWeek, attendWorkout } from './stock.js';
import {
  applyContractDecision, applyNbaOffer, applyAbroadOffer,
  resolveNbaWeek, setTradeRequest,
} from './nbabridge.js';
import { advanceLegacy, buildEpilogue, harvestSeasonHonors } from './epilogue.js';
import { accrueSeason } from './money.js';
import { APPROACH_DIALS } from './approach.js';

const VALID_SLOTS: readonly WeekSlotId[] = ['practice', 'extraWork', 'film', 'body', 'rest', 'life'];
const VALID_GROUPS = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'] as const;

function pushEvent(career: CareerState, kind: CareerState['events'][number]['kind'], reason: string, delta?: number): void {
  career.events.push({
    id: `ev-${kind}-${career.clock.year}w${career.clock.week}-${career.events.length}`,
    clock: { ...career.clock },
    kind,
    reason,
    ...(delta !== undefined ? { delta } : {}),
  });
}

function ok(): ChoiceResult { return { ok: true, errors: [] }; }
function deny(...errors: string[]): ChoiceResult { return { ok: false, errors }; }

function validCard(card: ApproachCard): boolean {
  return APPROACH_DIALS.every(d => Number.isFinite(card[d]) && card[d] >= 0 && card[d] <= 100);
}

/** The last declare/return decision logged in the given career year wins. */
function declaredThisYear(career: CareerState, year: number): boolean {
  for (let i = career.choiceLog.length - 1; i >= 0; i--) {
    const c = career.choiceLog[i]!;
    if (c.clock.year !== year) continue;
    if (c.choice.kind === 'declareDraft') return true;
    if (c.choice.kind === 'returnToSchool') return false;
  }
  return false;
}

/**
 * Apply one decision. Validates against the current phase and state;
 * never throws for a bad input, returns the errors instead (the UI shows
 * them as the world saying no). Applied choices append to the log.
 */
export function applyChoice(career: CareerState, choice: CareerChoice): ChoiceResult {
  const phase = career.clock.phase;
  let result: ChoiceResult;

  switch (choice.kind) {
    case 'setWeekPlan': {
      const p = choice.plan;
      if (!Array.isArray(p.slots) || p.slots.length > career.params.week.slotCount) {
        result = deny(`a week holds ${career.params.week.slotCount} slots beyond practice`);
      } else if (p.slots.some(s => !VALID_SLOTS.includes(s))) {
        result = deny('unknown slot in the plan');
      } else if (!VALID_GROUPS.includes(p.focus)) {
        result = deny('unknown training focus');
      } else {
        career.weekPlan = { slots: [...p.slots], focus: p.focus };
        result = ok();
      }
      break;
    }
    case 'setApproach': {
      if (!validCard(choice.card)) {
        result = deny('approach dials run 0 to 100');
      } else {
        career.nextApproach = { ...choice.card, ...(choice.playingHurt ? { playingHurt: true } : {}) };
        result = ok();
      }
      break;
    }
    case 'respondPhone': {
      try {
        result = applyPhoneChoice(career, choice.messageId, choice.choiceId);
      } catch {
        result = deny('the phone cannot take that answer yet');
      }
      break;
    }
    case 'acceptOffer':
    case 'commitCollege': {
      if (phase !== 'hs') { result = deny('commitments happen in high school'); break; }
      if (!career.recruiting) { result = deny('no recruiting board yet'); break; }
      if (career.recruiting.committedTo) { result = deny('you already committed'); break; }
      const offer = career.recruiting.offers.find(o => o.id === choice.offerId);
      if (!offer) { result = deny('that offer is not on the table'); break; }
      if (career.clock.week >= offer.expiresWeek) { result = deny('that offer expired'); break; }
      // the module owns the ritual: the commitment line plus every other
      // door audibly shutting ('came off the board: signed elsewhere')
      commitToOffer(career, offer.id);
      result = ok();
      break;
    }
    case 'declareDraft': {
      if (phase !== 'college') { result = deny('declaring is a college decision; pro routes auto-enter'); break; }
      pushEvent(career, 'phase', 'declared for the draft; the season plays out, then the pre-draft grind');
      result = ok();
      break;
    }
    case 'returnToSchool': {
      if (phase !== 'college') { result = deny('only a college player can run it back'); break; }
      pushEvent(career, 'phase', 'pulled out of the draft; one more year');
      result = ok();
      break;
    }
    case 'attendWorkout': {
      if (phase !== 'draftPrep') { result = deny('workouts happen in the pre-draft window'); break; }
      if (!career.stock?.workoutInvites.includes(choice.teamId)) { result = deny('no invite from that team'); break; }
      try {
        attendWorkout(career, choice.teamId);
        result = ok();
      } catch {
        result = deny('workouts are not open yet');
      }
      break;
    }
    case 'declineWorkout': {
      if (!career.stock?.workoutInvites.includes(choice.teamId)) { result = deny('no invite from that team'); break; }
      career.stock.workoutInvites = career.stock.workoutInvites.filter(t => t !== choice.teamId);
      pushEvent(career, 'stock', `declined the ${choice.teamId} workout; their room noticed`);
      result = ok();
      break;
    }
    case 'signAgent': {
      if (phase === 'hs') { result = deny('signing an agent in high school burns eligibility; not in this game'); break; }
      pushEvent(career, 'money', `signed with an agent (${choice.agentId}); calls start coming through them`);
      result = ok();
      break;
    }
    case 'contractDecision':
      result = applyContractDecision(career, choice.decisionId, choice.choiceId);
      break;
    case 'requestTrade':
      result = setTradeRequest(career, true);
      break;
    case 'withdrawTradeRequest':
      result = setTradeRequest(career, false);
      break;
    case 'acceptNbaOffer':
      result = applyNbaOffer(career, choice.offerId);
      break;
    case 'acceptAbroadOffer':
      result = applyAbroadOffer(career, choice.offerId);
      break;
    case 'retire': {
      if (phase !== 'nba' && phase !== 'china') { result = deny('there is nothing to retire from yet'); break; }
      career.clock.phase = 'retired';
      career.epilogue = buildEpilogue(career);
      pushEvent(career, 'phase', 'called it: retired');
      result = ok();
      break;
    }
    default:
      result = deny('unknown choice');
  }

  if (result.ok) {
    career.choiceLog.push({ seq: career.choiceSeq++, clock: { ...career.clock }, choice });
  }
  return result;
}

// ---------------------------------------------------------------------------
// the phase machine

const CIRCUIT_PHASES: readonly CareerPhase[] = ['hs', 'college', 'euro', 'nbl', 'china'];

function kindFor(phase: CareerPhase): CircuitKind {
  return phase as CircuitKind; // circuit phases share the kind vocabulary
}

function seasonStartWeek(career: CareerState): number {
  const t = career.params.tick;
  switch (career.clock.phase) {
    case 'hs': return t.hsSeasonStartWeek;
    case 'college': return t.collegeSeasonStartWeek;
    default: return t.proSeasonStartWeek;
  }
}

/** No career draft ever waits on a human chair: backfill AI personas. */
function ensureAiLeague(career: CareerState): void {
  const rng = streamRng(career.seed, 'career-gm-fill');
  for (const team of Object.values(career.league.teams)) {
    if (team.gm === null) team.gm = generatePersona(rng);
  }
}

async function fastDays(career: CareerState, days: number): Promise<void> {
  for (let i = 0; i < days; i++) {
    await advanceDay(career.league, fastSim);
  }
}

/** Drain the league forward to its draft phase (class built, night pending). */
async function drainToDraft(career: CareerState): Promise<void> {
  ensureAiLeague(career);
  let guard = 700; // at most ~2.2 fast seasons; deterministic, milliseconds
  while (career.league.phase !== 'draft' && guard-- > 0) {
    await advanceDay(career.league, fastSim);
  }
  if (career.league.phase !== 'draft') {
    throw new Error('career/tick: the league never reached a draft (calendar bug)');
  }
}

/** Run draft night with me in the class; read my selection off the wire. */
async function resolveDraftNight(career: CareerState, digest: WeekDigest): Promise<void> {
  await drainToDraft(career);
  enterDraftClass(career);
  const txBefore = career.league.transactions.length;
  let guard = 40;
  while (career.league.phase === 'draft' && guard-- > 0) {
    await advanceDay(career.league, fastSim);
  }
  const picks = career.league.transactions.slice(txBefore);
  const mine = picks.find(t => t.kind === 'draftSelection' && t.playerId === career.me);
  if (mine && mine.kind === 'draftSelection') {
    career.nbaTeam = mine.teamId as TeamId;
    career.clock.phase = 'nba';
    digest.phaseChangedTo = 'nba';
    const teamName = career.league.teams[mine.teamId]?.name ?? mine.teamId;
    pushEvent(career, 'transaction',
      `drafted: round ${mine.round}, pick ${mine.pick}, ${teamName}`, mine.pick);
    pushEvent(career, 'phase', `the climb reached the league: ${teamName}`);
  } else {
    pushEvent(career, 'stock', 'sixty names, none of them yours: undrafted. The phone still works');
    pushEvent(career, 'phase', 'undrafted; the market decides the next door');
  }
}

/** Season-end fold: archive the circuit, clear the field. */
function foldSeason(career: CareerState, digest: WeekDigest): void {
  if (!career.circuit?.complete) return;
  try {
    const summary = summarizeCircuit(career);
    career.circuitHistory.push(summary);
    pushEvent(career, 'phase', `season over: ${summary.finish}${summary.honors.length ? ` (${summary.honors.join(', ')})` : ''}`);
    for (const h of summary.honors) pushEvent(career, 'honor', h);
  } catch {
    // circuits task lands summarize; the history row still marks the
    // season played so the lazy-build never re-runs a played year
    career.circuitHistory.push({
      year: career.circuit.year, kind: career.circuit.kind, teamName: '',
      w: 0, l: 0,
      myLine: { gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tpm: 0, fgPct: 0 },
      finish: 'season over', honors: [],
    });
    pushEvent(career, 'phase', 'season over');
  }
  career.circuit = null;
  digest.events.push(career.events[career.events.length - 1]!.id);
}


/** Surnames for generated staff; mirrors creation.ts's pool (module-private there). */
const STAFF_SURNAMES: readonly string[] = [
  'Wexler', 'Aldrich', 'Barlowe', 'Casteel', 'Dempsey', 'Fairbank',
  'Granger', 'Halvorsen', 'Lockridge', 'Marchetti', 'Naughton', 'Pruett',
  'Rasmussen', 'Stoddard', 'Tillery', 'Youngblood',
];

/**
 * A new bench for a new chapter: the next program's coach replaces the
 * old CoachState wholesale. Trust re-earns from 55; the role STARTS at
 * the offer's promise (the promise is real on day one; keeping it is
 * the program's side of the deal, earning more is yours). Fixes the
 * continuity break where the high school coach silently followed the
 * player to college.
 */
function installNextCoach(career: CareerState, phase: CareerPhase, promisedRole: RoleId | null): void {
  const rng = streamRng(career.seed, 'career-next-coach', phase, career.clock.year);
  const personalities = ['playersCoach', 'disciplinarian', 'systems', 'ridesHotHand'] as const;
  const name = `Coach ${STAFF_SURNAMES[rng.int(STAFF_SURNAMES.length)]}`;
  const personality = personalities[rng.int(personalities.length)]!;
  career.coach = {
    name,
    personality,
    trust: 55,
    role: promisedRole ?? 'bench',
    plan: career.coach.plan, // recomputed by planFor at the next grade
    greenLight: false,
    grades: [],
    roleClock: { above: 0, below: 0 },
  };
  pushEvent(career, 'role',
    `a new bench: ${name} (${personality}) takes over; the ${promisedRole ?? 'bench'} role is the promise, trust re-earns from 55`);
}

/** Year-wrap phase transitions; returns the new phase when it moves. */
function transitionAtYearWrap(career: CareerState): CareerPhase | undefined {
  const phase = career.clock.phase;
  const me = career.players[career.me] ?? career.league.players[career.me];
  const age = me ? career.clock.year - me.bornSeason : 30;

  if (phase === 'hs') {
    let committed = career.recruiting?.offers.find(o => o.id === career.recruiting?.committedTo);
    if (!committed && career.recruiting) {
      // signing day passes for the undecided: the best door still open
      // gets the name (the world moves even when you do not)
      const open = career.recruiting.offers.filter(o => !career.recruiting!.interest
        .find(i => i.programId === o.programId)?.closed);
      // the default door is college; the leap abroad is a choice, never a drift
      const best = [...open].sort((a, b) =>
        Number(b.kind === 'college') - Number(a.kind === 'college')
        || b.coachDev - a.coachDev || b.money - a.money)[0];
      if (best) {
        career.recruiting.committedTo = best.id;
        committed = best;
        const dest = career.recruiting.programs.find(pr => pr.id === best.programId)?.name
          ?? best.clubName ?? 'the program';
        pushEvent(career, 'recruiting',
          `signing day came with no answer; ${dest} got the name (the best door still open)`);
      }
    }
    if (committed) {
      career.clock.phase = committed.kind;
      pushEvent(career, 'phase', committed.kind === 'college'
        ? 'moved in: the college year starts'
        : `flew out: the ${committed.kind === 'euro' ? 'European' : 'NBL'} season is the new proving ground`);
      installNextCoach(career, committed.kind, committed.promisedRole);
      return committed.kind;
    }
    // nobody called: the walk-on door (docs/CAREER.md, recruiting)
    career.clock.phase = 'college';
    if (career.recruiting) {
      const softest = [...career.recruiting.programs].sort((a, b) => a.coachDev - b.coachDev)[0];
      if (softest) {
        const offer = {
          id: `offer-walkon-${career.clock.year}`,
          kind: 'college' as const,
          programId: softest.id,
          money: 0,
          coachDev: softest.coachDev,
          promisedRole: 'bench' as const,
          style: softest.style,
          expiresWeek: career.params.tick.weeksPerYear,
        };
        career.recruiting.offers.push(offer);
        career.recruiting.committedTo = offer.id;
        pushEvent(career, 'phase', `no offers came; walked on at ${softest.name}. The chip lives on the shoulder now`);
      }
    } else {
      pushEvent(career, 'phase', 'walked on; the college year starts at the bottom of the bench');
    }
    installNextCoach(career, 'college', 'bench');
    return 'college';
  }

  if (phase === 'college') {
    const seasons = career.circuitHistory.filter(s => s.kind === 'college').length;
    if (declaredThisYear(career, career.clock.year - 1) || seasons >= 4) {
      career.clock.phase = 'draftPrep';
      pushEvent(career, 'phase', seasons >= 4
        ? 'eligibility spent; the draft is the only door left'
        : 'in the draft: the pre-draft window opens');
      return 'draftPrep';
    }
    return undefined;
  }

  if ((phase === 'euro' || phase === 'nbl') && career.nbaTeam === null && !career.epilogue) {
    // the showcase route only: a descent veteran abroad is not a prospect
    career.clock.phase = 'draftPrep';
    pushEvent(career, 'phase', 'the showcase year is over; automatically eligible. The pre-draft window opens');
    return 'draftPrep';
  }

  if ((phase === 'china' || phase === 'euro' || phase === 'nbl') && age >= 40) {
    career.clock.phase = 'retired';
    career.epilogue = buildEpilogue(career);
    pushEvent(career, 'phase', 'the body decided at forty: retired');
    return 'retired';
  }

  return undefined;
}

/**
 * Advance one career week. Routes by phase, advances the world clock,
 * and moves the phase machine at year wraps. The caller provides the
 * sim used for MY games (circuit and NBA); the pre-entry league always
 * runs on the internal fast sim.
 */
export async function advanceCareerWeek(career: CareerState, sim: SimulateJobs): Promise<WeekDigest> {
  const phase = career.clock.phase;
  let digest: WeekDigest;

  if (phase === 'nba') {
    digest = await resolveNbaWeek(career, sim);
  } else if (phase === 'retired') {
    // retirement moves a year at a time: the ball has stopped, the world
    // has not. One advance = one league season and one legacy tick.
    digest = {
      clock: { ...career.clock }, gamesPlayed: [], messages: [], events: [], energy: career.energy,
    };
    const fromSeason = career.league.season;
    let guard = 400;
    while (career.league.season === fromSeason && guard-- > 0) {
      await advanceDay(career.league, fastSim);
    }
    career.clock.week = 0;
    career.clock.year += 1;
    advanceLegacy(career);
    harvestSeasonHonors(career);
    digest.clock = { ...career.clock };
    digest.events = career.events.slice(-4).map(e => e.id);
    return digest;
  } else {
    // circuit phases and draftPrep share the week engine; one season per
    // year, so a played year (circuitHistory row) never rebuilds
    const playedThisYear = career.circuitHistory.some(
      s => s.year === career.clock.year && s.kind === kindFor(phase),
    );
    if (CIRCUIT_PHASES.includes(phase)
      && !career.circuit
      && !playedThisYear
      && career.clock.week >= seasonStartWeek(career)) {
      const rng = streamRng(career.seed, 'career-circuit', career.clock.year, phase);
      career.circuit = buildCircuit(career, kindFor(phase), rng);
      pushEvent(career, 'phase', `the ${phase} season schedule is out`);
    }

    digest = await resolveWeek(career, sim);
    foldSeason(career, digest);

    if (phase === 'draftPrep') {
      if (career.clock.week === career.params.tick.combineWeek) {
        try { runCombineWeek(career); } catch { /* stock task lands this */ }
      }
      if (career.clock.week === career.params.tick.draftWeek) {
        await resolveDraftNight(career, digest);
      }
    }

    // the NBA runs underneath, roughly real time (register C11)
    if (career.clock.phase !== 'nba') {
      await fastDays(career, career.params.tick.leagueDaysPerWeek);
    }
  }

  // the world clock
  career.clock.week += 1;
  if (career.clock.week >= career.params.tick.weeksPerYear) {
    career.clock.week = 0;
    career.clock.year += 1;
    if (career.clock.phase === 'retired') {
      advanceLegacy(career);
    } else {
      accrueSeason(career);
      harvestSeasonHonors(career);
      const moved = transitionAtYearWrap(career);
      if (moved) digest.phaseChangedTo = moved;
    }
  }
  digest.clock = { ...career.clock };
  return digest;
}
