# Contributing to hoopsh

This is the short human version. Two documents are normative and win on any
disagreement: [AGENTS.md](./AGENTS.md) (the rules) and
[docs/PLAYBOOK.md](./docs/PLAYBOOK.md) (the step-by-step build procedure).
Project jargon — fingerprint, bands, sweep, SWEPT/REAL/FEEL — is defined in
[docs/GLOSSARY.md](./docs/GLOSSARY.md).

## Setup — there is none

Node 24+ and a clone (`.nvmrc` pins the major). No `npm install`; the repo runs from TypeScript source
via Node's native type stripping.

```bash
git clone https://github.com/alperien/hoopsh && cd hoopsh
npm run sim        # one full game in ~1 second — if this works, you are set up
```

`npm install` is optional and only adds dev tooling: `npm run typecheck`
(3s) and `npm run test:vitest`. CI runs both; you don't need them locally
to contribute.

## The one rule

**Never weaken, delete, or re-tune a test, invariant, or acceptance band to
make your change pass.** If an invariant test fails, the change is wrong, not
the test (AGENTS.md §1.6 — the highest-severity violation defined in this
repo). Report the failure verbatim instead; that is a good PR comment, not a
failed PR.

## The verification ladder (measured runtimes)

Measured 2026-07-29 at commit `edb9e3d` on a 3.9 games/sec box; scale by your
own `npm run bench`.

| Command | When | Time |
|---|---|---|
| `npm test` | every change, no exceptions | **~2 min** (the run prints the live count) |
| `npm run batch -- --games 24` | any mechanics/params change | 7s |
| `npm run sweep -- --iters 0 --games 4 --verify 40` | params changes (3 seed bases) | 36s |
| `npm run fingerprint` | refactors claiming no behavior change | 9s |
| `npm run bench` | hot-path changes | 8s |

`npm test` is the one slow rung — everything else in this repo answers in
1–15 seconds. For the inner loop, one test file runs in ~5s:

```bash
node --disable-warning=ExperimentalWarning --import ./tools/register.mjs \
  --test packages/engine/test/invariants.test.ts
```

Run the full suite before you claim done, not after every keystroke.

## Your first change, end to end

Say you are fixing a typo in `docs/ROSTERS.md`.

1. Branch, then capture the fingerprint before touching anything:

   ```bash
   npm run sim -- --seed fingerprint-1   # note event count + final score
   npm test                              # ~2 min; note tests/pass/fail/todo
   ```

   At `edb9e3d` that reads `1217 events`, `Breakers 111, Monarchs 124`,
   tests all passing (the run prints the count; 1 pre-existing todo is normal).
2. Make the edit.
3. If the file is a Bible source (check the `SOURCES` list in
   `tools/build-bible.mjs` — 11 docs at last count), regenerate in the same
   commit:
   `npm run docs:bible`. CI fails on Bible drift. Never edit `docs/BIBLE.md`
   itself.
4. Recapture the fingerprint. For a docs-only change it must be identical —
   same event count, same score, same test counts. Any difference means you
   touched executable code.
5. Commit with a conventional prefix (`docs: fix roster guide typo`) and open
   a PR. The PR template asks for the before/after fingerprint — you already
   have both.

That's the whole process for the docs tier. Heavier tiers below.

## Change tiers

The tier system is defined in AGENTS.md §4.3; PLAYBOOK Part 2 has a recipe
with a named exemplar for each shape of change.

- **Docs, comments, typos** — the walkthrough above. Fingerprint byte-identical
  before/after. PR directly.
- **Consumer change** (stats / narration / viewer / harness output) —
  `npm test` green, engine fingerprint untouched. PR directly; pattern-match
  the recipe in [docs/PLAYBOOK.md](./docs/PLAYBOOK.md) Part 2 (usually
  Recipe G).
- **Pure refactor** — fingerprint and test counts identical, provably
  (`npm run fingerprint` checks 24 seeds byte-for-byte).
- **Mechanics or params change** — the whole ladder, and expect band drift.
  **Open an issue first** (feature template): the calibrated defaults are
  coupled, re-tuning is a sweep task (see [docs/CALIBRATION.md](./docs/CALIBRATION.md)),
  and unauthorized recalibration is the most common way a good idea becomes an
  unmergeable PR. Do not arrive with a hand-tuned `params.ts` diff.

## What CI runs

Two jobs (`.github/workflows/ci.yml`), on every PR:

- **verify** (zero-install): `npm test` · gated 48-game acceptance bands
  (~14s locally, exits nonzero below the ratchet floor) · 24-seed golden
  fingerprint corpus · determinism double-run diff · Bible regeneration drift.
  Everything this job runs, you can run on a bare clone.
- **types**: `npm install` + `tsc --noEmit` (strict) + the same suite under
  real vitest. This is the one job a bare clone can't reproduce; with the dev
  install, `npm run typecheck` takes ~3s.

## Commits

Small, one concern each, conventional prefixes: `feat(engine):`, `fix:`,
`docs:`, `test:`, `refactor:`, `tune:`. State the verification you ran in the
body when it isn't obvious. History is kept bisectable.

## What a first-timer can ignore

For a typo fix, a doc fix, or a consumer feature, none of this is your
problem:

- the calibration machinery (`sweep`, `noisefloor`, `knobs.ts`, provenance
  tags on existing numbers — [docs/CALIBRATION.md](./docs/CALIBRATION.md)) —
  it only activates for mechanics-tier changes;
- the debt register ([docs/REGISTER.md](./docs/REGISTER.md)) and the planning
  and audit records under [docs/history/](./docs/history/) — internal working
  records, not required reading;
- `docs/BIBLE.md` — generated; never edit it by hand.

Reading path when you want more: `README.md` → [docs/README.md](./docs/README.md)
(the hub) → `AGENTS.md` before your first change → `docs/PLAYBOOK.md` when
building.

## Reporting

- Sim behaves wrongly → bug template (include the seed — same seed = same
  game).
- A statistic looks off vs the NBA bands → calibration-finding template (it
  will ask for n and seed bases; single-draw reports are noise, AGENTS.md
  §4.4).
- Security → [SECURITY.md](./SECURITY.md).
