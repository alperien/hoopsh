# Calibration — workflow, doctrine, and the current measured state

Split out of `docs/INTERNALS.md` (which now carries only the module map,
design rules, and safety net) and AGENTS §4.4. This file is law for anyone
touching `sim/params.ts` values, `harness/src/bands.ts`, or mechanics that
consume them — read it together with AGENTS §4 (the verification ladder and
tiers). Superseded measured-state eras live in
[history/calibration-eras.md](./history/calibration-eras.md); only the
current state is documented here.

## The workflow

1. Change mechanics → `npm test` (invariants + wide guard must stay green).
2. `npm run batch -- --games 24` → see which bands drifted.
3. `npm run sweep -- --iters 14 --cands 4 --games 12 --verify 40` → let the optimizer
   re-center; bake the printed diff into `params.ts` defaults (keep the odd
   precision); verify with `npm run sweep -- --iters 0 --verify 40`.
4. Regenerate the noise floor: `npm run noisefloor` writes the sampling
   distribution of every gated statistic (`noise-floor.gen.ts`) and the
   permanent gates derive widths from it. Its diff is the accepted-drift
   record.

## Etiquette and the noise floor

- The NBA bands (`harness/src/bands.ts`) are the gate — count them there,
  never from memory (the list grows).
- The noise floor is MEASURED, not guessed: `npm run noisefloor` samples
  every gated statistic across independent seed bases at the gates' sample
  sizes and writes `noise-floor.gen.ts`; the permanent gates derive their
  widths from it (edge ± z·sd, z=3), so a gate failure means "the sim
  changed", not "the seed changed".
- Never adjudicate anything from one or two draws — that is chasing noise
  (measure more bases instead); never hand-nudge what the sweep owns; never
  quote a stale pass-rate in docs — state where to measure it instead.
- A center sitting on or outside a band edge is a systematic finding for
  this file even while the z-gate passes — record it in the measured-state
  section below.
- After the sweep prints a diff, bake it into `params.ts` defaults (keep the
  odd precision), then re-verify with `--iters 0`.

## What "locked" does and does not claim

"Locked" means: at 40+ games, every band's measured CENTER sits inside its
band. The bands are league-mean aggregates on the repo's own rosters, and
the sweep tunes the same knobs the bands grade — so a locked state
demonstrates the model CAN express modern-NBA averages, not that it is
identified (with 100+ free parameters against ~17 loose constraints, many
parameterizations pass). Held-out validation is the fidelity suite
(player-level, profiles authored independently of the sweep) and the
out-of-sample roster check in the harness; distributional realism (score
variance, blowout rate, quarter profiles) is reported but not yet enforced.
Treat band-locked as "necessary, not sufficient".

## Current measured state

Magnitudes from `npm run noisefloor`; positions from `npm run calreport`,
which quotes n40 grand-mean centers with standard errors — quoting a
smaller nested window's mean as "the center" was an error the third review
caught, twice, in our own write-up.

**PASS-VOLUME + RIM-SUPPLY ERA — measured 2026-07-31, recorded 2026-08-01
at main `34ccb6c`.** Four engine landings on 2026-07-31 moved the streams
past the two 2026-07-30 blocks this section carried (both compressed to
pointers below): the rules landing (W63: OT bonus threshold, the last-2:00
team-foul penalty, made-basket clock stops), the v0.3.0 probe flip and
concede hysteresis (W69/W70), the dunker dive (W73, `15b37c0`, PR #24), and
pass-volume increments 2 and 3 (W74 pass-flight clock charge, W75
`pass.riskBase` -3.75; live at `6728dfe`, PR #27) with their sweep
re-center (`70672f3`). The rim-supply session (PR #30) landed wiring and
measurement but moved no default: the lob fusion was falsified and stripped
(W76), and the transition leak-out ships STAGED at `leakOutScale: 0` (W77).
The realism wave (PR #31) and the career surfaces (PR #45) are
franchise/app-side; the engine stream held byte-identical through both
(28-seed corpus, `7fce52d`). Issue #39 (flow re-measurement at HEAD) and
issue #42 (noise-floor regen) run against this state; their numbers
supersede the matching rows here when they land. Every number below carries
its as-of commit.

- **Suite: 1531 tests / 1529 pass / 0 fail / 2 todo** (`npm test` prints
  the live count; measured 2026-08-01 at `34ccb6c`).
- **Golden corpus: 28 entries** (24 default-config plus the four H-04
  guards: flag-off ×2, NCAA, EURO; the in-suite flag-off byte-identity
  twin still runs under `npm test`), re-baselined at the pass-volume flip
  (`381752b`; the diff is the drift record).
- **Acceptance: 17/17 at n=48**, measured 2026-08-01 at `34ccb6c` (seed
  base `acceptance`; FG% 49.0 vs the 0.495 ceiling, assisted share 61.0 vs
  the 62.0 ceiling). Verify 40x3 read 17/17 at the W75 sweep re-center
  (`70672f3`), and 17/17 held on two bases at the increment-3 final tree
  (W75). fgPct now runs HIGH in its band by design: 49.1 at the dive
  landing (W73; dose 8 seated ON the ceiling and was not shipped). The
  release-audit era's "48.93, headroom below" story is superseded; the
  live watch is the ceiling side. Re-measure:
  `npm run batch -- --games 48|96`.
- **G11 (shot diet): a dial IS baked and live.** `ai.dunkerDiveScale: 6`
  (W73, `15b37c0`): made dunks 3.2/g (+68%), rim-possession share
  9.0 → 10.6% at n=40. `ai.leakOutScale: 0` STAGED (W77, `179a010`): full
  dose read made dunks 8.7/g and rim share 14.8% at the pinned flowboard
  convention, G11's first in-band reads on both counts, but the raw flip
  breaks 6 bands (assisted share 71% vs the 62 ceiling) and two sweep runs
  plus a directed probe showed the band geometry cannot absorb an assisted
  channel at gate-moving doses (the dive, the leak, and any lob compete
  for ~5pp of assisted-share headroom). G11 stays open at defaults; the
  flip waits on the unassisted-rim supply arc (W64/W77).
- **Pass volume: the probe is live, priced across three increments.** W69:
  probe 0.15/0.08 with `probePressureFade` 1, the shipped answer to the
  W28 interaction. W74: pass-flight clock charge at the 1.5 s get-off
  window; grenade-class violations fell 91% and holder-side violations
  exist for the first time. W75: `pass.riskBase` -3.75, rails narrowed to
  [-3.8, -3.7] (both true walls are band-invisible). Texture at the final
  tree (W75): 1.82/1.86/1.86 passes/poss vs corpus 2.84-2.86, a fifth of
  the gap closed in one landing; the remainder is structural supply, not
  pricing. Watch item: the self-play theta delta rides a CI edge
  (-0.017 ± 0.026, W75). Issue #39 re-measures the gap and the coupling
  interaction at HEAD.
- **OOS: 17/17 at the W75 final battery**; all four registered marginals
  back in band (FG% 49.6, 3PA share 32.5, BLK 6.6, assisted 53.7).
  Supersedes W71's 15/17 read and the release-audit block's B2-era
  standing caveat on `npm run oos`.
- **Fidelity: enforced misses 5 → 2** at the W75 final tree (Jokic AST
  reached his fixture floor for the first time; the remaining two are the
  registered W29/W58 debt; Curry AST stays the W71 owner-ruling class).
- **Noise floor: regenerated at the pass-volume landing** (`6c98849`,
  post-dive and post-increments; its diff is the drift record). Goldens
  re-baselined at the flip (`381752b`); session-7 pin re-anchors at
  `68aaa56`. Issue #42 was dispatched from an audit base that predates
  `6c98849`; reconcile its premise there. Read floor centers from
  `noise-floor.gen.ts` / `npm run noisefloor`, not from this file.
  `npm run calreport` has no fresh read recorded at `34ccb6c`; take one
  with issue #42's regen before quoting positions from it.
- **Flow instruments: no fresh full read at `34ccb6c`.** Flowboard spot
  reads live in the landing rows (W63: G8 closed at 1.75-2.48/g live-ball
  subs; W73: flowboard 10/13; W77: the staged leak-out's reads). A full
  flow/flowboard sweep at HEAD is issue #39's deliverable.
- **astdShare band corrected from sourced data; fgPct edges annotated
  (#56; owner draft PR #78 `1d7dc743`, adopted, re-cut and re-measured
  2026-08-02 at main `e05267fb`, branch `calib/i56-astd-band`).** The
  enforced astdShare band was 54.0-62.0 on a recalled provenance claim
  ("recent seasons ~56-59%"). Sourced reads, reproduced fresh at this
  branch (fourth independent count, exact): 63.80% pooled (9795/15352
  assisted FGM, 184-game 2025-26 pbp corpus; per-game mean 63.73%, sd
  6.49pp, se 0.48pp, n=184; parse recorded at the band; corpus shards
  bit-identical since the draft, tree `594f3034`) and 63.27% derived
  for 2023-24 (ast 26.7 / fg 42.2, both verbatim in
  league-averages-2023-24.json). Both sourced seasons sit above the old
  ceiling: a sim matching reality exactly failed the old band.
  Corrected band 59.8-67.8 = sourced center 63.8 +/- the incumbent
  4.0pp half-width (width FEEL until era data lands). One provenance
  correction against the draft: corpus FGA is 32452 (makes 15352 +
  misses 17100, zero dual-pattern rows), not the draft prose's 32458;
  FG% 47.31 was already consistent only with 32452. This row supersedes
  the 62.0-ceiling framing in the acceptance and G11 rows above. What
  the edit re-prices: W6's n=96 adjudication frame (superseded; 62.0
  was not a real edge); the two binding adjudications, re-measured
  against the corpus in the #39 addendum (probe dose 1.5 at n=1440/arm,
  W77 leak 0.35 at n=288/arm); the G11 headroom arithmetic (~7.6pp from
  the 60.19 n40 floor center to the 67.8 ceiling at this head); and the
  sweep's centering objective (sweep.ts CENTER_W), which now pulls
  astdShare UP toward 63.8 instead of DOWN toward 58.0. THE KERNEL
  MOVED UNDER THE DRAFT and the draft's flicker claim is superseded:
  the draft measured the corrected floor 2.4 draw-sd below the 61.43
  center (<1% per-draw flicker); four kernel movers later (W84 putback
  0.3, W85 blow-by 0.5 at a measured -0.63pp astd, #119, #160) the
  committed noise floor reads astd n40 center 60.19%, sd 0.86pp, so the
  floor sits 0.46 n40-draw-sd below center. astdShare is now the
  run-to-run boundary band at n<=96 reads (~1 in 3 n40/n48 draws read
  under; measured this session: 0/12 under at n=48 and one of three n=40 verify bases under at 0.59, i.e. 1 of 15 fresh draws; fresh-base weighted center 60.39 over 1536 games, the session's full fresh-base slate of 3x288 + 96 + 12x48, not the 12 n=48 bases alone; CI's batch
  gate floor 16/17 absorbs the lone flicker by design). Session-read
  provenance (PR #78 review 4838517576, disposition 5158044082): the
  12-base n=48 pool's seed names went unrecorded, against the
  register's pool-naming convention (the W84/W85 "pool name-1..n"
  shape), so the 0/12 read is not reproducible as recorded and ran
  high; the review's independent pool flick-1..12 at n=48 read 4/12
  under the floor (mean 60.23, sd 0.68pp), all 12 CI-green (every
  failure a lone band at 16/17, at or above RATCHET_FLOOR 16), and
  stands as the reproducible counter-sample of record. Plan on the
  analytic ~1 in 3, not 0/12. Count wording, aligned: this row's
  fourth-count phrasing and the bands.ts comment's three-prior-parses
  phrasing describe the same series (three prior parses plus this
  branch's own); the review's clean-clone recount is the fifth. The center
  itself is INSIDE by 2.9 center-se (se 0.14pp over 40 bases): the
  deficit to the real center, ~3.6pp at this head, is the D1b/supply-arc
  story (W84/W85 deliberately spent astd for unassisted rim volume; the
  #58 arc exit buys it back toward 63.8). Measured at this branch:
  fingerprint identical (1188 events / CAS 108 - MER 121; corpus
  28/28 both trees), suite 1696/1694/0/2 (452 suites) identical both sides, batch
  n=96 17/17 (astd 60.2 vs 59.8-67.8; fresh n=288 bases 60.1/60.4/60.3, 17/17 x3),
  verify 40x3 17/17, 17/17, 16/17 (swp-gamma astd 0.59; the rung exits nonzero, adjudicated per the W85 verify precedent), oos 15/17 report-only (astd 58.6, the W14 class; fgPct 50.1, ceiling flicker), fidelity gate exit 0 with
  the registered W29/W86/W87 QUAR lines standing and Curry AST 8.4 in
  range (W71, silent). fgPct: sourced 47.4% (2023-24) and 47.31%
  (corpus) sit inside 44.0-49.5 with house-normal margins (ceiling
  +2.1/+2.2pp, the tpPct/ftPct margin family); the edges stand,
  annotated at the band; the sim's high-in-band position stays the live
  watch item. Re-measure: `npm run batch -- --games 48|96`; adjudicate
  astd at n>=288.

## Endgame layer status

Implemented AND default-ON. The historical diagnosis (the review's sharpest
cut) held that near-ties are played out instead of MANAGED. All five
once-missing behaviors exist in `sim/endgame.ts` + concept 6
(`sim/ai/concepts.ts`): timeouts (advance + stop-the-run triggers, budget
from the rule pack), intentional fouling, hold-for-last, two-for-one, clock
burn, plus trailing-team hurry. The default flipped ON at the
calib/integration landing on the n=1260-games-per-arm survey evidence (the
survey record and the Q4-profile watch item are in
docs/history/calibration-eras.md, B1 block); `endgame: false` preserves the
byte-identical pre-layer path (verified at scale: 0 timeout events in 1,260
flag-off games). The magnitude dials are registered in `harness/knobs.ts`
and the coordinated sweep re-centered three of them; the window/threshold
dials stay off the sweep surface by doctrine (identity-shape gates are
design, not calibration), and `timeoutRunPts` has no cited real base rate —
do not tune it until one lands in `data/nba/` (ground-truth row 34).

## Superseded eras (full records in history)

Three-line pointers only; the full blocks moved verbatim to
[history/calibration-eras.md](./history/calibration-eras.md):

- **Release-audit fix wave** (2026-07-30, `fix/audit-integration`): the
  40-agent audit of `edb9e3d` (131 findings, 0 CRITICAL / 8 HIGH) fixed at
  the root; the H-01 hoist put ~38 inline constants on SimParams at
  identical values; suite 470/469/1 todo; acceptance 17/17 at n=96 with a
  16/17 fgPct draw-flicker at n=48; floor `7e814a5`, goldens `59fd74c`.
  Headline records: REGISTER W54 (wave summary), W55 (deferrals). Full
  block: this file's git history (revision `34ccb6c`); the verbatim move
  to history/calibration-eras.md is owed at the next history
  consolidation.
- **Flow re-fit** (2026-07-30, `flow/rebased`): the flow program's flips
  live and band-locked 17/17 at n=48 (`6c109d2`); `ai.openerShootMalus`
  0.32 → 0.55, `ai.pullUpThreeBonus` 0.35 → 0.70, the G6 makes-clause
  correction; G11 registered then as "dial surface exhausted" (W57), a
  verdict since superseded by the W73 dive and the staged W77 leak-out.
  Floor at the re-fit stream `33c65e4`. Headline records: REGISTER
  W56/W57. Full block: this file's git history (revision `34ccb6c`), same
  consolidation note as above.
- **Scan-fix wave landing** (2026-07-29, tune `60eda3f` / floor `60c71d1`):
  the fga inversion (box.ts charged FGA on fouled misses — under official
  counting the sim was never over-shooting; fga re-read 91.69 → 86.04 at
  the fix, 88.75 at the re-centered floor), the shot clock unfrozen during
  pass flights, the blitz revived, matchup retargeting on subs, the
  flow-base instrument corrections; verify 40×3 17/17 ×3 (score 4.115).
  Headline records: REGISTER W30 (wave summary), W26/W16 (fga
  supersession). Exception to the rule above: this era's full measured
  block is still in this file's git history (revision `7e814a5`) — the
  verbatim move to history/calibration-eras.md is owed at the next history
  consolidation (kept out of the audit wave's docs-only landing).
- **B2 game-state landing** (2026-07-28, `4bd7a72`): coupling live at
  g=0.3, concede live, probe staged at zero; the landed distribution record
  (mean |m| 12.41, blowout 19.2%, self-play signed sd 15.52) — headline
  numbers also in REGISTER W14/W17/W18; residuals W24-W29.
- **B1 integration landing** (2026-07-28, `7e05c97`): first full band lock;
  endgame default ON; charge-composition fix; fga/ftPct directed re-search —
  REGISTER W1/W2/W15/W16.
- **Pre-integration state** (2026-07-27) and older eras (arrival-based
  drive commit, the friction signature and its speed-units artifact,
  elite-shooter assist center, oos/texture reads at the B1/B2 landings):
  history file; re-measure before quoting any of it.
