/**
 * phone-detect.ts - read-only state detectors for the phone: the summit
 * beats (commitment, draft night, the title final, the NBA debut) and the
 * promise ledger's derived context. No new CareerState fields anywhere;
 * everything is recomputed from state that already happened. Part of the
 * phone surface; see phone.ts for the discipline rules and module map.
 */
import type { FrPlayer, GameLine, GameRecord, TeamId } from '@hoopsh/franchise';
import {
  MENTOR_MIN_AGE, ROLE_ORDER, fmtScore, meOf, nbaTeamNameOf, recordIsThisWeek,
  rungIdx, weekRecords,
} from './phone-shared.js';
import type {
  CareerState, CircuitKind, PhoneMessage, Program, RoleId, RouteOffer,
} from './types.js';

// ---------------------------------------------------------------------------
// state detectors for the summit beats (read-only; no new CareerState fields)

/** My draftSelection off the league's real ledger, if the night has happened. */
export function draftTxOf(career: CareerState, playerId: string): { teamId: TeamId; round: number; pick: number } | null {
  for (const tx of career.league.transactions) {
    if (tx.kind === 'draftSelection' && tx.playerId === playerId) {
      return { teamId: tx.teamId, round: tx.round, pick: tx.pick };
    }
  }
  return null;
}

/** The offer the career signed (recruiting.committedTo), if any. */
export function committedOffer(career: CareerState): RouteOffer | null {
  const rec = career.recruiting;
  if (!rec?.committedTo) return null;
  return rec.offers.find(o => o.id === rec.committedTo) ?? null;
}

/** Display name of an offer's destination (program or club). */
export function destOf(career: CareerState, offer: RouteOffer): string {
  if (offer.kind !== 'college') return offer.clubName ?? 'the club';
  return career.recruiting?.programs.find(p => p.id === offer.programId)?.name ?? 'the program';
}

/**
 * The losing finalist of the recruitment: the non-committed program that
 * climbed highest (rung, then perceived, then id for the tie). Only
 * programs that reached the living room count as finalists; a letter is
 * not a courtship.
 */
export function losingFinalist(career: CareerState, committedProgramId: string | undefined): { program: Program; interestIdx: number } | null {
  const rec = career.recruiting;
  if (!rec) return null;
  let best: { program: Program; interestIdx: number; rung: number; perceived: number } | null = null;
  for (let i = 0; i < rec.interest.length; i++) {
    const interest = rec.interest[i]!;
    if (committedProgramId !== undefined && interest.programId === committedProgramId) continue;
    const r = rungIdx(interest.rung);
    if (r < rungIdx('visit')) continue;
    const program = rec.programs.find(p => p.id === interest.programId);
    if (!program) continue;
    const wins = !best
      || r > best.rung
      || (r === best.rung && interest.perceived > best.perceived)
      || (r === best.rung && interest.perceived === best.perceived && program.id < best.program.id);
    if (wins) best = { program, interestIdx: i, rung: r, perceived: interest.perceived };
  }
  return best ? { program: best.program, interestIdx: best.interestIdx } : null;
}

/** Kind-appropriate title vocabulary, mirroring circuits.ts finish strings. */
export function titleWords(kind: CircuitKind): { champion: string; theFinal: string } {
  if (kind === 'hs') return { champion: 'state champion', theFinal: 'the state final' };
  if (kind === 'college') return { champion: 'national champion', theFinal: 'the national final' };
  return { champion: 'league champion', theFinal: 'the final' };
}

interface TitleOutcome {
  record: GameRecord;
  champion: boolean;
  score: string;
  kind: CircuitKind;
}

/** The championship final, if my team played it this week (win or lose). */
export function titleGameThisWeek(career: CareerState): TitleOutcome | null {
  const circuit = career.circuit;
  if (!circuit) return null;
  const myTeamId = circuit.teams[circuit.myTeamIdx]?.id;
  if (!myTeamId) return null;
  for (const g of circuit.bracket) {
    if (g.type !== 'bracket' || g.round !== 'F') continue;
    const record = circuit.results[g.id];
    if (!record || !recordIsThisWeek(career, record)) continue;
    if (record.home !== myTeamId && record.away !== myTeamId) continue;
    const champion = record.home === myTeamId
      ? record.final[0] > record.final[1]
      : record.final[1] > record.final[0];
    return { record, champion, score: fmtScore(record.final), kind: circuit.kind };
  }
  return null;
}

/**
 * The bracket-seed week: the postseason exists and none of it has been
 * played (rounds seed one at a time, so this is true exactly once per
 * bracket phase; the year tag keeps it once per season). Returns my
 * opening opponent and my table record for the copy.
 */
export function bracketSetThisWeek(career: CareerState): { opp: string; w: number; l: number } | null {
  const circuit = career.circuit;
  if (!circuit || circuit.complete || circuit.bracket.length === 0) return null;
  if (circuit.bracket.some(g => circuit.results[g.id])) return null;
  const mine = circuit.bracket.find(g =>
    g.homeIdx === circuit.myTeamIdx || g.awayIdx === circuit.myTeamIdx);
  if (!mine) return null;
  const oppIdx = mine.homeIdx === circuit.myTeamIdx ? mine.awayIdx : mine.homeIdx;
  const opp = circuit.teams[oppIdx]?.name ?? 'the other side';
  const table = circuit.standings.find(s => s.teamIdx === circuit.myTeamIdx);
  return { opp, w: table?.w ?? 0, l: table?.l ?? 0 };
}

/** Total NBA regular-season games on my sheet (rows whose team is a league team). */
function myNbaGamesTotal(career: CareerState): number {
  const me = meOf(career);
  let gp = 0;
  for (const row of me.seasons) {
    if (row.type === 'regular' && career.league.teams[row.teamId]) gp += row.gp;
  }
  return gp;
}

/** The debut week: my first NBA regular-season minutes happened inside this week's window. */
export function debutThisWeek(career: CareerState): { record: GameRecord; line: GameLine } | null {
  if (career.clock.phase !== 'nba') return null;
  const played = weekRecords(career).filter(r =>
    r.record.type === 'regular' && r.myLine && r.myLine.min > 0);
  if (played.length === 0) return null;
  if (myNbaGamesTotal(career) !== played.length) return null;
  const first = played[0]!;
  return { record: first.record, line: first.myLine! };
}

/** The oldest teammate past MENTOR_MIN_AGE on my NBA roster; the mentor voice. */
export function mentorOf(career: CareerState): FrPlayer | null {
  if (career.clock.phase !== 'nba' || !career.nbaTeam) return null;
  const team = career.league.teams[career.nbaTeam];
  if (!team) return null;
  let best: FrPlayer | null = null;
  for (const pid of team.roster) {
    if (pid === career.me) continue;
    const p = career.league.players[pid];
    if (!p) continue;
    if (career.league.season - p.bornSeason < MENTOR_MIN_AGE) continue;
    if (!best || p.bornSeason < best.bornSeason
      || (p.bornSeason === best.bornSeason && p.id < best.id)) best = p;
  }
  return best;
}

// ---------------------------------------------------------------------------
// the promise ledger (docs/CAREER.md: "a team that promised the starting job
// and buried you owes you a grievance the phone will conduct")

interface PromiseContext {
  /** stable dedupe key for the once-per-stint grievance and satisfied beats */
  key: string;
  promised: RoleId;
  dest: string;
  /** graded games under this promise (see the per-phase derivations below) */
  games: number;
  refs: PhoneMessage['refs'];
}

/**
 * The grace period before a grievance, read from career.params where the
 * frozen shape put it (params.nbabridge.promiseGraceGames, FEEL 20). The
 * trust section is checked first because the params task may migrate the
 * lever there this wave; this module never redefines the number.
 */
export function promiseGraceGames(career: CareerState): number {
  const trustSide = (career.params.trust as { promiseGraceGames?: number }).promiseGraceGames;
  return trustSide ?? career.params.nbabridge.promiseGraceGames;
}

/** My played games in the active circuit (min > 0 lines in its results). */
function myPlayedGamesInCircuit(career: CareerState): number {
  const c = career.circuit;
  if (!c) return 0;
  let n = 0;
  for (const record of Object.values(c.results)) {
    const line = record.lines.find(l => l.playerId === career.me);
    if (line && line.min > 0) n += 1;
  }
  return n;
}

/**
 * The live role promise, derived entirely from existing state:
 * - college/euro/nbl: the committed offer's promisedRole. The games
 *   counter is my played games in that circuit kind (archived seasons'
 *   gp plus the live circuit), which works because the design has no
 *   transfers: every game of that kind was played under that promise.
 * - nba: the promisedRole parsed from the most recent signing event
 *   (nbabridge writes 'signed: <team>, ... (<role> role promised)'),
 *   valid only while that event names my CURRENT team (a draft or a
 *   trade voids the paper promise: nobody promised the drafted rookie
 *   anything). The games counter is coach.grades.length: the NBA coach
 *   ledger resets on every locker-room change, so its length IS my
 *   graded games under this staff, DNPs included (being nailed to the
 *   bench is exactly the buried case the grievance exists for).
 */
export function promiseContext(career: CareerState): PromiseContext | null {
  const phase = career.clock.phase;
  if (phase === 'college' || phase === 'euro' || phase === 'nbl') {
    const offer = committedOffer(career);
    if (!offer || offer.kind !== phase) return null;
    let games = 0;
    for (const s of career.circuitHistory) {
      if (s.kind === phase) games += s.myLine.gp;
    }
    if (career.circuit?.kind === phase) games += myPlayedGamesInCircuit(career);
    const refs: PhoneMessage['refs'] = offer.programId ? { programId: offer.programId } : {};
    return { key: offer.id, promised: offer.promisedRole, dest: destOf(career, offer), games, refs };
  }
  if (phase === 'nba' && career.nbaTeam) {
    const tname = nbaTeamNameOf(career, career.nbaTeam);
    for (let i = career.events.length - 1; i >= 0; i--) {
      const e = career.events[i]!;
      if (e.kind !== 'contract' || !e.reason.startsWith('signed: ')) continue;
      if (!e.reason.includes(tname)) return null; // last signing was elsewhere: no live promise here
      const m = / \((\w+) role promised\)/.exec(e.reason);
      if (!m) return null;
      const promised = m[1] as RoleId;
      if (!ROLE_ORDER.includes(promised)) return null;
      return {
        key: `nba-${career.nbaTeam}`,
        promised,
        dest: tname,
        games: career.coach.grades.length,
        refs: { teamId: career.nbaTeam },
      };
    }
    return null;
  }
  return null;
}
