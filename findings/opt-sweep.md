# opt-sweep
scanned: packages/harness/src/sweep.ts (501), packages/harness/src/sweep-worker.ts (84), packages/harness/src/solve.ts (287), packages/harness/src/knobs.ts (293), packages/harness/test/knobs.test.ts (103); context read: bands.ts (68), aggregate.ts (207), args.ts (146), engine sim/params.ts (knob sites), sim/resolve.ts (shotMakeP/freeThrowP), sim/game.ts (initState/simulateGame), core/rng.ts, fidelity.ts#runBenchmark, docs/CALIBRATION.md, AGENTS.md, docs/REGISTER.md (sweep rows)
critical: 0   high: 0   medium: 5   low: 11

The search algorithm, identified precisely: greedy perturbation local search
(hill climbing) — per iteration, CANDS=4 candidates are proposed by nudging
1-3 of the 46 registered knobs from the incumbent (gaussian ≈ Irwin-Hall,
scaled by step × knob range, clamped to rails), each evaluated at GAMES×3
seed bases in a fresh subprocess, best adopted only on strict improvement,
step decayed ×0.93 floored at 0.06. Not CEM, not coordinate descent, no
worse-move acceptance — the header states this honestly. The objective
(scoreResults) is, per (seed base × band) pair: out-of-band, 0.25 + 4·(distance
past edge)/width; in-band, 0.25·|v−mid|/(width/2) — so it rewards CENTERING,
not mere membership, and is continuous at band edges (verified). "Score 4.115"
in CALIBRATION.md is a 17/17-passing verify's summed centering residue
(all-pass scores sit in ~4-5 of a 12.75 in-band maximum over 51 pairs; 0 would
mean dead-centered on all three bases). For 46 knobs against 17 bands the
problem is grossly under-identified; CALIBRATION.md admits this openly
("locked ... not that it is identified") — the findings below are where the
machinery's practice falls short of its own doctrine, not that admission.

## MEDIUM packages/harness/src/sweep.ts:409 - Early stop is unreachable under the default (margin) objective; its threshold predates the objective it now gates
`if (currentEval.score < 0.35 && failCount(...) === 0) break;`. Git shows 0.35
was born in the original sweep commit (e42e4cd) when centering weight was the
legacy 0.015/band (all-pass ceiling 51×0.015 = 0.765, so 0.35 ≈ mid-convergence).
The margin objective (64937d2) raised CENTER_W to 0.25 — all-pass ceiling
12.75 — and kept 0.35. Sampling noise on the tight ratio bands alone exceeds
the whole budget: at GAMES=16 (32 team-games/base, ~1090 3PA), tpPct SE ≈ 0.0145
≈ 0.58 of its half-width 0.025, contributing E ≈ 3 × 0.25 × 0.47 ≈ 0.35 even at
perfect true centering; the repo's own all-pass verifies scored 4.115 and 4.461
(CALIBRATION.md:194, REGISTER W1) — 12× the threshold, at the LARGER verify n.
So every margin-mode sweep burns its full ITERS budget, and the header's claim
at sweep.ts:28 ("search stops early at a verified 0" — itself wrong: score 0
additionally requires dead-centering, which is why the code ANDs failCount)
never happens. The comment's stated rationale at sweep.ts:403-408 ("exists
mainly to skip the failCount recomputation") is also false: line 402 computes
failCount unconditionally every iteration for the log line.
Breaks: a documented convergence behavior (dead under the shipped objective);
wastes full-budget sim work after convergence; two misleading comments at the
exact point of confusion.

## MEDIUM packages/harness/src/sweep.ts:392 - Every adoption is adjudicated from one fixed draw with a zero improvement threshold; nothing compares winner vs. baseline out-of-sample
Selection accepts any strict train-score improvement (`evals[i].score <
currentEval.score`, line 392) on ONE frozen sample: all ~112 candidate
evaluations of a default run score the identical 48 games
(`${seedBase}-${i}`, i = 0..GAMES−1, sweep-worker.ts:66 — common random
numbers, deliberately). CRN makes comparisons fair, but the winner is the
argmin over a fixed finite draw, and at GAMES=12-16 the centering deltas on
tpPct/ftPct/fgPct/astdShare are SE-sized (tpPct SE ≈ 58% of half-width, above),
so a large share of adoptions encode that draw's noise, and the baked SWEPT
digits ("keep the odd precision") partly encode frozen seed luck. The verify
(sweep.ts:430) measures the final winner honestly on disjoint seeds — but only
its absolute band pass/fail; neither the run nor out/sweep-best.json
(sweep.ts:474-483) ever evaluates the BASELINE at verify size, so for a
re-center run that starts from a passing state there is no paired evidence the
adopted diff beats the incumbent defaults out-of-sample at all. This is the
sweep adjudicating every step from one draw while CALIBRATION.md:32-33 forbids
exactly that ("Never adjudicate anything from one or two draws — that is
chasing noise"); the pre-committed mitigation (the TIDY test, sweep.ts:212-213)
is a human procedure no code applies.
Breaks: SWEPT-value provenance — re-center diffs can be pure selection noise
that still verifies "17/17", and marginal centering claims between eras are
unfalsifiable from the machinery's own output.

## MEDIUM packages/harness/src/sweep.ts:430 - The verify holdout is one fixed 120-game sample reused forever; the documented post-bake verification replays the tuning run's own verify games exactly
Verify bases are deterministic derivations of fixed defaults
(`swp-{alpha,beta,gamma}-verify`, sweep.ts:76/430), so every sweep in every
era certifies "locked" against the same 120 games. Two consequences. (a) The
workflow's re-verify step (CALIBRATION.md:17: bake the diff, then `npm run
sweep -- --iters 0 --verify 40`) simulates the identical seed strings with the
identical params as the tuning run's own final verify — bit-identical games by
the engine's determinism guarantee — so it can only detect transcription
errors in the bake, never add held-out evidence; presenting it as the
verification rung overstates what it measures. (b) Repeat-until-pass usage
(re-tune when a verify fails, as the ladder prescribes) is selection ON the
holdout across runs: a candidate that passes swp-*-verify by draw luck gets
baked, and the same 120 games then "confirm" it every subsequent era.
REGISTER W26 records exactly this sample's edge behavior ("the breach MOVES
BASE between adjacent runs at per-base se ≈ 0.5"). Era-salting the verify
bases (or any fresh-seed policy) would cost nothing.
Breaks: train/verify separation over time — the M-23 within-run fix does not
extend across runs, and the "locked" certification never sees fresh seeds
unless someone passes --seeds by hand.

## MEDIUM packages/harness/src/knobs.ts:53 - Five SWEPT-tagged params are absent from the registry the tag points at (unsweepable in practice), plus one "awaits the coordinated re-sweep" the sweep can never reach
The SWEPT tag means "found by the optimizer hunting the 17 acceptance bands"
(params.ts:43) and DO-NOT #1's remedy for a suspect value is "re-run the sweep
and bake its output" — but the sweep can only move SWEEPABLE paths, and these
SWEPT-tagged params are not in it: `shot.skillCoef` (params.ts:1246),
`shot.blockGain` (params.ts:1342) and `shot.blockSkillWeight` (params.ts:1344)
— both explicitly "tuned to the 3.5-6.5 blocks/game band" yet only
shot.blockBase is registered — `pass.laneRiskCoef` (params.ts:1464), and
`pass.skillCoef` (params.ts:1466). params.ts:1434-1436 names this exact class
as a past failure mode it fixed for chargePerDrive ("Previously tagged SWEPT
but never registered in harness/knobs.ts (unsweepable in practice)"; REGISTER
W15 calls it an AGENTS §1.4 failure mode), and REGISTER W41/W23 show the repo
records such gaps as debt rows — none exists for these five. Separately,
`decide.stealBreakBonus` (params.ts:1741) is tagged "FEEL (probe-verified,
awaits the coordinated re-sweep)" but is unregistered, so the awaited sweep
can never touch it — and coordinated sweeps have since run (W1, the FLOW
re-fit). Note the doctrine tension: shot.skillCoef/skillCoefThree are "what a
rating cashes out to in shot-make logits", which knobs.ts:19-23 excludes from
the sweep BY DESIGN — if that exclusion is intended here, the SWEPT tags are
the wrong label; either way params.ts and knobs.ts currently disagree about
who owns these values.
Breaks: provenance trust and the documented re-tune remedy — the machinery
cannot reproduce values it claims to own, and the blocks band has only one of
its three claimed levers actually reachable.

## MEDIUM packages/harness/src/knobs.ts:127 - chargePerDrive's rate anchors describe the superseded default; the re-swept value measures ~2 charges/team-game against the "~1.3 (real NBA ~1.3)" the rail was built around
knobs.ts:127-131 documents the rail as spanning "≈0.6 (lo) → ≈3.1 (hi)
offensive fouls per team-game around the default's ~1.3 (real NBA ~1.3)", and
params.ts:1431-1433 still says "hand-set to land the real rate (post-change
measured 1.16/1.31/1.28 per team-game on three 16-game seed bases)". Both
describe the W15 value 0.0034. The shipped default is 0.005971976876462406
(params.ts:1437, re-SWEPT at the FLOW landing) — by the comment's own linear
exposure mapping that is ~2.3/tg, and a 4-game probe at HEAD measures 2.00/tg
(16 off_foul turnovers over 8 team-games; Poisson se ≈ 0.5 — small sample per
the noise doctrine, but consistent with the mapping and well above 1.3). So
the optimizer traded a band-invisible composition (charge share of TOV/PF is
not banded; only their totals are) ~50-80% above the real anchor rate, and
both comment sites now attribute the old measurement to the new value — the
same "bands cannot see composition" class knobs.ts itself documents for
ai.swingBase (knobs.ts:155-159). Re-measure at n≥16 games per base and either
re-anchor the comments to the measured rate or treat the excursion as a
distributional-floor case like ai.scorePressureScale's lo rail.
Breaks: a documented REAL anchor — any agent reading either comment believes
the shipped value lands ~1.3/tg when it lands ~2; the pf/tov bands cannot
catch it.

## LOW packages/harness/src/sweep.ts:18 - Header says "40 SWEEPABLE paths today"; the registry holds 46
Counted by direct evaluation of SWEEPABLE at HEAD: 46 entries, all resolving.
The same sentence says "count them in knobs.ts, the registry is the source of
truth" — the hedge is right and the quoted number is exactly the stale-count
pattern CALIBRATION.md:33-34 bans for pass-rates ("never quote a stale
pass-rate — state where to measure it instead").
Breaks: doc accuracy in the module header agents read first.

## LOW packages/harness/src/sweep.ts:259 - failCount doc cites AGENTS §4.4 locked-state language ("46-48 of 48 checks passing") that exists nowhere, with a check count two eras stale
Grep finds "46-48" / "of 48" in neither AGENTS.md nor docs/*.md; AGENTS §4.4
is now a pointer to CALIBRATION.md, which carries no such phrase. The count
itself is 17 bands × 3 bases = 51 checks since astdShare was enforced
(bands.ts:67); 48 = the 16-band era.
Breaks: a comment that sends readers hunting for doctrine text that was moved
and reworded, quoting a superseded band count.

## LOW packages/harness/src/sweep.ts:326 - gaussian() comment calibrates its FEEL scale "at step=1.0 (the search's largest step size below)"; the largest step is 0.22
`step` initializes at 0.22 (sweep.ts:385) and only decays. Either the 1.6
scale was tuned against a step regime that no longer exists (historical) or
the comment misdescribes the tuning point; the actual proposal sd at the
largest real step is ≈ 0.92 × 0.22 ≈ 0.20 of a knob range, not ≈ 0.92.
Breaks: the comment's stated provenance for a FEEL constant.

## LOW packages/harness/src/sweep.ts:382 - The --iters 0 verification rung burns a search-size baseline evaluation whose result gates nothing; the two law docs disagree on the workaround
main() evaluates the empty candidate at GAMES×3 on TRAIN seeds before the
loop, unconditionally. With ITERS=0 the loop is skipped and verify re-measures
{} at verify size, so those games buy only a console line ("baseline score",
train seeds, small n — easy to misread as the verdict). AGENTS.md:145 works
around it (`--iters 0 --games 4 --verify 40`, 12 wasted games);
CALIBRATION.md:17's command for the same rung omits --games, wasting 48 games
(≈ 29% of the rung's sim budget) every documented post-bake verification.
Breaks: sim budget on a 2-core box; consistency between the two documents that
both claim law status for this rung.

## LOW packages/harness/src/sweep.ts:75 - Default --verify is 24 games/base; the "locked" bar the verify exists to certify is defined at 40+
CALIBRATION.md:43 : "'Locked' means: at 40+ games, every band's measured
CENTER sits inside its band." A bare `npm run sweep` (the header's own usage
example shows no --verify) writes out/sweep-best.json whose headline
score/bandFails are measured at 24×3 — below the doctrine's sample size, with
nothing in the output flagging that. Every documented invocation overrides to
40, which is how the default stays silently sub-doctrine.
Breaks: nothing when the ladder is followed; the default-flag path
under-samples the one number that gets quoted.

## LOW packages/harness/src/sweep.ts:452 - The console diff rounds to 4 decimals while the doctrine says "bake the printed diff ... keep the odd precision"
`console.log(\`  ${path}: ${from} → ${Number(value.toFixed(4))}\`)` — but
CALIBRATION.md:16-17/38-39 instructs baking the PRINTED diff with odd
precision kept, and shipped defaults carry full float precision (e.g.
params.ts:1437's 0.005971976876462406, 16 significant digits — provably baked
from out/sweep-best.json, which stores full precision, not from the console).
Following the doc literally changes the params (and makes the post-bake
verify genuinely diverge from the tuning run's verify); under the margin
objective's TIDY criterion the 4-digit bake should be safe, but then "keep the
odd precision" is the wrong instruction. The doc and the two output channels
disagree about which artifact is the bake source.
Breaks: the bake step's instructions — ambiguous between two artifacts that
differ in the digits the doctrine says to preserve.

## LOW packages/harness/src/sweep.ts:282 - Single-candidate evaluations use one worker: the verify's 120 games run serially on one core while the rest idle
Parallelism is across candidates only (evalBatch slices of WORKERS);
evaluateCandidate runs its 3 seed bases sequentially inside one subprocess
(sweep-worker.ts:50). The baseline eval (sweep.ts:382) and the verify
(sweep.ts:430) are single candidates, so a --verify 40 tail is 120 games on
one core — roughly 10% of a documented re-tune's wall time, and the WHOLE run
for the --iters 0 rung — with WORKERS−1 cores idle. Farming seed bases as
separate jobs for single-candidate evaluations would halve that on the target
2-core box. (evalBatch's slice barrier and no-AbortController asymmetry are
already recorded as deliberate — REGISTER W50; not re-filed.)
Breaks: wall-clock only; worker-pool load balance on the machine the header
says the design targets.

## LOW packages/harness/test/knobs.test.ts:73 - Stale line citation: "setPath JSDoc, knobs.ts:226-241" points at the endgame-knobs comment block
setPath's JSDoc sits at knobs.ts:269-277; lines 226-241 are the endgame
registration comments. The registry grew above the helpers and the citation
was not moved. (The other citations in this test file — knobs.ts:2-5, 34-44,
40-43 — verify correct.)
Breaks: a test-spec pointer; trivial, but this repo's convention is exact
citations.

## LOW packages/harness/src/solve.ts:68 - --iters/--cands accept negative or fractional values silently — the same no-op class sweep.ts hardened against after an incident
sweep.ts:77-84 added integer-≥-min floors because "a finite-but-negative count
no-ops the same way NaN did" (scan B2-1). solve.ts validates only through
flagNumber (finite check): `--iters -1` or `--cands 0` silently skips the
whole refinement and prints the raw analytic seed as the solved profile
(--games is guarded, but only downstream by runBenchmark's own throw). The
held-out verify line still prints an err a human can notice, which bounds it.
Breaks: the loud-input policy args.ts exists for, on the one harness CLI that
emits roster-ready JSON.

## LOW packages/harness/src/solve.ts:90 - Analytic seed hardcodes the FT knee/ramp (0.6, 0.4) and the three-point ambient (−0.055) instead of reading the params it already has in scope
The FT inversion (solve.ts:90-98) duplicates params.shot.ftEliteKneeN /
ftEliteRampN (params.ts:1326-1327) as literals, and the 3P% ambient's −0.055
(solve.ts:105) duplicates shot.distPenaltyThreePerFt × 1 ft beyond the line
(params.ts:1339) — all reachable as S.* on the line above. Algebra verified
correct against resolve.ts:freeThrowP at today's values; a future params
change silently degrades the seed (refinement absorbs it, so impact is
convergence speed, not correctness).
Breaks: nothing today; a quiet coupling that will drift the first time the FT
elite-tail shape or the deep-three penalty moves.

## LOW packages/harness/src/solve.ts:233 - import.meta.main gate makes `npm run solve` a silent success no-op on Node 24.0/24.1
`if (import.meta.main)` guards the whole script body; import.meta.main landed
in Node 24.2.0, and package.json engines allows ">=24". On 24.0/24.1 the
expression is undefined → falsy → solve (and the other four harness CLIs using
the convention) runs zero code and exits 0 — the exact silent-no-op class this
repo's incident notes hate. Verified working on this box (v24.14.1); the gap
is only the engines floor.
Breaks: nothing on current Node; a floor bump to >=24.2 (or a runtime guard)
closes it.

## What is done well
- The header's honesty about the algorithm is exemplary: it names what the
  search is (perturbation local search), what it is NOT (gradient descent,
  CMA-ES, annealing), why (2-core parallelizability over per-iteration search
  quality), and pins the revisit condition — no aspirational vocabulary.
- The objective is genuinely well-constructed for a direct-search method:
  centering pressure (margin mode) attacks the measured edge-parking failure
  of the legacy objective, the continuity-at-the-edge offset is algebraically
  correct (verified), and NaN metrics are penalized rather than skipped, so a
  broken metric wiring can never look like a win to the search.
- Train/verify seed separation is real where it matters most: the M-23 fix
  (`-verify` suffixed bases) and solve.ts's M-26 equivalent both actually
  produce disjoint game seeds, and per-base band checks are never pooled — one
  bad seed base cannot hide inside two good ones.
- The search PRNG repair (scan B2-5) is exact: the Math.imul LCG computes
  (1103515245·s + 12345) mod 2^31 precisely, a ≡ 1 (mod 4) and c odd give the
  full 2^31 period, and /2^31 keeps [0,1) — the reproducible-search-path
  contract the bake workflow depends on holds.
- Failure-mode engineering shows learned incidents everywhere: loud flag
  grammar (checkFlags/flagNumber), integer floors on counts, loud --objective
  validation, job files kept on failure for hand re-runs, the verify-rung
  exit code (M-24), and the every-run rail-pin warning (M-25).
- sweep-worker.ts is a model worker: standalone, no knowledge of the search,
  fresh process per candidate so params cannot leak between evaluations,
  side-balanced home/away alternation, and honest endgame-key omission so a
  sweep always measures the shipped config.
- knobs.test.ts closes the "sweep silently perturbs nothing" hole (path
  resolution, rail sanity, default-inside-rail, uniqueness) without pinning a
  single SWEPT value — exactly the right structural/value boundary under
  AGENTS §2.1.
- The knobs.ts range comments carry real calibration history (why each rail
  moved, which incidents bound it, which pairs move together) — rare and
  valuable context for the next tuner.

## Verified sound
- All 46 SWEEPABLE paths resolve to finite numbers in defaultParams, and every
  shipped default sits inside its rail (checked by direct evaluation at HEAD);
  the six exactly-on-rail defaults (decide.transitionBonus lo, shot.baseMid hi,
  reb.offWeightMult lo, ai.contestBrakeBase lo, ai.crashBase lo,
  ai.cutRateScale lo) match the count sweep.ts:461's warning describes.
- scoreResults is continuous at both band edges (in-band value at the edge =
  CENTER_W = the out-of-band constant term); the NaN penalty 10 ≈ 2.44
  band-widths past an edge under margin weights, matching its comment.
- evalBatch preserves candidate-index ↔ result ordering (sequential
  WORKERS-sized slices of Promise.all); best-candidate selection tie-breaks
  deterministically on first index; the search path (PRNG draws in perturb)
  is independent of --workers, so worker count cannot change the outcome.
- Worker determinism: game seeds derive only from `${seedBase}-${i}`; train
  seeds (swp-*-{0..G−1}) and verify seeds (swp-*-verify-{0..V−1}) are disjoint
  strings feeding cyrb128 → independent sfc32 streams; JSON NaN→null
  round-trip is caught by `?? NaN` in scoreResults (null is nullish), so a
  worker-side NaN cannot silently pass.
- simulateGame does not mutate its Team/Player inputs (no attr/tend writes
  anywhere in engine sim/; per-game mutable state lives on Agent), so
  sweep-worker's team-object reuse across a seed base is safe, and params are
  cloned per game (withParams/structuredClone), so candidates cannot leak.
- The --endgame flag's "identical games as flagless" claim holds: game.ts:209
  resolves `cfg.endgame ?? true`, so forced-true and omitted produce the same
  resolved config and the same rng stream.
- The --iters 0 rung cannot green a broken engine on the checked surface:
  missing/NaN metrics fail evaluate() (NaN comparisons are false) and
  failCount > 0 sets exit code 1.
- solve.ts: FT inversion algebra matches resolve.ts freeThrowP exactly at
  current params (knee 0.6, ramp 0.4, joint solve above the knee verified);
  all 17 SEARCH_DIALS exist as numbers on a real archetype Player (checked
  against a constructed comboGuard); empty-target and percent-form guards
  work as documented; `npm run solve` is live in package.json and the module
  is import-safe (main-guarded), with fit-roster's fork of hostTeam the
  documented reason it has no importers.
- Charge-rate probe run for the knobs.ts:127 finding: 4 games (within the
  review's sim budget), 16 off_foul turnovers / 8 team-games = 2.00/tg.
