/**
 * phone.ts - the career mode's narrative surface: a diegetic message
 * inbox with zero cutscenes (docs/CAREER.md, The phone). OWNER: phone
 * task. STATUS: implemented (build wave B).
 *
 * Discipline, in priority order:
 * 1. State-backed, always. Every message quotes real state: the actual
 *    grade note from coach.grades, the actual rung move in
 *    recruiting.interest, the actual stock reason from stock.history,
 *    the rival's actual box line from the circuit results. If the state
 *    did not happen, the message does not exist. A week with nothing
 *    real to say produces zero messages; silence is content.
 * 2. Few and consequential. Hard per-thread season caps
 *    (params.phone.capsPerSeason) plus the burst guard
 *    (params.phone.threadCooldownWeeks). Recruiter threads carry their
 *    own in-module cap because the frozen params shape holds no
 *    recruiter key (a program's whole season arc is about five beats).
 * 3. Character voices, no memes. The coach texts terse and film-first
 *    in lowercase; mom watches every game and worries about the body;
 *    the agent is transactional and slightly too smooth; the rival
 *    needles; media asks loaded questions; recruiters write in the
 *    formal register. Distinct with the name covered.
 * 4. Choices only where a real decision exists: scheduling the
 *    recruiting visit, answering media, engaging the rival, the family
 *    ask. Everything else is read-only texture; no quiz bolted onto it.
 * 5. Every consequence explained: applyPhoneChoice appends CareerEvents
 *    with nonempty reasons (the explained-consequence lint reads them).
 *
 * Streams (career.seed root, franchise rng.ts doctrine):
 *   career-phone:<year>:<week>       phrasing-variant picks; exactly one
 *                                    int draw per ADMITTED message, in
 *                                    admission order, so draw counts are
 *                                    a pure function of state
 *   career-phone-coach:<programId>   a program's recruiting coach
 *                                    surname; no week in the path
 *                                    because the man does not change
 *                                    names between letters
 */
import { clamp } from '@hoopsh/engine';
import { streamRng } from '@hoopsh/franchise';
import type { FrPlayer, GameLine, GameRecord } from '@hoopsh/franchise';
import type {
  CareerEvent, CareerState, GameGrade, InterestRung, PhoneChoice,
  PhoneMessage, Program, RoleId, ThreadId,
} from './types.js';

// ---------------------------------------------------------------------------
// module constants (message texture; the sweepable frequency levers live in
// params.phone)

/** FEEL: per-program season cap. The whole recruiting arc is questionnaire, letter, texts, visit, offer: five beats plus one nudge of slack. The frozen params shape carries no recruiter key, so the cap lives here. */
const RECRUITER_CAP_PER_SEASON = 6;

/** FEEL: the line that makes a beat writer drive over (mirrors stock.ts SHOCK_GAME_PTS: the 30-point game is the doc's own named shock). */
const MEDIA_GAME_PTS = 30;

/** FEEL: the rival line that earns an unprompted needle from another gym. */
const RIVAL_STATEMENT_PTS = 28;

/** FEEL: mock-ladder moves smaller than this stay between the agent and his coffee; the thread only carries moves worth a phone buzz. */
const AGENT_MOVE_MIN = 3;

/** FEEL: adherence under this reads as a night meaningfully off the plan (trust.ts scales deviation so ~20 points of dial overflow lands here). */
const OFF_SCRIPT_ADHERENCE = 60;

/** FEEL: perceived-interest points a scheduled in-home visit buys (the staff sees the family, the family sees the staff). */
const VISIT_PERCEIVED_BUMP = 3;

/** FEEL: perceived-interest points a polite no costs (coaches remember). */
const VISIT_DECLINE_COOL = 2;

/** FEEL: morale swing for owning the media moment / crediting the room / no-commenting it away. */
const MEDIA_MORALE = { lean: 3, team: 1, shrug: -1 } as const;

/** FEEL: morale stakes of the rival thread: flexing a win feels great, talking back after a loss hands him receipts, leaving him on read is quiet discipline either way. */
const RIVAL_MORALE = { replyWon: 3, replyLost: -2, mute: 1 } as const;

/** FEEL: the family ask. Going home restores the person and costs some rest; saying no sits wrong for a few days. */
const FAMILY_GO_MORALE = 4;
const FAMILY_GO_ENERGY = -8;
const FAMILY_STAY_MORALE = -2;

/** Fictional recruiting-coach surname pool (program identity flavor, not @hoopsh/data content). */
const RECRUITER_SURNAMES: readonly string[] = [
  'Hartley', 'Reyes', 'Calhoun', 'Brandt', 'Okafor', 'Marchetti', 'Doyle',
  'Whitfield', 'Kessler', 'Aldana', 'Pruitt', 'Novak', 'Beaumont', 'Rucker',
  'Sandoval', 'Tillman',
];

/** Interest ladder, in climb order (types.ts InterestRung doc). */
const RUNG_ORDER: readonly InterestRung[] = [
  'none', 'questionnaire', 'letter', 'texts', 'visit', 'offer',
];

/** Fixed admission order across threads: byte-stable output and draw order. Recruiter threads rank after the named eight, in interest-array order. */
const THREAD_RANK: Record<string, number> = {
  coach: 0, agent: 1, family: 2, rival: 3, media: 4, teammate: 5, mentor: 6, wire: 7,
};

/** Human label per role for message copy ('sixthMan' reads wrong in a text). */
const ROLE_LABEL: Record<RoleId, string> = {
  garbage: 'garbage-time', bench: 'bench', rotation: 'rotation',
  sixthMan: 'sixth man', starter: 'starter', featured: 'featured', franchise: 'franchise',
};

// ---------------------------------------------------------------------------
// shared lookups

/** Me, wherever I currently live (career.players pre-entry, league.players after). */
function meOf(career: CareerState): FrPlayer {
  const me = career.players[career.me] ?? career.league.players[career.me];
  if (!me) throw new Error('career/phone: my player is missing from both pools');
  return me;
}

/** '$180,000' without locale machinery (byte-stable across platforms). */
function fmtMoney(n: number): string {
  return `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function rungIdx(r: InterestRung): number {
  return RUNG_ORDER.indexOf(r);
}

/** Display name for a game participant's team, from the circuit first, the league second, the raw id as the honest last resort. */
function teamNameOf(career: CareerState, teamId: string): string {
  const ct = career.circuit?.teams.find(t => t.id === teamId);
  if (ct) return ct.name;
  return career.league.teams[teamId]?.name ?? teamId;
}

/** The stable, career-long surname of a program's recruiting coach. */
function recruiterSurname(career: CareerState, programId: string): string {
  return streamRng(career.seed, 'career-phone-coach', programId).pick(RECRUITER_SURNAMES);
}

/** '58-52' with the winner first: how a final gets texted. */
function fmtScore(final: [number, number]): string {
  const hi = Math.max(final[0], final[1]);
  const lo = Math.min(final[0], final[1]);
  return `${hi}-${lo}`;
}

interface WeekRecord {
  record: GameRecord;
  myLine: GameLine | null;
  rivalLine: GameLine | null;
}

/**
 * This week's finished games that can carry a message: circuit results
 * dated to the current career week plus, in the NBA phase, league results
 * inside the current league-day window (the week tick advances
 * params.tick.leagueDaysPerWeek days per career week). Sorted by game id:
 * result maps iterate in insertion order, which is deterministic but not
 * a contract worth leaning on.
 */
function weekRecords(career: CareerState): WeekRecord[] {
  const out: WeekRecord[] = [];
  const add = (record: GameRecord): void => {
    out.push({
      record,
      myLine: record.lines.find(l => l.playerId === career.me) ?? null,
      rivalLine: record.lines.find(l => l.playerId === career.rivalId) ?? null,
    });
  };
  if (career.circuit) {
    for (const record of Object.values(career.circuit.results)) {
      if (record.date.season === career.clock.year && record.date.day === career.clock.week) add(record);
    }
  }
  if (career.clock.phase === 'nba') {
    const windowStart = career.league.day - career.params.tick.leagueDaysPerWeek;
    for (const record of Object.values(career.league.results)) {
      if (record.date.season === career.league.season
        && record.date.day > windowStart && record.date.day <= career.league.day) add(record);
    }
  }
  out.sort((a, b) => (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0));
  return out;
}

/** Events already logged for the current (year, week): the week's real deltas. */
function eventsThisWeek(career: CareerState): CareerEvent[] {
  return career.events.filter(e =>
    e.clock.year === career.clock.year && e.clock.week === career.clock.week);
}

/** The record a grade points at, wherever it lives. */
function recordForGrade(career: CareerState, grade: GameGrade): GameRecord | null {
  return career.circuit?.results[grade.gameId]
    ?? career.league.results[grade.gameId]
    ?? null;
}

/** Whether a record's date sits in the current career week (circuit weeks) or the current NBA-phase day window. */
function recordIsThisWeek(career: CareerState, record: GameRecord): boolean {
  if (career.circuit?.results[record.id]) {
    return record.date.season === career.clock.year && record.date.day === career.clock.week;
  }
  if (career.clock.phase !== 'nba') return false;
  const windowStart = career.league.day - career.params.tick.leagueDaysPerWeek;
  return record.date.season === career.league.season
    && record.date.day > windowStart && record.date.day <= career.league.day;
}

// ---------------------------------------------------------------------------
// candidates: everything the week COULD say, before caps and cooldowns

interface Candidate {
  thread: ThreadId;
  /** admission rank across threads (THREAD_RANK or 8+ for recruiters) */
  threadRank: number;
  /** within-thread priority; the burst guard keeps one message a week, so the biggest beat wins the slot */
  priority: number;
  from: string;
  /** fully interpolated phrasings; the weekly stream picks one */
  variants: string[];
  choices?: PhoneChoice[];
  deadlineWeek?: number;
  refs?: PhoneMessage['refs'];
}

/** The coach's one text for the week: a role move outranks any single night; a night off the script outranks a clean one (that is who he is). */
function coachCandidates(career: CareerState, out: Candidate[]): void {
  const t = career.params.trust;
  const roleLabel = ROLE_LABEL[career.coach.role];

  // a role move this week: the only place role conversations happen
  const roleEv = eventsThisWeek(career).filter(e => e.kind === 'role').pop();
  if (roleEv) {
    const up = (roleEv.delta ?? 0) > 0;
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 100,
      from: career.coach.name,
      variants: up
        ? [
          `talked to the staff. the ${roleLabel} job is yours. ${roleEv.reason}. do not make me regret the call`,
          `new plan sheet this week. ${roleLabel} minutes. you earned it: ${roleEv.reason}`,
          `you are my ${roleLabel} now. ${roleEv.reason}. the standard moves with the job`,
        ]
        : [
          `moving you to ${roleLabel} for now. ${roleEv.reason}. the door back is the same door you came in`,
          `role talk after practice. you are at ${roleLabel}. ${roleEv.reason}. the tape does not lie and neither do i`,
          `this is not personal, it is the film: ${roleEv.reason}. ${roleLabel} until it turns`,
        ],
    });
  }

  // the week's graded nights: keep the loudest one (later game wins ties)
  let best: { priority: number; grade: GameGrade; record: GameRecord; pts: number } | null = null;
  for (const grade of career.coach.grades) {
    const record = recordForGrade(career, grade);
    if (!record || !recordIsThisWeek(career, record)) continue;
    const line = record.lines.find(l => l.playerId === career.me);
    if (!line || line.min <= 0) continue; // a DNP got its grade note; no text on top
    const offScript = grade.adherence < OFF_SCRIPT_ADHERENCE;
    const hot = grade.production >= t.promoteAt;
    const cold = grade.production <= t.demoteAt;
    const priority = offScript && hot ? 90 : offScript ? 85 : hot ? 80 : cold ? 70 : 0;
    if (priority === 0) continue; // an ordinary night inside the plan needs no text
    if (!best || priority >= best.priority) best = { priority, grade, record, pts: line.pts };
  }
  if (best) {
    const { grade, record, pts } = best;
    const offScript = grade.adherence < OFF_SCRIPT_ADHERENCE;
    const hot = grade.production >= t.promoteAt;
    const variants = offScript && hot
      ? [
        `${pts} is ${pts}. the plan was not. i graded you ${grade.adherence} on staying inside it. film thursday`,
        `i will take the ${pts}. i will not take how we got there. my book says "${grade.note}"`,
        `good ${pts}. wrong script. bring your shoes to film, we are walking every possession we called`,
        `${pts} points, graded ${grade.adherence} against the plan. one of those numbers is a problem. thursday`,
      ]
      : offScript
        ? [
          `the plan is not a suggestion. ${grade.adherence} on staying inside it and ${pts} to show for the freelancing. film`,
          `my note from tonight reads "${grade.note}". we are watching it together`,
          `you hunted outside what we called and it got you ${pts}. the tape does not blink. monday, early`,
          `graded ${grade.adherence} against the plan. that is not a talent problem, it is a choices problem. come see me`,
        ]
        : hot
          ? [
            `${pts} inside the offense. that is the whole idea. same again next game`,
            `graded you ${grade.production} for the night. the plan works when you work it`,
            `${pts} and nothing forced. watched it back twice. this is the standard now`,
            `that is what the job looks like. ${pts}. get your rest`,
          ]
          : [
            `rough one. ${pts} points and the book says "${grade.note}". next practice is the answer`,
            `everyone has a ${pts}-point night in them. what matters is what tuesday looks like. be early`,
            `not your night. graded ${grade.production} for the ${roleLabel} job. we go back to basics this week`,
            `saw it. ${pts}. no speech, just work. first drill is yours tomorrow`,
          ];
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: best.priority,
      from: career.coach.name, variants, refs: { gameId: record.id },
    });
  }
}

/** The agent (a family advisor until one can legally sign): stock reads, quoting the ladder's own stated reason. Small drifts stay unsent. */
function agentCandidates(career: CareerState, out: Candidate[]): void {
  const stock = career.stock;
  if (!stock) return;
  const weekEntries = stock.history.filter(h =>
    h.year === career.clock.year && h.week === career.clock.week);
  const entry = weekEntries[weekEntries.length - 1];
  if (!entry) return;
  const idx = stock.history.lastIndexOf(entry);
  const prev = idx > 0 ? stock.history[idx - 1] : undefined;

  const from = career.clock.phase === 'hs' || career.clock.phase === 'college'
    ? 'Uncle Dee (advisor)'
    : 'Marta (agent)';

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

/** Family: sparse grounding beats. Mom watches every game and worries about the body; the season caps keep her two or three texts a year. */
function familyCandidates(career: CareerState, out: Candidate[]): void {
  const me = meOf(career);
  const events = eventsThisWeek(career);

  // a new injury this week (week.ts logs it with a negative delta; the clearance event carries none)
  const hurt = events.some(e => e.kind === 'injury' && (e.delta ?? 0) < 0);
  if (hurt && me.health.injury) {
    const weeks = Math.max(1, Math.round(me.health.injury.outDays / 7));
    const weekWord = weeks === 1 ? 'week' : 'weeks';
    out.push({
      thread: 'family', threadRank: THREAD_RANK.family!, priority: 90, from: 'Mom',
      variants: [
        `Saw you limp off. Coach says about ${weeks} ${weekWord}. Ice it like your uncle never did`,
        `They told me ${me.health.injury.label}, ${weeks} ${weekWord}. The gym will still be there. Let it heal`,
        `I watched it back twice to see how you landed. ${me.health.injury.label}. Rest means rest, baby`,
      ],
    });
  }

  // the season opener: mom is in the stands for the first one every year
  // (the docs promise two or three family beats a season; the opener is
  // the reliable one, injuries and empty tanks are the conditional ones)
  if (career.circuit) {
    let playedThisSeason = 0;
    for (const record of Object.values(career.circuit.results)) {
      const l = record.lines.find(x => x.playerId === career.me);
      if (l && l.min > 0) playedThisSeason += 1;
    }
    const playedThisWeek = weekRecords(career).filter(r => r.myLine && r.myLine.min > 0);
    // opener week = every game I have played this season happened this
    // week (school ball plays twice a week, so counting games instead of
    // weeks would let the opener slip past unremarked)
    if (playedThisSeason > 0 && playedThisSeason === playedThisWeek.length) {
      const record = playedThisWeek[0]!.record; // mom texts about the first one, not the best one
      const myLine = playedThisWeek[0]!.myLine!;
      const myHome = myLine.teamId === record.home;
      const won = myHome ? record.final[0] > record.final[1] : record.final[1] > record.final[0];
      out.push({
        thread: 'family', threadRank: THREAD_RANK.family!, priority: 70, from: 'Mom',
        variants: won
          ? [
            `First one of the season and you gave me ${myLine.pts} points. I clapped too loud and I am not sorry`,
            `Opening night, ${myLine.pts} points, a win. Eat something real tonight, not gas station food`,
            `Season is open. ${myLine.pts} from my seat in the third row. I kept the ticket`,
          ]
          : [
            `${myLine.pts} points. They got the game but I saw you out there. Long season, baby`,
            `Opening night did not go your way. ${myLine.pts} still came home with you. Soup is on the stove`,
            `They tell me the first one matters least. ${myLine.pts} points says you showed up anyway`,
          ],
        refs: { gameId: record.id },
      });
    }
  }

  // running on empty: the allocation logged it, mom saw it in the free throws
  const gassed = events.some(e => e.kind === 'energy' && e.reason.startsWith('running on empty'));
  if (gassed) {
    out.push({
      thread: 'family', threadRank: THREAD_RANK.family!, priority: 60, from: 'Mom',
      variants: [
        `You look tired on the stream. A mother can tell from the free throws. Come home Sunday, I am cooking`,
        `All that gym time and you think I cannot see it in your legs. Sunday dinner. Bring your laundry`,
        `Grandma asked why you look skinny. I told her you are running on fumes. Sunday? ❤️`,
      ],
      choices: [
        { id: 'family-go', label: 'Go home Sunday' },
        { id: 'family-stay', label: 'Stay in the gym' },
      ],
    });
  }
}

/** The rival: head-to-heads get a needle with stakes; his statement lines elsewhere get a read-only jab. He always texts first. */
function rivalCandidates(career: CareerState, out: Candidate[]): void {
  const rival = career.players[career.rivalId] ?? career.league.players[career.rivalId];
  if (!rival) return;
  for (const { record, myLine, rivalLine } of weekRecords(career)) {
    if (!rivalLine) continue;
    if (myLine && myLine.min > 0 && rivalLine.teamId !== myLine.teamId) {
      // the head-to-head: stakes for whoever answers
      const myHome = myLine.teamId === record.home;
      const iWon = myHome ? record.final[0] > record.final[1] : record.final[1] > record.final[0];
      const score = fmtScore(record.final);
      const myReb = myLine.orb + myLine.drb;
      out.push({
        thread: 'rival', threadRank: THREAD_RANK.rival!, priority: 90, from: rival.name,
        variants: iWon
          ? [
            `enjoy it. i still put up ${rivalLine.pts} in your gym. run it back in the bracket`,
            `${score}. refs liked you tonight. they usually do`,
            `you got the win, i got ${rivalLine.pts}. we both know which one travels`,
          ]
          : [
            `${myLine.pts} and ${myReb} huh. cute`,
            `checked the box score twice to make sure. ${myLine.pts} points. see you next time`,
            `${score}. i would say good game but you were there`,
            `everybody said you were the problem tonight. ${myLine.pts} points of problem apparently`,
          ],
        choices: iWon
          ? [
            { id: 'reply-won', label: 'Send him the scoreboard' },
            { id: 'rival-mute', label: 'Leave him on read' },
          ]
          : [
            { id: 'reply-lost', label: 'Say something back' },
            { id: 'rival-mute', label: 'Leave him on read' },
          ],
        refs: { players: [career.rivalId], gameId: record.id },
      });
    } else if (!myLine && rivalLine.pts >= RIVAL_STATEMENT_PTS) {
      // his big night in somebody else's gym
      const oppId = rivalLine.teamId === record.home ? record.away : record.home;
      const opp = teamNameOf(career, oppId);
      out.push({
        thread: 'rival', threadRank: THREAD_RANK.rival!, priority: 50, from: rival.name,
        variants: [
          `${rivalLine.pts} on ${opp} tonight. you keeping count over there or should i keep you posted`,
          `${opp} tried to double me. ${rivalLine.pts}. anyway how was your week`,
          `scoreboard says ${rivalLine.pts}. just making sure your phone still works`,
        ],
        refs: { players: [career.rivalId], gameId: record.id },
      });
    }
  }
}

/** The beat writer: rare, loaded, consequence-backed. A statement line or a fresh role move earns a question; nothing else does. */
function mediaCandidates(career: CareerState, out: Candidate[]): void {
  const choices: PhoneChoice[] = [
    { id: 'media-lean', label: 'Own it' },
    { id: 'media-team', label: 'Credit the room' },
    { id: 'media-shrug', label: 'No comment' },
  ];

  // the statement game travels (the doc names the 30-point night the shock that moves boards)
  let big: { pts: number; opp: string; gameId: string } | null = null;
  for (const { record, myLine } of weekRecords(career)) {
    if (!myLine || myLine.pts < MEDIA_GAME_PTS) continue;
    if (!big || myLine.pts > big.pts) {
      const oppId = myLine.teamId === record.home ? record.away : record.home;
      big = { pts: myLine.pts, opp: teamNameOf(career, oppId), gameId: record.id };
    }
  }
  if (big) {
    out.push({
      thread: 'media', threadRank: THREAD_RANK.media!, priority: 80,
      from: 'Dana Marsh (beat writer)',
      variants: [
        `${big.pts} against ${big.opp}. People around this circuit say you are the best player in it. Are they right?`,
        `On the record: ${big.pts} points. The word scouts keep reaching for with you is ceiling. What word would you use?`,
        `${big.pts} on ${big.opp}. Your coach preaches the system. Was that the system tonight, or was that you?`,
      ],
      choices, refs: { gameId: big.gameId },
    });
  }

  // a promotion is a story with a microphone in it
  const promo = eventsThisWeek(career).filter(e => e.kind === 'role' && (e.delta ?? 0) > 0).pop();
  if (promo) {
    const roleLabel = ROLE_LABEL[career.coach.role];
    out.push({
      thread: 'media', threadRank: THREAD_RANK.media!, priority: 60,
      from: 'Dana Marsh (beat writer)',
      variants: [
        `The ${roleLabel} move is official. Quick quote for tomorrow: did the coaches catch up to you, or did you catch up to the job?`,
        `You are the ${roleLabel} now. On the record: is the job yours to keep, or is somebody else's name still on the door?`,
      ],
      choices,
    });
  }
}

/** A teammate after a tournament win: pure texture, read-only, teenage volume without internet slang. */
function teammateCandidates(career: CareerState, out: Candidate[]): void {
  const circuit = career.circuit;
  if (!circuit) return;
  const myTeamId = circuit.teams[circuit.myTeamIdx]?.id;
  if (!myTeamId) return;
  const mate = circuit.teams[circuit.myTeamIdx]!.starters.find(pid => pid !== career.me);
  const mateName = mate ? career.players[mate]?.name : undefined;
  if (!mate || !mateName) return;

  for (const { record } of weekRecords(career)) {
    if (record.home !== myTeamId && record.away !== myTeamId) continue;
    const game = [...circuit.schedule, ...circuit.bracket].find(g => g.id === record.id);
    if (!game || game.type === 'regular') continue;
    const weWon = record.home === myTeamId
      ? record.final[0] > record.final[1]
      : record.final[1] > record.final[0];
    if (!weWon) continue;
    const round = game.round === 'F' ? 'the final'
      : game.round === 'SF' ? 'the semifinal'
        : game.round === 'QF' ? 'the quarterfinal'
          : game.round === 'R16' ? 'the round of 16'
            : game.type === 'confTourney' ? 'the conference tournament' : 'the bracket';
    const score = fmtScore(record.final);
    out.push({
      thread: 'teammate', threadRank: THREAD_RANK.teammate!, priority: 40,
      from: `${mateName} (teammate)`,
      variants: [
        `${score}. we are through ${round}. gym is going to be LOUD next week`,
        `won ${round} ${score}. coach smiled. he actually smiled`,
        `${score} in ${round}. i am not sleeping tonight and honestly neither should you`,
      ],
      refs: { players: [mate], gameId: record.id },
    });
  }
}

/** Recruiters: one thread per program, each beat driven by the interest ladder's actual rung move this week. Formal on paper, warmer by text, exactly like the real arc. */
function recruiterCandidates(career: CareerState, out: Candidate[]): void {
  const rec = career.recruiting;
  if (!rec) return;
  rec.interest.forEach((interest, i) => {
    if (interest.closed || interest.lastMoveWeek !== career.clock.week) return;
    const program = rec.programs.find(p => p.id === interest.programId);
    if (!program) return;
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

// ---------------------------------------------------------------------------
// generatePhone

/**
 * Generate this week's messages from state deltas. Called once per career
 * week by week.ts AFTER games are graded and the systems have pulsed, so
 * everything below reads settled state. Returns messages; the caller owns
 * pushing them into career.phone (and dedupes on id).
 *
 * Admission: candidates build in a fixed order, sort by (thread rank,
 * priority), then pass the season cap and the burst guard per thread.
 * One rng int draw per ADMITTED message keeps the stream a pure function
 * of state, which is what makes two identical careers read identically.
 */
export function generatePhone(career: CareerState): PhoneMessage[] {
  const { year, week } = career.clock;
  const caps = career.params.phone.capsPerSeason;
  const cooldown = career.params.phone.threadCooldownWeeks;

  const candidates: Candidate[] = [];
  coachCandidates(career, candidates);
  agentCandidates(career, candidates);
  familyCandidates(career, candidates);
  rivalCandidates(career, candidates);
  mediaCandidates(career, candidates);
  teammateCandidates(career, candidates);
  recruiterCandidates(career, candidates);
  if (candidates.length === 0) return []; // silence is content

  // stable admission order: thread rank, then priority, then build order
  const indexed = candidates.map((c, i) => ({ c, i }));
  indexed.sort((a, b) =>
    a.c.threadRank - b.c.threadRank || b.c.priority - a.c.priority || a.i - b.i);

  const capFor = (thread: ThreadId): number => {
    if (thread.startsWith('recruiter:')) return RECRUITER_CAP_PER_SEASON;
    const key = thread as keyof typeof caps;
    return caps[key] ?? 0; // threads without a cap entry (wire) stay silent here
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
  const messages: PhoneMessage[] = [];

  for (const { c } of indexed) {
    const already = admittedPerThread[c.thread] ?? 0;
    if (cooldown > 0 && already > 0) continue; // one message per thread per week under the burst guard
    const last = lastWeekOf(c.thread);
    if (cooldown > 0 && last !== null && week - last < cooldown) continue;
    if (seasonCount(c.thread) + already >= capFor(c.thread)) continue;

    const body = c.variants[rng.int(c.variants.length)]!;
    const msg: PhoneMessage = {
      id: `ph-${c.thread}-${year}w${week}-${already}`,
      clock: { ...career.clock },
      thread: c.thread,
      from: c.from,
      body,
    };
    if (c.choices) msg.choices = c.choices.map(ch => ({ ...ch }));
    if (c.deadlineWeek !== undefined) msg.deadlineWeek = c.deadlineWeek;
    if (c.refs) msg.refs = c.refs;
    admittedPerThread[c.thread] = already + 1;
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

  // a choice id this module never generated: refuse rather than guess
  return { ok: false, errors: [`career/phone: unhandled choice '${choiceId}' on message '${messageId}'`] };
}
