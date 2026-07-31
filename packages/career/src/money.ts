/**
 * money.ts - the career ledger: one writer, season accruals, and the
 * running total the epilogue reads. Money is a consequence surface, not
 * a minigame (docs/CAREER.md): NIL follows the program, pro deals follow
 * the contract, and every entry names its source.
 *
 * Streams: none. Accrual is arithmetic over committed state.
 */
import type { CareerState } from './types.js';

/** The single ledger writer: siblings append through here. */
export function recordEarning(career: CareerState, year: number, label: string, amount: number): void {
  career.ledger.push({ year, label, amount });
}

/** Sum of everything earned so far. */
export function careerEarnings(career: CareerState): number {
  return career.ledger.reduce((s, e) => s + e.amount, 0);
}

/**
 * Season-end accruals, called once at each career year wrap. Reads the
 * phase that just PLAYED (the wrap runs before phase transitions):
 * college accrues NIL from the committed offer; euro/nbl/china accrue
 * the deal's salary; the NBA accrues the contract's current season line.
 * High school accrues nothing (the shoebox stays empty; that is the
 * point of the climb). Events explain each entry through the ledger
 * label itself.
 */
export function accrueSeason(career: CareerState): void {
  const phase = career.clock.phase;
  const year = career.clock.year - 1; // the season that just ended
  const already = (label: string) => career.ledger.some(e => e.year === year && e.label === label);

  if (phase === 'college') {
    const offer = career.recruiting?.offers.find(o => o.id === career.recruiting?.committedTo);
    if (offer && offer.money > 0) {
      const program = career.recruiting?.programs.find(p => p.id === offer.programId);
      const label = `NIL: ${program?.name ?? 'the program'}`;
      if (!already(label)) recordEarning(career, year, label, offer.money);
    }
    return;
  }

  if (phase === 'euro' || phase === 'nbl' || phase === 'china') {
    const offer = career.recruiting?.offers.find(o => o.id === career.recruiting?.committedTo);
    const fallback = phase === 'china' ? career.params.money.chinaSalaryMean
      : phase === 'euro' ? career.params.recruiting.euroOfferMoney
        : career.params.recruiting.nblOfferMoney;
    const amount = offer?.kind !== 'college' && offer?.money ? offer.money : fallback;
    const club = offer?.clubName ?? (phase === 'china' ? 'the CBA club' : phase === 'euro' ? 'the Euro club' : 'the NBL club');
    const label = `${club}, season salary`;
    if (!already(label)) recordEarning(career, year, label, amount);
    return;
  }

  if (phase === 'nba') {
    const me = career.league.players[career.me];
    const c = me?.contract;
    if (c && c.years.length > 0) {
      const line = c.years.find(y => y.season === career.league.season) ?? c.years[0]!;
      const teamName = career.league.teams.find(t => t.id === career.nbaTeam)?.name ?? 'the team';
      const label = `${teamName}, contract year ${line.season}`;
      if (!already(label)) recordEarning(career, year, label, line.salary);
    }
  }
}
