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
| D1 | Assisted share of FGM. **PARTIALLY FIXED (D1a shipped).** Diagnosed against six real games' play-by-play, by zone: real three 87% / rim 51% / paint 46% / mid 32% vs sim three 97% / rim 66% / mid 57% — the engine was crediting SELF-CREATED shots because the 2-dribble allowance was uniform floor-wide. Shipped the real scorekeeping rule: zone-aware "direct scoring move" (0 dribbles for jumpers, 1 for interior gathers). Result 63.4% → 62.6% (band 54-62), and **star AST snapped into identity** — Curry 14.5→8.75 [4.5-8.5], LeBron 8.92 [6-9.2], Jokić 8.42 [7-11]. Remaining 0.6pp is NOT crediting: it's shot-MIX (sim catch-and-shoot = 58% of makes vs real ~35-40%), i.e. the offense generates too many assistable shots. That's D1b — a decision-layer/off-ball-motion question needing its own re-sweep. | D1a resolved; D1b open (shot mix) |
| D2 | Mid-range share ~2% of FGA, median ~20 ft (no band pins it). **No-go this refactor**: no EV path prefers a 16-footer, so restoring it is a decision-layer modeling question (a mid-range shot-selection concept + tendency wiring + full re-sweep), not a bounded fix. Forcing it would trade real efficiency realism for a distribution metric. | deferred (modeling design) |
| D3 | Corner spot at 21.5 ft → ~1% junk corner-2s. **D1a did NOT unblock it (tested).** With the assist rule shipped, restoring behind-the-line corners still produced Curry 13.1 AST and collapsed the report to 7/17 (catch-and-shoot share 58%→67%; pace/pts/fga/3PA/FTA/TRB all out). Concentration was fine (top-assister share 36.7%, real ~30-38%) — the problem is TOTAL assisted volume, confirming D3 is coupled to **D1b (shot mix)**, not to assist crediting. D3 now needs a dedicated re-sweep with the corner model in place. Earlier trail retained below.**M1 update — D3 was believed COUPLED to D1.** Three assignment models were built and measured (12-game fidelity probes): (1) naive 22.4 corners → Jokić 12.1 3PA (real ~3-4) — kicks feed whoever lives behind the line; (2) appetite-ranked corners (tend.shotThree top-2 ≥ 0.5 floor) → Jokić 4.6 3PA ✓ but he landed on a WING and post shots collapsed 0.5/g, TRB 7; (3) + post-identity pull (fit = shotThree/100 − 0.5·post/100) and interior block-stationing → Jokić 3PA ✓ TRB 13.3 ✓ post recovering (1.2) — **but genuine behind-the-line corners raise kick EV enough that star creators' assists inflate to 12-14.5/game** (Curry 14.5 vs [4.5-8.5]), amplifying D1's structural assist-economy overshoot. The best-fit spacing model is validated per-metric and recorded here; land D1's assist-model fix first, then restore it. | blocked on D1 (model recorded) |
| D4 | FT phase skips `applyFatigue`. **Landed in M1** with the margin re-sweep. | resolved (M1) |
| D5 | `relocUntil` not cleared in the stale-timer sweep. **Landed in M1** with the margin re-sweep. | resolved (M1) |
| D6 | `makePlayer` uses a module-global `anonCounter` for default ids (impure; call-order-dependent fixture ids). Left as-is — changing it risks fixture-id churn across tests; low value. | deferred (low value) |
| D7 | `oos.ts` "out-of-sample" covers 12/132 matchups at defaults; naming/doc clarification, not a bug. | deferred (doc-only) |

## M1 — robustness re-foundation (margin objective + mechanics landed)

**Root cause located and fixed in the objective:** sweep.ts scored band
violations with centering pressure capped at 0.015/band — present but ~67x
weaker than one band-width of violation, so the search treated all interior
positions as equal and parked metrics on edges (the measured knife-edge). The
`margin` objective (now default; `--objective legacy` preserved) raises
centering to a real force (0.25/band) with violations steepened 4x, keeping
pass-first behavior while buying interior slack.

**Landed via one coordinated set + margin re-sweep (20 iters, 12-knob diff):**
D4 (FT-phase fatigue) and D5 (relocUntil hygiene) are IN, and the band gate is
back to **16/17 at n=48** (pace 94.4→in-band, FT% 80.9→in-band; assisted-share
remains the structural D1 miss). Fidelity identities all pass; Vance leads his
team in assists again.

**Tidy-test result (the pre-committed criterion): partial win.** Rounding every
odd-precision default to 2-3 digits now yields **15/17** vs 14/17 pre-M1, and
the failing band changed from pace to ftPct — the FT% ceiling (80.5%) is the
one remaining edge-hugger. Next sweep round should give the FT model slack
(ftBasePct rail currently floors at 0.69).

**Corner/spacing (D3): reverted again, now with the full model recorded.** The
best-fit assignment (appetite-ranked corners + interior block stationing) was
validated metric-by-metric across three iterations but exposed hard coupling to
D1: genuine behind-the-line corners raise kick EV enough to inflate star
creators to 12-14.5 apg. D3 is blocked on D1, by measurement.

**New decision-layer debt from flow-gap probes (knob leverage disproven):**

| # | Item | Status |
|---|---|---|
| D8 | Putback share ~53-56% vs real ~33%: NOT the putbackChance auto-roll — measured flat (53→50%) across putbackChance 0.45→0.22; the excess is emergent post-OREB rim-EV shooting. Needs post-OREB decision modeling (reset/kick-out pricing). | open (decision layer) |
| D9 | Steal→score-in-6s ~13-17% vs real ~29%: transition conversion; driveTransitionMult has no leverage (swept slightly DOWN by the bands). Needs transition speed/finish economy — M4-adjacent. | open (decision layer) |

## Realism-gate tiers ("reads like basketball")

Added 2026-07-27 on top of the original four gate families (invariants /
bands / fidelity / texture):

| Tier | Tool | Gated? | What it catches |
|---|---|---|---|
| Flow arcs | `npm run flow` + `test/flow.test.ts` | passing metrics gated (ratchet) | games that stop trading runs/leads, drought anomalies, possession-shape drift |
| Event grammar | inside flow.ts + reference file | report + gated subset | putback/steal-conversion/and-one/second-chance magnitudes |
| PBP Turing | `npm run turing` + judge protocol | measured baseline, rerun per milestone | the literal read — blind discrimination vs real NBA play-by-play |

**Flow findings at baseline (48 games):** already-real — lead changes 7.1
(real ~6.5), ties 5.4 (~5.7), runs>=8 3.1 (~3.3), droughts 232s (~295), and-ones
4.9 (~4.8), possession p50 13.3s, comeback rate 5%. **Provable gaps** — putback
rate 60% vs ~33% (putback economy over-tuned), steal->score-6s 13% vs ~29%
(transition conversion), runs>=10 1.0 vs ~1.8 (no momentum model; consistency
STAGED), flat quarter profile (no fatigue-arc/endgame pacing), clutch FT share
20% vs 35%+ (no intentional fouling — M4).

**Turing baseline (2026-07-27):** 30 blind excerpts (15 sim / 15 real bbref
2025-26, identical dry register, pseudonymized), 5 independent LLM judges:
**50% discrimination accuracy (CI 32-68%) — coin-flip; 73% of sim excerpts
passed as real.** Sim tells that worked: fixed-spot distance quantization
("26 ft" repeats), shot-type monotony at short range, missing event vocabulary
(timeouts/replay/team rebounds read as REAL markers). Protocol notes: unicode
pseudonymizer bug (fixed), renderer lacks bbref's "at rim" variant. Full
provenance in data/nba/flow-reference.json.

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
