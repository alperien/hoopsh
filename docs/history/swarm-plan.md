# Swarm plan — pushing hoopsh toward IRL rosters + realistic flow

> **STATUS (2026-07-27): historical record, kept as written.** Not a live task
> list — delivered-vs-undone accounting and every open item live in
> REFACTOR.md ("Open items — wave-2 audit").

**Mission:** drive hoopsh hard toward the stated goals (author real NBA/NCAA rosters →
get realistic stats AND realistic game flow) using a large agent swarm, under
mandatory rigor.

## Two hard lessons, both encoded below

1. **The previous swarm died mid-flight when the process exited — 5 agents, zero
   work landed.** (Verified: all four worktrees still sit at base commit `311a7f0`
   with clean status.) *Fix:* every agent commits INCREMENTALLY to its own branch —
   a first commit within its first few minutes, then after each milestone. A crash
   should cost minutes, not everything.
2. **The box has 2 cores and the sim runs ~3.7 games/sec.** Running heavy
   calibration in parallel would produce garbage slower than serial. *Fix:* the
   swarm splits by WORK TYPE — many agents on compute-light work (research, data,
   code authoring, analysis, docs, tests); ALL decision-gating measurement (sweeps,
   48-game bands, noise floors, fidelity gates) stays serialized through the
   orchestrator.

## Wave 1 — foundations & diagnosis (7 agents, parallel, isolated worktrees)

| # | Agent | Deliverable | Compute |
|---|---|---|---|
| A1 | Corpus | Fetch/parse 100+ real NBA games → versioned JSON corpus; regenerate `flow-reference.json` with real distributions (p10/p50/p90, n, grade A), replacing the n=6 anchor | none (data only) |
| A2 | Parallel runner | Worker-pool game runner adopted by `batch`/`flow`; **determinism across worker counts is the acceptance test** | light (≤24g verify) |
| A3 | Ratings inversion | `rosters:fit` — real stat lines → 38-dial rating packs (analytic priors + bounded refinement), validated against the 3 star fixtures | ≤8g × ≤10 iters |
| A4 | Endgame layer | Timeouts, intentional fouling, clock-kill, 2-for-1 — behind a feature flag, EV-integrated (not scripted playbooks) | ≤12g probes |
| A5 | Shot-mix diagnosis | Root-cause the 58%-catch-and-shoot defect that ties D1b/D2/D3/D8/D9 together. **Analysis only, no engine edits** | ≤12g probes |
| A6 | NCAA research | What actually differs (pace, spacing, shot clock, foul economy, talent spread) and what the rulepack + calibration need | none |
| A7 | Roster ergonomics | JSON Schema emitted from `schema.ts`, `roster:new` scaffold, `roster:validate` CLI, docs — Goal 2's UX half | none |

## Wave 2 — build on Wave 1 (5 agents)

Shot-mix implementation (from A5's diagnosis) · 30-roster fitting (needs A1+A3) ·
NCAA rulepack + fixtures (from A6) · season/schedule driver API (multi-game,
standings — the M6 substrate) · viewer + narration polish (the measured Turing
tells: shot vocabulary, distance quantization).

## Wave 3 — validation & adversarial (4 agents)

Red-team (job: **BREAK** the new work — find fixture-fitting, silent failures,
unreproducible numbers) · expanded Turing at n≥60 **including late-game windows**
now that endgame exists · prediction backtest (Brier + calibration curves vs real
outcomes) · docs/traceability sweep.

## Wave 4 — integration (orchestrator, serialized)

Coordinated re-sweep of everything that moved sim output · full verification ladder
· corpus + noise-floor + fingerprint re-baseline · debt-register update · push to
PR #3.

## Rigor contract (verbatim in every agent brief)

- Work ONLY in your assigned worktree/branch. Never touch another agent's directory.
- **COMMIT EARLY, COMMIT OFTEN** — a crash must not erase your work.
- Do NOT run sweeps, 48-game batches, or noise floors. Probes ≤12 games. The
  orchestrator owns all measurement that decides anything.
- Every claim needs a reproducible command or `file:line`. Tests ship in the same
  commit as the code. Behavior changes go behind a flag.
- Node 24 type-stripping: **erasable TypeScript only** (no enums/namespaces/
  parameter properties; `import type` for type-only imports).
- New behavioral constants go in `params.ts` — the house rule is absolute.
- Report honestly: what you verified, what you assumed, what you could not check.

## Integration protocol

The orchestrator reviews every diff, **re-runs the numbers that gate decisions**
(never trusting self-reported metrics), and merges in dependency order. Anything
that moves sim output is quarantined into the single Wave-4 re-sweep — the M1
lesson: piecemeal mechanics changes tip boundary bands.

## Kill-risks & mitigations

| Risk | Mitigation |
|---|---|
| Process crash loses swarm work | Incremental commits per agent; shorter waves |
| Compute contention (2 cores) | Type-split; serialized measurement; per-agent game budgets |
| Agents fitting the 2 fictional rosters | A1's real corpus lands first; Wave-3 red-team hunts for it |
| Endgame AI turning scripted | EV-integration constraint + late-window Turing test |
| Scope creep | One deliverable + explicit non-goals per agent |
