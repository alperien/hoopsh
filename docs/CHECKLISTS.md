# CHECKLISTS — the per-tier verification gates, one page

Pick your tier (defined in [AGENTS.md §4.3](../AGENTS.md)), run its gates, write
the report. This page restates [AGENTS.md](../AGENTS.md) §4.2–§4.3 and
[docs/PLAYBOOK.md](./PLAYBOOK.md) Part 3; on any disagreement, those documents win.

## The fingerprint capture (referenced by every tier below)

```bash
npm run sim -- --seed fingerprint-1 2>&1 | grep -E "events|FINAL"   # event count + final score
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|todo)"                 # test counts (~2 min)
```

Run before your first edit and after your last one. Record all four numbers
(event count, final score, tests, pass) both times; the completion report shows
before AND after.

## Docs-only / comments-only

Gates:

- [ ] Fingerprint captured before and after (capture block above).
- [ ] `npm run docs:bible` in the same commit, if any edited file is in the
      `SOURCES` list of `tools/build-bible.mjs`. Never edit `docs/BIBLE.md`
      directly; CI fails on Bible drift.

Fingerprint expectation: **identical** before and after — same event count, same
final score, same test counts. Any difference means you touched executable code.

Completion report: [PLAYBOOK](./PLAYBOOK.md) Part 3 format (the PR template is
the short version — fill TASK, TIER, FINGERPRINT, the first two checkboxes).
`FINGERPRINT BEFORE` and `FINGERPRINT AFTER` lines identical. `TIER: docs-only`.

## Pure refactor (move code, no behavior change)

Gates:

- [ ] Fingerprint captured before and after (capture block above).
- [ ] `npm run fingerprint` — the 28-seed golden corpus, byte-identical.

Fingerprint expectation: **identical** before and after, test counts identical.
This is provable and expected — the orchestrator split was verified bit-for-bit
this way.

Completion report: PLAYBOOK Part 3 format. `FINGERPRINT BEFORE`/`AFTER` lines
identical; `npm run fingerprint` output pasted. `TIER: refactor`.

## Mechanics change

Gates:

- [ ] `npm test` — full suite (~2 min), green; invariants take precedence
      (AGENTS.md §1.6): if an invariant fails, the change is wrong, never the test.
- [ ] `npm run batch -- --games 24` — fine-grained NBA bands. Any mechanics/params change.
- [ ] `npm run sweep -- --iters 0 --games 4 --verify 40` — 3-seed band verification. Params changes.
- [ ] `npm run sweep -- --iters 14 --cands 4 --games 12 --verify 40` — re-tune.
      Only when bands drifted AND your brief authorizes recalibration.
- [ ] `npm run bench` — perf budget ≥1 game/sec. Hot-path changes.

If the change touches `sim/params.ts` values, mechanics that consume them, or
`harness/src/bands.ts`, [docs/CALIBRATION.md](./CALIBRATION.md) is law for it
(AGENTS.md §4.4).

Fingerprint expectation: expected to change — adding, removing, or reordering any
rng call changes every game thereafter (AGENTS.md §1.2). Capture before and after
anyway; the report shows both.

Completion report: PLAYBOOK Part 3 format, ladder outputs pasted. Band drift is
reported, never silently re-tuned: drift without pre-authorized recalibration is
a STOP condition (PLAYBOOK Part 3). `TIER: mechanics`.

## Consumer change (stats/narration/viewer)

Gates:

- [ ] Fingerprint captured before and after (capture block above).
- [ ] `npm test` — full suite (~2 min), green.

Fingerprint expectation: engine fingerprint **untouched** — same event count,
same final score before and after.

Completion report: PLAYBOOK Part 3 format. `FINGERPRINT BEFORE`/`AFTER` lines
show the engine fingerprint unchanged; `npm test` output pasted. `TIER: consumer`.
