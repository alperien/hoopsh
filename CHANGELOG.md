# Changelog

All notable changes to hoopsh are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Dates are ISO 8601.

## [Unreleased]

Pass-volume increments 2 and 3 (REGISTER W74-W75) and the rim-supply
session (W76-W77), each plan-first with adversarial verifier gating and,
for the rim session, a primary-source audit of every reference number the
sim is compared against (findings/session7-plan*.md, session8-*.md).

### Unassisted-creation supply arc, increment 1 (#74, REGISTER W82)

- The transition carry, STAGED at `ai.transCarryScale: 0`: on a
  live-rebound/steal possession with the retreat beaten, a committed
  drive finish releases at the rim plane by construction instead of the
  behind-plane stop-out. The pre-diff probe on #74 localized the G11
  deficit to release geometry (beaten-break finishes at median 4.8 ft
  against the booth's 2.25 ft book boundary, 0-8% at the plane; plane
  releases convert at 59-67%), and branch instrumentation localized the
  artifact to the sprinting body's stopping distance. Same decides, same
  labels, same make model; the contest still reads off the body at
  release; dunk-class books through the booth's existing rule. One new
  knob (FEEL, hard-zero short-circuit checked first, heave-guard arming
  draw, knobs.ts range in the same PR); params-provenance pins
  re-baselined; off-state streams byte-identical.
- Amended pre-merge on the PR #75 Red Team probe (Lead ruling, four
  findings). F1: the carry's reach was uncapped up to the drive-label
  range and the frame ball rode the sliding body — fixed with
  `ai.transCarryGatherFt` (4.5 ft FEEL, the carry's own decide-time
  reach gate; SHAPE, deliberately not sweepable) plus the carried
  windup's honest ball path (decide-spot -> rim lerp; the release-tick
  frame-ball -> booking gap collapsed from p50 4.87 / max 9.95 ft to
  p50 0.51 / max 2.01). F2: the phase and commit gates pinned
  condition-by-condition on hand-built states (`carriesToRim` extracted
  as the seam; probe mutants verified red). F3: the arming-draw region
  pinned with exact stream checksums at an intermediate scale and the
  draw-free top (both probe mutants verified red; re-anchored to the
  landing dose at the dose commit). F4: the scout denominator defined —
  pool counts are per team-game (24 seeds = 48 team-games). The 0.5
  dose landing was reverted first (amendments precede dose selection);
  re-selection on the amended mechanism rides the re-run ladder.

### Rim supply (session 8)

- Reference-data audit: every comparison target re-verified against its
  primary source — the Wayback tracking snapshots reproduce to four
  decimals, live basketball-reference matches the committed league
  averages 10/10, the 184-game play-by-play corpus matches live pages
  verbatim on sampled games with ESPN cross-checks, flow-reference
  reproduces 217/217 from the committed shards, and the 30 season files
  match independent outlets exactly. No fabricated numbers anywhere.
- The lob fusion was built, measured across four shape iterations, and
  FALSIFIED: the engine's ordinary catch-decide-windup path is its true
  one-motion finish, and every fusion variant released outside the dunk
  band (W76). Machinery stripped the same session.
- The transition leak-out works mechanically — made dunks 3.5 to 8.7 per
  game and rim share 11.0 to 14.8%, both in the G11 band for the first
  time — but is BLOCKED by assisted-rim saturation: every leak finish is
  assisted, and two sweep runs plus a directed probe show the band
  geometry cannot absorb it without eating the dive channel (W77). The
  wiring ships STAGED behind a per-possession dose dial; the flip waits
  on an unassisted-rim supply arc (the sharpened W64 prerequisite).
- New tests: leak-out pins (sabotage-verified) and the engine-booth
  dunk-gate mirror.

### Engine

- Concept 12, the pass-flight clock charge: the chooser now prices a
  receiver's shot at the clock he will CATCH with (the world has charged
  pass flight to the shot clock all along). Before the fix every measured
  shot-clock violation was a grenade catch — a pass arriving inside 1.5
  seconds; at the shipped get-off window (1.5 s) that class falls 91% and
  holder-side violations exist for the first time. Pass volume unchanged
  by this fix alone; buzzer-beater rates flat.
- `pass.riskBase` re-priced -3.6 → -3.75 (the W16/FLOW riskening partially
  reversed, measured safe only WITH the probe and concept 12 live). The
  deeper -3.82 dose met every band but spent 4.2 points of favorite-win at
  n=1080 and died at the pre-registered line — the shipped dose spends
  3.0. Sweep rails now encode both band-invisible walls ([-3.8, -3.7]).
- Sweep re-center at the landing (verify 40x3, 17/17): the added live
  possessions pressed REB and the efficiency ceilings; fifteen SWEPT dials
  absorbed them. riskBase itself untouched by the optimizer.

### Measured at the landing

- Texture passes/possession 1.61 -> ~1.85 (corpus 2.84-2.86): a fifth of
  the gap closed in one landing, ping-pong share flat.
- Out-of-sample rosters 13/17 -> 17/17 — all four registered marginals
  (FG%, 3PA share, BLK, assisted share) back in band.
- Player fidelity enforced misses 5 -> 2: Jokic's assists reached his
  fixture floor for the first time; the two remaining misses are
  pre-existing registered debt.
- Theta and assist-hierarchy identity preserved on both w19 cohorts at
  n=1080 per arm; the self-play theta delta rides a CI edge and is
  registered as a watch item.

### Maintainability

- `sim/params.ts` split along its block seams (#36): eleven
  `params.<block>.ts` modules — the block's interface, calibrated defaults,
  and per-knob provenance map each — composed into the same flat `SimParams`.
  Pure refactor: serialization byte-identical, fingerprint corpus 28/28, not
  one value changed. Provenance (`REAL`/`SWEPT`/`FEEL`) is now machine-readable
  (`paramProvenance` + `params.provenance.ts`), and a new coverage test makes
  AGENTS.md DO-NOT rule 1 a checked property instead of an honor system.

### Fixed

- The types CI job is green on main again: two franchise test files carried
  strict tsc errors from the #31 merge, fixed with type-level changes that
  erase at runtime and touch no assertions (#53, issue #51). Re-verified:
  test counts identical before and after (1531 tests, 1529 pass, 2 todo),
  fingerprint corpus 28/28 byte-identical.
- Career and league saves are refused mid-run (409): both save routes now
  carry the sim.running guard every adjacent mutation already had, closing
  the torn mid-run save that permanently drifted career/league clock sync
  (#29). Re-verified: two new guard tests red on unfixed code and green on
  the fix, fingerprint corpus 28/28 byte-identical.
- Ring harvest keys on season rows, not the current team pointer: a ring
  now requires the player on the champion's roster in that season, ending
  pre-entry rings and restoring descent-phase earned rings (#32).
  Re-verified: two of four new epilogue tests red on unfixed code and green
  on the fix, fingerprint corpus 28/28 byte-identical.

### Docs

- docs: per-tier verification checklists on one page, docs/CHECKLISTS.md,
  linked from the README and the docs hub (#46, issue #38). Re-verified:
  fingerprint identical before and after, Bible regenerated in the same
  commit.

## [0.3.0] - 2026-07-31

Ball movement, priced. The pass-volume probe (concept 8) is live for the
first time, the concede thrash is fixed, and the real-roster fits close
their biggest identity gaps. Measurement records in docs/REGISTER.md
W69-W70 and the W65 update (renumbered past the career landing rows W66-W68, which reached main first).

### Engine

- Concept 8 (probe culture) is LIVE at the B2 dose (swing 0.15, malus
  0.08) with the new pressure fade: the probe yields exactly where the
  game-state coupling expresses (`ai.probePressureFade`). Measured at
  n=360 per cohort on fitted rosters: +0.05 passes per possession, theta
  and the favorite's win rate preserved, and the acceptance bands read
  17/17 at n=48 — the assisted-share residual from 0.2.0 is back in band
  (54.1-54.2 vs the 54.0 floor), exactly the upstream-swing protection the
  probe's design predicted. The unpriced flip was re-measured destructive
  first; the fade is load-bearing.
- Field-state hysteresis on the concede band: a full floor with at most
  one starter inside the band stays conceded, ending the measured ten-body
  thrash cycle (five starters returned and re-benched within ten game
  seconds on a knife-edge margin). Sub-grammar volume moved another point
  toward the corpus.

### Fitting (real rosters)

- Starting fives come from basketball-reference games-started, not
  minutes; all 30 season files carry the column.
- `rosters:fit --calibrate-three N` closes the tendency-versus-EV loop in
  team context: SGA's simulated three-point volume went from 0.5 to 3.8
  attempts per game (real 4.4), Fox from 0.6 to 3.6 (real 5.5).
  Saturation cases are reported honestly as engine levers.

## [0.2.0] - 2026-07-31

The realism landing: three real NBA rules the packs had simplified away, a
real-roster data pipeline, and measured movement on the play-by-play
indistinguishability gates. Full measurement records in docs/REGISTER.md
W63-W65 (renumbered past the franchise landing rows W59-W62, which reached main first).

### Rules (engine)

- The NBA last-two-minute team-foul penalty (Rule 12B VII): in the final two
  minutes of each period the second window foul pays free throws. New
  RulePack fields `lateWindowSec` / `lateWindowFoulBonusAt`; NCAA and
  EuroLeague explicitly carry no such rule.
- The overtime bonus threshold: the NBA drops to 4 team fouls in OT
  (`teamFoulBonusAtOT`); carry-over leagues keep their regulation threshold.
- Made-basket clock stops per pack (`makeStopClockFinalSec` /
  `makeStopClockEarlySec`): NBA 120/60, NCAA 60/0, FIBA 120/0. The frozen
  clock legally opens the last-minute substitution windows real games have.
- `FoulEvent.inBonus` is now the standing penalty state and remains fully
  reconstructible from the event stream; the event-contract doc carries the
  derivation.
- Companion endgame fits: the foul-hunt window widened to 45 s (hunted grabs
  now pay), the bench-return floor to 420 s.

Measured at the landing (flowboard vs the 184-game corpus): sub-grammar gate
G8 passes all four metrics (live-ball post-make subs 0.00 to 1.75 per game
against a corpus 1.16); the Q4 free-throw climb mechanism exists (+5% to
+11-30% by seed base); Q4 stopped being the highest-scoring quarter.
Acceptance bands 16/17 at n=48 (assisted share 53.6% vs a 54% floor is the
registered residual); the golden fingerprint corpus was re-baselined as the
drift record.

### Real rosters (data + harness)

- New pipeline: `npm run nba:fetch-team` / `nba:parse-team` turn
  basketball-reference team-season pages into committed, provenance-stamped
  season-lines files. All 30 teams' 2025-26 season files ship in data/nba/.
- The roster fitter reads real dunk volume (`fg_dunk`) and inverts the dunk
  call's athlete gate from both sides: real dunkers clear it, real
  non-dunkers stay under it.
- Current Spurs and Thunder rosters fit and verified against their real
  per-game lines over simulated meetings; identity findings (slasher
  three-point volume, secondary-creator assists, double-big minutes) are
  registered with numbers.

### Fixed

- turing accepts its own documented flags; broadcast and flowboard reject
  unknown or valueless flags loudly; flowboard refuses `--games 0`.
- Overtime periods label as OT in the booth pipeline and saved play-by-play.
- The replay viewer no longer bricks after a degenerate replay drop.

## [0.1.0] - 2026-07-31

First tagged release. hoopsh is a deterministic 2D spatial basketball
simulation core: ten agents move on a real court at 10 Hz, and discrete
outcomes (shots, passes, fouls, rebounds) resolve through logistic probability
models fed by spatial context. The same seed produces a bit-identical game, so
a game is a file you can replay, diff, and share.

### Engine

- Deterministic tick engine on a seeded sfc32 Rng. The same seed gives
  bit-identical events and frames in Node and the browser, and the engine
  imports nothing (no npm packages, no Node built-ins).
- Spatial offense and defense: spacing, drives, kick-outs, cuts, closeouts,
  help rotations, box-outs, pick-and-roll, post-ups, dribble-handoffs, and
  isolation, all emergent from geometry and incentives rather than scripted.
- Shot windup with self-consistent shot selection: the model that resolves a
  shot is the model the AI uses to choose it, so decisions and outcomes cannot
  drift apart.
- Late-game management, on by default: timeouts, intentional fouling,
  hold-for-last, two-for-one, and clock burn. Setting `endgame: false` selects
  the byte-identical legacy path.
- Score-pressure coupling: trailing teams press up and decided games wind down
  through the benches.
- A game-wide timeout economy and an officiating vocabulary (jump balls,
  violations, replay reviews), carried by replay format v3.

### Consumers

- `@hoopsh/stats`: event streams fold into box scores, exact minutes and
  plus-minus, advanced stats, and shot charts. Box scores reconstruct from the
  event stream alone.
- `@hoopsh/narration`: template play-by-play with run and milestone awareness,
  a two-voice broadcast booth (see docs/BROADCAST.md), and an LLM
  color-commentary seam.
- `@hoopsh/data`: player and team schemas, validation, archetype builders, and
  sample packs.
- `packages/viewer`: a single-file 2D canvas replay viewer. Drag any replay
  JSON onto it.

### Harness and tooling

- Batch runner graded against NBA acceptance bands, an automated parameter
  sweep that re-centers the bands after mechanics changes, a throughput
  benchmark, and a golden fingerprint corpus of 28 seeds.
- A stateless season driver with standings and Monte-Carlo matchups (see
  docs/SEASON.md).
- An NCAA rule pack behind the harness `--league` flag (rule coverage partial).
- Roster tooling: schema generation, a scaffold wizard, a validator, and a
  stats-to-ratings fitter.
- A 184-game parsed NBA play-by-play corpus grounding the flow references,
  with its provenance recorded in data/nba/.

### Quality

- A permanent invariant suite derived from adversarial audit rounds, an
  adversarial-input fixture, and a CI pipeline that runs the test suite, the
  gated acceptance bands, the fingerprint corpus, a two-run determinism check,
  a strict typecheck, the same suite under real vitest, and a
  documentation-drift check.

[0.3.0]: https://github.com/alperien/hoopsh/releases/tag/v0.3.0
[0.2.0]: https://github.com/alperien/hoopsh/releases/tag/v0.2.0
[0.1.0]: https://github.com/alperien/hoopsh/releases/tag/v0.1.0
