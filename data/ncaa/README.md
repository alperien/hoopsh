# data/ncaa — NCAA men's D-I research foundation (WORK IN PROGRESS)

Research document for calibrating hoopsh to NCAA men's Division I basketball.
Same provenance-first contract as `data/nba/README.md`: every number carries a
source and a grade. Nothing here is wired into the engine yet — these are
proposals for the orchestrator.

Provenance grades:

- **A** — published multi-season data with methodology (KenPom trends,
  Sports-Reference CBB league pages, NCAA rulebook/press releases).
- **B** — credible published analysis (single season, or analytics blog with
  described method).
- **C** — thin, derived, or estimated by us (derivation shown inline).

## Status

SKELETON — sections being filled in by research pass. Planned sections:

1. Rule differences (NCAA men vs NBA), with rulepack verification
2. Statistical / style differences (per-possession and per-40)
3. Talent distribution (why NBA-tight bands break)
4. Style of play (zone, set plays, shot clock, tournament effects)
5. Proposed acceptance bands (see `acceptance-bands.json`)
6. What the engine would need (`--league ncaa` workflow)
7. What we could not source
