# career-trust

scanned: packages/career/src/trust.ts (259), packages/career/src/approach.ts (183),
packages/career/test/approach.test.ts (272), packages/career/test/circuits.test.ts (567);
context read for verification: docs/CAREER.md (approach system + pillar 1 + gates),
docs/CAREER_INTERNALS.md (152), packages/career/src/week.ts (302), circuits.ts (projection
+ shiftForApproach sections), nbabridge.ts (swap/grading/coach-reset sections), stock.ts
(productionIndex section), tick.ts (setApproach), params.ts, types.ts,
packages/app/src/career-acceptance.ts (invariant gate), docs/REGISTER.md W66-W68.

critical: 0   high: 4   medium: 5   low: 7

## HIGH packages/app/src/career-acceptance.ts:198-202 - the fleet-scale reacting-world gate verifies clock hygiene, not the role response
The flagship gate checks `roleClock.above >= reactGames || roleClock.below >= reactGames`
once per week. But trust.ts increments a clock by exactly 1 per graded game and every
branch whose condition reaches reactGames resets that clock inside the same
`updateAfterGame` call (trust.ts:196-238 — promote, demote, AND the ladder-end branches
that move no role at all). So after any call the clocks are provably < reactGames, and the
weekly observation can only fire if a regression keeps the increment while deleting the
reset. Every regression that keeps the reset but breaks the RESPONSE passes green: role
assignment line dropped, wrong ladder index, a trust/personality gate added inside the
branch body (the exact regression the header at trust.ts:5-7 forbids), or ceiling-style
"reset plus nothing" generalized to mid-ladder. The gate also cannot see the DNP burial
path: trust.ts:134-141 returns before any clock movement on min<=0 nights, so a player the
NBA rotation stops playing entirely freezes his clocks forever and "a hot player stays
buried" (CAREER.md:215-217) is unobservable at fleet scale — W67a (docs/REGISTER.md:200)
registers that the rotation owns NBA minutes, but not that this blinds the invariant's
measurement (the phone's promise grievance covers only the promised-role subset). The
substantive invariant is enforced only by the unit tests (approach.test.ts:133-155).
Breaks: gate honesty — the W66 claim "role clocks never sit at reactGames unanswered"
(docs/REGISTER.md:199, CAREER_INTERNALS.md:130-134) is satisfied by construction for the
"answered" half; the acceptance harness cannot fail a build whose world stops responding
as long as the bookkeeping still resets.

## HIGH packages/career/src/circuits.ts:619-624 - playing hurt is unreachable in every phase: a listed player always sits
`meListed` sits me whenever `health.injury && remainingDays > 0`, with no consultation of
the card's `playingHurt` flag, so the designed choice — "gut it out (debuffed dials that
night, wear risk through the real injury model) or sit" (docs/CAREER.md:218-221, and
scope-IN "at real depth" at CAREER.md:385-386) — can never be exercised pre-NBA. The NBA
phase documents the same: nbabridge.ts:28-31 "the franchise availability logic ... sits me
anyway; v1 does not fight it". week.ts:22-23 actively claims the opposite ("gutting a
night out is a per-week decision, re-made while the listing lasts") and week.ts:251-254's
wear accrual for the listed case is unreachable in circuits (a listed player has no line,
so `played` is false). Net: the advertised playing-hurt mechanic is dead everywhere; its
only live effects apply to HEALTHY players (see next finding). Not registered in the
C-register or W67, and no test exercises playingHurt while listed.
Breaks: a documented v1 feature claim (design-law doc), plus the week.ts header's
description of its own behavior.

## HIGH packages/career/src/week.ts:175 - playingHurt on a healthy player disables the injury model entirely
`rollMyInjury` returns before the hazard draw when `playingHurt` is true. The already-
listed case is handled at week.ts:166 (`if (me.health.injury) return`), and circuits never
dress a listed player (previous finding), so the ONLY reachable consumers of this early
return are healthy players who set the flag — which tick.ts:98-105 permits with no injury-
state validation. Consequence: flagging playingHurt every week makes the career player
immune to circuit injuries (the sole pre-NBA injury source), at the cost of the -8 attr
debuff (approach.ts:87-94) and +1.1 wear/game (week.ts:251-254) — wear that itself never
matters because the hazard it multiplies is never rolled while the flag stays on. This
inverts the documented cost ("wear risk through the real injury model",
docs/CAREER.md:218-219) into a shield. Deterministic, silent, untested.
Breaks: the career injury model / the week economy's designed risk surface; an
acceptance-fleet career scripted with the flag would measure zero injuries and read as a
calibration truth.

## HIGH packages/career/src/trust.ts:201,230,236 - silent trust deltas: role-block trust moves bypass the event log and the grade
The promotion branch adds +4 trust (line 201), the ladder ceiling +2 (line 230), the
ladder floor -2 (line 236). None of these enter `delta`, so (a) the `ev-trust` event
(lines 240-248, gated on `delta !== 0`) omits them — the ceiling/floor branches emit NO
event and NO grade note at all (`roleNote` stays empty there), and (b) `grade.trustDelta`
(line 254) understates the night's real trust movement (a promotion night reporting +1.8
actually moved trust +5.8). CAREER.md:426-427 gates "Every trust ... delta carries a
stated reason (a lint over the career event log)", but the lint
(career-acceptance.ts:209-217) reads only rows that exist — an omitted event is invisible
to it, so this class can never go red. A franchise-role player on a permanent heater
silently gains +2 every reactGames games; a garbage-role player in a slump silently loses
-2 — precisely the "random disappointment" pillar 2 (CAREER.md:44-46) excludes.
Breaks: the explained-consequence guarantee and the accuracy of GameGrade.trustDelta
(consumed by career-views.ts:70,358 and the phone's grade texts).

## MEDIUM packages/career/src/trust.ts:55-58 + packages/career/src/stock.ts:243-260,311 - between-seasons production grading runs at the wrong par scale with a zero-attempt efficiency bonus
`parFor` treats `career.circuit === null` as "the NBA phase (scale 1.0)" (comment at
trust.ts:48), but circuit is also null between pre-NBA seasons and through draftPrep —
exactly the windows where stock.ts's between-seasons fallback (stock.ts:305-319) grades
the archived season through `productionScore`. Two composed distortions: (1) an archived
prep/college per-game average is graded against the NBA-scaled role par (HS starter par
jumps 7.2 -> 16); (2) `summaryAvgRecord` builds the synthetic line with fga=0/fta=0
(stock.ts:248), so `efficiencyTerm = 0.7 * pts` — every archived point counts 1.7 instead
of ~1.0 (verified: a 14-6-3 archive line composites 33.25 vs ~20.9 for the same line with
realistic attempts; production 88 vs an honest in-season ~80). The code comment
(stock.ts:239-241) acknowledges only the missing-turnovers "touch generous", not the
dominant +0.7/pt term or the par-scale switch. The two errors partially cancel by accident
at some role/kind combinations and compound at others (college featured: par shift -25
production points vs eff bonus +22). Feeds `productionIndex` -> `blendNowRead` -> weekly
recruiting interest and the draft stock ladder during spring offers and the pre-draft
window.
Breaks: a measurement instrument (the recruiting/stock "tape" leg) in the career's most
consequential decision windows; deterministic but systematically mis-centered.

## MEDIUM docs/CAREER.md:210-211 vs packages/career/src/approach.ts:163-183 - the player-personality bound does not exist anywhere
The design law states "Your personality (set at creation) bounds how far you can push."
No player personality exists: CreationSpec (types.ts:57-72) has no personality field,
creation.ts samples only COACH personality (creation.ts:136-139), and `planFor` shapes
plan width from `coach.personality` alone (approach.ts:171-178). Grep of the package finds
zero player-personality consumers. Nothing bounds the card by any property of the player;
the only bounds are the dial rails [0,100] and the coach's plan. Unregistered: neither the
C-register (CAREER.md:390-405) nor W67's honesty list (docs/REGISTER.md:200) carries this
cut.
Breaks: a design-law claim about the agency core's constraint structure; a reader tuning
plan/deviation behavior from the doc will look for a bound that was never built.

## MEDIUM packages/career/src/approach.ts:38-41 - the assist-response engine gap is "reported upstream" only inside this comment
The playmaking wiring comment records a measured engine defect: box assists are
insensitive to every tendency the card can reach (passOut +/-38 moved ast by -0.07/-0.03;
drive/iso/usage composites worse), needing an engine-side lever ("swingPassOutScale-order"
— the real knob exists at engine sim/params.ts:1023). The comment claims "reported
upstream", but no REGISTER.md row carries it: W67(a)-(h) omit it, and the register's own
pattern for exactly this shape exists (W68 registers a franchise defect found during the
career build). W65's under-assist row is the same engine family but does not name the
career card's dead lever. An engine gap that halves an advertised dial ("Playmaking: hunt
yours to make the extra pass", CAREER.md:204) is process-tracked nowhere a planner reads.
Breaks: the register discipline — unregistered debt on a shipped user-facing dial.

## MEDIUM packages/career/src/circuits.ts:524-569 - shiftForApproach: an unlabeled dead projection source with divergent wiring
`shiftForApproach` is no longer called by any src module (the live projection is
approach.ts#applyApproach at circuits.ts:630 and nbabridge.ts:357 — the ONE-source claim
of CAREER_INTERNALS.md:34 holds for live code), yet it remains exported with a comment
still describing the swap as pending ("Replaced by ... once the approach task lands",
circuits.ts:528-530) and no STAGED/UNWIRED label (AGENTS.md §2.5). Worse than plain dead
code: its wiring CONTRADICTS the canonical table — assertiveness raises the whole shot
diet at half magnitude (approach.ts's does not touch the diet), range omits the rim/mid
starve, motor bumps gambleSteal, defense weights foulAggr 1.0 vs 0.6, playmaking omits the
usage cut — so the "swap is one import" affordance it advertises would silently change
dial semantics. Its only consumer is a test asserting the neutral no-op
(circuits.test.ts:231-235), which cannot see the divergence.
Breaks: repo law (dead-surface labeling) and a second, contradictory statement of the
card's semantics one import away from production.

## MEDIUM packages/career/src/nbabridge.ts:356,410 + packages/career/src/trust.ts:129-130 - NBA-phase card semantics contradict the sticky-card doctrine, and career.approach is frozen post-entry
Pre-NBA, the felt-loop fix made the card sticky (week.ts:14-23, 287-297: dialing "is
setting your game, not burning a one-night token"). The NBA phase keeps exactly the
burn-a-token semantics: gradeMyGames calls `updateAfterGame(career, record)` bare, whose
legacy branch consumes `nextApproach` on the first grade — including on a DNP night, since
the consume (trust.ts:130) precedes the DNP check (trust.ts:134) — and nothing in
nbabridge ever folds a dialed card into `career.approach` (the fold exists only in
week.ts:290-297, pre-NBA). Consequences: (a) post-entry, `career.approach` is unwritable —
a player sims his college-era standing card for every un-dialed NBA game of a 15-year
career; (b) a card dialed for a night the coach DNPs you evaporates ungraded; (c) the
nbabridge header's claim "The card is consumed as a DNP grade that night, which the coach
note explains" (nbabridge.ts:30-31) is false — the DNP note (trust.ts:137) never mentions
the card. Sim-card == grade-card does hold (one game per league day), so the measured
0/100 dishonesty does not recur; this is the phase-inconsistency and the frozen standing
card. CAREER_INTERNALS.md:147-148 documents only the old semantics.
Breaks: the sticky-card doctrine's own rationale applied to the longest phase of the
career; one header claim.

## LOW packages/career/src/trust.ts:151-153 + packages/career/src/approach.ts:135-145 - the +-15 deviation tolerance awards "played the plan" from outside the plan
Deviation is overflow-only (a card AT the plan edge is deviation 0 — edge-riding is free
and optimal, which reads as design: the plan IS the allowed range, with no gradient inside
it). But the trust gain fires for deviation <= 15, i.e. up to 7 points of genuine overflow
still earns +adherenceTrustGain with the stated reason "played the plan" — a factually
wrong note under pillar 2's own standard, and it undercuts the doc's "Playing outside the
plan can win you the night and still cost trust" (CAREER.md:207-209): small excursions
cost nothing and GAIN trust. Deliberate softness would be fine; the note's wording is the
defect.
Breaks: nothing mechanical; the honesty of a stated reason.

## LOW packages/career/src/trust.ts:187-189,134-141,202 vs docs' "consecutive" wording - the role clock is a leaky bucket, not a consecutive counter
Par nights decay the clocks by 1 instead of resetting (trust.ts:187-189), and DNP nights
freeze them entirely (trust.ts:134-141), so `above` can reach reactGames across a
non-consecutive stretch (5 hot, 1 par, 2 hot fires; 5 hot, 30 DNPs, 1 hot fires). Docs and
types say "consecutive" (CAREER.md:423-425, CAREER_INTERNALS.md:35, types.ts:197-200), and
the promotion note asserts "earned over N straight games" (trust.ts:202) — false in the
decay/freeze paths. Direction is safe: the code is strictly MORE generous than the
documented rule, so the invariant can only fire sooner, never later (no acceptance
false-alarm risk); this is wording drift plus one dishonest note string.
Breaks: doc-vs-code consistency on the mode's flagship rule; one stated reason.

## LOW packages/career/src/trust.ts:201 - promotion's +4 trust skips the greenLight recompute the ladder-end branches perform
The ceiling/floor branches refresh `coach.greenLight` after their trust moves
(trust.ts:231,237); the promotion branch does not, so a +4 that crosses greenLightTrust
(78) leaves greenLight false until the next game's line 178. One-game lag on the plan
widening (planFor reads greenLight at the next grade and in the pre-game UI). Bounded,
inconsistent between sibling branches.
Breaks: a one-game window of plan width; branch symmetry.

## LOW packages/career/src/trust.ts:29-35 - ROLE_PAR's franchise anchor example does not match its own composite arithmetic
"a franchise player's 26 is a 25-7-6 night": a 25-7-6 line composites ~32-35 under
composite() at any plausible shooting (verified: TS 55/3 tov -> 35.3 -> production 70,
above promoteAt; TS 50/4 tov -> 32.2 -> 64) — i.e. the comment's example of a PAR night is
actually a promote-adjacent night. A true par-26 night is ~19-21 points with trimmings.
The sixthMan example ("13 is ~12 points with trimmings") checks out. Anchors are FEEL, but
this is the comment future tuners will scale promoteAt/demoteAt against.
Breaks: the anchor comment's arithmetic; no runtime effect.

## LOW packages/career/src/params.ts:87-95 + packages/career/src/approach.ts:21-22,49,64 - approachTendencyMax is documented as a per-dial max but the wiring exceeds it
params.ts calls it "max tendency delta at a dial's extreme (CAL 32)" and approach.ts calls
the weights "fractions of params.trust.approachTendencyMax", yet two weights are 1.2
(range->shotThree, playmaking->passOut): the actual extreme delta is 38 (test-pinned at
approach.test.ts:70-72), and cross-dial stacking (usage: assertiveness +1.0 plus
playmaking -0.4) reaches ~45 combined. The CAL 32 provenance story quotes "the 70 dial's
tendency swing (12.8 points)" — w=1.0 arithmetic that the live 1.2 wiring contradicts
(15.4). Either the A/B measured a different wiring or the narrative numbers are stale.
Breaks: a CAL provenance claim and the parameter's documented meaning; clamping keeps
runtime safe.

## LOW docs/CAREER_INTERNALS.md:36,83-86,147-148 - stale rows against the felt-loop-fixed code
(1) Line 36 says week.ts does "probabilistic integer training landings" — week.ts:25-33
is now a deterministic pity-timer bank ("Zero rng"). (2) The stream registry row
`career-injury:<year>:<week>` (line 86) is stale: the code keys per game,
`career-injury:<gameId>` (week.ts:10-12,177 — itself the fix for the shared-draw defect).
Also `career-train:<year>:<week>` (line 85) is reserved/unused now. (3) The trap row
(lines 147-148) "The approach card is consumed by the FIRST grade after it is set
(nextApproach is for one game)" describes only the NBA-phase legacy path; pre-NBA the card
is sticky and never consumed by grades (week.ts:14-23). Additionally, seedBracket's stream
name is stated two different ways: circuits.ts:17 claims `career-circuit:<year>:bracket`
(what the tests derive, circuits.test.ts:387) while week.ts:268 passes
`career-bracket:<year>` (what the registry row 83 matches) — harmless today because
seedBracket draws nothing, but the two documented names will diverge the day it draws.
Breaks: the determinism/stream documentation and two module-map rows; doc-tier only.

## LOW packages/career/src/nbabridge.ts:509-510 - trade-day grading: the game I played goes ungraded and a phantom DNP lands in the new coach's ledger
`reactToTransactions` runs before `gradeMyGames`, so on a day I am traded, career.nbaTeam
and career.coach are already the NEW team's when the day's games grade: the old team's
game — the one my line is actually in — fails the team filter (nbabridge.ts:407) and is
never graded, while the new team's same-day game (which I was not in) grades as "did not
play; nothing to grade" into the fresh coach's empty ledger, consuming any dialed card and
incrementing the promise-grievance games counter (phone.ts promiseContext counts
grades.length). Bounded to trade days; "the new coach doesn't grade old tape" is
defensible, the phantom DNP and burned card are not.
Breaks: one grade record and the grievance counter's first tick on trade days.

## What is done well

- The explicit-card threading fix is exemplary measurement hygiene: week.ts captures the
  week's card once, the projection and every grade read the same object, and the tests pin
  both the new path and the preserved legacy path with the measured defect (0/100
  adherence alternation) named in the comment (week.ts:14-23, trust.ts:110-120,
  approach.test.ts:189-210).
- The mid-ladder invariant implementation honors its own law: no trust gate, no
  personality gate, symmetric up/down, and the unit suite proves it both directions —
  including a low-trust promotion test written specifically against the tempting
  regression (approach.test.ts:133-155).
- PAR_SCALE_BY_KIND is a measured repair with honest provenance: the comment records the
  failure it fixes (a 13.9-ppg circuit leader never touching promoteAt, zero role moves in
  two seasons), anchors the FEEL value between two measurements, and the circuit-true
  tests prove the invariant fires in HS AND that the same line stays quiet at NBA pars
  (trust.ts:37-52, approach.test.ts:238-272).
- EFF_WEIGHT's comment arithmetic is exactly right (12 true attempts at TS 35 = -2.52;
  an efficient night ~ +0.84), and the chucker tax is both priced and NAMED only when it
  bites, with tests for firing and not firing (trust.ts:61-79,171-176,
  approach.test.ts:212-236).
- applyApproach/applyLegs are clean pure projections — source never mutated (JSON-snapshot
  tested), tendencies-vs-attributes separation strict, and circuits.test byte-compares the
  job projection to the canonical function including teammate isolation
  (circuits.test.ts:213-229).
- The playmaking wiring comment is a model of recording a negative result: what the A/B
  measured, why louder wiring is the wrong fix, and what the dial now honestly expresses
  (approach.ts:29-41) — the register row is the only missing step.
- The per-game injury stream fix (doubleheader shared-draw halving hazard) shows real
  stream-key discipline with the incident cited where it lives (week.ts:8-12,155-162).

## Verified sound

- EFF_WEIGHT comment claims verified numerically: 12 TA at TS 35 -> -2.52 (~-2.5 as
  claimed); TS 55 -> +0.84 (~+1); the composite's efficiency zero-point sits exactly at
  TS 50 (pts == trueAttempts).
- productionScore: clamped [0,100], rounded once, DNP-guarded both in itself (min<=0 ->
  0) and by the caller's early return; the 2.2 slope comment (10 over par ~= 72) is exact.
- Role clocks are mutually exclusive by construction (an above-increment zeroes below and
  vice versa; decay only decreases), so the four-way else-if role chain cannot double-fire
  and at most one branch runs per game; post-call clocks always < reactGames (the flip
  side of the gate finding).
- Ladder arithmetic: promotion/demotion move exactly one rung, indices guarded at both
  ends; trust clamped [5,99] at every write in trust.ts.
- deviationFrom: overflow-only, per-dial, clamped [0,100]; a neutral card grades deviation
  0 against the fixture starter plan, and correctly grades a mild deviation (~30, no trust
  loss) against a garbage-role plan whose centers sit below 50 — coherent "playing normal
  is mild insubordination for a mop-up role" behavior.
- planFor: ends clamped to [0,100]; widths strictly monotone garbage->franchise (10..54);
  green-light bonus additive; systems-coach range narrowing applies after the bonus
  (deliberate per comment shape).
- WIRING mass balance: range's shot-diet mass roughly conserves identity (+1.2 three vs
  -1.1 rim+mid, pullUp being a style not a diet key); playmaking trades usage/iso for
  passOut; per-key clamp(round(...), 0, 100) after each dial; fixed APPROACH_DIALS
  iteration order keeps rounding deterministic.
- The card never touches attributes except playingHurt, and the whole-sheet debuff cannot
  touch physique: heightIn/weightLb/wingspanIn are top-level FrPlayer fields, not attr
  keys (franchise types.ts:209-222) — confirmed, with the test pinning attr.three.
- ONE live projection source confirmed by grep: applyApproach called only from
  circuits.ts:630 and nbabridge.ts:357; shiftForApproach has no src callers; applyLegs
  applied only in the circuits ME projection (attributes only, tendencies untouched,
  linear and exact at floor/2 per test).
- NBA-phase par sanity spot-checked: a bench player's quiet 10-minute night reads ~52
  (neutral, decays clocks), a garbage-role empty night ~46 (not a demotion), the promote
  bar for bench requires a genuinely outsized night — no par-scale pathology for small
  roles at scale 1.0; a franchise player producing 12-point nights correctly accrues
  demotion pressure.
- stock.ts's LIVE production window feeds only min>0 lines (myGames filters), so DNP
  zero-scores never pollute the in-season tape (the between-seasons fallback is the
  finding above).
- Grade/event ids are unique per game (`ev-role-/ev-trust-<record.id>`); DNP grades push
  a note (lint-visible) and phone deliberately skips texting them while counting them for
  the promise grievance — a coherent, commented choice.
