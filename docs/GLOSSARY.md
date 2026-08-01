# Glossary — the terms, decoded once

Two tables. The first decodes the code vocabulary: terse names are house
style, documented at their DEFINITION sites (e.g. `n()` has a 15-line doc
block in derived.ts) but not at use sites hundreds of lines away — this
table is the use-site key. The second decodes the process and measurement
vocabulary the roadmap, the register, and the calibration docs use without
re-explaining. Definition sites stay canonical; when this table and a
fresher code comment disagree, the comment wins — flag the discrepancy.

## Code vocabulary

| Term | Plain meaning | Where it lives / is used |
|---|---|---|
| `n(rating)` | universal rating bridge: 0–100 → [−1, +1], 50 → 0 (average player contributes nothing to any logit) | defined model/derived.ts; used throughout resolve.ts, decide.ts; mirrored as `nOf` in fit-roster.ts |
| `t` | GAME-CLOCK seconds elapsed (freezes at whistles/horn) — the stats axis | events.ts `Base.t`, `GameState.t`; AGENTS §1.5 |
| `wt` / `wallT` | replay/wall timeline seconds (advances every tick, stoppages included) — the viewer axis | events.ts `Base.wt`, `GameState.wallT` |
| `poss` | the CURRENT possession record (`s.poss`) or a possession COUNT (`TeamTotals.poss`) depending on context | state.ts, stats/box.ts |
| `sc` | seconds left on the shot clock (`s.poss.shotClock`, clamped ≥ 0) | decide.ts, concepts.ts |
| `sfc32` | the PRNG algorithm name ("Small Fast Counter", 32-bit) — a public-domain generator, not a repo invention | core/rng.ts header |
| `cyrb128` | string-hash seeder feeding sfc32 four 32-bit seeds | core/rng.ts |
| `logit` / `base*` | log-odds; every `base*` param is calibrated at league-average everything | params.ts header conversion table |
| `EV` | expected points — the unit of every decision utility | params.ts §3, decide.ts header |
| `continuation` | expected points of NOT acting yet — the yardstick every action is measured against | decide.ts, concepts.ts 6/7 |
| `oreb`/`orb`, `drb`, `trb` | offensive / defensive / total rebounds (standard box-score codes) | stats/box.ts, harness flow-metrics.ts |
| `astdShare` | share of made FGs that were assisted | aggregate.ts:158, bands.ts:67 |
| `tg` | team-game (each simulated game = 2 team-games); "4.6/tg" = per team per game | comments in knobs.ts:119, docs/REGISTER.md |
| `A.` / `D.` / `E.` / `P.` / `F.` / `M.` / `W.` / `R.` | one-letter alias for a params BLOCK, bound at function top: A=ai, D=decide, E=endgame, M=move; but P=shot (resolve.ts:130) or pass (resolve.ts:286) or sub (subs.ts); F=foul or fatigue; W=shot-windups (decide.ts:115); R=reb — or a plain number (movement.ts:91 `R = avoidRadiusFt`) | all sim files; the idiom is consistent, the letter→block mapping is not — read the binding at function top |
| `h` / `m` / `a` / `d` / `s` | holder / teammate ("mate") / agent / defender / GameState — the per-function actor vocabulary | decide.ts, offense.ts, defense.ts, resolve.ts |
| `ph` | the current `Phase` object narrowed to one kind | tick handlers (possession.ts, fouls.ts) |
| `act0` | the possession's team action AS OF this decision (snapshot, may be null) | decide.ts, concepts.ts |
| `lk` | name-lookup helper (id → display name/abbrev) | narration/pbp.ts |
| `segmentT` | parametric position 0..1 along a segment (geometry `t`, NOT time) | core/vec.ts:79; used in decide.ts `defendersInLane` |
| `gravity` | how much defensive attention a player commands (shooting threat pull) | resolve.ts, offense/defense.ts |
| `DHO` / `pnr` / `iso` | dribble hand-off / pick-and-roll / isolation (basketball play types) | state.ts TeamAction, ai/actions.ts |
| `CRN` | common random numbers — candidates re-play identical seeds so comparisons are fair | fit-roster.ts refineFit, solve.ts |
| `SWEPT` / `REAL` / `FEEL` / `STAGED` / `UNWIRED` | provenance/honesty tags (optimizer-found / measured fact / hand-set / deliberate future / accidental debt) | params.ts header, AGENTS §2.5, §5 |
| `simone.ts` | "sim ONE game" CLI (not a person) — the single-game human-readable entry point | harness/src/simone.ts header |
| `oos` | out-of-sample (rosters the sweep never saw) | harness/src/oos.ts |

Domain jargon that needs no rename, just a decode: putback (immediate
re-shot off an offensive rebound), backdown (post dribbles toward the rim),
closeout (defender sprinting at a catching shooter), 2-for-1 (shooting
early enough to guarantee the period's last possession), one-and-one (the
NCAA bonus free throw earned only by making the first).

## Process and measurement vocabulary

| Term | Plain meaning | Where it lives / is used |
|---|---|---|
| fingerprint | the docs-tier identity check: `npm run sim -- --seed fingerprint-1` event count + final score, plus `npm test` counts — identical before/after proves a no-behavior change | AGENTS §4.1/§4.3, PLAYBOOK step 3 |
| golden corpus | 28 seeds' events+frames SHA-256 hashes, checked in — the pure-refactor tier's byte-identity reference (`npm run fingerprint`) and the seed set for CI's determinism gate (corpus built twice per run, `fingerprint:determinism`). Not a gameplay gate since issue #33 — bands + invariants own that; regenerate on demand at a refactor base or a deliberate re-baseline | packages/harness/golden/fingerprints.json, fingerprint.ts |
| acceptance bands | the league-mean ranges (pace, FG%, 3PA share, …) a batch run is graded against | harness/src/bands.ts `NBA_BANDS`; `npm run batch` |
| band lock / "locked" | at 40+ games, every band's measured CENTER sits inside its band — necessary, not sufficient (the sweep tunes the same knobs the bands grade) | docs/CALIBRATION.md |
| sweep | the parameter optimizer: searches `knobs.ts` ranges over `SimParams` against the bands; its printed diff gets baked into params.ts | harness/src/sweep.ts; `npm run sweep` |
| noise floor | the MEASURED sampling distribution of every gated statistic across seed bases; gates derive widths from it (edge ± 3·sd), so a gate failure means "the sim changed" | `npm run noisefloor` → noise-floor.gen.ts; docs/CALIBRATION.md |
| ratchet convention | once a report-only metric passes, it becomes gated so it cannot silently regress; the batch gate's floor is `RATCHET_FLOOR` | harness/src/cli.ts; docs/REGISTER.md W47 |
| verification tiers | docs-only / pure refactor / mechanics / consumer — each with its required evidence | AGENTS §4.3 |
| recipes A–G | the per-change-shape build procedures (new tendency, new knob, new action, new event, new rule field, new test, new consumer) | docs/PLAYBOOK.md Part 2 |
| rule pack vs data pack | league rules as JSON (`RulePack` — periods, clocks, bonus, geometry) vs roster content as JSON (team packs) | rules/rulepack.ts; docs/ROSTERS.md |
| the Bible | docs/BIBLE.md — a GENERATED concatenation of the source docs for one-context-window handoff; never edited directly | tools/build-bible.mjs; `npm run docs:bible` |
| the register | docs/REGISTER.md — the live debt rows D1–D9 and W1–W61 (formerly REFACTOR.md's tables) | docs/REGISTER.md |
| Phase 2R | the current roadmap phase: tuning and validating the implemented mechanics, not building new ones | README.md Roadmap |
| B2 / game-state coupling | the score-pressure mechanic: trailing team's defense presses up, leader's sags (concept 7 channel 2), plus the garbage-time concede rotation | REGISTER W17/W18; concepts.ts, subs.ts |
| concepts 6/7/8 | numbered bounded-rationality concepts: 6 = game-state urgency (clock kill, hold-for-last, 2-for-1), 7 = score pressure, 8 = probe culture; concept 4 (usage pressure) lives in decide.ts | sim/ai/concepts.ts (in-file order 1–3, 6, 5, 7, 8) |
| "staged at zero" | a mechanism wired into the engine with all magnitudes 0 — provably inert until a fit flips it (e.g. concept 8) | params.ts labels; REGISTER W19/W28 |
| fidelity / texture / flow gates | star-fixture identity checks (`npm run fidelity`) / frame-level feel forensics (`npm run texture`) / game-arc + event-grammar forensics (`npm run flow`) | harness/src/{fidelity,texture,flow}.ts |
| Turing round | the blind sim-vs-real play-by-play discrimination protocol (round 1: 50% judge accuracy — coin-flip) | harness/src/turing.ts; docs/history/refactor-log.md |
| Brier | mean squared error of probability forecasts — the planned prediction-backtest metric | REGISTER W5; docs/SEASON.md |
| seed base | a family of related seeds used for one measurement run; adjudicate across independent bases, never one draw | docs/CALIBRATION.md etiquette |
