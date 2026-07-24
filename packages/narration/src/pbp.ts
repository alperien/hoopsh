/**
 * Template play-by-play: every event rendered to broadcast-ready text with
 * seeded variety pools and repeat-avoidance. Deterministic per game seed.
 */

import { Rng, type GameEvent, type Team, type TeamSide } from '@hoopsh/engine';
import { ContextTracker, type NarrativeMoment } from './context.js';

export interface NarrationLine {
  t: number;
  period: number;
  clock: number;
  score: [number, number];
  kind: 'pbp' | 'color' | 'moment';
  text: string;
}

interface Lookup {
  name: (id: string) => string;
  last: (id: string) => string;
  teamName: (side: TeamSide) => string;
  abbrev: (side: TeamSide) => string;
}

export function makeLookup(teams: [Team, Team]): Lookup {
  const names = new Map<string, string>();
  for (const t of teams) for (const p of t.players) names.set(p.id, p.name);
  return {
    name: (id) => names.get(id) ?? id,
    last: (id) => {
      const nm = names.get(id) ?? id;
      const parts = nm.split(' ');
      return parts[parts.length - 1] ?? nm;
    },
    teamName: (side) => teams[side].name,
    abbrev: (side) => teams[side].abbrev
  };
}

function fmtClock(clock: number): string {
  const m = Math.floor(clock / 60);
  const s = Math.floor(clock % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function periodName(period: number, totalPeriods: number): string {
  if (period > totalPeriods) return `OT${period - totalPeriods > 1 ? period - totalPeriods : ''}`;
  return `Q${period}`;
}

/** pick with repeat-avoidance memory */
class Pool {
  private lastIdx = new Map<string, number>();
  private rng: Rng;
  constructor(rng: Rng) {
    this.rng = rng;
  }
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
  opts?: { seed?: string; includeMoments?: boolean }
): NarrationLine[] {
  const rng = new Rng(opts?.seed ?? 'pbp');
  const pool = new Pool(rng);
  const lk = makeLookup(teams);
  const tracker = new ContextTracker();
  const out: NarrationLine[] = [];
  const totalPeriods = 4;

  const line = (e: GameEvent, kind: NarrationLine['kind'], text: string): void => {
    out.push({ t: e.t, period: e.period, clock: e.clock, score: e.score, kind, text });
  };

  for (const e of events) {
    const moments = tracker.update(e);
    const text = renderEvent(e, lk, pool, tracker, totalPeriods);
    if (text) line(e, 'pbp', text);
    if (opts?.includeMoments !== false) {
      for (const m of moments) {
        const mt = renderMoment(m, lk);
        if (mt) line(e, 'moment', mt);
      }
    }
  }
  return out;
}

function renderMoment(m: NarrativeMoment, lk: Lookup): string | null {
  switch (m.kind) {
    case 'run':
      return `${lk.teamName(m.team!)} are on a ${m.detail}.`;
    case 'lead_change':
      return `${lk.teamName(m.team!)} take the lead.`;
    case 'tie':
      return `We're ${m.detail}.`;
    case 'milestone':
      return `${lk.name(m.playerId!)} is up to ${m.detail.replace('+', '')} tonight.`;
    case 'clutch_start':
      return `Under three minutes now, one-possession territory — winning time.`;
    default:
      return null;
  }
}

function renderEvent(
  e: GameEvent,
  lk: Lookup,
  pool: Pool,
  tracker: ContextTracker,
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
      return `That's the end of ${label}: ${lk.abbrev(0)} ${h}, ${lk.abbrev(1)} ${a}.`;
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
      }
      return null;
    }
    case 'foul': {
      const who = lk.last(e.on);
      const base =
        e.kind === 'shooting' ? `Whistle — shooting foul on ${who}` :
        e.kind === 'reach' ? `Reach-in foul on ${who}` :
        e.kind === 'loose_ball' ? `Loose-ball foul on ${who}` :
        `Offensive foul on ${who}`;
      const extras: string[] = [];
      if (e.personalCount >= 4) extras.push(`that's ${e.personalCount} on him`);
      if (e.inBonus && e.kind !== 'offensive') extras.push(`${lk.abbrev(e.team === 0 ? 1 : 0)} are in the bonus`);
      if (e.fouledOut) extras.push(`and he's fouled out`);
      return `${base}${extras.length ? ' — ' + extras.join(', ') : ''}.`;
    }
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

  const shotDesc =
    e.moveType === 'heave' ? 'desperation heave from way downtown' :
    e.moveType === 'putback' ? 'putback' :
    e.moveType === 'drive' ? (e.zone === 'rim' ? 'driving layup' : `running ${DIST(e.distFt)}`) :
    e.moveType === 'cut_finish' ? 'cutting finish at the rim' :
    e.moveType === 'post' ? 'post move' :
    e.three ? (e.moveType === 'pull_up' ? `pull-up three from ${Math.round(e.distFt)} feet` : 'catch-and-shoot three') :
    e.zone === 'rim' ? 'shot at the rim' :
    e.zone === 'mid' ? `${open ? '' : 'mid-range '}jumper from ${Math.round(e.distFt)} feet` :
    `${DIST(e.distFt)} in the paint`;

  if (e.blockedBy) {
    return pool.pick('blk', [
      `${who}'s ${shotDesc} is SWATTED by ${lk.last(e.blockedBy)}!`,
      `Rejected! ${lk.last(e.blockedBy)} says no to ${who}.`,
      `${lk.last(e.blockedBy)} erases the ${shotDesc} from ${who}!`
    ]);
  }

  if (e.made) {
    const assistTag = e.assist ? ` (${lk.last(e.assist)} with the dime)` : '';
    const andOne = e.foul?.andOne ? ` AND the foul!` : '';
    if (e.three) {
      return pool.pick('made3', [
        `${who} lets it fly... BANG! ${open}triple${andOne}${assistTag}`,
        `${who} from deep... got it!${andOne}${assistTag}`,
        `Splash! ${who} buries the ${open}three.${assistTag}`,
        `${who} rises from beyond the arc — pure!${andOne}${assistTag}`
      ]);
    }
    return pool.pick('made2', [
      `${who} finishes the ${shotDesc}${andOne ? ' — and one!' : '.'}${assistTag}`,
      `${who} with the ${shotDesc} — good!${andOne}${assistTag}`,
      `Bucket. ${who} converts the ${open}${shotDesc}.${assistTag}`
    ]);
  }

  return pool.pick('miss', [
    `${who}'s ${open}${shotDesc} rims out.`,
    `${who} misses the ${shotDesc}.`,
    `No good — ${who} can't drop the ${shotDesc}.`,
    `${who}'s ${shotDesc} is off the mark.`
  ]);
}
