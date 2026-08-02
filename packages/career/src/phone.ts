/**
 * phone.ts - the career mode's narrative surface: a diegetic message
 * inbox with zero cutscenes (docs/CAREER.md, The phone). OWNER: phone
 * task. STATUS: implemented (build wave B); summit-and-wire fix (wave C);
 * split along its seams into the phone-* sibling modules.
 *
 * Discipline, in priority order:
 * 1. State-backed, always. Every message quotes real state: the actual
 *    grade note from coach.grades, the actual rung move in
 *    recruiting.interest, the actual stock reason from stock.history,
 *    the rival's actual box line from the circuit results, the actual
 *    pick number off league.transactions on draft night. If the state
 *    did not happen, the message does not exist. A week with nothing
 *    real to say produces zero messages; silence is content.
 * 2. Few and consequential. Hard per-thread season caps
 *    (params.phone.capsPerSeason) plus the burst guard
 *    (params.phone.threadCooldownWeeks). Recruiter and wire threads
 *    carry module-constant caps (phone-shared.ts) because the frozen
 *    params shape holds no keys for them. FOUR named payoff moments
 *    ride OUTSIDE the caps (commitment, draft night, the title game,
 *    the NBA debut): the caps exist to stop filler, and a cap that
 *    silences the biggest night of a career is the bug this file was
 *    reopened to fix. Everything else, including every wire story,
 *    stays capped.
 * 3. Character voices, no memes. The coach texts terse and film-first
 *    in lowercase; mom watches every game and worries about the body;
 *    the agent is transactional and slightly too smooth; the rival
 *    needles; media asks loaded questions; recruiters write in the
 *    formal register; the mentor has seen everything twice; the wire
 *    writes like a beat reporter under one fixed byline (K. Osei, The
 *    Ledger) and quotes real numbers in every line.
 * 4. Choices only where a real decision exists: scheduling the
 *    recruiting visit, answering media, engaging the rival, the family
 *    ask, and the role-promise grievance. Everything else is read-only
 *    texture; no quiz bolted onto it.
 * 5. Every consequence explained: applyPhoneChoice appends CareerEvents
 *    with nonempty reasons (the explained-consequence lint reads them).
 * 6. Ghost-proof. A recruiting thread only speaks when its rung move is
 *    corroborated by a positive recruiting event logged THIS week (events
 *    carry (year, week), so a stale lastMoveWeek from a dead season can
 *    never resurrect a program when the week numbers wrap), and only in
 *    the HS phase, pre-commitment, on an open interest row. One sender
 *    never lands two messages in one week.
 * 7. Anti-repeat. A thread never repeats a byte-identical body within
 *    ANTIREPEAT_WEEKS (derived from career.phone itself, so it survives
 *    save/load with no new state).
 *
 * Streams (career.seed root, franchise rng.ts doctrine):
 *   career-phone:<year>:<week>       phrasing-variant picks; exactly one
 *                                    int draw per ADMITTED message, in
 *                                    admission order, so draw counts are
 *                                    a pure function of state (the
 *                                    anti-repeat filter reads career.phone,
 *                                    which is state too)
 *   career-phone-coach:<programId>   a program's recruiting coach
 *                                    surname; no week in the path
 *                                    because the man does not change
 *                                    names between letters
 *   career-phone-close:<programId>   the losing finalist's door-close
 *                                    temperature (classy or bitter); one
 *                                    chance draw, personality is stable
 *
 * Module map (the surface, split along its seams):
 *   phone-shared.ts      texture constants, shared lookups, the Candidate contract
 *   phone-detect.ts      summit-beat detectors and the promise ledger
 *   phone-coach.ts       the coach thread
 *   phone-agent.ts       the agent thread and the promise conversations
 *   phone-circle.ts      family, rival, teammate, and mentor threads
 *   phone-press.ts       the beat writer and the wire desk
 *   phone-recruiting.ts  recruiter threads and closing-window warnings
 *   phone-summits.ts     the cap-exempt payoff bursts
 *   phone-arcs.ts        the formative arcs: offseason, draftPrep, and
 *                        entry-gap texture for the windows nothing else
 *                        can speak in (issue #105)
 * This file keeps the public surface: generatePhone and applyPhoneChoice.
 */
import { clamp } from '@hoopsh/engine';
import type { AttrGroup } from '@hoopsh/franchise';
import { streamRng } from '@hoopsh/franchise';
import { agentCandidates, promiseCandidates } from './phone-agent.js';
import {
  TRAINABLE_GROUPS, draftPrepArcCandidates, entryArcCandidates,
  offseasonArcCandidates,
} from './phone-arcs.js';
import {
  familyCandidates, mentorCandidates, rivalCandidates, teammateCandidates,
} from './phone-circle.js';
import { coachCandidates } from './phone-coach.js';
import { mediaCandidates, wireCandidates } from './phone-press.js';
import { lapseWarningCandidates, recruiterCandidates } from './phone-recruiting.js';
import {
  FAMILY_GO_ENERGY, FAMILY_GO_MORALE, FAMILY_STAY_MORALE, MEDIA_MORALE,
  PROMISE_DEMAND_MORALE, PROMISE_KNOWN_MORALE, PROMISE_KNOWN_TRUST_COST,
  PROMISE_LET_GO_MORALE, RECRUITER_CAP_PER_SEASON, RIVAL_MORALE,
  VISIT_DECLINE_COOL, VISIT_PERCEIVED_BUMP, WIRE_CAP_PER_SEASON,
  alreadySent, meOf, recentBodySet, rungIdx,
} from './phone-shared.js';
import type { Candidate } from './phone-shared.js';
import {
  commitmentCandidates, debutCandidates, draftNightCandidates,
} from './phone-summits.js';
import type { CareerEvent, CareerState, PhoneMessage, Program, ThreadId } from './types.js';

// ---------------------------------------------------------------------------
// generatePhone

/**
 * Generate this week's messages from state deltas. Called once per career
 * week by week.ts AFTER games are graded and the systems have pulsed, so
 * everything below reads settled state. Returns messages; the caller owns
 * pushing them into career.phone (and dedupes on id).
 *
 * Admission: candidates build in a fixed order, sort by (thread rank,
 * priority), then pass, per candidate: the burst guard (one message per
 * thread per week), the sender guard (one message per SENDER per week,
 * across threads), the once-ever tag, and, unless the candidate is one
 * of the cap-exempt payoff moments, the cooldown and the season cap.
 * One rng int draw per ADMITTED message keeps the stream a pure function
 * of state, which is what makes two identical careers read identically;
 * the anti-repeat filter narrows the pool from career.phone, which is
 * state too.
 */
export function generatePhone(career: CareerState): PhoneMessage[] {
  const { year, week } = career.clock;
  const caps = career.params.phone.capsPerSeason;
  const cooldown = career.params.phone.threadCooldownWeeks;

  const candidates: Candidate[] = [];
  coachCandidates(career, candidates);
  agentCandidates(career, candidates);
  promiseCandidates(career, candidates);
  familyCandidates(career, candidates);
  rivalCandidates(career, candidates);
  mediaCandidates(career, candidates);
  teammateCandidates(career, candidates);
  mentorCandidates(career, candidates);
  wireCandidates(career, candidates);
  recruiterCandidates(career, candidates);
  lapseWarningCandidates(career, candidates);
  // the formative arcs: the offseason, the pre-combine block, and the
  // draft-to-camp gap - the windows every builder above is structurally
  // silent in (issue #105). Capped and cooled like everything else.
  offseasonArcCandidates(career, candidates);
  draftPrepArcCandidates(career, candidates);
  entryArcCandidates(career, candidates);
  commitmentCandidates(career, candidates);
  draftNightCandidates(career, candidates);
  debutCandidates(career, candidates);
  if (candidates.length === 0) return []; // silence is content

  // stable admission order: thread rank, then priority, then build order
  const indexed = candidates.map((c, i) => ({ c, i }));
  indexed.sort((a, b) =>
    a.c.threadRank - b.c.threadRank || b.c.priority - a.c.priority || a.i - b.i);

  const capFor = (thread: ThreadId): number => {
    if (thread.startsWith('recruiter:')) return RECRUITER_CAP_PER_SEASON;
    if (thread === 'wire') return WIRE_CAP_PER_SEASON; // params.phone carries no wire key (module constant in phone-shared.ts, header rule 2)
    const key = thread as keyof typeof caps;
    return caps[key] ?? 0; // a thread without a cap entry stays silent here
  };
  const seasonCount = (thread: ThreadId): number =>
    career.phone.filter(m => m.thread === thread && m.clock.year === year).length;
  const lastWeekOf = (thread: ThreadId): number | null => {
    let last: number | null = null;
    for (const m of career.phone) {
      if (m.thread !== thread || m.clock.year !== year) continue;
      if (last === null || m.clock.week > last) last = m.clock.week;
    }
    return last;
  };

  const rng = streamRng(career.seed, 'career-phone', year, week);
  const admittedPerThread: Record<string, number> = {};
  const recentByThread = new Map<ThreadId, Set<string>>();
  const seenFrom = new Set<string>();
  const messages: PhoneMessage[] = [];

  for (const { c } of indexed) {
    const already = admittedPerThread[c.thread] ?? 0;
    if (cooldown > 0 && already > 0) continue; // one message per thread per week under the burst guard
    if (seenFrom.has(c.from)) continue; // one sender, one message, one week (header rule 6)
    if (c.tag && alreadySent(career, c.tag)) continue; // once-ever beats never replay
    if (!c.capExempt) {
      const last = lastWeekOf(c.thread);
      if (cooldown > 0 && last !== null && week - last < cooldown) continue;
      if (seasonCount(c.thread) + already >= capFor(c.thread)) continue;
    }

    // anti-repeat: drop variants the thread sent inside the window; a
    // fully burned pool falls back to the whole pool (saying the thing
    // again beats silence on a real beat)
    let recent = recentByThread.get(c.thread);
    if (!recent) {
      recent = recentBodySet(career, c.thread);
      recentByThread.set(c.thread, recent);
    }
    let pool = c.variants.filter(v => !recent.has(v));
    if (pool.length === 0) pool = c.variants;

    const body = pool[rng.int(pool.length)]!;
    const msg: PhoneMessage = {
      id: `ph-${c.thread}-${c.tag ? `#${c.tag}#-` : ''}${year}w${week}-${already}`,
      clock: { ...career.clock },
      thread: c.thread,
      from: c.from,
      body,
    };
    if (c.choices) msg.choices = c.choices.map(ch => ({ ...ch }));
    if (c.deadlineWeek !== undefined) msg.deadlineWeek = c.deadlineWeek;
    if (c.refs) msg.refs = c.refs;
    admittedPerThread[c.thread] = already + 1;
    seenFrom.add(c.from);
    messages.push(msg);
  }
  return messages;
}

// ---------------------------------------------------------------------------
// applyPhoneChoice

/** Append one explained consequence of an answered message. */
function pushChoiceEvent(
  career: CareerState, messageId: string, seq: number,
  kind: CareerEvent['kind'], reason: string, delta?: number,
): void {
  career.events.push({
    id: `ev-phone-${messageId}-${seq}`,
    clock: { ...career.clock },
    kind,
    reason,
    ...(delta !== undefined ? { delta } : {}),
  });
}

/**
 * Apply an answered choice: validate, mutate the real state the choice
 * names, log every consequence with a reason, mark the message answered.
 * Never throws on a bad id: the phone is a UI surface and the polite
 * error is the contract ({ ok: false, errors }); nothing mutates on any
 * error path.
 */
export function applyPhoneChoice(career: CareerState, messageId: string, choiceId: string): { ok: boolean; errors: string[] } {
  const msg = career.phone.find(m => m.id === messageId);
  if (!msg) return { ok: false, errors: [`career/phone: no message '${messageId}'`] };
  if (!msg.choices || msg.choices.length === 0) {
    return { ok: false, errors: [`career/phone: message '${messageId}' carries no choices`] };
  }
  if (msg.chosen !== undefined) {
    return { ok: false, errors: [`career/phone: message '${messageId}' was already answered`] };
  }
  if (!msg.choices.some(c => c.id === choiceId)) {
    return { ok: false, errors: [`career/phone: message '${messageId}' has no choice '${choiceId}'`] };
  }
  if (msg.deadlineWeek !== undefined
    && (career.clock.year > msg.clock.year || career.clock.week > msg.deadlineWeek)) {
    return { ok: false, errors: [`career/phone: message '${messageId}' expired in week ${msg.deadlineWeek}`] };
  }

  const me = meOf(career);
  const moveMorale = (delta: number): void => {
    me.morale = clamp(me.morale + delta, 0, 100);
  };

  if (choiceId === 'visit-yes' || choiceId === 'visit-no') {
    const programId = msg.refs?.programId;
    const interest = programId
      ? career.recruiting?.interest.find(x => x.programId === programId)
      : undefined;
    const program: Program | undefined = programId
      ? career.recruiting?.programs.find(p => p.id === programId)
      : undefined;
    if (!interest || !program) {
      return { ok: false, errors: [`career/phone: message '${messageId}' names no live recruiting interest`] };
    }
    msg.chosen = choiceId;
    if (choiceId === 'visit-yes') {
      // the ladder only climbs from here: never demote a program that already sat in the living room or offered
      if (rungIdx(interest.rung) < rungIdx('visit')) {
        interest.rung = 'visit';
        interest.lastMoveWeek = career.clock.week;
      }
      interest.perceived = clamp(interest.perceived + VISIT_PERCEIVED_BUMP, 0, 100);
      pushChoiceEvent(career, messageId, 0, 'recruiting',
        `scheduled the ${program.name} in-home visit; the staff moved their number up`, VISIT_PERCEIVED_BUMP);
    } else {
      interest.perceived = clamp(interest.perceived - VISIT_DECLINE_COOL, 0, 100);
      pushChoiceEvent(career, messageId, 0, 'recruiting',
        `told ${program.name} not yet on the home visit; the staff cooled a step`, -VISIT_DECLINE_COOL);
    }
    return { ok: true, errors: [] };
  }

  if (choiceId === 'media-lean' || choiceId === 'media-team' || choiceId === 'media-shrug') {
    msg.chosen = choiceId;
    if (choiceId === 'media-lean') {
      moveMorale(MEDIA_MORALE.lean);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'owned the moment with the beat writer; it read confident in print', MEDIA_MORALE.lean);
    } else if (choiceId === 'media-team') {
      moveMorale(MEDIA_MORALE.team);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'pointed the story at the locker room; the room noticed', MEDIA_MORALE.team);
    } else {
      moveMorale(MEDIA_MORALE.shrug);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'no-commented the beat writer; the moment passed unclaimed', MEDIA_MORALE.shrug);
    }
    return { ok: true, errors: [] };
  }

  if (choiceId === 'reply-won' || choiceId === 'reply-lost' || choiceId === 'rival-mute') {
    msg.chosen = choiceId;
    if (choiceId === 'reply-won') {
      moveMorale(RIVAL_MORALE.replyWon);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'sent the rival the scoreboard; some texts write themselves', RIVAL_MORALE.replyWon);
    } else if (choiceId === 'reply-lost') {
      moveMorale(RIVAL_MORALE.replyLost);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'talked back after the loss; he had the box score and used it', RIVAL_MORALE.replyLost);
    } else {
      moveMorale(RIVAL_MORALE.mute);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'left the rival on read; nothing good lives in that thread', RIVAL_MORALE.mute);
    }
    return { ok: true, errors: [] };
  }

  if (choiceId === 'family-go' || choiceId === 'family-stay') {
    msg.chosen = choiceId;
    if (choiceId === 'family-go') {
      moveMorale(FAMILY_GO_MORALE);
      career.energy = clamp(career.energy + FAMILY_GO_ENERGY, 0, 100);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'went home Sunday; the table did what the gym cannot', FAMILY_GO_MORALE);
      pushChoiceEvent(career, messageId, 1, 'energy',
        'the trip home and back cost some rest', FAMILY_GO_ENERGY);
    } else {
      moveMorale(FAMILY_STAY_MORALE);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'told the family not this week; the quiet after the call stuck around', FAMILY_STAY_MORALE);
    }
    return { ok: true, errors: [] };
  }

  // the promise grievance: every effect lands in state consumers that
  // exist today (morale is read by the game-night projection; coach.trust
  // feeds planFor and the green light) and every effect is explained.
  // Widening the plan directly would need approach.ts's cooperation, so
  // the pressure routes through trust (the seam is noted in the module
  // report; nothing here fakes a mechanism that does not exist).
  if (choiceId === 'promise-let-go' || choiceId === 'promise-make-known' || choiceId === 'promise-demand') {
    msg.chosen = choiceId;
    if (choiceId === 'promise-let-go') {
      moveMorale(PROMISE_LET_GO_MORALE);
      pushChoiceEvent(career, messageId, 0, 'morale',
        'let the broken role promise go; the work will do the talking', PROMISE_LET_GO_MORALE);
    } else if (choiceId === 'promise-make-known') {
      career.coach.trust = clamp(Math.round((career.coach.trust - PROMISE_KNOWN_TRUST_COST) * 10) / 10, 5, 99);
      pushChoiceEvent(career, messageId, 0, 'trust',
        'the agent made the broken role promise known; the staff heard it and did not love the messenger', -PROMISE_KNOWN_TRUST_COST);
      moveMorale(PROMISE_KNOWN_MORALE);
      pushChoiceEvent(career, messageId, 1, 'morale',
        'stopped swallowing the broken promise; saying it out loud sat better', PROMISE_KNOWN_MORALE);
    } else {
      pushChoiceEvent(career, messageId, 0, 'contract',
        'demanded the promised role on the record; the file now says what was said in the living room');
      moveMorale(PROMISE_DEMAND_MORALE);
      pushChoiceEvent(career, messageId, 1, 'morale',
        'drew the line under the promise; self-respect is a stat too', PROMISE_DEMAND_MORALE);
    }
    return { ok: true, errors: [] };
  }

  // the formative-arc assignment (phone-arcs.ts): the staff's read becomes
  // the standing focus only when the player says so - the plan is his, and
  // both answers are explained so neither reads as a silent consequence.
  // A later setWeekPlan overrides freely; this is a shortcut, not a lock.
  if (choiceId === 'arc-focus-keep') {
    msg.chosen = choiceId;
    pushChoiceEvent(career, messageId, 0, 'dev',
      `kept his own program: the training focus stays ${career.weekPlan.focus}`);
    return { ok: true, errors: [] };
  }
  if (choiceId.startsWith('arc-focus:')) {
    const group = choiceId.slice('arc-focus:'.length) as AttrGroup;
    if (!TRAINABLE_GROUPS.includes(group)) {
      return { ok: false, errors: [`career/phone: message '${messageId}' names no trainable group '${group}'`] };
    }
    msg.chosen = choiceId;
    career.weekPlan.focus = group;
    pushChoiceEvent(career, messageId, 0, 'dev',
      `took the staff assignment: extra work moves to ${group}`);
    return { ok: true, errors: [] };
  }

  // a choice id the phone never generated: refuse rather than guess
  return { ok: false, errors: [`career/phone: unhandled choice '${choiceId}' on message '${messageId}'`] };
}
