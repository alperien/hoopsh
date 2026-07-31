# CAREER.md — one player, the whole climb

The design document for hoopsh's career mode: the second experience on
the engine, built on the franchise layer. This file is the mode's law in
the FRANCHISE.md tradition: design decisions, scope decisions, and the
honest register live here. Approved by the project owner 2026-07-31
before implementation.


## What this is

You create one player at seventeen and live his entire basketball life: a
high school senior season, a route through college or a pro league abroad,
the draft, an NBA career inside the existing franchise sim, the money
years abroad if the calls stop coming, retirement, and a page in the
almanac of a league that keeps living without you.

There is no joystick. The design bet, backed by the career-mode research
(docs/history/franchise-research/08-career-mode.md): control of the
possession is not what makes career modes gripping. Five things are:
earned and legible progression, a craftable identity, a life-balance turn
economy between games, the route fantasy itself (letters, signing day,
the green room), and an emergent story with memory. The five killers are
equally known: pay-or-grind walls, worlds that ignore your performance,
authored rails, repeated generic events, and opaque systems that punish
you for unexplained reasons. This design is organized around winning the
first five and structurally excluding the second five.

What replaces the joystick is that everything you decide is a real input
to a real simulation. Your build decides what your player attempts. Your
weekly allocation feeds the same development engine the GM game runs.
Your pre-game approach shifts the actual tendencies the engine plays
from, and the box score answers you the same night. Games are the reveal
of your choices, watchable possession by possession in the ticker or the
2D viewer, with your touches in bold.

Pillars, in order:

1. The world reacts, always. Score thirty a night and the role follows,
   promptly and visibly. This is a hard invariant with an acceptance
   test, not a tuning goal.
2. Every consequence is explained. Trust moved because you broke the
   game plan twice; the coach says so. No random disappointment.
3. The journey is the content. Routes differ mechanically, not
   cosmetically: different rule packs, different stat environments,
   different exposure to scouts.
4. Nothing is authored twice. No cutscenes, no fixed story beats. The
   phone writes from your actual games, contracts, and relationships;
   two careers should never read the same.
5. Free, forever. No grind economy. Progression costs choices, never
   currency.


## Decisions taken at approval

The concept's open questions, resolved with the approving owner's
defaults (thread review, 2026-07-31):

- Start point: senior year of high school. Earlier years are creation
  backstory (register C2).
- Default difficulty: Four-star, hidden ceilings. Walk-on and Phenom are
  creation presets.
- Phone tone: distinct character voices (a teenage teammate does not
  text like an agent); no meme content, no slang decay.
- Universe: fictional everywhere. Euro, NBL, and China clubs are
  invented, consistent with the Association.
- Default cadence: watch your own games (ticker), sim-to-next-game
  between them. Both directions configurable.
- Mode name: Career. One app, two chairs: the gm command's onboarding
  offers Franchise or Career in the same save universe.


## Creating him

Identity first: name, birthplace, nationality, position, body.
Nationality is mechanical: an international prospect can sign with a
European club and is draft-eligible at nineteen without college; an
American follows the high school route. Body is a real tradeoff surface:
height and wingspan raise defense and rebounding priors and tax speed
and handling priors, exactly as the engine prices them.

One background, each a named prior with honest costs:

- AAU circuit kid: offensive polish up, defensive habits down
- Coach's son: decisions and film sense up, athletic priors modest
- Playground: handle and iso up, discipline and shot selection down
- Late bloomer: lower start, more ceiling headroom
- Academy product (international only): fundamentals and passing up,
  self-creation down

Then a point budget across the six attribute groups (the same groups the
scouting and development systems already use), with within-group detail
derived from position and background so the sheet stays coherent. Two
signature picks set the tendency identity (movement shooter, downhill
grinder, point forward, rim runner, three-and-D, and so on), drawn from
the archetype catalog the engine is calibrated against.

The RPG hook: your ceilings are hidden, even from you. Creation sets
visible priors; the true per-group ceilings are sampled around them and
revealed only by development itself. Scouts guess at your ceiling with
ranges the same way you guess at theirs.

Difficulty presets are creation budgets: Walk-on (small budget,
under-recruited start; the research says under-recruited origins are a
feature), Four-star (default), Phenom (top-five hype and the pressure
that comes with it). Re-rolling a new career is deliberately cheap;
route variety is the replay engine.


## The journey web

Stage 0, high school senior year (age 17). A compact regional circuit:
eight schools, a 14-game season, a conference tournament, a state
bracket. Real simmed games under a prep rule pack (shorter quarters;
rule packs are data). Your teammates are generated kids, one of whom is
good enough to matter for the next fifteen years: the rival-or-brother
thread the phone keeps alive across your whole career. Recruiters watch
through the same scouting fog the GM game uses, pointed at you: they see
ranges, and your actual box scores move them.

The fork, spring of senior year. Offers arrive with real terms:

- College: 4 to 8 programs by prestige tier. Each has a coach
  development quality (feeds the real dev system), a promised role, a
  system (pace and three-bias that genuinely change your stat
  environment: a run-and-gun program inflates counting stats, a grinder
  teaches defense), and NIL money (a light ledger).
- Europe: a professional club contract. FIBA-style pack, grown men, low
  minutes you have to earn, the best development quality if you survive
  it, and draft-and-stash dynamics.
- NBL Next Star: a guaranteed showcase role, shorter season, decent
  development, high exposure.
- Straight to the draft: internationals only, at nineteen.

Stage 1, the route (1 to 4 years). College plays a 10-team conference
season plus a conference tournament and a 16-team national bracket:
single elimination, the cheapest drama machine in sports. Declare or
return every spring, with your agent-to-be projecting your stock as an
honest range. Europe and the NBL play their own compact seasons under
their own packs. Route choice is a strategy problem: development quality
vs exposure vs role vs money now.

Stage 2, the draft. Combine (your true measurements go public), team
workouts (invitations arrive; showing well moves that team's perception;
you may skip to hide flaws), promise rumors, then the green room on
draft night while the existing thirty AI front offices pick off their
own boards. You fall or you rise for reasons that are real.

Stage 3, the NBA (the long middle). Your career runs inside the shipped
franchise sim: real CBA contracts from the player's side (rookie scale,
the option years, restricted free agency, extensions, the max), real
trades that happen TO you, injuries with the existing wear model,
playoff runs, awards under the 65-game rule. Off-days run on the weekly
allocation; game days are game days.

Stage 4, the descent, played honestly. The calls change: fewer years,
team options, minimum offers. The China league (big money, short season,
gaudy stat lines) and Europe are real late-career forks with real ledger
consequences. Retiring is a decision you take on the phone, and the
epilogue is generated from your actual record: the retirement story, the
career page, the hall-of-fame vote four seasons later, and, if you
earned it, a number in the rafters of a franchise that remembers you.

After retirement the save stays alive: the league continues, and the GM
chair unlocks in the same world your career just happened in.


## A week in the life

Pre-NBA stages tick by week; the NBA stage keeps the franchise sim's day
tick with the same weekly allocation running underneath. The week is a
small, consequential turn, the New Star lesson applied honestly:

Six slots against an energy budget: team practice (mandatory; sets the
coach trust baseline), extra work (pick an attribute-group focus; feeds
the real development engine alongside earned minutes), film (decisions
and BBIQ), body work (recovery, injury resistance, trims accumulated
wear), rest (energy back), and life (family, friends, school in the
early stages; morale and grades). Overtraining is allowed and it hurts:
energy debt raises injury hazard through the existing model.

Nothing here is a meter for its own sake. Every slot lands in a system
that already exists: development reviews, wear, morale, trust. And every
delta is explained in plain language on the player card, the same way
the GM game's development notes already read ('earned 2,650 minutes',
'age 31: legs first').


## The approach system

The agency core. Before every game you set an approach card: five dials,
each a real projection input, not flavor:

- Assertiveness: defer to take over (usage, shot appetite)
- Range: inside the offense to let it fly (shot-diet and pull-up bias)
- Motor: conserve to empty the tank (rebounding and effort tendencies;
  conserve protects your legs on back-to-backs through the existing
  fatigue model)
- Defense: solid to gambling (steal-hunting, foul aggression)
- Playmaking: hunt yours to make the extra pass

The engine plays your player from these adjusted tendencies, which means
the answer arrives in the box score the same night. Hunt threes and your
attempts genuinely rise; gamble and you genuinely get steals and fouls.
The engine's self-consistency makes the dials trustworthy.

What makes it a game instead of sliders: the coach's game plan sets
allowed ranges per dial, derived from your role. Playing outside the
plan can win you the night and still cost trust; adherence plus
production earns wider ranges, the green light, the featured role. Your
personality (set at creation) bounds how far you can push. After each
game the coach grades the night against the plan, and the grade, the
reasons, and the trust delta are all stated. Role logic is governed by
the reacting-world invariant: sustained production forces a role
response within a bounded number of games, and the acceptance harness
fails the build if a hot player stays buried.

Playing hurt is an approach-level choice when you carry a listed injury:
gut it out (debuffed dials that night, wear risk through the real injury
model) or sit (miss the game, protect the body, watch the stock and
trust dynamics move). The body report keeps the long-term cost visible.

Registered honestly: mid-game approach changes (timeout adjustments)
need an engine seam because games simulate atomically today. The design
reserves the touchpoint; v1 ships pre-game approach only, and the
ticker's quarter breaks are presentation, not fake control.


## The phone

The hub of the career UI is your phone. It is diegetic, it is where a
seventeen-year-old and a thirty-five-year-old both live, and it carries
the entire narrative layer with zero cutscenes.

Threads, few and persistent:

- The coach: role talks, game-plan pushback, trust moments. The only
  place role conversations happen.
- The agent (a family advisor until you can legally sign one): stock
  reads, contract negotiations with real CBA terms, workout invitations,
  the hard conversations about decline.
- Recruiters (high school): letters that become texts that become home
  visits that become offers, each rung driven by the interest model.
- The star teammate and the vet mentor: usage tension, lessons, loyalty;
  a small chemistry state that shows up in role politics, never as a
  hidden on-court modifier.
- The rival: the kid from your high school circuit whose career the sim
  genuinely tracks against yours for fifteen years. Draft order,
  head-to-head box scores, awards races: the phone remembers all of it.
- Family: sparse grounding beats, two or three a season.
- The beat writer and the wire: interview moments (rare, three-choice,
  consequence-backed), plus the news desk already shipped, now writing
  about you: stock ladders, milestone chases, trade rumors with your
  name in them that you can respond to.

Discipline rules, from the research's failure list: no filler quizzes
(the FM press-conference lesson); every conversation is backed by real
state (trust, morale, contract, stock) and quotes real events (your
actual line last night, your actual history with the sender); choices
are few and consequential; frequency is capped so a season reads like a
season and not a group chat. Two careers never produce the same phone.


## Recruiting and draft stock

Recruiting (high school). Programs hold scouted ranges on you, not your
true sheet: coverage depends on their reach and your circuit's
visibility, which makes exposure a real currency. Interest climbs a
ladder: questionnaire, letter, text thread, in-home visit, committable
offer. Offers carry the four real terms (prestige, coach development
quality, promised role, system) plus NIL. Offers are alive: slump and a
program cools; another prospect commits and your spot closes. Signing
day is a ritual screen with a hat choice when you have earned one, and a
walk-on conversation when you have not. Being under-recruited is a
designed origin story, not a failure state.

Draft stock. A weekly mock-draft ladder written by the insider byline,
aggregated from each NBA team's private perceived value of you: their
scouts' coverage of your circuit, their positional needs, their persona
(the risk-taker chases your ceiling range; the conservative front office
wants your floor). Stock moves for legible reasons the story names: the
34-point conference final, the ankle in February, the measured wingspan
at the combine. The gap between your stock and your truth is the fog
working on you: you can be better than your slot and spend a rookie year
proving it, or get drafted on hype into a pressure you have to survive.

Draft-season events: the combine (measurements go public and reprice
you), team workouts (invitation-only; attending shows that team more
truth, which cuts both ways), promise rumors through your agent, and the
green room itself: picks tick past, your phone buzzes, and the fall, if
it comes, is money out of your rookie scale and a chip onto your
shoulder the news will keep referencing.

Declare-or-return (college): the agent gives a stock projection as an
honest range with reasons, never a clean number. Return and develop
under a good coach, or go while the hype is high. Both are real
strategies with real costs.


## The NBA years and the descent

The league you enter is the shipped franchise sim, whole: thirty AI
front offices, the real CBA, the schedule, injuries, the news desk,
awards, history. Career mode adds the player's seat at tables that
already exist:

- Contracts from your side: rookie scale options exercised or declined
  over your head, the qualifying offer decision, extension windows,
  restricted free agency where the market bids and your incumbent
  matches or does not, and eventually the max conversation. The agent
  thread carries every negotiation with real numbers.
- Trades happen to you. The rumor mill already runs on real negotiation
  state; when your name is in it, you hear it from the insider before
  the call comes. You can ask for a move (the disposition system already
  models requests) or put your head down.
- Free agency as a player: offers arrive with money, years, role
  promises, and a contender-or-money shape. Role promises are tracked
  and honoring them is real: a team that promised the starting job and
  buried you owes you a grievance the phone will conduct.
- Seasons have texture you do not control but live inside: a coach
  firing changes your game plans; a star arriving changes your usage; a
  rebuild strands you as the vet mentor to someone else's career arc.

The descent is designed with the same respect as the climb. Offers
shorten, options flip to the team's side, the minimum market arrives.
The China and Europe forks pay real money into the career ledger and
produce real (coarse-calibrated, registered) seasons. Retirement is
chosen, not imposed, unless the offers genuinely stop. The epilogue
generates from the record: the wire's retirement story, the almanac
career page, the hall-of-fame ballot four seasons on, a jersey in the
rafters if the franchise's history machinery says you earned it. Then,
if you want, the same save hands you a GM chair and the world keeps
going.


## Architecture

A third pure package plus app extensions, same law as everything else:

    packages/career/   pure deterministic career state machine: zero
                       node: imports, browser-safe. Consumes
                       @hoopsh/engine, @hoopsh/data, @hoopsh/franchise.
                       A career is a pure function of (seed, choice
                       log). All randomness through the franchise rng
                       streams under a 'career' namespace.
    packages/app/      grows career API routes, career save files, and
                       the career UI register (the phone plus the
                       existing broadcast register).

The load-bearing structural choices:

- The career player IS an FrPlayer. He lives in career state pre-NBA and
  is inserted into the League's draft class at entry; every existing
  system (scouting fog, development, contracts, news) sees him natively.
- Circuits are lightweight seasons, not League objects: a Circuit has
  teams, a schedule, standings, and a bracket, simmed through the same
  GameJob path the franchise uses. GameJob gains an optional rules
  passthrough so circuits play under their own packs (prep quarters,
  NCAA halves, FIBA shapes for Europe, the NBL, and China). Circuit
  fidelity is engine-real for every game you are part of.
- The NBA world is a real League created at career start so the thirty
  front offices, their scouts, and their transactions exist while you
  are in high school. Pre-entry seasons advance on the fast fake sim
  (structurally real: standings, lotteries, draft classes, transactions;
  box-score fidelity begins the season you arrive). Registered as C11.
- The week tick is the career's advanceDay: allocation effects, circuit
  game days, phone generation, recruiting and stock updates, all
  deterministic. In the NBA phase it wraps the franchise day loop.
- Development for the career player and his circuit cohort applies the
  same params.dev curves through a per-player review function extracted
  from people/dev.ts (additive change to franchise, no behavior change
  for the GM game).


## Scope cuts, v1 register

In, at real depth: creation with backgrounds, budgets, signatures,
hidden ceilings; HS senior season on a prep pack with the full
recruiting ladder; college route (10-team conference, conference
tournament, 16-team national bracket, declare-or-return, NIL-lite);
Europe and NBL routes as compact leagues on their packs; combine,
workouts, stock ladder, green room draft night; the full NBA career
inside the shipped franchise sim; the approach system (pre-game) with
coach trust and role logic under the reacting-world invariant; the
weekly allocation loop; the phone with seven thread types; playing-hurt
choices on the real wear model; late-career China and Europe forks;
retirement epilogue, HOF vote, same-save GM unlock; deterministic
careers; an auto-career acceptance harness.

Out, registered (the C-register, same discipline as the F-register):

| # | cut | cost | lift when |
|---|---|---|---|
| C1 | mid-game approach changes | no timeout adjustments | an engine seam for segmented simulation |
| C2 | playable pre-senior HS years | shorter runway | demand exists |
| C3 | persistent multi-decade college world | non-user college rosters regenerate per season (programs persist as identities; your rivals persist as people) | a college league instance worth its cost |
| C4 | G-League and OTE routes | fewer forks | arrives with franchise F4 |
| C5 | national teams and Olympics | no FIBA windows | calendar work; the best future ritual |
| C6 | endorsements beyond a light ledger; social-media sim | fame lives in the wire and the phone | probably never; ages badly |
| C7 | multiple created players per save | one life per save | re-roll is cheap by design |
| C8 | authored storylines | none; excluded on principle | never |
| C9 | Euro, NBL, China calibration depth | coarse bands at launch, like the NCAA pack today | dedicated calibration arcs |
| C10 | on-court chemistry modifiers | relationships act through role, trust, and the phone | consistent with franchise F1 |
| C11 | pre-entry NBA seasons on the fast sim | background box scores are statistically crude until you arrive; structure (standings, lotteries, classes, trades) is real | engine throughput or patience |

Build-time additions (registered at the 2026-07-31 landing; details in
REGISTER.md W66-W68 and docs/CAREER_INTERNALS.md):

| # | Cut | Consequence | Revisit when |
|---|---|---|---|
| C12 | past-season circuit game records | live only in the app session archive; 404 after reload | a results archive on CircuitSummary |
| C13 | NBA minutes priced by career role | the franchise rotation owns minutes; the ladder drives grading, trust, the phone | a minutes seam priced by role |
| C14 | the AI pricing my trade request | requests move morale and the phone only | a franchise trade-pulse seam |
| C15 | my RFA offer-sheet match window | outside NBA offers sign directly | the match window lands player-side |


## How we prove it works

The verification culture transfers unchanged: claims come with commands.

Hard gates (the suite):

- The reacting-world invariant: across auto-played careers, zero cases
  of a player outproducing his role band for N consecutive games without
  a role response. The single most immersion-critical property.
- Every trust, morale, and stock delta carries a stated reason (a lint
  over the career event log: no unexplained consequence).
- Determinism: same seed plus same choice log replays the identical
  career, byte for byte.
- Careers complete: no stage soft-locks across the auto-career corpus.

Reported bands (npm run gm:career-acceptance):

- Draft outcomes track creation quality with honest spread: Walk-ons go
  undrafted more often than not; Phenoms mostly land top ten; bust paths
  and late-pick star paths both exist.
- Route outcomes differ measurably: college vs Europe vs NBL produce
  different stock distributions, development deltas, earnings curves.
- Career shapes match the researched reality: length distributions, peak
  ages, earnings curves, injury-shortened tails.
- Boredom audit: in every stage, a consequential decision (not a game
  night) lands at least once per two sim-weeks, and no two consecutive
  seasons produce an identical phone-event mix.


## Build plan

Waves per the swarm playbook, manifests disjoint, engine never in scope:

1. Contracts (the interface freeze, orchestrator-written): career
   types.ts, params.ts with per-task section ownership, module stubs
   (THROWS for pure compute, INERT for tick hooks), the complete barrel,
   the app protocol extension, the GameJob rules passthrough amendment
   in franchise (plus worker/fold passthrough), the per-player dev
   review extraction in people/dev.ts, and the shared career test
   fixture.
2. Build A (parallel, disjoint): creation and identity; circuits (packs,
   generation, schedules, brackets); recruiting and offers; draft stock,
   combine, workouts, and the draft-night bridge; approach, trust, and
   the role ladder.
3. Build B (parallel, disjoint): the week tick and energy economy; the
   phone content system; the NBA-phase bridge (player-side contracts,
   agency, trades-to-you, FA offers); money and the epilogue; the career
   master tick, saves, and server routes.
4. Build C: career UI (the phone shell and career screens; two tasks
   split by files, on the shell contract).
5. Verify: the auto-career harness, the four hard gates, calibration
   passes, docs, and the register updated with measurements.

Pre-declared cut order under time pressure, cheapest first: workout
events collapse into the combine; NBL folds into the Europe route
shape; China becomes an epilogue paragraph instead of played seasons;
family thread trims to one beat a season; the boredom audit reports
instead of gates. The reacting-world invariant, determinism, and cap
legality are never cut.
