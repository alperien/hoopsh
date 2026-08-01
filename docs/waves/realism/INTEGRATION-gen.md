# INTEGRATION-gen.md - draft realism wave, patches for shared files

Owner lane: people/gen.ts + people/archetypes.ts (this wave). The files
below are read-only for this lane. Each patch is anchored with a verbatim
OLD snippet. Apply in any order; none depend on each other. Everything in
gen.ts and archetypes.ts already compiles and runs WITHOUT these patches;
they are surfacing and bookkeeping, not fixes.

Status of the shared surface: `generatePlayer(rng, opts)`,
`generateDraftClass(league, season)` and `generateCoach(rng, idSeq)` keep
their signatures. `GenPlayerOpts` gained one OPTIONAL field (`pipeline`),
so every existing callsite (genesis.ts, tick.ts, career/creation.ts,
career/circuits.ts) compiles unchanged. Measurables need no new fields:
FrPlayer already carries heightIn, weightLb and wingspanIn, and genesis
rosters, free agents, two-ways and career circuit players all flow through
generatePlayer, so every player in every league already gets the new
archetype-correlated bodies. No player anywhere lacks measurables.

---

## Patch 1 (REQUIRED for typecheck hygiene): FrPlayer.archetype

gen.ts stamps the generated archetype id on every player through a local
structural cast (archetypes.ts `stampArchetype`), so the field already
exists at runtime and serializes with saves. Declaring it makes the field
visible to UI and AI code without the cast. Optional, so pre-wave saves
stay valid.

FILE: packages/franchise/src/types.ts

OLD:
```ts
  seasons: PlayerSeasonRow[];
  awards: AwardRef[];
  devLog: DevNote[];
  /** deterministic seed for the procedural portrait */
  faceSeed: number;
```

NEW:
```ts
  seasons: PlayerSeasonRow[];
  awards: AwardRef[];
  devLog: DevNote[];
  /**
   * Archetype id the player was generated from (people/archetypes.ts
   * catalog). Optional: pre-wave saves lack it; readers go through
   * archetypeOf/archetypeLabelOf which handle the absence.
   */
  archetype?: string;
  /** deterministic seed for the procedural portrait */
  faceSeed: number;
```

## Patch 2 (REQUIRED): rng.ts stream registry entry

generateDraftClass draws the per-season class strength wave on a dedicated
stream so pool-size changes and generator refactors can never reshuffle
which drafts run loaded, and so tools can read a season's wave without
generating the class. The code already calls this path; the registry
comment is the bookkeeping.

FILE: packages/franchise/src/rng.ts

OLD:
```
 *   class:<season>     draft class generation (people/gen.ts)
 *   dev:<season>:<playerId>       development review rolls (people/dev.ts)
```

NEW:
```
 *   class:<season>     draft class generation (people/gen.ts)
 *   classwave:<season> per-season class strength wave (people/gen.ts;
 *                      isolated so pool-size changes never move a wave)
 *   dev:<season>:<playerId>       development review rolls (people/dev.ts)
```

## Patch 3 (REQUIRED): barrel exports

The archetype vocabulary and the wave reader belong on the package surface
for the app (player cards, draft board) and the career package.

FILE: packages/franchise/src/index.ts

OLD:
```ts
export { generatePlayer, generateDraftClass, generateCoach } from './people/gen.js';
export type { GenPlayerOpts } from './people/gen.js';
```

NEW:
```ts
export { generatePlayer, generateDraftClass, generateCoach, classStrengthFor } from './people/gen.js';
export type { GenPlayerOpts } from './people/gen.js';
export {
  ARCHETYPES, archetypeById, archetypeOf, archetypeLabelOf,
} from './people/archetypes.js';
export type { Archetype, ArchetypeId } from './people/archetypes.js';
```

## Patch 4 (SUGGESTED): scouting memo prints the identity

The scout report's role line currently derives from perceived group
strengths only. The archetype label is a cleaner role phrase and stays
honest: the label names the identity, the perceived groups still carry the
error. Display change only; no numbers move.

FILE: packages/franchise/src/scouting.ts

OLD:
```ts
  const ranked = groupsByStrength(perceivedCur);
  const top = ranked[0]!;
  const second = ranked[1]!;
  let role = `${GROUP_ADJ[top]} ${POS_NOUN[player.pos]}`;
  if (perceivedCur[second] >= STRENGTH_BAR) role += ` with ${GROUP_TOOL[second]}`;
```

NEW:
```ts
  const ranked = groupsByStrength(perceivedCur);
  const top = ranked[0]!;
  const second = ranked[1]!;
  const archLabel = archetypeLabelOf(player);
  let role = archLabel !== '' ? archLabel : `${GROUP_ADJ[top]} ${POS_NOUN[player.pos]}`;
  if (perceivedCur[second] >= STRENGTH_BAR) role += ` with ${GROUP_TOOL[second]}`;
```

plus the import at the top of scouting.ts:

OLD:
```ts
import { streamRng } from './rng.js';
import { ATTR_GROUPS, groupMean } from './people/dev.js';
```

NEW:
```ts
import { streamRng } from './rng.js';
import { ATTR_GROUPS, groupMean } from './people/dev.js';
import { archetypeLabelOf } from './people/archetypes.js';
```

## Patch 5 (SUGGESTED, params owner): graduate the tier table

The talent-tier weights, quality bands and age tilts live as CAL module
constants in gen.ts (TALENT_TIERS, POLISH_BY_BUCKET, readiness constants).
If sweeps want to move them, graduate them into params.gen as a
`draftTiers` section. Not required: the current values pass the wave's
calibration guards and params.gen's existing knobs (draftPoolSize,
intlShare, prospectAgeMix, classStrengthSd, mutationSd, ceiling knobs) all
stay live. prospectAgeMix in particular still matters: the tier age
distributions are that param reshaped by a per-tier geometric tilt, so
sweeping it moves every tier together.

## Register entries proposed

- GEN-R1: draft classes draw talent tier first, age conditional on tier;
  calibration guard: over 20 seeded classes the top 10 by true overall are
  at least 1.2 years younger than picks 45-60 (pinned in
  packages/franchise/test/gen.test.ts).
- GEN-R2: 'classwave:<season>' stream added to the rng registry; the wave
  is readable without generating the class (classStrengthFor).
- GEN-R3: FrPlayer.archetype is optional; pre-wave saves lack it and every
  reader must go through archetypeOf/archetypeLabelOf.
- GEN-R4 (follow-up for the dev owner): archetype identity caps apply at
  GENERATION only. people/dev.ts distributeGrowth pulls a group's lowest
  dials toward the group ceiling hardest, so a rim-running big can still
  grow a mid-50s three over many seasons. If that reads wrong on cards,
  dev.ts could respect archetype caps via archetypeOf(p) +
  archetypeById(id).caps; deliberately NOT done in this wave because
  dev.ts is outside the lane and late-career skill growth is arguably a
  real phenomenon (Brook Lopez arcs exist).
- GEN-R5 (FYI, career owner): career/creation.ts RIVAL_RAW_DISCOUNT_EST
  (12.5) still lands the rival inside his 46-66 ability band under the new
  readiness-scaled discount (career suite green, 176/176); the comment
  math it cites (2.6 per year flat) is now approximate. No change needed.

## Notes for the names lane

gen.ts imports only generateName, generateNameOfKind, GeneratedName and
NameKind, exactly today's surface. When the names rewrite lands with the
optional nationality/heritage/suffix fields, gen.ts needs no change; if
gen.ts later wants nationality it will read it through a guarded local
helper per the parallel-lane contract.

## Age floor note

The wave brief allows international prospects at 18. The frozen genesis
suite pins every prospect age at 19 or older (draft-eligible minimum), so
international ages run 19-21 with a thin 22 tail here. If the eligibility
floor ever drops to 18, change the bucket-to-age mapping in
generateDraftClass (one line) and relax the genesis.test.ts bound.
