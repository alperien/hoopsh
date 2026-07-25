<!-- ============================================================
  GENERATED FILE — DO NOT EDIT.
  This is the hoopsh Bible: all six source documents compiled in canonical
  reading order. Edit the sources, then regenerate: npm run docs:bible
  Sources (in order): README.md · ARCHITECTURE.md · docs/INTERNALS.md · AGENTS.md · docs/PLAYBOOK.md · docs/ONBOARDING.md
============================================================ -->

# 📖 The hoopsh Bible — everything, one file

> Generated from the six source documents. If this file and a source document
> disagree, the source is right and this file is stale — regenerate it.

## Contents
1. **README.md**
2. **ARCHITECTURE.md**
3. **docs/INTERNALS.md**
4. **AGENTS.md**
5. **docs/PLAYBOOK.md**
6. **docs/ONBOARDING.md**



---
---

<!-- ================= SOURCE: README.md ================= -->

# hoopsh

*A modular, deterministic, 2D-spatial basketball simulation core.*

Ten agents move on a real court at 10 ticks per second — spacing, drives, kick-outs, cuts,
closeouts, help rotations, box-outs. Discrete outcomes (shots, passes, fouls, rebounds)
resolve through **calibrated probability models fed by spatial context**: games follow
basketball rules and season-scale statistics fall inside real-league ranges. Every point
in a box score traces back to a simulated shot from a real (x, y) location.

hoopsh is engine-first: MyPlayer careers, GM/franchise modes, historical what-ifs
("drop Jordan into 2015"), broadcast experiences — all of these are thin apps consuming
one core's event stream. Leagues (NBA, NCAA, EuroLeague) are swappable **rule packs**;
rosters are human-editable **data packs**.

## Quickstart — zero dependencies

All you need is **Node 24+**. No `npm install` — the repo runs directly from TypeScript
source via Node's native type stripping and a tiny loader hook.

```bash
git clone https://github.com/alperien/hoopsh && cd hoopsh

npm run sim                      # simulate one game: box score + play-by-play + replay
npm run sim -- --seed my-seed    # deterministic: same seed = bit-identical game
npm run batch -- --games 50      # sim N games, grade vs NBA realism acceptance bands
npm run bench                    # games/sec benchmark (budget: ≥1; typical: ~6)
npm run test                     # full suite via node:test (zero installs)
npm run broadcast                # two-voice broadcast script for a game
```

Optional dev tooling (`typescript`, `vitest`, `tsx`) layers on with a normal
`npm i -D typescript vitest tsx @types/node` — but nothing requires it.

## Watch a game

```bash
npm run sim -- --seed showcase           # writes out/replay-showcase.json
npm run viewer:embed out/replay-showcase.json out/game.html
open out/game.html                       # court, players, ball, score, clock, ticker
```

Or open `packages/viewer/index.html` directly and **drag any replay JSON onto it**.
Playback controls: space to play/pause, ←/→ to skip ±10s, speed cycling, name labels,
made/missed shot splashes.

## Packages

| Package | What it does |
|---|---|
| `@hoopsh/engine` | Pure, zero-dependency, deterministic sim core (Node + browser) |
| `@hoopsh/stats` | Event stream → box scores, exact minutes/±, advanced stats, shot charts |
| `@hoopsh/data` | Player/team schemas, validation, archetype builders, sample teams |
| `@hoopsh/narration` | Template play-by-play with run/milestone awareness + LLM commentary interfaces |
| `@hoopsh/harness` | Batch runner, NBA acceptance bands, benchmarks, calibration tooling |
| `packages/viewer` | Single-file 2D canvas replay viewer (embed tool + drag-and-drop) |

Dependency rule: **`engine` imports nothing; everything else imports `engine`.**
The typed event stream is the public contract — stats, narration, and viewers are pure
consumers. Full design rationale in [ARCHITECTURE.md](./ARCHITECTURE.md).

**All documentation → [docs/README.md](./docs/README.md)** (the library hub: every
document, reading paths by role, which doc answers which question). The short list:
[ARCHITECTURE.md](./ARCHITECTURE.md) (design) · [docs/INTERNALS.md](./docs/INTERNALS.md)
(module map) · [AGENTS.md](./AGENTS.md) (**contributor covenant**) ·
[docs/PLAYBOOK.md](./docs/PLAYBOOK.md) (build procedure) ·
[docs/ONBOARDING.md](./docs/ONBOARDING.md) (learning path) ·
[docs/BIBLE.md](./docs/BIBLE.md) (everything compiled into one generated file)

## The core bet: hybrid spatial–stochastic simulation

Pure physics sims cannot be calibrated; pure stat sims have no feel. hoopsh runs
continuous 2D movement and decision-making, but resolves discrete events through
logistic models whose every constant lives in one flat object: **`SimParams`**, the
calibration surface. Player identity comes from handcrafted **attributes** (what a
player *can* do) and **tendencies** (what they *want* to do). An elite shooter profile
produces a heavy deep-three diet, off-ball gravity that warps the defense, and
star-level scoring volume as a result of these interactions, without being scripted.

Signature mechanics:
- **Shot windup** — shots take 0.4–0.65s to release, making every catch-and-shoot a
  race against the closeout; shooters *anticipate* the flying defender when judging
  shot quality.
- **Self-consistent AI** — the same model that resolves shots also drives shot
  *selection*, so decision-making and outcomes can never drift apart.
- **Honest defense economics** — sagging off non-shooters works because a rim-runner's
  open 9-foot floater is genuinely a win for the defense.

## Realism status

A batch harness grades league-wide averages against 16 NBA acceptance bands
(pace, efficiency, shot mix, rebounding, fouls, turnovers…), and an automated
parameter sweep (`npm run sweep`) keeps them locked. Current state: **46–48 of 48
band-checks passing across three independent seed bases** at 40-game samples;
residual misses are <1% band-edge grazes (the sampling noise floor). A 50-test
suite, including a permanent invariant suite derived from two adversarial audit
rounds, guards determinism, possession accounting, minutes conservation, and
buzzer integrity on every change. Archetype tests pin player differentiation
(elite shooter ≈ 25 pts on ~20 FGA with a deep-three diet; rim-runner takes 90%+
of shots inside; non-shooting bigs do not take low-value shots).

Run it yourself: `npm run batch -- --games 50`.

## Roadmap

**Done:** replay viewer · broadcast demo · automated parameter sweep ·
orchestrator refactor · pick-and-roll · invariant suite · full documentation
campaign (33% engine comment density, contributor covenant, onboarding path)

**Phase 2R (current):** usage hierarchy & re-initiation (make floor generals lead
their teams in assists) · post-up game · dump-off reads · fidelity harness + inverse
solver · Curry/LeBron/Jokić profiles validated against real-life stat ranges.

**Beyond:** season layer (schedules, fatigue across games, injuries) · progression &
aging · NCAA + EuroLeague rule-pack tuning · era packs (1995 vs 2015 shot diets) ·
deep player editor UI · GM & MyPlayer experiences · defensive schemes ·
broadcast TTS audio · WASM hot path if the perf budget ever demands it.

## License

Not chosen yet — treat as all-rights-reserved until a license lands.


---
---

<!-- ================= SOURCE: ARCHITECTURE.md ================= -->

# hoopsh — Architecture

*A modular, deterministic, 2D-spatial basketball simulation core.*

> Everything here is designed so that **experiences** (MyPlayer careers,
> GM/franchise, historical what-ifs, broadcast viewing) are thin applications built
> around one engine — never entangled with it.

---

## 1. Design goals

1. **Ultra-realistic outputs.** Season-scale averages for a given ratings profile should
   land inside that player's real-life statistical range. League-wide aggregates (pace,
   efficiency, shot mix, rebounding, turnovers) must sit inside acceptance bands derived
   from real league data.
2. **Handcrafted identity.** Players are defined by human-editable **attributes**
   (what a player *can* do) and **tendencies** (what a player *wants* to do). No opaque
   learned blobs: every knob is inspectable, editable, shareable as a data pack.
3. **Modular and expandable.** Leagues are **rule packs** (NBA / NCAA / EuroLeague /
   custom). Rosters are **data packs**. Narration, stats, UIs, and future experiences are
   **consumers of the event stream** — the engine never knows they exist.
4. **Deterministic.** Same seed + same inputs ⇒ bit-identical game, every time, on every
   platform. Non-negotiable for debugging, calibration, and replay sharing.
5. **Fast.** Target ≥ 1 full game/second/core in Node. Calibration sweeps run thousands
   of games; speed is a feature.

## 2. The core bet: hybrid spatial–stochastic simulation

Pure physics sims cannot be calibrated; pure stat sims have no feel. hoopsh runs a
**continuous 2D spatial layer** (movement, spacing, defensive positioning) and resolves
**discrete events probabilistically** (shots, passes, fouls, rebounds) using models fed
by spatial context:

```
tick (10 Hz):
  1. perceive   — each agent reads court state (ball, matchups, openness, clock)
  2. decide     — utility-based policies pick actions (attributes + tendencies + tactics)
  3. move       — steering integration under speed/accel limits derived from ratings
  4. resolve    — scheduled discrete events fire through probability models
  5. emit       — events append to the game's event stream; frames append to the replay
```

The probability models take spatial inputs (shot distance, contest level, closing speed,
passing-lane geometry) and player ratings, and **every constant lives in `SimParams`** —
a single tunable parameter object. That is the calibration surface. Realism becomes a
measurable optimization problem: tune `SimParams` until league aggregates hit acceptance
bands, while archetype tests pin player differentiation.

Two layers of knobs, deliberately separated:

| Layer | Examples | Tuned by |
|---|---|---|
| Global (`SimParams`) | base make-prob per zone, foul rates, rebound geometry, decision temperatures | calibration harness, vs league data |
| Player (ratings → modifiers) | rating curves mapping 0–100 skills into model coefficients | archetype test suite |

A third layer — **era packs** — can later override global tendencies (1995 shot diet vs
2015 pace-and-space), which is exactly what "drop Jordan into 2015" needs.

## 3. Package layout (npm workspaces monorepo)

```
packages/
  engine/      pure, zero-dependency, deterministic sim core (Node + browser)
  stats/       event stream → box scores, advanced stats, shot charts
  data/        player/team JSON schemas, validation, sample fictional rosters
  narration/   template play-by-play + LLM color-commentary interfaces
  harness/     batch runner, acceptance bands, benchmarks, calibration tools
  viewer/      (planned) single-file 2D canvas replay viewer
```

Dependency rule: `engine` imports nothing. Everything else imports `engine`.
Experiences (GM, MyPlayer, editor UI) will live outside these packages and speak to the
engine only through its public API: `simulateGame(config) → { events, replay, result }`.

## 4. Engine internals

### 4.1 Coordinates, units, time

- Units: **feet**, seconds. Court is `length × width` from the rule pack
  (NBA: 94 × 50). Origin at the home baseline's left corner; x along the court length.
- Hoops at `(rimInset, width/2)` and `(length − rimInset, width/2)`; NBA rim inset 5.25 ft.
- Tick rate `10 Hz` (a `SimParams` knob). A 48-minute game ≈ 28,800 ticks.

### 4.2 Rule packs

`RulePack` is data, not code: period count/length, OT length, shot clock (+ offensive
rebound reset), team-foul bonus thresholds, personal foul-out limit, three-point
geometry (arc radius, corner distance, corner break), court dimensions, clock-stopping
rules. NBA ships first; NCAA/EuroLeague are follow-ups. Custom leagues are just JSON.

### 4.3 Player model

- **Attributes (0–100):** physical (speed, accel, strength, vertical, lateral quickness,
  stamina, height/wingspan as real measurements) and skills (finishing, mid, three,
  free throw, ball-handle, pass accuracy/vision, perimeter/interior defense, steal,
  block, off/def rebounding, box-out, contest, decision speed, consistency).
- **Tendencies (0–100):** shot diet by zone, pull-up vs catch-and-shoot, drive/pass-out/
  iso/post frequencies, off-ball movement styles (spot-up, cut, screen), crash vs
  get-back, defensive gamble, foul aggression, tempo push.
- **Derived quantities:** ratings map to physical/model units through documented curves
  in `model/derived.ts` (e.g. speed 0–100 → max sprint ft/s). These curves are part of
  the calibration surface.

"Curry-ness" = elite three ratings + heavy three/pull-up tendencies + high off-ball
movement + gravity (defenses guard him tighter, farther out, which creates the
spacing his teammates feed on). Identity is a product of this interaction, not a script.

### 4.4 Offense AI

- Formation spots from a tactics template (5-out / 4-out-1-in chosen from personnel).
- Ball-handler policy scores `{shoot, drive, pass(x4), reposition}` each decision window:
  - Shot utility = predicted make prob (same model that resolves shots — the engine is
    self-consistent) × shot value + foul-draw EV, weighed against the possession's
    remaining continuation value, which decays as the shot clock drains. Late-clock
    heaves and early good-shot-taking emerge naturally.
  - Drive utility from lane openness; help convergence spikes kick-out utility —
    drive-and-kick emerges without scripting.
- Off-ball: hold/relocate to spacing spots, cut when lanes open, simple pick-and-roll
  action (screen delay on the on-ball defender; screener rolls or pops by tendency).

### 4.5 Defense AI

Man-to-man v1: positioning on the man–rim line, sag depth from shooter gravity and ball
distance (help side), closeouts on the catch, help rotation when a drive beats the
primary defender, contest quality from distance/closing speed/length at release.
Schemes (drop vs switch PnR coverage, zones) are later modules behind the same interface.

### 4.6 Rebounds, fouls, transition

- Miss location sampled by shot distance (long misses rebound long), then a weighted
  contest among boxout/positioning/athleticism of nearby players. Putbacks emerge.
- Foul models: shooting fouls (contest tightness, zone, defender aggression), reach-ins,
  charges (rare). Team-foul bonus and foul-outs from the rule pack. FT sequences.
- Live-ball turnovers and defensive rebounds trigger transition: if the defense isn't
  set, early-offense quality bonuses apply. Fast-break points emerge.

### 4.7 Event stream & replay

Every discrete outcome is a typed event (`shot`, `pass`, `rebound`, `turnover`, `foul`,
`free_throw`, `substitution`, `violation`, period markers) carrying game clock, shot
clock, score, and spatial coordinates (shots carry x/y for shot charts). The replay file
= metadata + downsampled position frames + the event list; the viewer renders it without
re-simulating.

### 4.8 Determinism

One seeded PRNG (sfc32) owned by the game; no `Math.random`, no `Date.now`, no float
nondeterminism from iteration order. Tests assert bit-identical event streams for fixed
seeds.

## 5. Realism: how "Curry averages like Curry" actually gets enforced

1. **League acceptance bands** (harness): sim N games between balanced rosters; assert
   pace, points, FG%/3P%/FT%, 3PA rate, FTA rate, ORB%, TOV%, assists, steals, blocks,
   fouls all inside bands taken from real league seasons.
2. **Archetype tests** (engine test suite): hand-built extreme profiles must produce the
   right *shape* of stat line — the elite shooter's 3PA share, the rim-runner's points
   at the rim, the floor general's assist rate. Direction and band, not exact values.
3. **Star fixtures**: full ratings profiles for star archetypes simmed over seasons;
   assert the sim distribution overlaps the player's real-life season range (real
   players vary year to year — that variance defines honest tolerance).
4. **Parameter search**: `SimParams` is a flat, serializable object precisely so the
   harness can grid/random-search subsets of it against the acceptance report.

Calibration order matters: pace → shot mix → efficiency → fouls/rebounds/turnovers →
archetype differentiation. Each stage locks before the next tunes.

## 6. Narration layer

Consumes the event stream; never touches the engine.

1. **Template PBP** — every event rendered to text with variety pools, seeded selection,
   repeat-avoidance, and context trackers (scoring runs, lead changes, milestones,
   clutch time).
2. **`CommentaryProvider` interface** — receives windows of events + narrative context
   (storylines, box score snapshots, momentum) and returns color commentary. LLM-backed
   implementations plug in here; the template layer is the zero-cost fallback.
3. **Broadcast audio** (roadmap) — two-voice play-by-play + color scripts rendered to
   TTS for highlight reels and quarter recaps.

## 7. Performance budget

- ≥ 1 game/sec/core single-threaded in Node (bench harness tracks this from day one).
- Batch runner parallelizes across worker processes; determinism preserved per-game
  (each game owns its seed, so parallel order can't change results).
- If the budget ever breaks against a future feature: hot loops port to Rust/WASM behind
  the same TypeScript API. Nothing above the engine notices.

## 8. Roadmap after v0.1

season layer (schedules, rotations, fatigue across games, injuries) → progression/aging
→ NCAA + EuroLeague rule packs → era packs → deep editor UI → GM & MyPlayer experiences
→ defensive schemes → broadcast audio → possible WASM core.


---
---

<!-- ================= SOURCE: docs/INTERNALS.md ================= -->

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
| `sim/ai.ts` | decideBall utilities, spacing/cuts, pick-and-roll, man defense | **all basketball behavior** |
| `sim/resolve.ts` | probability models: shots, contests, passes, rebounds | make/miss math |
| `sim/params.ts` | **every tunable constant** (`SimParams`) | calibration; never hardcode a constant elsewhere |
| `sim/state.ts` | shared types + `emit()` | event stamping, new state fields |
| `core/events.ts` | the event schema — **the public contract** | anything consumers see |
| `core/rng.ts` | seeded sfc32 + distributions | never use Math.random |
| `geometry/court.ts` | court build, shot zones, spacing spots | three-point geometry |
| `rules/rulepack.ts` | league packs (NBA/NCAA/EURO) | league differences |
| `model/player.ts` | attributes & tendencies (the 37 dials) | the editable surface |
| `model/derived.ts` | rating → physical-unit curves | what "90 speed" means |
| `replay/replay.ts` | replay JSON assembly | viewer data needs |

Consumers: `stats/box.ts` (events → box score, exact minutes/±), `data/` (schemas,
validation, archetypes, sample packs), `narration/` (frozen demo layer),
`harness/` (batch runner, bands, sweep, benchmarks), `packages/viewer/` (prototype).

## Design rules that maintain consistency across this codebase

1. **One probability form.** Every resolution is `sigmoid(base + Σ terms)`; every
   constant lives in `SimParams`. Rating influence goes through `n(rating)` ∈ [-1, 1].
2. **Self-consistent AI.** The model that resolves a shot is the model the AI uses to
   *choose* it (`shotEV` calls `shotMakeP`). Decision and outcome cannot drift apart.
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
npm run test     # 50 tests: determinism, geometry, archetypes, narration, schema,
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

## Calibration workflow

1. Change mechanics → `npm test` (invariants + wide guard must stay green).
2. `npm run batch -- --games 24` → see which bands drifted.
3. `npm run sweep -- --iters 14 --cands 4 --games 12 --verify 40` → let the optimizer
   re-center; bake the printed diff into `params.ts` defaults; verify with
   `npm run sweep -- --iters 0 --verify 40`.
4. Expect the noise floor: at 40-game samples, single bands graze edges by <1% on
   some seeds. 46–48 of 48 checks passing with sub-5% misses is a locked state.

## Known simplifications (deliberate, documented)

Simplified inbounds (timed reset, no inbound passer) · no timeouts · no backcourt/
8-second/travel violations · NBA last-2-minutes bonus rule not yet implemented ·
league assists run ~1 under the band floor (the sole Stage 2 calibration
residual — 45/48 checks at 40 games x 3 seeds; unassisted post twos and
live-ball strips replaced some assisted catch-and-shoot volume, and the
underlying assisted-share gap below is the real fix) ·
league assisted-share ~46-50% of makes vs NBA ~58% (no acceptance band constrains
it yet; gates the floor-general 6+ apg level ratchet in archetypes.test.ts) ·
man-to-man with drop coverage only · narration/viewer are frozen prototypes.


---
---

<!-- ================= SOURCE: AGENTS.md ================= -->

# AGENTS.md — the hoopsh contributor covenant

**Audience: AI agents first, humans second.** An AI agent assigned to work on this
codebase must read this file completely before writing anything. It exists so that
many agents, working on different parts at different times, produce ONE consistent
codebase. Several rules below encode incidents that corrupted stats or wasted
calibration runs; see the DO-NOT list (§2) and prime directives (§1) for citations.

Reading order for a new contributor: `README.md` → `ARCHITECTURE.md` →
`docs/INTERNALS.md` → this file → `docs/ONBOARDING.md` (guided walkthrough).

**Writing NEW code?** This file is the law; **`docs/PLAYBOOK.md` is the procedure** —
an eight-step process, per-change-shape recipes with exemplars, STOP conditions, and
the required completion-report format. Follow it step by step.

---

## 1. Prime directives (violating any of these is never acceptable)

### 1.1 The engine imports nothing
`packages/engine` has **zero dependencies** — no npm packages, no Node built-ins
(`node:fs`, `node:path`, …), no globals beyond the JS language and `structuredClone`.
It must run identically in Node and a browser. An engine change that needs I/O
belongs in a different package.

### 1.2 Determinism is mandatory
Same seed ⇒ bit-identical events and frames, on every platform, with no exception.
- **Never** use `Math.random`, `Date`, `performance.now`, or any ambient state inside
  the engine. All randomness flows through the game's seeded `Rng` (core/rng.ts).
- Be careful with **iteration order**: `Map`/`Set` iterate in insertion order (fine),
  but never iterate an object whose key order you don't control.
- Adding, removing, or reordering **any** `rng` call changes every game thereafter.
  That's allowed (it's not a compatibility break) but it invalidates fingerprints —
  see §4.3 for which verification tier that puts you in.

### 1.3 Events are the only contract
Consumers (stats, narration, viewers, future experiences) have no visibility into
engine internals. Information a consumer needs goes into the **event stream**
(core/events.ts) — never expose engine state directly. Box scores must remain fully
reconstructible from events alone (an invariant test enforces this).

### 1.4 Every behavioral constant lives in SimParams
A hardcoded tunable number inside engine logic is unreachable by the calibration
sweep, and league realism degrades without warning. New constants go in
`sim/params.ts` (+ a range entry in `harness/src/knobs.ts` if sweepable).
Timing/geometry literals that are NOT behavioral levers (e.g. cosmetic free-throw
lineup spots) may stay inline but must carry a comment explaining their real-world
meaning (see §5).

### 1.5 Two time axes — never mix them
- `t` / `Base.t` — **game-clock time**. Stops at whistles, stops at the horn.
  Minutes, pace, and all statistics key on it.
- `wallT` / `Base.wt` — **replay timeline**. Advances every tick, stoppages included.
  Frames and viewers key on it.
Mixing them has caused two historical incidents: post-buzzer scoring and free-throw
teleport-glides. `movement.ts#advanceClock` is the only writer of `t`; `game.ts#tick`
is the only writer of `wallT`.

### 1.6 Invariants take precedence
`packages/engine/test/invariants.test.ts` encodes guarantees verified by adversarial
audits. **If a change makes an invariant fail, the change is wrong — never the
invariant.** Weakening or deleting a test to make code pass is the highest-severity
violation defined in this repo. (Tests may be *corrected* only when the test itself
has a demonstrable bug — document the reasoning in the commit message.)

### 1.7 Only erasable TypeScript syntax
The runtime is **Node's native type stripping** (zero build step, see `tools/`).
Therefore: **no enums, no namespaces with runtime code, no constructor parameter
properties** (`constructor(private x: T)`), no `import x = require()`. Type-only
imports must be marked `import type` / inline `type` — stripping does not do import
elision, so an unmarked type-only import becomes a runtime error. Relative imports
use the `.js` extension convention (`from './state.js'` for `state.ts`).

---

## 2. The DO-NOT list

1. **Do not "tidy" SWEPT values.** `shootRim: 0.485` is not a rounding error — an
   optimizer chose it against 48 acceptance-band checks. Rounding it de-calibrates the
   league. If a value looks wrong, re-run the sweep and bake its output.
2. **Do not add rating dials speculatively.** New attributes/tendencies are added ONLY
   when a benchmark player is inexpressible without them (a failing fidelity case).
   Unvalidated depth expands the solver's search space with no offsetting benefit.
3. **Do not put behavior in consumer packages.** The viewer renders; narration
   describes; stats folds. None of them may influence or re-derive game logic.
4. **Do not touch calibrated defaults without re-verifying.** Any change to
   `sim/params.ts` values or to mechanics that consume them requires the calibration
   ladder (§4.2). The knobs are coupled. Incident (file header, `sim/params.ts`):
   increasing one foul rate reduced the league three-point rate by 8 points.
5. **Do not leave dead or misleading surface.** Anything defined-but-unconsumed must
   be labeled `STAGED` (deliberate, tied to a roadmap stage) or `UNWIRED` (accidental
   debt, with the condition for wiring it). Unlabeled dead code gets deleted.
6. **Do not add runtime dependencies without explicit owner approval.** The repo
   runs with zero installed packages by design.
7. **Do not reformat, rename, or "improve" code outside assigned scope.** Multi-agent
   work stays mergeable only if diffs are minimal and scoped. No drive-by edits.
8. **Do not break replay compatibility silently.** The replay JSON shape and the
   frame row layout are consumed by the standalone viewer; bump `Replay.version` and
   update `packages/viewer` in the same change.
9. **Do not bypass the roster schema.** New player/team fields go through
   `data/src/schema.ts` validation and the pack `formatVersion` discipline.
10. **Do not trust your memory of this file's rules over the code's own comments.**
    When they disagree, the code comments and tests are newer; flag the discrepancy.

---

## 3. Where things go (ownership map)

| You are changing… | It belongs in… |
|---|---|
| What a player decides to do | `sim/ai.ts` (utilities) |
| Whether an attempt succeeds | `sim/resolve.ts` (probability models) |
| A tunable constant | `sim/params.ts` (+ `harness/knobs.ts` range) |
| Phase flow / possession lifecycle | `sim/possession.ts`, dispatched from `sim/game.ts` |
| What consumers can see | `core/events.ts` (the contract) + `replay/` |
| What a rating means physically | `model/derived.ts` (curves) |
| League rules | `rules/rulepack.ts` (data, not code) |
| Stat math | `stats/` — pure event folding |
| Realism measurement / tuning | `harness/` |
| Editable content | `data/` (packs, archetypes, validation) |

Full map with per-file detail: `docs/INTERNALS.md`.

---

## 4. The change workflow

### 4.1 Before you write
1. Read the module header + `docs/INTERNALS.md` row for every file you'll touch.
2. State (to yourself / in your plan) which verification tier your change lands in (§4.3).
3. Capture the **fingerprint**: `npm run sim -- --seed fingerprint-1` → note the event
   count and final score, and run `npm test` → note pass counts.

### 4.2 The verification ladder
```
npm test                        # 50 tests incl. invariants — ALWAYS, every change
npm run batch -- --games 24     # fine-grained NBA bands — any mechanics/params change
npm run sweep -- --iters 0 --games 4 --verify 40   # 3-seed band verification — params changes
npm run sweep -- --iters 14 --cands 4 --games 12 --verify 40  # re-tune — when bands drifted
npm run bench                   # perf budget ≥1 game/sec — hot-path changes
```

### 4.3 Verification tiers
- **Docs-only / comments-only**: fingerprint must be IDENTICAL before and after
  (same event count, same final score, same test counts). Any difference means you
  touched executable code.
- **Pure refactor** (move code, no behavior change): fingerprint identical, tests
  identical. This is provable and expected — the orchestrator split was verified
  bit-for-bit this way.
- **Mechanics change**: tests green (invariants especially), then the calibration
  ladder. Expect band drift; re-tune with the sweep, bake the diff, verify.
- **Consumer change** (stats/narration/viewer): tests green; engine fingerprint
  must be untouched.

### 4.4 Calibration etiquette
- The 16 NBA bands (`harness/src/bands.ts`) are the gate. "Locked" means 46–48 of 48
  band-checks passing across the three seed bases at 40+ games, with any single miss
  under ~1% outside a band edge; that residual is the **noise floor** (sampling
  variance), not miscalibration. Do not chase it with hand-nudges — use the sweep.
- After the sweep prints a diff, bake it into `params.ts` defaults (keep the odd
  precision), then re-verify with `--iters 0`.

### 4.5 Commits
- Small, focused, one concern per commit. Conventional prefixes:
  `feat(engine):`, `fix(engine):`, `docs:`, `test:`, `refactor:`, `tune:`.
- Message body states the verification you ran when it isn't obvious.
- This repo's history is intentionally bisectable — keep it that way.

---

## 5. Comment & documentation standards

- **Voice**: explain the *basketball or design reason*, not the code mechanics.
  Good: "sagging off non-shooters works because his open 9-footer is a win for the
  defense." Bad: "// multiply by 0.6".
- **Register**: documentation and comments use a neutral technical register:
  declarative statements, incident citations rather than narrative, no motivational
  or promotional language. Emphasis is reserved for severity and safety-critical rules.
- **Every new numeric literal** gets either real-world units + meaning ("13.75 ft =
  NBA free-throw line to rim center") or an honest "FEEL — tuned for plausible
  timing, not statistically constrained."
- **New SimParams values** carry a provenance tag: `REAL` (measured basketball fact),
  `SWEPT` (optimizer-found — keep the odd precision), or `FEEL` (hand-set).
- **New exported functions** get JSDoc: what, when it's called (phase/trigger), and
  non-obvious side effects on `GameState`.
- **Traps get called out where they live** (ordering constraints, idempotency guards,
  protected IDs): a one-sentence comment at the point of confusion, stating what
  would otherwise require investigation to determine.
- Keep the two reference docs current: an architectural change updates
  `ARCHITECTURE.md`/`docs/INTERNALS.md` in the SAME commit.
- Any edit to a source document regenerates the compiled Bible in the same
  commit: `npm run docs:bible` (never edit `docs/BIBLE.md` directly).

---

## 6. Design taste (follow unless you have a measured reason not to)

- **Thin scaffolding, emergent behavior.** Model the geometry and incentives; let the
  basketball emerge. The pocket pass was never coded — the roll reuses cut machinery
  and the pass logic already valued cutters. Prefer that shape of solution.
- **Self-consistency**: decision-making must use the same models as resolution
  (`shotEV` wraps `shotMakeP`). Never let the AI's beliefs drift from reality.
- **Probabilistic resolution over hard physics**: spatial context feeds logistic
  models. That's the core bet that keeps realism calibratable.
- **Ratings express identity through interaction**, not special cases. An
  `if (player.isCurry)`-shaped branch is prohibited; do not add one.

## 7. When unsure

- Basketball-rules questions: check `rules/rulepack.ts` docs first; if the rule isn't
  modeled, add it to the known-simplifications list in `docs/INTERNALS.md` rather
  than half-implementing it.
- If a task seems to require breaking a prime directive, STOP and escalate to the
  project owner with the conflict spelled out. Do not reinterpret the rules.
- Two standing obligations beyond the assigned task: document undocumented behavior
  encountered (comments are always in scope); report bugs found outside scope rather
  than fixing them silently.


---
---

<!-- ================= SOURCE: docs/PLAYBOOK.md ================= -->

# PLAYBOOK — how to write NEW code for hoopsh, step by step

**Audience: any agent (or human) implementing new functionality.** `AGENTS.md` is the
LAW (what you may and may not do). This file is the PROCEDURE (how to do it). When
they conflict, the law wins; stop and report the conflict.

Follow these steps in order, copy the cited exemplars, report accurately.

---

## Part 1 — The eight steps (every new-code task, no exceptions)

### Step 1. Declare scope before writing anything
Write down (in your working notes and final report):
- **Files you will touch** — from the ownership map (`AGENTS.md §3`, `docs/INTERNALS.md`).
- **Verification tier** — from `AGENTS.md §4.3` (docs-only / pure refactor / mechanics / consumer).
- **Acceptance criteria** — how you will KNOW you're done (from your task brief).
If, later, you discover you need a file outside this list: **STOP** (Part 3) and
re-scope in your report. Never silently expand scope.

### Step 2. Read before you write
- The module header of every file in scope, plus its row in `docs/INTERNALS.md`.
- The **exemplar** named in your recipe (Part 2). You will pattern-match against it.
- If your task brief names no exemplar, find the nearest existing thing of the same
  shape and read it fully.

### Step 3. Capture the fingerprint
```bash
cd /path/to/hoopsh
npm run sim -- --seed fingerprint-1 2>&1 | grep -E "events|FINAL"
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|todo)"
```
Record all four numbers (event count, final score, tests, pass). Your report must
show before AND after values.

### Step 4. Design in the project's vocabulary
Answer, in one sentence each, BEFORE coding:
- Which layer is this? (a tendency? a SimParams knob? an AI action? an event?
  a consumer fold? — if you can't name the layer, re-read `ARCHITECTURE.md §2-4`)
- What existing thing is it most like? (that's your exemplar)
- What could it break? (name the invariant/band most at risk)

### Step 5. Implement in the smallest verifiable increments
- One coherent piece at a time; run `npm test` after each piece, not just at the end.
- Copy the exemplar's SHAPE: same file organization, same comment style, same
  naming pattern. Match the exemplar rather than choosing an alternative structure.
- Every new number gets a comment (units + meaning + provenance tag REAL/SWEPT/FEEL).
- New constants go in `sim/params.ts`, never inline (AGENTS.md §1.4).

### Step 6. Run the verification ladder for your tier
```bash
npm test                                              # always
npm run batch -- --games 24                           # mechanics/params changes
npm run sweep -- --iters 0 --games 4 --verify 40      # params changes (3-seed check)
npm run bench                                         # hot-path changes only
```
Paste the actual outputs into your report. If bands drifted and your brief didn't
authorize re-tuning: report the drift; do NOT freelance a sweep.

### Step 7. Self-review (the checklist)
Go through Part 3's checklist line by line. Each item corresponds to at least one
historical violation in this project.

### Step 8. Write the completion report
Use the exact format in Part 3. A report stating "docs don't explain X, so I did
not guess" ranks above a confident wrong answer.

---

## Part 2 — The pattern catalog (recipes with exemplars)

> Each recipe lists every file to touch, in dependency order. "Exemplar" = existing
> code to open side-by-side and pattern-match. If your task doesn't fit any recipe,
> that's a design question — STOP and escalate rather than inventing a new shape.

### Recipe A — a new tendency or attribute
**Gate first (AGENTS.md §2.2):** dials are added ONLY for a failing fidelity case.
Your brief must state which player/archetype is inexpressible without it.
**Exemplar:** how `stamina` is consumed in `sim/movement.ts#applyFatigue` (neutral
at 50 via a multiplier), and the field comments in `model/player.ts`.
1. `model/player.ts` — add to `Attributes`/`Tendencies` interface, with a comment
   citing the consumer; add to `DEFAULT_ATTR`/`DEFAULT_TEND` (50 unless the modern-
   baseline argument says otherwise — see the DEFAULT_TEND comment).
2. The consumer — `sim/resolve.ts` (resolution) or `sim/ai.ts` (decision), through
   the `n(rating)` bridge so 50 is neutral.
3. `sim/params.ts` — any new coefficient the rating multiplies (provenance-tagged).
4. `harness/src/knobs.ts` — range entry, if the coefficient is a calibration lever.
5. `data/src/schema.ts` — append to `ATTR_KEYS`/`TEND_KEYS`. **TypeScript will NOT
   catch it if you forget this** — the validator uses plain string arrays.
6. `packages/data/rosters/*.team.json` — regenerate via `npm run rosters:export`
   (packs missing the key now fail validation, by design).
7. `data/src/archetypes.ts` — set meaningful values where the default is wrong.
8. Tests: extend the archetype suite if the dial claims behavioral impact.
**Tier: mechanics** → full ladder; expect band drift if the consumer is live.

### Recipe B — a new SimParams knob
**Exemplar:** the `ai.pnr*` block in `sim/params.ts` (interface entry + commented
default, added together with its consumer).
1. `sim/params.ts` — interface field (with a `// what it means` comment) + default
   value (with units + provenance tag). Both in the SAME section as its siblings.
2. The consumer — read it via `s.params.<section>.<name>`. A knob nothing reads is
   UNWIRED surface; do not add it "for later."
3. `harness/src/knobs.ts` — `{ path, lo, hi }` if it's a calibration lever (read
   that file's header for what qualifies).
**Tier: mechanics** if the consumer changes behavior; ladder accordingly.

### Recipe C — a new AI action (a play pattern, like pick-and-roll)
**Exemplar:** the PnR implementation — `PnrAction` in `sim/state.ts`, `pnrTick` +
screener branch + drive bonus in `sim/ai.ts`, drop coverage in `defenseTick`,
`ai.pnr*` params block.
1. `sim/state.ts` — action type on `Possession.action` (extend the union), fields
   for phase/until/actors.
2. `sim/possession.ts#startPossession` — ensure the action resets (`action: null`
   is already there; new per-agent timers must be cleared in the stale-timer block).
3. `sim/ai.ts` — a lifecycle function (trigger conditions, phase transitions,
   expiry), integration into `offenseOffBallTick` (actor movement) and `decideBall`
   (utility nudges), defensive response in `defenseTick`.
4. **Staleness guards are mandatory**: the action must self-clear when an actor is
   substituted out, fouled out, or the ball changes hands (copy `actorGone` /
   `handlerLostBall` from pnrTick — both guards exist because audits caught their
   absence).
5. `sim/params.ts` + `knobs.ts` — every rate/distance/duration as knobs.
6. Consider whether the action deserves an **event** (Recipe D) for narration/stats.
7. Prove liveness: an on/off comparison probe (sim N games, trigger rate zeroed via
   params override vs default). Incident: the initial pick-and-roll implementation
   reached screen contact in 6.5% of actions; liveness was unmeasured before merge.
**Tier: mechanics** → full ladder + recalibration authorization in your brief.

### Recipe D — a new event type
**Exemplar:** `ShotEvent` in `core/events.ts` (documented invariants) and how
`stats/box.ts` folds it.
1. `core/events.ts` — interface extending `Base`, added to the `GameEvent` union,
   JSDoc stating WHEN it's emitted and what invariants consumers may rely on.
2. Emit sites — via `state.ts#emit` only (it stamps t/wt/period/clock/score).
3. `stats/box.ts` — either fold it or add an explicit `case ...: break;` with a
   comment saying stats ignores it (silent default-case swallowing hides bugs).
4. `narration/src/pbp.ts` — renderer entry or an explicit null with a comment
   (narration is frozen; minimum viable handling only).
5. `packages/viewer/index.html#buildFeed` — same choice, explicit.
6. `packages/engine/test/invariants.test.ts` — if the event carries a countable
   guarantee, encode it.
7. Replay compatibility: events ride inside replay JSON — additive fields are safe;
   anything structural bumps `Replay.version` (AGENTS.md §2.8).
**Tier: mechanics** (event emission changes the stream; determinism tests will
show new streams — expected, note it in the report).

### Recipe E — a new rule-pack field
**Exemplar:** `shotClockOffRebSec` (interface comment + per-pack values + consumer
in `possession.ts`).
1. `rules/rulepack.ts` — interface field with the real-world rule citation; values
   for ALL THREE packs (NBA tuned; NCAA/EURO get their rulebook-correct values with
   the existing "structural stub" caveat).
2. The consumer — engine code reads it via `s.rules.<field>`.
3. If a pack difference is untestable today, say so in the comment rather than
   pretending it's exercised.
**Tier: mechanics** for NBA-affecting fields; NCAA/EURO-only values are inert until
those packs are calibrated.

### Recipe F — a new test or invariant
**Exemplar:** `packages/engine/test/invariants.test.ts` (shared sim results, one
`describe`, provenance header).
1. Reuse the shared-games pattern (sim once, assert many) — keep the suite fast.
2. Only matchers the shim supports: `toBe, toEqual, toBeGreaterThan(OrEqual),
   toBeLessThan(OrEqual), toContain, toBeTruthy, .not` (see `tools/shims/vitest.ts`).
3. A new invariant needs a provenance comment: what bug/audit motivated it.
4. Never calibrate a test to current behavior just to make it pass — a test asserts
   what SHOULD be true.
**Tier: consumer** (tests don't change the engine; fingerprint must be identical).

### Recipe G — a new consumer feature (stats / harness / narration / viewer)
**Also covers pure data content**: new archetype builders, team packs, roster
fixtures (`data/`) — pattern-match the ten builders in `data/src/archetypes.ts`
and export from the package index. Validated with a minimal-capability agent
(2026-07): a clean archetype produced on the first attempt.
**Exemplar:** `fastbreakPts` in `stats/box.ts` (a fold over possession kinds).
1. Consume ONLY the event stream / replay JSON. If the data you need isn't in the
   events, that's Recipe D first — never reach into engine internals.
2. stats: extend the fold + derived helpers; keep "exact, not estimated" (this
   project computes real possessions/minutes, not NBA estimation formulas).
3. harness: new metrics go through `aggregate.ts` accumulators and, if gated,
   `bands.ts` with a documented source for the range.
**Tier: consumer** — engine fingerprint identical; `npm test` green.

---

## Part 3 — Guardrails, self-review, and the report

### Hard STOP conditions (stop working, write your report, escalate)
1. The same verification failure twice in a row after two distinct fix attempts.
   Repeated failed attempts are a higher-risk failure mode than the underlying bug.
2. You need a file outside your declared scope.
3. An **invariant test** fails — your change is wrong (AGENTS.md §1.6). Do not
   touch the test. Report the failure verbatim.
4. Your task seems to require violating a prime directive.
5. You cannot determine WHERE something belongs after checking the ownership map.
6. Bands drifted and your brief didn't pre-authorize recalibration.

### Anti-thrash / anti-guessing rules
- Max 3 edit-run cycles on the same problem before re-reading the relevant module
  docs top to bottom (the answer is often in a previously-skimmed comment).
- Never weaken/delete/re-tune a test or band to make code pass.
- Never "tidy" values, formatting, or names outside the diff.
- Unsure what a number/mechanism means and the docs don't say? State "the docs do
  not explain X" in the report; a stated unknown is preferable to a guess.

### Self-review checklist (before your report)
- [ ] Every file I touched was in my declared scope
- [ ] `npm test` output pasted; counts match expectations for my tier
- [ ] Fingerprint before/after pasted; identical if my tier requires it
- [ ] Every new number has units + meaning + provenance tag
- [ ] Every new export has JSDoc (what / when called / side effects)
- [ ] No new constant hides outside `sim/params.ts`
- [ ] No `Math.random`/`Date`/Node built-ins crept into the engine
- [ ] Type-only imports are marked `type`; no enums/namespaces/param properties
- [ ] Anything defined-but-unconsumed is labeled STAGED or UNWIRED
- [ ] My diff contains zero out-of-scope "improvements"

### The completion report (exact format)
```
TASK: <one line>
SCOPE DECLARED: <files>   SCOPE ACTUAL: <files>   (explain any difference)
TIER: <docs-only | refactor | mechanics | consumer>

FINGERPRINT BEFORE: <events> events, <final score>, tests <t/p/f/todo>
FINGERPRINT AFTER:  <events> events, <final score>, tests <t/p/f/todo>
<verification ladder outputs for the tier, pasted>

WHAT I DID: <3-8 bullets, mapped to the recipe steps>
DEVIATIONS FROM BRIEF: <or "none">
COULD NOT DETERMINE: <honest list, or "nothing">
OUT-OF-SCOPE FINDINGS: <bugs/oddities noticed, NOT fixed>
```

---

## Part 4 — For dispatchers: the task-briefing template

Brief quality is a primary determinant of multi-agent output quality: a lower-capability
agent with a well-specified brief typically outperforms a higher-capability agent with
an underspecified one. Template (use verbatim):

```
REPO: /path/to/hoopsh — read AGENTS.md and docs/PLAYBOOK.md before anything else.
TASK: <one concrete outcome, one sentence>
RECIPE: <A-G from PLAYBOOK Part 2>   EXEMPLAR: <file/function to pattern-match>
SCOPE (only these files): <list>
OUT OF SCOPE (do not touch, even to fix): <list or "everything else">
TIER: <from AGENTS.md §4.3> — verification commands you must run and paste: <list>
FROZEN FINGERPRINT (captured at dispatch time): <events / final / test counts>
  ⚠ Dispatcher: capture this AFTER your last code change, immediately before
  dispatch. Incident: a stale fingerprint sent an agent chasing a phantom
  regression.
ACCEPTANCE CRITERIA: <bulleted, checkable>
AUTHORIZED: <recalibration? new params? new tests? — explicit yes/no each>
REPORT: use PLAYBOOK Part 3's completion-report format.
```

Dispatcher rules:
- **Freeze the code while agents work.** No commits to in-scope areas mid-task.
- One agent per file region — never two agents with overlapping scopes.
- Review the agent's diff yourself before committing; the report is a claim,
  the diff is the evidence.
- Weak agents get Recipe-shaped tasks. If a task doesn't fit a recipe, it isn't
  ready to delegate — decompose it until its pieces are.


---
---

<!-- ================= SOURCE: docs/ONBOARDING.md ================= -->

# Onboarding — a two-evening path

This is the guided path. The other documents state *what's true*; this file states
*the order to learn it in*, with checkpoints to verify retention.

---

## Evening 1 — understand what it is, watch it work (~2-3 hours)

**1. Read, in order** (~50 min):
- `README.md` — what hoopsh is, the zero-dependency quickstart
- `ARCHITECTURE.md` — the hybrid spatial–stochastic bet, why it's calibratable
- `docs/INTERNALS.md` — tick pipeline, module map, the two time axes
- `AGENTS.md` — the rules you'll work under

**2. Run everything** (~20 min):
```bash
npm run sim -- --seed my-first-game     # box score + play-by-play in the console
npm test                                # 50 tests: invariants, realism guard, archetypes
npm run batch -- --games 24             # the 16-band NBA realism report
npm run bench                           # ~6 games/sec
```
Open `packages/viewer/index.html` in a browser, drag `out/replay-my-first-game.json`
onto it, press space. Watch a full possession. Scrub around a free throw.

**3. Read the two contracts** (~45 min):
- `packages/engine/src/core/events.ts` — every event type and its invariants;
  this is what every consumer sees.
- `packages/engine/src/sim/params.ts` — read the header primer carefully
  (logit table, units, provenance tags), then skim the annotated defaults.

**Checkpoint 1** — answer without looking:
- Why are there two time axes, and which one do stats use?
- What does `SWEPT` provenance mean, and why must you not round those values?
- Which package is allowed to import which?

---

## Evening 2 — trace the machine, then touch it safely (~2-3 hours)

**1. The guided possession trace** (~60 min). Open these files side by side and
follow one possession end to end:

1. **A possession begins** — `sim/possession.ts#startPossession`: shot clock reset,
   spots assigned (`ai.ts#assignSpots` — best handler top, shooters to the wings by
   gravity, non-shooter to the dunker spot), matchups assigned, stale timers cleared.
2. **The clock ticks** — `sim/game.ts#tick` → `tickLive`: wall clock first, then
   `movement.ts#advanceClock` (game clock; the ONLY place `t` moves), flight
   resolution, shot-clock check, period-expiry check.
3. **The handler thinks** — `ai.ts#decideBall` every ~0.66s: computes the
   **continuation value** (what "keep working" is worth), then utilities for
   shoot / drive / pass(×4) / hold — all in expected points — and softmaxes.
   This is the engine's central decision function.
4. **A pass** — `passing.ts#startPass`: risk resolved AT LAUNCH (determinism),
   flight animated, `resolvePassArrival` hands the ball over and opens the
   0.12s catch-and-shoot window.
5. **A shot** — `game.ts#executeAction` starts the **windup** (`pendingRelease`),
   defenders close out for ~0.4-0.55s, then `shooting.ts#startShot` measures the
   REAL contest at release, rolls make/block/foul, and lofts the ball.
   `resolveShotOutcome` lands it: score, and-one FTs, or a rebound scramble.
6. **The rebound** — `possession.ts#enterScramble` → `tickScramble` →
   `resolve.ts#resolveRebound`: proximity-dominant weighted lottery, offense
   discounted (`reb.offWeightMult`), putback chance at the rim.
7. **The books** — `stats/box.ts` folds the event stream: exact minutes from
   lineup timelines, plus-minus from score deltas, possessions from
   `possession_end` (which fires exactly once — see the `poss.ended` guard).

Keep the viewer open on the same seed while tracing: the windup pause before a shot,
the closeout sprint, and the scramble are all visible in the replay.

**2. Read the emergence machinery** (~30 min):
`resolve.ts#gravity` (why shooters warp defenses) → `ai.ts#defenseTick` (gap,
sag, help selection) → `ai.ts#pnrTick` (screens as thin scaffolding). Then re-read
`ARCHITECTURE.md §5` with the traced possession as context.

**3. First-change exercises** (~45 min, pick one, throwaway — do not commit):
- **Safe**: In `params.ts`, set `decide.threeAppetite: 0.5` via an override in a
  scratch script (`simulateGame({ params: { decide: { threeAppetite: 0.5 } } })`)
  and run 10 games. Observe the 3PA share drop in the box scores; no revert needed,
  since the file itself was never touched.
- **Safer**: Write a 10-line consumer: count screen-adjacent pull-up threes from the
  event stream of 20 games. Exercises the event contract directly.
- **Advanced**: Follow AGENTS.md §4 end-to-end for a real one-knob change
  (e.g. `reb.putbackChance` +0.05): fingerprint → change → `npm test` → batch →
  revert. The objective is familiarity with the verification procedure.

**Checkpoint 2** — Competency criteria:
- Explain how drive-and-kick emerges without a script (three mechanisms).
- State exactly what happens to `possession_end` on an and-one.
- Name the file to edit to change what a 90 `speed` rating means, and the file
  to edit to make players *want* to shoot earlier.
- State the verification tier of the change being made.

---

## The map when you're lost

| Question | Answer lives in |
|---|---|
| "Which document do I even need?" | `docs/README.md` (the library hub) |
| "What is this project?" | `README.md`, `ARCHITECTURE.md` |
| "Where is X / where do I change Y?" | `docs/INTERNALS.md` |
| "Am I allowed to do this?" | `AGENTS.md` |
| "HOW do I build this new thing?" | `docs/PLAYBOOK.md` (recipes + step-by-step process) |
| "What does this number mean?" | The comment next to it (if missing: that's a docs bug — fix it) |
| "What can consumers rely on?" | `core/events.ts` |
| "Why is the league average what it is?" | `sim/params.ts` header + `harness/src/bands.ts` |
