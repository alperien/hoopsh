/**
 * The shipped booth personas — narrators as data packs.
 *
 * All three are ORIGINAL HOMAGE ARCHETYPES: they capture broadcast styles
 * (the precision anchor, the teaching analyst, the firecracker), not named
 * people, and no real broadcaster's trademark call appears here. Names were
 * checked against the sample rosters (data/src/teams.ts) for collisions.
 *
 * Writing rules the pools obey (enforced by taste, checked by tests where
 * checkable):
 *  - A line only claims what the event stream supports. "Wide open" comes
 *    from ShotEvent.contest; "kicks it out" from PassEvent.kind; nobody ever
 *    calls a pick-and-roll (the sim runs them but never emits them —
 *    docs/BROADCAST.md §3) and nobody sees fatigue.
 *  - Flat register is terse — real PBP spends most of a game in short
 *    declaratives. Elevated earns a verb. Peak earns the full name and the
 *    exclamation.
 *  - Signature calls carry per-game budgets so they stay events, not tics.
 *
 * Slot vocabulary (filled by booth.ts buildContext — keep in sync):
 *   {player} {Player} {passer} {blocker} {stealer} {victim} {assist}
 *   {team} {opp} {abbrev} {oppAbbrev} {home} {away}
 *   {spot} {dist} {n} {of} {count}
 *   {ptsTonight} {ptsPeriod} {reb} {ast} {hitStreak} {ftLine}
 *   {run} {droughtMin} {bar}
 *   {score_phrase} {lead_phrase} {clock_phrase} {period_phrase}
 *   {in} {out} {statNote} {topNote} {homeStyle} {awayStyle} {winner} {loser}
 */

import type { VoicePack } from './voice.js';

/**
 * MILES CORBIN — the precision anchor. Economical in routine play; a
 * controlled detonation when a moment earns it. Never wastes the crowd's
 * peak on a February layup.
 */
export const CORBIN: VoicePack = {
  id: 'corbin',
  displayName: 'Miles Corbin',
  role: 'pbp',
  style: { statAffinity: 0.45 },
  signatures: [
    {
      id: 'count-it',
      text: [
        '{Player} from {spot}… COUNT IT!',
        'COUNT IT! {Player} from {dist} feet!'
      ],
      when: { kinds: ['shot_made'], tags: ['three'], minHeat: 0.72 },
      perGame: 3
    },
    {
      id: 'dagger',
      text: [
        'And that… is the dagger. {Player}, from {spot}.',
        '{Player} from {spot}… good night. That is the dagger.'
      ],
      when: { kinds: ['shot_made'], tags: ['dagger'], minHeat: 0.72 },
      perGame: 1
    },
    {
      id: 'not-in-here',
      text: [
        'SWATTED! {blocker} said not in here!',
        '{blocker} with AUTHORITY — get that out!'
      ],
      when: { kinds: ['shot_blocked'], minHeat: 0.72 },
      perGame: 2
    }
  ],
  pools: {
    game_start: [
      'Good evening, everybody — {home} and {away}, and we are moments from the tip.',
      'Welcome in. The {home} host the {away} tonight, and both benches are up already.'
    ],
    tip: [
      '{team} control the tip and we are under way.',
      'Tip to {team} — here we go.'
    ],
    period_start: [
      '{period_phrase} is under way.',
      'Back at it for {period_phrase}.'
    ],
    period_end: [
      'That will do it for {period_phrase}: {score_phrase}.',
      'The horn — end of {period_phrase}, {score_phrase}.'
    ],
    game_end: [
      'That is the final: {score_phrase}.',
      'And that will be that. Your final from tonight: {score_phrase}.'
    ],

    // ------------------------------------------------------------- makes
    'shot_made.heave': [
      'HE THREW IT IN! {Player} FROM {dist} FEET AT THE HORN!',
      'NO! WAY! {Player} banks in the prayer from {dist}!'
    ],
    'shot_made.and_one': [
      '{player} takes the contact — AND IT GOES! Chance for the three-point play.',
      '{player} muscles it home AND the foul!',
      'Bucket AND the whistle — {player} will head to the line for one more.'
    ],
    'shot_made.putback.flat': [
      '{player} cleans it up — putback good.',
      'Second effort, {player} — right back in.'
    ],
    'shot_made.putback': [
      '{player} rises on the miss — PUTBACK! Extra-possession points.',
      'Volleyball at the rim and {player} wins it — putback good!'
    ],
    'shot_made.repeat': [
      '{player}. Again.',
      '{player} again — he has {ptsTonight} now.',
      'And there is {player} one more time. {hitStreak} straight makes.'
    ],
    'shot_made.kickout.flat': [
      'Kick to {player} — knocks it down from {spot}.',
      'Drive and kick, {player} from {spot} — good.'
    ],
    'shot_made.kickout': [
      'Collapse and kick — {player} from {spot}… GOOD!',
      '{passer} kicks it out — {player} lets it fly from {spot}… got it!'
    ],
    'shot_made.three.flat': [
      '{player} connects from {spot}.',
      '{player} drops in the three from {spot}.',
      'Three-ball, {player}, from {spot}.',
      '{player} from {spot} — good.'
    ],
    'shot_made.three.elevated': [
      '{player} rises from {spot} — buries it!',
      'From {spot}… {player} splashes it home!',
      '{player} with room from {spot} — doesn’t touch a thing!',
      '{player} lets it go from {spot} — right at the bottom of the net!'
    ],
    'shot_made.three.peak': [
      '{Player} from {spot}… GOT IT! {lead_phrase}!',
      '{Player} rises… fires… YES SIR, from {dist} feet!',
      'Oh, WHAT a shot — {Player} from {spot}, and this building knows it!'
    ],
    'shot_made.rim.flat': [
      '{player} lays it in.',
      '{player} finishes inside.',
      '{player} gets to the rim and drops it off.',
      'Deuce for {player} at the rim.'
    ],
    'shot_made.rim.elevated': [
      '{player} slices in and finishes!',
      'To the rim — {player} lays it home through traffic!',
      '{player} attacks the paint and finishes strong!'
    ],
    'shot_made.rim.peak': [
      '{Player} TO THE RIM — AND IT COUNTS! {lead_phrase}!',
      '{Player} goes right at the defense and FINISHES!'
    ],
    'shot_made.paint.flat': [
      '{player} floats one in from {dist} feet.',
      'Soft touch in the lane — {player} for two.',
      'Little runner from {player} — good.'
    ],
    'shot_made.paint.elevated': [
      '{player} with the tough finish in the lane!',
      'The floater from {player} — kisses in!'
    ],
    'shot_made.mid.flat': [
      '{player} pulls up from {dist} — good.',
      'The {dist}-footer from {spot} — down.',
      '{player} from {spot}, middle of the net.',
      'Jumper, {player} — count the deuce.'
    ],
    'shot_made.transition': [
      '{player} out ahead of the pack — lays it in!',
      'Stop turned into points — {player} on the break!',
      '{player} fills the lane and finishes. Too easy in transition.'
    ],
    'shot_made.mid.elevated': [
      '{player} rises from {spot} — cash!',
      'Pull-up from {dist}… {player} drills it!'
    ],
    'shot_made.mid.peak': [
      '{Player} pulls up… BURIES IT from {dist}!',
      '{Player} from {spot} — the biggest jumper of the night so far!'
    ],
    'shot_made.paint.peak': [
      '{Player} floats it home — unbelievable touch!',
      '{Player} with the runner — IT GOES!'
    ],
    // generic safety nets — fire only when no more specific pool exists for
    // a (variant, register) combination, so a live beat never renders silence
    shot_made: [
      '{player} scores — {ptsTonight} tonight.',
      '{player} puts it in.'
    ],
    shot_missed: [
      '{player} misses.',
      'No good from {player}.'
    ],

    // ------------------------------------------------------------- misses
    'shot_missed.heave': [
      '{player} from midcourt at the horn — no.',
      'The heave from {player}… off the mark.'
    ],
    'shot_missed.three.flat': [
      '{player} from {spot} — no.',
      '{player} misses the three from {spot}.',
      'Short from {spot} — {player} can’t connect.',
      '{player}’s three rims out.'
    ],
    'shot_missed.three.elevated': [
      '{player} had daylight from {spot} — won’t go!',
      'Good look for {player} from {spot}… rattles out!'
    ],
    'shot_missed.rim': [
      '{player} can’t finish at the rim.',
      '{player} misses the layup — rim says no.',
      'The finish won’t fall for {player}.'
    ],
    'shot_missed.paint': [
      '{player}’s floater is off the mark.',
      'The runner from {player} — no good.',
      '{player} misses in the lane.'
    ],
    'shot_missed.mid': [
      '{player}’s {dist}-footer rims out.',
      'Back iron for {player} — no good.',
      '{player} misses from {spot}.',
      'The jumper from {player} won’t drop.'
    ],
    shot_blocked: [
      '{blocker} swats it away from {player}!',
      '{player} goes up — {blocker} says no!',
      'Denied! {blocker} with the rejection on {player}!',
      '{blocker} gets a piece of it — no good!'
    ],

    // ------------------------------------------------------------- the line
    'free_throw.made': [
      '{player} drops in the free throw, {n} of {of}.',
      'Good from the stripe — {n} of {of}.',
      '{player} makes them pay from the line.'
    ],
    'free_throw.miss': [
      '{player} misses from the line, {n} of {of}.',
      'Front rim — no good, {n} of {of}.',
      'The free throw won’t fall for {player}.'
    ],

    // ------------------------------------------------------------- the rest
    'rebound.off': [
      '{player} keeps it alive on the offensive glass!',
      'Offensive board — {player}. Fresh clock for {team}.',
      '{player} climbs for the offensive rebound!'
    ],
    'rebound.def': [
      'Rebound, {player}.',
      '{player} cleans the glass.',
      '{player} closes out the possession with the board.',
      'Board to {player}, and {team} will go the other way.'
    ],
    'turnover.steal': [
      'Picked! {stealer} steps in and takes it from {victim}!',
      '{stealer} with the strip — {team} lose it!',
      '{victim} coughs it up — {stealer} away with it!'
    ],
    'turnover.charge': [
      'Charge! {victim} lowers the shoulder and the officials saw it — offensive foul.',
      '{victim} barrels in — CHARGE, and the ball goes the other way.'
    ],
    'turnover.shot_clock': [
      'The buzzer — shot-clock violation on {team}.',
      'Twenty-four expires on {team}. Turnover.'
    ],
    'turnover.oob': [
      '{victim} throws it away — out of bounds, {team} turnover.',
      'Off the mark and out — {victim} with the miscue.'
    ],
    'foul.shooting': [
      'Whistle — shooting foul on {player}.',
      'Contact on the shot — foul, {player}.'
    ],
    'foul.reach': [
      'Reach-in on {player}.',
      'They catch {player} reaching — foul.'
    ],
    'foul.loose_ball': [
      'Loose-ball foul on {player} in the scramble.',
      'Whistle in the scrum — loose-ball foul, {player}.'
    ],
    'foul.offensive': [
      'Offensive foul on {player}.',
      'They’ll charge {player} with the offensive foul.'
    ],
    substitution: [
      '{in} checks in for {out}.',
      'Change for {team}: {in} on, {out} off.'
    ],
    'note.clutch': [
      'Look at the situation: {lead_phrase}, {clock_phrase}. Winning time.',
      'Here we are — {lead_phrase}, {clock_phrase}. Buckle up.'
    ]
  }
};

/**
 * GUS TREMAINE — the teaching analyst. Fundamentals, scouting-report
 * framing, tonight's numbers. Talks at dead balls and after the whistle,
 * never over live action.
 */
export const TREMAINE: VoicePack = {
  id: 'tremaine',
  displayName: 'Gus Tremaine',
  role: 'color',
  style: { statAffinity: 0.85 },
  signatures: [
    {
      id: 'clinic',
      text: [
        'That, folks, is a CLINIC. Tape it, teach it.',
        'Frame that one and hang it in the film room.'
      ],
      when: { kinds: ['shot_made'], tags: ['extra_pass', 'kickout'], minHeat: 0.6 },
      perGame: 2
    }
  ],
  pools: {
    'note.run': [
      'Timeout territory. When the board says {run}, somebody has to put a body on somebody. It’s that simple.',
      '{team} have scored {runPts} unanswered — and watch the body language on the other side. That’s what a run does to you.',
      'That’s {run}, {team}. The game is being played at THEIR speed now, and that never happens by accident.'
    ],
    'note.milestone': [
      '{bar} points now for {Player}. And look HOW he’s getting them — nothing forced, everything in rhythm.',
      'That makes {bar} for {Player}. Great players don’t chase numbers; the numbers arrive.',
      '{Player} is up to {bar}. Somebody on that bench needs to raise a hand and say: my man.'
    ],
    'note.foul_trouble': [
      'That’s {count} on {player}, and now the whole defensive plan changes — you sag, you funnel, you pray.',
      '{count} fouls on {player}. Watch his feet the rest of this period: he cannot afford to reach again.',
      'Foul number {count} for {player} — and his coach has a decision to make. Sit him and lose the minutes, or ride him and hold your breath.'
    ],
    'note.double_double': [
      'Quietly, {Player} has himself a double-double: {ptsTonight} points, and he’s cleaned up everywhere else. That’s a professional’s stat line.',
      'A double-double for {Player} — {ptsTonight} points to go with the dirty work. Winning basketball, folks.'
    ],
    'note.drought': [
      '{team} finally score after {droughtMin} without a point — and it wasn’t the defense, it was the shot diet. Live in the paint and the game opens back up.',
      'That ends {droughtMin} of nothing for {team}. Droughts end one way: somebody simple does something simple.'
    ],
    'note.clutch': [
      'Now we find out who wants it. Two things win close games: get a stop, and get your best player the basketball. Everything else is noise.',
      'This is where rotations shorten and every possession is currency. Spend them wisely.'
    ],
    'reaction.kickout': [
      'The defense collapsed two to the ball and the extra pass found the shooter. Textbook — you CANNOT guard that.',
      'Watch the help defender — the drive puts him in jail, and the kick-out walks him right into it.'
    ],
    'reaction.transition': [
      'Buckets like that start on the DEFENSIVE end — you get a stop, you run, and easy points show up.',
      'That’s stolen offense. No sets, no resistance — you simply beat five men down the floor.'
    ],
    'reaction.and_one': [
      'Strong AND smart — he initiated the contact, absorbed it, and STILL finished. You teach that.',
      'The and-one is a finisher’s trophy: soft touch through a hard foul.'
    ],
    'reaction.deep': [
      'From THAT distance, with a hand coming — some shots you can only shrug at.',
      'That’s not range, that’s a weapon. The defense guarded the line and it didn’t matter.'
    ],
    'reaction.block': [
      'Great defense is timing, not jumping — he waited, and THEN he went and got it.',
      'That block changes the next three possessions. Shooters remember.'
    ],
    'reaction.peak': [
      'My goodness. You want to know what separates professionals? THAT.',
      'I’ve been around this game a long time — that one made me sit up.',
      'Do NOT go get popcorn on this game, folks.'
    ],
    'reaction.dagger': [
      'And you can feel the air leave the building. That’s not a shot, that’s a verdict.',
      'Champions close. That’s the whole lesson.'
    ]
  },
  segments: {
    pregame: [
      'Here’s what I want you to watch tonight. {homeStyle} And on the other side? {awayStyle} Whoever imposes that identity wins this basketball game.',
      'Two very different teams, folks. {homeStyle} Meanwhile: {awayStyle} Styles make fights.'
    ],
    ft_gap: [
      'Watch the routine — same dribbles, same breath, every single time. He’s {ftLine} from the line tonight.',
      'Free throws are rhythm, not pressure. {ftLine} tonight from the stripe.',
      'Quiet feet, high release. That’s the whole recipe from the line.'
    ],
    recap_q: [
      'One number from that quarter: {statNote}. That’s the story so far. {topNote}.',
      'Put the quarter on one card: {statNote}. And underline this — {topNote}.'
    ],
    recap_half: [
      'Half a game in the books, and the ledger says: {statNote}. {topNote}. The adjustment window is open — let’s see who walks through it.',
      'At the break: {statNote}. {topNote}. Halftime is for honesty, folks — one of these locker rooms is hearing some right now.'
    ],
    final: [
      'The bottom line tonight: {statNote}. {topNote}. That’s the game, right there.',
      'When you file this one away, remember: {statNote}. {topNote}.'
    ],
    garbage: [
      'This one’s decided, but stay with me — watch the young legs out there. Coaches remember these minutes.',
      'The starters can put their warmups on, and the film session just got long for one of these teams.'
    ]
  }
};

/**
 * DANA BOONE — the firecracker. Kinetic imagery, personal-record volume at
 * peak, still accurate underneath the noise. The alternative pbp voice.
 */
export const BOONE: VoicePack = {
  id: 'boone',
  displayName: 'Dana Boone',
  role: 'pbp',
  style: { statAffinity: 0.3 },
  signatures: [
    {
      id: 'area-code',
      text: [
        '{Player} FROM ANOTHER AREA CODE — ARE YOU KIDDING ME?!',
        '{Player} just pulled from {dist} FEET and it’s PURE! WOW!'
      ],
      when: { kinds: ['shot_made'], tags: ['deep'], minHeat: 0.72 },
      perGame: 2
    },
    {
      id: 'goodness',
      text: [
        'OH, GOODNESS GRACIOUS — {Player}!',
        '{Player}! MY GOODNESS!'
      ],
      when: { kinds: ['shot_made', 'shot_blocked'], minHeat: 0.8 },
      perGame: 2
    }
  ],
  pools: {
    game_start: [
      'STRAP IN, everybody — {home} and {away}, and this gym is ready to BOIL.',
      'Hello, friends, and hold onto something: {home}, {away}, forty-eight minutes, no mercy.'
    ],
    tip: [
      '{team} win the tip and AWAY WE GO!',
      'Ball to {team} — light the fuse!'
    ],
    period_start: [
      '{period_phrase}, everybody — no naps allowed.',
      'And we’re back for {period_phrase}!'
    ],
    period_end: [
      'The horn ends {period_phrase} — {score_phrase}!',
      'BANG goes the horn — after {period_phrase} it’s {score_phrase}.'
    ],
    game_end: [
      'IT’S OVER! {winner} take it, {final_score}!',
      'Ballgame! Put it in the books: {score_phrase}.'
    ],
    'shot_made.heave': [
      '{Player} FROM THE OTHER TIME ZONE — IT WENT IN! IT WENT IN!',
      'HEAVE… HISTORY! {Player} from {dist} feet — UNBELIEVABLE!'
    ],
    'shot_made.and_one': [
      '{player} takes the hit and SCORES — and-one, count it and add the freebie!',
      'THROUGH the contact — {player} says gimme the bucket AND the whistle!'
    ],
    'shot_made.putback': [
      '{player} snatches the miss and SLAMS the door — putback!',
      'Garbage man special — {player} with the putback!'
    ],
    'shot_made.repeat': [
      '{player} AGAIN — somebody stop him, because {opp} sure can’t!',
      'Him again! {player} has {ptsTonight} and he is COOKING!'
    ],
    'shot_made.kickout': [
      'Drive, kick, KABOOM — {player} from {spot}!',
      'The kick-out finds {player} — and he makes the defense PAY!'
    ],
    'shot_made.three.flat': [
      '{player} drops the triple from {spot}.',
      'Splash — {player} from {spot}.',
      '{player} from downtown — good!'
    ],
    'shot_made.three.elevated': [
      '{player} from {spot} — WET!',
      '{player} lets it RIP from {spot} — bullseye!',
      'Rainmaker! {player} from {dist} feet!'
    ],
    'shot_made.three.peak': [
      '{Player} FROM {spot} — BOOM GOES THE DYNAMITE!',
      '{Player} RISES AND FIRES — GOT IT! THE ROOF JUST CAME OFF!',
      'ARE YOU SERIOUS?! {Player} from {dist} feet!'
    ],
    'shot_made.rim.flat': [
      '{player} finishes at the cup.',
      '{player} gets downhill and cashes the deuce.',
      'Layup — {player}.'
    ],
    'shot_made.rim.elevated': [
      '{player} attacks the rack — FINISHES!',
      '{player} goes THROUGH the paint like it owes him money!',
      'Coast to coast? Close enough — {player} lays it in!'
    ],
    'shot_made.rim.peak': [
      '{Player} AT THE RIM — NO PRISONERS!',
      '{Player} bullies it home — this crowd is UNGLUED!'
    ],
    'shot_made.paint': [
      '{player} teardrops it in.',
      'Floater — {player}, good.',
      '{player} with the touch in the lane.'
    ],
    'shot_made.mid.flat': [
      '{player} from {spot} — knocks it down.',
      'Middy for {player} — count it.',
      '{player} pulls from {dist} — money.'
    ],
    'shot_made.mid.elevated': [
      '{player} pulls up — SNAP goes the net from {dist}!',
      'Elbow jumper {player} — BUTTER!'
    ],
    'shot_made.mid.peak': [
      '{Player} PULLS UP — DAGGER-RANGE JUMPER, GOOD!',
      '{Player} from {dist} — ICE COLD!'
    ],
    'shot_made.transition': [
      '{player} OUTRUNS the whole building — break points!',
      'Fast break, {player} — the jets were ON!',
      'Steal the ball, steal the points — {player} in transition!'
    ],
    // generic safety nets — see the note on Corbin's equivalents
    shot_made: [
      '{player} gets it to GO — {ptsTonight} on the night!',
      '{player} cashes it in!'
    ],
    shot_missed: [
      '{player} misses the mark.',
      'Nope — {player} can’t connect.'
    ],
    'shot_missed.three': [
      '{player} from {spot} — CLANK.',
      'No sir — {player} misfires from deep.',
      '{player}’s triple won’t drop.'
    ],
    'shot_missed.rim': [
      '{player} can’t buy the layup!',
      'Point blank and NO — {player} misses.',
      'The rim rejects {player}’s finish.'
    ],
    'shot_missed.paint': [
      'The floater from {player} — no dice.',
      '{player}’s runner rolls off.'
    ],
    'shot_missed.mid': [
      '{player} from {dist} — off the mark.',
      'Brick from {spot} — {player} misses.',
      '{player}’s jumper hits back iron.'
    ],
    'shot_missed.heave': [
      'The prayer from {player} goes UNANSWERED.',
      '{player} lets the miracle fly — not tonight.'
    ],
    shot_blocked: [
      '{blocker} SENDS IT BACK! Not in his neighborhood!',
      'REJECTED! {blocker} with the eraser on {player}!',
      '{blocker} just VOLLEYBALL-SPIKED that thing!'
    ],
    'free_throw.made': [
      '{player} cashes the freebie, {n} of {of}.',
      'Stripe money — {n} of {of} good.'
    ],
    'free_throw.miss': [
      'CLANK from the line — {n} of {of} no good.',
      '{player} bricks the freebie.'
    ],
    'rebound.off': [
      '{player} steals an extra life on the offensive glass!',
      'Board battle won by {player} — {team} keep it!'
    ],
    'rebound.def': [
      '{player} inhales the rebound.',
      'Glass cleaned — {player}.',
      '{player} snatches the board.'
    ],
    'turnover.steal': [
      'PICKPOCKET! {stealer} robs {victim} in broad daylight!',
      '{stealer} jumps the lane — LARCENY!'
    ],
    'turnover.charge': [
      'CHARGE! {victim} ran the red light and got the ticket!',
      '{victim} bowls him over — offensive foul, no sale!'
    ],
    'turnover.shot_clock': [
      'The clock STRANGLES {team} — violation!',
      'Twenty-four gone — {team} never got a shot off!'
    ],
    'turnover.oob': [
      '{victim} fires it into the third row — turnover!',
      'Butterfingers — {victim} throws it away!'
    ],
    'foul.shooting': [
      'Whistle! They got {player} on the shot.',
      'Foul on the fly — {player} sends him to the line.'
    ],
    'foul.reach': [
      '{player} gets greedy — reach-in foul.',
      'Cookie-jar special — reach-in on {player}.'
    ],
    'foul.loose_ball': [
      'Bodies everywhere — loose-ball foul on {player}.'
    ],
    'foul.offensive': [
      'Offensive foul — {player} did the crime.',
    ],
    substitution: [
      'Fresh legs: {in} in for {out}.',
      '{team} go to the bench — {in} for {out}.'
    ],
    'note.clutch': [
      'Cancel your plans, folks — {lead_phrase}, {clock_phrase}!',
      'Crunch time: {lead_phrase}, {clock_phrase} — this is why you bought the ticket!'
    ]
  }
};

/** the shipped two-voice booths */
export const BOOTH_PRESETS: Record<'classic' | 'latenight', { pbp: VoicePack; color: VoicePack }> = {
  classic: { pbp: CORBIN, color: TREMAINE },
  latenight: { pbp: BOONE, color: TREMAINE }
};

export type BoothPresetId = keyof typeof BOOTH_PRESETS;
