/**
 * media/moments.ts - the calendar's loudest dates. The daily desk
 * (media/news.ts) reads what happened today; this module writes the
 * stories that mark a phase turning: the championship story at the horn,
 * the lottery order the night it is drawn, and the consensus draft
 * preview. Called by the spine at the phase transitions (tick.ts), never
 * from the daily pulse, because the pulse runs BEFORE the transitions and
 * would date these stories a day late (issue #111).
 *
 * Prose law (docs/FRANCHISE.md §10): dry and factual, numbers only from
 * sim data, no exclamation marks, no em dashes, no fabricated quotes.
 * Ids are deterministic per (day, story) so appendNews's guard makes
 * re-entered days idempotent.
 */
import type { AttrGroup, FrPlayer, League, NewsItem, PlayerId, TeamId } from '../types.js';
import { streamRng } from '../rng.js';
import { classStrengthFor } from '../people/gen.js';
import { GROUP_ORDER, perceivedGroup } from '../scouting.js';
import { positionBlend } from '../ai/roster.js';
import { tapeAdjust } from '../ai/draftai.js';
import { WIRE } from './recap.js';
import { COLUMNIST, ordinal } from './news.js';

// FEEL - the aggregate room: draftai.ts blends ceiling at 0.3 + 0.4 * risk;
// the league-wide consensus reads as a neutral-risk room (risk 50 -> 0.5).
const CONSENSUS_CEIL_WEIGHT = 0.5;
// FEEL - a class one classStrengthSd (0.06) off the mean gets an adjective;
// the middle two-thirds of classes go undescribed rather than called average.
const CLASS_STRONG = 1.06;
const CLASS_THIN = 0.94;
const PREVIEW_NAMES = 3; // the preview names this many prospects (FEEL: a top three is the mock-draft convention)

function teamName(league: League, id: TeamId): string {
  return league.teams[id]?.name ?? id;
}

// How a scout names a position (scouting.ts keeps its own copy private;
// media mirrors recap.ts's precedent of small local formatters).
const POS_NOUN: Record<FrPlayer['pos'], string> = {
  PG: 'guard', SG: 'guard', SF: 'wing', PF: 'forward', C: 'big',
};

/**
 * Owner of the round-1 pick originally belonging to `slotTeam` this season.
 * Same read as the spine's private pickOwner (tick.ts); duplicated because
 * media must not import the spine (tick.ts imports media, and a cycle is
 * worse than ten lines). Protections are already settled by runLottery, so
 * pick.owner is the truth. Falls back to the slot team when no pick object
 * exists (hand-built fixtures; genesis seeds picks seven seasons out).
 */
function pickOneOwner(league: League, slotTeam: TeamId): TeamId {
  for (const tid of Object.keys(league.teams)) {
    for (const pick of league.teams[tid]!.picks) {
      if (pick.season === league.season && pick.round === 1 && pick.originalTeam === slotTeam) {
        return pick.owner;
      }
    }
  }
  return slotTeam;
}

/**
 * The championship story, written once at the playoffs-to-lottery
 * transition (tick.ts), AFTER the season archive is pushed: the title
 * count below reads league.archives and expects this season in it.
 * Returns [] when the finals have no winner (defensive; the transition
 * only fires with one).
 */
export function championshipNews(league: League): NewsItem[] {
  const finals = league.playoffs.find((s) => s.round === 4 && s.winner !== undefined);
  if (!finals?.winner) return [];
  const champ = finals.winner;
  const runnerUp = champ === finals.high ? finals.low : finals.high;
  const champWins = champ === finals.high ? finals.wins[0] : finals.wins[1];
  const loserWins = champ === finals.high ? finals.wins[1] : finals.wins[0];
  const champSeed = champ === finals.high ? finals.highSeed : finals.lowSeed;
  const games = champWins + loserWins;
  const name = teamName(league, champ);
  const other = teamName(league, runnerUp);
  const rng = streamRng(league.seed, 'moments', league.season, league.day);

  // the finals scoring leader on the champion's side: fold the series
  // lines from the results ledger (simulated truth, not written flavor)
  const totals = new Map<PlayerId, { pts: number; gp: number }>();
  for (const gid of finals.games) {
    const rec = league.results[gid];
    if (!rec) continue;
    for (const line of rec.lines) {
      if (line.teamId !== champ || line.min <= 0) continue;
      const t = totals.get(line.playerId) ?? { pts: 0, gp: 0 };
      t.pts += line.pts;
      t.gp += 1;
      totals.set(line.playerId, t);
    }
  }
  let leader: { id: PlayerId; ppg: number } | null = null;
  for (const [id, t] of totals) {
    const ppg = t.pts / t.gp;
    // strict greater-than with an id tiebreak: deterministic whatever the
    // line order, same discipline as draftai's board scan
    if (!leader || ppg > leader.ppg || (ppg === leader.ppg && id < leader.id)) {
      leader = { id, ppg };
    }
  }

  // titles counted from the archives; this season's archive is already
  // pushed at the call site, so the count includes tonight (the max is a
  // guard against a reordered call site, not a code path)
  const titles = Math.max(1, league.archives.filter((a) => a.champion === champ).length);

  const headlines = loserWins === 0
    ? [
      `${name} sweep ${other} for the title`,
      `A sweep ends it and ${name} are champions`,
      `${name} finish the sweep and take the championship`,
    ]
    : games === 7
      ? [
        `${name} take Game 7 and the championship`,
        `${name} outlast ${other} in seven`,
        `Seven games decide it and ${name} are champions`,
      ]
      : [
        `${name} are champions`,
        `${name} close out ${other} for the title`,
        `${name} win the championship in ${games}`,
      ];

  const standing = league.standings[champ];
  const record = standing ? ` The ${ordinal(champSeed)} seed finished the regular season ${standing.w}-${standing.l}.` : '';
  const titleLine = titles === 1
    ? ' It is the first championship in franchise history.'
    : ` It is the franchise's ${ordinal(titles)} championship.`;
  const leaderLine = leader
    ? ` ${league.players[leader.id]?.name ?? leader.id} led the champions with ${Math.round(leader.ppg * 10) / 10} points a game in the series.`
    : '';

  return [{
    id: `n-s${league.season}d${league.day}-champ`,
    date: { season: league.season, day: league.day },
    type: 'review',
    headline: headlines[rng.int(headlines.length)]!,
    body: `${name} beat ${other} ${champWins}-${loserWins} in the finals.${record}${titleLine}${leaderLine}`,
    byline: COLUMNIST,
    players: leader ? [leader.id] : [],
    teams: [champ, runnerUp],
    gameId: undefined,
    weight: 3,
  }];
}

/**
 * The league's consensus read on a prospect: every team's perceived
 * current-plus-ceiling blend through the same position lens the AI boards
 * use (ai/draftai.ts), averaged, plus the public tape. Perception is
 * persistent per (team, player), so this is a pure read with no rng of
 * its own; averaging thirty differently-wrong rooms is exactly what a
 * mock-draft consensus is.
 */
function consensusScore(league: League, pid: PlayerId): number {
  const prospect = league.players[pid];
  if (!prospect) return -Infinity;
  let sum = 0;
  let rooms = 0;
  for (const tid of Object.keys(league.teams)) {
    const current = {} as Record<AttrGroup, number>;
    const ceiling = {} as Record<AttrGroup, number>;
    for (const g of GROUP_ORDER) {
      current[g] = perceivedGroup(league, tid, pid, g, 'current');
      ceiling[g] = perceivedGroup(league, tid, pid, g, 'ceiling');
    }
    sum += (1 - CONSENSUS_CEIL_WEIGHT) * positionBlend(prospect.pos, current)
      + CONSENSUS_CEIL_WEIGHT * positionBlend(prospect.pos, ceiling);
    rooms += 1;
  }
  return (rooms > 0 ? sum / rooms : 0) + tapeAdjust(prospect);
}

/** `Name (age, position noun, origin)` - the wire's one-line prospect bio. */
function prospectBio(league: League, pid: PlayerId): string {
  const p = league.players[pid]!;
  return `${p.name} (${league.season - p.bornSeason}, ${POS_NOUN[p.pos]}, ${p.originDetail})`;
}

/** Oxford-comma list for one to three names. */
function listPhrase(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * Lottery night's two stories, written once at the lottery-to-draft
 * transition (tick.ts), AFTER runLottery, generateDraftClass, and
 * runCombine: the order story needs settled pick ownership and the
 * preview needs the class on the books. Returns [] when there was no
 * drawing (defensive; the transition only fires after one).
 */
export function lotteryNightNews(league: League): NewsItem[] {
  const lottery = league.lottery;
  if (!lottery) return [];
  const out: NewsItem[] = [];
  const rng = streamRng(league.seed, 'moments', league.season, league.day);
  const order = lottery.order;
  const winner = order[0]!;
  const winName = teamName(league, winner);
  const ownerOfOne = pickOneOwner(league, winner);
  const conveyed = ownerOfOne !== winner;

  // ---- the order story -----------------------------------------------
  const winnerMove = lottery.movement.find((m) => m.teamId === winner);
  const opener = winnerMove
    ? `${winName} jumped from ${ordinal(winnerMove.from)} in the pre-lottery order to win the first pick.`
    : (() => {
      const s = league.standings[winner];
      return s
        ? `${winName}, holders of the league's worst record at ${s.w}-${s.l}, kept the first pick.`
        : `${winName} kept the first pick.`;
    })();
  const conveyLine = conveyed ? ` The pick belongs to ${teamName(league, ownerOfOne)} by prior trade.` : '';
  // the largest remaining swing, phrased by direction: movement records
  // drawn teams whose slot changed (postseason.ts), and a drawn team can
  // fall past the winner too; calling a slide a jump would be a lie
  const mover = [...lottery.movement]
    .filter((m) => m.teamId !== winner)
    .sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to) || a.teamId.localeCompare(b.teamId))[0];
  const moverLine = mover
    ? mover.to < mover.from
      ? ` ${teamName(league, mover.teamId)} moved up from ${ordinal(mover.from)} to ${ordinal(mover.to)}.`
      : ` ${teamName(league, mover.teamId)} slid from ${ordinal(mover.from)} to ${ordinal(mover.to)}.`
    : lottery.movement.length === 0
      ? ' The order held to form.'
      : '';
  const board = order
    .map((slotTeam, i) => {
      const owner = pickOneOwner(league, slotTeam);
      return `${i + 1}. ${teamName(league, slotTeam)}${owner !== slotTeam ? ` (pick to ${teamName(league, owner)})` : ''}`;
    })
    .join(', ');

  const lotteryHeadlines = conveyed
    ? [
      `${winName} win the lottery for ${teamName(league, ownerOfOne)}`,
      `Lottery night twist: the ${winName} pick conveys`,
      `${winName} land on top and the pick moves on`,
    ]
    : winnerMove
      ? [
        `${winName} win the draft lottery`,
        `${winName} jump to the top of the draft`,
        `Lottery night goes to ${winName}`,
      ]
      : [
        `${winName} hold the top pick`,
        `${winName} keep the first pick`,
        `No surprise at the top as ${winName} pick first`,
      ];

  out.push({
    id: `n-s${league.season}d${league.day}-lott`,
    date: { season: league.season, day: league.day },
    type: 'lottery',
    headline: lotteryHeadlines[rng.int(lotteryHeadlines.length)]!,
    body: `${opener}${conveyLine}${moverLine} The first-round order: ${board}.`,
    byline: WIRE,
    players: [],
    teams: [...order], // every team learned its slot tonight: the team filter must surface this
    gameId: undefined,
    weight: 3,
  });

  // ---- the draft preview ----------------------------------------------
  if (league.draftClass.length > 0) {
    const ranked = [...league.draftClass].sort()
      .map((id) => ({ id, score: consensusScore(league, id) }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, PREVIEW_NAMES)
      .map((r) => r.id);
    const top = league.players[ranked[0]!]!;
    const draftIdx = league.calendar.findIndex((d) => (d.marks as readonly string[]).includes('draftNight'));
    const daysOut = draftIdx - league.day;
    const when = draftIdx < 0 ? '' : daysOut > 1 ? ` in ${daysOut} days` : daysOut === 1 ? ' tomorrow' : ' tonight';
    const wave = classStrengthFor(league.seed, league.season, league.params);
    const classLine = wave >= CLASS_STRONG
      ? ' Rooms around the league call it a strong class.'
      : wave <= CLASS_THIN
        ? ' Rooms around the league call it a thin class.'
        : '';
    const previewHeadlines = [
      `Draft preview: the board starts with ${top.name}`,
      `${top.name} heads the draft class`,
      `The consensus board begins with ${top.name}`,
    ];
    out.push({
      id: `n-s${league.season}d${league.day}-dpre`,
      date: { season: league.season, day: league.day },
      type: 'preview',
      headline: previewHeadlines[rng.int(previewHeadlines.length)]!,
      body: `${teamName(league, ownerOfOne)} pick first${when}. Scouts' consensus puts ${listPhrase(ranked.map((id) => prospectBio(league, id)))} at the top of the class.${classLine}`,
      byline: COLUMNIST,
      players: ranked,
      teams: [ownerOfOne],
      gameId: undefined,
      weight: 2,
    });
  }

  return out;
}
