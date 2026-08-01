/**
 * phone-recruiting.ts - the recruiter threads: rung-move beats on the
 * interest ladder and the closing-window warnings (fix wave C). Part of
 * the phone surface; see phone.ts for the discipline rules and module map.
 */
import {
  ROLE_LABEL, THREAD_RANK, eventsThisWeek, fmtMoney, recruiterSurname,
  teamNameOf,
} from './phone-shared.js';
import type { Candidate, WeekRecord } from './phone-shared.js';
import type { CareerState, PhoneMessage, ThreadId } from './types.js';

/** Recruiters: one thread per program, each beat driven by the interest ladder's actual rung move this week. Formal on paper, warmer by text, exactly like the real arc. */

/**
 * The closing windows (fix wave C, the Amari critique): fourteen offers
 * lapsing unanswered read as illogical because NOBODY SAID ANYTHING. Two
 * beats close the gap. Per offer: the program itself calls once when its
 * window is inside LAPSE_WARN_WEEKS (a real staff does not let a committable
 * offer die silently). Per year: when several windows are closing at once,
 * the agent names the moment ("pick a door or the year picks for you").
 * After these, silence is legibly the PLAYER's choice; the signing-day
 * fallback then reads as the consequence it always was.
 */
const LAPSE_WARN_WEEKS = 2;   // FEEL: close enough to feel, far enough to act
const LAPSE_CHORUS_MIN = 3;   // FEEL: three closing doors is a moment, one is a call

export function lapseWarningCandidates(career: CareerState, out: Candidate[]): void {
  const rec = career.recruiting;
  if (!rec || career.clock.phase !== 'hs' || rec.committedTo) return;
  const week = career.clock.week;
  const closing = rec.offers.filter(o => {
    const left = o.expiresWeek - week;
    if (left <= 0 || left > LAPSE_WARN_WEEKS) return false;
    if (!o.programId) return true; // euro/nbl doors warn too
    const row = rec.interest.find(i => i.programId === o.programId);
    return !row?.closed;
  });
  if (closing.length === 0) return;

  for (const offer of closing) {
    const program = rec.programs.find(pr => pr.id === offer.programId);
    const dest = program?.name ?? offer.clubName ?? 'the program';
    const surname = program ? recruiterSurname(career, program.id) : 'the club';
    const weeksLeft = offer.expiresWeek - week;
    const when = weeksLeft <= 1 ? 'this week' : `in ${weeksLeft} weeks`;
    out.push({
      thread: program ? `recruiter:${program.id}` : 'agent',
      threadRank: program ? 8 : THREAD_RANK.agent!,
      priority: 88,
      from: program ? `Coach ${surname} (${dest})` : 'Marta (agent)',
      capExempt: true, tag: `lapse-${offer.id}`,
      refs: program ? { programId: program.id } : undefined,
      variants: program ? [
        `Being straight with you: the offer comes off the table ${when}. The class is filling and I cannot hold the spot past that. We want an answer either way`,
        `Our window closes ${when}. If you are waiting on someone else, I understand, but tell me to my face and I will wish you well. If it is us, say so before the board meets`,
        `The staff meets ${when} to finalize the class. Your name is still on the top of the sheet. It will not be after. What are we doing?`,
      ] : [
        `${dest}'s contract window closes ${when}. Overseas paper does not wait on ceremonies. Yes or no, and I make the call either way`,
        `Heads up: the ${dest} deal expires ${when}. If the plan is college, fine, but let it be a plan and not a lapse`,
      ],
    });
  }

  if (closing.length >= LAPSE_CHORUS_MIN) {
    const names = closing.slice(0, 3).map(o =>
      rec.programs.find(pr => pr.id === o.programId)?.name ?? o.clubName ?? 'a club').join(', ');
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 92,
      from: 'Uncle Dee (advisor)',
      capExempt: true, tag: `lapsechorus-${career.clock.year}`,
      variants: [
        `${closing.length} windows close inside two weeks (${names}). Holding out is a strategy right up until it is just waiting. Pick a door or the year picks for you`,
        `The month of closing doors is here: ${names}, all inside two weeks. Silence reads as an answer to these people. Make it YOUR answer`,
        `Every staff on your board meets this month. ${names} first. You do not owe anyone a yes. You owe yourself a decision`,
      ],
    });
  }
}

export function recruiterCandidates(career: CareerState, out: Candidate[]): void {
  const rec = career.recruiting;
  if (!rec) return;
  // GHOST GUARD (header rule 6): recruiting is a high-school courtship.
  // Outside the HS phase, or after the commitment, the staffs are done
  // writing: the per-year season caps reset every January, and a stale
  // lastMoveWeek can collide with a live clock.week years later (the
  // measured bug: an NBA franchise player getting college mail in 2029).
  // The one post-commitment recruiter message is the finalist's door
  // close, built in commitmentCandidates.
  if (career.clock.phase !== 'hs' || rec.committedTo) return;
  rec.interest.forEach((interest, i) => {
    if (interest.closed || interest.lastMoveWeek !== career.clock.week) return;
    const program = rec.programs.find(p => p.id === interest.programId);
    if (!program) return;
    // corroboration: the rung move must have logged its positive
    // recruiting event THIS week (events carry (year, week), so this is
    // the year-aware check the bare lastMoveWeek comparison cannot be).
    // recruiting.ts opens every up-move reason with the program's name.
    const movedThisWeek = eventsThisWeek(career).some(e =>
      e.kind === 'recruiting' && (e.delta ?? 0) > 0 && e.reason.startsWith(program.name));
    if (!movedThisWeek) return;
    // recruiting.ts stamps lastMoveWeek on COOLING drops too, and it logs
    // every drop as a negative-delta recruiting event opening with the
    // program's name. A staff that just cooled does not text you about
    // it: the drop's story lives in the event log, the phone stays quiet.
    const cooled = eventsThisWeek(career).some(e =>
      e.kind === 'recruiting' && (e.delta ?? 0) < 0 && e.reason.startsWith(program.name));
    if (cooled) return;
    const thread: ThreadId = `recruiter:${program.id}`;
    const threadRank = 8 + i;
    const surname = recruiterSurname(career, program.id);
    const refs: PhoneMessage['refs'] = { programId: program.id };

    // the questionnaire rung stays OFF the phone by design: the doc's
    // recruiter thread starts at letters ("letters that become texts
    // that become home visits that become offers"), and a fourteen-
    // program questionnaire wave in one week is the repeated-generic-
    // event killer in person. The event log already tells that story.
    if (interest.rung === 'letter') {
      // quote the most recent real film they could have pulled
      const played = weekRecordsAllSeason(career).filter(r => r.myLine && r.myLine.min > 0);
      const last = played[played.length - 1];
      const variants = last
        ? (() => {
          const oppId = last.myLine!.teamId === last.record.home ? last.record.away : last.record.home;
          const opp = teamNameOf(career, oppId);
          const pts = last.myLine!.pts;
          return [
            `Coach ${surname} watched the ${opp} tape twice. ${pts} points travels. He wants to see it in person this spring`,
            `From the desk of Coach ${surname}: the staff graded your ${opp} game. The ${pts} was not the part that impressed them, but it did not hurt`,
            `${program.name} put a letter in the mail the morning after ${opp}. ${pts} points will do that. The film room found you`,
          ];
        })()
        : [
          `A letter from ${program.name}. Coach ${surname} writes that the staff has opened a file and intends to keep it open`,
          `${program.name} sent a real letter, signed by Coach ${surname} himself. Short, formal, pointed: they are watching now`,
        ];
      out.push({ thread, threadRank, priority: 50, from: `${program.name} Basketball`, variants, refs });
    } else if (interest.rung === 'texts') {
      out.push({
        thread, threadRank, priority: 60, from: `Coach ${surname} (${program.name})`,
        variants: [
          `This is Coach ${surname} at ${program.name}. I would rather talk in your living room than in another letter. When can we come by?`,
          `Coach ${surname} here. Staff meeting ran long because of your tape. I want to sit down with your family. Can we set a date?`,
          `You have my number now. Coach ${surname}, ${program.name}. One home visit, no promises we cannot keep. Say the word`,
        ],
        choices: [
          { id: 'visit-yes', label: 'Set up the visit' },
          { id: 'visit-no', label: 'Not yet' },
        ],
        deadlineWeek: career.clock.week + career.params.phone.decisionDeadlineWeeks,
        refs,
      });
    } else if (interest.rung === 'visit') {
      out.push({
        thread, threadRank, priority: 55, from: `Coach ${surname} (${program.name})`,
        variants: [
          `Coach ${surname} sat in your kitchen for two hours and mostly talked to your mother. That is how the good ones close`,
          `The ${program.name} visit is done. He left a playbook page with your name already written on it. Subtle it was not`,
        ],
        refs,
      });
    } else if (interest.rung === 'offer') {
      const offer = rec.offers.find(o => o.programId === program.id);
      const money = fmtMoney(offer?.money ?? program.nil);
      const role = ROLE_LABEL[offer?.promisedRole ?? program.promisedRole];
      out.push({
        thread, threadRank, priority: 70, from: `Coach ${surname} (${program.name})`,
        variants: [
          `It is official: ${program.name} is offering. A ${role} role and ${money} behind it. Coach ${surname} said the word that matters: committable`,
          `Coach ${surname} called it in himself. Committable offer from ${program.name}: ${role} minutes promised, ${money} on the table`,
          `${program.name}. Committable. ${role} role, ${money}. Hats get bought for mornings like this`,
        ],
        refs,
      });
    }
  });
}

/**
 * My played games this season, in date order, for the recruiter letter's
 * film quote (a letter can reference any tape from the season, not just
 * this week's).
 */
function weekRecordsAllSeason(career: CareerState): WeekRecord[] {
  const out: WeekRecord[] = [];
  if (!career.circuit) return out;
  for (const record of Object.values(career.circuit.results)) {
    const myLine = record.lines.find(l => l.playerId === career.me) ?? null;
    if (myLine) out.push({ record, myLine, rivalLine: null });
  }
  out.sort((a, b) => a.record.date.day - b.record.date.day
    || (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0));
  return out;
}
