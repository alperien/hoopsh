# opt-flow
scanned: packages/harness/src/flow.ts (179), packages/harness/src/flow-metrics.ts (278), packages/harness/src/shotmix-probe.ts (164), packages/harness/src/probe-mid.ts (138); context read line-by-line: docs/CALIBRATION.md (209), data/nba/flow-reference.json (503), tools/parse-nba.mjs (749, corpus generator), packages/harness/test/flow.test.ts (136), packages/harness/test/flow-metrics*.test.ts, engine possession/shooting/fouls/events surfaces, parallel.ts/run-worker.ts/args.ts; data/nba/pbp-corpus.json inspected structurally (meta, distributions, per-game rows).
critical: 0   high: 0   medium: 1   low: 5

## MEDIUM packages/harness/src/flow.ts:137 - Flow report prints bare sim means with no n-scaled uncertainty, against a reference whose spread is sitting in the same file it imports
The report rows (flow.ts:137-158, printed 161-163) quote every sim metric as a
bare mean; reduceFlows (flow-metrics.ts:243-278) discards per-game spread
entirely, so nothing downstream can print an SE even if it wanted to. The only
n-visibility is the header game count and the qualifying-game counts on the two
conditional metrics (clutchGames, led10Games). Meanwhile the imported reference
carries per-metric n/stddev/p10/p90 (e.g. leadChanges sd 5.32 → se ≈ 0.77 at
the default n=48; clutchFTShare sd 0.29 over ~16 qualifying sim games → ±7pp),
and the report prints a 95% CI for the reference side of q4Lead10LostRate
(flow.ts:150) while the sim side of the same row is a bare ratio over ~40
led-10 games. CALIBRATION.md's own doctrine ("never adjudicate anything from
one or two draws"; calreport "quotes n40 grand-mean centers with standard
errors" — docs/CALIBRATION.md:33,56-58) and its instruction to re-measure
`npm run flow` before quoting flow numbers (docs/CALIBRATION.md:100-104) make
this report the adjudication instrument for flow claims; a reader comparing
sim 6.2 vs "real ~6.84" has no way to see the difference is deep inside noise.
Breaks: nothing mechanically (report-only), but it invites exactly the
noise-chasing the doctrine forbids — a marginal flow decision (e.g. whether a
metric has "moved" post-refit) can flip on a draw.

## LOW data/nba/flow-reference.json:40 - Reference file (and its generator) still claims flow.ts divides second-chance share by poss/2 — the fix landed; the claim is stale and self-regenerating
flow-reference.json:40 (meta.definitions.ambiguitiesResolved) and :501 (the
secondChanceShareOfPoss basis string) both state "flow.ts currently divides by
poss/2 ... reconcile on the sim side before gating". flow-metrics.ts:265-276
divides both-team second-chance possessions by both-team possession_ends (the
fix, commit b02ba33, unit-tested at test/flow-metrics-runs.test.ts:328), and
test/flow.test.ts:75-91 gates the metric — so the "before gating" precondition
is met and the described bug no longer exists. Both stale strings are
hardcoded in the generator (tools/parse-nba.mjs:678 and :725), so every future
`--write-reference` re-bake reprints them verbatim. A reader following the
citation file could "reconcile" flow.ts back to the broken denominator or
distrust the existing gate.
Breaks: a claim (doc-vs-code drift in the provenance file flow.ts imports and
tells readers to consult), regenerated on every corpus re-bake.

## LOW packages/harness/test/flow.test.ts:81 - Second-chance gate rationale quotes pre-H-06 reference values the committed flow-reference.json no longer contains
The comment (flow.test.ts:81-88) cites "flow-reference.json
secondChanceShareOfPoss: pooled 0.132, per-game p10/p90 0.099/0.166" and calls
the rails [0.058, 0.23] "the corpus per-game range". The committed, H-06
re-baked file says pooled 0.122, p10/p90 0.091/0.156, per-game range
[0.053, 0.219] (flow-reference.json:484-501; the re-bake delta is documented
at :35). So the stated identity "Rails = the corpus per-game range" is false —
the enforced floor 0.058 now sits ABOVE the corpus minimum 0.053 (a sim
landing at the real minimum would fail a floor described as the corpus range),
and every quoted number is from the retired pre-re-bake corpus. The gate
itself is generous and the sim sits at ~0.08, so no behavior changes today.
Breaks: a claim — the gate's stated derivation no longer matches its citation
file, which is exactly the drift class the H-06/b4-3 fixes existed to end.

## LOW packages/harness/src/probe-mid.ts:38 - possSum is accumulated per event and never consumed — unlabeled dead surface
`let possSum = 0` (probe-mid.ts:38) is incremented on every possession_end
(probe-mid.ts:56) and then never read: no report line prints it and nothing
else references it (the pts/game line at :138 uses ptsSum only). AGENTS §2.5:
anything defined-but-unconsumed must be labeled STAGED or UNWIRED, else
deleted. It also mildly misleads a reader into thinking the probe normalizes
something per-possession — it never does.
Breaks: repo law only (dead-surface labeling); no measurement is affected.

## LOW packages/harness/src/shotmix-probe.ts:66 - Attempt/zone tables and the FGA/FG% footer count fouled misses as FGAs, on a different basis from every corpus-referenced number in the same report — basis unstated
tallyGame counts EVERY shot event into fga/att/zoneAtt (shotmix-probe.ts:66-70),
so the moveType att%, zone att%, zone FG%, interior-mislabel share (:157) and
the footer "FGA/game … FG%" (:163) all include fouled misses (~6.5% of shot
events per probe-mid's L-50 note), which are not official FGAs. The same file
applies the official-FGA I26 convention inside its putback scan
(shotmix-probe.ts:88-92, M-49 comment), and the sibling probe was explicitly
fixed for this exact deflation ("folding fouled misses in ... deflated every
share", probe-mid.ts:49-53, audit L-50) — yet no comment here states the raw
basis or why it differs. Internally consistent for before/after use (same
basis both sides), but zone FG% reads low and interior att% reads high
against any official-counting comparison, and the footer FGA/game (~+6.5%)
sits one line under three corpus-referenced rates counted the official way.
Breaks: a measurement's comparability — cross-instrument basis inconsistency,
unlabeled, in the exact class two prior audit findings (L-50, M-49) repaired.

## LOW packages/harness/src/flow-metrics.ts:135 - "This is the corpus segmentation" has three known sub-1% counting residuals, none recorded on the sim side
The H-05 fold and header (flow.ts:34-42, flow-metrics.ts:135-151) claim the
possession convention now matches the corpus. Verified true to well under 1%,
but three residual classes differ and only one is documented, corpus-side only:
(a) the corpus drops zero-length possessions from both the length pool and the
possession count n (tools/parse-nba.mjs:375; ~379 of 37k, with the b7-F5 quirk
note at :368-374 — whose text "drops ALL zero-length possessions" also
mismatches its own filter `!(l === 0 && idx > 0)`, which keeps an index-0
zero), while the sim keeps every possession_end in both f.possLens and f.poss;
(b) mid-game jump-ball flips are sim-side boundaries (possession_end
'held_ball' from passing.ts, and 'def_rebound' from the scramble tie-up in
possession.ts tickScramble — ~0.8 jumps/g live, roughly half defense-won)
but are invisible to the corpus segmentation, which fuses the two possessions
(flow-reference.json:39 records this only as a corpus limitation);
(c) corpus lengths are whole-second (the parser truncates the clock's tenths,
parse-nba.mjs:83-85) vs the sim's float t — a mean-zero ±1s smear at the
<=8s/>=16s share cuts. Each class is ≤~1% of possessions and none flips a
conclusion at current report precision; the finding is that the sim-side files
assert exact convention identity without registering them.
Breaks: nothing at current precision — an honesty gap in a comparability
claim, the kind this repo registers (cf. b7-F5, L-45) rather than leaves
implicit.

## What is done well
- The operational-definition mirroring between flow-metrics.ts and
  tools/parse-nba.mjs is exceptional: every scan (putback, steal-to-score,
  and-one, second-chance marking, dead-ball exclusions) is implemented twice
  with matching stop rules, matching windows, and the deliberate asymmetries
  quantified in preserved legacy* fields — the corpus even mirrors sim-side
  conventions (any-FGA putbacks, FT-excluded steal conversions) instead of
  keeping its retired anchor definitions.
- The H-05 boundary-to-boundary fold is correct: period openers align exactly
  with period boundaries (verified at runtime, 0 mismatches), the stamped
  period on horn closes is right because endPossession runs before the period
  increments, and the header's "~41% of possessions follow a make" claim
  reproduces (42.3% measured over 2 games).
- Aggregation is like-to-like everywhere: pooled vs mean-of-per-game is chosen
  per metric to match the reference's own basis (clutchFTShare mean-of-ratios
  matches the corpus "matches flow.ts aggregation" note; putback/steal/
  second-chance/possession-p50 pooled both sides; per-game means elsewhere).
- flow-reference.json is a model provenance file: n, mean, stddev, p10/p50/p90,
  grade, basis prose, a Wilson 95% CI for the rare-event comeback rate, a
  materiality ledger vs the retired anchor, and definition-ambiguity records.
- CLI hygiene is genuinely defensive: declared flag vocabularies, loud
  rejection of `--games 0`/fractional counts with the incident cited, and the
  --endgame/--no-endgame contradiction check.
- The parallel path's determinism contract (contiguous slices, in-order
  concatenation, parent-side reduction, envelope validation, and the
  NaN-crosses-JSON-as-null finiteness sweep) makes worker count provably
  irrelevant to every printed digit.
- The fold and every scan definition are unit-tested against hand-built
  streams (flow-metrics.test.ts, flow-metrics-runs.test.ts), including the
  NCAA halves shape and the fouled-miss/and-one putback edge cases.
- flow.test.ts's ratchet policy is honest about debt: known gaps stay
  report-only, and the one vacuous leg (comebackRate >= 0) is explicitly
  labeled a NaN tripwire rather than passed off as enforcement.

## Verified sound
- Possession segmentation equivalence, case by case in engine code: made FG
  ends at the make; and-one hands off to the FT flow which closes at the made
  final FT (missed and-one FT → live rebound decides, offense keeps the same
  possession — matching the corpus's 1s-window and-one boundary skip); player
  and team defensive rebounds close; turnovers close; period horn closes
  (endPeriod always emits a period_end possession_end unless the possession
  already ended); technical FTs never close (sim emits no possession_end and
  no rebound row; corpus regex never matches them); missed non-final FTs log
  deadBall rebounds that both sides exclude from marking and denominators.
- Post-make horn tails cannot go missing on the sim side: post-make dead balls
  run the clock only OUTSIDE the make-stop windows (clock > 60s in Q1-Q3,
  > 120s in the final period), so the clock can never expire inside a make's
  ~2.2s resume — every corpus period-tail possession has a sim counterpart
  (0 missing tails in the runtime check; 407 possession_ends, 0 zero-length,
  per-game counts 208/199 vs corpus mean 199.5).
- reduceFlows folds rows in game order over concatenated slices; parallel
  worker invariance for the 'flow' task is enforced by test/parallel.test.ts;
  seeds are `${seedBase}-${i}` with odd-index home/away mirroring, matching
  the house convention across flow, shotmix-probe, and probe-mid.
- Both probes are deterministic and honest as static instruments: fixed seed
  pattern, sampleMatchup() is a fixed team pair, and the engine never mutates
  caller Team/Player objects (all mutable state lives on per-game Agent
  structs; grep found zero `.p.field =` writes), so shotmix-probe's single
  pre-loop sampleMatchup() is independence-safe. Neither probe mutates
  SimParams, so there is no restore obligation; dose-response mutation lives
  in flowboard/scoreboard.ts, outside this domain.
- Grammar scans symmetric to the corpus including the subtle parts: forward
  scans stop on every rebound row (dead-ball formality rows stop both sides),
  fouled misses are skipped-but-not-stops on both sides (M-49/I26; a fouled
  miss prints no corpus row at all — 0 of 3,876 corpus shooting fouls), scans
  cross period boundaries identically on both sides, and the 6s windows are
  inclusive on both sides.
- Reference numbers regenerate from the corpus aggregates: spot-checked
  2974/4151 = 0.716 (putback pooled), 925/3157 = 0.293 (steal conversion),
  possessions n=36703 consistent across sections, quarter profile Q4-lowest
  as printed; the corpus's own three-way score validation is 184/184.
- flow.ts compares like-to-like on units: per-game rows vs per-game corpus
  means, pooled possession shares vs pooled corpus shares (n=36703), pooled
  grammar ratios vs pooled corpus values, per-qualifying-game clutch mean vs
  the corpus's identical aggregation; the NBA-only reference caveat prints on
  non-NBA runs, and the endgame on/off footer states the measured config.
- Metric logic line-matched against parse-nba.mjs flowMetrics: same
  at-scoring-event evaluation, same tie/lead-change guards (first lead and tie
  interludes excluded), maximal runs with OT included, regulation-only
  droughts with tip/horn endpoints and tail folding, clutch pre-event margin
  in the final regulation period only, comeback marked at Q4 scoring events
  with last-10+-leader semantics — identical on both sides.
