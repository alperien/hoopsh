# Refactor tracking — verification-and-debt

Working log for the `refactor/verification-and-debt` branch. Every commit on
this branch declares one of three change classes and is verified accordingly:

| Class | Meaning | Verification |
|---|---|---|
| **preserving** | behavior-preserving refactor | `npm run fingerprint` byte-identical |
| **surgical** | deliberate fix outside the sim core | regression test in the same commit + sim fingerprints untouched |
| **mechanics** | deliberate sim behavior change | quarantined in one phase, followed by recalibration + corpus re-baseline |

## Baseline (tag `refactor-baseline`, commit 31442b1)

- `npm test`: 93 tests, 92 pass, 0 fail, 1 todo.
- Determinism: two `npm run sim -- --seed ci-fp` runs byte-identical (verified).
- Golden corpus: 24 seeds (`ci-fp`, `acceptance-0`, `golden-0..21`), events+frames
  SHA-256, checked in at `packages/harness/golden/fingerprints.json`.
- Acceptance bands (assisted-share is the one real miss; the 8-game CI smoke's
  extra failures are sample noise — pace/rebounds/blocks all pass at n≥24):
  - 8 games: 13/17 (noise)
  - 24 games: 16/17 — FAIL assisted-share 63.7% (band 54–62%)
  - 32 games: 16/17 — FAIL assisted-share 64.1%
  - 48 games: 16/17 — FAIL assisted-share 65.2%
- Type gate: **never run anywhere** (CI is zero-install; npm registry is
  firewalled in the authoring/refactor environments — probed again at refactor
  start: 403). `tsc --noEmit` status is therefore UNKNOWN at baseline; the CI
  job added in Phase 1 owns this gate.

## Calibration debt register

| # | Item | Status |
|---|---|---|
| D1 | Assisted share of FGM ~64% vs band 54–62% (persistent at all n; calreport ≈ −22 SE) | open — Phase 5 |
| D2 | Mid-range share ~2.8% of FGA, median 20.9 ft (no band pins it; measured over 12 games) | open — Phase 5 decision point |

## Finding → commit traceability map

Filled in as commits land; every finding from the review ends up here as
**resolved (commit)** or **deferred (reason)**.

| Finding | Class | Commit |
|---|---|---|
| _(pending)_ | | |
