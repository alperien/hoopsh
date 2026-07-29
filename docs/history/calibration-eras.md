# Calibration eras — superseded measured-state records

> **STATUS: historical record.** These are the measured-findings blocks
> moved verbatim out of `docs/INTERNALS.md` (2026-07-29, the docs
> restructure), newest first: the B2 game-state landing, the B1
> integration landing, the pre-integration state, and the older
> resolved-incident records, plus the oos/texture reads taken at those
> landings. The CURRENT state lives in
> [../CALIBRATION.md](../CALIBRATION.md); nothing here should be quoted
> without re-measuring (the re-measure command is stated per finding).
> Cross-reference pointers were updated for the move; measurements are
> unchanged.

- **B2 GAME-STATE STATE (historical — measured 2026-07-28 at the
  `mech/game-state` landing `4bd7a72`; superseded where the numbers
  overlap by the scan-fix block in docs/CALIBRATION.md — in particular, every fga/fgPct
  figure in this block was read on the pre-`5d9671f`
  fouled-miss-inclusive box instrument, and the engine/params were
  re-centered at `60eda3f`. The mechanics points are the tune
  pair `21e703d` (coupling live) / `5cd67d0` (concede live), and
  `4bd7a72` re-baselines the 24-seed goldens + measured noise floor at
  the landed defaults — its diff is the drift record (AGENTS §4.4).
  Out-of-repo citations below ("b2-…" / "design-…" findings) follow the
  branch commit-message convention: the swarm run's findings files.
  Re-measure commands per finding.):**
  - **What ships — game-state coupling (W17), concept 7 (SCORE
    PRESSURE, `sim/ai/concepts.ts`), two channels under one master
    (`ai.scorePressureScale`, sweep-registered [0.5, 1.5]).**
    **Channel 1 (continuation press/coast tilt): measured NULL, kept
    at 0.** The fit ladder ran `scorePressureTilt` ∈ {0.05, 0.10,
    0.15, 0.20} at n=240/point on the standard-pair cohort
    (b2-fit-tilt005/010/015/020 findings): θ — the per-quarter margin
    mean-reversion the coupling exists to buy — never separated from
    zero (tilt 0.10: slope +0.015 ± 0.027, the design's target band
    excluded at ≈3 se; tilt 0.20: θ 0.024, implied dθ/dtilt ≈ 0.09
    per unit ⇒ landing needs tilt ≈ 1.0+, outside the mechanism's
    meaningful range) while its side effects arrived first (fga
    +0.61 +1.7z, tov −0.72 −3.2z at tilt 0.10). The transition
    counterforce the design itself named cancels the yardstick
    channel's drift; do not revive it by magnitude escalation
    (`params.ts` records the ruling at the constant).
    **Channel 2 (defensive intensity): LIVE at
    `ai.scorePressureDefGain` 0.3** — the trailing team's defense
    presses up, the leader's sags off, through the existing on-ball
    containment gap + closeout slack (`defense.ts`; no urgency fade —
    defense manufactures no violations). Fitted by the gain ladder
    g ∈ {0.10, 0.20, 0.30, 0.45} at n=240/point (b2-fit-defgain*
    findings): dθ/dg ≈ 0.27 per unit gain; at 0.30, θ =
    0.086–0.098/quarter — inside the design band [0.07, 0.16] — with
    ~91% of per-pairing talent drift preserved (K = 0.910 ± 0.169,
    favorite win% 70.8 → 70.8; b2-trial-setC findings). The 0.45 wall
    is measured: fga +0.87 over its ceiling, tov −0.89
    (b2-fit-defgain045 findings). Do not buy θ with gain; the master
    scale's sweep rail is the sanctioned adjustment surface.
  - **Garbage-time concede (W18, `sim/subs.ts`): LIVE at design
    values** (base 15 / perMin 1.0 / trailLag 4 / exit 6 / energyMin
    25, all FEEL — design-garbagetime findings, executed as designed).
    Final-period-only clock-scaled margin line with hysteresis; leader
    concedes first structurally. REQUIRES the live coupling — do not
    detach them: uncoupled, generated pools' bench-vs-bench play is
    margin-EXPANDING and concede regressed the OOS walk's 30+ tail
    (5.8→8.3% fam-a, 7.9→10.4% fam-b — b2-fit-concede-oos findings;
    no trailLag value rescued it, b2-fit-lagkeep findings). On the
    coupled engine the regression dissolves mechanistically, not by
    masking (walk Δ30+ −0.83pp ± 1.18 — treatment BELOW control;
    self-play 30+ −3.5pp at 1.7se; 0 adverse close/OT flips across
    680 byte-paired games; b2-verify-concede findings).
  - **Concept 8 (PROBE CULTURE, the pass-volume increment W19):
    wired, STAGED at zero magnitudes.** Standalone-positive at the
    selected 0.15/0.08 dose: +0.13 passes/poss (≈ +12/tg), fga −1.0,
    every gated band in position (b2-fit-probe-high/-bisect
    findings). DEFERRED at the interaction gate: joined to the live
    coupling it is destructive — θ 0.098 → 0.038 and fixed-pool
    talent-drift keep 0.91 → 0.26–0.28, with cohort-contingent margin
    distortion in BOTH directions (b2-trial-setB vs -setC findings).
    Ships zero; the flip belongs to a successor arc with the
    interaction priced (REGISTER W19/W28).
  - **The landed distribution record — W14's headline gap,
    substantially closed** (b2-landed-record findings: 680 games at
    the shipped defaults, zero overrides, three cohorts, definitions
    per the owning baseline files). Standard pair (n=240): mean |m|
    **12.41** (NBA 12.58; baseline 15.31), signed sd 14.93 (NBA
    15.64), blowout-20+ **19.2%** (NBA 19.1%), 30+ 3.8% (NBA 6.3% —
    overshoot BELOW, the clamp-saturation note), θ **+0.098 ± 0.028**,
    growth 48′/12′ 1.65 (sub-diffusive). OOS pairing walk (n=240):
    mean |m| **12.20**, blowout-20+ **19.6%**, θ +0.067 ± 0.029
    (0.1 se under the 0.07 edge — pass-with-flag, single family).
    Self-play (n=200, zero talent gap by construction): signed sd
    **15.52 ± 0.78** — UNDER the ~16 independence floor the
    margin-distribution survey adjudicated as the headline gap
    (within-game coupling now demonstrably exists; NBA's 15.64
    includes talent spread); mean |m| 12.52 from 14.99. corr(h,a)
    moved uniformly right but lands PARTIAL on the fixed-environment
    criterion: +0.05…+0.12 (std +0.053, self-play +0.099, oos
    within-cell +0.122) from baselines ≈ −0.03…−0.12, short of the
    ≥ +0.10 line on the fixed cohorts (NBA +0.254,
    mixture-inclusive) — registered residual (REGISTER W24). OT share
    2.5/2.9/3.0% across the cohorts vs the real 4.80% — still low,
    registered residual (W25). Distributional stats stay report-only;
    adjudicate at n≥240 (`npm run oos` prints the 60-game indicative
    draw; the record's cohort constructions and per-game rows are in
    the findings).
  - **Bands at the landing: 17/17 at n=48 AND n=96 on the acceptance
    base** (CI-mirror `npm run batch -- --games 48` gate PASS;
    acceptance n=96 reads fga 91.3 — the `4bd7a72` commit record) —
    **with an fga verify-base flicker noted honestly**: the 40×3
    verify at the tip reads ONE base over the fga ceiling (swp-beta
    92.60; alpha/gamma 17/17), and the breach moves base between
    adjacent runs (per-base fga se ≈ 0.5 at n=40 — b2-scale-095
    findings), so the per-base excursion is draw-level. The
    systematic content is the CENTER: fga n40 sits at 91.81 (sd 0.61)
    against the 92.0 ceiling at the regenerated floor (pre-B2 91.64 —
    the coupling adds ~+0.4 fga on the cohort measurements,
    b2-trial-setC note 3), and the scale micro-ladder 0.85–1.0
    measured NO fga relief (b2-scale-085/090/095 findings). The
    headroom belongs to the next coordinated re-sweep (design-coupling
    OQ2); the staged probe is the known fga refund when it ships
    (standalone −1.0). Registered: REGISTER W26. Re-measure:
    `npm run sweep -- --iters 0 --verify 40`. **Scan-wave update
    (2026-07-29): retired** — the ceiling-hug was the instrument
    (fouled-miss FGA counting, fixed `5d9671f`); see THE FGA INVERSION
    in docs/CALIBRATION.md's scan-fix block and W26's supersession.
  - **Fidelity watch — star centers after the flips**
    (b2-fidelity-watch findings: 5 × 40-game bases per star plus a
    paired-seed attribution run `21e703d` → `5cd67d0`; per the
    pre-approved watch protocol nothing was nudged). The 12-game z=3
    gate is GREEN 18/18 — as the design predicted, it cannot see
    shifts of this size. Concede's own minutes effect on the star
    fixtures: **−1.0/−1.1/−1.4 min/g** (Curry/LeBron/Jokić; design
    predicted −0.8…−1.3 — Jokić slightly over), and the blowout-rest
    bimodality is real (generated-roster top-5 minutes grow a
    secondary mass at 24–28 min/g — b2-fit-concede-oos §5). Center
    ledger at HEAD: **4 pre-existing** outside profile edges, none
    B2-caused (Jokić TRB 9.62 vs its 10.0 EARNED floor, ≈2.9se out —
    predates B2 at the same depth; Jokić FG% 50.3% vs 52; Jokić post
    shots 1.00 vs 1.8 — the long-standing largest residual, slightly
    deeper; LeBron FG% 47.8% vs 50) and **2 NEW statistically ON
    their edges** (0.1se each): Jokić AST 6.98 vs its 7.0 floor
    (≈ −0.3 of the slide concede-attributable on paired seeds) and
    Curry TRB 3.52 vs 3.5 (NOT concede-attributable — coupling-era /
    composite drift). B2 improvements for the ledger: Jokić 3PA back
    inside, LeBron 3PA ratchet now met, Curry AST off its ceiling.
    Owner ruling (accept garbage-rested centers per the design's
    counterpoint vs nudge fixture `rotationMinutes`) remains open —
    a nudge would not fix the four pre-existing misses. Registered:
    REGISTER W29. Re-measure: `npm run fidelity -- --games 40` (the
    single `fid` draw prints 5 enforced FAILs — draw-level; adjudicate
    centers on multiple bases per §4.4).
- **B1 INTEGRATION STATE (historical — measured 2026-07-28 at the
  `calib/integration` landing; the measurement point is the winner bake
  `7e05c97` (commits after it are docs/comment-only, fingerprint-identical).
  Superseded where they overlap by the B2 game-state block above — the
  margin-distribution and pass-volume rows below record the diagnosis
  whose mechanics B2 landed/deferred.
  Magnitudes from the noise floor re-baselined in the winner commit;
  positions from the landing verification runs quoted per finding —
  `npm run calreport` n40 centers at the new floor are the one read not
  yet taken. Re-measure: `npm run batch -- --games 24`, `npm run calreport`,
  `npm run oos`, `npm run texture`):**
  - **Fouls: composition corrected, band re-centered.** The
    pre-integration pf miss (23.7 at batch-24; n40 center 22.69 ±0.08se
    outside the 22.5 ceiling — see the pre-integration block below) was
    diagnosed as a composition defect, not a wave-2 mechanism error:
    offensive fouls (charges) ran 4.4-4.8/team-game — ~3× the real ~1.3
    and ~3× the constant's own "deliberately rare" comment — because
    `chargePerDrive` is consumed per TICK (~0.024/s of committed drive
    time), while per-attempt shooting-foul rates matched the model's own
    zone-base intent within 2-3% and every charge is an `off_foul`
    turnover (~30% of all TOV vs roughly 10% real). Measured 2026-07-28
    via an instrumented event-stream probe replicating `runBatch`
    (3×48-game seed bases, n=288 team-games; fouls-mechanism diagnosis).
    Fix: `chargePerDrive` 0.012 → 0.0034 (commit 2d47954) — charges
    measured 1.16/1.31/1.28 per team-game post-fix (3×16-game bases;
    real ~1.3) — and the knob is now on the sweep surface
    (`foul.chargePerDrive` [0.0015, 0.008]; it was tagged SWEPT but
    never registered, exactly the AGENTS §1.4 failure mode). At the
    landing: pf 21.0 on the n=96 acceptance batch and 20.3 at the 40×3
    verify means — mid-band, inside on every base.
  - **Endgame management defaults ON** (commit 6260cae; `endgame: false`
    remains the byte-identical legacy path, and the same commit inverted
    the default pin in `endgame.test.ts`). Basis, measured 2026-07-28 via
    a runBatch-mirroring flag-on/off driver at n=1260 games/arm (3 seed
    bases × 420), corroborated by `npm run flow -- --games 100
    [--endgame]` and a 20-seed invariant probe (endgame-flag survey; all
    invariant probes green): the layer closes the sim's worst
    clutch-realism gaps — OT share 2.06% → 3.33% toward the real 4.80%
    (2023-24, N=1230; long-run ~5.9%), OT-given-clutch 4.9% → 7.8%
    (derived real 10.4%), clutch FT share 21% → 31% (flow-tool
    definition, n=100/arm; reference range 30-50%+), Q4 10+-lead
    comebacks 0% → 5% (real ~5-10%), last-2:00 FTA 2.23 → 3.84 per game
    (2.30× the game's per-2-minute average — the foul-game spike now
    exists), intentional-foul endgames 1.4% → 33.7% of games, timeouts
    0 → 2.08 per game (1.39 stop_run + 0.69 advance; budgets respected;
    VOLUME ungradeable — no cited real base rate exists for timeout
    usage, ground-truth row 34).
    **Watch item (Q4 profile):** flag-on makes Q4 the sim's
    HIGHEST-scoring quarter (flow n=100/arm: 55/56/56/59) where the real
    profile is Q4-lowest (58.5/56.3/58.0/54.2) — the foul-game FTs and
    hurry possessions outweigh the milk. Candidate levers recorded in
    the survey (leadHold*, foulHunt* FT volume, hurry depth). The watch
    item STANDS at the landing: no fresh flow read exists at the final
    point — re-measure via `npm run flow -- --games 100` before
    adjudicating; OT share on the landing's oos-60 draw reads 3.3%
    (single draw, n=60 — indicative only). Residual: OT share remains
    below the real 4.80% — the flag closes roughly half the gap; the
    rest is diffusion-shaped margin spread (see the margin-distribution
    bullet below), not an endgame defect.
  - **Coordinated margin-objective sweep, run flag-on and baked** (commit
    99482c8 — the re-sweep W1/W2 conditioned on: charge fix + endgame
    default-ON + MINOR-2 integrated; `npm run sweep -- --iters 14
    --cands 4 --games 12`, margin objective, 3 bases; a 12-iter
    continuation run confirmed convergence). 11 knobs re-centered (odd
    precision kept per AGENTS §2.1; canonical list is the commit diff):
    basePaint, blockBase, midRangeBonus, contestBrakeBase,
    driveMidStopChance, reachInPerSec, looseBallPerReb, stealShare, and
    three of the five registered endgame magnitude dials
    (leadHoldMaxBoost, hurryMaxCut, twoForOneCut). `chargePerDrive` held
    at its corrected 0.0034. The bake's own verify left fga outside on
    all three bases and the fga/ftPct centers outside at its regenerated
    floor (92.81 / 80.67% n12 means; the commit message is the record) —
    closed by the directed re-search below. The noise floor and the
    24-seed golden corpus were re-baselined at the bake and AGAIN at the
    winner bake `7e05c97` (the canonical floor) — each diff is the
    accepted-drift record (AGENTS §4.4). Verification at the landing
    point: 40×3 verify 17/17 / 17/17 / 17/17 (swp-alpha/beta/gamma,
    score 4.461, zero band-fails).
  - **fga/ftPct residuals: CLOSED by a directed re-search — the repo's
    first full band lock.** At the post-bake floor both centers sat
    outside (fga 92.81 vs the 92.0 ceiling, ftPct 80.67% vs 80.5%; the
    pre-winner n=192 acceptance read was 92.61 / 80.60% at 15/17 —
    stable at n=48/96/192, systematic, not draw noise). Two
    adjudications preceded the fix (decision analysis, search-actuary
    findings, 2026-07-28): (a) the ftPct residual had a located cause —
    the optimizer converged wall-pinned on `shot.ftBasePct`, whose knob
    floor WAS the fitted value (an explore-up-only rail authored when
    league FT% read low; the league mix sat ~2pp above the real 78.4%,
    data/nba/league-averages-2023-24.json). Floor freed 0.69 → 0.66
    (commit 5e0c500; identity spread stays in ftSkillSwing/ftEliteKick,
    star FT tripwires remain the guardrail). (b) The fga BAND was
    adjudicated against sources before moving the sim: real 2023-24 FGA
    is 88.9, so the 92.0 ceiling already grants ~3 attempts of headroom
    over an actual season — widening it would certify a league LESS like
    basketball; the fix must move the sim, never the band. The excess
    was a possession-OUTCOME-MIX defect, not tempo: at 2.2 possessions
    SLOWER than the sourced pace 98.5, the sim under-produced the
    non-FGA possession endings (tov 12.05 vs sourced 13.6, fta 20.3 vs
    21.7) — the correct direction sheds FGA into turnovers/FT trips, not
    into pace. The re-search: 8 parallel strategies (multi-start jitter
    ×2, arithmetic seed, a 12-cell riskBase × ftBasePct response grid, a
    pace axis — blocked by a pace-floor break — a foul-mix axis — no
    reliable ftPct signal — the legacy objective, plus the analyst's
    exact n=48 pass-probability model built from the noise floor;
    riskBase ≥ −3.70 hits an ast/astdShare wall). Winner, the grid's
    robust cell (commit 7e05c97): `pass.riskBase` −4.1869 → −3.95 and
    `shot.ftBasePct` 0.69 → 0.666. Measured at the landing: 40×3 verify
    17/17 on each of swp-alpha/beta/gamma (score 4.461; means fga 91.30,
    ftPct 77.92%, tov 13.09 — toward the sourced 13.6); n=96 acceptance
    batch 17/17 (fga 91.6, ftPct 78.0% vs real 78.4%, tov 13.0, pf 21.0,
    pace 96.3, ast 24.7, stl 8.6, astdShare 59.3%); the deterministic
    CI-mirror `npm run batch -- --games 48` 17/17, gate PASS
    (RATCHET_FLOOR 16). The analyst's joint model at the point:
    P(17/17 at CI n=48) ≈ 0.83, P(gate ≥16) ≈ 0.99.
    `decide.moveCutFinish` remains parked at 0 and off the sweep
    surface — still an open re-fit item (docs/REGISTER.md, W23).
    **Scan-wave update (2026-07-29):** the fga half of this
    adjudication ("the 92.0 ceiling grants ~3 attempts of headroom
    over the real 88.9") compared cross-convention numbers — the box
    then charged FGA on fouled misses (~5.7/tg), which the real 88.9
    excludes. Retired with the inversion (`5d9671f`; scan
    b1-HIGH/a4-F2). The ftPct half and the possession-mix direction
    stand.
  - **Margin distribution: mechanism ADJUDICATED — not sweepable, owned
    by B2.** Measured 2026-07-28 via a probe harness importing the
    repo's own oos generator and band evaluator (880 flag-off games
    across 4 cohorts incl. self-play, flag-on n=240, plus a
    recomputation of all 1,230 games of 2023-24 from
    Basketball-Reference schedules; margin-distribution survey).
    Verdict: the fat tail is universal engine noise — identical-roster
    self-play already produces mean |margin| 15.0 and 30% blowouts at
    zero talent gap; divergence accumulates as steady diffusion
    (|margin| grows ×2.0-2.2 from 12' to 48' ≈ √t, no late runaway and
    no garbage-time flattening); the variance sits on the wrong axis
    (sim corr(home, away) ≈ 0 vs NBA +0.254 — margins overdispersed
    while totals are underdispersed). The sweep cannot fix it: the
    objective is blind to distributional stats, every knob direction
    that compresses margins wrecks the mean bands (measured), and pace
    ≥95 + 3PA share ≥33% imply a ~16-pt even-pair margin-sd floor under
    independent possessions — the NBA sits below that floor only via
    within-game coupling. The endgame layer measured
    distribution-NEUTRAL (its windows are downstream of a divergence
    manufactured over 48 minutes). Distributional stats stay
    report-only; the B2 mechanism rows own the fix (score-pressure
    coupling + garbage-time rotation, docs/REGISTER.md — designs
    ready, design-coupling / design-garbagetime findings).
    **B2 update (2026-07-28): LANDED** — channel-2 coupling live at
    g=0.3 + concede live; the measured record is the B2 block above
    (std mean |m| 12.41, blowout-20+ 19.2%, self-play signed sd 15.52
    — the ~16 independence floor beaten).
  - **Pass volume: reference corrected and cited; the gap is an open
    mechanism item.** The cited real rate is ~2.84-2.86
    passes/possession (2023-24: 281.3 passes made per team-game, ÷ ~99
    possessions; `data/nba/tracking-references-2023-24.json`, generated
    from archived stats.nba.com tracking tables and cross-validated —
    the texture tool now imports the citation, commits f8a7c35 +
    869bb3f, so the printed reference cannot drift; the previously
    quoted "NBA ~3.2" was an uncited recollection and wrong on both
    counts). Measured at the landing: 1.97 (`npm run texture`,
    2026-07-28, 8 games, single base — indicative; pre-integration read
    1.93, 2026-07-27). The ~30% shortfall is a mechanism item (B2): the
    pass-back damping overshot — the pre-damping baseline was 2.95 —
    and the winner's riskBase re-price itself costs ~0.1-0.2
    passes/possession (risk pricing is a pass-volume lever; recorded in
    the design). A designed increment exists (design-passvolume
    findings: an early-shot-clock probe window coordinated with a
    riskBase re-price, ~+25 passes/team-game as the honest first step —
    the full gap is a multi-phase arc, not one knob).
    **B2 update (2026-07-28):** the probe window is WIRED and STAGED
    at zero magnitudes — standalone-positive but deferred at the
    measured probe×coupling interaction gate (the B2 block above;
    REGISTER W19/W28).
  - **Out-of-sample distributional state — adjudicate at n≥240; the
    60-game default is ±2 draw noise on these stats.** The
    margin-distribution survey re-measured the oos pool at n=240
    (2026-07-28, pre-integration main, endgame flag-off): mean |margin|
    14.48, blowout (20+) share 29.2%, close (≤5) share 20.0%, OT 1.7%
    vs the cited 2023-24 real 12.58 / 19.1% / 23.3% / 4.80% (N=1230).
    The previously documented oos-60 values (15.1 / 32% / 17%)
    overstated two misses — close-share is low-normal, not collapsed —
    and sd|m| is a minor miss. The regression direction vs the
    pre-wave-2 state stands. The oos tool's printed references are now
    computed-and-cited (commit 9a02fa8; note its marginSd is the SD of
    |margin|, 9.53 comparator — not the signed-margin SD 15.64).
    Post-winner re-run at the landing (`npm run oos`, 60 games, single
    draw — indicative per §4.4): **17/17 bands** — the first full oos
    pass, with the 3PA-share generalization gap (32.5% vs the 33.0
    floor on the 2026-07-27 read) clearing on this draw; distribution
    avg |margin| 14.5, sd|m| 9.7 (vs 9.53), blowout 30%, close 22%, OT
    3.3% (default config is endgame-ON since the flip — quote the
    config with the number). Consistent with the adjudicated n≥240
    reads on the systematic misses (margin/blowout); the coupling
    mechanism above is B2's target. One-generated-set,
    single-seed-family caveat stays.
- **PRE-INTEGRATION STATE (historical — measured 2026-07-27; superseded
  at the `calib/integration` landing).** The pf miss recorded here was
  subsequently diagnosed as the charge-composition defect (~3× documented
  intent; fixed in commit 2d47954) and the fga/ftPct edge story continues
  in the B1 block above. Kept as the incident record:
  - **Fouls band FAILS — branch-introduced.** batch-24 (single base): pf
    23.7 vs band 16.0-22.5, +1.2 over the ceiling. Systematic, not draw
    noise: the n40 grand-mean center is 22.69 ±0.08se — OUTSIDE the 22.5
    ceiling (−2.4se) on the branch's own re-baselined 40-base floor
    (generated 2026-07-26) — and oos-60 reads 23.3. `main` measures 21.7
    (OK) on the same command/base: wave 2 traded the assisted-share miss
    for a fouls miss. By §4.4's definition the tip is NOT locked; the fix
    belongs to the coordinated re-sweep (docs/REGISTER.md) or an
    explicitly recorded exception.
  - **Two more centers edge-unresolved (calreport, n40):** fga 92.07
    ±0.11 vs the 92.0 ceiling (−0.6se, leaning outside) and ftPct 80.5%
    ±0.1 sitting ON its 80.5% ceiling (−0.4se). The edge-set composition
    changed vs the historical signature: fta hugs its floor; fga, tpPct,
    ftPct, tov, and pf group at ceilings (calreport's own signature line:
    read as one defect with a direction).
  - **Assisted share RESOLVED** (formerly the long-standing structural
    miss): 58.3% at batch-24, 57.7% at oos-60, n40 center 59.0% ±0.2se —
    inside, +2.1σ from the 62% ceiling. The wave-2 shot-mix work closed
    it; the fouls miss above took its place as the one batch-24 FAIL.
- **RESOLVED by the arrival-based drive commit (speed-fix cluster)**: the
  ORtg unreachability and the friction floors were ONE mechanism short —
  drives with a fixed commit window expired mid-lane (picks equal to the
  old engine, FINISHES collapsed 4.7→1.35/game), and with them went the
  strips, charges, and help collisions that ARE the sim's friction. The
  commit now scales with launch distance (penetrate until ARRIVAL — the
  same principle as the phase boundaries, which are also arrival-based
  now: advance flips at 36 ft, transition when 4+ defenders are back).
  Post-fix at 40-game verify: ORtg ~116-118 mid-band (from 121-on-ceiling
  then 124-126 during the cluster), steals and turnovers back in band.
  Successor systematic finding at the time: ASSISTED SHARE ~0.65 vs the
  0.62 ceiling, repeating on all three seed bases — the drive-and-kick era
  converted collapses into assisted makes. Since RESOLVED by the wave-2
  shot-mix work (see the pre-integration block above: 59.0% ±0.2se n40
  center, inside). The hub's post volume remains under his identity floor
  (jokic post shots 1.18 vs the 1.8 identity floor, 10.6se out at n40 —
  the largest fidelity residual on the board).
- **THE FRICTION SIGNATURE (historical — resolved above; its speed reading
  was a UNITS ARTIFACT)** (the review computed the signature from our own
  table; the calreport now emits it): friction/volume statistics pinned
  near band FLOORS while accuracy/efficiency statistics pinned near
  CEILINGS — one defect with a direction, closed by the arrival-based
  drive commit (a mechanism, not global slowing). The era's "prime
  mechanical suspect: movement speed (6.55 ft/s vs NBA ~4.2)" compared a
  ft/s measurement against a miles-per-hour figure: the NBA tracking
  average is 4.22 mph = 6.19 ft/s (2023-24 team AVG_SPEED, NBA.com Speed &
  Distance tracking — an all-movements-including-standing average), so the
  sim's 6.55 ft/s was 4.47 mph, ~6% hot, not ~1.5× too fast (1.56 is a
  ft/s number divided by a mph number). The speed-pin experiment
  (2026-07-26, reviewer-designed: all speeds × 0.64, every shot/contest
  constant held fixed → pace 95.3→86.5, FG% 48.0%→50.1%, ORtg 120.8→126.8,
  blocks 3.8→2.5 at 24 games) pinned the sim to 4.19 ft/s = 2.86 mph —
  walking pace for all ten players averaged over live play — and its
  result is the over-slowing signature (defenders arrive late → cleaner
  looks → efficiency inflates while possessions shrink). It was evidence
  FOR the units error, misread at the time as "the shooting calibration
  absorbed the kinematics error". The units verdict landed 2026-07-26
  (commit `00e2cda`; `harness/src/texture.ts` header records that this
  paragraph's uncorrected text nearly drove a further round of engine
  slowing). The former binding directive "fix movement speed BEFORE
  fitting shot models to real data" is DISCHARGED: post-jog-economy the
  sim measured 6.24 ft/s = 4.25 mph (`00e2cda`), on the corrected target —
  movement speed is NOT an open blocker for the fit-to-real-data arc.
  Definitional caveat before any speed BAND is promoted: NBA's AVG_SPEED
  column provably does not equal distance ÷ minutes (4.22 vs 4.52 mph, a
  systematic ~7% gap both tracked seasons; the denominator is
  unpublished), and the texture tool measures live-clock chord-sampled
  speed — treat sim-vs-NBA average-speed deltas under ~10-15% as
  definitional noise until a same-convention, cited gate lands in
  `data/nba/`.
- **Elite-shooter benchmark's assist center**: measured 8.49 ±0.19se at
  the n40 floor (calreport, 2026-07-27) — inside the 4.5-8.5 identity
  range by 0.01, i.e. sitting ON the ceiling: edge-unresolved, no longer
  outside. The previously quoted 9.51 ±0.16se was the pre-wave-2 state.
  (An earlier 4-draw probe read 9.13 — the sample-size lesson applied to
  ourselves: quote the floor's larger sample, not a hand probe.) The
  engine-level audit question — does the decision layer over-generate
  assists for high-usage shooters regardless of cast structure? — remains
  open in edge-unresolved form, at reduced magnitude.
- **Position updates at 40 league bases (calreport, floor generated
  2026-07-26; read 2026-07-27)**: pace center 98.41 ±0.14 — inside; ORtg
  center 115.11 ±0.27 — inside, +3.0σ from the 121 ceiling. Earlier
  quoted positions (pace 95.42; ORtg 121.08 edge-unresolved; floors
  trb/blk/tov) describe superseded eras — the current edge set is the one
  in docs/CALIBRATION.md's current-state section.

**Out-of-sample status** (`npm run oos` — generated rosters the sweep never
saw): re-run at each landing. At the `calib/integration` landing
(2026-07-28, winner bake `7e05c97`; 60 games, 12 generated rosters, one
generated set, single draw — indicative per §4.4): **17/17 bands — the
first full oos pass**, including the 3PA-share generalization gap (32.5%
vs the 33.0 floor on the 2026-07-27 read; the acceptance-roster center was
36.8% ±0.1 at n40) clearing on this draw. Distributional report
(REPORT-ONLY, ratchet convention) — measured vs cited 2023-24 regular
season (computed from Basketball-Reference schedules, N=1230): avg
|margin| 14.5 vs real 12.58; sd|m| 9.7 vs 9.53; blowout (20+) share 30% vs
19.1%; close-game (≤5) share 22% vs 23.3%; OT 3.3% vs 4.80% (the default
config is endgame-ON since the flip — quote the config with the number).
Adjudicate distributional stats at n≥240 (the 60-game default is ±2 draw
noise on them): the adjudicated basis is the margin-distribution survey
(2026-07-28, n=240 oos pool + 880 flag-off games across 4 cohorts, on
pre-integration main) — the margin/blowout misses are systematic and the
mechanism is the missing score-pressure coupling (see the B2 block
above), owned by B2, sweep-unreachable by measurement. History:
the wave-2 landing regressed this report and did not re-run it (avg
margin 15.1 / blowout 32% / close 17% documented 2026-07-27 — itself a
60-game draw that overstated the close-share and mean misses; docs/REGISTER.md
W14 holds the record). One-generated-set caveat stands.
**B2 game-state landing update (2026-07-28, `4bd7a72`):** the
adjudicated-scale read now exists at the shipped defaults — the OOS
pairing-walk cohort at n=240 (b2-landed-record findings, the oos.ts
pool + pairing walk replicated exactly; games 0–11 byte-identical to
`npm run oos -- --seed b2oos-a --games 12`) measures mean |m| 12.20 /
blowout-20+ 19.6% / close 26.7% / OT 2.9% vs real 12.58 / 19.1% /
23.3% / 4.80%, bands 16/17 with the family's own documented pool-draw
pace miss, identical in kind to its baseline (not regressed). The
margin/blowout misses W14 recorded are substantially closed; OT stays
low (registered residual W25). The 60-game `npm run oos` default
remains an indicative draw.

**Texture (measured by `npm run texture`; latest read 2026-07-28 at the
landing, 8 games, single base — indicative per §4.4):** average live speed
6.20 ft/s vs the cited reference 4.22 mph = 6.19 ft/s (2023-24 team
AVG_SPEED, NBA.com Speed & Distance tracking) — on target within
definitional noise; there is NO open speed residual. History: 8.67 → 6.55
ft/s across the texture increment, 6.24 ft/s after the jog-economy fix
(commit `00e2cda`, 2026-07-26 — the units-verdict commit; this paragraph
formerly compared those ft/s readings against "NBA ~4.2" WITHOUT units, a
ft/s-vs-mph confusion whose full record is in the friction-signature
history above), 6.40 ft/s on 2026-07-27. Stationary share 33%, ping-pong
share of passes 11.3% (was 26.8% pre-increment — the eye-test oscillation,
largely gone), passes/possession 1.97 vs the cited NBA ~2.84-2.86 (see the
pass-volume finding above) — the damping overshot; the designed probe
window is wired and STAGED at zero, deferred at the probe×coupling
interaction gate (B2 block; the landed cohorts measured 1.81–1.95
passes/poss, b2-landed-record findings).
Mechanisms: pass-back damping (concept 3's negative side), stillness
deadbands with walked spacing moves, purposeful relocation with the denied
shooter's baseline escape. Texture now measures the shipped default
config, which is endgame-ON since the integration landing — re-measure
rather than compare against pre-flip reads.
