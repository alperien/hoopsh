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
| `sim/endgame.ts` | flag-gated endgame layer (`GameConfig.endgame`, default OFF): timeout brain, intentional-foul targeting, chase arithmetic shared with concept 6 | late-game management |
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
- **CURRENT STATE (measured 2026-07-27; single seed base where noted —
  indicative per AGENTS §4.4; systematic claims corroborated by the
  committed 40-base noise floor. Re-measure: `npm run batch -- --games 24`,
  `npm run calreport`, `npm run oos`):**
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
  shot-mix work (see the current-state block below: 59.0% ±0.2se n40
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
- **Pass volume runs low**: 1.93 passes/possession measured 2026-07-27
  (`npm run texture`, 8 games, single base — indicative) vs the cited NBA
  ~2.84-2.86 (2023-24: 281.3 passes made per team-game, NBA.com tracking
  Passing, ÷ ~99 possessions/game at B-Ref pace 98.5). The previously
  quoted target "NBA ~3.2" was an uncited recollection; the corrected
  reference makes the gap ~32%, not ~30%+ of a larger number. Open
  texture item with the damping named as cause (baseline was 2.95, the
  pass-back damping overshot).
- **Endgame management: mechanisms IMPLEMENTED, flag-gated default-OFF;
  the realism gap remains at the default.** The historical diagnosis (the
  review's sharpest cut) held that near-ties are played out instead of
  MANAGED. All five once-missing behaviors now exist behind
  `GameConfig.endgame` (`sim/endgame.ts` + concept 6 in
  `sim/ai/concepts.ts`): timeouts (advance + stop-the-run triggers,
  budget from the rule pack), intentional fouling, hold-for-last,
  two-for-one, clock burn, plus trailing-team hurry. Flag-off
  byte-identity vs the pre-endgame engine is verified
  (FINDINGS-REDTEAM.md item 2); flag-on probes pass budget/decrement
  checks. Deliberately NOT in `harness/knobs.ts` until the flag defaults
  on. Open items (REFACTOR.md register): the default-on decision + the
  coordinated re-sweep; no flag-on re-measurement of the OT-share target
  exists in-repo. With the flag off, OT share measured 1.7% at oos-60
  (2026-07-27) vs the cited real 4.80% (2023-24 regular season, computed
  from Basketball-Reference schedules, N=1230; long-run ~5.9%).

**Out-of-sample status** (`npm run oos` — generated rosters the sweep never
saw): re-run at each landing — an obligation wave 2 missed; the numbers
below are the 2026-07-27 re-measurement (60 games, 12 generated rosters,
one generated set — indicative per §4.4, but the deltas dwarf draw noise).
Bands 15/17: 3PA share 32.5% vs the 33.0 floor (a generalization gap — the
acceptance-roster center is 36.8% ±0.1 at n40) and fouls 23.3 vs the 22.5
ceiling (the same miss as the acceptance batch). Distributional report
(REPORT-ONLY, ratchet convention) — measured vs cited 2023-24 regular
season (computed from Basketball-Reference schedules, N=1230): avg final
margin 15.1 vs real mean |margin| 12.58; blowout (20+) share 32% vs 19.1%;
close-game (≤5) share 17% vs 23.3%; OT share 1.7% vs 4.80% (long-run
~5.9%); margin sd 10.3. This is a distributional REGRESSION vs the
previously documented state ("avg margin 12.2 / blowout 17% — in range",
measured pre-wave-2): the wave-2 landing moved the report the wrong way
and the report was not re-run at that landing. Close-game share also
FLIPPED from above range (37%) to below (17%) — the old "fat middle, fat
tails, missing shoulders" diagnosis no longer describes the tip.
Distributional misses are mechanism candidates first, fitting targets
second — see the roadmap's validation arc.

**Texture (measured by `npm run texture`; latest read 2026-07-27, 8 games,
single base — indicative per §4.4):** average live speed 6.40 ft/s vs the
cited reference 4.22 mph = 6.19 ft/s (2023-24 team AVG_SPEED, NBA.com
Speed & Distance tracking) — on target within definitional noise; there is
NO open speed residual. History: 8.67 → 6.55 ft/s across the texture
increment, then 6.24 ft/s after the jog-economy fix (commit `00e2cda`,
2026-07-26 — the units-verdict commit; this paragraph formerly compared
those ft/s readings against "NBA ~4.2" WITHOUT units, a ft/s-vs-mph
confusion whose full record is in the friction-signature history above).
Stationary share 31%, walking (1-6 ft/s) 16%, running (>6 ft/s) 53%,
ping-pong share of passes 13.5% (was 26.8% pre-increment — the eye-test
oscillation, largely gone), passes/possession 1.93 vs the cited NBA
~2.84-2.86 (see the pass-volume finding above) — the damping overshot;
open item. Mechanisms: pass-back damping (concept 3's negative side),
stillness deadbands with walked spacing moves, purposeful relocation with
the denied shooter's baseline escape.

## Known simplifications (deliberate, documented)

Simplified inbounds (timed reset, no inbound passer) · endgame management
(timeouts, intentional fouling, hold-for-last, two-for-one, clock burn) is
implemented but flag-gated default-OFF (`GameConfig.endgame` — so the default
game still plays without timeouts; the default-on decision belongs to the
coordinated re-sweep, REFACTOR.md register) · no backcourt/
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
