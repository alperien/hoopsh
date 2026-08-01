/**
 * phone-press.ts - the press threads: the beat writer's loaded questions
 * and the wire desk's stories under its one fixed byline. Part of the
 * phone surface; see phone.ts for the discipline rules and module map.
 */
import {
  MEDIA_BLOWOUT_MARGIN, MEDIA_GAME_PTS, MEDIA_STREAK_GAMES, MILESTONE_STEP,
  ROLE_LABEL, SLUMP_MIN_GAMES, SLUMP_RATIO, SLUMP_WINDOW_GAMES, THREAD_RANK,
  WIRE_BYLINE, alreadySent, eventsThisWeek, eventsWithinWeeks, fmtNum, fmtScore,
  meOf, round1, teamNameOf, weekRecords,
} from './phone-shared.js';
import type { Candidate } from './phone-shared.js';
import type { CareerState } from './types.js';

/**
 * Media context for the week: which loaded question the beat writer gets
 * to ask. Angles key to real, checkable state (the statement line, the
 * fresh role move, the blowout margin, the rivalry box score, the live
 * win streak, the measured slump), never to a generic quiz.
 */
export function mediaCandidates(career: CareerState, out: Candidate[]): void {
  const from = 'Dana Marsh (beat writer)';
  const records = weekRecords(career);
  const playedThisWeek = records.filter(r => r.myLine && r.myLine.min > 0);

  // the statement game travels (the doc names the 30-point night the shock that moves boards)
  let big: { pts: number; opp: string; gameId: string } | null = null;
  for (const { record, myLine } of records) {
    if (!myLine || myLine.pts < MEDIA_GAME_PTS) continue;
    if (!big || myLine.pts > big.pts) {
      const oppId = myLine.teamId === record.home ? record.away : record.home;
      big = { pts: myLine.pts, opp: teamNameOf(career, oppId), gameId: record.id };
    }
  }
  if (big) {
    out.push({
      thread: 'media', threadRank: THREAD_RANK.media!, priority: 80, from,
      variants: [
        `${big.pts} against ${big.opp}. People around this circuit say you are the best player in it. Are they right?`,
        `On the record: ${big.pts} points. The word scouts keep reaching for with you is ceiling. What word would you use?`,
        `${big.pts} on ${big.opp}. Your coach preaches the system. Was that the system tonight, or was that you?`,
        `${big.pts} tonight. Off-the-record answers make better quotes, so: how much of that was anger?`,
        `The ${big.pts}-point night will travel. When the calls start coming, and they will, what do you want them to have watched?`,
        `${big.pts} on ${big.opp} and the gym went quiet in the third. Do you notice the quiet, or is that just us up here?`,
      ],
      choices: [
        { id: 'media-lean', label: 'Own it' },
        { id: 'media-team', label: 'Credit the room' },
        { id: 'media-shrug', label: 'No comment' },
      ],
      refs: { gameId: big.gameId },
    });
  }

  // a promotion is a story with a microphone in it
  const promo = eventsThisWeek(career).filter(e => e.kind === 'role' && (e.delta ?? 0) > 0).pop();
  if (promo) {
    const roleLabel = ROLE_LABEL[career.coach.role];
    out.push({
      thread: 'media', threadRank: THREAD_RANK.media!, priority: 60, from,
      variants: [
        `The ${roleLabel} move is official. Quick quote for tomorrow: did the coaches catch up to you, or did you catch up to the job?`,
        `You are the ${roleLabel} now. On the record: is the job yours to keep, or is somebody else's name still on the door?`,
        `New role, same gym. What is the first thing that changes on film that the stands will not notice?`,
        `The ${roleLabel} job comes with the loudest seat. Who texted you first when the news broke, and what did they say?`,
      ],
      choices: [
        { id: 'media-lean', label: 'The job was mine already' },
        { id: 'media-team', label: 'Point at the coaches' },
        { id: 'media-shrug', label: 'Decline the victory lap' },
      ],
    });
  }

  // the blowout: winners get asked about style points
  for (const { record, myLine } of playedThisWeek) {
    const myHome = myLine!.teamId === record.home;
    const margin = myHome ? record.final[0] - record.final[1] : record.final[1] - record.final[0];
    if (margin < MEDIA_BLOWOUT_MARGIN) continue;
    const oppId = myHome ? record.away : record.home;
    const opp = teamNameOf(career, oppId);
    const score = fmtScore(record.final);
    out.push({
      thread: 'media', threadRank: THREAD_RANK.media!, priority: 55, from,
      variants: [
        `A ${margin}-point final over ${opp}. Winners get asked about style points: was that a message game, or does it just look like one from press row?`,
        `${score}. At what point in a night like that do you start playing the standings instead of the opponent?`,
        `Blowouts bore everybody except coaches. ${margin} points. What does the film session even look like after a game with no adversity in it?`,
        `${score} over ${opp}. Some teams ease up at twenty. Yours kept pressing. Whose call was that?`,
      ],
      choices: [
        { id: 'media-lean', label: 'It was a message' },
        { id: 'media-team', label: 'Just execution' },
        { id: 'media-shrug', label: 'Next question' },
      ],
      refs: { gameId: record.id },
    });
    break; // one blowout question a week is plenty
  }

  // the rivalry: the two names every scout sheet staples together
  const rival = career.players[career.rivalId] ?? career.league.players[career.rivalId];
  if (rival) {
    for (const { record, myLine, rivalLine } of records) {
      if (!myLine || myLine.min <= 0 || !rivalLine || rivalLine.teamId === myLine.teamId) continue;
      out.push({
        thread: 'media', threadRank: THREAD_RANK.media!, priority: 50, from,
        variants: [
          `You and ${rival.name} again. ${myLine.pts} to his ${rivalLine.pts}. Fifteen-year rivalries start somewhere. Is this one?`,
          `On the record about ${rival.name}: he says this circuit runs through his gym. Your ${myLine.pts} tonight argues back. Care to say it out loud?`,
          `${rival.name} had ${rivalLine.pts}, you had ${myLine.pts}. Every scout sheet I see staples you two together. Does that flatter you or bother you?`,
          `The building watched you and ${rival.name} all night. Honest question: do you two like each other, or is the handshake the whole relationship?`,
        ],
        choices: [
          { id: 'media-lean', label: 'It runs through me' },
          { id: 'media-team', label: 'Respect him, next' },
          { id: 'media-shrug', label: 'Not doing the rivalry bit' },
        ],
        refs: { gameId: record.id, players: [career.rivalId] },
      });
      break;
    }
  }

  // the streak: superstition is a story
  if (playedThisWeek.length > 0 && career.circuit) {
    const c = career.circuit;
    const myTeamId = c.teams[c.myTeamIdx]?.id;
    if (myTeamId) {
      const results: Array<{ week: number; id: string; won: boolean }> = [];
      for (const g of [...c.schedule, ...c.bracket]) {
        const rec = c.results[g.id];
        if (!rec || (rec.home !== myTeamId && rec.away !== myTeamId)) continue;
        const won = rec.home === myTeamId ? rec.final[0] > rec.final[1] : rec.final[1] > rec.final[0];
        results.push({ week: g.week, id: g.id, won });
      }
      results.sort((a, b) => a.week - b.week || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let streak = 0;
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i]!.won) streak += 1;
        else break;
      }
      if (streak >= MEDIA_STREAK_GAMES) {
        out.push({
          thread: 'media', threadRank: THREAD_RANK.media!, priority: 45, from,
          variants: [
            `${streak} straight wins. Streaks make teams superstitious. What is the thing nobody in your locker room will say out loud?`,
            `The streak sits at ${streak}. When did you last lose, and be honest: do you remember it too well or not at all?`,
            `${streak} in a row. Every run has the one game it should have lost. Which was yours?`,
            `Winning ${streak} straight changes how a gym sounds. What changed since the last loss that a box score will not show?`,
          ],
          choices: [
            { id: 'media-lean', label: 'Feed the streak talk' },
            { id: 'media-team', label: 'One game at a time' },
            { id: 'media-shrug', label: 'Not jinxing it' },
          ],
        });
      }

      // the slump: the recruiting model's own cold-stretch rule, asked out loud
      const myPts: number[] = [];
      for (const g of [...c.schedule, ...c.bracket]) {
        const rec = c.results[g.id];
        if (!rec) continue;
        const line = rec.lines.find(l => l.playerId === career.me);
        if (line && line.min > 0) myPts.push(line.pts);
      }
      if (myPts.length >= SLUMP_MIN_GAMES) {
        const seasonAvg = myPts.reduce((s, p) => s + p, 0) / myPts.length;
        const tail = myPts.slice(-SLUMP_WINDOW_GAMES);
        const recent = tail.reduce((s, p) => s + p, 0) / tail.length;
        if (seasonAvg > 0 && recent < seasonAvg * SLUMP_RATIO) {
          const r = round1(recent);
          const a = round1(seasonAvg);
          out.push({
            thread: 'media', threadRank: THREAD_RANK.media!, priority: 40, from,
            variants: [
              `Three games at ${r} a night against a season of ${a}. Slump, scheme, or something you are not telling me?`,
              `The last three: ${r} a game. Your season says ${a}. What does the film say that the numbers do not?`,
              `${r} a night this stretch, ${a} on the year. Coaches call it variance. Players call it a slump. What do you call it?`,
            ],
            choices: [
              { id: 'media-lean', label: 'It turns this week' },
              { id: 'media-team', label: 'Winning is the stat' },
              { id: 'media-shrug', label: 'No comment' },
            ],
          });
        }
      }
    }
  }
}

/**
 * The wire: the news desk writing about ME (docs/CAREER.md). One fixed
 * byline, every line quoting real numbers: career scoring milestones off
 * the season rows, honors off the honor events (read on a one-week lag
 * because folds and harvests land after the phone's weekly pass), and
 * draft night off the transaction ledger (built in draftNightCandidates
 * with the rest of that burst).
 */
export function wireCandidates(career: CareerState, out: Candidate[]): void {
  const me = meOf(career);

  // career scoring milestone: the rows are the accumulated truth; this
  // week's lines say whether the crossing happened tonight
  let total = 0;
  for (const row of me.seasons) total += row.pts;
  const played = weekRecords(career).filter(r => r.myLine && r.myLine.min > 0);
  const weekPts = played.reduce((s, r) => s + r.myLine!.pts, 0);
  if (weekPts > 0) {
    const before = total - weekPts;
    const k = Math.floor(total / MILESTONE_STEP);
    if (k >= 1 && before < k * MILESTONE_STEP) {
      const mark = k * MILESTONE_STEP;
      const last = played[played.length - 1]!;
      const oppId = last.myLine!.teamId === last.record.home ? last.record.away : last.record.home;
      const opp = teamNameOf(career, oppId);
      const pts = last.myLine!.pts;
      out.push({
        thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 80,
        from: WIRE_BYLINE, tag: `mile${mark}`, refs: { gameId: last.record.id },
        variants: [
          `${fmtNum(mark)} career points for ${me.name}, crossed with ${pts} against ${opp}. Round numbers are arbitrary. Watching him get there was not`,
          `${me.name} passed ${fmtNum(mark)} career points tonight, ${pts} against ${opp} doing the honors. The ledger keeps count so the highlight reels do not have to`,
          `Milestone watch closed: ${fmtNum(mark)} career points for ${me.name}. The ${pts}-point night against ${opp} did it`,
          `${fmtNum(mark)} career points for ${me.name}, sealed with ${pts} on ${opp}. Ask him and he will shrug. Ask anyone who has guarded him and they will not`,
        ],
      });
    }
  }

  // honors, read off the real events on a one-week lag (function doc):
  // fires only when every honor in the window is untold, so a digest
  // never half-repeats itself
  const honors = eventsWithinWeeks(career, 1).filter(e => e.kind === 'honor');
  if (honors.length > 0 && honors.every(e => !alreadySent(career, `wr-${e.id}`))) {
    const quoted = honors.slice(0, 3).map(e => e.reason).join('; ');
    out.push({
      thread: 'wire', threadRank: THREAD_RANK.wire!, priority: 60,
      from: WIRE_BYLINE, tag: `wr-${honors[0]!.id}`,
      variants: [
        `The season's ledger on ${me.name}: ${quoted}. Written plainly because it does not need help`,
        `For the record: ${quoted}. ${me.name}'s file gets thicker`,
        `${quoted}. That is the line under ${me.name}'s season. The Ledger prints what held up`,
      ],
    });
  }
}
