<!-- ============================================================
  GENERATED FILE — DO NOT EDIT.
  This is the hoopsh Bible: all eight source documents compiled in canonical
  reading order. Edit the sources, then regenerate: npm run docs:bible
  Sources (in order): README.md · ARCHITECTURE.md · docs/INTERNALS.md · AGENTS.md · docs/PLAYBOOK.md · docs/ROSTERS.md · docs/SEASON.md · docs/ONBOARDING.md
============================================================ -->

# 📖 The hoopsh Bible — everything, one file

> Generated from the eight source documents. If this file and a source document
> disagree, the source is right and this file is stale — regenerate it.

## Contents
1. **README.md**
2. **ARCHITECTURE.md**
3. **docs/INTERNALS.md**
4. **AGENTS.md**
5. **docs/PLAYBOOK.md**
6. **docs/ROSTERS.md**
7. **docs/SEASON.md**
8. **docs/ONBOARDING.md**



---
---

<!-- ================= SOURCE: README.md ================= -->

# hoopsh

*A modular, deterministic, 2D-spatial basketball simulation core.*

Ten agents move on a real court at 10 ticks per second — spacing, drives, kick-outs, cuts,
closeouts, help rotations, box-outs. Discrete outcomes (shots, passes, fouls, rebounds)
resolve through **probability models fed by spatial context, calibrated against
author-recalled NBA ranges** — honesty note: the acceptance BANDS are still
authored from memory, not generated from sourced data (the game-flow references
in `data/nba/flow-reference.json` ARE corpus-derived — 184 parsed real games);
grounding the bands in citable data (and fitting to distributions, not means)
remains the active roadmap arc. Games
follow basketball rules and season-scale statistics fall inside those ranges. Every point
in a box score traces back to a simulated shot at an (x, y) location — a
2D probability model with position as an input, not a physics sim (there is
no ball height; see docs/INTERNALS.md known simplifications for the full
honest list).

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
npm run bench                    # games/sec benchmark (budget: ≥1; hardware-dependent, ~3-6 typical)
npm run test                     # full suite via node:test (zero installs)
npm run broadcast                # two-voice broadcast script for a game

npm run roster:new               # scaffold your own team from archetypes (wizard)
npm run roster:validate -- t.json  # human-grade pack linting: fixes + plausibility warnings
npm run sim -- --home t.json     # ...and watch your team play (docs/ROSTERS.md is the guide)

npm run season -- --teams 8      # deterministic round-robin season + standings (docs/SEASON.md)
npm run season -- --matchup 0,3 --sims 200   # Monte-Carlo one fixture: win prob + CI
```

Optional dev tooling (`typescript`, `vitest`, `tsx`, `@types/node`) is
declared in `devDependencies` so one plain `npm install` reproduces the full
dev environment (`npm run typecheck`, `npm run test:vitest`) — but nothing at
runtime requires it; every command above works on a bare clone.
Note for readers of the test files: they import from `'vitest'`, which is NOT
installed — `tools/hooks.mjs` resolves that specifier to a `node:test`-backed
shim (`tools/shims/vitest.ts`), so `npm test` runs the whole suite with zero
dependencies. Installing real vitest simply takes over via `test:vitest`.

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
Input contract: `simulateGame` always rejects non-finite ratings loudly; pass
`validate: 'strict'` to also enforce the data-pack ranges (ratings 0-100) when
rosters come from untrusted sources — the default tier deliberately admits
out-of-range finite values for custom content and stress tests.

**All documentation → [docs/README.md](./docs/README.md)** (the library hub: every
document, reading paths by role, which doc answers which question). The short list:
[ARCHITECTURE.md](./ARCHITECTURE.md) (design) · [docs/INTERNALS.md](./docs/INTERNALS.md)
(module map) · [AGENTS.md](./AGENTS.md) (**contributor covenant**) ·
[docs/PLAYBOOK.md](./docs/PLAYBOOK.md) (build procedure) ·
[docs/ONBOARDING.md](./docs/ONBOARDING.md) (learning path) ·
[docs/BIBLE.md](./docs/BIBLE.md) (everything compiled into one generated file)

## The core bet: hybrid spatial–stochastic simulation

Pure physics sims are hard to calibrate; pure stat sims have no feel. hoopsh runs
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

A batch harness grades league-wide averages against the NBA acceptance bands
in `harness/src/bands.ts` (pace, efficiency, shot mix, rebounding, fouls,
turnovers, assisted share…), and an automated parameter sweep
(`npm run sweep`) re-centers them after mechanics changes. **No static pass
rate is quoted here on purpose — quoted numbers rot.** Measure the current
state yourself: `npm run batch -- --games 40` for one seed base,
`npm run sweep -- --iters 0 --verify 40` for three, `npm run oos` for rosters
the sweep has never seen (plus a distributional report the means can't
capture). Residual misses and open calibration findings are recorded in
`docs/INTERNALS.md`, not hidden. The test suite — including a permanent
invariant suite derived from adversarial audit rounds and an adversarial-
input fixture — guards determinism, possession accounting, minutes
conservation, and buzzer integrity on every change (`npm test` prints the
live count). Archetype tests pin player differentiation
(elite shooter ≈ 25 pts on ~20 FGA with a deep-three diet; rim-runner takes 90%+
of shots inside; non-shooting bigs do not take low-value shots).

Run it yourself: `npm run batch -- --games 50`.

## Roadmap

**Done:** replay viewer · broadcast demo · automated parameter sweep ·
orchestrator refactor · pick-and-roll · post-up game · dribble-handoff · isolation ·
usage hierarchy & re-initiation (floor generals lead their teams in assists) ·
invariant suite · full documentation campaign (contributor covenant, onboarding path) ·
real-game corpus (184 parsed NBA games) grounding the flow references ·
worker-pool parallel runner (determinism across worker counts tested) ·
roster tooling (schema gen, scaffold wizard, validator, stats→ratings fitter) ·
stateless season driver + Monte-Carlo matchups (docs/SEASON.md) ·
endgame layer (timeouts, intentional fouling, hold-for-last, two-for-one, clock
burn) — default ON since the calib/integration landing, decided on measured
survey evidence (`endgame: false` = the byte-identical legacy path) ·
NCAA rule pack behind the harness `--league` flag (partially wired — see
REFACTOR.md's register)

**Phase 2R (current — tuning, not building):** the mechanics above are implemented
and wired. The coordinated re-sweep of the integrated engine and the endgame-flag
decision both landed at the calib/integration landing (first full 17/17 band
lock); the open work is the B2 mechanism items (score-pressure coupling,
garbage-time rotation, pass volume), fidelity residuals (hub post-up share), and
the open items in REFACTOR.md's register.

**Next (validation arc):** mechanism audit of the distributional misses ·
30-roster league fitting off the corpus · Turing round 2 (n≥60, late-game
windows) · prediction backtest (Brier, calibration curves) via the season layer ·
sourced NBA data in-repo with provenance, bands/targets generated not typed ·
distribution-level fitting with a held-out season the solver never sees.

**Beyond:** cross-game season state (fatigue carryover, injuries — the seams are
documented in docs/SEASON.md) · progression & aging · EuroLeague rule pack +
NCAA calibration · era packs (1995 vs 2015 shot diets) · deep player editor UI ·
GM & MyPlayer experiences · defensive schemes · broadcast TTS audio · WASM hot
path if the perf budget ever demands it.

## License

MIT — see [LICENSE](LICENSE).


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

Pure physics sims are hard to calibrate; pure stat sims have no feel. hoopsh runs a
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
  harness/     batch runner, acceptance bands, benchmarks, calibration tools,
               season/matchup driver, stats→ratings fitter (docs/SEASON.md,
               docs/ROSTERS.md)
  viewer/      single-file 2D canvas replay viewer (working prototype; frozen)
```

Dependency rule: `engine` imports nothing. Everything else imports `engine`.
Experiences (GM, MyPlayer, editor UI) will live outside these packages and speak to the
engine only through its public API: `simulateGame(config) → GameResult` (`{ seed, events, finalScore, frames, rules, params, teams }`; a `Replay` is assembled separately from that result via `buildReplay`).

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
rules. NBA ships first. An NCAA pack exists and is selectable through the
harness `--league` flag (rule pack + bands + pace basis travel together);
its rule coverage is partial — unwired fields are labeled in
`rules/rulepack.ts` and registered in REFACTOR.md. EuroLeague is a
follow-up. Custom leagues are just JSON.

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
- Endgame management (timeouts, intentional fouling, hold-for-last, two-for-one,
  clock burn) is a layer that modulates the same EV framework rather than
  scripting plays (`GameConfig.endgame`). It defaults ON: the decision was
  measured, not assumed — an n=1260-games-per-arm flag-on survey showed the
  layer moving OT share, clutch free-throw texture, and comeback rates toward
  cited NBA rates with every invariant probe green — and `endgame: false`
  preserves the byte-identical legacy path. Its magnitude dials sit on the
  calibration sweep surface like any other `SimParams` constants; its
  window/threshold dials are design, not calibration, and stay off it.

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

cross-game season state (the stateless season driver exists — docs/SEASON.md
records the seams; fatigue carryover, injuries, home-court are the missing
pieces) → progression/aging → EuroLeague rule pack + NCAA calibration → era
packs → deep editor UI → GM & MyPlayer experiences → defensive schemes →
broadcast audio → possible WASM core.


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
   optimizer chose it against the 17 acceptance-band checks (bands.ts NBA_BANDS). Rounding it de-calibrates the
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
| What a player decides to do | `sim/ai/` (utilities; `ai.ts` is the barrel) |
| Whether an attempt succeeds | `sim/resolve.ts` (probability models) |
| A tunable constant | `sim/params.ts` (+ `harness/knobs.ts` range) |
| Phase flow / possession lifecycle | `sim/possession.ts`, dispatched from `sim/game.ts` |
| What consumers can see | `core/events.ts` (the contract) + `replay/` |
| What a rating means physically | `model/derived.ts` (curves) |
| League rules | `rules/rulepack.ts` (data, not code) |
| Late-game management (default ON; `endgame: false` = legacy path) | `sim/endgame.ts` + concept 6 in `sim/ai/concepts.ts` |
| Stat math | `stats/` — pure event folding |
| Realism measurement / tuning | `harness/` |
| Multi-game runs (seasons, matchup Monte-Carlo) | `harness/` season layer — see `docs/SEASON.md` |
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
npm test                        # full suite: invariants + fidelity gate — ALWAYS, every change
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
- The NBA bands (`harness/src/bands.ts`) are the gate — count them there, never
  from memory (the list grows). The noise floor is MEASURED, not guessed:
  `npm run noisefloor` samples every gated statistic across independent seed
  bases at the gates' sample sizes and writes `noise-floor.gen.ts`; the
  permanent gates derive their widths from it (edge ± z·sd, z=3), so a gate
  failure means "the sim changed", not "the seed changed". "Locked" means:
  at 40+ games, every band's measured CENTER sits inside its band. A center
  sitting on or outside an edge is a systematic finding for INTERNALS even
  while the z-gate passes. Never adjudicate anything from one or two draws —
  that is chasing noise (measure more bases instead); never hand-nudge what
  the sweep owns; never quote a stale pass-rate in docs — state where to
  measure it instead. Regenerate the floor after mechanics changes: its diff
  is the drift record.
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
2. The consumer — `sim/resolve.ts` (resolution) or `sim/ai/` (decision), through
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
screener branch + drive bonus in `sim/ai/`, drop coverage in `defenseTick`,
`ai.pnr*` params block.
1. `sim/state.ts` — action type on `Possession.action` (extend the union), fields
   for phase/until/actors.
2. `sim/possession.ts#startPossession` — ensure the action resets (`action: null`
   is already there; new per-agent timers must be cleared in the stale-timer block).
3. `sim/ai/actions.ts` — a lifecycle function (trigger conditions, phase transitions,
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

<!-- ================= SOURCE: docs/ROSTERS.md ================= -->

# Writing rosters — the authoring guide

How to put a real (or invented) team into hoopsh: scaffold a pack, understand
the 38 dials, edit with live editor feedback, validate, and watch it play.

This guide teaches the *model* — what the numbers mean in basketball terms and
how they interact. The per-dial ground truth lives in
[`packages/engine/src/model/player.ts`](../packages/engine/src/model/player.ts)
(every key is commented with what it drives and where), and those same comments
are surfaced as hover text in your editor via the generated JSON Schema, so you
rarely need to leave the file you're editing. When this guide and a fresher
code comment disagree, the code comment wins — that's repo law
([`docs/README.md`](./README.md)).

## The loop

```bash
npm run roster:new                                # wizard — Enter accepts every default
npm run roster:new -- --list                      # browse the 11 archetypes first
# ...edit the ratings in your editor (autocomplete + inline errors via $schema)...
npm run roster:validate -- my-team.team.json      # errors with fixes + plausibility warnings
npm run sim -- --home my-team.team.json           # play it (vs the built-in matchup's away team)
npm run sim -- --home my-team.team.json --away packages/data/rosters/monarchs.team.json --seed x1
```

Scripted scaffolding (no prompts):

```bash
npm run roster:new -- --name "Oak City Owls" --abbrev OWL --size 12 \
  --slots floorGeneral,scoringWing,threeAndD,glueForward,rimRunner,comboGuard,benchScorer,benchBig \
  --pace 62 --three-bias 58 --out owls.team.json
```

Start from the scaffold even when transcribing a real NBA roster: pick the
archetype closest to each player and adjust dials away from a profile whose 38
numbers already agree with each other. Typing 38 raw numbers from scratch
produces incoherent players (an 85 `three` with a 5 `shotThree` never shoots);
editing a coherent one produces variations.

## Editor setup

Scaffolded packs begin with a `"$schema"` line pointing (relatively) at
[`data/schema/team-pack.schema.json`](../data/schema/team-pack.schema.json).
Any JSON-Schema-aware editor (VS Code out of the box) then gives you:

- autocomplete for every key, including all 24 attributes and 14 tendencies
- inline squiggles for out-of-range ratings, wrong types, missing keys, and
  unknown keys (typos get flagged *at the typo*)
- hover documentation per dial, extracted from `model/player.ts`

For a hand-started file, add the line yourself (path relative to *your* file):

```jsonc
{ "$schema": "../../data/schema/team-pack.schema.json", "formatVersion": 2, "kind": "team", ... }
```

The schema is **generated** — `npm run schema:gen` derives it from the same
constants `validateTeamPack()` enforces (`packages/data/src/schema.ts`), so it
cannot drift from the loader. Two rules JSON Schema cannot express are only
checked at load time: player-id uniqueness, and starters/rotationMinutes
referring to real roster ids. Editor-green is necessary, `roster:validate`
is sufficient.

## Pack anatomy

```jsonc
{
  "$schema": "../../data/schema/team-pack.schema.json",
  "formatVersion": 2,          // exact match required; v2 added tend.usage
  "kind": "team",
  "team": {
    "id": "owls", "name": "Oak City Owls", "abbrev": "OWL",
    "tactics": { "pace": 62, "threeBias": 58, "helpAggr": 50 },  // required — team style dials
    "players": [ /* >= 8 players, each with all 38 ratings — see below */ ],
    "starters": [ "owls-p01", "owls-p02", "owls-p03", "owls-p04", "owls-p05" ],  // exactly 5 distinct ids
    "rotationMinutes": { "owls-p01": 36 }   // optional coach targets; omit to sub on fatigue alone
  }
}
```

Each player: `id`, `name`, `pos` (PG/SG/SF/PF/C — descriptive; matchups are
assigned by body and skill), `heightIn` (60–96 **inches**: 6'7" = 79),
`weightLb` (pounds), optional `wingspanIn` (engine assumes height + 2 when
absent), then `attr` (24 keys) and `tend` (14 keys). Validation is strict and
total: a pack either satisfies everything or is rejected with the complete
issue list — no silent defaults, ever (`schema.ts` header explains why).

## How the ratings work

**Everything is 0–100.** For *attributes*, 50 is a literal league-average
no-op: a 50 contributes exactly nothing to any probability model
(`model/player.ts` DEFAULT_ATTR comment). You only pay for what you push away
from 50, in either direction.

**Attributes are CAN, tendencies are WANT.** `three` is how well he shoots
threes; `shotThree` is how badly he wants to. Identity comes from the
combination under spatial context: elite `three` + heavy `shotThree`/`pullUp` +
high `offBallMotion` doesn't just score, it creates *gravity* that warps how
defenses guard him (gravity blends the skill and the appetite — a career 40%
shooter who never shoots doesn't scare anyone).

**Shot-diet tendencies are relative weights, not percentages.**
`shotRim`/`shotMid`/`shotThree` bias the AI's shot decisions against each
other. Calibrated rosters sum roughly 99–158 across the three; what matters is
the *ratio* (a 96/5/1 center virtually never leaves the restricted area).

**`usage` is a closed loop, mapped to real USG%.** 50 ≈ 20% (league average),
90 ≈ 30% (superstar), 10 ≈ 10% (screener). The engine continuously compares
the target to the realized share: an under-fed star hunts, an over-fed one
defers. Handy inversion when transcribing a real player:
`usage ≈ 4 × (USG% − 7.5)` — e.g. 25% USG → 70. The mapping is approximate and
compresses above ~30% USG; 90+ is "the offense runs through him", don't
chase decimals. Usage is deliberately orthogonal to skill — a deferential
genius and a low-skill chucker are both expressible, and `roster:validate`
will not second-guess that combination.

**Two dials are staged, honestly.** `consistency` (hot/cold variance) and
`pushPace`/team `pace` are read by staged systems documented in
[`docs/INTERNALS.md`](./INTERNALS.md); set them plausibly anyway so packs
don't need editing when the stages land.

Rough anchors, taken from the archetype file (`packages/data/src/archetypes.ts`
— the calibrated reference points for what numbers *mean*): 99 = the
unambiguous best in any roster (eliteShooter's `three`), 90 = elite/defining
skill, 80 = legitimate weapon, 70 = plus starter, 60 = solid, 50 = average,
below 40 = real weakness opponents attack, teens = non-factor
(rimRunner's `three: 12` is "don't even close out").

Quick physical mappings: `heightIn` = feet×12+inches (6'0"=72, 6'6"=78,
7'0"=84); `freeThrow` ≈ FT% as points (0.84 shooter → 84).

## The archetype catalog

Eleven builders in [`packages/data/src/archetypes.ts`](../packages/data/src/archetypes.ts),
each a coherent, test-anchored profile (the archetype suite asserts an "elite
shooter" actually *behaves* like one at season scale). Numbers live there —
run `npm run roster:new -- --list` for a live view with each archetype's top
skills derived from the current source.

| archetype | body | the player it approximates | signature dials |
|---|---|---|---|
| `floorGeneral` | PG 6'4" | pass-first table-setter, paint-to-kick | passVision 98, passAcc 97, decisions 95 |
| `eliteShooter` | PG 6'2" | off-movement three-point assassin | three 99, offBallMotion 90, pullUp 82 |
| `scoringWing` | SG 6'6" | three-level bucket-getter | finishing 88, drawFoul 82, iso 78 |
| `threeAndD` | SF 6'7" | corner spacer, point-of-attack stopper | perimeterD 90, three 82, pullUp 12 |
| `comboGuard` | SG 6'4" | steady no-weakness rotation guard | everything 60s–70s, no hole |
| `glueForward` | PF 6'8" | does a little of everything | perimeterD 70 + interiorD 72, three 58 |
| `postAnchor` | PF 6'10" | back-to-basket bruiser, soft touch | strength 90, post 78, midRange 74 |
| `stretchBig` | C 7'0" | floor-spacing modern center | three 76, shotThree 78, interiorD 84 |
| `rimRunner` | C 7'0" | lob-catching, glass-eating rim protector | finishing 94, offReb 92, block 90 |
| `benchScorer` | SG 6'5" | microwave sixth man | pullUp 68, three 78, decisions 54 (the trade-off) |
| `benchBig` | C 6'11" | energy reserve big | boxout 82, block 78, three 8 |

Contrasts are deliberate and worth studying before you edit: eliteShooter vs
threeAndD is *self-created* vs *spot-up* threes (pullUp 82 vs 12); rimRunner vs
postAnchor is *above-the-rim* vs *back-to-basket* (midRange 28 vs 74);
rimRunner vs benchBig is the same shape a tier apart.

## Worked example — a real-ish player

A downhill, foul-drawing star lead guard — the SGA/Harden shape: lives in the
lane and at the line, good-not-elite three, high usage, real playmaking, solid
but not lockdown defense. Closest archetype: `scoringWing` (self-creation,
drawFoul), reshaped toward a guard.

Reasoning per group, then the JSON:

- **Body/physical**: 6'6" guard → `heightIn: 78`, `weightLb: 200`. First-step
  burst is the weapon: `speed 88`, `accel 92`, `lateral 74` (good, not elite,
  defensively).
- **Scoring**: `finishing 92` (craft at the rim), `midRange 90` (the pull-up
  middy is the counter), `three 74` (respectable, not the identity),
  `freeThrow 88` (≈ .88 shooter), `drawFoul 95` — the defining skill, lives at
  the line.
- **Playmaking**: `ballHandle 94` (the whole game starts from the handle),
  `passAcc 80`, `passVision 82` — a scorer who makes the right kickout, not a
  floorGeneral.
- **Defense/glass**: `perimeterD 72`, `steal 74` (active hands), `interiorD 40`,
  `block 45` (guard-sized), rebounding 30s–50s.
- **Mental**: `decisions 84`, `consistency 82` — stars deliver most nights.
- **Tendencies**: shot diet rim-first, mid-heavy, three-light for a star guard:
  `shotRim 70 / shotMid 55 / shotThree 35` (sum 160, just above the calibrated
  band — a high-volume creator). `pullUp 72`, `drive 85` (downhill constantly),
  `iso 65`, `passOut 55`, `post 8`. Off ball he rests: `offBallMotion 40`,
  `crashOffReb 10`. `gambleSteal 55`, `foulAggr 30`. Usage: ~32% USG →
  `4 × (32 − 7.5) = 98` → clamp the ambition to `92` (the loop compresses up
  there anyway).

```json
{
  "id": "owls-p01", "name": "Dex Calloway", "pos": "PG",
  "heightIn": 78, "weightLb": 200,
  "attr": {
    "speed": 88, "accel": 92, "strength": 64, "vertical": 74, "lateral": 74, "stamina": 86,
    "finishing": 92, "midRange": 90, "three": 74, "freeThrow": 88, "drawFoul": 95,
    "ballHandle": 94, "passAcc": 80, "passVision": 82,
    "perimeterD": 72, "interiorD": 40, "steal": 74, "block": 45, "contestSkill": 58,
    "offReb": 25, "defReb": 50, "boxout": 32,
    "decisions": 84, "consistency": 82
  },
  "tend": {
    "shotRim": 70, "shotMid": 55, "shotThree": 35, "pullUp": 72,
    "drive": 85, "passOut": 55, "iso": 65, "post": 8,
    "offBallMotion": 40, "crashOffReb": 10,
    "gambleSteal": 55, "foulAggr": 30, "pushPace": 58, "usage": 92
  }
}
```

Sanity-check the *interactions* before moving on: high `drive` + `drawFoul 95`
+ `finishing 92` is the trips-to-the-line engine; `shotThree 35` + `three 74`
still projects enough gravity that defenses can't fully duck under; `usage 92`
with `decisions 84` is a star who carries efficiently rather than a chucker.

## Validate, then watch it play

```bash
npm run roster:validate -- owls.team.json            # exit 0 = loads
npm run roster:validate -- owls.team.json --strict   # warnings fail too (CI-friendly)
npm run roster:validate -- owls.team.json --json     # machine-readable report
```

Errors show the JSONPath, your value, the legal range, and a concrete fix
(quoted numbers, centimeter heights, and typo'd starter ids are recognized and
answered specifically). Errors are exactly `validateTeamPack()`'s verdicts —
the CLI never adds or hides a rejection.

**Warnings are advisory basketball judgment** — the pack loads; the numbers
just don't resemble any known-good roster. Each states its reasoning so you
can overrule it knowingly (a tanking squad may proudly ship `no-plus-skill`):

| code | fires when | the basketball reason |
|---|---|---|
| `flat-profile` | a player's 24 attributes are all identical | identity comes from contrast; flat = anonymous |
| `no-plus-skill` | nobody on the roster has any attribute ≥ 70 | no one can win a matchup — scrimmage ball |
| `uniform-elite` | every rating on the roster ≥ 85 | flatness in reverse; nothing differentiates styles |
| `no-rim-protection` | no starter with interiorD or block ≥ 65 | 5-out with no deterrent = layup line |
| `no-initiator` | no starter with ballHandle ≥ 65 | nobody can start offense; turnovers spiral |
| `shot-diet` | rim+mid+three appetite < 60 or > 240 | refuses every shot / drowns pass-drive channels |
| `duplicate-names` | two players share a display name | box scores and PBP become unreadable |
| `usage-overload` / `usage-vacuum` | starting-five usage mean > 62 / < 38 | one ball; 5×50 ≈ 100% of possessions |
| `rotation-*` | unknown id / target > 48 min / targets > 245 total | silently ignored or unsatisfiable coach targets |

Then play one game and read it like a scout, not a fan:

```bash
npm run sim -- --home owls.team.json --seed owls-1   # deterministic: same seed, same game
```

Check that the box score matches the story you wrote: does your usage-92 guard
lead the team in FGA and FTA? Does the rimRunner's line look like dunks and
boards (high FG%, no threes)? Is the team's three-point volume consistent with
your `threeBias` and shooters? One game is one sample — re-run with a few seeds
before concluding a dial is wrong, and see `npm run batch` if you want
band-graded aggregates.

## Troubleshooting

| symptom | cause / fix |
|---|---|
| `$.formatVersion: expected 2` + many `tend.usage` errors | v1-era pack; add `"usage": 50` per player, set formatVersion 2 (the CLI prints this migration note) |
| `heightIn must be a finite number 60-96`, value ~180–220 | centimeters — divide by 2.54 (the CLI computes it for you) |
| `rating must be 0-100`, current `"88"` | quoted number; ratings are bare JSON numbers |
| `starter X not on roster` | id typo — the CLI suggests the closest roster id |
| editor shows no autocomplete | missing/wrong `"$schema"` relative path; regenerate with `npm run schema:gen` if the file moved |
| pack valid but plays nothing like intended | re-read *CAN vs WANT* above — skill without the matching tendency (or vice versa) is the usual culprit |

## How this stays honest

The schema, the scaffold menu, and the validator share one source of truth:
`packages/data/src/schema.ts` exports the key lists and ranges, `schema:gen`
derives the JSON Schema from them, hover docs are extracted from
`model/player.ts`, and the archetype menu is discovery-tested against
`@hoopsh/data`'s exports. Tests ratchet all of it: the committed schema must
match regeneration byte-for-byte, must accept the shipped rosters, must reject
canonical breakage, and the warning heuristics must stay silent on every
known-good roster. If you add a rating to the engine, the suite will walk you
through every surface that needs to hear about it — including this doc's
companion hover text, which regenerates for free.


---
---

<!-- ================= SOURCE: docs/SEASON.md ================= -->

# SEASON.md — the season layer

The multi-game substrate on top of the single-game engine: schedules,
deterministic season driving, standings, and a Monte-Carlo matchup API.
Everything here is **harness-layer** (`packages/harness/src/season.ts`,
`matchup.ts`, `league.ts`); the engine is consumed strictly through its
public API and was not modified.

```
npm run season -- --teams 8 --seed 2026            # double round-robin, standings table
npm run season -- --teams 8 --rounds 1             # single round-robin
npm run season -- --teams 8 --games 40             # cap/extend the schedule
npm run season -- --teams 4 --seed proof --json    # byte-stable JSON (pipe to sha256sum)
npm run season -- --matchup 0,3 --sims 200         # Monte-Carlo one fixture
```

## API

- **`roundRobin(teamIds, rounds=2)`** → `ScheduledGame[]` (`{home, away, date?}`).
  Circle method; odd league sizes get a bye per round. Venue assignment keeps
  every team's single-cycle |home − away| ≤ 1 (≤ 2 with byes), and odd cycles
  mirror even ones so a double round-robin gives every pair exactly one game
  in each building. `date` is the round label `"r<k>"`; games sharing a label
  share no team (see "parallelism" below for why that matters).
- **`runSeason({teams, schedule?, seedBase?, simulate?, onGame?})`** →
  `{schedule, outcomes, standings}`. Accepts any explicit fixture list (a
  real league's schedule imports as `{home, away, date}` rows) or defaults to
  a double round-robin.
- **`computeStandings(outcomes, teamIds?)`** — pure fold, exported separately
  so standings can be recomputed from stored outcomes without re-simulating.
- **`simulateMatchup(home, away, n, opts?)`** → `MatchupDistribution` (below).
- **`makeLeague(n, seed)`** — deterministic fictional league for the CLI and
  tests; `scaleTeam` / `cloneTeamWithIds` build "same team but stronger" and
  "team vs itself" fixtures. These are tooling, NOT calibration rosters — the
  two `@hoopsh/data` teams keep that job.

## Determinism

A season is a pure function of `(seedBase, schedule, rosters)`. Game `i`
against the schedule gets seed `gameSeed(base, i, homeId, awayId)` =
`` `${base}:g${i}:${away}@${home}` `` — schedule position is in the seed, so
same seed base ⇒ the same season, byte for byte; and because the matchup ids
are in the seed too, editing unrelated schedule entries doesn't perturb games
that didn't move. Proof (run it yourself — the two hashes match, the third
differs):

```
$ npm run season --silent -- --teams 4 --rounds 1 --seed proof --json | sha256sum
c43ad6f0d1405fb64281844732e9631323a788b71b257cd35c4913fd6cc67131
$ npm run season --silent -- --teams 4 --rounds 1 --seed proof --json | sha256sum
c43ad6f0d1405fb64281844732e9631323a788b71b257cd35c4913fd6cc67131
$ npm run season --silent -- --teams 4 --rounds 1 --seed other --json | sha256sum
4b26463a9f8f2784edc9dc09e188b08c2834f18ec81fe1081dbf6b5a009e96b5
```

## Standings definitions (so nobody re-derives them differently)

- **W/L, venue splits, point differential**: integer sums; league-wide
  Σdiff = 0 exactly and ΣW = ΣL = games played (tested).
- **Ties cannot happen**: the engine plays overtime until decided
  (`possession.ts#endPeriod`); the standings fold throws on a tied score
  rather than inventing a rule.
- **Season averages**: counting stats are per-game means; ratio stats
  (FG%/3P%/FT%) are **volume-weighted** (Σmakes/Σattempts), matching
  `aggregate.ts`'s convention — never a mean of per-game percentages.
- **SOS**: plain opponents' winning percentage (OWP) — the mean of opponents'
  *final* win% over the team's games, with multiplicity. It does NOT exclude
  games against the team itself from opponents' records, and does not recurse
  into opponents' opponents (RPI-style OOWP). Cheap, standard, and good
  enough to flag unbalanced schedules; upgrade when a consumer needs it.
- **Sort order**: win% desc → point diff desc → team id (a total order, so
  standings are byte-stable even among tied teams).

## Monte-Carlo matchups (`simulateMatchup`)

Returns a **distribution**, not a game: win probability with a **Wilson 95%
CI**, margin mean/median/sample-sd, percentiles (p5/p25/p50/p75/p95), a
binned margin histogram, and per-player stat-line distributions
(min/pts/trb/ast, each with mean/sd/p10/p50/p90). Margins are from the home
team's perspective; ties are impossible, so `P(margin > 0)` *is* the win
probability.

**CI math.** Wilson score interval:
`center = (p̂ + z²/2n)/(1 + z²/n)`, `half = z·√(p̂(1−p̂)/n + z²/4n²)/(1 + z²/n)`,
z = 1.96. Chosen over the naive Wald interval because lopsided matchups push
p̂ toward 0/1, exactly where Wald's coverage collapses and its bounds leave
[0, 1].

**n-sensitivity — how many sims to resolve an edge?** The one-sample binomial
power calculation (`simsToResolveEdge`, 95% confidence / 80% power, two-sided
vs p₀ = 0.5):

| true p | sims needed |
|-------:|------------:|
| 0.52   | ~4,895 |
| 0.55   | **~783** |
| 0.60   | ~194 |
| 0.70   | ~47 |

Equivalently by CI width (worst case p = 0.5, half-width ≈ 0.98/√n):
n = 100 → ±9.8 pp, n = 400 → ±4.9 pp, n = 1600 → ±2.5 pp. **A 55%-vs-50%
edge costs ~783 sims ≈ 4–5 wall-clock minutes single-process at the measured
game cost below** — this is the honest price of small edges, and it is why
the API always reports the CI instead of a bare point estimate.

Measured sanity points (n = 30, seeds pinned in the tests):

- identical rosters (team vs its re-id'd clone): p̂ = 0.467,
  CI [0.302, 0.639] — contains 0.5; mean margin −0.5.
- every attribute +8 vs −8: p̂ = 0.867, CI [0.703, 0.947]; mean margin +19.8.
- equal-team margin sd ≈ **16.4 points** — noticeably above the real NBA's
  ~13–14 for even matchups. Consequence for prediction: the engine maps a
  given true skill gap to a win probability closer to 50% than reality would
  (more game-level noise ⇒ flatter prob curve). Recheck this number after any
  calibration change.

## Measured cost (2-core shared box, Node 24 type-stripping, single process)

| what | measured |
|------|---------|
| one game (calibration rosters) | mean 389 ms, median 345 ms |
| one game (generated league) | mean 317 ms, median 294 ms |
| 30-game double round-robin (6 teams) | ~10 s |
| **1230-game NBA-scale season** | **~6.5–8 min (estimated — do not run casually)** |
| 783-sim matchup (resolve 55/50) | ~4–5 min (estimated) |
| 1000 × full-season Monte-Carlo | ~110–130 h single-core — **needs the parallel runner** |

## Parallelism: a seam, deliberately not an implementation

`wave1/runner` owns worker-pool parallelism. This layer *pre-shapes* the work
for it and does nothing else:

- `runSeason`/`simulateMatchup` build the **complete task list up front**
  (`GameTask[]` — each task carries its seed and both full rosters, closing
  over no season state) and pass it to one `SimulateGames` function:
  `(tasks, onOutcome?) => GameOutcome[] | Promise<GameOutcome[]>`.
- The default is a sequential in-process loop (`simulateTasksSequential`).
  A worker pool drops in by implementing the same signature.
- **Completion order cannot matter**: callers re-sort outcomes by
  `task.index` before computing anything, and the standings fold is
  order-insensitive (tested with a mock seam that completes games in reverse).
- A seam returning the wrong number of outcomes fails loudly.

## THE DECISION: cross-game state is deliberately absent

**Today's model treats every game as strictly independent.** Rosters,
ratings, tendencies, and tactics are identical in game 82 and game 1; the
engine's within-game fatigue resets at the final horn. This is a decision,
not an oversight — it keeps the season layer embarrassingly parallel and
keeps prediction error attributable to the engine rather than to a
half-built carryover model. Nothing below is implemented; this section
records where each piece would attach and what its absence costs.

### What is stateless today

| real-world effect | status |
|---|---|
| home-court advantage | **not modeled at all** (engine is side-symmetric by design; `run.ts --mirror` exists to verify it stays that way) |
| fatigue carryover / back-to-backs | not modeled (fatigue exists within a game, resets between) |
| injuries | not modeled (rosters immortal) |
| rest days / travel | not modeled (`ScheduledGame.date` is carried but unread) |
| form / momentum / lineup changes | not modeled |

### The seams where cross-game state would attach

1. **Schedule metadata** — `ScheduledGame.date` already flows untouched into
   `GameTask.date` and `GameOutcome.date`. Rest days and travel legs are
   derivable from real dates here; the round labels `roundRobin` emits
   (`"r<k>"`) already partition the schedule into no-shared-team waves.
2. **Task construction (`buildTasks`)** — the single choke point where
   rosters enter tasks. A carryover model is a function
   `(team, seasonContextSoFar) => Team` applied per game here: fatigue as an
   attribute/stamina debuff, injuries as roster/starter edits. The engine
   needs no change — it already takes any `Team`.
3. **Per-game params** — `GameConfig.params` (unused by `simulateTask`
   today) is the hook for game-level modifiers that aren't roster edits,
   e.g. a tired-legs shooting penalty.
4. **Outcome feedback** — `GameOutcome.players[].min` already carries the
   per-game minutes an injury/fatigue state machine would consume; the fold
   in `computeStandings` stays pure either way.

### The cost that must be paid when state arrives

Independence is what lets a worker pool run all 1230 tasks concurrently.
Cross-game state creates a dependency chain per team: game g of team T needs
the outcomes of T's earlier games. The schedule's round structure is the
escape hatch — games within a round share no team, so the parallel runner
would process **round-by-round waves** (≈ n/2 games wide) instead of one flat
batch. That is a scheduling change in the runner, not a rewrite of this
layer: tasks would be built per-wave instead of all up front, through the
same `SimulateGames` signature.

### What statelessness costs in prediction accuracy (be honest with consumers)

- **No home-court advantage is the largest systematic bias.** Real NBA home
  teams win ~55–60% of games (≈ +2.5–3 pts); this layer predicts 50/50 for
  equal teams regardless of venue. Any real-world consumer must add HCA
  exogenously today, or every home-team prediction is ~5–10 pp too low.
- **Rest/B2B/travel** effects are worth ~1–2 pts of margin in real data;
  back-to-back-aware bettors systematically beat rest-blind models.
- **Injuries** dominate season-total error in real backtests — a star's
  20-game absence swings win totals by several games; an immortal-roster
  model cannot see it. For the planned simulated-vs-real season backtest,
  expect this to be the single biggest residual.
- **Correlation structure**: with independent games, a simulated team's win
  total is a sum of independent Bernoullis (variance ≤ 82·¼). Real season
  outcomes are positively correlated within a team (injury regimes, trades,
  tanking), so real win totals have FATTER tails — our season-total
  distributions will be over-confident even if per-game probabilities are
  perfect.
- **Engine-level margin noise** (sd ≈ 16.4 vs ~13–14 real) flattens the
  skill→win-probability curve, on top of the effects above.

## Limitations (recap)

- Home/away in `simulateMatchup` is positional, not an advantage (see above).
- Generated leagues (`makeLeague`) are NOT calibrated; realism bands apply to
  the two `@hoopsh/data` rosters only.
- SOS is plain OWP (no self-exclusion, no OOWP recursion).
- `--games` beyond one round-robin cycle tiles additional cycles and slices,
  so a capped schedule can leave pair-counts unequal — fine for smoke runs,
  not for fairness-sensitive experiments.
- Everything is single-process until `wave1/runner` lands behind the seam.


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
npm test                                # full suite: invariants, realism guard, archetypes, fidelity gate
npm run batch -- --games 24             # the NBA realism band report
npm run bench                           # throughput; budget >= 1 game/sec (hardware-dependent, ~3-6 typical)
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
   spots assigned (`ai/offense.ts#assignSpots` — best handler top, shooters to the wings by
   gravity, non-shooter to the dunker spot), matchups assigned, stale timers cleared.
2. **The clock ticks** — `sim/game.ts#tick` → `tickLive`: wall clock first, then
   `movement.ts#advanceClock` (game clock; the ONLY place `t` moves), flight
   resolution, shot-clock check, period-expiry check.
3. **The handler thinks** — `ai/decide.ts#decideBall` every ~0.66s: computes the
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
`resolve.ts#gravity` (why shooters warp defenses) → `ai/defense.ts#defenseTick` (gap,
sag, help selection) → `ai/actions.ts#actionTick` (screens as thin scaffolding). Then re-read
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
