# opt-validate

scanned: packages/harness/src/oos.ts (219), packages/harness/src/fidelity.ts (333),
packages/harness/src/texture.ts (127), packages/harness/src/turing.ts (1224);
supporting reads: harness/test/fidelity.test.ts, harness/test/realism.test.ts,
harness/test/turing.test.ts, harness/test/scoreboard.test.ts (pin lists),
harness/src/aggregate.ts, bands.ts, args.ts, noisefloor.ts, noise-floor.gen.ts,
scoreboard.ts (judge + main), data/src/teams.ts, data/src/archetypes.ts (header),
engine core/events.ts, replay/replay.ts, sim/params.ts (FT curve, dunkerDiveScale),
.github/workflows/ci.yml, docs/CALIBRATION.md, docs/REGISTER.md, corpus shard
plays-2025-11.json, git history.

critical: 0   high: 1   medium: 6   low: 3

## HIGH fidelity.ts:226 - Enforced star-fixture targets fail at center; no automated tier can see it, and the in-code "EARNED" provenance is two eras stale
The Jokić TRB row (`lo: 10, hi: 13`, comment "ratchet EARNED: minutes controller
+ guard-crash economy") is an enforced target, but the repo's own committed noise
floor (noise-floor.gen.ts:496-503, regenerated 2026-07-31 at commit 5496580)
measures its 8-base 40-game center at **8.92** (sd across bases 0.70, se ≈ 0.25 —
the 10.0 floor sits ~4 se above the center). Same floor: Jokić AST center 6.66
vs its enforced 7-11 (noise-floor.gen.ts:484-491), Curry 3PA-share center 48.9%
vs its enforced 50-68% floor (noise-floor.gen.ts:384-391); REGISTER W71
(2026-07-31) adds Curry AST 9.0 vs the 8.5 ceiling and 3P% 36.2 vs the 38.0
floor at n=40. The only enforced tier is the 12-game z=3 tripwire
(fidelity.test.ts:43-49), whose widened edges (TRB lo ≈ 6.83, AST lo ≈ 5.64,
3PA-share lo ≈ 38.4%) cannot see misses of this size — REGISTER W29's own words:
"the 12-game z=3 gate GREEN 18/18 throughout — it cannot see shifts this size."
The 40-game tier that CAN see them is the CLI, which sets no exit code (next
finding). The misses ARE tracked in REGISTER (W29 open since B2, W58, W71), but:
(a) fidelity.ts:226 still asserts the TRB ratchet is EARNED while W29 records
"the ratchet's premise predates the re-centered engine" and the center has since
fallen from 9.62 to 8.92; (b) CALIBRATION.md:47-50 presents "the fidelity suite"
as the held-out validation with no caveat, and its "Current measured state"
section quotes suite/corpus/batch/floor status but zero fidelity centers —
violating its own rule ("a center sitting on or outside a band edge is a
systematic finding for this file"). Precedent that this failure mode is real,
not hypothetical: the Jokić Post-shots row rode exactly this blindness for four
eras before the tightened floor exposed it, and the resolution was to un-gate
the row (W58, commit 4f27109).
Breaks: the "held-out validation" claim in CALIBRATION.md §"What locked does and
does not claim" — at HEAD, the hub benchmark's two headline identity stats
(fidelity.ts:87 "Fidelity hinges on huge rebounding … point-guard-grade assist
totals") are not met at center and nothing automated can go red on it.

## MEDIUM fidelity.ts:332 - The fidelity CLI counts enforced misses but always exits 0
The runner (fidelity.ts:303-333) increments `failures` for every enforced range
miss (line 324) and prints "N enforced range misses" (line 332), then falls off
the end of the file — no `process.exit(1)` on the failure path (the only exit is
the `--games` guard at line 313). Contrast cli.ts, whose band batch exits 1
below RATCHET_FLOOR (cli.ts:171), and scoreboard.ts, which dies loudly on
misconfiguration. Given HIGH-1, `npm run fidelity` at HEAD would likely print
FAIL rows for Jokić TRB (and probabilistically AST / Curry 3PA share) and still
report success to any script, cron, or CI step that checks exit codes. The
file's own header calls this "the Phase 2R acceptance gate". Adjacent to but not
covered by REGISTER W32 (which is about `import.meta.main` silently no-opping on
Node 24.0/24.1 — a different way the same command lies green).
Breaks: the 40-game precision tier of the two-tier fidelity gate — the only tier
that can see center-level identity drift has no red state.

## MEDIUM docs/CALIBRATION.md:48 - "Profiles authored independently of the sweep" overstates independence; fixture and engine were co-adapted against measured output
The held-out claim rests on independence, but the file's own provenance
comments record the opposite direction of flow: (a) fidelity.ts:122-135 — the
Curry supporting cast (dGreen passVision 90 / passAcc 86 / usage 28) was
"Authored AFTER the noise floor measured his 40-game AST center at 9.64 vs the
4.5-8.5 identity range" — the fixture was re-engineered against the calibrated
engine's measured output until the gated line came inside; (b) fidelity.ts:62-67
— LeBron's freeThrow 61 is derived by inverting the engine's current FT curve
("the engine's own curve is the citation"), and that curve was itself previously
re-centered because "the fidelity harness's 99-rated benchmark" failed at the
old swing (params.ts:1313-1318 comment). Engine tuned to fixture, fixture tuned
via engine. Each step is individually defensible (ratings only have meaning
through the engine's curves; real Curry does play with a second initiator), but
the resulting epistemic status is "an authored fixture exists under which the
engine reproduces the identity," which is weaker than "held-out validation …
authored independently." Also, unlike oos.ts's references (CITED to a
self-validating 1230-game derivation, oos.ts:145-162) and texture.ts's (a
committed provenance JSON), the TARGETS lo/hi ranges are authored recollections
("composite prime-season ranges … a fan would recognize", fidelity.ts:13-16,
197-204) with no data-file citation — real-flavored, not measured year-to-year
variance. The measured part of the tolerance is only the z·sd widening.
Breaks: the strength of the held-out claim in CALIBRATION.md §"What locked does
and does not claim"; the anti-circularity story for player-level validation.

## MEDIUM oos.ts:216 - The "out-of-sample roster check" cannot fail: no exit path, no CI wiring, no test twin — and its latest registered read is 15/17
The runner (oos.ts:196-219) prints `formatReport(evaluate(...NBA_BANDS))` — a
table with FAIL rows — and the REPORT-ONLY distribution block, then ends. There
is no `process.exit` anywhere in the file, `npm run oos` appears in no CI step
(.github/workflows/ci.yml runs test / batch 48 / fingerprint / determinism /
docs only), and no test imports anything from oos.ts. So the instrument
CALIBRATION.md:48-50 names as the second pillar of held-out validation ("the
out-of-sample roster check in the harness") can only be judged by a human who
happens to run it and read the table. That table currently doesn't pass:
REGISTER W71 (2026-07-31) records oos at 15/17 (assisted share 52.2 vs the 54
floor; FG% 49.7 vs the 49.5 ceiling), both adjudicated and left report-only per
the W14 protocol ("stays report-only"). The header's framing (oos.ts:8-17) marks
only item 2 (distribution) as REPORT-ONLY, implying item 1 (the bands) is a
check with teeth; in effect both are reports. Docs also flag the last quoted
reads as B2-era stale (CALIBRATION.md:100-107) — correct, and consistent with
nothing forcing a re-run.
Breaks: gate honesty of the held-out roster validation — a generalization
regression on generated rosters has no red state anywhere.

## MEDIUM noise-floor.gen.ts:13 - The floor all gate widths derive from was not regenerated after the dunker-dive mechanics flip; no consumer checks its vintage
CALIBRATION.md's workflow step 4 makes the noise-floor regen part of every
mechanics/params change ("the permanent gates derive widths from it"). The last
floor regen is commit 5496580 ("re-baseline … at the 0.3.0 streams"); the
dunker-dive engine change 15b37c0 (`ai.dunkerDiveScale` landed live at 6,
params.ts:2402; goldens re-baselined, so every stream changed) postdates it,
and no floor regen followed (git log on noise-floor.gen.ts stops at 5496580).
Consequence: the fidelity tripwire's n12 sds (fidelity.test.ts:43), the realism
guard's n24 sds (realism.test.ts), and the star centers quoted in HIGH-1 are
all measured on pre-dive streams — and the dive specifically moves the interior
economy (dunks 1.9→3.2/g, rim share 9.0→10.6% per its commit message), the
region the Jokić rows live in. The file carries `generatedAt` metadata
(noise-floor.gen.ts:13) but no consumer compares it to anything — the
dispatch's staleness question generalizes: none of the four instruments warns
about stale baselines; the only engine-coupled committed baseline (this floor)
relies purely on convention, and the convention was missed one commit after it
was last honored.
Breaks: the "a gate failure means the sim changed, not the seed changed"
guarantee — the null the widths encode is one engine wave old.

## MEDIUM turing.ts:1193 - Enum-valued flags are cast, never validated: a typo'd value silently changes the protocol while the manifest records the lie
`--windows`, `--variant`, `--strat` are read with `flagValue(...) as WindowKind`
etc. (turing.ts:1193-1195). checkFlags (args.ts) guards flag NAMES only, so
`--windows quarters` passes validation and falls through cutWindows' final
`else` (turing.ts:868-871) — i.e. behaves as `full`, whole-game windows;
an unknown `--strat` value takes the non-clutch arm of the ternary
(turing.ts:865) — i.e. behaves as `decided`; an unknown `--variant` behaves as
`census`. In every case manifest.json then records the typo'd string as pack
provenance (turing.ts:1141), so the artifact's own provenance ledger — the
thing the neutral protocol added specifically for measurement honesty —
mislabels what was actually cut. The house pattern for this exact hazard
exists one file over: noisefloor.ts:42-44 validates `--mode` against its enum
and dies loudly. Same-class incident already registered for flag NAMES
(audit H-03, and this file's own TURING_CLI_FLAGS comment at 1161-1165);
values are the remaining hole.
Breaks: pack provenance for judged runs — a discrimination result can be filed
under a window/variant/stratification that was never actually produced.

## MEDIUM oos.ts:5 - "Rosters the sweep has never seen" is jittered recombination of the training basis, on a 12-of-132 matchup graph, with narrower tactics than the training pair
Three compounding limits on the out-of-sample-ness the header sells
("ROSTERS THE SWEEP HAS NEVER SEEN … it removes the fit-to-the-training-set
objection", oos.ts:5-12):
(a) Basis reuse — the sweep trains exclusively on sampleMatchup()
(sweep-worker.ts:52-57), i.e. Cascadia/Meridian, which teams.ts:33-37 assembles
from the same ten archetype builders oos.ts:22-27 imports; SLOT_POOLS/BENCH_POOLS
add only stretchBig. Generated rosters are ±8 jitter around the very rating
vectors the training pair is made of — within-family interpolation, not
out-of-family generalization.
(b) Matchup coverage — hi and ai (oos.ts:205-207) are both functions of
g mod TEAMS, so exactly TEAMS distinct ordered pairs ever occur (verified
numerically: 12 pairs at defaults, each repeated 5× over 60 games; every team
meets exactly 2 distinct opponents; `--games 600` buys zero new pairings, only
new seeds). Registered as D7 ("deferred (doc-only)") — but the promised
clarification has not landed at the code site: the comment still says only
"deterministic pairing walk".
(c) Tactics range — generated tactics are 50±14 → [36,64] (oos.ts:96-98), which
EXCLUDES the training pair's own settings (pace 66/threeBias 68; pace 46/
threeBias 44, teams.ts:66,98): the OOS population never exercises the style
extremes the calibration was actually fit on.
None of this is hidden maliciously — the header hedges identification — but
"removes the fit-to-the-training-set objection" is stronger than what a
2-regular matchup graph over jittered training archetypes at interior tactics
can deliver.
Breaks: the strength of the generalization claim the sweep's defenders cite;
D7's promised doc correction.

## LOW oos.ts:37 - Module-scope flag parsing plus exported-but-unconsumed library functions: a latent import trap and unlabeled dead surface
oos.ts parses argv at module top level (checkFlags/flagNumber, lines 37-43) and
`randomTeam` reads module-const JITTER (lines 79, 88), yet the file exports
randomTeam / GameFinal / DistReport / distributionOf / formatDistribution /
finalsOf — none of which any repo file or test imports (verified by grep).
Any future importer (e.g. a test of distributionOf) would execute oos's
checkFlags against ITS OWN argv — throwing on any flag outside oos's four —
and silently bake the importer's `--jitter` (or the default) into randomTeam.
Per AGENTS §2.5, defined-but-unconsumed surface must be labeled STAGED or
UNWIRED; these exports carry no label.
Breaks: repo dead-surface law; a latent loud-crash (best case) or wrong-jitter
(worst case) for the first importer.

## LOW fidelity.test.ts:43 - Missing-floor fallback invents a width instead of failing loudly
`floor?.[t.label] ? floor[t.label]!.n12.sd : (t.hi - t.lo) * 0.175` — when a
target label has no noise-floor entry (the exact state after adding a target
without re-running `npm run noisefloor`, or after a label typo), the gate
silently grades against an invented sd (0.175·range at z=3 ≈ doubling the
range) rather than throwing. The whole point of the measured floor (file
header, lines 5-13; CALIBRATION.md noise-floor doctrine: "MEASURED, not
guessed") is that widths are never guessed. All current labels are present
(verified against noise-floor.gen.ts stars), so the branch is dormant today —
but its failure mode is precisely a gate whose width nobody measured, with no
signal that the fallback engaged.
Breaks: (latently) the measured-null guarantee for any future fidelity target.

## LOW turing.ts:1205 - The legacy bbref path emits unbalanced packs, violating the balance principle the neutral path states
The neutral path balances sides before shuffling ("a lopsided pack invites
base-rate guessing", turing.ts:1116-1119). The legacy path (turing.ts:1205-1211)
shuffles whatever each side produced: simWindows' safety valve (`g > count * 2`,
line 222) or a short `--real` directory can leave sims ≠ reals, and the pack
ships lopsided — a judge who guesses the majority class scores above 50% with
no basketball signal. Bounded: the path is explicitly rounds-1-2 continuity
only, and the stdout line prints both counts; but a continuity comparison
against the old 90% baseline is exactly where a base-rate artifact would
mislead.
Breaks: comparability of legacy-path discrimination scores.

## What is done well

- **The neutral matched-representation protocol is genuinely careful.** One
  schema, one window cutter, one anonymizer, one renderer for both sides
  (turing.ts:318-359), with the fairness property pinned by an actual
  byte-identity test (scoreboard.test.ts:116-135). The honest-exclusion ledger
  (every dropped row counted by reason, symmetric, with a loud 0.5% unparse
  abort at realToNeutral:760-766) is the opposite of quiet data cleaning.
- **Anti-tell discipline is empirical, not aspirational**: fouled-miss rows,
  offensive-foul pairing order, team-charged shot clocks, timeout-string
  normalization each cite a corpus count (0/3876, 546/551, 10/10) and a
  registered incident; the corpus-side foul-column flip is justified with
  measured 6255/6262 and 1163/1165 splits (turing.ts:707-714).
- **The statistical judge avoids the obvious p-hacking shapes**: thresholds
  learned on a train split cut by GAME (sibling windows never straddle),
  scored on the held-out half with a Wilson CI, all five window/variant reads
  printed (scoreboard.ts:909-941), tells ranked and reported in full, and the
  header honestly scopes the number as a "discriminability upper bound under
  fair representation" rather than a realism grade.
- **References are cited with derivations, not vibes**: oos.ts's 2023-24
  distribution block distinguishes SD-of-|margin| from SD-of-signed-margin and
  flags its own uncited rows; texture.ts imports its reference numbers from a
  provenance JSON whose definitionTraps block documents the units incident
  that motivated it — the printed citation cannot drift because it IS the file.
- **Failure-mode archaeology lives at the point of use**: nearly every guard in
  these four files names the incident that created it (b4-5, b4-8, B3-1, c2-F2,
  H-03, H-07, M-34, M-35, L-51), which is exactly the comment standard AGENTS §5
  asks for.
- **The two-tier gate design (measured-noise tripwire in CI, precision read in
  the CLI) is the right architecture** — the findings above are about the
  precision tier lacking teeth and the floor's vintage, not the design.
- **REGISTER discipline is real**: the fidelity center misses, the oos
  matchup-coverage limit, and the import.meta.main hazard were all already
  self-reported (W29/W58/W71, D7, W32) with measured trails — this review
  mostly found the deltas between the register's knowledge and what the code
  and CALIBRATION.md still claim.

## Verified sound

- **CI wiring (dispatch question)**: fidelity is the only one of the four in CI
  — via `npm test` → fidelity.test.ts (widened tripwire) plus the realism.test
  band guard; turing/scoreboard appear in CI only as unit pins. `npm run oos`,
  `npm run texture`, `npm run turing`, `npm run flowboard` are manual-only
  (verified against .github/workflows/ci.yml and package.json).
- **Report-only status (dispatch question)**: distributional realism (margin
  spread, blowout/close/OT rates, quarter profile) lives in oos.ts:105-176 and
  is REPORT-ONLY as CALIBRATION.md:50-51 claims; texture.ts likewise. If the
  distribution rows were enforced today: the B2-registered reads had margin
  12.41/12.20 and blowout 19.2/19.6% INSIDE the references, OT share 2.5-3.0%
  vs 4.8% would FAIL (open residual W25), and the oos band table would fail
  2/17 (W71). Current-engine distribution values are unmeasured (two waves
  stale, per docs) and could not be honestly re-measured inside this review's
  4-game budget.
- **Turing's realism score (dispatch question)**: turing.ts computes no score —
  it emits blind packs (pack/key/manifest); the in-repo number is
  scoreboard.ts#discriminate (balanced-accuracy threshold-vote over six
  structural features, Wilson 95% CI), surfaced as flowboard gates T1/T2 with a
  ≤55% program-end band — printed with verdicts, but flowboard also exits 0
  regardless of gate verdicts (scoreboard.ts main), so the discrimination score
  is reported, never enforced.
- oos pairing walk behavior confirmed by direct enumeration (12 distinct
  ordered pairs at TEAMS=12 for any GAMES; 8/56, 16/240, 30/870 at other sizes);
  no hi==ai collision at even TEAMS.
- distributionOf: sample (n−1) sd of |margin| matches the cited reference
  convention; ratio stats in fidelity TARGETS and aggregate.finalize are pooled
  makes/attempts (volume-weighted), not means of ratios; astdShare = ast/fgm is
  sound given one assist per assisted make.
- finalsOf is safe against the event contract: Base carries period/clock/score
  on every event, and period_end fires for every period including the last
  (events.ts:184-186), so quarter profiles and OT detection are complete;
  OT periods are correctly excluded from the 4-quarter profile.
- texture.ts frame indexing matches the replay contract ([0]=wall-clock
  seconds, [1]=period, [2]=clock, coords at 6+2p — replay.ts:6-8), the
  live-clock filter excludes FT rituals and dead balls, and the >30 ft/s
  sub-teleport drop is applied before any aggregate. The reference JSON exists
  with every field the report reads (speedDistance.AVG_SPEED, passing
  .PASSES_MADE, derived.passesPerPossession, derived.distOverOnCourtTimeMph).
- No timeout-side tell in the neutral schema: real corpus timeout rows are
  side-tagged (386 sided / 0 null in plays-2025-11.json), matching sim rows;
  jump rows are side-null on both sides.
- simToNeutral's switch covers the entire 17-type GameEvent union with a loud
  throw for future types; the offensive-foul reorder consumes its companion via
  bounded lookahead matching the engine's documented pairing contract.
- anonymizeWindow: side-scoped tokens, fresh maps per window (no cross-excerpt
  fingerprinting), score slots swapped consistently with the first-appearing
  side; assist/block/steal/drawn token sides match basketball reality.
- The fidelity gate skips exactly the two declared ratchet rows (18 enforced
  rows), uses measured n12 sds for all current labels, and its 12-game slate is
  seed-prefix-consistent with the CLI's 40-game slate; runBenchmark alternates
  opponent and home court in a balanced 4-cycle and throws loudly on games < 1.
- args.ts loud-flag discipline is correctly applied in all four CLIs (names,
  `=`-spellings, repeats); turing's allow-list is itself pinned by a test.
- LeBron's 3PA ratchet row now measures inside its 3-7.5 range at the committed
  floor (n40 center 4.08) — a ratchet that has earned its flip per the stated
  convention; noted here rather than filed, since the floor is one engine wave
  stale (MEDIUM-5) and the flip decision should follow a fresh regen.
