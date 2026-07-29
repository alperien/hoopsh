# hoopsh examples

Six single-file, seeded, deterministic programs — each teaches exactly one way
to build on hoopsh. Every file starts with a header saying what it teaches,
how to run it, and what you should see. Each finishes in seconds and needs
**zero installs**: they run through the repo's own loader
(`tools/register.mjs`), the same way every npm script here does.

These examples cannot rot: the test suite runs every one of them and asserts
on their output (`packages/harness/test/examples.test.ts`), so `npm test`
fails if an example breaks.

## Run one

```
npm run example:01        # or :02 ... :06
```

(equivalently: `node --disable-warning=ExperimentalWarning --import ./tools/register.mjs examples/01-simulate-a-game.ts`)

## Reading order

| # | File | What it teaches |
|---|------|-----------------|
| 01 | [`01-simulate-a-game.ts`](01-simulate-a-game.ts) | The hello world: `simulateGame({ seed, home, away })` → final score, line score, raw events, and determinism (same seed = same game). |
| 02 | [`02-custom-consumer.ts`](02-custom-consumer.ts) | **Events are the contract.** Compute things no box score has (every lead change, biggest runs, largest leads) from nothing but `result.events`. |
| 03 | [`03-your-own-team.ts`](03-your-own-team.ts) | Teams are data: author an 8-player pack, watch `loadTeamPack()` catch four hand-editing mistakes with JSONPaths, then play it. Learn the `{ team, issues }` envelope. |
| 04 | [`04-custom-rules.ts`](04-custom-rules.ts) | Leagues are data: a `RulePack` with 10-minute quarters, a 30s clock, a one-and-one bonus, and a shorter arc — engine source untouched. |
| 05 | [`05-commentary-provider.ts`](05-commentary-provider.ts) | The narration seam: implement `CommentaryProvider` (the LLM slot) and get your lines interleaved with the play-by-play. |
| 06 | [`06-season.ts`](06-season.ts) | The season layer: schedule → six real games → standings, all deterministic, no cross-game state. |

Start at 01 and go in order — 02 is the most important idea in the repo, and
03-05 each swap in one custom piece (team, rules, voice). 06 shows the layer
above single games.

## Where to next

- **Embedding hoopsh in your own project** (imports, the loader recipe,
  typechecking against the packages): [`docs/EMBEDDING.md`](../docs/EMBEDDING.md)
- **Hand-authoring team files + the validator CLI**: [`docs/ROSTERS.md`](../docs/ROSTERS.md)
- **Seasons in depth**: [`docs/SEASON.md`](../docs/SEASON.md)
- **The event stream's full field-by-field contract**:
  [`packages/engine/src/core/events.ts`](../packages/engine/src/core/events.ts)
- **Every `RulePack` field, documented**:
  [`packages/engine/src/rules/rulepack.ts`](../packages/engine/src/rules/rulepack.ts)

## Conventions these files follow

- One concept per file; numbered because the order is a learning sequence.
- Fixed seeds everywhere, so your output matches the header's description
  (and the test suite's assertions) byte-for-byte on a given engine version.
- Examples 01-05 import only public package barrels (`@hoopsh/engine`,
  `@hoopsh/data`, `@hoopsh/stats`, `@hoopsh/narration`) — if an example ever
  needed engine internals, that would be an engine API bug worth filing.
  06 imports `packages/harness` by path: the harness is the one
  repo-internal package (see its barrel header), not embeddable surface.
