# career-create
scanned: packages/career/src/creation.ts (660), packages/career/test/creation.test.ts (312); context read for verification: packages/career/src/params.ts (319), packages/career/src/types.ts (creation section), packages/franchise/src/people/gen.ts (484), packages/franchise/src/people/dev.ts (364), packages/franchise/src/rng.ts (51), packages/franchise/src/genesis.ts (556), packages/franchise/src/ai/persona.ts (partial), packages/engine/src/model/derived.ts (94), packages/engine/src/sim/resolve.ts (body consumers), packages/career/src/week.ts (training path), packages/career/src/stock.ts (enterDraftClass), packages/app/src/career-acceptance.ts (335), packages/app/src/acceptance.ts (chair-fill pattern), docs/CAREER.md, docs/CAREER_INTERNALS.md
critical: 0   high: 2   medium: 4   low: 8

## HIGH docs/CAREER.md:78-80 vs packages/career/src/creation.ts:408-418 - the body "tradeoff surface" does not exist: no priors move with body, and the engine prices no tax
CAREER.md (approved design law, "Creating him") promises: "Body is a real
tradeoff surface: height and wingspan raise defense and rebounding priors and
tax speed and handling priors, exactly as the engine prices them." Neither
half is implemented. buildMe (creation.ts:408-418) computes every attribute
from budget + signature/position shape + background + noise; spec.heightIn /
wingspanIn are only stored on the player (creation.ts:475-477). And the engine
itself prices body as pure upside: reachFt (engine model/derived.ts:72-75)
feeds contest quality and rim finishing, heightIn feeds the rebound blend
(engine sim/resolve.ts:471-472), screen quality (sim/ai/actions.ts:209) and
jump balls (sim/possession.ts:40,73); the speed/accel/lateral/handling curves
(derived.ts:24-52) are attribute-only. So at fixed dials, more height and
wingspan is strictly non-negative everywhere. Consequence: max height (90 in)
plus max wingspan (+9) is a dominant strategy at creation - a 7'6" condor PG
keeps every typed speed/handling point and gains all the length physics free.
The only body constraint is the weight-for-height plausibility band
(creation.ts:356-368), which itself has no attribute consequence. The
creation.ts:73 comment "body: a real tradeoff surface needs real bounds"
frames bounds as if they were the tradeoff; they are not.
Breaks: a documented design guarantee of the approved mode law; creation
balance (free-lunch dominant build the acceptance bands will never flag).

## HIGH packages/career/src/creation.ts:441-447 - hidden-ceiling floor is over the PRIOR, not the built sheet; backgrounds with dial bonuses produce permanently dead development groups (~10% of coach's-son creations)
The ceiling floor is `prior + CEILING_FLOOR_OVER_PRIOR` (creation.ts:446)
where prior = base + alloc + background GROUP shift (groupPrior,
creation.ts:276-280). But the realized group mean also includes background
SINGLE-DIAL shifts (bg.attrs, applied at creation.ts:414) and noise: coach's
son passVision +1*S = +6 on a 3-dial group lifts the playmaking mean ~+2 over
the prior; playground ballHandle does the same. When the headroom draw lands
near the floor (N(18,8) low tail), potential[g] can sit AT or BELOW the
group's actual mean. Measured with the real createCareer over 30 seeds
(coach's-son, fourstar): 3/30 creations arrive with potential.playmaking <=
current mean (worst: potential 56 vs mean 57.3). Consequence downstream: the
dev review skips the group forever (`headroom <= 0 -> continue`,
franchise/people/dev.ts:220-221) and career training banks nothing
(`groupMean >= ceiling -> return`, career/week.ts:95-96, before the bank even
accrues) - the exact group the background advertises as its strength ("film
sense up") is dead at 17, silently, while the UI hides the ceiling by design.
This contradicts the constant's own contract (creation.ts:103: "creation
always leaves something to develop; the hidden-ceiling RPG hook is a lie
without it") and the test's claim ("headroom exists at 17",
creation.test.ts:189-194 - asserted only for the aau build, whose bg.attrs is
empty). gen.ts avoids exactly this by flooring potential at the REALIZED
group mean (gen.ts:343-345); creation weakened the convention to the prior.
Near-misses are also throttled: dev.ts:226 tapers growth as headroom/12, so a
ceiling 1-3 points over the mean develops at a crawl. Fix shape: floor over
the realized group mean (as gen.ts does), or include bg.attrs in the sampled
prior.
Breaks: the documented always-develops guarantee, design pillar 2 ("every
consequence is explained" - this one never is), and the RPG hook for two of
the five named backgrounds.

## MEDIUM packages/career/src/creation.ts:343-346 vs creation.ts:276-280 - the creation cap is checked without the background shift, so built sheets exceed the documented cap by up to 6
validateCreation's cap check uses `prior = c.groupBase + alloc`
(creation.ts:343), but the file's own definition of "the visible group prior:
base + allocation + background shift. The number the ceilings sample over"
(groupPrior, creation.ts:276-280) includes the background. Verified: an aau
spec with scoring alloc 30 validates ok (68 = cap exactly) while the sheet is
built and the ceilings sampled over a scoring prior of 74 - six points over
the creationGroupCap 68 ("nobody arrives finished", params.ts:19-20).
Symmetrically a late bloomer is over-restricted by 4 (his true prior is base
+ alloc - 4). The validation comment (creation.ts:334-337, "the resulting
group prior may not pass the creation cap") claims the check it does not
perform. Either the cap is on the typed allocation (then the comment and
groupPrior's JSDoc are wrong) or on the visible prior (then aau/coach's-son
builds evade it).
Breaks: the over-cap-is-an-error budget promise the validator documents; two
contradictory definitions of "group prior" inside one module.

## MEDIUM packages/career/src/creation.ts:320-385 - refusal completeness: pos, signatures, background, preset ids are never validated; invalid enums crash with raw TypeErrors after the full league build
validateCreation checks names, budget arithmetic, body bounds, signature
DISTINCTNESS, and the two nationality rules - but never that spec.pos,
spec.signatures[i], spec.background, or spec.preset are known ids. Verified
with the real functions: `pos:'XX'`, `signatures:['bogus-a','bogus-b']`, and
`background:'street'` all return ok:true, then createCareer builds the entire
30-team world (creation.ts:589, ~500 generated players) before dying in
buildMe with `TypeError: Cannot read properties of undefined (reading
'attrDelta')` (creation.ts:402-404/412) or `(reading 'groups')`
(creation.ts:279 via 411). Fail-loud, so nothing corrupt reaches the sim -
but the plain-language full-list refusal contract this validator documents
(creation.ts:315-319) is bypassed for exactly the fields TypeScript would
normally guard, and career-acceptance.ts:112 shows specs reach createCareer
through `as unknown as CreationSpec` with no compile-time narrowing (its
Pilot.budget/signatures are plain string types), so a typo'd pilot would
surface as a cryptic crash report, not a refusal. Also: non-integer
allocations pass ("must be a non-negative number of POINTS",
creation.ts:338-340 - only finite/>=0 is checked; fractional budgets summing
to the preset validate and build fractional priors), and extra smuggled spec
properties spread into career.creation (creation.ts:636) and serialize into
the save.
Breaks: the validation gate's documented refusal contract; wasted league
build on every enum typo.

## MEDIUM packages/career/src/creation.ts:507-508 vs packages/career/src/params.ts:50-51 - rivalBudgetFactor does not scale "the rival's creation budget"; it scales base + budget + the age-discount add-back
params.ts documents the knob as "the rival's creation budget as a fraction of
a fourstar's". The code computes `quality = (fourstarPrior +
RIVAL_RAW_DISCOUNT_EST) * factor` where fourstarPrior = groupBase +
budget/6 (creation.ts:507-508) - so the factor also scales the age-17
groupBase (38) and the +12.5 raw-discount compensation. At the shipped 1.0
nothing shows, but any sweep move is ~3x the documented semantics: factor 0.8
yields quality 55.1, while "0.8 of a fourstar's budget" means groupBase +
(110*0.8)/6 + 12.5 = 65.2. A calibrator trusting the registered comment would
mis-dose the rival badly.
Breaks: a registered knob's documented meaning; any future rival-quality
sweep.

## MEDIUM packages/career/src/creation.ts:504-520 - rival generation parity: he gets the franchise ceiling headroom (mean 12), I get the career one (mean 18), at the same age
Career params justify ceilingHeadroomMean 18 as "younger than genesis
prospects: more room" (params.ts:22). The rival is the same age 17, but
buildRival routes through generatePlayer, whose fade `clamp((27-age)/8,0,1)`
saturates at 1 for every age <= 19 (gen.ts:340) over franchise
gen.ceilingHeadroomMean 12 / sd 7 (franchise params.ts:441-442) - a
17-year-old gets no more headroom there than a 19-year-old. Measured over 12
seeds: current-ability parity holds (me 57.5 vs rival 55.6 - the
RIVAL_RAW_DISCOUNT_EST math is honest, see Verified sound), but per-group
ceiling headroom is me 18.1 vs rival 12.1 - the "true peer"
(params.ts:51) is born ~36 total attribute points short of my growth room,
so over the fifteen-year arc the rivalry the phone is built around
(creation.ts:497-503; CAREER.md "good enough to matter for the next fifteen
years") structurally decays in my favor. Note also gen truncates negative
headroom to 0 (ceiling can equal current mean) while creation floors at +2.
Breaks: the documented true-peer intent of the flagship rival thread;
long-arc rivalry bands the acceptance harness reports.

## LOW packages/career/src/creation.ts:20-23 - header claims "gen.ts never quality-shifts ... tendencies, and neither does creation"; gen.ts quality-shifts usage
gen.ts:311-316 derives tend.usage from quality (`USAGE_SLOPE * quality +
USAGE_INTERCEPT`, "an offense feeds its best players"), the one deliberate
exception to its own appetite-is-not-skill comment. Creation takes usage
straight from the signature blend (creation.ts:421-423), so a phenom with
glue (usage 30) + three-and-d (usage 40) signatures arrives at ~35 usage
while every gen.ts player of his quality - the rival included (measured ~67)
- carries star usage. Arguably identity-by-choice (the approach assertiveness
dial can push usage game-night), but the header's factual claim about gen.ts
is false as written, and the systematic volume asymmetry vs the rival is
undocumented.
Breaks: a module-header method claim (doc-vs-code drift).

## LOW packages/career/src/creation.ts:590 + packages/franchise/src/rng.ts:11-34 - the 'genesis:career-user-gm' stream is registered in neither registry
franchise/rng.ts's registry states "Adding a stream = adding a name here ...
so collisions are impossible by construction"; it has no row for the
career-user-gm (or acceptance.ts:71's user-gm) path under the league seed's
genesis family. CAREER_INTERNALS.md's career stream table (line 80) does not
carry it either (it lives under the world seed, so the franchise registry is
its home). No collision today ('genesis:team:<id>' is the only neighboring
family), but the by-construction guarantee is only as good as the registry's
completeness.
Breaks: the stream-registry discipline both registries claim.

## LOW docs/CAREER_INTERNALS.md:80 - the creation stream row lists phantom "probe streams" and omits 'career-creation'
The table row reads "`career-ceiling`, `career-traits`, `career-rival`, and
creation's probe streams | creation.ts | fixed per creation". probeShape
(creation.ts:189-199) draws no rng at all - the archetype probes are
rng-free module-load builder calls - so "probe streams" names streams that do
not exist, while the module's MAIN stream, 'career-creation' (~40 draws: 24
attr + 14 tend + conditional repair + 2 coach picks, creation.ts:29-32,
391-397), is missing from the table. Also "fixed per creation" is loose: the
career-creation draw count varies BY SPEC (the conditional coherence-repair
draw, creation.ts:428-433), which the module header documents honestly but
the registry wording papers over.
Breaks: the career stream registry's accuracy.

## LOW docs/CAREER.md:99 vs packages/career/src/creation.ts:446 - "sampled around" vs "sampled OVER" the priors
CAREER.md says ceilings are "sampled around" the visible priors, implying a
ceiling below the prior is possible. The code clamps at prior+2
(creation.ts:446), strictly over, matching CAREER_INTERNALS.md:29 ("sampled
OVER"). CAREER.md is the drifted one. Adjacent nit: creation caps potential
at RATING_HI 99 citing "gen.ts convention" (creation.ts:92), but gen.ts caps
potential at 100 (gen.ts:345) - the 99 convention there covers dials, not
ceilings.
Breaks: design-doc precision on the hidden-ceiling contract.

## LOW packages/career/src/creation.ts:590 vs packages/franchise/src/genesis.ts:467 - the user-chair persona keeps its own drawn timeline; genesis aligns every other chair's to the roster tier
Genesis assigns AI chairs `{ ...generatePersona(rng), timeline: tier }` so
the persona's posture matches the roster it was built with; creation's fill
(like acceptance.ts:71, so the "acceptance-harness pattern" claim is
accurate) keeps generatePersona's independent 40/35/25 timeline draw. The nye
chair can open as a "contend" persona on a rebuild roster. Bounded:
team.strategy.timeline (the behavior driver) is set correctly at genesis, and
persona.timeline only shifts the reevaluation bar by 0.02
(persona.ts:177-178, PRIOR_TIMELINE_BAR_SHIFT), but the 30th chair is
generated under a different rule than the other 29.
Breaks: chair-generation uniformity (cosmetic behavioral asymmetry).

## LOW docs/CAREER_INTERNALS.md:122-123 - "cross-process determinism" is claimed for the creation suite; the test is same-process
The proof table says the creation suite covers "validation, identity,
cross-process determinism". The determinism test (creation.test.ts:161-165)
builds both careers in the same module load and compares JSON - it would
catch draw-order bugs but not anything only a second process can reveal (and
nothing in the career test tree greps for cross-process). The acceptance
harness's determinism gate (career-acceptance.ts:240-260) is also
same-process. The claim overstates the evidence.
Breaks: a documented proof claim (gate-honesty axis: the stated verification
does not exist as stated).

## LOW packages/career/test/creation.test.ts:18 - deep relative import of franchise internals the barrel deliberately withholds
`import { abilityScore } from '../../franchise/src/gameday.js'` reaches
across the package boundary; abilityScore is intentionally NOT exported from
the franchise barrel, which is why career/src/circuits.ts:225-229 keeps its
own local copy. A career test binding to a franchise-internal symbol dodges
the public-API discipline the source module itself honors.
Breaks: scoped-import/style law (minor).

## LOW packages/career/src/creation.ts:67,589 - START_YEAR agreement with the world is by parallel constants, not by construction
The comment says START_YEAR 2026 "matches franchise genesis
DEFAULT_START_SEASON" (true today, genesis.ts:52), but createCareer calls
createLeague without startSeason (creation.ts:589), so the agreement is two
constants that must be edited in lockstep across packages. Passing
`startSeason: START_YEAR` would make the claimed invariant structural. Same
family: buildRival's RIVAL_RAW_DISCOUNT_EST (creation.ts:111-117) restates
gen.ts module-local constants by hand (accurate today - see Verified sound -
but it drifts silently if gen.ts retunes RAW_DISCOUNT_PER_YEAR or the group
weights). Related nit: me and the rival never pass through ensureUniqueName
against the league's ~500 names (gen.ts:224-235 doctrine: "cross-league
uniqueness is the caller's job"; neither buildRival nor stock.ts
enterDraftClass does the job), so duplicate display names are possible at
entry.
Breaks: nothing today; documented-match claims held up by discipline instead
of code.

## What is done well
- The anchor-probe pattern (creation.ts:189-199) is exactly right: signature
  and position shapes derive from the SAME calibrated archetype builders the
  engine is tuned against, as level-neutral within-group deviations - a
  rebalanced archetype re-shapes creation with no hand-copied table to go
  stale, and the blend provably stays inside the calibrated envelope.
- Budget validation is honest by design: exact-spend enforcement, over-cap as
  an ERROR never a clamp, every problem returned at once in plain language,
  with the reasoning for each rule written where the rule lives.
- Stream discipline is thoughtful where it exists: ceilings and traits on
  dedicated streams so spec edits can never reshuffle them, the rival on his
  own stream drawn dry, the world under `${seed}:world` structurally
  collision-free from career-* labels, and validateCreation deliberately
  draw-free so a rejected-then-fixed spec consumes nothing.
- The rival discount estimate is honest arithmetic, not vibes: 6 years x 2.6
  pts x 0.804 dial-weighted mean group weight = 12.54 ~ 12.5, verified
  against gen.ts's module-local constants; measured current-ability parity
  (57.5 vs 55.6 over 12 seeds) confirms the targeting works at defaults.
- Late-bloomer mechanics match the documented arithmetic exactly: the +8
  ceiling bonus banks BEFORE the draw (whole distribution up, per the
  comment), measured net +24 potential sum / -24 mean sum vs aau on the same
  seed and budget.
- Defensive copying is careful and explained (spec copy at creation.ts:636,
  clock copies for the welcome message and the phase event, with the
  determinism reason stated at each site).
- The fail-loud createCareer gate and the deliberate NOT-built-here register
  (creation.ts:568-572) keep ownership boundaries legible for the sibling
  tasks.
- The test suite covers the right behavioral contracts (tradeoffs visible on
  the sheet, ties in focus, plan widths agreeing with trust params, world
  seam assertions) rather than snapshotting numbers.

## Verified sound
- Draw-count audit of every creation stream: career-creation = 24 attr
  gaussians (GROUPS then GROUP_ATTRS order, 6+5+3+5+3+2) + 14 tend gaussians
  (TEND_KEYS length 14 verified by probe) + at most ONE coherence-repair draw
  (the two repair conditions are mutually exclusive: attr.three >= 75 vs <=
  15) + 2 coach picks; career-ceiling exactly 6 in GROUPS order;
  career-traits exactly 8 in the commented order (7 gaussians + 1 int).
- GROUP_ATTRS covers all 24 engine ATTR_KEYS exactly once (probe against
  @hoopsh/data); the creation copy, the test copy, and dev.ts's copy agree.
- Rejected-then-fixed specs cannot perturb draws: validateCreation is pure
  and draw-free, streams are derived fresh inside each createCareer call, and
  the throw happens before any stream exists.
- Ceilings can never sit below the PRIOR (floor prior+2, cap 99; clamp bounds
  cannot invert since max prior 74 < 97) - "sampled over" as
  CAREER_INTERNALS claims; the failure mode found is vs the realized MEAN,
  not the prior (finding 2).
- START_YEAR 2026 == genesis DEFAULT_START_SEASON 2026 today; bornSeason
  2009 as tested; wear 0 is consistent with gen.ts's own formula at age 17.
- The wingspan default +2 matches the engine's own fallback exactly
  (derived.ts:73), as the constant's comment cites.
- careerControlled = [me] and NOT the rival is design-correct: after
  enterDraftClass (stock.ts:789-818) the rival becomes a normal league player
  whose retirement (retire.ts:116), player options (tick.ts:413), and FA life
  (ai/fa.ts:284,400) run on franchise auto-decisions - his life is the sim's
  to live, per the CAREER_INTERNALS seam doc; enterDraftClass re-adds me
  idempotently and preserves class order (me, rival, pool).
- Every chair persona-run verified: genesis fills 29 AI chairs, creation
  fills the nominated 30th from the world's own genesis-family stream; the
  test asserts all 30 truthy and the fill mirrors acceptance.ts:71 as the
  header claims (including its timeline quirk - see the LOW).
- The focus tie-break is byte-stable (strict >, fixed GROUPS order), matches
  the test's scoring-over-defense assertion at equal allocations.
- The three shipped acceptance pilots' specs all pass validateCreation
  (budgets sum exactly to 160/110/60; phenom's 30-point groups land exactly
  at the 68 cap; 77in/196lb inside the weight band) - the `as unknown as`
  cast smuggles nothing invalid TODAY (finding 4 is about what it could
  smuggle tomorrow).
- withCareerParams merges section-level overrides onto fresh defaults per
  call (defaultCareerParams returns a new literal; no shared mutable state
  across careers).
- The determinism test (same opts twice, JSON-identical) passes structurally:
  no ambient state, no Date/Math.random anywhere in creation.ts, all ids and
  message/event strings fixed or spec-derived.
