# data/nba — sourced basketball data (provenance-first)

This directory exists to retire the repo's deepest documented weakness: every
acceptance band and fidelity target was authored from memory ("recollection is
not provenance" — external review, 2026-07-26). Everything in here follows one
contract:

**Every file carries its provenance: source, query parameters, season, access
date, and validation results. Every file is produced by a fetch/parse script
committed next to it — reproducible, not hand-typed.**

Explicitly banned: numbers recalled by a human or a language model and
formatted as data. That failure is worse than the original, because it wears
the costume of an external source while the provenance chain still terminates
in memory.

## The play-by-play corpus (data spine, wave 1)

The flow/grammar references used to be anchored to six hand-fetched games
(honest but thin — "n=6 is an anchor, not a distribution"). They are now
regenerated from a validated corpus of 100+ 2025-26 regular-season games
parsed from public basketball-reference play-by-play pages.

### Files

| file | contents | committed |
|---|---|---|
| `raw/` | raw fetched HTML (game pbp pages + date indexes) | **no** (gitignored) |
| `pbp-plays/plays-YYYY-MM.json` | full per-game play arrays, monthly shards | yes |
| `pbp-corpus.json` | per-game derived metrics + corpus-level distributions + composition | yes |
| `flow-reference.json` | flow/grammar reference values with distributions, grades, provenance | yes (generated) |

Play arrays are stored as tuple rows `[q, clockSec, side, text, awayScore,
homeScore]` (side `"a"`/`"h"`/`null`, `q>=5` = 300s OT periods) with the column
schema in each shard's meta — compact enough (~29KB/game) that the FULL corpus
play stream fits in git; only the raw HTML stays out.

### Pipeline

```
npm run nba:fetch -- --season 2025-26        # polite fetch -> data/nba/raw/ (resumable)
npm run nba:parse -- --write-reference       # raw HTML -> shards + corpus + flow-reference.json

npm run nba:parse -- --from-shards --write-reference
    # metric/definition RE-BAKE from the committed shards — no raw cache
    # needed (the shards are the verbatim play streams; the mode round-trips
    # them byte-identically and refuses to write if any committed game stops
    # validating). This is how definition fixes reach pbp-corpus.json and
    # flow-reference.json without refetching (release-audit H-06 shipped so).
```

Debugging subsets (`--games id1,id2`) must be pointed at a scratch
`--out-dir`; the parser refuses to overwrite the committed corpus with a
subset and refuses `--games --write-reference` outright.

- `tools/fetch-nba.mjs` — strictly sequential, >=2s between requests (default
  3.5s ≈ 17 req/min, under basketball-reference's 20 req/min crawl ceiling),
  skips anything already cached (resume = rerun), backs off once on 429/5xx
  then aborts rather than hammer. `--dates`, `--games`, `--limit`, `--dry-run`
  for surgical fetches. The `--season 2025-26` date spread IS the declared
  corpus composition (see `SEASON_DATES` in the script and `meta.dates` in
  `pbp-corpus.json`): 21 dates, 2-4 per month October-April, mixed weekdays,
  every game on each date taken — no cherry-picking by outcome.
- `tools/parse-nba.mjs` — parses the pbp table, validates every game three
  ways (score column monotonic and one-sided per event; every scoring event's
  delta equals the points its text implies; text-summed points == scoreboard
  final == scorebox final for both teams), computes per-game flow + grammar
  metrics with the operational definitions documented in
  `flow-reference.json` `meta.definitions` (kept in sync with
  `packages/harness/src/flow.ts`), and writes corpus distributions
  (n, mean, stddev, p10/p50/p90). Games failing validation are listed in
  `pbp-corpus.json` `meta.failed` and excluded from aggregates.

### Refreshing / extending the corpus

1. Add dates to `SEASON_DATES` (or pass `--dates`) and run `npm run nba:fetch`.
   Politeness contract is non-negotiable; the fetcher enforces it.
2. `npm run nba:parse -- --write-reference` regenerates everything downstream.
   `flow-reference.json`'s scholarship blocks (`publishedSources`,
   `turingBaseline`, `previousAnchor`) are preserved verbatim by the writer;
   values, distributions and the `changesVsAnchor` ledger are regenerated.
3. Commit the parsed JSON, never the raw HTML.

### Definitional notes (resolved ambiguities)

Recorded in `flow-reference.json` `meta.definitions.ambiguitiesResolved`, the
load-bearing ones:

- **Putback denominator**: bbref logs `Offensive rebound by Team` bookkeeping
  rows (mostly dead-ball rows after missed non-final FTs). The retired n=6
  anchor divided putbacks by ALL OREB rows (hence its 0.33); the corpus uses
  PLAYER offensive rebounds (~22/game, matching real OREB rates) — the sim has
  no team-rebound events, so this is the comparable base. Anchor-definition
  values are still computed and stored under `legacyAnchorDefinition`.
- **Droughts are regulation-only** (as always documented); the anchor
  implementation accidentally let one OT game inflate the average (295 → 230
  on the same six games once the bug is removed).
- **`secondChanceShareOfPoss`** is possessions containing a live OREB over ALL
  possessions (both teams pooled). `flow.ts`'s report currently divides by
  `poss/2`; reconcile the sim-side denominator before gating that metric.
- Possession segmentation cannot see mid-game jump-ball flips or
  away-from-play FT retention (rare); flagrant/clear-path FT phrasings never
  match the plain `N of N` boundary and so correctly do not end possessions.

## Planned datasets (unchanged)

| file | contents | feeds |
|---|---|---|
| `team-per-game-<season>.json` | official league per-team per-game aggregates | `bands.ts` (GENERATED, not typed) |
| `league-averages-<season>.json` | league-wide per-game means | band centers + widths from real inter-team spread |
| `tracking-references-<season>.json` | tracking speed/distance/passing league values with exact definitions + the definition traps (avg speed includes standing; AVG_SPEED column ≠ distance/minutes; the sim's texture metric is a third quantity) | `harness/texture.ts` printed references — **landed** for 2023-24, generated by `fetch-tracking-references.mjs` beside it |
| `shot-zones-<season>.json` | shot volume/accuracy by distance/zone | shot-distance distribution targets (Phase 5) |
| star season lines | per-season player lines for benchmark stars | fidelity TARGETS (GENERATED) |

The original stats.nba.com aggregate fetcher stub was replaced by the pbp
corpus fetcher (this milestone's deliverable); the aggregate datasets above
remain planned and will get their own script when they land.

## Season protocol (fit vs holdout)

Fitting seasons and the HOLDOUT season are declared here the day data lands,
before any fitting run. The holdout season is never given to the sweep or the
solver; landing in-band on it without re-sweeping is the project's promotion
test. Season-to-season drift (pace, 3PA share, foul rates) is the reason the
holdout axis is seasons, not rosters. The pbp corpus above is all 2025-26 —
the same season the sim's references have always targeted; a second-season
corpus for holdout purposes is a follow-up fetch away (`--season` table).

## Source & licensing notes

Play-by-play: public basketball-reference.com pages, fetched politely
(sequential, >=2s spacing, honest User-Agent, resumable cache so pages are
fetched at most once), parsed locally; raw HTML is not redistributed — only
derived play tuples and metrics with attribution and access dates. Aggregate
endpoints (stats.nba.com) remain the plan of record for the band datasets.
