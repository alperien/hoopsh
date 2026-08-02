/**
 * phone-coach.ts - the coach's thread: role moves, the bracket seed, the
 * season postmortem, the NBA-debut note, and the graded-night reads, terse
 * and film-first in lowercase. Part of the phone surface; see phone.ts for
 * the discipline rules and module map.
 */
import type { GameRecord } from '@hoopsh/franchise';
import { bracketSetThisWeek, debutThisWeek, titleGameThisWeek } from './phone-detect.js';
import {
  OFF_SCRIPT_ADHERENCE, ROLE_LABEL, THREAD_RANK, eventsThisWeek, recordForGrade,
  recordIsThisWeek,
} from './phone-shared.js';
import type { Candidate } from './phone-shared.js';
import type { CareerState, GameGrade } from './types.js';

/** The coach's one text for the week: a role move outranks any single night; a night off the script outranks a clean one (that is who he is). */
export function coachCandidates(career: CareerState, out: Candidate[]): void {
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

  // the bracket seed: the season's second act announced in his voice
  const seeded = bracketSetThisWeek(career);
  if (seeded) {
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 96,
      from: career.coach.name, capExempt: true, tag: `bkt${career.clock.year}`,
      variants: [
        `the bracket is set. ${seeded.opp} first. ${seeded.w}-${seeded.l} earned us the seed and the seed means nothing now. film tomorrow`,
        `the bracket is set: we open with ${seeded.opp}. everything before this was rehearsal. bring your real self monday`,
        `bracket came out. ${seeded.opp}. ${seeded.w} wins bought us this game and nothing after it. one night at a time now`,
        `it is ${seeded.opp} in the opener. the bracket is set and so is my rotation. do not make me rethink either`,
      ],
    });
  }

  // the postmortem: the final was this week, name the season honestly
  const title = titleGameThisWeek(career);
  if (title) {
    const table = career.circuit!.standings.find(s => s.teamIdx === career.circuit!.myTeamIdx);
    const w = table?.w ?? 0;
    const l = table?.l ?? 0;
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 99,
      from: career.coach.name, capExempt: true, tag: `post${career.clock.year}`,
      refs: { gameId: title.record.id },
      variants: title.champion
        ? [
          `${w}-${l} and the last game of the year was ours. i have coached a long time for a locker room that sounds like that. proud of you`,
          `season closed: champions. ${w}-${l}. in july nobody will remember the february slog. i will. that is where this was won`,
          `we finished it. ${title.score}. enjoy every second of this week, then remember: banners age fast in my gym`,
          `champions. i graded every night of this season and tonight i am putting the pen down. ${w}-${l}. thank you`,
        ]
        : [
          `${w}-${l} and one game short. i will not pretend the ending does not sting. i will also not pretend that season was anything but real`,
          `we lost the last one, ${title.score}. the season was still ${w}-${l} and nobody hands you that. the gap is one possession wide`,
          `final hurt. good. sleep on it, then look at ${w}-${l} and tell me this group did not move. see you in the spring`,
          `${title.score}. i watched you shake hands like a pro after. seasons end. what you built this year does not`,
        ],
    });
  }

  // the NBA debut: the first league tape gets its own text, quoting the line
  const debut = debutThisWeek(career);
  if (debut) {
    const { pts, ast } = debut.line;
    const reb = debut.line.orb + debut.line.drb;
    out.push({
      thread: 'coach', threadRank: THREAD_RANK.coach!, priority: 97,
      from: career.coach.name, capExempt: true, tag: 'debut',
      refs: { gameId: debut.record.id },
      variants: [
        `${pts}, ${reb} and ${ast} in your first one. the league book on you starts tonight. write it yourself`,
        `debut done. ${pts} points. the speed is the league, the game is still the game. film at nine`,
        `first nba tape: ${pts}-${reb}-${ast}. nerves showed for a quarter, work showed for three. good ratio`,
        `welcome to the league. ${pts} in game one. nobody remembers debuts except mothers and coaches. we both saw a player`,
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
