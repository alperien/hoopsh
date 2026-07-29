# SEASON.md — the season layer

The multi-game substrate on top of the single-game engine: schedules,
deterministic season driving, standings, and a Monte-Carlo matchup API.
Everything here is **harness-layer** (`packages/harness/src/season.ts`,
`matchup.ts`, `league.ts`); the engine is consumed strictly through its
public API and was not modified.

```
npm run season -- --teams 8 --seed 2026            # double round-robin, standings table
npm run season -- --teams 8 --rounds 1             # single round-robin
npm run season -- --teams 8 --games 40             # cap/extend the schedule
npm run season -- --teams 4 --seed proof --json    # byte-stable JSON (pipe to sha256sum)
npm run season -- --matchup 0,3 --sims 200         # Monte-Carlo one fixture
```

## API

- **`roundRobin(teamIds, rounds=2)`** → `ScheduledGame[]` (`{home, away, date?}`).
  Circle method; odd league sizes get a bye per round. Venue assignment keeps
  every team's single-cycle |home − away| ≤ 1 (≤ 2 with byes), and odd cycles
  mirror even ones so a double round-robin gives every pair exactly one game
  in each building. `date` is the round label `"r<k>"`; games sharing a label
  share no team (see "parallelism" below for why that matters).
- **`runSeason({teams, schedule?, seedBase?, simulate?, onGame?})`** →
  `{schedule, outcomes, standings}`. Accepts any explicit fixture list (a
  real league's schedule imports as `{home, away, date}` rows) or defaults to
  a double round-robin.
- **`computeStandings(outcomes, teamIds?)`** — pure fold, exported separately
  so standings can be recomputed from stored outcomes without re-simulating.
- **`simulateMatchup(home, away, n, opts?)`** → `MatchupDistribution` (below).
- **`makeLeague(n, seed)`** — deterministic fictional league for the CLI and
  tests; `scaleTeam` / `cloneTeamWithIds` build "same team but stronger" and
  "team vs itself" fixtures. These are tooling, NOT calibration rosters — the
  two `@hoopsh/data` teams keep that job.

## Determinism

A season is a pure function of `(seedBase, schedule, rosters)`. Game `i`
against the schedule gets seed `gameSeed(base, i, homeId, awayId)` =
`` `${base}:g${i}:${away}@${home}` `` — schedule position is in the seed, so
same seed base ⇒ the same season, byte for byte; and because the matchup ids
are in the seed too, editing unrelated schedule entries doesn't perturb games
that didn't move. Proof (run it yourself — the two hashes match, the third
differs):

```
$ npm run season --silent -- --teams 4 --rounds 1 --seed proof --json | sha256sum
c43ad6f0d1405fb64281844732e9631323a788b71b257cd35c4913fd6cc67131
$ npm run season --silent -- --teams 4 --rounds 1 --seed proof --json | sha256sum
c43ad6f0d1405fb64281844732e9631323a788b71b257cd35c4913fd6cc67131
$ npm run season --silent -- --teams 4 --rounds 1 --seed other --json | sha256sum
4b26463a9f8f2784edc9dc09e188b08c2834f18ec81fe1081dbf6b5a009e96b5
```

## Standings definitions (so nobody re-derives them differently)

- **W/L, venue splits, point differential**: integer sums; league-wide
  Σdiff = 0 exactly and ΣW = ΣL = games played (tested).
- **Ties cannot happen**: the engine plays overtime until decided
  (`possession.ts#endPeriod`); the standings fold throws on a tied score
  rather than inventing a rule.
- **Season averages**: counting stats are per-game means; ratio stats
  (FG%/3P%/FT%) are **volume-weighted** (Σmakes/Σattempts), matching
  `aggregate.ts`'s convention — never a mean of per-game percentages.
- **SOS**: plain opponents' winning percentage (OWP) — the mean of opponents'
  *final* win% over the team's games, with multiplicity. It does NOT exclude
  games against the team itself from opponents' records, and does not recurse
  into opponents' opponents (RPI-style OOWP). Cheap, standard, and good
  enough to flag unbalanced schedules; upgrade when a consumer needs it.
- **Sort order**: win% desc → point diff desc → team id (a total order, so
  standings are byte-stable even among tied teams).

## Monte-Carlo matchups (`simulateMatchup`)

Returns a **distribution**, not a game: win probability with a **Wilson 95%
CI**, margin mean/median/sample-sd, percentiles (p5/p25/p50/p75/p95), a
binned margin histogram, and per-player stat-line distributions
(min/pts/trb/ast, each with mean/sd/p10/p50/p90). Margins are from the home
team's perspective; ties are impossible, so `P(margin > 0)` *is* the win
probability.

**CI math.** Wilson score interval:
`center = (p̂ + z²/2n)/(1 + z²/n)`, `half = z·√(p̂(1−p̂)/n + z²/4n²)/(1 + z²/n)`,
z = 1.96. Chosen over the naive Wald interval because lopsided matchups push
p̂ toward 0/1, exactly where Wald's coverage collapses and its bounds leave
[0, 1].

**n-sensitivity — how many sims to resolve an edge?** The one-sample binomial
power calculation (`simsToResolveEdge`, 95% confidence / 80% power, two-sided
vs p₀ = 0.5):

| true p | sims needed |
|-------:|------------:|
| 0.52   | ~4,895 |
| 0.55   | **~783** |
| 0.60   | ~194 |
| 0.70   | ~47 |

Equivalently by CI width (worst case p = 0.5, half-width ≈ 0.98/√n):
n = 100 → ±9.8 pp, n = 400 → ±4.9 pp, n = 1600 → ±2.5 pp. **A 55%-vs-50%
edge costs ~783 sims ≈ 4–5 wall-clock minutes single-process at the measured
game cost below** — this is the honest price of small edges, and it is why
the API always reports the CI instead of a bare point estimate.

Measured sanity points (n = 30, seeds pinned in the tests):

- identical rosters (team vs its re-id'd clone): p̂ = 0.467,
  CI [0.302, 0.639] — contains 0.5; mean margin −0.5.
- every attribute +8 vs −8: p̂ = 0.867, CI [0.703, 0.947]; mean margin +19.8.
- equal-team margin noise: quote nothing static here. This bullet once read
  "sd ≈ 16.4, noticeably above the real NBA's ~13–14" and then survived
  three re-centers (B1, B2, scan-wave) unrechecked while both numbers went
  stale — the adjudicated record at the B2 landing measured self-play
  signed margin sd 15.52 ± 0.78 vs the real 15.64 (n=200; docs/REGISTER.md
  W14). Measure fresh after any calibration change (`npm run oos` prints
  the distributional report) before reasoning about how engine noise
  flattens the skill→win-probability curve.

## Measured cost (2-core shared box, Node 24 type-stripping, single process)

| what | measured |
|------|---------|
| one game (calibration rosters) | mean 389 ms, median 345 ms |
| one game (generated league) | mean 317 ms, median 294 ms |
| 30-game double round-robin (6 teams) | ~10 s |
| **1230-game NBA-scale season** | **~6.5–8 min (estimated — do not run casually)** |
| 783-sim matchup (resolve 55/50) | ~4–5 min (estimated) |
| 1000 × full-season Monte-Carlo | ~110–130 h single-core — **needs the parallel runner** |

## Parallelism: a seam, deliberately not an implementation

`packages/harness/src/parallel.ts` owns worker-pool parallelism. This
layer *pre-shapes* the work
for it and does nothing else:

- `runSeason`/`simulateMatchup` build the **complete task list up front**
  (`GameTask[]` — each task carries its seed and both full rosters, closing
  over no season state) and pass it to one `SimulateGames` function:
  `(tasks, onOutcome?) => GameOutcome[] | Promise<GameOutcome[]>`.
- The default is a sequential in-process loop (`simulateTasksSequential`).
  A worker pool drops in by implementing the same signature.
- **Completion order cannot matter**: callers re-sort outcomes by
  `task.index` before computing anything, and the standings fold is
  order-insensitive (tested with a mock seam that completes games in reverse).
- A seam returning the wrong number of outcomes fails loudly.

## THE DECISION: cross-game state is deliberately absent

**Today's model treats every game as strictly independent.** Rosters,
ratings, tendencies, and tactics are identical in game 82 and game 1; the
engine's within-game fatigue resets at the final horn. This is a decision,
not an oversight — it keeps the season layer embarrassingly parallel and
keeps prediction error attributable to the engine rather than to a
half-built carryover model. Nothing below is implemented; this section
records where each piece would attach and what its absence costs.

### What is stateless today

| real-world effect | status |
|---|---|
| home-court advantage | **not modeled at all** (engine is side-symmetric by design; `run.ts --mirror` exists to verify it stays that way) |
| fatigue carryover / back-to-backs | not modeled (fatigue exists within a game, resets between) |
| injuries | not modeled (rosters immortal) |
| rest days / travel | not modeled (`ScheduledGame.date` is carried but unread) |
| form / momentum / lineup changes | not modeled |

### The seams where cross-game state would attach

1. **Schedule metadata** — `ScheduledGame.date` already flows untouched into
   `GameTask.date` and `GameOutcome.date`. Rest days and travel legs are
   derivable from real dates here; the round labels `roundRobin` emits
   (`"r<k>"`) already partition the schedule into no-shared-team waves.
2. **Task construction (`buildTasks`)** — the single choke point where
   rosters enter tasks. A carryover model is a function
   `(team, seasonContextSoFar) => Team` applied per game here: fatigue as an
   attribute/stamina debuff, injuries as roster/starter edits. The engine
   needs no change — it already takes any `Team`.
3. **Per-game params** — `GameConfig.params` (unused by `simulateTask`
   today) is the hook for game-level modifiers that aren't roster edits,
   e.g. a tired-legs shooting penalty.
4. **Outcome feedback** — `GameOutcome.players[].min` already carries the
   per-game minutes an injury/fatigue state machine would consume; the fold
   in `computeStandings` stays pure either way.

### The cost that must be paid when state arrives

Independence is what lets a worker pool run all 1230 tasks concurrently.
Cross-game state creates a dependency chain per team: game g of team T needs
the outcomes of T's earlier games. The schedule's round structure is the
escape hatch — games within a round share no team, so the parallel runner
would process **round-by-round waves** (≈ n/2 games wide) instead of one flat
batch. That is a scheduling change in the runner, not a rewrite of this
layer: tasks would be built per-wave instead of all up front, through the
same `SimulateGames` signature.

### What statelessness costs in prediction accuracy (be honest with consumers)

- **No home-court advantage is the largest systematic bias.** Real NBA home
  teams win ~55–60% of games (≈ +2.5–3 pts); this layer predicts 50/50 for
  equal teams regardless of venue. Any real-world consumer must add HCA
  exogenously today, or every home-team prediction is ~5–10 pp too low.
- **Rest/B2B/travel** effects are worth ~1–2 pts of margin in real data;
  back-to-back-aware bettors systematically beat rest-blind models.
- **Injuries** dominate season-total error in real backtests — a star's
  20-game absence swings win totals by several games; an immortal-roster
  model cannot see it. For the planned simulated-vs-real season backtest,
  expect this to be the single biggest residual.
- **Correlation structure**: with independent games, a simulated team's win
  total is a sum of independent Bernoullis (variance ≤ 82·¼). Real season
  outcomes are positively correlated within a team (injury regimes, trades,
  tanking), so real win totals have FATTER tails — our season-total
  distributions will be over-confident even if per-game probabilities are
  perfect.
- **Engine-level margin noise** adds game-level variance on top of the
  effects above, flattening the skill→win-probability curve; the B2
  game-state coupling moved it materially — measure it fresh (`npm run
  oos`) rather than trusting a typed number (see the matchup section's
  noise bullet).

## Limitations (recap)

- Home/away in `simulateMatchup` is positional, not an advantage (see above).
- Generated leagues (`makeLeague`) are NOT calibrated; realism bands apply to
  the two `@hoopsh/data` rosters only.
- SOS is plain OWP (no self-exclusion, no OOWP recursion).
- `--games` beyond one round-robin cycle tiles additional cycles and slices,
  so a capped schedule can leave pair-counts unequal — fine for smoke runs,
  not for fairness-sensitive experiments.
- Everything here runs single-process today: the worker-pool runner
  (`packages/harness/src/parallel.ts`) landed but is not wired behind
  `SimulateGames` — drop it in through the seam when a consumer needs it.
