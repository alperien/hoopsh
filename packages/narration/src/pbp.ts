/**
 * Template play-by-play: every event rendered to broadcast-ready text with
 * seeded variety pools and repeat-avoidance. Deterministic per game seed.
 *
 * Maintained template layer (docs/INTERNALS.md "Consumers" note,
 * ARCHITECTURE.md §6; the FROZEN PROTOTYPE label an earlier header carried
 * belongs to the viewer, not narration — audit L-33): the reference
 * consumer of the event stream, not a production broadcast product. The
 * engine never depends on this file or anything it produces — it's a
 * one-way consumer of `GameEvent`s (AGENTS.md §1.3/§6).
 *
 * Template pools philosophy: every rendered line for a repeatable situation
 * (a made two, a missed free throw, a steal, ...) has 2-4 hand-written text
 * variants rather than one fixed template, specifically so a viewer watching
 * many games — or many possessions in one game — doesn't hear "X makes the
 * jumper" verbatim every single time. This is flavor variety for READING
 * comfort, not a claim that any one variant is more "correct" than another;
 * they're interchangeable in basketball meaning, chosen only to avoid
 * monotony. Same spirit as AGENTS.md §5's comment-voice guidance (explain
 * the reason, not just the mechanic) — the reason these pools exist is
 * narration pacing/feel, not a functional requirement of the event data.
 */

import { Rng, type GameEvent, type Team, type TeamSide } from '@hoopsh/engine';
import { ContextTracker, type NarrativeMoment } from './context.js';
import { shotCall, type ShooterTraits } from './shotcall.js';

export interface NarrationLine {
  t: number;
  period: number;
  clock: number;
  score: [number, number];
  // 'color' is UNWIRED (AGENTS.md DO-NOT #5): nothing in this package emits
  // it — the broadcast pipeline carries color commentary on its own
  // BroadcastCue.speaker instead. It stays in the union as the slot a
  // future single-stream consumer (one merged NarrationLine feed instead of
  // BroadcastCue) would use; it waits until that consumer is written.
  kind: 'pbp' | 'color' | 'moment';
  text: string;
}

interface Lookup {
  name: (id: string) => string;
  last: (id: string) => string;
  teamName: (side: TeamSide) => string;
  abbrev: (side: TeamSide) => string;
  /** shooter athleticism for the layup/dunk shot call (see shotcall.ts) */
  traits: (id: string) => ShooterTraits | undefined;
}

export function makeLookup(teams: [Team, Team]): Lookup {
  const names = new Map<string, string>();
  const traits = new Map<string, ShooterTraits>();
  for (const t of teams) {
    for (const p of t.players) {
      names.set(p.id, p.name);
      traits.set(p.id, { vertical: p.attr.vertical, finishing: p.attr.finishing });
    }
  }
  // disambiguate shared last names ("R. Vance" vs "E. Vance"). Counted
  // across BOTH teams together (not per-team) because two players who share
  // a last name across OPPOSING rosters are just as ambiguous in a line of
  // play-by-play text as two teammates would be — "Vance drives" is unclear
  // regardless of which side either Vance plays for.
  // trim + whitespace-run split throughout: a padded roster name
  // ("  Eli Vance ") otherwise splits into empty fragments — the collision
  // prefix rendered "undefined. Vance" (parts[0] was '') and a trailing
  // space made the "last name" the empty string, an empty actor in every
  // line (audit M-38). Names are display data from packs; normalize here
  // rather than trusting pack hygiene.
  const lastCount = new Map<string, number>();
  for (const nm of names.values()) {
    const last = nm.trim().split(/\s+/).pop() ?? nm;
    lastCount.set(last, (lastCount.get(last) ?? 0) + 1);
  }
  return {
    name: (id) => (names.get(id) ?? id).trim(),
    // `last()` is what nearly every rendered line calls (see renderEvent/
    // renderShot below) — full names read as too formal for broadcast-style
    // PBP ("Marcus Vance drives" vs. the "Vance drives" a real broadcast
    // would say), so this is the primary display form, with the first-
    // initial prefix as a fallback ONLY when lastCount flags a collision.
    // `parts.length > 1` guards a mononym (single-word name, no space) from
    // ever producing a floating ". " with nothing before it — same guard as
    // the independently-implemented viewer copy of this logic in
    // packages/viewer/index.html's boot().
    last: (id) => {
      const nm = names.get(id) ?? id;
      const parts = nm.trim().split(/\s+/);
      const last = parts[parts.length - 1] || nm;
      if ((lastCount.get(last) ?? 0) > 1 && parts.length > 1) {
        return `${parts[0]![0]}. ${last}`;
      }
      return last;
    },
    teamName: (side) => teams[side].name,
    abbrev: (side) => teams[side].abbrev,
    traits: (id) => traits.get(id)
  };
}

function periodName(period: number, totalPeriods: number): string {
  if (period > totalPeriods) return `OT${period - totalPeriods > 1 ? period - totalPeriods : ''}`;
  // a 2-period ruleset plays halves, not quarters (NCAA men, halves packs):
  // "Q2" was the wrong label for the 2nd half — the OT arm above landed in
  // the same class of fix but regulation halves were missed (audit M-39)
  if (totalPeriods === 2) return period === 1 ? '1st half' : '2nd half';
  return `Q${period}`;
}

/**
 * pick with repeat-avoidance memory.
 *
 * `key` scopes the repeat-avoidance memory independently per call site — the
 * "made two" template pool and the "missed three" template pool each get
 * their own `lastIdx` slot, so avoiding a repeat in one situation never
 * affects variety in an unrelated one. Callers pass a stable string (e.g.
 * the situation name) as `key`.
 *
 * The RNG (seeded once per game — see `generatePlayByPlay` below) is what
 * makes the whole pool deterministic per seed: same seed, same sequence of
 * `pick()` outcomes, same rendered play-by-play text every run.
 */
class Pool {
  private lastIdx = new Map<string, number>();
  private rng: Rng;
  constructor(rng: Rng) {
    this.rng = rng;
  }
  // Repeat-avoidance is a re-roll, not a re-draw: if the RNG's fresh pick for
  // this key lands on the SAME index used last time for this key, bump it to
  // the next index (wrapping via modulo) rather than drawing again from the
  // RNG. This keeps the RNG's consumption count deterministic regardless of
  // whether a repeat was avoided, which matters because every other pool's
  // `pick()` shares the same underlying Rng stream — consuming a variable
  // number of random draws here would shift every subsequent pool's results
  // for the rest of the game.
  pick(key: string, options: string[]): string {
    if (options.length === 1) return options[0]!;
    let idx = this.rng.int(options.length);
    if (idx === this.lastIdx.get(key)) idx = (idx + 1) % options.length;
    this.lastIdx.set(key, idx);
    return options[idx]!;
  }
}

const DIST = (ft: number): string => `${Math.round(ft)}-footer`;

export function generatePlayByPlay(
  events: GameEvent[],
  teams: [Team, Team],
  opts?: { seed?: string; includeMoments?: boolean; periods?: number }
): NarrationLine[] {
  const rng = new Rng(opts?.seed ?? 'pbp');
  const pool = new Pool(rng);
  const lk = makeLookup(teams);
  const out: NarrationLine[] = [];
  // regulation period count from the rule pack (NBA 4, NCAA 2, ...) so OT
  // and halves label correctly. Defaults to 4 (NBA quarters) when the caller
  // doesn't pass one, but any ruleset with a different period count (e.g.
  // NCAA's 2 halves) should pass its actual count here — `periodName()`
  // treats every `period > totalPeriods` as overtime ("OT", "OT2", ...)
  // rather than a regulation period label, and the ContextTracker keys its
  // clutch_start "final period" test on the same count (a hardcoded 4 made
  // winning time unreachable in NCAA regulation — scan finding B6-1). Get
  // this wrong and a halves ruleset's "2nd half" would render as "OT1".
  const totalPeriods = opts?.periods ?? 4;
  const tracker = new ContextTracker(totalPeriods);

  const line = (e: GameEvent, kind: NarrationLine['kind'], text: string): void => {
    out.push({ t: e.t, period: e.period, clock: e.clock, score: e.score, kind, text });
  };

  for (const e of events) {
    const moments = tracker.update(e);
    const text = renderEvent(e, lk, pool, totalPeriods);
    if (text) line(e, 'pbp', text);
    if (opts?.includeMoments !== false) {
      for (const m of moments) {
        const mt = renderMoment(m, lk, tracker, e.score);
        if (mt) line(e, 'moment', mt);
      }
    }
  }
  return out;
}

function renderMoment(
  m: NarrativeMoment,
  lk: Lookup,
  tracker: ContextTracker,
  score: [number, number]
): string | null {
  switch (m.kind) {
    case 'run': {
      // spoken article for the leading numeral: "an 8-0 / an 18-0 run" but
      // "a 9-0 / a 12-0 / a 16-0 run". Crossing detection (context.ts,
      // audit M-36) reports the TRUE run total, so values between the
      // 8/12/16 bars occur (a three jumping 6 -> 9 announces "a 9-0 run");
      // 8/11/18 are the leading numerals that take "an".
      const an = /^(8|11|18)-/.test(m.detail);
      return `${lk.teamName(m.team!)} are on ${an ? 'an' : 'a'} ${m.detail}.`;
    }
    case 'lead_change':
      return `${lk.teamName(m.team!)} take the lead.`;
    case 'tie':
      return `We're ${m.detail}.`;
    case 'milestone':
      // Say the player's TRUE running total, not the bar from `detail`: the
      // crossing basket usually overshoots the threshold ("20+ points"
      // stripped to "up to 20" while the player sat on 21 or 22 — a wrong
      // number on ~half of all milestone lines, audit H-08). The tracker
      // already folded the crossing basket by the time this moment reached
      // us (update() mutates before returning), so pointsFor() IS the total
      // at this instant — exactly the number a broadcaster reads off.
      return `${lk.name(m.playerId!)} is up to ${tracker.pointsFor(m.playerId!)} points tonight.`;
    case 'clutch_start': {
      // clutch fires at any margin within 6 (context.ts) — but "one
      // possession" is basketball arithmetic for a margin of 3 or less; at
      // 4-6 the old line claimed one-possession territory for what is a
      // two-possession game (audit M-40). The phrasing follows the margin
      // at the firing event; the tracker's clutch definition is unchanged.
      const margin = Math.abs(score[0] - score[1]);
      return margin <= 3
        ? `Under three minutes now, one-possession territory — winning time.`
        : `Under three minutes now, a two-possession game — winning time.`;
    }
    default:
      return null;
  }
}

function renderEvent(
  e: GameEvent,
  lk: Lookup,
  pool: Pool,
  totalPeriods: number
): string | null {
  switch (e.type) {
    case 'game_start':
      return `We're underway — ${lk.teamName(0)} hosting ${lk.teamName(1)}.`;
    case 'tip_off':
      return `${lk.teamName(e.winner)} control the tip.`;
    case 'period_start':
      return e.period === 1 ? null : `${periodName(e.period, totalPeriods)} under way.`;
    case 'period_end': {
      const [h, a] = e.score;
      const label = periodName(e.period, totalPeriods);
      // halves take an article ("the end of the 1st half"); Q/OT labels don't
      const named = label.endsWith('half') ? `the ${label}` : label;
      return `That's the end of ${named}: ${lk.abbrev(0)} ${h}, ${lk.abbrev(1)} ${a}.`;
    }
    case 'game_end': {
      const [h, a] = e.score;
      const winner = h > a ? 0 : 1;
      return `Final: ${lk.teamName(winner as TeamSide)} win it, ${Math.max(h, a)}-${Math.min(h, a)}.`;
    }
    case 'shot':
      return renderShot(e, lk, pool);
    case 'free_throw': {
      const who = lk.last(e.shooter);
      if (e.technical) {
        // the technical single, a different beat from a trip to the line
        // (no "1 of 2" bookkeeping worth saying out loud on a 1-of-1)
        return e.made
          ? pool.pick('fttm', [
              `${who} knocks down the technical.`,
              `${who} steps up and sinks the technical free throw.`,
              `The technical is good — ${who} adds the point.`
            ])
          : pool.pick('fttx', [
              `${who} misses the technical free throw.`,
              `The technical won't drop for ${who}.`
            ]);
      }
      // NCAA bonus one-and-one: `of` is the POTENTIAL 2 (core/events.ts) —
      // the second attempt exists only if the front end drops, so "(1 of 2)"
      // announced an attempt that a miss forfeits (the next event is a live
      // rebound scramble). The event carries `oneAndOne` precisely so a
      // consumer can call the front end what it is.
      if (e.oneAndOne && e.n === 1) {
        return e.made
          ? `${who} makes the front end of the one-and-one.`
          : `${who} misses the front end of the one-and-one.`;
      }
      if (e.made) {
        return pool.pick('ftm', [
          `${who} knocks down the free throw (${e.n} of ${e.of}).`,
          `${who} makes it from the line, ${e.n} of ${e.of}.`,
          `Free throw ${e.n} of ${e.of} is good.`
        ]);
      }
      return pool.pick('ftx', [
        `${who} misses the free throw (${e.n} of ${e.of}).`,
        `Free throw ${e.n} of ${e.of} rims out.`,
        `${who} can't connect from the line.`
      ]);
    }
    case 'rebound': {
      // the missed-non-final-FT formality: dead ball by rule, next attempt
      // simply proceeds — a broadcast says nothing here
      if (e.deadBall) return null;
      if (!e.player) {
        // TEAM rebound: the carom died out of bounds; a side is awarded the ball
        return e.offensive
          ? pool.pick('torb', [
              `Knocked out of bounds — ${lk.teamName(e.team)} keep it.`,
              `The carom skips out of play; ${lk.abbrev(e.team)} retain possession.`,
              `Nobody controls it — out of bounds, still ${lk.teamName(e.team)}'s ball.`
            ])
          : pool.pick('tdrb', [
              `The long rebound bounces out of bounds — ${lk.teamName(e.team)} ball.`,
              `Tipped out of play; possession to ${lk.teamName(e.team)}.`,
              `Nobody comes up with it — ${lk.abbrev(e.team)} will inbound.`
            ]);
      }
      const who = lk.last(e.player);
      return e.offensive
        ? pool.pick('orb', [
            `${who} keeps it alive on the offensive glass!`,
            `Offensive board — ${who} muscles it away.`,
            `${who} with the second-chance rebound.`
          ])
        : pool.pick('drb', [
            `${who} cleans the glass.`,
            `Rebound ${lk.abbrev(e.team)} — ${who}.`,
            `${who} secures the defensive board.`
          ]);
    }
    case 'turnover': {
      const who = lk.last(e.player);
      switch (e.kind) {
        case 'bad_pass':
          return e.stolenBy
            ? pool.pick('tostl', [
                `${lk.last(e.stolenBy)} jumps the passing lane — steal!`,
                `Picked off! ${lk.last(e.stolenBy)} reads it perfectly.`,
                `${who}'s pass is intercepted by ${lk.last(e.stolenBy)}.`
              ])
            : `${who}'s pass sails out of bounds.`;
        case 'lost_ball':
          return e.stolenBy
            ? pool.pick('strip', [
                `${lk.last(e.stolenBy)} pokes it loose from ${who}!`,
                `Stripped! ${lk.last(e.stolenBy)} with the takeaway.`,
                `${who} loses the handle — ${lk.last(e.stolenBy)} comes up with it.`
              ])
            : `${who} loses the handle out of bounds.`;
        case 'off_foul':
          return `Charge! ${who} barrels into the defender — offensive foul.`;
        case 'shot_clock':
          return `The buzzer sounds — shot-clock violation on ${lk.teamName(e.team)}.`;
        case 'out_of_bounds':
          return `${who} throws it away — out of bounds.`;
        case 'travel':
          return pool.pick('travel', [
            `${who} shuffles his feet — traveling.`,
            `Traveling on ${who}, and the whistle kills the play.`,
            `${who} takes one step too many — that's a travel.`
          ]);
        case 'off_goaltend':
          return pool.pick('offgt', [
            `${who} tips it on the rim — offensive goaltending, no basket.`,
            `Offensive goaltending on ${who} — the putback comes off the board.`,
            `${who} gets it while it's on the cylinder — offensive interference, turnover.`
          ]);
      }
      return null;
    }
    case 'foul': {
      const who = lk.last(e.on);
      const extras: string[] = [];
      if (e.personalCount >= 4) extras.push(`that's ${e.personalCount} on him`);
      if (e.inBonus && e.kind !== 'offensive') extras.push(`${lk.abbrev(e.team === 0 ? 1 : 0)} are in the bonus`);
      if (e.fouledOut) extras.push(`and he's fouled out`);
      // An offensive foul is ALWAYS the second half of a charge the engine
      // just emitted as a `turnover` (kind 'off_foul' — see core/events.ts's
      // TurnoverKind contract), and the turnover case above already narrated
      // the play ("Charge! ..."). Rendering a generic line here too produced
      // two adjacent sentences for one whistle on every single charge. Stay
      // silent UNLESS this foul carries game-state news the charge line
      // doesn't (foul trouble, a foul-out) — then narrate just that.
      if (e.kind === 'offensive') {
        return extras.length ? `On the offensive foul — ${extras.join(', ')}.` : null;
      }
      // a technical is its own beat: no personal-count/bonus news to append
      // (the engine stamps its counts unchanged; core/events.ts FoulKind)
      if (e.kind === 'technical') {
        return pool.pick('ftech', [
          `Technical foul on ${who}.`,
          `${who} has a word with the official — that's a technical.`,
          `They hit ${who} with a tech for arguing the call.`
        ]);
      }
      const base =
        e.kind === 'shooting' ? `Whistle — shooting foul on ${who}` :
        e.kind === 'reach' ? `Reach-in foul on ${who}` :
        e.kind === 'take'
          ? pool.pick('ftake', [
              `${who} wraps him up before the break gets going — take foul`,
              `Take foul from ${who} — give one to stop the run-out`,
              `${who} concedes it with the deliberate grab`
            ])
          : `Loose-ball foul on ${who}`;
      return `${base}${extras.length ? ' — ' + extras.join(', ') : ''}.`;
    }
    case 'timeout': {
      // endgame-layer events — and the layer is ON by default now, so these
      // appear in ordinary streams. The two reasons read differently on a
      // broadcast: a run-stopper is about the bleeding, an advance is pure
      // late-game procedure.
      const team = lk.teamName(e.team);
      if (e.reason === 'advance') {
        return pool.pick('to_adv', [
          `Timeout ${team} — they'll advance the ball into the frontcourt.`,
          `${team} use a timeout to move the ball up. ${e.remaining} left.`
        ]);
      }
      return pool.pick('to_run', [
        `Timeout ${team} — got to stop this run.`,
        `${team} call time to regroup. ${e.remaining} remaining.`,
        `That'll be a timeout from the ${team} bench.`
      ]);
    }
    case 'jump_ball': {
      // mid-game held ball (period openers are tip_off events); the tap
      // usually finds a third player, worth naming (corpus: 96%)
      const gainer = lk.last(e.gainedBy);
      return pool.pick('jump', [
        `Held ball! ${lk.last(e.between[0])} and ${lk.last(e.between[1])} tie it up — ${gainer} comes away with the tap.`,
        `Jump ball — ${gainer} wins it for ${lk.teamName(e.winner)}.`,
        `They're tied up, and we'll have a jump… ${gainer} controls it for ${lk.teamName(e.winner)}.`
      ]);
    }
    case 'violation': {
      // player is optional on the contract (real logs attribute some kinds
      // to Team); fall back to the violating side's name
      const culprit = e.player ? lk.last(e.player) : lk.teamName(e.team);
      if (e.kind === 'def_goaltend') {
        return pool.pick('dgt', [
          `Goaltending on ${culprit} — the basket counts.`,
          `That's goaltending — ${culprit} got it on the way down, and they'll count it.`,
          `Too late on the swat by ${culprit} — goaltend, good basket.`
        ]);
      }
      const off = lk.teamName(e.team === 0 ? 1 : 0);
      return pool.pick('kick', [
        `Kicked ball on ${culprit} — ${off} keep it, fresh clock coming.`,
        `${culprit} sticks a foot out — kicked ball, and ${off} retain.`,
        `Whistle: kicked ball. ${off} will play on with a reset clock.`
      ]);
    }
    case 'replay_review':
      // no outcome on the event by design; reviews never overturn (v1), so
      // the narration owns the "stands" beat
      return e.trigger === 'period_end'
        ? pool.pick('rrp', [
            `They'll review it before the break — the call stands.`,
            `One last look at the monitor before the horn… stands.`
          ])
        : pool.pick('rr', [
            `Officials take a look at the monitor… the call stands.`,
            `We're going to replay — after the review, no change.`,
            `Quick check with the replay center, and the call on the floor stands.`
          ]);
    case 'substitution':
      return null; // too noisy for PBP; viewers show these separately
    case 'possession_start':
    case 'possession_end':
      return null;
    default:
      return null;
  }
}

function renderShot(
  e: Extract<GameEvent, { type: 'shot' }>,
  lk: Lookup,
  pool: Pool
): string {
  const who = lk.last(e.shooter);
  const open = e.contest < 0.18 ? 'wide-open ' : e.contest > 0.62 ? 'heavily contested ' : '';

  // the shot's basketball NAME (layup/dunk/hook/tip-in/jump shot) comes from
  // the shared classifier — the broadcast register then dresses it up by how
  // the shot was created. This is the shot-type-monotony fix: short attempts
  // used to all read as generic jumpers/paint shots (Turing baseline tell).
  const call = shotCall(e, lk.traits(e.shooter));
  const shotDesc =
    e.moveType === 'heave' ? 'desperation heave from way downtown' :
    call === 'tip-in' ? 'tip-in' :
    call === 'dunk' ? (
      e.moveType === 'putback' ? 'putback slam' :
      e.moveType === 'drive' ? 'driving dunk' : 'dunk'
    ) :
    call === 'hook shot' ? `${DIST(e.distFt)} hook` :
    call === 'layup' ? (
      e.moveType === 'putback' ? 'putback layup' :
      e.moveType === 'drive' ? 'driving layup' :
      e.moveType === 'cut_finish' ? 'cutting layup' : 'layup'
    ) :
    // jump shots, by flavor of creation and range
    e.moveType === 'post' ? 'turnaround out of the post' :
    e.three ? (e.moveType === 'pull_up' ? `pull-up three from ${Math.round(e.distFt)} feet` : 'catch-and-shoot three') :
    e.zone === 'paint' ? (
      (e.moveType === 'drive' || e.moveType === 'pull_up') && e.distFt <= 10
        ? `floater from ${Math.round(e.distFt)} feet` // the runner/teardrop range
        : `${DIST(e.distFt)} in the paint`
    ) :
    `${open ? '' : 'mid-range '}jumper from ${Math.round(e.distFt)} feet`;

  if (e.blockedBy) {
    return pool.pick('blk', [
      `${who}'s ${shotDesc} is SWATTED by ${lk.last(e.blockedBy)}!`,
      `Rejected! ${lk.last(e.blockedBy)} says no to ${who}.`,
      `${lk.last(e.blockedBy)} erases the ${shotDesc} from ${who}!`
    ]);
  }

  if (e.made) {
    const assistTag = e.assist ? ` (${lk.last(e.assist)} with the dime)` : '';
    // The and-one call is APPENDED to whichever template the pool picks,
    // never baked into individual variants: two of the seven made-shot
    // templates used to omit it, so "AND the foul!" silently vanished on
    // ~38% of and-one makes depending on the draw (audit L-30). A made shot
    // carrying e.foul.andOne must always say so — the bonus free throw that
    // follows is otherwise unexplained on the broadcast.
    const andOne = e.foul?.andOne ? ` AND the foul!` : '';
    const body = e.three
      ? pool.pick('made3', [
          `${who} lets it fly... BANG! ${open}triple`,
          `${who} from deep... got it!`,
          `Splash! ${who} buries the ${open}three.`,
          `${who} rises from beyond the arc — pure!`
        ])
      : pool.pick('made2', [
          `${who} finishes the ${shotDesc}.`,
          `${who} with the ${shotDesc} — good!`,
          `Bucket. ${who} converts the ${open}${shotDesc}.`
        ]);
    return `${body}${andOne}${assistTag}`;
  }

  return pool.pick('miss', [
    `${who}'s ${open}${shotDesc} rims out.`,
    `${who} misses the ${shotDesc}.`,
    `No good — ${who} can't drop the ${shotDesc}.`,
    `${who}'s ${shotDesc} is off the mark.`
  ]);
}
