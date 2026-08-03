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
npm run sweep -- --iters 0 --games 4 --verify 160     # params changes (3-seed check)
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
   toBeLessThan(OrEqual), toContain, toBeTruthy, toBeDefined, toBeUndefined,
   toThrow, .not` (see `tools/shims/vitest.ts`).
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
Agents use this format verbatim. Humans: cover the same facts in your PR
description; the fields are the checklist, not the formatting.
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

(Dispatchers only — skip this part as a contributor.)

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
