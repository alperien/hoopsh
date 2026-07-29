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

**SCAN-FIX ERA — measured 2026-07-29 on `fix/scan-integration`.** The wave
is 23 parallel line audits (findings/scan/\*.md, the swarm run's findings
files per the branch citation convention) → 140 findings, ~118 fixed at
root across 3 high-fix + 4 med branches (18 commits; highs individual, meds
squashed), 25 owner-call items registered instead of fixed
(findings/scan-register.md → docs/REGISTER.md W30+). Landing point: the
re-center `60eda3f` (tune) / `60c71d1` (floor). Re-measure commands per
finding.

- **THE FGA INVERSION — the instrument over-counted; the sim was
  never over-shooting** (scan b1-HIGH / a4-F2; fix commit `5d9671f`,
  consumer tier — engine fingerprints untouched). `stats/box.ts`
  charged an FGA on EVERY `shot` event, but the engine also emits one
  for a shooting-foul miss, and official scoring — the convention
  behind every real reference number this repo calibrates against
  (bands.ts fga/fgPct, fit-roster season lines, tsPct's 0.44 FTA
  weight) — charges NO attempt on a fouled miss. Measured at the fix
  commit (2026-07-29, 24-game acceptance batch): 5.65 fouled-miss
  shots/team-game had been counted; fga re-reads 91.69 → 86.04 and
  fgPct 46.0% → 49.1% under official counting. Against real 2023-24
  FGA 88.9 the sim sat BELOW real volume the whole time. **The
  "fga hugs its ceiling" narrative (the B1 fga-residual adjudication
  and B2's verify-flicker bullet — both now in
  docs/history/calibration-eras.md; REGISTER W26) is retired as a
  cross-convention artifact**: it compared a fouled-miss-inclusive
  measurement to a fouled-miss-exclusive target (~6 attempts of
  hidden slack, ~2× the band's total headroom — a4-F2). Player-level
  effect confirmed: foul-drawing players' FG% was systematically
  deflated (LeBron FG% n12 center 0.481 → 0.527, now inside his
  real-anchored [0.50, 0.58] profile). Post-re-center position
  (2026-07-29): fga n40 center 88.75 (sd 0.65) at the `60c71d1`
  floor — mid-band, 0.15 under real; acceptance batch reads 88.7 at
  n=48 / 88.8 at n=96 (`npm run batch -- --games 48|96`, re-run at
  HEAD for this record). fgPct n40 center 48.2% now runs nearer its
  0.495 ceiling — the sim's true efficiency was always ~real
  (2023-24 ≈ 47.4%); the old instrument hid it.
- **The shot-clock bug: the clock froze during pass flights**
  (a1-MED / a4-F1 HIGH; fix commit `a768dae`, mechanics tier).
  tickLive froze the shot clock for BOTH flight kinds where the
  documented rule freezes it only for a released shot — every pass
  granted the offense its flight time free (~0.2-1.0 s/pass), and
  whistle-free possessions measured up to 26.9 s at the 48-game
  verification base (31.4 s max on the 120-game probe) under a 24 s
  clock. Post-fix (48 games, seed base acceptance, 2026-07-29):
  shot-clock violations 0.02 → 1.79/game, max whistle-free span
  24.5 s (the residual is the arrival-whistle latency, ≤1 tick);
  pace re-read 98.3 at the post-mechanics pre-sweep batch-48 (the
  `1a36b9b` verification) from 95.9. Post-re-center: pace 98.5
  (n=48) / 99.0 (n=96), n40 center 99.2 at the `60c71d1` floor.
- **The blitz was dead code — the 20 ft/15 ft contradiction** (A9-1
  HIGH; fix commit `1a36b9b`, mechanics tier). defenseTick's blitz
  trigger requires the holder BEYOND blitzBeyondFt (20 ft) while
  pickHelper rejected any holder at/beyond helpTriggerFt (15 ft) —
  mutually exclusive since the introducing commit (measured: 48,008
  blitz-condition ticks, 0 helpers, 0 branch executions). Fix
  exempts blitz-triggered calls from the near-rim gate per the
  mechanism's documented intent. Post-fix instrumented probe
  (8 games): 26,004/26,004 helpers selected; texture delta as the
  design comment predicts (assists 47.8 → 53.5/g, 3PA 76.3 → 71.6/g,
  steals 18.5 → 16.5/g). **Companion: subs left stale matchups**
  (a5-F1 MED / A9-2; fixes in `99f2745` + `d73a4a4`): swapPlayers
  fixed only the incoming player's own `manId`, so defenders kept
  guarding a benched man through resumed possessions — 8,916 stale
  defender-ticks over 30 games ≈ ~300/game (~30 defender-seconds of
  misassigned defense per game at 10 Hz; episodes up to four
  defenders on benched men). Both directions now retarget: the
  incoming defender inherits the outgoing man's assignment, and
  opposing defenders re-point to the replacement.
- **Instrument corrections (flow bases)**: gameFlow's OREB base
  counted dead-ball FT formalities and playerless team rebounds
  where the reference is defined on PLAYER OREBs only (b4-1 /
  c3-F1; fix `f277765`) — putbackShare re-reads **54.3%** (was
  42.9%) vs corpus 71.6% of player OREBs: the post-OREB-patience gap
  is real but ~11 pp smaller than the contaminated denominator
  suggested. secondChanceShare divided a both-teams numerator by a
  per-team denominator, printing ~2× its reference's definition
  (b9-F1 / b4-2; fix `56c8a81`) — 16.1% → **8.1%** vs corpus pooled
  13.2% (per-game p10/p90 9.9%/16.6%): the sim is slightly LOW; the
  old doubled read (~21% vs "~12-15%") had inverted the diagnosis.
  Gate rails re-anchored to the corpus per-game range [0.058, 0.23];
  b9's suppression mutant now fails the floor. Both measured
  2026-07-29 at the fix commits, 24-game flow base; re-measure:
  `npm run flow -- --games 24`.
- **The re-center** (tune `60eda3f`, floor `60c71d1`, pin re-anchors
  `7ea62a6`): the wave changed the physics (shot clock during
  passes, blitz alive, matchup retargeting) and the instruments
  (official FGA counting, player-OREB flow bases), so the 30-knob
  surface was re-swept on the corrected engine. Measured 2026-07-29:
  verify 40×3 = **17/17 / 17/17 / 17/17, zero band-fails, score
  4.115** (`npm run sweep -- --iters 0 --verify 40`, the tune-commit
  record); acceptance batch **17/17 at n=48 AND n=96** (fga
  88.7/88.8, pace 98.5/99.0 — `npm run batch -- --games 48|96`,
  re-run at HEAD 2026-07-29 for this record); suite **346 tests /
  345 pass / 0 fail / 1 todo** (`npm test`, 2026-07-29 — the three
  catalogued mechanics drift-trips re-greened at the re-center; two
  draw-fragile pins re-anchored to their properties in `7ea62a6`,
  no assertion weakened). Golden corpus re-baselined in the tune
  commit; the noise-floor diff (`60c71d1`) is the drift record.
  NOT yet re-taken post-re-center: `npm run oos`,
  `npm run texture`, `npm run calreport` — the B2-era reads (moved
  to docs/history/calibration-eras.md) predate the wave; re-measure
  before quoting.

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
