# The broadcast booth — narration engine design

Status: shipped in `packages/narration` (the `booth` pipeline). This document is
the design reference for it: what it consumes, how it is structured, what it can
and cannot say, and where it goes next. The v1 template layer (`pbp.ts`,
`context.ts`, `provider.ts`, `broadcast.ts`) previously carried a FROZEN
PROTOTYPE label; that freeze was lifted by a project-level decision (2026-07)
when the booth was commissioned. The v1 surface remains exported and untouched
in behavior — it is the minimal reference consumer; the booth is the product.

Governing rules inherited from the repo (none are new):

- **Consumer tier** (AGENTS.md §4.3, PLAYBOOK Recipe G): the booth consumes
  `GameEvent[]` and public engine exports only. It never reads engine
  internals, never influences game logic, and any change to it must leave the
  engine fingerprint byte-identical.
- **Determinism** (AGENTS.md §1.2 discipline, applied to narration): one seeded
  `Rng` per script, fixed draw order. Same events + same seed + same booth ⇒
  bit-identical script. The RNG-consumption rule from `pbp.ts`'s `Pool` applies
  everywhere: repeat-avoidance re-rolls by index arithmetic, never by drawing
  again, so avoidance can never shift later picks.
- **No I/O, no dependencies**: the package depends on `@hoopsh/engine` only.
  File writing stays in `harness` callers.
- **Erasable TypeScript** (AGENTS.md §1.7): no enums, `.js` import extensions,
  `import type` for type-only imports.

## 1. Why a second narration layer

The v1 layer renders each event in isolation with small variety pools. Reading
a full v1 script surfaces four structural limits, none fixable by adding pool
variants:

1. **No memory.** Every line is stateless: nothing references a player's
   running total, a shooting streak, a scoring drought, or how the last
   possession ended.
2. **No stakes.** A Q1 blowout three and a go-ahead three with 40 seconds left
   render from the same pool at the same energy.
3. **No geography.** Events carry shot coordinates; v1 says "16-footer" but
   never "from the left elbow".
4. **One voice.** Real broadcasts are a conversation between a play-by-play
   voice and an analyst with different jobs, different registers, and
   different vocabulary.

The booth addresses all four with a staged pipeline, each stage a pure fold
over the previous one.

## 2. Pipeline

```
GameEvent[]
  │
  ├─ sense.ts     GameSense — the running truth a booth keeps in its head:
  │               box lines, streaks, droughts, runs, lineups, fouls/bonus,
  │               possession context (passes, offensive boards, elapsed clock)
  │
  ├─ beats.ts     Beat compiler — one narratable Beat per event that deserves
  │               voice, annotated with semantic tags (transition, kickout,
  │               and_one, go_ahead, dagger, …), court geography (geometry.ts),
  │               a leverage/heat score (0..1) and a register (flat/elevated/peak)
  │
  ├─ booth.ts     Booth director — turn-taking. PBP owns live action; the
  │               analyst owns dead balls, reactions to peak moments, quarter
  │               and halftime recaps, the pregame open, clutch entry. Emits
  │               BoothCue[] timed on the wall clock (wt).
  │
  └─ voice.ts     Voice rendering — persona packs (personas.ts) turn a Beat
     personas.ts  into text: template pools keyed by (beat kind, variant,
                  register), slot filling, signature calls under per-game
                  budgets, game-long anti-repetition, naming policy.
```

Every stage is exported; a future consumer (an LLM color provider, a TTS
renderer, a highlight cutter) can consume `GameSense`/`Beat[]` directly and
skip the shipped voices.

## 3. What the event stream provides — and what it lacks

The booth uses these event facts (`core/events.ts` is the contract):

| Fact | Source | Broadcast use |
|---|---|---|
| shot x/y, distance, zone | `ShotEvent.x/y/distFt/zone` | floor geography ("left corner", "right elbow") |
| contest level + contester | `ShotEvent.contest/contestedBy` | "wide open" / "right in his face" |
| shot creation | `ShotEvent.moveType` | pull-up vs catch-and-shoot vs drive vs putback vs heave |
| assist, and-one, block | `ShotEvent.assist/foul.andOne/blockedBy` | play chains, "AND the foul", rejection calls |
| pass kinds | `PassEvent.kind` (kickout/outlet/entry/handoff) | "kicks it out…", possession texture |
| possession opener | `PossessionStartEvent.kind` (steal/live_rebound/tip/inbound) | transition detection ("out on the break") |
| foul bookkeeping | `FoulEvent.personalCount/teamCountInPeriod/inBonus/fouledOut` | foul trouble, bonus, disqualification |
| free-throw position | `FreeThrowEvent.n/of` | line ritual pacing |
| two time axes | `Base.t` (game clock) / `Base.wt` (wall clock) | stats phrasing keys on `t`; cue timing keys on `wt` |

Known gaps, worked around honestly rather than fabricated:

- **Team actions are invisible.** The sim runs pick-and-roll / post / iso / DHO
  lifecycles internally but emits no event for them. The booth never claims
  "off the pick-and-roll". `PassEvent.kind 'entry'/'handoff'` and drive
  move-types allow adjacent-but-true phrasing. Surfacing actions is a Recipe D
  change (mechanics tier — new events change the stream fingerprint); listed
  as future work, not attempted here.
- **Fatigue is invisible.** No "he looks gassed" lines — the booth cannot know.
- **No timeouts exist in the sim** (a documented simplification). The analyst
  may say a team *needs* one; nobody ever calls one.
- **Full 10-player positions live only in replay frames.** The booth runs on
  events alone by design; spatial talk is limited to shot/rebound coordinates.
- **Shot-clock state is not on events.** Elapsed possession time (`t` minus the
  possession start's `t`) stands in for "deep in the clock" phrasing.

## 4. GameSense — the running truth

`GameSense` folds events into exactly the quantities a real booth tracks on a
notepad. Everything is derivable from the stream (the same guarantee
`stats/box.ts` relies on); nothing reaches into the engine.

Per player: points / rebounds / assists / steals / blocks / turnovers / fouls,
shooting splits (FG, 3P, FT), points this period, consecutive made and missed
field goals, first-mention flag (drives the naming policy).

Per team: score, current unanswered run, scoring drought (game-clock seconds
since last point), team fouls this period + bonus state, biggest lead,
fast-break points (possession opened by steal/live rebound and converted
within 8 game-seconds — FEEL threshold, field goals only), second-chance
points (any points after an offensive rebound in the same possession),
points in the paint (made rim+paint twos).

Per possession: offense side, opener kind, start `t`/`wt`, completed passes,
last pass (passer/kind), offensive rebounds so far.

Game-level: lead changes, ties, largest lead either way, clutch entry (the
same 3:00 / margin ≤ 6 definition as v1's `context.ts`).

`GameSense.update(e)` returns a `SenseDelta` of transitions this event caused
(lead change, tie, go-ahead, run thresholds, milestones, drought broken, foul
trouble, double-double) — the beat compiler turns deltas into tags and note
beats instead of re-deriving them.

## 5. Geography — naming the floor

`geometry.ts` converts shot coordinates into the names a broadcast says.
Court dimensions and three-point geometry come from the engine's exported
`RulePack` (NBA by default) — no court constants are duplicated.

- The attacked rim is inferred by matching the event's `distFt` against the
  distance to each rim (never "nearest rim", which misclassifies heaves).
- **Left/right convention**: from the offense's perspective facing the basket
  (attacking the high-x rim, left = higher y; attacking the low-x rim,
  left = lower y). Real broadcasts are inconsistent about camera-side vs
  offense-side naming; the booth picks the offense side and applies it
  everywhere. Consistency matters more than the choice.
- Zone taxonomy: corners and wings and top of the arc for threes (corner
  detection reuses the rule pack's `cornerBreakFt`, the same boundary
  `classifyShot` uses); baseline / elbows / free-throw-line area / wings for
  mid-range; the lane and point-blank range inside. Depth grades on top:
  27+ ft is "deep", 32+ ft is logo range, 40+ ft is a backcourt heave.

## 6. Beats, heat, registers

A `Beat` is one narratable unit: the source event, a kind
(`shot_made`, `shot_missed`, `shot_blocked`, `free_throw`, `rebound`,
`turnover`, `foul`, `substitution`, period markers, plus compiler-generated
`note` beats for run/milestone/drought/clutch/foul-trouble observations),
semantic tags, geography, the play chain (last pass + passes this possession),
and a frozen `SenseSnapshot` of every number a template might cite.

**Heat** (0..1) decides how much a moment matters — the model is deliberately
simple and every constant is FEEL-tagged in `beats.ts`:

- *Spectacle*: what happened, in isolation (a block, an and-one, a deep three,
  a putback, a made heave).
- *Leverage*: closeness × game progress, with a clutch floor once the game is
  inside 5:00 / margin ≤ 8 territory.
- *Swing boosts*: go-ahead, tie, run-extending, milestone, dagger.
- Garbage-time clamp: 20+ margins in the fourth cap heat regardless of
  spectacle, which is exactly how real booths deflate.

Heat maps to a **register** — `flat` (< 0.40), `elevated` (0.40–0.72), `peak`
(≥ 0.72) — and the register selects template pools, sentence energy, whether
signature calls are eligible, and whether the analyst reacts.

## 7. Voice packs — narrators as data

A `VoicePack` is data, mirroring the repo's rule-pack/data-pack philosophy:

```ts
interface VoicePack {
  id: string; displayName: string; role: 'pbp' | 'color';
  style: { statAffinity: number };       // how often tonight's numbers get cited
  pools: Record<string, string[]>;       // "<kind>.<variant>.<register>" → lines
  signatures: Signature[];               // budgeted catchphrases
  segments?: Record<string, string[]>;   // color: pregame/recap/clutch/… talk
}
```

Pool keys resolve most-specific-first (`shot_made.three.peak` →
`shot_made.three` → `shot_made`), so a pack only writes the specificity it
needs. Templates use `{slot}` tokens filled from the beat + sense snapshot
(`{player}`, `{Player}` full name, `{passer}`, `{blocker}`, `{spot}`, `{dist}`,
`{ptsTonight}`, `{run}`, `{margin_phrase}`, `{score_phrase}`, `{clock_phrase}`,
…). A signature (`"COUNT IT!"`-class call) carries trigger conditions
(kinds/tags/minimum heat) and a per-game budget; the booth enforces the budget
so a catchphrase stays an event, not a tic.

Shipped personas are **original homage archetypes** — styles, not imitations
of named people, and no real broadcaster's trademark call is reproduced:

- **Miles Corbin** (pbp) — precision anchor: economical during routine play,
  a controlled detonation at peak moments. Signature: "COUNT IT!"
- **Gus Tremaine** (color) — the teacher: fundamentals, numbered points,
  scouting-report framing, tonight's numbers. High stat affinity.
- **Dana Boone** (pbp) — the firecracker: kinetic imagery, personal-record
  volume at peak, still accurate underneath the noise.

Booth presets: `classic` (Corbin + Tremaine) and `latenight` (Boone +
Tremaine). A custom `BoothConfig` with user-authored packs is accepted by the
same entry point.

## 8. The booth — turn-taking

`buildBoothScript(events, teams, opts)` renders beats through the booth's
discipline:

- **PBP owns live action.** Every shot, rebound, turnover, foul and free throw
  gets a play call. Completed passes are folded into the shot call as chain
  phrasing ("kicks it out — …") rather than narrated individually; the pass
  spam a literal event-per-line renderer produces is the main reason v1 output
  reads like a log, not a call.
- **The analyst speaks at structural gaps**: pregame open (team identities
  derived from tactics + roster tendencies), between free throws in a
  multi-shot trip, after peak moments (when the wall clock shows an actual
  gap before the next live beat), on note beats (runs, milestones, droughts,
  foul trouble), at period ends (a recap citing the quarter's defining
  number), clutch entry, and the final horn.
- **Cooldown**: color lines respect a minimum wall-clock spacing outside
  structural slots, so the analyst never talks over three consecutive
  possessions.
- **Score/clock mentions** follow a policy instead of spamming every line:
  on lead changes and ties, on peak makes, every ~2.5 game-minutes of silence,
  and tighter inside the last two minutes of the fourth.
- **Cue timing is on `wt`** (the replay axis), so a script lines up with
  replay frames and free-throw routines occupy real time — the property TTS
  and the viewer both need. `t` is carried for stats phrasing only
  (AGENTS.md §1.5's two-axes rule, applied to narration).

Output: `BoothCue[]` — `{ wt, t, period, clock, score, speaker, voice,
register, kind, sig?, text }` — plus `formatBoothScript()` for a printable
two-voice script.

## 9. Determinism contract

- One `Rng` seeded from `opts.seed` (namespaced `booth:<seed>`), shared across
  every pool pick in a script; draw count is independent of which lines win
  (re-roll by index bump, never re-draw — the same reasoning documented on
  v1's `Pool.pick`).
- Anti-repetition state (per-pool recent ring + game-long recent-sentence
  window) is deterministic and part of the fold.
- No wall-clock reads, no `Math.random`, no iteration over untrusted key
  order (all maps are insertion-ordered).

`test/booth.test.ts` asserts: bit-identical scripts per seed; full coverage
(every made field goal has a play call; no `undefined`, no unfilled `{slot}`);
non-decreasing `wt`; signature budgets respected; presets actually differ;
pregame/recap/final segments present; v1 suite untouched and green.

## 10. Entry points

- `npm run broadcast [-- --seed S --booth classic|latenight]` — sim + booth
  script to `out/broadcast-<seed>.txt` (add `--legacy` for the v1 pipeline).
- Library: `buildBoothScript` / `formatBoothScript` / `compileBeats` /
  `GameSense` / `BOOTH_PRESETS` from `@hoopsh/narration`.

## 11. Future work (explicitly out of scope here)

1. **LLM color** via the existing `CommentaryProvider` seam — `CommentaryWindow`
   can be upgraded to carry `Beat[]`/`SenseSnapshot` instead of raw events;
   the deterministic booth remains the zero-cost fallback and the regression
   baseline.
2. **Recipe D events** for team actions (screen/PnR/post observability) and a
   fatigue snapshot on substitutions — each is a mechanics-tier change with
   the full verification ladder; the booth is written to absorb new tags
   without restructuring.
3. **TTS rendering** of `BoothCue[]` (the roadmap's "broadcast audio") — cue
   timing on `wt` was chosen for exactly this.
4. **Era/league voice variation** — pool keys and rule-pack-driven geography
   already parameterize by rules; a `halves` vocabulary for NCAA is a data
   change.
