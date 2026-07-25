# Onboarding — from zero to productive in two evenings

This is the guided path. Documents tell you *what's true*; this file tells you
*what order to learn it in*, with checkpoints so you know it stuck.

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
- `packages/engine/src/core/events.ts` — every event type and its invariants.
  This is what EVERY consumer sees; internalize it.
- `packages/engine/src/sim/params.ts` — read the header primer carefully
  (logit table, units, provenance tags), then skim the annotated defaults.

**Checkpoint 1** — you should be able to answer without looking:
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
   Read this function slowly; it is the heart of the engine.
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

While tracing, keep the viewer open on the same seed. Everything you read is
visible: the windup pause before a shot, the closeout sprint, the scramble.

**2. Read the emergence machinery** (~30 min):
`resolve.ts#gravity` (why shooters warp defenses) → `ai.ts#defenseTick` (gap,
sag, help selection) → `ai.ts#pnrTick` (screens as thin scaffolding). Then read
`ARCHITECTURE.md §5` again — it will land differently now.

**3. First-change exercises** (~45 min, pick one, throwaway — don't commit):
- **Safe**: In `params.ts`, set `decide.threeAppetite: 0.5` via an override in a
  scratch script (use `simulateGame({ params: { decide: { threeAppetite: 0.5 } } })`)
  and run 10 games. Watch the 3PA share crater in the box scores. Revert nothing —
  you never touched the file.
- **Safer**: Write a 10-line consumer: count screen-adjacent pull-up threes from the
  event stream of 20 games. You'll learn the event contract by using it.
- **Advanced**: Follow AGENTS.md §4 end-to-end for a real one-knob change
  (e.g. `reb.putbackChance` +0.05): fingerprint → change → `npm test` → batch →
  revert. The point is the ritual, not the change.

**Checkpoint 2** — you're productive when you can:
- Explain how drive-and-kick emerges without a script (three mechanisms).
- Say exactly what happens to `possession_end` on an and-one.
- Name the file you'd edit to change what a 90 `speed` rating means, and the file
  you'd edit to make players *want* to shoot earlier.
- State the verification tier of the change you're about to make.

---

## The map when you're lost

| Question | Answer lives in |
|---|---|
| "What is this project?" | `README.md`, `ARCHITECTURE.md` |
| "Where is X / where do I change Y?" | `docs/INTERNALS.md` |
| "Am I allowed to do this?" | `AGENTS.md` |
| "What does this number mean?" | The comment next to it (if missing: that's a docs bug — fix it) |
| "What can consumers rely on?" | `core/events.ts` |
| "Why is the league average what it is?" | `sim/params.ts` header + `harness/src/bands.ts` |
