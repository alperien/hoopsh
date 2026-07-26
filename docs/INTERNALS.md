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
| `sim/ai/actions.ts` | pnr/post/iso/dho lifecycle | calling & phasing team actions |
| `sim/ai/offense.ts` | spacing spots, cuts, screens, shot-reaction crash/boxout | off-ball offense |
| `sim/ai/defense.ts` | matchups, help, blitz, drop, containment, denial, sag | defensive positioning |
| `sim/ai/shared.ts` | creation hierarchy, defender queries, locomotion policy | cross-layer queries |
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
validation, archetypes, sample packs), `narration/` (frozen demo layer),
`harness/` (batch runner, bands, sweep, fidelity benchmarks, inverse solver), `packages/viewer/` (prototype).

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
npm run test     # 69 tests: determinism, geometry, archetypes, narration, schema,
                 # wide-band realism guard, and the INVARIANT SUITE (below)
npm run batch -- --games 24    # fine-grained NBA acceptance bands
npm run bench    # ≥1 game/sec budget (typical ~6)
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
  Successor systematic finding: ASSISTED SHARE ~0.65 vs the 0.62 ceiling,
  repeating on all three seed bases — the drive-and-kick era converts
  collapses into assisted makes; unassisted-creation economy (post, iso)
  was boosted (postCallShare 1.875, isoCallShare 0.91) but the hub's post
  volume remains under his identity floor. Open item with a named cause.
- **THE FRICTION SIGNATURE (historical — resolved above)** (the review computed it from our own table; the
  calreport now emits it): friction/volume statistics pin near band FLOORS
  (pace edge-unresolved at +1.5se, trb/stl/blk/tov hugging at ~1σ gate
  distance, fta/orbPct at ~2σ) while accuracy/efficiency statistics pin near
  CEILINGS (ORtg edge-unresolved at +0.6se, 3P% hugging, FG%/FT%/assisted
  share at ~1.6-1.9σ). Read as ONE defect with a direction: the sim plays
  frictionless, hyper-efficient basketball at slightly few possessions.
  Prime mechanical suspect: movement speed (6.55 ft/s vs NBA ~4.2) feeding
  every spatial computation. **Speed-pin experiment (run 2026-07-26,
  reviewer-designed): all speeds × 0.64 ≈ NBA-equivalent, every shot/contest
  constant held fixed → pace 95.3→86.5, FG% 48.0%→50.1%, ORtg 120.8→126.8,
  blocks 3.8→2.5 at 24 games.** Large moves everywhere = the shooting
  calibration HAS absorbed the kinematics error (the current constants are
  fitted to a world where defenders arrive ~1.5× too fast). Consequence,
  binding on the validation arc: fix movement speed BEFORE fitting shot
  models to real data, or the absorption gets a citation attached.
- **Elite-shooter benchmark's assist center runs high**: 9.51 ±0.16se at
  8×40-game bases vs the 4.5-8.5 identity range. (An earlier 4-draw probe
  read 9.13 — the sample-size lesson applied to ourselves: quote the floor's
  larger sample, not a hand probe.) The cast fix (point-forward hub authored
  in) plus the passVision trim moved the center only 9.64→~9.5 — LITTLE,
  which sharpens the engine-level audit question the fixture change cannot
  answer: the decision layer appears to over-generate assists for high-usage
  shooters regardless of cast structure. Promoted in the audit ranking.
- **Position updates at 40 league bases**: pace center RESOLVED inside its
  band (95.42, +3.5se above the 95.0 floor); ORtg center 121.08 ±0.27se —
  edge-unresolved, leaning just above the 121 ceiling. The friction
  signature persists (floors: trb/blk/tov ~1σ; ceilings: 3P%/ORtg).
- **Pass volume runs low**: ~2.3 passes/possession vs the NBA's ~3.2 after
  pass-back damping (baseline was 2.95) — the swing economy thinned; open
  texture item.
- **Endgame management is missing, distinctly from mid-game coupling** (the
  review's sharpest cut): conditional on a game being close, OT arrives ~9%
  of the time vs the league's ~26% (3.3/37 vs ~6/23) — near-ties are played
  out instead of MANAGED (no timeouts, intentional fouling, hold-for-last,
  two-for-one, clock burn). Margin sd high (~12 vs 8-9) AND close-game share
  high (37% vs 20-26%): fat middle, fat tails, missing shoulders — TWO
  mechanism gaps (mid-game coupling; endgame management), not one.

**Out-of-sample status** (`npm run oos` — generated rosters the sweep never
saw): re-run at each landing. The texture increment improved the
distributional report as a side effect — avg margin 12.2 (was 13.7, NBA
11-12) and blowout share 17% (was 23%, NBA 15-20%) are now in range;
overtime share (3.3% vs 5-7%) and margin spread (sd ~12 vs 8-9) remain the
game-state-coupling gap: nothing yet pulls diverging games back together
or tightens finishes (timeouts, trailing-team urgency, tempo kill).
Distributional misses are mechanism candidates first, fitting targets
second — see the roadmap's validation arc.

**Texture (measured by `npm run texture`, before → after the texture
increment):** average live speed 8.67 → 6.55 ft/s (NBA ~4.2; the residual
is an open item — real spacing is held even more than the sim holds it),
stationary share 28% → 33%, ping-pong share of passes 26.8% → 12.4%
(the eye-test oscillation, largely gone), passes/possession 2.95 → 2.23
(NBA ~3.2 — the damping overshot; open item). Mechanisms: pass-back
damping (concept 3's negative side), stillness deadbands with walked
spacing moves, purposeful relocation with the denied shooter's baseline
escape.

## Known simplifications (deliberate, documented)

Simplified inbounds (timed reset, no inbound passer) · no timeouts · no backcourt/
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
narration/viewer are frozen prototypes.
