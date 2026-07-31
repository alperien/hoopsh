# FRANCHISE.md — the GM experience built on the engine

This is the design document for hoopsh's franchise game: a general-manager
career sim in which every game of every season is simulated by the spatial
engine, possession by possession. It is the first "experience" the
architecture promised (ARCHITECTURE.md: experiences are thin apps consuming
one core's event stream). This document is the game's law in the same way
AGENTS.md is the repo's law: design decisions, scope decisions, and the
honest register of simplifications live here.

Sibling documents: [FRANCHISE_INTERNALS.md](./FRANCHISE_INTERNALS.md) (per-module
map, written with the code), [ROSTERS.md](./ROSTERS.md) (the 38 dials the
franchise layer projects onto), [SEASON.md](./SEASON.md) (the stateless season
substrate this layer adds state to).

---

## 1. What this is

You are the general manager of one of thirty fictional professional teams.
You control the roster, the cap sheet, the draft board, the coaching hire,
the rotation policy, and nothing else: the games are played by the engine,
the other twenty-nine front offices are played by AI, and the league moves
one day at a time whether your plans are ready or not.

The positioning, stated plainly: NBA 2K owns graphics. This game concedes
that entirely and competes on everything a franchise mode is actually made
of: a game engine you can trust at possession level, a league economy that
does not collapse in season three, front offices that behave like front
offices, and a season that reads like a season in the news. Research across
the basketball sim market (docs/history/franchise-research/) found exactly
this gap: no basketball title pairs management depth with a believable,
watchable game engine. hoopsh already has the engine. This layer is the
depth.

Three design pillars, in priority order:

1. **Trust.** Nothing in the league may be visibly fake or exploitable. A
   stat-literate player audits, in order: the league-average table,
   leaderboards, minutes distributions, box scores, standings spread. AI
   trades, contracts, and draft classes must survive that audit for decades
   of sim time. Trust failures are release blockers; missing features are
   not.
2. **The season is the content.** News, rivalry, award races, deadline
   pressure, draft ritual, the arc of a rebuild. The game manufactures
   nothing: every story is generated from things that actually happened in
   simulated games and transactions, with real numbers.
3. **One franchise, lived in.** This is not a god-mode league browser. The
   default rhythm is day by day, inbox first, one team's problems. Fast
   simming exists and is fast, but the game optimizes for attachment, not
   for skipping fifty seasons.

## 2. What the research said

Seven research reports were compiled before this document
(docs/history/franchise-research/, all claims sourced). The findings that
shaped the design:

- **The market gap is "Football Manager of basketball."** Basketball GM owns
  fast/casual; the paid incumbents (Draft Day Sports, Pro Basketball
  Manager) are dated, buggy at the possession level, and abandoned months
  after each yearly release. Nobody pairs depth with a believable engine.
- **Trust is the meta-complaint everywhere.** 2K's franchise community:
  broken CPU trade logic (15 years), free-agency chaos, rating inflation
  breaking the cap economy within three sim seasons, garbage generated
  draft classes. Basketball GM: "fleecing" is community vocabulary, and the
  anti-exploit caps bolted on later are hated as tedium. OOTP's chronic
  sore spot is the same. An AI that neither gets fleeced nor refuses
  plausible star trades is the hardest and most valuable system in the
  genre.
- **Development is the most-memed failure.** BBGM's top all-time community
  posts are about progs: too uniform, too jumpy, rookies too weak, peaks
  too early (the developer agrees). Players want arcs they can read and
  busts that come from scouting error, not dice.
- **The immersion playbook is known.** From FM and OOTP: the inbox is the
  game's spine; the draft is a calendar ritual; scouting fog of war makes
  uncertainty the game; deep history tracking turns saves into worlds;
  frictionless sim rhythm creates "one more game." The anti-patterns are
  equally known: mandatory press-conference quizzes, template news with
  irrelevant stats, morale micromanagement, noise.
- **UI: speed and density win.** Instant loads, dense sortable tables,
  history as browsable content, a watch-mode spectrum (most players sim and
  watch key moments). FM26 shipped the opposite (fewer tables, more clicks)
  and landed among Steam's worst-reviewed launches.
- **Realism has numbers.** League averages, minutes distributions,
  leaderboard shapes, wins SD ~13, champion-by-seed rates, aging curves,
  career lengths, injury base rates: all sourced in the research files and
  encoded here as acceptance bands (§12).

## 3. What ships in v1 and what does not

v1 is a complete, playable, trustworthy franchise career. Everything in the
"in" list exists at real depth; everything in the "out" list is absent on
purpose and registered, not half-built (AGENTS.md §2.5 applies to systems
as much as symbols).

**In:** thirty-team fictional league with conferences/divisions · full
calendar (camp, 82-game schedule, all-star break, trade deadline, play-in,
playoffs, lottery, draft, free agency) · the engine simming every league
game with rotations, home court, fatigue carryover, and injuries projected
in · full CBA layer (cap/tax/aprons, exceptions, Bird rights, rookie scale,
max tiers, minimums, options, restricted FA, trade matching, Stepien rule,
two-ways, waivers/stretch) · AI front offices with distinct personas
running the same rules the user faces · player development and aging with
legible arcs · injuries with recovery timelines and wear · draft classes
generated archetype-coherent with scouting fog of war · trades (2-team) with
a value model built to survive both fleecing and cowardice · free agency as
a market with cap holds and offer sheets · coaching hires that map to
engine tactics · a news desk generating the season's paper trail from real
events · awards, records, career histories, an almanac · watch mode from
quick-sim to live text broadcast with the 2D viewer · deterministic saves
(seed + action log) · a dense keyboard-first web UI.

**Out (registered):** MyPlayer/agent careers · online/multiplayer · 3+ team
trades and sign-and-trades · G-League game simulation (assignment exists,
its games do not) · summer league · in-season tournament · expansion,
relocation · financial minutiae beyond payroll/tax/owner patience (no
ticket pricing) · morale as an on-court modifier (off-court behavior only,
see §7) · era packs · real-player licensing (the fitter in ROSTERS.md is
the modder's path).

## 4. Architecture

Two new packages, same law as the rest of the repo:

```
packages/
  franchise/   pure deterministic league state machine: zero node: imports,
               zero npm deps, browser-safe. Consumes @hoopsh/engine,
               @hoopsh/data, @hoopsh/stats. All randomness through the
               engine's Rng, seeded per-stream. All behavioral constants in
               one flat FranchiseParams object (the calibration surface,
               mirroring SimParams discipline).
  app/         the game server: node:http static server + JSON API, save
               files on disk, worker-pool game execution (the proven
               harness parallel pattern), and the web UI (plain JS + HTML,
               no build step, viewer-package discipline).
```

Dependency direction unchanged: engine imports nothing; franchise imports
engine/data/stats; app imports franchise and narration. The engine is not
modified by this work: any franchise-layer need that seems to require an
engine change is a STOP-and-escalate, not a patch (AGENTS.md §7).

The seams SEASON.md documented are used exactly as written: rosters enter
per-game at task construction, and everything the engine does not model
arrives as a roster edit at that seam. Injuries remove or limit players,
fatigue pre-degrades stamina, rotation policy becomes `rotationMinutes`,
and home-court advantage is a small calibrated attribute debuff on the
road team (the engine is side-symmetric by design and must stay that way;
a probe measured a uniform -1 to -2 debuff bracketing the real 55-60%
home-win rate, and calibration picks the value). Outcomes feed the state
machine: real minutes played drive fatigue and injury exposure.

**Determinism.** A league is a pure function of (league seed, user action
log). Every subsystem draws from its own derived RNG stream
(`rng(`${seed}:draft:${season}`)`, `rng(`${seed}:dev:${season}:${playerId}`)`),
so an extra roll in one system never reshuffles another. Same seed + same
actions = byte-identical league history. The save file records both, which
makes saves diffable, shareable, and bug reports reproducible: the repo's
replay culture extended to whole careers.

**Performance.** Measured engine cost is ~3 games/sec/core. A league day
(2-8 games) resolves in about a second on the worker pool; a full 1230-game
season fast-forwards in a few minutes on four cores. That is the honest
price of simming every possession of every game, and it is the identity of
the product; a statistical shortcut engine for background games is
explicitly rejected (it would fork reality into two qualities of truth).
Full event streams are kept for the user's games and the nightly featured
game; every other game persists as box score + key plays, aggregated in the
worker (the parallel runner's own rule: aggregates cross the process
boundary, events do not).

## 5. The player, beyond the 38 dials

The engine's `Player` is a snapshot of ability. The franchise player wraps
it with everything a career needs:

- **Identity:** name, age, birthplace, college/pro origin, draft record,
  height/weight/wingspan (the engine's own physicals), a deterministic
  SVG portrait seed.
- **True ratings vs the sheet:** the 38 dials are the hidden truth the
  engine sees. Scouts see estimates (§9). The user's own players report
  exact current dials (you employ them; your coaches run practice), but
  *potential* is always an estimate, for everyone.
- **Development state:** per-attribute-group growth curves, a hidden
  potential ceiling sampled at generation, work ethic, injury wear, and a
  development log (what changed at each review and the stated reason:
  minutes earned, coach quality, age, injury).
- **Health:** current injuries with recovery windows, proneness, chronic
  wear that accumulates and shows up as earlier athletic decline.
- **Contract:** years/salaries/options/guarantees, Bird status, trade
  restrictions, extension eligibility.
- **Disposition (off-court only):** ambition, loyalty, professionalism,
  market preference. These drive free-agency choices, extension demands,
  trade requests, and retirement timing. They never touch the engine's
  dials in v1: a disgruntled star plays like a star and forces your hand in
  the papers instead (registered simplification, §13).

**Aging and development.** The curve targets the researched consensus:
athleticism (speed/accel/vertical/lateral) peaks 24-27 and declines first;
skill (finishing/handles/passing) crests later and holds; shooting and
decision-making improve into the early 30s before the body drags the rest
down. Growth is driven by age, ceiling headroom, minutes actually played
(from real box scores), coach development quality, and work ethic, with
bounded per-review deltas: arcs are smooth and legible, not jumpy. The
random tail exists (late breakouts, early walls) but is small, and busts
are primarily a scouting phenomenon, not a dice phenomenon: the draft's
uncertainty lives in the gap between the scouted range and the truth, which
is where the research says players want it. Retirement is a hazard model on
age, decline, role, and wear; career-length distribution is an acceptance
band, not an accident.

**Generation.** Draft classes and league genesis build players the way
ROSTERS.md tells humans to: start from a coherent archetype, mutate within
coherence (a mutation that breaks CAN/WANT agreement is re-rolled), then
age-adjust (a 19-year-old's dials are discounted toward his ceiling; a
30-year-old vet is his curve's present value). Class strength varies by
seed. Name generation draws from era-weighted pools with an international
share matching the modern league, and never collides with a famous real
name. Heights, wingspans, and position mix hold the league's anthropometric
distribution steady across decades (a documented long-sim failure mode in
other games).

## 6. The league office: CBA

The full reference lives in the research file (06-cba-rules.md, sourced
from the NBA's official CBA 101 and 2023 CBA summary plus the Hoops Rumors
and cbaguide glossaries; Larry Coon's FAQ predates the 2023 CBA and is
cited only where still valid); the model implements: salary
cap / luxury tax line / first and second aprons, with a cap economy that
grows a sampled 3-8% per season clamped at the CBA's 10% ceiling (constant
10% growth would silently halve every contract's cap share inside a
decade) · max tiers (25/30/35% by service, 8%/5% raises) and rookie-scale
contracts with team options and restricted free agency · minimums by
service, two-ways (3 slots), 10-days late season · exceptions (non-taxpayer
MLE, taxpayer MLE, room, bi-annual) and Bird/Early Bird/Non-Bird rights ·
cap holds and renouncement (the detail most sims silently drop: an
over-the-cap team's space is fiction until holds are resolved) · trade
salary matching with apron restrictions on aggregation · the Stepien rule,
pick protections and swaps, seven-year pick horizon · repeater tax rates
and second-apron consequences (frozen future first) · waivers and the
stretch provision · the July moratorium, qualifying offers, offer sheets
with a two-day match window.

Simplifications are registered per rule in the module header, not hidden:
e.g. tax brackets are implemented at published rates but BRI true-up
mechanics are not modeled; hardship exceptions and trade bonuses are out.
The test suite for this module is a golden-case battery: every rule above
gets legality cases derived from the research file's rule tables and
dollar anchors (2026-27 cap $164.961M, tax line at 121.5% of cap, 25% max
exactly $41,240,250). When the cap engine and a stat-literate player
disagree, one of them cites a source.

## 7. Twenty-nine other front offices

Every AI team runs the same rulebook the user does: same cap engine, same
scouting fog (their scouts are wrong too, per-team differently wrong), same
rotation policy machinery. There is no CPU cheat lane; there is also no
CPU handicap.

Each front office is a persona sampled at genesis: a **timeline** (contend
/ retool / rebuild, re-evaluated each season from record, core age, and
asset position), a **risk appetite**, a **tax posture** inherited from the
owner, draft-capital hoarding vs star-chasing, and patience. Persona is
visible in behavior over seasons: the hoarder really does stockpile, the
star-chaser really does overpay at the deadline.

**Trade engine.** Valuation is surplus value: projected on-court value over
the remaining contract, discounted by age and injury wear, plus a pick
value curve (empirical, from the research file's draft-value studies),
adjusted by the persona's timeline (a rebuilder discounts win-now value; a
contender discounts 2031 seconds) and roster fit. Negotiation is iterative:
offers, counters, "close but add a second," walk-aways with memory. The
anti-fleece property comes from the floor of the value model plus persona
patience, not from bolt-on caps (the caps are what BBGM's community hates);
the anti-cowardice property comes from pressure states: a star demanding
out, a tax bill an owner won't pay, a deadline seller with expiring value.
Star trades happen because situations force them, which is how they happen
in the real league. AI-to-AI trades run on the same machinery on a schedule
of league pulses (post-draft, camp, deadline season), so the transaction
wire stays alive without the user in the room.

**Free agency** is a market, not a lottery: agents solicit offers, players
weigh money, role (projected minutes against the depth chart), winning,
market size, and incumbent advantages (Bird years, relationships), with
disposition weighting the mix per player. Restricted free agency plays out
as offer sheets and match decisions with real cap consequences on both
ends. The market clears the way the real one does: stars first, the
mid-tier scramble, then a long tail of minimums and camp deals into
September.

**The draft** AI runs boards built from its own scouts' (wrong) estimates,
persona-weighted between best-available and need, with pick trades live on
draft night.

## 8. A season, day by day

The calendar is the game loop. Each day resolves in order: injuries and
recoveries advance · AI front offices act · scheduled games sim on the
worker pool · stats, standings, and streaks fold in · the news desk writes ·
the inbox surfaces what needs the user (a rotation hole, an offer sheet
clock, a scout report, an owner note). Then the user acts and advances.
Continuous simming runs day-by-day under the hood with a live ticker and
stops on things that genuinely need a decision (FM's rhythm, with OOTP's
configurable stop conditions).

Season structure: training camp with preseason friendlies · an 82-game
schedule built by a generator that honors the real formula (4×4 division,
36 in-conference balance, 2×15 cross-conference), realistic back-to-back
counts, and an all-star break · a February trade deadline that is the
season's loudest week by construction · play-in (7-10) and four best-of-7
rounds with 2-2-1-1-1 home court · the lottery with the real odds table,
revealed worst-to-first as a ritual · the draft as an event screen, not a
form · July moratorium and the free-agency market · an August/September
quiet period that fast-forwards gracefully.

**Games.** Rotation policy (user-set or coach-run: minutes targets, roles,
back-to-back rest rules, blowout behavior) becomes engine `rotationMinutes`
per game. Fatigue carries across the schedule and back-to-backs sit players
or dull their legs (a stamina projection, per SEASON.md's seam). Home court
is a calibrated per-game params modifier targeting the researched ~55-60%
home win rate. Injuries roll on real minutes played with hazard from load,
age, and proneness; outcomes range from day-to-day to season-ending, and
the news attributes each to the game it happened in.

## 9. Scouting: the fog of war

The draft board is the one place the game hides the truth, because the
research is unanimous that uncertainty is the fun. Prospects carry scouted
ranges, not numbers: a shooting grade of "62-81" is a fact about your
scouting, not about the player. Range width narrows with invested scouting
(assignments by region, workouts, the combine); direction of error is
per-team and persistent (your international scout runs hot; so does
theirs, differently). Reports read like reports: strengths, flags,
comparisons, a projected role, and a confidence the UI treats honestly.
Busts and steals are what the gap between range and truth produces at
scale, which means they are earned by scouting budgets and biases, not
rolled on draft night.

Own-roster current ratings are exact; potential is always a projection.
Other teams' current ratings are exact too (v1, registered): league
personnel knowledge is near-perfect in reality, and blurring it makes the
trade UI dishonest rather than fun. The fog belongs to the future, not the
present.

## 10. The paper trail: news, awards, history

The news desk is the season's connective tissue, and it follows the
narration package's discipline: template pools with seeded variety and
repeat-avoidance, written dry, numbers only from the sim. Story classes:
game recaps built from actual event streams (the run that decided it, the
line that carried it) · injury reports · the rumor cycle, which only prints
smoke when there is fire (rumors surface real negotiation states,
anonymized) · transactions with cap context · award races on a weekly
cadence · milestone and record chases flagged as they approach, not after ·
draft coverage from combine to grades · firings, hirings, retirements with
career retrospectives. Two or three byline voices with fixed registers
(wire-service terse; insider breathless; columnist opinionated) keep the
feed from reading like one machine. No fabricated quotes-as-facts: player
"quotes" appear only where disposition actually drove an action.

Awards run on voting models fed by stats, wins, availability, and narrative
weight (the MVP ladder likes wins and minutes; media fatigue on
back-to-back winners is real). All-league teams, all-star selection with
fan-vote flavor, rookie/defensive/sixth-man/most-improved, weekly and
monthly honors. Everything lands in the almanac: career pages with year-by-
year tables, franchise register (banners, retired numbers, all-time
leaders), season archives (standings, brackets, award ballots), records
(single-game/season/career, playoff splits), draft class re-grades on
anniversaries. History is content; the almanac is a first-class screen, not
an export.

## 11. The UI

A local web app served by the app package: plain HTML/JS/CSS, no build
step, no framework, same zero-dependency identity as the rest of the repo
(the viewer already proved the pattern). Screens: the office (inbox +
today) · roster and rotation · player cards with development logs and shot
charts · cap sheet · trade desk · free agency hub · draft room (board,
reports, live draft) · league (standings, leaders, stats with sortable
everything, transactions wire) · schedule/results · game center · almanac ·
settings/saves.

Design doctrine per blandaid: every visible choice names a source in the
subject. The sources here are broadcast scorebugs, the printed box score,
arena wayfinding, and the league's own documents (cap sheets are
spreadsheets; scouting reports are memos). Dense tables are the point:
information density is respect for the player (FM26's click-multiplying
redesign is the documented anti-pattern). Dark, chrome-free game center
with a live scorebug; print-flavored almanac and news; monospace numerics
everywhere numbers align. Keyboard-first: advance day, jump to inbox,
sort/filter without a mouse. No purple gradients, no glassmorphism, no
mascot illustration, no pill badges; team identity is procedural (color
pairs + SVG monogram in scorebug style), not clip art.

**Watch mode is a spectrum** (research: most players sim and watch what
matters): quick-sim the night · digest a game in four quarter cards · read
it as a live ticker at 1x-32x with the two-voice broadcast lines, the
scorebug, and the box score filling in · or open the 2D court viewer on
the replay, which already exists in this repo. Spoiler-free controls
throughout: the ticker never shows the final before you watch.

## 12. Acceptance: realism as tests, again

The engine earned trust through bands and invariants; the franchise layer
inherits the method at league scale. A seeded 20-season autosim (AI running
all thirty teams) must hold, among others (full list with sources in the
research files; bands in `franchise/test/`):

- League averages inside engine bands every season, no secular drift
  (pace, efficiency, shot mix stay put for decades).
- Minutes distribution: league leaders 36-38 MPG, stars 34-37, real bench
  tiers; nobody averaging 16 PPG at 29 MPG atop the scoring table.
- Leaderboard shapes: scoring leader typically 28-35 PPG, single-season
  outliers rare and news-worthy; FTA, usage, and efficiency leaders inside
  researched historical envelopes.
- Standings texture: win totals SD ≈ 13, a 60-win team most seasons but
  not every season, tanking teams bad but not 5-77.
- Playoffs: 1-vs-8 goes to the one-seed ~90-95% of the time, 4-vs-5 is
  near even; the title goes to a one-seed about two-thirds of the time
  and to a top-three seed in ~95% of seasons across decades.
- Economy: cap sheets legal every day (hard invariant, not a band); star
  share of payroll stable; no rating inflation (the league-wide ratings
  distribution in season 20 matches season 1); no unsigned-star pileups in
  September.
- Careers: debut/peak/retirement age distributions and career lengths
  match the researched curves; heights and position mix do not drift.
- Determinism: same seed + same action log = byte-identical league, and
  the 20-season autosim's final state hash is a regression fingerprint.

Two tiers, because a 20-season autosim is ~25k engine games (half an hour
of compute): the always-on suite (`npm test`) carries hard gates on a
short autosim (determinism hash, cap legality every day, seasons complete,
no monotonic drift), and `npm run gm:acceptance` runs the full multi-decade
report with the distributional bands. An acceptance claim without a
command to reproduce it does not exist.

## 13. Register of simplifications

The honest list, in the repo's tradition (INTERNALS.md keeps the engine's;
this section keeps the franchise layer's). Each entry names the cost and
the condition for lifting it.

| # | simplification | cost | lift when |
|---|---|---|---|
| F1 | disposition never modifies on-court dials | a sulking star plays true | morale-to-court coupling designed with calibration evidence, not vibes |
| F2 | injuries roll post-game, attributed narratively to a moment | no mid-game exits; minutes of an injury game slightly overstated | engine exposes an in-game exit seam or rotation caps can express onset minute |
| F3 | trades are 2-team, no sign-and-trades | some real deal shapes inexpressible | valuation engine proven exploit-resistant in the wild |
| F4 | G-League assignment develops but does not sim games | no G-League box scores | a second league instance is cheap enough to run nightly |
| F5 | other teams' current ratings exact | no pro-personnel scouting game | fog UX proven on the draft first |
| F6 | schedule generator ignores arenas/travel geometry beyond B2B counts | rest realism approximate | travel model with distance table |
| F7 | no in-season tournament, no summer league | calendar thinner in Nov/July | after v1 |
| F8 | financials stop at payroll/tax/owner patience | no revenue management game | never, possibly; it is a different game |
| F9 | award voting has taste, not politics | fewer hot-take controversies | narrative memory system |
| F10 | fictional league only; real players via the modding path | no licensed nostalgia | out of scope by design (ROSTERS.md fitter is the door) |
| F11 | age is season-granular (no birthdays inside a season) | a February 19th birthday reads as 19 all year | nobody has asked |
| F12 | pick protections are top-N with a roll-forward, no swaps | some real deal shapes inexpressible | swap resolution logic with almanac coverage |
| F13 | tiebreakers: head-to-head, division, conference, point diff | the official cascade's division-winner and common-opponent steps are absent | a measured case where the simple cascade mis-seeds |
| F14 | the waiver wire clears immediately (no claim window or priority) | no waiver-order strategy | claim window with the priority queue |
| F15 | preseason exists on the calendar but friendlies are not simulated | camp is quiet | cut order says friendlies come back last |

Module headers carry their own local registers in the same discipline
(cba/cap.ts S1-S4, cba/contracts.ts C1-C8, cba/tradelegal.ts T1-T4,
transactions.ts X1-X4); this table holds the design-level entries.

## 14. Build plan

Waves per the swarm playbook (contracts wave fixes the shared vocabulary
before parallel building; the engine is never in scope). Each build task
carries an explicit file manifest at dispatch; no two tasks share a file.

1. **Contracts (the interface freeze):** the complete `types.ts` (domain
   model, user-action union, worker job shape), the full `params.ts` with
   per-module sections each build task owns exclusively, the RNG stream
   registry, the save schema, the complete package barrel, the app API
   protocol, and root package.json script entries. Written by the
   orchestrator, merged before anything builds. Every cross-module shape a
   sibling consumes (player generator interface, negotiation-state type,
   injury interface) is frozen here, not discovered mid-wave.
2. **Build A (parallel, disjoint):** genesis data + player/draft-class
   generation (names, teams, archetype mutation) · CBA/cap engine ·
   schedule + standings + playoffs/lottery · development/aging + injuries
   + disposition · the day-loop state machine + game-day projection (one
   owner for the spine; consumes the others' frozen interfaces).
3. **Build B (parallel, disjoint):** AI valuation + trade engine · AI free
   agency + draft + roster management · scouting · news desk + awards +
   almanac · app server + worker pool + saves + replay persistence.
4. **Build C:** UI shell + office/roster/league screens · game center +
   draft room + almanac screens (two tasks split by screen files; the
   shell task owns the shared files and lands first or with pinned shared
   file content).
5. **Verify:** independent test authors on the cap golden cases and the
   autosim gates; adversarial review of the trade engine (the fleece
   suite: a scripted exploiter agent must fail to profit); the full
   `gm:acceptance` run and calibration passes.

Pre-declared cut order under time pressure, cheapest first: live ticker
speed controls · camp/preseason friendlies · combine and workout detail ·
byline voices 3 to 1 · almanac depth · RFA offer-sheet ceremony (auto-
resolve instead). Cap legality, determinism, and the acceptance gates are
never cut. v1 lands with every §3 "in" system present and tested,
calibration coarse in places, and the register (§13) accurate. The
register is the contract with the next contributor.
