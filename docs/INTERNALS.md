# hoopsh internals — a guided tour

Read [ARCHITECTURE.md](../ARCHITECTURE.md) first for the *why*; this is the *where*.
The terse names the code uses (`n()`, `t`/`wt`, `sc`, the one-letter params
aliases) are decoded once in [GLOSSARY.md](./GLOSSARY.md).
Everything below assumes the governing rule: **`engine` imports nothing; everything
else consumes its event stream.**

## The tick pipeline (10 Hz)

```
simulateGame(cfg)
 └─ tick(dt)                                 sim/game.ts
     ├─ wallT += dt                          (replay timeline: never pauses)
     ├─ phase dispatch:
     │   live        → tickLive              sim/game.ts
     │   dead        → tickDead              sim/possession.ts
     │   freethrows  → tickFreeThrows        sim/fouls.ts
     │   scramble    → tickScramble          sim/possession.ts
     └─ recordFrame                          sim/game.ts

tickLive, in order:
  advanceClock (game clock; stops at the horn) → ball flight? resolve on arrival
  → period expiry → shot-clock violation check → windup in progress?
  → possession phase transitions → holder movement intent → dribble accounting
  → decideBall() at each decision window → executeAction → reach-in checks
  → charge check → offense/defense brains → integrateMovement → fatigue
```

**Two time axes.** `t` is game-clock time (stops at whistles and the horn; stats and
minutes key on it). `wallT` is the replay timeline (advances every tick; frames and
event `wt` key on it). Do not mix them.

## Module map — `packages/engine/src/`

| File | Owns | Start here when changing… |
|---|---|---|
| `sim/game.ts` | orchestrator: init, tick dispatch, live tick, movement intents, frames | tick order, decision cadence, replay frames |
| `sim/possession.ts` | possession lifecycle, dead balls, scrambles, periods, tip | pace accounting, inbounds, period/OT rules |
| `sim/shooting.ts` | windup → release → resolution, assists | anything between "decides to shoot" and the rim |
| `sim/passing.ts` | pass flight, steals/OOB, reach-ins | turnover mechanics |
| `sim/fouls.ts` | foul bookkeeping, bonus, FT sequences | whistle rules |
| `sim/subs.ts` | lineup swaps, fatigue rotation, foul-out replacement, garbage-time concede (LIVE: final-period clock-scaled margin line + hysteresis, both benches close decided games, leader first; requires the live coupling — provenance in `params.ts` `sub.concede*`) | rotations, garbage time |
| `sim/movement.ts` | clock advance, physical integration, collision, fatigue | locomotion, energy |
| `sim/ai.ts` | **all basketball behavior** — the stable barrel over `sim/ai/` | start below, per layer |
| `sim/ai/decide.ts` | decideBall: ball-handler utilities + softmax | shot selection, pass choice, drives |
| `sim/ai/concepts.ts` | the bounded-rationality layer, consolidated (drilled-behavior bias terms; concept 6 = game-state urgency: clock kill, hold-for-last, two-for-one; concept 7 = score pressure: channel-1 continuation tilt wired but MEASURED NULL, ships at 0 — channel-2 defensive intensity LIVE at `scorePressureDefGain` 0.3; concept 8 = probe culture, STAGED at zero magnitudes; concept 9 = opening set, LIVE since the FLOW flip; concept 10 = OREB scramble economy, LIVE — both under "Flow-program families" below) | decision bias terms, late-clock behavior, game-state coupling |
| `sim/ai/actions.ts` | pnr/post/iso/dho lifecycle | calling & phasing team actions |
| `sim/ai/offense.ts` | spacing spots, cuts, screens, shot-reaction crash/boxout | off-ball offense |
| `sim/ai/defense.ts` | matchups, help, blitz, drop, containment, denial, sag; the on-ball containment gap + closeout slack consume concept 7's channel-2 score-pressure lean | defensive positioning |
| `sim/ai/shared.ts` | creation hierarchy, defender queries, locomotion policy | cross-layer queries |
| `sim/endgame.ts` | endgame layer (`GameConfig.endgame`, **default ON** since the n=1260/arm flag-on survey; explicit `endgame: false` is the byte-identical legacy path): timeout brain (plus the game-wide timeout economy since the FLOW flip — below), intentional-foul targeting, chase arithmetic shared with concept 6 | late-game management |
| `sim/resolve.ts` | probability models: shots, contests, passes, rebounds | make/miss math |
| `sim/params.ts` | **every tunable constant** — the composed calibration surface: `SimParams`, `defaultParams`, `paramProvenance`, `withParams` (#36 split) | calibration; never hardcode a constant elsewhere |
| `sim/params.<block>.ts` | one module per block (`shot` `foul` `pass` `reb` `decide` `move` `fatigue` `sub` `endgame` `officiating` `ai`): the block's interface, calibrated defaults, and per-knob provenance map | an individual knob's value, docs, or provenance |
| `sim/params.provenance.ts` | the `Provenance` tag vocabulary (`REAL`/`SWEPT`/`FEEL`) and the #36 adjudication rules | what a provenance tag means |
| `sim/state.ts` | shared types + `emit()` | event stamping, new state fields |
| `core/events.ts` | the event schema — **the public contract** | anything consumers see |
| `core/rng.ts` | seeded sfc32 + distributions | never use Math.random |
| `geometry/court.ts` | court build, shot zones, spacing spots | three-point geometry |
| `rules/rulepack.ts` | league packs (NBA/NCAA/EURO) | league differences |
| `model/player.ts` | attributes & tendencies (the 38 dials) | the editable surface |
| `model/derived.ts` | rating → physical-unit curves | what "90 speed" means |
| `replay/replay.ts` | replay JSON assembly | viewer data needs |

Flow-program families, live since the FLOW flip (`853ebd1`; wired
STAGED-inert first, byte-identity proven against the golden corpus). Every
rate and magnitude lives in `sim/params.ts` — that file is the source of
truth; values quoted below are identity anchors only.

Officiating vocabulary (`params.officiating`; event kinds `jump_ball`,
`violation`, replay reviews — replay format v3, with the box/narration/viewer
consumer chain): kicked balls at pass arrivals (passing.ts), held-ball jump
balls at rebound scrambles and on-ball reach-ins (possession.ts / passing.ts;
an offense-retains tie-up floors the shot clock like an offensive board),
defensive/offensive goaltends (shooting.ts / the putback branch), travel
hazards on committed drive and post time (game.ts), technicals after foul
whistles (fouls.ts), take fouls (the endgame-hunt relabel plus the
beaten-in-transition window, passing.ts), replay reviews at flagged dead
balls, late makes, and period ends (possession.ts; wallT-only stoppages —
the game clock never moves). The rates are corpus-fitted REAL targets
(ffit-officiating) and deliberately NOT in `harness/knobs.ts`: the 17-band
sweep measures no officiating statistic and would trade them to zero to
relieve the tov/pf ceilings; the flowboard G2 gate owns them instead.

Concept 9 (opening set) raises the shoot/drive bar on a period's first
possession only — never the pass channel, never the continuation
(`ai.openerShootMalus` 0.55 after the post-audit re-fit, drives paying
`openerDriveShare` 0.75 of it; openers start from a real formation via the
period-break re-set). Concept 10 (scramble economy) is the
putback/continuation family after a player OREB: a putback shoot term and a
kick-out pass term priced against the post-OREB continuation, plus the M2a
supply half — one hard perimeter refill behind the grab (`ai/offense.ts`
onOrebSecured). Flowboard G3/G4 gate them (the G4 kick-3 supply residual is
REGISTER W57).

Timeout economy (`params.endgame` `to*` dials; `endgame.ts` decideTimeout
plus the possession.ts dead-ball/live sites; the budget stays in
`rules.timeoutsPerGame`): mandatory (TV) stoppages at the NBA Rule 5 VI(b)
anchors, the REAL Q4/late/OT caps, the coach voluntary-timeout hazard
(run- and trail-pressure weighted, cooldown, quarter-open quiet window,
pre-cap burn), and the live-ball site (defensive board or steal, called
before the advance). Corpus-fitted (ffit-timeouts); flowboard G1 gates
volume and quarter coverage. The legacy stop_run trigger is retired in
place at `timeoutRunPts` 999 — the hazard subsumes it; the param and the
endgame.ts branch that still reads it go together when removed.

Consumers: `stats/box.ts` (events → box score, exact minutes/±; official-convention
FGA — no attempt charged on a shooting-foul miss, `5d9671f`), `data/` (schemas,
validation, archetypes, sample packs), `narration/` (template PBP + the booth
— a two-voice broadcast pipeline: `sense.ts` GameSense fold → `beats.ts`
tags/heat/registers → `booth.ts` turn-taking director → `voice.ts` +
`personas.ts` voice packs (Corbin/Tremaine/Boone; design doc
docs/BROADCAST.md); speaks the full flow vocabulary incl. mandatory
timeouts and held-ball jumps; `shotcall.ts` classifies which basketball
NAME an attempt gets — layup/dunk/hook/tip-in/jump shot — from ShotEvent
data alone),
`packages/viewer/` (frozen prototype).

Harness map — `packages/harness/src/` (measurement and tooling; rows for the
modules an agent is likely to be pointed at):

| File | Owns |
|---|---|
| `bands.ts` + `cli.ts` | the NBA acceptance bands (count them HERE, per AGENTS §4.4) + the gated batch runner |
| `sweep.ts` / `knobs.ts` / `solve.ts` | parameter search over SimParams (margin objective) |
| `noisefloor.ts` / `calreport.ts` | measured noise floor (40 bases → `noise-floor.gen.ts`); n40 center positions vs band edges |
| `fidelity.ts` | star-fixture identity gates (Curry/LeBron/Jokić profiles) |
| `texture.ts` | frame-level feel forensics: speeds, stillness, ping-pong passing |
| `flow.ts` + `flow-metrics.ts` | game-arc forensics + event grammar (CLI/report + doctrine in flow.ts; pure metric library in flow-metrics.ts) |
| `turing.ts` | blind PBP discrimination protocol vs real bbref logs; also exports the matched-representation neutral schema (`NeutralRow`) the flowboard measures on |
| `scoreboard.ts` | the flowboard (`npm run flowboard`): the flow program's 13-gate judgment instrument — T1/T2 blind discrimination by a deterministic in-repo statistical judge over the neutral schema, plus gates G1-G11 (timeout volume, officiating rows, opener/heave/sub grammar, rebound cadence, shot diet — dead-ball/texture structure the enforced flow gates cannot see). One algorithm, two adapters: the corpus side is live-computed from the committed 184-game shards at print time, never hand-typed; writes `out/scoreboard.json` |
| `oos.ts` | out-of-sample generated-roster bands + the distributional report |
| `season.ts` / `matchup.ts` / `league.ts` | season driver + standings, Monte-Carlo matchup distributions, deterministic fictional leagues — see `docs/SEASON.md` |
| `leagues.ts` | league selection: one id resolves rule pack + bands + pace basis TOGETHER (`--league`; prevents grading NCAA play against NBA bands) |
| `parallel.ts` | worker-pool game runner; determinism across worker counts is the acceptance test |
| `fingerprint.ts` | golden fingerprint corpus — the pure-refactor byte-identity tripwire (default mode, run locally) and the CI determinism gate (`--determinism`: corpus double-built in-process, the two runs must match; not a gameplay gate since issue #33) |
| `fit-roster.ts` | stats → ratings inversion (`rosters:fit`): real box lines → validated 38-dial packs |
| `args.ts` | shared loud CLI flag parsing (exists because of the silent `--seed` incident) |
| `reanchor.ts` | the seed-pin re-anchor helper (issue #50): verifies every `seed-pins.gen.ts` anchor — the W54/W56 pinned-fixture class consumed by events/subs/timeouts/leakout (engine), season (harness), pbp (narration) — against the current streams; `--write` re-scouts stranded anchors per each pin's documented doctrine, rewrites the generated anchor files, and re-runs the consuming tests as confirmation. Never edits a test or lowers a floor; REFUSES (exit 1) when a scan exhausts or a collapse discriminator trips (per-pin guards against laundering a dead mechanism through lucky seeds — the review #88 finding; doctrine audit in the file header). Confirmation red is classified: managed failures restore and exit 1; failures matching only the KNOWN_UNMANAGED registry restore too unless `--keep-unmanaged-red` keeps the re-anchor and exits 2, loudly listing the remaining hand tax |

Roster-authoring tooling (`tools/gen-schema.mjs`, `roster-new.mjs`,
`roster-validate.mjs` — `npm run schema:gen` / `roster:new` / `roster:validate`)
sits outside the packages: it consumes `@hoopsh/data`'s exported schema
definitions and archetypes, and emits/validates the hand-edited packs. The
editor JSON Schema at `data/schema/team-pack.schema.json` is GENERATED — see
`docs/ROSTERS.md` for the authoring loop and `packages/data/src/schema.ts` for
the single source of truth it derives from.

## Design rules that maintain consistency across this codebase

1. **One probability form.** Every resolution is `sigmoid(base + Σ terms)`; every
   constant lives in `SimParams`. Rating influence goes through `n(rating)` ∈ [-1, 1].
2. **Self-consistent AI, plus a bounded-rationality layer.** The model that
   resolves a shot is the model the AI uses to *choose* it (`shotEV` calls
   `shotMakeP`) — the EV core cannot drift from reality. On TOP of that core,
   decideBall applies deliberate non-EV bias terms (catch-and-shoot
   decisiveness, action patience, usage pressure, …): real players are not
   EV-optimizers, they run drilled behaviors, and each term models one. This
   is a DESIGN DECISION with a maintenance cost — the terms accumulate per
   mechanic and are due for consolidation into fewer principled concepts, and
   the decision-vs-EV divergence should be measured, not assumed small (both
   tracked on the roadmap).
3. **Determinism is mandatory.** One seeded `Rng` per game. No `Math.random`, no `Date`,
   no iteration-order dependence. Same seed ⇒ bit-identical events + frames.
4. **Events are the only truth.** If a consumer needs something, it goes in the event
   stream — never reach into engine internals.
5. **Actions are thin scaffolding.** Pick-and-roll sets up geometry (screen contact,
   stun, roll); the payoff (pull-up space, pocket pass) *emerges* from existing systems.
   The post-up follows the same shape: the entry reuses the pass model, the double-team
   reuses help defense, and the spray out of the double reuses kick-out machinery.
6. **Staged surface is labeled.** Fields marked `STAGED` in `model/player.ts`
   (`consistency`, `tend.pushPace`, `Tactics.pace`) are defined but not yet
   consumed — each is tied to a roadmap stage (the pace pair belongs to the same
   team-pace layer). Wiring one without its stage's mechanics adds unvalidated
   surface area.

## The safety net (run all of it before pushing)

```bash
npm run test     # full suite: determinism, geometry, archetypes, narration, schema,
                 # wide-band realism guard, and the INVARIANT SUITE (below)
npm run batch -- --games 24    # fine-grained NBA acceptance bands
npm run bench    # ≥1 game/sec budget (throughput is hardware-dependent — measure locally, don't quote)
```

`packages/engine/test/invariants.test.ts` permanently enforces what two adversarial
audit rounds verified: possession start/end balance, zero post-horn scoring, exact
minutes conservation, plus-minus ≡ margin×5, score reconstructible from events, no
off-court or fouled-out actors, team-foul monotonicity, strictly monotonic replay
frames, and a physical teleport ceiling on player movement. **Policy: if a change to
the engine makes an invariant fail, the change is treated as wrong — never the
invariant.**

`packages/engine/test/adversarial.test.ts` pins the input contract: non-finite
ratings throw at the `simulateGame` boundary (tier 'finite', always on),
`validate: 'strict'` additionally enforces the data-pack ranges, a stalled
game throws instead of faking a `game_end`, and extreme-but-finite rosters
complete with invariants intact.

## Calibration

The calibration workflow, the noise-floor doctrine, what "locked" does and
does not claim, and the CURRENT measured state all live in
[CALIBRATION.md](./CALIBRATION.md) (split out of this file 2026-07-29 —
it had grown a 600-line measured-state journal; superseded eras are in
[history/calibration-eras.md](./history/calibration-eras.md)).

## Known simplifications (deliberate, documented)

Simplified inbounds (timed reset, no inbound passer) · endgame management
(timeouts, intentional fouling, hold-for-last, two-for-one, clock burn) is
implemented and DEFAULT-ON since the calib/integration landing
(`endgame: false` = the byte-identical legacy path); the game-wide timeout
economy (mandatory/TV anchors, the coach voluntary hazard, the live-ball
site) is live since the FLOW flip, corpus-fitted and gated by flowboard G1 —
ATO play-calls remain unmodeled · no backcourt/
8-second violations (travels exist as officiating-vocabulary hazards) · the NBA
last-2:00 team-foul penalty, the OT bonus threshold drop, and the per-period
made-basket clock stops ARE modeled since the rules landing (rulepack.ts
`lateWindow*`, `teamFoulBonusAtOT`, `makeStopClock*`; REGISTER W63) ·
team-foul counting hardcodes the NBA rule under every pack (offensive fouls
are personal-only, sim/fouls.ts `countsTeam`): under NCAA men's rules a
player-control foul DOES count toward the team-foul/bonus total (while never
awarding shots), so the NCAA pack under-counts toward its 7/10 thresholds —
mechanizing it needs a rulepack field (a10 contract scan F5) ·
the offensive-rebound shot-clock reset FLOORS at shotClockOffRebSec
(`Math.max`, sim/possession.ts — a board with 20 s left keeps 20) where the
real NBA/FIBA rule resets TO 14 unconditionally on a rim-contact miss; the
difference binds only on early-clock misses (small pace bias; changing it is
a calibration-ladder change — a10 contract scan F6) ·
(the Stage 2 assists/assisted-share gaps are CLOSED: usage pressure,
delivery quality, and DHO conversion brought assisted share to ~57-61% and
the band is now enforced like any other — see the fidelity-phase commits) ·
man-to-man with drop coverage, plus top-lock denial of extreme-gravity shooters (and its backdoor-cut counter) ·
shotEV prices the shooting-foul EV unconditionally while resolution awards a
whistle only when a contester exists (shooting.ts gates on `contest.by`), and
skips the blockedFoulMult damping — a wide-open look carries ~0.15 phantom
foul EV at the rim and every pass valuation (contest hardcoded `by: null`)
includes it; bands are calibrated around the bias, so making shotEV
realizability-aware is a re-calibration change, not a patch (a6 line audit) ·
bench-exhausted foul-outs play on (NBA rule analog: a fouled-out player remains
when no substitute exists — reachable only with short/foul-storm rosters; the
no-fouled-out-actors invariant applies whenever replacements exist, and every
lineup-consuming site falls back consistently rather than crashing — hardened
after the Stage 2 adversarial audit) ·
narration is a maintained layer (wave-1 polish: shot-call
classification, bbref-register turing renderer; the booth landed as its
second pipeline — docs/BROADCAST.md); the viewer is a frozen prototype.
