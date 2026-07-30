# Changelog

All notable changes to hoopsh are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Dates are ISO 8601.

## [0.1.0] - 2026-07-31

First tagged release. hoopsh is a deterministic 2D spatial basketball
simulation core: ten agents move on a real court at 10 Hz, and discrete
outcomes (shots, passes, fouls, rebounds) resolve through logistic probability
models fed by spatial context. The same seed produces a bit-identical game, so
a game is a file you can replay, diff, and share.

### Engine

- Deterministic tick engine on a seeded sfc32 Rng. The same seed gives
  bit-identical events and frames in Node and the browser, and the engine
  imports nothing (no npm packages, no Node built-ins).
- Spatial offense and defense: spacing, drives, kick-outs, cuts, closeouts,
  help rotations, box-outs, pick-and-roll, post-ups, dribble-handoffs, and
  isolation, all emergent from geometry and incentives rather than scripted.
- Shot windup with self-consistent shot selection: the model that resolves a
  shot is the model the AI uses to choose it, so decisions and outcomes cannot
  drift apart.
- Late-game management, on by default: timeouts, intentional fouling,
  hold-for-last, two-for-one, and clock burn. Setting `endgame: false` selects
  the byte-identical legacy path.
- Score-pressure coupling: trailing teams press up and decided games wind down
  through the benches.
- A game-wide timeout economy and an officiating vocabulary (jump balls,
  violations, replay reviews), carried by replay format v3.

### Consumers

- `@hoopsh/stats`: event streams fold into box scores, exact minutes and
  plus-minus, advanced stats, and shot charts. Box scores reconstruct from the
  event stream alone.
- `@hoopsh/narration`: template play-by-play with run and milestone awareness,
  a two-voice broadcast booth (see docs/BROADCAST.md), and an LLM
  color-commentary seam.
- `@hoopsh/data`: player and team schemas, validation, archetype builders, and
  sample packs.
- `packages/viewer`: a single-file 2D canvas replay viewer. Drag any replay
  JSON onto it.

### Harness and tooling

- Batch runner graded against NBA acceptance bands, an automated parameter
  sweep that re-centers the bands after mechanics changes, a throughput
  benchmark, and a golden fingerprint corpus of 28 seeds.
- A stateless season driver with standings and Monte-Carlo matchups (see
  docs/SEASON.md).
- An NCAA rule pack behind the harness `--league` flag (rule coverage partial).
- Roster tooling: schema generation, a scaffold wizard, a validator, and a
  stats-to-ratings fitter.
- A 184-game parsed NBA play-by-play corpus grounding the flow references,
  with its provenance recorded in data/nba/.

### Quality

- A permanent invariant suite derived from adversarial audit rounds, an
  adversarial-input fixture, and a CI pipeline that runs the test suite, the
  gated acceptance bands, the fingerprint corpus, a two-run determinism check,
  a strict typecheck, the same suite under real vitest, and a
  documentation-drift check.

[0.1.0]: https://github.com/alperien/hoopsh/releases/tag/v0.1.0
