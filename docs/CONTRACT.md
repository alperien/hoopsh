# The engine API contract

What a downstream project may rely on when it consumes `@hoopsh/engine`, what
may change under it, and what a version bump means. This document declares
stability; it does not explain mechanics (`docs/INTERNALS.md`) or packaging
(`docs/EMBEDDING.md`).

Ground truth: the doc comments in `packages/engine/src` are the per-field
specification, and they are newer than this file whenever the two disagree
(AGENTS.md §2.10). Every section below cites its source. Version means the
`version` field of the root `package.json`; the project uses semantic
versioning (see CHANGELOG.md).

## 1. The stable surfaces

Four surfaces are stable. Everything else in `packages/engine/src` is
internal, whatever it exports.

1. The event stream: the `GameEvent` union in `core/events.ts` (§2).
2. The replay artifact: the `Replay` shape in `replay/replay.ts`, including
   the frame row layout (§3).
3. The public exports of `packages/engine/src/index.ts` (§4).
4. The determinism guarantee (§5).

"Stable" means: within a version the surface behaves as documented, and
across versions it changes only under the policy in §7.

## 2. The event stream

Events are the only contract between the engine and its consumers
(AGENTS.md §1.3). The stream fully describes the game: box scores are
reconstructible from events alone, and `packages/engine/test/invariants.test.ts`
enforces that. Field-level invariants and per-kind caveats live as doc
comments in `core/events.ts`; that file is the specification. This table is
the index of it.

### 2.1 Common fields

Every event carries five stamped fields (`Base` in `core/events.ts`; the
single stamping site is `sim/state.ts#emit`):

| Field | Meaning |
|---|---|
| `t` | Game-clock time: absolute elapsed game seconds across periods, frozen during stoppages. Stats key on it. Rounded to 2 decimals. |
| `wt` | Wall-clock timeline: seconds on the replay timeline, advancing through stoppages. Viewers key on it. Always `>= t`, monotonically non-decreasing across the stream. Rounded to 2 decimals. |
| `period` | 1-based period number; exceeds `rules.periods` in overtime. |
| `clock` | Seconds remaining in the period, floored at 0. |
| `score` | `[home, away]` AFTER this event. |

The two time axes never mix (AGENTS.md §1.5). Use `t` for anything
statistical and `wt` for anything about replaying the game. Events stamp
`wt` at 2 decimals but replay frame rows stamp their wall-clock at 1, so an
equality join between events and frames fails; sync by ordering or nearest
timestamp. `LineupSnapshot.t` is copied from event `wt` and matches exactly.

### 2.2 The event kinds

All 18 kinds, from the `GameEvent` union in `core/events.ts`. Fields listed
are the fields beyond `Base`; `?` marks optional fields. Emitters are
grep-verified construction sites; every emission flows through
`sim/state.ts#emit`.

| `type` | Fields | Semantics | Emitter |
|---|---|---|---|
| `game_start` | `home{teamId, lineup}`, `away{teamId, lineup}` | Exactly once, first in the stream. `lineup` is each side's starting five in stable slot order; the slot index is meaningful (frame `holderSlot`, §3). | `sim/game.ts` |
| `tip_off` | `winner` | The game-opening jump ball and the start of every overtime period. `winner` gets the ball. Regulation Q2/Q3 open with the ball going to the opening tip's loser and Q4 to its winner (the real W-L-L-W rule); those openers are ordinary inbounds, not new tips. | `sim/game.ts` (opener), `sim/possession.ts` (each OT) |
| `period_start` | none | Start of every period after the first, including overtimes. Count is always periods played minus 1: period 1 opens `game_start` then `tip_off` instead. An overtime opens `period_start` then `tip_off`. | `sim/possession.ts` |
| `period_end` | none | Once when a period's clock reaches 0, before the next `period_start` or `game_end`. | `sim/possession.ts` |
| `game_end` | none | Exactly once, always last. Only fires when a period ends untied with regulation and queued overtimes exhausted; a tied period always adds another overtime. | `sim/possession.ts` |
| `possession_start` | `team`, `kind` | Opens a possession for `team`; pairs 1:1 with a later `possession_end`. `kind`: `inbound` (dead-ball inbound), `live_rebound` (defense plays on off a live board), `steal` (takeaway, ball in hand), `tip` (period-opening jumps and defense-won held-ball jumps). | `sim/possession.ts` |
| `possession_end` | `team`, `outcome` | Closes the matching possession, exactly once per possession (guarded in `endPossession`). `outcome`: `made_fg`, `made_ft`, `def_rebound`, `turnover`, `period_end`, `held_ball`. Pace and per-possession stats depend on the 1:1 pairing. | `sim/possession.ts` |
| `pass` | `team`, `from`, `to`, `kind` | A completed pass between on-court teammates. A failed pass is a `turnover` (`bad_pass` or `out_of_bounds`), never a `pass` event. `kind`: `normal`, `kickout` (out of a live drive), `outlet` (transition), `entry` (post feed), `handoff` (DHO). | `sim/passing.ts` |
| `shot` | `team`, `shooter`, `x`, `y`, `distFt`, `zone`, `three`, `moveType`, `contest`, `contestedBy?`, `made`, `points`, `assist?`, `blockedBy?`, `foul?` | A field-goal attempt; shot charts come straight off `x`/`y`/`distFt`/`zone`. Invariants: `points` is 0 on a miss and `three ? 3 : 2` on a make; `assist` only on makes with the passer still on court; `blockedBy` only on misses; `foul` present on shooting-foul contact (`andOne: true` means the shot also fell, one FT; false means a miss with `ftAwarded` FTs). | `sim/shooting.ts` |
| `free_throw` | `team`, `shooter`, `n`, `of`, `made`, `oneAndOne?`, `technical?` | One attempt within a trip, position `n` of `of`. The final attempt (`n === of`) is what can close a possession. `oneAndOne` stamps every attempt of an NCAA-style one-and-one trip (a missed front end ends the trip with a live ball). `technical` FTs are 1-of-1, produce no rebound, and never change possession. | `sim/fouls.ts` |
| `rebound` | `team`, `player?`, `offensive`, `deadBall?`, `x`, `y` | A rebound; `x`/`y` is the ball's landing spot, not the rebounder's. `player` set: an individual live-ball board. `player` absent without `deadBall`: a team rebound, awarded at a dead-ball inbound. `deadBall: true`: the scorekeeping formality after a missed non-final FT, excluded from all rebound totals (stats/box.ts follows official scoring). | `sim/possession.ts` (live and team), `sim/fouls.ts` (dead-ball formality) |
| `turnover` | `team`, `player`, `kind`, `stolenBy?` | `team` loses the ball; never the gaining side. `kind`: `bad_pass`, `lost_ball` (both always carry `stolenBy`), `off_foul` (charge; immediately followed by the matching `foul` of kind `offensive`), `shot_clock`, `out_of_bounds`, `travel`, `off_goaltend` (putback interference; no shot event logged). The last four never carry `stolenBy`. | `sim/passing.ts` (`bad_pass`, `out_of_bounds`, `lost_ball`), `sim/game.ts` (`shot_clock`, `off_foul`, `travel`), `sim/possession.ts` (`off_goaltend`) |
| `foul` | `team`, `on`, `kind`, `drawnBy?`, `personalCount`, `teamCountInPeriod`, `inBonus`, `fouledOut` | A whistle on player `on`. `kind`: `shooting`, `reach`, `offensive`, `loose_ball`, `take`, `technical`. `personalCount` is the fouler's game total; `teamCountInPeriod` resets each period except into OT under packs with `teamFoulsCarryToOT`. `offensive` and `technical` kinds do not add team fouls. `inBonus` is the standing penalty state, including the NBA late-window rule. A `fouledOut: true` foul is followed by a replacement `substitution` unless the bench is exhausted. | `sim/fouls.ts` |
| `timeout` | `team`, `reason`, `remaining` | A team timeout (endgame layer, default ON; an explicit `endgame: false` run never emits one). Called at a dead ball by the team that will inbound. `reason`: `stop_run`, `advance` (frontcourt inbound; only under packs with `advanceAfterTimeout`), `mandatory`, `regroup`. `remaining` is the caller's budget after this one. Game clock never runs during it; `wt` keeps advancing. | `sim/endgame.ts` |
| `substitution` | `team`, `out[]`, `in[]` | A lineup change at a dead ball or an immediate fouled-out replacement. `out[i]` is replaced by `in[i]`; every current caller swaps exactly one player, and the array shape exists for a future multi-swap without a schema break. | `sim/subs.ts` |
| `jump_ball` | `between[2]`, `winner`, `gainedBy` | A mid-game held-ball jump; period openers stay `tip_off`. `between` order is emission-site-specific, not home-first. Offense wins the tap: the same possession continues. Defense wins: a new possession of kind `tip`. `gainedBy` is whoever came up with the tap. | `sim/passing.ts` (on-ball tie-up), `sim/possession.ts` (scramble tie-up) |
| `violation` | `team`, `player?`, `kind` | A non-foul, non-turnover officiating call. `def_goaltend` immediately follows the made `shot` it rides (same `t`/`wt`; that shot's `score` already includes the points). `kicked_ball` kills a pass (no `pass` event, no turnover); the offense retains with the shot clock floored at `rules.shotClockOffRebSec`. | `sim/passing.ts` (`kicked_ball`), `sim/shooting.ts` (`def_goaltend`) |
| `replay_review` | `trigger` | An officials' review: a wall-clock-only stoppage, game clock frozen. No outcome field by design (reviews never overturn in v1). `trigger`: `oob`, `late_make`, `period_end` (emitted before the `period_end` event). | `sim/possession.ts` |

### 2.3 Ordering guarantees

Each of these is documented in `core/events.ts` and holds for every stream
the engine produces:

- `game_start` is first and `game_end` is last; each fires exactly once.
- `wt` is monotonically non-decreasing; `wt >= t` on every event.
- `score` is the post-event score; the last event's `score` equals
  `GameResult.finalScore`.
- Each `possession_start` pairs 1:1, in order, with one `possession_end`.
- Documented adjacencies: an `off_foul` turnover is immediately followed by
  its `offensive` foul; a `def_goaltend` violation immediately follows its
  made shot at the same `t`/`wt`; a `replay_review` with trigger
  `period_end` precedes the `period_end` event; a `fouledOut: true` foul is
  followed by the replacement `substitution` unless the bench is exhausted.
- Box scores are fully reconstructible from events alone
  (`packages/engine/test/invariants.test.ts`).

### 2.4 Schema history

The authoritative history of the event schema is the `Replay.version` doc
comment in `replay/replay.ts`: 14 kinds at v1, 15 at v2 (`timeout` joined),
18 at v3 (`jump_ball`, `violation`, `replay_review` joined, plus the
enum/optional-field additions listed there).

## 3. The replay artifact

`buildReplay(result)` in `replay/replay.ts` produces the `Replay` object:
`version`, `seed`, `rules` (id, court geometry, periods, period minutes),
`teams` (trimmed metadata), `finalScore`, `lineups` (a `LineupSnapshot`
timeline), `frames`, and the full `events` array. It is self-contained: a
viewer renders a game from it with no engine access.

- Frame rows are 26 numbers:
  `[t, period, clock, ballX, ballY, holderSlot, h0x, h0y .. h4x, h4y, a0x, a0y .. a4x, a4y]`.
  Row field `[0]` is WALL-clock seconds at 1 decimal despite the short name.
  `holderSlot` is 0-4 home slots, 5-9 away slots, -1 ball loose or in
  flight. Interpolate positions linearly between frames on `[0]`; never
  interpolate `holderSlot` (snap to the nearer frame). Frames are
  downsampled on a fixed wall-clock cadence, not one row per tick. The full
  index-by-index specification is the header of `replay/replay.ts`.
- Lineups are a separate timeline, not frame columns: the lineup in effect
  for a side at wall-clock time T is the last `LineupSnapshot` for that side
  with `t <= T`.
- Ball coordinates in frames during dead phases are cosmetic placement
  (dead-ball freeze spots, free-throw lineups), not gameplay. Naming the
  sanctioned internal reader list for dead-phase ball position is open as
  issue #167.
- `Replay.version` (currently 3) bumps on ANY serialized-shape change,
  including changes to the embedded `GameEvent` shapes, with
  `packages/viewer` updated in the same change (AGENTS.md DO-NOT 8). The
  per-version change list, and one known v1 ambiguity affecting pre-c3d5bef
  saved replays, live on that field's doc comment.

## 4. The public exports

The covered API is exactly what `packages/engine/src/index.ts` exports.
Deep imports into `packages/engine/src` internals (`sim/*`, `GameState`,
helper modules) are not covered by this contract, whatever they export.

- `simulateGame(cfg: GameConfig): GameResult` (`sim/game.ts`). The one
  entry point. `GameConfig`: `seed` (string or number), `home`/`away`
  (`Team`), `rules?` (default NBA), `params?` (deep-partial overrides,
  merged by `withParams`), `collectFrames?` (default true),
  `safetyCapTicks?` (diagnostics only), `endgame?` (default true; `false`
  is the byte-identical legacy path and stays corpus-pinned), `validate?`
  (`'finite'` default, `'strict'` adds the data-pack ranges). Non-finite
  ratings, measurements, and tactics are always rejected loudly.
  `GameResult`: `seed`, `events`, `finalScore`, `frames`, `rules`,
  `params`, `teams`.
- Event types: `GameEvent`, `GameEventType`, every per-kind interface, and
  the shared enums (`TeamSide`, `ShotZone`, `ShotMoveType`, `TurnoverKind`,
  `FoulKind`, `PossessionOutcome`) from `core/events.ts`.
- Rules: `NBA`, `NCAA`, `EUROLEAGUE`, `bonusFreeThrowAward`, and the
  `RulePack` family of types (`rules/rulepack.ts`). Rule packs are data;
  custom leagues are JSON-shaped values, not code.
- Params: `defaultParams`, `withParams`, and the `SimParams` type
  (`sim/params.ts`). The shape is exported; the values are calibration
  output (§6).
- Player model: `makePlayer`, `makeTactics`, and the `Player`,
  `Attributes`, `Tendencies`, `Team`, `Tactics`, `Position` types
  (`model/player.ts`); derived-motion helpers `sprintSpeed`,
  `acceleration`, `lateralSpeed`, `reachFt` (`model/derived.ts`).
- Geometry: `makeCourt`, `classifyShot`, `Court`, `ShotLocation`
  (`geometry/court.ts`).
- Replay: `buildReplay` and the `Replay`, `ReplayTeamMeta`,
  `ReplayPlayerMeta`, `LineupSnapshot` types (`replay/replay.ts`).
- Utilities: `Rng`, `sigmoid`, `clamp` (`core/rng.ts`) and the `vec`
  namespace with `V2` (`core/vec.ts`). Exported because in-repo consumer
  packages already lean on them; semver applies.

## 5. The determinism guarantee

Within one engine version, `simulateGame` is a pure function of its config.
Same `seed` plus the same teams, rules, params, and flags produces a
bit-identical `events` array and bit-identical `frames`, on every run and
in every process. Everything derived from them (the replay artifact, box
scores, any fold) is therefore identical too. All randomness flows through
one seeded `Rng` (sfc32 over a cyrb128 seed hash, `core/rng.ts`); the
engine never reads `Math.random`, the clock, or any ambient state
(AGENTS.md §1.2).

What CI actually gates on every push and PR (`.github/workflows/ci.yml`,
verify job):

- The suite (`npm test`), which includes
  `packages/engine/test/determinism.test.ts`: same seed, two simulations,
  `JSON.stringify`-identical events and frames.
- `npm run fingerprint:determinism`
  (`packages/harness/src/fingerprint.ts`): the 28-entry corpus built twice
  in one process; per entry, the sha256 of the serialized event stream and
  the sha256 of the serialized frames must match run to run. The corpus is
  24 default-config NBA games (`ci-fp`, `acceptance-0`, 22 mirrored
  `golden-N` matchups) plus 4 non-default entries pinning the
  `endgame: false` legacy path (both orientations), NCAA, and EuroLeague.
- A two-process stdout diff: `npm run sim -- --seed ci-fp` run twice, byte-
  identical after normalizing the wall-clock timing line. The sim stdout
  includes the rendered box score and play-by-play tail, so this also pins
  the narration rendering of that seed.

The checked-in golden corpus (`npm run fingerprint`, 28 seeds byte-
identical against `packages/harness/golden/fingerprints.json`) is the
pure-refactor tier's local assertion, not a CI gate: since issue #33 a
golden mismatch cannot distinguish a regression from an allowed rng-order
change, so gameplay regressions are gated by the acceptance bands
(`npm run batch -- --games 48` at the ratchet floor) and the invariant
suite instead. The golden file may lag main; that is documented, expected
upkeep.

One honest caveat, from the `core/rng.ts` header: the integer PRNG path is
spec-exact everywhere, but `gaussian`/`sigmoid`/`Math.hypot` are
implementation-approximated. Node and Chrome share V8 and agree
bit-for-bit; the cross-engine half of the guarantee (JavaScriptCore,
SpiderMonkey) is V8-verified, not spec-backed. No divergence has been
observed.

Across versions there is no stream stability. See §6 and §7.

## 6. The explicitly unstable surfaces

None of these carry any cross-version promise. Do not build on them.

- **`SimParams` values.** The defaults are calibration output (`SWEPT`
  provenance carries deliberately odd precision). Any release may re-tune
  any value. Treat params as opaque data: override through `withParams`,
  never copy values out as constants, never assert on specific defaults.
- **The `SimParams` key set.** Knobs are added routinely with mechanics
  work. Overrides you carry can need updating across versions.
- **Fingerprints across versions.** Same seed, different engine version:
  a different game, routinely. Any mechanics change, params re-tune, or
  rng-call reordering legitimately moves every hash in the golden corpus
  (measured at 53788fe: 42 of 463 commits were recalibration or re-baseline
  upkeep). Fingerprint movement between versions is NORMAL and is not a
  compatibility break. If your project needs byte-stable replays, pin the
  engine version and store the replay artifacts.
- **Per-seed texture.** Event counts, final scores, band positions inside
  their gates, and every other per-seed number move whenever streams move.
- **Engine internals.** Everything under `packages/engine/src` not exported
  by `index.ts`, including `GameState` and the `sim/*` modules.
- **Harness and tool output.** CLI stdout formats (`npm run sim`, batch
  reports) and the golden corpus file format are repo tooling, not engine
  API. The rendered play-by-play text belongs to `@hoopsh/narration`, a
  consumer, not to the engine.

## 7. The change policy

Never, at any version (the prime directives, AGENTS.md §1):

- Determinism within a version does not break.
- The engine does not gain imports or dependencies.
- The event stream stays sufficient to rebuild box scores.
- Consumers do not influence game logic.

Allowed in any release, with no compatibility claim: mechanics changes,
params re-tunes, rng-order changes, and the resulting movement of every
fingerprint, per-seed stream, and band position. A CHANGELOG entry records
the change; the streams themselves are not a compatibility surface.

Additive changes (minor bump): new event kinds, new optional fields on
existing events, new enum members, new exports, new rule packs, new
`SimParams` knobs. Any change to the serialized replay shape, including
these additive event-schema changes, bumps `Replay.version` and updates
`packages/viewer` in the same change (AGENTS.md DO-NOT 8), whatever the
semver level.

Breaking changes (major bump): removing or renaming an exported symbol, an
event kind, or an event field; changing an existing field's type, units, or
semantics; changing the frame row layout; weakening any §2.3 ordering
guarantee; narrowing the determinism statement.

While the version is 0.x, read "major bump" as a bump of the minor
component (0.3 to 0.4): that is the compatibility boundary npm's `^` ranges
enforce for 0.x packages. Declaring 1.0 is an owner decision.

## 8. Consuming the engine

The minimal consumer is a fold over the event stream:

```ts
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const { home, away } = sampleMatchup();
const result = simulateGame({ seed: 'my-seed', home, away });

let threes = 0;
for (const e of result.events) {
  if (e.type === 'shot' && e.three && e.made) threes += 1;
}
console.log(`made threes: ${threes}`);
console.log(`final: ${result.finalScore[0]}-${result.finalScore[1]}`);
```

Runnable, commented versions: `examples/01` through `examples/06`
(`npm run example:01`). Install lanes, loader recipes, and packaging
caveats: `docs/EMBEDDING.md`.

Two rules bind every consumer:

1. **Nothing imports INTO the engine.** The engine has zero dependencies
   and never learns who consumes it (AGENTS.md §1.1; the arrow diagram in
   README.md is the review test). Consume the event stream and the exported
   API. If the data you need is not in the events, request a new event
   (PLAYBOOK Recipe D); do not reach into engine internals.
2. **Params are data.** `SimParams` is a flat serializable object;
   `withParams(overrides)` deep-merges onto the calibrated defaults. Pass
   overrides as data, keep them as data, and expect the defaults to move
   between versions (§6).
