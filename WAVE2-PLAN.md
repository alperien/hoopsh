# Wave 2 plan

> STATUS (2026-07-27): historical record, kept as written. Not a live task
> list; Phases B.3/B.4, C (B3/B6/B7/B8), and D were not fully delivered; the
> open remainder is registered in REFACTOR.md ("Open items — wave-2 audit").

Wave 1 landed 9/9 agents. This plan covers (A) merging that work safely, (B) acting
on the four corrections agents found in my own prior measurements, and (C) a
second, wider swarm launched on top of the integrated base.

## Conflict map (measured, not assumed)

| Branch | Touches | Engine behavior? | Conflict risk |
|---|---|---|---|
| `wave1/ncaa` | `data/ncaa/**` only | no | none |
| `wave1/corpus` | `data/nba/**`, `tools/*nba*`, pkg.json | no | pkg.json only |
| `wave1/season` | new harness files, pkg.json | no | pkg.json only |
| `wave1/ratings` | new harness files, pkg.json, `data/nba/example-*` | no | pkg.json only |
| `wave1/ergo` | `packages/data/**`, docs, pkg.json | no | pkg.json, docs |
| `wave1/runner` | `harness/{cli,flow,aggregate,index}.ts` + new | no | flow.ts |
| `wave1/narration` | engine spacing/rebounds, pbp, turing, stats, viewer | yes | 5 files w/ endgame |
| `wave1/endgame` | engine events/params/ai/possession, stats, pbp, viewer, turing, flow | yes | 5 files w/ narration |

Merge order (least-risk first, engine-behavior last): ncaa → corpus → season →
ratings → ergo → runner → narration → endgame. Rationale: get every no-behavior
branch onto a green base first, so when the two engine branches land, any
fingerprint/band movement is unambiguously attributable to them.

## Phase A

Serialized merges, orchestrator only. After each merge: `npm test` +
`npm run fingerprint`. Behavior-neutral branches must leave the 24-seed corpus
byte-identical; if one doesn't, that's a bug in the branch and it gets fixed
before the next merge, never batched.

The two engine branches will break the corpus by design. They land last, together,
and are followed by one re-baseline, not two.

## Phase B

Act on the four corrections agents found in my work. These are not new features;
they are defects in the project's own reference data and gates that my earlier
sessions produced and agents caught.

1. Putback reference was wrong (0.33 → 0.716; my denominator counted 82 of 214
   team-rebound bookkeeping rows). Fix `flow.ts`'s hardcoded reference strings and
   `flow.test.ts` bands, and re-scope debt D8: its gap points the opposite
   direction (sim ~56% is too low, not too high). Prism's post-OREB proposal must
   be re-aimed before any implementation.
2. Shipped rosters fail their own validator (11 issues, stale v1). Fixed on
   `wave1/ergo`; verify post-merge.
3. A star fixture is miscalibrated: LeBron `freeThrow: 74` shoots 78.1% vs his
   real 73.1%; the fitter's 61 gives 73.2%. Correct the fixture, with the engine's
   own curve as the citation.
4. Band count reads 17/17 at n=24. Confirm at n=96 with the parallel runner
   before declaring D1 (assisted share) closed. Noise-vs-real must be settled by
   sample size.

## Phase C

The Wave 2 swarm: 8 agents, launched on the integrated base. Compute discipline
unchanged: agents get ≤12-game probes; all sweeps, band runs, noise floors, and
fingerprint re-baselines stay serialized through the orchestrator. The measured
hardware reality: this box is 1 physical core / 2 hyperthreads, so the parallel
runner's ceiling here is ~1.3×; agents must not assume more.

| # | Agent | Mission |
|---|---|---|
| B1 | Shot-mix implementer | Prism's ranked fixes: taxonomy (assign `cut_finish`, stop labeling rebound-catches `catch_shoot`), state-aware transition urgency, post-OREB pressure re-aimed for the corrected 0.716 target |
| B2 | Mid-range restoration | The dead zone: no 16-footer is ever argmax. Demand (drilled mid pull-up, tendency-gated) + supply (elbow spots exist but are never assigned) |
| B3 | 30-roster fitting | Run `rosters:fit` across a real league using the 184-game corpus; fit rosters together so players are each other's cast (fixes the context-relativity limitation) |
| B4 | NCAA rulepack | Fix the 3 verified bugs (one-and-one bonus, 12-ft lane, OT foul carryover) + wire the proposed bands behind a league flag |
| B5 | Red team | Job: break everything Wave 1 shipped. Hunt fixture-fitting, unreproducible numbers, silent failures, determinism holes, and self-reported metrics that don't replicate |
| B6 | Turing round 2 | n≥60, five fresh judges, including late-game windows now that endgame exists. The before/after number for the whole wave |
| B7 | Prediction backtest | Real season outcomes vs sim: Brier score, calibration curves, log loss, using the season layer + fitted rosters |
| B8 | Docs & traceability | Reconcile every doc with reality after 17 branches of change; update the debt register with corrected directions |

## Phase D

The coordinated re-sweep, run by the orchestrator. One margin-objective sweep
over the integrated engine (endgame flag decision included), then: full ladder,
corpus re-baseline, noise-floor regeneration, ratchet update, push to PR #3.

## Non-negotiables

- I re-run every decision-gating number myself. Agent self-reports are leads, not evidence.
- Behavior changes stay flag-gated until the coordinated re-sweep.
- No agent re-baselines the fingerprint corpus. That is the orchestrator's call alone.
- Corrections to my own past work get the same rigor as new features; they are the
  highest-value findings this swarm produced.
