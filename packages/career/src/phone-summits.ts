/**
 * phone-summits.ts - the payoff bursts that ride outside the season caps:
 * commitment day, draft night (and the undrafted morning after), and the
 * NBA debut. Part of the phone surface; see phone.ts for the discipline
 * rules and module map.
 */
import { streamRng } from '@hoopsh/franchise';
import { committedOffer, debutThisWeek, destOf, draftTxOf, losingFinalist } from './phone-detect.js';
import {
  THREAD_RANK, WIRE_BYLINE, eventsWithinWeeks, meOf, nbaTeamNameOf,
  recruiterSurname,
} from './phone-shared.js';
import type { Candidate } from './phone-shared.js';
import type { CareerState, PhoneMessage } from './types.js';

/**
 * The commitment burst: the payoff of the whole recruiting arc, fired on
 * the committedTo transition (detected by scan plus the once-ever tag,
 * because the signing can happen through a choice OR the signing-day
 * autopick at the year wrap). Three voices in one week: mom with the
 * program's real name, the rival with a needle, and the losing finalist
 * closing the door classy or bitter by stable personality draw. EXEMPT
 * from per-thread season caps: this is the moment the caps exist to
 * protect, and a mom who spent her three texts on openers must still get
 * signing day.
 */
export function commitmentCandidates(career: CareerState, out: Candidate[]): void {
  const phase = career.clock.phase;
  if (phase !== 'hs' && phase !== 'college' && phase !== 'euro' && phase !== 'nbl') return;
  const offer = committedOffer(career);
  if (!offer) return;
  const dest = destOf(career, offer);
  const refs: PhoneMessage['refs'] = offer.programId ? { programId: offer.programId } : {};

  out.push({
    thread: 'family', threadRank: THREAD_RANK.family!, priority: 98,
    from: 'Mom', capExempt: true, tag: 'commit', refs,
    variants: [
      `${dest}. Baby, I said it out loud in the kitchen just to hear it. Your grandmother is already telling the whole church`,
      `I framed the first letter they sent and now I get to hang it. ${dest}. Your father would have driven there tonight`,
      `You picked ${dest} and I cried in the car so you would not see. Proud is too small a word`,
      `${dest}!! I am buying the ugliest sweatshirt they sell and wearing it everywhere, do not fight me on this`,
      `Sat with it all night. ${dest} is getting the kid who shoveled the driveway to get shots up. They have no idea`,
    ],
  });

  const rival = career.players[career.rivalId] ?? career.league.players[career.rivalId];
  if (rival) {
    out.push({
      thread: 'rival', threadRank: THREAD_RANK.rival!, priority: 95,
      from: rival.name, capExempt: true, tag: 'commit', refs: { players: [career.rivalId] },
      variants: [
        `heard about ${dest}. congrats i guess. see you in the bracket before you go`,
        `${dest}? interesting. i would have picked somewhere that actually runs offense`,
        `so it is ${dest}. good. now i know exactly where to find you for the next four years`,
        `everybody keeps sending me your ${dest} announcement. tell them to stop. anyway congrats or whatever`,
      ],
    });
  }

  const loser = losingFinalist(career, offer.programId);
  if (loser) {
    const surname = recruiterSurname(career, loser.program.id);
    const bitter = streamRng(career.seed, 'career-phone-close', loser.program.id).chance(0.5);
    out.push({
      thread: `recruiter:${loser.program.id}`,
      threadRank: 8 + loser.interestIdx,
      priority: 90,
      from: `Coach ${surname} (${loser.program.name})`,
      capExempt: true, tag: 'commit', refs: { programId: loser.program.id },
      variants: bitter
        ? [
          `Saw the news. Committing to ${dest} without a call, after everything this staff put in. Good luck`,
          `So the visit meant nothing. Noted. ${dest} had better be everything they promised`,
          `We held a scholarship for you while other kids begged for it. A text would have been decent. Anyway`,
        ]
        : [
          `Coach ${surname} here. You told us before the wire did, and that counts for something. ${dest} is getting a pro. Our door stays open`,
          `Classy of you to call the staff this morning. Go be great at ${dest}. If it ever stops fitting, you have my number`,
          `No hard feelings from this staff. We recruit kids and we root for the ones we lose. Beat everyone except us`,
        ],
    });
  }
}

/**
 * Draft night, read off the league's real transaction ledger the week
 * after the night resolves (the tick runs the draft after the phone's
 * weekly pass, so the burst lands with the morning-after texts). Four
 * voices: the agent's call naming the pick and the mock gap, mom's room,
 * the rival's pick against mine with his real numbers, and the wire
 * story with the birthplace arc. EXEMPT from caps (header rationale).
 * Undrafted careers get the agent's honest morning-after instead.
 */
export function draftNightCandidates(career: CareerState, out: Candidate[]): void {
  const mine = draftTxOf(career, career.me);

  if (!mine) {
    // sixty names, none of them yours: the stock event is the receipt
    const passed = eventsWithinWeeks(career, 1).some(e =>
      e.kind === 'stock' && e.reason.startsWith('sixty names'));
    if (passed) {
      out.push({
        thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 90,
        from: 'Marta (agent)', capExempt: true, tag: 'undrafted',
        variants: [
          'Sixty names and not ours. I will not spin it. Summer league lists open this morning and I already made two calls. The route changes, the destination does not',
          'No call last night. I know what it cost to watch. Here is what is real: rooms passed on a name, not on a player. We go make the name undeniable',
          'Undrafted. The word stings until you count how many careers started there. Camp invites are the new draft and I am working the phones today',
        ],
      });
    }
    return;
  }

  const team = nbaTeamNameOf(career, mine.teamId);
  const pick = mine.pick;
  const mock = career.stock?.rank ?? null;
  const me = meOf(career);

  // the agent's call: the pick, the team, and the mock-vs-pick gap named
  let agentVariants: string[];
  if (mock === null) {
    agentVariants = [
      `${team}, pick ${pick}. The boards never printed a number for you and a war room just did. That is the only ladder that pays`,
      `No mock had you. ${team} called at ${pick} anyway. Scouts type, rooms decide. Congratulations`,
      `Pick ${pick}, ${team}. The consensus never saw you coming, which makes this my favorite kind of phone call`,
      `${team} at ${pick} and not one board saw it. Enjoy tonight. Tomorrow we are nobody's surprise ever again`,
    ];
  } else if (pick < mock) {
    agentVariants = [
      `${team}, pick ${pick}. Boards had you ${mock}; the room that mattered did not. This is the call I do this job for`,
      `They called at ${pick}. ${team}. The boards said ${mock} this morning and the boards are now recycling. Congratulations, kid`,
      `Pick ${pick} to ${team}. We beat the consensus by ${mock - pick} spots. Sleep tonight, work tomorrow`,
      `Boards ${mock}, reality ${pick}. ${team} paid for the file, not the chatter. This is a good night. Let it be one`,
    ];
  } else if (pick > mock) {
    agentVariants = [
      `${team} at ${pick}. Boards had you ${mock} and rooms got cute. Every one of those ${pick - mock} spots is money they owe you an apology for. We collect on the floor`,
      `You slid to ${pick}. I will not dress it up. ${team} still called, and everybody who passed now schedules you twice a year`,
      `${pick}, ${team}. The boards said ${mock}. The gap is fuel and the rookie scale at ${pick} is a bet on yourself. We like that bet`,
      `Green room got long, I know. ${mock} on the boards, ${pick} on the night. ${team} gets the chip AND the shoulder. Their gain`,
    ];
  } else {
    agentVariants = [
      `${team} at ${pick}, right on the number. The market read you clean for once. Now we outplay the slot anyway`,
      `Pick ${pick}, exactly where the boards had you. ${team}. Boring draft nights make the best careers`,
      `${mock} on the boards, ${pick} on the night. ${team}. The market and the room agreed on you, which almost never happens`,
      `Right on the consensus: ${pick}, ${team}. No drama, all business. My favorite kind of night in this job`,
    ];
  }
  out.push({
    thread: 'agent', threadRank: THREAD_RANK.agent!, priority: 100,
    from: 'Marta (agent)', capExempt: true, tag: 'draftnight',
    refs: { teamId: mine.teamId },
    variants: agentVariants,
  });

  // mom: the room
  out.push({
    thread: 'family', threadRank: THREAD_RANK.family!, priority: 99,
    from: 'Mom', capExempt: true, tag: 'draftnight', refs: { teamId: mine.teamId },
    variants: [
      `The whole room screamed when they said your name. Your uncle knocked over the dip. ${team}. My baby`,
      `I have watched you dribble in the hallway since you were six and tonight a man in a suit said your name on television. ${team}. Pick ${pick}`,
      `Grandma made them replay it four times. Pick ${pick}. I kept the napkin I cried into and that is normal now`,
      `${team}. I do not even know where that is on a map yet, but I know they just got the hardest worker I ever raised`,
      `Everybody is still here eating and yelling. You should hear this house. Pick ${pick}, baby. PICK ${pick}`,
    ],
  });

  // the rival: his pick against mine, real numbers when he has them
  const rival = career.players[career.rivalId] ?? career.league.players[career.rivalId];
  if (rival) {
    const his = draftTxOf(career, career.rivalId);
    let rivalVariants: string[];
    if (his && his.pick < pick) {
      rivalVariants = [
        `${his.pick}. you went ${pick}. i will save you a seat in the lottery suite next time`,
        `they called my name ${pick - his.pick} picks before yours. fifteen years of this and the scoreboard still likes me`,
        `${his.pick} and ${pick}. the draft finally put it in writing. see you on somebody's opening night`,
      ];
    } else if (his) {
      rivalVariants = [
        `fine. ${pick} beats ${his.pick}. enjoy the one night the numbers went your way`,
        `${his.pick} to your ${pick}. whatever. careers are long and i hold grudges professionally`,
        `you went ${pick}, i went ${his.pick}. rooms overthink. floors do not. see you in the league`,
      ];
    } else {
      rivalVariants = [
        `sixty picks and none for me. do not text back. i will see you in summer league and it will be personal`,
        `they passed on me sixty times and called you at ${pick}. congrats, genuinely. now watch what a chip does`,
        `no name for me last night. yours went at ${pick}. keep the jersey clean until i get there`,
      ];
    }
    out.push({
      thread: 'rival', threadRank: THREAD_RANK.rival!, priority: 96,
      from: rival.name, capExempt: true, tag: 'draftnight',
      refs: { players: [career.rivalId] },
      variants: rivalVariants,
    });
  }

  // the wire story: pick, team, the one-line arc from the birthplace
  const home = career.creation.birthplace;
  out.push({
    thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 100,
    from: WIRE_BYLINE, capExempt: true, tag: 'draftnight', refs: { teamId: mine.teamId },
    variants: [
      `From ${home} to pick ${pick}: the ${team} select ${me.name}. The building believed before the boards did`,
      `The ${team} take ${me.name} at pick ${pick}. In ${home} they are honking horns tonight`,
      `Pick ${pick}: ${me.name}, ${team}. Some numbers are just numbers. In ${home}, this one is a street party`,
      `${me.name} to the ${team} at pick ${pick}. The scouts called it a projection. ${home} called it Tuesday`,
    ],
  });
}

/**
 * The NBA debut, mom's side (the coach text builds in coachCandidates,
 * the mentor welcome in mentorCandidates; they share the 'debut' tag and
 * the same detection, so the whole beat lands in one week). EXEMPT from
 * caps: the debut usually shares a career year with a full pre-NBA
 * season that already spent the family budget.
 */
export function debutCandidates(career: CareerState, out: Candidate[]): void {
  const debut = debutThisWeek(career);
  if (!debut) return;
  const pts = debut.line.pts;
  out.push({
    thread: 'family', threadRank: THREAD_RANK.family!, priority: 95,
    from: 'Mom', capExempt: true, tag: 'debut', refs: { gameId: debut.record.id },
    variants: [
      `Your first real one. ${pts} points in an NBA building. I wore the jersey to work and dared anybody to say something`,
      `I watched the whole thing standing up. ${pts} in your first NBA game. Every hallway dribble was worth it`,
      `${pts} points, baby. First one. I recorded it and I am never deleting it. The cable box dies with that game on it`,
      `First NBA game. ${pts}. Your grandmother lit a candle and then talked trash, in that order`,
      `An NBA box score with your name in it. ${pts} points. I printed it. Paper lasts, baby`,
    ],
  });
}
