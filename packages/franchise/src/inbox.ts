/**
 * inbox.ts - the GM desk: inbox item generation. OWNER: spine task (#152).
 *
 * FRANCHISE.md section 8 names this step of the day: after the news desk
 * writes, "the inbox surfaces what needs the user (a rotation hole, an
 * offer sheet clock, a scout report, an owner note)". Before this module
 * that step was silent: a full GM season produced zero items and the
 * trade deadline passed inside multi-week advances with nothing but a
 * post-hoc verdict string (#152). The app's advance loop stops on new
 * inbox items and on open decisions; these items are the stop conditions.
 *
 * Three laws, in order:
 * - READ-ONLY. Items derive from state other subsystems already computed:
 *   calendar marks, rosters, contracts, offer sheets, injuries, the
 *   transaction log, trade-desk valuations. Nothing here mutates league
 *   state, executes a decision, or re-derives game logic (AGENTS.md 2.3).
 * - NO RANDOMNESS. Items are a pure function of league state. No rng
 *   stream is registered for this module and none may be added casually:
 *   a draw here would reshuffle sibling streams and move the acceptance
 *   baseline for a cosmetic reason.
 * - HUMAN CHAIR ONLY. A persona-run user seat (autosims, career worlds,
 *   gm:acceptance) decides through the AI paths and needs no inbox.
 *   Generation gates on gm === null, the same seam processDraft and
 *   aiTradePulse use. Acceptance output is byte-identical with this
 *   module dark or lit, by construction; keep it that way.
 *
 * Cadence discipline (FRANCHISE.md section 2 anti-patterns: "morale
 * micromanagement, noise"): seasonal rituals produce one item per season
 * (deterministic per-season ids; tick.ts pushInbox dedupes on id), events
 * produce one item per event. Decision items carry a deadline and the
 * spine's morning sweep (expireInboxDeadlines) retires them once the date
 * passes: an ignored decision must never wedge the advance loop past its
 * real-world expiry. Dead time is this mode's worst failure; the second
 * worst is spam. Every generator filters for relevance to the user's
 * team, its posture, or its watched players before it speaks.
 */
import type { InboxItem, League, LeagueDate, PlayerId, TeamId } from './types.js';
import { currentDate, optionDecisionDay } from './calendar.js';
import { capSheet } from './cba/cap.js';
import { signingSeason } from './cba/contracts.js';
import {
  DEADLINE_WINDOW_DAYS, inDeadlineWindow, pickSellerTarget, tradeDeadlineDay,
} from './ai/trade.js';
import { playerValue } from './ai/valuation.js';

/** LeagueDate strict less-than, (season, day) lexicographic. */
function dateLt(a: LeagueDate, b: LeagueDate): boolean {
  return a.season < b.season || (a.season === b.season && a.day < b.day);
}

/** '$12.4M' from integer dollars, for item bodies. */
function money(x: number): string {
  return `$${(x / 1e6).toFixed(1)}M`;
}

/** True when the contract's last season is the current one (a rental in trade terms). */
function expiringThisSeason(league: League, pid: PlayerId): boolean {
  const c = league.players[pid]?.contract;
  if (!c) return false;
  return c.years.filter((y) => y.season >= league.season).length <= 1;
}

/** 'Name (31)' display for item bodies. */
function nameAge(league: League, pid: PlayerId): string {
  const p = league.players[pid]!;
  return `${p.name} (${league.season - p.bornSeason})`;
}

/** Already on the record: per-season ids make rituals fire once. */
function alreadyPosted(league: League, id: string): boolean {
  return league.inbox.some((i) => i.id === id);
}

/**
 * Retire unresolved items whose deadline strictly passed. Wires the
 * previously unconsumed InboxItem.deadline field: deadline means "the
 * last day the decision can still be acted on". Called by the spine every
 * morning (tick.ts); mutates only item.resolved flags. Runs for every
 * chair (state hygiene, a no-op while no deadlined items exist).
 */
export function expireInboxDeadlines(league: League): void {
  const today = currentDate(league);
  for (const item of league.inbox) {
    if (item.resolved || !item.deadline) continue;
    if (dateLt(item.deadline, today)) item.resolved = true;
  }
}

// ------------------------------------------------------------- generators

/** Deadline season opens: one notice with the user's expiring books. */
function deadlineWindowBrief(league: League, items: InboxItem[]): void {
  if (!inDeadlineWindow(league)) return;
  if (league.day === tradeDeadlineDay(league)) return; // the day itself gets the louder item
  const id = `deadline-window-s${league.season}`;
  if (alreadyPosted(league, id)) return;
  const team = league.teams[league.userTeam]!;
  const daysOut = tradeDeadlineDay(league) - league.day;
  const expiring = team.roster.filter((pid) => expiringThisSeason(league, pid));
  const lines = [`The trade deadline is ${daysOut} day${daysOut === 1 ? '' : 's'} out.`];
  if (expiring.length > 0) {
    lines.push(`Expiring money on your books: ${expiring.map((pid) => nameAge(league, pid)).join(', ')}. Rentals walk for nothing in July.`);
  }
  lines.push(`Your stated posture: ${team.strategy.timeline}.`);
  items.push({
    id, date: currentDate(league), kind: 'notice',
    title: 'Deadline season opens', body: lines.join(' '), resolved: false,
  });
}

/** The AI seller rental the USER's board prices highest (buy side). */
function bestBuyTarget(league: League): { playerId: PlayerId; seller: TeamId } | null {
  let best: { playerId: PlayerId; seller: TeamId; value: number } | null = null;
  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;
    if (!team.gm || tid === league.userTeam) continue;
    if (team.strategy.timeline === 'contend') continue; // contenders are not selling
    const target = pickSellerTarget(league, league.userTeam, tid);
    if (!target) continue;
    const value = playerValue(league, league.userTeam, target);
    if (!best || value > best.value || (value === best.value && target < best.playerId)) {
      best = { playerId: target, seller: tid, value };
    }
  }
  return best ? { playerId: best.playerId, seller: best.seller } : null;
}

/** The user rental an AI contender's board prices highest (sell side). */
function bestSellCandidate(league: League): { playerId: PlayerId; buyer: TeamId } | null {
  let best: { playerId: PlayerId; buyer: TeamId; value: number } | null = null;
  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;
    if (!team.gm || tid === league.userTeam) continue;
    if (team.strategy.timeline !== 'contend') continue; // buyers chase rentals
    const target = pickSellerTarget(league, tid, league.userTeam);
    if (!target) continue;
    const value = playerValue(league, tid, target);
    if (!best || value > best.value || (value === best.value && target < best.playerId)) {
      best = { playerId: target, buyer: tid, value };
    }
  }
  return best ? { playerId: best.playerId, buyer: best.buyer } : null;
}

/**
 * Deadline day: the one decision item of the season's loudest week. The
 * body is posture-aware simulated truth: the same pickSellerTarget and
 * playerValue reads the pulse itself trades on, never invented flavor.
 * Expires at close of business (the morning sweep), so ignoring it costs
 * exactly one stop.
 */
function deadlineDayCall(league: League, items: InboxItem[]): void {
  if (league.phase !== 'regular' || league.day !== tradeDeadlineDay(league)) return;
  const id = `deadline-day-s${league.season}`;
  if (alreadyPosted(league, id)) return;
  const timeline = league.teams[league.userTeam]!.strategy.timeline;
  const lines = ['The trade deadline is today. The wire freezes at close of business.'];
  if (timeline !== 'rebuild') {
    const buy = bestBuyTarget(league);
    if (buy) {
      lines.push(`Available: ${nameAge(league, buy.playerId)} in ${league.teams[buy.seller]!.city} tops your board among sellers' movable vets.`);
    }
  }
  if (timeline !== 'contend') {
    const sell = bestSellCandidate(league);
    if (sell) {
      lines.push(`Shoppable: ${nameAge(league, sell.playerId)} is your most marketable rental; ${league.teams[sell.buyer]!.city} values him most.`);
    }
  }
  const open = league.negotiations.filter((n) => n.teams.includes(league.userTeam)).length;
  if (open > 0) lines.push(`${open} negotiation${open === 1 ? '' : 's'} on file at the trade desk.`);
  items.push({
    id, date: currentDate(league), kind: 'decision',
    title: 'Deadline day', body: lines.join(' '),
    choices: [
      { id: 'trade-desk', label: 'Work the phones at the trade desk' },
      { id: 'stand-pat', label: 'Stand pat' },
    ],
    deadline: { season: league.season, day: league.day },
    resolved: false,
  });
}

/**
 * Morning-after wrap, only when deadline-season deals touched the user's
 * world: scouted players, negotiation partners' subjects, or division
 * rivals. A quiet deadline is the news desk's story, not a stop.
 */
function deadlineWrap(league: League, items: InboxItem[]): void {
  if (league.phase !== 'regular' || league.day !== tradeDeadlineDay(league) + 1) return;
  const id = `deadline-wrap-s${league.season}`;
  if (alreadyPosted(league, id)) return;
  const user = league.userTeam;
  const division = league.teams[user]!.division;
  const watched = new Set<PlayerId>();
  for (const pid of Object.keys(league.scouting)) {
    if (league.scouting[pid]!.coverage > 0) watched.add(pid);
  }
  for (const n of league.negotiations) {
    if (n.teams.includes(user)) for (const pid of n.about) watched.add(pid);
  }
  const windowStart = tradeDeadlineDay(league) - DEADLINE_WINDOW_DAYS;
  const windowTrades = league.transactions.filter((tx) => tx.kind === 'trade'
    && tx.date.season === league.season
    && tx.date.day >= windowStart && tx.date.day <= tradeDeadlineDay(league));
  const relevant: string[] = [];
  for (const tx of windowTrades) {
    if (tx.kind !== 'trade') continue;
    const rival = tx.teams.some((t) => t !== user && league.teams[t]?.division === division);
    const onRadar = tx.players.find((m) => watched.has(m.playerId));
    if (!rival && !onRadar) continue;
    const headliner = onRadar ?? tx.players[0];
    if (headliner) {
      relevant.push(`${league.players[headliner.playerId]?.name ?? headliner.playerId} to ${league.teams[headliner.to]?.city ?? headliner.to}`);
    }
  }
  if (relevant.length === 0) return;
  items.push({
    id, date: currentDate(league), kind: 'notice',
    title: 'Deadline wrap',
    body: `${windowTrades.length} deal${windowTrades.length === 1 ? '' : 's'} cleared in deadline season. On your radar: ${relevant.slice(0, 3).join('; ')}.`,
    resolved: false,
  });
}

/**
 * The offer sheet clock (FRANCHISE.md section 8's canonical example): an
 * outside sheet landed on a restricted free agent whose rights the user
 * holds. Open through the match window; resolveOfferSheet (tick.ts) marks
 * it resolved on any resolution path, and silence declines by inaction.
 */
function offerSheetClocks(league: League, items: InboxItem[]): void {
  for (const sheet of league.offerSheets) {
    const player = league.players[sheet.playerId];
    if (!player || player.rights?.teamId !== league.userTeam) continue;
    const id = `sheet-clock-s${league.season}-${sheet.playerId}`;
    if (alreadyPosted(league, id)) continue;
    const year1 = sheet.contract.years[0]?.salary ?? 0;
    const closes = league.calendar[sheet.decideBy.day]?.label ?? `day ${sheet.decideBy.day}`;
    items.push({
      id, date: currentDate(league), kind: 'decision',
      title: `Offer sheet on ${player.name}`,
      body: `${league.teams[sheet.from]!.city} signed ${player.name} to a ${sheet.contract.years.length}-year offer sheet starting at ${money(year1)}. `
        + `Match it and the deal is yours at the same terms; pass and he walks. The window closes ${closes}. Silence declines.`,
      choices: [{ id: 'fa-desk', label: 'Decide at the free-agency desk' }],
      deadline: sheet.decideBy,
      resolved: false,
    });
  }
}

/**
 * Sheet resolutions the user was not in the room for: the outcome of the
 * user's own outgoing sheet (the incumbent decided), and a match window
 * on a user-rights player that lapsed to a decline by inaction.
 */
function offerSheetResults(league: League, items: InboxItem[]): void {
  const today = currentDate(league);
  for (const tx of league.transactions) {
    if (tx.kind !== 'matchDecision') continue;
    if (tx.date.season !== today.season || tx.date.day !== today.day) continue;
    const pid = tx.playerId;
    const name = league.players[pid]?.name ?? pid;
    const id = `sheet-result-s${today.season}d${today.day}-${pid}`;
    if (alreadyPosted(league, id)) continue;
    const userFiled = league.actionLog.some((a) => a.action.kind === 'offerSheet'
      && a.action.playerId === pid && a.date.season === today.season);
    if (userFiled && tx.teamId !== league.userTeam) {
      items.push({
        id, date: today, kind: 'notice',
        title: `Sheet on ${name}: ${tx.matched ? 'matched' : 'unmatched'}`,
        body: tx.matched
          ? `${league.teams[tx.teamId]?.city ?? tx.teamId} matched your offer sheet. ${name} stays put.`
          : `${league.teams[tx.teamId]?.city ?? tx.teamId} declined to match. ${name} is yours at the sheet terms.`,
        resolved: false,
      });
    } else if (tx.teamId === league.userTeam && !tx.matched) {
      const acted = league.actionLog.some((a) => a.action.kind === 'matchOfferSheet'
        && a.action.playerId === pid && a.date.season === today.season);
      if (acted) continue; // the user decided by hand and knows
      const signing = league.transactions.find((t) => t.kind === 'signing'
        && t.playerId === pid && t.date.season === today.season && t.date.day === today.day);
      const to = signing && signing.kind === 'signing' ? league.teams[signing.teamId]?.city ?? signing.teamId : 'the offering team';
      items.push({
        id, date: today, kind: 'notice',
        title: `${name} signed away`,
        body: `The match window on ${name} lapsed. He signs with ${to}.`,
        resolved: false,
      });
    }
  }
}

/**
 * Option day: the league's option and tender decisions land today (the
 * same day runAiOffseasonDecisions runs for AI teams). One notice listing
 * the user's pending option years and tender calls; acting is optional,
 * the documented defaults apply to silence.
 */
function optionsDue(league: League, items: InboxItem[]): void {
  if (league.day !== optionDecisionDay(league.calendar, league.params)) return;
  const id = `options-due-s${league.season}`;
  if (alreadyPosted(league, id)) return;
  const team = league.teams[league.userTeam]!;
  const target = signingSeason(league);
  const options: string[] = [];
  for (const pid of [...team.roster, ...team.twoWay]) {
    const c = league.players[pid]?.contract;
    const year = c?.years.find((y) => y.season === target && (y.teamOption === true || y.playerOption === true));
    if (!year) continue;
    options.push(`${league.players[pid]!.name} (${year.teamOption === true ? 'team' : 'player'} option, ${money(year.salary)})`);
  }
  const tenders: string[] = [];
  for (const pid of [...league.freeAgents].sort()) {
    const p = league.players[pid];
    if (p?.status === 'freeAgent' && p.rights?.restricted && p.rights.teamId === league.userTeam) tenders.push(p.name);
  }
  if (options.length === 0 && tenders.length === 0) return;
  const lines = ['Option and tender decisions land across the league today.'];
  if (options.length > 0) lines.push(`On your books: ${options.join(', ')}. Undecided options ride as exercised at the rollover.`);
  if (tenders.length > 0) lines.push(`Qualifying offers out to: ${tenders.join(', ')}. Your tenders stand unless you renounce the rights.`);
  items.push({ id, date: currentDate(league), kind: 'notice', title: 'Option day', body: lines.join(' '), resolved: false });
}

/** Free agency opens: the user's own market exposure and cap position, once. */
function faOpening(league: League, items: InboxItem[]): void {
  const morEnd = league.calendar.findIndex((d) => (d.marks as string[]).includes('moratoriumEnds'));
  if (morEnd < 0 || league.day !== morEnd + 1) return;
  const id = `fa-open-s${league.season}`;
  if (alreadyPosted(league, id)) return;
  const own: string[] = [];
  for (const pid of [...league.freeAgents].sort()) {
    const p = league.players[pid];
    if (p?.status !== 'freeAgent' || p.rights?.teamId !== league.userTeam) continue;
    own.push(`${p.name}${p.rights.restricted ? ' (RFA)' : ''}`);
  }
  const sheet = capSheet(league, league.userTeam);
  const cap = league.capLines[signingSeason(league)]?.cap ?? league.capLines[league.season]?.cap ?? 0;
  const lines = ['Free agency is open. Signings are legal as of this morning.'];
  if (own.length > 0) lines.push(`Your own free agents: ${own.join(', ')}. Rights held until signed or renounced.`);
  if (cap > 0) lines.push(`Payroll ${money(sheet.total)} against a ${money(cap)} cap.`);
  items.push({ id, date: currentDate(league), kind: 'notice', title: 'Free agency opens', body: lines.join(' '), resolved: false });
}

/**
 * Rotation holes: a user player went down today for more than a nick.
 * Severity above minor means a week-plus absence by the injury tables;
 * day-to-day knocks are noise the desk stays quiet about.
 */
function injuryEscalations(league: League, items: InboxItem[]): void {
  const team = league.teams[league.userTeam]!;
  const today = currentDate(league);
  for (const pid of [...team.roster, ...team.twoWay]) {
    const p = league.players[pid];
    const injury = p?.health.injury;
    if (!p || !injury || injury.severity === 'minor') continue;
    if (injury.startedOn.season !== today.season || injury.startedOn.day !== today.day) continue;
    const id = `injury-s${today.season}d${today.day}-${pid}`;
    if (alreadyPosted(league, id)) continue;
    const starter = team.rotation.starters.includes(pid);
    items.push({
      id, date: today, kind: 'notice',
      title: `${p.name} out about ${injury.outDays} days`,
      body: `${p.name} suffered a ${injury.label} (${injury.severity}). The training staff calls it roughly ${injury.outDays} days.`
        + (starter ? ' He starts: the rotation needs an answer.' : ''),
      resolved: false,
    });
  }
}

/**
 * Generate today's GM-desk items. Pure derivation from league state: no
 * rng, no mutation (the spine appends what this returns through its
 * pushInbox id guard). Returns [] for any league whose user seat is not a
 * human chair, which keeps autosims, career worlds, and gm:acceptance
 * byte-identical with the desk dark. Called once per day from advanceDay
 * at the documented inbox position (after the news desk, FRANCHISE.md
 * section 8).
 */
export function generateGmInbox(league: League): InboxItem[] {
  if (league.teams[league.userTeam]?.gm !== null) return [];
  const items: InboxItem[] = [];
  deadlineWindowBrief(league, items);
  deadlineDayCall(league, items);
  deadlineWrap(league, items);
  offerSheetClocks(league, items);
  offerSheetResults(league, items);
  optionsDue(league, items);
  faOpening(league, items);
  injuryEscalations(league, items);
  return items;
}
