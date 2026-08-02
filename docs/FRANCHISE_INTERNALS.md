# FRANCHISE_INTERNALS.md — per-module map of the franchise layer

The franchise counterpart of docs/INTERNALS.md: where things live, what
each module owns, and the traps. The design rationale is
[FRANCHISE.md](./FRANCHISE.md); this file is the working map. When a
module header and this table disagree, the header is newer; flag the
discrepancy (AGENTS.md §2.10 applies here unchanged).

## Reading order for a new contributor

1. `docs/FRANCHISE.md` (the design law and the register of simplifications)
2. `packages/franchise/src/types.ts` (the domain model, heavily commented)
3. `packages/franchise/src/params.ts` (every behavioral constant, with provenance)
4. `packages/franchise/src/tick.ts` (the day loop: the order everything runs in)

## packages/franchise/src

| file | owns | notes |
|---|---|---|
| `types.ts` | the domain model, user-action union, worker job shapes, save schema | frozen vocabulary; changing shapes here is a design decision, not an edit |
| `params.ts` | `FranchiseParams` + defaults | flat, serializable, per-section ownership documented in the header; provenance tags REAL/FEEL/CAL |
| `rng.ts` | RNG stream registry | every stream path is registered in the header comment; unregistered paths are a review reject |
| `teamdata.ts` | the 30 franchise identities | fictional names, scorebug-legible color pairs |
| `genesis.ts` | `createLeague` | returns calendar/schedule EMPTY; the spine lazy-initializes both on first advance |
| `calendar.ts` | season calendar + phase machine | day labels are fictional-year real-month arithmetic |
| `tick.ts` | `advanceDay`, `applyUserAction` | THE order of a league day lives here and nowhere else |
| `inbox.ts` | the GM desk: inbox item generation + deadline expiry (#152) | read-only over league state, zero rng, human-chair gated; autosims and gm:acceptance run byte-identical with it dark |
| `gameday.ts` | franchise -> engine projection, result fold, key plays | injuries/fatigue/HCA/rotation all become roster edits here (SEASON.md seam 2) |
| `schedule.ts` | the 82-game generator | real NBA formula (16/36/30), B2B targets |
| `standings.ts` | standings fold, tiebreakers, seeding | play-in and playoff games never touch standings |
| `postseason.ts` | play-in, bracket, series scheduling, lottery | lottery = sequential weighted draw of the top 4 (documented simplification) |
| `cba/cap.ts` | cap sheets, tax math, apron flags, cap-line growth | integer dollars; rounding rules at the math |
| `cba/contracts.ts` | signing legality, max/min/rookie-scale/QO math | every rule cites docs/history/franchise-research/06-cba-rules.md |
| `cba/tradelegal.ts` | trade legality (matching, aprons, Stepien) | |
| `transactions.ts` | the ONLY writers of roster/contract/pick state | executors validate, mutate, append the Transaction |
| `people/names.ts` | name pools + generator | famous-name blocklist; era-neutral |
| `people/gen.ts` | player/coach/draft-class generation | archetype base + coherent mutation (ROSTERS.md method) |
| `people/dev.ts` | development reviews + aging | legible arcs: every review writes a DevNote with reasons |
| `people/injury.ts` | injury catalog, hazard, recovery | rolls post-game (register F2) |
| `people/disposition.ts` | morale, trade requests | off-court only (register F1); designed quiet |
| `people/retire.ts` | retirement hazard | career-length distribution is an acceptance band |
| `scouting.ts` | fog of war | per-team deterministic error, persistent (never re-rolled) |
| `ai/persona.ts` | GM personas, timeline re-evaluation | |
| `ai/valuation.ts` | player/pick/package value | team-context value, not global |
| `ai/trade.ts` | negotiation, verdicts, league trade pulse | anti-fleece = value floor + patience; anti-cowardice = pressure states; user offers land as inbox items carrying a frozen offer copy - accept executes exactly that copy (tick.ts respondToRequest, #158) |
| `ai/fa.ts` | the free-agency market | stars first, tail to September |
| `ai/draftai.ts` | AI draft boards | built from their own scouts' wrong numbers |
| `ai/roster.ts` | depth charts, rotations, roster upkeep | |
| `media/news.ts` | the news desk | template pools, seeded variety, fixed bylines; numbers only from sim data |
| `media/moments.ts` | phase-transition stories | championship, lottery order, draft preview; written at the transitions (tick.ts) because the daily pulse runs before them |
| `media/recap.ts` | game recaps | reads GameRecord, never raw events |
| `media/awards.ts` | races, voting, all-star | 65-game rule in params |
| `media/almanac.ts` | records book, season archives | |
| `index.ts` | the frozen barrel | build tasks implement behind it without editing it |

## packages/app/src

| file | owns | notes |
|---|---|---|
| `protocol.ts` | the frozen UI<->server API contract | the UI mirrors it in public/js/api.js JSDoc |
| `server.ts` | node:http JSON API + static UI | all franchise I/O lives in this package |
| `runner.ts` | worker-pool SimulateJobs | harness parallel.ts pattern: slices, aggregates only |
| `worker.ts` | per-process game worker | argv[2] = job file; ONE JSON blob on stdout |
| `saves.ts` | save files (out/saves/*.json) | meta excluded from determinism hashes |
| `main.ts` | `npm run gm` entry | |
| `acceptance.ts` | `npm run gm:acceptance` | multi-season league-health report; outside the test glob on purpose |

## Traps

- The engine's `Team` is a projection built per game. Mutating a projected
  team changes nothing durable; mutate `FrPlayer`/`FrTeam` and re-project.
- `league.params`, not `defaultFranchiseParams()`, inside modules: sweeps
  and saves vary params per league.
- Two-way players live in `team.twoWay`, not `team.roster`; projection
  includes them only within the game limit.
- Money is integer dollars everywhere; a float that survives to a cap
  comparison is a bug even when the test passes.
- `advanceDay` is the only mover of time. Anything that "happens daily"
  is called from there, in the documented order; a subsystem that
  self-schedules breaks replay determinism.
