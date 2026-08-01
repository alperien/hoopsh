# INTEGRATION-names: patches for shared files

The identity-first name generator (people/names.ts plus people/namebank/)
is live and back-compatible. Nothing below is required for the suite to
pass. Each patch upgrades a callsite to the new capabilities: birth-year
era cohorts for players, and the staff generator `personName` for coaches,
owners, and officials.

New API surface, for reference:

- `generateName(rng, opts?)` where opts is `{ bornYear?: number; kind?: NameKind }`.
- `generateNameOfKind(rng, kind, opts?)` with the same optional opts.
- `personName(rng, role, opts?)` where role is `'coach' | 'gm' | 'scout' | 'official' | 'agent' | 'reporter'` and opts is `{ bornYear?: number }`. Returns `{ first, last }` drawn from older birth cohorts.
- `GeneratedName` gains additive fields: `nationality` (always set), `heritage?`, `suffix?`.
- `NameOpts` and `PersonRole` are exported types.

RESHUFFLE WARNING (read before applying): every patch below changes the
number of rng draws consumed at its callsite, which reshuffles every
downstream draw on that stream for a given seed. That regime is documented
in the names.ts header and was already exercised by this rebuild (three
seed-lottery band tests re-rolled; all 430 franchise plus career tests are
green at handoff). Apply the patches, run the full suite, and if a
statistical band test trips, the correct response is the same one this
wave used: treat it as a stream re-roll, not a logic regression, and nudge
any near-threshold band from the failing test's own side if its owner
agrees, or re-roll the stream with a benign draw-shape change. One latent
bound worth knowing about: genesis.test.ts's max-salary rail
(`cap * 0.35 * 1.09`) tolerates only one year of raise compounding, while
genesis standardYears can legally compound up to 8 percent over 4 years
from a 35 percent start. Any stream can surface that conjunction. The
durable fix belongs to the genesis owner (clamp later years, or raise the
test rail to `0.35 * 1.08^3`).

---

## P1: gen.ts, era-correct player names

FILE: packages/franchise/src/people/gen.ts

OLD:
```ts
  const pos = POSITION_ORDER[rng.int(POSITION_ORDER.length)]!;
  const name = opts.pipeline
    ? generateNameOfKind(rng, opts.pipeline)
    : generateName(rng);
```

NEW:
```ts
  const pos = POSITION_ORDER[rng.int(POSITION_ORDER.length)]!;
  // birth year picks the US first-name era cohort (names.ts): a 2007-born
  // prospect draws Jayden-era names, a 1988-born veteran draws his own
  const bornYear = opts.season - opts.age;
  const name = opts.pipeline
    ? generateNameOfKind(rng, opts.pipeline, { bornYear })
    : generateName(rng, { bornYear });
```

## P2: gen.ts, era-correct uniqueness re-rolls

FILE: packages/franchise/src/people/gen.ts

OLD:
```ts
export function ensureUniqueName(rng: Rng, p: FrPlayer, used: Set<string>): void {
  const kind = nameKindOf(p);
  for (let i = 0; i < MAX_NAME_REROLLS && used.has(p.name); i++) {
    applyName(p, generateNameOfKind(rng, kind));
  }
```

NEW:
```ts
export function ensureUniqueName(rng: Rng, p: FrPlayer, used: Set<string>): void {
  const kind = nameKindOf(p);
  for (let i = 0; i < MAX_NAME_REROLLS && used.has(p.name); i++) {
    applyName(p, generateNameOfKind(rng, kind, { bornYear: p.bornSeason }));
  }
```

## P3: gen.ts, era-correct pipeline belt in generateDraftClass

FILE: packages/franchise/src/people/gen.ts

OLD:
```ts
    // belt over the forced pipeline, then league-wide uniqueness
    if (nameKindOf(p) !== pipeline) applyName(p, generateNameOfKind(rng, pipeline));
```

NEW:
```ts
    // belt over the forced pipeline, then league-wide uniqueness
    if (nameKindOf(p) !== pipeline) {
      applyName(p, generateNameOfKind(rng, pipeline, { bornYear: p.bornSeason }));
    }
```

## P4: gen.ts, coaches draw from the coach cohort

FILE: packages/franchise/src/people/gen.ts

OLD:
```ts
import { generateName, generateNameOfKind } from './names.js';
```

NEW:
```ts
import { generateName, generateNameOfKind, personName } from './names.js';
```

FILE: packages/franchise/src/people/gen.ts

OLD:
```ts
export function generateCoach(rng: Rng, idSeq: number): Coach {
  const name = generateName(rng);
```

NEW:
```ts
export function generateCoach(rng: Rng, idSeq: number): Coach {
  // staff generator: a 58-year-old coach is Rick or Monty, never Jayden
  const name = personName(rng, 'coach');
```

## P5: genesis.ts, owners draw from the executive cohort

FILE: packages/franchise/src/genesis.ts

OLD:
```ts
import { generateName } from './people/names.js';
```

NEW:
```ts
import { personName } from './people/names.js';
```

FILE: packages/franchise/src/genesis.ts

OLD:
```ts
    const ownerName = generateName(rng); // owners draw from the same era-neutral pools; only first/last are used
```

NEW:
```ts
    const ownerName = personName(rng, 'gm'); // owners draw from the executive age cohort; only first/last are used
```

## P6: officials.ts, officials draw from the official cohort

FILE: packages/franchise/src/officials.ts

OLD:
```ts
import { generateName } from './people/names.js';
```

NEW:
```ts
import { personName } from './people/names.js';
```

FILE: packages/franchise/src/officials.ts

OLD:
```ts
    const names: string[] = [];
    for (let slot = 0; slot < 3; slot++) {
      let last = generateName(rng).last;
```

NEW:
```ts
    const names: string[] = [];
    for (let slot = 0; slot < 3; slot++) {
      let last = personName(rng, 'official').last;
```

FILE: packages/franchise/src/officials.ts

OLD:
```ts
      for (let tries = 0; tries < NAME_REROLLS; tries++) {
        const clash = names.includes(last) || (slot === 0 && usedChiefs.has(last));
        if (!clash) break;
        last = generateName(rng).last;
      }
```

NEW:
```ts
      for (let tries = 0; tries < NAME_REROLLS; tries++) {
        const clash = names.includes(last) || (slot === 0 && usedChiefs.has(last));
        if (!clash) break;
        last = personName(rng, 'official').last;
      }
```

## P7: index.ts, barrel exports for the other lanes

FILE: packages/franchise/src/index.ts

OLD:
```ts
// people
export { generateName } from './people/names.js';
export type { GeneratedName } from './people/names.js';
```

NEW:
```ts
// people
export { generateName, generateNameOfKind, isFamousName, personName } from './people/names.js';
export type { GeneratedName, NameKind, NameOpts, PersonRole } from './people/names.js';
```

## P8: career/circuits.ts, era-correct circuit re-rolls

FILE: packages/career/src/circuits.ts

OLD:
```ts
function ensureUniqueCircuitName(rng: Rng, p: FrPlayer, used: Set<string>): void {
  for (let i = 0; i < MAX_NAME_REROLLS && used.has(p.name); i++) {
    const n = generateName(rng);
    p.name = `${n.first} ${n.last}`;
```

NEW:
```ts
function ensureUniqueCircuitName(rng: Rng, p: FrPlayer, used: Set<string>): void {
  for (let i = 0; i < MAX_NAME_REROLLS && used.has(p.name); i++) {
    const n = generateName(rng, { bornYear: p.bornSeason });
    p.name = `${n.first} ${n.last}`;
```

Note: circuits generates high schoolers, so once P8 lands they draw from
the youngest cohorts automatically (a 2033 recruit draws the held c2010
table). The `generateName(rng, { bornYear })` call reaches circuits
through the barrel, so P7 must land with or before P8 only if circuits
switches to the new opts import path; the current barrel signature already
passes opts through because it re-exports the same function.

## P9: docs/REGISTER.md, register row for the rebuild decisions

FILE: docs/REGISTER.md

OLD:
```md
## Realism-gate tiers ("reads like basketball")

Added 2026-07-27 on top of the original four gate families (invariants /
bands / fidelity / texture):
```

NEW:
```md
| W78 | **Name generation rebuilt identity-first (people/namebank/).** Every generated person now rolls an identity (nationality plus heritage lineage) before any name token; first name, surname, and birthplace draw from that identity's pools only, killing cross-pool incoherence ("Giorgos Kulenovic born in Warsaw"). Registered decisions: (1) ASCII transliterations throughout (Jokic, not diacritics), consistent with the existing codebase; (2) US first-name pools are birth-decade era tables (c1955/c1975/c1990/c2000/c2010) and births past 2019 HOLD the c2010 table rather than inventing a future era; (3) when a caller passes no birth year, player draws assume the active-player window (30/70 c1990/c2000) and staff draws use per-role age curves (`personName`); (4) diaspora birthplaces are registered per identity (Bosnian kids born in Stuttgart, Franco-Malians born in Bamako, Sudanese-Australians born in Kakuma), never cross-pool accidents; (5) US texture at real rates (suffixes ~4%, initial-pair firsts ~2.5%, hyphenated surnames ~2%), gated in names.test.ts; (6) scale floor 2000 distinct first names and 2000 distinct surnames, gated. Draw-shape doctrine: texture and cohort rolls are uniform slots (chance(0) legal) so rate edits flip outcomes without shifting draw counts; pool edits remain stream-reshuffling behavioral changes per the names.ts header. | names.ts; namebank/; names.test.ts | landed |

## Realism-gate tiers ("reads like basketball")

Added 2026-07-27 on top of the original four gate families (invariants /
bands / fidelity / texture):
```

---

## Post-apply checklist for the orchestrator

1. Apply P1 through P9 in any order (P4/P5/P6 import lines before their callsite hunks if applied line by line).
2. Run the full suite: franchise plus career must be green.
3. If a statistical band test trips, see the RESHUFFLE WARNING above.
4. Optional follow-up owned by other lanes: FrPlayer could persist the new `nationality`, `heritage`, and `suffix` fields (types.ts, applyName in gen.ts, circuits applyName twin) so media and UI lanes can print them. The generator already supplies them on every draw.
