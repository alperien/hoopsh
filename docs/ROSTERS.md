# Writing rosters — the authoring guide

How to put a real (or invented) team into hoopsh: scaffold a pack, understand
the 38 dials, edit with live editor feedback, validate, and watch it play.

This guide teaches the *model* — what the numbers mean in basketball terms and
how they interact. The per-dial ground truth lives in
[`packages/engine/src/model/player.ts`](../packages/engine/src/model/player.ts)
(every key is commented with what it drives and where), and those same comments
are surfaced as hover text in your editor via the generated JSON Schema, so you
rarely need to leave the file you're editing. When this guide and a fresher
code comment disagree, the code comment wins — that's repo law
([`docs/README.md`](./README.md)).

## The loop

```bash
npm run roster:new                                # wizard — Enter accepts every default
npm run roster:new -- --list                      # browse the 11 archetypes first
# ...edit the ratings in your editor (autocomplete + inline errors via $schema)...
npm run roster:validate -- my-team.team.json      # errors with fixes + plausibility warnings
npm run sim -- --home my-team.team.json           # play it (vs the built-in matchup's away team)
npm run sim -- --home my-team.team.json --away packages/data/rosters/monarchs.team.json --seed x1
```

Scripted scaffolding (no prompts):

```bash
npm run roster:new -- --name "Oak City Owls" --abbrev OWL --size 12 \
  --slots floorGeneral,scoringWing,threeAndD,glueForward,rimRunner,comboGuard,benchScorer,benchBig \
  --pace 62 --three-bias 58 --out owls.team.json
```

Start from the scaffold even when transcribing a real NBA roster: pick the
archetype closest to each player and adjust dials away from a profile whose 38
numbers already agree with each other. Typing 38 raw numbers from scratch
produces incoherent players (an 85 `three` with a 5 `shotThree` never shoots);
editing a coherent one produces variations.

## Editor setup

Scaffolded packs begin with a `"$schema"` line pointing (relatively) at
[`data/schema/team-pack.schema.json`](../data/schema/team-pack.schema.json).
Any JSON-Schema-aware editor (VS Code out of the box) then gives you:

- autocomplete for every key, including all 24 attributes and 14 tendencies
- inline squiggles for out-of-range ratings, wrong types, missing keys, and
  unknown keys (typos get flagged *at the typo*)
- hover documentation per dial, extracted from `model/player.ts`

For a hand-started file, add the line yourself (path relative to *your* file):

```jsonc
{ "$schema": "../../data/schema/team-pack.schema.json", "formatVersion": 2, "kind": "team", ... }
```

The schema is **generated** — `npm run schema:gen` derives it from the same
constants `validateTeamPack()` enforces (`packages/data/src/schema.ts`), so it
cannot drift from the loader. A few rules JSON Schema cannot express are only
checked at load time: player-id uniqueness, ids not colliding with
Object.prototype keys ("constructor", "toString", … — ids key plain JSON
objects downstream), and starters/rotationMinutes referring to real roster
ids. Editor-green is necessary, `roster:validate`
is sufficient.

## Pack anatomy

```jsonc
{
  "$schema": "../../data/schema/team-pack.schema.json",
  "formatVersion": 2,          // exact match required; v2 added tend.usage
  "kind": "team",
  "team": {
    "id": "owls", "name": "Oak City Owls", "abbrev": "OWL",
    "tactics": { "pace": 62, "threeBias": 58, "helpAggr": 50 },  // required — see the dial table below
    "players": [ /* >= 8 players, each with all 38 ratings — see below */ ],
    "starters": [ "owls-p01", "owls-p02", "owls-p03", "owls-p04", "owls-p05" ],  // exactly 5 distinct ids
    "rotationMinutes": { "owls-p01": 36 }   // optional coach targets; omit to sub on fatigue alone; 0 = DNP scratch (never auto-inserted)
  }
}
```

Each player: `id`, `name`, `pos` (PG/SG/SF/PF/C — descriptive; matchups are
assigned by body and skill), `heightIn` (60–96 **inches**: 6'7" = 79),
`weightLb` (pounds), optional `wingspanIn` (engine assumes height + 2 when
absent), then `attr` (24 keys) and `tend` (14 keys). Validation is strict and
total: a pack either satisfies everything or is rejected with the complete
issue list — no silent defaults, ever (`schema.ts` header explains why).

## How the ratings work

**Everything is 0–100.** For *attributes*, 50 is a literal league-average
no-op: a 50 contributes exactly nothing to any probability model
(`model/player.ts` DEFAULT_ATTR comment). You only pay for what you push away
from 50, in either direction.

**Attributes are CAN, tendencies are WANT.** `three` is how well he shoots
threes; `shotThree` is how badly he wants to. Identity comes from the
combination under spatial context: elite `three` + heavy `shotThree`/`pullUp` +
high `offBallMotion` doesn't just score, it creates *gravity* that warps how
defenses guard him (gravity blends the skill and the appetite — a career 40%
shooter who never shoots doesn't scare anyone).

**Shot-diet tendencies are relative weights, not percentages.**
`shotRim`/`shotMid`/`shotThree` bias the AI's shot decisions against each
other. Calibrated rosters sum roughly 99–158 across the three; what matters is
the *ratio* (a 96/5/1 center virtually never leaves the restricted area).

**`usage` is a closed loop, mapped to real USG%.** 50 ≈ 20% (league average),
90 ≈ 30% (superstar), 10 ≈ 10% (screener). The engine continuously compares
the target to the realized share: an under-fed star hunts, an over-fed one
defers. Handy inversion when transcribing a real player:
`usage ≈ 4 × (USG% − 7.5)` — e.g. 25% USG → 70. The mapping is approximate and
compresses above ~30% USG; 90+ is "the offense runs through him", don't
chase decimals. Usage is deliberately orthogonal to skill — a deferential
genius and a low-skill chucker are both expressible, and `roster:validate`
will not second-guess that combination.

**Two dials are staged, honestly.** `consistency` (hot/cold variance) and
What the dials do (0-100, 50 = league-neutral):

| dial | effect |
|---|---|
| `threeBias` | shifts the shot diet toward (above 50) or away from (below 50) three-point attempts; it scales shot-selection utilities, it does not change make probability |
| `helpAggr` | how early and far help defenders rotate off their man; high values trade rim protection for open kick-out threes |
| `pace` | STAGED — defined and validated but read by no live system yet; setting it changes nothing today (the roster wizard's `--pace` flag stores it for when the tempo layer lands) |

`pushPace`/team `pace` are read by staged systems documented in
[`docs/INTERNALS.md`](./INTERNALS.md); set them plausibly anyway so packs
don't need editing when the stages land.

Rough anchors, taken from the archetype file (`packages/data/src/archetypes.ts`
— the calibrated reference points for what numbers *mean*): 99 = the
unambiguous best in any roster (eliteShooter's `three`), 90 = elite/defining
skill, 80 = legitimate weapon, 70 = plus starter, 60 = solid, 50 = average,
below 40 = real weakness opponents attack, teens = non-factor
(rimRunner's `three: 12` is "don't even close out").

Quick physical mappings: `heightIn` = feet×12+inches (6'0"=72, 6'6"=78,
7'0"=84); `freeThrow` ≈ FT% as points (0.84 shooter → 84).

## The archetype catalog

Eleven builders in [`packages/data/src/archetypes.ts`](../packages/data/src/archetypes.ts),
each a coherent, test-anchored profile (the archetype suite asserts an "elite
shooter" actually *behaves* like one at season scale). Numbers live there —
run `npm run roster:new -- --list` for a live view with each archetype's top
skills derived from the current source.

| archetype | body | the player it approximates | signature dials |
|---|---|---|---|
| `floorGeneral` | PG 6'4" | pass-first table-setter, paint-to-kick | passVision 98, passAcc 97, decisions 95 |
| `eliteShooter` | PG 6'2" | off-movement three-point assassin | three 99, offBallMotion 90, pullUp 82 |
| `scoringWing` | SG 6'6" | three-level bucket-getter | finishing 88, drawFoul 82, iso 78 |
| `threeAndD` | SF 6'7" | corner spacer, point-of-attack stopper | perimeterD 90, three 82, pullUp 12 |
| `comboGuard` | SG 6'4" | steady no-weakness rotation guard | everything 60s–70s, no hole |
| `glueForward` | PF 6'8" | does a little of everything | perimeterD 70 + interiorD 72, three 58 |
| `postAnchor` | PF 6'10" | back-to-basket bruiser, soft touch | strength 90, post 78, midRange 74 |
| `stretchBig` | C 7'0" | floor-spacing modern center | three 76, shotThree 78, interiorD 84 |
| `rimRunner` | C 7'0" | lob-catching, glass-eating rim protector | finishing 94, offReb 92, block 90 |
| `benchScorer` | SG 6'5" | microwave sixth man | pullUp 68, three 78, decisions 54 (the trade-off) |
| `benchBig` | C 6'11" | energy reserve big | boxout 82, block 78, three 8 |

Contrasts are deliberate and worth studying before you edit: eliteShooter vs
threeAndD is *self-created* vs *spot-up* threes (pullUp 82 vs 12); rimRunner vs
postAnchor is *above-the-rim* vs *back-to-basket* (midRange 28 vs 74);
rimRunner vs benchBig is the same shape a tier apart.

## Worked example — a real-ish player

A downhill, foul-drawing star lead guard — the SGA/Harden shape: lives in the
lane and at the line, good-not-elite three, high usage, real playmaking, solid
but not lockdown defense. Closest archetype: `scoringWing` (self-creation,
drawFoul), reshaped toward a guard.

Reasoning per group, then the JSON:

- **Body/physical**: 6'6" guard → `heightIn: 78`, `weightLb: 200`. First-step
  burst is the weapon: `speed 88`, `accel 92`, `lateral 74` (good, not elite,
  defensively).
- **Scoring**: `finishing 92` (craft at the rim), `midRange 90` (the pull-up
  middy is the counter), `three 74` (respectable, not the identity),
  `freeThrow 88` (≈ .88 shooter), `drawFoul 95` — the defining skill, lives at
  the line.
- **Playmaking**: `ballHandle 94` (the whole game starts from the handle),
  `passAcc 80`, `passVision 82` — a scorer who makes the right kickout, not a
  floorGeneral.
- **Defense/glass**: `perimeterD 72`, `steal 74` (active hands), `interiorD 40`,
  `block 45` (guard-sized), rebounding 30s–50s.
- **Mental**: `decisions 84`, `consistency 82` — stars deliver most nights.
- **Tendencies**: shot diet rim-first, mid-heavy, three-light for a star guard:
  `shotRim 70 / shotMid 55 / shotThree 35` (sum 160, just above the calibrated
  band — a high-volume creator). `pullUp 72`, `drive 85` (downhill constantly),
  `iso 65`, `passOut 55`, `post 8`. Off ball he rests: `offBallMotion 40`,
  `crashOffReb 10`. `gambleSteal 55`, `foulAggr 30`. Usage: ~32% USG →
  `4 × (32 − 7.5) = 98` → clamp the ambition to `92` (the loop compresses up
  there anyway).

```json
{
  "id": "owls-p01", "name": "Dex Calloway", "pos": "PG",
  "heightIn": 78, "weightLb": 200,
  "attr": {
    "speed": 88, "accel": 92, "strength": 64, "vertical": 74, "lateral": 74, "stamina": 86,
    "finishing": 92, "midRange": 90, "three": 74, "freeThrow": 88, "drawFoul": 95,
    "ballHandle": 94, "passAcc": 80, "passVision": 82,
    "perimeterD": 72, "interiorD": 40, "steal": 74, "block": 45, "contestSkill": 58,
    "offReb": 25, "defReb": 50, "boxout": 32,
    "decisions": 84, "consistency": 82
  },
  "tend": {
    "shotRim": 70, "shotMid": 55, "shotThree": 35, "pullUp": 72,
    "drive": 85, "passOut": 55, "iso": 65, "post": 8,
    "offBallMotion": 40, "crashOffReb": 10,
    "gambleSteal": 55, "foulAggr": 30, "pushPace": 58, "usage": 92
  }
}
```

Sanity-check the *interactions* before moving on: high `drive` + `drawFoul 95`
+ `finishing 92` is the trips-to-the-line engine; `shotThree 35` + `three 74`
still projects enough gravity that defenses can't fully duck under; `usage 92`
with `decisions 84` is a star who carries efficiently rather than a chucker.

## Validate, then watch it play

```bash
npm run roster:validate -- owls.team.json            # exit 0 = loads
npm run roster:validate -- owls.team.json --strict   # warnings fail too (CI-friendly)
npm run roster:validate -- owls.team.json --json     # machine-readable report
```

Errors show the JSONPath, your value, the legal range, and a concrete fix
(quoted numbers, centimeter heights, and typo'd starter ids are recognized and
answered specifically). Errors are exactly `validateTeamPack()`'s verdicts —
the CLI never adds or hides a rejection.

**Warnings are advisory basketball judgment** — the pack loads; the numbers
just don't resemble any known-good roster. Each states its reasoning so you
can overrule it knowingly (a tanking squad may proudly ship `no-plus-skill`):

| code | fires when | the basketball reason |
|---|---|---|
| `flat-profile` | a player's 24 attributes are all identical | identity comes from contrast; flat = anonymous |
| `no-plus-skill` | nobody on the roster has any attribute ≥ 70 | no one can win a matchup — scrimmage ball |
| `uniform-elite` | every rating on the roster ≥ 85 | flatness in reverse; nothing differentiates styles |
| `no-rim-protection` | no starter with interiorD or block ≥ 65 | 5-out with no deterrent = layup line |
| `no-initiator` | no starter with ballHandle ≥ 65 | nobody can start offense; turnovers spiral |
| `shot-diet` | rim+mid+three appetite < 60 or > 240 | refuses every shot / drowns pass-drive channels |
| `duplicate-names` | two players share a display name | box scores and PBP become unreadable |
| `usage-overload` / `usage-vacuum` | starting-five usage mean > 62 / < 38 | one ball; 5×50 ≈ 100% of possessions |
| `rotation-*` | unknown id / target > 48 min / targets > 245 total | silently ignored or unsatisfiable coach targets |

Then play one game and read it like a scout, not a fan:

```bash
npm run sim -- --home owls.team.json --seed owls-1   # deterministic: same seed, same game
```

Check that the box score matches the story you wrote: does your usage-92 guard
lead the team in FGA and FTA? Does the rimRunner's line look like dunks and
boards (high FG%, no threes)? Is the team's three-point volume consistent with
your `threeBias` and shooters? One game is one sample — re-run with a few seeds
before concluding a dial is wrong, and see `npm run batch` if you want
band-graded aggregates.

## Troubleshooting

| symptom | cause / fix |
|---|---|
| `$.formatVersion: expected 2` + many `tend.usage` errors | v1-era pack; add `"usage": 50` per player, set formatVersion 2 (the CLI prints this migration note) |
| `heightIn must be a finite number 60-96`, value ~180–220 | centimeters — divide by 2.54 (the CLI computes it for you) |
| `rating must be 0-100`, current `"88"` | quoted number; ratings are bare JSON numbers |
| `starter X not on roster` | id typo — the CLI suggests the closest roster id |
| editor shows no autocomplete | missing/wrong `"$schema"` relative path; regenerate with `npm run schema:gen` if the file moved |
| pack valid but plays nothing like intended | re-read *CAN vs WANT* above — skill without the matching tendency (or vice versa) is the usual culprit |

## How this stays honest

The schema, the scaffold menu, and the validator share one source of truth:
`packages/data/src/schema.ts` exports the key lists and ranges, `schema:gen`
derives the JSON Schema from them, hover docs are extracted from
`model/player.ts`, and the archetype menu is discovery-tested against
`@hoopsh/data`'s exports. Tests ratchet all of it: the committed schema must
match regeneration byte-for-byte, must accept the shipped rosters, must reject
canonical breakage, and the warning heuristics must stay silent on every
known-good roster. If you add a rating to the engine, the suite will walk you
through every surface that needs to hear about it — including this doc's
companion hover text, which regenerates for free.
