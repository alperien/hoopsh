/**
 * The booth — turn-taking director for a two-voice broadcast.
 *
 * Consumes the beat stream (beats.ts) and renders it through two VoicePacks:
 * play-by-play owns live action; the analyst owns structural gaps (pregame,
 * free-throw trips, reactions to peak moments, note beats, period recaps,
 * the final). The discipline — WHO speaks WHEN — lives here; the packs only
 * decide how a line sounds.
 *
 * Cue timing keys on `wt` (the replay/wall-clock axis) so a script lines up
 * with replay frames and free-throw routines occupy real time; `t` rides
 * along for stats phrasing only. This is AGENTS.md §1.5's two-axes rule
 * applied to narration — a TTS renderer or the viewer can schedule cues off
 * `wt` directly.
 *
 * Determinism: one Rng seeded from `booth:<seed>`, consumed only through
 * LineDealer (one draw per line, see voice.ts); every scheduling decision is
 * a pure function of the beat stream. Same events + seed + booth ⇒
 * bit-identical script.
 */

import { NBA, Rng, type GameEvent, type RulePack, type Team, type TeamSide } from '@hoopsh/engine';
import { compileBeats, type Beat, type Register } from './beats.js';
import { makeLookup } from './pbp.js';
import { BOOTH_PRESETS, type BoothPresetId } from './personas.js';
import {
  LineDealer, clockPhrase, fillSlots, minutesText, mmss, ordinal, periodPhrase,
  resolvePool, runText, type RenderContext, type Signature, type VoicePack
} from './voice.js';

export interface BoothConfig {
  pbp: VoicePack;
  color: VoicePack;
}

export interface BoothOptions {
  seed?: string;
  /** preset id or a custom two-pack config (default 'classic') */
  booth?: BoothPresetId | BoothConfig;
  /** rule pack the game was simulated under (default NBA) — drives geography + period naming */
  rules?: RulePack;
}

export interface BoothCue {
  wt: number;
  t: number;
  period: number;
  clock: number;
  score: [number, number];
  speaker: 'pbp' | 'color';
  /** VoicePack id that spoke */
  voice: string;
  register: Register;
  /** beat kind (or segment name for structural color talk) */
  kind: string;
  /** signature id when this line spent a catchphrase budget */
  sig?: string;
  text: string;
}

// booth policy constants — all FEEL, tuned for broadcast pacing
const COLOR_REACTION_HEAT = 0.75; // a moment must be this hot for the analyst to jump in
const COLOR_REACTION_GAP_WT = 4; // wall-clock room needed before the next live beat
const COLOR_REACTION_COOLDOWN_WT = 12; // min wall-clock spacing between reactions
const FT_GAP_COOLDOWN_WT = 20; // spacing before free-throw-routine filler fires again
const SCORE_MENTION_EVERY_T = 150; // game-clock seconds of score silence before a re-anchor
const SCORE_MENTION_LATE_T = 45; // tighter anchoring inside the last two minutes

/**
 * shared booth-level tag phrasings (persona-neutral connective tissue) —
 * genre-standard credit formulas only; anything with personality belongs in
 * a VoicePack, and anything cleverer than these is banned by the style
 * contract (docs/BROADCAST.md).
 */
const ASSIST_TAGS = [' From {assist}.', ' {assist} with the assist.', ' Set up by {assist}.'];

function nickname(team: Team): string {
  return team.name.split(' ').pop() ?? team.name;
}

/**
 * Build the full two-voice script for a finished game. Pure function of
 * (events, teams, opts); see the module header for the determinism contract.
 */
export function buildBoothScript(events: GameEvent[], teams: [Team, Team], opts?: BoothOptions): BoothCue[] {
  const rules = opts?.rules ?? NBA;
  const booth: BoothConfig =
    typeof opts?.booth === 'object' ? opts.booth : BOOTH_PRESETS[opts?.booth ?? 'classic'];
  const rng = new Rng(`booth:${opts?.seed ?? 'booth'}`);
  const dealer = new LineDealer(rng);
  const lk = makeLookup(teams);
  const beats = compileBeats(events, teams, { rules });
  const cues: BoothCue[] = [];

  // ---- booth state ------------------------------------------------------
  const mentioned = new Set<string>(); // players already introduced by full name
  const sigUsed = new Map<string, number>(); // "<voiceId>:<sigId>" → uses
  let lastColorWt = -Infinity;
  let lastScoreMentionT = 0;
  let lastScorerId: string | null = null;
  let garbageCalled = false;

  // Naming policy: the PRIMARY actor of a beat gets introduced by full name
  // on first reference (and again at peak register); supporting cast
  // (passer, assister, stealer's victim, …) go by last name always — the
  // broadcast convention once a game is rolling, and it keeps the
  // first-mention upgrade from being silently consumed by a ctx slot the
  // chosen template never rendered.
  const nameFor = (id: string | undefined, full: boolean): string => {
    if (!id) return '';
    if (!mentioned.has(id)) {
      mentioned.add(id);
      return lk.name(id); // first reference is always the full name
    }
    return full ? lk.name(id) : lk.last(id);
  };
  const lastName = (id: string | undefined): string => (id ? lk.last(id) : '');

  const leadPhrase = (score: [number, number]): string => {
    const [h, a] = score;
    if (h === a) return `tied at ${h}`;
    const lead: TeamSide = h > a ? 0 : 1;
    return `${nickname(teams[lead])} by ${Math.abs(h - a)}, ${Math.max(h, a)}-${Math.min(h, a)}`;
  };

  const scorePhrase = (score: [number, number]): string => {
    const [h, a] = score;
    if (h === a) return `${h} apiece`;
    const lead: TeamSide = h > a ? 0 : 1;
    const trail: TeamSide = lead === 0 ? 1 : 0;
    return `${nickname(teams[lead])} ${Math.max(h, a)}, ${nickname(teams[trail])} ${Math.min(h, a)}`;
  };

  // ---- per-beat render context ------------------------------------------
  const buildCtx = (b: Beat): RenderContext => {
    const e = b.event;
    const peak = b.register === 'peak';
    const team = b.team !== undefined ? teams[b.team] : undefined;
    const opp = b.team !== undefined ? teams[b.team === 0 ? 1 : 0] : undefined;
    const shot = e.type === 'shot' ? e : null;
    const ctx: RenderContext = {
      player: nameFor(b.primary, peak),
      Player: nameFor(b.primary, true),
      passer: b.chain ? lastName(b.chain.passer) : '',
      blocker: shot?.blockedBy ? nameFor(shot.blockedBy, peak) : '',
      stealer: b.secondary && b.kind === 'turnover' ? lastName(b.secondary) : '',
      victim: b.kind === 'turnover' ? nameFor(b.primary, false) : '',
      assist: shot?.assist ? lastName(shot.assist) : '',
      team: team ? nickname(team) : '',
      opp: opp ? nickname(opp) : '',
      abbrev: team?.abbrev ?? '',
      oppAbbrev: opp?.abbrev ?? '',
      home: teams[0].name,
      away: teams[1].name,
      spot: b.spot?.name ?? '',
      dist: shot ? String(Math.round(shot.distFt)) : '',
      n: e.type === 'free_throw' ? String(e.n) : '',
      of: e.type === 'free_throw' ? String(e.of) : '',
      count: String(b.snap.pf),
      ptsTonight: String(b.snap.pts),
      ptsPeriod: String(b.snap.ptsThisPeriod),
      reb: String(b.snap.reb),
      ast: String(b.snap.ast),
      hitStreak: String(b.snap.hitStreak),
      tpm: String(b.snap.tpm),
      ftLine: `${b.snap.ftm}-of-${b.snap.fta}`,
      run: runText(b.note?.kind === 'run' ? (b.note.value ?? b.snap.run) : b.snap.run),
      runPts: String(b.note?.kind === 'run' ? (b.note.value ?? b.snap.run) : b.snap.run),
      final_score: `${Math.max(b.snap.score[0], b.snap.score[1])}-${Math.min(b.snap.score[0], b.snap.score[1])}`,
      droughtMin: minutesText(b.snap.droughtSecs),
      bar: b.note?.value !== undefined ? String(b.note.value) : '',
      score_phrase: scorePhrase(b.snap.score),
      lead_phrase: leadPhrase(b.snap.score),
      clock_phrase: clockPhrase(e.period, e.clock, rules.periods),
      period_phrase: periodPhrase(e.period, rules.periods),
      in: e.type === 'substitution' ? nameFor(e.in[0], false) : '',
      out: e.type === 'substitution' ? nameFor(e.out[0], false) : '',
      winner: b.snap.score[0] === b.snap.score[1] ? '' : nickname(teams[b.snap.score[0] > b.snap.score[1] ? 0 : 1]),
      loser: b.snap.score[0] === b.snap.score[1] ? '' : nickname(teams[b.snap.score[0] > b.snap.score[1] ? 1 : 0])
    };
    return ctx;
  };

  const push = (b: Beat, speaker: 'pbp' | 'color', voice: VoicePack, kind: string, text: string, sig?: string): void => {
    if (!text) return;
    const e = b.event;
    cues.push({
      wt: e.wt, t: e.t, period: e.period, clock: e.clock,
      score: [e.score[0], e.score[1]],
      speaker, voice: voice.id, register: b.register, kind, text, ...(sig ? { sig } : {})
    });
    if (speaker === 'color') lastColorWt = e.wt;
  };

  const trySignature = (pack: VoicePack, b: Beat, ctx: RenderContext): SigHit => {
    for (const s of pack.signatures) {
      if (!matchSignature(s, b)) continue;
      const key = `${pack.id}:${s.id}`;
      const used = sigUsed.get(key) ?? 0;
      if (used >= s.perGame) continue;
      sigUsed.set(key, used + 1);
      return { text: dealer.deal(`sig:${key}`, s.text, ctx), sig: s.id };
    }
    return null;
  };

  const dealFrom = (pack: VoicePack, kind: string, variants: (string | null)[], register: Register, ctx: RenderContext): string => {
    for (const v of variants) {
      const hit = resolvePool(pack, kind, v, register);
      if (hit) return dealer.deal(hit.key, hit.pool, ctx);
    }
    return '';
  };

  const segment = (b: Beat, name: string, ctx: RenderContext): void => {
    const pool = booth.color.segments?.[name];
    if (!pool || pool.length === 0) return;
    push(b, 'color', booth.color, name, dealer.deal(`${booth.color.id}:seg:${name}`, pool, ctx));
  };

  const colorNote = (b: Beat, poolKind: string, ctx: RenderContext): void => {
    const text = dealFrom(booth.color, poolKind, [null], b.register, ctx);
    if (text) push(b, 'color', booth.color, poolKind, text);
  };

  // ---- structural composition helpers ------------------------------------
  // pregame scouting sentence, derived from the team's actual tactics and
  // roster dials (pace/threeBias tactics; attr.three and tend.post leaders) —
  // the analyst's opener is grounded in the same data the sim plays with.
  // Returned capitalized: pregame templates splice it in after terminal
  // punctuation ("… watch tonight. {homeStyle}").
  const styleNote = (team: Team): string => {
    const nick = nickname(team);
    const byThree = [...team.players].sort((x, y) => y.attr.three - x.attr.three)[0]!;
    const byPost = [...team.players].sort((x, y) => y.tend.post - x.tend.post)[0]!;
    const { pace, threeBias } = team.tactics;
    if (pace >= 58 && threeBias >= 58) {
      return `The ${nick} want to run — they play fast, they shoot the three, and it starts with ${lk.name(byThree.id)}.`;
    }
    if (pace <= 52 && threeBias <= 50) {
      return `The ${nick} want a slow game and points in the painted area${byPost.tend.post >= 60 ? ` — they will throw it in to ${lk.name(byPost.id)} and let him work` : ''}.`;
    }
    return `The ${nick} are balanced — they take what the defense gives them, and ${lk.name(byThree.id)} is the number one option.`;
  };

  const statNote = (b: Beat): string => {
    const r = b.snap.recap;
    if (!r) return scorePhrase(b.snap.score);
    type Cand = { ratio: number; text: string };
    const cands: Cand[] = [];
    const side = (vals: [number, number]): TeamSide => (vals[0] >= vals[1] ? 0 : 1);
    const tpmD = Math.abs(r.tpm[0] - r.tpm[1]);
    if (tpmD >= 3) {
      const s = side(r.tpm);
      cands.push({ ratio: tpmD / 3, text: `${nickname(teams[s])} have hit ${r.tpm[s]} threes to ${nickname(teams[s === 0 ? 1 : 0])}' ${r.tpm[s === 0 ? 1 : 0]}` });
    }
    const paintD = Math.abs(r.paint[0] - r.paint[1]);
    if (paintD >= 8) {
      const s = side(r.paint);
      cands.push({ ratio: paintD / 8, text: `${nickname(teams[s])} own the paint, ${r.paint[s]}-${r.paint[s === 0 ? 1 : 0]}` });
    }
    const fbD = Math.abs(r.fb[0] - r.fb[1]);
    if (fbD >= 6) {
      const s = side(r.fb);
      cands.push({ ratio: fbD / 6, text: `${nickname(teams[s])} are outscoring them ${r.fb[s]}-${r.fb[s === 0 ? 1 : 0]} on the break` });
    }
    const tovD = Math.abs(r.tov[0] - r.tov[1]);
    if (tovD >= 3) {
      const s = r.tov[0] > r.tov[1] ? 0 : 1; // the team with MORE giveaways is the story
      cands.push({ ratio: tovD / 3, text: `${nickname(teams[s])} have coughed it up ${r.tov[s]} times to ${nickname(teams[s === 0 ? 1 : 0])}' ${r.tov[s === 0 ? 1 : 0]}` });
    }
    cands.sort((x, y) => y.ratio - x.ratio);
    if (cands.length > 0) return cands[0]!.text;
    // no stat separates the teams — the score line is the honest note
    return scorePhrase(b.snap.score);
  };

  const topNote = (b: Beat): string => {
    const r = b.snap.recap;
    if (!r) return '';
    const [hid, hpts] = r.topHome;
    const [aid, apts] = r.topAway;
    const [id, pts] = hpts >= apts ? [hid, hpts] : [aid, apts];
    return id ? `${lk.last(id)} leads all scorers with ${pts}` : '';
  };

  // ---- score-mention policy ----------------------------------------------
  const wantScoreAnchor = (b: Beat): boolean => {
    if (b.kind !== 'shot_made' && b.kind !== 'free_throw') return false;
    if (b.event.type === 'free_throw' && !b.event.made) return false;
    const e = b.event;
    const late = e.period >= rules.periods && e.clock <= 120;
    // first-period lead changes are routine (every early bucket flips a
    // 2-point game) — they fall back to the time cadence instead of each
    // earning an anchor.
    const swing = (b.tags.includes('go_ahead') || b.tags.includes('tie')) && e.period >= 2;
    return (
      swing ||
      b.heat >= 0.72 ||
      e.t - lastScoreMentionT >= SCORE_MENTION_EVERY_T ||
      (late && e.t - lastScoreMentionT >= SCORE_MENTION_LATE_T)
    );
  };

  // ---- main loop ----------------------------------------------------------
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    const next = beats[i + 1];
    const ctx = buildCtx(b);

    switch (b.kind) {
      case 'game_start': {
        push(b, 'pbp', booth.pbp, b.kind, dealFrom(booth.pbp, 'game_start', [null], b.register, ctx));
        segment(b, 'pregame', { ...ctx, homeStyle: styleNote(teams[0]), awayStyle: styleNote(teams[1]) });
        break;
      }
      case 'tip':
      case 'period_start': {
        push(b, 'pbp', booth.pbp, b.kind, dealFrom(booth.pbp, b.kind, [null], b.register, ctx));
        break;
      }
      case 'period_end': {
        push(b, 'pbp', booth.pbp, b.kind, dealFrom(booth.pbp, 'period_end', [null], b.register, ctx));
        // when the game ends here, the 'final' segment (game_end beat, next)
        // carries the wrap-up — a quarter recap right before it would say the
        // same thing twice.
        if (next?.kind !== 'game_end') {
          const recapCtx = { ...ctx, statNote: statNote(b), topNote: topNote(b) };
          if (b.event.period === Math.ceil(rules.periods / 2)) segment(b, 'recap_half', recapCtx);
          else segment(b, 'recap_q', recapCtx);
        }
        lastScoreMentionT = b.event.t;
        break;
      }
      case 'game_end': {
        push(b, 'pbp', booth.pbp, 'game_end', dealFrom(booth.pbp, 'game_end', [null], b.register, ctx));
        segment(b, 'final', { ...ctx, statNote: statNote(b), topNote: topNote(b) });
        break;
      }
      case 'shot_made':
      case 'shot_missed':
      case 'shot_blocked': {
        const e = b.event.type === 'shot' ? b.event : null;
        if (!e) break;
        const zone: string = e.zone;
        const variants: (string | null)[] =
          b.kind === 'shot_blocked' ? [null] :
          b.kind === 'shot_made'
            ? [
                b.tags.includes('heave') ? 'heave' : null,
                b.tags.includes('and_one') ? 'and_one' : null,
                b.tags.includes('putback') ? 'putback' : null,
                lastScorerId === e.shooter && b.snap.hitStreak >= 2 ? 'repeat' : null,
                // "lets it fly" phrasing belongs to jump shots — a kickout
                // that ends in a rim finish reads as a break/finish call
                b.chain && b.tags.includes('kickout') && (e.three || e.zone === 'mid') ? 'kickout' : null,
                b.tags.includes('transition') && (e.zone === 'rim' || e.zone === 'paint') ? 'transition' : null,
                e.three ? 'three' : zone,
                null
              ].filter((v, idx, arr) => v !== null || idx === arr.length - 1)
            : [b.tags.includes('heave') ? 'heave' : e.three ? 'three' : zone, null];

        const sig = b.kind !== 'shot_missed' ? trySignature(booth.pbp, b, ctx) : null;
        let text = sig ? sig.text : dealFrom(booth.pbp, b.kind, variants, b.register, ctx);

        // append-guards require a base line: a missing pool must produce
        // silence, never an orphaned assist tag or score anchor.
        if (text) {
          // assist credit — appended, not baked into every template, so pools
          // stay reusable whether or not a dime happened.
          if (b.kind === 'shot_made' && e.assist && !text.includes(ctx.assist!) && b.register !== 'flat') {
            text += dealer.deal('booth:assist', ASSIST_TAGS, ctx);
          }
          // score anchor — a real PBP voice re-anchors the score at rhythm
          // points instead of every basket.
          if (b.kind === 'shot_made' && wantScoreAnchor(b) && !text.includes(ctx.lead_phrase!)) {
            text += ` ${capitalize(ctx.lead_phrase!)}.`;
            lastScoreMentionT = b.event.t;
          }
        }
        push(b, 'pbp', booth.pbp, b.kind, text, sig?.sig);
        if (b.kind === 'shot_made') lastScorerId = e.shooter;

        // drought talk rides the scoring beat
        if (b.tags.includes('drought_break')) colorNote(b, 'note.drought', ctx);

        // analyst reaction to a peak moment — only with real wall-clock room
        const gapOk = !next || next.event.wt - b.event.wt >= COLOR_REACTION_GAP_WT;
        const cooled = b.event.wt - lastColorWt >= COLOR_REACTION_COOLDOWN_WT;
        if (b.heat >= COLOR_REACTION_HEAT && gapOk && cooled && b.kind !== 'shot_missed') {
          const colorSig = trySignature(booth.color, b, ctx);
          if (colorSig) {
            push(b, 'color', booth.color, 'reaction', colorSig.text, colorSig.sig);
          } else {
            const reaction =
              b.tags.includes('dagger') ? 'reaction.dagger' :
              b.kind === 'shot_blocked' ? 'reaction.block' :
              b.tags.includes('kickout') || b.tags.includes('extra_pass') ? 'reaction.kickout' :
              b.tags.includes('and_one') ? 'reaction.and_one' :
              b.tags.includes('transition') ? 'reaction.transition' :
              b.tags.includes('deep') || b.tags.includes('logo') ? 'reaction.deep' :
              'reaction.peak';
            const rtext = dealFrom(booth.color, reaction, [null], b.register, ctx) || dealFrom(booth.color, 'reaction.peak', [null], b.register, ctx);
            if (rtext) push(b, 'color', booth.color, 'reaction', rtext);
          }
        }
        break;
      }
      case 'free_throw': {
        const e = b.event.type === 'free_throw' ? b.event : null;
        if (!e) break;
        let text = dealFrom(booth.pbp, 'free_throw', [e.made ? 'made' : 'miss'], b.register, ctx);
        if (e.made && wantScoreAnchor(b) && e.n === e.of) {
          text += ` ${capitalize(ctx.lead_phrase!)}.`;
          lastScoreMentionT = e.t;
        }
        push(b, 'pbp', booth.pbp, 'free_throw', text);
        // the trip's built-in dead time is the analyst's oldest slot. Gated
        // on fta >= 3 so the {ftLine} citation is a meaningful sample — on a
        // shooter's first trip "1-of-1 tonight" is technically true but
        // reads as a bookkeeping glitch, not commentary.
        if (e.n === 1 && e.of >= 2 && b.snap.fta >= 3 && b.event.wt - lastColorWt >= FT_GAP_COOLDOWN_WT && !b.tags.includes('garbage')) {
          segment(b, 'ft_gap', ctx);
        }
        break;
      }
      case 'rebound': {
        const e = b.event.type === 'rebound' ? b.event : null;
        if (!e) break;
        // playerless boards (flow contract: optional player) take the
        // team-credited pool; a player board keeps the off/def split
        const variants = e.player
          ? [e.offensive ? 'off' : 'def']
          : ['team', e.offensive ? 'off' : 'def'];
        push(b, 'pbp', booth.pbp, 'rebound', dealFrom(booth.pbp, 'rebound', variants, b.register, ctx));
        break;
      }
      case 'turnover': {
        const variant =
          b.tags.includes('steal') ? 'steal' :
          b.tags.includes('charge') ? 'charge' :
          b.tags.includes('travel') ? 'travel' :
          b.tags.includes('shot_clock') ? 'shot_clock' : 'oob';
        push(b, 'pbp', booth.pbp, 'turnover', dealFrom(booth.pbp, 'turnover', [variant], b.register, ctx));
        break;
      }
      case 'foul': {
        const e = b.event.type === 'foul' ? b.event : null;
        if (!e) break;
        const prev = beats[i - 1];
        // an and-one's foul was already called inside the shot line; a
        // charge's foul was already called by the turnover line. Render only
        // the bookkeeping extras in those cases (or nothing).
        const prevShotFoul = prev?.event.type === 'shot' && prev.event.foul?.andOne && prev.event.shooter === e.drawnBy;
        const prevCharge = e.kind === 'offensive' && prev?.event.type === 'turnover' && prev.event.kind === 'off_foul' && prev.event.player === e.on;
        const extras: string[] = [];
        const technical = e.kind === 'technical';
        // a technical repeats the pre-whistle personal count (the tech is
        // not a personal): citing it would read as if the tech counted
        if (e.personalCount >= 3 && !technical) extras.push(`That’s ${e.personalCount} on ${ctx.player}.`);
        if (b.tags.includes('bonus')) extras.push(`${nickname(teams[e.team === 0 ? 1 : 0])} are in the bonus.`);
        if (e.fouledOut) extras.push(`That’s his ${ordinal(e.personalCount)} — he’s fouled out.`);
        if (prevShotFoul || prevCharge) {
          if (extras.length > 0) push(b, 'pbp', booth.pbp, 'foul', extras.join(' '));
          break;
        }
        const variant =
          technical ? 'technical' :
          e.kind === 'take' ? 'take' :
          e.kind === 'shooting' ? 'shooting' :
          e.kind === 'reach' ? 'reach' :
          e.kind === 'loose_ball' ? 'loose_ball' : 'offensive';
        let text = dealFrom(booth.pbp, 'foul', [variant], b.register, ctx);
        if (extras.length > 0) text += ` ${extras.join(' ')}`;
        push(b, 'pbp', booth.pbp, 'foul', text);
        break;
      }
      case 'timeout': {
        const reason = b.tags.includes('mandatory') ? 'mandatory' : null;
        const line = dealFrom(booth.pbp, 'timeout', [reason], b.register, ctx);
        if (line) push(b, 'pbp', booth.pbp, 'timeout', line);
        // a coach stopping play is the analyst's natural moment; the TV
        // break is not
        if (b.tags.includes('stop_run') || b.tags.includes('regroup')) {
          const note = dealFrom(booth.color, 'timeout', [null], b.register, ctx);
          if (note) push(b, 'color', booth.color, 'timeout', note);
        }
        break;
      }
      case 'jump_ball': {
        const line = dealFrom(booth.pbp, 'jump_ball', [null], b.register, ctx);
        if (line) push(b, 'pbp', booth.pbp, 'jump_ball', line);
        break;
      }
      case 'violation': {
        const variant = b.tags.includes('def_goaltend') ? 'def_goaltend' : 'kicked_ball';
        const line = dealFrom(booth.pbp, 'violation', [variant], b.register, ctx);
        if (line) push(b, 'pbp', booth.pbp, 'violation', line);
        break;
      }
      case 'review': {
        const line = dealFrom(booth.pbp, 'review', [null], b.register, ctx);
        if (line) push(b, 'pbp', booth.pbp, 'review', line);
        const note = dealFrom(booth.color, 'review', [null], b.register, ctx);
        if (note) push(b, 'color', booth.color, 'review', note);
        break;
      }
      case 'substitution': {
        push(b, 'pbp', booth.pbp, 'substitution', dealFrom(booth.pbp, 'substitution', [null], b.register, ctx));
        break;
      }
      case 'note': {
        const kind = b.note?.kind;
        if (!kind) break;
        if (kind === 'clutch') {
          push(b, 'pbp', booth.pbp, 'note.clutch', dealFrom(booth.pbp, 'note.clutch', [null], b.register, ctx));
          colorNote(b, 'note.clutch', ctx);
        } else if (kind === 'run') {
          colorNote(b, 'note.run', ctx);
        } else if (kind === 'milestone') {
          colorNote(b, 'note.milestone', ctx);
        } else if (kind === 'foul_trouble') {
          colorNote(b, 'note.foul_trouble', ctx);
        } else if (kind === 'double_double') {
          colorNote(b, 'note.double_double', ctx);
        }
        break;
      }
      default:
        break;
    }

    // one-time garbage-time acknowledgment — the booth audibly deflates
    if (!garbageCalled && b.tags.includes('garbage')) {
      garbageCalled = true;
      segment(b, 'garbage', ctx);
    }
  }

  return cues;
}

/** printable two-voice script: "[Q3 4:12] CORBIN: …" — `periods` is the
 * regulation period count from the rule pack (default 4, NBA). */
export function formatBoothScript(cues: BoothCue[], boothConfig?: BoothConfig, periods = 4): string {
  const voiceName = (cue: BoothCue): string => {
    if (boothConfig) {
      const pack = cue.voice === boothConfig.pbp.id ? boothConfig.pbp : boothConfig.color;
      return (pack.displayName.split(' ').pop() ?? pack.displayName).toUpperCase();
    }
    return cue.voice.toUpperCase();
  };
  // overtime bracket labels, same convention as pbp.ts periodName /
  // broadcast.ts formatScript / the viewer: the old hardcoded `Q${c.period}`
  // printed "[Q5 …]" for overtime — the booth-side sibling of scan finding
  // B6-6, which fixed only the legacy formatScript pipeline.
  const label = (p: number): string =>
    p > periods ? `OT${p - periods > 1 ? p - periods : ''}` : periods === 2 ? `H${p}` : `Q${p}`;
  return cues
    .map((c) => `[${label(c.period)} ${mmss(c.clock)}] ${voiceName(c)}: ${c.text}`)
    .join('\n');
}

/** a spent signature line, or null when no signature matched/was budgeted */
type SigHit = { text: string; sig: string } | null;

function matchSignature(s: Signature, b: Beat): boolean {
  if (b.heat < s.when.minHeat) return false;
  if (s.when.kinds && !s.when.kinds.includes(b.kind)) return false;
  if (s.when.tags && !s.when.tags.some((t) => b.tags.includes(t))) return false;
  return true;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
