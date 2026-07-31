# CAREER_INTERNALS.md — per-module map of the career layer

The implementation companion to docs/CAREER.md (the design law). That
file says what the mode is and why; this one says where everything
lives, which clocks drive it, which rng streams it draws, and how it is
proven. FRANCHISE_INTERNALS.md is the same document for the layer below.

Everything here holds one identity: **CareerState = f(seed, choiceLog)**.
Two runs from the same seed fed the same choices produce byte-identical
careers, and the acceptance harness replays that equality as a gate.


## Reading order for a new contributor

1. docs/CAREER.md — the pillars, the journey web, the scope decisions.
2. packages/career/src/types.ts — the whole domain vocabulary in one file.
3. packages/career/src/tick.ts — the phase machine; every week passes here.
4. packages/career/src/week.ts — what one pre-NBA week actually does.
5. packages/career/src/nbabridge.ts — the same week after draft night.


## packages/career/src

| Module | What it owns |
|---|---|
| `types.ts` | The frozen domain contract: CareerState, clocks, circuits, choices, events, the save shape. Changed only at interface freezes. |
| `params.ts` | Every tunable, sectioned by owner (creation, circuits, week, trust, recruiting, stock, phone, nbabridge, money, tick) and classed REAL / CAL / FEEL in the franchise params tradition. |
| `packs.ts` | Rule packs as career-side data: PREP (4x8min, 35s/one-and-one), FIBA, NBL, CBA_CHINA. Circuit jobs carry them through `GameJob.rules`; the engine never learned league names. |
| `creation.ts` | CreationSpec validation (plain-language refusals) and createCareer: me at seventeen (budget over group base, background shifts, signature tendency identities probed from the data archetypes, hidden ceilings sampled OVER the visible priors), the rival, the NBA world via createLeague with an AI persona in every chair, `careerControlled = [me]`. |
| `circuits.ts` | Every league that is not the NBA: fictional program/club generation, rosters via generatePlayer in kind-true age bands, circle-method round robins on absolute week anchors, reseeded single-elimination brackets, engine-real week jobs (my games keep full event streams), result folds, standings, summaries, honors. |
| `perception.ts` | perceiveProspect: the one fog primitive. Fixed draws per (observer, player), per-observer bias, error easing with coverage — recruiters and NBA rooms mis-read the same kid differently and consistently. |
| `recruiting.ts` | Programs, the interest ladder (rungs move one step a week, cold streaks cool boards), offers that extend/lapse/pull with stated reasons, classes that fill, the once-per-career Euro and NBL doors. |
| `stock.ts` | Draft stock: per-team boards tilted by persona risk appetite, the weekly mock under move caps (shock cap for statement games, listed injuries, combine week), the combine, private workouts, and enterDraftClass — me and the rival move INTO league.players so the real AI boards do the choosing natively. |
| `approach.ts` | The agency core: the pre-game card projected onto my real tendencies through a wiring table (attempts move, ability never does; playing hurt dulls the whole sheet), the coach's plan (centers by role, width by role and personality), deviation scoring. The ONE projection source — circuits and the NBA bridge both call it. |
| `trust.ts` | The coach ledger: role-relative production scoring, adherence grading against the plan, trust movement with personality in the math, and THE REACTING-WORLD INVARIANT — reactGames consecutive above-band games move the role, unconditionally. No trust gate, no personality gate, no exception. |
| `week.ts` | One pre-NBA week: the allocation economy (weekBaseRecovery, then slots; probabilistic integer training landings at the calibrated rate), my post-game injury rolls on the franchise hazard tables (energy floor multiplies hazard), circuit game folding with grading, bracket seeding when the slate finishes, recruiting/stock/phone pulses. |
| `tick.ts` | The master: applyChoice (all sixteen choice kinds, never throws on bad input, the log is the replayable record) and advanceCareerWeek (the phase machine, lazy one-season-per-year circuit builds, the draft-night league drain, year-wrap transitions including signing day and the walk-on door, season accruals and honor harvesting). |
| `phone.ts` | The narrative surface: seven threads, state-backed always (grade notes verbatim, true rung moves, real box lines), caps and burst guards, choices only where answering changes state. Silence is content. |
| `nbabridge.ts` | My seat inside the franchise sim: resolveNbaWeek (seven real league days; the approach swap around advanceDay with a loss-free delta reconcile), contract decisions surfaced once per window, buildMyOffers (cap room + team need; abroad doors when interest thins), trades-to-me re-keying the room, coach reset rules. Conventions (decision ids, offer id prefixes) live in its header. |
| `money.ts` | The single-writer ledger and season accruals by phase (NIL from the committed offer, abroad salaries, the NBA contract year). |
| `epilogue.ts` | Honor harvesting off the real league archives (rings and awards read the ballots — nothing invents a resume), the retirement summary, the legacy score, the HOF ballot and the rafters on the legacy clock. |
| `fastsim.ts` | The engine-free SimulateJobs for the pre-entry league (register C11): deterministic, applyGameResults-compatible lines from the jobs' actual rosters. The world is alive from day one at negligible cost; MY games never run on it. |


## packages/app additions

| Module | What it owns |
|---|---|
| `career-views.ts` | Read models for the career API: trimmed display payloads (the UI never receives a league players map). |
| `server.ts` | The `/api/career/*` routes; a loaded career mounts its NBA world as the current league so every franchise read route serves scenery for free, while the franchise time controls 409 (career time moves only through the choice log). |
| `saves.ts` | One directory, two shapes (`league` vs `career` key); list rows carry their chair; loadCareer rebinds me to one object when an abroad save forked the two maps. |
| `career-acceptance.ts` | `npm run gm:career-acceptance`: scripted pilots live whole careers; gates and bands below. |
| `public/js/screens/career/` | The player-chair screens (creation, the week, the phone, the plan, the season, the game center, recruiting, stock, money, the journey). The shell (`app.js`) is mode-aware; scenery screens (league, news, almanac) are shared between chairs. |


## The two clocks

The career runs on weeks (52 a year); the league runs on days (313 a
season). They drift by design — pre-entry the league is scenery advancing
`leagueDaysPerWeek` fast days per career week, and nothing pre-entry
cares which league day it is. The one hard sync point is draft night: at
`params.tick.draftWeek` the league drains forward on the fast sim to its
draft phase (however far that is), enterDraftClass inserts me, and the
real boards pick. Post-entry the career clock follows the league
(resolveNbaWeek advances real days). Registered consequence: league
season numbers outpace career years by roughly one season per seven
career years; ages inside the league are league-consistent, and my age
runs on the career clock.


## Stream registry (career namespace)

All career draws derive from `streamRng(career.seed, ...)` with fixed
draw counts per call, in the franchise tradition. The franchise-side
registry lives in franchise/src/rng.ts; career streams are documented in
their owning module headers and collected here.

| Stream | Owner | Draws |
|---|---|---|
| `career-ceiling`, `career-traits`, `career-rival`, and creation's probe streams | creation.ts | fixed per creation |
| `career-circuit:<year>:<phase>` | tick.ts → circuits.ts | circuit build |
| `career-circuit:<year>:national` | circuits.ts | national field |
| `career-bracket:<year>` | week.ts → seedBracket | reserved (draws nothing today) |
| `:circuit:<gameId>` (under the career seed) | circuits.ts | game seeds |
| `career-train:<year>:<week>` | week.ts | training landings |
| `career-injury:<year>:<week>` | week.ts | my post-game hazard |
| `career-recruit:<year>:<week>`, `career-recruit:need:<programId>`, `career-recruit-programs` | recruiting.ts / week.ts | fixed |
| `career-scout:<observerKey>:<playerId>`, `career-scout-bias:<observerKey>` | perception.ts | 12 + 6 |
| `career-stock:<year>:<week>` | stock.ts | 1 gaussian |
| `career-phone:<year>:<week>` | phone.ts | sampling |
| `career-gm-fill` | tick.ts / nbabridge.ts | persona backfill (first filler wins) |
| `career-nba-coach:<teamId>` | nbabridge.ts | 1 int |
| `career-nba-offers:<year>:<week>` | nbabridge.ts | 5 |
| `career-hof` | epilogue.ts | the borderline ballot |


## The franchise seams (everything the career needed from below)

- `League.careerControlled?: PlayerId[]` — listed players are skipped by
  franchise auto-decisions: retirement rolls, the AI FA market, player
  options (team options stay the club's), RFA auto-match, and the trade
  AI when the user chair is human. The career bridge surfaces those
  decisions instead.
- `GameJob.rules?: RulePack` — circuit jobs carry their pack through the
  same SimulateJobs seam; gameday folds pace by `periods x periodMinutes`
  and labels halves with an H prefix.
- `reviewPlayerDevelopment(player, ctx)` — the per-player extraction of
  the development review (RNG-order preserving), so career training rides
  the same growth model the league uses. `distributeGrowth`/`groupMean`
  are exported for the weekly landings.
- The engine itself is untouched by the career build: every wave was
  verified byte-identical against the then-current fingerprint baseline
  (1143 events, CAS 132-116, pre-rules-landing; the rules landing that
  merged alongside re-baselined separately).


## How we prove it works

Suite (in `npm test`): approach/trust unit gates including THE INVARIANT
both directions, spine (choices, allocation, recovery, clocks, year-wrap
doors, week determinism), circuits (engine-real seasons, bracket
propagation, canonical projection), creation (validation, identity,
cross-process determinism), recruiting, stock, phone (caps under flood,
byte determinism), nbabridge (the swap leak check, offers, determinism).

`npm run gm:career-acceptance` (outside the test glob, minutes by
design): scripted pilots (phenom-aggressive, fourstar-balanced,
walkon-grinder) live whole careers on the worker pool.

GATES (exit 1): careers complete their arcs without throwing; the role
clocks never sit at reactGames unanswered (the reacting-world invariant
at fleet scale); every event, grade, and ledger row carries a nonempty
reason (the explained-consequence lint); a 40-week scripted career
replays byte-identical.

BANDS (reported, never fatal): draft outcomes track creation quality;
the boredom audit (content pulse per week, zero-event streaks, phone
volume); the energy economy holds off the floor; career shapes by phase.


## Traps

- `league.teams` is a Record, not an array (bit the first draft drain).
- CircuitSummary.myLine stores season TOTALS; divide by gp for per-game.
- Folding a circuit nulls it; game records for past seasons live only in
  the app's session archive (register row, cut order: circuit viewer).
- The approach card is consumed by the FIRST grade after it is set
  (nextApproach is for one game); the UI resends per game night.
- RouteOffer.kind has no NBA or China arm; the id prefixes (`nba:`,
  `abroad:china:`, `abroad:euro:`) are authoritative (nbabridge header).
- An abroad phase holds me as one object in BOTH player maps; JSON saves
  fork it and loadCareer rebinds (never deep-copy me on load paths).
