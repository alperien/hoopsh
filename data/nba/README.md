# data/nba — sourced basketball data (provenance-first)

This directory exists to retire the repo's deepest documented weakness: every
acceptance band and fidelity target was authored from memory ("recollection is
not provenance" — external review, 2026-07-26). Everything in here follows one
contract:

**Every file carries its provenance: source URL, query parameters, season,
access date, and a checksum of the raw payload. Every file is produced by a
fetch script committed next to it — reproducible, not hand-typed.**

Explicitly banned: numbers recalled by a human or a language model and
formatted as data. That failure is worse than the original, because it wears
the costume of an external source while the provenance chain still terminates
in memory.

## Planned datasets

| file | contents | feeds |
|---|---|---|
| `team-per-game-<season>.json` | official league per-team per-game aggregates | `bands.ts` (GENERATED, not typed) |
| `league-averages-<season>.json` | league-wide per-game means | band centers + widths from real inter-team spread |
| `shot-zones-<season>.json` | shot volume/accuracy by distance/zone | shot-distance distribution targets (Phase 5) |
| star season lines | per-season player lines for benchmark stars | fidelity TARGETS (GENERATED) |

## Season protocol (fit vs holdout)

Fitting seasons and the HOLDOUT season are declared here the day data lands,
before any fitting run. The holdout season is never given to the sweep or the
solver; landing in-band on it without re-sweeping is the project's promotion
test. Season-to-season drift (pace, 3PA share, foul rates) is the reason the
holdout axis is seasons, not rosters.

## Source & licensing notes

Primary source: the NBA's public stats API (stats.nba.com endpoints, e.g.
`leaguedashteamstats`). Official league data, publicly served, fetched with
attribution and access dates recorded; not redistributed beyond this repo's
research use. Fetch requires the standard reference headers (see
`tools/fetch-nba.mjs`). If the endpoint shape changes, the script fails
loudly rather than writing a partial file.
