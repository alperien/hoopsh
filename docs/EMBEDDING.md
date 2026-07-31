# Embedding hoopsh — building on the engine from your own project

For the downstream builder: you want to consume `@hoopsh/engine` (and
friends) from your own code, not contribute to this repo. Everything below
was measured in a 2026-07-29 build trial (four downstream builds, all
succeeded) and a packaging audit (every install lane tried under Node
24.14 / npm 11.11, registry firewalled). The engine supports this use; the
packaging has exactly one working dependency lane, documented here.

What the four builds proved works, engine-side:

1. **A consumer app on the event stream alone** — `simulateGame` +
   `GameEvent`; score rides on every event; determinism holds (same seed →
   byte-identical output, verified by hash).
2. **A custom team pack** — the authoring loop in
   [ROSTERS.md](./ROSTERS.md) works end to end from outside the repo, and
   the validator caught every planted mistake with a taught fix.
3. **A custom rule pack** — 4×10-minute periods, 30 s clock, one-and-one
   bonus, FIBA arc: all honored via the API without touching engine source
   (caveats below).
4. **A custom `CommentaryProvider`** — plugged into the shipped broadcast
   pipeline first try, interleaved with template PBP.

## The packaging reality

The packages ship TypeScript source. No build, no dist, no `.d.ts`;
`main` points at `src/index.ts`, and internal imports use the `./x.js`
extension convention for `.ts` files on disk (AGENTS §1.7). Two
consequences:

- Under plain Node you always need a resolver hook — native type-stripping
  never rewrites specifiers, so `./state.js` finds nothing without one.
- **Any install that materializes real `.ts` files inside `node_modules`
  is dead on arrival**: Node refuses to type-strip anything whose realpath
  is under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`,
  measured). No hook can fix that — the ban applies at load time.

**npm git-dependencies are broken — do not try them.** Measured, three
independent failures: (1) npm "prepares" a git dep by running a nested
`npm install --include=dev` in a temp clone, which contacts the registry
(fails offline, downloads dev tooling pointlessly online); (2) even on
success you get one package named `hoopsh` — the workspaces are NOT
linked, so `import '@hoopsh/engine'` still fails; (3) the files land under
`node_modules`, hitting the type-stripping ban. pnpm's
`git+…#path:packages/engine` installs cleanly but cannot run under plain
Node for reason (3); that lane is alive only for bundler consumers
(vite/esbuild/tsx do their own transpilation and `.js`→`.ts` resolution) —
plausible, untested here (registry firewalled).

## The paths that work (all measured)

**A. Work inside a clone/fork.** The designed path. Zero install; first
game in ~1.3 s from a bare clone.

**B. No install at all — borrow the repo's loader.** From any directory:

```bash
node --import /path/to/hoopsh/tools/register.mjs app.ts
```

The hook resolves `@hoopsh/*` relative to its own file and rewrites
`./x.js` → `.ts` globally. Your app just imports `@hoopsh/engine`. npm is
pure ceremony in this lane.

**C. `file:` install + a 12-line hook — the one real dependency lane.**
Works because npm symlinks `file:` deps, so the realpath escapes
`node_modules` and stripping is allowed. Two requirements, both measured:

1. **Install the full closure explicitly.** `npm install
   file:/path/to/hoopsh/packages/data` alone "succeeds" but leaves
   `@hoopsh/engine@*` silently UNMET (runtime: `Cannot find package
   '@hoopsh/engine'`). Install engine and data together:

   ```bash
   npm install file:/path/to/hoopsh/packages/engine \
               file:/path/to/hoopsh/packages/data
   ```

2. **A resolver hook for the internal `./x.js` imports.** With the bare
   specifiers resolved by node_modules, only the relative-import branch is
   needed — 12 lines, vendorable:

   ```js
   // hoopsh-loader.mjs — register.mjs does: register(new URL('./hoopsh-loader.mjs', import.meta.url))
   import { existsSync } from 'node:fs';
   import path from 'node:path';
   import { fileURLToPath, pathToFileURL } from 'node:url';
   export async function resolve(spec, ctx, next) {
     if ((spec.startsWith('./') || spec.startsWith('../')) && spec.endsWith('.js')
         && ctx.parentURL?.startsWith('file:')) {
       const ts = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + '.ts');
       if (existsSync(ts)) return { url: pathToFileURL(ts).href, shortCircuit: true };
     }
     return next(spec, ctx);
   }
   ```

**D. Vendor the sources.** Copy `packages/engine/src` (etc.) into your
tree **outside `node_modules`** and use the hook or a bundler. The engine
has zero `node:` imports (browser-safe); data/stats/narration also have
zero, but additionally need `@hoopsh/engine` mapped. `@hoopsh/harness` is
NOT relocatable, period: it reads repo-root `data/` files and spawns
workers via the repo loader.

## Typechecking a consumer

Runtime is fine with stripped types; `tsc` is not, for two reasons:

- Cross-package imports don't type-resolve through the symlinks — the
  clone has no node_modules of its own, so when TS follows the symlink
  into `packages/data`, its `@hoopsh/engine` import resolves nowhere. Fix:
  a `paths` block in YOUR tsconfig pointing into the clone (mirror the
  repo's own):

  ```jsonc
  {
    "compilerOptions": {
      "moduleResolution": "bundler",
      "paths": {
        "@hoopsh/engine": ["/path/to/hoopsh/packages/engine/src/index.ts"],
        "@hoopsh/data":   ["/path/to/hoopsh/packages/data/src/index.ts"]
      }
    }
  }
  ```

- Consuming raw `.ts` means the LIBRARY sources are checked under YOUR
  compiler flags — mirror the repo's strictness (`strict`,
  `noUncheckedIndexedAccess`, …) or cross-package types will not resolve
  cleanly. Only shipped `.d.ts` would decouple this, and the repo is
  deliberately source-only (zero-install identity; no dist to drift).

## A complete consumer app

```ts
// app.ts — run with lane B or C above
import { simulateGame } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';

const { home, away } = sampleMatchup();
const result = simulateGame({ seed: 'my-first-embed', home, away });

for (const e of result.events) {
  // GameEvent is a discriminated union — `e.type === 'shot'` narrows it.
  if (e.type === 'shot' && e.made && e.three) {
    console.log(`3PM ${e.shooter} at t=${e.t}s — score ${e.score[0]}-${e.score[1]}`);
  }
}
console.log('FINAL', result.finalScore);
```

Same seed → bit-identical `events` and `frames`, every run, promised
within a repo version (AGENTS §1.2).

## GameConfig and GameResult

`simulateGame(config) → GameResult`. The interface JSDoc in
`packages/engine/src/sim/game.ts` is the reference; the shape:

| Field | Type | Notes |
|---|---|---|
| `seed` | `string \| number` | required; the determinism key |
| `home`, `away` | `Team` | required; any `Team` object, not just packs |
| `rules?` | `RulePack` | default NBA; see below |
| `params?` | partial `SimParams` | deep-merged over defaults; unknown keys throw |
| `collectFrames?` | `boolean` | replay position frames |
| `endgame?` | `boolean` | default ON; `false` = byte-identical legacy path |
| `validate?` | `'finite' \| 'strict'` | `'finite'` (default) rejects non-finite ratings; `'strict'` also enforces pack ranges (0–100). Use `'strict'` for untrusted rosters |
| `safetyCapTicks?` | `number` | diagnostics only |

`GameResult`: `{ seed, events, finalScore, frames, rules, params, teams }`.
A `Replay` is assembled separately from a result via `buildReplay`
(exported from the engine barrel).

## Loading team packs — the envelope

`loadTeamPack` takes the pack file's **contents** (a JSON string, not a
path) and returns an envelope, not a `Team`:

```ts
import { loadTeamPack } from '@hoopsh/data';
import { readFileSync } from 'node:fs';

const { team, issues } = loadTeamPack(readFileSync('rooks.team.json', 'utf8'));
if (!team) throw new Error(issues.map(i => `${i.path}: ${i.message}`).join('\n'));
```

`team` is `null` on ANY issue — there is no partial pack. Passing the
envelope itself to `simulateGame` fails at runtime as `team.players is not
iterable` (a documented build-trial wall; check `issues` first). Authoring,
validation, and the 38 dials: [ROSTERS.md](./ROSTERS.md).

## Custom rule packs

`RulePack` is data, not code — build an object and pass it as
`GameConfig.rules`. The field-level reference is the JSDoc in
`packages/engine/src/rules/rulepack.ts`; the shape:

| Field | Meaning |
|---|---|
| `id`, `name` | echoed into `GameResult.rules` |
| `courtLengthFt`, `courtWidthFt` | court footprint (NBA 94×50) |
| `rimInsetFt` | rim center distance from baseline |
| `keyWidthFt` | lane width — **UNWIRED** (declared, read nowhere) |
| `ftLineFt` | free-throw line distance from baseline |
| `three` | `{ arcRadiusFt, cornerDistFt, cornerBreakFt }` |
| `periods`, `periodMinutes` | regulation format (4×12 NBA, 2×20 NCAA) |
| `otMinutes` | overtime period length |
| `shotClockSec`, `shotClockOffRebSec` | shot clock + offensive-rebound reset |
| `teamFoulBonusAt` | team fouls that start the bonus |
| `bonusRule` | `'flat'` or `'oneAndOne'` (NCAA men, fouls 7–9) |
| `doubleBonusAt` | team fouls at which every trip is a flat award |
| `bonusFreeThrows` | free throws per flat bonus trip |
| `teamFoulsCarryToOT` | whether period counts carry into OT |
| `foulOutAt` | personals that disqualify |
| `timeoutsPerGame` | flat per-game budget (endgame layer only) |
| `advanceAfterTimeout` | whether a late-game timeout advances the inbound to the frontcourt (NBA/FIBA yes, NCAA no) |
| `teamFoulBonusAtOT` | bonus threshold in overtime (NBA drops to 4; carry-over leagues keep regulation) |
| `lateWindowSec`, `lateWindowFoulBonusAt` | the NBA last-2:00 team-foul penalty window (0 disables — NCAA, FIBA) |
| `makeStopClockFinalSec`, `makeStopClockEarlySec` | made-basket clock stops: final period/OT window and the NBA's last-minute window in earlier periods |

Three honest caveats, all measured:

- **Rules input is NOT boundary-validated.** A pack missing
  `shotClockSec` or `foulOutAt` is accepted and dies mid-game as
  `Rng.weighted: non-finite weight NaN in [NaN, NaN, NaN]` — the loud
  input contract ("simulateGame always rejects non-finite ratings")
  covers exactly one of the two swappable data inputs. Until a rules
  guard lands, include every field; the safe recipe is spreading a
  shipped pack: `{ ...NBA, id: 'my-league', shotClockSec: 30 }` (`NBA`,
  `NCAA`, `EUROLEAGUE` are exported).
- **No tooling parity with team packs**: no JSON schema, no
  `rules:validate`, no loader.
- **No single-game CLI path**: `npm run sim` has no `--rules`/`--league`
  flag (`--league` exists only in the batch harness, hardcoded nba|ncaa),
  and unknown flags are rejected loudly (`args.ts`).

## Custom commentary

The seam is `CommentaryProvider` (`packages/narration/src/provider.ts`):

```ts
interface CommentaryProvider {
  name: string;
  generate(window: CommentaryWindow): Promise<ColorLine[]>;
}
```

Implementations must be stateless across calls (the window carries
context, including the `storylines` continuity channel). Wire it through
`buildBroadcastScript(events, teams, provider, opts?)` →
`BroadcastCue[]`, where `opts` is
`{ seed?: string; windowEvents?: number; periods?: number }` — pass
`periods` for non-4-period rule sets or OT labels mis-render.
`TemplateColorProvider` is the shipped no-LLM fallback.

## The sanctioned source-reading list

The docs deliberately do not restate field-level API; the JSDoc is the
reference and the build trial rated it excellent everywhere it looked.
These files are the API surface a consumer may rely on:

| File | What it documents |
|---|---|
| `packages/engine/src/core/events.ts` | the event contract — every event type, emitter, invariants, consumer notes |
| `packages/engine/src/sim/game.ts` | `GameConfig`, `GameResult`, `simulateGame` |
| `packages/engine/src/rules/rulepack.ts` | `RulePack` + the three shipped packs |
| `packages/engine/src/model/player.ts` | `Team`/`Player`/`Attributes`/`Tendencies` (the 38 dials) |
| `packages/engine/src/replay/replay.ts` | `buildReplay`, the replay shape |
| `packages/data/src/schema.ts` | `loadTeamPack`, `validateTeamPack`, the pack contract |
| `packages/narration/src/provider.ts` + `broadcast.ts` | the commentary seam + pipeline |
| `packages/harness/src/season.ts`, `matchup.ts` | multi-game driving ([SEASON.md](./SEASON.md)) — but the harness package is repo-welded; consume its ideas, not the package |

Everything else in `packages/*/src` is internals; the package barrels
(`src/index.ts`) define what is public.
