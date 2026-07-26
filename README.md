# hoopsh

*A modular, deterministic, 2D-spatial basketball simulation core.*

Ten agents move on a real court at 10 ticks per second — spacing, drives, kick-outs, cuts,
closeouts, help rotations, box-outs. Discrete outcomes (shots, passes, fouls, rebounds)
resolve through **probability models fed by spatial context, fit to NBA
league aggregates**: games follow
basketball rules and season-scale statistics fall inside real-league ranges. Every point
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
npm run bench                    # games/sec benchmark (budget: ≥1; typical: ~6)
npm run test                     # full suite via node:test (zero installs)
npm run broadcast                # two-voice broadcast script for a game
```

Optional dev tooling (`typescript`, `vitest`, `tsx`) layers on with a normal
`npm i -D typescript vitest tsx @types/node` — but nothing requires it.
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
