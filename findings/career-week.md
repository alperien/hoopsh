# career-week

scanned: packages/career/src/week.ts (302), packages/career/src/tick.ts (493),
packages/career/src/fastsim.ts (59), packages/career/test/spine.test.ts (220),
docs/CAREER_INTERNALS.md (152), docs/CAREER.md (475); read for seams:
career/src/{params,types,approach,trust,circuits(§§ used by week),nbabridge(§§),
stock(enterDraftClass),epilogue}.ts, franchise/src/{people/injury.ts,
people/disposition.ts,people/dev.ts(distributeGrowth),calendar.ts,tick.ts(§§),
gameday.ts(§§),params.ts(injury)}, app/src/server.ts (career routes).

critical: 0   high: 3   medium: 7   low: 6

## HIGH tick.ts:86 - applyChoice throws TypeError on malformed payloads, breaking its own "never throws" contract
`case 'setWeekPlan'` reads `choice.plan.slots` (tick.ts:85-86) and
`case 'setApproach'` reads `card[d]` inside `validCard` (tick.ts:60, called at
:99) without guarding the container object. A payload of
`{ kind: 'setWeekPlan' }` or `{ kind: 'setApproach', card: null }` throws
`TypeError: Cannot read properties of undefined/null` — verified by direct
probe (4 of 16 malformed shapes threw; the other 12 kinds deny gracefully,
including nbabridge's four, which wrap their executors in try/catch). The
module header (tick.ts:76-77) promises "never throws for a bad input, returns
the errors instead", and CAREER_INTERNALS.md:37 repeats "never throws on bad
input". The payload arrives over the network: server.ts:307-309 casts the JSON
body (`body.choice as CareerChoice`) and calls applyChoice with only a
truthiness check on `choice`, so the two most common choice kinds are a
malformed POST away from an unhandled throw. No state is mutated before the
throw (validation-first), so this is a crash, not corruption.
Breaks: a documented guarantee of the choice spine; the career API's
robustness claim.

## HIGH tick.ts:397 - descent-Europe careers are funneled back into draftPrep: the showcase-route guard cannot distinguish a veteran
`transitionAtYearWrap` sends `(phase === 'euro' || phase === 'nbl') &&
career.nbaTeam === null && !career.epilogue` to draftPrep, with the comment
"the showcase route only: a descent veteran abroad is not a prospect". But the
only way to reach the euro phase post-NBA is applyAbroadOffer, which
unconditionally sets `career.nbaTeam = null` (nbabridge.ts:874) — so a
34-year-old, 12-season NBA veteran who signs in Europe has exactly the
signature of an 18-year-old showcase kid. Consequences at his first year wrap:
phase flips to draftPrep ("automatically eligible", tick.ts:400); he gets a
combine week at tick.ts:463 and a draft night at :466-467 whose drain
(drainToDraft) jumps the league forward; enterDraftClass no-ops (he is already
in league.players, stock.ts:801) so he is not in the class and the wire posts
"sixty names, none of them yours: undrafted" for a decorated vet; multi-year
European descents are impossible (one season, then draftPrep pinball); the
age-40 forced retirement at tick.ts:404 is unreachable for euro (the :397
branch always returns first) — and he cannot even choose retirement, because
`retire` is denied outside nba/china (tick.ts:181). China (not in the :397
guard) works as designed, which shows the intended shape. Contradicts
docs/CAREER.md:324-333 ("The China and Europe forks... real late-career forks
with real ledger consequences", retirement chosen during the descent).
Breaks: the descent design for the Europe fork; the career-shape band
("career shapes match the researched reality"); epilogue timing.

## HIGH week.ts:251-255 - "playing hurt" is unreachable in every phase; the wired code only fires backwards, for a healthy player
The designed mechanic (docs/CAREER.md:217-221, and the v1 in-scope register
:381-388 "playing-hurt choices on the real wear model") is: carry a listed
injury and choose to gut it out or sit. Neither phase can produce it:
- Circuits: projectCircuitTeam sits a listed me unconditionally
  (circuits.ts:619-624, `meListed` has no playingHurt override). Probe
  confirmed: listed + `playingHurt: true` card, me dressed=false in both
  jobs of the week.
- NBA: nbabridge.ts:28-31 says outright "the franchise availability logic
  sits me anyway; v1 does not fight it".
So `played && me.health.injury` is impossible, and week.ts's playing-hurt
branches are live only for the one case the design never meant: a HEALTHY
player whose card sets playingHurt (nothing validates the flag against a
listing — tick.ts:102 accepts it always). That player gets the whole-sheet
playHurtDialDebuff (approach.ts:87-94), pays +1.1 wear per game
(week.ts:251-254, `playHurtWearMult * 0.5`), and — backwards — SKIPS his
post-game injury roll entirely (week.ts:175 returns before the draw). The
`me.health.injury` disjunct at :251 is dead code in circuits. Neither
CAREER.md's C-register nor CAREER_INTERNALS registers the cut; only the
nbabridge header admits half of it.
Breaks: a registered v1 feature; the wear-model claim; the injury-roll
semantics for anyone who touches the flag.

## MEDIUM week.ts:220-225 - post-entry, resolveWeek's weekly -7 stacks on the league's daily recovery tick: injuries heal at 14 days/week
resolveWeek decrements `me.health.injury.remainingDays -= 7` per career week.
After league entry I live in league.players (the abroad seam keeps the SAME
object in both pools — nbabridge.ts:881-885), and every non-NBA week also runs
`fastDays(7)` (tick.ts:472-474), whose advanceDay calls franchise
advanceRecoveries daily (injury.ts:167-182, no careerControlled exclusion) —
another -7. Any resolveWeek-routed phase after entry double-decrements: the
china descent, the (already broken, see HIGH tick.ts:397) euro descent, and
the undrafted draftPrep weeks after enterDraftClass. A moderate injury
(7-24 days) becomes a one-week absence; a season-ender (81-240 days) heals in
half its sentence. Pre-entry phases are clean (I am not in league.players);
the NBA phase is clean (nbabridge defers to the franchise clock, header
:25-27).
Breaks: injury out-time realism in descent/undrafted phases; the
"severity and time out ride the same franchise tables" claim (week.ts:181-186
sets the right outDays, then the clock runs double).

## MEDIUM week.ts:148 - the off-season allocation has a strictly dominant strategy: energy is only consumed by game nights
Verified arithmetic (defaults): weekly delta = +30 base - 12 practice - slot
costs; triple-extraWork = -30/week, clamped at 0 (week.ts:148). Every energy
tooth is game-gated: the hazard multiplier fires only inside rollMyInjury
(week.ts:172-174, post-game only), the legs tax only inside the circuit
game projection (approach.ts:104-108 via circuits.ts:631). In any week
without games — the ~20+ off-season weeks of every pre-NBA year, plus all of
draftPrep — energy at 0 costs literally nothing, and the clamp forgives
arbitrarily deep deficits (a -30 week from energy 2 lands at 0, same as a -3
week; no debt carries). So triple-extraWork off-season banks 0.45 pts/week vs
0.30 for the "responsible" eW/eW/rest plan, at zero cost, and two triple-rest
weeks (+93/week) restore 0→100 before the opener. The in-season economy is a
real tradeoff (measured: grind pins energy at 0 in 4 weeks → full -8 legs
debuff + 1.8x hazard raising a 14-game season's injury probability from 7.5%
to 13.1%) — the A/B in params.ts:67-74 fixed exactly this in-season, but the
off-season half of "Overtraining is allowed and it hurts" (CAREER.md:180) has
no teeth at all. The floor-warning event (week.ts:149-151) fires weekly with
no consequence attached.
Breaks: the week economy's design claim in off-season weeks; the acceptance
band "the energy economy holds off the floor" grades a number that is optimal
to leave ON the floor half the year.

## MEDIUM week.ts:144 - the life slot has no mechanical consumer anywhere; gradesFloor is unwired and unlabeled
`life` adds lifeMoraleGain to me.morale. Pre-NBA nothing reads it: the circuit
projection (circuits.ts:614-710) projects attr/tend only, franchise gameday
never reads morale, dev.ts never reads morale, and career phone.ts only
WRITES morale (no read anywhere; its own comment at phone.ts:1927 claims
"morale is read by the game-night projection", which is false in both
projections). Post-entry it is worse: franchise updateDispositions recomputes
`player.morale = moraleFor(league, player)` statelessly for every rostered
player every 7 league days (disposition.ts:183-186, tick.ts:869-871, no
careerControlled exclusion), so the +4 is overwritten within a week.
Meanwhile params.week.gradesFloor ("FEEL 2 life slots/month keeps eligibility",
params.ts:82/:247) is consumed by zero lines of code and carries neither a
STAGED nor an UNWIRED label (AGENTS §2.5). Together the slot is pure flavor,
against CAREER.md:183-184: "Nothing here is a meter for its own sake. Every
slot lands in a system that already exists: development reviews, wear,
morale, trust."
Breaks: repo dead-surface law (gradesFloor); the week-economy design claim;
one of six slots is a strictly dominated choice.

## MEDIUM tick.ts:277-285 - foldSeason's catch swallows real summarize defects into a silently zeroed season
The catch around summarizeCircuit writes a fallback CircuitSummary (teamName
'', 0-0, all-zero myLine, finish 'season over', no honors) and carries the
stale scaffolding comment "circuits task lands summarize" — that task landed;
summarizeCircuit exists and is the normal path. Any future defect in it now
degrades invisibly: the zero row still counts toward college eligibility
(tick.ts:386 counts kind==='college' rows), pollutes seasonsPlayed
(epilogue.ts:82), erases the season's honors from the legacy score
(epilogue.ts:58-70 reads honor events that were never pushed), and the career
page shows a blank line — with no error event, no throw, nothing for the
"careers complete without throwing" gate to catch precisely because the throw
is eaten here.
Breaks: silent-corruption path into circuitHistory, eligibility counting, and
the legacy/HOF inputs; AGENTS §2.5 (misleading dead-ish surface).

## MEDIUM docs/CAREER_INTERNALS.md:85-86 - the stream registry is wrong on two rows and missing a stream that draws
The registry claims to collect all career streams ("documented in their owning
module headers and collected here", :73-77). Against code:
- :86 lists `career-injury:<year>:<week>`; the code draws
  `career-injury:<gameId>` (week.ts:177), a deliberate fix the week.ts header
  documents (:9-13, the doubleheader shared-draw defect) — the registry was
  never updated.
- :85 lists `career-train:<year>:<week>` as live "training landings"; week.ts
  draws nothing on it (the pity timer is deterministic; week.ts:8-9 says
  "reserved") — unlike the bracket row (:83), the reserved status is not
  recorded.
- `career-next-coach:<phase>:<year>` (tick.ts:307, installNextCoach: 2 int
  draws per phase transition) appears in NEITHER the registry NOR tick.ts's
  own header stream list (:20-22) — an undocumented randomness source under
  the registry doctrine.
- Bonus latent drift: circuits.ts:17 names seedBracket's reserved stream
  `career-circuit:<year>:bracket` while the actual call passes
  `career-bracket:<year>` (week.ts:268; registry :83 matches week.ts).
Breaks: the determinism audit trail — the registry is the document an auditor
must be able to trust about where every draw comes from.

## MEDIUM fastsim.ts:22-24 - pre-entry standings carry zero team-strength signal; C11 registers crude box scores but sells "standings real"
Each side's final is an independent Uniform(95..129) draw regardless of the
rosters on the job (`95 + rng.int(35)`, ties +1 home): every game is a coin
flip, so over a 174-day season every team's win total is Binomial(~82, .5),
sd ≈ 4.5 wins — no 60-win or 20-win teams exist until I arrive (real
team-win sd is ~12). Playoff seeds, lottery order (and therefore which teams
pick high in the classes around mine), persona timeline reevaluation, and
nbabridge's pickContender (standings pct) all consume this noise. The C11
register (CAREER.md:404, fastsim.ts:2-5) is honest about box scores
("statistically crude") but claims "structure (standings, lotteries, draft
classes, transactions) is real" — the machinery is real, the signal is zero,
and that distinction is nowhere registered. Secondary crudeness, honestly
assessed as FEEL-labeled: player lines are internally inconsistent with team
totals (lines sum fga ≈ 0.85·pts ≈ 95 vs totals fga = 88; fgm 0.38 vs 0.37;
line identity 2·fgm+tpm+ftm ≈ 1.02·pts), OT is always 0, pace always 98.
Confirmed MY games never route here: tick.ts uses fastSim only for
fastDays/drain/retired-year advancement; circuit and NBA weeks take the
caller's sim (week.ts:239, nbabridge).
Breaks: the plausibility of the league hierarchy I get drafted into; the C11
register's "structure is real" framing.

## MEDIUM packages/career/test - rollMyInjury has zero test coverage: the hazard seam could regress silently
No test in the career suite exercises my post-game injury roll: not the
energy-cliff multiplier (week.ts:172-174), not the severity CDF walk
(:182-183), not the outDays/wear application (:186-197), not the per-game
stream keying that the header advertises as a measured defect fix (:9-13).
spine.test.ts:172-186 tests only the recovery clock (heals on schedule); the
grep for injury/hazard across career/test confirms nothing else touches it.
A regression — hazard computed as 0, the 1.8x multiplier inverted, the
severity thresholds shuffled — passes `npm test`; the acceptance harness's
energy band is reported, never fatal (CAREER_INTERNALS.md:136-140).
Breaks: gate honesty for the injury half of the week economy.

## LOW week.ts:197 - my wear accrual is uncapped where the franchise caps at 100
`me.health.wear += inj.wearBySeverity[sevIdx]!` (:197) and
`me.health.wear += playHurtWearMult * 0.5` (:253) have no ceiling; franchise
code writes `Math.min(100, wear + ...)` (injury.ts:154) and types.ts declares
wear "0-100" (franchise types.ts:122). Wear past 100 extrapolates hazardFor's
wearF, dev's wearDeclineFactorAt100 curve, and retire.ts's wear term beyond
their calibrated domain. Reachable only through many majors plus the
(currently backwards, see HIGH week.ts:251) played-hurt compounding; bounded.
Breaks: the 0-100 wear contract on long careers.

## LOW docs/CAREER_INTERNALS.md:36 - week.ts row and the approach trap describe the pre-fix mechanics
Two claims the code has moved past: (a) ":36 probabilistic integer training
landings at the calibrated rate" — landings are deterministic bank-crossings
now (week.ts:25-33, "Zero rng: the pity timer cannot be streaky");
(b) :147-149 trap "The approach card is consumed by the FIRST grade after it
is set (nextApproach is for one game); the UI resends per game night" — the
card is sticky per week and folds into the standing approach (week.ts:14-23,
:287-297); types.ts:395 carries the same stale "for the next game only"
comment. Following the stale trap is harmless (resending is idempotent) but
the trap section exists precisely to be trusted.
Breaks: doc-vs-code trust in the internals map.

## LOW docs/CAREER_INTERNALS.md:66 - the two-clocks drift arithmetic says seven; the params say 6.14
With leagueDaysPerWeek 7 and weeksPerYear 52 (params.ts:310-311), pre-entry
advances 364 fast days per career year against a 313-day league season
(calendar.ts: 20+174+4+60+1+4+10+40 = 313, verified). Excess 51 days/year →
one extra league season every 313/51 = 6.14 career years, not "roughly one
season per seven career years". The likely error: 364/51 = 7.14 measures
career-years-per-... nothing — the correct per-career-year figure is 6.14.
Additionally every draftPrep year's drainToDraft (tick.ts:231-240) jumps the
league to its next draft "however far that is" (up to ~a season), so the
stated rate is a floor, not the drift. Registered consequence, wrong number.
Breaks: a registered-consequence claim in the internals doc.

## LOW tick.ts:442 - digest event lists are approximate in two places
(a) The retired-year branch reports `career.events.slice(-4)` — a fixed
window that can include events from before the advance (when legacy+harvest
push fewer than 4) or drop extras (when they push more). (b) foldSeason
appends only the LAST pushed event id to the digest (:287) — when a summary
carries honors, the 'phase' event and all but the final honor id are missing
from digest.events (resolveWeek closed its slice before foldSeason ran,
tick.ts:459-460). State and event log are correct; only the digest (the UI's
week readout) under/over-reports.
Breaks: WeekDigest fidelity, not state.

## LOW week.ts:156-158 - header overstates the franchise-form match; injury kinds are a private 4-entry catalog
Nits against the cited source (people/injury.ts): the header says age,
proneness, wear are "each floored at 0.25" — hazardFor floors only proneness
and wear (the age factor is ≥ 1 by construction, injury.ts:88); the hazard
ceiling here is 0.5 (:178) vs franchise 0.95 (:95, a guard, stricter is
fine); the kind/label table hardcodes one kind per severity including
'foot-stress', which does not exist in the franchise INJURY_CATALOG
(injury.ts:50-69 has foot-fracture/foot-soreness), so my injuries are always
the same four stories while the league's use a 16-entry weighted catalog.
Severity mix and outDays genuinely do ride the franchise tables (verified
against params.injury [0.62,0.26,0.09,0.03] and the CDF walk at :183). Also
:163-174 computes the full hazard before the playingHurt early-return at
:175 — wasted work only.
Breaks: header precision; injury-story variety (the repeated-generic-events
killer the design says it excludes).

## LOW tick.ts:181 - a perpetually undrafted player has no exit: retire is denied, and draftPrep never ages out
`retire` requires phase nba or china; transitionAtYearWrap has no draftPrep
branch and its age-40 forced retirement covers only china/euro/nbl
(tick.ts:404). An undrafted player who declines or ignores every offer loops
combine week + draft night (with its league drain and a fresh "sixty names,
none of them yours" event) every year at any age, and can never reach the
epilogue. The two-way offer floor in buildMyOffers (nbabridge.ts:632-641)
means a door always exists, so this needs deliberate idling — but the state
machine offers no terminal transition for it, against CAREER.md:328
("Retirement is chosen, not imposed, unless the offers genuinely stop").
Breaks: arc-completion guarantee for one reachable (if perverse) path.

## What is done well
- The training pity timer is exactly what its header claims: banked expected
  gains land deterministically, the bank conserves to the calibrated rate to
  the 6th decimal (probe: 60 landed + 0.416 banked vs 60.42 expected over 200
  weeks), the 1e-6 snap kills float-stall, ceilings stop accrual before
  banking, and the overshoot-spends-the-bank rule is documented where it
  bites. Zero RNG where RNG once produced measured 10-week droughts is the
  right trade.
- The sticky-card fix is thorough: one card captured before any sim
  (week.ts:232), the same card fed to the projection (circuits.ts:630 reads
  the identical `nextApproach ?? approach`) and to every grade of the week
  (trust.ts takes it explicitly), folding into the standing card at week end
  with playingHurt deliberately dropped — and the doubleheader test pins the
  measured 0/100-alternation defect it fixed.
- The injury stream re-key to per-game ('career-injury:<gameId>') is a real
  determinism-quality fix (two games of a doubleheader no longer share one
  draw), and per-game streams make draw-count variance harmless by
  construction.
- applyChoice's validation-before-mutation discipline means even the throws
  found above corrupt nothing; denied choices never touch the log, and the
  log-append-on-ok gives replay a clean spine.
- The felt-loop A/B culture shows everywhere in the numbers: energyLegsFloor
  exists because a measured 41-week zero-energy grind cost nothing;
  approachTendencyMax 32 because 22 was statistically invisible; the params
  comments cite the measurements instead of asserting taste.
- fastSim's seed hygiene ('fast:' prefix over the job seed) guarantees the
  fake sim can never mirror an engine stream for the same game, and its
  fixed 8-draws-per-line shape keeps it deterministic and shape-compatible
  with applyGameResults.
- ensureAiLeague dodges the documented Record trap correctly
  (Object.values over league.teams, insertion-order deterministic), and
  drainToDraft's 700-day guard is honestly derived (~2.2 seasons) with a loud
  throw rather than a silent hang.

## Verified sound
- E[landed training points] = accrual rate exactly; landing cadence bounded
  by ceil(1/rate) (probe over 200 weeks + spine test at the HS staff rate).
- Energy cannot go negative or exceed 100, cannot oscillate (single
  end-of-week clamp over a linear sum; probed from energy 2 and 99); the
  in-season grind→floor→legs-debuff→hazard chain is a genuine tradeoff at
  default params (season injury P 7.5% rested vs 13.1% pinned; -8 attrs).
- All sixteen CareerChoice kinds in types.ts:338-354 are handled in the
  switch (acceptOffer/commitCollege share one arm); unknown kinds fall to a
  graceful deny; 12 of 16 kinds survive malformed payloads (probe).
- No double-jeopardy on injuries in the NBA phase: rollMyInjury is
  module-private to week.ts, resolveNbaWeek never rolls career-side
  (nbabridge.ts:25-27), and pre-entry I am absent from league.players so
  franchise rolls cannot reach me.
- The severity CDF walk in rollMyInjury matches params.injury.severityMix
  order and mass ([0.62,0.26,0.09,0.03]); outDays uniform-inclusive per
  severity band matches the franchise form; proneness/wear factor forms and
  0.25 floors match hazardFor.
- MY games never route through fastSim: circuit weeks and NBA weeks take the
  caller's SimulateJobs; fastSim serves only fastDays, the draft drain, and
  retired-year advancement (tick.ts read end to end).
- Draw-source discipline in the domain files: every draw in week.ts/tick.ts
  derives from streamRng(career.seed, ...) with per-week/per-game/per-year
  namespacing (no Math.random/Date anywhere; grep-verified); an early return
  in one week cannot shift another week's streams.
- Year-wrap bookkeeping: declaredThisYear's last-decision-wins scan against
  year-1 is correct relative to the wrap's pre-incremented year; the lazy
  one-season-per-year build is guarded by (circuitHistory row ∨ live
  circuit) and cannot rebuild a played year; enterDraftClass is idempotent
  across a repeated draft night.
- The 313-day season length (calendar.ts window sum) and the drainToDraft /
  resolveDraftNight / retired-year guards (700/40/400) all clear their worst
  cases with margin.
- spine.test's assertions are pinned to computable truths (cap=7 derived from
  the same params the code reads; adherence equality across a doubleheader;
  bank remainder in [0,1)) — none of the spine tests could pass against a
  broken pity timer or a reverting card.
