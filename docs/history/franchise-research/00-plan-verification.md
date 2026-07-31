# Plan verification — docs/FRANCHISE.md §14 build plan

Verifier notes, 2026-07-31. Verdict: **DISPATCH WITH AMENDMENTS** (amendments 1–2 are blocking; 3–5 strongly advised).

Sources traced: FRANCHISE.md, AGENTS.md, ARCHITECTURE.md, docs/SEASON.md, docs/EMBEDDING.md, research/01–07, engine/src/sim/game.ts + params.ts + movement.ts + subs.ts, engine/src/model/player.ts, harness/src/season.ts + parallel.ts, root package.json.

## Engine reality checks (assignment D)

- **Team.rotationMinutes exists** (model/player.ts:149, consumed in sim/subs.ts). Per-Team, so per-game changeable via task-time Team construction. Plan claim OK.
- **Fatigue pre-degradation is viable**: `stamina` attribute scales drain (movement.ts applyFatigue, staminaMult = 1.25 − stamina/100·0.5); SEASON.md seam 2 blesses "fatigue as an attribute/stamina debuff" at buildTasks. Plan claim OK.
- **Home-court advantage via GameConfig.params is NOT possible.** SimParams has no per-side field (grepped; the only "home" hits in params.ts mean "correct home for this data"). SEASON.md: "home-court advantage — **not modeled at all** (engine is side-symmetric by design; run.ts --mirror exists to verify it stays that way)". A params patch applies to both teams equally. §4 and §8 name the wrong seam; the only legal implementation is an asymmetric roster edit at task construction. Danger: an implementer discovering this mid-wave may reach for an engine patch (prime-directive violation / STOP condition).
- **Engine exports Rng** from the barrel (engine/src/index.ts:14) — the derived-stream discipline is implementable.
- **The harness worker pool is not reusable as code.** parallel.ts's run-worker constructs rosters itself from leagues.ts; it does not accept per-game Team payloads. EMBEDDING.md: harness is "repo-welded; consume its ideas, not the package," and the plan's own dependency list (app imports franchise + narration) excludes harness. So "the proven harness parallel pattern" = a new worker script + job format carrying serialized per-game rosters. That job shape crosses the franchise/app boundary and belongs in the contracts wave.
- Root package.json `workspaces: ["packages/*"]` and the test glob `packages/*/test/*.test.ts` pick up new packages automatically — but that also means any 20-season harness written as a `.test.ts` lands inside `npm test` (~2 min budget) and breaks it.
- App's use of node:http/worker processes is legal (zero-dep prime directive is engine-scoped; DO-NOT 6 bans npm deps, plan promises zero). Erasable-TS, events-only, engine-frozen: plan is compliant as written, HCA excepted.

## A. Wave decomposition

**No task has a file manifest.** Domains are prose. Concrete collision surfaces, all shared by 4–5 parallel writers:
- `franchise/src/index.ts` barrel — every Build A task exports through it.
- `FranchiseParams` — "one flat object"; every task adds constants. Contracts delivers only a "skeleton."
- Save schema — Build A (injury state, dev state) and Build B (scouting fog, negotiation memory, news dedup state) all add serialized slices.
- The day loop: §8's resolve order (injuries → AI act → games → stats fold → news → inbox) straddles "calendar/state machine" (task A1) and "game-day pipeline" (task A3). Two owners for one orchestration file.
- Root package.json scripts (`gm`, `gm:acceptance`) — unassigned.
- App API route registry and payload types — needed by both the app-server task and the UI task (Build B siblings).

**Undeclared dependencies:**
- Intra-A: league genesis consumes player generation (genesis builds 30 rosters via §5's generator). Parallel siblings.
- Intra-A: game-day pipeline consumes the injuries module's roster edits and rotation policy.
- Intra-B: news desk consumes AI-front-office negotiation state (§10: "rumors surface real negotiation states"). Parallel siblings.
- Intra-B: UI consumes the app server's API shape. Parallel siblings.
- Cross-wave A→B is handled by wave order (fine). Wave 4 → everything is handled by order (fine) but under-budgeted (see C).

**Contracts wave completeness:** "types.ts + module interfaces + RNG registry + save schema + FranchiseParams skeleton" omits: Action/command types (the action log!), the app JSON API contract, negotiation-state shape, the worker job/GameTask-with-rosters shape, per-module params sections, a pre-written barrel, data ownership (names/teams).

## B. Missing tasks (end-to-end walk)

1. **The user-action command layer.** §4's determinism law — league = f(seed, action log) — requires Action types, a dispatcher, and log replay. No wave task owns it. This is the spine of saves, determinism, and every UI interaction.
2. **Identity data**: era-weighted name pools + international share (§5), 30 team names/cities/colors, SVG monogram generator (§11), player portrait seeds (§5). Real deliverables, no owner.
3. **Replay persistence + viewer wiring for watch mode**: user games need collectFrames + full event retention; viewer embed serving; spoiler-free ticker. Split across app/UI with no declared boundary.
4. **npm run gm / gm:acceptance script entries**, README/docs touches, FRANCHISE_INTERNALS.md ("written with the code") — unowned.
5. Lottery/play-in/playoff-series state machines are plausibly inside "calendar/state machine" but that task is already the largest in Build A; worth naming explicitly so they aren't dropped.

## C. Scope realism

- 20-season acceptance: 24,600 games ÷ (~3 games/sec/core × 4 cores) ≈ 35–45 min per run before offseason machinery. Wave 4 gets 1–2 runs. §12's distributional bands (wins SD, minutes tiers, leaderboard shapes) depend on generation × development × rotation × AI interacting — they cannot be *calibrated* tonight, only measured. Plan's own honesty line admits this; the verify wave must encode it (gates vs reports) or wave 4 "fails" spuriously.
- Oversized tasks: "AI front offices (valuation, trades, FA, draft)" is four systems and the plan's self-declared hardest problem in one parallel slot. "UI shell + core screens" is ~12 screens + a watch-mode spectrum + keyboard system.
- Safest pre-declared cut order (trust pillar: cut features, never correctness): (1) live ticker 1×–32× broadcast mode — keep quick-sim, quarter digest, box score, and viewer replay; (2) training camp/preseason friendlies; (3) combine/workout scouting detail → flat scouting-spend model; (4) three byline voices → one; (5) almanac depth (records book, draft re-grades) → career pages + season archive only; (6) RFA offer-sheet ceremony → simplified match decision (cap legality stays exact); (7) coaching hires → tactics presets. Never cut: cap legality invariant, determinism/action log, 82-game season + playoffs + draft + FA loop, save/load.

## D. Repo-law issues

- HCA-as-params (above) — the one place the plan points an implementer at a nonexistent engine feature; adjacent STOP-condition risk.
- Acceptance harness in the `npm test` glob (above).
- AI front offices iterating over teams via object key order would break determinism; the RNG registry covers streams but iteration-order discipline (AGENTS 1.2) should be restated in the contracts wave for the new packages.

## E. Design errors vs research

1. **§12 "higher seeds win round one ~90% of the time across decades."** Research 05 B6/D4: ~90–95% is the **1-vs-8** rate specifically; 4-vs-5 is near a coin flip; champion distribution is the separate check. As written, a wave-4 author encodes a chalk league. Use research D4 verbatim: 1-seeds win ~90–95% of R1 series; champion ~2/3 1-seeds, seeds 1–3 ≥ 95%.
2. **§6 "a 10%-cap-growth economy."** Research 06 §1: 10% is the clamp ceiling (hit once, 2025-26); guidance ~+5.5%; rule "clamp growth to [0–3%, 10%]". Constant 10% growth halves every contract's cap share in ~7 years (raises max 8%/5%) — directly contradicts §12's "star share of payroll stable" band. Sample growth ~3–8%, clamp at 10%.
3. **§6 sources "Larry Coon's CBA FAQ."** Research 06 header: cbafaq is frozen, never covered the 2023 CBA. An implementer following that citation gets pre-apron rules. Sources are the research file's tables + cross-check anchors (2026-27 cap $164.961M; 25% max = $41,240,250 exactly; tax = 121.5% of cap).
4. **§14 wave 4: golden cases "lifted from real, dated transactions in the research file."** 06-cba-rules.md contains rule tables and anchors, not transactions. The criterion is not executable as written; derive cases from the tables/anchors instead.
5. Minor: §12 scoring leader "28–35 PPG" vs research "title in [30,37]"; award 65-game eligibility rule (research §2) unmentioned. Encode research numbers, not prose.

Verified-correct design claims worth recording: schedule formula (16/36/30), play-in shape, lottery odds table, two-way 3 slots, max tiers/raises, 2-day offer-sheet window, Stepien, second-apron frozen first, home win 55–60% target, wins SD ~13, minutes tiers, aging by skill group, career-length bands.

## Amendments (priority order)

1. **Blocking — expand the contracts wave** into a real interface freeze: pre-written barrel; per-module type files, params sections, and save-state slices; Action/command types + action-log replay contract; app API route/payload contract; negotiation-state shape; worker job format; per-task file manifests naming every file each task may touch. One agent, ~30–45 min, removes every traced collision.
2. **Blocking — correct the four factual errors before agents encode them**: HCA = asymmetric roster edit at task construction (never params, never engine); R1 band per research D4; cap growth 3–8% clamped; CBA sourcing = research tables/anchors.
3. Split/trim the two oversized Build B tasks (AI FO → valuation+trades / FA+draft; UI → shell+office/roster/cap/league / game-center+draft-room+almanac) and pre-declare the cut order above in §14.
4. Verify wave: split §12 into hard gates (determinism hash, daily cap legality, 20-season completion, no monotonic drift) vs reported bands; CI autosim at ~5 seasons; `gm:acceptance` as a script outside the test glob; assign `npm run gm`, README, INTERNALS ownership.
5. Add the missing tasks: action layer (contracts + calendar task), identity data (genesis + UI), replay/viewer wiring boundary (app vs UI, named).
