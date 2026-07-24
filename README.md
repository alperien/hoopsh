# hoopsh 🏀

*A modular, deterministic, 2D-spatial basketball simulation core.*

Ten agents move on a real court at 10 ticks per second — spacing, drives, kick-outs, cuts,
closeouts, help rotations, box-outs. Discrete outcomes (shots, passes, fouls, rebounds)
resolve through **calibrated probability models fed by spatial context**, so games look
like basketball *and* season-scale statistics land inside real-league ranges. Every point
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

## The core bet: hybrid spatial–stochastic simulation

Pure physics sims can't be calibrated; pure stat sims have no feel. hoopsh runs
continuous 2D movement and decision-making, but resolves discrete events through
logistic models whose every constant lives in one flat object: **`SimParams`**, the
calibration surface. Player identity comes from handcrafted **attributes** (what a
player *can* do) and **tendencies** (what they *want* to do) — an elite shooter profile
organically produces a heavy deep-three diet, off-ball gravity that warps the defense,
and star-level scoring volume. Nobody scripts that; it emerges.

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
(pace, efficiency, shot mix, rebounding, fouls, turnovers…). Current state: the engine
has hit **16/16**; ongoing AI-realism work (usage hierarchy, anticipated contests) has
several bands oscillating within 1–3 units pending the automated parameter sweep.
Archetype tests pin player differentiation (elite shooter ≈ 25 pts on ~20 FGA with a
deep-three diet; rim-runner takes 90%+ of shots inside; non-shooting bigs don't chuck).

Run it yourself: `npm run batch -- --games 50`.

## Roadmap

**Phase 2 (current):** replay viewer ✅ · README ✅ · broadcast demo · automated
parameter sweep to lock all 16 bands · orchestrator refactor · pick-and-roll & usage
hierarchy (make floor generals lead their teams in assists) · post-up game · star
fixtures validated against real-life stat ranges.

**Beyond:** season layer (schedules, fatigue across games, injuries) · progression &
aging · NCAA + EuroLeague rule-pack tuning · era packs (1995 vs 2015 shot diets) ·
deep player editor UI · GM & MyPlayer experiences · defensive schemes ·
broadcast TTS audio · WASM hot path if the perf budget ever demands it.

## License

Not chosen yet — treat as all-rights-reserved until a license lands.
