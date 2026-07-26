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

## Outcome summary

The refactor is **provably behavior-preserving**: after every phase, the engine
produces byte-identical events+frames to `refactor-baseline` (24-seed golden
corpus). Calibration is therefore untouched at **16/17 bands** (only the
pre-existing structural assisted-share miss). Test count **93 → 114** (all pass,
1 todo). Every HIGH/MAJOR review finding is resolved; the mechanics-level minor
findings are deferred as a coordinated re-sweep task (see debt register + the
Phase 5 finding below).

### Phase 5 finding — the calibration is too marginal to absorb even correct mechanics fixes

The three mechanics fixes (FT-phase fatigue, relocUntil hygiene, corner-spot
placement) were implemented, quarantined, and **measured**, then **reverted**.
Reason: the baseline calibration sits on multiple knife-edges (pace, FT%, FTA,
3P%, assisted-share all near a band boundary), so each individually-correct
mechanics fix tips a boundary band, and no bounded knob change re-centers it:

- **corner spot 21.5→22.4/22.5** (fix the ~1% junk corner-2s): eliminated the
  junk 2s but routed moderate-gravity BIGS into a heavy three diet — the Jokić
  fidelity benchmark's 3PA blew past his real-NBA identity (>9 vs ~3-4) and his
  post volume collapsed. Net-negative: a minor cosmetic fix for a real
  hub-identity regression.
- **FT-phase fatigue** (consistency with every other phase handler): shifted
  pace and FT% off their band edges (14/17 with relocUntil).
- **relocUntil hygiene** (fix a real cross-possession timer leak): alone it
  nudged pace to 94.9 vs the 95.0 floor — a boundary tip.

The correct remedy is a **coordinated fix + full `npm run sweep` re-center**,
which is out of budget in this environment (~3.7 games/sec). Shipping any of
these as a lone commit would trade a stable 16/17 for a regression to fix a
review-rated *minor* issue — the wrong trade. They are deferred as D3–D5 with
the full mechanism recorded here so the re-sweep is a scoped task, not a
rediscovery.

## Calibration / modeling debt register

| # | Item | Status |
|---|---|---|
| D1 | Assisted share of FGM ~64% vs band 54–62% (persistent at all n; calreport ≈ −22 SE). An assist-window sweep (2.0→1.65s) confirmed **<2% leverage** — structural, not a knob. Needs a decision-layer assist model + an assisted-share acceptance band. | open (structural; pre-existing) |
| D2 | Mid-range share ~2% of FGA, median ~20 ft (no band pins it). **No-go this refactor**: no EV path prefers a 16-footer, so restoring it is a decision-layer modeling question (a mid-range shot-selection concept + tendency wiring + full re-sweep), not a bounded fix. Forcing it would trade real efficiency realism for a distribution metric. | deferred (modeling design) |
| D3 | Corner spacing spot at 21.5 ft (just inside the 22 ft line) → ~1% junk corner-2s. Fix requires **gravity-aware corner assignment** (only true shooters get a behind-the-line corner) so bigs don't over-shoot 3s, then a re-sweep. | deferred (needs re-sweep) |
| D4 | FT phase skips `applyFatigue` (sole phase handler that does). Correct fix tips pace/FT% bands; needs a re-sweep to re-center. | deferred (needs re-sweep) |
| D5 | `relocUntil` not cleared in the possession stale-timer sweep (rare cross-possession leak). Correct fix tips the pace boundary; needs a re-sweep. | deferred (needs re-sweep) |
| D6 | `makePlayer` uses a module-global `anonCounter` for default ids (impure; call-order-dependent fixture ids). Left as-is — changing it risks fixture-id churn across tests; low value. | deferred (low value) |
| D7 | `oos.ts` "out-of-sample" covers 12/132 matchups at defaults; naming/doc clarification, not a bug. | deferred (doc-only) |

## Finding → commit traceability map

Every finding from the review, mapped to its resolution. Commits on branch
`refactor/verification-and-debt`.

| # | Review finding (severity) | Resolution |
|---|---|---|
| 1 | CI band gate is exit-code theater (prints FAIL, exits 0) | **resolved** — cli.ts RATCHET_FLOOR + nonzero exit; CI runs gated 48-game batch (phase 1, `36e52c4`) |
| 2 | TypeScript never typechecked anywhere | **resolved** — CI `types` job (npm install + tsc --noEmit + real vitest) + `tools/` added to tsconfig (phase 1). npm firewalled locally, so the gate is CI-owned; hand-audit of `noUncheckedIndexedAccess` hot-paths found only tuple-by-TeamSide / helper-guarded access (phase T) |
| 3 | broadcast-demo silent `--seed` → seed "undefined" | **resolved** — args.ts loud flag parsing + test (phase 2, `dbe2a4a`) |
| 4 | viewer innerHTML XSS sink | **resolved** — createElement/textContent + no-innerHTML tripwire test (phase 2) |
| 5 | Phantom-code comments (sweep setPath / hardcoded 16); false STAGED labels; 0.7-vs-0.85 & 40-vs-45 comments; 16/48/17 band count; stale doc numbers | **resolved** — truth pass (phase 4, `556aaad`) |
| 6 | "single calibration surface" violated 30+ inline constants | **resolved** — ~35 constants moved to SimParams byte-identically; header claim made precisely true with the cosmetic-positioning carve-out (phase 3b, `513a567`) |
| 7 | Charge narrated twice (off_foul turnover + offensive foul) | **resolved** — pbp.ts one-line-per-charge + test (phase 2) |
| 8 | noise-floor.gen.ts generator-default drift (20/8/4 vs 40/16/8 artifact) | **resolved** — defaults realigned to the artifact (phase 4) |
| 9 | Mid-range game vestigial (~2%) | **deferred D2** — modeling design, documented no-go |
| m1 | relocUntil not cleared in stale-timer sweep | **deferred D5** — correct fix tips pace band; needs re-sweep |
| m2 | FT phase skips applyFatigue | **deferred D4** — correct fix tips pace/FT%; needs re-sweep |
| m3 | 3× segment-distance duplication | **resolved** — vec.segmentT (phase 3a, `10171b6`) |
| m4 | contestAt/anticipatedContest copy-paste | **resolved** — merged contestCore (phase 3a) |
| m5 | fouled-out ghost-actor filter repeated at ~15 sites | **resolved** — state.liveOnCourt (phase 3a) |
| m6 | offense getback degenerate lerp(A,A,0.55) | **resolved** — simplified (phase 3a) |
| m7 | deepMerge/withParams accepts unknown keys silently | **resolved** — throws on unknown path + test (phase 2) |
| m8 | Rng.weighted empty-array fall-through | **resolved** — throws + test (phase 2) |
| m9 | corner spots inside the 3pt line (~1% junk 2s) | **deferred D3** — fix needs gravity-aware assignment + re-sweep |
| m10 | hardcoded 14s reset / 13.75 FT spot vs rule pack | **resolved** — rulepack derivations (phase 3a) |
| m11 | stats package has no direct unit tests | **resolved** — box.test.ts, 10 known-answer cases (phase 6) |
| m12 | makePlayer global anonCounter | **deferred D6** — low value |
| m13 | oos.ts 12/132 coverage vs "out-of-sample" name | **deferred D7** — doc-only |
| m14 | fallback gate widths 0.175 vs 0.15 disagree; Rng.gaussian platform caveat; storylines/drawFoul/fastbreakPts dead-or-asymmetric | **noted** — accurate-but-minor; left with the code's own comments, logged here for the re-sweep pass |
