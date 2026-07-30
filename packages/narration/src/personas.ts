/**
 * The shipped booth personas — original archetypes on researched craft.
 *
 * Policy (final form of the 2026-07 language decision): invented broadcast
 * language reads as generated text, so every template keeps the craft of
 * the researched phrase inventory — but the personas are ORIGINAL
 * archetypes. No real broadcaster is named and no verbatim personal
 * signature call is used; what carries over is the discipline of the
 * genre, not anyone's identity. Every line here is one of:
 *   1. modeled on the SHAPE of verified calls and verbal formulas from the
 *      phrase inventory gathered from real transcripts and interviews
 *      (sources in docs/BROADCAST.md §7) — the pattern, never the verbatim
 *      trademark, or
 *   2. genre lingua franca confirmed as standard NBA play-by-play vocabulary
 *      ("won't go", "in and out", "off the back iron", "splits free throws",
 *      "kicks it out", "ahead to…", "and the foul", "checks in for"), or
 *   3. a plain factual statement of things the event stream supports.
 * Nothing is invented for color. The style contract in docs/BROADCAST.md
 * bans the constructions that read as LLM text (not-x-but-y, aphoristic
 * kickers, moralizing closers, meta-similes); test/style.test.ts enforces
 * the machine-checkable subset.
 *
 * Signature budgets follow the real usage discipline the research found:
 * the famous real signature calls are career-rare — order tens of uses in
 * thousands of games. Per-game budgets of 1 with high heat floors are
 * already generous at game scale — they exist so a signature stays an
 * event.
 *
 * Slot vocabulary (filled by booth.ts buildContext — keep in sync):
 *   {player} {Player} {passer} {blocker} {stealer} {victim} {assist}
 *   {team} {opp} {abbrev} {oppAbbrev} {home} {away}
 *   {spot} {dist} {n} {of} {count}
 *   {ptsTonight} {ptsPeriod} {reb} {ast} {hitStreak} {tpm} {ftLine}
 *   {run} {runPts} {droughtMin} {bar} {final_score}
 *   {score_phrase} {lead_phrase} {clock_phrase} {period_phrase}
 *   {in} {out} {statNote} {topNote} {homeStyle} {awayStyle} {winner} {loser}
 */

import type { VoicePack } from './voice.js';

/**
 * MILES CORBIN — play-by-play, the precision anchor. Crescendo discipline
 * (the researched anchor's rule: start low so the voice has somewhere to
 * go): terse standard calls through routine play, "It's good! It's good!"
 * doubling at big moments, COUNT IT reserved for big threes only, the
 * double form once a game at most for the impossible one.
 */
export const CORBIN: VoicePack = {
  id: 'corbin',
  displayName: 'Miles Corbin',
  role: 'pbp',
  style: { statAffinity: 0.4 },
  signatures: [
    {
      id: 'count-it-double',
      text: [
        'COUNT IT — OH, COUNT IT! What a shot by {Player}!',
        '{Player} from {dist} feet… COUNT IT! COUNT IT!'
      ],
      when: { kinds: ['shot_made'], tags: ['heave'], minHeat: 0.9 },
      perGame: 1
    },
    {
      id: 'count-it',
      text: [
        '{player} for three… COUNT IT!',
        '{Player} from {spot}… COUNT IT!'
      ],
      when: { kinds: ['shot_made'], tags: ['three'], minHeat: 0.72 },
      perGame: 3
    },
    {
      id: 'its-good',
      text: [
        'IT’S GOOD! IT’S GOOD! {Player} at the buzzer!'
      ],
      when: { kinds: ['shot_made'], tags: ['buzzer'], minHeat: 0.85 },
      perGame: 1
    }
  ],
  pools: {
    game_start: [
      'Good evening, everyone — the {away} and the {home}, moments away from the tip.',
      'The {away} are in town to face the {home}. We’re just about set here.'
    ],
    tip: [
      '{team} control the tip — here we go.',
      '{team} win the tip and we’re under way.'
    ],
    period_start: [
      '{period_phrase} under way.',
      'We’re back for {period_phrase}.'
    ],
    period_end: [
      'That’s the end of {period_phrase}: {score_phrase}.',
      'The horn sounds — end of {period_phrase}, {score_phrase}.'
    ],
    game_end: [
      'That’s the final: {score_phrase}.',
      'And that will do it. The final: {score_phrase}.'
    ],
    'game_end.peak': [
      'What a victory for the {winner}! The final: {final_score}!',
      'And this one is over — the {winner} take it, {final_score}! What a ballgame!'
    ],

    // ------------------------------------------------------------- makes
    'shot_made.heave': [
      '{Player} from {dist} feet… IT’S GOOD! IT’S GOOD!',
      'It goes in! {Player} from {dist} feet!'
    ],
    'shot_made.and_one': [
      'It’s good — AND the foul!',
      '{player} scores it, and the foul!',
      'Good! And a foul — {player} will have a chance for three the hard way.'
    ],
    'shot_made.putback.flat': [
      '{player} puts it back.',
      'Offensive rebound, and {player} puts it back in.'
    ],
    'shot_made.putback': [
      '{player} puts it back — good!',
      'The follow by {player} — it’s good!'
    ],
    'shot_made.repeat': [
      '{player} again!',
      '{player}… again. He has {ptsTonight}.',
      'Another one for {player}.'
    ],
    'shot_made.kickout.flat': [
      'Kicks it out — {player} for three… good.',
      'Drive and kick, {player}… got it.'
    ],
    'shot_made.kickout': [
      'Kicks it out to {player}… it’s good!',
      '{passer} finds him — {player} from {spot}… got it!'
    ],
    'shot_made.transition': [
      'Ahead to {player} — lays it in.',
      '{player} on the break… good.',
      '{team} run it — {player} finishes.'
    ],
    'shot_made.three.flat': [
      '{player} for three… good.',
      '{player} from {spot}… got it.',
      '{player} connects from {spot}.',
      'Three-ball from {player} — good.'
    ],
    'shot_made.three.elevated': [
      '{player} for three… rattles home!',
      '{player} from {spot}… it’s good!',
      '{player} lets it go… got it!'
    ],
    'shot_made.three.peak': [
      '{Player} for three… IT’S GOOD!',
      '{Player} from {spot}… count it!'
    ],
    'shot_made.rim.flat': [
      '{player} lays it in.',
      '{player} inside — good.',
      '{player} puts it in.',
      '{player} with the layup.'
    ],
    'shot_made.rim.elevated': [
      '{player} drives — lays it in!',
      '{player} to the rim… got it!',
      '{player} takes it inside and scores!'
    ],
    'shot_made.rim.peak': [
      '{Player} takes it all the way — IT’S GOOD!',
      '{Player} to the basket — and it counts!'
    ],
    'shot_made.paint.flat': [
      '{player} with the floater… good.',
      '{player} in the lane — got it.',
      'The little runner by {player} — good.'
    ],
    'shot_made.paint.elevated': [
      '{player} floats it up… and in!',
      'The runner by {player} — it’s good!'
    ],
    'shot_made.paint.peak': [
      '{Player} with the floater — IT’S GOOD!'
    ],
    'shot_made.mid.flat': [
      '{player} pulls up… good.',
      '{player} from {dist}… got it.',
      '{player} with the jumper — good.',
      '{player} from {spot}… down.'
    ],
    'shot_made.mid.elevated': [
      '{player} pulls up from {dist}… rattles home!',
      '{player} from {spot}… it’s good!'
    ],
    'shot_made.mid.peak': [
      '{Player} pulls up… IT’S GOOD!',
      'Jump shot {Player}… GOOD!'
    ],
    shot_made: [
      '{player} scores. He has {ptsTonight}.',
      '{player} puts it in.'
    ],

    // ------------------------------------------------------------- misses
    'shot_missed.heave': [
      '{player} from midcourt… no.',
      'The heave by {player} is off the mark.'
    ],
    'shot_missed.three.flat': [
      '{player} for three… won’t go.',
      '{player} from {spot} — no good.',
      'In and out! {player}’s three stays out.',
      '{player}’s three is short.'
    ],
    'shot_missed.three.elevated': [
      'A good look for {player}… won’t go!',
      '{player} — wide open — in and out!'
    ],
    'shot_missed.rim': [
      '{player} misses the layup.',
      '{player} inside — won’t go.',
      '{player} can’t get it to fall.'
    ],
    'shot_missed.paint': [
      '{player}’s floater won’t go.',
      'The runner by {player} — no good.'
    ],
    'shot_missed.mid': [
      '{player}’s jumper won’t go.',
      '{player} from {dist} — off the back iron.',
      '{player} pulls up… no good.'
    ],
    shot_missed: [
      '{player} misses.',
      'No good.'
    ],
    shot_blocked: [
      'Blocked! {blocker} got it!',
      'Rejected by {blocker}!',
      '{blocker} swats it away!',
      '{blocker} blocks the shot!'
    ],

    // ------------------------------------------------------------- the line
    'free_throw.made': [
      'The free throw is good.',
      '{player} makes it — {n} of {of}.',
      'Good. {n} of {of}.'
    ],
    'free_throw.miss': [
      'The free throw is no good.',
      '{player} misses — {n} of {of}.',
      'In and out — no good.'
    ],

    // ------------------------------------------------------------- the rest
    'rebound.off': [
      'Offensive rebound, {player}.',
      '{player} keeps it alive.',
      '{player} grabs the miss — {team} keep it.'
    ],
    'rebound.def': [
      'Rebound, {player}.',
      '{player} with the board.',
      '{player} pulls it down.'
    ],
    'turnover.steal': [
      'Stolen! {stealer} takes it away!',
      '{stealer} picks his pocket!',
      'Picked off by {stealer}!'
    ],
    'turnover.charge': [
      'Offensive foul — {victim} with the charge.',
      'They call the charge on {victim}.'
    ],
    'turnover.shot_clock': [
      'Shot-clock violation on {team}.',
      'The 24 expires — violation on {team}.'
    ],
    'turnover.oob': [
      '{victim} throws it away.',
      '{victim} loses it out of bounds — {team} turnover.'
    ],
    'foul.shooting': [
      'Foul on the shot — {player}.',
      'Whistle. {player} with the foul on the shot.'
    ],
    'foul.reach': [
      'Reach-in foul on {player}.',
      '{player} reaches — they call the foul.'
    ],
    'foul.loose_ball': [
      'Loose-ball foul on {player}.',
      'The whistle — loose-ball foul, {player}.'
    ],
    'foul.offensive': [
      'Offensive foul on {player}.'
    ],
    substitution: [
      '{in} checks in for {out}.',
      '{team} substitution: {in} in for {out}.'
    ],
    'note.clutch': [
      'Under three minutes to go — {lead_phrase}.',
      'Here we go: {lead_phrase}, {clock_phrase}.'
    ]
  }
};

/**
 * GUS TREMAINE — analyst, the teacher. The teaching register the research
 * catalogued: "you must" directives, conditional second person ("if you're
 * X, you have to…"), "the painted area", numbers cited plainly, "That's
 * it! That's it!" as peak approval, credit to the coaching staff, and
 * measured old-coach maxims delivered as settled fact.
 */
export const TREMAINE: VoicePack = {
  id: 'tremaine',
  displayName: 'Gus Tremaine',
  role: 'color',
  style: { statAffinity: 0.9 },
  signatures: [
    {
      id: 'thats-it',
      text: [
        'That’s it! That’s it! That’s it! The extra pass — you make the defense pay.',
        'That’s it! That’s it! Excellent execution.'
      ],
      when: { kinds: ['shot_made'], tags: ['extra_pass', 'kickout'], minHeat: 0.6 },
      perGame: 2
    }
  ],
  pools: {
    'note.run': [
      'Now you’re looking at a {run} run. If you’re the {opp}, you must get a stop, and then you must take care of the basketball at the other end.',
      'That’s {runPts} unanswered. Somebody on the {opp} has to step up and make a play right now, okay?',
      'A {run} run by the {team}. There is plenty of time — but you must get organized on this possession.'
    ],
    'note.milestone': [
      '{bar} points now for {Player} — {tpm} threes, {ftLine} from the line.',
      'That’s {bar} for {Player}. Now, when a man is going like this, you must send the double early and make somebody else beat you.',
      '{bar} points. And he is getting them inside the flow — nothing forced.'
    ],
    'note.foul_trouble': [
      'Now he has {count} fouls. So if you’re the {opp}, you must go right at him — either he backs off defensively, or he goes to the bench.',
      'That’s {count} on {player}. Watch — every drive is coming at him now, because that is exactly what you must do.',
      '{count} fouls. The coaching staff has a decision to make here, and either way you live with it.'
    ],
    'note.double_double': [
      'A double-double for {Player}: {ptsTonight} points, {reb} rebounds. That is an excellent night’s work.',
      '{Player} now has {ptsTonight} and {reb}. You must put a body on him every single time the shot goes up.'
    ],
    'note.drought': [
      'The {team} finally score — that was {droughtMin} without a point. When you go dry like that, you must get into the painted area and get to the line.',
      'That ends {droughtMin} of nothing. The oldest rule in the book: the team that gets more layups wins — go get a layup.'
    ],
    'note.clutch': [
      'Okay — winning time. You must get a stop, and you must take care of the basketball.',
      'Now we find out. You must maximize every possession from here on in.'
    ],
    'reaction.kickout': [
      'That’s a terrific pass. The drive forces the help, you swing it, and the shooter is open — that’s always a tribute to the coaching staff.',
      'See, the defense collapses on the drive, and now the corner is wide open. Excellent execution.'
    ],
    'reaction.transition': [
      'Against a good half-court defense you must get out and run — and that is exactly what they did.',
      'That is what forcing turnovers gives you: layups. And the team that gets more layups wins.'
    ],
    'reaction.and_one': [
      'Excellent. He initiates the contact, he keeps his balance, and he finishes. Now go make it a three-point play.',
      'That is a strong move. He absorbs the hit, and he still gets the shot up clean.'
    ],
    'reaction.deep': [
      'Distance is not a factor for this young man.',
      'If he steps back any deeper, he’s going to be sitting up here with us.'
    ],
    'reaction.block': [
      'Excellent timing. You stay vertical, you keep it in front, and you go get it.',
      'That is a big-time defensive play.'
    ],
    'reaction.dagger': [
      'Right there — that is the ballgame.',
      'You guard for twenty-three seconds, and he still makes that shot. That is the ballgame.'
    ],
    'reaction.peak': [
      'That’s it! That’s it! What a play.',
      'That is a big-time play by a big-time player.',
      'My goodness. You will see that one again on every highlight tonight.'
    ]
  },
  segments: {
    pregame: [
      'Now, here’s what you watch tonight. One: {homeStyle} Two: {awayStyle} Whichever team gets the game played at its pace wins.',
      'Okay, two things tonight. {homeStyle} And on the other side: {awayStyle} The tempo decides it.'
    ],
    ft_gap: [
      'He’s {ftLine} from the line tonight.',
      'Watch the feet and the follow-through — same routine every time. He’s {ftLine} tonight.',
      'Free throws win close games. He is {ftLine} on the night.'
    ],
    recap_q: [
      'One number from that quarter: {statNote}. {topNote}.',
      'Okay, the story of that quarter: {statNote}. And {topNote}.'
    ],
    recap_half: [
      'At the half: {statNote}. {topNote}. Now come the adjustments — watch the first five minutes of the third quarter.',
      'Half a game in the books: {statNote}. {topNote}.'
    ],
    final: [
      'The bottom line tonight: {statNote}. {topNote}. That’s your ballgame.',
      'When you look at the sheet: {statNote}. {topNote}.'
    ],
    garbage: [
      'This one is decided, so now you evaluate the bench — these minutes go on tape.',
      'It’s over as a contest. The young men out there are playing for rotation minutes now.'
    ]
  }
};

/**
 * DANA BOONE — alternate play-by-play, the firecracker. The researched
 * high-energy structure: controlled start, staccato action-word
 * enumeration on the big ones, a bridge exclamation, "What a play!" as the
 * closing tag, and signature calls held under real-usage budgets.
 */
export const BOONE: VoicePack = {
  id: 'boone',
  displayName: 'Dana Boone',
  role: 'pbp',
  style: { statAffinity: 0.3 },
  signatures: [
    {
      id: 'baptized',
      text: [
        '{Player}… OH, HE BAPTIZED HIM AT THE RIM!'
      ],
      when: { kinds: ['shot_made'], tags: ['drive'], minHeat: 0.88 },
      perGame: 1
    },
    {
      id: 'hammer',
      text: [
        '{Player} climbs the ladder and BRINGS DOWN THE HAMMER! Goodness gracious!'
      ],
      when: { kinds: ['shot_made'], tags: ['putback', 'drive'], minHeat: 0.78 },
      perGame: 1
    },
    {
      id: 'zip-code',
      text: [
        'IT’S GOOD! FROM ANOTHER ZIP CODE! Are you seeing this?!'
      ],
      when: { kinds: ['shot_made'], tags: ['heave', 'buzzer'], minHeat: 0.9 },
      perGame: 1
    },
    {
      id: 'dagger',
      text: [
        '{Player}… and THAT, folks, is the dagger!'
      ],
      when: { kinds: ['shot_made'], tags: ['dagger'], minHeat: 0.72 },
      perGame: 1
    }
  ],
  pools: {
    game_start: [
      'The {away} and the {home} — we are moments away!',
      'Hello everyone — {away} at {home}, and we are just about ready.'
    ],
    tip: [
      '{team} with the tip, and away we go!',
      '{team} win the tip — here we go!'
    ],
    period_start: [
      '{period_phrase}, under way!',
      'Back for {period_phrase}.'
    ],
    period_end: [
      'That’s the quarter — {score_phrase}.',
      'The horn: end of {period_phrase}, {score_phrase}.'
    ],
    game_end: [
      'That’s the ballgame. The final: {score_phrase}.',
      'It’s over. Final: {score_phrase}.'
    ],
    'game_end.peak': [
      'This one is OVER! The {winner} win it, {final_score}! What a game!',
      'BALLGAME! The {winner} survive, {final_score}!'
    ],
    'shot_made.heave': [
      '{Player} from {dist}… IT’S GOOOOD!',
      'HE GOT IT! {Player} from {dist} feet!'
    ],
    'shot_made.and_one': [
      '{player} scores it — count it, AND the foul!',
      'Good! And a foul! {player} to the line for one more!'
    ],
    'shot_made.putback': [
      '{player} follows it home — the putback!',
      'Second effort — {player} puts it back!'
    ],
    'shot_made.repeat': [
      '{player} AGAIN!',
      'Him again — {player} has {ptsTonight}!'
    ],
    'shot_made.kickout': [
      'Kicks it out — {player}… GOT IT!',
      'Drive and kick — {player} from {spot}, good!'
    ],
    'shot_made.transition': [
      'Ahead to {player} — lays it in!',
      'Here they come — {player} finishes the break!',
      'Out on the break — {player}, good!'
    ],
    'shot_made.three.flat': [
      '{player} for three… good!',
      'A three-ball from {player} — got it!',
      '{player} from {spot}… in!'
    ],
    'shot_made.three.elevated': [
      '{player} from {spot}… GOT IT!',
      'Oh baby — {player} buries the three!',
      '{player} lets it fly… GOOD!'
    ],
    'shot_made.three.peak': [
      'OH MY GOODNESS — {Player} from {dist} feet!',
      '{Player}… rises… fires… GOT IT! What a play!'
    ],
    'shot_made.rim.flat': [
      '{player} lays it in.',
      '{player} with the layup — good.',
      '{player} inside, and it counts.'
    ],
    'shot_made.rim.elevated': [
      '{player} attacks the rim — GOOD!',
      'Oh! {player} gets it to go inside!'
    ],
    'shot_made.rim.peak': [
      '{Player}… OH MY GOODNESS! WHAT A PLAY!',
      '{Player} RISES and finishes! WOO!'
    ],
    'shot_made.paint': [
      '{player} floats it in.',
      '{player} in the lane — good.',
      'The runner by {player}… got it.'
    ],
    'shot_made.mid.flat': [
      '{player} pulls up — good.',
      '{player} from {dist} feet… got it.',
      'Jumper by {player} — good.'
    ],
    'shot_made.mid.elevated': [
      '{player} rises from {spot} — GOOD!',
      'Pull-up by {player}… got it!'
    ],
    shot_made: [
      '{player} gets it to go! He has {ptsTonight}.',
      '{player} scores it!'
    ],
    'shot_missed.heave': [
      'The heave by {player}… no good.',
      '{player} from midcourt… short.'
    ],
    'shot_missed.three': [
      '{player} for three… no good.',
      '{player} lets it fly… short!',
      '{player}’s three rims out.'
    ],
    'shot_missed.rim': [
      '{player} inside — won’t go!',
      '{player} can’t finish!',
      'The layup by {player} rolls off.'
    ],
    'shot_missed.paint': [
      '{player}’s floater won’t drop.',
      'The runner is no good.'
    ],
    'shot_missed.mid': [
      '{player} pulls up — off the mark.',
      '{player} from {dist} — no good.',
      '{player}’s jumper hits the back iron.'
    ],
    shot_missed: [
      '{player} misses the mark.',
      'No good.'
    ],
    shot_blocked: [
      'REJECTED! {blocker}!',
      '{blocker} sends it back!',
      'Oh! {blocker} with the block!'
    ],
    'free_throw.made': [
      'Good — {n} of {of}.',
      '{player} drops it in, {n} of {of}.',
      'Count it. {n} of {of}.'
    ],
    'free_throw.miss': [
      'No good — {n} of {of}.',
      '{player} misses, {n} of {of}.',
      'Front iron!'
    ],
    'rebound.off': [
      '{player} keeps it alive!',
      'Offensive rebound {player} — second chance!'
    ],
    'rebound.def': [
      'Rebound {player}.',
      '{player} rips it down.',
      '{player} with the board.'
    ],
    'turnover.steal': [
      'Stolen! {stealer}!',
      '{stealer} picks his pocket!',
      'Intercepted — {stealer}!'
    ],
    'turnover.charge': [
      'They call the charge on {victim}!',
      'Offensive foul — {victim} ran into a set defender!'
    ],
    'turnover.shot_clock': [
      'The buzzer — 24-second violation on {team}!',
      'Shot clock! Turnover, {team}!'
    ],
    'turnover.oob': [
      '{victim} throws it away!',
      'Out of bounds — {team} turnover!'
    ],
    'foul.shooting': [
      'Whistle — foul on the shot, {player}.',
      'They got {player} on the shot.'
    ],
    'foul.reach': [
      'Reach-in on {player}.',
      '{player} reaches — they call it.'
    ],
    'foul.loose_ball': [
      'Loose-ball foul, {player}.'
    ],
    'foul.offensive': [
      'Offensive foul on {player}.'
    ],
    substitution: [
      '{in} checks in for {out}.',
      '{team} bring in {in} for {out}.'
    ],
    'note.clutch': [
      'Hang on now — {lead_phrase}, {clock_phrase}!',
      'Crunch time: {lead_phrase}, {clock_phrase}!'
    ]
  }
};

/** the shipped two-voice booths */
export const BOOTH_PRESETS: Record<'classic' | 'latenight', { pbp: VoicePack; color: VoicePack }> = {
  classic: { pbp: CORBIN, color: TREMAINE },
  latenight: { pbp: BOONE, color: TREMAINE }
};

export type BoothPresetId = keyof typeof BOOTH_PRESETS;
