# Refactor tracking — verification-and-debt

Working log for the `refactor/verification-and-debt` branch. **This file is
the branch's canonical debt register.** Register reconciled 2026-07-27
against the wave-2 audit (see "Open items — wave-2 audit" below); the
narrative sections above it are the historical record of the refactor phase
and are kept as written. Every commit on
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
| D1 | Assisted share of FGM. **PARTIALLY FIXED (D1a shipped).** Diagnosed against six real games' play-by-play, by zone: real three 87% / rim 51% / paint 46% / mid 32% vs sim three 97% / rim 66% / mid 57% — the engine was crediting SELF-CREATED shots because the 2-dribble allowance was uniform floor-wide. Shipped the real scorekeeping rule: zone-aware "direct scoring move" (0 dribbles for jumpers, 1 for interior gathers). Result 63.4% → 62.6% (band 54-62), and **star AST snapped into identity** — Curry 14.5→8.75 [4.5-8.5], LeBron 8.92 [6-9.2], Jokić 8.42 [7-11]. Remaining 0.6pp is NOT crediting: it's shot-MIX (sim catch-and-shoot = 58% of makes vs real ~35-40%), i.e. the offense generates too many assistable shots. That's D1b — a decision-layer/off-ball-motion question needing its own re-sweep. **Wave-2 update (2026-07-27):** the shot-mix work (taxonomy fix, transition urgency, post-OREB re-aim — commits `2bb9f85`/`e53c75a`/`b662513`) shipped D1b's mechanism, and the assisted-share band now measures INSIDE (58.3% batch-24; n40 center 59.0% ±0.2se vs the 62% ceiling — see docs/INTERNALS.md measured findings). Declaring D1 fully closed still pends the n=96 adjudication promised in WAVE2-PLAN Phase B.4 (W6 below). | D1a resolved; D1b shipped — close pends n=96 (W6) |
| D2 | Mid-range share ~2% of FGA, median ~20 ft (no band pins it). Was a documented no-go for the refactor phase (no EV path preferred a 16-footer). **Shipped in wave 2**: the mid-range restoration (commits `8c5b76b`, `ebf8ee7`) landed the shot-selection concept and is gated by `packages/engine/test/midrange.test.ts` (league share gate 3-8%; measured 4.0-4.6% at landing — the honest limit disclosed in the gate itself). The 5-7% aspiration needs a true mid-range-artist roster: coupled to the 30-roster fitting item (W3 below). | resolved (wave 2) |
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
(ftBasePct rail currently floors at 0.69). Done at B1: the floor was freed
0.69 → 0.66 after the coordinated sweep converged wall-pinned at it (commit
5e0c500), and the directed re-search adopted `shot.ftBasePct` 0.666 with
`pass.riskBase` −3.95 (commit 7e05c97) — the ftPct edge-hugger re-centered
to 77.92% verify-40×3 means / 78.0% at n=96 (W16).

**Corner/spacing (D3): reverted again, now with the full model recorded.** The
best-fit assignment (appetite-ranked corners + interior block stationing) was
validated metric-by-metric across three iterations but exposed hard coupling to
D1: genuine behind-the-line corners raise kick EV enough to inflate star
creators to 12-14.5 apg. D3 is blocked on D1, by measurement.

**New decision-layer debt from flow-gap probes (knob leverage disproven):**

| # | Item | Status |
|---|---|---|
| D8 | Putback share — **DIRECTION REVERSED 2026-07-27** (this row previously read "~53-56% vs real ~33%", aiming DOWN). The wave-2 reference correction (commit `b662513`; `packages/harness/src/flow.ts:112`, `flow.test.ts`) established the real reference as **0.716 of PLAYER OREBs** (184-game corpus, grade A) — the old ~33% divided putbacks by all OREB rows including team-rebound bookkeeping. Sim ~50-56% is therefore too **LOW**. Any post-OREB decision modeling (reset/kick-out pricing) must aim UP; the pre-correction knob-leverage note stands (putbackChance measured flat 53→50% across 0.45→0.22). | open (decision layer; re-aimed) |
| D9 | Steal→score-in-6s: **CLOSED by measurement.** Re-verified at tip `5ff37af` across 3 seed bases: 27/32/25% (mean ~28%) vs real 29.3% (184-game corpus) — in range. Historical: ~13-17% when this row was written. Re-measure via `npm run flow`. | resolved (measured at 5ff37af) |

## Open items — wave-2 audit (registered 2026-07-27)

The wave-2 tip (`5ff37af`, "wave 2 complete") left the branch's own plans
partially undone and created new debt; none of it was registered anywhere.
Absorbed here from the audit (plan-vs-delivery reconciliation, red-team
findings, calibration re-measurement). SWARM-PLAN.md and WAVE2-PLAN.md are
historical records; this table is the live list.

| # | Item | Source | Status |
|---|---|---|---|
| W1 | **Coordinated margin-objective re-sweep of the integrated engine.** Ran flag-on on the integrated engine (commit 99482c8: iters 14 × cands 4, margin objective, 3 bases; a continuation run confirmed convergence). 11 knobs re-centered; noise floor + 24-seed golden corpus re-baselined in that commit and AGAIN at the winner bake 7e05c97 — the canonical floor; each diff is the drift record (§4.4). The bake's own verify left fga outside on all three bases with fga/ftPct centers outside at its floor (92.81 / 80.67% n12 means); closed by the directed re-search winner 7e05c97 (see W16): VERIFY 40×3 at the landing **17/17 / 17/17 / 17/17** (score 4.461), verify means fga 91.30 / ftPct 77.92%; pf re-centered after the charge-composition fix (W15) — 21.0 at n=96 / 20.3 verify means, mid-band. `moveCutFinish` REMAINS parked at 0 and off the sweep surface — carried forward as its own re-fit item (W23). | WAVE2-PLAN Phase D; calibration audit; commits 99482c8, 7e05c97 | resolved (B1) — first full band lock |
| W2 | **Endgame flag ship/hold decision** — **resolved: default ON** (commit 6260cae). The flag-on OT-share re-measurement now exists in-repo terms: OT 2.06% → 3.33% toward the cited 4.80%, n=1260/arm (endgame-flag survey, 2026-07-28). `params.endgame` magnitude dials registered (commit 8e80b02); flag-on batch/sweep plumbing landed (06334f0, f839923 — default-config tasks now grade the SHIPPED default by omitting the key). Residual OT gap and the Q4-profile watch item are recorded in INTERNALS; distributional recovery is NOT booked to this flag (measured distribution-neutral — margin-distribution survey). | WAVE2-PLAN Phase D; SWARM-PLAN wave 4 | resolved — default ON |
| W3 | **B3 — 30-roster league fitting** off the 184-game corpus (`rosters:fit`; fit rosters together so players are each other's cast). `data/nba/` still holds only the two example packs. Also unblocks D2's 5-7% mid-range aspiration. | WAVE2-PLAN Phase C | not started |
| W4 | **B6 — Turing round 2** (n≥60, fresh judges, late-game windows) — the promised before/after number for the whole wave. No artifacts exist. | WAVE2-PLAN Phase C; SWARM-PLAN wave 3 | not started |
| W5 | **B7 — prediction backtest** (Brier, log loss, calibration curves) via the season layer; `docs/SEASON.md` still calls it planned. | WAVE2-PLAN Phase C; SWARM-PLAN wave 3 | not started |
| W6 | **n=96 band adjudication before declaring D1 closed** (parallel runner exists; the only mention of n=96 on the branch is the plan itself). Assisted share now measures inside at n40 — confirm at n=96. | WAVE2-PLAN Phase B.4 | not started |
| W7 | **LeBron fixture correction** — resolved (commit f8e510a): `freeThrow` 74 → 61, the engine's own curve as the citation (curve 73.2% vs his real 73.1%; measured 73.95% over the 40-game CLI slate, n=238 FTA, binomial z=0.27). Fidelity gate 18/18. | WAVE2-PLAN Phase B.3 | resolved |
| W8 | **NCAA R2 — `keyWidthFt` UNWIRED**: the pack ships `keyWidthFt: 12` but no code reads it (`rulepack.ts` marks it UNWIRED; `classifyShot()` zones by rim distance). The planned 12-ft-lane bug fix is constant-deep. R3 + R5-inventory items from `data/ncaa/README.md` also unaddressed in the engine. | WAVE2-PLAN Phase C (B4) | open (labeled) |
| W9 | **Stale unitless speed comments — narrowed to the `params.ts` half.** The texture tool's printed references now import the citation file (commits f8a7c35 + 869bb3f: speed 4.22 mph = 6.19 ft/s, passing ~2.84-2.86 — the printed numbers ARE the citation), and the definitional trap (AVG_SPEED ≠ distance/minutes, ~7% both seasons; sim chord speed a third quantity) is stated where it prints. The `params.ts` comment sites (~:1056, ~:1076 at the branch tip) still repeat unitless "NBA ~4.2" at exactly the dials a sweep agent reads — verified still present 2026-07-28 via grep; remains open (comment-only, Phase-B code change, docs-tier fingerprint rule applies). | speed-units audit; commits f8a7c35, 869bb3f | partially resolved (params.ts half open) |
| W10 | **Red-team MINOR-1** — `stats/box.ts` folds shot-clock turnovers into the holder's player TOV line; the wave's own turing renderer follows bbref's team-turnover convention (10/10 in corpus). Scoring-convention decision needed (box fold philosophy + consistency.test.ts assert current behavior). | FINDINGS-REDTEAM.md | open (decide or record as deliberate) |
| W11 | **Red-team MINOR-2** — resolved (commit ce64b1d): stop_run now requires `!advanceWindow \|\| margin > 0` — a leading team being run on can call timeout inside the advance window; trailing-only advance and tied-side suppression unchanged (unit truth-table probe, 6 states). Instrumented rarity before the fix: 0.95% of games (n=1260 flag-on, survey F6). Register wording corrected in passing: the window is `timeoutAdvanceClockSec` = 45 s at defaults, not "~2 minutes". | FINDINGS-REDTEAM.md; commit ce64b1d | resolved |
| W12 | **Red-team MINOR-3** — `sim/resolve.ts` resolveTeamReboundSide coin-flips 50/50 when nobody is within reach (no closest-player fallback, unlike resolveRebound); docstring discloses the coin, behavior unchanged. | FINDINGS-REDTEAM.md | open |
| W13 | **Red-team MINOR-4** — resolved (commit d6d6157): `--games 0` (and any non-integer < 1) exits 1 loudly before simulating; gating semantics unchanged. | FINDINGS-REDTEAM.md; commit d6d6157 | resolved |
| W14 | **OOS distributional regression — re-based and mechanism-owned.** Quote the n=240 values (mean \|m\| 14.48 / blowout 29.2% / close 20.0% / OT 1.7% vs real 12.58 / 19.1% / 23.3% / 4.80% — margin-distribution survey 2026-07-28, flag-off pre-integration main; the oos-60 draw overstated close-share and the mean). Mechanism adjudicated: universal diffusion + missing cross-team coupling; not sweep-reachable; endgame-neutral. The B2 rows below (W17/W18) own the fix; stays report-only. Post-winner re-read at the landing: `npm run oos` 17/17 bands, \|m\| 14.5 / sd\|m\| 9.7 / blowout 30% / close 22% / OT 3.3% (60-game single draw, endgame-ON default — indicative per §4.4; adjudicate at n≥240). | calibration audit; docs/INTERNALS.md; margin-distribution survey | re-based — mechanism owned by W17/W18 |

D1b (n=96 confirm → W6), D3 (corner spots; blocked on shot-mix state), D6,
D7 carry forward from the register above unchanged.

## Open items — B1 integration landing (registered 2026-07-28)

Registered at the `calib/integration` landing (winner bake `7e05c97`).
Numbering continues the wave-2 table. The out-of-repo survey/design
citations ("fouls-mechanism diagnosis", "endgame-flag survey",
"margin-distribution survey", "design-coupling" / "design-garbagetime" /
"design-passvolume" findings) follow the branch's commit-message
convention — the swarm run's findings files.

| # | Item | Source | Status |
|---|---|---|---|
| W15 | **Charge-composition fix** — `chargePerDrive` 0.012 → 0.0034 (was consumed per tick, ~0.024/s of committed drive time; charges 4.4-4.8/tg ≈ 3× the real ~1.3 and 3× its own comment's intent; ~30% of all TOV as `off_foul`). Post-fix charges 1.16/1.31/1.28/tg (3×16-game bases). Knob registered `foul.chargePerDrive` [0.0015, 0.008] — was SWEPT-tagged but never sweepable (AGENTS §1.4 failure mode). Residual doubt recorded in the diagnosis: drive-commit EXPOSURE (s/game in driveUntil windows) is not event-visible; an instrumented counter would split rate-vs-exposure. | fouls-mechanism diagnosis (2026-07-28, n=288 team-games); commit 2d47954 | resolved — pf at landing 21.0 (n=96) / 20.3 (verify 40×3 means), mid-band |
| W16 | **ftBasePct sweep floor correction + directed re-search** — the range lo WAS the fitted value (explore-up-only rail); the optimizer converged at the wall with league FT ~2pp above real 78.4%. Floor 0.69 → 0.66 (commit 5e0c500); star FT tripwires the guardrail. Re-search ran as an 8-strategy parallel search (12-cell response grid + decision analyst's exact n=48 pass-probability model; the fga BAND itself adjudicated generous vs the sourced 88.9 — move the sim, never the band; search-actuary/search-grid findings). Winner baked (commit 7e05c97): `pass.riskBase` −4.1869 → −3.95, `shot.ftBasePct` 0.69 → 0.666 → verify 40×3 17/17 ×3 (means fga 91.30, ftPct 77.92%), n=96 acceptance 17/17 (91.6 / 78.0%), CI-mirror 48 gate PASS. | commit 99482c8 residual note; commits 5e0c500, 7e05c97; search-actuary + search-grid findings | resolved — first full band lock |
| W17 | **B2 — score-pressure coupling mechanic.** THE margin-distribution mechanism: sim corr(home,away) ≈ 0 vs NBA +0.254; self-play mean \|m\| 15.0/30% blowouts at zero talent gap; sweep-unreachable (objective-blind, band-blocked, ~16-pt arithmetic sd floor). Candidate shape recorded: a 7th concept (or concept 6 ungated from the final period) — margin-proportional intensity tilt, both signs, ~1.0-1.3 pts/qtr per 10-pt margin ≈ 10-13% mean-reversion/quarter; one params.ai scale + knobs.ts entry so the sweep owns it after it exists. Executable design ready: design-coupling findings. Mechanics tier (§4.3 ladder + noise-floor regen). | margin-distribution survey (2026-07-28, 880 flag-off + 240 flag-on games, 4 cohorts); design-coupling findings | open (B2; design ready) |
| W18 | **B2 — garbage-time rotation policy.** Blowouts grow +6-8 in Q4 instead of flattening (blowout-only \|m\| Q1→Q4: 8.4→13.6→18.9→27.4); subs.ts crunch branch covers only \|margin\| ≤ 10 — at ≥11 normal fatigue rotation runs and starters play blowouts to the horn. Candidate: a "concede" branch (final period, margin ≥ ~18: both benches, leader first); trims the 30+ tail (13.8% self-play vs real 6.3%). Partial (~−0.5-1.0 mean \|m\|); pairs with W17. Executable design ready: design-garbagetime findings. | margin-distribution survey; design-garbagetime findings | open (B2; design ready) |
| W19 | **B2 — pass-volume mechanism.** Measured 1.97 passes/possession at the landing (`npm run texture`, 2026-07-28, 8 games single base; 1.93 on 2026-07-27) vs cited ~2.84-2.86 (tracking-references-2023-24.json). Named cause: pass-back damping overshot (pre-damping baseline 2.95); the winner's riskBase re-price costs a further ~0.1-0.2 (risk pricing is a pass-volume lever). Decision-layer work, not a knob trim — design ready (design-passvolume findings): early-shot-clock probe window + coordinated riskBase re-price, ~+25 passes/team-game honest first increment; the full +80/tg gap is a multi-phase arc. | texture reads; commits f8a7c35/869bb3f (citation); design-passvolume findings | open (B2; design ready) |
| W20 | **Stale engine comment: `sim/state.ts` ENDGAME LAYER doc block** said "false is the default and the byte-identical legacy path" — falsified by commit 6260cae (default ON). Fixed docs-tier (comments only, fingerprint identical) in commit ce34047. | verified at tip 2026-07-28; commit ce34047 | resolved |
| W21 | **Flow/batch off-vs-on comparison collapsed by the default flip.** Default-config tasks deliberately OMIT the endgame key (parallel.ts) so they grade the shipped default — which is now ON; `flowEndgame`/`batchEndgame` FORCE ON. The two arms therefore measure the same config and the layer's off/on comparison (`flowEndgame`'s stated purpose) is unreachable without an explicit `endgame:false` task. Also stale in the same file: the playGame doc comment still ends "(the shipped default is OFF)". Decide: add explicit-false legacy tasks, or retire the comparison and update the comments. | flag-plumbing report; parallel.ts at tip | open (decide) |
| W22 | **`/tmp/hoopsh-runner-job-*` litter on failed workers.** parallel.ts writes a job file per slice and keeps it on failure BY DESIGN (hand re-run recipe, run-worker.ts:15) but nothing ever reaps kept files — repeated failed/aborted runs accumulate tmpdir litter (wrench's report). LOW: age-based reap on runner start, or a documented cleanup note. | wrench report; parallel.ts:211/230 | open (low) |
| W23 | **`decide.moveCutFinish` re-fit** — parked at 0 and off the sweep surface (a live dial on ~30% of attempts; see its `params.ts` comment block). Carried out of W1: the coordinated sweep and the winner re-center both ran without it. Re-fit needs its own measured case before re-registration in knobs.ts. | W1 carry-forward; params.ts comment block | open (re-fit item) |

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
| 9 | Mid-range game vestigial (~2%) | **resolved (wave 2)** — was deferred D2; shipped as the mid-range restoration (`8c5b76b`, `ebf8ee7`), gated by `midrange.test.ts` |
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
