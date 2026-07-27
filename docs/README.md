# The hoopsh library — every document, organized

This is the hub. If you don't know which document you need, start here.

## The organizing principle

- **Repo root** holds the three *front-door* documents — what a visitor or a
  freshly-assigned agent must see before anything else:
  `README.md` (what this is) · `ARCHITECTURE.md` (why it's built this way) ·
  `AGENTS.md` (the law you work under).
- **`docs/`** holds the *deep guides* you reach for while working:
  `INTERNALS.md` (where everything lives) · `ONBOARDING.md` (how to learn it) ·
  `PLAYBOOK.md` (how to build new things) · `ROSTERS.md` (how to author team content) ·
  `SEASON.md` (the multi-game layer) · `BIBLE.md` (all of the above, one file).
- **Code comments are the ground truth for specifics.** Documents describe the
  system; the comment next to a number explains *that number*. When a doc and a
  fresher code comment disagree, the code comment wins — flag the discrepancy.

## The documents

| Document | One line | Read it when |
|---|---|---|
| [`README.md`](../README.md) | What hoopsh is + zero-dep quickstart | First contact |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | The hybrid spatial–stochastic bet and the design goals | Before forming opinions |
| [`AGENTS.md`](../AGENTS.md) | **The contributor covenant** — directives, DO-NOTs, verification tiers | Before changing anything |
| [`docs/INTERNALS.md`](./INTERNALS.md) | Module map, tick pipeline, two time axes, safety net | When looking for where something lives |
| [`docs/ONBOARDING.md`](./ONBOARDING.md) | Two-evening guided path with checkpoints | Your first two evenings |
| [`docs/PLAYBOOK.md`](./PLAYBOOK.md) | **The build procedure** — 8 steps, recipes A–G, STOP rules, report format | Every time you write new code |
| [`docs/ROSTERS.md`](./ROSTERS.md) | **The roster-authoring guide** — the 38 dials in basketball language, archetypes, scaffold → validate → sim loop | When writing a team pack |
| [`docs/SEASON.md`](./SEASON.md) | **The season layer** — schedules, standings, Monte-Carlo matchups, and the deliberate absence of cross-game state | When driving multi-game runs or predictions |
| [`docs/BIBLE.md`](./BIBLE.md) | ⚠ GENERATED — every source doc compiled into one file (`npm run docs:bible`) | When you want everything in one context/download |

## Reading paths by role

**New human developer** → README → ARCHITECTURE → ONBOARDING (do both evenings) →
INTERNALS as reference → AGENTS before your first change → PLAYBOOK when building.

**New AI agent, assigned a task** → AGENTS.md (all of it) → PLAYBOOK.md (Part 1 +
your recipe) → INTERNALS.md rows for your in-scope files → the module headers and
exemplar code your brief names. You do not need ONBOARDING's exercises; you DO need
its possession trace if your task touches the engine.

**Dispatcher (briefing other agents)** → PLAYBOOK Part 4 (the briefing template) +
AGENTS §4 (tiers). Freeze code, capture the fingerprint last, review diffs yourself.

**Debugging a stat that looks wrong** → INTERNALS "safety net" + `sim/possession.ts`
header (possession accounting) + `stats/box.ts` header (folding rules).

**Tuning realism** → `sim/params.ts` header primer → `harness/src/bands.ts` +
`knobs.ts` headers → AGENTS §4.4 (calibration etiquette, the noise floor).

**Writing a roster (real or invented team)** → ROSTERS.md end to end (it's the
whole loop) → `model/player.ts` comments for any dial the guide's plain-language
version doesn't settle → `packages/data/src/archetypes.ts` for calibrated
reference profiles.

**Running seasons or matchup predictions** → SEASON.md end to end (schedule
determinism, standings definitions, Monte-Carlo CI math, and — read before
trusting any prediction — what the deliberate absence of cross-game state
costs in accuracy).

## Which document answers which question

| Question | Answer lives in |
|---|---|
| "What is this project?" | `README.md`, `ARCHITECTURE.md` |
| "Where is X / where do I change Y?" | `docs/INTERNALS.md` |
| "Am I allowed to do this?" | `AGENTS.md` |
| "HOW do I build this new thing?" | `docs/PLAYBOOK.md` |
| "How do I write a team/roster pack?" | `docs/ROSTERS.md` |
| "How do I run a season / predict a matchup?" | `docs/SEASON.md` |
| "How do I learn this codebase?" | `docs/ONBOARDING.md` |
| "What does this number mean?" | The comment next to it |
| "What can consumers rely on?" | `core/events.ts` (documented as an API) |
| "Why is the league average what it is?" | `sim/params.ts` header + `harness/src/bands.ts` |

## Maintenance rules

1. Architectural changes update `ARCHITECTURE.md`/`INTERNALS.md` **in the same
   commit** (AGENTS §5).
2. Any edit to a Bible source document (the `SOURCES` list in
   `tools/build-bible.mjs`) regenerates the Bible in the same commit:
   `npm run docs:bible`.
3. Never edit `docs/BIBLE.md` by hand — it is overwritten on regeneration.
4. New documents get a row in this hub's table, a reading-path mention, and a
   Bible-order entry in `tools/build-bible.mjs`.
