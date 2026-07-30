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

**RELEASE-AUDIT ERA — measured 2026-07-30 on `fix/audit-integration`.**
The wave: a 40-agent read-only release audit of `edb9e3d`
(findings/release-audit.md, the swarm run's findings files per the branch
citation convention) filed 131 findings — 0 CRITICAL / 8 HIGH / 50 MEDIUM /
73 LOW — and the fix wave landed all 8 HIGHs, ~44 MEDIUMs and ~55 LOWs at
the root (REGISTER W54 is the wave summary; W53/W55 carry the deferrals).
What moved the streams here: mechanics-tier fixes (H-02 crunch at the OT
tip, M-02 rim-contest monotonicity, the M-09/10/11 endgame-gate and
M-13/14 subs repairs, the L-04/06/11/16 behavior repairs) plus the H-01
hoist — ~38 formerly-inline behavioral constants now on the SimParams
surface at identical values (pure refactor, fingerprint-verified; the
sweep-appropriate levers are registered in knobs.ts). Params defaults were
NOT re-swept: the bands held at the shipped values (below). The instruments
moved too: H-05 folded sim possession lengths boundary-to-boundary (the
corpus convention) and H-06 re-baked the pbp corpus + flow reference from
the committed shards. Positions at the landing, measured 2026-07-30:

- **Suite: 470 tests / 469 pass / 1 todo** (`npm test` prints the
  live count; measured 2026-07-30 at the landing).
- **Golden corpus: 28 entries** — 24 default-config plus the four
  H-04 guard entries (flag-off ×2, NCAA, EURO), re-baselined at the
  audit-fixed engine (`59fd74c`; the diff is the drift record). The
  in-suite flag-off byte-identity twin runs under `npm test`, so a
  flag-off leak is caught between CI corpus runs (H-04).
- **Acceptance batch: 17/17 at n=96; 16/17 at n=48** — the one n=48
  miss is fgPct 49.7 against its 0.495 ceiling, a draw-level
  flicker: the fresh floor's center reads 48.93, inside. Re-measure:
  `npm run batch -- --games 48|96`.
- **Noise floor regenerated at the audit-fixed engine** (`7e814a5`;
  regen: `npm run noisefloor` — its diff is the accepted-drift
  record). Floor centers (n12-tier means, n=120 windows): pace
  99.77, fga 89.88, tov 12.97, pf 20.41. fga vs the sourced real
  88.9: within ~1.0 under official counting — the scan wave's
  counting-rule fix (`5d9671f`) plus this wave's mechanics repairs
  hold the honest read at real volume, where the pre-inversion
  instrument had mis-read the same stat by ~3 under the wrong
  convention (scan-era pointer below). Seed-luck fixture pins were
  re-anchored to the reshuffled streams (`b9b356d`, `b6ef7f7`), no
  assertion weakened.
- **NOT re-taken post-audit**: `npm run flow` at n≥24 — H-05
  (boundary-to-boundary possession lengths) and H-06 (reference
  re-bake) both moved its measurement basis, so the scan-era 54.3%
  putback / 8.1% second-chance reads predate the wave; re-measure
  before quoting. Same standing caveat for `npm run oos`,
  `npm run texture`, `npm run calreport` — their last reads are
  B2-era (docs/history/calibration-eras.md); two waves of engine
  change sit between them and HEAD.

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
