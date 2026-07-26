/**
 * Beat compiler — turns raw events into narratable Beats: the event, its
 * basketball meaning (tags), its floor geography, its play chain, a frozen
 * snapshot of every number a template might cite, and a HEAT score that
 * decides how much the moment matters.
 *
 * Heat is the booth's dramaturgy: it selects the register (flat / elevated /
 * peak), which selects template pools, sentence energy, signature-call
 * eligibility, and whether the analyst reacts. Every constant in the model is
 * FEEL — hand-tuned for how often each register should occur across a typical
 * game (roughly: most beats flat, a handful of peaks per close game, near-zero
 * peaks in a blowout). None of this is SimParams surface; it tunes narration
 * pacing, not basketball.
 *
 * Consumer-tier module: pure fold over (events, teams, rules). Deterministic —
 * no RNG here at all; randomness enters only at voice rendering.
 */

import { NBA, type GameEvent, type RulePack, type ShotEvent, type Team, type TeamSide } from '@hoopsh/engine';
import { GameSense, type SenseDelta } from './sense.js';
import { makeGeo, shotSpot, type GeoContext, type ShotSpot } from './geometry.js';

export type Register = 'flat' | 'elevated' | 'peak';

export type BeatKind =
  | 'game_start' | 'tip' | 'period_start' | 'period_end' | 'game_end'
  | 'shot_made' | 'shot_missed' | 'shot_blocked'
  | 'free_throw' | 'rebound' | 'turnover' | 'foul' | 'substitution'
  | 'note';

export type NoteKind = 'run' | 'milestone' | 'drought_break' | 'foul_trouble' | 'double_double' | 'clutch';

export type BeatTag =
  | 'three' | 'deep' | 'logo' | 'corner' | 'heave' | 'putback' | 'drive' | 'pull_up' | 'catch_shoot'
  | 'and_one' | 'wide_open' | 'contested' | 'buzzer'
  | 'transition' | 'kickout' | 'extra_pass' | 'second_chance'
  | 'go_ahead' | 'tie' | 'dagger' | 'late_close' | 'garbage'
  | 'hot' | 'cold' | 'drought_break' | 'milestone' | 'big_run'
  | 'steal' | 'charge' | 'shot_clock' | 'bonus' | 'fouled_out';

/** numbers frozen at beat time so templates cite the same truth the booth saw */
export interface SenseSnapshot {
  score: [number, number];
  margin: number;
  leader: TeamSide | -1;
  /** unanswered run for the beat's team (0 when not applicable) */
  run: number;
  /** primary actor's line at this moment */
  pts: number;
  ptsThisPeriod: number;
  reb: number;
  ast: number;
  pf: number;
  ftm: number;
  fta: number;
  hitStreak: number;
  /** game-seconds the scoring team had gone scoreless before this beat (0 = n/a) */
  droughtSecs: number;
  /** completed passes this possession */
  passes: number;
  offenseInBonus: boolean;
  /** period recap material — only on period_end / game_end beats */
  recap?: {
    pts: [number, number];
    tpm: [number, number];
    tov: [number, number];
    paint: [number, number];
    fb: [number, number];
    topHome: [string, number];
    topAway: [string, number];
    leadChanges: number;
    ties: number;
  };
}

export interface Beat {
  event: GameEvent;
  kind: BeatKind;
  /** the beat's team perspective where one exists (scoring/fouling/rebounding side) */
  team?: TeamSide;
  /** primary actor (shooter, rebounder, fouler, turnover-committer, FT shooter) */
  primary?: string;
  /** secondary actor (blocker, stealer, assister, foul-drawer, sub-in) */
  secondary?: string;
  note?: { kind: NoteKind; playerId?: string; team?: TeamSide; value?: number };
  tags: BeatTag[];
  spot?: ShotSpot;
  chain?: { passer: string; passKind: string } | null;
  heat: number;
  register: Register;
  snap: SenseSnapshot;
}

const REGISTER_ELEVATED = 0.4; // FEEL — heat floor for the elevated register
const REGISTER_PEAK = 0.72; // FEEL — heat floor for the peak register

function registerOf(heat: number): Register {
  return heat >= REGISTER_PEAK ? 'peak' : heat >= REGISTER_ELEVATED ? 'elevated' : 'flat';
}

/**
 * Leverage: how much the game situation itself is worth, independent of the
 * play. closeness × progress², with a clutch floor once the game is inside
 * 5:00 / margin ≤ 8 (FEEL — approximates when real broadcasts audibly shift).
 */
function leverage(e: GameEvent, regulationSecs: number): number {
  const margin = Math.abs(e.score[0] - e.score[1]);
  const closeness = Math.max(0, 1 - margin / 16);
  const progress = Math.min(1, e.t / regulationSecs);
  let lev = closeness * (0.2 + 0.8 * progress * progress);
  if (e.period >= 4 && e.clock <= 300 && margin <= 8) {
    lev = Math.max(lev, 0.5 + 0.45 * closeness);
  }
  return lev;
}

/** spectacle: the play in isolation (FEEL table — see module header) */
function spectacle(kind: BeatKind, e: GameEvent, tags: BeatTag[]): number {
  const has = (t: BeatTag): boolean => tags.includes(t);
  switch (kind) {
    case 'shot_made': {
      if (has('heave')) return 0.95;
      let s = 0.18;
      if (has('three')) s += 0.14;
      if (has('deep')) s += 0.08;
      if (has('logo')) s += 0.15;
      if (has('drive')) s += 0.08;
      if (has('putback')) s += 0.14;
      if (has('and_one')) s += 0.22;
      if (has('buzzer')) s += 0.3;
      if (has('transition')) s += 0.05;
      return s;
    }
    case 'shot_blocked': return 0.38;
    case 'shot_missed': return has('heave') ? 0.02 : 0.05;
    case 'free_throw': return 0.04;
    case 'rebound': return (e.type === 'rebound' && e.offensive) ? 0.15 : 0.06;
    case 'turnover':
      return has('steal') ? 0.3 : has('charge') ? 0.22 : has('shot_clock') ? 0.15 : 0.1;
    case 'foul': return has('fouled_out') ? 0.35 : 0.08;
    case 'note': return 0.3;
    case 'tip': return 0.15;
    case 'game_end': {
      const margin = Math.abs(e.score[0] - e.score[1]);
      return margin <= 3 ? 0.9 : margin <= 8 ? 0.7 : 0.4;
    }
    default: return 0.1;
  }
}

export interface CompileOptions {
  rules?: RulePack;
}

/**
 * Compile the full beat list for a game. One pass, one GameSense fold; note
 * beats (runs, milestones, foul trouble, double-doubles, clutch entry) are
 * emitted immediately after the beat that caused them, so a renderer sees
 * them in broadcast order.
 */
export function compileBeats(events: GameEvent[], teams: [Team, Team], opts?: CompileOptions): Beat[] {
  const rules = opts?.rules ?? NBA;
  const geo = makeGeo(rules);
  const regulationSecs = rules.periods * rules.periodMinutes * 60;
  const sense = new GameSense(teams);
  const beats: Beat[] = [];

  for (const e of events) {
    // capture possession context BEFORE update: a made shot's possession ends
    // after it, but the pass chain that produced it belongs to the beat.
    const possBefore = sense.poss;
    const delta = sense.update(e);
    const beat = makeBeat(e, sense, delta, possBefore, geo, regulationSecs);
    if (beat) beats.push(beat);
    for (const note of noteBeats(e, sense, delta, regulationSecs)) beats.push(note);
  }
  return beats;
}

function snapshotFor(e: GameEvent, sense: GameSense, primary: string | undefined, team: TeamSide | undefined, delta: SenseDelta, withRecap: boolean): SenseSnapshot {
  const line = primary ? sense.line(primary) : undefined;
  const snap: SenseSnapshot = {
    score: [e.score[0], e.score[1]],
    margin: Math.abs(e.score[0] - e.score[1]),
    leader: e.score[0] > e.score[1] ? 0 : e.score[1] > e.score[0] ? 1 : -1,
    run: team !== undefined ? sense.team[team].run : 0,
    pts: line?.pts ?? 0,
    ptsThisPeriod: line?.ptsThisPeriod ?? 0,
    reb: line ? line.oreb + line.dreb : 0,
    ast: line?.ast ?? 0,
    pf: line?.pf ?? 0,
    ftm: line?.ftm ?? 0,
    fta: line?.fta ?? 0,
    hitStreak: line?.hitStreak ?? 0,
    droughtSecs: delta.droughtBrokenSecs ?? 0,
    passes: sense.poss?.passes ?? 0,
    offenseInBonus: team !== undefined ? sense.team[team].offenseInBonus : false
  };
  if (withRecap) {
    // the final recap talks about the GAME; a quarter recap talks about the
    // quarter — different windows, same shape.
    const d = e.type === 'game_end' ? sense.gameTotals() : sense.periodDeltas();
    snap.recap = {
      ...d,
      topHome: sense.topScorer(0),
      topAway: sense.topScorer(1),
      leadChanges: sense.leadChanges,
      ties: sense.ties
    };
  }
  return snap;
}

function shotTags(e: ShotEvent, sense: GameSense, delta: SenseDelta, possBefore: GameSense['poss'], spot: ShotSpot): BeatTag[] {
  const tags: BeatTag[] = [];
  if (e.three) tags.push('three');
  if (spot.deep) tags.push('deep');
  if (spot.logo) tags.push('logo');
  if (spot.short.includes('corner') && e.three) tags.push('corner');
  if (e.moveType === 'heave') tags.push('heave');
  if (e.moveType === 'putback') tags.push('putback');
  if (e.moveType === 'drive') tags.push('drive');
  if (e.moveType === 'pull_up') tags.push('pull_up');
  if (e.moveType === 'catch_shoot') tags.push('catch_shoot');
  if (e.foul?.andOne) tags.push('and_one');
  // contest thresholds shared with v1 pbp.ts (0.18 / 0.62) so the two layers
  // never disagree about what "wide open" means.
  if (e.contest < 0.18) tags.push('wide_open');
  if (e.contest > 0.62) tags.push('contested');
  if (e.made && e.clock < 1.0) tags.push('buzzer');
  if (possBefore && (possBefore.kind === 'steal' || possBefore.kind === 'live_rebound') && possBefore.orebs === 0 && e.t - possBefore.startT <= 8) {
    tags.push('transition');
  }
  if (possBefore && possBefore.orebs > 0) tags.push('second_chance');
  if (possBefore && possBefore.lastPass?.kind === 'kickout' && possBefore.lastPass.to === e.shooter) tags.push('kickout');
  if (e.made && possBefore && possBefore.passes >= 3 && e.assist) tags.push('extra_pass');
  if (e.made) {
    if (delta.goAhead !== undefined) tags.push('go_ahead');
    if (delta.tie !== undefined) tags.push('tie');
    if (delta.milestone) tags.push('milestone');
    if (delta.droughtBrokenSecs) tags.push('drought_break');
    if (delta.runReached && delta.runReached.run >= 12) tags.push('big_run');
    if (sense.line(e.shooter).hitStreak >= 3) tags.push('hot');
  } else if (sense.line(e.shooter).missStreak >= 4) {
    tags.push('cold');
  }
  return tags;
}

function situationTags(e: GameEvent): BeatTag[] {
  const tags: BeatTag[] = [];
  const margin = Math.abs(e.score[0] - e.score[1]);
  if (e.period >= 4 && e.clock <= 120 && margin <= 5) tags.push('late_close');
  if (e.period >= 4 && margin >= 20) tags.push('garbage');
  return tags;
}

/**
 * Dagger: a made three in the final 75 seconds that stretches a held lead to
 * decisive-but-not-blowout territory (7–14). FEEL — the shot a real PBP voice
 * lowers into "that's the dagger" over.
 */
function isDagger(e: ShotEvent, snap: SenseSnapshot): boolean {
  return (
    e.made && e.three && e.period >= 4 && e.clock <= 75 &&
    snap.leader === e.team && snap.margin >= 7 && snap.margin <= 14
  );
}

function makeBeat(
  e: GameEvent,
  sense: GameSense,
  delta: SenseDelta,
  possBefore: GameSense['poss'],
  geo: GeoContext,
  regulationSecs: number
): Beat | null {
  const finish = (
    kind: BeatKind,
    fields: Partial<Pick<Beat, 'team' | 'primary' | 'secondary' | 'tags' | 'spot' | 'chain'>>,
    withRecap = false
  ): Beat => {
    const tags = [...(fields.tags ?? []), ...situationTags(e)];
    const snap = snapshotFor(e, sense, fields.primary, fields.team, delta, withRecap);
    let heat = spectacle(kind, e, tags) + 0.5 * leverage(e, regulationSecs);
    if (tags.includes('go_ahead')) heat += e.period >= 4 && e.clock <= 120 ? 0.25 : 0.12;
    if (tags.includes('tie')) heat += e.period >= 4 && e.clock <= 120 ? 0.2 : 0.08;
    if (tags.includes('milestone')) heat += 0.06;
    if (tags.includes('big_run')) heat += 0.08;
    if (tags.includes('hot')) heat += 0.05;
    if (kind === 'shot_made' && isDagger(e as ShotEvent, snap)) {
      tags.push('dagger');
      heat = Math.max(heat, 0.8);
    }
    // garbage-time clamp: a 20-point fourth quarter deflates everything —
    // exactly how a real booth's energy behaves.
    if (tags.includes('garbage')) heat = Math.min(heat, 0.25);
    heat = Math.max(0, Math.min(1, heat));
    return { event: e, kind, tags, heat, register: registerOf(heat), snap, ...fields };
  };

  switch (e.type) {
    case 'game_start':
      return finish('game_start', {});
    case 'tip_off':
      return finish('tip', { team: e.winner });
    case 'period_start':
      return e.period === 1 ? null : finish('period_start', {});
    case 'period_end':
      return finish('period_end', {}, true);
    case 'game_end':
      return finish('game_end', {}, true);
    case 'shot': {
      const spot = shotSpot(e, geo);
      const tags = shotTags(e, sense, delta, possBefore, spot);
      const chain =
        possBefore?.lastPass && possBefore.lastPass.to === e.shooter && e.t - possBefore.lastPass.t <= 2.5
          ? { passer: possBefore.lastPass.from, passKind: possBefore.lastPass.kind }
          : null;
      const kind: BeatKind = e.blockedBy ? 'shot_blocked' : e.made ? 'shot_made' : 'shot_missed';
      return finish(kind, {
        team: e.team,
        primary: e.shooter,
        secondary: e.blockedBy ?? e.assist ?? chain?.passer,
        tags,
        spot,
        chain
      });
    }
    case 'free_throw': {
      // a made FT can flip or tie the game late — the swing tags (and their
      // heat boosts) apply exactly as they do on field goals.
      const tags: BeatTag[] = [];
      if (e.made) {
        if (delta.goAhead !== undefined) tags.push('go_ahead');
        if (delta.tie !== undefined) tags.push('tie');
        if (delta.milestone) tags.push('milestone');
        if (delta.droughtBrokenSecs) tags.push('drought_break');
      }
      return finish('free_throw', { team: e.team, primary: e.shooter, tags });
    }
    case 'rebound':
      return finish('rebound', { team: e.team, primary: e.player, tags: e.offensive ? ['second_chance'] : [] });
    case 'turnover': {
      const tags: BeatTag[] =
        e.stolenBy ? ['steal'] :
        e.kind === 'off_foul' ? ['charge'] :
        e.kind === 'shot_clock' ? ['shot_clock'] : [];
      return finish('turnover', { team: e.team, primary: e.player, secondary: e.stolenBy, tags });
    }
    case 'foul': {
      const tags: BeatTag[] = [];
      if (e.fouledOut) tags.push('fouled_out');
      if (e.inBonus && e.kind !== 'offensive') tags.push('bonus');
      return finish('foul', { team: e.team, primary: e.on, secondary: e.drawnBy, tags });
    }
    case 'substitution':
      return finish('substitution', { team: e.team, primary: e.out[0], secondary: e.in[0] });
    case 'possession_start':
    case 'possession_end':
      return null; // pure sense food — the booth never narrates these directly
    default:
      return null;
  }
}

function noteBeats(e: GameEvent, sense: GameSense, delta: SenseDelta, regulationSecs: number): Beat[] {
  const out: Beat[] = [];
  const push = (kind: NoteKind, playerId?: string, team?: TeamSide, value?: number, heatBase = 0.35): void => {
    const snap = snapshotFor(e, sense, playerId, team, delta, false);
    let heat = heatBase + 0.5 * leverage(e, regulationSecs);
    if (e.period >= 4 && Math.abs(e.score[0] - e.score[1]) >= 20) heat = Math.min(heat, 0.25);
    heat = Math.max(0, Math.min(1, heat));
    out.push({
      event: e, kind: 'note', note: { kind, playerId, team, value },
      team, primary: playerId, tags: [], heat, register: registerOf(heat), snap
    });
  };

  if (delta.runReached) push('run', undefined, delta.runReached.team, delta.runReached.run, 0.3 + delta.runReached.run / 100);
  if (delta.milestone) push('milestone', delta.milestone.playerId, undefined, delta.milestone.bar, 0.3 + delta.milestone.bar / 150);
  if (delta.foulTrouble) push('foul_trouble', delta.foulTrouble.playerId, undefined, delta.foulTrouble.count, 0.3);
  if (delta.doubleDouble) push('double_double', delta.doubleDouble.playerId, undefined, undefined, 0.28);
  if (delta.clutchStart) push('clutch', undefined, undefined, undefined, 0.6);
  return out;
}
