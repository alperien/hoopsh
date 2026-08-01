/**
 * media/recap.ts - game recaps from stored results. Reads GameRecord
 * (lines, totals, keyPlays), never raw events: gameday folded those.
 *
 * Prose law (docs/FRANCHISE.md §10): dry, factual, numbers only from the
 * sim. No exclamation marks, no em dashes, no manufactured drama. Variety
 * comes from seeded pool selection keyed to the game id, so two recaps on
 * the same night read differently and the same game always reads the same
 * (determinism). The wire voice carries recaps; the other bylines live in
 * news.ts.
 */
import { Rng } from '@hoopsh/engine';
import type { GameLine, GameRecord, League, NewsItem } from '../types.js';
import { officialsRecapLine } from '../officials.js';

/** Wire byline for recaps (fixed voice, see media/news.ts for the others). */
export const WIRE = 'Association Wire';

function teamName(league: League, id: string): string {
  const t = league.teams[id];
  return t ? t.name : id;
}

function cityName(league: League, id: string): string {
  const t = league.teams[id];
  return t ? t.city : id;
}

/** Top scorer line on a side, ties broken by minutes then id (stable). */
function star(lines: GameLine[], teamId: string): GameLine | null {
  const own = lines.filter(l => l.teamId === teamId);
  if (own.length === 0) return null;
  own.sort((a, b) => b.pts - a.pts || b.min - a.min || a.playerId.localeCompare(b.playerId));
  return own[0]!;
}

function statLine(league: League, l: GameLine): string {
  const name = league.players[l.playerId]?.name ?? l.playerId;
  const bits = [`${l.pts} points`];
  if (l.orb + l.drb >= 10) bits.push(`${l.orb + l.drb} rebounds`);
  if (l.ast >= 8) bits.push(`${l.ast} assists`);
  if (l.blk >= 4) bits.push(`${l.blk} blocks`);
  if (l.stl >= 4) bits.push(`${l.stl} steals`);
  if (bits.length === 1 && l.tpm >= 5) bits.push(`${l.tpm} threes`);
  return `${name} had ${bits.join(', ')}`;
}

/** A double-double or better, for the notes sentence. */
function doubleDouble(l: GameLine): boolean {
  const cats = [l.pts >= 10, l.orb + l.drb >= 10, l.ast >= 10, l.blk >= 10, l.stl >= 10];
  return cats.filter(Boolean).length >= 2;
}

function tripleDouble(l: GameLine): boolean {
  const cats = [l.pts >= 10, l.orb + l.drb >= 10, l.ast >= 10, l.blk >= 10, l.stl >= 10];
  return cats.filter(Boolean).length >= 3;
}

/**
 * Write the recap for one game. Weight: 2 for user-team and milestone
 * games, 1 otherwise (the front page belongs to bigger stories).
 */
export function recapGame(league: League, record: GameRecord): NewsItem | null {
  const [hs, as] = record.final;
  const homeWon = hs > as;
  const winner = homeWon ? record.home : record.away;
  const loser = homeWon ? record.away : record.home;
  const wName = teamName(league, winner);
  const lName = teamName(league, loser);
  const margin = Math.abs(hs - as);
  const rng = new Rng(`${league.seed}:recap:${record.id}`);

  const wStar = star(record.lines, winner);
  const lStar = star(record.lines, loser);

  // headline pool by game shape; every option is plain fact
  const score = homeWon ? `${hs}-${as}` : `${as}-${hs}`;
  const headlines: string[] = [];
  if (record.ot > 0) {
    const otTag = record.ot === 1 ? 'overtime' : `${record.ot} overtimes`;
    headlines.push(
      `${wName} outlast ${lName} in ${otTag}, ${score}`,
      `${wName} take ${lName} to ${otTag} and win it, ${score}`,
    );
  } else if (margin >= 20) {
    headlines.push(
      `${wName} run ${lName} out of the building, ${score}`,
      `${wName} rout ${lName}, ${score}`,
      `${wName} bury ${lName} by ${margin}`,
    );
  } else if (margin <= 5) {
    headlines.push(
      `${wName} edge ${lName}, ${score}`,
      `${wName} hold off ${lName}, ${score}`,
      `${wName} survive ${lName}, ${score}`,
    );
  } else {
    headlines.push(
      `${wName} beat ${lName}, ${score}`,
      `${wName} handle ${lName}, ${score}`,
      `${wName} get past ${lName}, ${score}`,
    );
  }
  if (wStar && wStar.pts >= 40) {
    headlines.length = 0; // a 40-point night IS the headline
    const starName = league.players[wStar.playerId]?.name ?? wStar.playerId;
    headlines.push(
      `${starName} pours in ${wStar.pts} as ${wName} beat ${lName}`,
      `${starName} scores ${wStar.pts}, ${wName} take down ${lName} ${score}`,
    );
  }
  const headline = headlines[rng.int(headlines.length)]!;

  // body: star line, the decisive moment, one team-stat note, a context tail
  const sentences: string[] = [];
  if (wStar) {
    const shooting = wStar.fga >= 10 ? ` on ${wStar.fgm}-of-${wStar.fga} shooting` : '';
    sentences.push(`${statLine(league, wStar)}${shooting} for ${cityName(league, winner)}.`);
  }
  const decisive = record.keyPlays.find(k => k.kind === 'run' || k.kind === 'buzzer' || k.kind === 'takeover')
    ?? record.keyPlays[0];
  if (decisive) sentences.push(`${decisive.text} (${decisive.clock}).`);
  const [ht, at] = record.totals;
  const wt = homeWon ? ht : at;
  const lt = homeWon ? at : ht;
  const notes: string[] = [];
  if (wt.tpm >= 18) notes.push(`${wName} hit ${wt.tpm} threes`);
  if (lt.tov >= 18) notes.push(`${lName} gave it away ${lt.tov} times`);
  if (wt.fastbreakPts - lt.fastbreakPts >= 12) notes.push(`${wName} won the open floor ${wt.fastbreakPts}-${lt.fastbreakPts}`);
  if (wt.orb >= 14) notes.push(`${wName} took ${wt.orb} offensive boards`);
  if (lStar && lStar.pts >= 30) notes.push(`${statLine(league, lStar)} in the loss`);
  else if (lStar && tripleDouble(lStar)) notes.push(`${league.players[lStar.playerId]?.name ?? lStar.playerId} finished with a triple-double in the loss`);
  if (notes.length > 0) sentences.push(`${notes[rng.int(notes.length)]!}.`);
  const streak = league.standings[winner]?.streak ?? 0;
  if (streak >= 4 && record.type === 'regular') sentences.push(`${wName} have won ${streak} straight.`);
  if (record.type === 'playoffs' && record.seriesId) {
    const series = league.playoffs.find(s => s.id === record.seriesId);
    if (series) {
      const [hw, lw] = series.wins;
      const lead = hw === lw ? `even at ${hw}-${lw}` : hw > lw ? `${series.high === winner ? wName : lName} up ${Math.max(hw, lw)}-${Math.min(hw, lw)}` : `${series.low === winner ? wName : lName} up ${Math.max(hw, lw)}-${Math.min(hw, lw)}`;
      sentences.push(`The series is ${lead}.`);
    }
  }

  const crewLine = officialsRecapLine(league, record);
  if (crewLine) sentences.push(crewLine);

  const userGame = record.home === league.userTeam || record.away === league.userTeam;
  const milestone = (wStar && wStar.pts >= 40) || record.keyPlays.some(k => k.kind === 'milestone' || k.kind === 'buzzer');
  const body = sentences.join(' ');
  const id = `n-${record.id}-recap`;

  return {
    id,
    date: record.date,
    type: 'recap',
    headline,
    body,
    byline: WIRE,
    players: [wStar?.playerId, lStar?.playerId].filter((x): x is string => Boolean(x)),
    teams: [record.home, record.away],
    gameId: record.id,
    weight: record.type === 'playoffs' || userGame || milestone ? 2 : 1,
  };
}
