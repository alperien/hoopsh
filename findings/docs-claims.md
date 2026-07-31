# docs-claims

scanned: docs/CALIBRATION.md (209), docs/REGISTER.md (220), docs/CAREER.md (475),
docs/CAREER_INTERNALS.md (152), README.md (268), CHANGELOG.md (155), package.json (79);
verification targets: packages/app/src/career-acceptance.ts (336), packages/career/src/trust.ts (259),
creation.ts / week.ts / circuits.ts / nbabridge.ts / phone.ts / recruiting.ts / stock.ts /
perception.ts / tick.ts / types.ts / packs.ts / params.ts / epilogue.ts (career, spot),
engine sim/params.ts / rules/rulepack.ts / sim/subs.ts / ai/offense.ts / ai/concepts.ts (spot),
harness cli.ts / sweep.ts / flow.ts / scoreboard.ts / fidelity.ts / oos.ts / noisefloor.ts /
turing.ts / season-cli.ts / simone.ts / fit-roster.ts / calreport.ts / fingerprint.ts / knobs.ts /
run.ts / parallel.ts / args.ts (flag vocabularies), franchise cba/contracts.ts / tick.ts /
calendar.ts / media/awards.ts (spot), app acceptance.ts / saves.ts / server.ts (spot),
harness test readme.test.ts / readme-claims.test.ts / realism.test.ts, career test suite (spot),
tools/parse-nba.mjs / parse-nba-team.mjs (spot), git history for provenance.

critical: 0   high: 2   medium: 2   low: 12

## HIGH docs/CALIBRATION.md:54 - "Current measured state" is an era behind HEAD; specific quoted values are false at HEAD
The file's own contract (lines 7-9: "only the current state is documented here";
line 33-34: "never quote a stale pass-rate in docs") is violated: five stream-moving
landings on 2026-07-31 (REGISTER W63 rules landing, W69 probe flip, W70 concede
hysteresis, W71 oos re-read, W73 dunker dive) postdate the block's 2026-07-30
measurements and no era addendum was appended. Stale-at-HEAD inventory:
- :78 "Suite: 470 tests / 469 pass / 1 todo" — the franchise (136 static test
  declarations), career (174) and fun-wave suites landed 2026-07-31; static
  declarations across packages/*/test now total 1,339 and the live runtime count
  is roughly triple the quoted 470.
- :85-88 "16/17 at n=48 — the one miss is fgPct 49.7... the fresh floor's center
  reads 48.93, inside" — superseded twice: W63 measured 16/17 for a different
  reason (assisted 53.6), W69 restored 17/17 (assisted 54.2), and W73 measured
  17/17 with FG% 49.1 — the dive deliberately moved fgPct up toward the 49.5
  ceiling (dose 8 seats ON it), so the "draw-level flicker around 48.93" story
  and its headroom implication are no longer the live fgPct state.
- :147-156 "G11 (shot diet): dial surface exhausted — mechanism gap, no dial
  point baked" — falsified by W73: a new dial IS baked and live
  (`ai.dunkerDiveScale: 6`, engine sim/params.ts:2402, consumed at
  ai/offense.ts:335-337); dunks 3.2/g and rim share 10.6% at HEAD vs the row's
  quoted 1.67-2.88/g and 8.8-10.3%.
- :157-163 "Noise floor regenerated at the re-fit stream in its own commit
  (33c65e4 — its diff is the drift record)" — two later regens exist (e74d513
  at the rules landing, 5496580 at the 0.3.0 streams), so the block points a
  reader diffing the drift record at the wrong "latest" commit.
- :104-107 "Same standing caveat for `npm run oos` ... last reads are B2-era" —
  stale: W71 (2026-07-31) took a fresh oos read (15/17, both residuals
  attributed by a v0.2.0 control run).
Breaks: the calibration-law document misstates the live band state, the live
dial surface, and the current drift-record baseline for anyone touching
sim/params.ts under AGENTS §4.4.

## HIGH packages/app/src/career-acceptance.ts:289 - the "careers complete" gate covers 2 of 8 phases; a soft-lock in draftPrep/nba/euro/nbl/china passes green
CAREER.md:430 documents the hard gate as "Careers complete: no stage soft-locks
across the auto-career corpus" (same claim in W66 and the file's own header,
career-acceptance.ts:9). The implementation fails only on
`finalPhase === 'hs' || finalPhase === 'college'`. The CareerPhase union
(packages/career/src/types.ts:30-32) has eight phases; a career that stalls in
'draftPrep', 'nba', 'euro', 'nbl', or 'china' just burns the MAX_WEEKS=700 loop
cap (runCareer:149-203) and exits silently — e.g. if the scripted `retire`
choice is refused forever (:173-176, `if (r.ok) continue` with no else), the
career ends at 700 weeks in 'nba' with every gate green (no games ⇒ role clocks
0 ⇒ invariant green; lint green). The two unchecked-but-exercised phases
(draftPrep, nba) are exactly the draft machinery and the NBA bridge — the most
complex arcs the gate exists to guard. (Distinct from the determinism-gate-scope
finding owned by another reader.)
Breaks: a documented flagship gate — a bridge/draft regression that strands
careers ships with `gm:career-acceptance` exiting 0.

## MEDIUM README.md:233-235 - "the mechanism built to fix that is parked at zero strength" — the probe is live at HEAD; README contradicts its own CHANGELOG at the same version
The roadmap's "Now — tuning, not building" paragraph says the pass-volume
mechanism "is parked at zero strength because, measured together with the
score-pressure coupling, the two interact badly." That was the W19/W28 state.
At HEAD (v0.3.0) the probe is LIVE: `probeSwingBonus: 0.15`,
`probeShootMalus: 0.08`, `probePressureFade: 1` (engine sim/params.ts:2290-2292;
fade consumed at ai/concepts.ts:734), and CHANGELOG.md:9-24 headlines "the
pass-volume probe (concept 8) is live for the first time" (W69). README's
description of the live engine's configuration is false in the same tree that
documents the flip. The residual half of the sentence ("moves the ball less
than real teams") is still true (W69: ~1.4-1.6 vs 2.84-2.86 passes/poss).
Breaks: the front-door description of current engine behavior; anyone
interpreting sim output or planning work from the README's "Now" section.

## MEDIUM docs/CAREER.md:434-443 - two of the four documented reported bands are not measured by gm:career-acceptance, and a third is measured differently
"Reported bands (npm run gm:career-acceptance)" promises:
- :437-438 "Route outcomes differ measurably: college vs Europe vs NBL produce
  different stock distributions, development deltas, earnings curves" — no such
  band exists in career-acceptance.ts, and it is structurally unmeasurable
  there: all three pilots (:53-81) take the college route
  (`declareAfterCollegeSeasons`); no pilot ever accepts a Euro or NBL offer, so
  those code paths are not exercised by the fleet at all.
- :434-436 "Draft outcomes track creation quality with honest spread: Walk-ons
  go undrafted more often than not; Phenoms mostly land top ten; bust paths and
  late-pick star paths both exist" — implemented (:294-304) as a single
  ordering check, `min(phenom picks) < max(walkon picks)`; none of the
  documented distributional claims (undrafted rate, top-ten rate, bust/late-star
  existence) is measured, and at the default `--careers 3` there is one pilot
  per preset so they could not be.
- :441-443 boredom audit — documented as "a consequential decision (not a game
  night) lands at least once per two sim-weeks, and no two consecutive seasons
  produce an identical phone-event mix"; implemented (:305-310) as total
  content ≥0.8 items/week (counting game-driven events and phone messages, not
  decisions), zero-event streak ≤4 weeks, phone lifetime 20-400. The
  phone-mix-uniqueness clause has no implementation anywhere.
(The missing career-shapes band is excluded here — another reader owns it.)
Breaks: CAREER.md's "How we prove it works" contract — a reader auditing the
mode's claims by its stated instruments finds the instruments absent or weaker.

## LOW docs/CAREER.md:99 - ceilings "sampled around" the priors vs CAREER_INTERNALS "sampled OVER" — code says OVER
CAREER.md:99 "the true per-group ceilings are sampled around them" implies a
ceiling can land below the visible prior. creation.ts clamps every potential to
at least prior+2 (`CEILING_FLOOR_OVER_PRIOR = 2`, creation.ts:103;
`clamp(prior + headroom, prior + CEILING_FLOOR_OVER_PRIOR, RATING_HI)`,
creation.ts:445-446), with headroom drawn gaussian(18, 8). CAREER_INTERNALS.md:29
("hidden ceilings sampled OVER the visible priors") is the correct statement;
CAREER.md's "around" is the design-doc draft wording the implementation
tightened. Adjudicated: OVER is true.
Breaks: a design-doc claim about the RPG hook's distribution.

## LOW docs/CAREER_INTERNALS.md:147-148 - trap 4 states falsified approach-card semantics (pre-felt-loop)
The trap says "The approach card is consumed by the FIRST grade after it is set
(nextApproach is for one game); the UI resends per game night." The felt-loop
fix inverted both halves for the pre-NBA path: week.ts captures the card ONCE
per week (:232), grades every game of the week against it
(trust.ts:121-130 takes `card` explicitly), and at week's end the dialed card
FOLDS INTO career.approach and persists ("THE CARD IS STICKY... persists until
changed" — week.ts:14-25, 287-296), so the UI does NOT need to resend. Only the
NBA-bridge legacy path (trust.ts:129-130, nbabridge.ts:356) still consumes
nextApproach per game. Same-wave staleness in the same file: the week.ts module
row (:36) still says "probabilistic integer training landings at the calibrated
rate" — training is now a deterministic pity-timer bank (week.ts:25-29: "the
old probabilistic +1 landings").
Breaks: the Traps section — the safety surface — actively describes semantics
the felt-loop wave (commit 976f511) removed.

## LOW docs/CAREER_INTERNALS.md:78-95 - stream registry misses three streams its own module headers document; circuits.ts header names the bracket stream wrongly
The table claims to collect the career streams "documented in their owning
module headers" (:75-76) but omits: `career-recruit:pace:<programId>`
(recruiting.ts header :27, drawn at :253), `career-phone-coach:<programId>`
(phone.ts header :53, drawn at phone.ts:214 AND recruiting.ts:242), and
`career-phone-close:<programId>` (phone.ts header :57, drawn at :1394).
Separately, circuits.ts:17 documents seedBracket's stream as
`career-circuit:<year>:bracket` while the actual derivation is
`career-bracket:<year>` (week.ts:268 — the registry table has the correct
name); inert only because seedBracket draws nothing (circuits.ts:1016-1017,
verified). These are ADDITIONAL registry errors beyond the
career-injury/career-train/career-next-coach rows other readers own (all three
corroborated in passing: week.ts:8-12 shows career-train reserved and
career-injury keyed by gameId; tick.ts:307 draws `career-next-coach`, absent
from the table).
Breaks: the registry's audit function — the collected list is the surface a
draw-reshuffle review reads.

## LOW packages/engine/src/sim/params.ts:2402 - dunkerDiveScale is live at 6 but still labeled "STAGED"
`dunkerDiveScale: 6, // STAGED — the W64 dose ladder owns the flip`. The flip
happened: W73 landed dose 6 (dunks 3.2/g, rim share 10.6%, 17/17 bands), and
the value is consumed live behind a `> 0` short-circuit (ai/offense.ts:335-337).
A live value carrying the STAGED tag violates the AGENTS §2.5 labeling
discipline and would mislead a staging audit or a sweep agent scanning for
dormant dials. The interface JSDoc (params.ts:1030-1036, "0 = staged inert") is
correct; only the default-site comment is stale.
Breaks: dead/staged-surface labeling, the exact discipline REGISTER W48/W67
enforce elsewhere.

## LOW docs/REGISTER.md:194 - W61 quotes `npm run batch -- --mirror`, a flag batch rejects at parse
cli.ts's checkFlags vocabulary (cli.ts:92) is `--games --seed --league
--workers --endgame --no-endgame --min-bands` — no `--mirror`; under the H-03
loud grammar the suggested command exits 1 before simulating. `--mirror` is
season-cli vocabulary (season-cli.ts:40), and at the library level run.ts
already mirrors batches by default (run.ts:31, :55 `opts.mirror ?? true`, odd
games flip). The suggested engine-owner check as quoted is a paste-and-fail
instruction (the same defect class W51 gated out of the README).
Breaks: a register row's re-measure recipe.

## LOW docs/REGISTER.md:53 - W3 status "not started" contradicted by W65's own "W3 first tranche" and 30 committed season files
W3's body still says "data/nba/ still holds only the two example packs" and its
status cell reads "not started", while W65 (:198) opens with "Real-roster
program (W3 first tranche)" and a second tranche, and data/nba/ holds all 30
2025-26 season files (atl-…lal-2025-26.season.json verified; CHANGELOG 0.2.0
says the same). Rows keep their record by design, but status cells are updated
on progress everywhere else in this register (D1, W9, W10…); W3's was not.
Breaks: the register's status ledger — the "not started" cell misstates the
project's largest data milestone.

## LOW docs/REGISTER.md:141 - W48's "PassEvent.kind ... zero consumers ... remain at HEAD" is half-stale: narration consumes it since 2026-07-30
The booth records the pass kind (narration/src/sense.ts:230 `kind: e.kind`) and
branches on it (beats.ts:247 `lastPass?.kind === 'kickout'`, :330 passKind) —
landed with 9609fd7 (2026-07-30), a day after the row was registered, which is
exactly the row's own "wire the cheap one" resolution, taken in narration
instead of texture.ts. The row was never updated. The other half stands:
ShotEvent.contestedBy has no consumer outside engine + tests (verified by
repo-wide grep).
Breaks: a live register row's premise; the "label/wire/drop" decision it asks
for is already half-taken.

## LOW CHANGELOG.md:7 - nothing recorded after v0.3.0: the dunker dive (engine mechanic), the fitter minutes fix, and the career fun wave are unreleased-and-unrecorded
The v0.3.0 tag sits at merge 6996ff3 (PR #20). On main after it, with no
[Unreleased] section: PR #23's minutes-targets fix (e6a7e15 — Hartenstein
11.5→24.0 min, a fitted-roster behavior change), PR #24's dunker dive (W73 —
an engine mechanic: dunks +68%, goldens re-baselined), and PR #25's career fun
wave (sticky approach cards, training pity timer, ladder-end invariant answer —
behavior changes to the shipped career mode). "All notable changes to hoopsh
are recorded here" (:3) plus the Keep-a-Changelog format the file declares both
expect these to appear.
Breaks: the changelog's completeness claim at HEAD.

## LOW docs/CALIBRATION.md:181 - "ground-truth row 34" is a dangling citation: no such registry exists in the repo
"do not tune it until one lands in `data/nba/` (ground-truth row 34)" — and
knobs.ts:231 cites "nba-ground-truth row 34" — but no ground-truth file exists
anywhere in the tree (searched; data/nba/README.md has no numbered table).
REGISTER.md declares its out-of-repo citation convention for Source columns
(:16-18); CALIBRATION.md and knobs.ts give the reader no such marker, so the
instruction's referent is unresolvable in-repo.
Breaks: a tuning prohibition's provenance chain.

## LOW docs/CAREER.md:421 - "Hard gates (the suite):" — the four hard gates run in gm:career-acceptance, not the npm-test suite
The section contrasts "Hard gates (the suite)" with "Reported bands
(npm run gm:career-acceptance)" (:432), implying the gates live in `npm test`.
All four (invariant at fleet scale, lint, determinism replay, careers complete)
run only in career-acceptance.ts (:8-16), which is outside the test glob by
design (CAREER_INTERNALS.md:126-127 states this correctly; unit-scale invariant
tests do run in the suite, approach.test.ts:132-156).
Breaks: where a reader would go to see the flagship gates fail.

## LOW docs/REGISTER.md:125 - W32's import.meta.main inventory is one file short at HEAD: solve.ts gates on it too
W32 lists fidelity.ts / fit-roster.ts / oos.ts as "the 3 files" carrying the
Node ≥24.2 `import.meta.main` silent-no-op hazard. At HEAD solve.ts:233 uses
the same gate (added post-registration; fit-roster.ts:920 even notes "solve.ts
is import.meta.main-guarded now"), so the row's remedy ("standardize ... across
the 3 files") under-counts the exposure by one CLI.
Breaks: the row's fix recipe; a standardization pass following it would leave
solve.ts latent on Node 24.0/24.1.

## LOW docs/REGISTER.md:198 - W65's open-residual list is stale: the Hartenstein/Dort minutes starvation is fixed at HEAD by a commit that cites the row
W65 still lists "OPEN residuals with numbers: Hartenstein 9.2 min vs 24.2
DESPITE starting ... Dort's supply collapse (2.3 FGA vs 7.6)". Commit e6a7e15
("minutes targets go to the core nine — the Hartenstein starvation (W65)",
2026-07-31, post-0.3.0) measured Hartenstein 11.5→24.0 min (real 24.2) and Dort
19.4→26.9 min (real 26.8) on OKC at n=12, unit-pinned — the rotation-return
question the row calls open is answered, and the Dort FGA number was read at
the starved minutes. Neither W65 nor W72's "Adjacent: W65's Hartenstein/Dort
supply questions" was updated.
Breaks: the register's memory of what remains open in the real-roster program.

## What is done well
- The register rows carry real falsification records, not just wins: W64
  documents three reverted experiments with the measured reason each died;
  W72's team-strength anchor was built, measured, REJECTED held-out, and
  explicitly NOT shipped. That is rare discipline.
- README quoted commands are gated twice over: readme.test.ts executes every
  runnable fenced line verbatim, and readme-claims.test.ts statically checks
  inline-quoted flags against each CLI's own checkFlags vocabulary and pins
  quoted batch game counts above the gate-active floor (the W51 incident became
  a durable, mutant-killing gate).
- Career doc numeric claims verify against code with unusual precision:
  reactGames 6, the 313-day league calendar (summed from calendar.ts
  constants), 52-week year, hofBallotYears 4, sixteen choice kinds, PREP
  4x8min/35s/one-and-one, the 65-game award rule, RouteOffer id-prefix
  authority — every one exact.
- The reacting-world invariant is genuinely unconditional in code (trust.ts's
  promotion branch has no trust or personality gate) and is tested in both
  directions plus at both ladder ends, with the acceptance harness polling the
  clock independently of the enforcement site.
- W68 is a model register row: it asserts a franchise defect precisely enough
  to re-verify in two minutes (performAction 'extend' → validateSigning
  ('extension') → meansErrors default branch), and the assertion is exactly
  right at HEAD.
- CHANGELOG measured claims cross-check against REGISTER to the decimal
  (54.0 floor / 54.1-54.2 assisted; G8c 0.00→1.75/g vs corpus 1.16;
  +0.05 passes/poss).
- The noise-floor doctrine text and its machinery agree: realism gates derive
  edge ± 3·sd from noise-floor.gen.ts (realism.test.ts:13-34), and calreport
  enforces the n40-grand-mean-with-se quoting rule its header narrates.

## Verified sound
- Every npm command quoted across the six docs names a real package.json
  script (sim, batch, bench, test, broadcast, viewer:embed, roster:new,
  roster:validate, season, sweep, fidelity, oos, texture, noisefloor, flow,
  flowboard, turing, calreport, fingerprint:write, nba:fetch/parse[-team],
  rosters:fit, gm, gm:acceptance, gm:career-acceptance, docs:bible).
- Flag parses verified against each CLI's checkFlags vocabulary: flowboard
  `--games 48` (and its `--games 0` refusal), fidelity `--games 40`, flow
  `--games/--seed/--league/--workers/--endgame/--no-endgame`, batch
  `--games 24|40|48|50|96`, sweep `--iters 0|14 --cands 4 --games 12
  --verify 40`, season `--teams 8` / `--matchup 0,3 --sims 200`, sim
  `--seed/--home`, oos (no flags quoted), noisefloor (plain), turing
  vocabulary, rosters:fit `--calibrate-three`, nba:parse `--from-shards
  --write-reference`, gm:acceptance `--seasons 5|2`, gm:career-acceptance
  `--careers 3`. Sole failure: W61's batch `--mirror` (filed).
- W63's rule claims: teamFoulBonusAtOT 4 (NBA) with carried thresholds (NCAA 7,
  FIBA-family 5); lateWindowSec 120 / lateWindowFoulBonusAt 2 NBA with NCAA/
  EURO explicit 0s; makeStopClock 120/60 NBA, 60/0 NCAA, 120/0 FIBA;
  foulTrailMaxClockSec 45; subMinBenchSec 420 — all present at the documented
  values in rulepack.ts / params.ts.
- W69's wiring: probeSwingBonus 0.15 / probeShootMalus 0.08 / probePressureFade
  1 live; the fade formula clamp(1 − fade·|scorePressure|) at concepts.ts:734
  exactly as the row states.
- W70's fix: updateConcede hysteresis (full floor with ≤1 starter counts as
  conceded; five-body guard) present in subs.ts:137-175; concede.test.ts exists
  and the tag-contains check confirms the fix is inside v0.3.0 as CHANGELOG
  claims.
- W73's mechanism: dunkerDiveScale consumed in offense.ts behind a `> 0`
  short-circuit that precedes the rng draw, as the byte-identity claim requires.
- W65's pipeline: fg_dunk → dunks, games_started → gs, team_misc → teamRatings
  all flow through parse-nba-team.mjs into fit-roster.ts's benchmark schema.
- Older-row spot checks accurate at HEAD: W47 (RATCHET_FLOOR still 16,
  cli.ts:87), W22 (job files unlinked on success only; no reap on start),
  W41 (all three params on the SimParams surface, none in knobs.ts),
  W9 (unitless "~4.2" comments still at params.ts:1841/1867), W58 (Post-shots
  row `ratchet: true`, lo 1.8, fidelity.ts:240), W45 (--from-shards re-bake
  recipe live in tools + data/nba/README).
- CALIBRATION.md structural claims: golden corpus is 28 entries at HEAD (24 +
  flag-off ×2 + NCAA + EURO, fingerprint.ts:50-89); release-audit arithmetic
  131 = 8+50+73; openerShootMalus 0.55 and pullUpThreeBonus 0.70 are the live
  defaults the re-fit block claims.
- CAREER_INTERNALS: reading-order files and every module in both tables exist;
  suite claims verified (invariant both directions, nbabridge swap-leak :118 and
  determinism :130, phone flood caps :192 and byte determinism :949, spine week
  determinism :211, circuits canonical projection :213-223); registry draw
  counts verified in code (career-scout 12 + bias 6, career-stock 1 gaussian,
  career-nba-coach 1 int, career-nba-offers fixed 5-draw block, career-bracket
  draws nothing); two-clocks numbers verified (52 weeks, 313-day calendar
  summed from constants, leagueDaysPerWeek 7, draftWeek 38); traps 1, 2, 3, 5,
  6 verified true (league.teams a Record at franchise types.ts:668; myLine
  season totals; foldSeason nulls the circuit at tick.ts:286; RouteOffer.kind
  college|euro|nbl with authoritative nba:/abroad: id prefixes and disclosed
  placeholder kinds at nbabridge.ts:550-663; loadCareer abroad rebind at
  saves.ts:62-73).
- README claims: reactGames 6 backs "within six games, always"; simulateGame's
  validate 'finite'/'strict' contract as described (game.ts:71-77);
  packages/career/src has zero node: imports (browser-safe claim); the
  "Live a career" onboarding string exists (boot.js:39); readme.test.ts +
  readme-claims.test.ts gates live as W51 claims.
