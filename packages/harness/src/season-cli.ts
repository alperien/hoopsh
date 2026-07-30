/**
 * Season / matchup CLI:
 *
 *   npm run season -- [--teams 6] [--rounds 2] [--games N] [--seed base] [--json]
 *   npm run season -- --matchup 0,3 [--sims 100] [--mirror] [--teams 6] [--seed base] [--json]
 *
 * SEASON MODE (default): generates a deterministic league of --teams teams
 * (league.ts), schedules a --rounds round-robin (default double), simulates
 * every game, and prints per-game scores' summary plus a standings table.
 * --games caps the schedule (or extends it by tiling more round-robin
 * cycles when larger than one).
 *
 * MATCHUP MODE (--matchup A,B): Monte-Carlo the A-vs-B fixture --sims times
 * (A at home) and print the distribution report — win probability with a
 * Wilson 95% CI, margin stats/histogram, and per-player stat lines.
 *
 * --json switches either mode to a single machine-readable JSON document on
 * stdout with NO timing/progress noise — byte-identical across runs with
 * the same flags, which is exactly how to PROVE determinism:
 *
 *   npm run season -- --teams 4 --seed proof --json | sha256sum
 *   (run twice; the hashes match)
 *
 * COMPUTE BUDGET: one game is ~250-400ms on this class of box. A 6-team
 * double round-robin (30 games) is ~10s; a 30-team NBA-sized 1230-game
 * season is ~6-8 MINUTES single-process — run that deliberately, not
 * casually. Parallel execution arrives via the wave1/runner worker pool
 * behind season.ts's SimulateGames seam, not here.
 */

import { checkFlags, flagNumber, flagValue } from './args.js';
import { makeLeague } from './league.js';
import { roundRobin, runSeason, type SeasonResult, type TeamStanding } from './season.js';
import { formatMatchup, simulateMatchup, simsToResolveEdge } from './matchup.js';
import type { Team } from '@hoopsh/engine';

const argv = process.argv;
// declared vocabulary — a typo'd or `=`-spelled flag dies here instead of
// silently simulating a default season (args.ts checkFlags, audit H-03)
checkFlags(argv, ['--teams', '--rounds', '--seed', '--json', '--matchup', '--sims', '--mirror', '--games']);
const nTeams = flagNumber(argv, '--teams', 6);
const rounds = flagNumber(argv, '--rounds', 2);
const seed = flagValue(argv, '--seed', 'season-2026');
const json = argv.includes('--json');
const matchupSpec = flagValue(argv, '--matchup', '');

if (!Number.isInteger(nTeams) || nTeams < 2) {
  throw new Error(`--teams must be an integer >= 2, got ${nTeams}`);
}
// same loud-on-malformed doctrine as --teams (and cli.ts's --games guard,
// red-team MINOR-4): `--rounds 0` used to print a real-looking all-zero
// standings table with 'checks: Σwins 0 = games 0' and exit 0, and a
// fractional value silently rounded UP a whole extra round-robin cycle
// (scan finding B3-2)
if (!Number.isInteger(rounds) || rounds < 1) {
  throw new Error(`--rounds must be an integer >= 1, got ${rounds} — a zero-game season is a misconfiguration, not a result`);
}

const teams = makeLeague(nTeams, `${seed}:league`);

// ---------------------------------------------------------------- helpers

function progress(done: number, total: number): void {
  if (json) return; // JSON mode: stdout carries ONLY the document
  if (process.stdout.isTTY) {
    // live terminal: rewrite a single line in place
    if (done % 5 === 0 || done === total) process.stdout.write(`  ${done}/${total} games\r`);
    return;
  }
  // piped/redirected stdout never erases a \r line, so the per-5 chunks used
  // to concatenate into one long wrapping wall (`  5/200 games  10/200 games
  // …`) — print quarter milestones on their own lines instead
  const chunk = Math.max(1, Math.ceil(total / 4));
  if (done % chunk === 0 || done === total) console.log(`  ${done}/${total} games`);
}

function standingsTable(standings: TeamStanding[], byId: Map<string, Team>): string {
  const head =
    '  #  TEAM                       W   L   PCT    DIFF  MRG/G   HOME    AWAY    PF/G   PA/G    SOS';
  const rows = standings.map((s, i) => {
    const t = byId.get(s.teamId);
    const name = `${t?.abbrev ?? '???'} ${t?.name ?? s.teamId}`.slice(0, 24);
    const pct = s.winPct.toFixed(3).replace(/^0/, '');
    const diff = (s.diff >= 0 ? '+' : '') + s.diff;
    const mrg = (s.avgMargin >= 0 ? '+' : '') + s.avgMargin.toFixed(1);
    return (
      `${String(i + 1).padStart(3)}  ${name.padEnd(24)}` +
      `${String(s.wins).padStart(4)}${String(s.losses).padStart(4)}  ${pct.padStart(4)}` +
      `${diff.padStart(8)}${mrg.padStart(7)}` +
      `${`${s.home.wins}-${s.home.losses}`.padStart(7)}${`${s.away.wins}-${s.away.losses}`.padStart(8)}` +
      `${s.avg.pts.toFixed(1).padStart(8)}${(s.pointsAgainst / Math.max(1, s.games)).toFixed(1).padStart(7)}` +
      `${s.sos.toFixed(3).replace(/^0/, '').padStart(7)}`
    );
  });
  return [head, '─'.repeat(head.length), ...rows].join('\n');
}

/** strip Team objects down to ids for the JSON document (rosters are
 *  reproducible from the seed; repeating them would bloat the output) */
function seasonJson(result: SeasonResult): string {
  return JSON.stringify({
    seedBase: result.seedBase,
    teams: teams.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev })),
    games: result.outcomes.map((o) => ({
      index: o.index, date: o.date, home: o.homeId, away: o.awayId, score: o.score
    })),
    standings: result.standings
  });
}

// ------------------------------------------------------------------ modes

async function seasonMode(): Promise<void> {
  // Negative/fractional values fail loudly instead of degrading silently
  // (c4-F6, kin of batch MINOR-4): `--rounds -1` used to print a 0-game
  // season with an empty standings table and exit 0, and `--games -3` was
  // silently ignored (the > 0 gate below routed to the rounds default).
  if (rounds < 1 || !Number.isInteger(rounds)) {
    throw new Error(`season: --rounds must be a positive integer, got ${rounds}`);
  }
  const perCycle = roundRobin(teams.map((t) => t.id), 1).length;
  const gamesFlag = flagNumber(argv, '--games', 0);
  // 0 is the not-passed default (schedule length comes from --rounds); an
  // explicit negative/fractional --games was previously IGNORED silently by
  // the `gamesFlag > 0` branches below — reject it instead (B3-2)
  if (!Number.isInteger(gamesFlag) || gamesFlag < 0) {
    throw new Error(`--games must be an integer >= 1 (omit it to schedule by --rounds), got ${gamesFlag}`);
  }
  let schedule = roundRobin(
    teams.map((t) => t.id),
    gamesFlag > 0 ? Math.max(1, Math.ceil(gamesFlag / perCycle)) : rounds
  );
  if (gamesFlag > 0) schedule = schedule.slice(0, gamesFlag);

  if (!json) {
    console.log(
      `Season: ${teams.length} teams, ${schedule.length} games ` +
      `(${gamesFlag > 0 ? `--games ${gamesFlag}` : `${rounds} round-robin cycle(s)`}), seed base "${seed}"`
    );
  }
  const t0 = performance.now();
  let done = 0;
  const result = await runSeason({
    teams,
    schedule,
    seedBase: seed,
    onGame: () => progress(++done, schedule.length)
  });
  const secs = (performance.now() - t0) / 1000;

  if (json) {
    console.log(seasonJson(result));
    return;
  }
  console.log(`\nDone in ${secs.toFixed(1)}s (${(schedule.length / secs).toFixed(2)} games/sec)\n`);
  console.log(standingsTable(result.standings, new Map(teams.map((t) => [t.id, t]))));
  console.log(
    `\nchecks: Σwins ${result.standings.reduce((s, x) => s + x.wins, 0)} = games ${result.outcomes.length}; ` +
    `Σdiff ${result.standings.reduce((s, x) => s + x.diff, 0)} (must be 0)`
  );
}

async function matchupMode(): Promise<void> {
  const sims = flagNumber(argv, '--sims', 100);
  // empty segments rejected BEFORE Number(): Number('') === 0, so a trailing
  // comma (`--matchup 1,`) silently read as "team 1 vs team 0" and simulated
  // a fixture nobody asked for (audit M-32)
  const segs = matchupSpec.split(',').map((s) => s.trim());
  const parts = segs.map((s) => Number(s));
  if (segs.length !== 2 || segs.some((s) => s === '') ||
      parts.some((v) => !Number.isInteger(v) || v < 0 || v >= teams.length)) {
    throw new Error(
      `--matchup needs two team indices 0..${teams.length - 1} (e.g. --matchup 0,3), got "${matchupSpec}"`
    );
  }
  // the guard above enforces exactly two integer indices in [0, teams.length)
  const [home, away] = [teams[parts[0]!]!, teams[parts[1]!]!];
  if (home.id === away.id) throw new Error('--matchup: pick two different teams');

  if (!json) {
    console.log(`Monte-Carlo: ${home.name} (home) vs ${away.name}, ${sims} sims...`);
  }
  const t0 = performance.now();
  let done = 0;
  const dist = await simulateMatchup(home, away, sims, {
    seedBase: `${seed}:mc`,
    mirror: argv.includes('--mirror'),
    onGame: () => progress(++done, sims)
  });
  const secs = (performance.now() - t0) / 1000;

  if (json) {
    console.log(JSON.stringify(dist));
    return;
  }
  console.log(`\nDone in ${secs.toFixed(1)}s (${(sims / secs).toFixed(2)} games/sec)\n`);
  console.log(formatMatchup(dist));
  // honesty line: what this n can and cannot resolve
  const pHat = Math.min(0.98, Math.max(0.02, dist.homeWinProb));
  const needed = pHat === 0.5 ? simsToResolveEdge(0.55) : simsToResolveEdge(pHat);
  console.log(
    `\nn-sensitivity: distinguishing p=${pHat === 0.5 ? 0.55 : pHat.toFixed(2)} from a coin flip ` +
    `at 95% confidence / 80% power needs ~${needed} sims (this run: ${sims}). ` +
    `Reference: 55% vs 50% needs ~${simsToResolveEdge(0.55)} sims.`
  );
}

if (matchupSpec !== '') {
  await matchupMode();
} else {
  await seasonMode();
}
