/**
 * acceptance.ts - `npm run gm:acceptance`: the multi-season league-health
 * report (docs/FRANCHISE.md §12). Runs OUTSIDE the test glob on purpose:
 * a 20-season autosim is ~25k engine games. Two tiers of verdicts:
 *
 *   GATES  (exit 1 on failure): seasons complete; cap legality sampled
 *          weekly; no monotonic drift in league averages or ratings.
 *   BANDS  (reported PASS/MISS, never fatal): the researched realism
 *          envelopes. Misses are calibration work, not release blockers,
 *          and the register records them.
 *
 *   npm run gm:acceptance -- --seasons 5 --seed acc-1 --workers 3
 */
import {
  advanceDay, capSheet, createLeague, generatePersona, streamRng,
} from '@hoopsh/franchise';
import type { League } from '@hoopsh/franchise';
import { makeWorkerPool } from './runner.js';

function flag(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback;
}

const SEASONS = Number(flag('seasons', '5'));
const SEED = flag('seed', 'acceptance-1');
const WORKERS = Number(flag('workers', '3'));

interface SeasonReport {
  season: number;
  champion: string;
  championSeed: number;
  winsSd: number;
  topWins: number;
  bottomWins: number;
  ptsPerGame: number;
  pace: number;
  tpaPerGame: number;
  topScorerPpg: number;
  topScorerName: string;
  minutesLeader: number;
  meanAge: number;
  meanOverallProxy: number;
  taxTeams: number;
  capViolations: number;
  retirees: number;
  faUnsignedStars: number;
  homeWinPct: number;
  injuries: number;
}

/** Compact ability proxy for drift tracking (presentation-free). */
function abilityProxy(league: League, pid: string): number {
  const a = league.players[pid]!.attr;
  return (a.finishing + a.midRange + a.three + a.ballHandle + a.passVision
    + a.perimeterD + a.interiorD + a.defReb + a.decisions) / 9;
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

async function main(): Promise<void> {
  console.log(`gm:acceptance — ${SEASONS} seasons, seed ${SEED}, ${WORKERS} workers`);
  const started = Date.now();
  const league = createLeague({ seed: SEED, userTeam: 'nye' });
  // the "user" chair is AI-run for an autosim: every front office plays
  league.teams[league.userTeam]!.gm = generatePersona(streamRng(SEED, 'genesis', 'user-gm'));

  const pool = makeWorkerPool({ workers: WORKERS });
  const reports: SeasonReport[] = [];
  let capViolations = 0;
  let dayCount = 0;
  let taxTeamsAtClose = 0; // sampled when the regular season ends; reading at rollover is an artifact (contract years already shed)
  const gateFailures: string[] = [];

  const startSeason = league.season;
  while (league.season < startSeason + SEASONS) {
    const seasonAtTick = league.season;
    const digest = await advanceDay(league, pool);
    dayCount++;
    if (dayCount > SEASONS * 400 + 400) {
      gateFailures.push(`season ${league.season} never completed (day loop ran away after ${dayCount} days)`);
      break;
    }
    // weekly cap-legality sample (the hard invariant: §12 economy gate)
    if (dayCount % 7 === 0) {
      for (const teamId of Object.keys(league.teams)) {
        const sheet = capSheet(league, teamId);
        // legality here means arithmetic sanity: payroll accounted, no
        // negative salaries, dead money finite. Apron positions are legal
        // states; ILLEGAL is a broken sheet.
        if (!Number.isFinite(sheet.total) || sheet.total < 0) {
          capViolations++;
          gateFailures.push(`s${league.season} d${league.day}: ${teamId} cap sheet broke (${sheet.total})`);
        }
      }
    }
    if (digest.phaseChangedTo === 'playin') {
      taxTeamsAtClose = Object.keys(league.teams).filter(t => capSheet(league, t).overTax).length;
    }
    if (digest.seasonRolledTo !== undefined && seasonAtTick < digest.seasonRolledTo) {
      const archive = league.archives.find(a => a.season === seasonAtTick);
      if (!archive) {
        gateFailures.push(`season ${seasonAtTick} rolled without an archive`);
        continue;
      }
      // season report
      const standings = archive.finalStandings;
      const wins = standings.map(s => s.w);
      const seeds = new Map(standings.map((s, i) => [s.teamId, i + 1]));
      const rows: Array<{ pid: string; ppg: number; mpg: number; name: string }> = [];
      for (const pid of Object.keys(league.players)) {
        const p = league.players[pid]!;
        const row = p.seasons.find(r => r.season === seasonAtTick && r.type === 'regular');
        if (row && row.gp >= 50) rows.push({ pid, ppg: row.pts / row.gp, mpg: row.min / row.gp, name: p.name });
      }
      rows.sort((a, b) => b.ppg - a.ppg);
      const ages: number[] = [];
      const proxies: number[] = [];
      for (const pid of Object.keys(league.players)) {
        const p = league.players[pid]!;
        if (p.status !== 'roster' && p.status !== 'gleague') continue;
        ages.push(seasonAtTick - p.bornSeason);
        proxies.push(abilityProxy(league, pid));
      }
      const unsignedStars = league.freeAgents.filter(pid => abilityProxy(league, pid) >= 62).length;
      let homeW = 0, homeG = 0;
      for (const st of standings) { homeW += st.homeW; homeG += st.homeW + st.homeL; }
      const seasonInjuries = Object.values(league.players)
        .flatMap(pl => pl.health.history)
        .filter(inj => inj.startedOn.season === seasonAtTick).length;
      reports.push({
        season: seasonAtTick,
        champion: archive.champion,
        championSeed: seeds.get(archive.champion) ?? 0,
        winsSd: sd(wins),
        topWins: Math.max(...wins),
        bottomWins: Math.min(...wins),
        ptsPerGame: archive.leagueAverages.pts ?? 0,
        pace: archive.leagueAverages.pace ?? 0,
        tpaPerGame: archive.leagueAverages.tpa ?? 0,
        topScorerPpg: rows[0]?.ppg ?? 0,
        topScorerName: rows[0]?.name ?? '-',
        minutesLeader: Math.max(0, ...rows.map(r => r.mpg)),
        meanAge: mean(ages),
        meanOverallProxy: mean(proxies),
        taxTeams: taxTeamsAtClose,
        capViolations,
        retirees: league.transactions.filter(tx => tx.kind === 'retirement' && tx.date.season === seasonAtTick).length,
        faUnsignedStars: unsignedStars,
        homeWinPct: homeG > 0 ? homeW / homeG : 0,
        injuries: seasonInjuries,
      });
      console.log(`season ${seasonAtTick} complete: ${archive.champion} (seed ${seeds.get(archive.champion)}) · ` +
        `top scorer ${rows[0]?.name ?? '-'} ${rows[0] ? rows[0].ppg.toFixed(1) : '-'} · wins sd ${sd(wins).toFixed(1)}`);
    }
  }

  // ---------- verdicts ----------
  console.log('\n================ the report ================');
  const bands: Array<{ name: string; check: (r: SeasonReport) => boolean; value: (r: SeasonReport) => number; note: string }> = [
    { name: 'league scoring 105-125/g', check: r => r.ptsPerGame >= 105 && r.ptsPerGame <= 125, value: r => r.ptsPerGame, note: 'research 05 A' },
    { name: 'pace 94-104', check: r => r.pace >= 94 && r.pace <= 104, value: r => r.pace, note: 'research 05 A' },
    { name: '3PA 30-42/g', check: r => r.tpaPerGame >= 30 && r.tpaPerGame <= 42, value: r => r.tpaPerGame, note: 'research 05 A' },
    { name: 'top scorer 26-37 ppg', check: r => r.topScorerPpg >= 26 && r.topScorerPpg <= 37, value: r => r.topScorerPpg, note: 'research 05 C leaderboards' },
    { name: 'minutes leader 33-38.5', check: r => r.minutesLeader >= 33 && r.minutesLeader <= 38.5, value: r => r.minutesLeader, note: 'the first thing stat heads check' },
    { name: 'wins sd 9-16', check: r => r.winsSd >= 9 && r.winsSd <= 16, value: r => r.winsSd, note: 'real ~12.9' },
    { name: 'best team 55-73 wins', check: r => r.topWins >= 55 && r.topWins <= 73, value: r => r.topWins, note: 'a 60-win team most years' },
    { name: 'worst team 9-28 wins', check: r => r.bottomWins >= 9 && r.bottomWins <= 28, value: r => r.bottomWins, note: 'bad, not 5-77' },
    { name: 'mean age 24.5-28', check: r => r.meanAge >= 24.5 && r.meanAge <= 28, value: r => r.meanAge, note: 'league ~26.4' },
    { name: 'home court 52-62%', check: r => r.homeWinPct >= 0.52 && r.homeWinPct <= 0.62, value: r => Math.round(r.homeWinPct * 1000) / 10, note: 'real ~55-60; params.hca is the dial' },
    { name: 'tax teams 2-12', check: r => r.taxTeams >= 2 && r.taxTeams <= 12, value: r => r.taxTeams, note: 'economy alive at both ends' },
    { name: 'no unsigned-star pileup', check: r => r.faUnsignedStars <= 6, value: r => r.faUnsignedStars, note: 'September market clears' },
  ];
  for (const band of bands) {
    const misses = reports.filter(r => !band.check(r));
    const values = reports.map(r => `${r.season}: ${(Math.round(band.value(r) * 10) / 10)}`).join('  ');
    console.log(`${misses.length === 0 ? 'PASS' : 'MISS'}  ${band.name}  (${band.note})  [${values}]`);
  }
  const inj = reports.map(r => `${r.season}: ${r.injuries}`).join('  ');
  console.log(`INFO  injuries per season [${inj}] (real: most players nicked at least once; majors rare)`);
  // champion seed distribution across the run (needs several seasons to mean much)
  const oneSeedTitles = reports.filter(r => r.championSeed === 1).length;
  console.log(`INFO  one-seed champions: ${oneSeedTitles}/${reports.length} (real long-run ~2/3; small n is noisy)`);

  // drift gates: monotonic movement across seasons is the failure mode
  if (reports.length >= 3) {
    const first = reports[0]!, last = reports[reports.length - 1]!;
    if (Math.abs(last.meanOverallProxy - first.meanOverallProxy) > 4) {
      gateFailures.push(`rating drift: ability proxy moved ${first.meanOverallProxy.toFixed(1)} -> ${last.meanOverallProxy.toFixed(1)}`);
    }
    if (Math.abs(last.ptsPerGame - first.ptsPerGame) > 10) {
      gateFailures.push(`scoring drift: ${first.ptsPerGame.toFixed(1)} -> ${last.ptsPerGame.toFixed(1)} per game`);
    }
    if (Math.abs(last.meanAge - first.meanAge) > 1.6) {
      gateFailures.push(`age drift: ${first.meanAge.toFixed(1)} -> ${last.meanAge.toFixed(1)}`);
    }
  }
  if (reports.length < SEASONS) gateFailures.push(`only ${reports.length}/${SEASONS} seasons completed`);

  console.log('\n================ gates ================');
  if (gateFailures.length === 0) {
    console.log(`PASS  all gates (${reports.length} seasons, ${dayCount} days, ${((Date.now() - started) / 60000).toFixed(1)} min)`);
  } else {
    for (const g of gateFailures) console.log(`FAIL  ${g}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('acceptance run crashed:', err);
  process.exit(1);
});
