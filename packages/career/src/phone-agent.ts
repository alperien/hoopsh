/**
 * phone-agent.ts - the agent's thread (a family advisor until one can
 * legally sign): stock-ladder reads, the pre-draft window flip, and both
 * sides of the promise ledger's conversations. Part of the phone surface;
 * see phone.ts for the discipline rules and module map.
 */
import { promiseContext, promiseGraceGames } from './phone-detect.js';
import { AGENT_MOVE_MIN, ROLE_LABEL, THREAD_RANK, eventsThisWeek, roleIdx } from './phone-shared.js';
import type { Candidate } from './phone-shared.js';
import type { CareerState } from './types.js';

/** The agent's display name for the phase: a family advisor until one can legally sign. */
function agentFrom(career: CareerState): string {
  return career.clock.phase === 'hs' || career.clock.phase === 'college'
    ? 'Uncle Dee (advisor)'
    : 'Marta (agent)';
}

/** The agent (a family advisor until one can legally sign): stock reads, quoting the ladder's own stated reason. Small drifts stay unsent. */
export function agentCandidates(career: CareerState, out: Candidate[]): void {
  const from = agentFrom(career);

  // the draft-class entry week: the file goes real, the tone flips
  // professional (the year-wrap phase event lands in this week's feed)
  const entered = eventsThisWeek(career).some(e =>
    e.kind === 'phase' && e.reason.includes('pre-draft window opens'));
  if (entered) {
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 95,
      from: 'Marta (agent)', tag: 'file',
      variants: [
        'Marta. From this week I represent you, and this stops being a story about potential. The file went to all thirty rooms this morning. Everything you do until June is an exhibit',
        'It is paperwork season. The class list has your name on it as of today. From here the calls come through me, the film speaks for you, and neither of us reads comment sections',
        'Welcome to the pre-draft window. Thirty teams, one file, your name on the cover. Train like the number is wrong in whichever direction keeps you hungry',
        'The advisor era is over. Agent era. Combine, workouts, war rooms. I talk, you play, we pick the suit later',
      ],
    });
  }

  const stock = career.stock;
  if (!stock) return;
  const weekEntries = stock.history.filter(h =>
    h.year === career.clock.year && h.week === career.clock.week);
  const entry = weekEntries[weekEntries.length - 1];
  if (!entry) return;
  const idx = stock.history.lastIndexOf(entry);
  const prev = idx > 0 ? stock.history[idx - 1] : undefined;

  // the ladder's stated reasons are complete sentences in the insider's
  // voice, so the agent forwards them in quotes rather than restating
  // the number they already carry
  let variants: string[] | null = null;
  if (entry.rank === null) {
    variants = [
      `Straight talk: "${entry.reason}". Off the boards this week. The way back on is film they cannot ignore`,
      `"${entry.reason}". No number next to your name right now. That is information, not a verdict`,
      `The boards dropped you. Their reason: "${entry.reason}". We work. We do not scroll`,
    ];
  } else if (!prev || prev.rank === null) {
    variants = [
      `You are a real name now. Their words: "${entry.reason}". Do not read the mocks, that is my job`,
      `It is in print: "${entry.reason}". We stay boring and we keep working`,
      `The market opened on you: "${entry.reason}". I worry about the number, you play`,
    ];
  } else {
    const delta = prev.rank - entry.rank; // +N picks climbed
    if (delta >= AGENT_MOVE_MIN) {
      variants = [
        `Up ${delta} to ${entry.rank}. The wire's line: "${entry.reason}". My phone is doing its job, you keep doing yours`,
        `The boards moved you to ${entry.rank}. Stated reason: "${entry.reason}". Do not read the rest of the page`,
        `${entry.rank} now, ${delta} better than last week. "${entry.reason}". Markets chase. We do not`,
      ];
    } else if (delta <= -AGENT_MOVE_MIN) {
      variants = [
        `Down ${-delta} to ${entry.rank}. "${entry.reason}". Boards overreact on the way down too. We do not`,
        `You will hear you slid to ${entry.rank}. The reason on the wire: "${entry.reason}". It is priced in. Keep playing`,
        `${entry.rank} this week. "${entry.reason}". Nobody remembers a February board in June. Work`,
      ];
    } else if (delta === 0) {
      // a story entry with the number unmoved is a real beat (the combine measurement lands here)
      variants = [
        `"${entry.reason}". The number held at ${entry.rank}. Steady is a result too`,
        `News from the ladder: "${entry.reason}". You sit at ${entry.rank}. No panic in this office`,
      ];
    }
  }
  if (!variants) return; // a 1-2 pick drift is coffee talk, not a phone buzz
  out.push({
    thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 80, from, variants,
  });
}

/**
 * The promise ledger, conducted by the agent (docs/CAREER.md): after
 * params grace games below the promised role, the grievance; on the rung
 * finally reached, the satisfied beat. Both once per promise context,
 * derived states only.
 */
export function promiseCandidates(career: CareerState, out: Candidate[]): void {
  const ctx = promiseContext(career);
  if (!ctx) return;
  const from = agentFrom(career);
  const cur = career.coach.role;
  const curIdx = roleIdx(cur);
  const promIdx = roleIdx(ctx.promised);
  const promLabel = ROLE_LABEL[ctx.promised];
  const curLabel = ROLE_LABEL[cur];

  if (curIdx < promIdx && ctx.games >= promiseGraceGames(career)) {
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 85,
      from, tag: `grv-${ctx.key}`, refs: ctx.refs,
      variants: [
        `Time to talk about the promise. ${ctx.dest} said ${promLabel}; ${ctx.games} games in, you sit at ${curLabel}. That gap is theirs to explain or yours to carry. Which is it going to be?`,
        `I keep a file. ${ctx.dest} promised the ${promLabel} job and after ${ctx.games} games the sheet says ${curLabel}. We can let the film argue for us, or we can make some noise`,
        `${ctx.games} games at ${ctx.dest} and the ${promLabel} promise is still parked at ${curLabel}. I do not forget terms. Tell me how loud to be`,
        `The promise was ${promLabel}. The reality after ${ctx.games} games is ${curLabel}. The grace period is over by my math. Your move, and I back any of them`,
      ],
      choices: [
        { id: 'promise-let-go', label: 'Let it go' },
        { id: 'promise-make-known', label: 'Make it known' },
        { id: 'promise-demand', label: 'Demand action' },
      ],
    });
    return;
  }

  // the promise met: a role move this week carried you across the line
  const rose = eventsThisWeek(career).some(e => e.kind === 'role' && (e.delta ?? 0) > 0);
  if (rose && curIdx >= promIdx && curIdx - 1 < promIdx) {
    out.push({
      thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 70,
      from, tag: `kept-${ctx.key}`, refs: ctx.refs,
      variants: [
        `For the record: ${ctx.dest} said ${promLabel} and you are the ${promLabel}. Kept promises get remembered in this office too`,
        `The file closes clean: promised ${promLabel}, playing ${promLabel}. Rare enough to text about`,
        `They kept their word. ${promLabel}, like the paper said. I like doing business with people like that. Now keep taking the minutes`,
      ],
    });
  }
}
