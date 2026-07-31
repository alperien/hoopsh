/**
 * people/disposition.ts - off-court morale and trade requests. OWNER:
 * people task.
 *
 * Morale is OFF-COURT ONLY in v1 (register F1, docs/FRANCHISE.md §13): a
 * sulking star still plays like a star; his leverage is the papers and
 * the front office, never the engine dials. updateDispositions is a pure
 * recomputation, idempotent per call: morale is a function of today's
 * league state (role, wins, usage, health), never an accumulator, so the
 * spine can call it on whatever cadence it likes and calling twice moves
 * nothing twice.
 *
 * QUIET BY DESIGN: the research warns that morale spam and mood
 * micromanagement are hated (research 01 Q3: BBGM's own anti-
 * micromanagement principle; research 03/04 anti-patterns). A healthy,
 * winning, sanely-rotated league recomputes to the content baseline and
 * produces near-zero requests. A request needs a top-3 talent playing
 * below his rank AND morale under the params.trade.requestMoraleFloor AND
 * low professionalism, at most once per player per season.
 *
 * Randomness: none consumed today. The registered 'morale:<season>:<day>'
 * stream stays reserved: requests are earned by the compound condition,
 * not rolled, because dice-driven drama is the development-progs failure
 * transplanted to the locker room.
 */
import type { FrPlayer, FrTeam, InboxItem, League } from '../types.js';
import { ATTR_GROUPS, groupMean, regularSeasonTotals } from './dev.js';

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Content baseline: an employed pro with no grievance sits here. FEEL 70. */
const MORALE_BASE = 70;

/**
 * What each owner expectation translates to as a win fraction, for the
 * team-success factor. REAL-ish anchors (title ~57-win pace, playoffs
 * ~45-win pace in a 13-14 SD league, research 05 B6); mapping FEEL.
 */
const EXPECTATION_TARGET: Record<FrTeam['owner']['expectation'], number> = {
  title: 0.70,
  contend: 0.61,
  playoffs: 0.55,
  playin: 0.45,
  develop: 0.35,
  rebuild: 0.25,
};

/** Crude one-number talent proxy: mean of the six group means. Rank ordering only. */
function overallOf(player: FrPlayer): number {
  let sum = 0;
  let n = 0;
  for (const group of Object.keys(ATTR_GROUPS) as Array<keyof typeof ATTR_GROUPS>) {
    sum += groupMean(player.attr, group);
    n++;
  }
  return sum / n;
}

/** Deterministic string order (no locale tables anywhere near determinism). */
function byId(a: FrPlayer, b: FrPlayer): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The team currently employing the player (roster or two-way), if any. */
function teamOf(league: League, playerId: string): FrTeam | null {
  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;
    if (team.roster.includes(playerId) || team.twoWay.includes(playerId)) return team;
  }
  return null;
}

/**
 * Recompute one player's morale (0-100) from today's league state. Pure
 * with respect to the league (reads standings, rosters, season rows;
 * writes nothing). Exported so tests and the UI can hit the math.
 *
 * Factors: role satisfaction (minutes rank vs talent rank on the roster,
 * weighted by ambition), team success vs the owner's stated expectation
 * (weighted by ambition), usage fit, injury frustration; professionalism
 * damps the whole swing. Free agents idle at the content baseline: the
 * FA market module owns their feelings.
 */
export function moraleFor(league: League, player: FrPlayer): number {
  const team = teamOf(league, player.id);
  if (!team) return MORALE_BASE;

  // Ambition weights the grievances: 0.5x for the content soldier at
  // ambition 0, 1.5x for the alpha at 100. FEEL.
  const ambW = 0.5 + player.disposition.ambition / 100;

  // Role satisfaction: where his minutes rank on the roster vs where his
  // talent ranks. Playing below your talent is a public demotion.
  const rosterPlayers: FrPlayer[] = [];
  for (const pid of team.roster) {
    const pl = league.players[pid];
    if (pl) rosterPlayers.push(pl);
  }
  let roleDelta = 0;
  let totalMin = 0;
  const minOf = new Map<string, number>();
  for (const pl of rosterPlayers) {
    const m = regularSeasonTotals(pl, league.season).min;
    minOf.set(pl.id, m);
    totalMin += m;
  }
  if (totalMin > 0 && rosterPlayers.length > 1) {
    const byMinutes = [...rosterPlayers].sort((a, b) => (minOf.get(b.id)! - minOf.get(a.id)!) || byId(a, b));
    const byAbility = [...rosterPlayers].sort((a, b) => (overallOf(b) - overallOf(a)) || byId(a, b));
    const minutesRank = byMinutes.findIndex((pl) => pl.id === player.id) + 1;
    const abilityRank = byAbility.findIndex((pl) => pl.id === player.id) + 1;
    const gap = minutesRank - abilityRank;
    if (gap > 0) {
      // 3 morale points per rotation slot below his talent, ambition
      // weighted, capped at 30. FEEL: this is THE grievance that forces
      // trades in the real league.
      roleDelta = -Math.min(30, gap * 3 * ambW);
    } else if (gap < 0) {
      // Playing above your talent is pleasant, mildly: 1 point per slot,
      // capped at 4. FEEL: nobody demands a trade over too many minutes.
      roleDelta = Math.min(4, -gap * 1);
    }
  }

  // Team success vs the owner's stated bar, once the season has shape
  // (10 games, FEEL): winners forgive, losing compounds everything.
  let successDelta = 0;
  const st = league.standings[team.id];
  const games = st ? st.w + st.l : 0;
  if (st && games >= 10) {
    const target = EXPECTATION_TARGET[team.owner.expectation];
    // 30: scale so a 10-win-pct shortfall costs ~3 points before weighting
    // (FEEL); losing stings more than winning soothes, hence the -12/+8 clamp.
    successDelta = clamp((st.w / games - target) * 30 * ambW, -12, 8);
  }

  // Usage fit: a player wired for offensive load (tend.usage) getting spot
  // minutes chafes beyond the rank gap itself. Small on purpose. FEEL:
  // up to -3 when usage 100 meets under-20-minute nights; needs 5 games
  // played so opening week noise reads as nothing.
  let usageDelta = 0;
  const totals = regularSeasonTotals(player, league.season);
  if (totals.gp >= 5 && player.tend.usage > 60 && totals.min / totals.gp < 20) {
    usageDelta = -3 * (player.tend.usage - 60) / 40;
  }

  // Injury frustration: long rehab with no basketball saps. 0.15 points
  // per remaining out-day, capped at -12. FEEL.
  let injuryDelta = 0;
  if (player.health.injury) {
    injuryDelta = -Math.min(12, 0.15 * player.health.injury.remainingDays);
  }

  // Professionalism compresses the swing: the consummate pro (100) shows
  // 60% of the grievance, the volatile one (0) shows all of it. FEEL 0.4.
  const damper = 1 - 0.4 * (player.disposition.professionalism / 100);
  return clamp(Math.round(MORALE_BASE + damper * (roleDelta + successDelta + usageDelta + injuryDelta)), 0, 100);
}

/**
 * Recompute morale for every rostered player and arm trade requests.
 * Called by the spine on its own cadence (daily is safe: idempotent).
 * Mutates player.morale only; returns the InboxItems for the spine to
 * append (a 'decision' with choices for the user's team, a 'notice' for
 * AI teams).
 *
 * Once-per-player-per-season: the item id is deterministic
 * ('trade-request-<season>-<playerId>') and the spine appends returned
 * items to league.inbox, so a standing inbox entry means the demand is
 * already on the record and it does not re-fire while the player stews.
 * If the player is still miserable next season, he asks again.
 */
export function updateDispositions(league: League): InboxItem[] {
  const items: InboxItem[] = [];
  const date = { season: league.season, day: league.day };
  const floor = league.params.trade.requestMoraleFloor;

  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;

    for (const pid of [...team.roster, ...team.twoWay]) {
      const player = league.players[pid];
      if (player) player.morale = moraleFor(league, player);
    }

    // Trade requests: only a top-3 talent has the leverage to force the
    // papers; only low professionalism (< 60, FEEL: a pro handles it
    // in-house) goes public; only real misery pulls the trigger.
    const rosterPlayers: FrPlayer[] = [];
    for (const pid of team.roster) {
      const pl = league.players[pid];
      if (pl) rosterPlayers.push(pl);
    }
    const byAbility = [...rosterPlayers].sort((a, b) => (overallOf(b) - overallOf(a)) || byId(a, b));
    const topTalent = new Set(byAbility.slice(0, 3).map((pl) => pl.id));

    for (const player of rosterPlayers) {
      if (player.morale >= floor) continue;
      if (player.disposition.professionalism >= 60) continue;
      if (!topTalent.has(player.id)) continue;
      const id = `trade-request-${league.season}-${player.id}`;
      if (league.inbox.some((it) => it.id === id)) continue; // already on the record this season
      const isUser = tid === league.userTeam;
      const item: InboxItem = {
        id,
        date,
        kind: isUser ? 'decision' : 'notice',
        title: `${player.name} wants out`,
        body: `${player.name} has told ${team.city} he wants a trade. Morale ${player.morale}: playing below his talent on a team not meeting expectations.`,
        resolved: false,
      };
      if (isUser) {
        item.choices = [
          { id: 'hold', label: 'Hold firm' },
          { id: 'role', label: 'Promise a bigger role' },
          { id: 'talks', label: 'Open trade talks' },
        ];
      }
      items.push(item);
    }
  }
  return items;
}
