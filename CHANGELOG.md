# Changelog

All notable changes to hoopsh are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Dates are ISO 8601.

## [Unreleased]

Pass-volume increments 2 and 3 (REGISTER W74-W75) and the rim-supply
session (W76-W77), each plan-first with adversarial verifier gating and,
for the rim session, a primary-source audit of every reference number the
sim is compared against (findings/session7-plan*.md, session8-*.md).

Also in this window: the career fun wave, the dunker dive (REGISTER
W73), and the core-nine minutes-targets fix (W65).

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
- Dose re-landed at 0.5 on the amended mechanism: n=96 paired arms on
  two bases put the 0.5 astd purchase inside the priced window on each
  base independently with fgPct flat at every dose (the priced ceiling
  breach never materializes); 0.75 was declined — its pooled astd read
  sits on the window edge with the dose step disagreeing across bases.
  Goldens, provenance pin, F3 intermediate pins (re-anchored at the
  landing dose per the ruling), and the seed-anchored existence pins
  re-anchored per protocol, including one franchise-side pin
  (officials dir seeds) touched from an engine landing for the first
  time.

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

### Career (the fun wave)

A four-critic design audit played the shipped career mode; this wave
fixes what it measured. At the landing: 1401 tests, 0 failures; the
28-seed fingerprint corpus byte-identical (the engine untouched); a
three-career acceptance fleet completes with the determinism,
reacting-world, and explained-consequence gates all holding.

- Production feeds perception: a role-relative, efficiency-weighted
  production index blends into the perceived read at 0.30, shared by
  draft stock and recruiting. Stock previously read attributes only, and
  in the bust test the reckless chucker out-drafted the disciplined
  control (pick 10 vs 17); the mock now converges to the real boards
  (residual 19 picks to 2) and the fleet drafts phenom 1, four-star 4,
  walk-on 13. Feed hygiene drops sub-3-pick noise events; recruiting
  interest staggers over 7-12 weeks.
- The felt loop: the week's approach card grades both games of a
  doubleheader and persists as the standing approach; before the fix the
  second game was judged against a card the player never set. Card
  voltage 22 to 32 (a 70 dial lands the old 95's effect); energy under
  40 debuffs attributes linearly and injuries stream per game with the
  wear factor; role pars scale to the circuit's scoring world, so
  promotions fire inside a high-school season (measured week 2-3,
  previously zero all year); minutes follow the role (5.7 to 25.6 a
  night across the ladder); training banks fractional progress and lands
  every 6-7 weeks with no droughts.
- The phone: ghost recruiters are gone (65 counterfeit letters to zero);
  commitment, the bracket, the final, draft night, and the NBA debut
  speak in the established voices with real numbers; milestone stories
  arrive bylined on the wire thread; promises have memory
  (`promiseGraceGames` consumed, grievances conducted by the agent).
  Phone choices previously measured byte-identical across answer/ignore
  arms, and the 32-week post-commitment void (two alternating noise
  strings, 25% of all events) is closed.
- Surfaces: draft night runs as a green room with a pick-by-pick reveal,
  the player's takeover card, the rival chip, and an undrafted variant;
  signing day is a staged in-game sequence instead of a window.confirm
  dialog; the week screen carries the role clock, the stock line, offer
  expiry, and calendar countdowns; The Office answers contracts, free
  agency, declare/return/agent/trade/retire; a Me screen exists. The
  second act had been engine-complete with no interactive surface.
- Ladder ends: at the franchise rung, sustained above-band production
  resets into belief instead of a clock that sits at `reactGames`
  forever; the first verification fleet failed exactly this, 25 times.
- Registered, not gated: two boredom-band misses (zero-event streaks in
  one phenom corridor) remain as content work.

### Rim supply (session 6)

- The dunker dive (W64 increment 1, REGISTER W73): the dunker spot,
  excluded from cutting since the spot's introduction, now dives exactly
  when its ball-handler is mid-drive-commit (the dump-off timing),
  behind `ai.dunkerDiveScale` with a staged-0 short-circuit before any
  rng draw (byte-identity proven on the 28-seed corpus before the flip).
  Dose 8 seated league FG% exactly on the 49.5 band ceiling at n=48 and
  was rejected (the W26 ceiling-seat lesson); dose 6 landed: 17/17 bands
  (FG% 49.1), made dunks 3.2 per game (up 68% from 1.9), rim-possession
  share 9.0 to 10.6% at n=40, flowboard 10/13. The channel saturates
  near dose 8; the session-8 records above carry the successor channels.

### Fitting (real rosters)

- Minutes targets go to the mpg-ordered core nine and the tail plays
  untargeted fill (the roster fitter; REGISTER W65, the Hartenstein
  starvation). Targeting all twelve had structurally killed the engine's
  eager-return path (it swaps a behind-pace target in for an untargeted
  on-court body), and 240 game-minutes cannot hold twelve season
  averages (a real 12-man mpg column sums to ~290). Measured on OKC at
  n=12: Hartenstein 11.5 to 24.0 minutes (real 24.2), Dort 19.4 to 26.9
  (real 26.8), the core nine all within about a minute. Generated
  rosters do not pass through the fitter and are unchanged.

### Maintainability

- `sim/params.ts` split along its block seams (#36): eleven
  `params.<block>.ts` modules — the block's interface, calibrated defaults,
  and per-knob provenance map each — composed into the same flat `SimParams`.
  Pure refactor: serialization byte-identical, fingerprint corpus 28/28, not
  one value changed. Provenance (`REAL`/`SWEPT`/`FEEL`) is now machine-readable
  (`paramProvenance` + `params.provenance.ts`), and a new coverage test makes
  AGENTS.md DO-NOT rule 1 a checked property instead of an honor system.
- `verbatimModuleSyntax` is on in the root tsconfig (#80, issue #62):
  unmarked type-only imports and the other non-erasable syntax AGENTS.md 1.7
  bans now fail `npm run typecheck` instead of erroring at runtime under
  type stripping. The audit found zero violating sites; the diff is the flag
  plus its comment. Re-verified: fingerprint corpus 28/28 byte-identical,
  test counts identical (1542 tests, 1540 pass, 2 todo), typecheck green
  before and after.

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
- Team packs carrying `rotationMinutes` keys that match no player id are
  rejected at load: `validateTeamPack` checks each key against the pack's
  player ids, ending the silent acceptance behind the #39 dead-rotation-map
  incident class (85% self-play loss). roster:validate drops the orphaned
  rotation-unknown-id warning and moves its did-you-mean suggestion into
  the rejection explainer (#79, issue #60). Re-verified: test counts 1542
  to 1544 (the two new validation tests), fingerprint corpus 28/28
  byte-identical.

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
