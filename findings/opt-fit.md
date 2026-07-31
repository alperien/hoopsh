# opt-fit

scanned: packages/harness/src/fit-roster.ts (1396, every line); packages/harness/test/fit-roster.test.ts (259), fit-dunks.test.ts (98), fit-starters.test.ts (93), season-lines.test.ts (65); docs/ROSTERS.md (292). Consulted for claim verification: harness/src/fidelity.ts (runBenchmark/AggLine), harness/src/args.ts (flagNumber), harness/src/solve.ts (FT inverse twin), engine sim/resolve.ts (freeThrowP, shootingFoulP, zoneSkill), sim/shooting.ts (and-one/contester gating), sim/ai/decide.ts (usage loop, zoneTend), sim/params.ts (shot/foul/ai defaults), narration/src/shotcall.ts (dunk gate), model/player.ts (DEFAULT_TEND), data/src/teams.ts (sampleMatchup), data/nba/*.season.json + README, docs/REGISTER.md W65/W72, docs/history/redteam-wave2.md.

critical: 0   high: 1   medium: 3   low: 7

## HIGH fit-roster.ts:404 - REF_CONTEST calibration claim cites tests that do not exist, and two of the three quoted anchors no longer hold
The reference-model comment (fit-roster.ts:400-406) states the contest levels are
"calibrated so the archetype/fixture anchors invert onto themselves (three:
eliteShooter 99 ↔ ~45%, threeAndD 82 ↔ ~38.5%, comboGuard 70 ↔ ~36%) — each
anchor's check lives in the tests." No such check exists anywhere in the suite:
the only consumers of `zoneRefs`/`forwardThreePct`/`invertThree` are
fit-roster.test.ts's round-trips (lines 39-79) and the 50s-fixpoint test (81-112),
and both are self-consistent — the round-trip composes the fitter's own forward
and inverse (any REF_CONTEST value cancels), and the fixpoint test constructs its
input FROM `zoneRefs().leaguePct`, so a REF change moves the input and the
assertion together. Measured under current defaultParams (node one-liner against
the shipped functions): forwardThreePct(99, 0.15) = 43.8% (claimed ~45% — the
inverse direction "holds" only because the raw inverse of 45% is ~103 and
`ratingOf` clamps at 99); 82 → 38.4% (holds); invertThree(0.36, 0.15) = 74 against
the claimed comboGuard-70 anchor — a league-average 36% shooter now fits 4 rating
points hot relative to the documented calibration story. Since the fitter landed
(153da5d), the flow flips and G3/G5 re-fits moved the engine's realized shot
economy (docs/CALIBRATION.md flow-re-fit block), which is exactly what
REF_CONTEST's "realized average look" values encode — and nothing in the suite
can go red when they drift further.
Breaks: the absolute scale of every fitted `three` (and the 2P zone ratings that
share the REF family), plus a documented test-coverage guarantee that is false —
someone re-tuning REF_CONTEST would trust the suite to catch a mistake it cannot
see.

## MEDIUM fit-roster.ts:479 - FT elite knee/ramp hardcoded (0.6/0.4) while the engine reads them from params; the round-trip test cannot catch a de-sync
`forwardFtPct` (line 479: `(nv - 0.6) / 0.4`) and `invertFreeThrow` (lines 497,
502-503: `S.ftSkillSwing * 0.6`, `S.ftEliteKick * 0.6) / 0.4`, `S.ftEliteKick / 0.4`)
hardcode the elite-kick knee and ramp. The engine's freeThrowP reads
`P.ftEliteKneeN` / `P.ftEliteRampN` (resolve.ts:258), hoisted to the SimParams
surface by release-audit H-01 at 0.6/0.4 (params.ts:1326-1327); the fitter was not
updated to read them. This contradicts the file's own doctrine ("All logit pieces
come from defaultParams — the same constants resolve.ts runs forward",
fit-roster.ts:397-398) and the function's "Exact mirror of resolve.ts freeThrowP" /
"exact piecewise inverse" claims (475, 492). Today the values match, so the
inversion is currently correct — but if the elite-tail shape is ever re-tuned, the
fitter silently de-calibrates every freeThrow fit while the round-trip test
(fit-roster.test.ts:50-55) stays green, because it composes the fitter's forward
with the fitter's inverse and both share the stale constants. solve.ts:87-96
carries the identical hardcode (adjacent domain, same fix).
Breaks: the "exact inverse" guarantee, latently; the test that claims to guard it
structurally cannot.

## MEDIUM fit-roster.ts:576 - drawFoul mix blend overrides OBSERVED shot-mix data and inflates rim-diet bigs by ~13 rating points
`invertDrawFoul` blends the player's zone mix 50/50 with the league mix
(DRAW_FOUL_MIX_BLEND, lines 568, 575-582) on the rationale that "the player mix is
itself an estimate (position priors)" (557-559). That rationale is wrong for the
component where the blend does its damage: the three-point share is `tpa/fga` —
exact box-score data, never estimated — and when `shotZones` is provided (all 30
committed 2025-26 season files carry it; season-lines.test.ts:62 asserts the
channel), the entire mix is observation-grade, yet the blend still discards half
of it. Because the three-zone foul base is ~33x smaller than rim
(params.ts:1382/1385: shootRim 0.51974 vs shootThree 0.0156), granting a rim-only
center a phantom ~19% three diet suppresses predAtD1 by ~18% and inflates D.
Measured with the shipped function: a rim-diet C (mix rim .71/paint .20/mid .08/
three .01, FTA/FGA 0.45 — the Gobert/Hartenstein shape) fits drawFoul 64 where his
observed-mix algebra gives ~51; the symmetric deflation hits extreme three diets.
The blend is anchored only on the Curry-class direction ("keeps the Curry-class
outlier in the 80s", 562-563) and claims balanced diets move < 3 points — the
interior class moves 13. Refinement can walk it back (drawFoul is searched,
region ±20) but only if the 4-game fta signal wins the objective, and the layer's
own contract says "An unexplained coefficient in this layer is a bug" (line 31).
Also: line 581 inlines `0.15` where `REF_CONTEST.threePerPullUp` (line 410) is the
named constant — a second drift trap in the same function.
Breaks: the analytic layer's documented explainability for a whole position
class; fitted packs ship rim bigs that over-draw fouls when refinement doesn't
fully claw it back.

## MEDIUM fit-roster.ts:1254 - --calibrate-three has no integer or budget guard: the hard-budget doctrine is bypassable and fractional rounds silently ship unmeasured adjustments
The refinement budget is "hard-enforced: exceeding either cap is an error, not a
warning" (837-839), and audit M-30/L-47 added integer+lower-bound guards for
iters/cands/games precisely because `flagNumber` accepts any finite number
(args.ts:62-69, fit-roster.ts:1019-1038). The later-landed `--calibrate-three`
pass (74a591f) got none of that: `flagNumber(argv, '--calibrate-three', 0)` at
1254 feeds the round loop at 1354 directly, so `--calibrate-three 100000` runs
1,000,000 team games with no cap — the exact "this fitter may not sweep" contract
the caps exist to enforce — and a fractional count changes semantics rather than
erroring: with 2.5, rounds 1 AND 2 both satisfy `round < calibrateThreeRounds`
(1375), so the final executed round adjusts `shotThree` after measuring, the loop
ends without the design's measurement-only last round, and the emitted pack
carries adjustments (and SATURATED verdicts, 1379) that were never re-simmed.
Negative values silently no-op.
Breaks: the wave-1 compute-budget contract; the calibration pass's own
"last round measures" design under non-integer input.

## LOW fit-roster.ts:993 - verify-gate selection reuses the same 8 fresh games for both arms, so the quoted "honest" verifyErr is winner-biased and "strictly additive" is an expectation-level overclaim
The gate re-evaluates seed and refined candidate on one shared fresh-seed set
(1109-1111) and reports the winner's score as "the honest number to quote"
(993-995). Selecting the min of two noisy scores on the SAME evaluation set makes
the reported verifyErr optimistically biased (mild — two arms), and the comment
"Refinement can therefore never make the fit worse than the analytic layer — it
is strictly additive" (1107-1108) holds only on that 8-game sample: a lucky draw
past the 10% margin can ship an in-expectation-worse profile. An unbiased quote
needs a third seed set. Bounded: CRN across the two arms cancels shared noise,
and the 10% keep-margin is conservative.
Breaks: nothing structural; the statistical honesty of one reported number.

## LOW fit-roster.ts:1109 - 16 verify games are burned comparing the seed against its own clone whenever refinement accepted nothing
If no candidate clears ACCEPT_MARGIN, `best` is still the untouched
`structuredClone(seedPlayer)` (1052), yet the gate runs both
`evaluate(seedPlayer, verify, 8)` and `evaluate(best, verify, 8)` (1109-1110) —
16 deterministic-identical games producing byte-equal scores and a guaranteed
`keptRefinement = false` (x < 0.9x). Half of that (8 games, ~10% of the default
76-game per-player budget) is provably wasted work; tracking whether `best` ever
changed skips it.
Breaks: nothing; wasted sim work on every fit where the analytic seed is already
locally optimal.

## LOW fit-roster.ts:183 - teamRatings docstring claims it "drives the fitter's team-context anchors" — nothing consumes it, its fields are never validated, and the one uncontroversial consumer (pace) is ignored
The interface doc (182-186) says the team-strength signal "drives the fitter's
team-context anchors", but the anchor was built, FALSIFIED held-out, and NOT
shipped (fit-roster.ts:1328-1339, REGISTER W72) — `teamRatings` is read by zero
code paths (repo-wide grep: declaration and the rejection comment only). Per
AGENTS §2.5 that is unlabeled dead surface wearing a live docstring; the honest
label is STAGED with the successor-arc condition. Compounding: validateSeasonLines
checks none of its fields (a string `ortg` passes silently — the exact class
audit M-29 fixed for player optionals at 243-248), and `teamRatings.pace` ships
sourced in every file while `usgPct` divides by the league-constant
PLAYS_PER_MIN = 2.3 (341, 381-383), leaving a ±3-4% systematic usage error across
pace extremes that sourced data on hand would remove.
Breaks: doc-vs-code truth for the input schema; a validation gap on the one
optional block the validator skips.

## LOW docs/REGISTER.md:198 - W65 status column still reports the Hartenstein starvation as open with superseded numbers
The W65 row's status quotes "OPEN residuals with numbers: Hartenstein 9.2 min vs
24.2 DESPITE starting (a rotation-return path question, not starters)". Commit
e6a7e15 landed the core-nine rotation-targets fix and measured Hartenstein
11.5 → 24.0 vs 24.2 real (fit-roster.ts:1166-1178, unit-pinned in
fit-starters.test.ts:65-80) but did not touch REGISTER.md, so the register
contradicts both the code comment and the commit record — the "never quote a
stale read" doctrine applied to the repo's own ledger. The row's diagnosis note
("rotation-return path, not starters") is also superseded by the landed
diagnosis (all-twelve targeting killed the eager-return path).
Breaks: the register's reliability as the wave ledger for W65.

## LOW fit-roster.ts:596 - stale engine line references and an in-file JSDoc contradicted two lines below it
Three internal references have rotted: (a) "decide.ts:115" for the usage-target
formula (header line 21 and line 596) — the formula lives at decide.ts:201;
(b) "decide.ts:90" for the rim/paint zoneTend bucket (625-626) — actual
decide.ts:175-177; (c) assembleTeamPack's JSDoc says "pick starters by MPG"
(1128) while the implementation two lines down sorts games-started first with
mpg as tiebreak (1153-1156, deliberately, per W65). The formulas themselves were
verified correct against the cited code; only the pointers and the JSDoc lie.
Breaks: nothing at runtime; navigation trust in a file whose whole method is
"cite the engine algebra you invert".

## LOW fit-roster.ts:228 - input plausibility gaps: mpg unbounded above, pts never cross-checked, and the emitted pack carries no fit-quality marker
validateSeasonLines enforces cross-field sanity where it looked (tpa ≤ fga at
252-254, orb ≤ reb at 255-257, pct ≤ 1 at 232-237) but: `mpg` accepts any finite
value ≥ 0 (228-231) — a typo like 342 silently produces stamina 99 and a ~7x
usage deflation; and `pts` is never reconciled against shot volume — the analytic
layer never reads pts, so an arithmetically impossible line (60 ppg on 5 FGA + 2
FTA) fits "successfully" and the written team.json carries no fit-quality/err
marker distinguishing it from a clean fit (write at 1392-1395; already recorded
as a red-team note, docs/history/redteam-wave2.md "Notes (not defects)", still
unaddressed). A pipeline consuming out/fitted/ and ignoring stdout cannot tell
them apart.
Breaks: garbage-in detection for the two fields the validator does not sanity
check; artifact-level auditability of fit quality.

## LOW fit-roster.ts:1285 - fits run strictly sequentially (~76 games/player) despite the repo's worker pool
Default budget is 76 games per player (859-861: 4 seed + 56 refine + 16 verify),
and the CLI fits players one at a time in a plain for-loop (1285-1324), plus 10
team games per calibrate-three round. A 12-man roster is ~900+ games ≈ 15 min at
the 1 game/s budget; the 30-team program (REGISTER W3) is ~27k games serial.
Candidate evaluations within an iteration and players within a roster are
independent (per-player seed streams already disjoint via starId), and the
harness has a proven bit-identical worker pool (run.ts / parallel.test.ts) that
this CLI never uses. Not a correctness issue — determinism would survive the
worker split because scores are folded per-player.
Breaks: nothing; leaves 2x wall-clock on the table for the fleet-fitting arc.

## What is done well

- The two-layer architecture is genuinely disciplined: every one of the 38 dials
  routes through the `F()` record-and-clamp helper, so the provenance report is
  complete by construction, and the "formula / body / template / default" source
  taxonomy makes the gap list (box-invisible dials) honest instead of hidden.
- Real inversions, not vibes: usage is exact algebra against decide.ts's target-
  share formula; FT% is the exact piecewise inverse at current params; the 3P%/2P%
  inversions run the engine's own logit pieces backward from defaultParams, so
  most of the analytic layer re-calibrates itself when SWEPT constants move.
- Seed discipline is exemplary: common random numbers across candidates
  (`${seedBase}-${starId}-${i}`), a disjoint `-verify` stream for held-out
  gating, per-player stream separation via starId, a deterministic opponent pair
  (sampleMatchup), and a seeded hill-climb RNG per player id. Same seeds also put
  the hand-built fixtures on the identical yardstick for the CLI comparison.
- The verify gate makes refinement fail-safe in the right direction: a stochastic
  4-game hill-climb can only ship if it beats the analytic seed held-out by 10%,
  and the in-sample/held-out distinction is labeled in the output.
- Hard compute budgets that actually throw (integer floors before the budget
  arithmetic — the M-30 fractional bypass is closed and tested), with the default
  budget arithmetic documented and correct.
- The objective's attempt-aware percentage weights implement exactly the right
  statistics: w² proportional to attempt volume equalizes each percentage stat's
  noise contribution across players (verified algebraically), fixing the observed
  "trash rebounding to chase a 1-3PA coin flip" failure.
- Input hygiene encodes its incident history: loud complete-issue-list
  validation, slug-collision preemption, provenance strings required (with
  "typed from memory must say so"), and the 30 committed season files are
  test-pinned for provenance text, mpg ordering, and the dunk channel.
- Failed ideas are documented with measurements instead of deleted: the rejected
  DRtg anchor block (W72) and the calibrate-three SATURATED honesty ("engine
  lever, not a fit miss") keep the next agent from re-deriving dead ends.

## Verified sound

- usageDial is the exact inverse of decide.ts:201 (`0.2 + (usage−50)/100 ·
  usageShareSwing`, swing 0.24) — checked algebraically and test-pinned.
- invertFreeThrow matches resolve.ts freeThrowP exactly at current params
  (knee/ramp 0.6/0.4 equal params.ts:1326-1327); round-trip ±1 verified.
- invertDrawFoul's FT-expectation algebra matches shooting.ts:64-71: and-one
  damped by andOneFoulMult (0.28) with 1 FT on a make, k=2/3 on a miss, fouls
  gated on a contester existing; the `(1 + NONSHOOT_FTA_SHARE)` construction
  matches its stated "share of shooting FTA" reading (0.35/1.35 ≈ 26% of total).
- The paint-skill blend comment (0.35 finishing / 0.65 midRange) matches
  params.paintBlendFinishing/MidRange; zoneTendencies' 50/30/40 defaults match
  DEFAULT_TEND (player.ts:181-183); the rim+paint single-bucket claim matches
  decide.ts:175-177; the dunk-gate geometry (0.6·vert + 0.4·finishing ≥ 74)
  matches shotcall.ts:54/93, and the two-sided inversion is exact against the
  fitted finishing (unit-pinned with rounding-epsilon reasoning).
- deriveRates' USG denominator is correct: 2.3 plays per on-court minute is team
  plays per game-minute (≈110/48), the right on-court share denominator; all
  division sites in the rates path carry floors (fga 0.1, twoPa 0.2 guard, tov
  0.5, used 1) — no div-by-zero path found.
- Physical measurements are held fixed: heightIn/weightLb pass through,
  wingspan only if provided ("never guessed" honored); SEARCH_DIALS contains no
  physical or defensive-craft dial; trust-region bounds derive from the analytic
  seed and clamp to [1,99] inside the schema range.
- hostTeam is position-aware (star's slot never duplicated — the twin-towers
  rebounding artifact is structurally excluded) and targets the star's real
  minutes; league-context bias of the neutral cast is documented, and the
  calibrate-three pass closes the 3PA loop in real team context with a damped
  log2 step, skipping sub-0.5-3PA players and reporting saturation honestly.
- runBenchmark alternates opponent and home court deterministically; AggLine
  percentages are pooled (not means of per-game means); no home-advantage param
  exists in the engine, so the calibrate-three home-only measurement is unbiased.
- The budget guards reject fractional/zero/negative iters/cands/games before any
  sim, and MAX_ITERS/MAX_GAMES_PER_ITER are enforced by throw (test-pinned).
- assembleTeamPack: starters gs-first with mpg tiebreak (test-pinned), core-nine
  rotation targets (pigeonhole rule test-pinned), cast padding cannot collide
  with fitted ids, and the pack is refused on any validateTeamPack error before
  write. calibrate-three's id→line mapping (`fit-` prefix strip) cannot capture
  cast ids ('fitted-cast-N' does not match /^fit-/).
- No ambient randomness anywhere in the fitter: all game seeds derive from
  --seed; Map/array iteration orders are insertion-stable; re-running the CLI
  with the same inputs and flags reproduces byte-identical packs.
