/**
 * The PBP Turing protocol — does the game READ as basketball, literally?
 *
 * Renders simulated games into the same dry play-by-play register as
 * basketball-reference game logs, pseudonymizes player names on BOTH sides,
 * and emits blind excerpt packs: mid-game windows of N consecutive plays,
 * real and simulated shuffled together with an answer key. Human or LLM
 * judges then classify each excerpt REAL or SIM with a stated tell.
 *
 * The metric is discrimination accuracy: 50% = the sim is indistinguishable
 * from real basketball at the play-by-play level; every point above 50% is
 * a measured, attributable realism gap (the judges' tells are the defect
 * list, ranked by how often they worked). Re-run after every flow milestone
 * — the score is the "reads like basketball" number.
 *
 * Two representations live here:
 *
 *  - `--repr neutral` (default; the fair protocol, findings/fdesign-judge.md
 *    §2): both sides map into one structured NeutralRow schema and one shared
 *    template renders both, so vocabulary variance is zero by construction
 *    and only basketball structure can carry the verdict. Real side defaults
 *    to the committed corpus shards (data/nba/pbp-plays). Window variants
 *    `--windows mid|quarter|final3|full`, vocabulary variants `--variant
 *    census|core`, endgame stratification `--strat clutch|decided|any`,
 *    `--cap-per-game N` (real windows per game). Emits manifest.json
 *    provenance beside the pack. Timeout stripping does not exist on this
 *    path: timeout rows are identical on both sides and their scarcity is
 *    measured, not censored (scoreboard gate G1).
 *
 *  - `--repr bbref` (legacy; rounds 1-2 continuity only): sim events render
 *    through this file's dry bbref-register renderer while real plays keep
 *    bbref's own text, pseudonymized by regex. Two different text generators
 *    feed the judge; the measured format term this path retains is why the
 *    neutral path is now the default (the 90% round-2 verdict mixed format
 *    tells with flow tells; see the design doc's tell triage). Original
 *    design notes: windows are intra-quarter (Q2-Q3) so the verdict rests on
 *    ordinary halfcourt basketball; `--strip-timeouts` optionally removes
 *    real timeout lines; running score is appended to scoring lines on both
 *    sides (score cadence is part of how a game reads).
 *
 * Usage:
 *   npm run turing -- --sim 200 --seed fair-1                  # fair pack, census/mid
 *   npm run turing -- --variant core --windows quarter         # vocabulary-censored variant
 *   npm run turing -- --repr bbref --sim 15 --real <plays-dir> # legacy continuity pack
 * Both paths read the committed corpus shards (tools/parse-nba.mjs output:
 * { meta, games: { gameId: { plays: [q, clockSec, side, text, a, h] tuple
 * rows } } }; the repo ships seven under data/nba/pbp-plays/) and bare JSON
 * arrays of { q, clockSec, side, text, a, h } objects — the legacy loader
 * gained the shard format in audit M-35 (before that --real could not read
 * any artifact the repo ships).
 * Output: pack.json (blind, shuffled), key.json (answers; do not show the
 * judges), a per-excerpt .txt for convenient pasting, and (neutral path)
 * manifest.json with flags/seeds/counts/exclusion accounting.
 *
 * The discrimination rate itself is measured by the statistical judge in
 * scoreboard.ts (`npm run flowboard`), gates T1/T2 of the program scoreboard;
 * LLM/human panels remain an out-of-band option using the same packs.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Rng, simulateGame, type GameEvent, type Team } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { distPhrase, shotCall, type ShooterTraits } from '@hoopsh/narration';
import { checkFlags, flagNumber, flagValue } from './args.js';

// a neutral name pool large enough for two rosters per excerpt; assignment is
// per-excerpt so cross-excerpt frequency analysis can't fingerprint rosters
const POOL = [
  'Carver', 'Whitfield', 'Okonkwo', 'Reyburn', 'Salazar', 'Dunlap', 'Mbeki',
  'Torrance', 'Ishida', 'Kovac', 'Bellamy', 'Rourke', 'Anand', 'Petrov',
  'Calloway', 'Nash', 'Iverson-Reed', 'Duplantis', 'Moreau', 'Tanaka',
  'Osei-Bonsu', 'Lindqvist', 'Harmon', 'Castellanos', 'Bright', 'Fontaine',
  'Adebayo-Cole', 'Marsh', 'Villanueva', 'Quist'
];

interface NormPlay {
  clock: string;      // "Q3 7:41"
  text: string;       // pseudonymized dry line
  score?: string;     // "45-51" on scoring plays
}

// ---------------------------------------------------------------- sim side

function fmtClock(period: number, clock: number): string {
  const m = Math.floor(clock / 60);
  const s = Math.floor(clock % 60);
  return `Q${period} ${m}:${String(s).padStart(2, '0')}`;
}

/**
 * render one sim event into the bbref-ish dry register (null = not a play
 * line). Exported for the renderer's own tests (every shot-vocabulary
 * variant must produce the exact bbref grammar).
 */
export function renderEvent(
  e: GameEvent,
  name: (id: string) => string,
  traits?: (id: string) => ShooterTraits | undefined
): string | null {
  switch (e.type) {
    case 'shot': {
      // bbref's shot grammar, exactly: "{2,3}-pt {call} {from N ft | at rim}"
      // with the call vocabulary (layup/dunk/hook/tip-in/jump shot) derived
      // from event data + shooter athleticism — see narration/src/shotcall.ts
      // and the Turing baseline's shot-type-monotony tell.
      const call = shotCall(e, traits?.(e.shooter));
      const kind = `${e.three ? '3-pt' : '2-pt'} ${call} ${distPhrase(e.distFt)}`;
      if (e.made) {
        const ast = e.assist ? ` (assist by ${name(e.assist)})` : '';
        return `${name(e.shooter)} makes ${kind}${ast}`;
      }
      // A fouled miss never prints a miss line in the real register — the
      // shooting-foul + FT rows ARE the play (0 of 3,876 corpus shooting
      // fouls carry one; the sim printed 5.65/game, a deterministic tell a
      // zero-knowledge classifier keyed on — release-audit H-07). Made
      // and-ones keep their make line: bbref prints make + foul there.
      if (e.foul) return null;
      const blk = e.blockedBy ? ` (block by ${name(e.blockedBy)})` : '';
      return `${name(e.shooter)} misses ${kind}${blk}`;
    }
    case 'free_throw':
      return `${name(e.shooter)} ${e.made ? 'makes' : 'misses'} free throw ${e.n} of ${e.of}`;
    case 'rebound':
      // playerless = team rebound; "rebound by Team" is bbref's exact phrasing
      return `${e.offensive ? 'Offensive' : 'Defensive'} rebound by ${e.player ? name(e.player) : 'Team'}`;
    case 'turnover': {
      // bbref charges shot-clock violations to the TEAM, never a player
      // (10/10 in the reference corpus: "Turnover by Team (shot clock)")
      if (e.kind === 'shot_clock') return 'Turnover by Team (shot clock)';
      const kind =
        e.kind === 'bad_pass' ? 'bad pass' :
        e.kind === 'lost_ball' ? 'lost ball' :
        e.kind === 'off_foul' ? 'offensive foul' : 'out of bounds';
      const stl = e.stolenBy ? `; steal by ${name(e.stolenBy)}` : '';
      return `Turnover by ${name(e.player)} (${kind}${stl})`;
    }
    case 'foul': {
      // offensive fouls render their own line: real bbref prints BOTH the
      // foul row and the paired turnover row (546/551 corpus charges —
      // "Offensive foul by X (drawn by Y)" then "Turnover by X (offensive
      // foul)"); suppressing the foul line here made every sim charge a
      // one-line play, a deterministic tell the blind-pack judges keyed on
      // (audit M-34). Residual difference, stated honestly: the engine
      // emits turnover-then-foul (game.ts's foul-out ordering constraint),
      // the corpus prints foul-then-turnover — a subtler tell than a
      // missing line, and not fixable per-event in a stream renderer.
      const kind =
        e.kind === 'shooting' ? 'Shooting' :
        e.kind === 'loose_ball' ? 'Loose ball' :
        e.kind === 'offensive' ? 'Offensive' : 'Personal';
      const drawn = e.drawnBy ? ` (drawn by ${name(e.drawnBy)})` : '';
      return `${kind} foul by ${name(e.on)}${drawn}`;
    }
    case 'substitution':
      return `${name(e.in[0]!)} enters the game for ${name(e.out[0]!)}`;
    case 'timeout':
      // EXACTLY the literal the real side normalizes to (`Full timeout`,
      // realWindows below) — the two sides of a forced-choice discrimination
      // protocol must render one concept to one string, or the string itself
      // is a deterministic tell (scan finding b4-5: sim said `Team timeout`,
      // real said `Full timeout`, and with the endgame default ON these land
      // inside the judged Q2-Q3 windows — measured 15 in 10 default games).
      // Without this line the layer's signature stoppages would silently
      // vanish from exactly the excerpts the protocol judges.
      return `Full timeout`;
    default:
      return null;
  }
}

function simWindows(count: number, winLen: number, seedBase: string, rng: Rng, stripTimeouts: boolean): NormPlay[][] {
  const windows: NormPlay[][] = [];
  let g = 0;
  while (windows.length < count) {
    const { home, away } = sampleMatchup();
    const flip = g % 2 === 1;
    const teams: [Team, Team] = [flip ? away : home, flip ? home : away];
    const r = simulateGame({ seed: `${seedBase}-${g}`, home: teams[0], away: teams[1], collectFrames: false });
    const ids = new Map<string, string>();
    const pool = rng.shuffle([...POOL]);
    const name = (id: string): string => {
      if (!ids.has(id)) {
        const p = teams.flatMap((t) => t.players).find((x) => x.id === id);
        const first = (p?.name ?? 'X Y').split(' ')[0]!;
        ids.set(id, `${first[0]}. ${pool[ids.size % pool.length]}`);
      }
      return ids.get(id)!;
    };
    // shooter athleticism feeds the layup/dunk call in the renderer
    const traits = (id: string): ShooterTraits | undefined => {
      const p = teams.flatMap((t) => t.players).find((x) => x.id === id);
      return p ? { vertical: p.attr.vertical, finishing: p.attr.finishing } : undefined;
    };
    // renderable mid-game lines (Q2-Q3)
    const lines: NormPlay[] = [];
    let prev: [number, number] = [0, 0];
    for (const e of r.events) {
      if (e.period < 2 || e.period > 3) { prev = [e.score[0], e.score[1]]; continue; }
      // --strip-timeouts must strip BOTH sides: stripping only the real side
      // made any surviving timeout line a guaranteed sim marker in the
      // conditioned variant (b4-5)
      const text = stripTimeouts && e.type === 'timeout' ? null : renderEvent(e, name, traits);
      if (!text) { prev = [e.score[0], e.score[1]]; continue; }
      const scored = e.score[0] + e.score[1] > prev[0] + prev[1];
      lines.push({ clock: fmtClock(e.period, e.clock), text, score: scored ? `${e.score[0]}-${e.score[1]}` : undefined });
      prev = [e.score[0], e.score[1]];
    }
    // up to 3 non-overlapping windows per game. The stride floors at winLen:
    // with a short line pool (lines.length < winLen + 20) the raw stride
    // goes NEGATIVE and windows 1-2 would start BEFORE window 0 and overlap
    // it, breaking judge independence (c2-F2). Flooring makes them adjacent
    // instead; the in-bounds break below still drops what doesn't fit.
    // Normal games (hundreds of Q2-Q3 lines) are unaffected: their stride
    // already exceeds winLen.
    for (let w = 0; w < 3 && windows.length < count; w++) {
      const start = 10 + w * Math.max(winLen, Math.floor((lines.length - winLen - 20) / 3));
      if (start + winLen > lines.length) break;
      windows.push(lines.slice(start, start + winLen));
    }
    g++;
    if (g > count * 2) break; // safety
  }
  return windows;
}

// --------------------------------------------------------------- real side

interface RealPlay { q: number; clockSec: number; side: string | null; text: string; a: number; h: number }

/** one committed-shard row: [q, clockSec, side, text, awayScore, homeScore] */
type ShardRow = [number, number, string | null, string, number, number];

/**
 * Read every real game under `dir`, one play-list PER GAME (windows must
 * never span two games' plays). Two formats (audit M-35 — the old reader
 * accepted only the second, which no shipped artifact uses):
 *   - a committed corpus shard, tools/parse-nba.mjs output:
 *     { meta, games: { gameId: { plays: tuple rows } } } — what the repo
 *     ships under data/nba/pbp-plays/;
 *   - a bare JSON array of { q, clockSec, side, text, a, h } objects.
 * Anything else fails loudly with both shapes named.
 */
function readRealGames(dir: string): RealPlay[][] {
  // sorted: readdirSync order is filesystem-dependent, and a blind pack's
  // excerpt numbering must not depend on which OS built it (audit L-51);
  // game order INSIDE a shard follows the file's own key order, which is
  // fixed by the committed bytes
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const games: RealPlay[][] = [];
  for (const f of files) {
    const doc = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as unknown;
    if (Array.isArray(doc)) {
      games.push(doc as RealPlay[]);
      continue;
    }
    const shardGames = (doc as { games?: Record<string, { plays?: ShardRow[] }> }).games;
    if (shardGames && typeof shardGames === 'object') {
      for (const [id, g] of Object.entries(shardGames)) {
        if (!Array.isArray(g.plays)) throw new Error(`${f}: game ${id} has no plays array`);
        games.push(g.plays.map(([q, clockSec, side, text, a, h]) => ({ q, clockSec, side, text, a, h })));
      }
      continue;
    }
    throw new Error(
      `${f}: unrecognized real-plays format — expected a committed pbp shard ` +
      `({ games: { id: { plays } } }, tools/parse-nba.mjs output) or a bare array of ` +
      `{ q, clockSec, side, text, a, h } rows`
    );
  }
  return games;
}

function realWindows(dir: string, count: number, winLen: number, rng: Rng, stripTimeouts: boolean): NormPlay[][] {
  const windows: NormPlay[][] = [];
  for (const plays of readRealGames(dir)) {
    const mid = plays.filter((p) => p.q >= 2 && p.q <= 3);
    const pool = rng.shuffle([...POOL]);
    const names = new Map<string, string>();
    const pseudo = (text: string): string =>
      // bbref name shape: "J. Tatum" (initial dot space capitalized surname).
      // \p{L} (unicode letters) is REQUIRED: an ASCII-only class half-replaced
      // diacritic surnames ("N. Jokić" -> "N. Iverson-Reed" + leftover "ć"),
      // and the baseline judges correctly flagged the mangled names as
      // generator artifacts — on REAL excerpts (protocol leak, now fixed).
      text.replace(/\b([A-Z])\. ?(\p{Lu}[\p{L}'-]+(?: Jr\.| Sr\.| II| III| IV)?)/gu, (_, ini, last) => {
        const key = `${ini}.${last}`;
        if (!names.has(key)) names.set(key, `${ini}. ${pool[names.size % pool.length]}`);
        return names.get(key)!;
      });
    let lines: NormPlay[] = [];
    let prev = -1;
    for (const p of mid) {
      if (stripTimeouts && /timeout/i.test(p.text)) continue;
      let text = p.text;
      if (/timeout/i.test(text)) text = 'Full timeout'; // neutralize the team name
      text = pseudo(text);
      const scored = p.a + p.h !== prev && prev !== -1 && p.a + p.h > prev;
      lines.push({
        clock: `Q${p.q} ${Math.floor(p.clockSec / 60)}:${String(p.clockSec % 60).padStart(2, '0')}`,
        text,
        score: scored ? `${p.a}-${p.h}` : undefined
      });
      prev = p.a + p.h;
    }
    // same winLen stride floor as the sim side (c2-F2): no overlapping
    // windows out of a short real-game line pool
    for (let w = 0; w < 3 && windows.length < count; w++) {
      const start = 5 + w * Math.max(winLen, Math.floor((lines.length - winLen - 10) / 3));
      if (start + winLen > lines.length) break;
      windows.push(lines.slice(start, start + winLen));
    }
    if (windows.length >= count) break;
  }
  return windows.slice(0, count);
}

// ============================================================================
// The fair protocol: matched-representation neutral schema.
//
// Diagnosis this section answers (findings/fdesign-judge.md §0-§2): the legacy
// path above feeds judges two different text generators (this file's renderer
// for sim, bbref's native text for real), so 24 of the 32 string tells in the
// 90% baseline were format, not basketball. Here both sides map into one
// structured `NeutralRow` and both are rendered by one template function
// (`renderNeutral`), so vocabulary variance is zero by construction and the
// judge's only material is which rows, in which order, at which clocks, with
// which outcomes and scores.
//
// Honest-exclusion doctrine: everything unmappable is excluded from both
// sides symmetrically and counted (NeutralGame.excluded), never silently:
//   sim-only, dropped (real pbp has no equivalent row):
//     - `pass` events (real pbp logs no passes; the pass network stays a
//       stream-only metric, per the design doc §2.2)
//     - `possession_start`/`possession_end` markers (no real pbp equivalent)
//     - game/period markers (real "End of Nth quarter" rows dropped in mirror)
//     - shot rows for fouled misses (bbref logs no field-goal attempt when the
//       shooter is fouled and misses; dropping the sim row is what makes the
//       two sides identical; the foul + FT rows still appear on both)
//     - per-field: moveType/zone/x/y/contest (real side carries only distance),
//       foul bookkeeping counts (bbref text carries none), timeout reason.
//   real-only, dropped (sim has no equivalent row):
//     - "End of Nth quarter/overtime" period markers (mirror of sim's)
//     - ejection notation rows (zero-row consequence; counted)
//     - Instant Replay ruling detail (row kept as type 'replay'; detail counted)
//     - rows matching no template, counted as unparsed; the mapper aborts
//       loudly above 0.5% (the corpus's three-way score validation says a
//       clean shard parses at ~0.03%).
//   residual asymmetry, stated not hidden: row order within a shared clock
//   second is kept as each source logs it (engine order vs scorer order); it
//   carries no vocabulary and the cadence gates measure timing explicitly.
//
// Census vs core variants (design doc §2.4): 'census' keeps every mappable
// row including real-only officiating vocabulary (replay/violation/mid-game
// jump/technical rows), the honest headline where the sim's missing event
// vocabulary still costs it. 'core' (coreFilter) censors zero-consequence
// real-only stoppage rows and rejects windows with score-bearing unmappables,
// isolating the residual structure term: census − core = the vocabulary term.
// ============================================================================

/** Judge-visible row types. Both sides produce all ten since the officiating
 *  vocabulary went live (ffit-officiating): sim 'violation' rows are
 *  goaltends/kicked balls, 'replay' rows are review stoppages, and mid-game
 *  'jump' rows are held-ball jumps — the G2 gap this schema made visible. */
export type NeutralType =
  | 'shot' | 'ft' | 'reb' | 'tov' | 'foul' | 'sub' | 'timeout' | 'jump'
  | 'violation' | 'replay';

export type NeutralTovSub = 'badpass' | 'lostball' | 'offfoul' | 'oob' | 'shotclock' | 'violation';
/** 'technical'/'flagrant' extend the design sketch's four klasses so real
 *  tech/flagrant rows stay visible in census (and rejectable in core) instead
 *  of being laundered into 'personal'; erasing them would make real look
 *  more sim-like, biasing the discrimination measurement downward. */
export type NeutralFoulKlass = 'shooting' | 'personal' | 'looseball' | 'offensive' | 'technical' | 'flagrant';
export type NeutralViolSub = 'kicked' | 'goaltend' | 'def3sec' | 'delay' | 'lane' | 'jump' | 'other';

/**
 * One normalized play, the judge's entire world. All fields enumerated, no
 * free text. `actor` holds a source-side key (player id / parsed name) until
 * `anonymizeWindow` rewrites it to per-excerpt tokens 'A1'/'B2'/'TEAM'.
 * `side`: mapper convention 'A' = home-like (sim team 0 / real 'h');
 * anonymization relabels so the excerpt's first-appearing side is 'A'.
 * `score` is [side A, side B] and is set only on scoring rows (made shot /
 * made FT), both sides, matching the legacy protocol's score-cadence rule.
 * `g2` fields are measurement-only subtype annotations for the scoreboard's
 * G2 category census (traveling, take foul, ...); renderNeutral never reads
 * them, so they cannot leak vocabulary into an excerpt.
 */
export interface NeutralRow {
  q: number;
  /** seconds remaining in period, floored (bbref's .1s precision dropped on both sides) */
  clock: number;
  side: 'A' | 'B' | null;
  actor: string | null;
  type: NeutralType;
  shot?: { pts: 2 | 3; made: boolean; distFt: number | null; assist: string | null; block: string | null };
  ft?: { n: number; of: number; made: boolean; klass: 'plain' | 'technical' | 'flagrant' };
  reb?: { off: boolean };
  tov?: { live: boolean; steal: string | null; sub: NeutralTovSub; g2?: string };
  foul?: { klass: NeutralFoulKlass; drawn: string | null; g2?: string };
  sub?: { in: string; out: string };
  viol?: { sub: NeutralViolSub };
  score: [number, number] | null;
}

/** A whole game mapped to neutral rows, with honest exclusion accounting. */
export interface NeutralGame {
  rows: NeutralRow[];
  /** every unmappable/dropped row counted by reason; the symmetry ledger */
  excluded: Record<string, number>;
  /** G11 side channel: made dunks, counted from the call-word channel (sim:
   *  narration shotCall; real: bbref "dunk" text), deliberately outside the
   *  neutral schema because call words are renderer vocabulary, not structure.
   *  Scoreboard-only; never rendered into an excerpt. */
  madeDunks: number;
}

const count = (rec: Record<string, number>, key: string): void => {
  rec[key] = (rec[key] ?? 0) + 1;
};

// --------------------------------------------------------- sim -> neutral

/**
 * Map a sim event stream to neutral rows. Conventions ported verbatim from
 * the corpus-validated grammar adapter (design doc §2.2): fouled misses drop
 * the shot row (bbref logs no FGA), offensive-foul turnovers emit the bbref
 * pair (foul row first, then turnover row; the engine logs turnover-first),
 * dead-ball formality rebounds keep their TEAM row (bbref logs the same
 * formality). `traits` feeds the dunk side channel only (see NeutralGame).
 */
export function simToNeutral(
  events: readonly GameEvent[],
  traits?: (id: string) => ShooterTraits | undefined
): NeutralGame {
  const rows: NeutralRow[] = [];
  const excluded: Record<string, number> = {};
  let madeDunks = 0;
  const side = (t: 0 | 1): 'A' | 'B' => (t === 0 ? 'A' : 'B');
  // offensive-foul companion rows already emitted via the pairing rule
  const consumedFouls = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const base = { q: e.period, clock: Math.floor(e.clock) };
    switch (e.type) {
      case 'shot': {
        if (!e.made && e.foul) { count(excluded, 'sim.fouledMissShotRow'); break; }
        if (e.made && shotCall(e, traits?.(e.shooter)) === 'dunk') madeDunks++;
        rows.push({
          ...base, side: side(e.team), actor: e.shooter, type: 'shot',
          shot: {
            pts: e.three ? 3 : 2, made: e.made, distFt: Math.round(e.distFt),
            assist: e.assist ?? null, block: e.blockedBy ?? null
          },
          score: e.made ? [e.score[0], e.score[1]] : null
        });
        break;
      }
      case 'free_throw':
        rows.push({
          ...base, side: side(e.team), actor: e.shooter, type: 'ft',
          // technical FTs mirror bbref's "makes technical free throw" klass
          // (the real-side reFt mapping) — plain otherwise
          ft: { n: e.n, of: e.of, made: e.made, klass: e.technical ? 'technical' : 'plain' },
          score: e.made ? [e.score[0], e.score[1]] : null
        });
        break;
      case 'rebound':
        rows.push({
          ...base, side: side(e.team), actor: e.player ?? 'TEAM', type: 'reb',
          reb: { off: e.offensive }, score: null
        });
        break;
      case 'turnover': {
        if (e.kind === 'off_foul') {
          // engine contract: turnover(off_foul) is immediately followed by the
          // companion foul(offensive); bbref logs foul row first; reorder here
          for (let j = i + 1; j < Math.min(i + 4, events.length); j++) {
            const f = events[j]!;
            if (f.type === 'foul' && f.kind === 'offensive' && f.on === e.player) {
              consumedFouls.add(j);
              rows.push({
                q: f.period, clock: Math.floor(f.clock), side: side(f.team), actor: f.on,
                type: 'foul', foul: { klass: 'offensive', drawn: f.drawnBy ?? null }, score: null
              });
              break;
            }
          }
        }
        const sub: NeutralTovSub =
          e.kind === 'bad_pass' ? 'badpass' :
          e.kind === 'lost_ball' ? 'lostball' :
          e.kind === 'off_foul' ? 'offfoul' :
          e.kind === 'shot_clock' ? 'shotclock' :
          e.kind === 'travel' || e.kind === 'off_goaltend' ? 'violation' : 'oob';
        // violation-class dead TOs carry the g2 census word exactly as the
        // real-side mapper spells it (TOV_VIOLATION_WORDS) so the scoreboard
        // G2 categories cannot fork between sides
        const g2word =
          e.kind === 'travel' ? 'traveling' :
          e.kind === 'off_goaltend' ? 'off goaltending' : undefined;
        rows.push({
          ...base, side: side(e.team),
          actor: e.kind === 'shot_clock' ? 'TEAM' : e.player, type: 'tov',
          tov: {
            live: sub === 'badpass' || sub === 'lostball', steal: e.stolenBy ?? null, sub,
            ...(g2word ? { g2: g2word } : {})
          },
          score: null
        });
        break;
      }
      case 'foul': {
        if (consumedFouls.has(i)) break;
        const klass: NeutralFoulKlass =
          e.kind === 'shooting' ? 'shooting' :
          e.kind === 'loose_ball' ? 'looseball' :
          e.kind === 'offensive' ? 'offensive' :
          e.kind === 'technical' ? 'technical' : 'personal'; // 'reach'/'take' -> personal, as bbref logs them
        // a take is bbref's "Personal take foul" — klass personal plus the
        // g2 census tag, mirroring the real-side reFoul mapping exactly
        const foulG2 = e.kind === 'take' ? 'take' : undefined;
        rows.push({
          ...base, side: side(e.team), actor: e.on, type: 'foul',
          foul: { klass, drawn: e.drawnBy ?? null, ...(foulG2 ? { g2: foulG2 } : {}) }, score: null
        });
        break;
      }
      case 'substitution':
        rows.push({
          ...base, side: side(e.team), actor: e.in[0]!, type: 'sub',
          sub: { in: e.in[0]!, out: e.out[0]! }, score: null
        });
        break;
      case 'timeout':
        // reason/remaining dropped (bbref text carries neither)
        rows.push({ ...base, side: side(e.team), actor: 'TEAM', type: 'timeout', score: null });
        break;
      case 'tip_off':
        rows.push({ ...base, side: null, actor: null, type: 'jump', score: null });
        break;
      case 'jump_ball':
        // mid-game held-ball jump — same anonymous row shape as the real
        // side's "Jump ball" template (contestants/gainer are sim-only
        // detail bbref carries in text the mapper already drops)
        rows.push({ ...base, side: null, actor: null, type: 'jump', score: null });
        break;
      case 'violation':
        rows.push({
          ...base, side: side(e.team), actor: e.player ?? 'TEAM', type: 'violation',
          viol: { sub: e.kind === 'kicked_ball' ? 'kicked' : 'goaltend' }, score: null
        });
        break;
      case 'replay_review':
        // bbref's "Instant Replay" row: ruling detail dropped on the real
        // side, trigger detail dropped here — the row IS the texture
        rows.push({ ...base, side: null, actor: null, type: 'replay', score: null });
        break;
      case 'pass':
        count(excluded, 'sim.pass'); break;
      case 'possession_start':
      case 'possession_end':
        count(excluded, 'sim.possessionMarker'); break;
      case 'game_start':
      case 'game_end':
      case 'period_start':
      case 'period_end':
        count(excluded, 'sim.periodMarker'); break;
      default:
        // future event types must be classified here deliberately, not leak
        throw new Error(`simToNeutral: unmapped event type ${(e as GameEvent).type}`);
    }
  }
  return { rows, excluded, madeDunks };
}

// -------------------------------------------------------- real -> neutral

/** One tuple row from the committed corpus shards (data/nba/pbp-plays). */
export interface RealPlayRow { q: number; clockSec: number; side: string | null; text: string; a: number; h: number }

/** bbref name capture: initial-dot + surname(s), unicode letters, stops at
 *  an open-paren/semicolon tail. Multi-word surnames land whole in one key
 *  ("D. Jones García"); worst case a weird name splits an actor into two
 *  tokens (frequency noise); no substitution regex exists to mangle text. */
const NAME = String.raw`(.+?)`;
const reShot = new RegExp(`^${NAME} (makes|misses) ([23])-pt (?:.+?) (?:from (\\d+) ft|at rim)((?: \\(.+\\))?)$`);
const reFt = new RegExp(`^${NAME} (makes|misses) (technical |flagrant |clear path )?free throw(?: (\\d+) of (\\d+))?$`);
const reReb = /^(Offensive|Defensive) rebound by (.+)$/;
// actor may be empty on team-charged rows ("Turnover by (8 sec)", a nameless
// bench "Technical foul by"); empty maps to TEAM, matching bbref's intent
const reTov = /^Turnover by ?(.*?) ?\((.+)\)$/;
const reFoul = /^(Shooting|Personal take|Personal|Loose ball|Offensive|Technical|Rescinded technical|Away from play|Clear path) foul by ?(.*?)(?: \(drawn by (.+?)\))?$/;
const reFlagrant = /^Flagrant foul type [12] by (.+?)(?: \(drawn by (.+?)\))?$/;
const reSub = /^(.+?) enters the game for (.+)$/;
const reViol = /^Violation by (.+?) \((.+)\)$/;

/** dead-turnover parentheticals that are real-only violation vocabulary (the
 *  sim has no such mechanics; they map to sub 'violation' and are counted by
 *  scoreboard gate G2, not laundered into sim-shaped kinds) */
const TOV_VIOLATION_WORDS = new Set([
  'traveling', 'back court', '8 sec', '5 sec', '3 sec', 'inbound', 'palming',
  'dbl dribble', 'discontinued dribble', 'lane violation', 'off goaltending', 'turnover'
]);

/**
 * Map committed-corpus tuple rows to neutral rows via a fixed template set
 * (the bbref grammar the corpus's three-way score validation already trusts).
 * Actor names are parsed out and kept only as identity keys: no substitution
 * regex, so the legacy pseudonymizer leak class dies by construction.
 * Throws when more than 0.5% of rows match no template (a degenerate or
 * drifted input must fail loudly, never quietly thin the real side).
 */
export function realToNeutral(plays: readonly RealPlayRow[], sourceId = 'real'): NeutralGame {
  const rows: NeutralRow[] = [];
  const excluded: Record<string, number> = {};
  const unparsed: string[] = [];
  let madeDunks = 0;
  const side = (s: string | null): 'A' | 'B' | null => (s === 'h' || s === 'home') ? 'A' : (s === 'a' || s === 'away') ? 'B' : null;
  const opp = (s: 'A' | 'B' | null): 'A' | 'B' | null => (s === 'A' ? 'B' : s === 'B' ? 'A' : null);

  for (const p of plays) {
    const base = { q: p.q, clock: Math.floor(p.clockSec) };
    const rowSide = side(p.side);
    const scored: [number, number] = [p.h, p.a]; // [side A, side B] = [home, away]
    const text = p.text;
    let m: RegExpMatchArray | null;

    if ((m = text.match(reShot))) {
      const made = m[2] === 'makes';
      if (made && /\bdunk\b/.test(text)) madeDunks++;
      const tail = m[5] ?? '';
      const assist = tail.match(/\(assist by (.+?)\)/)?.[1] ?? null;
      const block = tail.match(/\(block by (.+?)\)/)?.[1] ?? null;
      rows.push({
        ...base, side: rowSide, actor: m[1]!, type: 'shot',
        shot: {
          pts: m[3] === '3' ? 3 : 2, made,
          distFt: m[4] !== undefined ? Number(m[4]) : 0, // "at rim" -> 0 ft
          assist, block
        },
        score: made ? scored : null
      });
    } else if (/^Team (makes|misses) heave shot$/.test(text)) {
      // bbref's anonymous buzzer-heave formality: a TEAM shot row with no
      // distance; real-only vocabulary, visible in census, dropped in core
      rows.push({
        ...base, side: rowSide, actor: 'TEAM', type: 'shot',
        shot: { pts: 2, made: false, distFt: null, assist: null, block: null }, score: null
      });
    } else if ((m = text.match(reFt))) {
      const made = m[2] === 'makes';
      const kw = (m[3] ?? '').trim();
      if (kw === 'clear path') count(excluded, 'real.clearPathFtCoarsenedToPlain');
      const klass = kw === 'technical' ? 'technical' : kw === 'flagrant' ? 'flagrant' : 'plain';
      rows.push({
        ...base, side: rowSide, actor: m[1]!, type: 'ft',
        // technical FTs carry no "N of M" in bbref -> a 1-of-1 trip
        ft: { n: m[4] !== undefined ? Number(m[4]) : 1, of: m[5] !== undefined ? Number(m[5]) : 1, made, klass },
        score: made ? scored : null
      });
    } else if ((m = text.match(reReb))) {
      rows.push({
        ...base, side: rowSide, actor: m[2] === 'Team' ? 'TEAM' : m[2]!, type: 'reb',
        reb: { off: m[1] === 'Offensive' }, score: null
      });
    } else if ((m = text.match(reTov))) {
      const inner = m[2]!;
      const stealM = inner.match(/^(.*?); steal by (.+)$/);
      const word = (stealM ? stealM[1]! : inner).trim();
      const steal = stealM ? stealM[2]! : null;
      const sub: NeutralTovSub =
        word === 'bad pass' ? 'badpass' :
        word === 'lost ball' ? 'lostball' :
        word === 'offensive foul' ? 'offfoul' :
        word === 'shot clock' ? 'shotclock' :
        word === 'out of bounds lost ball' || word === 'step out of bounds' || word === 'out of bounds' ? 'oob' :
        TOV_VIOLATION_WORDS.has(word) ? 'violation' : 'violation';
      if (sub === 'violation' && !TOV_VIOLATION_WORDS.has(word)) count(excluded, 'real.tovUnknownSubtypeAsViolation');
      rows.push({
        ...base, side: rowSide, actor: m[1] === 'Team' || m[1] === '' ? 'TEAM' : m[1]!, type: 'tov',
        tov: {
          live: sub === 'badpass' || sub === 'lostball', steal, sub,
          ...(sub === 'violation' ? { g2: word } : {})
        },
        score: null
      });
    } else if (/^Def 3 sec tech foul by/.test(text)) {
      // logged by bbref as a technical-class foul IN THE OFFENDED TEAM's
      // column (57/57 corpus rows share the ensuing tech-FT's side); mapped
      // per the design doc to the violation taxonomy with side flipped to the
      // offending DEFENSE (its FT arrives separately as klass technical)
      rows.push({ ...base, side: opp(rowSide), actor: 'TEAM', type: 'violation', viol: { sub: 'def3sec' }, score: null });
    } else if ((m = text.match(reFoul))) {
      const kw = m[1]!;
      const klass: NeutralFoulKlass =
        kw === 'Shooting' ? 'shooting' :
        kw === 'Loose ball' ? 'looseball' :
        kw === 'Offensive' ? 'offensive' :
        kw === 'Technical' || kw === 'Rescinded technical' ? 'technical' : 'personal';
      const g2 =
        kw === 'Personal take' ? 'take' :
        kw === 'Away from play' ? 'away' :
        kw === 'Clear path' ? 'clearpath' :
        kw === 'Rescinded technical' ? 'rescinded' : undefined;
      // bbref column convention, measured corpus-wide: personal/shooting/
      // take/away rows sit in the fouled team's column (6255/6262 rows have
      // the fouler opposite), while loose-ball/offensive/technical rows sit
      // in the fouler's own column (1163/1165; clear-path leans own-column
      // 4/6 and stays unflipped). Neutral rows always carry the fouling side
      // (the sim's convention); flip the fouled-column family so both sides
      // read identically and the ensuing FTs belong to the other team.
      const flips = (klass === 'shooting' || klass === 'personal') && g2 !== 'clearpath';
      rows.push({
        ...base, side: flips ? opp(rowSide) : rowSide,
        actor: m[2] === 'Team' || m[2] === '' ? 'TEAM' : m[2]!, type: 'foul',
        foul: { klass, drawn: m[3] ?? null, ...(g2 ? { g2 } : {}) }, score: null
      });
    } else if ((m = text.match(reFlagrant))) {
      // flagrant rows follow the fouled-column convention (34/34); flip
      rows.push({
        ...base, side: opp(rowSide), actor: m[1]!, type: 'foul',
        foul: { klass: 'flagrant', drawn: m[2] ?? null }, score: null
      });
    } else if ((m = text.match(reSub))) {
      rows.push({
        ...base, side: rowSide, actor: m[1]!, type: 'sub',
        sub: { in: m[1]!, out: m[2]! }, score: null
      });
    } else if (/timeout/i.test(text)) {
      // team-name prefix discarded; one identical row shape for both sides
      rows.push({ ...base, side: rowSide, actor: 'TEAM', type: 'timeout', score: null });
    } else if (/^Jump ball/.test(text)) {
      rows.push({ ...base, side: null, actor: null, type: 'jump', score: null });
    } else if (/^Instant Replay/i.test(text)) {
      count(excluded, 'real.replayRulingDetail'); // row kept, ruling text dropped
      rows.push({ ...base, side: rowSide, actor: null, type: 'replay', score: null });
    } else if ((m = text.match(reViol))) {
      const word = m[2]!;
      const sub: NeutralViolSub =
        word === 'kicked ball' ? 'kicked' :
        word === 'def goaltending' || word === 'goaltending' ? 'goaltend' :
        word === 'delay of game' ? 'delay' :
        word === 'double lane' || word === 'lane' ? 'lane' :
        word === 'jump ball' ? 'jump' : 'other';
      rows.push({
        ...base, side: rowSide, actor: m[1] === 'Team' ? 'TEAM' : m[1]!, type: 'violation',
        viol: { sub }, score: null
      });
    } else if (/^End of \d/.test(text)) {
      count(excluded, 'real.periodMarker'); // mirror of sim's dropped period markers
    } else if (/ejected from game$/.test(text)) {
      count(excluded, 'real.ejection');
    } else {
      unparsed.push(text);
    }
  }

  const unparseRate = plays.length === 0 ? 1 : unparsed.length / plays.length;
  if (unparseRate > 0.005) {
    throw new Error(
      `realToNeutral(${sourceId}): unparse rate ${(unparseRate * 100).toFixed(2)}% exceeds the 0.5% abort threshold ` +
      `(${unparsed.length}/${plays.length}); first offenders: ${unparsed.slice(0, 5).map((t) => JSON.stringify(t)).join(', ')}`
    );
  }
  if (unparsed.length > 0) excluded['real.unparsed'] = unparsed.length;
  return { rows, excluded, madeDunks };
}

// ----------------------------------------------- shared corpus shard loader

/** One corpus game with its raw tuple rows (see data/nba/pbp-plays meta). */
export interface CorpusGame { id: string; away: string; home: string; plays: RealPlayRow[] }

/**
 * Load real games from a directory: either the committed monthly tuple
 * shards ({meta, games} objects, the default corpus) or legacy per-game
 * JSON arrays of {q, clockSec, side, text, a, h} (the old --real format).
 * Games return sorted by id (chronological); callers season-spread with a
 * seeded shuffle rather than taking the first N files (the October-bias
 * defect the flow-turing audit had to hand-patch).
 */
export function loadCorpus(dir: string): CorpusGame[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const games: CorpusGame[] = [];
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as unknown;
    if (Array.isArray(parsed)) {
      games.push({ id: f.replace(/\.json$/, ''), away: '?', home: '?', plays: parsed as RealPlayRow[] });
      continue;
    }
    const shard = parsed as { games?: Record<string, { away: string; home: string; plays: [number, number, string | null, string, number, number][] }> };
    for (const [id, g] of Object.entries(shard.games ?? {})) {
      games.push({
        id, away: g.away, home: g.home,
        plays: g.plays.map(([q, clockSec, side, text, a, h]) => ({ q, clockSec, side, text, a, h }))
      });
    }
  }
  games.sort((x, y) => (x.id < y.id ? -1 : 1));
  return games;
}

// ------------------------------------------------------- windows (one cutter)

export type WindowKind = 'mid' | 'quarter' | 'final3' | 'full';

export interface WindowSpec {
  kind: WindowKind;
  /** rows per 'mid' window (default 14, continuity with rounds 1-2) */
  len?: number;
  /** max windows per game (default: mid 3, others 1) */
  perGame?: number;
  /** 'final3' stratification: margin at the 3:00 entry (clutch <= 5, decided >= 15) */
  strat?: 'clutch' | 'decided' | 'any';
}

/** last known [A,B] score at or before row index i (rows carry score only on scoring rows) */
function scoreAt(rows: readonly NeutralRow[], i: number): [number, number] {
  for (let j = i; j >= 0; j--) {
    const s = rows[j]!.score;
    if (s) return s;
  }
  return [0, 0];
}

/**
 * Cut judge windows from one game's neutral rows, the single implementation
 * both sides use (the legacy path's separate simWindows/realWindows offset
 * formulas were a silent asymmetry; this replaces both for the fair path).
 * Offsets are seeded-rng jittered, non-overlapping. Windows too short to
 * judge are skipped, never padded.
 */
export function cutWindows(rows: readonly NeutralRow[], spec: WindowSpec, rng: Rng): NeutralRow[][] {
  const windows: NeutralRow[][] = [];
  if (spec.kind === 'mid') {
    const len = spec.len ?? 14;
    const perGame = spec.perGame ?? 3;
    const pool = rows.filter((r) => r.q >= 2 && r.q <= 3);
    const chunk = Math.floor(pool.length / perGame);
    if (chunk < len) return windows;
    for (let w = 0; w < perGame; w++) {
      const start = w * chunk + rng.int(Math.max(1, chunk - len));
      if (start + len <= pool.length) windows.push(pool.slice(start, start + len));
    }
  } else if (spec.kind === 'quarter') {
    // 24 rows ~= the thinnest plausible real quarter; anything shorter is a
    // parse anomaly, not a judgeable quarter
    const perGame = spec.perGame ?? 1;
    const qs = rng.shuffle([1, 2, 3, 4]);
    for (const q of qs) {
      if (windows.length >= perGame) break;
      const qRows = rows.filter((r) => r.q === q);
      if (qRows.length >= 24) windows.push(qRows);
    }
  } else if (spec.kind === 'final3') {
    // regulation endgame: Q4 from 3:00 to the horn (180s)
    const pool = rows.filter((r) => r.q === 4 && r.clock <= 180);
    if (pool.length >= 8) {
      const strat = spec.strat ?? 'any';
      const entryIdx = rows.findIndex((r) => r.q === 4 && r.clock <= 180);
      const [a, b] = scoreAt(rows, Math.max(0, entryIdx - 1));
      const margin = Math.abs(a - b);
      const ok = strat === 'any' || (strat === 'clutch' ? margin <= 5 : margin >= 15);
      if (ok) windows.push(pool);
    }
  } else {
    if (rows.length >= 8) windows.push([...rows]);
  }
  return windows;
}

// -------------------------------------------------- per-excerpt anonymization

/**
 * Rewrite one window to per-excerpt anonymous form: the first-appearing side
 * becomes 'A' (score slots swap to match), actors become 'A1'/'B2'/... by
 * first appearance, 'TEAM' stays 'TEAM'. Token side is inferred from row
 * semantics only (assist = shooter's side; block/steal/drawn = opposite), so
 * one code path serves both sources: identical inputs, identical output.
 * Fresh maps per window: cross-excerpt frequency analysis cannot fingerprint
 * rosters (the legacy protocol's per-excerpt name-pool rule, kept).
 */
export function anonymizeWindow(rows: readonly NeutralRow[]): NeutralRow[] {
  const firstSide = rows.find((r) => r.side)?.side ?? 'A';
  const mapSide = (s: 'A' | 'B' | null): 'A' | 'B' | null =>
    s === null ? null : s === firstSide ? 'A' : 'B';
  const opp = (s: 'A' | 'B' | null): 'A' | 'B' | null => (s === 'A' ? 'B' : s === 'B' ? 'A' : null);
  const tokens = new Map<string, string>();
  const counters: Record<'A' | 'B', number> = { A: 0, B: 0 };
  const tok = (key: string | null | undefined, side: 'A' | 'B' | null): string | null => {
    if (key === null || key === undefined) return null;
    if (key === 'TEAM') return 'TEAM';
    const s: 'A' | 'B' = side ?? 'A';
    const mapKey = `${s}:${key}`; // side-scoped: same surname on both teams stays two actors
    if (!tokens.has(mapKey)) {
      counters[s]++;
      tokens.set(mapKey, `${s}${counters[s]}`);
    }
    return tokens.get(mapKey)!;
  };
  return rows.map((r) => {
    const side = mapSide(r.side);
    const out: NeutralRow = {
      ...r, side, actor: tok(r.actor, side),
      score: r.score ? (firstSide === 'B' ? [r.score[1], r.score[0]] : [r.score[0], r.score[1]]) : null
    };
    if (r.shot) out.shot = { ...r.shot, assist: tok(r.shot.assist, side), block: tok(r.shot.block, opp(side)) };
    if (r.tov) out.tov = { ...r.tov, steal: tok(r.tov.steal, opp(side)) };
    if (r.foul) out.foul = { ...r.foul, drawn: tok(r.foul.drawn, opp(side)) };
    if (r.sub) out.sub = { in: tok(r.sub.in, side)!, out: tok(r.sub.out, side)! };
    return out;
  });
}

// --------------------------------------------------------- the one renderer

const TOV_WORDS: Record<NeutralTovSub, string> = {
  badpass: 'bad pass', lostball: 'lost ball', offfoul: 'offensive foul',
  oob: 'out of bounds', shotclock: 'shot clock', violation: 'violation'
};
const FOUL_WORDS: Record<NeutralFoulKlass, string> = {
  shooting: 'shooting', personal: 'personal', looseball: 'loose ball',
  offensive: 'offensive', technical: 'technical', flagrant: 'flagrant'
};
const VIOL_WORDS: Record<NeutralViolSub, string> = {
  kicked: 'kicked ball', goaltend: 'goaltending', def3sec: 'def 3 sec',
  delay: 'delay of game', lane: 'lane', jump: 'jump ball', other: 'misc'
};

/**
 * Render one anonymized row to judge-visible text, the single code path
 * from row to string for both sides (the fairness property; pinned by a
 * byte-identity unit test). Deliberately dry and fixed: no synonyms, no
 * prose register. 'core' renders dead-ball turnovers subtype-less
 * ("dead ball"); the census/core vocabulary knob from the design doc §2.4.
 */
export function renderNeutral(r: NeutralRow, variant: 'census' | 'core' = 'census'): string {
  const mm = Math.floor(r.clock / 60);
  const ss = String(Math.floor(r.clock % 60)).padStart(2, '0');
  const score = r.score ? ` (${r.score[0]}-${r.score[1]})` : '';
  const who = r.actor === 'TEAM' ? `${r.side ?? ''} TEAM`.trim() : (r.actor ?? '');
  let body: string;
  switch (r.type) {
    case 'shot': {
      const s = r.shot!;
      const dist = s.distFt === null ? '' : s.distFt < 1 ? ' at rim' : ` from ${s.distFt} ft`;
      const tail = s.made
        ? (s.assist ? ` (assist ${s.assist})` : '')
        : (s.block ? ` (block ${s.block})` : '');
      body = `${who} ${s.made ? 'makes' : 'misses'} ${s.pts}-pt${dist}${tail}`;
      break;
    }
    case 'ft': {
      const f = r.ft!;
      const k = f.klass === 'plain' ? '' : `${f.klass} `;
      body = `${who} ${f.made ? 'makes' : 'misses'} ${k}free throw ${f.n} of ${f.of}`;
      break;
    }
    case 'reb':
      body = `${who} ${r.reb!.off ? 'offensive' : 'defensive'} rebound`;
      break;
    case 'tov': {
      const t = r.tov!;
      const word = variant === 'core' && !t.live ? 'dead ball' : TOV_WORDS[t.sub];
      body = `turnover by ${who} (${word}${t.steal ? `; steal by ${t.steal}` : ''})`;
      break;
    }
    case 'foul':
      body = `${FOUL_WORDS[r.foul!.klass]} foul by ${who}${r.foul!.drawn ? ` (drawn by ${r.foul!.drawn})` : ''}`;
      break;
    case 'sub':
      body = `${r.sub!.in} in for ${r.sub!.out}`;
      break;
    case 'timeout':
      body = `timeout${r.side ? ` ${r.side}` : ''}`;
      break;
    case 'jump':
      body = 'jump ball';
      break;
    case 'violation':
      body = `violation${who ? ` by ${who}` : ''} (${VIOL_WORDS[r.viol!.sub]})`;
      break;
    case 'replay':
      body = 'instant replay review';
      break;
  }
  return `[Q${r.q} ${mm}:${ss}] ${body}${score}`;
}

// --------------------------------------------------------- census -> core

/** period-opening clock value (regulation 720s quarters, 300s OT) */
const periodLen = (q: number): number => (q <= 4 ? 720 : 300);

/**
 * The core-variant filter: drop zero-consequence real-only stoppage rows
 * (replay, kicked/delay/lane/misc violations, possession-retaining mid-game
 * jumps, anonymous TEAM heave formalities) and REJECT windows containing
 * score-bearing unmappables (technical/flagrant FTs or fouls). Every drop is
 * counted; census − core = the vocabulary term (design doc §2.4). Goaltending
 * violations survive: they change the score, censoring them would hide real
 * basketball rather than real vocabulary.
 */
export function coreFilter(rows: readonly NeutralRow[]): {
  rows: NeutralRow[]; dropped: Record<string, number>; rejected: string | null
} {
  const dropped: Record<string, number> = {};
  const rejected = rows.some((r) =>
    (r.ft && r.ft.klass !== 'plain') ||
    (r.foul && (r.foul.klass === 'technical' || r.foul.klass === 'flagrant'))
  ) ? 'technical/flagrant rows (score-bearing unmappables)' : null;
  const kept = rows.filter((r) => {
    if (r.type === 'replay') { count(dropped, 'core.replay'); return false; }
    if (r.type === 'violation' && r.viol!.sub !== 'goaltend' && r.viol!.sub !== 'def3sec') {
      count(dropped, 'core.violation'); return false;
    }
    if (r.type === 'jump' && r.clock !== periodLen(r.q)) { count(dropped, 'core.midGameJump'); return false; }
    if (r.type === 'shot' && r.actor === 'TEAM') { count(dropped, 'core.teamHeaveRow'); return false; }
    return true;
  });
  return { rows: kept, dropped, rejected };
}

// ------------------------------------------------- shared sim-side sourcing

/**
 * Simulate `gamesN` games (shipped default config) and map each to neutral
 * rows, the one sim-side source shared by the fair pack CLI here and the
 * scoreboard (scoreboard.ts), so their measurements cannot fork. Seeding
 * convention: seed `${seedBase}-g${i}`, home/away mirrored on odd i.
 */
export function simNeutralGames(gamesN: number, seedBase: string): NeutralGame[] {
  const out: NeutralGame[] = [];
  for (let g = 0; g < gamesN; g++) {
    const { home, away } = sampleMatchup();
    const flip = g % 2 === 1;
    const teams: [Team, Team] = [flip ? away : home, flip ? home : away];
    const r = simulateGame({ seed: `${seedBase}-g${g}`, home: teams[0], away: teams[1], collectFrames: false });
    // shooter athleticism feeds the dunk CALL side channel only (G11)
    const traits = (id: string): ShooterTraits | undefined => {
      const p = teams.flatMap((t) => t.players).find((x) => x.id === id);
      return p ? { vertical: p.attr.vertical, finishing: p.attr.finishing } : undefined;
    };
    out.push(simToNeutral(r.events, traits));
  }
  return out;
}

// ------------------------------------------------------------------- main

/** default committed corpus location (monthly tuple shards) */
const DEFAULT_CORPUS_DIR = 'data/nba/pbp-plays';

function emitNeutralPack(opts: {
  simCount: number; winLen: number; outDir: string; realDir: string; seedBase: string;
  windows: WindowKind; variant: 'census' | 'core'; strat: 'clutch' | 'decided' | 'any'; capPerGame: number;
}): void {
  const rng = new Rng(`${opts.seedBase}-pack`);
  const perGameSim = opts.windows === 'mid' ? 3 : 1;
  const spec: WindowSpec = { kind: opts.windows, len: opts.winLen, strat: opts.strat };
  const excludedTotals: Record<string, number> = {};
  const coreDrops: Record<string, number> = {};
  let coreRejected = 0;
  const addAll = (into: Record<string, number>, from: Record<string, number>): void => {
    for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  };

  const finishWindow = (w: NeutralRow[]): NeutralRow[] | null => {
    if (opts.variant === 'core') {
      const f = coreFilter(w);
      addAll(coreDrops, f.dropped);
      if (f.rejected) { coreRejected++; return null; }
      return anonymizeWindow(f.rows);
    }
    return anonymizeWindow(w);
  };

  // sim side: simulate until enough windows (hard cap 3x to stay loud on
  // impossible requests instead of spinning)
  const simWins: NeutralRow[][] = [];
  let simGames = 0;
  while (simWins.length < opts.simCount && simGames < Math.ceil(opts.simCount / perGameSim) * 3 + 4) {
    const g = simNeutralGames(1, `${opts.seedBase}-s${simGames}`)[0]!;
    addAll(excludedTotals, g.excluded);
    for (const w of cutWindows(g.rows, { ...spec, perGame: perGameSim }, rng)) {
      if (simWins.length >= opts.simCount) break;
      const done = finishWindow(w);
      if (done) simWins.push(done);
    }
    simGames++;
  }

  // real side: committed shards, seeded season-spread shuffle, capped per game
  const realWins: NeutralRow[][] = [];
  let realGamesUsed = 0;
  let unparseTotal = 0;
  if (existsSync(opts.realDir)) {
    const games = rng.shuffle(loadCorpus(opts.realDir));
    for (const cg of games) {
      if (realWins.length >= opts.simCount) break;
      const g = realToNeutral(cg.plays, cg.id);
      addAll(excludedTotals, g.excluded);
      unparseTotal += g.excluded['real.unparsed'] ?? 0;
      let took = 0;
      for (const w of cutWindows(g.rows, { ...spec, perGame: Math.min(opts.capPerGame, perGameSim) }, rng)) {
        if (realWins.length >= opts.simCount || took >= opts.capPerGame) break;
        const done = finishWindow(w);
        if (done) { realWins.push(done); took++; }
      }
      if (took > 0) realGamesUsed++;
    }
  }

  // balanced pack: a lopsided pack invites base-rate guessing
  const n = Math.min(simWins.length, realWins.length);
  const sims = simWins.slice(0, n);
  const reals = realWins.slice(0, n);

  const items = rng.shuffle([
    ...sims.map((w, i) => ({ id: `S${i}`, kind: 'sim' as const, rows: w })),
    ...reals.map((w, i) => ({ id: `R${i}`, kind: 'real' as const, rows: w }))
  ]).map((x, i) => ({ n: i + 1, ...x }));

  mkdirSync(opts.outDir, { recursive: true });
  const fmt = (w: NeutralRow[]): string => w.map((r) => renderNeutral(r, opts.variant)).join('\n');
  writeFileSync(path.join(opts.outDir, 'pack.json'), JSON.stringify(
    items.map(({ n: num, rows }) => ({ n: num, text: fmt(rows) })), null, 1));
  writeFileSync(path.join(opts.outDir, 'key.json'), JSON.stringify(
    items.map(({ n: num, kind, id }) => ({ n: num, kind, id })), null, 1));
  for (const it of items) {
    writeFileSync(path.join(opts.outDir, `excerpt-${String(it.n).padStart(2, '0')}.txt`), fmt(it.rows) + '\n');
  }
  const density = items.length
    ? items.reduce((s, it) => s + it.rows.length, 0) / items.length : 0;
  writeFileSync(path.join(opts.outDir, 'manifest.json'), JSON.stringify({
    protocol: 'neutral-repr fair Turing pack (findings/fdesign-judge.md §2)',
    promptVersion: 'fdesign-judge-v1',
    flags: {
      repr: 'neutral', windows: opts.windows, variant: opts.variant, strat: opts.strat,
      sim: opts.simCount, window: opts.winLen, capPerGame: opts.capPerGame, seed: opts.seedBase,
      real: opts.realDir
    },
    counts: { excerpts: items.length, sim: sims.length, real: reals.length, simGames, realGamesUsed },
    windowRowsMean: Number(density.toFixed(1)),
    exclusions: excludedTotals,
    unparsedRealRows: unparseTotal,
    core: opts.variant === 'core' ? { dropped: coreDrops, rejectedWindows: coreRejected } : null
  }, null, 1));

  console.log(`wrote ${items.length} blind excerpts (${sims.length} sim, ${reals.length} real; ` +
    `${opts.windows}/${opts.variant}) to ${opts.outDir}/`);
  console.log('pack.json = blind pack for judges; key.json = answers (do not show); manifest.json = provenance.');
  if (reals.length === 0) {
    console.log('\nWARNING: NO REAL SIDE — this pack is UNMEASURABLE as a discrimination test.');
    console.log(`Point --real at the committed corpus (default ${DEFAULT_CORPUS_DIR}) for a judged run.`);
  }
}

/** every flag this CLI reads — the checkFlags vocabulary below. Exported so
 *  the flag-guard test can pin that the allow-list stays in sync with the
 *  reads: it once omitted --repr/--windows/--variant/--strat/--cap-per-game
 *  (all read a few lines down), so the file's own documented `--variant core`
 *  invocation died as "unknown flag --variant". */
export const TURING_CLI_FLAGS: readonly string[] = [
  '--sim', '--window', '--out', '--real', '--seed', '--strip-timeouts',
  '--repr', '--windows', '--variant', '--strat', '--cap-per-game'
];

const isMain = process.argv[1]?.endsWith('turing.ts');
if (isMain) {
  // declared vocabulary — a typo'd or `=`-spelled flag dies here instead of
  // silently building a default pack (args.ts checkFlags, audit H-03)
  checkFlags(process.argv, TURING_CLI_FLAGS);
  const simCount = flagNumber(process.argv, '--sim', 15);
  const winLen = flagNumber(process.argv, '--window', 14);
  const outDir = flagValue(process.argv, '--out', 'out/turing');
  const seedBase = flagValue(process.argv, '--seed', 'turing');
  const stripTimeouts = process.argv.includes('--strip-timeouts');
  // 'neutral' is the fair protocol and the default; 'bbref' (the legacy
  // renderer above) is kept only for continuity comparisons with rounds 1-2.
  const repr = flagValue(process.argv, '--repr', 'neutral');

  if (repr === 'neutral') {
    const realDir = flagValue(process.argv, '--real', DEFAULT_CORPUS_DIR);
    if (stripTimeouts) {
      console.log('NOTE: --strip-timeouts is a bbref-path flag; the neutral protocol keeps timeouts on');
      console.log('both sides (one identical row) and measures their scarcity honestly (gate G1).');
    }
    emitNeutralPack({
      simCount, winLen, outDir, realDir, seedBase,
      windows: flagValue(process.argv, '--windows', 'mid') as WindowKind,
      variant: flagValue(process.argv, '--variant', 'census') as 'census' | 'core',
      strat: flagValue(process.argv, '--strat', 'any') as 'clutch' | 'decided' | 'any',
      capPerGame: flagNumber(process.argv, '--cap-per-game', 2)
    });
  } else {
    const realDir = flagValue(process.argv, '--real', '');
    const rng = new Rng(`${seedBase}-pack`);

    // strip-timeouts applies to BOTH sides on this path (the endgame layer
    // emits stop-run timeouts inside these windows; --strip-timeouts removes
    // them from BOTH for the conditioned variant, the raw variant keeps them)
    const sims = simWindows(simCount, winLen, seedBase, rng, stripTimeouts);
    const reals = realDir ? realWindows(realDir, simCount, winLen, rng, stripTimeouts) : [];

    const items = rng.shuffle([
      ...sims.map((w, i) => ({ id: `S${i}`, kind: 'sim' as const, lines: w })),
      ...reals.map((w, i) => ({ id: `R${i}`, kind: 'real' as const, lines: w }))
    ]).map((x, i) => ({ n: i + 1, ...x }));

    mkdirSync(outDir, { recursive: true });
    const fmt = (w: NormPlay[]): string =>
      w.map((l) => `[${l.clock}] ${l.text}${l.score ? ` (${l.score})` : ''}`).join('\n');
    writeFileSync(path.join(outDir, 'pack.json'), JSON.stringify(
      items.map(({ n, lines }) => ({ n, text: fmt(lines) })), null, 1));
    writeFileSync(path.join(outDir, 'key.json'), JSON.stringify(
      items.map(({ n, kind, id }) => ({ n, kind, id })), null, 1));
    for (const it of items) writeFileSync(path.join(outDir, `excerpt-${String(it.n).padStart(2, '0')}.txt`), fmt(it.lines) + '\n');
    console.log(`wrote ${items.length} blind excerpts (${sims.length} sim, ${reals.length} real) to ${outDir}/`);
    console.log('pack.json = blind pack for judges; key.json = answers (do not show).');
  }
}
