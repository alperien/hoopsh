# hoopsh internals — a guided tour

Read [ARCHITECTURE.md](../ARCHITECTURE.md) first for the *why*; this is the *where*.
Everything below assumes the governing rule: **`engine` imports nothing; everything
else consumes its event stream.**

## The tick pipeline (10 Hz)

```
simulateGame(cfg)
 └─ tick(dt)                                 sim/game.ts
     ├─ wallT += dt                          (replay timeline: never pauses)
     ├─ phase dispatch:
     │   live        → tickLive              sim/game.ts
     │   dead        → tickDead              sim/possession.ts
     │   freethrows  → tickFreeThrows        sim/fouls.ts
     │   scramble    → tickScramble          sim/possession.ts
     └─ recordFrame                          sim/game.ts

tickLive, in order:
  advanceClock (game clock; stops at the horn) → ball flight? resolve on arrival
  → shot-clock violation check → period expiry → windup in progress?
  → possession phase transitions → holder movement intent → dribble accounting
  → decideBall() at each decision window → executeAction → reach-in checks
  → charge check → offense/defense brains → integrateMovement → fatigue
```

**Two time axes.** `t` is game-clock time (stops at whistles and the horn; stats and
minutes key on it). `wallT` is the replay timeline (advances every tick; frames and
event `wt` key on it). Do not mix them.

## Module map — `packages/engine/src/`

| File | Owns | Start here when changing… |
|---|---|---|
| `sim/game.ts` | orchestrator: init, tick dispatch, live tick, movement intents, frames | tick order, decision cadence, replay frames |
| `sim/possession.ts` | possession lifecycle, dead balls, scrambles, periods, tip | pace accounting, inbounds, period/OT rules |
| `sim/shooting.ts` | windup → release → resolution, assists | anything between "decides to shoot" and the rim |
| `sim/passing.ts` | pass flight, steals/OOB, reach-ins | turnover mechanics |
| `sim/fouls.ts` | foul bookkeeping, bonus, FT sequences | whistle rules |
| `sim/subs.ts` | lineup swaps, fatigue rotation, foul-out replacement | rotations |
| `sim/movement.ts` | clock advance, physical integration, collision, fatigue | locomotion, energy |
| `sim/ai.ts` | **all basketball behavior** — the stable barrel over `sim/ai/` | start below, per layer |
| `sim/ai/decide.ts` | decideBall: ball-handler utilities + softmax | shot selection, pass choice, drives |
| `sim/ai/concepts.ts` | the bounded-rationality layer, consolidated (drilled-behavior bias terms; concept 6 = game-state urgency: clock kill, hold-for-last, two-for-one) | decision bias terms, late-clock behavior |
| `sim/ai/actions.ts` | pnr/post/iso/dho lifecycle | calling & phasing team actions |
| `sim/ai/offense.ts` | spacing spots, cuts, screens, shot-reaction crash/boxout | off-ball offense |
| `sim/ai/defense.ts` | matchups, help, blitz, drop, containment, denial, sag | defensive positioning |
| `sim/ai/shared.ts` | creation hierarchy, defender queries, locomotion policy | cross-layer queries |
| `sim/endgame.ts` | endgame layer (`GameConfig.endgame`, **default ON** since the n=1260/arm flag-on survey; explicit `endgame: false` is the byte-identical legacy path): timeout brain, intentional-foul targeting, chase arithmetic shared with concept 6 | late-game management |
| `sim/resolve.ts` | probability models: shots, contests, passes, rebounds | make/miss math |
| `sim/params.ts` | **every tunable constant** (`SimParams`) | calibration; never hardcode a constant elsewhere |
| `sim/state.ts` | shared types + `emit()` | event stamping, new state fields |
| `core/events.ts` | the event schema — **the public contract** | anything consumers see |
| `core/rng.ts` | seeded sfc32 + distributions | never use Math.random |
| `geometry/court.ts` | court build, shot zones, spacing spots | three-point geometry |
| `rules/rulepack.ts` | league packs (NBA/NCAA/EURO) | league differences |
| `model/player.ts` | attributes & tendencies (the 38 dials) | the editable surface |
| `model/derived.ts` | rating → physical-unit curves | what "90 speed" means |
| `replay/replay.ts` | replay JSON assembly | viewer data needs |

Consumers: `stats/box.ts` (events → box score, exact minutes/±), `data/` (schemas,
validation, archetypes, sample packs), `narration/` (template PBP + broadcast
scripts; `shotcall.ts` classifies which basketball NAME an attempt gets —
layup/dunk/hook/tip-in/jump shot — from ShotEvent data alone),
`packages/viewer/` (frozen prototype).

Harness map — `packages/harness/src/` (measurement and tooling; rows for the
modules an agent is likely to be pointed at):

| File | Owns |
|---|---|
| `bands.ts` + `cli.ts` | the NBA acceptance bands (count them HERE, per AGENTS §4.4) + the gated batch runner |
| `sweep.ts` / `knobs.ts` / `solve.ts` | parameter search over SimParams (margin objective) |
| `noisefloor.ts` / `calreport.ts` | measured noise floor (40 bases → `noise-floor.gen.ts`); n40 center positions vs band edges |
| `fidelity.ts` | star-fixture identity gates (Curry/LeBron/Jokić profiles) |
| `texture.ts` | frame-level feel forensics: speeds, stillness, ping-pong passing |
| `flow.ts` + `flow-metrics.ts` | game-arc forensics + event grammar (CLI/report + doctrine in flow.ts; pure metric library in flow-metrics.ts) |
| `turing.ts` | blind PBP discrimination protocol vs real bbref logs |
| `oos.ts` | out-of-sample generated-roster bands + the distributional report |
| `season.ts` / `matchup.ts` / `league.ts` | season driver + standings, Monte-Carlo matchup distributions, deterministic fictional leagues — see `docs/SEASON.md` |
| `leagues.ts` | league selection: one id resolves rule pack + bands + pace basis TOGETHER (`--league`; prevents grading NCAA play against NBA bands) |
| `parallel.ts` | worker-pool game runner; determinism across worker counts is the acceptance test |
| `fingerprint.ts` | golden fingerprint corpus — the refactor tripwire |
| `fit-roster.ts` | stats → ratings inversion (`rosters:fit`): real box lines → validated 38-dial packs |
| `args.ts` | shared loud CLI flag parsing (exists because of the silent `--seed` incident) |

Roster-authoring tooling (`tools/gen-schema.mjs`, `roster-new.mjs`,
`roster-validate.mjs` — `npm run schema:gen` / `roster:new` / `roster:validate`)
sits outside the packages: it consumes `@hoopsh/data`'s exported schema
definitions and archetypes, and emits/validates the hand-edited packs. The
editor JSON Schema at `data/schema/team-pack.schema.json` is GENERATED — see
`docs/ROSTERS.md` for the authoring loop and `packages/data/src/schema.ts` for
the single source of truth it derives from.

## Design rules that maintain consistency across this codebase

1. **One probability form.** Every resolution is `sigmoid(base + Σ terms)`; every
   constant lives in `SimParams`. Rating influence goes through `n(rating)` ∈ [-1, 1].
2. **Self-consistent AI, plus a bounded-rationality layer.** The model that
   resolves a shot is the model the AI uses to *choose* it (`shotEV` calls
   `shotMakeP`) — the EV core cannot drift from reality. On TOP of that core,
   decideBall applies deliberate non-EV bias terms (catch-and-shoot
   decisiveness, action patience, usage pressure, …): real players are not
   EV-optimizers, they run drilled behaviors, and each term models one. This
   is a DESIGN DECISION with a maintenance cost — the terms accumulate per
   mechanic and are due for consolidation into fewer principled concepts, and
   the decision-vs-EV divergence should be measured, not assumed small (both
   tracked on the roadmap).
3. **Determinism is mandatory.** One seeded `Rng` per game. No `Math.random`, no `Date`,
   no iteration-order dependence. Same seed ⇒ bit-identical events + frames.
4. **Events are the only truth.** If a consumer needs something, it goes in the event
   stream — never reach into engine internals.
5. **Actions are thin scaffolding.** Pick-and-roll sets up geometry (screen contact,
   stun, roll); the payoff (pull-up space, pocket pass) *emerges* from existing systems.
   The post-up follows the same shape: the entry reuses the pass model, the double-team
   reuses help defense, and the spray out of the double reuses kick-out machinery.
6. **Staged surface is labeled.** Fields marked `STAGED` in `model/player.ts`
   (`consistency`, `tend.pushPace`) are defined but not yet consumed — each is
   tied to a roadmap stage. Wiring one without its stage's mechanics adds unvalidated
   surface area.

## The safety net (run all of it before pushing)

```bash
npm run test     # full suite: determinism, geometry, archetypes, narration, schema,
                 # wide-band realism guard, and the INVARIANT SUITE (below)
npm run batch -- --games 24    # fine-grained NBA acceptance bands
npm run bench    # ≥1 game/sec budget (throughput is hardware-dependent — measure locally, don't quote)
```

`packages/engine/test/invariants.test.ts` permanently enforces what two adversarial
audit rounds verified: possession start/end balance, zero post-horn scoring, exact
minutes conservation, plus-minus ≡ margin×5, score reconstructible from events, no
off-court or fouled-out actors, team-foul monotonicity, strictly monotonic replay
frames, and a physical teleport ceiling on player movement. **Policy: if a change to
the engine makes an invariant fail, the change is treated as wrong — never the
invariant.**

`packages/engine/test/adversarial.test.ts` pins the input contract: non-finite
ratings throw at the `simulateGame` boundary (tier 'finite', always on),
`validate: 'strict'` additionally enforces the data-pack ranges, a stalled
game throws instead of faking a `game_end`, and extreme-but-finite rosters
complete with invariants intact.

## Calibration workflow

1. Change mechanics → `npm test` (invariants + wide guard must stay green).
2. `npm run batch -- --games 24` → see which bands drifted.
3. `npm run sweep -- --iters 14 --cands 4 --games 12 --verify 40` → let the optimizer
   re-center; bake the printed diff into `params.ts` defaults; verify with
   `npm run sweep -- --iters 0 --verify 40`.
4. The noise floor is measured, not assumed: `npm run noisefloor` writes the
   sampling distribution of every gated statistic (noise-floor.gen.ts) and
   the permanent gates derive widths from it (edge ± 3·sd). Judge lock state
   by measured CENTERS at 40 games: every center inside its band = locked; a
   center on or beyond an edge is a systematic finding — record it below.

**What "locked" does and does not claim.** The bands are league-mean aggregates
on the repo's own rosters, and the sweep tunes the same knobs the bands grade —
so a locked state demonstrates the model CAN express modern-NBA averages, not
that it is identified (with 100+ free parameters against ~17 loose constraints,
many parameterizations pass). Held-out validation is the fidelity suite
(player-level, profiles authored independently of the sweep) and the
out-of-sample roster check in the harness; distributional realism (score
variance, blowout rate, quarter profiles) is reported but not yet enforced.
Treat band-locked as "necessary, not sufficient".

**Measured findings** (noise-floor era — magnitudes from `npm run noisefloor`;
positions from `npm run calreport`, which quotes n40 grand-mean centers with
standard errors — quoting a smaller nested window's mean as "the center" was
an error the third review caught, twice, in our own write-up. The pre-texture
FTA-low and 3P%-high residuals PASS after the texture re-tune):
- **CURRENT STATE (integration era — measured 2026-07-28 at the
  `calib/integration` landing; the measurement point is the winner bake
  `7e05c97` (commits after it are docs/comment-only, fingerprint-identical).
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
    surface — still an open re-fit item (REFACTOR register).
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
    coupling + garbage-time rotation, REFACTOR register — designs
    ready, design-coupling / design-garbagetime findings).
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
  in the current block. Kept as the incident record:
  - **Fouls band FAILS — branch-introduced.** batch-24 (single base): pf
    23.7 vs band 16.0-22.5, +1.2 over the ceiling. Systematic, not draw
    noise: the n40 grand-mean center is 22.69 ±0.08se — OUTSIDE the 22.5
    ceiling (−2.4se) on the branch's own re-baselined 40-base floor
    (generated 2026-07-26) — and oos-60 reads 23.3. `main` measures 21.7
    (OK) on the same command/base: wave 2 traded the assisted-share miss
    for a fouls miss. By §4.4's definition the tip is NOT locked; the fix
    belongs to the coordinated re-sweep (REFACTOR.md register) or an
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
  shot-mix work (see the CURRENT STATE block above: 59.0% ±0.2se n40
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
  in the CURRENT STATE block above.
- **Endgame management: implemented AND default-ON.** The historical
  diagnosis (the review's sharpest cut) held that near-ties are played
  out instead of MANAGED. All five once-missing behaviors exist in
  `sim/endgame.ts` + concept 6 (`sim/ai/concepts.ts`): timeouts (advance
  + stop-the-run triggers, budget from the rule pack), intentional
  fouling, hold-for-last, two-for-one, clock burn, plus trailing-team
  hurry. The default flipped ON at the calib/integration landing on the
  n=1260-games-per-arm survey evidence (see the CURRENT STATE block
  above for what it closes and the Q4-profile watch item);
  `endgame: false` preserves the byte-identical pre-layer path (verified
  at scale: 0 timeout events in 1,260 flag-off games). The magnitude
  dials are registered in `harness/knobs.ts` and the coordinated sweep
  re-centered three of them; the window/threshold dials stay off the
  sweep surface by doctrine (identity-shape gates are design, not
  calibration), and `timeoutRunPts` has no cited real base rate — do not
  tune it until one lands in `data/nba/` (ground-truth row 34).

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
mechanism is the missing score-pressure coupling (see the measured
findings above), owned by B2, sweep-unreachable by measurement. History:
the wave-2 landing regressed this report and did not re-run it (avg
margin 15.1 / blowout 32% / close 17% documented 2026-07-27 — itself a
60-game draw that overstated the close-share and mean misses; REFACTOR
register W14 holds the record). One-generated-set caveat stands.

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
pass-volume finding above) — the damping overshot; open B2 mechanism item.
Mechanisms: pass-back damping (concept 3's negative side), stillness
deadbands with walked spacing moves, purposeful relocation with the denied
shooter's baseline escape. Texture now measures the shipped default
config, which is endgame-ON since the integration landing — re-measure
rather than compare against pre-flip reads.

## Known simplifications (deliberate, documented)

Simplified inbounds (timed reset, no inbound passer) · endgame management
(timeouts, intentional fouling, hold-for-last, two-for-one, clock burn) is
implemented and DEFAULT-ON since the calib/integration landing
(`endgame: false` = the byte-identical legacy path); real timeout-usage
patterns (mandatory/TV timeouts, ATO play-calls) remain unmodeled and
ungraded — no cited base rate exists · no backcourt/
8-second/travel violations · NBA last-2-minutes bonus rule not yet implemented ·
(the Stage 2 assists/assisted-share gaps are CLOSED: usage pressure,
delivery quality, and DHO conversion brought assisted share to ~57-61% and
the band is now enforced like any other — see the fidelity-phase commits) ·
man-to-man with drop coverage, plus top-lock denial of extreme-gravity shooters (and its backdoor-cut counter) ·
bench-exhausted foul-outs play on (NBA rule analog: a fouled-out player remains
when no substitute exists — reachable only with short/foul-storm rosters; the
no-fouled-out-actors invariant applies whenever replacements exist, and every
lineup-consuming site falls back consistently rather than crashing — hardened
after the Stage 2 adversarial audit) ·
narration is a maintained template layer (wave-1 polish: shot-call
classification, bbref-register turing renderer); the viewer is a frozen
prototype.
