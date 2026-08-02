# The hoopsh library — every document, organized

This is the hub. If you don't know which document you need, start here.

## The organizing principle

- **Repo root** holds the three *front-door* documents — what a visitor or a
  freshly-assigned agent must see before anything else:
  `README.md` (what this is) · `ARCHITECTURE.md` (why it's built this way) ·
  `AGENTS.md` (the law you work under) — plus `LICENSE`.
- **`docs/`** holds the *deep guides* you reach for while working, each with a
  row below.
- **`docs/history/`** holds *records, not guides* — the July-2026 process
  artifacts (swarm plans, red-team findings, the refactor log, superseded
  calibration eras). Nothing there is a live task list; the live list is
  [REGISTER.md](./REGISTER.md).
- **Code comments are the ground truth for specifics.** Documents describe the
  system; the comment next to a number explains *that number*. When a doc and a
  fresher code comment disagree, the code comment wins — flag the discrepancy.

## The documents

| Document | One line | Read it when |
|---|---|---|
| [`README.md`](../README.md) | What hoopsh is + zero-dep quickstart | First contact |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | The hybrid spatial–stochastic bet and the design goals | Before forming opinions |
| [`AGENTS.md`](../AGENTS.md) | **The contributor covenant** — directives, DO-NOTs, verification tiers | Before changing anything |
| [`docs/CHECKLISTS.md`](./CHECKLISTS.md) | **Per-tier verification checklists** — the gates, fingerprint expectation, and report expectation for each tier, one page | When verifying any change |
| [`docs/INTERNALS.md`](./INTERNALS.md) | Module map, tick pipeline, two time axes, safety net, known simplifications | When looking for where something lives |
| [`docs/CALIBRATION.md`](./CALIBRATION.md) | Calibration workflow, noise-floor doctrine, what "locked" claims, the CURRENT measured state | Before touching `params.ts` values or `bands.ts`; when tuning realism |
| [`docs/EMBEDDING.md`](./EMBEDDING.md) | **The downstream-builder guide** — consuming the packages from your own project; what works, what's broken, honest caveats | When building ON the engine rather than IN the repo |
| [`docs/CONTRACT.md`](./CONTRACT.md) | **The engine API contract** — the stable surfaces (event schema, replay, exports, determinism), the explicitly unstable ones, the change policy | Before pinning hoopsh under your own project; when judging whether a change breaks consumers |
| [`docs/GLOSSARY.md`](./GLOSSARY.md) | Every terse name and process term, decoded once, with where it lives | Whenever jargon blocks you |
| [`docs/REGISTER.md`](./REGISTER.md) | **The live debt register** — D1–D9, W1–W87, realism-gate tiers | Checking what's open, deferred, or already measured |
| [`docs/PLAYBOOK.md`](./PLAYBOOK.md) | **The build procedure** — 8 steps, recipes A–G, STOP rules, report format | Every time you write new code |
| [`docs/ONBOARDING.md`](./ONBOARDING.md) | Two-evening guided path with checkpoints | Your first two evenings |
| [`docs/ROSTERS.md`](./ROSTERS.md) | **The roster-authoring guide** — the 38 dials in basketball language, archetypes, scaffold → validate → sim loop | When writing a team pack |
| [`docs/SEASON.md`](./SEASON.md) | **The season layer** — schedules, standings, Monte-Carlo matchups, and the deliberate absence of cross-game state | When driving multi-game runs or predictions |
| [`docs/BROADCAST.md`](./BROADCAST.md) | **The broadcast booth** — the two-voice play-by-play pipeline (GameSense, beats, director, voice packs) and its persona/language doctrine | When working on narration or the booth |
| [`docs/BIBLE.md`](./BIBLE.md) | ⚠ GENERATED — every source doc compiled into one file (`npm run docs:bible`) | When you want everything in one context/download |
| [`docs/history/`](./history/README.md) | Records, not guides: swarm plans, red-team findings, refactor log, superseded calibration eras | Only when tracing why something is the way it is |
| [`data/nba/README.md`](../data/nba/README.md) | The provenance-first data contract + the pbp-corpus pipeline | When touching reference data or the corpus |
| [`data/ncaa/README.md`](../data/ncaa/README.md) | NCAA research: rules verification, stat deltas, the bands now loaded by `--league ncaa` | When working the league-expansion arc |

## Reading paths by role

**User (play games, author teams, run seasons)** → README quickstart →
ROSTERS.md end to end (it's the whole loop) → SEASON.md for multi-game
runs. GLOSSARY on demand. You never need the law, the calibration docs, or
history.

**Contributor (changing code)** → README → ARCHITECTURE → ONBOARDING (do
both evenings — Evening 1 walks you through INTERNALS and AGENTS in order) →
PLAYBOOK when building, CHECKLISTS.md for the verification gates, INTERNALS as
reference. CALIBRATION.md is law too
the moment you touch `params.ts` values or bands. Budget note: `npm test`
(rung 1 of the ladder) takes ~2 minutes on a modest box.

**Builder (consuming hoopsh as a library)** → README → EMBEDDING.md (the
install lanes, the runnable example, the caveats) → CONTRACT.md (what you
may rely on, what may move, what a version bump means) → the sanctioned
source-API list EMBEDDING ends with (`core/events.ts`, `rulepack.ts`,
`provider.ts`, …) → ROSTERS.md when you author packs.

**Agent, assigned a task** → AGENTS.md (all of it) → PLAYBOOK.md (Part 1 +
your recipe) → INTERNALS.md rows for your in-scope files → the module
headers and exemplar code your brief names. Calibration task? CALIBRATION.md
is your law. You do not need ONBOARDING's exercises; you DO need its
possession trace if your task touches the engine.

## Which document answers which question

| Question | Answer lives in |
|---|---|
| "What is this project?" | `README.md`, `ARCHITECTURE.md` |
| "Where is X / where do I change Y?" | `docs/INTERNALS.md` |
| "Am I allowed to do this?" | `AGENTS.md` |
| "HOW do I build this new thing?" | `docs/PLAYBOOK.md` |
| "How do I use hoopsh from my own project?" | `docs/EMBEDDING.md` |
| "What can consumers rely on?" | `docs/CONTRACT.md` (the contract) + `core/events.ts` (the per-field spec) |
| "How do I write a team/roster pack?" | `docs/ROSTERS.md` |
| "How do I run a season / predict a matchup?" | `docs/SEASON.md` |
| "How do I tune realism / is the sim 'locked'?" | `docs/CALIBRATION.md` |
| "What does this term/jargon mean?" | `docs/GLOSSARY.md` |
| "What known debt or open items exist?" | `docs/REGISTER.md` |
| "How do I learn this codebase?" | `docs/ONBOARDING.md` |
| "What happened in the July-2026 campaign?" | `docs/history/` |
| "What does this number mean?" | The comment next to it |
| "Why is the league average what it is?" | `sim/params.ts` header + `harness/src/bands.ts` |
| "A stat looks wrong — where do I start?" | `docs/INTERNALS.md` safety net + `sim/possession.ts` header (possession accounting) + `stats/box.ts` header (folding rules) |

## Maintenance rules

1. Architectural changes update `ARCHITECTURE.md`/`INTERNALS.md` **in the same
   commit** (AGENTS §5).
2. Any edit to a Bible source document (the `SOURCES` list in
   `tools/build-bible.mjs`) regenerates the Bible in the same commit:
   `npm run docs:bible`.
3. Never edit `docs/BIBLE.md` by hand — it is overwritten on regeneration.
4. New documents get a row in this hub's table, a reading-path mention, and a
   Bible decision: guides join the `SOURCES` list; `REGISTER.md` and
   `docs/history/` are excluded by design (the Bible is the agent
   context-pack; history would re-bloat the one file whose size is the
   point). `CHECKLISTS.md` is excluded by decision, not drift: it restates
   AGENTS §4.2-4.3 and PLAYBOOK Part 3, which the Bible already compiles
   (PR #46; inclusion stays an owner option, issue #239). Data-pack READMEs
   (`data/*/README.md`) hold hub rows without joining `SOURCES`; they sit
   outside this rule.
5. `docs/history/` files are records: append dated status notes, don't
   rewrite them.
