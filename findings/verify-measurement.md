# verify-measurement — adversarial verification of measurement-domain findings

Verifier pass over 11 dispatched items from findings/opt-noise.md, opt-gates.md, engine-surface.md,
opt-sweep.md, opt-fit.md, opt-validate.md. Every cited line re-read at HEAD (2436ce9); git claims
re-derived; arithmetic re-computed; probes re-run within a 4-simulated-game budget (spent on item 8).

## 1. Noise floor predates the dunker dive — VERDICT: CONFIRMED-WITH-CORRECTION

Ancestry re-derived: `git merge-base --is-ancestor 5496580 15b37c0` holds and the reverse does not;
5496580 (2026-07-31 16:54) is a strict ancestor of the dive 15b37c0 (19:31), the dive is in HEAD, and
`git log HEAD -- packages/harness/src/noise-floor.gen.ts` ends at 5496580. Arithmetic verified from the
committed gen file: fgPct n40 mean 0.48087, sd 0.0049901 → se 0.000789; (0.491 − 0.48087)/se = 12.84se
(claimed ~12.8 ✓); drift headroom |0.491 − 0.481127|/0.0073799 = 1.34σ of the 3.5σ Zd (✓,
realism.test.ts:72-89 confirmed to anchor on the floor's n24 means); the ~22% n=48 ceiling-hug breach at
49.1 vs 49.5 recomputes to 22.2%. W73's REGISTER row (line 206) records goldens/pins re-anchors
(9a99ce9 touched tests + REGISTER only) but neither a floor regen nor a deferral; CALIBRATION.md's
measured-state section carries no 2026-07-31/0.3.0 block. CORRECTIONS: (a) "no gen-file commit exists
after 5496580" is true only at HEAD — commit 77883c8 ("noise floor regenerated at the pass-volume
landing", 2026-07-31 23:59) exists on the unmerged branch `origin/feat/pass-volume-2`; it post-dates the
dive but measures that branch's further live engine changes (pass-volume increments), so it is not a
HEAD floor and the HEAD-state finding stands; (b) three of the cited prior-regen hashes
(4bd7a72/7e814a5/33c65e4) do not resolve in this clone (they are REGISTER-quoted hashes) — the
regen-per-landing pattern is still real in resolvable history (5f52ab7, 1c56714, 281138e, a8ea7a5,
e74d513). HIGH severity stands.

## 2. astdShare center below the 0.54 floor; W69/W73 single-draw 17/17 — VERDICT: CONFIRMED-WITH-CORRECTION

Facts verified: bands.ts:67 enforces lo 0.54 with no ratchet; the committed floor measures the center
below it at all tiers (n12 0.53969 / n24 0.53884 / n40 0.538494); W69's flip commit 4b58b0e (16:35)
precedes the floor regen 5496580 (16:54) by 19 minutes; per-draw pass probability under that center is
~42-43% at n=48 (claimed ~41%, same conclusion); RATCHET_FLOOR is 16 at cli.ts:87; no 0.3.0-era
measured-state block exists. TWO CORRECTIONS. First, resolution: the floor's own se on the n40 grand
mean is 0.008571/√40 = 0.00136, so the center sits 1.1se below the edge — by calreport's own 2se rule
the committed instrument reads "edge-unresolved", not decisively OUTSIDE (opt-noise's LOW at
CALIBRATION.md:137 phrased this correctly; opt-gates' headline overstates instrument resolution).
Second, tense: the orchestrator's 9 fresh verify bases at n=40 at HEAD passed astdShare 9/9; under the
committed center the per-base pass probability is ~0.43, so P(9/9) ≈ 0.43⁹ ≈ 5×10⁻⁴ — the committed
center is decisively rejected for HEAD. The dive plausibly moved it (dump-off catches are assisted
makes; the unmerged pass-volume branch floor reads 0.614). Correct present-tense statement: at HEAD the
astdShare center sits INSIDE its band and the committed floor row is stale (item 1); what remains true
is historical/process — W69's registered "BACK IN BAND at 54.2" was a single n=48 draw contradicted by
the same-hour 1600-game instrument (a ~43% coin), the center-on-edge recording rule was not followed
for the 0.3.0 era, and W73's "17/17" was likewise a single draw (though, post-dive, probably an honest
pass). Proposed severity: MEDIUM (ledger/adjudication honesty); the live-instrument component belongs
to item 1's HIGH.

## 3. bands.ts REAL provenance while author-recalled; sourced file feeds no bands — VERDICT: CONFIRMED

bands.ts:6-8 claims "Provenance: these are REAL numbers … a fan of the modern game would recognize";
ARCHITECTURE.md:206 states "author-recalled ranges today; sourcing them from real league data is an
active roadmap item"; AGENTS.md defines REAL as "measured basketball fact"; data/nba/README.md bans
recalled numbers "wearing the costume of an external source". Consumers of
league-averages-2023-24.json verified by grep: its own fetch script, the tracking-references
cross-validation, a knobs.ts comment, and calibration-eras.md — no code derives any band from it
(precision note: "feeds nothing" is shorthand; the finding's own text correctly lists the cross-check
consumers — the accurate claim is "feeds no band"). assistedShareOfFgm is null in the sourced file
while the astdShare band claims REAL. MEDIUM stands.

## 4. G6 ceiling-only / G8b no min-case floor / T1-T2 point-estimate + inverted bound / single-seed flowboard — VERDICT: CONFIRMED

All four re-read in scoreboard.ts at HEAD. G6 (≈783-798): rateOk `perGame <= 0.3`, decidedOk ≤ 0.05,
makes clause armed only at att ≥ 180 — an engine with zero heaves passes all three (0 ≤ 0.3, 0 ≤ 0.05,
makes unarmed); no existence floor. G8b: `b: bCases === 0 ? 0 : pulled/bCases` (468) gated
`inBand(v.b, 0.40, 0.75)` (817) with no bCases guard — at bCases=1 the share is 0 or 1, FAIL either
way; binomial se at the corpus ~66% and n≈13 is ~0.13 with ~25-29% ceiling-breach probability; CLI
default `--games 20` confirmed. T1/T2: verdict is `r.acc <= 0.55 ? 'PASS' : 'HIGH'` (717) — a point
estimate; the Wilson CI is printed and the adjacent comment names "CI lower bound touching 50%" as the
end state, yet the verdict never consults it; se arithmetic verified (se ≈ 4.2% at n=144; ~31% PASS at
true 57%; ~11% HIGH at true 50%); header line ~37 does say "read T1/T2 here as the discriminability
upper bound under fair representation", and the direction critique is statistically sound (a 6-feature
learned-threshold judge's held-out accuracy lower-bounds achievable discriminability); W56's verdict
quotes T1 52.8% [45%,61%] under "statistical indistinguishability". Flowboard: single `--seed`
(default 'flowboard', line 886), no multi-seed/pooling mode, versus CALIBRATION.md:32-33's
one-or-two-draws ban and the recorded G3 hand-pooling precedent (single-base verdicts flipped at
se ≈ 1.8%). All four MEDIUMs stand.

## 5. Eight SWEPT-tagged params never in knobs.ts — VERDICT: CONFIRMED

Tags verified at the cited params.ts sites: shot.skillCoef 0.5 ("… SWEPT." 1245-46), shot.blockSkillCoef
0.5 (umbrella "SWEPT." 1329-32), shot.blockGain 1.8 and shot.blockSkillWeight 0.14 ("— SWEPT"
1341-44), foul.shootMid 0.065 / foul.shootThree 0.0156 (umbrella "SWEPT" over the four foul rates,
1375-85), pass.laneRiskCoef 1.6 and pass.skillCoef 0.75 ("SWEPT" 1463-66). Git claim verified beyond
the requested 4: `git log --all -S <name> -- packages/harness/src/knobs.ts` is empty for all seven
distinct strings (skillCoef, blockSkillCoef, blockGain, blockSkillWeight, shootMid, shootThree,
laneRiskCoef) covering all eight params — never present in any revision, on any branch. All eight
values are round, contradicting params.ts:43-45's own "odd precision because a machine chose them"
doctrine. Counter-evidence hunted and absent: no REGISTER row names any of the eight (grep); W15
registers this exact failure class for chargePerDrive, W41 registers three different unsweepable
params, W23 registers moveCutFinish — the precedent of registering such gaps exists and was not
applied here. HIGH stands.

## 6. Verify holdout fixed forever; post-bake re-verify bit-identical — VERDICT: CONFIRMED

Seed derivation verified: SEED_BASES default 'swp-alpha,swp-beta,swp-gamma' (sweep.ts:76); verify
evaluates `${base}-verify` (sweep.ts:430); worker game seeds are `${seedBase}-${i}` (sweep-worker.ts:66)
— so every documented sweep's verify is the identical fixed string set swp-*-verify-{0..39}, 120 games
at --verify 40, in every era. The post-bake rung (CALIBRATION.md:17, `--iters 0 --verify 40`)
evaluates the empty candidate on the baked defaults = the winner's effective SimParams on the identical
seed strings → bit-identical games under the engine's CI-pinned determinism; it can catch only bake
transcription errors. Caveat that sharpens rather than weakens the finding: bit-identity holds when the
bake preserves full precision from out/sweep-best.json (params.ts's 16-digit values show that is the
practice); baking the 4-decimal console diff would break identity — the doc ambiguity opt-sweep files
separately. A `--seeds` escape hatch exists but no documented invocation uses it; W26 records the fixed
sample's edge flicker. MEDIUM stands.

## 7. Adoption from one frozen draw, zero threshold, no baseline-vs-winner OOS — VERDICT: CONFIRMED

sweep.ts:392 adopts on strict `evals[i].score < currentEval.score` — zero improvement margin — where
incumbent and all candidates are scored on the same frozen train seeds (`swp-*-{0..GAMES-1}`, CRN by
design). The verify (430) measures only the final winner; the baseline {} is evaluated once at line 382
on TRAIN seeds at search size only; out/sweep-best.json (474-483) stores score/bandFails/diff/candidate/
verify for the winner alone — no artifact ever compares baseline vs winner at verify size. The SE
context checks: pooled tpPct SE at GAMES=16 ≈ 0.0145 ≈ 58% of the 0.025 half-width, so SE-sized
centering deltas drive adoptions. Doctrine conflict (CALIBRATION.md:32-33) confirmed verbatim. MEDIUM
stands.

## 8. chargePerDrive comments claim ~1.3/tg; shipped value measures ~2/tg — VERDICT: CONFIRMED-WITH-CORRECTION

Comment staleness confirmed: params.ts:1431-1437 attributes "post-change measured 1.16/1.31/1.28 per
team-game" to a default that is now 0.005971976876462406 ("SWEPT at the FLOW landing"), 1.76× the
0.0034 those rates measured; knobs.ts:127-131 anchors the rail narrative on "the default's ~1.3 (real
NBA ~1.3)" — the rail's own linear mapping puts 0.0034 at ~1.33/tg and the shipped value at ~2.32/tg.
Probe re-run on a FRESH seed family (4 games, the full budget): 13 off_foul turnovers / 8 team-games =
1.63/tg; pooled with the reviewer's probe (16/8) → 29/16 = 1.81 ± 0.34/tg (Poisson se). CORRECTION on
magnitude: "measures ~2/tg" is one 4-game draw's point estimate; the defensible statement at this
budget is ~1.6-2.3/tg — materially above the documented ~1.3 anchor (~1.5σ pooled) and consistent with
the ~2.3 mapping, but a n≥16-per-base re-measure should precede quoting a number. The core defect (both
comment sites attribute the superseded measurement to the re-swept value; pf/tov bands cannot see the
composition) is confirmed. MEDIUM stands.

## 9. REF_CONTEST cites nonexistent anchor tests; comboGuard anchor drifted to 74 — VERDICT: CONFIRMED

fit-roster.ts:400-406 claims the three anchors are "calibrated so the … anchors invert onto themselves
… each anchor's check lives in the tests." Grep across all test dirs: the only consumers of
forwardThreePct/invertThree/zoneRefs are fit-roster.test.ts's round-trip (composes the fitter's forward
with its own inverse — REF_CONTEST cancels; verified the loop asserts only recovery ±1) and the 50s
fixpoint test (constructs its input FROM zoneRefs().leaguePct — moves with any REF change). No test
pins an anchor. Ran the fitter's own functions at HEAD: forwardThreePct(99, 0.15) = 43.8% (claimed
~45), 82 → 38.4% (holds), 70 → 34.7%, and invertThree(0.36, 0.15) = 74.0 against the documented
comboGuard-70 anchor — reproducing the finding's numbers exactly; invertThree(0.45, 0.15) = 99.0,
consistent with the ratingOf clamp masking the eliteShooter anchor's failure in the inverse direction.
HIGH stands.

## 10. Fidelity enforced targets fail at center; z=3 tier blind; CLI exits 0 — VERDICT: CONFIRMED-WITH-CORRECTION (register split stated)

Numbers verified against the committed floor and fidelity.ts: Jokic TRB n40 center 8.9219 (sd 0.697,
se 0.246 → the 10.0 floor sits 4.4se above center) vs the enforced 10-13 row still commented "ratchet
EARNED" (fidelity.ts:226); Jokic AST 6.6594 vs enforced 7-11; Curry 3PA-share 0.48860 vs enforced
0.50-0.68. Widened z=3 tripwire edges recomputed: TRB 10 − 3(1.0585) = 6.83, AST 5.64, 3PA-share 38.4%
— the only CI-enforced tier cannot see misses of this size (W29's own words concede this). CLI verified:
the import.meta.main block counts `failures` and prints, but the only process.exit is the --games
guard — enforced misses always exit 0 (at the floor's centers a 40-game TRB draw fails with ~94%
probability, so `npm run fidelity` would print FAIL rows and report success). REGISTER SPLIT, as
dispatched: the center misses are REGISTERED DEBT — W29 (TRB 9.62 vs 10 open owner-ruling; AST 6.98
on-edge; plus the tier-blindness sentence), W58 (post-shots un-gated), W71 (Curry 3PA-share 49.5 vs 50
+ AST/3P% drift, owner-ruling class) — though at magnitudes now stale-shallow (TRB 9.62→8.92, AST
6.98→6.66 per the committed floor). NEW and unregistered: (a) the fidelity.ts:226 "EARNED" tag
contradicting W29's own "the ratchet's premise predates the re-centered engine"; (b) the CLI
exit-0-on-failures gap (W32 covers only the Node <24.2 no-op mode of the same command lying green);
(c) CALIBRATION.md:47-50 presenting the suite as held-out validation with zero center caveat. Caveat:
all quoted centers are pre-dive measurements (item 1) — the dive moves interior economy, so
present-tense magnitudes need a regen; direction unknown. HIGH stands for the enforcement-gap package;
the miss inventory itself is KNOWN-DEBT (W29/W58/W71).

## 11. oos.ts jittered recombination, 12-of-132 matchups, tactics exclude training extremes — VERDICT: CONFIRMED (pairing count is KNOWN-DEBT, REGISTER D7)

Pairing claim re-derived numerically from the code at oos.ts:205-207 (hi = 11g mod 12, ai = 5g+1 mod
12 at TEAMS=12): exactly 12 distinct ordered pairs of 132 possible over 60 games (each played 5×),
still 12 at --games 600, every team meeting exactly 2 distinct opponents — matches the finding.
Tactics verified: generated 50 ± range(−14,14) → [36,64] (oos.ts:96-98), excluding the training pair's
pace 66/threeBias 68 and 46/44 (teams.ts:66,98). Basis reuse verified: oos.ts:24-27 imports the same
ten archetype builders sampleMatchup's teams are built from (+stretchBig). Register status: the
12/132 coverage is registered — D7 "naming/doc clarification, not a bug — deferred (doc-only)"
(REGISTER.md:30) — and the promised clarification has indeed not landed (the code comment still says
only "deterministic pairing walk"); the tactics-range exclusion and within-family-jitter framing are
new. MEDIUM stands, with the pairing-count half cited as D7 debt.

## Summary table

| # | Finding (short) | Verdict | Key evidence |
|---|---|---|---|
| 1 | Floor predates dunker dive; regen skipped, unregistered | CONFIRMED-WITH-CORRECTION | merge-base verified; 12.84se / 1.34σ recomputed; post-dive regen 77883c8 exists but only on unmerged feat/pass-volume-2 |
| 2 | astdShare center outside 0.54 floor; single-draw 17/17 | CONFIRMED-WITH-CORRECTION | Committed centers 0.5385-0.5397 verified, but only 1.1se below (edge-unresolved) and stale: 9/9 fresh n=40 bases pass at HEAD (p≈5×10⁻⁴ under committed center) — historical/ledger finding, propose MEDIUM |
| 3 | bands.ts REAL claim vs author-recalled; sourced file feeds no band | CONFIRMED | bands.ts:6 vs ARCHITECTURE.md:206; grep shows no band derivation; assistedShareOfFgm null |
| 4 | G6 ceiling-only; G8b no n-floor; T1/T2 point gate + inverted bound; single-seed flowboard | CONFIRMED | All clauses re-read; zero-heave passes G6; se arithmetic verified; single --seed confirmed |
| 5 | 8 SWEPT params never in knobs.ts | CONFIRMED | git log --all -S empty for all 8 (7 strings); tags + round values at cited lines; no REGISTER row |
| 6 | Verify holdout fixed forever; post-bake re-verify bit-identical | CONFIRMED | swp-*-verify-{i} fixed strings; empty-candidate-on-baked-defaults = winner params; full-precision bake practice confirmed |
| 7 | Zero-threshold adoption on frozen draw; no baseline OOS | CONFIRMED | sweep.ts:392 strict <; verify measures winner only; sweep-best.json has no baseline |
| 8 | chargePerDrive ~2/tg vs documented ~1.3 | CONFIRMED-WITH-CORRECTION | Fresh probe 1.63/tg; pooled 1.81±0.34 — above 1.3, but "~2/tg" is one draw's point estimate; comment staleness fully confirmed |
| 9 | REF_CONTEST anchor tests nonexistent; invertThree(0.36)=74 | CONFIRMED | Ran fitter functions: 43.8%/38.4%/34.7%, invert 74.0 — exact match; no anchor test exists |
| 10 | Fidelity targets fail at center; tier blind; CLI exit 0 | CONFIRMED-WITH-CORRECTION | All floor numbers verified; misses = W29/W58/W71 known debt (now deeper); EARNED tag, exit-0 gap, CALIBRATION framing = new |
| 11 | oos 12-of-132 pairs; tactics exclude training extremes | CONFIRMED | Enumeration: 12/132, 2-regular; tactics [36,64] vs 66/68 & 46/44; pairing count = D7 known debt |

Totals: CONFIRMED 7, CONFIRMED-WITH-CORRECTION 4, OVERSTATED 0, WRONG 0, standalone KNOWN-DEBT 0
(known-debt components noted inside items 10 and 11).
