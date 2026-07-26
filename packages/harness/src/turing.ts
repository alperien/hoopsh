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
 * Design notes, all deliberate:
 *  - BOTH sides render through the same dry register (this file's renderer
 *    for sim events; bbref's own text for real plays) and both get
 *    pseudonymized from the same name pool, so formatting and name
 *    recognition cannot carry the verdict — only basketball structure can.
 *  - Windows are intra-quarter (Q2-Q3 by default) so the verdict rests on
 *    ordinary halfcourt basketball, not on the sim's KNOWN missing endgame
 *    layer; `--strip-timeouts` optionally removes real timeout lines for the
 *    conditioned variant (the raw variant keeps them and simply counts the
 *    timeout tell honestly — it is a real gap, see REFACTOR.md M4).
 *  - Running score is appended to scoring lines on both sides (score cadence
 *    is part of how a game reads).
 *
 * Usage:
 *   npm run turing -- --sim 15 --out out/turing            # sim excerpts only
 *   npm run turing -- --sim 15 --real /path/to/plays-dir --out out/turing
 * The real-plays dir holds JSON arrays of { q, clockSec, side, text, a, h }
 * (see tools/fetch-nba.mjs notes / REFACTOR.md for how to produce them from
 * public play-by-play pages — raw fetched HTML stays out of the repo).
 * Output: pack.json (blind, shuffled), key.json (answers — do not show the
 * judges), and a per-excerpt .txt for convenient pasting.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Rng, simulateGame, type GameEvent, type Team } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { flagNumber, flagValue } from './args.js';

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

/** render one sim event into the bbref-ish dry register (null = not a play line) */
function renderEvent(e: GameEvent, name: (id: string) => string): string | null {
  switch (e.type) {
    case 'shot': {
      const kind = e.three
        ? `3-pt jump shot from ${Math.round(e.distFt)} ft`
        : e.zone === 'rim'
          ? `layup from ${Math.max(1, Math.round(e.distFt))} ft`
          : `2-pt jump shot from ${Math.round(e.distFt)} ft`;
      if (e.made) {
        const ast = e.assist ? ` (assist by ${name(e.assist)})` : '';
        return `${name(e.shooter)} makes ${kind}${ast}`;
      }
      const blk = e.blockedBy ? ` (block by ${name(e.blockedBy)})` : '';
      return `${name(e.shooter)} misses ${kind}${blk}`;
    }
    case 'free_throw':
      return `${name(e.shooter)} ${e.made ? 'makes' : 'misses'} free throw ${e.n} of ${e.of}`;
    case 'rebound':
      return `${e.offensive ? 'Offensive' : 'Defensive'} rebound by ${name(e.player)}`;
    case 'turnover': {
      const kind =
        e.kind === 'bad_pass' ? 'bad pass' :
        e.kind === 'lost_ball' ? 'lost ball' :
        e.kind === 'off_foul' ? 'offensive foul' :
        e.kind === 'shot_clock' ? 'shot clock' : 'out of bounds';
      const stl = e.stolenBy ? `; steal by ${name(e.stolenBy)}` : '';
      return `Turnover by ${name(e.player)} (${kind}${stl})`;
    }
    case 'foul': {
      if (e.kind === 'offensive') return null; // the paired turnover line already reads as the play
      const kind = e.kind === 'shooting' ? 'Shooting' : e.kind === 'loose_ball' ? 'Loose ball' : 'Personal';
      const drawn = e.drawnBy ? ` (drawn by ${name(e.drawnBy)})` : '';
      return `${kind} foul by ${name(e.on)}${drawn}`;
    }
    case 'substitution':
      return `${name(e.in[0]!)} enters the game for ${name(e.out[0]!)}`;
    default:
      return null;
  }
}

function simWindows(count: number, winLen: number, seedBase: string, rng: Rng): NormPlay[][] {
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
    // renderable mid-game lines (Q2-Q3)
    const lines: NormPlay[] = [];
    let prev: [number, number] = [0, 0];
    for (const e of r.events) {
      if (e.period < 2 || e.period > 3) { prev = [e.score[0], e.score[1]]; continue; }
      const text = renderEvent(e, name);
      if (!text) { prev = [e.score[0], e.score[1]]; continue; }
      const scored = e.score[0] + e.score[1] > prev[0] + prev[1];
      lines.push({ clock: fmtClock(e.period, e.clock), text, score: scored ? `${e.score[0]}-${e.score[1]}` : undefined });
      prev = [e.score[0], e.score[1]];
    }
    // up to 3 non-overlapping windows per game
    for (let w = 0; w < 3 && windows.length < count; w++) {
      const start = 10 + w * Math.floor((lines.length - winLen - 20) / 3);
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

function realWindows(dir: string, count: number, winLen: number, rng: Rng, stripTimeouts: boolean): NormPlay[][] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const windows: NormPlay[][] = [];
  for (const f of files) {
    const plays = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as RealPlay[];
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
    for (let w = 0; w < 3 && windows.length < count; w++) {
      const start = 5 + w * Math.floor((lines.length - winLen - 10) / 3);
      if (start + winLen > lines.length) break;
      windows.push(lines.slice(start, start + winLen));
    }
    if (windows.length >= count) break;
  }
  return windows.slice(0, count);
}

// ------------------------------------------------------------------- main

const isMain = process.argv[1]?.endsWith('turing.ts');
if (isMain) {
  const simCount = flagNumber(process.argv, '--sim', 15);
  const winLen = flagNumber(process.argv, '--window', 14);
  const outDir = flagValue(process.argv, '--out', 'out/turing');
  const realDir = flagValue(process.argv, '--real', '');
  const seedBase = flagValue(process.argv, '--seed', 'turing');
  const stripTimeouts = process.argv.includes('--strip-timeouts');
  const rng = new Rng(`${seedBase}-pack`);

  const sims = simWindows(simCount, winLen, seedBase, rng);
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
