/**
 * phone-circle.ts - the personal circle's threads: mom, the rival, a
 * teammate after a tournament win, and the vet mentor. Part of the phone
 * surface; see phone.ts for the discipline rules and module map.
 */
import { debutThisWeek, mentorOf, titleGameThisWeek, titleWords } from './phone-detect.js';
import {
  RIVAL_STATEMENT_PTS, THREAD_RANK, eventsThisWeek, fmtScore, meOf, teamNameOf,
  weekRecords,
} from './phone-shared.js';
import type { Candidate } from './phone-shared.js';
import type { CareerState } from './types.js';

/** Family: sparse grounding beats. Mom watches every game and worries about the body; the season caps keep her two or three texts a year, and the payoff nights ride outside them. */
export function familyCandidates(career: CareerState, out: Candidate[]): void {
  const me = meOf(career);
  const events = eventsThisWeek(career);

  // the title game: win or lose, mom is the voice of the biggest night
  const title = titleGameThisWeek(career);
  if (title) {
    const words = titleWords(title.kind);
    out.push({
      thread: 'family', threadRank: THREAD_RANK.family!, priority: 96,
      from: 'Mom', capExempt: true, tag: `fin${career.clock.year}`,
      refs: { gameId: title.record.id },
      variants: title.champion
        ? [
          `You are a ${words.champion}. I said it out loud three times in the parking lot just to hear it. Tonight's ticket goes in a frame`,
          `${title.score}. A ${words.champion}. I hugged strangers, baby. STRANGERS`,
          `My son the ${words.champion}. I am not sleeping and I do not care. I am reliving ${title.score} until the sun comes up`,
          `A ${words.champion}! Your grandmother heard me scream from the porch. Come home safe, the cake goes in the oven the second you text back`,
          `They can never take tonight away. ${words.champion}. I kept every ticket this season and this one gets the frame`,
        ]
        : [
          `${title.score}. I know, baby. I kept the ticket anyway. I keep them all, that is where the whole story lives`,
          `You lost ${words.theFinal} tonight and I watched you shake their hands like a grown man anyway. The ticket stays in my purse. So does the pride`,
          `Not tonight. ${title.score}. Soup is on when you get home and we are not talking about it unless you want to`,
          `I saw the ending. I also saw the season. Tonight's ticket goes in the shoebox with all the others, and one day you will want it`,
        ],
    });
  }

  // commitment day: real feelings, the program's actual name
  // (built in commitmentCandidates so the burst stays in one place)

  // draft and debut nights are built in their own burst builders (phone-summits.ts)

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
        `The trainer talked to me because you would not. ${me.health.injury.label}, ${weeks} ${weekWord}. Healing is training too, do not argue with your mother`,
        `I do not care about the standings, I care about the landing. ${weeks} ${weekWord} means ${weeks} ${weekWord}. We will do puzzles`,
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
            `Opening night again. ${myLine.pts} points, and you found me in the stands before tipoff like always. That is my favorite part and it is not close`,
            `${myLine.pts} in the opener. New season, same third row. I brought your cousin and she is hoarse now`,
            `Season one game old and you already gave them ${myLine.pts}. The whole drive home was radio and grinning`,
          ]
          : [
            `${myLine.pts} points. They got the game but I saw you out there. Long season, baby`,
            `Opening night did not go your way. ${myLine.pts} still came home with you. Soup is on the stove`,
            `They tell me the first one matters least. ${myLine.pts} points says you showed up anyway`,
            `An opener is a comma, not a period. ${myLine.pts} points. Eat something and call me tomorrow`,
            `${myLine.pts} on opening night. They were bigger. You were braver. The season is long and I have snacks`,
            `First game went to them. Your ${myLine.pts} still happened, I counted every one. Bed early tonight`,
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
        `You are running on fumes, I can hear it in your texts even. Sunday. One afternoon will not cost you the season, it might save it`,
        `I know that empty-tank look even through a screen. Home Sunday, plate of real food, back by dark. Deal?`,
      ],
      choices: [
        { id: 'family-go', label: 'Go home Sunday' },
        { id: 'family-stay', label: 'Stay in the gym' },
      ],
    });
  }
}

/** The rival: head-to-heads get a needle with stakes; his statement lines elsewhere get a read-only jab. He always texts first. */
export function rivalCandidates(career: CareerState, out: Candidate[]): void {
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

/** A teammate after a tournament win: pure texture, read-only, teenage volume without internet slang. */
export function teammateCandidates(career: CareerState, out: Candidate[]): void {
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
        `${score}. i have watched the last play nine times. NINE. we are actually good`,
        `coach let the locker room music stay on after ${round}. ${score}. historic night all around`,
        `my mom cried, your mom cried, i think the ref almost cried. ${score}. gym at six because i cannot sleep anyway`,
        `they are printing shirts. SHIRTS. ${score} in ${round} and we are on a shirt`,
      ],
      refs: { players: [mate], gameId: record.id },
    });
  }
}

/**
 * The vet mentor (docs/CAREER.md: lessons, loyalty, perspective): the
 * oldest teammate past thirty on my NBA roster. Two state-backed beats:
 * the debut welcome and the demotion-week perspective. No mentor in the
 * room, no thread.
 */
export function mentorCandidates(career: CareerState, out: Candidate[]): void {
  const mentor = mentorOf(career);
  if (!mentor) return;
  const age = career.league.season - mentor.bornSeason;
  const from = `${mentor.name} (vet)`;

  const debut = debutThisWeek(career);
  if (debut) {
    out.push({
      thread: 'mentor', threadRank: THREAD_RANK.mentor!, priority: 80,
      from, tag: 'debut', refs: { players: [mentor.id], gameId: debut.record.id },
      variants: [
        `${mentor.name}. rook. shootaround comes an hour early with me from now on. first lesson is free: this league tests your sleep before it tests your handle`,
        `good first one, rook. ${age} years old means i have already made every mistake you are about to. sit next to me on the plane`,
        `saw the debut. real minutes, real nerves, real player. rule one in this room: vets eat first, rooks carry the film bag, everybody guards`,
        `welcome to the show, rook. one thing worth texting after game one: be early, everywhere, always. the rest we cover at practice`,
      ],
    });
  }

  const demoted = eventsThisWeek(career).some(e => e.kind === 'role' && (e.delta ?? 0) < 0);
  if (demoted) {
    out.push({
      thread: 'mentor', threadRank: THREAD_RANK.mentor!, priority: 60,
      from, refs: { players: [mentor.id] },
      variants: [
        `heard about the role. i have been benched by better teams than this one, rook. the ones who last treat it like weather`,
        `role news reached my locker before you did. i lost my starting job twice and took it back twice. the tape is the only appeal that works`,
        `do not sulk past thursday. this league forgets sulkers and promotes workers. i have watched it happen for a decade`,
        `benches are where pros get made. tourists complain, residents renovate. be a resident this week`,
      ],
    });
  }
}
