# verify-late — adversarial re-check of 9 career/franchise findings

Method: every cited line re-read at HEAD; counter-evidence hunted in tests,
REGISTER.md (W1-W73), the C-register (CAREER.md C1-C15), and in-code
disclosures; one pure-compute probe re-run (item 5, 90 fresh seeds via the
real `createCareer` through `tools/register.mjs`). No engine games simulated.

## 1. career-app CRITICAL — /api/career/save not gated on the running career sim

**VERDICT: CONFIRMED.** `/api/career/save` (packages/app/src/server.ts:230-237)
has no `state.careerSim.running` check while every sibling mutation does
(new :195, load :213, choice :306, advance :315); the client masthead save
button and the `s` hotkey call `api.careerSave()` with no `advancing` guard
(app.js CAREER_KEYS + `btn-save`; only the two advance buttons are disabled).
The advance loop runs as a detached promise over a real worker pool
(server.ts:713 makeWorkerPool, :158 await advanceCareerWeek), and the week
mutates across genuine yield points — `resolveAllocation` debits
energy/banks training BEFORE `await sim(jobs)` (week.ts:227 vs :238; NBA
twin nbabridge.ts:499 before the 7× awaited day loop :501-511) — while the
clock increments only at the end (career/tick.ts:478), so a synchronous
`saveCareer` (saves.ts writeFileSync) landing between awaits serializes a
paid-but-unplayed week; reloading and advancing re-runs the same week
(double allocation) and, on the NBA path, advances 7 more league days from a
mid-week league position (permanent career/league drift). The finding's own
mitigation note (end-of-run autosave overwrites the same name; the torn file
survives save-and-quit or the error path, server.ts:318-321) is accurate, as
is the untestability note (career-acceptance.ts drives `advanceCareerWeek`
directly, never HTTP). Franchise twin `/api/save` (server.ts:456-463)
confirmed: it 409s under a career but has no `state.sim.running` check.
Not registered anywhere (W66-W68, C1-C15 silent).

## 2. career-app HIGH — /api/trade/evaluate mutates the mounted career league

**VERDICT: CONFIRMED** (and slightly understated). The route
(server.ts:559-564) is the only franchise POST without a `state.career` 409
(compare /api/sim/advance :538, /api/action :550, and even /api/save :457);
while a career is mounted `state.league = state.career.league`
(server.ts:205, 220). `respondToOffer` writes `league.negotiations` on
essentially EVERY path past legality — untouchable :317, walk-away :344,
counter :358, no-bridge fallback :362, and also ACCEPT :327 (broader than
the finding's three named paths) — its own docstring says "Mutates ONLY
league.negotiations" (ai/trade.ts:277-279), and cooldowns steer future AI
behavior (:298-300, :398). saveCareer serializes the whole `career` object
(career.league.negotiations included), and autosaves fire on every ok choice
and advance (server.ts:310, 318-319), so the un-logged perturbation
persists and `career ≠ f(seed, choiceLog)`. protocol.ts documents the route
as "(no execution)" and frames the career mount as read-safe. Reachable by
any HTTP client regardless of the hidden trade screen (the hash router does
no mode check).

## 3. career-app HIGH — NBA-phase approach card is a one-shot; documented UI resend does not exist

**VERDICT: CONFIRMED**, all four links verified. (1) `advanceMyGameDay`
reads `career.nextApproach ?? {...career.approach}` per game day
(nbabridge.ts:356). (2) `gradeMyGames` calls `updateAfterGame(career,
record)` with no card (nbabridge.ts:410), taking the legacy path that
consumes `nextApproach` on the FIRST grade (trust.ts:129-130) — and the
consume precedes the DNP early-return (:134), so a DNP burns the card.
(3) The only writer of `career.approach` in the package is the pre-NBA
week-end fold (week.ts:292; resolveNbaWeek has no fold), so post-entry the
standing card freezes at whatever the last pre-NBA week folded. (4) The doc
trap "the UI resends per game night" (CAREER_INTERNALS.md Traps) is
fictional: the only UI sender is the plan screen (plan.js:99), the advance
loop posts no choices, and /api/career/choice 409s while the loop runs
(server.ts:306), so a per-game resend is impossible during 'sim ahead'. The
acceptance harness resends only while `career.circuit` is live
(career-acceptance.ts:161-162), so no gate exercises the NBA card path; the
legacy semantics are even test-pinned as "the NBA bridge contract"
(approach.test.ts:203-208). Net: one dialed card affects exactly one NBA
game; every other game of the mode's longest phase sims and grades on a
college-era card.

## 4. career-create HIGH — the body "tradeoff surface" does not exist

**VERDICT: CONFIRMED.** CAREER.md ("Creating him") promises "height and
wingspan raise defense and rebounding priors and tax speed and handling
priors, exactly as the engine prices them" — neither half exists. `buildMe`
(creation.ts:398-489) computes every attribute from budget + shape +
background + noise; `heightIn/weightLb/wingspanIn` are stored on the player
only (:475-477). Engine-side, every body consumer is monotone upside at
fixed dials: `reachFt` (derived.ts:72-75, both partial derivatives
positive) feeds contest/finish; the rebound blend adds
`heightIn * blendHeightPerIn` with the knob at +0.45 (resolve.ts:471-472,
params.ts:1640); screener score (+height, actions.ts:209) and tip-offs
(+height, possession.ts:40,73) likewise; speed/accel/lateral curves are
attribute-only (derived.ts:24-52). Only defense.ts:30 sorts by height+weight
for matchup ASSIGNMENT — routing, not a stat tax. The sole body constraint
is the attribute-consequence-free weight plausibility band
(creation.ts:356-368), and creation.ts:73's comment does frame bounds as
the tradeoff. Max height + max wingspan is strictly dominant at creation.
No C-register row or W67 item claims this cut.

## 5. career-create HIGH — hidden-ceiling floor over the PRIOR; coach's-son can ship a dead development group

**VERDICT: CONFIRMED-WITH-CORRECTION** (incidence ~2%, not the reader's
3/30 ≈ 10%). Code confirmed: the ceiling floors over `groupPrior` (base +
alloc + GROUP shift only, creation.ts:277-280) at prior+2 (:444-446), while
the realized sheet also carries background SINGLE-DIAL shifts (:414 —
coach's-son passVision +6 on the 3-dial playmaking group ⇒ mean ≈ prior+2)
and noise; gen.ts by contrast floors potential at the REALIZED group mean
(gen.ts:343-346). Downstream both consumers verified: dev review skips the
group forever at headroom ≤ 0 (dev.ts:221) and training banks nothing
(week.ts:96), with the near-miss crawl real too (headroomF = headroom/12,
dev.ts:227). Re-probe with the real `createCareer`, fourstar: coach's-son
2/90 dead (one at potential 61 = mean 61.00, one at potential 60 < mean
60.67), playground 1/60 (potential 60 vs mean 61.33 — BELOW the realized
mean), plus 2-3% more at crawl headroom ≤ 3. So the mechanism, the
potential-below-mean worst case, the contract violation (creation.ts:103
"creation always leaves something to develop"), and the test blind spot
(creation.test.ts:189-194 asserts headroom only for the aau build, whose
bg.attrs is empty) all hold — but the measured rate was a small-sample high
draw; state it as ~2% of coach's-son/playground creations. Severity HIGH is
still defensible (permanent, silent, on the background's advertised
strength); MEDIUM-HIGH honest.

## 6. career-trust HIGH — silent trust deltas at trust.ts:201/:230/:236

**VERDICT: CONFIRMED** (one precision note). All three moves verified at
exactly the cited lines: promotion `coach.trust + 4` (trust.ts:201), ladder
ceiling +2 (:230), floor -2 (:236) — none enters `delta`, so the `ev-trust`
event (:240-248, gated `delta !== 0`) and `grade.trustDelta` (:254) omit
them; a promotion night inside the plan-but-not-adherent band reports +1.8
(productionTrustGain, params.ts:254) while trust moved +5.8 — the finding's
arithmetic is exact. The ceiling/floor branches themselves emit no event and
no roleNote (verified); precision: a ceiling night necessarily carries
production ≥ promoteAt, so an ev-trust event for the night EXISTS but
understates by +2, whereas the floor path can net delta 0 (mid-deviation
demoteAt night) and move trust -2 with NO event at all — the fully-silent
case is real on the floor side. The explained-consequence lint
(career-acceptance.ts:208-217) only checks that EXISTING rows have
non-empty reasons, so this class can never go red, while CAREER.md's hard
gate claims "Every trust ... delta carries a stated reason." trustDelta is
consumed by career-views. Unregistered.

## 7. career-phone HIGH — morale-backed choice outcomes have no consumer; the stated consumer is fictional

**VERDICT: CONFIRMED.** The 9-of-13 count is exact (applyPhoneChoice,
phone.ts:1844-1953): media-lean/team/shrug, reply-won/reply-lost/rival-mute,
family-stay, promise-let-go, promise-demand mutate only morale + the event
log; the real four are visit-yes/no (recruiting rung/perceived), family-go
(energy), promise-make-known (coach.trust). Grep of packages/career/src
confirms morale is only ever WRITTEN (creation.ts:484, week.ts:144,
nbabridge.ts:918/922, phone.ts:1841; nbabridge.ts:343 is the swap
reconcile) — approach.ts, the game-night projection the comment at
phone.ts:1926-1928 names as the reader, contains zero morale references, so
the named consumer is fictional. Franchise-side: `updateDispositions`
recomputes `player.morale = moraleFor(league, player)` statelessly for every
rostered player (disposition.ts:183-185, no careerControlled anywhere in the
file; the skip exists only at fa.ts:284/:400, retire.ts:116, tick.ts:413)
on the 7-day cadence (tick.ts:78, 869-871), erasing career writes within a
week post-entry; types.ts:229 documents morale as "drives
requests/decisions only". Partial adjacency to registered debt: C14/W67(b)
registers trade REQUESTS as morale-only — the phone-choice inertness, the
fictional comment, and the weekly erasure are registered nowhere.

## 8. franchise-seams HIGH — aiRosterUpkeep signs/converts careerControlled players; abroad me is signable; no 'signing' arm

**VERDICT: CONFIRMED.** `aiRosterUpkeep` (ai/roster.ts:209) contains no
careerControlled reference (file-wide grep): the roster-floor fill
(:222-231) runs daily outside moratorium/freeAgency (tick.ts:849, gate
:212) and signs from `minimumMarket` (:180-192), which filters only
status/injury/RFA/offer-sheets and sorts by ability — so an abroad career
player is at or near the top. The abroad state shape verified:
`applyAbroadOffer` waives me if rostered (executeWaive sets status
'freeAgent' and pushes into league.freeAgents, transactions.ts:177-179) and
deliberately keeps me in league.players (nbabridge.ts:874-885), while
euro/china weeks run `fastDays` → `advanceDay` → upkeep (career/tick.ts:473),
so the path is live every abroad week. The two-way conversion (:234-264) is
reachable on me because `applyNbaOffer`'s below-minimum tier signs a real
twoWay contract (nbabridge.ts:789-801). `reactToTransactions`
(nbabridge.ts:370-398) handles only trade/waive/optionDecision/coachChange —
executeSigning's 'signing' row (transactions.ts:138) is invisible to the
career, so path 1 is fully silent and path 2 surfaces only the waive half.
Both the frozen contract (types.ts:701-705 "the FA market never signs them
to a decision") and CAREER_INTERNALS' seam list are violated/overstated;
nothing in W66-W68 or the C-register discloses upkeep as a signing path.

## 9. franchise-seams HIGH + career-nba HIGH (union) — the retire choice never retires me league-side

**VERDICT: CONFIRMED**, both claims' union. `applyChoice('retire')`
(career/tick.ts:180-187) flips `career.clock.phase` and builds the epilogue
only — grep confirms zero `executeRetirement` (or any status write) in
packages/career/src, no roster guard, and `career.nbaTeam` is not cleared.
The world can never clean up: runRetirements skips careerControlled
unconditionally (retire.ts:116) and the FA market skips me (fa.ts:284),
while `runDevelopmentReview`/`applyAging` gate only on `status === 'retired'`
(dev.ts:286, 316) — never set — so dev and aging run on the "retiree"
forever. Mid-contract, status stays 'roster': the retired-phase loop
advances whole seasons (tick.ts:426-443) and fastSim generates box lines
for the top 8 of every roster (fastsim.ts:26-41), so the ghost keeps
playing and accruing season rows; once a free agent, he sits in
league.freeAgents where item 8's upkeep fill can legally re-sign him
(minimumMarket has no list filter). The ghost-harvest corroboration holds:
`harvestSeasonHonors` runs every retired-year tick (tick.ts:440) and its
award branch (epilogue.ts:42-47) has no was-I-there gate, so
post-retirement awards harvest into the legacy score; the ring branch stays
reachable because retire never clears `career.nbaTeam` (post-retirement it
is gated by the weaker ledger-substring `wasMySeason`, not the
phase-shortcut — a shade narrower than career-nba's "stays armed" but the
mechanism stands). CAREER.md's "after retirement the save stays alive"
world contains an unretirable me. Unregistered (W67's honesty list and
retire.ts:112-116's disclosure cover the WORLD-side skip, not the missing
career-side execution).

## Summary

| # | Finding | Verdict |
|---|---------|---------|
| 1 | /api/career/save ungated mid-run → torn save, double allocation, league drift | CONFIRMED |
| 2 | /api/trade/evaluate writes negotiation memory onto the mounted career league | CONFIRMED |
| 3 | NBA-phase approach card one-shot; documented UI resend fictional; approach frozen post-entry | CONFIRMED |
| 4 | Body tradeoff surface does not exist (buildMe + engine both) | CONFIRMED |
| 5 | Ceiling floor over prior; coach's-son/playground can ship dead groups | CONFIRMED-WITH-CORRECTION (rate ~2%, not ~10%; mechanism, worst case, consumers all verified) |
| 6 | Silent trust deltas (+4/+2/-2) bypass delta, events, and grade.trustDelta | CONFIRMED (floor path can be fully event-less; ceiling night's event exists but understates) |
| 7 | 9/13 phone outcomes morale-only; morale never read; recompute erases; fictional comment | CONFIRMED |
| 8 | aiRosterUpkeep fill/conversion no careerControlled skip; abroad me signable; no 'signing' arm | CONFIRMED |
| 9 | Retire choice never retires me league-side; ghost seasons + upkeep re-sign | CONFIRMED |

Counts: 8 CONFIRMED, 1 CONFIRMED-WITH-CORRECTION, 0 OVERSTATED, 0 WRONG,
0 KNOWN-DEBT.
